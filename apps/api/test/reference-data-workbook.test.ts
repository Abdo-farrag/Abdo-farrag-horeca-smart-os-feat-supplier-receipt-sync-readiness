import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildReferenceWorkbook,
  parseReferenceWorkbook,
  validateReferenceRows,
  type ReferenceExportRow,
} from '../src/reference-data.js';

const exportRow: ReferenceExportRow = {
  companyId: 1,
  companyName: 'MAS',
  productCode: '101071',
  productName: 'Chocolate Sauce',
  brandId: null,
  brandName: 'BODUO',
  supplierId: 29906,
  supplierCode: 'IFI-01',
  supplierName: 'ifico masr',
  supplierProductCode: null,
  purchaseUomCode: null,
  purchaseUomName: 'Carton',
  packSize: 6,
  minimumQty: 12,
  price: 1900,
  currencyCode: 'EGP',
  delayDays: 2,
  sequence: 10,
  isPrimary: true,
  active: true,
  effectiveSource: 'ODOO_SYNC',
  brandEffectiveSource: 'ODOO_SYNC',
};

describe('procurement reference workbook', () => {
  it('exports stable editable columns and preserves supplier identifiers', async () => {
    const buffer = await buildReferenceWorkbook([exportRow], '2026-08-25T10:00:00.000Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Product References');

    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).values).toEqual([
      undefined,
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
    ]);
    expect(sheet!.getRow(2).getCell(8).value).toBe(29906);
    expect(sheet!.getRow(2).getCell(9).value).toBe('IFI-01');
    expect(sheet!.views[0]?.state).toBe('frozen');
  });

  it('round-trips exported rows into normalized import rows', async () => {
    const buffer = await buildReferenceWorkbook([exportRow], '2026-08-25T10:00:00.000Z');
    const parsed = await parseReferenceWorkbook(buffer);

    expect(parsed.templateVersion).toBe('1.0');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      rowNumber: 2,
      companyId: 1,
      productCode: '101071',
      brandName: 'BODUO',
      supplierId: 29906,
      currencyCode: 'EGP',
      isPrimary: true,
    });
  });

  it('leaves vendor flags blank for products without a supplier so new assignments default active', async () => {
    const buffer = await buildReferenceWorkbook([
      exportRow,
      {
        ...exportRow,
        productCode: '101072',
        supplierId: null,
        supplierCode: null,
        supplierName: null,
        isPrimary: false,
        active: false,
      },
    ], '2026-08-25T10:00:00.000Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Product References')!;

    expect(sheet.getRow(2).getCell(20).value).toBe(true);
    expect(sheet.getRow(2).getCell(21).value).toBe(true);
    expect(sheet.getRow(3).getCell(20).value).toBeNull();
    expect(sheet.getRow(3).getCell(21).value).toBeNull();

    const parsed = await parseReferenceWorkbook(buffer);
    expect(parsed.rows[1]).not.toHaveProperty('isPrimary');
    expect(parsed.rows[1]).not.toHaveProperty('active');
  });

  it('rejects unknown suppliers, negative values, duplicate mappings, and multiple primaries', () => {
    const rows = [
      {
        rowNumber: 2,
        companyId: 1,
        productCode: '101071',
        brandName: 'BODUO',
        supplierId: 29906,
        minimumQty: 12,
        currencyCode: 'EGP',
        isPrimary: true,
        active: true,
      },
      {
        rowNumber: 3,
        companyId: 1,
        productCode: '101071',
        brandName: 'BODUO',
        supplierId: 29906,
        minimumQty: -1,
        currencyCode: 'EGP',
        isPrimary: true,
        active: true,
      },
      {
        rowNumber: 4,
        companyId: 1,
        productCode: '101071',
        brandName: 'BODUO',
        supplierId: 99999,
        currencyCode: 'EGP',
        isPrimary: true,
        active: true,
      },
    ];

    const result = validateReferenceRows(rows, {
      productCodes: new Set(['101071']),
      suppliers: new Map([[29906, { supplierId: 29906, supplierCode: 'IFI-01' }]]),
      supplierIdsByCode: new Map([['IFI-01', [29906]]]),
      existingVendorKeys: new Set(['1|101071|29906']),
    });

    expect(result.validRows).toHaveLength(1);
    expect(result.errors.map((error) => error.errorCode)).toEqual(expect.arrayContaining([
      'DUPLICATE_VENDOR_MAPPING',
      'NEGATIVE_VALUE_NOT_ALLOWED',
      'SUPPLIER_NOT_SELECTABLE',
    ]));
  });

  it('resolves a unique supplier code and blocks inconsistent brand values for one product', () => {
    const result = validateReferenceRows([
      {
        rowNumber: 2,
        companyId: 1,
        productCode: '101071',
        brandName: 'BODUO',
        supplierCode: 'IFI-01',
        active: true,
        isPrimary: false,
      },
      {
        rowNumber: 3,
        companyId: 2,
        productCode: '101071',
        brandName: 'Different Brand',
        active: true,
        isPrimary: false,
      },
    ], {
      productCodes: new Set(['101071']),
      suppliers: new Map([[29906, { supplierId: 29906, supplierCode: 'IFI-01' }]]),
      supplierIdsByCode: new Map([['IFI-01', [29906]]]),
      existingVendorKeys: new Set<string>(),
    });

    expect(result.validRows[0]).toMatchObject({ supplierId: 29906 });
    expect(result.errors.map((error) => error.errorCode)).toContain('INCONSISTENT_BRAND_NAME');
  });
});
