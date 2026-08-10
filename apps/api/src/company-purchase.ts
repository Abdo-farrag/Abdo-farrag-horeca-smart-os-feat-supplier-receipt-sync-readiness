import crypto from 'node:crypto';
import { CompanyPurchaseRowSchema } from '@horeca/contracts';
import type { CompanyPurchaseDecisionInput, CompanyPurchaseRow } from '@horeca/contracts';
import type {
  CompanyPurchaseBulkResult,
  CompanyPurchaseDecisionResult,
  CompanyPurchaseDependencies,
  CompanyPurchaseListParams,
} from './auth/types.js';
import type { AppConfig } from './config.js';

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
  return `req-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function mapRowToCamelCase(row: Record<string, any>): CompanyPurchaseRow {
  const mapped = {
    companyId: Number(row.company_id),
    companyName: String(row.company_name ?? ''),
    productCode: String(row.product_code ?? ''),
    productName: String(row.product_name ?? ''),
    priority: String(row.priority ?? 'LOW'),
    freeQty: Number(row.free_qty ?? 0),
    effectiveDailyDemand: Number(row.effective_daily_demand ?? 0),
    coverageDays: row.coverage_days !== null && row.coverage_days !== undefined ? Number(row.coverage_days) : null,
    targetCoverageDays: Number(row.target_coverage_days ?? 14),
    suggestedQty: row.suggested_qty !== null && row.suggested_qty !== undefined ? Number(row.suggested_qty) : null,
    approvedQty: row.approved_qty !== null && row.approved_qty !== undefined ? Number(row.approved_qty) : null,
    supplierId: row.supplier_id !== null && row.supplier_id !== undefined ? Number(row.supplier_id) : null,
    supplierName: row.supplier_name ?? null,
    supplierReadiness: row.supplier_readiness ?? 'NEEDS_SUPPLIER',
    latestReceiptAt: row.latest_receipt_at ?? null,
    latestUnitCost: row.latest_unit_cost !== null && row.latest_unit_cost !== undefined ? Number(row.latest_unit_cost) : null,
    estimatedValue: row.estimated_value !== null && row.estimated_value !== undefined ? Number(row.estimated_value) : null,
    decisionStatus: row.decision_status ?? 'NEW',
    buyerNote: row.buyer_note ?? null,
    version: Number(row.version ?? 0),
    sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : null,
    readyForPo: Boolean(row.ready_for_po),
  };

  return CompanyPurchaseRowSchema.parse(mapped);
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

async function listCompanyPurchaseReview(
  config: AppConfig,
  params: CompanyPurchaseListParams,
): Promise<{
  data: {
    items: CompanyPurchaseRow[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
  error: null;
}> {
  const andConditions: string[] = [];

  if (params.company === '1') {
    andConditions.push('company_id.eq.1');
  } else if (params.company === '2') {
    andConditions.push('company_id.eq.2');
  }

  if (params.search) {
    const trimmed = params.search.trim();
    if (trimmed) {
      andConditions.push(`or(product_code.ilike.*${trimmed}*,product_name.ilike.*${trimmed}*)`);
    }
  }

  if (params.priority && params.priority !== 'all') {
    andConditions.push(`priority.eq.${params.priority}`);
  }

  if (params.decisionStatus && params.decisionStatus !== 'all') {
    andConditions.push(`decision_status.eq.${params.decisionStatus}`);
  }

  if (params.noSupplier) {
    andConditions.push('supplier_readiness.eq.NEEDS_SUPPLIER');
  }

  let filterString = '';
  if (andConditions.length > 0) {
    filterString = `and(${andConditions.join(',')})`;
  }

  const countQuery = `/rest/v1/api_company_purchase_review?select=product_code${filterString ? `&${filterString}` : ''}&count=exact&limit=0`;
  const countResponse = await supabaseRequest(config, countQuery, {
    headers: { Accept: 'application/json', Prefer: 'count=exact' },
  });

  let total = 0;
  if (countResponse.ok) {
    const countStr = countResponse.headers.get('content-range') ?? '';
    const match = countStr.match(/\/(\d+)$/);
    total = match && match[1] ? parseInt(match[1], 10) : 0;
  }

  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const offset = (params.page - 1) * params.pageSize;

  let dataQuery = `/rest/v1/api_company_purchase_review?select=*&order=company_id.asc,priority.desc.nullslast,product_code.asc&offset=${offset}&limit=${params.pageSize}`;
  if (filterString) {
    dataQuery += `&${filterString}`;
  }

  const response = await supabaseRequest(config, dataQuery, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase company purchase view error ${response.status}: ${text}`);
  }

  const rawRows = (await response.json()) as Record<string, any>[];
  const items = rawRows.map(mapRowToCamelCase);

  return {
    data: {
      items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages,
      },
    },
    error: null,
  };
}

