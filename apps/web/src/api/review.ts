import { apiFetch } from './client.js';
import type { ApprovalResult, BulkUpdateResult } from '../types.js';

export interface ApproveBody {
  productCode: string;
  decisionStatus: string;
  approvedQty: number | null;
  approvedSupplierId: number | null;
  approvedSupplierName: string | null;
  buyerNote: string | null;
  expectedVersion: number;
}

export interface BulkBody {
  items: Array<{
    productCode: string;
    approvedQty: number | null;
    approvedSupplierId: number | null;
    approvedSupplierName: string | null;
    expectedVersion: number;
  }>;
  decisionStatus: string;
  buyerNote: string | null;
}

export async function fetchReviewProducts(filters: {
  company: string;
  search: string;
  priority: string;
  decisionStatus: string;
  noSupplier: boolean;
  page: number;
  pageSize: number;
}): Promise<{ rows: unknown[]; pagination: { page: number; total: number; pageSize: number; totalPages: number } }> {
  const params = new URLSearchParams();
  params.set('company', filters.company);
  params.set('search', filters.search);
  params.set('priority', filters.priority);
  params.set('decisionStatus', filters.decisionStatus);
  params.set('noSupplier', String(filters.noSupplier));
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));

  const result = await apiFetch<{ data: { rows: unknown[]; pagination: unknown } }>(
    `/api/procurement/review?${params.toString()}`,
  );
  return result.data as { rows: unknown[]; pagination: { page: number; total: number; pageSize: number; totalPages: number } };
}

export async function approveRecommendation(body: ApproveBody): Promise<ApprovalResult> {
  const result = await apiFetch<{ data: ApprovalResult }>('/api/procurement/review/approve', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.data;
}

export async function bulkUpdateRecommendations(body: BulkBody): Promise<BulkUpdateResult> {
  const result = await apiFetch<{ data: BulkUpdateResult }>('/api/procurement/review/bulk', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return result.data;
}
