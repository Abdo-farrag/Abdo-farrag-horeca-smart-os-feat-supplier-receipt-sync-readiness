import {
  mapOdooPartnerDirectoryRecord,
  mapOdooProductPurchaseMetadata,
  mapOdooSupplierReference,
  mapOdooVendorPrice,
} from "./purchase-reference-mapper.ts";
import {
  parsePurchaseReferenceSyncInput,
  purchaseReferenceWriteAllowed,
} from "./purchase-reference-input.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("maps an active Odoo supplier and preserves code", () => {
  const row = mapOdooSupplierReference({
    id: 32546,
    name: "  Arma Supplier  ",
    ref: " ARMA-01 ",
    active: true,
    supplier_rank: 3,
    write_date: "2026-08-16 09:00:00",
  });

  assert(row !== null, "eligible supplier must be mapped");
  assert(row.odoo_supplier_id === 32546, "supplier id must be preserved");
  assert(row.supplier_name === "Arma Supplier", "name must be trimmed");
  assert(row.supplier_code === "ARMA-01", "code must be trimmed");
});

Deno.test("excludes inactive and customer-only Odoo partners", () => {
  assert(
    mapOdooSupplierReference({
      id: 1,
      name: "Inactive Supplier",
      ref: null,
      active: false,
      supplier_rank: 5,
      write_date: null,
    }) === null,
    "inactive partner must be excluded",
  );
  assert(
    mapOdooSupplierReference({
      id: 2,
      name: "Customer Only",
      ref: "CUS-2",
      active: true,
      supplier_rank: 0,
      write_date: null,
    }) === null,
    "customer-only partner must be excluded",
  );
});

Deno.test("preserves inactive supplier state so stale options can be removed", () => {
  const row = mapOdooPartnerDirectoryRecord({
    id: 41,
    name: "Former Supplier",
    ref: "OLD-41",
    active: false,
    supplier_rank: 2,
    write_date: null,
  });

  assert(row.active === false, "inactive state must be preserved");
  assert(row.supplier_rank === 2, "supplier rank must be preserved");
});

Deno.test("maps official brand and purchase UoM only when supplied", () => {
  const row = mapOdooProductPurchaseMetadata({
    id: 8567,
    default_code: "101002",
    product_tmpl_id: [7567, "Oil Template"],
    official_brand: [81, "El Nada"],
    purchase_uom: [12, "Pack"],
    order_multiple: 6,
    write_date: "2026-08-16 09:00:00",
  });

  assert(row !== null, "coded product must be mapped");
  assert(row.brand_id === 81, "official brand id must be preserved");
  assert(row.brand_name === "El Nada", "official brand name must be preserved");
  assert(row.purchase_uom_name === "Pack", "purchase UoM must be preserved");
  assert(row.order_multiple === 6, "trusted order multiple must be preserved");
});

Deno.test("keeps brand null when Odoo exposes no official brand field", () => {
  const row = mapOdooProductPurchaseMetadata({
    id: 8568,
    default_code: "101003",
    product_tmpl_id: [7568, "No Brand Template"],
    official_brand: null,
    purchase_uom: null,
    order_multiple: null,
    write_date: null,
  });

  assert(row !== null, "coded product must be mapped");
  assert(row.brand_id === null, "brand id must remain null");
  assert(row.brand_name === null, "brand name must remain null");
});

Deno.test("maps supplier-specific vendor price tiers", () => {
  const row = mapOdooVendorPrice({
    product_code: "101002",
    supplier: [32546, "Arma Supplier"],
    minimum_qty: 12,
    price: 1526.9,
    currency: [2, "SAR"],
    delay_days: 4,
    sequence: 10,
    write_date: "2026-08-16 09:00:00",
  });

  assert(row.product_code === "101002", "product code must be preserved");
  assert(row.supplier_id === 32546, "supplier id must be preserved");
  assert(row.minimum_qty === 12, "MOQ tier must be preserved");
  assert(row.price === 1526.9, "vendor price must be preserved");
  assert(row.currency === "SAR", "currency name must be preserved");
});

Deno.test("defaults to bounded zero-write test mode", () => {
  const input = parsePurchaseReferenceSyncInput({ page_size: 500, max_pages: 100 });
  assert(input.mode === "test", "omitted mode must default to test");
  assert(input.pageSize === 5, "test page size must be capped to five");
  assert(input.maxPages === 1, "test mode must fetch one page");
  assert(!purchaseReferenceWriteAllowed(input.mode), "test mode must not write");
});

Deno.test("rejects invalid purchase reference sync inputs", () => {
  for (const mode of ["", "dryrun", true, 1]) {
    let rejected = false;
    try {
      parsePurchaseReferenceSyncInput({ mode });
    } catch {
      rejected = true;
    }
    assert(rejected, `invalid mode ${String(mode)} must be rejected`);
  }
});
