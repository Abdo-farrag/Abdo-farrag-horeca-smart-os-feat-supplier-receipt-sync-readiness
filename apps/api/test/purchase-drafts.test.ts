import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthDependencies, PurchaseDraftDependencies } from '../src/auth/types.js';

function makeAuth(): AuthDependencies {
  return {
    overviewPasswordHash: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
    sessionSecret: '0123456789abcdef0123456789abcdef',
    overviewAuthDisabled: true,
    verifyAccessToken: async () => null,
    findUserRole: async () => null,
  };
}

const draft = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'DRAFT' as const,
  companyId: 1 as const,
  companyName: 'MAS',
  supplierId: 99001,
  supplierName: 'RFQ Supplier A',
  supplierCode: 'RFQ-A',
  expectedReceiptDate: '2026-08-25',
  buyerNote: null,
  odooRfqId: null,
  odooRfqName: null,
  version: 1,
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
};

const line = {
  id: '22222222-2222-4222-8222-222222222222',
  draftId: draft.id,
  productCode: '101002',
  productName: 'Oil Pack',
  brandName: null,
  suggestedQty: 23,
  approvedQty: 24,
  purchaseUom: 'Pack',
  minimumOrderQty: 12,
  orderMultiple: 6,
  unitPrice: 95,
  priceSource: 'ODOO_VENDOR_PRICE' as const,
  currency: 'SAR',
  warnings: ['BRAND_UNDEFINED' as const],
  sourceRecommendationVersion: 0,
  version: 1,
  buyerNote: null,
};

