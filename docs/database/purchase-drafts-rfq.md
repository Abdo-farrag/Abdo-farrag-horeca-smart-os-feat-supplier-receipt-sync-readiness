# Purchase Drafts and Manual Odoo RFQ Handoff

This feature turns approved purchasing recommendations into an auditable draft for
manual entry as an Odoo Request for Quotation (RFQ). Version 1 is deliberately
read-only toward Odoo: it exports Excel and never calls `create`, `write`,
`unlink`, or a confirmation action.

## Recommendation fields and sources

| Displayed field | Canonical source | Rule |
| --- | --- | --- |
| Company | `api_procurement_company_source` | MAS is `company_id=1`; Horeca Smart is `company_id=2`. |
| Product code/name | `api_procurement_company_source` | Odoo-aligned product reference and name. |
| Free quantity | procurement source | On-hand quantity after reservations/commitments. It can be negative. |
| Effective daily demand | procurement recommendation source | Daily demand used by the recommendation function. |
| Coverage days | recommendation calculation | `free_qty / effective_daily_demand` when demand is positive. Negative coverage is valid over-commitment. |
| Target coverage | review projection | Currently 14 days. |
| Suggested quantity | `procurement_calculate_recommendation` | Quantity required to reach target coverage after lead time and safety stock rules, then product recommendation rounding. |
| Official brand | `procurement_product_purchase_metadata` | Read from an official readable Odoo brand relation; otherwise null and shown as `براند غير محدد`. |
| Proposed supplier | canonical supplier projection | Buyer decision, verified external receipt, SKU fallback, then global review. Draft overrides never update this field. |
| Purchase UoM/order multiple | Odoo purchasing reference sync | Used only when a readable trusted Odoo field is available. |
| Vendor price/MOQ | Odoo `product.supplierinfo` reference rows | Kept per product, supplier, and minimum quantity tier. |

## Quantity copied into a draft

When a buyer creates a draft, every selected line starts from the current
`suggested_qty`. The database verifies the recommendation version and then applies:

1. `max(suggested_qty, supplier_MOQ)` when an MOQ exists.
2. Round upward to the nearest `order_multiple` when it exists.
3. If neither trusted MOQ nor order multiple exists, keep the suggested quantity
   unchanged and add `PACKAGING_REVIEW_REQUIRED`.

Example: suggested quantity 23 and order multiple 6 becomes approved quantity 24.
The buyer can edit the quantity later while the draft is in `DRAFT`; the same
round-up rule is applied again by the database.

## Supplier and price rules

- Supplier search returns only synchronized Odoo partners that are active and have
  `supplier_rank > 0`. Customer-only partners do not appear.
- Every draft has exactly one company and one supplier.
- Changing a supplier changes that draft only. It does not update SKU supplier
  settings or the canonical recommendation.
- Price choice is deterministic:
  1. matching Odoo vendor-price tier for the selected supplier;
  2. latest verified receipt from the same supplier and company;
  3. latest other-supplier receipt as an explicitly labelled reference;
  4. missing price.
- Manual price edits are stored as `MANUAL_CONFIRMED`.

## Warnings

| Code | Buyer action |
| --- | --- |
| `PACKAGING_REVIEW_REQUIRED` | Check Odoo purchase UoM, pack size, MOQ, and multiple before creating the RFQ. |
| `MISSING_PRICE` | Obtain and enter the selected supplier price. |
| `OTHER_SUPPLIER_PRICE` | Treat the value as a reference only; it came from another supplier. |
| `BRAND_UNDEFINED` | The official Odoo brand field was unavailable or empty. |

## Draft lifecycle

`DRAFT → READY_FOR_EXPORT → EXPORTED → CLOSED`

`CANCELLED` is allowed only from `DRAFT` or `READY_FOR_EXPORT`. Every mutation
uses optimistic versions and writes a sanitized procurement audit event. Product,
supplier, quantity, price-source, UoM, brand, and warning snapshots are frozen in
the draft so later reference syncs cannot silently rewrite an old purchasing decision.

## Manual Odoo RFQ handoff

1. Filter recommendations by company, official/undefined brand, and proposed supplier.
2. Select rows from one company only.
3. Choose one active Odoo supplier by name or code and create the draft.
4. Review approved quantities, UoM, price provenance, and warnings.
5. Resolve missing or reference-only data and mark the draft `READY_FOR_EXPORT`.
6. Download the workbook. The `RFQ` sheet contains the frozen lines and the
   `Warnings` sheet contains required checks.
7. In Odoo Purchasing, create a new RFQ manually for the same company and supplier.
8. Copy product, purchase UoM, quantity, price, and expected receipt date from Excel.
9. Recheck packaging/MOQ and warning rows in Odoo before saving.
10. Save the Odoo RFQ, then record its RFQ name and optional Odoo ID in the dashboard.

Downloading a ready workbook marks the dashboard draft `EXPORTED` only after the
XLSX has been built successfully. It does not prove that Odoo accepted an RFQ;
recording the manual Odoo reference provides that operational link.

## Purchase reference sync

Endpoint: `sync-odoo18-purchase-reference`

Safe test payload (default if mode is omitted or null):

```json
{"mode":"test","page_size":5,"max_pages":1}
```

Controlled sync payload:

```json
{"mode":"sync","page_size":200,"max_pages":10}
```

Only exact `test` and `sync` values are accepted. Test mode caps work and performs
zero Supabase mutations and zero sync-log inserts. Sync mode reads Odoo partners,
products, and supplier-info only, then upserts service-role-only reference tables.
It never writes to Odoo. Secrets belong only in the runtime secret store and must
never be placed in payloads, logs, migrations, source files, or browser code.

## Security and rollout

Reference and draft tables/views/RPCs are unavailable directly to PUBLIC, `anon`,
and `authenticated`. The Fastify backend uses the service role after the existing
overview session gate. Mutation RPCs are `SECURITY DEFINER` with fixed
`search_path = public, pg_temp`.

Applying the migrations, deploying the Edge Function, running sync mode, or
contacting live Odoo are separate rollout actions and require explicit approval.
