import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createPurchaseReferenceSyncProgress,
  purchaseReferenceFailurePayload,
  purchaseReferenceLogMessage,
  sanitizePurchaseReferenceError,
} from '../../../supabase/functions/_shared/purchase-reference-telemetry.ts';

describe('purchase reference partial-write telemetry', () => {
  it('reports written rows and current cursors after a later write fails', () => {
    const progress = createPurchaseReferenceSyncProgress(100, 200);
    progress.supplierPages = 1;
    progress.productPages = 1;
    progress.suppliersFetched = 5;
    progress.suppliersAccepted = 5;
    progress.productsFetched = 100;
    progress.productsAccepted = 100;
    progress.vendorPricesAccepted = 25;
    progress.writtenRows = 105;
    progress.partnerCursorEnd = 28795;
    progress.productCursorEnd = 8106;

    expect(purchaseReferenceFailurePayload('sync', progress, 'Vendor price upsert failed: detail')).toEqual({
      success: false,
      error: 'VENDOR_PRICE_UPSERT_FAILED',
      mode: 'sync',
      supplier_pages: 1,
      product_pages: 1,
      suppliers_fetched: 5,
      suppliers_accepted: 5,
      products_fetched: 100,
      products_accepted: 100,
      vendor_prices_accepted: 25,
      inserted_or_updated_rows: 105,
      write_performed: true,
      partial_write: true,
      partner_cursor_start: 100,
      partner_cursor_end: 28795,
      product_cursor_start: 200,
      product_cursor_end: 8106,
    });
  });

  it('serializes the same sanitized progress for sync_logs', () => {
    const progress = createPurchaseReferenceSyncProgress(0, 0);
    progress.writtenRows = 11;
    progress.partnerCursorEnd = 28795;

    expect(JSON.parse(purchaseReferenceLogMessage(progress, 'later stage failed'))).toMatchObject({
      error: 'PURCHASE_REFERENCE_SYNC_FAILED',
      inserted_or_updated_rows: 11,
      partial_write: true,
      partner_cursor_end: 28795,
    });
  });

  it('reduces downstream database details to a stable public error code', () => {
    expect(sanitizePurchaseReferenceError(
      'Vendor price upsert failed: duplicate key value contains private detail',
    )).toBe('VENDOR_PRICE_UPSERT_FAILED');
    expect(sanitizePurchaseReferenceError('unexpected Odoo response body')).toBe(
      'PURCHASE_REFERENCE_SYNC_FAILED',
    );
    expect(sanitizePurchaseReferenceError('Invalid mode. Supported modes are: test, sync')).toBe(
      'Invalid mode. Supported modes are: test, sync',
    );
  });

  it('fails closed when the required Odoo supplier-info fields are unavailable', async () => {
    const source = await readFile(
      new URL(
        '../../../supabase/functions/sync-odoo18-purchase-reference/index.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).toContain('Missing Odoo supplier-info fields:');
    expect(source).not.toContain(
      'requiredSupplierInfoFields.every((field) => supplierInfoFields.has(field))',
    );
  });
});
