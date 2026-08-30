import ExcelJS from 'exceljs';

export const REFERENCE_TEMPLATE_VERSION = '1.0';

const COLUMN_KEYS = [
  'template_version',
  'company_id',
  'company_name',
  'product_code',
  'product_name',
  'brand_id',
  'brand_name',
  'supplier_id',
  'supplier_code',
  'supplier_name',
  'supplier_product_code',
  'purchase_uom_code',
  'purchase_uom_name',
  'pack_size',
  'minimum_qty',
  'price',
  'currency_code',
  'delay_days',
  'sequence',
  'is_primary',
  'active',
  'effective_source',
  'brand_effective_source',
] as const;

export interface ReferenceExportRow {
  companyId: number;
  companyName: string;
  productCode: string;
  productName: string;
  brandId: number | null;
  brandName: string | null;
  supplierId: number | null;
  supplierCode: string | null;
  supplierName: string | null;
  supplierProductCode: string | null;
  purchaseUomCode: string | null;
  purchaseUomName: string | null;
  packSize: number | null;
  minimumQty: number | null;
  price: number | null;
  currencyCode: string | null;
  delayDays: number | null;
  sequence: number | null;
  isPrimary: boolean;
  active: boolean;
  effectiveSource: string | null;
  brandEffectiveSource: string | null;
}

export interface ReferenceImportRow {
  rowNumber: number;
  companyId?: number;
  productCode?: string;
  brandId?: number;
  brandName?: string;
  supplierId?: number;
  supplierCode?: string;
  supplierProductCode?: string;
  purchaseUomCode?: string;
  purchaseUomName?: string;
  packSize?: number;
  minimumQty?: number;
  price?: number;
  currencyCode?: string;
  delayDays?: number;
  sequence?: number;
  isPrimary?: boolean;
  active?: boolean;
}

export interface ReferenceValidationError {
  rowNumber: number;
  severity: 'ERROR';
  errorCode: string;
  errorMessage: string;
  originalRow: ReferenceImportRow;
}

export interface ReferenceValidationContext {
  productCodes: Set<string>;
  suppliers: Map<number, { supplierId: number; supplierCode: string | null }>;
  supplierIdsByCode: Map<string, number[]>;
  existingVendorKeys: Set<string>;
}

function exportValues(row: ReferenceExportRow): unknown[] {
  return [
    REFERENCE_TEMPLATE_VERSION,
    row.companyId,
    row.companyName,
    row.productCode,
    row.productName,
    row.brandId,
    row.brandName,
    row.supplierId,
    row.supplierCode,
    row.supplierName,
    row.supplierProductCode,
    row.purchaseUomCode,
    row.purchaseUomName,
    row.packSize,
    row.minimumQty,
    row.price,
    row.currencyCode ?? 'EGP',
    row.delayDays,
    row.sequence ?? 10,
    row.supplierId === null ? null : row.isPrimary,
    row.supplierId === null ? null : row.active,
    row.effectiveSource,
    row.brandEffectiveSource,
  ];
}

export async function buildReferenceWorkbook(
  rows: ReferenceExportRow[],
  generatedAt: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Horeca Smart OS';
  workbook.created = new Date(generatedAt);
  const sheet = workbook.addWorksheet('Product References', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.addRow([...COLUMN_KEYS]);
  for (const row of rows) sheet.addRow(exportValues(row));
  sheet.autoFilter = { from: 'A1', to: 'W1' };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF17365D' },
  };
  sheet.columns.forEach((column, index) => {
    column.width = [16, 12, 18, 18, 38, 12, 24, 16, 18, 28, 22, 20, 22, 14, 16, 14, 14, 12, 12, 12, 10, 18, 22][index] ?? 16;
  });

  const instructions = workbook.addWorksheet('Instructions');
  instructions.addRows([
    ['Horeca Smart Procurement Reference Template', REFERENCE_TEMPLATE_VERSION],
    ['Rule', 'Do not change template_version, company_id, product_code, or supplier_id unless assigning a different valid supplier.'],
    ['Preview', 'Uploading this file only validates it. Data changes happen only after explicit Apply.'],
    ['Supplier', 'Use supplier_id when possible. supplier_code may be used only when it uniquely identifies one active supplier. New supplier assignments default to active when active is blank.'],
    ['Brand', 'Use one consistent brand_name for the same product_code across all company/supplier rows.'],
  ]);
  instructions.getColumn(1).width = 24;
  instructions.getColumn(2).width = 110;

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return undefined;
}

function cellRawValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === 'object') {
    if ('result' in value) return value.result;
    return cell.text;
  }
  return value;
}

export async function parseReferenceWorkbook(buffer: Buffer): Promise<{
  templateVersion: string;
  rows: ReferenceImportRow[];
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.getWorksheet('Product References');
  if (!sheet) throw new Error('REFERENCE_SHEET_MISSING');

  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const key = optionalText(cellRawValue(cell))?.toLowerCase();
    if (key) headers.set(key, columnNumber);
  });
  for (const required of ['template_version', 'company_id', 'product_code']) {
    if (!headers.has(required)) throw new Error(`MISSING_COLUMN:${required}`);
  }

  const read = (row: ExcelJS.Row, key: string) => {
    const column = headers.get(key);
    return column ? cellRawValue(row.getCell(column)) : undefined;
  };
  const rows: ReferenceImportRow[] = [];
  let templateVersion = '';
  for (let rowNumber = 2; rowNumber <= sheet.actualRowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const productCode = optionalText(read(row, 'product_code'));
    const supplierId = optionalNumber(read(row, 'supplier_id'));
    const brandName = optionalText(read(row, 'brand_name'));
    if (!productCode && supplierId === undefined && !brandName) continue;
    templateVersion ||= optionalText(read(row, 'template_version')) ?? '';
    const parsed: ReferenceImportRow = { rowNumber };
    const assign = <K extends keyof ReferenceImportRow>(key: K, value: ReferenceImportRow[K]) => {
      if (value !== undefined) parsed[key] = value;
    };
    assign('companyId', optionalNumber(read(row, 'company_id')));
    assign('productCode', productCode);
    assign('brandId', optionalNumber(read(row, 'brand_id')));
    assign('brandName', brandName);
    assign('supplierId', supplierId);
    assign('supplierCode', optionalText(read(row, 'supplier_code')));
    assign('supplierProductCode', optionalText(read(row, 'supplier_product_code')));
    assign('purchaseUomCode', optionalText(read(row, 'purchase_uom_code')));
    assign('purchaseUomName', optionalText(read(row, 'purchase_uom_name')));
    assign('packSize', optionalNumber(read(row, 'pack_size')));
    assign('minimumQty', optionalNumber(read(row, 'minimum_qty')));
    assign('price', optionalNumber(read(row, 'price')));
    assign('currencyCode', optionalText(read(row, 'currency_code'))?.toUpperCase());
    assign('delayDays', optionalNumber(read(row, 'delay_days')));
    assign('sequence', optionalNumber(read(row, 'sequence')));
    assign('isPrimary', optionalBoolean(read(row, 'is_primary')));
    assign('active', optionalBoolean(read(row, 'active')));
    rows.push(parsed);
  }
  if (templateVersion !== REFERENCE_TEMPLATE_VERSION) {
    throw new Error('UNSUPPORTED_TEMPLATE_VERSION');
  }
  return { templateVersion, rows };
}

function validationError(
  row: ReferenceImportRow,
  errorCode: string,
  errorMessage: string,
): ReferenceValidationError {
  return {
    rowNumber: row.rowNumber,
    severity: 'ERROR',
    errorCode,
    errorMessage,
    originalRow: row,
  };
}

