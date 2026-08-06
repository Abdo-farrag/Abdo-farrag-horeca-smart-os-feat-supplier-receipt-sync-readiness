# Procurement V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready Horeca Smart OS module: an Arabic RTL procurement application that reads the existing Supabase procurement engine through a stable API layer, supports supplier review and product settings, records every mutation, and deploys through GitHub to Replit.

**Architecture:** Use a TypeScript npm-workspace repository with a React web application, a Fastify backend, and shared Zod contracts. The browser talks only to the Replit backend. The backend validates shared-password or Supabase employee sessions, then calls version-controlled Supabase `api_*` views and `rpc_*` functions using the service role. Existing raw tables and forecast views remain untouched.

**Tech Stack:** Node.js 22 LTS, TypeScript, npm workspaces, React, Vite, React Router, TanStack Query, TanStack Table, Fastify, Zod, Supabase JS, ExcelJS, Vitest, Testing Library, Playwright, Supabase CLI, Deno for Edge Function tests.

## Global Constraints

- Use the existing Supabase project `afzxhuaeggrngvchbvur`; do not create a replacement production database.
- Arabic RTL, desktop-first, responsive.
- The frontend never reads internal Supabase tables or uses the service-role key.
- The backend returns recommendations calculated in Supabase; the browser never calculates procurement quantities.
- `available_quantity` from the live database is exposed to the application as `free_qty`.
- Coverage choices are exactly 7, 14, 21, and 30 days; 14 is the default.
- One approved supplier per product across MAS and Horeca Smart.
- Proposed supplier means the last supplier from an actual completed stock receipt.
- Shared password protects Procurement Overview; Supabase Email/Password protects Reviewer and Admin screens.
- Reviewer may approve, reject, change supplier, mark Needs Supplier, and bulk approve only.
- Admin additionally manages product rules, users, audit export, and undo.
- No PO, RFQ, supplier creation, inventory mutation, finance workflow, or AI agent in V1.
- All mutations use optimistic concurrency and write an immutable audit event in the same database transaction.
- No migration is applied to production before it passes against a Supabase development branch or isolated test database.
- The six existing RLS-disabled tables are a separate explicit-approval deployment gate; do not silently enable RLS.

---

## Delivery decomposition

The work is sequenced as independently reviewable vertical slices:

1. Repository and contracts.
2. Database application layer and supplier receipt source.
3. Backend authentication and read APIs.
4. Procurement Overview.
5. Supplier Review and Audit.
6. Product Settings and User Administration.
7. End-to-end hardening and Replit deployment.

Each task ends with a commit and an independently testable result.

---

### Task 1: Create the TypeScript workspace and CI baseline

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `.nvmrc`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `tsconfig.base.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/test/health.test.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/app.css`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` from `apps/api/src/app.ts`.
- Produces: workspace commands `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, and `npm run lint`.

- [ ] **Step 1: Write the failing backend health test**

```ts
// apps/api/test/health.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns the service status', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: { service: 'horeca-smart-os-api', status: 'ok' },
      error: null,
    });
    await app.close();
  });
});
```

- [ ] **Step 2: Create workspace manifests and install dependencies**

```json
// package.json
{
  "name": "horeca-smart-os",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently -k \"npm run dev -w @horeca/api\" \"npm run dev -w @horeca/web\"",
    "build": "npm run build -w @horeca/contracts && npm run build -w @horeca/web && npm run build -w @horeca/api",
    "test": "npm run test -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present",
    "lint": "npm run lint -ws --if-present"
  }
}
```

Run:

```bash
npm install -D concurrently typescript eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
npm install -w apps/api fastify @fastify/cors @fastify/helmet zod
npm install -D -w apps/api tsx vitest @types/node
npm install -w apps/web react react-dom react-router-dom @tanstack/react-query @tanstack/react-table
npm install -D -w apps/web vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom
npm install -w packages/contracts zod
```

Expected: `package-lock.json` is created and all workspaces resolve.

- [ ] **Step 3: Implement the minimal Fastify app**

```ts
// apps/api/src/app.ts
import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({
    data: { service: 'horeca-smart-os-api', status: 'ok' },
    error: null,
  }));

  return app;
}
```

```ts
// apps/api/src/server.ts
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const app = buildApp();

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Implement the Arabic RTL shell**

```tsx
// apps/web/src/App.tsx
export function App() {
  return (
    <main className="app-shell" dir="rtl">
      <h1>Horeca Smart OS</h1>
      <p>وحدة المشتريات قيد التجهيز</p>
    </main>
  );
}
```

```css
/* apps/web/src/app.css */
:root { font-family: Arial, sans-serif; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f7f9; color: #111827; }
.app-shell { min-height: 100vh; padding: 2rem; direction: rtl; }
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: health test passes, TypeScript reports no errors, and both applications build.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: scaffold Horeca Smart OS workspace"
```

---

### Task 2: Define shared API contracts and error envelopes

**Files:**
- Create: `packages/contracts/src/common.ts`
- Create: `packages/contracts/src/procurement.ts`
- Create: `packages/contracts/src/suppliers.ts`
- Create: `packages/contracts/src/settings.ts`
- Create: `packages/contracts/src/audit.ts`
- Create: `packages/contracts/src/users.ts`
- Create: `packages/contracts/test/contracts.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `OverviewQuerySchema`, `ProcurementOverviewResponseSchema`, `SupplierDecisionSchema`, `ProductRuleUpdateSchema`, `AuditQuerySchema`, and `ApiErrorSchema`.
- Produces: inferred TypeScript types consumed by both API and web workspaces.

- [ ] **Step 1: Write failing contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { OverviewQuerySchema, SupplierDecisionSchema } from '../src/index.js';

describe('procurement contracts', () => {
  it('defaults coverage to 14 days', () => {
    expect(OverviewQuerySchema.parse({})).toMatchObject({ coverageDays: 14, page: 1, pageSize: 50 });
  });

  it('rejects unsupported bulk decisions', () => {
    expect(() => SupplierDecisionSchema.parse({ action: 'bulk-reject' })).toThrow();
  });
});
```

- [ ] **Step 2: Implement common schemas**

```ts
// packages/contracts/src/common.ts
import { z } from 'zod';

export const CompanyFilterSchema = z.union([z.literal('all'), z.literal('1'), z.literal('2')]);
export const CoverageDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(30)]);
export const PrioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const SupplierStatusSchema = z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_SUPPLIER']);

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(200),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
```

- [ ] **Step 3: Implement procurement query and row schemas**

```ts
// packages/contracts/src/procurement.ts
import { z } from 'zod';
import { CompanyFilterSchema, CoverageDaysSchema, PaginationSchema, PrioritySchema, SupplierStatusSchema } from './common.js';

