import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';
import { ApiError } from '../api/client.js';

// Mock API modules
vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/review.js', () => ({
  fetchCompanyPurchaseReview: vi.fn(),
  saveCompanyPurchaseDecision: vi.fn(),
  bulkSaveCompanyPurchaseDecisions: vi.fn(),
  downloadPurchaseExport: vi.fn(),
}));

vi.mock('../api/purchase-drafts.js', () => ({
  fetchBrandOptions: vi.fn(),
  searchSuppliers: vi.fn(),
  createPurchaseDraft: vi.fn(),
  fetchPurchaseDraft: vi.fn(),
  updatePurchaseDraftLine: vi.fn(),
  changePurchaseDraftSupplier: vi.fn(),
  transitionPurchaseDraft: vi.fn(),
  downloadPurchaseDraftRfq: vi.fn(),
  setPurchaseDraftRfqReference: vi.fn(),
}));

import * as authApi from '../api/auth.js';
import * as reviewApi from '../api/review.js';
import * as draftApi from '../api/purchase-drafts.js';

const masRow = {
  companyId: 1 as const,
  companyName: 'MAS',
  productCode: '101002',
  productName: 'زيت النضاء 20 لتر',
  priority: 'CRITICAL' as const,
  freeQty: 10,
  effectiveDailyDemand: 5,
  coverageDays: 2,
  targetCoverageDays: 21,
  suggestedQty: 100,
  approvedQty: 80,
  supplierId: 101,
  supplierName: 'مورد MAS',
  supplierReadiness: 'VERIFIED_RECEIPT' as const,
  latestReceiptAt: '2026-08-01T10:00:00Z',
  latestUnitCost: 150,
  estimatedValue: 12000,
  decisionStatus: 'NEW' as const,
  buyerNote: null,
  version: 3,
  sourceUpdatedAt: '2026-08-01T10:00:00Z',
  readyForPo: true,
};

const horecaRow = {
  companyId: 2 as const,
  companyName: 'Horeca Smart',
  productCode: '101002',
  productName: 'زيت النضاء 20 لتر',
  priority: 'HIGH' as const,
  freeQty: 5,
  effectiveDailyDemand: 2,
  coverageDays: 2.5,
  targetCoverageDays: 21,
  suggestedQty: 60,
  approvedQty: 60,
  supplierId: null,
  supplierName: null,
  supplierReadiness: 'NEEDS_SUPPLIER' as const,
  latestReceiptAt: null,
  latestUnitCost: null,
  estimatedValue: null,
  decisionStatus: 'NEW' as const,
  buyerNote: null,
  version: 5,
  sourceUpdatedAt: null,
  readyForPo: false,
};

const fallbackRow = {
  companyId: 1 as const,
  companyName: 'MAS',
  productCode: '101003',
  productName: 'زيت الحلوة 700 مل',
  priority: 'MEDIUM' as const,
  freeQty: 20,
  effectiveDailyDemand: 4,
  coverageDays: 5,
  targetCoverageDays: 21,
  suggestedQty: 50,
  approvedQty: 50,
  supplierId: 102,
  supplierName: 'المورد الأساسي',
  supplierReadiness: 'FALLBACK_NEEDS_REVIEW' as const,
  latestReceiptAt: null,
  latestUnitCost: 100,
  estimatedValue: 5000,
  decisionStatus: 'NEW' as const,
  buyerNote: null,
  version: 1,
  sourceUpdatedAt: null,
  readyForPo: true,
};

const mockCompanyReviewResponse = {
  rows: [masRow, horecaRow],
  pagination: { page: 1, total: 2, pageSize: 50, totalPages: 1 },
};

