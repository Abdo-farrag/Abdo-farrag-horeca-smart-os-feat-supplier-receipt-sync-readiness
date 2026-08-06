export const REJECTION_REASONS = {
  INVALID_RECEIPT_LINE_ID: "INVALID_RECEIPT_LINE_ID",
  MISSING_OR_INVALID_PICKING: "MISSING_OR_INVALID_PICKING",
  MISSING_PICKING_TYPE: "MISSING_PICKING_TYPE",
  NON_INCOMING_PICKING: "NON_INCOMING_PICKING",
  INTERNAL_TRANSFER_EXCLUDED: "INTERNAL_TRANSFER_EXCLUDED",
  INVALID_COMPANY: "INVALID_COMPANY",
  MISSING_OR_INVALID_PRODUCT: "MISSING_OR_INVALID_PRODUCT",
  MISSING_SUPPLIER: "MISSING_SUPPLIER",
  MISSING_PRODUCT_CODE: "MISSING_PRODUCT_CODE",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  MISSING_DATE_DONE: "MISSING_DATE_DONE",
  INVALID_UNIT_COST: "INVALID_UNIT_COST",
} as const;

export const INVALID_COMPLETED_RECEIPT_LINE = "INVALID_COMPLETED_RECEIPT_LINE" as const;

type Many2One = [number, string] | false | null | undefined;

export type SupplierReceiptRow = {
  odoo_receipt_line_id: number;
  receipt_id: number;
  receipt_name: string;
  company_id: 1 | 2;
  product_id: number;
  product_code: string;
  product_name: string;
  supplier_id: number;
  supplier_name: string;
  received_qty: number;
  unit_cost: number | null;
  received_at: string;
  source_updated_at: string | null;
};

function invalid(code: string = INVALID_COMPLETED_RECEIPT_LINE): never {
  throw new Error(code);
}

function positiveInteger(value: unknown, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) invalid(errorCode);
  return parsed;
}

function positiveNumber(value: unknown, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) invalid(errorCode);
  return parsed;
}

function optionalCost(value: unknown): number | null {
  if (value === null || value === undefined || value === false || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) invalid(REJECTION_REASONS.INVALID_UNIT_COST);
  return parsed;
}

function nonEmptyText(value: unknown, errorCode: string): string {
  if (typeof value !== "string") invalid(errorCode);
  const normalized = value.trim();
  if (!normalized) invalid(errorCode);
  return normalized;
}

function many2One(value: unknown, errorCode: string): [number, string] {
  if (!Array.isArray(value) || value.length < 2) invalid(errorCode);
  return [positiveInteger(value[0], errorCode), nonEmptyText(value[1], errorCode)];
}

function normalizeOdooTimestamp(value: string): string {
  const normalized = value.trim();
  const withoutTimezone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  return withoutTimezone.test(normalized) ? `${normalized.replace(" ", "T")}Z` : normalized;
}

function isoTimestamp(value: unknown, errorCode: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === false || value === "")) {
    return null;
  }

  if (typeof value !== "string" && !(value instanceof Date)) invalid(errorCode);
  const parsed = value instanceof Date
    ? new Date(value.getTime())
    : new Date(normalizeOdooTimestamp(value as string));
  if (Number.isNaN(parsed.getTime())) invalid(errorCode);
  return parsed.toISOString();
}

function parseProductDisplayName(displayName: string): {
  productCode: string;
  productName: string;
} {
  const match = displayName.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!match) invalid(REJECTION_REASONS.MISSING_PRODUCT_CODE);

  return {
    productCode: nonEmptyText(match[1], REJECTION_REASONS.MISSING_PRODUCT_CODE),
    productName: nonEmptyText(match[2], REJECTION_REASONS.MISSING_OR_INVALID_PRODUCT),
  };
}

function resolveProductIdentity(
  raw: Record<string, unknown>,
  displayName: string,
): { productCode: string; productName: string } {
  const explicitCode = typeof raw.product_code === "string" ? raw.product_code.trim() : "";
  const explicitName = typeof raw.product_name === "string" ? raw.product_name.trim() : "";

  if (explicitCode) {
    const fallbackName = displayName.replace(/^\[[^\]]+\]\s*/, "").trim();
    return {
      productCode: explicitCode,
      productName: nonEmptyText(explicitName || fallbackName, REJECTION_REASONS.MISSING_OR_INVALID_PRODUCT),
    };
  }

  return parseProductDisplayName(displayName);
}

export function mapOdooReceiptLine(
  raw: Record<string, unknown>,
): SupplierReceiptRow {
  const odooReceiptLineId = positiveInteger(raw.id, REJECTION_REASONS.INVALID_RECEIPT_LINE_ID);
  const picking = many2One(raw.picking_id, REJECTION_REASONS.MISSING_OR_INVALID_PICKING);

  // Additional defensive check on picking name containing /INT/
  if (picking[1].toUpperCase().includes("/INT/")) {
    invalid(REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED);
  }

  // Primary classification rule: Odoo picking type code must be incoming
  const pickingCode = typeof raw.picking_code === "string" && raw.picking_code.trim()
    ? raw.picking_code.trim().toLowerCase()
    : typeof raw.picking_type_code === "string" && raw.picking_type_code.trim()
    ? raw.picking_type_code.trim().toLowerCase()
    : null;

  if (pickingCode === null) {
    invalid(REJECTION_REASONS.MISSING_PICKING_TYPE);
  }

  if (pickingCode === "internal") {
    invalid(REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED);
  }

  if (pickingCode !== "incoming") {
    invalid(REJECTION_REASONS.NON_INCOMING_PICKING);
  }

  const company = many2One(raw.company_id, REJECTION_REASONS.INVALID_COMPANY);
  if (company[0] !== 1 && company[0] !== 2) {
    invalid(REJECTION_REASONS.INVALID_COMPANY);
  }

  const product = many2One(raw.product_id, REJECTION_REASONS.MISSING_OR_INVALID_PRODUCT);
  const supplier = many2One(raw.partner_id, REJECTION_REASONS.MISSING_SUPPLIER);

  const identity = resolveProductIdentity(raw, product[1]);
  const receivedAt = isoTimestamp(raw.date_done, REJECTION_REASONS.MISSING_DATE_DONE);
  if (!receivedAt) invalid(REJECTION_REASONS.MISSING_DATE_DONE);

  return {
    odoo_receipt_line_id: odooReceiptLineId,
    receipt_id: picking[0],
    receipt_name: picking[1],
    company_id: company[0],
    product_id: product[0],
    product_code: identity.productCode,
    product_name: identity.productName,
    supplier_id: supplier[0],
    supplier_name: supplier[1],
    received_qty: positiveNumber(raw.quantity, REJECTION_REASONS.INVALID_QUANTITY),
    unit_cost: optionalCost(raw.price_unit),
    received_at: receivedAt,
    source_updated_at: isoTimestamp(raw.write_date, REJECTION_REASONS.MISSING_DATE_DONE, true),
  };
}
