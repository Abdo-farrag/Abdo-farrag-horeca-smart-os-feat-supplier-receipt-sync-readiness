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
import {
  type Many2One,
  mapOdooPartnerDirectoryRecord,
  mapOdooProductPurchaseMetadata,
  mapOdooSupplierReference,
  mapOdooVendorPrice,
  type OdooProductPurchaseReference,
  type OdooSupplierReference,
  type ProductPurchaseMetadataRow,
  type ProductVendorPriceRow,
  type SupplierDirectoryRow,
} from "../_shared/purchase-reference-mapper.ts";
import {
  parsePurchaseReferenceSyncInput,
  type PurchaseReferenceMode,
  type PurchaseReferenceRequestBody,
  purchaseReferenceWriteAllowed,
} from "../_shared/purchase-reference-input.ts";

type OdooProductRow =
  & Omit<
    OdooProductPurchaseReference,
    "official_brand" | "purchase_uom" | "order_multiple"
  >
  & Record<string, unknown>;

type OdooSupplierInfo = {
  id: number;
  partner_id: Many2One;
  product_id: Many2One;
  product_tmpl_id: Many2One;
  min_qty: number | string | null;
  price: number | string | null;
  currency_id: Many2One;
  delay: number | string | null;
  sequence: number | string | null;
  write_date: string | null;
};

const SYNC_TYPE = "odoo_purchase_reference";
const MAX_PAGE_SIZE = 500;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  return Array.isArray(value) && Number.isSafeInteger(Number(value[0])) && Number(value[0]) > 0
    ? Number(value[0])
    : null;
}

async function writeSyncLog(
  supabase: ReturnType<typeof createClient>,
  values: JsonRecord,
): Promise<void> {
  const { error } = await supabase.from("sync_logs").insert(values);
  if (error) console.error("Could not write purchase reference sync log", error.message);
}

