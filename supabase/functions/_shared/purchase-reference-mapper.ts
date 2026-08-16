export type Many2One = [number, string] | false | null;

export type OdooSupplierReference = {
  id: number;
  name: string | null;
  ref: string | false | null;
  active: boolean;
  supplier_rank: number;
  write_date: string | null;
};

export type OdooProductPurchaseReference = {
  id: number;
  default_code: string | false | null;
  product_tmpl_id: Many2One;
  official_brand: Many2One;
  purchase_uom: Many2One;
  order_multiple: number | string | null;
  write_date: string | null;
};

export type OdooVendorPriceReference = {
  product_code: string;
  supplier: Many2One;
  minimum_qty: number | string | null;
  price: number | string | null;
  currency: Many2One;
  delay_days: number | string | null;
  sequence: number | string | null;
  write_date: string | null;
};

export type SupplierDirectoryRow = {
  odoo_supplier_id: number;
  supplier_name: string;
  supplier_code: string | null;
  active: boolean;
  supplier_rank: number;
  source_updated_at: string | null;
};

export function mapOdooPartnerDirectoryRecord(
  raw: OdooSupplierReference,
): SupplierDirectoryRow {
  const id = positiveInteger(raw.id, "INVALID_SUPPLIER_ID");
  const name = trimmed(raw.name);
  if (!name) throw new Error("MISSING_SUPPLIER_NAME");

  const supplierRank = Number(raw.supplier_rank);
  if (!Number.isSafeInteger(supplierRank) || supplierRank < 0) {
    throw new Error("INVALID_SUPPLIER_RANK");
  }

  return {
    odoo_supplier_id: id,
    supplier_name: name,
    supplier_code: trimmed(raw.ref),
    active: raw.active === true,
    supplier_rank: supplierRank,
    source_updated_at: trimmed(raw.write_date),
  };
}

export type ProductPurchaseMetadataRow = {
  product_code: string;
  odoo_product_id: number;
  odoo_product_tmpl_id: number | null;
  brand_id: number | null;
  brand_name: string | null;
  purchase_uom_id: number | null;
  purchase_uom_name: string | null;
  order_multiple: number | null;
  source_updated_at: string | null;
};

export type ProductVendorPriceRow = {
  product_code: string;
  supplier_id: number;
  minimum_qty: number;
  price: number;
  currency: string | null;
  delay_days: number | null;
  sequence: number;
  source_updated_at: string | null;
};

function positiveInteger(value: unknown, code: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function nonNegativeNumber(value: unknown, fallback: number, code: string): number {
  if (value === null || value === undefined || value === false || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function optionalPositiveNumber(value: unknown, code: string): number | null {
  if (value === null || value === undefined || value === false || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function many2One(value: Many2One): { id: number; name: string } | null {
  if (!Array.isArray(value)) return null;
  const id = positiveInteger(value[0], "INVALID_MANY2ONE_ID");
  const name = trimmed(value[1]);
  if (!name) throw new Error("INVALID_MANY2ONE_NAME");
  return { id, name };
}

export function mapOdooSupplierReference(
  raw: OdooSupplierReference,
): SupplierDirectoryRow | null {
  const row = mapOdooPartnerDirectoryRecord(raw);
  return row.active && row.supplier_rank > 0 ? row : null;
}

export function mapOdooProductPurchaseMetadata(
  raw: OdooProductPurchaseReference,
): ProductPurchaseMetadataRow | null {
  const productCode = trimmed(raw.default_code);
  if (!productCode) return null;

  const productId = positiveInteger(raw.id, "INVALID_PRODUCT_ID");
  const template = many2One(raw.product_tmpl_id);
  const brand = many2One(raw.official_brand);
  const purchaseUom = many2One(raw.purchase_uom);

  return {
    product_code: productCode,
    odoo_product_id: productId,
    odoo_product_tmpl_id: template?.id ?? null,
    brand_id: brand?.id ?? null,
    brand_name: brand?.name ?? null,
    purchase_uom_id: purchaseUom?.id ?? null,
    purchase_uom_name: purchaseUom?.name ?? null,
    order_multiple: optionalPositiveNumber(raw.order_multiple, "INVALID_ORDER_MULTIPLE"),
    source_updated_at: trimmed(raw.write_date),
  };
}

export function mapOdooVendorPrice(raw: OdooVendorPriceReference): ProductVendorPriceRow {
  const productCode = trimmed(raw.product_code);
  if (!productCode) throw new Error("MISSING_VENDOR_PRODUCT_CODE");
  const supplier = many2One(raw.supplier);
  if (!supplier) throw new Error("MISSING_VENDOR_SUPPLIER");
  const price = nonNegativeNumber(raw.price, -1, "INVALID_VENDOR_PRICE");
  if (price < 0) throw new Error("MISSING_VENDOR_PRICE");
  const currency = many2One(raw.currency);

  return {
    product_code: productCode,
    supplier_id: supplier.id,
    minimum_qty: nonNegativeNumber(raw.minimum_qty, 0, "INVALID_MINIMUM_QUANTITY"),
    price,
    currency: currency?.name ?? null,
    delay_days: raw.delay_days === null || raw.delay_days === undefined
      ? null
      : nonNegativeNumber(raw.delay_days, 0, "INVALID_DELAY_DAYS"),
    sequence: nonNegativeNumber(raw.sequence, 10, "INVALID_VENDOR_SEQUENCE"),
    source_updated_at: trimmed(raw.write_date),
  };
}
