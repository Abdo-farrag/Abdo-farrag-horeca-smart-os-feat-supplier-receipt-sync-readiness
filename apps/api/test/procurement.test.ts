import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createOverviewSessionCookie } from '../src/auth/service.js';
import type { AuthDependencies, ProcurementDependencies, ProcurementOverviewParams, ReviewDependencies } from '../src/auth/types.js';

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

const EMPTY_RESULT = {
  data: {
    rows: [],
    summary: { needsPurchase: 0, critical: 0, totalSuggestedQty: 0, noSupplier: 0, insufficientData: 0 },
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  },
};

function makeProcurement(
  overrideGetOverview?: (params: ProcurementOverviewParams) => Promise<unknown>,
): ProcurementDependencies {
  return {
    getOverview: overrideGetOverview ?? (async () => EMPTY_RESULT),
    getSyncStatus: async () => null,
  };
}

function makeReview(): ReviewDependencies {
  return {
    getReviewProducts: async () => ({
      data: {
        items: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      },
      error: null,
    }),
    approveRecommendation: async (productCode, decisionStatus, approvedQty, approvedSupplierId, approvedSupplierName, buyerNote, expectedVersion) => ({
      productCode,
      approvedQty,
      approvedSupplierId,
      approvedSupplierName,
      decisionStatus,
      buyerNote,
      version: expectedVersion + 1,
      updatedAt: '2026-08-04T00:00:00Z',
    }),
    bulkUpdateRecommendations: async (items, decisionStatus, buyerNote) => ({
      batchId: 'batch-1',
      items: items.map((item) => ({
        productCode: item.productCode,
        approvedQty: item.approvedQty ?? null,
        approvedSupplierId: item.approvedSupplierId ?? null,
        approvedSupplierName: item.approvedSupplierName ?? null,
        decisionStatus,
        buyerNote,
        version: item.expectedVersion + 1,
        updatedAt: '2026-08-04T00:00:00Z',
      })),
    }),
  };
}

function validSessionCookie(): string {
  const header = createOverviewSessionCookie(SESSION_SECRET);
  const match = /hs_overview=([^\s;]+)/.exec(header);
  return `hs_overview=${match?.[1] ?? ''}`;
}

describe('GET /api/overview-access/session', () => {
  it('returns 401 without a session cookie', async () => {
    const app = buildApp({ auth: makeAuth() });
    const res = await app.inject({ method: 'GET', url: '/api/overview-access/session' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with a valid session cookie', async () => {
    const app = buildApp({ auth: makeAuth() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview-access/session',
      headers: { cookie: validSessionCookie() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.authenticated).toBe(true);
  });

  it('returns 401 for a tampered cookie', async () => {
    const app = buildApp({ auth: makeAuth() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview-access/session',
      headers: { cookie: 'hs_overview=tampered.invalidsig' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/procurement/overview', () => {
  it('returns 401 without a session cookie', async () => {
    const app = buildApp({ auth: makeAuth(), procurement: makeProcurement() });
    const res = await app.inject({ method: 'GET', url: '/api/procurement/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with rows, summary, and pagination for an authenticated session', async () => {
    const app = buildApp({ auth: makeAuth(), procurement: makeProcurement() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/overview',
      headers: { cookie: validSessionCookie() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data.rows)).toBe(true);
    expect(body.data.summary).toBeDefined();
    expect(body.data.pagination).toBeDefined();
    expect(body.error).toBeNull();
  });

  it('passes company and coverageDays from query params to the dependency', async () => {
    let captured: ProcurementOverviewParams | undefined;
    const app = buildApp({
      auth: makeAuth(),
      procurement: makeProcurement(async (params) => {
        captured = params;
        return EMPTY_RESULT;
      }),
    });

    await app.inject({
      method: 'GET',
      url: '/api/procurement/overview?company=1&coverageDays=7',
      headers: { cookie: validSessionCookie() },
    });

    expect(captured?.companyId).toBe(1);
    expect(captured?.coverageDays).toBe(7);
  });

  it('uses company=null for company=all', async () => {
    let captured: ProcurementOverviewParams | undefined;
    const app = buildApp({
      auth: makeAuth(),
      procurement: makeProcurement(async (params) => { captured = params; return EMPTY_RESULT; }),
    });

    await app.inject({
      method: 'GET',
      url: '/api/procurement/overview?company=all',
      headers: { cookie: validSessionCookie() },
    });

    expect(captured?.companyId).toBeNull();
  });

  it('returns 503 when the procurement dependency throws', async () => {
    const app = buildApp({
      auth: makeAuth(),
      procurement: makeProcurement(async () => { throw new Error('PROCUREMENT_UNAVAILABLE'); }),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/overview',
      headers: { cookie: validSessionCookie() },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('PROCUREMENT_UNAVAILABLE');
  });
});

describe('OVERVIEW_AUTH_DISABLED bypass behavior', () => {
  it('allows access to session, overview, review, approve, and bulk endpoints when overviewAuthDisabled is true without a session cookie', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: true }),
      procurement: makeProcurement(),
      review: makeReview(),
    });

    const sessionRes = await app.inject({ method: 'GET', url: '/api/overview-access/session' });
    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.json().data.authenticated).toBe(true);

    const overviewRes = await app.inject({ method: 'GET', url: '/api/procurement/overview' });
    expect(overviewRes.statusCode).toBe(200);

    const reviewRes = await app.inject({ method: 'GET', url: '/api/procurement/review' });
    expect(reviewRes.statusCode).toBe(200);

    const approveRes = await app.inject({
      method: 'POST',
      url: '/api/procurement/review/approve',
      payload: {
        productCode: 'PROD-1',
        decisionStatus: 'APPROVED',
        expectedVersion: 1,
      },
    });
    expect(approveRes.statusCode).toBe(200);

    const bulkRes = await app.inject({
      method: 'POST',
      url: '/api/procurement/review/bulk',
      payload: {
        items: [{ productCode: 'PROD-1', expectedVersion: 1 }],
        decisionStatus: 'APPROVED',
      },
    });
    expect(bulkRes.statusCode).toBe(200);
  });

  it('rejects unauthenticated requests to all protected routes when overviewAuthDisabled is false', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: false }),
      procurement: makeProcurement(),
      review: makeReview(),
    });

    const routes = [
      { method: 'GET' as const, url: '/api/overview-access/session' },
      { method: 'GET' as const, url: '/api/procurement/overview' },
      { method: 'GET' as const, url: '/api/procurement/review' },
      {
        method: 'POST' as const,
        url: '/api/procurement/review/approve',
        payload: { productCode: 'PROD-1', decisionStatus: 'APPROVED', expectedVersion: 1 },
      },
      {
        method: 'POST' as const,
        url: '/api/procurement/review/bulk',
        payload: { items: [{ productCode: 'PROD-1', expectedVersion: 1 }], decisionStatus: 'APPROVED' },
      },
    ];

    for (const route of routes) {
      const res = await app.inject(route);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }
  });
});

