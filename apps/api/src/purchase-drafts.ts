import {
  PurchaseDraftLineSchema,
  PurchaseDraftSchema,
  SupplierDirectoryItemSchema,
  type PurchaseDraft,
  type PurchaseDraftCreateInput,
  type PurchaseDraftLine,
  type PurchaseDraftLineInput,
  type PurchaseDraftRfqReferenceInput,
  type PurchaseDraftStatusInput,
  type SupplierDirectoryQuery,
} from '@horeca/contracts';
import type { PurchaseDraftDependencies } from './auth/types.js';
import type { AppConfig } from './config.js';

const OVERVIEW_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

async function supabaseRequest(
  config: AppConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

function requestId(): string {
  return `purchase-draft-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

function safeSearchTerm(value: string): string {
  return value.replace(/[%*(),.]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const text = await response.text();
  let message = text;
  try {
    const payload = JSON.parse(text) as { message?: string; code?: string };
    message = payload.message ?? payload.code ?? text;
    if (payload.code === '40001') message = 'VERSION_CONFLICT';
  } catch {
    // Keep the sanitized caller-facing error classification below.
  }
  const stableCodes = [
    'VERSION_CONFLICT',
    'SUPPLIER_NOT_FOUND',
    'DRAFT_NOT_FOUND',
    'DRAFT_LINE_NOT_FOUND',
    'DRAFT_NOT_EDITABLE',
    'INVALID_STATUS_TRANSITION',
    'RFQ_REFERENCE_NOT_ALLOWED',
    'RECOMMENDATION_NOT_FOUND',
    'NON_POSITIVE_SUGGESTED_QUANTITY',
  ];
  const code = stableCodes.find((candidate) => message.includes(candidate));
  throw new Error(code ?? 'PURCHASE_DRAFT_UNAVAILABLE');
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapDraft(row: Record<string, unknown>): PurchaseDraft {
  return PurchaseDraftSchema.parse({
    id: row.id,
    status: row.status,
    companyId: Number(row.company_id),
    companyName: row.company_name,
    supplierId: Number(row.supplier_id),
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code ?? null,
    expectedReceiptDate: row.expected_receipt_date ?? null,
    buyerNote: row.buyer_note ?? null,
    odooRfqId: numberOrNull(row.odoo_rfq_id),
    odooRfqName: row.odoo_rfq_name ?? null,
    version: Number(row.version),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapLine(row: Record<string, unknown>): PurchaseDraftLine {
  return PurchaseDraftLineSchema.parse({
    id: row.id,
    draftId: row.draft_id,
    productCode: row.product_code,
    productName: row.product_name,
    brandName: row.brand_name ?? null,
    suggestedQty: Number(row.suggested_qty),
    approvedQty: Number(row.approved_qty),
    purchaseUom: row.purchase_uom_name ?? null,
    minimumOrderQty: numberOrNull(row.minimum_order_qty),
    orderMultiple: numberOrNull(row.order_multiple),
    unitPrice: numberOrNull(row.unit_price),
    priceSource: row.price_source,
    currency: row.currency ?? null,
    warnings: row.warnings ?? [],
    sourceRecommendationVersion: Number(row.source_recommendation_version),
    version: Number(row.version),
    buyerNote: row.buyer_note ?? null,
  });
}

async function listSuppliers(config: AppConfig, query: SupplierDirectoryQuery) {
  const filters = new URLSearchParams({
    select: '*',
    order: 'supplier_name.asc,supplier_id.asc',
    offset: String((query.page - 1) * query.pageSize),
    limit: String(query.pageSize),
  });
  const search = safeSearchTerm(query.search);
  if (search) {
    filters.set(
      'or',
      `(supplier_name.ilike.*${search}*,supplier_code.ilike.*${search}*)`,
    );
  }
  const response = await requireOk(await supabaseRequest(
    config,
    `/rest/v1/api_procurement_supplier_directory?${filters.toString()}`,
    { headers: { Prefer: 'count=exact' } },
  ));
  const rows = await response.json() as Record<string, unknown>[];
  const totalMatch = response.headers.get('content-range')?.match(/\/(\d+)$/);
  const total = totalMatch?.[1] ? Number(totalMatch[1]) : rows.length;
  return {
    items: rows.map((row) => SupplierDirectoryItemSchema.parse({
      supplierId: Number(row.supplier_id),
      supplierName: row.supplier_name,
      supplierCode: row.supplier_code ?? null,
      supplierRank: Number(row.supplier_rank),
      active: row.active,
      sourceUpdatedAt: row.source_updated_at
        ? new Date(String(row.source_updated_at)).toISOString()
        : null,
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

async function listBrands(config: AppConfig) {
  const [brandResponse, undefinedResponse] = await Promise.all([
    supabaseRequest(
      config,
      '/rest/v1/api_procurement_brand_options?select=*&order=brand_name.asc',
    ),
    supabaseRequest(
      config,
      '/rest/v1/procurement_product_purchase_metadata?select=product_code&brand_name=is.null&limit=0',
      { headers: { Prefer: 'count=exact' } },
    ),
  ]);
  await Promise.all([requireOk(brandResponse), requireOk(undefinedResponse)]);
  const rows = await brandResponse.json() as Record<string, unknown>[];
  const undefinedMatch = undefinedResponse.headers.get('content-range')?.match(/\/(\d+)$/);
  return [
    {
      brandId: null,
      brandName: null,
      productCount: undefinedMatch?.[1] ? Number(undefinedMatch[1]) : 0,
    },
    ...rows.map((row) => ({
      brandId: numberOrNull(row.brand_id),
      brandName: row.brand_name === null ? null : String(row.brand_name),
      productCount: Number(row.product_count),
    })),
  ];
}

async function listDrafts(
  config: AppConfig,
  query: { status?: string; companyId?: number; supplierId?: number },
): Promise<PurchaseDraft[]> {
  const filters = new URLSearchParams({ select: '*', order: 'updated_at.desc', limit: '200' });
  if (query.status) filters.set('status', `eq.${query.status}`);
  if (query.companyId) filters.set('company_id', `eq.${query.companyId}`);
  if (query.supplierId) filters.set('supplier_id', `eq.${query.supplierId}`);
  const response = await requireOk(await supabaseRequest(
    config,
    `/rest/v1/api_purchase_drafts?${filters.toString()}`,
  ));
  const rows = await response.json() as Record<string, unknown>[];
  return rows.map(mapDraft);
}

async function getDraft(config: AppConfig, draftId: string) {
  const [draftResponse, lineResponse] = await Promise.all([
    supabaseRequest(config, `/rest/v1/api_purchase_drafts?id=eq.${draftId}&select=*&limit=1`),
    supabaseRequest(
      config,
      `/rest/v1/api_purchase_draft_lines?draft_id=eq.${draftId}&select=*&order=product_code.asc`,
    ),
  ]);
  await Promise.all([requireOk(draftResponse), requireOk(lineResponse)]);
  const draftRows = await draftResponse.json() as Record<string, unknown>[];
  if (!draftRows[0]) throw new Error('DRAFT_NOT_FOUND');
  const lineRows = await lineResponse.json() as Record<string, unknown>[];
  return { draft: mapDraft(draftRows[0]), lines: lineRows.map(mapLine) };
}

async function callRpc(
  config: AppConfig,
  name: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await requireOk(await supabaseRequest(config, `/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  return await response.json() as Record<string, unknown>;
}

export function createSupabasePurchaseDraftDependencies(
  config: AppConfig,
): PurchaseDraftDependencies {
  return {
    listSuppliers: (query) => listSuppliers(config, query),
    listBrands: () => listBrands(config),
    listDrafts: (query) => listDrafts(config, query),
    getDraft: (draftId) => getDraft(config, draftId),
    createDraft: async (input: PurchaseDraftCreateInput) => {
      const result = await callRpc(config, 'rpc_create_purchase_draft', {
        p_company_id: input.companyId,
        p_supplier_id: input.supplierId,
        p_expected_receipt_date: input.expectedReceiptDate ?? null,
        p_buyer_note: input.buyerNote ?? null,
        p_items: input.items,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_request_id: requestId(),
      });
      return getDraft(config, String(result.id));
    },
    updateLine: async (draftId, lineId, input: PurchaseDraftLineInput) => {
      const result = await callRpc(config, 'rpc_update_purchase_draft_line', {
        p_draft_id: draftId,
        p_line_id: lineId,
        p_approved_qty: input.approvedQty,
        p_unit_price: input.unitPrice ?? null,
        p_buyer_note: input.buyerNote ?? null,
        p_expected_version: input.expectedVersion,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_request_id: requestId(),
      });
      return mapLine(result);
    },
    changeSupplier: async (draftId, input) => mapDraft(await callRpc(
      config,
      'rpc_change_purchase_draft_supplier',
      {
        p_draft_id: draftId,
        p_supplier_id: input.supplierId,
        p_expected_version: input.expectedVersion,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_request_id: requestId(),
      },
    )),
    transition: async (draftId, input: PurchaseDraftStatusInput) => mapDraft(await callRpc(
      config,
      'rpc_transition_purchase_draft',
      {
        p_draft_id: draftId,
        p_status: input.status,
        p_expected_version: input.expectedVersion,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_request_id: requestId(),
      },
    )),
    setRfqReference: async (draftId, input: PurchaseDraftRfqReferenceInput) => mapDraft(
      await callRpc(config, 'rpc_set_purchase_draft_rfq_reference', {
        p_draft_id: draftId,
        p_odoo_rfq_id: input.odooRfqId ?? null,
        p_odoo_rfq_name: input.odooRfqName,
        p_expected_version: input.expectedVersion,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_request_id: requestId(),
      }),
    ),
  };
}
