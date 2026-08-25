import { createHash } from 'node:crypto';
import type { ReferenceDataDependencies } from './auth/types.js';
import type { AppConfig } from './config.js';
import {
  buildReferenceWorkbook,
  parseReferenceWorkbook,
  validateReferenceRows,
  type ReferenceExportRow,
  type ReferenceImportRow,
  type ReferenceValidationError,
} from './reference-data.js';

const OVERVIEW_ACTOR_ID = null;
const PAGE_SIZE = 1000;

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

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  const payload = await response.text();
  let message = 'REFERENCE_DATA_UNAVAILABLE';
  try {
    const parsed = JSON.parse(payload) as { message?: string; code?: string };
    message = parsed.message ?? parsed.code ?? message;
  } catch {
    // Do not expose upstream response bodies.
  }
  const stableCodes = [
    'IMPORT_FILE_ALREADY_APPLIED',
    'IMPORT_BATCH_ALREADY_APPLIED',
    'IMPORT_HAS_BLOCKING_ERRORS',
    'IMPORT_BATCH_NOT_FOUND',
    'IMPORT_ROW_COUNT_MISMATCH',
  ];
  throw new Error(stableCodes.find((code) => message.includes(code)) ?? 'REFERENCE_DATA_UNAVAILABLE');
}

async function fetchAllRows(
  config: AppConfig,
  objectName: string,
  order: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query = new URLSearchParams({
      select: '*',
      order,
      offset: String(offset),
      limit: String(PAGE_SIZE),
    });
    const response = await requireOk(await supabaseRequest(
      config,
      `/rest/v1/${objectName}?${query.toString()}`,
    ));
    const page = await response.json() as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapExportRow(row: Record<string, unknown>): ReferenceExportRow {
  return {
    companyId: Number(row.company_id),
    companyName: String(row.company_name),
    productCode: String(row.product_code),
    productName: String(row.product_name),
    brandId: numberOrNull(row.brand_id),
    brandName: row.brand_name === null || row.brand_name === undefined
      ? null
      : String(row.brand_name),
    supplierId: numberOrNull(row.supplier_id),
    supplierCode: row.supplier_code === null || row.supplier_code === undefined
      ? null
      : String(row.supplier_code),
    supplierName: row.supplier_name === null || row.supplier_name === undefined
      ? null
      : String(row.supplier_name),
    supplierProductCode: row.supplier_product_code === null || row.supplier_product_code === undefined
      ? null
      : String(row.supplier_product_code),
    purchaseUomCode: row.purchase_uom_code === null || row.purchase_uom_code === undefined
      ? null
      : String(row.purchase_uom_code),
    purchaseUomName: row.purchase_uom_name === null || row.purchase_uom_name === undefined
      ? null
      : String(row.purchase_uom_name),
    packSize: numberOrNull(row.pack_size),
    minimumQty: numberOrNull(row.minimum_qty),
    price: numberOrNull(row.price),
    currencyCode: row.currency_code === null || row.currency_code === undefined
      ? null
      : String(row.currency_code),
    delayDays: numberOrNull(row.delay_days),
    sequence: numberOrNull(row.sequence),
    isPrimary: Boolean(row.is_primary),
    active: row.active === undefined ? true : Boolean(row.active),
    effectiveSource: row.effective_source === null || row.effective_source === undefined
      ? null
      : String(row.effective_source),
    brandEffectiveSource: row.brand_effective_source === null || row.brand_effective_source === undefined
      ? null
      : String(row.brand_effective_source),
  };
}

function databaseImportRow(row: ReferenceImportRow): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    product_code: row.productCode,
  };
  const fields: Array<[keyof ReferenceImportRow, string]> = [
    ['companyId', 'company_id'],
    ['brandId', 'brand_id'],
    ['brandName', 'brand_name'],
    ['supplierId', 'supplier_id'],
    ['supplierCode', 'supplier_code'],
    ['supplierProductCode', 'supplier_product_code'],
    ['purchaseUomCode', 'purchase_uom_code'],
    ['purchaseUomName', 'purchase_uom_name'],
    ['packSize', 'pack_size'],
    ['minimumQty', 'minimum_qty'],
    ['price', 'price'],
    ['currencyCode', 'currency_code'],
    ['delayDays', 'delay_days'],
    ['sequence', 'sequence'],
    ['isPrimary', 'is_primary'],
    ['active', 'active'],
  ];
  for (const [source, destination] of fields) {
    if (row[source] !== undefined) mapped[destination] = row[source];
  }
  return mapped;
}

