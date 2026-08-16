import type {
  CompanyId,
  PurchaseDecisionStatus,
  SupplierReadiness,
  PurchaseExportScope,
  CompanyPurchaseDecisionInput,
  CompanyPurchaseRow,
} from '@horeca/contracts';

export type {
  CompanyId,
  PurchaseDecisionStatus,
  SupplierReadiness,
  PurchaseExportScope,
  CompanyPurchaseDecisionInput,
  CompanyPurchaseRow,
};

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

// ── Company Purchase Review types ──

export type DecisionStatus = PurchaseDecisionStatus;

export interface CompanyReviewFilters {
  company: CompanyFilter;
  search: string;
  priority: string;
  decisionStatus: string;
  noSupplier: boolean;
  supplierId?: number;
  brandId: string;
  page: number;
}

export function companyPurchaseRowKey(row: { companyId: number; productCode: string }): string {
  return `${row.companyId}:${row.productCode}`;
}
