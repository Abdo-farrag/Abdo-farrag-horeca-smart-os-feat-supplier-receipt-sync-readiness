# Procurement Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Procurement Review workflow with individual editing, bulk approval, automatic exclusion of invalid rows, shared notes, optimistic concurrency, audit logging, and real Supabase-backed data.

**Architecture:** Keep the existing protected `/procurement/review` route and API endpoints, but replace the current oversized page with focused components, normalize the review data contract, and use one aggregated approval decision per `product_code`. Database migrations remain manual; the API must never run migrations automatically.

**Tech Stack:** React 19, TypeScript, Vite, TanStack Query, Fastify 5, Supabase REST/RPC, PostgreSQL, Vitest, Testing Library.

## Global Constraints

- Decisions are aggregated across MAS and Horeca Smart in this phase.
- The decision key is `product_code` only.
- `APPROVED` requires `approvedQty > 0` and a supplier.
- Products without suppliers are excluded from bulk approval and remain unchanged.
- Products with null, zero, negative, or invalid quantities are excluded from bulk approval and remain unchanged.
- Bulk actions support one optional shared note with a maximum of 1000 characters.
- Bulk requests are atomic at the database transaction level.
- Optimistic concurrency uses `expectedVersion`; version conflicts must never overwrite newer data.
- No RFQ creation, purchase order creation, Odoo write-back, or company-level split in this phase.
- No database migration may run automatically during API startup.
- Use Arabic user-facing copy and preserve the existing RTL layout.

---

## File Structure Map

### Existing files to modify

- `apps/api/src/app.ts` — request validation, review routes, response/error mapping.
- `apps/api/src/auth/types.ts` — API dependency contracts and canonical review types.
- `apps/api/src/supabase-review.ts` — Supabase reads, RPC calls, response mapping, error normalization.
- `apps/api/src/server.ts` — keep review dependency wiring; confirm no migration runner call.
- `apps/api/package.json` — remove unused direct PostgreSQL migration dependencies.
- `apps/web/src/pages/ProcurementReviewPage.tsx` — reduce to orchestration only.
- `apps/web/src/api/review.ts` — request/response DTOs and fetch helpers.
- `apps/web/src/hooks/useReview.ts` — query/mutation hooks and cache invalidation.
- `apps/web/src/types.ts` — canonical frontend review models.
- `apps/web/src/app.css` — component styles, sticky bulk bar, confirmation dialog, validation states.
- `apps/web/src/__tests__/review.test.tsx` — page and workflow tests.
- `supabase/migrations/20260726100000_procurement_approval_workflow.sql` — correct constraints, RPC validation, and review read model.
- `package-lock.json` — dependency lock updates after removing `pg` packages.

### Files to create

- `apps/web/src/components/review/ReviewKpiCards.tsx`
- `apps/web/src/components/review/ReviewFilters.tsx`
- `apps/web/src/components/review/ReviewTable.tsx`
- `apps/web/src/components/review/ReviewRow.tsx`
- `apps/web/src/components/review/BulkActionBar.tsx`
- `apps/web/src/components/review/BulkConfirmationDialog.tsx`
- `apps/web/src/components/review/ReviewStatusBadge.tsx`
- `apps/web/src/components/review/review-validation.ts`
- `apps/api/src/__tests__/review-routes.test.ts`

### File to remove

- `apps/api/src/migrate.ts`

---

### Task 1: Remove the Unused Migration Runner

**Files:**
- Delete: `apps/api/src/migrate.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Verify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: existing API startup in `apps/api/src/server.ts`.
- Produces: an API process that starts without direct PostgreSQL migration code or migration-only dependencies.

- [ ] **Step 1: Add a regression assertion that server startup does not import a migration runner**

Create or extend `apps/api/src/__tests__/server.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('server startup', () => {
  it('does not import or execute database migrations', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');

    expect(source).not.toContain("from './migrate.js'");
    expect(source).not.toContain('runPendingMigrations');
  });
});
```

- [ ] **Step 2: Run the regression test**

Run:

```bash
npm --workspace apps/api test -- server.test.ts
```

Expected: PASS, proving startup is already disconnected from the runner.

- [ ] **Step 3: Remove migration-only code and dependencies**

Delete:

```text
apps/api/src/migrate.ts
```

Remove these entries from `apps/api/package.json`:

```json
"pg": "^8.22.0"
```

```json
"@types/pg": "^8.20.0"
```

Run:

```bash
npm install
```

- [ ] **Step 4: Verify no migration runner references remain**

Run:

```bash
grep -R "runPendingMigrations\|src/migrate\|from 'pg'" apps/api/src apps/api/package.json
```

Expected: no output.

- [ ] **Step 5: Run API tests**

Run:

```bash
npm --workspace apps/api test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/migrate.ts apps/api/package.json package-lock.json apps/api/src/__tests__/server.test.ts
git commit -m "chore: remove unused migration runner"
```

---

### Task 2: Define the Canonical Review Data Contract

**Files:**
- Modify: `apps/api/src/auth/types.ts`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api/review.ts`
- Test: `apps/api/src/__tests__/review-routes.test.ts`

**Interfaces:**
- Consumes: raw review rows returned by Supabase.
- Produces:
  - `ReviewDecisionStatus`
  - `ReviewProduct`
  - `ReviewSummary`
  - `ReviewPageData`
  - `ReviewFiltersInput`
  - `ApprovalDecision`
  - `BulkUpdateResult`

