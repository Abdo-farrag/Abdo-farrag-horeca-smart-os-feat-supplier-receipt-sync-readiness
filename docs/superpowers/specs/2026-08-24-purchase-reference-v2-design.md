# Purchase Reference Sync v2 Design

## Problem

The Odoo `product.supplierinfo` sync collapses distinct Odoo rows into the
database key `(product_code, supplier_id, minimum_qty)`. When a batch contains
two supplier-info records with that same projected key, PostgreSQL rejects the
bulk upsert with `ON CONFLICT DO UPDATE command cannot affect row a second
time`. The failed request can already have written supplier-directory and
product-metadata rows, but its error log currently reports zero rows.

## Approved design

- Persist the immutable Odoo `product.supplierinfo.id` as
  `odoo_supplierinfo_id` and use it as the sync conflict target.
- Persist nullable `company_id`; null means a global Odoo vendor-price rule.
- Persist `date_start` and `date_end` as nullable validity dates.
- Keep legacy rows compatible: existing rows receive a local surrogate key and
  remain global fallbacks until the next sync supplies an Odoo id.
- For RFQ pricing, prefer a valid rule for the requested company, then a valid
  global rule. Within that scope retain the existing MOQ and sequence ordering.
- Use the same company/date eligibility when calculating the minimum order
  quantity for draft creation and supplier changes.
- Error responses and `sync_logs` must expose sanitized progress, written-row
  count, cursors, and whether a partial write occurred.
- Test mode remains zero-write. Odoo access remains read-only.

## Safety boundary

This change is prepared and tested on a GitHub feature branch only. It does not
apply a live migration, deploy an Edge Function, contact Odoo, or run any sync.
