/**
 * Regression tests for the noSupplier filter in company-purchase.ts.
 *
 * The noSupplier filter must use `supplier_readiness.eq.NEEDS_SUPPLIER`, which
 * maps to the view column introduced in 20260808211220 and refined in
 * 20260812210000 (supplier_projection_fix). The old, incorrect form was
 * `supplier_name.is.null`, which excluded products that have a known primary
 * supplier from sku_supplier_settings.
 *
 * These tests ensure:
 *   1. noSupplier=true uses supplier_readiness.eq.NEEDS_SUPPLIER (not supplier_name.is.null).
 *   2. noSupplier=false never injects a supplier_readiness filter.
 *   3. noSupplier=true does NOT inject supplier_name.is.null (explicit anti-regression).
 *   4. noSupplier=true does NOT inject supplier_readiness.eq.FALLBACK_NEEDS_REVIEW.
 *   5. noSupplier applies to both the count query and the data query.
 *   6. noSupplier combines correctly with company, priority, and decisionStatus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseCompanyPurchaseDependencies } from '../src/company-purchase.js';
import type { AppConfig } from '../src/config.js';

// ── Minimal config ────────────────────────────────────────────────────────────
const MOCK_CONFIG: AppConfig = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
  OVERVIEW_PASSWORD_HASH: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OVERVIEW_AUTH_DISABLED: false,
  PORT: 3000,
  HOST: '0.0.0.0',
};

// ── Supabase stub that returns an empty page ──────────────────────────────────
function makeEmptyResponse(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Range': '0-0/0',
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function capturedUrls(): string[] {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    (call: [string | URL | Request, ...unknown[]]) => String(call[0]),
  );
}

function andParam(url: string): string | null {
  return new URL(url).searchParams.get('and');
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(makeEmptyResponse())));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── noSupplier filter correctness ─────────────────────────────────────────────

describe('listCompanyPurchaseReview — noSupplier filter', () => {
  it('uses supplier_readiness.eq.NEEDS_SUPPLIER when noSupplier=true', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const andValue = andParam(capturedUrls()[0]);
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('does NOT use supplier_name.is.null when noSupplier=true (anti-regression)', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    // The old broken filter was supplier_name.is.null — it excluded FALLBACK
    // products that have a primary_supplier name but no receipt.
    for (const url of capturedUrls()) {
      expect(url).not.toContain('supplier_name.is.null');
    }
  });

  it('does NOT inject supplier_readiness.eq.FALLBACK_NEEDS_REVIEW when noSupplier=true', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    // FALLBACK_NEEDS_REVIEW means a supplier is known — those rows must NOT
    // appear in the noSupplier=true result set.
    for (const url of capturedUrls()) {
      expect(url).not.toContain('supplier_readiness.eq.FALLBACK_NEEDS_REVIEW');
    }
  });

  it('does NOT inject any supplier_readiness filter when noSupplier=false', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: false, page: 1, pageSize: 50,
    });

    for (const url of capturedUrls()) {
      expect(url).not.toContain('supplier_readiness');
    }
  });

  it('applies the supplier_readiness filter to BOTH the count query and the data query', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const urls = capturedUrls();
    // list() issues at least 2 Supabase requests: count + data.
    expect(urls.length).toBeGreaterThanOrEqual(2);

    for (const url of urls) {
      const andValue = andParam(url);
      expect(andValue).not.toBeNull();
      expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
    }
  });

  it('combines noSupplier=true with company=1 correctly', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: '1', search: '', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const andValue = andParam(capturedUrls()[0]);
    expect(andValue).toContain('company_id.eq.1');
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('combines noSupplier=true with company=2 and priority=CRITICAL', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: '2', search: '', priority: 'CRITICAL', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const andValue = andParam(capturedUrls()[0]);
    expect(andValue).toContain('company_id.eq.2');
    expect(andValue).toContain('priority.eq.CRITICAL');
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('combines noSupplier=true with decisionStatus=NEW', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: '', priority: 'all', decisionStatus: 'NEW',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const andValue = andParam(capturedUrls()[0]);
    expect(andValue).toContain('decision_status.eq.NEW');
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('combines noSupplier=true with a search term', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: 'all', search: 'olive', priority: 'all', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const andValue = andParam(capturedUrls()[0]);
    expect(andValue).toContain('or(product_code.ilike.*olive*,product_name.ilike.*olive*)');
    expect(andValue).toContain('supplier_readiness.eq.NEEDS_SUPPLIER');
  });

  it('uses a single and=(...) param — no duplicate supplier_readiness conditions', async () => {
    const deps = createSupabaseCompanyPurchaseDependencies(MOCK_CONFIG);
    await deps.list({
      company: '1', search: '', priority: 'HIGH', decisionStatus: 'all',
      noSupplier: true, page: 1, pageSize: 50,
    });

    const url = capturedUrls()[0];
    // Count occurrences of supplier_readiness in the URL
    const occurrences = (url.match(/supplier_readiness/g) ?? []).length;
    // The and= param is mirrored to both count+data requests but within one
    // URL it must appear exactly once.
    expect(occurrences).toBe(1);
  });
});
