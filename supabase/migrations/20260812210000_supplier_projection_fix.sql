begin;

-- ── Supplier projection fix for api_company_purchase_review ──────────────────
--
-- Problem
-- -------
-- The FALLBACK_NEEDS_REVIEW / NEEDS_SUPPLIER classification ignored
-- sku_supplier_settings.primary_supplier. Products that have a known primary
-- supplier configured in SKU settings but no verified external receipt were
-- classified as NEEDS_SUPPLIER, inflating the "no supplier" count shown on the
-- company-review page relative to the overview dashboard.
--
-- Root cause of join failure
-- --------------------------
-- sku_supplier_settings.product_id (range 795–7981) is the Odoo product.product
-- ID from the raw-product catalogue sync, NOT the procurement product_id used
-- in api_procurement_company_source (range 8012+). The two ID spaces are
-- disjoint so a direct join on product_id produces zero matches.
--
-- Solution
-- --------
-- Bridge via raw_products:
--   api_procurement_company_source.product_code  ← string like "108212"
--       = raw_products.internal_reference        ← Odoo internal ref, same string
--   raw_products.product_id                      ← 795–7981 catalogue ID
--       = sku_supplier_settings.product_id
--
-- Changes
-- -------
-- 1. Add LEFT JOIN raw_products rp ON rp.internal_reference = s.product_code.
-- 2. Add LEFT JOIN sku_supplier_settings sss ON sss.product_id = rp.product_id
--    AND sss.primary_supplier IS NOT NULL.
-- 3. Include sss.primary_supplier in the supplier_name COALESCE chain
--    (between verified receipt and global supplier review).
-- 4. Include sss.primary_supplier IS NOT NULL in the FALLBACK_NEEDS_REVIEW
--    branch of the supplier_readiness CASE expression.
-- 5. Do NOT add sss.primary_supplier as a supplier_id source — supplier_id is
--    an integer FK; sku_supplier_settings only stores a display name.
-- 6. ready_for_po still requires a non-null supplier_id — unchanged.
--
-- Predicted impact (verified against live data 2026-08-12)
-- ----------------------------------------------------------
--   VERIFIED_RECEIPT    :   227 (unchanged)
--   FALLBACK_NEEDS_REVIEW: 1103 (was 0  — +1103 from NEEDS_SUPPLIER)
--   NEEDS_SUPPLIER      :   180 (was 1283 — −1103 products gain fallback supplier)
--   Total               :  1510

-- ── Permissions ──────────────────────────────────────────────────────────────
-- Explicit revoke-then-grant so the security model is stated once and is
-- verifiable by the pgTAP permission matrix in supplier_projection_fix.sql.
-- On live Supabase, raw_products and sku_supplier_settings have no pre-existing
-- grants to anon/authenticated; the REVOKEs here are idempotent safeguards.

revoke all on table public.raw_products          from public, anon, authenticated;
revoke all on table public.sku_supplier_settings  from public, anon, authenticated;
revoke all on table public.api_company_purchase_review from public, anon, authenticated;

grant select on table public.raw_products          to service_role;
grant select on table public.sku_supplier_settings  to service_role;

