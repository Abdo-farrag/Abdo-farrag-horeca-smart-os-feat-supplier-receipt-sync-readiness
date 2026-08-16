import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildPurchaseDraftRfqWorkbook } from '../src/purchase-draft-export.js';
import type { PurchaseDraft, PurchaseDraftLine } from '@horeca/contracts';

const draft: PurchaseDraft = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'READY_FOR_EXPORT',
  companyId: 1,
  companyName: 'MAS',
  supplierId: 99001,
  supplierName: 'RFQ Supplier A',
  supplierCode: 'RFQ-A',
  expectedReceiptDate: '2026-08-25',
  buyerNote: 'Manual Odoo entry',
  odooRfqId: null,
  odooRfqName: null,
  version: 2,
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T11:00:00.000Z',
};

const lines: PurchaseDraftLine[] = [{
  id: '22222222-2222-4222-8222-222222222222',
  draftId: draft.id,
  productCode: '00101002',
  productName: 'Oil Pack',
  brandName: null,
  suggestedQty: 23,
  approvedQty: 24,
  purchaseUom: 'Pack',
  minimumOrderQty: 12,
  orderMultiple: 6,
  unitPrice: 95,
  priceSource: 'ODOO_VENDOR_PRICE',
  currency: 'SAR',
  warnings: ['BRAND_UNDEFINED'],
  sourceRecommendationVersion: 0,
  version: 1,
  buyerNote: null,
}];

describe('manual Odoo RFQ workbook', () => {
  it('creates RFQ and Warnings sheets for one company and one supplier', async () => {
    const buffer = await buildPurchaseDraftRfqWorkbook(
      draft,
      lines,
      '2026-08-16T12:00:00.000Z',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['RFQ', 'Warnings']);
    const rfq = workbook.getWorksheet('RFQ');
    expect(rfq?.getCell('B2').value).toBe('MAS');
    expect(rfq?.getCell('B3').value).toBe('RFQ Supplier A');
    expect(rfq?.getCell('B4').value).toBe('RFQ-A');
  });

  it('preserves product code as text and approved purchasing values', async () => {
    const buffer = await buildPurchaseDraftRfqWorkbook(
      draft,
      lines,
      '2026-08-16T12:00:00.000Z',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const rfq = workbook.getWorksheet('RFQ');

    expect(rfq?.getCell('A9').value).toBe('00101002');
    expect(rfq?.getCell('A9').numFmt).toBe('@');
    expect(rfq?.getCell('D9').value).toBe(24);
    expect(rfq?.getCell('F9').value).toBe(95);
    expect(rfq?.getCell('H9').value).toMatchObject({ formula: 'D9*F9' });
  });

  it('makes warnings and price provenance auditable', async () => {
    const buffer = await buildPurchaseDraftRfqWorkbook(
      draft,
      lines,
      '2026-08-16T12:00:00.000Z',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const warnings = workbook.getWorksheet('Warnings');

    expect(warnings?.getCell('A2').value).toBe('00101002');
    expect(warnings?.getCell('B2').value).toBe('BRAND_UNDEFINED');
    expect(warnings?.getCell('D2').value).toBe('ODOO_VENDOR_PRICE');
  });

  it('rejects non-exportable states, empty drafts, and mixed line ownership', async () => {
    await expect(buildPurchaseDraftRfqWorkbook(
      { ...draft, status: 'DRAFT' },
      lines,
      '2026-08-16T12:00:00.000Z',
    )).rejects.toThrow('DRAFT_NOT_READY_FOR_EXPORT');
    await expect(buildPurchaseDraftRfqWorkbook(
      draft,
      [],
      '2026-08-16T12:00:00.000Z',
    )).rejects.toThrow('EMPTY_PURCHASE_DRAFT');
    await expect(buildPurchaseDraftRfqWorkbook(
      draft,
      [{ ...lines[0]!, draftId: '33333333-3333-4333-8333-333333333333' }],
      '2026-08-16T12:00:00.000Z',
    )).rejects.toThrow('MIXED_PURCHASE_DRAFT_LINES');
  });
});
