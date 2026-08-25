import type {
  CompanyPurchaseDecisionInput,
  CompanyPurchaseRow,
  PurchaseDraft,
  PurchaseDraftCreateInput,
  PurchaseDraftLine,
  PurchaseDraftLineInput,
  PurchaseDraftRfqReferenceInput,
  PurchaseDraftStatus,
  PurchaseDraftStatusInput,
  SupplierDirectoryItem,
  SupplierDirectoryQuery,
} from '@horeca/contracts';

export type AppRole = 'reviewer' | 'admin';

export interface VerifiedAccessToken {
  userId: string;
}

export interface AppUserRole {
  userId: string;
  displayName: string;
  role: AppRole;
  isActive: boolean;
}

export interface AuthDependencies {
  overviewPasswordHash: string;
  sessionSecret: string;
  overviewAuthDisabled: boolean;
  verifyOverviewPassword?: (password: string, passwordHash: string) => Promise<boolean>;
  verifyAccessToken: (token: string) => Promise<VerifiedAccessToken | null>;
  findUserRole: (userId: string) => Promise<AppUserRole | null>;
}

export interface SyncStatus {
  finishedAt: string | null;
  freshnessStatus: string | null;
}

export interface ProcurementOverviewParams {
  companyId: number | null;
  coverageDays: number;
  search: string;
  priorities: string[];
  supplierStatuses: string[];
  needsPurchase: boolean | null;
  noSupplier: boolean | null;
  insufficientData: boolean | null;
  sort: string;
  direction: string;
  page: number;
  pageSize: number;
}

export interface ProcurementDependencies {
  getOverview: (params: ProcurementOverviewParams) => Promise<unknown>;
  getSyncStatus: () => Promise<SyncStatus | null>;
}

export interface ApprovalDecision {
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
  items: ApprovalDecision[];
}

export interface ReviewDependencies {
  getReviewProducts: (params: {
    company?: string;
    search?: string;
    priority?: string;
    decisionStatus?: string;
    noSupplier?: boolean;
    page: number;
    pageSize: number;
  }) => Promise<unknown>;
  approveRecommendation: (
    productCode: string,
    decisionStatus: string,
    approvedQty: number | null,
    approvedSupplierId: number | null,
    approvedSupplierName: string | null,
    buyerNote: string | null,
    expectedVersion: number,
  ) => Promise<ApprovalDecision>;
  bulkUpdateRecommendations: (
    items: Array<{
      productCode: string;
      approvedQty: number | null;
      approvedSupplierId: number | null;
      approvedSupplierName: string | null;
      expectedVersion: number;
    }>,
    decisionStatus: string,
    buyerNote: string | null,
  ) => Promise<BulkUpdateResult>;
}

export interface CompanyPurchaseListParams {
  company: 'all' | '1' | '2';
  search?: string;
  priority?: string;
  decisionStatus?: string;
  noSupplier?: boolean;
  supplierId?: number;
  brandId?: number | 'undefined';
  page: number;
  pageSize: number;
}

export interface CompanyPurchaseDecisionResult {
  companyId: number;
  productCode: string;
  approvedQty: number | null;
  approvedSupplierId: number | null;
  approvedSupplierName: string | null;
  decisionStatus: string;
  buyerNote: string | null;
  version: number;
  updatedAt: string | null;
}

export interface CompanyPurchaseBulkResult {
  batchId: string;
  items: CompanyPurchaseDecisionResult[];
}

export interface CompanyPurchaseDependencies {
  list: (params: CompanyPurchaseListParams) => Promise<{
    data: {
      items: CompanyPurchaseRow[];
      pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    };
    error: null;
  }>;
  saveDecision: (input: CompanyPurchaseDecisionInput) => Promise<CompanyPurchaseDecisionResult>;
  bulkSave: (input: {
    items: CompanyPurchaseDecisionInput[];
    decisionStatus: string;
    buyerNote?: string | null;
  }) => Promise<CompanyPurchaseBulkResult>;
  exportRows?: (query: { companyId?: number; scope: 'draft' | 'approved' }) => Promise<CompanyPurchaseRow[]>;
}

export interface PurchaseDraftDependencies {
  listSuppliers: (query: SupplierDirectoryQuery) => Promise<{
    items: SupplierDirectoryItem[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  listBrands: () => Promise<Array<{
    brandId: number | null;
    brandName: string | null;
    productCount: number;
  }>>;
  listDrafts: (query: {
    status?: PurchaseDraftStatus;
    companyId?: 1 | 2;
    supplierId?: number;
  }) => Promise<PurchaseDraft[]>;
  getDraft: (draftId: string) => Promise<{
    draft: PurchaseDraft;
    lines: PurchaseDraftLine[];
  }>;
  createDraft: (input: PurchaseDraftCreateInput) => Promise<{
    draft: PurchaseDraft;
    lines: PurchaseDraftLine[];
  }>;
  updateLine: (
    draftId: string,
    lineId: string,
    input: PurchaseDraftLineInput,
  ) => Promise<PurchaseDraftLine>;
  changeSupplier: (
    draftId: string,
    input: { supplierId: number; expectedVersion: number },
  ) => Promise<PurchaseDraft>;
  transition: (draftId: string, input: PurchaseDraftStatusInput) => Promise<PurchaseDraft>;
  setRfqReference: (
    draftId: string,
    input: PurchaseDraftRfqReferenceInput,
  ) => Promise<PurchaseDraft>;
}

export interface ReferenceDataDependencies {
  exportWorkbook: () => Promise<Buffer>;
  previewImport: (input: {
    filename: string;
    contentBase64: string;
  }) => Promise<{
    batchId: string;
    filename: string;
    templateVersion: string;
    totalRows: number;
    validRows: number;
    invalidRows: number;
    errors: Array<Record<string, unknown>>;
    changes: Array<Record<string, unknown>>;
  }>;
  applyImport: (batchId: string) => Promise<{
    batchId: string;
    status: 'APPLIED';
    inserted: number;
    updated: number;
    unchanged: number;
    skipped: number;
  }>;
}

export interface BuildAppOptions {
  auth?: AuthDependencies;
  procurement?: ProcurementDependencies;
  review?: ReviewDependencies;
  companyPurchase?: CompanyPurchaseDependencies;
  purchaseDrafts?: PurchaseDraftDependencies;
  referenceData?: ReferenceDataDependencies;
}
