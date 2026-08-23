import type { PurchaseReferenceMode } from "./purchase-reference-input.ts";

export type PurchaseReferenceSyncProgress = {
  supplierPages: number;
  productPages: number;
  suppliersFetched: number;
  suppliersAccepted: number;
  productsFetched: number;
  productsAccepted: number;
  vendorPricesAccepted: number;
  writtenRows: number;
  partnerCursorStart: number;
  partnerCursorEnd: number;
  productCursorStart: number;
  productCursorEnd: number;
};

export function createPurchaseReferenceSyncProgress(
  partnerCursorStart: number,
  productCursorStart: number,
): PurchaseReferenceSyncProgress {
  return {
    supplierPages: 0,
    productPages: 0,
    suppliersFetched: 0,
    suppliersAccepted: 0,
    productsFetched: 0,
    productsAccepted: 0,
    vendorPricesAccepted: 0,
    writtenRows: 0,
    partnerCursorStart,
    partnerCursorEnd: partnerCursorStart,
    productCursorStart,
    productCursorEnd: productCursorStart,
  };
}

const PUBLIC_ERROR_CODES: ReadonlyArray<readonly [string, string]> = [
  ["Supplier directory read failed:", "SUPPLIER_DIRECTORY_READ_FAILED"],
  ["Supplier directory upsert failed:", "SUPPLIER_DIRECTORY_UPSERT_FAILED"],
  ["Product metadata upsert failed:", "PRODUCT_METADATA_UPSERT_FAILED"],
  ["Vendor price upsert failed:", "VENDOR_PRICE_UPSERT_FAILED"],
  ["Missing Odoo supplier fields:", "MISSING_ODOO_SUPPLIER_FIELDS"],
  ["Missing Odoo product fields:", "MISSING_ODOO_PRODUCT_FIELDS"],
  ["Missing Odoo supplier-info fields:", "MISSING_ODOO_SUPPLIER_INFO_FIELDS"],
];

const STABLE_PUBLIC_ERRORS = new Set([
  "SERVICE_ROLE_REQUIRED",
  "INVALID_PURCHASE_REFERENCE_INPUT",
  "SUPPLIER_DIRECTORY_READ_FAILED",
  "SUPPLIER_DIRECTORY_UPSERT_FAILED",
  "PRODUCT_METADATA_UPSERT_FAILED",
  "VENDOR_PRICE_UPSERT_FAILED",
  "MISSING_ODOO_SUPPLIER_FIELDS",
  "MISSING_ODOO_PRODUCT_FIELDS",
  "MISSING_ODOO_SUPPLIER_INFO_FIELDS",
  "PURCHASE_REFERENCE_SYNC_FAILED",
]);

export function sanitizePurchaseReferenceError(error: string): string {
  if (STABLE_PUBLIC_ERRORS.has(error)) return error;
  if (
    /^Invalid (mode|page_size|max_pages|start_after_partner_id|start_after_product_id)\./.test(
      error,
    )
  ) return error;
  return PUBLIC_ERROR_CODES.find(([prefix]) => error.startsWith(prefix))?.[1] ??
    "PURCHASE_REFERENCE_SYNC_FAILED";
}

function progressPayload(progress: PurchaseReferenceSyncProgress) {
  return {
    supplier_pages: progress.supplierPages,
    product_pages: progress.productPages,
    suppliers_fetched: progress.suppliersFetched,
    suppliers_accepted: progress.suppliersAccepted,
    products_fetched: progress.productsFetched,
    products_accepted: progress.productsAccepted,
    vendor_prices_accepted: progress.vendorPricesAccepted,
    inserted_or_updated_rows: progress.writtenRows,
    write_performed: progress.writtenRows > 0,
    partial_write: progress.writtenRows > 0,
    partner_cursor_start: progress.partnerCursorStart,
    partner_cursor_end: progress.partnerCursorEnd,
    product_cursor_start: progress.productCursorStart,
    product_cursor_end: progress.productCursorEnd,
  };
}

export function purchaseReferenceFailurePayload(
  mode: PurchaseReferenceMode,
  progress: PurchaseReferenceSyncProgress,
  error: string,
) {
  return {
    success: false,
    error: sanitizePurchaseReferenceError(error),
    mode,
    ...progressPayload(progress),
  };
}

export function purchaseReferenceLogMessage(
  progress: PurchaseReferenceSyncProgress,
  error: string,
): string {
  return JSON.stringify({
    error: sanitizePurchaseReferenceError(error),
    ...progressPayload(progress),
  });
}
