# Procurement Review — Design Specification

Date: 2026-07-27
Status: Approved design
Repository: `Abdo-farrag/horeca-smart-os`

## 1. Objective

Complete the Procurement Review workflow so procurement users can review purchase recommendations, adjust quantities, approve individual products, and approve multiple products in bulk.

This phase uses an aggregated decision per `product_code` across MAS and Horeca Smart. Company-level quantity splitting is deferred to the later RFQ generation phase.

## 2. Scope

### Included

- Display aggregated procurement recommendations.
- Edit approved quantity per product.
- Edit or confirm supplier per product.
- Save individual decisions.
- Select multiple products.
- Bulk approve selected products.
- Bulk set products to under review, deferred, or rejected.
- Add one optional shared note to a bulk action.
- Automatically exclude products without a supplier from bulk approval.
- Automatically exclude products with an invalid approval quantity from bulk approval.
- Preserve excluded products without changing their current decision.
- Record actor, timestamp, old state, new state, note, request ID, and version.
- Detect and report optimistic-concurrency conflicts.

### Excluded

- RFQ creation.
- Purchase order creation.
- Odoo write-back.
- Company-level split between MAS and Horeca Smart.
- Automatic execution of database migrations during API startup.

## 3. Decision Model

Supported statuses:

- `NEW`: no review decision has been saved.
- `UNDER_REVIEW`: product is being investigated.
- `APPROVED`: product is approved for purchase.
- `DEFERRED`: purchase is postponed.
- `REJECTED`: product is not approved for purchase.

Rules:

- `APPROVED` requires `approved_qty > 0`.
- `APPROVED` requires a supplier.
- `REJECTED` and `DEFERRED` do not require an approved quantity.
- A product without a saved decision is presented as `NEW`.
- The decision key in this phase is `product_code` only.

## 4. Page Structure

Route:

`/procurement/review`

The page remains protected by the existing overview session.

Main sections:

1. Page header and aggregated-scope notice.
2. KPI cards.
3. Filters.
4. Review table.
5. Sticky bulk action bar when one or more rows are selected.
6. Bulk confirmation dialog.
7. Success, warning, and error feedback.

The page must display this notice clearly:

> Decisions in this phase are aggregated across MAS and Horeca Smart. Quantities will be split by company during RFQ generation.

## 5. KPI Cards

Display:

- Total recommended products.
- New.
- Under review.
- Approved.
- Deferred.
- Without supplier.
- Total approved quantity.

KPI values must be derived from the same filtered data source used by the page or from a dedicated summary returned by the review API.

## 6. Filters

Supported filters:

- Search by product code or product name.
- Priority.
- Decision status.
- Without supplier.
- Needs purchase only.
- Manually modified quantity.
- Approved only.
- All products.

The company filter is not used in this phase because decisions are aggregated.

Filtering must reset pagination to page 1.

## 7. Review Table

Each row displays:

- Selection checkbox.
- Product code.
- Product name.
- Priority.
- Aggregated available quantity.
- Effective daily demand.
- Coverage days.
- Suggested quantity.
- Editable approved quantity.
- Proposed or approved supplier.
- Supplier status.
- Decision status.
- Buyer note.
- Last update timestamp.
- Save action.

Default quantity behavior:

- If a saved decision exists, show its saved approved quantity.
- Otherwise, initialize the editable approved quantity with the system suggested quantity.
- Editing a quantity marks the row as modified but does not save automatically.

## 8. Individual Review Workflow

A user can edit:

- Approved quantity.
- Supplier.
- Decision status.
- Buyer note.

Saving an individual decision:

1. Validate the row locally.
2. Send the current `expectedVersion`.
3. Save through the review API.
4. Replace local row data with the returned canonical decision.
5. Show a success message.
6. On `VERSION_CONFLICT`, show a clear message and refresh that row or the current page.

Validation messages must be shown next to the affected field.

## 9. Bulk Selection Rules

The user can select visible rows individually or select all rows on the current page.

Selection must not be lost when editing quantities on the same page.

The bulk action bar displays:

- Number selected.
- Approve selected.
- Mark under review.
- Defer selected.
- Reject selected.
- Clear selection.

## 10. Bulk Approval Workflow

When the user chooses bulk approval:

1. Use the currently visible editable quantity for each selected product.
2. Use the current supplier value for each selected product.
3. Exclude products without a supplier.
4. Exclude products whose approval quantity is null, zero, negative, or otherwise invalid.
5. Keep excluded products unchanged.
6. Open a confirmation dialog before sending the request.

The confirmation dialog displays:

- Number of valid products to approve.
- Total approved quantity.
- Number excluded because no supplier exists.
- Number excluded because the quantity is invalid.
- The excluded product names or codes, grouped by reason.
- One optional shared note, maximum 1000 characters.

If no valid products remain, disable confirmation and explain why.

After success:

- Clear selection.
- Reload page data and KPIs.
- Show a message similar to:

> 18 products approved. 3 products without suppliers and 1 product with an invalid quantity were excluded.

## 11. Other Bulk Decisions

For `UNDER_REVIEW`, `DEFERRED`, and `REJECTED`:

