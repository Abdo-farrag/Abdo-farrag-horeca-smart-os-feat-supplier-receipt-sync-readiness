import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCompanyPurchaseReview,
  saveCompanyPurchaseDecision,
  bulkSaveCompanyPurchaseDecisions,
} from '../api/review.js';
import type { CompanyReviewFilters } from '../types.js';
import type { CompanyPurchaseDecisionInput } from '@horeca/contracts';

export function useCompanyPurchaseReview(filters: CompanyReviewFilters, pageSize = 50) {
  return useQuery({
    queryKey: ['company-review', filters, pageSize],
    queryFn: () => fetchCompanyPurchaseReview({ ...filters, pageSize }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useSaveCompanyDecision() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CompanyPurchaseDecisionInput) => saveCompanyPurchaseDecision(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-review'] });
    },
  });
}

export function useBulkSaveCompanyDecisions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      items: CompanyPurchaseDecisionInput[];
      decisionStatus: string;
      buyerNote: string | null;
    }) => bulkSaveCompanyPurchaseDecisions(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-review'] });
    },
  });
}

// Aliases for compatibility
export const useReviewProducts = useCompanyPurchaseReview as any;
export const useApproveRecommendation = useSaveCompanyDecision as any;
export const useBulkUpdateRecommendations = useBulkSaveCompanyDecisions as any;
