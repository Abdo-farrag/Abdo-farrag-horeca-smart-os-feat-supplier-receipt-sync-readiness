import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';
import { ApiError } from '../api/client.js';

// Mock all API modules
vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/review.js', () => ({
  fetchReviewProducts: vi.fn(),
  approveRecommendation: vi.fn(),
  bulkUpdateRecommendations: vi.fn(),
}));

import * as authApi from '../api/auth.js';
import * as reviewApi from '../api/review.js';

const mockProducts = {
  rows: [
    {
      productCode: '101002',
      productName: '[101002] El Nada Olein Oil 20 L - Pack',
      freeQty: 2,
      effectiveDailyDemand: 849.33,
      forecastQty: 849.33,
      actualCoverageDays: 0.03,
      suggestedQty: 1515,
      priority: 'CRITICAL',
      dataStatus: 'SUFFICIENT',
      supplierStatus: 'NEEDS_SUPPLIER',
      proposedSupplierName: null,
      latestReceiptAt: null,
      productVersion: 0,
      approvedQty: null,
      reviewApprovedSupplierId: null,
      reviewApprovedSupplierName: null,
      decisionStatus: null,
      buyerNote: null,
      approvalVersion: 0,
    },
    {
      productCode: '101003',
      productName: '[101003] El Helwa Mixed Oil 700 ml - 12 Pack',
      freeQty: 5,
      effectiveDailyDemand: 55.07,
      forecastQty: 55.07,
      actualCoverageDays: 1.5,
      suggestedQty: 97,
      priority: 'HIGH',
      dataStatus: 'SUFFICIENT',
      supplierStatus: 'APPROVED',
      proposedSupplierName: 'مورد تجربة',
      latestReceiptAt: '2026-06-15T10:00:00Z',
      productVersion: 0,
      approvedQty: 100,
      reviewApprovedSupplierId: 1,
      reviewApprovedSupplierName: 'مورد معتمد',
      decisionStatus: 'APPROVED',
      buyerNote: 'ملاحظة',
      approvalVersion: 1,
    },
  ],
  pagination: { page: 1, total: 2, pageSize: 50, totalPages: 1 },
};

