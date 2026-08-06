# Live Supabase Audit — Procurement V1

- **Date:** 2026-07-24
- **Project:** `afzxhuaeggrngvchbvur`
- **Mode:** Read-only catalog audit
- **Purpose:** Lock the implementation plan to the database that actually exists before writing application code.

## 1. Existing procurement data sources

The current database already contains the core sales, stock, forecast, settings, and sync sources needed for Procurement V1:

- `odoo_product_forecast_by_company` — product stock snapshot by company.
- `v_product_demand_forecast_joined` — joins company stock to demand windows.
- `v_procurement_current_position_unified` — current demand, cover, trend, and status per company/product.
- `v_procurement_recommendation_configurable` — existing configurable recommendation logic.
- `v_procurement_overview_summary` — existing company/all-company summary.
- `v_procurement_sync_status_latest` — latest sales and forecast sync status.
- `product_procurement_settings` — existing settings per company and product code.
- `product_procurement_settings_history` — existing settings history table.
- `sync_logs` — synchronization history.
- `v_unified_sales_lines`, `v_product_sales_daily_unified`, and `v_product_demand_windows` — unified sales history and demand windows.

The application API will reuse these sources but will not expose them directly to the browser.

## 2. Important schema differences from the approved product design

### 2.1 Stock naming

The approved UI calls the usable stock `free_qty`. The live database exposes the corresponding company-level value as `available_quantity` in `odoo_product_forecast_by_company` and downstream views.

The stable API layer will alias `available_quantity` to `free_qty`.

### 2.2 Existing recommendation formula

The existing `v_procurement_recommendation_configurable` calculates recommendations from configured target coverage and `forecasted_quantity`. The approved V1 design requires the explicit formula:

```text
forecast demand for selected coverage
+ lead-time demand
+ safety-stock demand
- free_qty
```

Therefore the new `api_*` layer must calculate the approved formula and must not expose the existing `configured_suggested_qty_*` as the final application recommendation.

### 2.3 Product settings scope

The existing `product_procurement_settings` table is per company and product code. The approved UI treats Lead Time, Safety Stock Days, order multiple, and supplier review as one product-level decision shared by MAS and Horeca Smart.

The implementation will preserve the existing table and add a non-destructive product-level rules table for the new application contract.

### 2.4 Supplier receipt history is missing

No live table or view currently stores the actual Odoo supplier receipt history required to select:

> the last supplier that physically delivered the product.

The implementation therefore needs a new normalized receipt table and a dedicated Odoo 18 receipt sync before Supplier Review can be considered complete. Existing text fields such as `primary_supplier` are not sufficient evidence of an actual receipt and will not be treated as the final recommendation source.

## 3. Existing Edge Functions

The project currently contains active functions for:

- `sync-odoo18-product-forecast`
- `sync-odoo18-sales-phase1`
- `test-odoo18-forecast-connection`
- `temporary-import-odoo17-daily`

There is no supplier-receipt sync function. Procurement V1 will add one using the same `sync_logs` monitoring pattern.

## 4. Security finding requiring explicit approval

Row Level Security is currently disabled on six public tables:

- `current_stock_by_warehouse`
- `product_sales_from_june1`
- `manual_current_stock_staging`
- `manual_current_stock_backup_20260715`
- `manual_current_stock_backup_20260715_upload`
- `stock_upload_payload_staging`

This means Supabase client roles can potentially access those tables directly. Procurement V1 will not query them from the browser, but the exposure still exists independently of the new application.

Proposed hardening SQL, to be applied only after policy review and explicit approval:

```sql
alter table public.current_stock_by_warehouse enable row level security;
alter table public.product_sales_from_june1 enable row level security;
alter table public.manual_current_stock_staging enable row level security;
alter table public.manual_current_stock_backup_20260715 enable row level security;
alter table public.manual_current_stock_backup_20260715_upload enable row level security;
alter table public.stock_upload_payload_staging enable row level security;
```

Enabling RLS without policies can block legitimate integrations. The implementation plan treats this as a deployment gate rather than applying it automatically.

## 5. Non-destructive implementation rule

Procurement V1 will:

- keep all existing raw tables, views, sync functions, and historical data;
- add migrations through version-controlled SQL;
- create stable `api_*` views and transactional `rpc_*` functions;
- keep the Supabase service role on the server only;
- avoid direct browser access to internal tables;
- test migrations against a Supabase development branch or isolated test database before production.
