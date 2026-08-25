import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/procurement.js', () => ({
  fetchProcurementOverview: vi.fn(),
}));

vi.mock('../api/review.js', () => ({
  fetchCompanyPurchaseReview: vi.fn(),
  saveCompanyPurchaseDecision: vi.fn(),
  bulkSaveCompanyPurchaseDecisions: vi.fn(),
  downloadPurchaseExport: vi.fn(),
}));

import * as authApi from '../api/auth.js';
import * as procurementApi from '../api/procurement.js';
import * as reviewApi from '../api/review.js';

const mockOverviewData = {
  rows: [],
  summary: {
    totalItems: 0,
    criticalItems: 0,
    highItems: 0,
    estimatedTotalCost: 0,
    totalQuantityNeeded: 0,
    needsPurchase: 0,
    critical: 0,
    totalSuggestedQty: 0,
    noSupplier: 0,
    insufficientData: 0,
  },
  pagination: { page: 1, total: 0, pageSize: 50, totalPages: 1 },
  syncStatus: null,
};

const mockReviewData = {
  rows: [],
  pagination: { page: 1, total: 0, pageSize: 50, totalPages: 1 },
};

describe('Procurement Application Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    vi.mocked(procurementApi.fetchProcurementOverview).mockResolvedValue(mockOverviewData);
    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockResolvedValue(mockReviewData);
  });

  it('displays top-level procurement navigation and allows navigating between pages', async () => {
    const user = userEvent.setup();

    renderWithProviders(<AppRoutes />, { initialEntries: ['/'] });

    await waitFor(() => {
      expect(screen.getByText('Horeca Smart OS')).toBeInTheDocument();
    });

    // Check header displays two navigation options: "نظرة عامة" and "مراجعة واعتماد المشتريات"
    const overviewNav = screen.getByRole('button', { name: 'نظرة عامة' });
    const referenceDataNav = screen.getByRole('button', { name: 'بيانات الموردين والبراندات' });
    const reviewNavButtons = screen.getAllByRole('button', { name: 'مراجعة واعتماد المشتريات' });
    expect(overviewNav).toBeInTheDocument();
    expect(referenceDataNav).toBeInTheDocument();
    expect(reviewNavButtons.length).toBeGreaterThanOrEqual(1);

    // Click "مراجعة واعتماد المشتريات"
    await user.click(reviewNavButtons[0]!);

    // Should open ProcurementReviewPage
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'مراجعة مشتريات الشركات' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'تصدير مسودة Excel' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'تصدير المعتمد Excel' })).toBeInTheDocument();
    });

    // Company filters: الكل / MAS / Horeca Smart
    const companySelect = screen.getByLabelText('الشركة') as HTMLSelectElement;
    expect(companySelect).toBeInTheDocument();
    expect(companySelect).toHaveTextContent('الكل');
    expect(companySelect).toHaveTextContent('MAS');
    expect(companySelect).toHaveTextContent('Horeca Smart');

    // Click "نظرة عامة" to return
    const overviewNavFromReview = screen.getByRole('button', { name: 'نظرة عامة' });
    await user.click(overviewNavFromReview);

    await waitFor(() => {
      expect(screen.getByText('نظرة عامة على المشتريات')).toBeInTheDocument();
    });
  });

  it('direct navigation to /procurement/review loads ProcurementReviewPage without rendering ProcurementOverviewPage', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'مراجعة مشتريات الشركات' })).toBeInTheDocument();
    });

    expect(screen.queryByText('نظرة عامة على المشتريات')).not.toBeInTheDocument();
  });
});
