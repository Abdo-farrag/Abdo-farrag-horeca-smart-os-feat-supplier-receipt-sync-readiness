import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/auth.js';
import { Filters } from '../components/Filters.js';
import { KpiCards } from '../components/KpiCards.js';
import { ProductTable } from '../components/ProductTable.js';
import { useProcurement } from '../hooks/useProcurement.js';
import type { CompanyFilter, CoverageDays } from '../types.js';

export function ProcurementOverviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [company, setCompany] = useState<CompanyFilter>('all');
  const [coverageDays, setCoverageDays] = useState<CoverageDays>(14);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [company, coverageDays, debouncedSearch]);

  const filters = { company, coverageDays, search: debouncedSearch, page };
  const { data, isPending, isError, error } = useProcurement(filters);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/login', { replace: true });
    },
  });

  const handlePageChange = useCallback((newPage: number) => setPage(newPage), []);

  return (
    <div className="overview-page" dir="rtl">
      <header className="overview-header">
        <div className="overview-header__brand">
          <h1 className="overview-header__title">Horeca Smart OS</h1>
          <span className="overview-header__subtitle">نظرة عامة على المشتريات</span>
        </div>
        <nav className="overview-header__nav">
          <button
            className="btn--nav btn--nav-active"
            onClick={() => navigate('/')}
            aria-current="page"
          >
            نظرة عامة
          </button>
          <button
            className="btn--nav"
            onClick={() => navigate('/procurement/review')}
          >
            مراجعة واعتماد المشتريات
          </button>
          <button
            className="btn btn--ghost"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            aria-label="تسجيل الخروج"
          >
            {logoutMutation.isPending ? '...' : 'تسجيل الخروج'}
          </button>
        </nav>
      </header>

      <main className="overview-main">
        <div className="overview-action-bar">
          <div className="overview-action-bar__info">
            <h2 className="overview-action-bar__title">مراجعة مشتريات الشركات</h2>
            <p className="overview-action-bar__subtitle">
              استعراض واعتماد خطة المشتريات المستقلة لـ MAS و Horeca Smart وتصدير تقارير Excel.
            </p>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => navigate('/procurement/review')}
          >
            مراجعة واعتماد المشتريات
          </button>
        </div>

        <Filters
          company={company}
          coverageDays={coverageDays}
          search={searchInput}
          onCompanyChange={setCompany}
          onCoverageDaysChange={setCoverageDays}
          onSearchChange={setSearchInput}
        />

        {isPending && (
          <div className="state-message" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            جاري تحميل البيانات...
          </div>
        )}

        {isError && (
          <div className="state-message state-message--error" role="alert">
            <p>تعذّر تحميل بيانات المشتريات.</p>
            <p className="state-message__detail">
              {error instanceof Error ? error.message : 'خطأ غير معروف'}
            </p>
          </div>
        )}

        {data && (
          <>
            <KpiCards summary={data.summary} syncStatus={data.syncStatus} />
            <ProductTable
              rows={data.rows}
              pagination={data.pagination}
              onPageChange={handlePageChange}
            />
          </>
        )}
      </main>
    </div>
  );
}
