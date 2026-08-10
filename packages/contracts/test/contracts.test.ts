import { describe, expect, it } from 'vitest';
import {
  AuditQuerySchema,
  CompanyIdSchema,
  CompanyPurchaseDecisionInputSchema,
  CompanyPurchaseExportQuerySchema,
  CompanyPurchaseRowSchema,
  OverviewQuerySchema,
  ProductRuleUpdateSchema,
  PurchaseDecisionStatusSchema,
  PurchaseExportScopeSchema,
  SupplierDecisionSchema,
  SupplierReadinessSchema,
  UserInviteSchema,
} from '../src/index.js';

describe('procurement contracts', () => {
  it('defaults overview coverage and pagination', () => {
    expect(OverviewQuerySchema.parse({})).toMatchObject({
      company: 'all',
      coverageDays: 14,
      page: 1,
      pageSize: 50,
    });
  });

  it('rejects unsupported bulk supplier decisions', () => {
    expect(() => SupplierDecisionSchema.parse({ action: 'bulk-reject' })).toThrow();
  });

  it('enforces product rule boundaries', () => {
    expect(
      ProductRuleUpdateSchema.parse({
        leadTimeDays: 90,
        safetyStockDays: 60,
        expectedVersion: 0,
      }),
    ).toMatchObject({ leadTimeDays: 90, safetyStockDays: 60, expectedVersion: 0 });

    expect(() =>
      ProductRuleUpdateSchema.parse({
        leadTimeDays: 91,
        safetyStockDays: 7,
        expectedVersion: 0,
      }),
    ).toThrow();
  });

  it('defaults audit pagination', () => {
    expect(AuditQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('validates employee invitations', () => {
    expect(
      UserInviteSchema.parse({
        email: 'reviewer@horecasmart.com',
        displayName: 'مراجع المشتريات',
        role: 'reviewer',
      }),
    ).toMatchObject({ role: 'reviewer' });

    expect(() =>
      UserInviteSchema.parse({ email: 'invalid', displayName: 'User', role: 'owner' }),
    ).toThrow();
  });
});

describe('company purchase review contracts', () => {
  it('companyId accepts only 1 or 2', () => {
    expect(CompanyIdSchema.parse(1)).toBe(1);
    expect(CompanyIdSchema.parse(2)).toBe(2);
    expect(() => CompanyIdSchema.parse(0)).toThrow();
    expect(() => CompanyIdSchema.parse(3)).toThrow();
    expect(() => CompanyIdSchema.parse('1')).toThrow();
  });

  it('APPROVED requires approvedQty > 0', () => {
    expect(
      CompanyPurchaseDecisionInputSchema.parse({
        companyId: 1,
        productCode: 'PROD-1',
        decisionStatus: 'APPROVED',
        approvedQty: 100,
        expectedVersion: 0,
      }),
    ).toMatchObject({ approvedQty: 100, decisionStatus: 'APPROVED' });

    expect(() =>
      CompanyPurchaseDecisionInputSchema.parse({
        companyId: 1,
        productCode: 'PROD-1',
        decisionStatus: 'APPROVED',
        approvedQty: 0,
        expectedVersion: 0,
      }),
    ).toThrow();

    expect(() =>
      CompanyPurchaseDecisionInputSchema.parse({
        companyId: 1,
        productCode: 'PROD-1',
        decisionStatus: 'APPROVED',
        approvedQty: null,
        expectedVersion: 0,
      }),
    ).toThrow();

    expect(() =>
      CompanyPurchaseDecisionInputSchema.parse({
        companyId: 1,
        productCode: 'PROD-1',
        decisionStatus: 'APPROVED',
        expectedVersion: 0,
      }),
    ).toThrow();
  });

  it('MAS and Horeca Smart are separate company identities', () => {
    const masRow = CompanyPurchaseRowSchema.parse({
      companyId: 1,
      companyName: 'MAS',
      productCode: 'P-101',
      productName: 'Product A',
      priority: 'CRITICAL',
      freeQty: 10,
      effectiveDailyDemand: 2.5,
      coverageDays: 4,
      targetCoverageDays: 14,
      suggestedQty: 25,
      approvedQty: 25,
      supplierId: 101,
      supplierName: 'Supplier A',
      supplierReadiness: 'VERIFIED_RECEIPT',
      latestReceiptAt: '2026-08-01T00:00:00.000Z',
      latestUnitCost: 150,
      estimatedValue: 3750,
      decisionStatus: 'APPROVED',
      buyerNote: 'Approved for MAS',
      version: 1,
      sourceUpdatedAt: '2026-08-01T00:00:00.000Z',
      readyForPo: true,
    });

    const horecaRow = CompanyPurchaseRowSchema.parse({
      companyId: 2,
      companyName: 'Horeca Smart',
      productCode: 'P-101',
      productName: 'Product A',
      priority: 'CRITICAL',
      freeQty: 5,
      effectiveDailyDemand: 1.0,
      coverageDays: 5,
      targetCoverageDays: 14,
      suggestedQty: 9,
      approvedQty: null,
      supplierId: null,
      supplierName: null,
      supplierReadiness: 'NEEDS_SUPPLIER',
      latestReceiptAt: null,
      latestUnitCost: null,
      estimatedValue: null,
      decisionStatus: 'NEW',
      buyerNote: null,
      version: 0,
      sourceUpdatedAt: null,
      readyForPo: false,
    });

    expect(masRow.companyId).toBe(1);
    expect(masRow.companyName).toBe('MAS');
    expect(horecaRow.companyId).toBe(2);
    expect(horecaRow.companyName).toBe('Horeca Smart');
    expect(masRow.companyId).not.toBe(horecaRow.companyId);
  });

  it('supplier readiness values are exactly VERIFIED_RECEIPT, FALLBACK_NEEDS_REVIEW, NEEDS_SUPPLIER', () => {
    expect(SupplierReadinessSchema.parse('VERIFIED_RECEIPT')).toBe('VERIFIED_RECEIPT');
    expect(SupplierReadinessSchema.parse('FALLBACK_NEEDS_REVIEW')).toBe('FALLBACK_NEEDS_REVIEW');
    expect(SupplierReadinessSchema.parse('NEEDS_SUPPLIER')).toBe('NEEDS_SUPPLIER');
    expect(() => SupplierReadinessSchema.parse('PENDING_REVIEW')).toThrow();
    expect(() => SupplierReadinessSchema.parse('UNKNOWN')).toThrow();
  });

  it('export scope accepts only draft and approved', () => {
    expect(PurchaseExportScopeSchema.parse('draft')).toBe('draft');
    expect(PurchaseExportScopeSchema.parse('approved')).toBe('approved');
    expect(() => PurchaseExportScopeSchema.parse('all')).toThrow();
    expect(() => PurchaseExportScopeSchema.parse('rejected')).toThrow();

    expect(CompanyPurchaseExportQuerySchema.parse({})).toMatchObject({
      scope: 'approved',
    });
  });
});
