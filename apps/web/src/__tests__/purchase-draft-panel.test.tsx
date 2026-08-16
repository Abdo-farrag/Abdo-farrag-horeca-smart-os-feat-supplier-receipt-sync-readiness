import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { PurchaseDraftPanel } from '../components/PurchaseDraftPanel.js';

vi.mock('../api/purchase-drafts.js', () => ({
  searchSuppliers: vi.fn(),
  createPurchaseDraft: vi.fn(),
  fetchPurchaseDraft: vi.fn(),
  updatePurchaseDraftLine: vi.fn(),
  changePurchaseDraftSupplier: vi.fn(),
  transitionPurchaseDraft: vi.fn(),
  downloadPurchaseDraftRfq: vi.fn(),
  setPurchaseDraftRfqReference: vi.fn(),
}));

import * as draftApi from '../api/purchase-drafts.js';

const row = {
  companyId: 1 as const,
  companyName: 'MAS',
  productCode: '101002',
  productName: 'Oil Pack',
  brandId: null,
  brandName: null,
  priority: 'CRITICAL' as const,
  freeQty: 2,
  effectiveDailyDemand: 4,
  coverageDays: 0.5,
  targetCoverageDays: 14,
  suggestedQty: 23,
  approvedQty: null,
  supplierId: null,
  supplierName: null,
  supplierReadiness: 'NEEDS_SUPPLIER' as const,
  latestReceiptAt: null,
  latestUnitCost: null,
  estimatedValue: null,
  decisionStatus: 'NEW' as const,
  buyerNote: null,
  version: 7,
  sourceUpdatedAt: null,
  readyForPo: false,
};

const supplier = {
  supplierId: 99001,
  supplierName: 'RFQ Supplier A',
  supplierCode: 'RFQ-A',
  supplierRank: 2,
  active: true as const,
  sourceUpdatedAt: null,
};

const snapshot = {
  draft: {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'DRAFT' as const,
    companyId: 1 as const,
    companyName: 'MAS',
    supplierId: 99001,
    supplierName: 'RFQ Supplier A',
    supplierCode: 'RFQ-A',
    expectedReceiptDate: null,
    buyerNote: null,
    odooRfqId: null,
    odooRfqName: null,
    version: 1,
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
  },
  lines: [{
    id: '22222222-2222-4222-8222-222222222222',
    draftId: '11111111-1111-4111-8111-111111111111',
    productCode: '101002',
    productName: 'Oil Pack',
    brandName: null,
    suggestedQty: 23,
    approvedQty: 24,
    purchaseUom: 'Pack',
    minimumOrderQty: 12,
    orderMultiple: 6,
    unitPrice: 95,
    priceSource: 'ODOO_VENDOR_PRICE' as const,
    currency: 'SAR',
    warnings: ['BRAND_UNDEFINED' as const],
    sourceRecommendationVersion: 7,
    version: 1,
    buyerNote: null,
  }],
};

describe('PurchaseDraftPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(draftApi.searchSuppliers).mockResolvedValue([supplier]);
    vi.mocked(draftApi.createPurchaseDraft).mockResolvedValue(snapshot);
  });

  it('blocks a mixed-company draft', () => {
    render(
      <PurchaseDraftPanel
        selectedRows={[row, { ...row, companyId: 2, companyName: 'Horeca Smart' }]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('اختر منتجات من شركة واحدة فقط لإنشاء المسودة.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إنشاء المسودة' })).not.toBeInTheDocument();
  });

  it('searches the active supplier directory and creates one-company one-supplier draft', async () => {
    const user = userEvent.setup();
    render(<PurchaseDraftPanel selectedRows={[row]} onClose={() => undefined} />);

    const combobox = screen.getByRole('combobox', { name: 'مورد هذه المسودة' });
    await user.click(combobox);
    await user.type(combobox, 'RFQ-A');
    await waitFor(() => expect(draftApi.searchSuppliers).toHaveBeenCalled());
    await user.click(await screen.findByRole('option', { name: /RFQ Supplier A/ }));
    await user.click(screen.getByRole('button', { name: 'إنشاء المسودة' }));

    await waitFor(() => {
      expect(draftApi.createPurchaseDraft).toHaveBeenCalledWith({
        companyId: 1,
        supplierId: 99001,
        expectedReceiptDate: null,
        buyerNote: null,
        items: [{ productCode: '101002', expectedRecommendationVersion: 7 }],
      });
    });
    expect(screen.getByLabelText('كمية المسودة 101002')).toHaveValue(24);
    expect(screen.getAllByText('براند غير محدد')).toHaveLength(2);
  });
});
