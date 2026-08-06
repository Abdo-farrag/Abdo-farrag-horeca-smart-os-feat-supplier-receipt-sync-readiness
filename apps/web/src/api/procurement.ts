import { apiFetch } from './client.js';
import type { OverviewFilters, ProcurementOverviewData } from '../types.js';

export async function fetchProcurementOverview(
  filters: OverviewFilters,
): Promise<ProcurementOverviewData> {
  const params = new URLSearchParams();
  params.set('company', filters.company);
  params.set('coverageDays', String(filters.coverageDays));
  if (filters.search) params.set('search', filters.search);
  params.set('page', String(filters.page));

  const result = await apiFetch<{ data: ProcurementOverviewData }>(
    `/api/procurement/overview?${params.toString()}`,
  );
  return result.data;
}