-- ── Replace the view ─────────────────────────────────────────────────────────
create or replace view public.api_company_purchase_review
with (security_invoker = true)
as
with latest_external_receipts as (
  -- Most recent positive external receipt per (company_id, product_code).
  -- Intercompany receipts (MAS ↔ Horeca Smart) are excluded by both
  -- supplier_id and a name-based guard to survive partial data issues.
  select distinct on (r.company_id, r.product_code)
    r.company_id,
    r.product_code,
    r.supplier_id,
    r.supplier_name,
    r.received_at,
    r.unit_cost
  from public.procurement_supplier_receipts r
  where r.received_qty > 0
    and r.supplier_id not in (1, 2)
    and upper(btrim(r.supplier_name)) not in ('MAS', 'HORECA SMART', 'HORECA', 'HORECA SMART OS')
  order by
    r.company_id,
    r.product_code,
    r.received_at desc,
    r.received_qty desc,
    r.id desc
)
select
  s.company_id,
  s.company_name,
  s.product_code,
  s.product_name,
  c.priority,
  s.free_qty,
  s.effective_daily_demand,
  c.actual_coverage_days                            as coverage_days,
  14::numeric                                       as target_coverage_days,
  c.suggested_qty,
  r.approved_qty,

  -- supplier_id: real integer FKs only — never invent one from sku_supplier_settings.
  -- Priority: buyer decision → verified receipt → global supplier review.
  coalesce(
    r.approved_supplier_id,
    er.supplier_id,
    sr.approved_supplier_id
  )                                                 as supplier_id,

  -- supplier_name: include sss.primary_supplier as the canonical fallback
  -- between the verified receipt name and the global review name.
  coalesce(
    r.approved_supplier_name,
    er.supplier_name,
    sss.primary_supplier,
    sr.approved_supplier_name
  )                                                 as supplier_name,

  -- supplier_readiness classification (business rules):
  --   VERIFIED_RECEIPT    — at least one positive external receipt exists.
  --   FALLBACK_NEEDS_REVIEW — no receipt, but a supplier is known via the
  --                           buyer's decision, sku_supplier_settings, or the
  --                           global supplier review. Order-from required.
  --   NEEDS_SUPPLIER      — no supplier known from any source; must be
  --                         assigned before a PO can be raised.
  case
    when er.supplier_id    is not null
      then 'VERIFIED_RECEIPT'
    when r.approved_supplier_id  is not null
      or  sss.primary_supplier   is not null
      or  sr.approved_supplier_id is not null
      then 'FALLBACK_NEEDS_REVIEW'
    else 'NEEDS_SUPPLIER'
  end                                               as supplier_readiness,

  er.received_at                                    as latest_receipt_at,
  er.unit_cost                                      as latest_unit_cost,

  case
    when er.unit_cost is not null
      then round(coalesce(r.approved_qty, c.suggested_qty, 0) * er.unit_cost, 2)
    else null
  end                                               as estimated_value,

  coalesce(r.decision_status, 'NEW')                as decision_status,
  r.buyer_note,
  coalesce(r.version, 0)                            as version,
  r.updated_at::text                                as source_updated_at,

  -- ready_for_po still requires a real supplier_id (no invented IDs).
  (
    coalesce(r.decision_status, 'NEW') = 'APPROVED'
    and coalesce(r.approved_qty, 0) > 0
    and coalesce(r.approved_supplier_id, er.supplier_id, sr.approved_supplier_id) is not null
  )                                                 as ready_for_po

from public.api_procurement_company_source s

cross join lateral public.procurement_calculate_recommendation(
  s.effective_daily_demand,
  s.free_qty,
  14,
  s.lead_time_days,
  s.safety_stock_days,
  s.order_multiple,
  s.data_status
) c

-- Buyer's per-company purchase decision (absent until a buyer acts).
left join public.procurement_company_purchase_reviews r
  on  r.company_id   = s.company_id
  and r.product_code = s.product_code

-- Latest verified external receipt, per company+product.
left join latest_external_receipts er
  on  er.company_id   = s.company_id
  and er.product_code = s.product_code

-- Bridge from procurement product_code to the raw catalogue product_id.
-- raw_products.internal_reference stores the Odoo internal reference (same
-- string as product_code). Each internal_reference maps to exactly one
-- product_id in the raw catalogue.
left join public.raw_products rp
  on  rp.internal_reference = s.product_code

-- Product-level SKU supplier settings, joined through the raw catalogue bridge.
-- primary_supplier is a display name only (no integer supplier_id is stored).
left join public.sku_supplier_settings sss
  on  sss.product_id       = rp.product_id
  and sss.primary_supplier is not null

-- Global cross-company supplier review (approved name+id pair).
left join public.procurement_supplier_reviews sr
  on  sr.product_code = s.product_code;

-- Re-grant SELECT (idempotent — view was already granted in original migration).
grant select on public.api_company_purchase_review to service_role;

commit;