export function validateReferenceRows(
  rows: ReferenceImportRow[],
  context: ReferenceValidationContext,
): {
  validRows: ReferenceImportRow[];
  errors: ReferenceValidationError[];
  changes: Array<{
    rowNumber: number;
    companyId?: number;
    productCode?: string;
    supplierId?: number;
    changeType: 'INSERT' | 'UPDATE' | 'BRAND_ONLY' | 'NO_CHANGE';
  }>;
} {
  const errors: ReferenceValidationError[] = [];
  const invalidRows = new Set<number>();
  const vendorKeys = new Set<string>();
  const primaryKeys = new Map<string, number>();
  const brandByProduct = new Map<string, string>();

  const addError = (row: ReferenceImportRow, code: string, message: string) => {
    errors.push(validationError(row, code, message));
    invalidRows.add(row.rowNumber);
  };

  for (const row of rows) {
    if (!row.productCode || !context.productCodes.has(row.productCode)) {
      addError(row, 'UNKNOWN_PRODUCT_CODE', 'Product code does not exist in procurement reference data.');
      continue;
    }
    if (row.companyId !== 1 && row.companyId !== 2) {
      addError(row, 'INVALID_COMPANY_ID', 'Company ID must be 1 (MAS) or 2 (Horeca Smart).');
    }

    if (row.brandName) {
      const normalizedBrand = row.brandName.trim().toLocaleUpperCase('en-US');
      const previousBrand = brandByProduct.get(row.productCode);
      if (previousBrand && previousBrand !== normalizedBrand) {
        addError(row, 'INCONSISTENT_BRAND_NAME', 'The same product has different brand names in the workbook.');
      } else {
        brandByProduct.set(row.productCode, normalizedBrand);
      }
    }

    if (row.supplierId === undefined && row.supplierCode) {
      const matches = context.supplierIdsByCode.get(row.supplierCode.trim()) ?? [];
      if (matches.length === 1) row.supplierId = matches[0]!;
      else addError(row, 'UNKNOWN_OR_AMBIGUOUS_SUPPLIER_CODE', 'Supplier code must identify exactly one active supplier.');
    }
    if (row.supplierId !== undefined && !context.suppliers.has(row.supplierId)) {
      addError(row, 'SUPPLIER_NOT_SELECTABLE', 'Supplier is missing, inactive, or not selectable.');
    }

    const numericValues = [
      row.packSize,
      row.minimumQty,
      row.price,
      row.delayDays,
      row.sequence,
    ];
    if (numericValues.some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      addError(row, 'NEGATIVE_VALUE_NOT_ALLOWED', 'Quantities, price, delay, and sequence must be non-negative numbers.');
    }
    if (row.currencyCode && !/^[A-Z]{3}$/.test(row.currencyCode)) {
      addError(row, 'INVALID_CURRENCY_CODE', 'Currency must be a three-letter code such as EGP.');
    }

    if (row.supplierId !== undefined && row.companyId !== undefined) {
      const vendorKey = `${row.companyId}|${row.productCode}|${row.supplierId}`;
      if (vendorKeys.has(vendorKey)) {
        addError(row, 'DUPLICATE_VENDOR_MAPPING', 'The same company, product, and supplier appears more than once.');
      } else {
        vendorKeys.add(vendorKey);
      }
      if ((row.active ?? true) && (row.isPrimary ?? false)) {
        const productKey = `${row.companyId}|${row.productCode}`;
        const priorRow = primaryKeys.get(productKey);
        if (priorRow !== undefined) {
          addError(row, 'MULTIPLE_PRIMARY_SUPPLIERS', `Only one primary supplier is allowed; row ${priorRow} is already primary.`);
        } else {
          primaryKeys.set(productKey, row.rowNumber);
        }
      }
    }
  }

  const validRows = rows.filter((row) => !invalidRows.has(row.rowNumber));
  const changes = validRows.map((row) => {
    const vendorKey = row.companyId !== undefined && row.productCode && row.supplierId !== undefined
      ? `${row.companyId}|${row.productCode}|${row.supplierId}`
      : null;
    const changeType = vendorKey
      ? context.existingVendorKeys.has(vendorKey) ? 'UPDATE' as const : 'INSERT' as const
      : row.brandName ? 'BRAND_ONLY' as const : 'NO_CHANGE' as const;
    return {
      rowNumber: row.rowNumber,
      ...(row.companyId === undefined ? {} : { companyId: row.companyId }),
      ...(row.productCode ? { productCode: row.productCode } : {}),
      ...(row.supplierId === undefined ? {} : { supplierId: row.supplierId }),
      changeType,
    };
  });
  return { validRows, errors, changes };
}
