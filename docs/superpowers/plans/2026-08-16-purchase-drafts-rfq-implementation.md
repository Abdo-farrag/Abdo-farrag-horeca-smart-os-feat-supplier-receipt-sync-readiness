# Purchase Drafts and Manual Odoo RFQ Handoff Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an auditable purchase-draft workflow that lets a buyer choose one company and one active Odoo supplier, review and edit suggested quantities, filter products by supplier or official Odoo brand, and export a manual Odoo RFQ workbook without writing to Odoo.

**Architecture:** Keep canonical supplier recommendations immutable and store every supplier override inside a new purchase draft. A read-only Edge Function synchronizes active Odoo suppliers and optional product purchasing metadata into service-role-only reference tables. Security-definer RPCs own draft mutations and audit events; the Fastify API is the only browser-facing data path. Typed React client adapters power supplier search, draft creation/editing, and RFQ export. All database changes remain local/CI until a separate live-migration approval.

**Tech Stack:** TypeScript, Zod, Fastify, React, TanStack Query, ExcelJS, Supabase Postgres/pgTAP, Supabase Edge Functions (Deno), Odoo JSON-RPC.

---

## Guardrails and fixed business decisions

- Supplier override is draft-only; never update `sku_supplier_settings` or canonical review projections from a draft.
- Every draft contains exactly one `company_id` and one `supplier_id`.
- Supplier choices come only from active Odoo partners with `supplier_rank > 0`; customer-only partners are excluded.
- Supplier search matches Odoo partner name or code/reference.
- Brand uses an official readable Odoo brand field when available; otherwise display and filter as `براند غير محدد`.
- Suggested quantity is copied into approved quantity when a line is added and stays editable.
- Packaging/MOQ rounding is applied only when trusted Odoo purchasing metadata exists; otherwise retain the quantity and add `PACKAGING_REVIEW_REQUIRED`.
- Price selection order is: same-supplier Odoo vendor price, same-supplier verified receipt, other-supplier reference, then missing.
- Status transitions are `DRAFT -> READY_FOR_EXPORT -> EXPORTED -> CLOSED`, with `CANCELLED` allowed from `DRAFT` or `READY_FOR_EXPORT` only.
- Version 1 exports Excel for manual Odoo RFQ entry. It performs no Odoo create/write/confirm operation.
- PUBLIC, `anon`, and `authenticated` receive no direct access to reference/draft tables, views, or mutation RPCs. Backend service role only.

## Task 1: Define canonical draft contracts and pure rules

**Files:**
- Create: `packages/contracts/src/purchase-drafts.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/purchase-drafts.test.ts`

- [x] Write failing contract tests for supplier search, draft creation, line updates, status transitions, price-source enums, warnings, and RFQ reference validation.
- [x] Run `npm -w packages/contracts test -- purchase-drafts.test.ts` and confirm RED because exports do not exist.
- [x] Implement strict Zod schemas and inferred types:
  - `PurchaseDraftStatusSchema`
  - `PurchasePriceSourceSchema`
  - `PurchaseDraftWarningSchema`
  - `SupplierDirectoryQuerySchema`
  - `PurchaseDraftCreateInputSchema`
  - `PurchaseDraftLineInputSchema`
  - `PurchaseDraftStatusInputSchema`
  - `PurchaseDraftRfqReferenceInputSchema`
  - `PurchaseDraftSchema` and `PurchaseDraftLineSchema`
- [x] Implement pure helpers `canTransitionPurchaseDraft` and `roundPurchaseQuantity`.
- [x] Assert `roundPurchaseQuantity(23, null, null)` returns 23 plus `PACKAGING_REVIEW_REQUIRED`, while MOQ/order-multiple inputs round upward deterministically.
- [x] Export the module from `packages/contracts/src/index.ts`.
- [x] Run targeted tests and commit `feat(procurement): define purchase draft contracts`.

## Task 2: Add service-role-only Odoo purchasing reference storage

**Files:**
- Create: `supabase/migrations/20260816130000_purchase_draft_reference_data.sql`
- Create: `supabase/tests/purchase_draft_reference_data.sql`
- Modify: `.github/fixtures/ci_external_procurement_sources.sql`

- [ ] Write pgTAP tests first for `procurement_supplier_directory`, `procurement_product_purchase_metadata`, and supplier-specific `procurement_product_vendor_prices` existence, keys, validation, RLS, and complete permission matrix.
- [ ] Add `procurement_supplier_directory` with Odoo partner id, name, supplier code, active flag, `supplier_rank`, timestamps, and sync metadata.
- [ ] Add `procurement_product_purchase_metadata` keyed by product code with nullable official brand, purchase UoM, order multiple, and source timestamp.
- [ ] Add `procurement_product_vendor_prices` keyed by product code + supplier + minimum quantity so prices/MOQs for multiple suppliers are never collapsed into one product row.
- [ ] Add `api_procurement_supplier_directory` and `api_procurement_brand_options` using `security_invoker = true`.
- [ ] Revoke all direct privileges from PUBLIC/`anon`/`authenticated`; grant only SELECT/mutation needed by `service_role`.
- [ ] Extend the CI fixture with minimal external/Odoo stubs only where a clean local database requires them.
- [ ] Run `npx supabase db reset`, `npx supabase db lint`, and `npx supabase test db` locally.
- [ ] Commit `feat(procurement): persist Odoo purchasing reference data`.

