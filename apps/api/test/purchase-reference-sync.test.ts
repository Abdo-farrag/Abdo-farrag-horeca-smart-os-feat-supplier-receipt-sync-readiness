import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parsePurchaseReferenceSyncInput,
  purchaseReferenceWriteAllowed,
} from '../../../supabase/functions/_shared/purchase-reference-input.ts';
import {
  mapOdooPartnerDirectoryRecord,
  mapOdooProductPurchaseMetadata,
  mapOdooSupplierReference,
  mapOdooVendorPrice,
} from '../../../supabase/functions/_shared/purchase-reference-mapper.ts';

describe('Odoo purchasing reference mapper', () => {
  it('includes only active partners with supplier_rank > 0', () => {
    expect(
      mapOdooSupplierReference({
        id: 32546,
        name: 'Arma Supplier',
        ref: 'ARMA-01',
        active: true,
        supplier_rank: 2,
        write_date: null,
      }),
    ).toMatchObject({ odoo_supplier_id: 32546, supplier_code: 'ARMA-01' });

    expect(
      mapOdooSupplierReference({
        id: 1,
        name: 'Customer Only',
        ref: 'CUS-1',
        active: true,
        supplier_rank: 0,
        write_date: null,
      }),
    ).toBeNull();
  });

  it('preserves inactive supplier state for stale-option reconciliation', () => {
    expect(
      mapOdooPartnerDirectoryRecord({
        id: 41,
        name: 'Former Supplier',
        ref: 'OLD-41',
        active: false,
        supplier_rank: 2,
        write_date: null,
      }),
    ).toMatchObject({
      odoo_supplier_id: 41,
      active: false,
      supplier_rank: 2,
    });
  });

  it('does not fabricate a brand when no official Odoo brand exists', () => {
    expect(
      mapOdooProductPurchaseMetadata({
        id: 8568,
        default_code: '101003',
        product_tmpl_id: [7568, 'Template'],
        official_brand: null,
        purchase_uom: null,
        order_multiple: null,
        write_date: null,
      }),
    ).toMatchObject({ brand_id: null, brand_name: null });
  });

  it('preserves supplier-specific price and MOQ', () => {
    expect(
      mapOdooVendorPrice({
        id: 7001,
        product_code: '101002',
        supplier: [32546, 'Arma Supplier'],
        company: [1, 'MAS'],
        minimum_qty: 12,
        price: 1526.9,
        currency: [2, 'SAR'],
        delay_days: 4,
        sequence: 10,
        valid_from: '2026-08-01',
        valid_to: '2026-12-31',
        write_date: null,
      }),
    ).toMatchObject({
      odoo_supplierinfo_id: 7001,
      supplier_id: 32546,
      company_id: 1,
      minimum_qty: 12,
      price: 1526.9,
      valid_from: '2026-08-01',
      valid_to: '2026-12-31',
    });
  });

  it('keeps same-tier Odoo vendor rows distinct and maps global rules', () => {
    const common = {
      product_code: '101002',
      supplier: [32546, 'Arma Supplier'] as [number, string],
      company: false as const,
      minimum_qty: 12,
      price: 1526.9,
      currency: [2, 'SAR'] as [number, string],
      delay_days: 4,
      sequence: 10,
      valid_from: false as const,
      valid_to: false as const,
      write_date: null,
    };

    const first = mapOdooVendorPrice({ ...common, id: 7001 });
    const second = mapOdooVendorPrice({ ...common, id: 7002 });

    expect(first.odoo_supplierinfo_id).toBe(7001);
    expect(second.odoo_supplierinfo_id).toBe(7002);
    expect(first.company_id).toBeNull();
    expect(first.valid_from).toBeNull();
    expect(first.valid_to).toBeNull();
  });
});

describe('Odoo purchasing reference sync safety', () => {
  it('defaults to bounded zero-write test mode', () => {
    expect(parsePurchaseReferenceSyncInput({ page_size: 500, max_pages: 100 })).toEqual({
      mode: 'test',
      pageSize: 5,
      maxPages: 1,
      partnerCursor: 0,
      productCursor: 0,
    });
    expect(purchaseReferenceWriteAllowed('test')).toBe(false);
    expect(purchaseReferenceWriteAllowed('sync')).toBe(true);
  });

  it.each(['', 'dryrun', true, 1])('rejects invalid mode %j', (mode) => {
    expect(() => parsePurchaseReferenceSyncInput({ mode })).toThrow(
      'Invalid mode. Supported modes are: test, sync',
    );
  });

  it('rejects invalid limits and cursors', () => {
    expect(() => parsePurchaseReferenceSyncInput({ mode: 'sync', page_size: 501 })).toThrow();
    expect(() => parsePurchaseReferenceSyncInput({ mode: 'sync', max_pages: 0 })).toThrow();
    expect(() =>
      parsePurchaseReferenceSyncInput({ mode: 'sync', start_after_partner_id: -1 }),
    ).toThrow();
  });

  it('contains only read-only Odoo operations and paginates vendor prices', () => {
    const source = readFileSync(
      new URL(
        '../../../supabase/functions/sync-odoo18-purchase-reference/index.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/"(?:create|write|unlink|action_confirm)"/);
    expect(source.match(/"search_read"/g)).toHaveLength(3);
    expect(source).toContain('offset: sellerOffset');
    expect(source).toContain('["supplier_rank", ">", 0]');
    expect(source).toContain('purchaseReferenceWriteAllowed(mode)');
    expect(source).toContain('{ onConflict: "odoo_supplierinfo_id" }');
    expect(source.indexOf('progress.partnerCursorEnd = partnerCursor')).toBeGreaterThan(
      source.indexOf('progress.writtenRows += directoryRows.length'),
    );
    expect(source.indexOf('progress.productCursorEnd = productCursor')).toBeGreaterThan(
      source.indexOf('progress.writtenRows += vendorRows.length'),
    );
  });
});
