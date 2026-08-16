import { describe, expect, it } from 'vitest';
import {
  PurchaseDraftCreateInputSchema,
  PurchaseDraftLineInputSchema,
  PurchaseDraftRfqReferenceInputSchema,
  PurchaseDraftStatusInputSchema,
  SupplierDirectoryQuerySchema,
  canTransitionPurchaseDraft,
  roundPurchaseQuantity,
} from '../src/index.js';

describe('purchase draft contracts', () => {
  it('normalizes supplier search pagination', () => {
    expect(SupplierDirectoryQuerySchema.parse({ search: '  ARMA  ' })).toEqual({
      search: 'ARMA',
      page: 1,
      pageSize: 20,
    });

    expect(() => SupplierDirectoryQuerySchema.parse({ pageSize: 51 })).toThrow();
  });

  it('requires one company, one supplier and unique selected products', () => {
    const valid = PurchaseDraftCreateInputSchema.parse({
      companyId: 1,
      supplierId: 32546,
      supplierName: 'Untrusted client label',
      expectedReceiptDate: '2026-08-25',
      buyerNote: 'Manual Odoo RFQ',
      items: [
        { productCode: '101002', expectedRecommendationVersion: 0 },
        { productCode: '101030', expectedRecommendationVersion: 2 },
      ],
    });

    expect(valid.companyId).toBe(1);
    expect(valid.supplierId).toBe(32546);
    expect(valid).not.toHaveProperty('supplierName');
    expect(valid.items).toHaveLength(2);

    expect(() =>
      PurchaseDraftCreateInputSchema.parse({
        companyId: 3,
        supplierId: 32546,
        items: [{ productCode: '101002', expectedRecommendationVersion: 0 }],
      }),
    ).toThrow();

    expect(() =>
      PurchaseDraftCreateInputSchema.parse({
        companyId: 1,
        supplierId: 32546,
        items: [
          { productCode: '101002', expectedRecommendationVersion: 0 },
          { productCode: '101002', expectedRecommendationVersion: 0 },
        ],
      }),
    ).toThrow('Duplicate productCode');
  });

  it('requires positive approved quantity and optimistic version for line edits', () => {
    expect(
      PurchaseDraftLineInputSchema.parse({
        approvedQty: 24,
        unitPrice: 125.5,
        buyerNote: null,
        expectedVersion: 1,
      }),
    ).toMatchObject({ approvedQty: 24, unitPrice: 125.5, expectedVersion: 1 });

    expect(() =>
      PurchaseDraftLineInputSchema.parse({ approvedQty: 0, expectedVersion: 1 }),
    ).toThrow();
    expect(() =>
      PurchaseDraftLineInputSchema.parse({ approvedQty: 1, unitPrice: -1, expectedVersion: 1 }),
    ).toThrow();
  });

  it('allows only the approved purchase draft status transitions', () => {
    expect(canTransitionPurchaseDraft('DRAFT', 'READY_FOR_EXPORT')).toBe(true);
    expect(canTransitionPurchaseDraft('READY_FOR_EXPORT', 'EXPORTED')).toBe(true);
    expect(canTransitionPurchaseDraft('EXPORTED', 'CLOSED')).toBe(true);
    expect(canTransitionPurchaseDraft('DRAFT', 'CANCELLED')).toBe(true);
    expect(canTransitionPurchaseDraft('READY_FOR_EXPORT', 'CANCELLED')).toBe(true);

    expect(canTransitionPurchaseDraft('DRAFT', 'EXPORTED')).toBe(false);
    expect(canTransitionPurchaseDraft('EXPORTED', 'DRAFT')).toBe(false);
    expect(canTransitionPurchaseDraft('CLOSED', 'CANCELLED')).toBe(false);

    expect(
      PurchaseDraftStatusInputSchema.parse({
        status: 'READY_FOR_EXPORT',
        expectedVersion: 3,
      }),
    ).toMatchObject({ status: 'READY_FOR_EXPORT', expectedVersion: 3 });
  });

  it('copies suggested quantity and flags missing packaging metadata', () => {
    expect(roundPurchaseQuantity(23, null, null)).toEqual({
      quantity: 23,
      warnings: ['PACKAGING_REVIEW_REQUIRED'],
    });
  });

  it('rounds upward using trusted MOQ and order multiple', () => {
    expect(roundPurchaseQuantity(23, 12, 6)).toEqual({ quantity: 24, warnings: [] });
    expect(roundPurchaseQuantity(5, 12, 6)).toEqual({ quantity: 12, warnings: [] });
    expect(roundPurchaseQuantity(25, null, 12)).toEqual({ quantity: 36, warnings: [] });
  });

  it('validates the manual Odoo RFQ reference without creating it', () => {
    expect(
      PurchaseDraftRfqReferenceInputSchema.parse({
        odooRfqId: 8123,
        odooRfqName: 'P00042',
        expectedVersion: 4,
      }),
    ).toMatchObject({ odooRfqId: 8123, odooRfqName: 'P00042', expectedVersion: 4 });

    expect(() =>
      PurchaseDraftRfqReferenceInputSchema.parse({
        odooRfqId: -1,
        odooRfqName: '',
        expectedVersion: 4,
      }),
    ).toThrow();
  });
});
