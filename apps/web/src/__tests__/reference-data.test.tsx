import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App.js';
import { renderWithProviders } from './test-utils.js';

vi.mock('../api/auth.js', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
}));

vi.mock('../api/reference-data.js', () => ({
  downloadReferenceData: vi.fn(),
  previewReferenceData: vi.fn(),
  applyReferenceData: vi.fn(),
}));

import * as authApi from '../api/auth.js';
import * as referenceApi from '../api/reference-data.js';

describe('Procurement reference-data page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.checkSession).mockResolvedValue({ authenticated: true });
    vi.mocked(referenceApi.previewReferenceData).mockResolvedValue({
      batchId: '11111111-1111-4111-8111-111111111111',
      filename: 'procurement-reference.xlsx',
      templateVersion: '1.0',
      totalRows: 2,
      validRows: 1,
      invalidRows: 1,
      errors: [{
        row_number: 3,
        severity: 'ERROR',
        error_code: 'SUPPLIER_NOT_SELECTABLE',
        error_message: 'Supplier is not selectable',
        original_row: { product_code: '101071' },
      }],
      changes: [{
        rowNumber: 2,
        companyId: 1,
        productCode: '101071',
        supplierId: 29906,
        changeType: 'UPDATE',
      }],
    });
    vi.mocked(referenceApi.applyReferenceData).mockResolvedValue({
      batchId: '11111111-1111-4111-8111-111111111111',
      status: 'APPLIED',
      inserted: 0,
      updated: 1,
      unchanged: 0,
      skipped: 0,
    });
  });

  it('opens the bulk supplier and brand management route', async () => {
    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/reference-data'] });

    expect(await screen.findByRole('heading', {
      name: 'تحديث الموردين والبراندات جماعيًا',
    })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تنزيل ملف البيانات الحالي' })).toBeInTheDocument();
    expect(screen.getByLabelText('ملف Excel المعدّل')).toBeInTheDocument();
  });

  it('shows row errors after preview and keeps apply disabled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/reference-data'] });
    const file = new File(['xlsx'], 'procurement-reference.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await user.upload(await screen.findByLabelText('ملف Excel المعدّل'), file);
    await user.click(screen.getByRole('button', { name: 'معاينة التغييرات' }));

    await waitFor(() => {
      expect(screen.getByText('SUPPLIER_NOT_SELECTABLE')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'تطبيق التحديثات' })).toBeDisabled();
  });

  it('applies a clean preview by batch id only', async () => {
    vi.mocked(referenceApi.previewReferenceData).mockResolvedValueOnce({
      batchId: '11111111-1111-4111-8111-111111111111',
      filename: 'procurement-reference.xlsx',
      templateVersion: '1.0',
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      errors: [],
      changes: [{
        rowNumber: 2,
        companyId: 1,
        productCode: '101071',
        supplierId: 29906,
        changeType: 'UPDATE',
      }],
    });
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />, { initialEntries: ['/procurement/reference-data'] });
    const file = new File(['xlsx'], 'procurement-reference.xlsx');

    await user.upload(await screen.findByLabelText('ملف Excel المعدّل'), file);
    await user.click(screen.getByRole('button', { name: 'معاينة التغييرات' }));
    const applyButton = await screen.findByRole('button', { name: 'تطبيق التحديثات' });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);

    await waitFor(() => {
      expect(referenceApi.applyReferenceData).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(screen.getByText('تم تطبيق التحديثات بنجاح')).toBeInTheDocument();
    });
  });
});
