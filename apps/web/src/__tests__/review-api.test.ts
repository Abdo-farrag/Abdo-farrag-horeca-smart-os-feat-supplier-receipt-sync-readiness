import { describe, expect, it, vi } from 'vitest';
import {
  fetchCompanyPurchaseReview,
  saveCompanyPurchaseDecision,
  bulkSaveCompanyPurchaseDecisions,
} from '../api/review.js';

describe('Review API URL prefixes', () => {
  it('fetchCompanyPurchaseReview uses absolute URL starting with /api/procurement/company-review', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            items: [],
            pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await fetchCompanyPurchaseReview({
      company: 'all',
      search: '',
      priority: 'all',
      decisionStatus: 'all',
      noSupplier: false,
      supplierId: 99001,
      brandId: 'undefined',
      page: 1,
      pageSize: 50,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl.startsWith('/api/procurement/company-review')).toBe(true);
    const query = new URL(calledUrl, 'https://app.test').searchParams;
    expect(query.get('supplierId')).toBe('99001');
    expect(query.get('brandId')).toBe('undefined');

    fetchSpy.mockRestore();
  });

  it('saveCompanyPurchaseDecision uses absolute URL starting with /api/procurement/company-review/decision', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            companyId: 1,
            productCode: 'PROD-1',
            decisionStatus: 'APPROVED',
            version: 2,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await saveCompanyPurchaseDecision({
      companyId: 1,
      productCode: 'PROD-1',
      decisionStatus: 'APPROVED',
      expectedVersion: 1,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl.startsWith('/api/procurement/company-review/decision')).toBe(true);

    fetchSpy.mockRestore();
  });

  it('bulkSaveCompanyPurchaseDecisions uses absolute URL starting with /api/procurement/company-review/bulk', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            batchId: 'batch-1',
            items: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await bulkSaveCompanyPurchaseDecisions({
      items: [{ companyId: 1, productCode: 'PROD-1', decisionStatus: 'APPROVED', expectedVersion: 1 }],
      decisionStatus: 'APPROVED',
      buyerNote: null,
    });

    expect(fetchSpy).toHaveBeenCalled();
    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl.startsWith('/api/procurement/company-review/bulk')).toBe(true);

    fetchSpy.mockRestore();
  });
});
