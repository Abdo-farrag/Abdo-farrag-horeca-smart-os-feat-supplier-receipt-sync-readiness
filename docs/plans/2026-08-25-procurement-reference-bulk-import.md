# Procurement Reference Bulk Import Implementation Plan

## Goal

Allow authenticated procurement users to export the current effective product reference data, edit supplier and brand mappings in Excel, preview every change without writing, and explicitly apply a valid batch atomically to Supabase-owned override tables.

## Safety boundaries

- Never update Odoo-synchronized reference tables.
- Preview never mutates vendor or brand overrides.
- Apply is explicit, idempotent by file checksum, and blocked when any row is invalid.
- All database access stays server-side with the existing service-role credential.
- Existing purchase and RFQ flows read effective override-first reference data.

## Tasks

1. Version the already-applied Supabase override schema and add a corrective integration migration.
2. Add shared contracts for export rows, preview errors/results, and apply input/results.
3. Add failing API tests for authenticated export, preview validation, and apply blocking/idempotency.
4. Implement workbook generation/parsing and Supabase reference-import dependencies.
5. Register API routes and server dependencies.
6. Add failing web tests for the new reference-data route and preview/apply workflow.
7. Implement the reference-data page and browser API client.
8. Run lint, typecheck, full tests, production build, and database security/performance advisors.
