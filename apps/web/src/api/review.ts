import { apiFetch } from './client.js';
import type {
  CompanyPurchaseRow,
  CompanyPurchaseDecisionInput,
  PurchaseExportScope,
} from '@horeca/contracts';

export interface CompanyReviewFiltersInput {
  company: string;
  search: string;
  priority: string;
  decisionStatus: string;
  noSupplier: boolean;
  page: number;
  pageSize: number;
}

export async function fetchCompanyPurchaseReview(filters: CompanyReviewFiltersInput): Promise<{
  rows: CompanyPurchaseRow[];
  pagination: { page: number; total: number; pageSize: number; totalPages: number };
}> {
  const params = new URLSearchParams();
  params.set('company', filters.company);
  params.set('search', filters.search);
  params.set('priority', filters.priority);
  params.set('decisionStatus', filters.decisionStatus);
  params.set('noSupplier', String(filters.noSupplier));
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));

  const result = await apiFetch<{
    data: {
      items: CompanyPurchaseRow[];
      pagination: { page: number; total: number; pageSize: number; totalPages: number };
    };
  }>(`/api/procurement/company-review?${params.toString()}`);

  return {
    rows: result.data.items,
    pagination: result.data.pagination,
  };
}

export async function saveCompanyPurchaseDecision(
  input: CompanyPurchaseDecisionInput,
): Promise<CompanyPurchaseRow> {
  const result = await apiFetch<{ data: CompanyPurchaseRow }>(
    '/api/procurement/company-review/decision',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return result.data;
}

export async function bulkSaveCompanyPurchaseDecisions(payload: {
  items: CompanyPurchaseDecisionInput[];
  decisionStatus: string;
  buyerNote: string | null;
}): Promise<{ batchId: string; items: CompanyPurchaseRow[] }> {
  const result = await apiFetch<{ data: { batchId: string; items: CompanyPurchaseRow[] } }>(
    '/api/procurement/company-review/bulk',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return result.data;
}

export async function downloadPurchaseExport(scope: PurchaseExportScope): Promise<void> {
  const response = await fetch(
    `/api/procurement/company-review/export?scope=${encodeURIComponent(scope)}`,
    {
      credentials: 'include',
    },
  );

  if (!response.ok) {
    let errorMsg = `فشل تصدير ملف ${scope === 'approved' ? 'المعتمد' : 'المسودة'}`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorMsg = errJson.error.message;
      }
    } catch {
      // Ignore parse failure
    }
    throw new Error(errorMsg);
  }

  const disposition = response.headers.get('Content-Disposition');
  let filename = `horeca-purchase-plan-${scope}.xlsx`;
  if (disposition) {
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    if (filenameMatch && filenameMatch[1]) {
      filename = filenameMatch[1];
    }
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Aliases for compatibility
export const fetchReviewProducts = fetchCompanyPurchaseReview as any;
export const approveRecommendation = saveCompanyPurchaseDecision as any;
export const bulkUpdateRecommendations = bulkSaveCompanyPurchaseDecisions as any;