## Task 3: Implement read-only Odoo supplier and metadata sync

**Files:**
- Create: `supabase/functions/_shared/purchase-reference-mapper.ts`
- Create: `supabase/functions/_shared/purchase-reference-mapper.test.ts`
- Create: `supabase/functions/sync-odoo18-purchase-reference/index.ts`
- Modify: `supabase/functions/deno.json`
- Create: `apps/api/test/purchase-reference-sync.test.ts`

- [ ] Write mapper tests for active suppliers, `supplier_rank > 0`, customer-only exclusion, name/code normalization, nullable official brand, and safe packaging metadata.
- [ ] Implement strict request parsing: omitted/null mode defaults to `test`; only `test|sync`; bounded page size/pages; test mode capped and zero-write.
- [ ] Authenticate with the existing `_shared/odoo.ts` helpers.
- [ ] Read `res.partner` with domain `active = true AND supplier_rank > 0`; never call Odoo write methods.
- [ ] Probe readable product/template/vendor fields. Accept brand only from a readable official brand relation field; otherwise store null.
- [ ] In test mode return sanitized counts/sample and perform no Supabase writes or sync-log inserts.
- [ ] In sync mode upsert reference rows by Odoo ids/product code and log only sanitized metrics.
- [ ] Run native Deno mapper tests/check when Deno is available and Vitest mirror tests always.
- [ ] Commit `feat(procurement): sync Odoo supplier reference data`.

## Task 4: Persist drafts, lines, snapshots, transitions, and audit events

**Files:**
- Create: `supabase/migrations/20260816140000_purchase_drafts_rfq.sql`
- Create: `supabase/tests/purchase_drafts_rfq.sql`

- [ ] Write pgTAP RED tests for tables, foreign keys, company/supplier invariant, unique line keys, frozen snapshot columns, status rules, optimistic versions, audit writes, and permissions.
- [ ] Create `procurement_purchase_drafts` with UUID id, company/supplier snapshot, dates/notes, status, version, actor/timestamps, and nullable Odoo RFQ reference.
- [ ] Create `procurement_purchase_draft_lines` with product snapshot, brand, suggested/approved qty, UoM/MOQ/multiple, price/source/currency, warning array, source recommendation version, and row version.
- [ ] Add `rpc_create_purchase_draft` to atomically validate one company/one active supplier, snapshot selected recommendations, copy/round quantities, choose price source, and audit creation.
- [ ] Add `rpc_update_purchase_draft_line`, `rpc_change_purchase_draft_supplier`, `rpc_transition_purchase_draft`, and `rpc_set_purchase_draft_rfq_reference` with optimistic locking.
- [ ] Freeze snapshots: future supplier/product/reference syncs must not mutate existing draft lines.
- [ ] Use SECURITY DEFINER only for mutation RPCs, set `search_path = public, pg_temp`, revoke PUBLIC execution, and grant service-role execute only.
- [ ] Add `api_purchase_drafts` and `api_purchase_draft_lines` security-invoker views for service-role reads.
- [ ] Run `npx supabase test db` and commit `feat(procurement): persist auditable purchase drafts`.

## Task 5: Add supplier, brand, and draft API adapters/routes

**Files:**
- Create: `apps/api/src/purchase-drafts.ts`
- Modify: `apps/api/src/auth/types.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/purchase-drafts.test.ts`
- Create: `apps/api/test/supplier-directory.test.ts`

- [ ] Write route tests first for access control, supplier name/code search, brand options, create/list/detail/update/change-supplier/status/RFQ-reference operations, validation errors, and version conflicts.
- [ ] Add `PurchaseDraftDependencies` to `BuildAppOptions` and wire the Supabase adapter in `server.ts`.
- [ ] Implement service-role PostgREST/RPC calls with encoded query values and sanitized error mapping.
- [ ] Add routes:
  - `GET /api/procurement/suppliers?search=&page=&pageSize=`
  - `GET /api/procurement/brands`
  - `GET /api/procurement/purchase-drafts`
  - `GET /api/procurement/purchase-drafts/:id`
  - `POST /api/procurement/purchase-drafts`
  - `PATCH /api/procurement/purchase-drafts/:id/lines/:lineId`
  - `POST /api/procurement/purchase-drafts/:id/change-supplier`
  - `POST /api/procurement/purchase-drafts/:id/status`
  - `POST /api/procurement/purchase-drafts/:id/rfq-reference`
