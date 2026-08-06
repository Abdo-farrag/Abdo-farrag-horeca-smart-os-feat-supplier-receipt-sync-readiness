import { screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/procurement.js', () => ({
  fetchProcurementOverview: vi.fn().mockResolvedValue({
    rows: [],
    summary: { needsPurchase: 0, critical: 0, totalSuggestedQty: 0, noSupplier: 0, insufficientData: 0 },
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    syncStatus: null,
  }),
}));

import * as authApi from '../api/auth.js';

describe('Session protection', () => {
  it('redirects unauthenticated visitors from / to /login', async () => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: false });
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    });
  });

  it('shows the overview page for authenticated users at /', async () => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByText('نظرة عامة على المشتريات')).toBeInTheDocument();
    });
  });

  it('renders the login page directly at /login without a session check redirect', () => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: false });
    renderWithProviders(<AppRoutes />, { initialEntries: ['/login'] });

    expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
  });
});
