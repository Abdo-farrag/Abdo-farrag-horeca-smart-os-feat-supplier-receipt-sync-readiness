# Odoo 18 Supplier Receipt Synchronization

- **Status:** implementation candidate; source-controlled and CI-tested only.
- **Edge Function:** `sync-odoo18-supplier-receipts`.
- **Destination:** `public.procurement_supplier_receipts`.
- **Sync log type:** `supplier_receipts_by_company`.
- **Production deployment:** not performed by merging this document or its branch.

## Business definition

The proposed supplier for a product is derived from the last supplier that completed an actual incoming stock receipt. The synchronization therefore reads completed stock movements, not purchase quotations, draft purchase orders, invoices without receipts, or expected incoming quantities.

A source row is accepted only when all of the following are true:

- Odoo model is `stock.move`.
- `state = done`.
- the picking type is `incoming`.
- company is MAS (`1`) or Horeca Smart (`2`).
- completed quantity is greater than zero.
- the linked picking has a supplier and `date_done`.
- the product has a stable internal reference.

## Odoo connection

The function reuses the existing Odoo JSON-RPC convention and secret names:

```text
ODOO_URL
ODOO_DB              optional; defaults to DB-LIVE
ODOO_USERNAME
ODOO_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

No secret value is stored in GitHub. The Odoo API user must have read access to companies `1` and `2`, `stock.move`, `stock.picking`, and `product.product`.

## Invocation security

Supabase configuration requires JWT verification. The function also checks the verified JWT payload and accepts only `role = service_role`. A normal `anon` or `authenticated` token cannot start this internal synchronization.

The function accepts `POST` only. It is not designed for direct browser access.

## Request modes

### Test mode

Default mode when `mode` is absent or not equal to `sync`.

- Reads at most five completed lines.
- Validates Odoo access, required fields, product codes, suppliers, dates, and mapping.
- Does not write receipt rows.
- Returns a small mapped sample and rejected-line diagnostics.

### Sync mode

```json
{
  "mode": "sync",
  "company_ids": [1, 2],
  "page_size": 500,
  "max_pages": 100,
  "full_sync": false
}
```

- Page size is capped at `500`.
- Page count is capped at `100` per invocation.
- Rows are ordered and paginated by Odoo stock-move line ID.
- Incremental mode begins after `procurement_supplier_receipt_cursor()`.
- `full_sync: true` starts from ID zero and safely upserts existing lines.
- `start_after_id` may be supplied for controlled recovery.

## Idempotency

`odoo_receipt_line_id` is unique in the destination table. Each batch uses an upsert with that column as the conflict key.

Re-running a full or partial synchronization does not create duplicates. It refreshes supplier, product, quantity, cost, receipt date, source update date, and `synced_at` for the same Odoo line.

## Mapping

The mapper prefers:

- `product.product.default_code` for `product_code`.
- `product.product.display_name` for `product_name`.

If explicit product metadata is absent, it accepts the display-name pattern:

```text
[PRODUCT-CODE] Product Name
```

It rejects the row when the stable code cannot be determined.

Timestamps are normalized to ISO 8601 UTC. Missing unit cost is stored as `NULL`; negative or non-numeric cost is rejected.

## Error behavior

Invalid individual rows are counted and omitted. Up to twenty rejected Odoo IDs are returned for diagnosis.

The invocation fails rather than reporting false success when a fetched page contains rows but all of them are rejected. Odoo authentication, unreadable required fields, inaccessible companies, Supabase cursor errors, and upsert failures also fail the invocation.

Every successful or failed attempt writes to `sync_logs` when the Supabase client is available.

## Cursor function

Migration `20260724093000_supplier_receipt_sync.sql` adds:

```text
public.procurement_supplier_receipt_cursor() -> bigint
```

The function returns the greatest synchronized `odoo_receipt_line_id`, or zero for an empty table. It is executable by `service_role` only.

## Verification

CI performs:

- Deno formatting check.
- Deno lint.
- seven mapper tests.
- type checking of the production Edge Function entrypoint.
- PostgreSQL tests for cursor existence, empty state, populated state, and `anon` denial.
- all existing Node, TypeScript, build, and database tests.

## Deployment gate & Controlled rollout sequence

Before enabling automated background synchronization, follow this controlled deployment sequence:

1. **Deploy Edge Function:**
   Deploy `sync-odoo18-supplier-receipts` to Supabase Edge Functions with JWT verification required.

2. **Run Test Mode (Zero-Write Validation):**
   Invoke the function in `test` mode with `page_size = 5`:
   ```json
   {
     "mode": "test",
     "company_ids": [1, 2],
     "page_size": 5
   }
   ```
   - Verify `"write_performed": false` and `"inserted_or_updated_rows": 0`.
   - Confirm zero database writes occurred to `procurement_supplier_receipts` or `sync_logs`.

3. **Review Diagnostics:**
   - Inspect `company_counts`, `minimum_received_at`, and `maximum_received_at`.
   - Inspect `rejection_reason_counts` and `rejected_line_ids` to verify mapping hygiene.

4. **Run First Controlled Sync:**
   Execute an initial limited sync batch:
   ```json
   {
     "mode": "sync",
     "company_ids": [1, 2],
     "page_size": 100,
     "max_pages": 1,
     "full_sync": true
   }
   ```

5. **Validate Initial Sync Output:**
   - Confirm `inserted_or_updated_rows` equal 100 (or total available moves).
   - Validate sample records against Odoo stock moves.

6. **Continue Incremental Backfill:**
   - Run subsequent batches with `"full_sync": false` so the stored cursor (`procurement_supplier_receipt_cursor()`) advances monotonically.
   - **Important:** Do not repeatedly use `full_sync = true`, because doing so would re-read the earliest historical records instead of advancing through history.

7. **Enable Automated Schedule:**
   - Enable pg_cron or scheduled trigger only after historical backfill and validation are complete.

## Schedule Disable & Rollback Procedure

If issues are detected during sync operations:

1. **Disable Scheduled Cron Job:**
   Unschedule the cron job in Supabase or pg_cron:
   ```sql
   SELECT cron.unschedule('sync-supplier-receipts-cron');
   ```

2. **Revert Edge Function or Pause Invocation:**
   Stop external webhook triggers or revoke invocation keys if necessary.

3. **Non-Destructive Rollback:**
   Do not execute destructive table truncation or row deletion as an automatic rollback. Existing synced records remain safely indexed by `odoo_receipt_line_id` and can be corrected or re-upserted once fixes are applied.
