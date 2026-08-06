import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';
import { ApiError } from '../api/client.js';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/procurement.js', () => ({
  fetchProcurementOverview: vi.fn(),
}));

import * as authApi from '../api/auth.js';
import * as procurementApi from '../api/procurement.js';

const EMPTY_OVERVIEW = {
  rows: [],
  summary: { needsPurchase: 0, critical: 0, totalSuggestedQty: 0, noSupplier: 0, insufficientData: 0 },
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  syncStatus: null,
};

describe('Procurement overview page states', () => {
  beforeEach(() => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
  });

  it('shows a loading indicator while data is fetching', async () => {
    vi.mocked(procurementApi.fetchProcurementOverview).mockReturnValue(
      new Promise(() => {}), // never resolves
    );
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('shows an empty state when no products match', async () => {
    vi.mocked(procurementApi.fetchProcurementOverview).mockResolvedValue(EMPTY_OVERVIEW);
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(
        screen.getByText('لا توجد منتجات تطابق المعايير المحددة'),
      ).toBeInTheDocument();
    });
  });

  it('shows an error alert when the API fails', async () => {
    vi.mocked(procurementApi.fetchProcurementOverview).mockRejectedValue(
      new ApiError(503, 'PROCUREMENT_UNAVAILABLE'),
    );
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows KPI cards when data loads successfully', async () => {
    vi.mocked(procurementApi.fetchProcurementOverview).mockResolvedValue({
      ...EMPTY_OVERVIEW,
      summary: { needsPurchase: 5, critical: 2, totalSuggestedQty: 100, noSupplier: 1, insufficientData: 3 },
    });
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'مؤشرات الأداء' })).toBeInTheDocument();
    });
  });
});
