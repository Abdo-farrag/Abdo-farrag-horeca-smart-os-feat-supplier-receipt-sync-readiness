export type CompanyFilter = 'all' | '1' | '2';
export type CoverageDays = 7 | 14 | 21 | 30;
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type SupplierStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'NEEDS_SUPPLIER';
export type DataStatus = 'SUFFICIENT' | 'INSUFFICIENT';

export interface ProcurementRow {
  productCode: string;
  productName: string;
  freeQty: number;
  effectiveDailyDemand: number;
  forecastQty: number | null;
  leadTimeQty: number | null;
  safetyStockQty: number | null;
  actualCoverageDays: number | null;
  leadTimeDays: number;
  safetyStockDays: number;
  suggestedQty: number | null;
  priority: Priority;
  dataStatus: DataStatus;
  proposedSupplierId: number | null;
  proposedSupplierName: string | null;
  approvedSupplierId: number | null;
  approvedSupplierName: string | null;
  supplierStatus: SupplierStatus;
  latestReceiptAt: string | null;
  version: number;
}

export interface ProcurementSummary {
  needsPurchase: number;
  critical: number;
  totalSuggestedQty: number;
  noSupplier: number;
  insufficientData: number;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SyncStatus {
  finishedAt: string | null;
  freshnessStatus: string | null;
}

export interface ProcurementOverviewData {
  rows: ProcurementRow[];
  summary: ProcurementSummary;
  pagination: Pagination;
  syncStatus: SyncStatus | null;
}

export interface OverviewFilters {
  company: CompanyFilter;
  coverageDays: CoverageDays;
  search: string;
  page: number;
}

// ── Review / Approval types ──

export type DecisionStatus = 'NEW' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'DEFERRED';

export interface ReviewApprovalData {
  productCode: string;
  productName: string;
  freeQty: number;
  effectiveDailyDemand: number;
  forecastQty: number | null;
  actualCoverageDays: number | null;
  leadTimeDays: number;
  safetyStockDays: number;
  suggestedQty: number | null;
  priority: Priority;
  dataStatus: DataStatus;
  supplierStatus: SupplierStatus;
  proposedSupplierName: string | null;
  existingApprovedSupplierName: string | null;
  latestReceiptAt: string | null;
  productVersion: number;
  approvedQty: number | null;
  reviewApprovedSupplierId: number | null;
  reviewApprovedSupplierName: string | null;
  decisionStatus: DecisionStatus | null;
  buyerNote: string | null;
  approvalVersion: number;
}

export interface ApprovalResult {
  productCode: string;
  approvedQty: number | null;
  approvedSupplierId: number | null;
  approvedSupplierName: string | null;
  decisionStatus: string;
  buyerNote: string | null;
  version: number;
  updatedAt: string | null;
}

export interface BulkUpdateResult {
  batchId: string;
  items: ApprovalResult[];
}

export interface ReviewFilters {
  company: CompanyFilter;
  search: string;
  priority: string;
  decisionStatus: string;
  noSupplier: boolean;
  page: number;
}