- [ ] **Step 1: Write failing API contract tests**

Create `apps/api/src/__tests__/review-routes.test.ts` with a minimal Fastify app and mocked review dependency:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';

const reviewProduct = {
  productCode: 'SKU-001',
  productName: 'Test Product',
  priority: 'CRITICAL',
  availableQty: 2,
  effectiveDailyDemand: 1.5,
  coverageDays: 1.33,
  suggestedQty: 20,
  approvedQty: null,
  proposedSupplierId: 9,
  proposedSupplierName: 'Supplier A',
  approvedSupplierId: null,
  approvedSupplierName: null,
  supplierStatus: 'PENDING_REVIEW',
  decisionStatus: 'NEW',
  buyerNote: null,
  reviewUpdatedAt: null,
  approvalVersion: 0,
};

describe('procurement review routes', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns items, pagination, and summary', async () => {
    const app = buildApp({
      auth: {
        sessionSecret: 'x'.repeat(32),
        passwordHash: '$2b$12$invalid',
        authorizeEmployee: vi.fn(),
      } as never,
      review: {
        getReviewProducts: vi.fn().mockResolvedValue({
          data: {
            items: [reviewProduct],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
            summary: {
              totalRecommended: 1,
              newCount: 1,
              underReviewCount: 0,
              approvedCount: 0,
              deferredCount: 0,
              withoutSupplierCount: 0,
              totalApprovedQty: 0,
            },
          },
          error: null,
        }),
        approveRecommendation: vi.fn(),
        bulkUpdateRecommendations: vi.fn(),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/procurement/review?page=1&pageSize=50',
      headers: { cookie: 'overview_session=valid-test-cookie' },
    });

    expect([200, 401]).toContain(response.statusCode);
  });
});
```

Use the project’s existing test session helper instead of the placeholder cookie when implementing.

- [ ] **Step 2: Run the contract test and confirm it fails for missing types or mismatched response**

Run:

```bash
npm --workspace apps/api test -- review-routes.test.ts
```

Expected: FAIL until canonical contracts are added.

- [ ] **Step 3: Add canonical backend types**

In `apps/api/src/auth/types.ts`, define:

```ts
export type ReviewDecisionStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED';

export interface ReviewProduct {
  productCode: string;
  productName: string;
  priority: string;
  availableQty: number;
  effectiveDailyDemand: number;
  coverageDays: number | null;
  suggestedQty: number;
  approvedQty: number | null;
  proposedSupplierId: number | null;
  proposedSupplierName: string | null;
  approvedSupplierId: number | null;
  approvedSupplierName: string | null;
  supplierStatus: string;
  decisionStatus: ReviewDecisionStatus;
  buyerNote: string | null;
  reviewUpdatedAt: string | null;
  approvalVersion: number;
}

export interface ReviewSummary {
  totalRecommended: number;
  newCount: number;
  underReviewCount: number;
  approvedCount: number;
  deferredCount: number;
  withoutSupplierCount: number;
  totalApprovedQty: number;
}

export interface ReviewPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReviewPageData {
  items: ReviewProduct[];
  pagination: ReviewPagination;
  summary: ReviewSummary;
}
```

Update `ReviewDependencies.getReviewProducts` to return:

```ts
Promise<{ data: ReviewPageData; error: null }>
```

- [ ] **Step 4: Mirror the contract in the frontend**

In `apps/web/src/types.ts`, define the same field names and status union. In `apps/web/src/api/review.ts`, make `fetchReviewProducts` return:

```ts
Promise<{ data: ReviewPageData | null; error: ApiError | null }>
```

- [ ] **Step 5: Run type checks and tests**

Run:

```bash
npm --workspace apps/api run typecheck
npm --workspace apps/web run typecheck
npm --workspace apps/api test -- review-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/types.ts apps/api/src/__tests__/review-routes.test.ts apps/web/src/types.ts apps/web/src/api/review.ts
git commit -m "refactor: define procurement review contract"
```

---

### Task 3: Correct Supabase Read Mapping and RPC Error Handling

**Files:**
- Modify: `apps/api/src/supabase-review.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/__tests__/review-routes.test.ts`

**Interfaces:**
- Consumes:
  - Supabase view `v_recommendation_approvals`
  - RPC `rpc_approve_recommendation`
  - RPC `rpc_bulk_update_recommendations`
- Produces:
  - `getReviewProducts(params): Promise<{ data: ReviewPageData; error: null }>`
  - normalized `VERSION_CONFLICT`, `REVIEW_UNAVAILABLE`, `VALIDATION_ERROR`, and `BULK_UPDATE_FAILED` errors.

- [ ] **Step 1: Add failing tests for query mapping and conflict handling**

Extend `apps/api/src/__tests__/review-routes.test.ts`:

```ts
it('maps version conflicts to HTTP 409', async () => {
  const app = buildApp({
    auth: createTestAuth(),
    review: {
      getReviewProducts: vi.fn(),
      approveRecommendation: vi.fn().mockRejectedValue(new Error('VERSION_CONFLICT')),
      bulkUpdateRecommendations: vi.fn(),
    },
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/procurement/review/approve',
    headers: { cookie: createValidSessionCookie() },
    payload: {
      productCode: 'SKU-001',
      decisionStatus: 'APPROVED',
      approvedQty: 10,
      approvedSupplierId: 9,
      approvedSupplierName: 'Supplier A',
      buyerNote: null,
      expectedVersion: 0,
    },
  });

  expect(response.statusCode).toBe(409);
  expect(response.json().error.code).toBe('VERSION_CONFLICT');
});

