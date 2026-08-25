import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { buildReferenceWorkbook, type ReferenceExportRow } from '../src/reference-data.js';
import { createSupabaseReferenceDataDependencies } from '../src/supabase-reference-data.js';

const CONFIG: AppConfig = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(40),
  OVERVIEW_PASSWORD_HASH: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  OVERVIEW_AUTH_DISABLED: false,
  PORT: 3000,
  HOST: '0.0.0.0',
};

const databaseRow = {
  company_id: 1,
  company_name: 'MAS',
  product_code: '101071',
  product_name: 'Chocolate Sauce',
  brand_id: null,
  brand_name: 'BODUO',
  supplier_id: 29906,
  supplier_code: 'IFI-01',
  supplier_name: 'ifico masr',
  supplier_product_code: null,
  purchase_uom_code: null,
  purchase_uom_name: 'Carton',
  pack_size: 6,
  minimum_qty: 12,
  price: 1900,
  currency_code: 'EGP',
  delay_days: 2,
  sequence: 10,
  is_primary: true,
  active: true,
  effective_source: 'ODOO_SYNC',
  brand_effective_source: 'ODOO_SYNC',
};

const exportRow: ReferenceExportRow = {
  companyId: 1,
  companyName: 'MAS',
  productCode: '101071',
  productName: 'Chocolate Sauce',
  brandId: null,
  brandName: 'BODUO',
  supplierId: 29906,
  supplierCode: 'IFI-01',
  supplierName: 'ifico masr',
  supplierProductCode: null,
  purchaseUomCode: null,
  purchaseUomName: 'Carton',
  packSize: 6,
  minimumQty: 12,
  price: 1900,
  currencyCode: 'EGP',
  delayDays: 2,
  sequence: 10,
  isPrimary: true,
  active: true,
  effectiveSource: 'ODOO_SYNC',
  brandEffectiveSource: 'ODOO_SYNC',
};

afterEach(() => vi.restoreAllMocks());

describe('Supabase reference-data adapter', () => {
  it('exports the override-first bulk view rather than Odoo source tables', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([databaseRow]), { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabaseReferenceDataDependencies(CONFIG);

    const buffer = await dependencies.exportWorkbook();

    expect(buffer.byteLength).toBeGreaterThan(1000);
    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(firstUrl.pathname).toBe('/rest/v1/api_procurement_product_reference_bulk_export');
    expect(firstUrl.searchParams.get('offset')).toBe('0');
  });

  it('stores the normalized preview rows in Supabase and never sends workbook base64 to the RPC', async () => {
    const workbook = await buildReferenceWorkbook([exportRow], '2026-08-25T10:00:00.000Z');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('api_procurement_product_reference_bulk_export')) {
        return new Response(JSON.stringify([databaseRow]), { status: 200 });
      }
      if (url.includes('api_procurement_supplier_directory')) {
        return new Response(JSON.stringify([{
          supplier_id: 29906,
          supplier_code: 'IFI-01',
          supplier_name: 'ifico masr',
          supplier_rank: 3,
          active: true,
        }]), { status: 200 });
      }
      if (url.includes('record_procurement_reference_import_preview')) {
        return new Response(JSON.stringify('11111111-1111-4111-8111-111111111111'), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabaseReferenceDataDependencies(CONFIG);

    const result = await dependencies.previewImport({
      filename: 'procurement-reference.xlsx',
      contentBase64: workbook.toString('base64'),
    });

    expect(result).toMatchObject({ validRows: 1, invalidRows: 0 });
    const rpcCall = calls.find((call) => call.url.includes('record_procurement_reference_import_preview'));
    const body = JSON.parse(String(rpcCall?.init?.body));
    expect(body.p_rows[0]).toMatchObject({
      company_id: 1,
      product_code: '101071',
      supplier_id: 29906,
    });
    expect(JSON.stringify(body)).not.toContain(workbook.toString('base64'));
  });

  it('applies by immutable preview batch id without accepting replacement rows', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({
        p_batch_id: '11111111-1111-4111-8111-111111111111',
        p_actor_user_id: null,
        p_actor_display_name: 'Overview Dashboard',
      });
      return new Response(JSON.stringify({
        batch_id: body.p_batch_id,
        status: 'APPLIED',
        inserted: 1,
        updated: 0,
        unchanged: 0,
        skipped: 0,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const dependencies = createSupabaseReferenceDataDependencies(CONFIG);

    await expect(dependencies.applyImport(
      '11111111-1111-4111-8111-111111111111',
    )).resolves.toMatchObject({ status: 'APPLIED', inserted: 1 });
  });
});
