# Procurement V1 Database Contract

- **Status:** implementation candidate; validated only on an isolated local Supabase database until explicitly approved for deployment.
- **Production project:** `afzxhuaeggrngvchbvur`.
- **PostgreSQL compatibility target:** 17.x; production reported 17.6 on 2026-07-24.
- **Migration:** `supabase/migrations/20260724090000_procurement_v1_core.sql`.

## Safety boundary

This migration is additive. It does not rename, drop, truncate, update, or change privileges on any existing production table, view, function, Edge Function, cron job, or data row.

It creates five application-owned tables and one helper function. The existing procurement engine remains the source of sales, stock, demand, and forecast data until later API-layer migrations join it to these tables.

The migration must pass `supabase test db` against a fresh PostgreSQL 17 local database before it can be proposed for a Supabase development branch. Merging this GitHub change does not deploy it to production.

## Identity conventions

- Products are identified by the stable Odoo `product_code` text used across Odoo 17 and Odoo 18.
- Company IDs remain:
  - `1`: MAS.
  - `2`: Horeca Smart.
- Product rules and supplier review decisions are global per product and apply to both companies.
- Receipt history remains company-specific because each actual receipt belongs to one company.
- Audit event IDs use PostgreSQL `bigint` identity values. This intentionally matches the shared TypeScript contract and avoids a UUID/number mismatch at the API boundary.

## Application tables

### `public.app_user_roles`

Purpose: application authorization layered on top of Supabase Auth.

Key rules:

- `user_id` references `auth.users(id)` and is the primary key.
- Roles are exactly `reviewer` or `admin`.
- An Auth user without an active row receives no application authorization.
- `version` starts at `1` and will be used for optimistic concurrency.
- Disabling a user does not delete the Auth account.

### `public.procurement_product_rules`

Purpose: global Procurement V1 overrides by product.

Key rules:

- Primary key: `product_code`.
- Default Lead Time: `4` days; allowed range `0–90`.
- Default Safety Stock: `7` days; allowed range `0–60`.
- `order_multiple` is positive and defaults to `1`.
- The table does not overwrite `product_procurement_settings`, raw Odoo data, or existing recommendation views.

### `public.procurement_supplier_receipts`

Purpose: authoritative history of completed incoming receipt lines used to determine the proposed supplier.

Key rules:

- `odoo_receipt_line_id` is unique, making synchronization idempotent.
- Only company IDs `1` and `2` are allowed.
- `received_qty` must be positive.
- A row represents completed stock received from a supplier, never a draft purchase order, invoice-only record, or unreceived PO line.
- Latest-supplier ordering is supported by the index:
  1. `received_at DESC`.
  2. `received_qty DESC`.
  3. `supplier_id ASC`.

### `public.procurement_supplier_reviews`

Purpose: one current supplier-review state per product.

Statuses:

- `PENDING_REVIEW`.
- `APPROVED`.
- `REJECTED`.
- `NEEDS_SUPPLIER`.

Key rules:

- Primary key: `product_code`.
- Approved supplier ID and name must both be present only when status is `APPROVED`.
- Non-approved states retain no approved supplier value.
- `version` starts at `0` for optimistic concurrency.
- Review history is stored in the immutable audit table, not by adding mutable history columns here.

### `public.procurement_audit_events`

Purpose: append-only business and security audit trail.

Key rules:

- Identity primary key: `bigint`.
- Supported events and modules are constrained to the shared API contract.
- `old_data` and `new_data` retain before/after JSON values.
- `batch_id` groups bulk operations.
- `undo_of` points to the original event.
- A unique partial index prevents more than one undo event from targeting the same original event.
- Later transactional RPCs must write the business mutation and audit event in one transaction.
- Database privileges allow `service_role` to select and insert audit rows, but explicitly deny update and delete.
- Undo creates a new audit event and never edits the original row.

## Helper function

### `public.procurement_actor_role(uuid)`

Returns the active application role for a Supabase Auth user, or `NULL` when the user is missing or disabled.

The function is `SECURITY DEFINER`, has a fixed search path, and is executable only by `service_role`. It does not expose user data to `anon` or `authenticated` browser roles.

## Access model

All five tables have Row Level Security enabled.

No browser-readable RLS policies are created. Privileges are explicitly revoked from:

- `PUBLIC`.
- `anon`.
- `authenticated`.

The backend service role receives only the table and sequence privileges needed for later repository and RPC work. For the audit table, those privileges are restricted to `SELECT` and `INSERT`. The browser remains unable to query these application tables directly.

This migration deliberately does not modify the six pre-existing legacy/staging tables that currently have RLS disabled. Their remediation remains a separate production deployment gate because enabling RLS without tested policies could interrupt existing synchronization or import jobs.

## Testing

`supabase/tests/procurement_v1_core.sql` verifies:

- all required tables and the helper function exist;
- product rules and supplier reviews use `product_code` primary keys;
- Odoo receipt line IDs are unique;
- all application tables have RLS enabled;
- `anon` and `authenticated` cannot read the tables;
- `service_role` can write operational tables and append audit events;
- `service_role` cannot update or delete audit events;
- audit IDs match the numeric API contract;
- default Lead Time, Safety Stock, and version values;
- supplier reviews start in `PENDING_REVIEW`;
- no browser RLS policies exist;
- unknown users receive no role.

CI uses Supabase CLI `2.101.0` and a fresh PostgreSQL 17 database. It does not link to the production project.

## Future migrations

Later tasks may only consume this contract through additional version-controlled migrations:

1. Supplier receipt synchronization metadata and Edge Function support.
2. Stable `api_*` views.
3. Transactional `rpc_*` functions for supplier decisions, rule updates, audit queries, and undo.

Raw tables and current forecast views must remain behind the stable API boundary.
