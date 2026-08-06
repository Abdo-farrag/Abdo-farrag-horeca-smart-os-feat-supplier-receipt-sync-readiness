import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Filters } from '../components/Filters.js';
import { renderWithProviders } from './test-utils.js';
import type { CompanyFilter, CoverageDays } from '../types.js';

const defaultProps = {
  company: 'all' as CompanyFilter,
  coverageDays: 14 as CoverageDays,
  search: '',
  onCompanyChange: vi.fn(),
  onCoverageDaysChange: vi.fn(),
  onSearchChange: vi.fn(),
};

describe('Filters component', () => {
  it('renders all company options', () => {
    renderWithProviders(<Filters {...defaultProps} />);
    const select = screen.getByLabelText('تصفية حسب الشركة') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select).toHaveDisplayValue('جميع الشركات');
  });

  it('includes MAS and Horeca Smart as company options', () => {
    renderWithProviders(<Filters {...defaultProps} />);
    expect(screen.getByText('MAS')).toBeInTheDocument();
    expect(screen.getByText('Horeca Smart')).toBeInTheDocument();
  });

  it('defaults coverage days to 14', () => {
    renderWithProviders(<Filters {...defaultProps} />);
    const select = screen.getByLabelText('تصفية حسب أيام التغطية') as HTMLSelectElement;
    expect(select.value).toBe('14');
  });

  it('renders all four coverage day options (7, 14, 21, 30)', () => {
    renderWithProviders(<Filters {...defaultProps} />);
    const select = screen.getByLabelText('تصفية حسب أيام التغطية') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['7', '14', '21', '30']);
  });

  it('calls onCompanyChange when the company select changes', () => {
    const onCompanyChange = vi.fn();
    renderWithProviders(<Filters {...defaultProps} onCompanyChange={onCompanyChange} />);
    fireEvent.change(screen.getByLabelText('تصفية حسب الشركة'), { target: { value: '1' } });
    expect(onCompanyChange).toHaveBeenCalledWith('1');
  });

  it('calls onCoverageDaysChange when coverage days change', () => {
    const onCoverageDaysChange = vi.fn();
    renderWithProviders(<Filters {...defaultProps} onCoverageDaysChange={onCoverageDaysChange} />);
    fireEvent.change(screen.getByLabelText('تصفية حسب أيام التغطية'), { target: { value: '7' } });
    expect(onCoverageDaysChange).toHaveBeenCalledWith(7);
  });

  it('calls onSearchChange when typing in the search field', () => {
    const onSearchChange = vi.fn();
    renderWithProviders(<Filters {...defaultProps} onSearchChange={onSearchChange} />);
    fireEvent.change(screen.getByLabelText('البحث عن منتج'), { target: { value: 'كود-123' } });
    expect(onSearchChange).toHaveBeenCalledWith('كود-123');
  });
});