Deno.serve(async (req: Request) => {
  const startedAt = new Date().toISOString();
  let mode: PurchaseReferenceMode = "test";
  let supabase: ReturnType<typeof createClient> | null = null;

  try {
    if (req.method !== "POST") return jsonResponse({ success: false, error: "Use POST" }, 405);
    requireServiceRole(req);
    const body = await req.json().catch(() => ({})) as PurchaseReferenceRequestBody;
    const input = parsePurchaseReferenceSyncInput(body);
    mode = input.mode;
    const { pageSize, maxPages } = input;
    let { partnerCursor, productCursor } = input;
    const partnerCursorStart = partnerCursor;
    const productCursorStart = productCursor;

    const credentials = readOdooCredentials();
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const uid = await authenticateOdoo(credentials);
    const context: JsonRecord = { active_test: false };
    const partnerFields = await readableFields(credentials, uid, "res.partner", context);
    const requiredPartnerFields = ["id", "name", "active", "supplier_rank", "write_date"];
    const missingPartnerFields = requiredPartnerFields.filter((field) => !partnerFields.has(field));
    if (missingPartnerFields.length > 0) {
      throw new Error(`Missing Odoo supplier fields: ${missingPartnerFields.join(", ")}`);
    }
    const selectedPartnerFields = [...requiredPartnerFields];
    if (partnerFields.has("ref")) selectedPartnerFields.push("ref");
    const { data: knownSupplierRows, error: knownSupplierError } = await supabase
      .from("procurement_supplier_directory")
      .select("odoo_supplier_id")
      .limit(10000);
    if (knownSupplierError) {
      throw new Error(`Supplier directory read failed: ${knownSupplierError.message}`);
    }
    const knownSupplierIds = (knownSupplierRows ?? []).map((row) => Number(row.odoo_supplier_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);

    const productFields = await readableFields(credentials, uid, "product.product", context);
    const requiredProductFields = ["id", "default_code", "product_tmpl_id", "write_date"];
    const missingProductFields = requiredProductFields.filter((field) => !productFields.has(field));
    if (missingProductFields.length > 0) {
      throw new Error(`Missing Odoo product fields: ${missingProductFields.join(", ")}`);
    }
    const brandField = ["product_brand_id", "brand_id"].find((field) => productFields.has(field));
    const purchaseUomField = ["uom_po_id", "purchase_uom_id"].find((field) =>
      productFields.has(field)
    );
    const orderMultipleField = ["order_multiple", "purchase_multiple_qty", "qty_multiple"].find(
      (field) => productFields.has(field),
    );
    const selectedProductFields = [
      ...requiredProductFields,
      ...(brandField ? [brandField] : []),
      ...(purchaseUomField ? [purchaseUomField] : []),
      ...(orderMultipleField ? [orderMultipleField] : []),
    ];

    let supplierPages = 0;
    let productPages = 0;
    let suppliersFetched = 0;
    let suppliersAccepted = 0;
    let productsFetched = 0;
    let productsAccepted = 0;
    let vendorPricesAccepted = 0;
    let writtenRows = 0;
    const supplierSample: SupplierDirectoryRow[] = [];
    const productSample: ProductPurchaseMetadataRow[] = [];

    while (supplierPages < maxPages) {
      const partnerDomain: unknown[] = knownSupplierIds.length > 0
        ? [
          "|",
          ["supplier_rank", ">", 0],
          ["id", "in", knownSupplierIds],
          ["id", ">", partnerCursor],
        ]
        : [
          ["supplier_rank", ">", 0],
          ["id", ">", partnerCursor],
        ];
      const partners = await executeKw<OdooSupplierReference[]>(
        credentials,
        uid,
        "res.partner",
        "search_read",
        [partnerDomain],
        {
          fields: selectedPartnerFields,
          limit: pageSize,
          order: "id asc",
          context,
        },
      );
      if (partners.length === 0) break;
      supplierPages += 1;
      suppliersFetched += partners.length;
      partnerCursor = Math.max(...partners.map((partner) => Number(partner.id)));
      const directoryRows = partners.map(mapOdooPartnerDirectoryRecord);
      const eligibleRows = partners.map(mapOdooSupplierReference).filter(
        (row): row is SupplierDirectoryRow => row !== null,
      );
      suppliersAccepted += eligibleRows.length;
      for (const row of eligibleRows) {
        if (supplierSample.length < 5) supplierSample.push(row);
      }

      if (purchaseReferenceWriteAllowed(mode) && directoryRows.length > 0) {
        const syncedAt = new Date().toISOString();
        const { error } = await supabase.from("procurement_supplier_directory").upsert(
          directoryRows.map((row) => ({ ...row, synced_at: syncedAt, updated_at: syncedAt })),
          { onConflict: "odoo_supplier_id" },
        );
        if (error) throw new Error(`Supplier directory upsert failed: ${error.message}`);
        writtenRows += directoryRows.length;
      }
      if (partners.length < pageSize || mode === "test") break;
    }

    while (productPages < maxPages) {
      const products = await executeKw<OdooProductRow[]>(
        credentials,
        uid,
        "product.product",
        "search_read",
        [[
          ["default_code", "!=", false],
          ["id", ">", productCursor],
        ]],
        {
          fields: selectedProductFields,
          limit: pageSize,
          order: "id asc",
          context,
        },
      );
      if (products.length === 0) break;
      productPages += 1;
      productsFetched += products.length;
      productCursor = Math.max(...products.map((product) => Number(product.id)));

      const normalizedProducts = products.map((product) => ({
        id: product.id,
        default_code: product.default_code,
        product_tmpl_id: product.product_tmpl_id,
        official_brand: brandField ? product[brandField] as Many2One : null,
        purchase_uom: purchaseUomField ? product[purchaseUomField] as Many2One : null,
        order_multiple: orderMultipleField
          ? product[orderMultipleField] as number | string | null
          : null,
        write_date: product.write_date,
      }));
      const productRows = normalizedProducts.map(mapOdooProductPurchaseMetadata).filter(
        (row): row is ProductPurchaseMetadataRow => row !== null,
      );
      productsAccepted += productRows.length;
      for (const row of productRows) if (productSample.length < 5) productSample.push(row);

      const productCodeById = new Map(
        productRows.map((row) => [row.odoo_product_id, row.product_code]),
      );
      const productCodesByTemplate = new Map<number, string[]>();
      for (const row of productRows) {
        if (row.odoo_product_tmpl_id === null) continue;
        const codes = productCodesByTemplate.get(row.odoo_product_tmpl_id) ?? [];
        codes.push(row.product_code);
        productCodesByTemplate.set(row.odoo_product_tmpl_id, codes);
      }

      const templateIds = [...productCodesByTemplate.keys()];
      let vendorRows: ProductVendorPriceRow[] = [];
      if (templateIds.length > 0) {
        const supplierInfoFields = await readableFields(
          credentials,
          uid,
          "product.supplierinfo",
          context,
        );
        const requiredSupplierInfoFields = [
          "id",
          "partner_id",
          "product_id",
          "product_tmpl_id",
          "min_qty",
          "price",
          "currency_id",
          "delay",
          "sequence",
          "write_date",
        ];
        if (requiredSupplierInfoFields.every((field) => supplierInfoFields.has(field))) {
          const sellerRows: OdooSupplierInfo[] = [];
          let sellerOffset = 0;
          while (true) {
            const sellerPage = await executeKw<OdooSupplierInfo[]>(
              credentials,
              uid,
              "product.supplierinfo",
              "search_read",
              [[
                ["product_tmpl_id", "in", templateIds],
              ]],
              {
                fields: requiredSupplierInfoFields,
                limit: MAX_PAGE_SIZE,
                offset: sellerOffset,
                order: "sequence asc,id asc",
                context,
              },
            );
            sellerRows.push(...sellerPage);
            if (sellerPage.length < MAX_PAGE_SIZE) break;
            sellerOffset += sellerPage.length;
          }
          vendorRows = sellerRows.flatMap((seller) => {
            const exactProductId = many2OneId(seller.product_id);
            const templateId = many2OneId(seller.product_tmpl_id);
            const productCode = exactProductId === null
              ? (templateId !== null && productCodesByTemplate.get(templateId)?.length === 1
                ? productCodesByTemplate.get(templateId)?.[0]
                : undefined)
              : productCodeById.get(exactProductId);
            if (!productCode) return [];
            return [mapOdooVendorPrice({
              product_code: productCode,
              supplier: seller.partner_id,
              minimum_qty: seller.min_qty,
              price: seller.price,
              currency: seller.currency_id,
              delay_days: seller.delay,
              sequence: seller.sequence,
              write_date: seller.write_date,
            })];
          });
          vendorPricesAccepted += vendorRows.length;
        }
      }

      if (purchaseReferenceWriteAllowed(mode) && productRows.length > 0) {
        const syncedAt = new Date().toISOString();
        const { error: productError } = await supabase
          .from("procurement_product_purchase_metadata")
          .upsert(
            productRows.map((row) => ({ ...row, synced_at: syncedAt, updated_at: syncedAt })),
            { onConflict: "product_code" },
          );
        if (productError) {
          throw new Error(`Product metadata upsert failed: ${productError.message}`);
        }
        writtenRows += productRows.length;

        if (vendorRows.length > 0) {
          const { error: vendorError } = await supabase
            .from("procurement_product_vendor_prices")
            .upsert(
              vendorRows.map((row) => ({ ...row, synced_at: syncedAt, updated_at: syncedAt })),
              { onConflict: "product_code,supplier_id,minimum_qty" },
            );
          if (vendorError) throw new Error(`Vendor price upsert failed: ${vendorError.message}`);
          writtenRows += vendorRows.length;
        }
      }

      if (products.length < pageSize || mode === "test") break;
    }

    if (purchaseReferenceWriteAllowed(mode)) {
      await writeSyncLog(supabase, {
        sync_type: SYNC_TYPE,
        status: "success",
        rows_count: writtenRows,
        message: JSON.stringify({
          suppliers_fetched: suppliersFetched,
          suppliers_accepted: suppliersAccepted,
          products_fetched: productsFetched,
          products_accepted: productsAccepted,
          vendor_prices_accepted: vendorPricesAccepted,
        }),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }

    return jsonResponse({
      success: true,
      mode,
      database: credentials.database,
      supplier_pages: supplierPages,
      product_pages: productPages,
      suppliers_fetched: suppliersFetched,
      suppliers_accepted: suppliersAccepted,
      products_fetched: productsFetched,
      products_accepted: productsAccepted,
      vendor_prices_accepted: vendorPricesAccepted,
      inserted_or_updated_rows: purchaseReferenceWriteAllowed(mode) ? writtenRows : 0,
      write_performed: purchaseReferenceWriteAllowed(mode),
      partner_cursor_start: partnerCursorStart,
      partner_cursor_end: partnerCursor,
      product_cursor_start: productCursorStart,
      product_cursor_end: productCursor,
      supplier_sample: supplierSample,
      product_sample: productSample,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (purchaseReferenceWriteAllowed(mode) && supabase) {
      await writeSyncLog(supabase, {
        sync_type: SYNC_TYPE,
        status: "error",
        rows_count: 0,
        message,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
    }
    const status = message === "SERVICE_ROLE_REQUIRED"
      ? 403
      : message.startsWith("Invalid ")
      ? 400
      : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
});