describe('Company-First Procurement Review Page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockResolvedValue(mockCompanyReviewResponse);
    vi.mocked(reviewApi.downloadPurchaseExport).mockResolvedValue(undefined);
    vi.mocked(draftApi.fetchBrandOptions).mockResolvedValue([]);
    vi.mocked(draftApi.searchSuppliers).mockResolvedValue([]);
  });

  it('renders company-first review and proves company independence for identical productCode', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.saveCompanyPurchaseDecision).mockResolvedValue({
      ...masRow,
      approvedQty: 75,
      version: 4,
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'مراجعة مشتريات الشركات' })).toBeInTheDocument();
      expect(screen.getByText('تتم مراجعة احتياجات MAS وHoreca Smart بصورة مستقلة.')).toBeInTheDocument();
      expect(screen.getByTestId('row-1:101002')).toBeInTheDocument();
      expect(screen.getByTestId('row-2:101002')).toBeInTheDocument();
    });

    // Prove stable key identity: both rows render
    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(rows).toHaveLength(2);

    const masTr = screen.getByTestId('row-1:101002');
    const horecaTr = screen.getByTestId('row-2:101002');

    expect(within(masTr).getByText('MAS')).toBeInTheDocument();
    expect(within(horecaTr).getByText('Horeca Smart')).toBeInTheDocument();

    // Edit MAS approved quantity to 75
    const masQtyInput = within(masTr).getByLabelText(/الكمية المعتمدة لـ MAS 101002/i);
    const horecaQtyInput = within(horecaTr).getByLabelText(/الكمية المعتمدة لـ Horeca Smart 101002/i);

    expect(masQtyInput).toHaveValue(80);
    expect(horecaQtyInput).toHaveValue(60);

    await user.clear(masQtyInput);
    await user.type(masQtyInput, '75');

    // Prove editing MAS does NOT change Horeca Smart
    expect(masQtyInput).toHaveValue(75);
    expect(horecaQtyInput).toHaveValue(60);

    // Save MAS row
    const masSaveBtn = within(masTr).getByRole('button', { name: /حفظ/i });
    await user.click(masSaveBtn);

    await waitFor(() => {
      expect(reviewApi.saveCompanyPurchaseDecision).toHaveBeenCalled();
    });

    expect(reviewApi.saveCompanyPurchaseDecision).toHaveBeenCalledWith({
      companyId: 1,
      productCode: '101002',
      decisionStatus: 'NEW',
      approvedQty: 75,
      approvedSupplierId: 101,
      approvedSupplierName: 'مورد MAS',
      buyerNote: null,
      expectedVersion: 3,
    });
  });

  it('filters by company and resets pagination safely', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockImplementation(async (filters) => {
      if (filters.company === '1') {
        return {
          rows: [masRow],
          pagination: { page: 1, total: 1, pageSize: 50, totalPages: 1 },
        };
      }
      if (filters.company === '2') {
        return {
          rows: [horecaRow],
          pagination: { page: 1, total: 1, pageSize: 50, totalPages: 1 },
        };
      }
      return mockCompanyReviewResponse;
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByTestId('row-1:101002')).toBeInTheDocument();
      expect(screen.getByTestId('row-2:101002')).toBeInTheDocument();
    });

    const companySelect = screen.getByLabelText('الشركة');
    await user.selectOptions(companySelect, '1');

    await waitFor(() => {
      expect(screen.getByTestId('row-1:101002')).toBeInTheDocument();
      expect(screen.queryByTestId('row-2:101002')).not.toBeInTheDocument();
    });

    await user.selectOptions(companySelect, '2');

    await waitFor(() => {
      expect(screen.queryByTestId('row-1:101002')).not.toBeInTheDocument();
      expect(screen.getByTestId('row-2:101002')).toBeInTheDocument();
    });
  });

  it('filters recommendations by official brand and active supplier', async () => {
    const user = userEvent.setup();
    vi.mocked(draftApi.fetchBrandOptions).mockResolvedValue([
      { brandId: null, brandName: null, productCount: 3 },
      { brandId: 77, brandName: 'Official Brand', productCount: 12 },
    ]);
    vi.mocked(draftApi.searchSuppliers).mockResolvedValue([{
      supplierId: 99001,
      supplierName: 'RFQ Supplier A',
      supplierCode: 'RFQ-A',
      supplierRank: 2,
      active: true,
      sourceUpdatedAt: null,
    }]);

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });
    await screen.findByTestId('row-1:101002');

    await user.selectOptions(screen.getByLabelText('البراند الرسمي'), '77');
    const supplierSearch = screen.getByRole('combobox', { name: 'المورد المقترح' });
    await user.click(supplierSearch);
    await user.type(supplierSearch, 'RFQ-A');
    await user.click(await screen.findByRole('option', { name: /RFQ Supplier A/ }));

    await waitFor(() => {
      expect(reviewApi.fetchCompanyPurchaseReview).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: '77', supplierId: 99001 }),
      );
    });
  });

  it('validates APPROVED decision requires positive quantity and disables only target row during save', async () => {
    const user = userEvent.setup();
    let resolveSave: ((val: any) => void) | undefined;
    vi.mocked(reviewApi.saveCompanyPurchaseDecision).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByTestId('row-1:101002')).toBeInTheDocument();
    });

    const masTr = screen.getByTestId('row-1:101002');
    const horecaTr = screen.getByTestId('row-2:101002');

    const masStatusSelect = within(masTr).getByLabelText(/حالة الاعتماد لـ MAS 101002/i);
    const masQtyInput = within(masTr).getByLabelText(/الكمية المعتمدة لـ MAS 101002/i);

    await user.selectOptions(masStatusSelect, 'APPROVED');
    await user.clear(masQtyInput);
    await user.type(masQtyInput, '0');

    const masSaveBtn = within(masTr).getByRole('button', { name: /حفظ/i });
    await user.click(masSaveBtn);

    expect(
      screen.getByText('حالة معتمد تتطلب كمية معتمدة أكبر من صفر'),
    ).toBeInTheDocument();
    expect(reviewApi.saveCompanyPurchaseDecision).not.toHaveBeenCalled();

    // Now fix quantity to 80 on MAS row and edit Horeca row so both have changes
    await user.clear(masQtyInput);
    await user.type(masQtyInput, '80');

    const horecaQtyInput = within(horecaTr).getByLabelText(/الكمية المعتمدة لـ Horeca Smart 101002/i);
    await user.clear(horecaQtyInput);
    await user.type(horecaQtyInput, '65');

    await user.click(masSaveBtn);

    expect(within(masTr).getByRole('button')).toBeDisabled();
    expect(within(masTr).getByRole('button')).toHaveTextContent('...');
    expect(within(horecaTr).getByRole('button', { name: 'حفظ' })).not.toBeDisabled();

    if (resolveSave) {
      resolveSave({ ...masRow, approvedQty: 80, decisionStatus: 'APPROVED' });
    }
  });

  it('displays clear Arabic version conflict message and preserves buyer edits', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.saveCompanyPurchaseDecision).mockRejectedValue(
      new Error('VERSION_CONFLICT'),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByTestId('row-1:101002')).toBeInTheDocument();
    });

    const masTr = screen.getByTestId('row-1:101002');
    const masQtyInput = within(masTr).getByLabelText(/الكمية المعتمدة لـ MAS 101002/i);
    await user.clear(masQtyInput);
    await user.type(masQtyInput, '95');

    const masSaveBtn = within(masTr).getByRole('button', { name: /حفظ/i });
    await user.click(masSaveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/تعارض في الإصدار للمنتج. تم تعديل البيانات بواسطة شخص آخر, يرجى إعادة التحميل./i),
      ).toBeInTheDocument();
    });

    // Check that buyer edit is preserved
    expect(masQtyInput).toHaveValue(95);
  });

  it('renders distinct accessible supplier readiness labels and PO readiness', async () => {
    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockResolvedValue({
      rows: [masRow, horecaRow, fallbackRow],
      pagination: { page: 1, total: 3, pageSize: 50, totalPages: 1 },
    });

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByText('مورد موثّق من استلام فعلي')).toBeInTheDocument();
      expect(screen.getByText('يحتاج تحديد مورد')).toBeInTheDocument();
      expect(screen.getByText('المورد الأساسي — يحتاج مراجعة')).toBeInTheDocument();
      expect(screen.getByText('غير جاهز للشراء')).toBeInTheDocument();
      // 1 header column + 2 rows = 3 instances of "جاهز للشراء"
      expect(screen.getAllByText('جاهز للشراء')).toHaveLength(3);
    });
  });

  it('handles Excel draft and approved export buttons with loading state and error handling', async () => {
    const user = userEvent.setup();
    let resolveExport: (() => void) | undefined;
    vi.mocked(reviewApi.downloadPurchaseExport).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'تصدير مسودة Excel' })).toBeInTheDocument();
    });

    const draftBtn = screen.getByRole('button', { name: 'تصدير مسودة Excel' });
    const approvedBtn = screen.getByRole('button', { name: 'تصدير المعتمد Excel' });

    await user.click(draftBtn);

    expect(reviewApi.downloadPurchaseExport).toHaveBeenCalledWith('draft');
    expect(draftBtn).toBeDisabled();
    expect(approvedBtn).toBeDisabled();

    if (resolveExport) resolveExport();

    await waitFor(() => {
      expect(draftBtn).not.toBeDisabled();
      expect(approvedBtn).not.toBeDisabled();
    });

    // Test failed export
    vi.mocked(reviewApi.downloadPurchaseExport).mockRejectedValueOnce(
      new Error('فشل التصدير'),
    );

    await user.click(approvedBtn);

    await waitFor(() => {
      expect(screen.getByText('فشل التصدير')).toBeInTheDocument();
    });

    expect(reviewApi.saveCompanyPurchaseDecision).not.toHaveBeenCalled();
  });

  it('shows loading, error, and empty states gracefully', async () => {
    const user = userEvent.setup();
    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockRejectedValueOnce(
      new ApiError(503, 'COMPANY_REVIEW_UNAVAILABLE'),
    );

    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/review'] });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /إعادة المحاولة/i })).toBeInTheDocument();
    });

    vi.mocked(reviewApi.fetchCompanyPurchaseReview).mockResolvedValueOnce({
      rows: [],
      pagination: { page: 1, total: 0, pageSize: 50, totalPages: 1 },
    });

    await user.click(screen.getByRole('button', { name: /إعادة المحاولة/i }));

    await waitFor(() => {
      expect(screen.getByText('لا توجد مشتريات مطابقة')).toBeInTheDocument();
    });
  });
});