- [ ] Return stable errors such as `SUPPLIER_NOT_FOUND`, `MIXED_COMPANY_SELECTION`, `VERSION_CONFLICT`, `INVALID_STATUS_TRANSITION`, and `PACKAGING_REVIEW_REQUIRED`.
- [ ] Run targeted API tests and commit `feat(procurement): add purchase draft API`.

## Task 6: Generate a one-company/one-supplier RFQ workbook

**Files:**
- Create: `apps/api/src/purchase-draft-export.ts`
- Create: `apps/api/test/purchase-draft-export.test.ts`
- Modify: `apps/api/src/app.ts`

- [ ] Write RED tests proving one supplier/company per workbook, no mixed draft export, correct product codes/quantities/UoM/prices/warnings, formulas, safe filename, and status gate.
- [ ] Implement `buildPurchaseDraftRfqWorkbook(draft, lines, generatedAt)` with `RFQ` and `Warnings` sheets.
- [ ] Add `GET /api/procurement/purchase-drafts/:id/export` and reject drafts outside `READY_FOR_EXPORT|EXPORTED`.
- [ ] Record export audit/status through the transition RPC only after the workbook is built successfully.
- [ ] Confirm the endpoint returns XLSX content type, attachment filename, and non-empty PK/ZIP bytes.
- [ ] Commit `feat(procurement): export manual Odoo RFQ workbook`.

## Task 7: Add supplier/brand filters and draft creation UI

**Files:**
- Modify: `apps/web/src/types.ts`
- Create: `apps/web/src/api/purchase-drafts.ts`
- Create: `apps/web/src/components/SupplierCombobox.tsx`
- Create: `apps/web/src/components/PurchaseDraftPanel.tsx`
- Modify: `apps/web/src/pages/ProcurementReviewPage.tsx`
- Modify: `apps/web/src/app.css`
- Create: `apps/web/src/__tests__/purchase-draft-panel.test.tsx`
- Modify: `apps/web/src/__tests__/review.test.tsx`

- [ ] Write UI tests first for debounced supplier name/code search, customer-only exclusion contract, brand/unknown-brand filters, draft-only supplier override, company/supplier selection invariant, suggested-to-approved copy, and warning display.
- [ ] Add supplier combobox with keyboard/ARIA behavior and loading/empty/error states.
- [ ] Add supplier and brand filters to the review page; `براند غير محدد` maps to explicit null-brand filter.
- [ ] Add `إنشاء مسودة شراء` action that requires selected rows from one company and a chosen supplier.
- [ ] Add draft panel for quantity/price/note edits, warning resolution, status transition, Excel export, and manual Odoo RFQ reference entry.
- [ ] Keep canonical row supplier unchanged when a draft supplier changes.
- [ ] Run focused React tests and commit `feat(procurement): review and export supplier RFQ drafts`.

## Task 8: Documentation, regression, and release checkpoint

**Files:**
- Create: `docs/database/purchase-drafts-rfq.md`
- Modify: `.env.example` only if a new non-secret configuration name is required

- [ ] Document every displayed field source, quantity formula, target coverage, price hierarchy, warning meaning, and the exact manual Odoo RFQ handoff steps.
- [ ] Document the supplier reference sync test/sync payloads without secret values.
- [ ] Run `git diff --check`.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Run `npx supabase db lint` and `npx supabase test db` from a clean local stack.
- [ ] Run Deno format/lint/test/check for all Edge Functions when Deno is available.
- [ ] Verify no Odoo write method, service-role secret, PAT, or `.env` value exists in the diff.
- [ ] Restart the local/Replit workflow once and smoke-test supplier search, filters, draft creation, draft-only supplier override, and both Excel sheets.
- [ ] Stop before any live Supabase migration, Edge Function deployment, Odoo call, sync invocation, commit push, or PR merge unless separately approved.

## Completion criteria

- A buyer can filter recommendations by company, supplier, and official/unknown brand.
- A buyer can create a draft from rows belonging to one company, choose one active Odoo supplier, and edit copied quantities.
- Changing the supplier affects only that draft.
- Draft state, line snapshots, price provenance, warnings, versions, and audit events persist correctly.
- The generated workbook contains exactly one company and one supplier and is suitable for manual Odoo RFQ entry.
- All unit, integration, pgTAP, Deno, lint, typecheck, and build checks pass.
- Live Supabase and Odoo remain untouched until explicit rollout approval.

## Local implementation checkpoint — 2026-08-16

- Tasks 2–8 are implemented in the local feature worktree; no live migration, deployment, Odoo call, reference sync, push, or PR action has been performed.
- Local lint and TypeScript checks pass for API, web, and contracts.
- Local Vitest totals: API 150, web 37, contracts 17 (204 passed, 0 failed).
- API and web production builds pass, and `git diff --check` is clean.
- Native pgTAP/Supabase CLI and Deno format/lint/test/check remain CI-required because Docker, Supabase CLI, and Deno are unavailable in this runtime.
- The existing web review test still prints a non-failing React `act(...)` warning; it predates this feature and does not fail lint or tests.
