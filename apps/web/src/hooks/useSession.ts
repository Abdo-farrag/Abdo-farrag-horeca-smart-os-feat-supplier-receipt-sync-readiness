import { useQuery } from '@tanstack/react-query';
import { checkSession } from '../api/auth.js';
import { ApiError } from '../api/client.js';

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await checkSession();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return { authenticated: false };
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