- Supplier is not required.
- Approved quantity is not required.
- The same optional shared note is supported.
- All selected products are included unless they have stale versions or invalid identifiers.

Bulk operations are atomic: if one submitted item fails at the database transaction level, the whole submitted batch fails.

Client-side exclusions happen before the request and are not part of the submitted batch.

## 12. API Design

Existing endpoints are retained:

- `GET /api/procurement/review`
- `POST /api/procurement/review/approve`
- `POST /api/procurement/review/bulk`

### GET response expectations

The response must include:

- Items.
- Pagination.
- Summary/KPI values.
- Canonical decision fields.
- Approval version.
- Supplier status.

### Individual save request

Must include:

- `productCode`
- `decisionStatus`
- `approvedQty`
- `approvedSupplierId`
- `approvedSupplierName`
- `buyerNote`
- `expectedVersion`

### Bulk request

Must include for each submitted item:

- `productCode`
- Current approved quantity.
- Current supplier.
- Current expected version.

The request also includes:

- `decisionStatus`
- Optional shared `buyerNote`

## 13. Database and Data Source

The application uses:

- `procurement_recommendation_approvals`
- `rpc_approve_recommendation`
- `rpc_bulk_update_recommendations`
- A corrected review read model compatible with the real procurement schema.
- `procurement_audit_events`

The read model must use actual existing source columns and produce the fields expected by the API. The currently invalid view definition must not be applied unchanged.

The final read model must aggregate both companies by `product_code` and expose at least:

- Product code and name.
- Available quantity.
- Effective daily demand.
- Coverage.
- Suggested quantity.
- Priority.
- Data status.
- Proposed supplier.
- Supplier status.
- Latest receipt timestamp.
- Saved approval decision.
- Approval version.

Database changes are applied manually through Supabase migration tooling or SQL Editor after review. The API must not run migrations automatically.

## 14. Optimistic Concurrency

Every saved decision carries a numeric `version`.

Rules:

- New decision expects version `0`.
- Existing decision must submit its current version.
- A version mismatch returns `VERSION_CONFLICT`.
- The UI must not overwrite a newer decision silently.

User message:

> This product was changed by another user. Refresh the data and try again.

## 15. Audit Requirements

Every successful individual or bulk decision records:

- Event type.
- Module.
- Entity type and product code.
- Actor user ID, display name, and role.
- Old data.
- New data.
- Note.
- Request ID.
- Timestamp.

Bulk operations should share a batch identifier where supported.

## 16. Error Handling

- Unauthorized session: return to login.
- Review source unavailable: show retry state.
- Invalid input: show field-level validation.
- Version conflict: show conflict message and refresh.
- Bulk transaction failure: show that no submitted items were changed.
- Partial client-side exclusion: show excluded counts and reasons.
- Unknown server error: show a safe Arabic message and log the technical error server-side.

## 17. Component Boundaries

Refactor the current large page into:

- `ProcurementReviewPage`
- `ReviewKpiCards`
- `ReviewFilters`
- `ReviewTable`
- `ReviewRow`
- `BulkActionBar`
- `BulkConfirmationDialog`
- `ReviewStatusBadge`

Responsibilities:

- Page: query state, selection state, orchestration, and mutations.
- KPI cards: summary presentation only.
- Filters: controlled filter inputs only.
- Table: rendering and page-level selection.
- Row: local editable fields and validation display.
- Bulk bar: available batch actions.
- Dialog: validation summary, exclusions, note, and confirmation.
- Badge: status presentation.

## 18. Testing Requirements

Add or update tests for:

- Protected route behavior.
- Loading and error states.
- Search and filters.
- Pagination reset on filter change.
- Suggested quantity used as the default approval quantity.
- Individual quantity edit.
- Individual save.
- Individual invalid approval quantity.
- Individual missing supplier.
- Page selection.
- Bulk approval.
- Exclusion of products without suppliers.
- Exclusion of invalid quantities.
- Shared bulk note.
- Bulk under-review, defer, and reject actions.
- Atomic bulk failure message.
- Version conflict behavior.
- Selection cleared after success.
- Excluded rows remain unchanged.
- Session expiry handling.

## 19. Delivery Order

1. Remove or leave disconnected the unused migration runner; do not call it from server startup.
2. Correct the review data contract and API mapping.
3. Refactor the review page into focused components.
4. Implement individual validation and save behavior.
5. Implement selection and sticky bulk actions.
6. Implement bulk confirmation and exclusion logic.
7. Complete automated tests.
8. Apply the corrected database migration manually.
9. Run end-to-end verification in Replit.

## 20. Acceptance Criteria

The phase is complete when:

- A logged-in user can open `/procurement/review`.
- Recommendations load from the real Supabase review source.
- A user can modify and save one recommendation.
- A user can select multiple recommendations and approve them.
- The displayed editable quantities are used in the bulk request.
- Products without suppliers are excluded automatically.
- Products with invalid quantities are excluded automatically.
- Exclusion reasons are visible before confirmation and after completion.
- One optional note is applied to the submitted bulk items.
- Version conflicts never overwrite newer data.
- Audit events are recorded.
- No database migration runs automatically when the API starts.
- Tests pass for the agreed individual and bulk workflows.
