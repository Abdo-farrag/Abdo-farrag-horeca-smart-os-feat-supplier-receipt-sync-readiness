/**
 * Regression tests for negative coverageDays in CompanyPurchaseRowSchema.
 *
 * Root cause: the Supabase view computes coverageDays as free_qty / effective_daily_demand.
 * When inventory is over-committed (free_qty < 0) the result is negative, which is a
 * valid business state meaning the product is already short. The original schema used
 * .nonnegative() on coverageDays, which caused CompanyPurchaseRowSchema.parse() to throw
 * for any such product, making the draft export fail with EXPORT_GENERATION_FAILED (500).
 *
 * Fix: remove .nonnegative() from coverageDays only. All other nonneg constraints are
 * legitimate and remain unchanged.
 *
 * Exact failing rows found by scanning 1,482 live rows (all in companyId=2):
 *   productCode=108224  coverageDays=-5.294117647058823
 *   productCode=108257  coverageDays=-1.791044776119403
 *   productCode=202030  coverageDays=-0.06564551422319474
 *   productCode=202069  coverageDays=-0.5552010210593491
 *   productCode=302004  coverageDays=-0.32727272727272727
 */

import { describe, expect, it } from 'vitest';
import { CompanyPurchaseRowSchema } from '@horeca/contracts';

// ── base valid row ────────────────────────────────────────────────────────────
const BASE_ROW = {
  companyId: 2 as const,
  companyName: 'Horeca Smart',
  productCode: '108224',
  productName: 'Over-committed Product',
  priority: 'HIGH' as const,
  freeQty: -90,                         // negative free stock
  effectiveDailyDemand: 17,
  coverageDays: -5.294117647058823,     // exact value from live row 108224
  targetCoverageDays: 14,
  suggestedQty: 329,
  approvedQty: null,
  supplierId: null,
  supplierName: null,
  supplierReadiness: 'NEEDS_SUPPLIER' as const,
  latestReceiptAt: null,
  latestUnitCost: null,
  estimatedValue: null,
  decisionStatus: 'NEW' as const,
  buyerNote: null,
  version: 0,
  sourceUpdatedAt: null,
  readyForPo: false,
};

describe('CompanyPurchaseRowSchema — coverageDays', () => {
  it('accepts zero coverageDays (no stock, no demand)', () => {
    const result = CompanyPurchaseRowSchema.safeParse({ ...BASE_ROW, coverageDays: 0 });
    expect(result.success).toBe(true);
  });

  it('accepts positive coverageDays (normal case)', () => {
    const result = CompanyPurchaseRowSchema.safeParse({ ...BASE_ROW, coverageDays: 7.5 });
    expect(result.success).toBe(true);
  });

  it('accepts null coverageDays (zero demand — division not possible)', () => {
    const result = CompanyPurchaseRowSchema.safeParse({ ...BASE_ROW, coverageDays: null });
    expect(result.success).toBe(true);
  });

  // ── exact live-data regression cases ────────────────────────────────────────
  it('accepts negative coverageDays for productCode=108224 (over-committed inventory)', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      productCode: '108224',
      coverageDays: -5.294117647058823,
    });
    expect(result.success).toBe(true);
  });

  it('accepts negative coverageDays for productCode=108257', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      productCode: '108257',
      coverageDays: -1.791044776119403,
    });
    expect(result.success).toBe(true);
  });

  it('accepts negative coverageDays for productCode=202030', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      productCode: '202030',
      coverageDays: -0.06564551422319474,
    });
    expect(result.success).toBe(true);
  });

  it('accepts negative coverageDays for productCode=202069', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      productCode: '202069',
      coverageDays: -0.5552010210593491,
    });
    expect(result.success).toBe(true);
  });

  it('accepts negative coverageDays for productCode=302004', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      productCode: '302004',
      coverageDays: -0.32727272727272727,
    });
    expect(result.success).toBe(true);
  });

  // ── guard: other nonneg fields are still enforced ────────────────────────────
  it('still rejects negative effectiveDailyDemand', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      effectiveDailyDemand: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['effectiveDailyDemand']);
      expect(result.error.issues[0]?.code).toBe('too_small');
    }
  });

  it('still rejects negative targetCoverageDays', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      targetCoverageDays: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['targetCoverageDays']);
    }
  });

  it('still rejects negative suggestedQty', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      suggestedQty: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['suggestedQty']);
    }
  });

  it('still rejects negative approvedQty', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      approvedQty: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['approvedQty']);
    }
  });

  it('still rejects negative latestUnitCost', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      latestUnitCost: -0.01,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['latestUnitCost']);
    }
  });

  it('still rejects negative estimatedValue', () => {
    const result = CompanyPurchaseRowSchema.safeParse({
      ...BASE_ROW,
      coverageDays: 5,
      estimatedValue: -100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['estimatedValue']);
    }
  });
});