function databaseError(error: ReferenceValidationError): Record<string, unknown> {
  return {
    row_number: error.rowNumber,
    severity: error.severity,
    error_code: error.errorCode,
    error_message: error.errorMessage,
    original_row: databaseImportRow(error.originalRow),
  };
}

async function callRpc(
  config: AppConfig,
  name: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await requireOk(await supabaseRequest(config, `/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  return response.json() as Promise<unknown>;
}

async function loadReferenceContext(config: AppConfig) {
  const [rawExportRows, rawSuppliers] = await Promise.all([
    fetchAllRows(
      config,
      'api_procurement_product_reference_bulk_export',
      'company_id.asc,product_code.asc,supplier_id.asc',
    ),
    fetchAllRows(
      config,
      'api_procurement_supplier_directory',
      'supplier_name.asc,supplier_id.asc',
    ),
  ]);
  const exportRows = rawExportRows.map(mapExportRow);
  const suppliers = new Map<number, { supplierId: number; supplierCode: string | null }>();
  const supplierIdsByCode = new Map<string, number[]>();
  for (const row of rawSuppliers) {
    const supplierId = Number(row.supplier_id);
    const supplierCode = row.supplier_code === null || row.supplier_code === undefined
      ? null
      : String(row.supplier_code).trim();
    suppliers.set(supplierId, { supplierId, supplierCode });
    if (supplierCode) {
      supplierIdsByCode.set(
        supplierCode,
        [...(supplierIdsByCode.get(supplierCode) ?? []), supplierId],
      );
    }
  }
  return {
    exportRows,
    productCodes: new Set(exportRows.map((row) => row.productCode)),
    suppliers,
    supplierIdsByCode,
    existingVendorKeys: new Set(exportRows
      .filter((row) => row.supplierId !== null)
      .map((row) => `${row.companyId}|${row.productCode}|${row.supplierId}`)),
  };
}

export function createSupabaseReferenceDataDependencies(
  config: AppConfig,
): ReferenceDataDependencies {
  return {
    exportWorkbook: async () => {
      const rawRows = await fetchAllRows(
        config,
        'api_procurement_product_reference_bulk_export',
        'company_id.asc,product_code.asc,supplier_id.asc',
      );
      return buildReferenceWorkbook(rawRows.map(mapExportRow), new Date().toISOString());
    },
    previewImport: async ({ filename, contentBase64 }) => {
      const buffer = Buffer.from(contentBase64, 'base64');
      const checksum = createHash('sha256').update(buffer).digest('hex');
      const [{ templateVersion, rows }, context] = await Promise.all([
        parseReferenceWorkbook(buffer),
        loadReferenceContext(config),
      ]);
      const validation = validateReferenceRows(rows, context);
      const normalizedRows = validation.validRows.map(databaseImportRow);
      const errors = validation.errors.map(databaseError);
      const batchId = await callRpc(config, 'record_procurement_reference_import_preview', {
        p_original_filename: filename,
        p_file_checksum: checksum,
        p_template_version: templateVersion,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_actor_display_name: 'Overview Dashboard',
        p_total_rows: rows.length,
        p_valid_rows: normalizedRows.length,
        p_invalid_rows: validation.errors.length === 0
          ? 0
          : new Set(validation.errors.map((error) => error.rowNumber)).size,
        p_rows: normalizedRows,
        p_errors: errors,
      });
      return {
        batchId: String(batchId),
        filename,
        templateVersion,
        totalRows: rows.length,
        validRows: normalizedRows.length,
        invalidRows: new Set(validation.errors.map((error) => error.rowNumber)).size,
        errors,
        changes: validation.changes,
      };
    },
    applyImport: async (batchId) => {
      const result = await callRpc(config, 'apply_procurement_reference_import', {
        p_batch_id: batchId,
        p_actor_user_id: OVERVIEW_ACTOR_ID,
        p_actor_display_name: 'Overview Dashboard',
      }) as Record<string, unknown>;
      return {
        batchId: String(result.batch_id),
        status: 'APPLIED' as const,
        inserted: Number(result.inserted ?? 0),
        updated: Number(result.updated ?? 0),
        unchanged: Number(result.unchanged ?? 0),
        skipped: Number(result.skipped ?? 0),
      };
    },
  };
}
