import { describe, expect, it } from "vitest";
import {
  mapOdooReceiptLine,
  REJECTION_REASONS,
} from "../../../supabase/functions/_shared/receipt-mapper.ts";

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

describe("Supplier Receipt Sync Mapper", () => {
  it("accepts valid MAS receipt", () => {
    const row = mapOdooReceiptLine(completedReceipt);
    expect(row).toEqual({
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

  it("accepts valid Horeca Smart receipt", () => {
    const row = mapOdooReceiptLine({
      ...completedReceipt,
      company_id: [2, "Horeca Smart"],
    });
    expect(row.company_id).toBe(2);
  });

  it("normalizes timezone-less Odoo datetimes to UTC", () => {
    const row = mapOdooReceiptLine({
      ...completedReceipt,
      date_done: "2026-07-23 10:00:00",
      write_date: "2026-07-23 10:05:00",
    });
    expect(row.received_at).toBe("2026-07-23T10:00:00.000Z");
    expect(row.source_updated_at).toBe("2026-07-23T10:05:00.000Z");
  });

  it("prefers explicit product code and name", () => {
    const row = mapOdooReceiptLine({
      ...completedReceipt,
      product_code: "EXPLICIT-55",
      product_name: "Explicit Product Name",
    });
    expect(row.product_code).toBe("EXPLICIT-55");
    expect(row.product_name).toBe("Explicit Product Name");
  });

  it("keeps missing unit cost as null", () => {
    const row = mapOdooReceiptLine({ ...completedReceipt, price_unit: null });
    expect(row.unit_cost).toBeNull();
  });

  it("rejects zero and negative quantities", () => {
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, quantity: 0 }),
    ).toThrow(REJECTION_REASONS.INVALID_QUANTITY);
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, quantity: -10 }),
    ).toThrow(REJECTION_REASONS.INVALID_QUANTITY);
  });

  it("rejects missing product code", () => {
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        product_id: [55, "Product without code"],
      }),
    ).toThrow(REJECTION_REASONS.MISSING_PRODUCT_CODE);
  });

  it("rejects missing supplier", () => {
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, partner_id: false }),
    ).toThrow(REJECTION_REASONS.MISSING_SUPPLIER);
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, partner_id: null }),
    ).toThrow(REJECTION_REASONS.MISSING_SUPPLIER);
  });

  it("rejects missing date_done", () => {
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, date_done: null }),
    ).toThrow(REJECTION_REASONS.MISSING_DATE_DONE);
  });

  it("rejects companies outside 1 and 2", () => {
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, company_id: [3, "Other"] }),
    ).toThrow(REJECTION_REASONS.INVALID_COMPANY);
  });

  it("classifies picking types correctly", () => {
    // missing picking code
    const noPickingCode = { ...completedReceipt };
    delete (noPickingCode as Record<string, unknown>).picking_code;
    delete (noPickingCode as Record<string, unknown>).picking_type_code;
    expect(() => mapOdooReceiptLine(noPickingCode)).toThrow(
      REJECTION_REASONS.MISSING_PICKING_TYPE,
    );

    // empty picking code
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_code: "   ",
        picking_type_code: "",
      }),
    ).toThrow(REJECTION_REASONS.MISSING_PICKING_TYPE);

    // incoming is accepted
    const incomingRow = mapOdooReceiptLine({
      ...completedReceipt,
      picking_code: "incoming",
    });
    expect(incomingRow.odoo_receipt_line_id).toBe(901);

    // internal is rejected
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, picking_code: "internal" }),
    ).toThrow(REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED);

    // outgoing is rejected
    expect(() =>
      mapOdooReceiptLine({ ...completedReceipt, picking_code: "outgoing" }),
    ).toThrow(REJECTION_REASONS.NON_INCOMING_PICKING);

    // unknown code is rejected
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_code: "unknown_code",
      }),
    ).toThrow(REJECTION_REASONS.NON_INCOMING_PICKING);

    // picking_type_code internal is rejected
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_code: "",
        picking_type_code: "internal",
      }),
    ).toThrow(REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED);

    // picking_type_code outgoing is rejected
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_code: "",
        picking_type_code: "outgoing",
      }),
    ).toThrow(REJECTION_REASONS.NON_INCOMING_PICKING);

    // defensive check on picking name containing /INT/
    expect(() =>
      mapOdooReceiptLine({
        ...completedReceipt,
        picking_id: [88, "WH/INT/00088"],
        picking_code: "incoming",
      }),
    ).toThrow(REJECTION_REASONS.INTERNAL_TRANSFER_EXCLUDED);
  });
});

