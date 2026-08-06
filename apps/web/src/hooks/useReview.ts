import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchReviewProducts,
  approveRecommendation,
  bulkUpdateRecommendations,
  type ApproveBody,
  type BulkBody,
} from '../api/review.js';
import type { ReviewFilters } from '../types.js';

export function useReviewProducts(filters: ReviewFilters, pageSize = 50) {
  return useQuery({
    queryKey: ['review', 'products', filters, pageSize],
    queryFn: () =>
      fetchReviewProducts({ ...filters, pageSize }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useApproveRecommendation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ApproveBody) => approveRecommendation(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review', 'products'] });
    },
  });
}

export function useBulkUpdateRecommendations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: BulkBody) => bulkUpdateRecommendations(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review', 'products'] });
    },
  });
}
