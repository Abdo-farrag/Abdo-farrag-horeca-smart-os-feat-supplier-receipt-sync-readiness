import { useQuery } from '@tanstack/react-query';
import { fetchProcurementOverview } from '../api/procurement.js';
import type { OverviewFilters } from '../types.js';

export function useProcurement(filters: OverviewFilters) {
  return useQuery({
    queryKey: ['procurement', 'overview', filters],
    queryFn: () => fetchProcurementOverview(filters),
    staleTime: 2 * 60 * 1000,
  });
}