describe('Procurement Review Page', () => {
  beforeEach(() => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    vi.mocked(reviewApi.fetchReviewProducts).mockResolvedValue(mockProducts);
  });

  it('loads and displays recommendations', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('مراجعة واعتماد المشتريات')).toBeInTheDocument();
      expect(screen.getByText('101002')).toBeInTheDocument();
      expect(screen.getByText('101003')).toBeInTheDocument();
      expect(screen.getAllByText('حرج').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('عالٍ').length).toBeGreaterThanOrEqual(1);
    });

    // Decision status select shows options
    const statusSelect = screen.getAllByRole('combobox', { name: /حالة الاعتماد/i });
    expect(statusSelect.length).toBeGreaterThanOrEqual(1);
  });

  it('approves a product by filling editable fields and clicking save', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.approveRecommendation).mockResolvedValue({
      productCode: '101002',
      approvedQty: 1500,
      approvedSupplierId: null,
      approvedSupplierName: 'مورد جديد',
      decisionStatus: 'APPROVED',
      buyerNote: 'موافقة',
      version: 1,
      updatedAt: '2026-07-26T10:00:00Z',
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('101002')).toBeInTheDocument();
    });

    const row = screen.getByText('101002').closest('tr')!;

    // Find the approved qty input for 101002
    const qtyInput = within(row).getByLabelText(/الكمية المعتمدة لـ 101002/);
    await user.clear(qtyInput);
    await user.type(qtyInput, '1500');

    // Set decision status to APPROVED
    const statusSelect = within(row).getByLabelText(/حالة الاعتماد لـ 101002/);
    await user.selectOptions(statusSelect, 'APPROVED');

    // Click save
    const saveBtn = within(row).getByRole('button', { name: /حفظ/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(reviewApi.approveRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({
          productCode: '101002',
          approvedQty: 1500,
          decisionStatus: 'APPROVED',
        }),
      );
    });
  });

  it('rejects a product', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.approveRecommendation).mockResolvedValue({
      productCode: '101002',
      approvedQty: null,
      approvedSupplierId: null,
      approvedSupplierName: null,
      decisionStatus: 'REJECTED',
      buyerNote: 'مرفوض بسبب نقص البيانات',
      version: 1,
      updatedAt: '2026-07-26T10:00:00Z',
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('101002')).toBeInTheDocument();
    });

    const row = screen.getByText('101002').closest('tr')!;

    // Set status to REJECTED
    const statusSelect = within(row).getByLabelText(/حالة الاعتماد لـ 101002/);
    await user.selectOptions(statusSelect, 'REJECTED');

    // Add note
    const noteInput = within(row).getByLabelText(/ملاحظة المشتري لـ 101002/);
    await user.type(noteInput, 'مرفوض بسبب نقص البيانات');

    // Save
    const saveBtn = within(row).getByRole('button', { name: /حفظ/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(reviewApi.approveRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({
          productCode: '101002',
          decisionStatus: 'REJECTED',
          buyerNote: 'مرفوض بسبب نقص البيانات',
        }),
      );
    });
  });

  it('changes approved quantity', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.approveRecommendation).mockResolvedValue({
      productCode: '101003',
      approvedQty: 80,
      approvedSupplierId: null,
      approvedSupplierName: 'مورد معتمد',
      decisionStatus: 'APPROVED',
      buyerNote: 'تعديل الكمية',
      version: 2,
      updatedAt: '2026-07-26T10:00:00Z',
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('101003')).toBeInTheDocument();
    });

    const row = screen.getByText('101003').closest('tr')!;

    const qtyInput = within(row).getByLabelText(/الكمية المعتمدة لـ 101003/);
    await user.clear(qtyInput);
    await user.type(qtyInput, '80');

    const saveBtn = within(row).getByRole('button', { name: /حفظ/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(reviewApi.approveRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({
          productCode: '101003',
          approvedQty: 80,
        }),
      );
    });
  });

  it('handles version conflict error', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.approveRecommendation).mockRejectedValue(
      new Error('VERSION_CONFLICT'),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('101002')).toBeInTheDocument();
    });

    const row = screen.getByText('101002').closest('tr')!;

    const statusSelect = within(row).getByLabelText(/حالة الاعتماد لـ 101002/);
    await user.selectOptions(statusSelect, 'APPROVED');

    const saveBtn = within(row).getByRole('button', { name: /حفظ/ });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/تعارض الإصدار للمنتج 101002/),
      ).toBeInTheDocument();
    });
  });

  it('bulk approves selected products', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.bulkUpdateRecommendations).mockResolvedValue({
      batchId: 'batch-1',
      items: [
        {
          productCode: '101002',
          approvedQty: null,
          approvedSupplierId: null,
          approvedSupplierName: null,
          decisionStatus: 'APPROVED',
          buyerNote: null,
          version: 1,
          updatedAt: '2026-07-26T10:00:00Z',
        },
        {
          productCode: '101003',
          approvedQty: null,
          approvedSupplierId: null,
          approvedSupplierName: null,
          decisionStatus: 'APPROVED',
          buyerNote: null,
          version: 2,
          updatedAt: '2026-07-26T10:00:00Z',
        },
      ],
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('101002')).toBeInTheDocument();
    });

    // Select all
    const selectAllCheckbox = screen.getByLabelText('اختيار الكل');
    await user.click(selectAllCheckbox);

    // Bulk action bar should appear
    await waitFor(() => {
      expect(screen.getByText(/تم اختيار 2 منتج/)).toBeInTheDocument();
    });

    // Click bulk apply
    const applyBtn = screen.getByRole('button', { name: 'تطبيق على المختار' });
    await user.click(applyBtn);

    await waitFor(() => {
      expect(reviewApi.bulkUpdateRecommendations).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionStatus: 'UNDER_REVIEW',
          items: expect.arrayContaining([
            expect.objectContaining({ productCode: '101002' }),
            expect.objectContaining({ productCode: '101003' }),
          ]),
        }),
      );
    });
  });

  it('redirects unauthenticated users to login', async () => {
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: false });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('كلمة المرور')).toBeInTheDocument();
    });
  });

  it('shows loading state', async () => {
    vi.mocked(reviewApi.fetchReviewProducts).mockReturnValue(
      new Promise(() => {}), // never resolves
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('جاري تحميل البيانات...')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(reviewApi.fetchReviewProducts).mockRejectedValue(
      new ApiError(503, 'REVIEW_UNAVAILABLE'),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
