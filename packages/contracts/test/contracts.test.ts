import { describe, expect, it } from 'vitest';
import {
  AuditQuerySchema,
  OverviewQuerySchema,
  ProductRuleUpdateSchema,
  SupplierDecisionSchema,
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