function makeDependencies(
  overrides: Partial<PurchaseDraftDependencies> = {},
): PurchaseDraftDependencies {
  return {
    listSuppliers: async () => ({
      items: [{
        supplierId: 99001,
        supplierName: 'RFQ Supplier A',
        supplierCode: 'RFQ-A',
        supplierRank: 3,
        active: true,
        sourceUpdatedAt: null,
      }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    }),
    listBrands: async () => [{ brandId: null, brandName: null, productCount: 10 }],
    listDrafts: async () => [draft],
    getDraft: async () => ({ draft, lines: [line] }),
    createDraft: async () => ({ draft, lines: [line] }),
    updateLine: async () => line,
    changeSupplier: async () => draft,
    transition: async () => ({ ...draft, status: 'READY_FOR_EXPORT', version: 2 }),
    setRfqReference: async () => ({
      ...draft,
      status: 'EXPORTED',
      odooRfqId: 501,
      odooRfqName: 'P00051',
      version: 3,
    }),
    ...overrides,
  };
}

describe('purchase draft API', () => {
  it('requires overview access', async () => {
    const auth = makeAuth();
    auth.overviewAuthDisabled = false;
    const app = buildApp({ auth, purchaseDrafts: makeDependencies() });
    const response = await app.inject({ method: 'GET', url: '/api/procurement/suppliers' });
    expect(response.statusCode).toBe(401);
  });

  it('searches active suppliers by normalized name or code query', async () => {
    let captured: unknown;
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        listSuppliers: async (query) => {
          captured = query;
          return { items: [], pagination: { page: 2, pageSize: 10, total: 0, totalPages: 1 } };
        },
      }),
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/procurement/suppliers?search=RFQ-A&page=2&pageSize=10',
    });
    expect(response.statusCode).toBe(200);
    expect(captured).toEqual({ search: 'RFQ-A', page: 2, pageSize: 10 });
  });

  it('returns official and undefined brand options', async () => {
    const app = buildApp({ auth: makeAuth(), purchaseDrafts: makeDependencies() });
    const response = await app.inject({ method: 'GET', url: '/api/procurement/brands' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0]).toMatchObject({ brandName: null });
  });

  it('creates one-company one-supplier draft without trusting a client supplier name', async () => {
    let captured: Record<string, unknown> | undefined;
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        createDraft: async (input) => {
          captured = input as unknown as Record<string, unknown>;
          return { draft, lines: [line] };
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/procurement/purchase-drafts',
      payload: {
        companyId: 1,
        supplierId: 99001,
        supplierName: 'Spoofed Name',
        items: [{ productCode: '101002', expectedRecommendationVersion: 0 }],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(captured).not.toHaveProperty('supplierName');
    expect(captured).toMatchObject({ companyId: 1, supplierId: 99001 });
  });

  it('rejects invalid or duplicate draft selections', async () => {
    const app = buildApp({ auth: makeAuth(), purchaseDrafts: makeDependencies() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/procurement/purchase-drafts',
      payload: {
        companyId: 1,
        supplierId: 99001,
        items: [
          { productCode: '101002', expectedRecommendationVersion: 0 },
          { productCode: '101002', expectedRecommendationVersion: 0 },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('lists drafts and returns draft details', async () => {
    const app = buildApp({ auth: makeAuth(), purchaseDrafts: makeDependencies() });
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/procurement/purchase-drafts?status=DRAFT',
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/procurement/purchase-drafts/${draft.id}`,
    });
    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.json().data.lines).toHaveLength(1);
  });

  it('updates a line with optimistic version data', async () => {
    let captured: unknown;
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        updateLine: async (_draftId, _lineId, input) => {
          captured = input;
          return line;
        },
      }),
    });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/procurement/purchase-drafts/${draft.id}/lines/${line.id}`,
      payload: { approvedQty: 30, unitPrice: 88, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(captured).toMatchObject({ approvedQty: 30, expectedVersion: 1 });
  });

  it('changes supplier only inside the draft', async () => {
    let captured: unknown;
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        changeSupplier: async (_draftId, input) => {
          captured = input;
          return { ...draft, supplierId: 99002, supplierName: 'RFQ Supplier B' };
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/procurement/purchase-drafts/${draft.id}/change-supplier`,
      payload: { supplierId: 99002, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(captured).toEqual({ supplierId: 99002, expectedVersion: 1 });
  });

  it('validates status and manual RFQ reference operations', async () => {
    const app = buildApp({ auth: makeAuth(), purchaseDrafts: makeDependencies() });
    const statusResponse = await app.inject({
      method: 'POST',
      url: `/api/procurement/purchase-drafts/${draft.id}/status`,
      payload: { status: 'READY_FOR_EXPORT', expectedVersion: 1 },
    });
    const rfqResponse = await app.inject({
      method: 'POST',
      url: `/api/procurement/purchase-drafts/${draft.id}/rfq-reference`,
      payload: { odooRfqId: 501, odooRfqName: 'P00051', expectedVersion: 2 },
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(rfqResponse.statusCode).toBe(200);
  });

  it('downloads a valid RFQ workbook before marking a ready draft as exported', async () => {
    const readyDraft = { ...draft, status: 'READY_FOR_EXPORT' as const };
    const calls: string[] = [];
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        getDraft: async () => {
          calls.push('load');
          return { draft: readyDraft, lines: [line] };
        },
        transition: async (_draftId, input) => {
          calls.push(`transition:${input.status}`);
          return { ...readyDraft, status: 'EXPORTED', version: 2 };
        },
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/procurement/purchase-drafts/${draft.id}/export`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain('.xlsx');
    expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect(calls).toEqual(['load', 'transition:EXPORTED']);
  });

  it.each([
    ['VERSION_CONFLICT', 409],
    ['SUPPLIER_NOT_FOUND', 404],
    ['INVALID_STATUS_TRANSITION', 409],
    ['DRAFT_NOT_EDITABLE', 409],
  ])('maps %s to stable HTTP response', async (code, status) => {
    const app = buildApp({
      auth: makeAuth(),
      purchaseDrafts: makeDependencies({
        changeSupplier: async () => {
          throw new Error(code);
        },
      }),
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/procurement/purchase-drafts/${draft.id}/change-supplier`,
      payload: { supplierId: 99002, expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
  });
});
