import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createOverviewSessionCookie } from '../src/auth/service.js';
import type { AuthDependencies, CompanyPurchaseDependencies } from '../src/auth/types.js';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

function makeAuth(overrides?: Partial<AuthDependencies>): AuthDependencies {
  return {
    overviewPasswordHash: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
    sessionSecret: SESSION_SECRET,
    overviewAuthDisabled: false,
    verifyAccessToken: async () => null,
    findUserRole: async () => null,
    ...overrides,
  };
}

function validSessionCookie(): string {
  const header = createOverviewSessionCookie(SESSION_SECRET);
  const match = /hs_overview=([^\s;]+)/.exec(header);
  return `hs_overview=${match?.[1] ?? ''}`;
}

function makeCompanyPurchaseDependencies(
  overrides?: Partial<CompanyPurchaseDependencies>,
): CompanyPurchaseDependencies {
  return {
    list: async (params) => ({
      data: {
        items: [
          {
            companyId: 1,
            companyName: 'MAS',
            productCode: '101002',
            productName: 'Sample Tea 1',
            priority: 'CRITICAL',
            freeQty: 10,
            effectiveDailyDemand: 5,
            coverageDays: 2,
            targetCoverageDays: 14,
            suggestedQty: 60,
            approvedQty: 60,
            supplierId: 32546,
            supplierName: 'Arma Supplier',
            supplierReadiness: 'VERIFIED_RECEIPT',
            latestReceiptAt: '2026-08-01T10:00:00Z',
            latestUnitCost: 10,
            estimatedValue: 600,
            decisionStatus: 'APPROVED',
            buyerNote: 'Note MAS',
            version: 1,
            sourceUpdatedAt: '2026-08-01T10:00:00Z',
            readyForPo: true,
          },
          {
            companyId: 2,
            companyName: 'Horeca Smart',
            productCode: '101002',
            productName: 'Sample Tea 1',
            priority: 'HIGH',
            freeQty: 5,
            effectiveDailyDemand: 2,
            coverageDays: 2.5,
            targetCoverageDays: 14,
            suggestedQty: 23,
            approvedQty: 25,
            supplierId: 28795,
            supplierName: 'BODUO Supplier',
            supplierReadiness: 'VERIFIED_RECEIPT',
            latestReceiptAt: '2026-08-02T10:00:00Z',
            latestUnitCost: 12,
            estimatedValue: 300,
            decisionStatus: 'APPROVED',
            buyerNote: 'Note Horeca',
            version: 1,
            sourceUpdatedAt: '2026-08-02T10:00:00Z',
            readyForPo: true,
          },
        ],
        pagination: { page: params.page, pageSize: params.pageSize, total: 2, totalPages: 1 },
      },
      error: null,
    }),
    saveDecision: async (input) => {
      if (input.expectedVersion === 99) {
        throw new Error('VERSION_CONFLICT');
      }
      return {
        companyId: input.companyId,
        productCode: input.productCode,
        approvedQty: input.approvedQty ?? null,
        approvedSupplierId: input.approvedSupplierId ?? null,
        approvedSupplierName: input.approvedSupplierName ?? null,
        decisionStatus: input.decisionStatus,
        buyerNote: input.buyerNote ?? null,
        version: input.expectedVersion + 1,
        updatedAt: '2026-08-08T12:00:00Z',
      };
    },
    bulkSave: async (input) => {
      if (input.items.some((i) => i.expectedVersion === 99)) {
        throw new Error('VERSION_CONFLICT');
      }
      return {
        batchId: 'batch-test-123',
        items: input.items.map((item) => ({
          companyId: item.companyId,
          productCode: item.productCode,
          approvedQty: item.approvedQty ?? null,
          approvedSupplierId: item.approvedSupplierId ?? null,
          approvedSupplierName: item.approvedSupplierName ?? null,
          decisionStatus: input.decisionStatus,
          buyerNote: input.buyerNote ?? null,
          version: item.expectedVersion + 1,
          updatedAt: '2026-08-08T12:00:00Z',
        })),
      };
    },
    ...overrides,
  };
}