async function saveCompanyPurchaseDecision(
  config: AppConfig,
  input: CompanyPurchaseDecisionInput,
  actorUserId: string,
  requestId: string,
): Promise<CompanyPurchaseDecisionResult> {
  const body = {
    p_company_id: input.companyId,
    p_product_code: input.productCode,
    p_decision_status: input.decisionStatus,
    p_approved_qty: input.approvedQty ?? null,
    p_approved_supplier_id: input.approvedSupplierId ?? null,
    p_approved_supplier_name: input.approvedSupplierName ?? null,
    p_buyer_note: input.buyerNote ?? null,
    p_expected_version: input.expectedVersion,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
  };

  const response = await supabaseRequest(config, '/rest/v1/rpc/rpc_review_company_purchase', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed = tryParseError(text);
    const msg = parsed?.message ?? text;
    if (msg.includes('VERSION_CONFLICT') || parsed?.code === '40001') {
      throw new Error('VERSION_CONFLICT');
    }
    throw new Error(msg);
  }

  const resJson = (await response.json()) as Record<string, any>;
  return {
    companyId: Number(resJson.companyId),
    productCode: String(resJson.productCode),
    approvedQty: resJson.approvedQty !== null && resJson.approvedQty !== undefined ? Number(resJson.approvedQty) : null,
    approvedSupplierId: resJson.approvedSupplierId !== null && resJson.approvedSupplierId !== undefined ? Number(resJson.approvedSupplierId) : null,
    approvedSupplierName: resJson.approvedSupplierName ?? null,
    decisionStatus: String(resJson.decisionStatus),
    buyerNote: resJson.buyerNote ?? null,
    version: Number(resJson.version),
    updatedAt: resJson.updatedAt ? String(resJson.updatedAt) : null,
  };
}

async function bulkSaveCompanyPurchaseDecisions(
  config: AppConfig,
  input: {
    items: CompanyPurchaseDecisionInput[];
    decisionStatus: string;
    buyerNote?: string | null;
  },
  actorUserId: string,
  requestId: string,
): Promise<CompanyPurchaseBulkResult> {
  const body = {
    p_items: input.items.map((item) => ({
      companyId: item.companyId,
      productCode: item.productCode,
      approvedQty: item.approvedQty ?? null,
      approvedSupplierId: item.approvedSupplierId ?? null,
      approvedSupplierName: item.approvedSupplierName ?? null,
      expectedVersion: item.expectedVersion,
    })),
    p_decision_status: input.decisionStatus,
    p_buyer_note: input.buyerNote ?? null,
    p_actor_user_id: actorUserId,
    p_request_id: requestId,
  };

  const response = await supabaseRequest(config, '/rest/v1/rpc/rpc_bulk_review_company_purchases', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed = tryParseError(text);
    const msg = parsed?.message ?? text;
    if (msg.includes('VERSION_CONFLICT') || parsed?.code === '40001') {
      throw new Error('VERSION_CONFLICT');
    }
    throw new Error(msg);
  }

  const resJson = (await response.json()) as { batchId: string; items: Record<string, any>[] };
  return {
    batchId: resJson.batchId,
    items: resJson.items.map((item) => ({
      companyId: Number(item.companyId),
      productCode: String(item.productCode),
      approvedQty: item.approvedQty !== null && item.approvedQty !== undefined ? Number(item.approvedQty) : null,
      approvedSupplierId: item.approvedSupplierId !== null && item.approvedSupplierId !== undefined ? Number(item.approvedSupplierId) : null,
      approvedSupplierName: item.approvedSupplierName ?? null,
      decisionStatus: String(item.decisionStatus),
      buyerNote: item.buyerNote ?? null,
      version: Number(item.version),
      updatedAt: item.updatedAt ? String(item.updatedAt) : null,
    })),
  };
}

async function exportCompanyPurchaseRows(
  config: AppConfig,
  query: { companyId?: number; scope: 'draft' | 'approved' },
): Promise<CompanyPurchaseRow[]> {
  const allRows: CompanyPurchaseRow[] = [];
  const pageSize = 1000;
  let page = 1;
  const maxPages = 50;

  const andConditions: string[] = [];
  if (query.companyId) {
    andConditions.push(`company_id.eq.${query.companyId}`);
  }
  if (query.scope === 'approved') {
    andConditions.push('decision_status.eq.APPROVED');
    andConditions.push('approved_qty.gt.0');
  }

  let filterString = '';
  if (andConditions.length > 0) {
    filterString = `and(${andConditions.join(',')})`;
  }

  while (page <= maxPages) {
    const offset = (page - 1) * pageSize;
    let dataQuery = `/rest/v1/api_company_purchase_review?select=*&order=company_id.asc,product_code.asc&offset=${offset}&limit=${pageSize}`;
    if (filterString) {
      dataQuery += `&${filterString}`;
    }

    const response = await supabaseRequest(config, dataQuery, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase export error ${response.status}: ${text}`);
    }

    const rawRows = (await response.json()) as Record<string, any>[];
    const mapped = rawRows.map(mapRowToCamelCase);
    allRows.push(...mapped);

    if (rawRows.length < pageSize) {
      break;
    }
    page++;
  }

  return allRows;
}

export function createSupabaseCompanyPurchaseDependencies(config: AppConfig): CompanyPurchaseDependencies {
  let currentRequestId = generateRequestId();

  return {
    list: (params) => listCompanyPurchaseReview(config, params),
    saveDecision: async (input) => {
      const result = await saveCompanyPurchaseDecision(
        config,
        input,
        '00000000-0000-0000-0000-000000000000',
        currentRequestId,
      );
      currentRequestId = generateRequestId();
      return result;
    },
    bulkSave: async (input) => {
      const result = await bulkSaveCompanyPurchaseDecisions(
        config,
        input,
        '00000000-0000-0000-0000-000000000000',
        currentRequestId,
      );
      currentRequestId = generateRequestId();
      return result;
    },
    exportRows: (query) => exportCompanyPurchaseRows(config, query),
  };
}