export const OverviewQuerySchema = z.object({
  company: CompanyFilterSchema.default('all'),
  coverageDays: z.coerce.number().pipe(CoverageDaysSchema).default(14),
  priorities: z.array(PrioritySchema).default([]),
  supplierStatuses: z.array(SupplierStatusSchema).default([]),
  needsPurchase: z.coerce.boolean().optional(),
  noSupplier: z.coerce.boolean().optional(),
  insufficientData: z.coerce.boolean().optional(),
  search: z.string().trim().max(120).default(''),
  sort: z.enum(['priority', 'suggestedQty', 'coverageDays', 'productName', 'latestReceipt']).default('priority'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const ProcurementRowSchema = z.object({
  productCode: z.string(),
  productName: z.string(),
  freeQty: z.number(),
  effectiveDailyDemand: z.number(),
  forecastQty: z.number().nullable(),
  leadTimeQty: z.number().nullable(),
  safetyStockQty: z.number().nullable(),
  actualCoverageDays: z.number().nullable(),
  leadTimeDays: z.number().int(),
  safetyStockDays: z.number().int(),
  suggestedQty: z.number().nullable(),
  priority: PrioritySchema,
  dataStatus: z.enum(['SUFFICIENT', 'INSUFFICIENT']),
  proposedSupplierName: z.string().nullable(),
  approvedSupplierName: z.string().nullable(),
  supplierStatus: SupplierStatusSchema,
  latestReceiptAt: z.string().datetime().nullable(),
  version: z.number().int().nonnegative(),
});

export const ProcurementOverviewResponseSchema = z.object({
  data: z.object({
    rows: z.array(ProcurementRowSchema),
    summary: z.object({
      needsPurchase: z.number().int().nonnegative(),
      critical: z.number().int().nonnegative(),
      totalSuggestedQty: z.number().nonnegative(),
      noSupplier: z.number().int().nonnegative(),
      insufficientData: z.number().int().nonnegative(),
    }),
    pagination: PaginationSchema,
  }),
  error: z.null(),
});
```

- [ ] **Step 4: Implement mutation contracts**

```ts
// packages/contracts/src/suppliers.ts
import { z } from 'zod';

export const SupplierDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve'), supplierId: z.number().int().positive(), supplierName: z.string().min(1), expectedVersion: z.number().int().nonnegative(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('reject'), expectedVersion: z.number().int().nonnegative(), note: z.string().max(500).optional() }),
  z.object({ action: z.literal('needs-supplier'), expectedVersion: z.number().int().nonnegative(), note: z.string().max(500).optional() }),
]);

export const BulkApproveSchema = z.object({
  items: z.array(z.object({ productCode: z.string(), supplierId: z.number().int().positive(), supplierName: z.string().min(1), expectedVersion: z.number().int().nonnegative() })).min(1).max(200),
});
```

- [ ] **Step 5: Run and commit**

```bash
npm test -w @horeca/contracts
npm run typecheck -w @horeca/contracts
git add packages/contracts
git commit -m "feat: define shared procurement contracts"
```

Expected: contract tests pass.

---

### Task 3: Add the non-destructive Supabase application schema

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260724090000_procurement_v1_core.sql`
- Create: `supabase/tests/procurement_v1_core.sql`
- Create: `docs/database/procurement-v1-data-contract.md`

**Interfaces:**
- Produces tables: `app_user_roles`, `procurement_product_rules`, `procurement_supplier_receipts`, `procurement_supplier_reviews`, `procurement_audit_events`.
- Produces helper function: `procurement_actor_role(uuid)`.
- All new tables have RLS enabled and no browser-readable policies.

- [ ] **Step 1: Write the pgTAP-style failing assertions**

```sql
-- supabase/tests/procurement_v1_core.sql
begin;
select plan(10);
select has_table('public', 'procurement_product_rules');
select has_table('public', 'procurement_supplier_receipts');
select has_table('public', 'procurement_supplier_reviews');
select has_table('public', 'procurement_audit_events');
select has_table('public', 'app_user_roles');
select col_is_pk('public', 'procurement_product_rules', 'product_code');
select col_is_pk('public', 'procurement_supplier_reviews', 'product_code');
select col_is_unique('public', 'procurement_supplier_receipts', 'odoo_receipt_line_id');
select table_privs_are('public', 'procurement_audit_events', 'anon', array[]::text[]);
select table_privs_are('public', 'procurement_audit_events', 'authenticated', array[]::text[]);
select * from finish();
rollback;
```

- [ ] **Step 2: Create the migration**

```sql
-- supabase/migrations/20260724090000_procurement_v1_core.sql
create table public.app_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('reviewer', 'admin')),
  is_active boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

create table public.procurement_product_rules (
  product_code text primary key,
  lead_time_days integer not null default 4 check (lead_time_days between 0 and 90),
  safety_stock_days integer not null default 7 check (safety_stock_days between 0 and 60),
  order_multiple numeric not null default 1 check (order_multiple > 0),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

create table public.procurement_supplier_receipts (
  id bigint generated always as identity primary key,
  odoo_receipt_line_id bigint not null unique,
  receipt_id bigint not null,
  receipt_name text not null,
  company_id bigint not null check (company_id in (1, 2)),
  product_id bigint null,
  product_code text not null,
  product_name text not null,
  supplier_id bigint not null,
  supplier_name text not null,
  received_qty numeric not null check (received_qty > 0),
  unit_cost numeric null check (unit_cost is null or unit_cost >= 0),
  received_at timestamptz not null,
  source_updated_at timestamptz null,
  synced_at timestamptz not null default now()
);

create index procurement_supplier_receipts_product_latest_idx
  on public.procurement_supplier_receipts (product_code, received_at desc, received_qty desc, supplier_id asc);

create table public.procurement_supplier_reviews (
  product_code text primary key,
  approved_supplier_id bigint null,
  approved_supplier_name text null,
  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_SUPPLIER')),
  note text null,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);

create table public.procurement_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  module text not null,
  entity_type text not null,
  entity_key text not null,
  actor_user_id uuid null references auth.users(id),
  actor_role text null,
  old_data jsonb null,
  new_data jsonb null,
  note text null,
  batch_id uuid null,
  undo_of uuid null references public.procurement_audit_events(id),
  request_id text not null,
  created_at timestamptz not null default now()
);

create index procurement_audit_events_entity_idx
  on public.procurement_audit_events (entity_type, entity_key, created_at desc);
create index procurement_audit_events_actor_idx
  on public.procurement_audit_events (actor_user_id, created_at desc);

alter table public.app_user_roles enable row level security;
alter table public.procurement_product_rules enable row level security;
alter table public.procurement_supplier_receipts enable row level security;
alter table public.procurement_supplier_reviews enable row level security;
alter table public.procurement_audit_events enable row level security;

revoke all on public.app_user_roles from anon, authenticated;
revoke all on public.procurement_product_rules from anon, authenticated;
revoke all on public.procurement_supplier_receipts from anon, authenticated;
revoke all on public.procurement_supplier_reviews from anon, authenticated;
revoke all on public.procurement_audit_events from anon, authenticated;

grant all on public.app_user_roles to service_role;
grant all on public.procurement_product_rules to service_role;
grant all on public.procurement_supplier_receipts to service_role;
grant all on public.procurement_supplier_reviews to service_role;
grant all on public.procurement_audit_events to service_role;
```

- [ ] **Step 3: Validate on an isolated database**

Run:

```bash
supabase start
supabase db reset
supabase test db
```

Expected: migration completes and all ten assertions pass.

- [ ] **Step 4: Document the contract and commit**

```bash
git add supabase docs/database/procurement-v1-data-contract.md
git commit -m "feat: add Procurement V1 application schema"
```

---

### Task 4: Add actual supplier receipt synchronization from Odoo 18

**Files:**
- Create: `supabase/functions/_shared/odoo.ts`
- Create: `supabase/functions/_shared/receipt-mapper.ts`
- Create: `supabase/functions/_shared/receipt-mapper.test.ts`
- Create: `supabase/functions/sync-odoo18-supplier-receipts/index.ts`
- Create: `supabase/migrations/20260724093000_supplier_receipt_sync.sql`
- Modify: `docs/database/procurement-v1-data-contract.md`

**Interfaces:**
- Produces: `mapOdooReceiptLine(raw): SupplierReceiptRow`.
- Writes idempotently to `procurement_supplier_receipts` by `odoo_receipt_line_id`.
- Writes `sync_logs.sync_type = 'supplier_receipts_by_company'`.

- [ ] **Step 1: Write the failing mapper test**

```ts
Deno.test('maps a completed incoming receipt line', () => {
  const row = mapOdooReceiptLine({
    id: 901,
    picking_id: [88, 'WH/IN/00088'],
    company_id: [1, 'MAS'],
    product_id: [55, '[P-55] Product'],
    partner_id: [77, 'Supplier A'],
    quantity: 12,
    price_unit: 54.5,
    date_done: '2026-07-23T10:00:00Z',
    write_date: '2026-07-23T10:05:00Z',
  });

  assertEquals(row.product_code, 'P-55');
  assertEquals(row.supplier_id, 77);
  assertEquals(row.received_qty, 12);
});
```

- [ ] **Step 2: Implement strict mapping**

```ts
// supabase/functions/_shared/receipt-mapper.ts
export type SupplierReceiptRow = {
  odoo_receipt_line_id: number;
  receipt_id: number;
  receipt_name: string;
  company_id: number;
  product_id: number;
  product_code: string;
  product_name: string;
  supplier_id: number;
  supplier_name: string;
  received_qty: number;
  unit_cost: number | null;
  received_at: string;
  source_updated_at: string | null;
};

export function mapOdooReceiptLine(raw: Record<string, unknown>): SupplierReceiptRow {
  const product = raw.product_id as [number, string];
  const supplier = raw.partner_id as [number, string];
  const picking = raw.picking_id as [number, string];
  const company = raw.company_id as [number, string];
  const match = product[1].match(/^\[([^\]]+)\]\s*(.*)$/);

  if (!match || !raw.date_done || Number(raw.quantity) <= 0) {
    throw new Error('INVALID_COMPLETED_RECEIPT_LINE');
  }

  return {
    odoo_receipt_line_id: Number(raw.id),
    receipt_id: picking[0],
    receipt_name: picking[1],
    company_id: company[0],
    product_id: product[0],
    product_code: match[1].trim(),
    product_name: match[2].trim(),
    supplier_id: supplier[0],
    supplier_name: supplier[1],
    received_qty: Number(raw.quantity),
    unit_cost: raw.price_unit == null ? null : Number(raw.price_unit),
    received_at: String(raw.date_done),
    source_updated_at: raw.write_date == null ? null : String(raw.write_date),
  };
}
```

- [ ] **Step 3: Implement the Edge Function query boundary**

The function must request only completed incoming receipt lines for company IDs 1 and 2, paginate by Odoo line ID, and upsert batches of 500 rows. It must never treat draft purchase orders as receipts.

```ts
const domain = [
  ['state', '=', 'done'],
  ['picking_code', '=', 'incoming'],
  ['company_id', 'in', [1, 2]],
  ['quantity', '>', 0],
  ['id', '>', lastSeenId],
];
```

- [ ] **Step 4: Run tests and local function check**

```bash
deno test supabase/functions/_shared/receipt-mapper.test.ts
supabase functions serve sync-odoo18-supplier-receipts --env-file supabase/.env.local
```

Expected: mapper test passes; local function returns HTTP 200 with inserted/updated counts when valid development credentials are present.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions supabase/migrations docs/database
git commit -m "feat: sync actual Odoo supplier receipts"
```

---

### Task 5: Build stable Supabase read views and transactional RPCs

**Files:**
- Create: `supabase/migrations/20260724100000_procurement_api_layer.sql`
- Create: `supabase/tests/procurement_api_layer.sql`
- Create: `docs/api/procurement-api-contract.md`

**Interfaces:**
- Produces views: `api_procurement_company_source`, `api_latest_supplier_receipt`, `api_supplier_history`, `api_sync_status`.
- Produces RPCs: `rpc_get_procurement_overview`, `rpc_get_procurement_product_details`, `rpc_get_supplier_review_queue`, `rpc_review_supplier`, `rpc_bulk_approve_suppliers`, `rpc_update_product_rule`, `rpc_bulk_update_product_rules`, `rpc_get_audit_log`, `rpc_undo_audit_event`.

- [ ] **Step 1: Write failing SQL assertions for the approved formula**

Seed a product with daily demand `10`, `free_qty = 40`, coverage `14`, lead time `4`, safety `7`, and order multiple `1`.

Expected:

```text
forecast_qty = 140
lead_time_qty = 40
safety_stock_qty = 70
suggested_qty = 210
```

The test must also assert that an insufficient-data product returns `suggested_qty = null`.

- [ ] **Step 2: Create the company source and latest-receipt views**

```sql
create or replace view public.api_procurement_company_source as
select
  r.company_id,
  r.company_name,
  r.product_id,
  r.product_code,
  r.effective_product_name as product_name,
  r.available_quantity as free_qty,
  r.effective_daily_demand,
  r.last_sale_date,
  r.snapshot_at,
  coalesce(pr.lead_time_days, 4) as lead_time_days,
  coalesce(pr.safety_stock_days, 7) as safety_stock_days,
  coalesce(pr.order_multiple, 1) as order_multiple,
  case
    when r.demand_method = 'MANUAL' and r.manual_daily_demand is not null then 'SUFFICIENT'
    when coalesce(r.sales_qty_90d, 0) > 0 and r.last_sale_date is not null then 'SUFFICIENT'
    else 'INSUFFICIENT'
  end as data_status
from public.v_procurement_recommendation_configurable r
left join public.procurement_product_rules pr using (product_code);

create or replace view public.api_latest_supplier_receipt as
select distinct on (product_code)
  product_code,
  supplier_id,
  supplier_name,
  received_at,
  received_qty,
  unit_cost,
  company_id
from public.procurement_supplier_receipts
order by product_code, received_at desc, received_qty desc, supplier_id asc;
```

- [ ] **Step 3: Implement `rpc_get_procurement_overview`**

The function must aggregate company rows after applying the selected company filter, calculate the formula in SQL, join the global supplier review, then apply server-side filtering, sorting, and pagination. Its final JSON keys must match `ProcurementOverviewResponseSchema`.

Core calculation:

```sql
case when data_status = 'INSUFFICIENT' then null else daily_demand * p_coverage_days end as forecast_qty,
case when data_status = 'INSUFFICIENT' then null else daily_demand * lead_time_days end as lead_time_qty,
case when data_status = 'INSUFFICIENT' then null else daily_demand * safety_stock_days end as safety_stock_qty,
case
  when data_status = 'INSUFFICIENT' then null
  when daily_demand <= 0 then 0
  else ceil(greatest(
    daily_demand * (p_coverage_days + lead_time_days + safety_stock_days) - free_qty,
    0
  ) / order_multiple) * order_multiple
end as suggested_qty
```

Priority calculation:

```sql
case
  when data_status = 'INSUFFICIENT' then 'LOW'
  when daily_demand <= 0 then 'LOW'
  when free_qty / nullif(daily_demand, 0) <= lead_time_days then 'CRITICAL'
  when free_qty / nullif(daily_demand, 0) <= lead_time_days + safety_stock_days then 'HIGH'
  when free_qty / nullif(daily_demand, 0) <= lead_time_days + safety_stock_days + p_coverage_days then 'MEDIUM'
  else 'LOW'
end
```

- [ ] **Step 4: Implement atomic supplier decision and audit RPC**

```sql
create or replace function public.rpc_review_supplier(
  p_product_code text,
  p_action text,
  p_supplier_id bigint,
  p_supplier_name text,
  p_expected_version bigint,
  p_note text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.procurement_supplier_reviews;
  v_new public.procurement_supplier_reviews;
begin
  select * into v_old
  from public.procurement_supplier_reviews
  where product_code = p_product_code
  for update;

  if found and v_old.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;

  insert into public.procurement_supplier_reviews (
    product_code, approved_supplier_id, approved_supplier_name, status, note, version, updated_by
  ) values (
    p_product_code,
    case when p_action = 'approve' then p_supplier_id else null end,
    case when p_action = 'approve' then p_supplier_name else null end,
    case p_action
      when 'approve' then 'APPROVED'
      when 'reject' then 'REJECTED'
      when 'needs-supplier' then 'NEEDS_SUPPLIER'
      else 'PENDING_REVIEW'
    end,
    p_note,
    coalesce(v_old.version, 0) + 1,
    p_actor_user_id
  )
  on conflict (product_code) do update set
    approved_supplier_id = excluded.approved_supplier_id,
    approved_supplier_name = excluded.approved_supplier_name,
    status = excluded.status,
    note = excluded.note,
    version = excluded.version,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning * into v_new;

  insert into public.procurement_audit_events (
    event_type, module, entity_type, entity_key, actor_user_id, actor_role,
    old_data, new_data, note, request_id
  ) values (
    upper(p_action), 'SUPPLIER_REVIEW', 'PRODUCT', p_product_code,
    p_actor_user_id, p_actor_role, to_jsonb(v_old), to_jsonb(v_new), p_note, p_request_id
  );

  return to_jsonb(v_new);
end;
$$;
```

- [ ] **Step 5: Revoke browser execution and test**

```sql
revoke all on function public.rpc_review_supplier(text,text,bigint,text,bigint,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.rpc_review_supplier(text,text,bigint,text,bigint,text,uuid,text,text) to service_role;
```

Run:

```bash
supabase db reset
supabase test db
```

Expected: formula, latest supplier tie-break, version conflict, audit atomicity, and permissions tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests docs/api
git commit -m "feat: add stable procurement API layer"
```

---

### Task 6: Implement backend configuration, Supabase clients, and authentication

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/lib/supabase.ts`
- Create: `apps/api/src/plugins/request-id.ts`
- Create: `apps/api/src/plugins/error-handler.ts`
- Create: `apps/api/src/plugins/overview-session.ts`
- Create: `apps/api/src/plugins/employee-auth.ts`
- Create: `apps/api/src/routes/overview-access.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/test/overview-access.test.ts`
- Create: `apps/api/test/employee-auth.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces request decorators `request.requestId`, `request.employee`, and `request.hasOverviewSession`.
- Produces guards `requireOverviewAccess`, `requireEmployee`, and `requireAdmin`.

- [ ] **Step 1: Add environment schema**

```ts
// apps/api/src/config.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  OVERVIEW_PASSWORD_HASH: z.string().min(20),
  SESSION_SECRET: z.string().min(32),
});

export type AppConfig = z.infer<typeof EnvSchema>;
export const config = EnvSchema.parse(process.env);
```

- [ ] **Step 2: Write shared-password tests**

Test cases:

- correct password returns 204 and an HttpOnly, Secure, SameSite=Strict cookie;
- incorrect password returns 401;
- six failed attempts from one IP within fifteen minutes return 429;
- logout clears the cookie;
- the raw password never appears in logs or response bodies.

- [ ] **Step 3: Implement overview session login**

Use `bcryptjs.compare()` and `@fastify/secure-session`. Store only `{ overview: true, expiresAt }` in the encrypted cookie. Set eight-hour expiry.

- [ ] **Step 4: Implement employee authentication**

For every protected request:

1. Parse `Authorization: Bearer <token>`.
2. Call `supabase.auth.getUser(token)`.
3. Query `app_user_roles` by returned user ID.
4. Reject missing or inactive roles.
5. Attach `{ userId, displayName, role }` to the request.

- [ ] **Step 5: Run and commit**

```bash
npm test -w @horeca/api -- overview-access employee-auth
npm run typecheck -w @horeca/api
git add apps/api .env.example
git commit -m "feat: add secure overview and employee authentication"
```

---

### Task 7: Implement backend procurement read APIs and exports

**Files:**
- Create: `apps/api/src/repositories/procurement-repository.ts`
- Create: `apps/api/src/services/procurement-service.ts`
- Create: `apps/api/src/routes/procurement.ts`
- Create: `apps/api/src/routes/exports.ts`
- Create: `apps/api/src/lib/export-workbook.ts`
- Create: `apps/api/test/procurement-routes.test.ts`
- Create: `apps/api/test/export.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces endpoints:
  - `GET /api/procurement/overview`
  - `GET /api/procurement/products/:productCode`
  - `GET /api/procurement/sync-status`
  - `GET /api/procurement/export?format=csv|xlsx`

- [ ] **Step 1: Write route tests using a fake repository**

Assert:

- query strings are parsed by `OverviewQuerySchema`;
- unsupported coverage returns 400;
- overview-session and employee-session users can read Overview;
- CSV and XLSX exports reuse the exact current filters;
- export caps at 25,000 rows and returns 413 above the cap;
- stale sync state is returned, not hidden.

- [ ] **Step 2: Implement repository RPC calls**

```ts
export async function getOverview(query: OverviewQuery) {
  const { data, error } = await supabase.rpc('rpc_get_procurement_overview', {
    p_company_id: query.company === 'all' ? null : Number(query.company),
    p_coverage_days: query.coverageDays,
    p_search: query.search || null,
    p_priorities: query.priorities,
    p_supplier_statuses: query.supplierStatuses,
    p_needs_purchase: query.needsPurchase ?? null,
    p_no_supplier: query.noSupplier ?? null,
    p_insufficient_data: query.insufficientData ?? null,
    p_sort: query.sort,
    p_direction: query.direction,
    p_page: query.page,
    p_page_size: query.pageSize,
  });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 3: Implement export generation**

Use ExcelJS server-side. Arabic sheet name: `توصيات المشتريات`. Columns must match the visible table and include applied filters in a metadata sheet.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @horeca/api -- procurement-routes export
npm run typecheck -w @horeca/api
git add apps/api
git commit -m "feat: expose procurement overview and export APIs"
```

---

### Task 8: Build the frontend shell, access screens, and API client

**Files:**
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/lib/api-client.ts`
- Create: `apps/web/src/lib/query-client.ts`
- Create: `apps/web/src/auth/AuthProvider.tsx`
- Create: `apps/web/src/auth/ProtectedRoute.tsx`
- Create: `apps/web/src/layout/AppLayout.tsx`
- Create: `apps/web/src/layout/Sidebar.tsx`
- Create: `apps/web/src/pages/OverviewAccessPage.tsx`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/components/EmptyState.tsx`
- Create: `apps/web/src/components/ErrorState.tsx`
- Create: `apps/web/src/test/router.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/app.css`

**Interfaces:**
- Produces `apiClient<T>()` with credentials included and normalized error envelopes.
- Produces route guards for overview session, Reviewer, and Admin.

- [ ] **Step 1: Write routing tests**

Assert:

- `/procurement` redirects to `/overview-access` without a valid overview session;
- `/procurement/suppliers-review` redirects to `/login` without employee auth;
- Reviewer cannot open `/admin/users`;
- Admin can open every V1 route.

- [ ] **Step 2: Implement app routes**

```tsx
const router = createBrowserRouter([
  { path: '/overview-access', element: <OverviewAccessPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/procurement', element: <ProcurementOverviewPage /> },
      { path: '/procurement/suppliers-review', element: <ProtectedRoute roles={['reviewer', 'admin']}><SupplierReviewPage /></ProtectedRoute> },
      { path: '/procurement/product-settings', element: <ProtectedRoute roles={['admin']}><ProductSettingsPage /></ProtectedRoute> },
      { path: '/procurement/audit-log', element: <ProtectedRoute roles={['reviewer', 'admin']}><AuditLogPage /></ProtectedRoute> },
      { path: '/admin/users', element: <ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute> },
    ],
  },
]);
```

- [ ] **Step 3: Implement RTL layout and sidebar**

The active procurement routes are enabled. Future modules appear disabled and do not navigate.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @horeca/web -- router
npm run typecheck -w @horeca/web
git add apps/web
git commit -m "feat: add RTL application shell and access flows"
```

---

### Task 9: Implement Procurement Overview UI

**Files:**
- Create: `apps/web/src/features/procurement/api.ts`
- Create: `apps/web/src/features/procurement/useOverviewFilters.ts`
- Create: `apps/web/src/features/procurement/OverviewFilters.tsx`
- Create: `apps/web/src/features/procurement/OverviewKpis.tsx`
- Create: `apps/web/src/features/procurement/DataFreshnessAlert.tsx`
- Create: `apps/web/src/features/procurement/ProcurementTable.tsx`
- Create: `apps/web/src/features/procurement/ProductDetailsRow.tsx`
- Create: `apps/web/src/pages/ProcurementOverviewPage.tsx`
- Create: `apps/web/src/features/procurement/ProcurementOverviewPage.test.tsx`

**Interfaces:**
- URL query string is the source of filter state.
- `useProcurementOverview()` returns validated contract data.

- [ ] **Step 1: Write the page behavior tests**

Assert:

- initial request uses `company=all` and `coverageDays=14`;
- clicking Critical KPI sets `priorities=CRITICAL` in the URL;
- expanding a row shows MAS and Horeca breakdown;
- insufficient products display `بيانات غير كافية` and no quantity;
- stale sync displays an alert;
- export sends the current URL filters.

- [ ] **Step 2: Implement server-state query**

```ts
export function useProcurementOverview(filters: OverviewQuery) {
  return useQuery({
    queryKey: ['procurement-overview', filters],
    queryFn: () => apiClient(`/api/procurement/overview?${toSearchParams(filters)}`, ProcurementOverviewResponseSchema),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 3: Implement table and accessible statuses**

Every status includes Arabic text and an icon. Do not use color as the only signal. Pagination is server-side. Search is debounced by 300 ms.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @horeca/web -- ProcurementOverviewPage
npm run typecheck -w @horeca/web
git add apps/web/src/features/procurement apps/web/src/pages/ProcurementOverviewPage.tsx
git commit -m "feat: build Procurement Overview screen"
```

---

### Task 10: Implement Supplier Review, bulk approve, and admin undo

**Files:**
- Create: `apps/api/src/repositories/supplier-review-repository.ts`
- Create: `apps/api/src/routes/supplier-reviews.ts`
- Create: `apps/api/test/supplier-reviews.test.ts`
- Create: `apps/web/src/features/suppliers/SupplierReviewTable.tsx`
- Create: `apps/web/src/features/suppliers/SupplierReviewDrawer.tsx`
- Create: `apps/web/src/features/suppliers/BulkApproveDialog.tsx`
- Create: `apps/web/src/pages/SupplierReviewPage.tsx`
- Create: `apps/web/src/features/suppliers/SupplierReviewPage.test.tsx`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Endpoints:
  - `GET /api/supplier-reviews`
  - `GET /api/supplier-reviews/:productCode/history`
  - `POST /api/supplier-reviews/:productCode/decision`
  - `POST /api/supplier-reviews/bulk-approve`
  - `POST /api/audit/:eventId/undo`

- [ ] **Step 1: Write mutation tests**

Assert:

- Reviewer can approve, reject, change supplier, and mark Needs Supplier;
- Reviewer cannot call undo;
- bulk endpoint accepts only approve items;
- stale `expectedVersion` returns HTTP 409;
- a successful mutation writes one audit event;
- a failed audit insert rolls back the business mutation.

- [ ] **Step 2: Implement route validation and RPC mapping**

Map PostgreSQL `40001 / VERSION_CONFLICT` to:

```json
{
  "data": null,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "تم تعديل السجل بواسطة مستخدم آخر. حدّث الصفحة وحاول مرة أخرى.",
    "requestId": "..."
  }
}
```

- [ ] **Step 3: Implement drawer workflow**

The drawer shows the latest supplier first, followed by historical suppliers ordered by latest receipt. Choosing a supplier does not save until the user confirms the decision.

- [ ] **Step 4: Implement bulk approve safeguards**

Selection is enabled only for Pending Review rows that have a proposed supplier. Reject and supplier change remain single-product actions.

- [ ] **Step 5: Verify and commit**

```bash
npm test -w @horeca/api -- supplier-reviews
npm test -w @horeca/web -- SupplierReviewPage
git add apps/api apps/web/src/features/suppliers apps/web/src/pages/SupplierReviewPage.tsx
git commit -m "feat: add supplier review workflow"
```

---

### Task 11: Implement product rules and immediate recalculation preview

**Files:**
- Create: `apps/api/src/repositories/product-rules-repository.ts`
- Create: `apps/api/src/routes/product-rules.ts`
- Create: `apps/api/test/product-rules.test.ts`
- Create: `apps/web/src/features/settings/ProductRulesTable.tsx`
- Create: `apps/web/src/features/settings/EditProductRuleDialog.tsx`
- Create: `apps/web/src/features/settings/BulkProductRuleDialog.tsx`
- Create: `apps/web/src/pages/ProductSettingsPage.tsx`
- Create: `apps/web/src/features/settings/ProductSettingsPage.test.tsx`

**Interfaces:**
- Endpoints:
  - `GET /api/product-rules`
  - `PATCH /api/product-rules/:productCode`
  - `PATCH /api/product-rules/bulk`

- [ ] **Step 1: Write validation and authorization tests**

Assert:

- Reviewer receives 403;
- Lead Time accepts integers 0–90;
- Safety Stock accepts integers 0–60;
- invalid values return 400 without mutation;
- stale versions return 409;
- response includes before and after suggested quantity using the current default coverage of 14 days.

- [ ] **Step 2: Implement atomic rule update RPC call**

Payload:

```ts
{
  leadTimeDays: number;
  safetyStockDays: number;
  expectedVersion: number;
  note?: string;
}
```

The SQL RPC updates the global product rule, increments version, records the audit event, and returns the recalculated product row from `rpc_get_procurement_product_details`.

- [ ] **Step 3: Implement single and bulk dialogs**

Bulk edit allows setting Lead Time, Safety Stock Days, or both. It displays the product count and requires confirmation.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @horeca/api -- product-rules
npm test -w @horeca/web -- ProductSettingsPage
git add apps/api apps/web/src/features/settings apps/web/src/pages/ProductSettingsPage.tsx
git commit -m "feat: add product procurement settings"
```

---

### Task 12: Implement Audit Log and User Administration

**Files:**
- Create: `apps/api/src/routes/audit.ts`
- Create: `apps/api/src/routes/admin-users.ts`
- Create: `apps/api/src/services/admin-users-service.ts`
- Create: `apps/api/test/audit.test.ts`
- Create: `apps/api/test/admin-users.test.ts`
- Create: `apps/web/src/features/audit/AuditTable.tsx`
- Create: `apps/web/src/features/audit/AuditDetailsDrawer.tsx`
- Create: `apps/web/src/pages/AuditLogPage.tsx`
- Create: `apps/web/src/features/users/UsersTable.tsx`
- Create: `apps/web/src/features/users/InviteUserDialog.tsx`
- Create: `apps/web/src/pages/UsersPage.tsx`

**Interfaces:**
- Endpoints:
  - `GET /api/audit`
  - `GET /api/admin/users`
  - `POST /api/admin/users/invite`
  - `PATCH /api/admin/users/:userId/role`
  - `PATCH /api/admin/users/:userId/status`
  - `POST /api/admin/users/:userId/password-reset`

- [ ] **Step 1: Write audit visibility tests**

Reviewer sees Supplier Review events only. Admin sees all events. Neither role can edit or delete an audit event.

- [ ] **Step 2: Write user safety tests**

Assert:

- only Admin can invite or modify users;
- an Auth user without an active `app_user_roles` row is denied;
- the last active Admin cannot be disabled or demoted;
- password reset uses Supabase email and never returns a password;
- invite failure caused by missing SMTP does not create an active role row.

- [ ] **Step 3: Implement user management with compensation**

Invitation flow:

1. Send Supabase Admin invitation.
2. Upsert inactive role metadata tied to the invited user ID.
3. Activate the role only after the invitation succeeds.
4. Audit the action without storing tokens or passwords.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @horeca/api -- audit admin-users
npm test -w @horeca/web -- AuditLogPage UsersPage
git add apps/api apps/web/src/features/audit apps/web/src/features/users apps/web/src/pages
git commit -m "feat: add audit log and user administration"
```

---

### Task 13: Add full integration and end-to-end coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/overview.spec.ts`
- Create: `e2e/supplier-review.spec.ts`
- Create: `e2e/product-settings.spec.ts`
- Create: `e2e/user-admin.spec.ts`
- Create: `scripts/seed-e2e.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces repeatable seeded E2E environment with one overview password, one Reviewer, one Admin, and deterministic product/supplier fixtures.

- [ ] **Step 1: Add E2E seed fixtures**

Fixtures must include:

- Critical product with supplier receipt.
- Product with insufficient data.
- Product without supplier.
- Approved product that can be undone by Admin.
- Two historical suppliers with a deterministic latest-receipt winner.

- [ ] **Step 2: Implement browser journeys**

Overview journey:

```ts
await page.goto('/overview-access');
await page.getByLabel('كلمة المرور').fill(process.env.E2E_OVERVIEW_PASSWORD!);
await page.getByRole('button', { name: 'دخول' }).click();
await expect(page.getByRole('heading', { name: 'نظرة عامة على المشتريات' })).toBeVisible();
```

Supplier journey must approve the latest receiving supplier and confirm the audit entry. Product Settings journey must change Lead Time and confirm the displayed before/after quantity.

- [ ] **Step 3: Add CI gates**

CI order:

```text
install → lint → typecheck → unit tests → Supabase migration tests → build → Playwright
```

- [ ] **Step 4: Run and commit**

```bash
npm run test
npm run typecheck
npm run build
npx playwright test
git add .github playwright.config.ts e2e scripts
git commit -m "test: add Procurement V1 end-to-end coverage"
```

---

### Task 14: Configure Replit production deployment and release gates

**Files:**
- Create: `.replit`
- Create: `replit.nix`
- Create: `Dockerfile`
- Create: `docs/deployment/replit.md`
- Create: `docs/deployment/release-checklist.md`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Modify: `README.md`

**Interfaces:**
- Production command serves the built React files from Fastify and exposes `/api/*` from the same origin.
- Replit Secrets contain all production secrets; no secret is committed.

- [ ] **Step 1: Serve the frontend build from Fastify**

Register `@fastify/static` for `apps/web/dist`; return `index.html` for non-API routes. Never serve a fallback for `/api/*`.

- [ ] **Step 2: Create deployment configuration**

```toml
# .replit
run = "npm run start"
entrypoint = "apps/api/dist/server.js"

[deployment]
run = ["sh", "-c", "npm run build && npm run start"]
deploymentTarget = "autoscale"
```

Required Replit Secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
OVERVIEW_PASSWORD_HASH
SESSION_SECRET
```

- [ ] **Step 3: Execute release checklist**

The checklist must verify:

- production Supabase project ref is correct;
- migrations are reviewed and backed up;
- supplier receipt sync has at least one successful run;
- sales and forecast sync are fresh;
- at least one active Admin exists;
- SMTP invitation and password reset work;
- service-role key is absent from the browser bundle;
- shared password cookie is Secure and HttpOnly;
- CSV/XLSX export respects filters;
- rollback commit and database rollback SQL are documented.

- [ ] **Step 4: Resolve the existing RLS deployment gate**

Before production launch, review policies for the six RLS-disabled legacy/staging tables recorded in `docs/database/2026-07-24-live-supabase-audit.md`. Apply RLS only after explicit approval and a policy test proving required sync/import jobs continue to work.

- [ ] **Step 5: Final verification and commit**

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright test
git add .replit replit.nix Dockerfile docs/deployment apps/api README.md
git commit -m "chore: configure Replit production deployment"
```

Expected: every command exits 0; production smoke test returns 200 for `/api/health` and loads `/procurement` through the shared-password gate.

---

## Plan self-review

### Spec coverage

- Procurement Overview: Tasks 5, 7, 8, and 9.
- Supplier Review and latest actual receiving supplier: Tasks 4, 5, and 10.
- Product Settings: Tasks 3, 5, and 11.
- Audit and Undo: Tasks 3, 5, 10, and 12.
- Shared password and employee authentication: Tasks 6 and 8.
- Reviewer/Admin authorization and user management: Tasks 6, 8, and 12.
- Server-side filters, pagination, and exports: Tasks 5, 7, and 9.
- Sync monitoring and stale warnings: Tasks 5, 7, and 9.
- Testing and deployment: Tasks 13 and 14.

### Explicit data gaps addressed

- Actual supplier receipt history did not exist; Task 4 adds it before Supplier Review.
- Existing recommendation formula differs from the approved formula; Task 5 builds a new stable API calculation without altering the existing view.
- Existing settings are per company while V1 decisions are global per product; Task 3 adds a non-destructive global rule table.
- Six legacy/staging tables have RLS disabled; Task 14 treats remediation as an explicit deployment gate rather than silently changing access.

### Placeholder scan

The plan contains no `TBD`, `TODO`, `implement later`, or unspecified error-handling steps. Exact paths, interfaces, commands, expected behavior, and mutation boundaries are defined.

### Type and naming consistency

- Product identity is `productCode` in TypeScript and `product_code` in PostgreSQL.
- Company filter values are `all`, `1`, and `2`.
- Supplier statuses are `PENDING_REVIEW`, `APPROVED`, `REJECTED`, and `NEEDS_SUPPLIER`.
- Priorities are `CRITICAL`, `HIGH`, `MEDIUM`, and `LOW`.
- Concurrency field is `version`; every mutation receives `expectedVersion`.
