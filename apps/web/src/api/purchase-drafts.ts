import { apiFetch } from './client.js';
import type {
  PurchaseDraft,
  PurchaseDraftCreateInput,
  PurchaseDraftLine,
  PurchaseDraftLineInput,
  PurchaseDraftRfqReferenceInput,
  PurchaseDraftStatusInput,
  SupplierDirectoryItem,
} from '@horeca/contracts';

export interface BrandOption {
  brandId: number | null;
  brandName: string | null;
  productCount: number;
}

export interface PurchaseDraftSnapshot {
  draft: PurchaseDraft;
  lines: PurchaseDraftLine[];
}

export async function searchSuppliers(search: string): Promise<SupplierDirectoryItem[]> {
  const params = new URLSearchParams({ search, page: '1', pageSize: '20' });
  const result = await apiFetch<{
    data: { items: SupplierDirectoryItem[] };
  }>(`/api/procurement/suppliers?${params.toString()}`);
  return result.data.items;
}

export async function fetchBrandOptions(): Promise<BrandOption[]> {
  const result = await apiFetch<{ data: BrandOption[] }>('/api/procurement/brands');
  return result.data;
}

export async function createPurchaseDraft(
  input: PurchaseDraftCreateInput,
): Promise<PurchaseDraftSnapshot> {
  const result = await apiFetch<{ data: PurchaseDraftSnapshot }>(
    '/api/procurement/purchase-drafts',
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.data;
}

export async function fetchPurchaseDraft(draftId: string): Promise<PurchaseDraftSnapshot> {
  const result = await apiFetch<{ data: PurchaseDraftSnapshot }>(
    `/api/procurement/purchase-drafts/${draftId}`,
  );
  return result.data;
}

export async function updatePurchaseDraftLine(
  draftId: string,
  lineId: string,
  input: PurchaseDraftLineInput,
): Promise<PurchaseDraftLine> {
  const result = await apiFetch<{ data: PurchaseDraftLine }>(
    `/api/procurement/purchase-drafts/${draftId}/lines/${lineId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return result.data;
}

export async function changePurchaseDraftSupplier(
  draftId: string,
  input: { supplierId: number; expectedVersion: number },
): Promise<PurchaseDraft> {
  const result = await apiFetch<{ data: PurchaseDraft }>(
    `/api/procurement/purchase-drafts/${draftId}/change-supplier`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.data;
}

export async function transitionPurchaseDraft(
  draftId: string,
  input: PurchaseDraftStatusInput,
): Promise<PurchaseDraft> {
  const result = await apiFetch<{ data: PurchaseDraft }>(
    `/api/procurement/purchase-drafts/${draftId}/status`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.data;
}

export async function setPurchaseDraftRfqReference(
  draftId: string,
  input: PurchaseDraftRfqReferenceInput,
): Promise<PurchaseDraft> {
  const result = await apiFetch<{ data: PurchaseDraft }>(
    `/api/procurement/purchase-drafts/${draftId}/rfq-reference`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.data;
}

export async function downloadPurchaseDraftRfq(draftId: string): Promise<void> {
  const response = await fetch(`/api/procurement/purchase-drafts/${draftId}/export`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('RFQ_EXPORT_FAILED');
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1]
    ?? `odoo-rfq-${draftId}.xlsx`;
  const url = window.URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}