describe('Company Purchase Review API', () => {
  describe('GET /api/procurement/company-review', () => {
    it('requires overview access when overviewAuthDisabled=false', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: false }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });
      const res = await app.inject({ method: 'GET', url: '/api/procurement/company-review' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error?.code).toBe('UNAUTHORIZED');
    });

    it('works without cookie when overviewAuthDisabled=true', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });
      const res = await app.inject({ method: 'GET', url: '/api/procurement/company-review' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.error).toBeNull();
      expect(body.data.items).toHaveLength(2);
    });

    it('passes company filter independently: all, 1 or 2', async () => {
      let capturedCompany: string | undefined;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          list: async (params) => {
            capturedCompany = params.company;
            return {
              data: {
                items: [],
                pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
              },
              error: null,
            };
          },
        }),
      });

      await app.inject({ method: 'GET', url: '/api/procurement/company-review?company=1' });
      expect(capturedCompany).toBe('1');

      await app.inject({ method: 'GET', url: '/api/procurement/company-review?company=2' });
      expect(capturedCompany).toBe('2');

      await app.inject({ method: 'GET', url: '/api/procurement/company-review?company=all' });
      expect(capturedCompany).toBe('all');
    });

    it('supports search, priority, decisionStatus, noSupplier, page and pageSize', async () => {
      let capturedParams: any;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          list: async (params) => {
            capturedParams = params;
            return {
              data: {
                items: [],
                pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
              },
              error: null,
            };
          },
        }),
      });

      await app.inject({
        method: 'GET',
        url: '/api/procurement/company-review?search=tea&priority=HIGH&decisionStatus=APPROVED&noSupplier=true&page=2&pageSize=20',
      });

      expect(capturedParams).toMatchObject({
        search: 'tea',
        priority: 'HIGH',
        decisionStatus: 'APPROVED',
        noSupplier: true,
        page: 2,
        pageSize: 20,
      });
    });

    it('returns the existing { data, error } envelope and keeps productCode separate for companyId 1 and 2', async () => {
      const app = buildApp({
        auth: makeAuth(),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/procurement/company-review',
        headers: { cookie: validSessionCookie() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('error', null);
      expect(body.data.items[0].companyId).toBe(1);
      expect(body.data.items[0].productCode).toBe('101002');
      expect(body.data.items[1].companyId).toBe(2);
      expect(body.data.items[1].productCode).toBe('101002');
    });
  });

  describe('POST /api/procurement/company-review/decision', () => {
    it('passes companyId to the dependency and succeeds for APPROVED with approvedQty > 0', async () => {
      let capturedInput: any;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          saveDecision: async (input) => {
            capturedInput = input;
            return {
              companyId: input.companyId,
              productCode: input.productCode,
              approvedQty: input.approvedQty ?? null,
              approvedSupplierId: input.approvedSupplierId ?? null,
              approvedSupplierName: input.approvedSupplierName ?? null,
              decisionStatus: input.decisionStatus,
              buyerNote: input.buyerNote ?? null,
              version: input.expectedVersion + 1,
              updatedAt: '2026-08-08T12:00:00Z',
            };
          },
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 1,
          productCode: '101002',
          decisionStatus: 'APPROVED',
          approvedQty: 100,
          approvedSupplierId: 32546,
          approvedSupplierName: 'Arma Supplier',
          buyerNote: 'Approved MAS purchase',
          expectedVersion: 0,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(capturedInput.companyId).toBe(1);
      expect(res.json().data.version).toBe(1);
      expect(res.json().error).toBeNull();
    });

    it('APPROVED with approvedQty 0 or null returns HTTP 400', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const resZero = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 1,
          productCode: '101002',
          decisionStatus: 'APPROVED',
          approvedQty: 0,
          expectedVersion: 0,
        },
      });
      expect(resZero.statusCode).toBe(400);
      expect(resZero.json().error.code).toBe('VALIDATION_ERROR');

      const resNull = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 1,
          productCode: '101002',
          decisionStatus: 'APPROVED',
          approvedQty: null,
          expectedVersion: 0,
        },
      });
      expect(resNull.statusCode).toBe(400);
      expect(resNull.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('invalid companyId returns HTTP 400', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 3,
          productCode: '101002',
          decisionStatus: 'APPROVED',
          approvedQty: 50,
          expectedVersion: 0,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('empty productCode returns HTTP 400', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 1,
          productCode: '   ',
          decisionStatus: 'APPROVED',
          approvedQty: 50,
          expectedVersion: 0,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('stale expectedVersion / VERSION_CONFLICT returns HTTP 409 and does not auto-retry', async () => {
      let saveCount = 0;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          saveDecision: async () => {
            saveCount++;
            throw new Error('VERSION_CONFLICT');
          },
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: {
          companyId: 1,
          productCode: '101002',
          decisionStatus: 'APPROVED',
          approvedQty: 50,
          expectedVersion: 99,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
      expect(saveCount).toBe(1);
    });
  });

  describe('POST /api/procurement/company-review/bulk', () => {
    it('preserves companyId for every item and allows the same productCode for MAS and Horeca Smart', async () => {
      let capturedInput: any;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          bulkSave: async (input) => {
            capturedInput = input;
            return {
              batchId: 'batch-test-bulk',
              items: input.items.map((item) => ({
                companyId: item.companyId,
                productCode: item.productCode,
                approvedQty: item.approvedQty ?? null,
                approvedSupplierId: item.approvedSupplierId ?? null,
                approvedSupplierName: item.approvedSupplierName ?? null,
                decisionStatus: input.decisionStatus,
                buyerNote: input.buyerNote ?? null,
                version: item.expectedVersion + 1,
                updatedAt: '2026-08-08T12:00:00Z',
              })),
            };
          },
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: {
          items: [
            { companyId: 1, productCode: '101002', approvedQty: 100, expectedVersion: 0 },
            { companyId: 2, productCode: '101002', approvedQty: 50, expectedVersion: 0 },
          ],
          decisionStatus: 'APPROVED',
          buyerNote: 'Bulk approval',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(capturedInput.items[0].companyId).toBe(1);
      expect(capturedInput.items[1].companyId).toBe(2);
      expect(res.json().data.batchId).toBe('batch-test-bulk');
    });

    it('rejects an empty items array', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: {
          items: [],
          decisionStatus: 'APPROVED',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid approval quantities', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: {
          items: [
            { companyId: 1, productCode: '101002', approvedQty: 0, expectedVersion: 0 },
          ],
          decisionStatus: 'APPROVED',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('VERSION_CONFLICT returns HTTP 409 and does not partially retry', async () => {
      let bulkSaveCount = 0;
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies({
          bulkSave: async () => {
            bulkSaveCount++;
            throw new Error('VERSION_CONFLICT');
          },
        }),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: {
          items: [
            { companyId: 1, productCode: '101002', approvedQty: 100, expectedVersion: 99 },
          ],
          decisionStatus: 'APPROVED',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('VERSION_CONFLICT');
      expect(bulkSaveCount).toBe(1);
    });
  });

  describe('Authentication coverage for all three routes', () => {
    it('returns 401 when overviewAuthDisabled=false and no session cookie is provided', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: false }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const getRes = await app.inject({ method: 'GET', url: '/api/procurement/company-review' });
      expect(getRes.statusCode).toBe(401);

      const decisionRes = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: { companyId: 1, productCode: '101002', decisionStatus: 'APPROVED', approvedQty: 10, expectedVersion: 0 },
      });
      expect(decisionRes.statusCode).toBe(401);

      const bulkRes = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: { items: [{ companyId: 1, productCode: '101002', approvedQty: 10, expectedVersion: 0 }], decisionStatus: 'APPROVED' },
      });
      expect(bulkRes.statusCode).toBe(401);
    });

    it('is accessible when overviewAuthDisabled=true for AI Studio preview', async () => {
      const app = buildApp({
        auth: makeAuth({ overviewAuthDisabled: true }),
        companyPurchase: makeCompanyPurchaseDependencies(),
      });

      const getRes = await app.inject({ method: 'GET', url: '/api/procurement/company-review' });
      expect(getRes.statusCode).toBe(200);

      const decisionRes = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/decision',
        payload: { companyId: 1, productCode: '101002', decisionStatus: 'APPROVED', approvedQty: 10, expectedVersion: 0 },
      });
      expect(decisionRes.statusCode).toBe(200);

      const bulkRes = await app.inject({
        method: 'POST',
        url: '/api/procurement/company-review/bulk',
        payload: { items: [{ companyId: 1, productCode: '101002', approvedQty: 10, expectedVersion: 0 }], decisionStatus: 'APPROVED' },
      });
      expect(bulkRes.statusCode).toBe(200);
    });
  });
});
