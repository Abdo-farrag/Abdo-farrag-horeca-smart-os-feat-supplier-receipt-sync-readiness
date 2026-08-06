import { fireEvent, screen, waitFor } from '@testing-library/react';
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

describe('Logout', () => {
  it('calls the logout API when the logout button is clicked', async () => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    vi.mocked(authApi.logout).mockResolvedValue(undefined);

    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));

    await waitFor(() => {
      expect(authApi.logout).toHaveBeenCalledTimes(1);
    });
  });

  it('redirects to /login after successful logout', async () => {
    vi.mocked(authApi.checkSession)
      .mockResolvedValueOnce({ authenticated: true }) // initial session check
      .mockResolvedValue({ authenticated: false });   // after logout invalidation
    vi.mocked(authApi.logout).mockResolvedValue(undefined);

    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'تسجيل الخروج' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'تسجيل الخروج' }));

    await waitFor(() => {
      expect(screen.getByLabelText('كلمة المرور')).toBeInTheDocument();
    });
  });
});
