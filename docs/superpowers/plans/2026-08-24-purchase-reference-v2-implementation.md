# Purchase Reference Sync v2 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve every Odoo vendor-price record without conflict, make RFQ pricing company/date aware, and report partial sync progress accurately.

**Architecture:** Extend the vendor-price table additively with a surrogate primary key plus a unique Odoo supplier-info id. Normalize Odoo company and validity fields in the shared mapper, upsert by the Odoo id, and centralize sync-progress formatting in a pure shared module. Replace RFQ price/MOQ selection functions so company-specific valid rows precede global valid rows.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, Supabase Edge Functions (Deno/TypeScript), Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-purchase-reference-v2-design.md`

---

### Task 1: Lock the desired mapper and telemetry behavior

**Files:**
- Modify: `supabase/functions/_shared/purchase-reference-mapper.test.ts`
- Modify: `apps/api/test/purchase-reference-sync.test.ts`
- Create: `supabase/functions/_shared/purchase-reference-telemetry.test.ts`

1. Add tests proving two same-tier Odoo rows retain distinct supplier-info ids.
2. Add tests for company-specific/global company mapping and validity dates.
3. Add tests proving error progress reports written rows, cursors, and partial writes.
4. Run focused tests and confirm they fail for the missing v2 behavior.

### Task 2: Implement Edge mapping and progress reporting

**Files:**
- Modify: `supabase/functions/_shared/purchase-reference-mapper.ts`
- Create: `supabase/functions/_shared/purchase-reference-telemetry.ts`
- Modify: `supabase/functions/sync-odoo18-purchase-reference/index.ts`

1. Extend the Odoo supplier-info type and mapper with id, company, and dates.
2. Require standard Odoo 18 supplier-info fields and map them without fabrication.
3. Upsert vendor rows on `odoo_supplierinfo_id`.
4. Move counters/cursors to shared progress state visible to the catch path.
5. Return and log sanitized partial-write telemetry.
6. Re-run focused tests until green.

### Task 3: Add the additive database migration

**Files:**
- Modify: `supabase/migrations/20260823224020_purchase_reference_vendor_prices_v2.sql`

1. Add a surrogate identity primary key and nullable unique Odoo supplier-info id.
2. Add company and validity columns with integrity constraints and selection indexes.
3. Preserve RLS and the existing service-role-only permission boundary.
4. Replace RFQ price selection and company-aware minimum-MOQ helper.
5. Replace affected draft creation and supplier-change RPC definitions to use the helper.

### Task 4: Add pgTAP regression coverage

**Files:**
- Modify: `supabase/tests/purchase_draft_reference_data.sql`
- Modify: `supabase/tests/purchase_drafts_rfq.sql`
- Create: `supabase/tests/purchase_reference_vendor_prices_v2.sql`

1. Update the old primary-key assertion for the surrogate key.
2. Test distinct Odoo ids at the same product/supplier/MOQ tier.
3. Test company-specific preference, global fallback, and expired-row exclusion.
4. Test company/date-aware MOQ behavior and the unchanged permission matrix.
5. Run local `supabase test db` from a clean local stack.

### Task 5: Verify and publish for review

**Files:** All changed files above.

1. Run Deno format/lint/test/check if Deno is available.
2. Run `npm run lint`, `npm run typecheck`, focused tests, `npm test`, and `npm run build`.
3. Run `git diff --check`, inspect the complete changed-file list, and scan for secrets.
4. Commit on `agent/purchase-reference-v2`, push, and open a Draft PR.
5. Do not apply migrations, deploy functions, call Odoo, or run sync.
