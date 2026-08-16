export type PurchaseReferenceMode = "test" | "sync";

export type PurchaseReferenceRequestBody = {
  mode?: unknown;
  page_size?: unknown;
  max_pages?: unknown;
  start_after_partner_id?: unknown;
  start_after_product_id?: unknown;
};

export type PurchaseReferenceSyncInput = {
  mode: PurchaseReferenceMode;
  pageSize: number;
  maxPages: number;
  partnerCursor: number;
  productCursor: number;
};

const MAX_PAGE_SIZE = 500;
const MAX_PAGES = 100;

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${name}. Must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function cursor(value: unknown, name: string): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${name}. Must be a non-negative integer`);
  }
  return value;
}

export function parsePurchaseReferenceSyncInput(
  body: PurchaseReferenceRequestBody,
): PurchaseReferenceSyncInput {
  let mode: PurchaseReferenceMode;
  if (body.mode === undefined || body.mode === null) {
    mode = "test";
  } else if (body.mode === "test" || body.mode === "sync") {
    mode = body.mode;
  } else {
    throw new Error("Invalid mode. Supported modes are: test, sync");
  }

  const requestedPageSize = boundedInteger(
    body.page_size,
    "page_size",
    1,
    MAX_PAGE_SIZE,
    mode === "test" ? 5 : MAX_PAGE_SIZE,
  );

  return {
    mode,
    pageSize: mode === "test" ? Math.min(requestedPageSize, 5) : requestedPageSize,
    maxPages: mode === "test"
      ? 1
      : boundedInteger(body.max_pages, "max_pages", 1, MAX_PAGES, MAX_PAGES),
    partnerCursor: cursor(body.start_after_partner_id, "start_after_partner_id"),
    productCursor: cursor(body.start_after_product_id, "start_after_product_id"),
  };
}

export function purchaseReferenceWriteAllowed(mode: PurchaseReferenceMode): boolean {
  return mode === "sync";
}
