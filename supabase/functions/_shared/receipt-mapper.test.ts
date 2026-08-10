import { mapOdooReceiptLine, REJECTION_REASONS } from "./receipt-mapper.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

function assertThrows(fn: () => unknown, expectedMessage: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== expectedMessage) {
      throw new Error(`Expected error ${expectedMessage}, received ${message}`);
    }
    return;
  }
  throw new Error(`Expected error ${expectedMessage}`);
}

const completedReceipt = {
  id: 901,
  picking_id: [88, "WH/IN/00088"],
  picking_code: "incoming",
  company_id: [1, "MAS"],
  product_id: [55, "[P-55] Product"],
  partner_id: [77, "Supplier A"],
  quantity: 12,
  price_unit: 54.5,
  date_done: "2026-07-23T10:00:00Z",
  write_date: "2026-07-23T10:05:00Z",
};

Deno.test("valid MAS receipt is accepted", () => {
  const row = mapOdooReceiptLine(completedReceipt);

  assertEquals(row, {
    odoo_receipt_line_id: 901,
    receipt_id: 88,
    receipt_name: "WH/IN/00088",
    company_id: 1,
    product_id: 55,
    product_code: "P-55",
    product_name: "Product",
    supplier_id: 77,
    supplier_name: "Supplier A",
    received_qty: 12,
    unit_cost: 54.5,
    received_at: "2026-07-23T10:00:00.000Z",
    source_updated_at: "2026-07-23T10:05:00.000Z",
  });
});

Deno.test("valid Horeca Smart receipt is accepted", () => {
  const row = mapOdooReceiptLine({
    ...completedReceipt,
    company_id: [2, "Horeca Smart"],
  });

  assertEquals(row.company_id, 2);
});

Deno.test("normalizes timezone-less Odoo datetimes as UTC", () => {
  const row = mapOdooReceiptLine({
    ...completedReceipt,
    date_done: "2026-07-23 10:00:00",
    write_date: "2026-07-23 10:05:00",
  });

  assertEquals(row.received_at, "2026-07-23T10:00:00.000Z");
  assertEquals(row.source_updated_at, "2026-07-23T10:05:00.000Z");
});

Deno.test("prefers explicit product code and name from product.product", () => {
  const row = mapOdooReceiptLine({
    ...completedReceipt,
    product_code: "EXPLICIT-55",
    product_name: "Explicit Product Name",
  });

  assertEquals(row.product_code, "EXPLICIT-55");
  assertEquals(row.product_name, "Explicit Product Name");
});

Deno.test("keeps missing unit cost as null", () => {
  const row = mapOdooReceiptLine({ ...completedReceipt, price_unit: null });
  assertEquals(row.unit_cost, null);
});

Deno.test("missing date_done is rejected", () => {
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, date_done: null }),
    REJECTION_REASONS.MISSING_DATE_DONE,
  );
});

Deno.test("zero and negative quantities are rejected", () => {
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, quantity: 0 }),
    REJECTION_REASONS.INVALID_QUANTITY,
  );
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, quantity: -5 }),
    REJECTION_REASONS.INVALID_QUANTITY,
  );
});

Deno.test("companies outside 1 and 2 are rejected", () => {
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, company_id: [3, "Other"] }),
    REJECTION_REASONS.INVALID_COMPANY,
  );
});

Deno.test("missing product code is rejected", () => {
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, product_id: [55, "Product without code"] }),
    REJECTION_REASONS.MISSING_PRODUCT_CODE,
  );
});

Deno.test("missing supplier is rejected", () => {
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, partner_id: false }),
    REJECTION_REASONS.MISSING_SUPPLIER,
  );
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, partner_id: null }),
    REJECTION_REASONS.MISSING_SUPPLIER,
  );
});

Deno.test("picking type code classification rules", () => {
  // missing picking code
  const noPickingCode = { ...completedReceipt };
  delete (noPickingCode as Record<string, unknown>).picking_code;
  delete (noPickingCode as Record<string, unknown>).picking_type_code;
  assertThrows(
    () => mapOdooReceiptLine(noPickingCode),
    REJECTION_REASONS.MISSING_PICKING_TYPE,
  );

  // empty picking code
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, picking_code: "   ", picking_type_code: "" }),
    REJECTION_REASONS.MISSING_PICKING_TYPE,
  );

  // incoming is accepted
  const incomingRow = mapOdooReceiptLine({ ...completedReceipt, picking_code: "incoming" });
  assertEquals(incomingRow.odoo_receipt_line_id, 901);

  // internal is rejected with INTERNAL_TRANSFER_EXCLUDED
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, picking_code: "internal" }),
    REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED,
  );

  // outgoing is rejected with NON_INCOMING_PICKING
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, picking_code: "outgoing" }),
    REJECTION_REASONS.NON_INCOMING_PICKING,
  );

  // unknown code is rejected with NON_INCOMING_PICKING
  assertThrows(
    () => mapOdooReceiptLine({ ...completedReceipt, picking_code: "dropship_custom" }),
    REJECTION_REASONS.NON_INCOMING_PICKING,
  );

  // picking_type_code internal is rejected
  assertThrows(
    () =>
      mapOdooReceiptLine({ ...completedReceipt, picking_code: "", picking_type_code: "internal" }),
    REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED,
  );

  // picking_type_code outgoing is rejected
  assertThrows(
    () =>
      mapOdooReceiptLine({ ...completedReceipt, picking_code: "", picking_type_code: "outgoing" }),
    REJECTION_REASONS.NON_INCOMING_PICKING,
  );

  // /INT/ name rejected even if another inconsistent field says incoming
  assertThrows(
    () =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_id: [88, "WH/INT/00088"],
        picking_code: "incoming",
      }),
    REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED,
  );
});
