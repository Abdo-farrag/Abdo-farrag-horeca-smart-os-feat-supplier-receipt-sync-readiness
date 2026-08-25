import { ApiError, apiFetch } from './client.js';

export interface ReferenceImportError {
  row_number: number;
  severity: 'ERROR' | 'WARNING';
  error_code: string;
  error_message: string;
  original_row: Record<string, unknown>;
}

export interface ReferenceImportChange {
  rowNumber: number;
  companyId?: number;
  productCode?: string;
  supplierId?: number;
  changeType: 'INSERT' | 'UPDATE' | 'BRAND_ONLY' | 'NO_CHANGE';
}

export interface ReferenceImportPreview {
  batchId: string;
  filename: string;
  templateVersion: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ReferenceImportError[];
  changes: ReferenceImportChange[];
}

export interface ReferenceImportApplyResult {
  batchId: string;
  status: 'APPLIED';
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function downloadReferenceData(): Promise<void> {
  const response = await fetch('/api/procurement/reference-data/export', {
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'REFERENCE_DATA_UNAVAILABLE');
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    ?? 'procurement-reference-data.xlsx';
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function previewReferenceData(file: File): Promise<ReferenceImportPreview> {
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  const response = await apiFetch<{ data: ReferenceImportPreview; error: null }>(
    '/api/procurement/reference-data/preview',
    {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentBase64 }),
    },
  );
  return response.data;
}

export async function applyReferenceData(
  batchId: string,
): Promise<ReferenceImportApplyResult> {
  const response = await apiFetch<{ data: ReferenceImportApplyResult; error: null }>(
    '/api/procurement/reference-data/apply',
    {
      method: 'POST',
      body: JSON.stringify({ batchId }),
    },
  );
  return response.data;
}