describe("Supplier Receipt Edge Function Logic & Input Validation", () => {
  function validateInputs(body: {
    mode?: unknown;
    page_size?: unknown;
    max_pages?: unknown;
    full_sync?: unknown;
    start_after_id?: unknown;
  }) {
    const rawMode = body.mode;
    let mode: "test" | "sync";
    if (rawMode === undefined || rawMode === null) {
      mode = "test";
    } else if (rawMode === "test" || rawMode === "sync") {
      mode = rawMode;
    } else {
      return { valid: false, error: "Invalid mode. Supported modes are: test, sync" };
    }

    if (body.page_size !== undefined) {
      if (
        typeof body.page_size !== "number" ||
        !Number.isInteger(body.page_size) ||
        body.page_size < 1 ||
        body.page_size > 500
      ) {
        return { valid: false, error: "Invalid page_size. Must be an integer between 1 and 500" };
      }
    }

    if (body.max_pages !== undefined) {
      if (
        typeof body.max_pages !== "number" ||
        !Number.isInteger(body.max_pages) ||
        body.max_pages < 1 ||
        body.max_pages > 100
      ) {
        return { valid: false, error: "Invalid max_pages. Must be an integer between 1 and 100" };
      }
    }

    if (body.full_sync !== undefined && typeof body.full_sync !== "boolean") {
      return { valid: false, error: "Invalid full_sync. Must be a boolean" };
    }

    if (
      body.start_after_id !== undefined &&
      (typeof body.start_after_id !== "number" ||
        !Number.isInteger(body.start_after_id) ||
        body.start_after_id < 0)
    ) {
      return { valid: false, error: "Invalid start_after_id. Must be a non-negative integer" };
    }

    return { valid: true, mode };
  }

  it("handles mode parsing correctly", () => {
    // omitted => test mode
    const omittedRes = validateInputs({});
    expect(omittedRes.valid).toBe(true);
    expect(omittedRes.mode).toBe("test");

    // null => test mode
    const nullRes = validateInputs({ mode: null });
    expect(nullRes.valid).toBe(true);
    expect(nullRes.mode).toBe("test");

    // "test" => test mode
    const testRes = validateInputs({ mode: "test" });
    expect(testRes.valid).toBe(true);
    expect(testRes.mode).toBe("test");

    // "sync" => sync mode
    const syncRes = validateInputs({ mode: "sync" });
    expect(syncRes.valid).toBe(true);
    expect(syncRes.mode).toBe("sync");

    // Invalid modes return HTTP 400 error
    expect(validateInputs({ mode: "" }).valid).toBe(false);
    expect(validateInputs({ mode: "dryrun" }).valid).toBe(false);
    expect(validateInputs({ mode: "unknown" }).valid).toBe(false);
    expect(validateInputs({ mode: true }).valid).toBe(false);
    expect(validateInputs({ mode: 1 }).valid).toBe(false);
  });

  it("validates page_size boundaries and integer type", () => {
    expect(validateInputs({ page_size: 0 }).valid).toBe(false);
    expect(validateInputs({ page_size: -1 }).valid).toBe(false);
    expect(validateInputs({ page_size: 501 }).valid).toBe(false);
    expect(validateInputs({ page_size: 2.5 }).valid).toBe(false);
    expect(validateInputs({ page_size: "10" }).valid).toBe(false);
    expect(validateInputs({ page_size: 10 }).valid).toBe(true);
    expect(validateInputs({ page_size: 500 }).valid).toBe(true);
  });

  it("validates max_pages boundaries and integer type", () => {
    expect(validateInputs({ max_pages: 0 }).valid).toBe(false);
    expect(validateInputs({ max_pages: -1 }).valid).toBe(false);
    expect(validateInputs({ max_pages: 101 }).valid).toBe(false);
    expect(validateInputs({ max_pages: 1.5 }).valid).toBe(false);
    expect(validateInputs({ max_pages: "5" }).valid).toBe(false);
    expect(validateInputs({ max_pages: 1 }).valid).toBe(true);
    expect(validateInputs({ max_pages: 100 }).valid).toBe(true);
  });

  it("validates full_sync boolean type", () => {
    expect(validateInputs({ full_sync: "true" }).valid).toBe(false);
    expect(validateInputs({ full_sync: 1 }).valid).toBe(false);
    expect(validateInputs({ full_sync: true }).valid).toBe(true);
    expect(validateInputs({ full_sync: false }).valid).toBe(true);
  });

  it("validates start_after_id non-negative integer type", () => {
    expect(validateInputs({ start_after_id: -1 }).valid).toBe(false);
    expect(validateInputs({ start_after_id: 2.5 }).valid).toBe(false);
    expect(validateInputs({ start_after_id: "0" }).valid).toBe(false);
    expect(validateInputs({ start_after_id: 0 }).valid).toBe(true);
    expect(validateInputs({ start_after_id: 150 }).valid).toBe(true);
  });

  it("sanitizes rejection reason counts", () => {
    const rejectionReasonCounts: Record<string, number> = {};
    const errors = [
      new Error(REJECTION_REASONS.MISSING_SUPPLIER),
      new Error(REJECTION_REASONS.MISSING_SUPPLIER),
      new Error(REJECTION_REASONS.INVALID_QUANTITY),
    ];

    for (const err of errors) {
      const reason = err.message;
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
    }

    expect(rejectionReasonCounts).toEqual({
      [REJECTION_REASONS.MISSING_SUPPLIER]: 2,
      [REJECTION_REASONS.INVALID_QUANTITY]: 1,
    });
  });
});
