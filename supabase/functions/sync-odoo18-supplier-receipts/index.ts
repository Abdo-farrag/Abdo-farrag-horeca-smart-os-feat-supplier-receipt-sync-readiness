import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.8";
import {
  authenticateOdoo,
  executeKw,
  type JsonRecord,
  readableFields,
  readOdooCredentials,
  requiredEnv,
} from "../_shared/odoo.ts";
import { mapOdooReceiptLine, type SupplierReceiptRow } from "../_shared/receipt-mapper.ts";

type Mode = "test" | "sync";
type Many2One = [number, string] | false | null;

type OdooMove = {
  id: number;
  picking_id: Many2One;
  company_id: Many2One;
  product_id: Many2One;
  quantity: number | string | null;
  price_unit?: number | string | null;
  write_date?: string | null;
};

type OdooPicking = {
  id: number;
  name: string;
  partner_id: Many2One;
  date_done: string | null;
  company_id: Many2One;
};

type OdooProduct = {
  id: number;
  default_code: string | false | null;
  display_name: string | null;
};

type RequestBody = {
  mode?: unknown;
  company_ids?: unknown;
  page_size?: unknown;
  max_pages?: unknown;
  start_after_id?: unknown;
  full_sync?: unknown;
};

const SYNC_TYPE = "supplier_receipts_by_company";
const MAX_PAGE_SIZE = 500;
const MAX_PAGES = 100;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseCompanyIds(value: unknown): Array<1 | 2> {
  const values = Array.isArray(value) ? value : [1, 2];
  const ids = [...new Set(values.map(Number))].filter(
    (id): id is 1 | 2 => id === 1 || id === 2,
  );
  if (ids.length === 0) throw new Error("At least one valid company_id is required");
  return ids;
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  return atob(`${normalized}${padding}`);
}

function requireServiceRole(req: Request): void {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("SERVICE_ROLE_REQUIRED");

  try {
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1] ?? "")) as {
      role?: unknown;
    };
    if (payload.role !== "service_role") throw new Error("SERVICE_ROLE_REQUIRED");
  } catch {
    throw new Error("SERVICE_ROLE_REQUIRED");
  }
}

function many2OneId(value: Many2One): number | null {
  return Array.isArray(value) && Number.isSafeInteger(Number(value[0])) ? Number(value[0]) : null;
}

function uniquePositiveIds(values: Array<number | null>): number[] {
  return [
    ...new Set(
      values.filter((value): value is number =>
        value !== null && Number.isSafeInteger(value) && value > 0
      ),
    ),
  ];
}

async function searchReadByIds<T extends { id: number }>(
  credentials: ReturnType<typeof readOdooCredentials>,
  uid: number,
  model: string,
  ids: number[],
  fields: string[],
  context: JsonRecord,
): Promise<Map<number, T>> {
  if (ids.length === 0) return new Map();
  const rows = await executeKw<T[]>(
    credentials,
    uid,
    model,
    "search_read",
    [[[
      "id",
      "in",
      ids,
    ]]],
    { fields, limit: ids.length, order: "id asc", context },
  );
  return new Map(rows.map((row) => [Number(row.id), row]));
}

async function writeSyncLog(
  supabase: ReturnType<typeof createClient>,
  values: JsonRecord,
): Promise<void> {
  const { error } = await supabase.from("sync_logs").insert(values);
  if (error) console.error("Could not write supplier receipt sync log", error.message);
}

async function currentReceiptCursor(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const { data, error } = await supabase.rpc("procurement_supplier_receipt_cursor");
  if (error) throw new Error(`Could not read supplier receipt cursor: ${error.message}`);
  return parseNonNegativeInteger(data, 0);
}

