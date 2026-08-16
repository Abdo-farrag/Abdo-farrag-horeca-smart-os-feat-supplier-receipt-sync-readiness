/**
 * Regression tests for the PostgREST filter URL construction in company-purchase.ts.
 *
 * Root cause fixed: filterString was built as `and(conditions)` and appended as
 * `&and(conditions)` — a URL key with no value, which PostgREST silently ignores.
 * The correct form is `&and=(conditions)` (key=`and`, value=`(conditions)`).
 *
 * These tests intercept `fetch` to capture every URL sent to Supabase and assert
 * that the `and=` parameter is present and syntactically correct.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseCompanyPurchaseDependencies } from '../src/company-purchase.js';
import type { AppConfig } from '../src/config.js';

// ── Minimal config ──────────────────────────────────────────────────────────
const MOCK_CONFIG: AppConfig = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
  OVERVIEW_PASSWORD_HASH: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OVERVIEW_AUTH_DISABLED: false,
  PORT: 3000,
  HOST: '0.0.0.0',
};

// ── Empty-page Supabase stub ─────────────────────────────────────────────────
function makeEmptyResponse(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Range': '0-0/0',
    },
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Collect every URL fetched during the test. */
function capturedUrls(): string[] {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: [string | URL | Request, ...unknown[]]) => String(call[0]),
  );
}

/**
 * Parse the `and=` query-param value from a URL.
 * Returns null if no `and=` param exists.
 */
function andParam(url: string): string | null {
  const parsed = new URL(url);
  return parsed.searchParams.get('and');
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(makeEmptyResponse())));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── list() filter tests ──────────────────────────────────────────────────────

describe('listCompanyPurchaseReview — PostgREST URL filter correctness', () => {
  it('uses and= (not and() ) when company=1 is applied', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: '1', search: '', priority: 'all', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls.length).toBeGreaterThanOrEqual(1);

    for (const url of urls) {
      // Must NOT contain the old broken form
      expect(url).not.toMatch(/[?&]and\(/);
      // Must contain the correct PostgREST form
      expect(url).toMatch(/[?&]and=/);
    }

    const andValue = andParam(urls[0]);
    expect(andValue).toBe('(company_id.eq.1)');
  });

  it('uses and= when company=2 is applied', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: '2', search: '', priority: 'all', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    const andValue = andParam(urls[0]);
    expect(andValue).toBe('(company_id.eq.2)');
  });

  it('sends no and= param when company=all and no other filters are set', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', search: '', priority: 'all', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    for (const url of urls) {
      expect(url).not.toMatch(/[?&]and[=(]/);
    }
  });

  it('includes priority.eq.<VALUE> inside and= when priority filter is set', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', search: '', priority: 'CRITICAL', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('priority.eq.CRITICAL');
  });

  it('includes decision_status.eq.<VALUE> inside and= when decisionStatus filter is set', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', search: '', priority: 'all', decisionStatus: 'APPROVED', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('decision_status.eq.APPROVED');
  });

  it('includes supplier_readiness.eq.NEEDS_SUPPLIER inside and= when noSupplier=true', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', search: '', priority: 'all', decisionStatus: 'all', noSupplier: true, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('filters by the canonical supplier id', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: '1', supplierId: 99001, page: 1, pageSize: 50,
    });

    expect(andParam(capturedUrls()[0])).toContain('supplier_id.eq.99001');
  });

  it('filters by an official brand id or by the explicit undefined-brand state', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', brandId: 77, page: 1, pageSize: 50 });
    expect(andParam(capturedUrls()[0])).toContain('brand_id.eq.77');

    vi.mocked(fetch).mockClear();
    await deps.list({ company: 'all', brandId: 'undefined', page: 1, pageSize: 50 });
    expect(andParam(capturedUrls()[0])).toContain('brand_id.is.null');
  });

  it('wraps the search condition in or() nested inside and= ', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: 'all', search: 'tea', priority: 'all', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    // The search or() must be nested inside the and=() value
    expect(andValue).toContain('or(product_code.ilike.*tea*,product_name.ilike.*tea*)');
  });

  it('removes PostgREST control characters from user search input', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: 'tea*),supplier_id.gt.0', page: 1, pageSize: 50,
    });
    const value = andParam(capturedUrls()[0]);
    expect(value).not.toContain('supplier_id.gt.0');
    expect(value).toContain('product_code.ilike.*tea supplier_id gt 0*');
  });

  it('combines all active filters correctly inside a single and=(...) param', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: '1', search: 'rice', priority: 'HIGH', decisionStatus: 'UNDER_REVIEW', noSupplier: true, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);

    const andValue = andParam(urls[0]);
    expect(andValue).toContain('company_id.eq.1');
    expect(andValue).toContain('or(product_code.ilike.*rice*,product_name.ilike.*rice*)');
    expect(andValue).toContain('priority.eq.HIGH');
    expect(andValue).toContain('decision_status.eq.UNDER_REVIEW');
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('applies the and= filter to both the count query and the data query', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({ company: '2', search: '', priority: 'all', decisionStatus: 'all', noSupplier: false, page: 1, pageSize: 50 });

    const urls = capturedUrls();
    // Expect at least 2 Supabase calls: count query + data query
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) {
      expect(url).not.toMatch(/[?&]and\(/);
      const andValue = andParam(url);
      expect(andValue).toBe('(company_id.eq.2)');
    }
  });
});

// ── exportCompanyPurchaseRows filter tests ────────────────────────────────────

describe('exportCompanyPurchaseRows — PostgREST URL filter correctness', () => {
  it('uses and= (not and() ) for approved scope', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'approved' });

    const urls = capturedUrls();
    expect(urls.length).toBeGreaterThanOrEqual(1);

    for (const url of urls) {
      expect(url).not.toMatch(/[?&]and\(/);
      expect(url).toMatch(/[?&]and=/);
    }
  });

  it('includes decision_status.eq.APPROVED inside and= for approved scope', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'approved' });

    const urls = capturedUrls();
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('decision_status.eq.APPROVED');
  });

  it('includes approved_qty.gt.0 inside and= for approved scope', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'approved' });

    const urls = capturedUrls();
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('approved_qty.gt.0');
  });

  it('sends both decision_status and approved_qty conditions in the same and= value', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'approved' });

    const urls = capturedUrls();
    const andValue = andParam(urls[0]);
    expect(andValue).toBe('(decision_status.eq.APPROVED,approved_qty.gt.0)');
  });

  it('sends no and= param for draft scope with no companyId', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'draft' });

    const urls = capturedUrls();
    for (const url of urls) {
      expect(url).not.toMatch(/[?&]and[=(]/);
    }
  });

  it('applies company_id filter inside and= when companyId is provided', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'draft', companyId: 1 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('company_id.eq.1');
  });

  it('combines companyId and approved-scope conditions inside and= for approved+company', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.exportRows!({ scope: 'approved', companyId: 2 });

    const urls = capturedUrls();
    expect(urls[0]).not.toMatch(/[?&]and\(/);
    const andValue = andParam(urls[0]);
    expect(andValue).toContain('company_id.eq.2');
    expect(andValue).toContain('decision_status.eq.APPROVED');
    expect(andValue).toContain('approved_qty.gt.0');
  });
});