it('rejects approved decisions without a positive quantity', async () => {
  const app = buildApp({ auth: createTestAuth(), review: createReviewMock() });

  const response = await app.inject({
    method: 'POST',
    url: '/api/procurement/review/approve',
    headers: { cookie: createValidSessionCookie() },
    payload: {
      productCode: 'SKU-001',
      decisionStatus: 'APPROVED',
      approvedQty: 0,
      approvedSupplierId: 9,
      approvedSupplierName: 'Supplier A',
      expectedVersion: 0,
    },
  });

  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe('INVALID_APPROVED_QTY');
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npm --workspace apps/api test -- review-routes.test.ts
```

Expected: FAIL because current route validation is incomplete.

- [ ] **Step 3: Normalize the Supabase row mapper**

In `apps/api/src/supabase-review.ts`, add a dedicated mapper:

```ts
function toNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function mapReviewRow(row: Record<string, unknown>): ReviewProduct {
  return {
    productCode: String(row.product_code ?? ''),
    productName: String(row.product_name ?? ''),
    priority: String(row.priority ?? 'NORMAL'),
    availableQty: toNumber(row.available_qty),
    effectiveDailyDemand: toNumber(row.effective_daily_demand),
    coverageDays: row.coverage_days == null ? null : toNumber(row.coverage_days),
    suggestedQty: toNumber(row.suggested_qty),
    approvedQty: row.approved_qty == null ? null : toNumber(row.approved_qty),
    proposedSupplierId: row.proposed_supplier_id == null ? null : toNumber(row.proposed_supplier_id),
    proposedSupplierName: row.proposed_supplier_name == null ? null : String(row.proposed_supplier_name),
    approvedSupplierId: row.approved_supplier_id == null ? null : toNumber(row.approved_supplier_id),
    approvedSupplierName: row.approved_supplier_name == null ? null : String(row.approved_supplier_name),
    supplierStatus: String(row.supplier_status ?? 'NEEDS_SUPPLIER'),
    decisionStatus: String(row.decision_status ?? 'NEW') as ReviewDecisionStatus,
    buyerNote: row.buyer_note == null ? null : String(row.buyer_note),
    reviewUpdatedAt: row.review_updated_at == null ? null : String(row.review_updated_at),
    approvalVersion: toNumber(row.approval_version),
  };
}
```

- [ ] **Step 4: Build summary values from the filtered result set**

Add:

```ts
function buildReviewSummary(items: ReviewProduct[]): ReviewSummary {
  return {
    totalRecommended: items.length,
    newCount: items.filter((item) => item.decisionStatus === 'NEW').length,
    underReviewCount: items.filter((item) => item.decisionStatus === 'UNDER_REVIEW').length,
    approvedCount: items.filter((item) => item.decisionStatus === 'APPROVED').length,
    deferredCount: items.filter((item) => item.decisionStatus === 'DEFERRED').length,
    withoutSupplierCount: items.filter(
      (item) => !item.approvedSupplierId && !item.proposedSupplierId && !item.approvedSupplierName && !item.proposedSupplierName,
    ).length,
    totalApprovedQty: items
      .filter((item) => item.decisionStatus === 'APPROVED')
      .reduce((sum, item) => sum + (item.approvedQty ?? 0), 0),
  };
}
```

If the API already has a dedicated summary endpoint or count query, use that instead so totals reflect all filtered rows, not just one page.

- [ ] **Step 5: Add route-level validation in `apps/api/src/app.ts`**

Before calling the dependency:

```ts
if (body.decisionStatus === 'APPROVED') {
  if (body.approvedQty == null || !Number.isFinite(body.approvedQty) || body.approvedQty <= 0) {
    return reply.code(400).send({ data: null, error: { code: 'INVALID_APPROVED_QTY' } });
  }

  const hasSupplier = Boolean(
    body.approvedSupplierId || body.approvedSupplierName?.trim(),
  );

  if (!hasSupplier) {
    return reply.code(400).send({ data: null, error: { code: 'SUPPLIER_REQUIRED' } });
  }
}
```

- [ ] **Step 6: Run API tests**

Run:

```bash
npm --workspace apps/api test -- review-routes.test.ts
npm --workspace apps/api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/supabase-review.ts apps/api/src/app.ts apps/api/src/__tests__/review-routes.test.ts
git commit -m "fix: normalize procurement review API"
```

---

### Task 4: Correct the Database Migration and Review Read Model

**Files:**
- Modify: `supabase/migrations/20260726100000_procurement_approval_workflow.sql`
- Add verification queries inside comments at the bottom of the migration.

**Interfaces:**
- Consumes:
  - `api_procurement_company_source`
  - `api_latest_supplier_receipt`
  - `procurement_require_actor`
  - `procurement_audit_events`
- Produces:
  - `procurement_recommendation_approvals`
  - `rpc_approve_recommendation`
  - `rpc_bulk_update_recommendations`
  - `v_recommendation_approvals`

- [ ] **Step 1: Make table creation idempotent without dropping production data**

Replace plain table creation with:

```sql
create table if not exists public.procurement_recommendation_approvals (
  product_code text primary key check (length(btrim(product_code)) between 1 and 120),
  approved_qty numeric null check (approved_qty is null or approved_qty >= 0),
  approved_supplier_id bigint null check (approved_supplier_id is null or approved_supplier_id > 0),
  approved_supplier_name text null,
  decision_status text not null default 'NEW'
    check (decision_status in ('NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED')),
  buyer_note text null check (buyer_note is null or length(buyer_note) <= 1000),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null
);
```

Then replace the approval constraint safely:

```sql
alter table public.procurement_recommendation_approvals
  drop constraint if exists procurement_approvals_approved_pair_check;

alter table public.procurement_recommendation_approvals
  add constraint procurement_approvals_approved_pair_check check (
    (decision_status = 'APPROVED' and approved_qty is not null and approved_qty > 0)
    or decision_status <> 'APPROVED'
  );
```

- [ ] **Step 2: Tighten individual RPC validation**

Use:

```sql
if p_decision_status = 'APPROVED'
   and (p_approved_qty is null or p_approved_qty <= 0) then
  raise exception 'APPROVED_QTY_MUST_BE_POSITIVE';
end if;

if p_decision_status = 'APPROVED'
   and p_approved_supplier_id is null
   and nullif(btrim(coalesce(p_approved_supplier_name, '')), '') is null then
  raise exception 'APPROVED_SUPPLIER_REQUIRED';
end if;
```

- [ ] **Step 3: Make bulk JSON parsing safe**

Inside the loop, parse values with `nullif` and validate `expectedVersion` explicitly:

```sql
if nullif(v_item ->> 'productCode', '') is null then
  raise exception 'PRODUCT_CODE_REQUIRED';
end if;

if nullif(v_item ->> 'expectedVersion', '') is null then
  raise exception 'EXPECTED_VERSION_REQUIRED';
end if;

v_result := public.rpc_approve_recommendation(
  v_item ->> 'productCode',
  p_decision_status,
  nullif(v_item ->> 'approvedQty', '')::numeric,
  nullif(v_item ->> 'approvedSupplierId', '')::bigint,
  nullif(v_item ->> 'approvedSupplierName', ''),
  p_buyer_note,
  (v_item ->> 'expectedVersion')::bigint,
  p_actor_user_id,
  p_request_id
);
```

- [ ] **Step 4: Replace the invalid view with an aggregated read model using real columns**

Use `api_procurement_company_source` as the stable source:

```sql
create or replace view public.v_recommendation_approvals as
with aggregated as (
  select
    s.product_code,
    max(s.product_name) as product_name,
    sum(s.free_qty)::numeric as available_qty,
    sum(s.effective_daily_demand)::numeric as effective_daily_demand,
    case
      when sum(s.effective_daily_demand) > 0
        then round(sum(s.free_qty) / sum(s.effective_daily_demand), 2)
      else null
    end::numeric as coverage_days,
    greatest(
      ceil(
        greatest(
          (sum(s.effective_daily_demand) * 14) - sum(s.free_qty),
          0
        )
      ),
      0
    )::numeric as suggested_qty,
    case
      when sum(s.free_qty) <= 0 then 'CRITICAL'
      when sum(s.effective_daily_demand) > 0
       and sum(s.free_qty) / sum(s.effective_daily_demand) < 4 then 'HIGH'
      else 'NORMAL'
    end::text as priority,
    case
      when bool_or(s.data_status = 'SUFFICIENT') then 'SUFFICIENT'
      else 'INSUFFICIENT'
    end::text as data_status,
    max(s.snapshot_at) as snapshot_at
  from public.api_procurement_company_source s
  group by s.product_code
),
supplier as (
  select distinct on (r.product_code)
    r.product_code,
    r.supplier_id as proposed_supplier_id,
    r.supplier_name as proposed_supplier_name,
    r.received_at as latest_receipt_at
  from public.api_latest_supplier_receipt r
  order by r.product_code, r.received_at desc nulls last
)
select
  g.product_code,
  g.product_name,
  g.priority,
  g.available_qty,
  g.effective_daily_demand,
  g.coverage_days,
  g.suggested_qty,
  s.proposed_supplier_id,
  s.proposed_supplier_name,
  case
    when s.proposed_supplier_id is null
     and nullif(btrim(coalesce(s.proposed_supplier_name, '')), '') is null
      then 'NEEDS_SUPPLIER'
    else 'PENDING_REVIEW'
  end::text as supplier_status,
  s.latest_receipt_at,
  a.approved_qty,
  a.approved_supplier_id,
  a.approved_supplier_name,
  coalesce(a.decision_status, 'NEW') as decision_status,
  a.buyer_note,
  a.updated_at as review_updated_at,
  a.updated_by as review_updated_by,
  coalesce(a.version, 0) as approval_version
from aggregated g
left join supplier s on s.product_code = g.product_code
left join public.procurement_recommendation_approvals a
  on a.product_code = g.product_code;
```

Before applying, verify the exact supplier source column names in the target database. If `api_latest_supplier_receipt` differs, update only the supplier CTE while preserving the output aliases above.

- [ ] **Step 5: Keep RLS and grants service-role only**

Ensure the migration ends with:

```sql
alter table public.procurement_recommendation_approvals enable row level security;

revoke all on table public.procurement_recommendation_approvals from public, anon, authenticated;
revoke all on view public.v_recommendation_approvals from public, anon, authenticated;

grant select, insert, update, delete on table public.procurement_recommendation_approvals to service_role;
grant select on view public.v_recommendation_approvals to service_role;
```

Keep function execute grants restricted to `service_role`.

- [ ] **Step 6: Add manual verification queries as SQL comments**

Append:

```sql
-- Verification after manual application:
-- select to_regclass('public.procurement_recommendation_approvals');
-- select count(*) from public.v_recommendation_approvals;
-- select product_code, suggested_qty, decision_status, approval_version
-- from public.v_recommendation_approvals
-- order by priority, product_code
-- limit 20;
```

- [ ] **Step 7: Review the SQL without applying it**

Run locally if a parser is available, or copy into a Supabase SQL Editor tab and use the editor parser without pressing Run.

Expected: no missing relation or missing column errors in the parsed statement.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260726100000_procurement_approval_workflow.sql
git commit -m "fix: align procurement approval migration with live schema"
```

---

### Task 5: Extract Frontend Review Validation and Presentational Components

**Files:**
- Create: `apps/web/src/components/review/review-validation.ts`
- Create: `apps/web/src/components/review/ReviewStatusBadge.tsx`
- Create: `apps/web/src/components/review/ReviewKpiCards.tsx`
- Create: `apps/web/src/components/review/ReviewFilters.tsx`
- Modify: `apps/web/src/__tests__/review.test.tsx`

**Interfaces:**
- Consumes: `ReviewProduct`, `ReviewSummary`, `ReviewDecisionStatus`.
- Produces:
  - `validateReviewDecision(input): ReviewValidationErrors`
  - `resolveEffectiveSupplier(item, draft)`
  - reusable KPI, filters, and status badge components.

- [ ] **Step 1: Write failing validation tests**

Add to `apps/web/src/__tests__/review.test.tsx` or create `review-validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateReviewDecision } from '../components/review/review-validation.js';

describe('validateReviewDecision', () => {
  it('requires a positive quantity for approval', () => {
    expect(
      validateReviewDecision({
        decisionStatus: 'APPROVED',
        approvedQty: 0,
        supplierId: 9,
        supplierName: 'Supplier A',
      }),
    ).toEqual({ approvedQty: 'الكمية المعتمدة يجب أن تكون أكبر من صفر.' });
  });

  it('requires a supplier for approval', () => {
    expect(
      validateReviewDecision({
        decisionStatus: 'APPROVED',
        approvedQty: 10,
        supplierId: null,
        supplierName: null,
      }),
    ).toEqual({ supplier: 'يجب اختيار مورد قبل الاعتماد.' });
  });
});
```

- [ ] **Step 2: Run the validation tests and confirm failure**

Run:

```bash
npm --workspace apps/web test -- review-validation
```

Expected: FAIL because the validation module does not exist.

- [ ] **Step 3: Implement validation**

Create `review-validation.ts`:

```ts
import type { ReviewDecisionStatus } from '../../types.js';

export interface ReviewValidationInput {
  decisionStatus: ReviewDecisionStatus;
  approvedQty: number | null;
  supplierId: number | null;
  supplierName: string | null;
}

export interface ReviewValidationErrors {
  approvedQty?: string;
  supplier?: string;
}

export function validateReviewDecision(input: ReviewValidationInput): ReviewValidationErrors {
  if (input.decisionStatus !== 'APPROVED') {
    return {};
  }

  const errors: ReviewValidationErrors = {};

  if (input.approvedQty == null || !Number.isFinite(input.approvedQty) || input.approvedQty <= 0) {
    errors.approvedQty = 'الكمية المعتمدة يجب أن تكون أكبر من صفر.';
  }

  if (!input.supplierId && !input.supplierName?.trim()) {
    errors.supplier = 'يجب اختيار مورد قبل الاعتماد.';
  }

  return errors;
}
```

- [ ] **Step 4: Implement `ReviewStatusBadge`**

Map status copy:

```ts
const LABELS = {
  NEW: 'جديد',
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  DEFERRED: 'مؤجل',
  REJECTED: 'مرفوض',
} as const;
```

Use semantic class names only, such as `review-status review-status--approved`.

- [ ] **Step 5: Implement KPI cards**

`ReviewKpiCards` receives:

```ts
interface ReviewKpiCardsProps {
  summary: ReviewSummary;
}
```

Render seven cards for the approved spec fields.

- [ ] **Step 6: Implement controlled filters**

`ReviewFilters` receives:

```ts
interface ReviewFiltersProps {
  search: string;
  priority: string;
  decisionStatus: string;
  noSupplier: boolean;
  needsPurchaseOnly: boolean;
  modifiedOnly: boolean;
  onChange: (next: Partial<ReviewFilterState>) => void;
}
```

Do not include a company filter.

- [ ] **Step 7: Run frontend tests**

Run:

```bash
npm --workspace apps/web test -- review
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/review apps/web/src/__tests__/review.test.tsx
git commit -m "feat: add procurement review UI primitives"
```

---

### Task 6: Implement Editable Rows and Individual Save

**Files:**
- Create: `apps/web/src/components/review/ReviewRow.tsx`
- Create: `apps/web/src/components/review/ReviewTable.tsx`
- Modify: `apps/web/src/hooks/useReview.ts`
- Modify: `apps/web/src/api/review.ts`
- Modify: `apps/web/src/__tests__/review.test.tsx`

**Interfaces:**
- Consumes:
  - `ReviewProduct`
  - `validateReviewDecision`
  - `saveReviewDecision(request)`
- Produces:
  - editable row drafts
  - `onDraftChange(productCode, patch)`
  - `onSave(productCode)`
  - page-level selection callbacks.

- [ ] **Step 1: Add failing tests for default quantity and individual save**

Add tests:

```ts
it('uses suggested quantity when no saved approval quantity exists', async () => {
  renderReviewPage({ approvedQty: null, suggestedQty: 24 });

  expect(await screen.findByDisplayValue('24')).toBeInTheDocument();
});

it('sends the edited quantity and expected version when saving', async () => {
  const save = vi.fn().mockResolvedValue({ data: savedDecision, error: null });
  renderReviewPage({ save });

  const quantity = await screen.findByLabelText('الكمية المعتمدة SKU-001');
  await userEvent.clear(quantity);
  await userEvent.type(quantity, '18');
  await userEvent.click(screen.getByRole('button', { name: 'حفظ القرار SKU-001' }));

  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      productCode: 'SKU-001',
      approvedQty: 18,
      expectedVersion: 0,
    }),
  );
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm --workspace apps/web test -- review
```

Expected: FAIL until row extraction and save flow are implemented.

- [ ] **Step 3: Add the individual mutation hook**

In `useReview.ts`:

```ts
export function useSaveReviewDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveReviewDecision,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['procurement-review'] });
    },
  });
}
```

- [ ] **Step 4: Implement `ReviewRow` draft initialization**

Initialize:

```ts
const initialApprovedQty = item.approvedQty ?? item.suggestedQty;
const initialSupplierId = item.approvedSupplierId ?? item.proposedSupplierId;
const initialSupplierName = item.approvedSupplierName ?? item.proposedSupplierName;
```

The row must expose controlled fields for quantity, supplier name, status, and note. Editing marks the row as dirty without saving.

- [ ] **Step 5: Validate before saving**

On save:

```ts
const errors = validateReviewDecision({
  decisionStatus: draft.decisionStatus,
  approvedQty: draft.approvedQty,
  supplierId: draft.supplierId,
  supplierName: draft.supplierName,
});

if (Object.keys(errors).length > 0) {
  setValidationErrors(errors);
  return;
}
```

- [ ] **Step 6: Send canonical individual request**

```ts
await saveDecision.mutateAsync({
  productCode: item.productCode,
  decisionStatus: draft.decisionStatus,
  approvedQty: draft.decisionStatus === 'APPROVED' ? draft.approvedQty : null,
  approvedSupplierId: draft.supplierId,
  approvedSupplierName: draft.supplierName,
  buyerNote: draft.buyerNote?.trim() || null,
  expectedVersion: item.approvalVersion,
});
```

- [ ] **Step 7: Handle version conflict in Arabic**

When API error code is `VERSION_CONFLICT`, show:

```text
تم تعديل هذا المنتج بواسطة مستخدم آخر. حدّث البيانات وأعد المحاولة.
```

Refresh the current review query after displaying the message.

- [ ] **Step 8: Run tests**

Run:

```bash
npm --workspace apps/web test -- review
npm --workspace apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/review/ReviewRow.tsx apps/web/src/components/review/ReviewTable.tsx apps/web/src/hooks/useReview.ts apps/web/src/api/review.ts apps/web/src/__tests__/review.test.tsx
git commit -m "feat: add individual procurement review editing"
```

---

### Task 7: Implement Bulk Selection, Exclusion Logic, and Shared Note

**Files:**
- Create: `apps/web/src/components/review/BulkActionBar.tsx`
- Create: `apps/web/src/components/review/BulkConfirmationDialog.tsx`
- Modify: `apps/web/src/pages/ProcurementReviewPage.tsx`
- Modify: `apps/web/src/hooks/useReview.ts`
- Modify: `apps/web/src/api/review.ts`
- Modify: `apps/web/src/__tests__/review.test.tsx`

**Interfaces:**
- Consumes:
  - page items
  - row drafts
  - selected product codes
- Produces:
  - `buildBulkPreview(selectedItems, drafts, action)`
  - `BulkPreview`
  - atomic bulk request payload.

- [ ] **Step 1: Write failing tests for bulk exclusions and shared note**

Add:

```ts
it('excludes products without suppliers from bulk approval', async () => {
  const bulk = vi.fn().mockResolvedValue({ data: { batchId: 'b1', items: [] }, error: null });
  renderReviewPage({
    items: [productWithSupplier, productWithoutSupplier],
    bulk,
  });

  await userEvent.click(await screen.findByLabelText('تحديد SKU-001'));
  await userEvent.click(screen.getByLabelText('تحديد SKU-002'));
  await userEvent.click(screen.getByRole('button', { name: 'اعتماد المحدد' }));

  expect(screen.getByText('منتج واحد بدون مورد سيتم استبعاده')).toBeInTheDocument();
});

it('applies one shared note to submitted bulk items', async () => {
  const bulk = vi.fn().mockResolvedValue({ data: { batchId: 'b1', items: [savedDecision] }, error: null });
  renderReviewPage({ bulk });

  await userEvent.click(await screen.findByLabelText('تحديد SKU-001'));
  await userEvent.click(screen.getByRole('button', { name: 'اعتماد المحدد' }));
  await userEvent.type(screen.getByLabelText('ملاحظة مشتركة'), 'اعتماد خطة الأسبوع');
  await userEvent.click(screen.getByRole('button', { name: 'تأكيد الاعتماد' }));

  expect(bulk).toHaveBeenCalledWith(
    expect.objectContaining({ buyerNote: 'اعتماد خطة الأسبوع' }),
  );
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm --workspace apps/web test -- review
```

Expected: FAIL.

- [ ] **Step 3: Define bulk preview types and pure builder**

Inside the page or a small helper module:

```ts
interface BulkExcludedItem {
  productCode: string;
  productName: string;
  reason: 'NO_SUPPLIER' | 'INVALID_QTY';
}

interface BulkPreview {
  validItems: BulkApprovalItem[];
  excludedItems: BulkExcludedItem[];
  totalApprovedQty: number;
}
```

For `APPROVED`, exclude rows without a supplier and rows with invalid quantity. For other statuses, include all selected rows with valid identifiers and versions.

- [ ] **Step 4: Implement sticky `BulkActionBar`**

Props:

```ts
interface BulkActionBarProps {
  selectedCount: number;
  onApprove: () => void;
  onUnderReview: () => void;
  onDefer: () => void;
  onReject: () => void;
  onClear: () => void;
}
```

Render only when `selectedCount > 0`.

- [ ] **Step 5: Implement confirmation dialog**

Display:

- valid count
- total approved quantity
- no-supplier exclusion count
- invalid-quantity exclusion count
- grouped excluded product codes/names
- shared note textarea with `maxLength={1000}`

Disable confirmation when `validItems.length === 0`.

- [ ] **Step 6: Add bulk mutation hook**

```ts
export function useBulkReviewDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: bulkUpdateReviewDecisions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['procurement-review'] });
    },
  });
}
```

- [ ] **Step 7: Send only valid items**

```ts
await bulkMutation.mutateAsync({
  items: preview.validItems,
  decisionStatus: pendingBulkAction,
  buyerNote: sharedNote.trim() || null,
});
```

After success:

```ts
setSelectedProductCodes(new Set());
setBulkDialogOpen(false);
setSharedNote('');
```

- [ ] **Step 8: Show precise success copy**

Build a message such as:

```text
تم اعتماد 18 منتجًا. تم استبعاد 3 منتجات بدون مورد ومنتج واحد بكمية غير صالحة.
```

Do not change excluded rows locally; rely on query refresh for canonical state.

- [ ] **Step 9: Run tests**

Run:

```bash
npm --workspace apps/web test -- review
npm --workspace apps/web run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/review/BulkActionBar.tsx apps/web/src/components/review/BulkConfirmationDialog.tsx apps/web/src/pages/ProcurementReviewPage.tsx apps/web/src/hooks/useReview.ts apps/web/src/api/review.ts apps/web/src/__tests__/review.test.tsx
git commit -m "feat: add bulk procurement approval workflow"
```

---

### Task 8: Complete Page Orchestration, Filters, KPIs, and Error States

**Files:**
- Modify: `apps/web/src/pages/ProcurementReviewPage.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/__tests__/review.test.tsx`

**Interfaces:**
- Consumes all review components and hooks from Tasks 5–7.
- Produces the final protected `/procurement/review` experience.

- [ ] **Step 1: Add failing tests for filters, page reset, retry state, and session expiry**

Add tests that assert:

```ts
it('resets page to 1 when filters change', async () => {
  renderReviewPage({ initialPage: 3 });
  await userEvent.type(screen.getByLabelText('بحث'), 'coffee');
  expect(mockFetch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'coffee' }));
});

it('shows a retry button when the review source is unavailable', async () => {
  renderReviewPage({ queryError: true });
  expect(await screen.findByRole('button', { name: 'إعادة المحاولة' })).toBeInTheDocument();
});
```

Use the project’s existing session-expiry test helpers for the 401 flow.

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm --workspace apps/web test -- review
```

Expected: FAIL until orchestration is complete.

- [ ] **Step 3: Reduce `ProcurementReviewPage` to orchestration**

The page should own only:

```ts
const [filters, setFilters] = useState<ReviewFilterState>(DEFAULT_FILTERS);
const [page, setPage] = useState(1);
const [selectedProductCodes, setSelectedProductCodes] = useState<Set<string>>(new Set());
const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
const [feedback, setFeedback] = useState<ReviewFeedback | null>(null);
```

All row rendering belongs in `ReviewTable` and `ReviewRow`.

- [ ] **Step 4: Reset pagination on filter changes**

```ts
function updateFilters(patch: Partial<ReviewFilterState>) {
  setFilters((current) => ({ ...current, ...patch }));
  setPage(1);
}
```

- [ ] **Step 5: Add the aggregated-scope notice**

Render:

```text
قرارات هذه المرحلة مجمعة لشركتي MAS وHoreca Smart، وسيتم توزيع الكميات عند إنشاء طلبات الشراء.
```

- [ ] **Step 6: Add loading, empty, error, and retry states**

Use existing spinner and state-message patterns. A 401 must navigate to `/login`; a data-source error shows `إعادة المحاولة`.

- [ ] **Step 7: Add responsive RTL styles**

In `app.css`, add focused class groups:

```css
.review-page {}
.review-kpis {}
.review-filters {}
.review-table-wrap {}
.review-bulk-bar {}
.review-dialog-backdrop {}
.review-dialog {}
.review-field-error {}
.review-row--dirty {}
```

Keep the table horizontally scrollable on smaller screens and the bulk bar sticky above the viewport bottom.

- [ ] **Step 8: Run frontend tests**

Run:

```bash
npm --workspace apps/web test
npm --workspace apps/web run typecheck
npm --workspace apps/web run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/ProcurementReviewPage.tsx apps/web/src/app.css apps/web/src/__tests__/review.test.tsx
git commit -m "feat: complete procurement review page"
```

---

### Task 9: Manual Supabase Application and Verification

**Files:**
- No code files modified unless verification reveals a migration mismatch.
- Use: `supabase/migrations/20260726100000_procurement_approval_workflow.sql`

**Interfaces:**
- Consumes the reviewed migration from Task 4.
- Produces live database objects required by the API.

- [ ] **Step 1: Back up object definitions before applying**

Run in Supabase SQL Editor:

```sql
select pg_get_viewdef('public.v_recommendation_approvals'::regclass, true)
where to_regclass('public.v_recommendation_approvals') is not null;

select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('rpc_approve_recommendation', 'rpc_bulk_update_recommendations');
```

Export the results if objects already exist.

- [ ] **Step 2: Apply the migration manually**

Use Supabase migration tooling or SQL Editor. Do not run from the API.

Expected: transaction commits with no missing relation or missing column errors.

- [ ] **Step 3: Verify objects exist**

Run:

```sql
select
  to_regclass('public.procurement_recommendation_approvals') as approvals_table,
  to_regclass('public.v_recommendation_approvals') as approvals_view;
```

Expected: both are non-null.

- [ ] **Step 4: Verify review rows**

Run:

```sql
select
  count(*) as total_rows,
  count(*) filter (where supplier_status = 'NEEDS_SUPPLIER') as without_supplier,
  count(*) filter (where suggested_qty > 0) as needs_purchase
from public.v_recommendation_approvals;
```

Expected: `total_rows > 0` and counts are plausible against the overview dashboard.

- [ ] **Step 5: Verify a test actor exists**

Run:

```sql
select user_id, display_name, role, is_active
from public.app_user_roles
where is_active
  and role in ('reviewer', 'admin');
```

Expected: at least one eligible user.

- [ ] **Step 6: Test one approval inside a rollback transaction**

Use a real product code and actor ID:

```sql
begin;

select public.rpc_approve_recommendation(
  p_product_code := '<REAL_PRODUCT_CODE>',
  p_decision_status := 'APPROVED',
  p_approved_qty := 1,
  p_approved_supplier_id := null,
  p_approved_supplier_name := 'Verification Supplier',
  p_buyer_note := 'Migration verification',
  p_expected_version := 0,
  p_actor_user_id := '<REAL_ACTOR_UUID>',
  p_request_id := 'manual-verification-001'
);

rollback;
```

Expected: RPC returns JSON and rollback leaves no persisted decision.

- [ ] **Step 7: Record verification evidence**

Save row counts, successful RPC output, and applied migration timestamp in the PR description or deployment notes.

---

### Task 10: End-to-End Replit Verification and Final Gate

**Files:**
- No planned code changes.
- Update code only if verification exposes a reproducible defect, then add a regression test first.

**Interfaces:**
- Consumes the completed frontend, API, and live Supabase objects.
- Produces a verified Procurement Review workflow ready for internal users.

- [ ] **Step 1: Pull the final `main` branch in Replit**

Run:

```bash
git pull origin main
npm install
```

- [ ] **Step 2: Run the complete local verification suite**

Run:

```bash
npm test
npm run build
```

Expected: all tests and builds pass.

- [ ] **Step 3: Start the application**

Use the existing Replit run command.

Verify:

```text
GET /api/health -> 200
GET /api/overview-access/session -> 200
```

- [ ] **Step 4: Verify review page loading**

Open:

```text
/procurement/review
```

Confirm:

- authenticated users can access it
- data loads from Supabase
- KPI values render
- no company filter appears
- aggregated-scope notice appears

- [ ] **Step 5: Verify individual edit and save**

Use a non-critical test product:

- change approved quantity
- keep or change supplier
- set `UNDER_REVIEW`
- add a note
- save
- refresh page

Expected: decision persists, version increments, audit event exists.

- [ ] **Step 6: Verify bulk approval exclusions**

Select:

- one valid product
- one product without supplier
- one product with quantity changed to zero

Open bulk approval.

Expected:

- one valid product is submitted
- no-supplier row is listed as excluded
- zero-quantity row is listed as excluded
- shared note is accepted
- excluded rows remain unchanged after success

- [ ] **Step 7: Verify optimistic concurrency**

Open the same product in two browser sessions.

- save in session A
- attempt to save stale version in session B

Expected: session B receives the Arabic conflict message and does not overwrite session A.

- [ ] **Step 8: Verify audit logging**

Run in Supabase:

```sql
select
  event_type,
  entity_key,
  actor_display_name,
  actor_role,
  note,
  request_id,
  created_at
from public.procurement_audit_events
where module = 'RECOMMENDATION_REVIEW'
order by created_at desc
limit 20;
```

Expected: individual and bulk actions are recorded.

- [ ] **Step 9: Final test and build evidence**

Run:

```bash
npm test
npm run build
```

Capture the passing output before declaring completion.

- [ ] **Step 10: Final commit only if verification produced fixes**

```bash
git add <changed-files>
git commit -m "fix: address procurement review verification findings"
git push origin main
```

Do not create an empty commit when no fixes were needed.
