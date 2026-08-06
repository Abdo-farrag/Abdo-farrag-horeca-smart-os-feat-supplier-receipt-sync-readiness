import type { CompanyFilter, CoverageDays } from '../types.js';

interface FiltersProps {
  company: CompanyFilter;
  coverageDays: CoverageDays;
  search: string;
  onCompanyChange: (value: CompanyFilter) => void;
  onCoverageDaysChange: (value: CoverageDays) => void;
  onSearchChange: (value: string) => void;
}

export function Filters({
  company,
  coverageDays,
  search,
  onCompanyChange,
  onCoverageDaysChange,
  onSearchChange,
}: FiltersProps) {
  return (
    <div className="filters" role="search" aria-label="تصفية المنتجات">
      <div className="filters__group">
        <label className="filters__label" htmlFor="company-filter">
          الشركة
        </label>
        <select
          id="company-filter"
          className="filters__select"
          value={company}
          onChange={(e) => onCompanyChange(e.target.value as CompanyFilter)}
          aria-label="تصفية حسب الشركة"
        >
          <option value="all">جميع الشركات</option>
          <option value="1">MAS</option>
          <option value="2">Horeca Smart</option>
        </select>
      </div>

      <div className="filters__group">
        <label className="filters__label" htmlFor="coverage-filter">
          أيام التغطية
        </label>
        <select
          id="coverage-filter"
          className="filters__select"
          value={coverageDays}
          onChange={(e) => onCoverageDaysChange(Number(e.target.value) as CoverageDays)}
          aria-label="تصفية حسب أيام التغطية"
        >
          {([7, 14, 21, 30] as const).map((d) => (
            <option key={d} value={d}>
              {d} أيام
            </option>
          ))}
        </select>
      </div>

      <div className="filters__group filters__group--search">
        <label className="filters__label" htmlFor="search-filter">
          البحث
        </label>
        <input
          id="search-filter"
          type="search"
          className="filters__input"
          placeholder="ابحث بالكود أو الاسم..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="البحث عن منتج"
        />
      </div>
    </div>
  );
}
