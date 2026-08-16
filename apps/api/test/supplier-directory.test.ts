import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabasePurchaseDraftDependencies } from '../src/purchase-drafts.js';
import type { AppConfig } from '../src/config.js';

const CONFIG: AppConfig = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
  OVERVIEW_PASSWORD_HASH: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OVERVIEW_AUTH_DISABLED: false,
  PORT: 3000,
  HOST: '0.0.0.0',
};

afterEach(() => vi.restoreAllMocks());

describe('supplier directory adapter', () => {
  it('queries only the active-supplier security view and searches name or code', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Range': '0-0/0' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabasePurchaseDraftDependencies(CONFIG);

    await dependencies.listSuppliers({ search: 'ARMA-01', page: 1, pageSize: 20 });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/rest/v1/api_procurement_supplier_directory');
    expect(url.searchParams.get('or')).toBe(
      '(supplier_name.ilike.*ARMA-01*,supplier_code.ilike.*ARMA-01*)',
    );
  });

  it('neutralizes PostgREST grammar characters in supplier search', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabasePurchaseDraftDependencies(CONFIG);

    await dependencies.listSuppliers({ search: 'x),active.eq.false', page: 1, pageSize: 20 });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get('or')).not.toContain('active.eq.false');
  });

  it('maps Odoo supplier identity and count without accepting customer rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{
      supplier_id: 32546,
      supplier_name: 'Arma Supplier',
      supplier_code: 'ARMA-01',
      supplier_rank: 3,
      active: true,
      source_updated_at: null,
    }]), {
      status: 200,
      headers: { 'Content-Range': '0-0/1' },
    })));
    const dependencies = createSupabasePurchaseDraftDependencies(CONFIG);
    const result = await dependencies.listSuppliers({ search: '', page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({ supplierId: 32546, active: true });
    expect(result.pagination.total).toBe(1);
  });

  it('adds the explicit undefined-brand option before official Odoo brands', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        brand_id: 81,
        brand_name: 'Official Brand',
        product_count: 50,
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', {
        status: 200,
        headers: { 'Content-Range': '0-0/7' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabasePurchaseDraftDependencies(CONFIG);

    await expect(dependencies.listBrands()).resolves.toEqual([
      { brandId: null, brandName: null, productCount: 7 },
      { brandId: 81, brandName: 'Official Brand', productCount: 50 },
    ]);
  });
});
