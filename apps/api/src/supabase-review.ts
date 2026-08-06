import type { AppConfig } from './config.js';
import type { ApprovalDecision, BulkUpdateResult, ReviewDependencies } from './auth/types.js';
import crypto from 'node:crypto';

async function supabaseRequest(config: AppConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

function generateRequestId(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function getReviewProducts(
  config: AppConfig,
  params: {
    company?: string;
    search?: string;
    priority?: string;
    decisionStatus?: string;
    noSupplier?: boolean;
    page: number;
    pageSize: number;
  },
): Promise<unknown> {
  // Build Supabase REST query with filters
  const andConditions: string[] = [];

  // Filter by company (using approved_supplier_id as proxy for company-specific products)
  // The v_recommendation_approvals view doesn't have company_id, so we skip company filter here
  // and the frontend can use the overview API for company-specific data

  if (params.search) {
    andConditions.push(
      `or(product_code.ilike.*${params.search}*,product_name.ilike.*${params.search}*)`,
    );
  }

  if (params.priority && params.priority !== 'all') {
    andConditions.push(`priority.eq.${params.priority}`);
  }

  if (params.decisionStatus && params.decisionStatus !== 'all') {
    andConditions.push(`decision_status.eq.${params.decisionStatus}`);
  }

  if (params.noSupplier) {
    andConditions.push('supplier_status.eq.NEEDS_SUPPLIER');
  }

  let filterString = '';
  if (andConditions.length > 0) {
    filterString = `and(${andConditions.join(',')})`;
  }

  // Get count for pagination
  const countQuery = `/rest/v1/v_recommendation_approvals?select=product_code${filterString ? `&${filterString}` : ''}&count=exact&limit=0`;
  const countResponse = await supabaseRequest(config, countQuery, {
    headers: { Accept: 'application/json', Prefer: 'count=exact' },
  });

  let total = 0;
  if (countResponse.ok) {
    const countStr = countResponse.headers.get('content-range') ?? '';
    const match = countStr.match(/\/(\d+)$/);
    total = match && match[1] ? parseInt(match[1], 10) : 0;
  }

  // If count is 0 via content-range, try prefer header
  if (total === 0) {
    const countPrefer = countResponse.headers.get('content-range') ?? '';
    if (!countPrefer) {
      // Try fetching first page to determine total
      const fallbackQuery = `/rest/v1/v_recommendation_approvals?select=product_code${filterString ? `&${filterString}` : ''}`;
      const fallbackResponse = await supabaseRequest(config, fallbackQuery, {
        headers: { Accept: 'application/json', Prefer: 'count=exact' },
      });
      if (fallbackResponse.ok) {
        const cr = fallbackResponse.headers.get('content-range') ?? '';
        const m = cr.match(/\/(\d+)$/);
        total = m && m[1] ? parseInt(m[1], 10) : 0;
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const offset = (params.page - 1) * params.pageSize;

  // Build the main data query
  let dataQuery = `/rest/v1/v_recommendation_approvals?select=*&order=priority.desc.nullslast,product_code.asc&offset=${offset}&limit=${params.pageSize}`;
  if (filterString) {
    dataQuery += `&${filterString}`;
  }

  const response = await supabaseRequest(config, dataQuery, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase review view error ${response.status}: ${text}`);
  }

  const rows = await response.json();

  return {
    data: {
      rows,
      pagination: {
        page: params.page,
        total,
        pageSize: params.pageSize,
        totalPages,
      },
    },
  };
}

async function approveRecommendation(
  config: AppConfig,
  productCode: string,
  decisionStatus: string,
  approvedQty: number | null,
  approvedSupplierId: number | null,
  approvedSupplierName: string | null,
  buyerNote: string | null,
  expectedVersion: number,
  actorUserId: string,
  requestId: string,
): Promise<ApprovalDecision> {
  const body = {
    p_product_code: productCode,
    p_decision_status: decisionStatus,
    p_approved_qty: approvedQty,
    p_approved_supplier_id: approvedSupplierId,
    p_approved_supplier_name: approvedSupplierName,
    p_buyer_note: buyerNote,
    p_expected_version: expectedVersion,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
  };

  const response = await supabaseRequest(
    config,
    '/rest/v1/rpc/rpc_approve_recommendation',
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!response.ok) {
    const text = await response.text();
    const parsed = tryParseError(text);
    throw new Error(parsed?.message ?? `Supabase approval RPC error ${response.status}: ${text}`);
  }

  return response.json() as Promise<ApprovalDecision>;
}

async function bulkUpdateRecommendations(
  config: AppConfig,
  items: Array<{
    productCode: string;
    approvedQty: number | null;
    approvedSupplierId: number | null;
    approvedSupplierName: string | null;
    expectedVersion: number;
  }>,
  decisionStatus: string,
  buyerNote: string | null,
  actorUserId: string,
  requestId: string,
): Promise<BulkUpdateResult> {
  const body = {
    p_items: items.map((item) => ({
      productCode: item.productCode,
      approvedQty: item.approvedQty,
      approvedSupplierId: item.approvedSupplierId,
      approvedSupplierName: item.approvedSupplierName,
      expectedVersion: item.expectedVersion,
    })),
    p_decision_status: decisionStatus,
    p_buyer_note: buyerNote,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
  };

  const response = await supabaseRequest(
    config,
    '/rest/v1/rpc/rpc_bulk_update_recommendations',
    { method: 'POST', body: JSON.stringify(body) },
  );

  if (!response.ok) {
    const text = await response.text();
    const parsed = tryParseError(text);
    throw new Error(parsed?.message ?? `Supabase bulk RPC error ${response.status}: ${text}`);
  }

  return response.json() as Promise<BulkUpdateResult>;
}

function tryParseError(text: string): { message: string; code?: string } | null {
  try {
    const json = JSON.parse(text);
    if (json.message) return { message: json.message, code: json.code };
    return null;
  } catch {
    return null;
  }
}

export function createSupabaseReviewDependencies(config: AppConfig): ReviewDependencies {
  let currentRequestId = generateRequestId();

  return {
    getReviewProducts: (params) => getReviewProducts(config, params),
    approveRecommendation: async (
      productCode,
      decisionStatus,
      approvedQty,
      approvedSupplierId,
      approvedSupplierName,
      buyerNote,
      expectedVersion,
    ) => {
      const result = await approveRecommendation(
        config,
        productCode,
        decisionStatus,
        approvedQty,
        approvedSupplierId,
        approvedSupplierName,
        buyerNote,
        expectedVersion,
        '00000000-0000-0000-0000-000000000000',
        currentRequestId,
      );
      currentRequestId = generateRequestId();
      return result;
    },
    bulkUpdateRecommendations: async (items, decisionStatus, buyerNote) => {
      const result = await bulkUpdateRecommendations(
        config,
        items,
        decisionStatus,
        buyerNote,
        '00000000-0000-0000-0000-000000000000',
        currentRequestId,
      );
      currentRequestId = generateRequestId();
      return result;
    },
  };
}