Deno.serve(async (req: Request) => {
  const startedAt = new Date().toISOString();
  let supabase: ReturnType<typeof createClient> | null = null;
  let mode: Mode = "test";

  try {
    if (req.method !== "POST") return jsonResponse({ success: false, error: "Use POST" }, 405);
    requireServiceRole(req);

    const body = await req.json().catch(() => ({})) as RequestBody;

    const rawMode = body.mode;
    if (rawMode === undefined || rawMode === null) {
      mode = "test";
    } else if (rawMode === "test" || rawMode === "sync") {
      mode = rawMode;
    } else {
      return jsonResponse(
        { success: false, error: "Invalid mode. Supported modes are: test, sync" },
        400,
      );
    }

    if (body.page_size !== undefined) {
      if (
        typeof body.page_size !== "number" ||
        !Number.isInteger(body.page_size) ||
        body.page_size < 1 ||
        body.page_size > MAX_PAGE_SIZE
      ) {
        return jsonResponse(
          { success: false, error: "Invalid page_size. Must be an integer between 1 and 500" },
          400,
        );
      }
    }

    if (body.max_pages !== undefined) {
      if (
        typeof body.max_pages !== "number" ||
        !Number.isInteger(body.max_pages) ||
        body.max_pages < 1 ||
        body.max_pages > MAX_PAGES
      ) {
        return jsonResponse(
          { success: false, error: "Invalid max_pages. Must be an integer between 1 and 100" },
          400,
        );
      }
    }

    if (body.full_sync !== undefined && typeof body.full_sync !== "boolean") {
      return jsonResponse(
        { success: false, error: "Invalid full_sync. Must be a boolean" },
        400,
      );
    }

    if (
      body.start_after_id !== undefined &&
      (typeof body.start_after_id !== "number" ||
        !Number.isInteger(body.start_after_id) ||
        body.start_after_id < 0)
    ) {
      return jsonResponse(
        { success: false, error: "Invalid start_after_id. Must be a non-negative integer" },
        400,
      );
    }

    const companyIds = parseCompanyIds(body.company_ids);
    const requestedPageSize = typeof body.page_size === "number"
      ? body.page_size
      : (mode === "test" ? 5 : MAX_PAGE_SIZE);
    const pageSize = mode === "test" ? Math.min(requestedPageSize, 5) : requestedPageSize;
    const maxPages = mode === "test"
      ? 1
      : (typeof body.max_pages === "number" ? body.max_pages : MAX_PAGES);

    const credentials = readOdooCredentials();
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const uid = await authenticateOdoo(credentials);
    const context = { allowed_company_ids: companyIds };

    const accessibleCompanies = await executeKw<Array<{ id: number; name: string }>>(
      credentials,
      uid,
      "res.company",
      "search_read",
      [[[
        "id",
        "in",
        companyIds,
      ]]],
      { fields: ["id", "name"], limit: companyIds.length, order: "id asc", context },
    );
    const inaccessible = companyIds.filter(
      (id) => !accessibleCompanies.some((company) => Number(company.id) === id),
    );
    if (inaccessible.length > 0) {
      throw new Error(`Odoo API user cannot access company IDs: ${inaccessible.join(", ")}`);
    }

    const moveFields = await readableFields(credentials, uid, "stock.move", context);
    const requiredMoveFields = [
      "id",
      "picking_id",
      "company_id",
      "product_id",
      "quantity",
      "write_date",
    ];
    const missingMoveFields = requiredMoveFields.filter((field) => !moveFields.has(field));
    if (missingMoveFields.length > 0) {
      throw new Error(
        `Missing or unreadable Odoo stock.move fields: ${missingMoveFields.join(", ")}`,
      );
    }

    const receiptFields = [...requiredMoveFields];
    if (moveFields.has("price_unit")) receiptFields.push("price_unit");
    const incomingDomainField = moveFields.has("picking_code")
      ? "picking_code"
      : "picking_id.picking_type_id.code";

    const fullSync = body.full_sync === true;
    let lastSeenId = mode === "test"
      ? parseNonNegativeInteger(body.start_after_id, 0)
      : fullSync
      ? 0
      : body.start_after_id !== undefined
      ? parseNonNegativeInteger(body.start_after_id, 0)
      : await currentReceiptCursor(supabase);

    const cursorStart = lastSeenId;
    let fetchedRows = 0;
    let mappedRows = 0;
    let writtenRows = 0;
    let rejectedRows = 0;
    let pages = 0;
    const rejectedLineIds: number[] = [];
    const sample: SupplierReceiptRow[] = [];
    const rejectionReasonCounts: Record<string, number> = {};
    const companyCounts: Record<string, number> = {};
    let minimumReceivedAt: string | null = null;
    let maximumReceivedAt: string | null = null;

    while (pages < maxPages) {
      const domain = [
        ["state", "=", "done"],
        [incomingDomainField, "=", "incoming"],
        ["company_id", "in", companyIds],
        ["quantity", ">", 0],
        ["id", ">", lastSeenId],
      ];
      const moves = await executeKw<OdooMove[]>(
        credentials,
        uid,
        "stock.move",
        "search_read",
        [domain],
        {
          fields: receiptFields,
          limit: pageSize,
          order: "id asc",
          context,
        },
      );
      if (moves.length === 0) break;

      fetchedRows += moves.length;
      pages += 1;
      lastSeenId = Math.max(...moves.map((move) => Number(move.id)));

      const pickingIds = uniquePositiveIds(moves.map((move) => many2OneId(move.picking_id)));
      const productIds = uniquePositiveIds(moves.map((move) => many2OneId(move.product_id)));
      const pickings = await searchReadByIds<OdooPicking>(
        credentials,
        uid,
        "stock.picking",
        pickingIds,
        ["id", "name", "partner_id", "date_done", "company_id"],
        context,
      );
      const products = await searchReadByIds<OdooProduct>(
        credentials,
        uid,
        "product.product",
        productIds,
        ["id", "default_code", "display_name"],
        context,
      );

      const mapped: SupplierReceiptRow[] = [];
      for (const move of moves) {
        const pickingId = many2OneId(move.picking_id);
        const productId = many2OneId(move.product_id);
        const picking = pickingId === null ? undefined : pickings.get(pickingId);
        const product = productId === null ? undefined : products.get(productId);

        try {
          const row = mapOdooReceiptLine({
            ...move,
            picking_id: picking ? [picking.id, picking.name] : move.picking_id,
            company_id: picking?.company_id ?? move.company_id,
            partner_id: picking?.partner_id ?? null,
            date_done: picking?.date_done ?? null,
            product_code: product?.default_code || null,
            product_name: product?.display_name || null,
          });
          mapped.push(row);
          if (sample.length < 5) sample.push(row);

          const compStr = String(row.company_id);
          companyCounts[compStr] = (companyCounts[compStr] || 0) + 1;

          if (!minimumReceivedAt || row.received_at < minimumReceivedAt) {
            minimumReceivedAt = row.received_at;
          }
          if (!maximumReceivedAt || row.received_at > maximumReceivedAt) {
            maximumReceivedAt = row.received_at;
          }
        } catch (error) {
          rejectedRows += 1;
          if (rejectedLineIds.length < 20) rejectedLineIds.push(Number(move.id));
          const reason = error instanceof Error ? error.message : "UNKNOWN_REJECTION";
          rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
        }
      }

      mappedRows += mapped.length;

      if (mode === "sync" && mapped.length > 0) {
        const syncedAt = new Date().toISOString();
        const rows = mapped.map((row) => ({ ...row, synced_at: syncedAt }));
        const { error } = await supabase
          .from("procurement_supplier_receipts")
          .upsert(rows, { onConflict: "odoo_receipt_line_id" });
        if (error) throw new Error(`Supabase receipt upsert failed: ${error.message}`);
        writtenRows += rows.length;
      }

      if (moves.length < pageSize || mode === "test") break;
    }

    if (mode === "sync") {
      const finishedAt = new Date().toISOString();
      await writeSyncLog(supabase, {
        sync_type: SYNC_TYPE,
        status: "success",
        message: JSON.stringify({
          mode,
          fetched_rows: fetchedRows,
          mapped_rows: mappedRows,
          written_rows: writtenRows,
          rejected_rows: rejectedRows,
          cursor: lastSeenId,
        }),
        rows_count: writtenRows,
        started_at: startedAt,
        finished_at: finishedAt,
      });
    }

    return jsonResponse({
      success: true,
      mode,
      database: credentials.database,
      company_ids: companyIds,
      pages,
      fetched_rows: fetchedRows,
      accepted_rows: mappedRows,
      rejected_rows: rejectedRows,
      inserted_or_updated_rows: mode === "sync" ? writtenRows : 0,
      write_performed: mode === "sync",
      cursor_start: cursorStart,
      cursor_end: lastSeenId,
      rejection_reason_counts: rejectionReasonCounts,
      company_counts: companyCounts,
      minimum_received_at: minimumReceivedAt,
      maximum_received_at: maximumReceivedAt,
      rejected_line_ids: rejectedLineIds,
      mapped_rows: mappedRows,
      written_rows: mode === "sync" ? writtenRows : 0,
      cursor: lastSeenId,
      has_more: mode === "sync" && pages === maxPages,
      sample,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "sync" && supabase) {
      await writeSyncLog(supabase, {
        sync_type: SYNC_TYPE,
        status: "error",
        message,
        rows_count: 0,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }
    const status = message === "SERVICE_ROLE_REQUIRED"
      ? 403
      : message.includes("Invalid mode")
      ? 400
      : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});
