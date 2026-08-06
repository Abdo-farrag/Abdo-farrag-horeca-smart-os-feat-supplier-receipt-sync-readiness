import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout } from '../api/auth.js';
import { useReviewProducts, useApproveRecommendation, useBulkUpdateRecommendations } from '../hooks/useReview.js';
import type { CompanyFilter, DecisionStatus } from '../types.js';

const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'حرج',
  HIGH: 'عالٍ',
  MEDIUM: 'متوسط',
  LOW: 'منخفض',
};

const DATA_STATUS_LABELS: Record<string, string> = {
  SUFFICIENT: 'كافية',
  INSUFFICIENT: 'غير كافية',
};

const DECISION_STATUS_LABELS: Record<string, string> = {
  NEW: 'جديد',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  DEFERRED: 'مؤجل',
};

const DECISION_OPTIONS: DecisionStatus[] = ['NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-SA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
}

interface EditableRow {
  productCode: string;
  productName: string;
  priority: string;
  dataStatus: string;
  supplierStatus: string;
  freeQty: number;
  effectiveDailyDemand: number;
  forecastQty: number | null;
  actualCoverageDays: number | null;
  suggestedQty: number | null;
  proposedSupplierName: string | null;
  latestReceiptAt: string | null;
  productVersion: number;
  // Editable fields
  approvedQty: number | null;
  reviewApprovedSupplierId: number | null;
  reviewApprovedSupplierName: string | null;
  decisionStatus: DecisionStatus | null;
  buyerNote: string | null;
  approvalVersion: number;
  selected: boolean;
  isDirty: boolean;
}

export function ProcurementReviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filters
  const [company, setCompany] = useState<CompanyFilter>('all');
  const [priority, setPriority] = useState('all');
  const [decisionStatus, setDecisionStatus] = useState('all');
  const [noSupplier, setNoSupplier] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const approveMutation = useApproveRecommendation();
  const bulkMutation = useBulkUpdateRecommendations();

  const [bulkDecisionStatus, setBulkDecisionStatus] = useState<DecisionStatus>('UNDER_REVIEW');
  const [bulkBuyerNote, setBulkBuyerNote] = useState('');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [company, priority, decisionStatus, noSupplier, debouncedSearch]);

  const filters = { company, priority, decisionStatus, noSupplier, search: debouncedSearch, page };
  const { data, isPending, isError, error } = useReviewProducts(filters);

  // Transform rows to editable rows with selection
  const rows: EditableRow[] = ((data?.rows ?? []) as Record<string, unknown>[]).map((r) => ({
    productCode: r.productCode as string,
    productName: r.productName as string,
    priority: r.priority as string,
    dataStatus: r.dataStatus as string,
    supplierStatus: r.supplierStatus as string,
    freeQty: Number(r.freeQty ?? 0),
    effectiveDailyDemand: Number(r.effectiveDailyDemand ?? 0),
    forecastQty: r.forecastQty as number | null,
    actualCoverageDays: r.actualCoverageDays as number | null,
    suggestedQty: r.suggestedQty as number | null,
    proposedSupplierName: r.proposedSupplierName as string | null,
    latestReceiptAt: r.latestReceiptAt as string | null,
    productVersion: Number(r.productVersion ?? 0),
    approvedQty: r.approvedQty as number | null,
    reviewApprovedSupplierId: r.reviewApprovedSupplierId as number | null,
    reviewApprovedSupplierName: r.reviewApprovedSupplierName as string | null,
    decisionStatus: (r.decisionStatus as DecisionStatus) ?? null,
    buyerNote: r.buyerNote as string | null,
    approvalVersion: Number(r.approvalVersion ?? 0),
    selected: false,
    isDirty: false,
  }));

  const pagination = data?.pagination ?? { page: 1, total: 0, pageSize: 50, totalPages: 1 };

  // Local state for row edits (stored by productCode)
  const [edits, setEdits] = useState<Record<string, {
    approvedQty: number | null;
    approvedSupplierName: string | null;
    decisionStatus: DecisionStatus;
    buyerNote: string | null;
  }>>({});

  const [savingProduct, setSavingProduct] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Select all
  const [selectAll, setSelectAll] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  const toggleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedSet(new Set());
      setSelectAll(false);
    } else {
      setSelectedSet(new Set(rows.map((r) => r.productCode)));
      setSelectAll(true);
    }
  }, [selectAll, rows]);

  const toggleSelect = useCallback((productCode: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(productCode)) {
        next.delete(productCode);
      } else {
        next.add(productCode);
      }
      return next;
    });
  }, []);

  // Update selectAll when selection changes
  useEffect(() => {
    if (rows.length > 0 && selectedSet.size === rows.length) {
      setSelectAll(true);
    } else {
      setSelectAll(false);
    }
  }, [selectedSet, rows]);

  const selectedProducts = rows.filter((r) => selectedSet.has(r.productCode));

  const handleSaveRow = async (row: EditableRow) => {
    const edit = edits[row.productCode];
    if (!edit) return;

    setSavingProduct(row.productCode);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await approveMutation.mutateAsync({
        productCode: row.productCode,
        decisionStatus: edit.decisionStatus,
        approvedQty: edit.approvedQty,
        approvedSupplierId: null,
        approvedSupplierName: edit.approvedSupplierName ?? null,
        buyerNote: edit.buyerNote ?? null,
        expectedVersion: row.approvalVersion,
      });
      setSuccessMessage(`تم حفظ ${row.productCode}`);
      // Clear edits for this row
      setEdits((prev) => {
        const next = { ...prev };
        delete next[row.productCode];
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل الحفظ';
      if (msg.includes('VERSION_CONFLICT')) {
        setErrorMessage(`تعارض الإصدار للمنتج ${row.productCode}. يرجى إعادة تحميل الصفحة.`);
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setSavingProduct(null);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedProducts.length === 0) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await bulkMutation.mutateAsync({
        items: selectedProducts.map((r) => ({
          productCode: r.productCode,
          approvedQty: edits[r.productCode]?.approvedQty ?? r.approvedQty,
          approvedSupplierId: null,
          approvedSupplierName: edits[r.productCode]?.approvedSupplierName ?? r.reviewApprovedSupplierName,
          expectedVersion: r.approvalVersion,
        })),
        decisionStatus: bulkDecisionStatus,
        buyerNote: bulkBuyerNote || null,
      });
      setSuccessMessage(`تم تحديث ${selectedProducts.length} منتج بنجاح`);
      setSelectedSet(new Set());
      setBulkBuyerNote('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل التحديث الجماعي';
      setErrorMessage(msg);
    }
  };

  const handlePageChange = useCallback((newPage: number) => setPage(newPage), []);

  // Logout
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/login', { replace: true });
    },
  });

  // Get edit values for a row (from local edits or original data)
  function getEdit(row: EditableRow) {
    return edits[row.productCode] ?? {
      approvedQty: row.approvedQty,
      approvedSupplierName: row.reviewApprovedSupplierName,
      decisionStatus: (row.decisionStatus ?? 'NEW') as DecisionStatus,
      buyerNote: row.buyerNote,
    };
  }

  function updateEdit(productCode: string, field: string, value: unknown) {
    setEdits((prev) => {
      const current = prev[productCode] ?? null;
      const row = rows.find((r) => r.productCode === productCode);
      if (!row) return prev;
      const original = {
        approvedQty: row.approvedQty,
        approvedSupplierName: row.reviewApprovedSupplierName,
        decisionStatus: (row.decisionStatus ?? 'NEW') as DecisionStatus,
        buyerNote: row.buyerNote,
      };
      const base = current ?? original;
      return { ...prev, [productCode]: { ...base, [field]: value } };
    });
  }

  return (
    <div className="review-page" dir="rtl">
      <header className="review-header">
        <div className="review-header__brand">
          <h1 className="review-header__title">Horeca Smart OS</h1>
          <span className="review-header__subtitle">مراجعة واعتماد المشتريات</span>
        </div>
        <nav className="review-header__nav">
          <button
            className="btn btn--ghost"
            onClick={() => navigate('/')}
          >
            نظرة عامة
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

      <main className="review-main">
        {/* Filters */}
        <div className="filters" role="search" aria-label="تصفية المنتجات">
          <div className="filters__group">
            <label className="filters__label" htmlFor="review-company">
              الشركة
            </label>
            <select
              id="review-company"
              className="filters__select"
              value={company}
              onChange={(e) => setCompany(e.target.value as CompanyFilter)}
            >
              <option value="all">جميع الشركات</option>
              <option value="1">MAS</option>
              <option value="2">Horeca Smart</option>
            </select>
          </div>

          <div className="filters__group">
            <label className="filters__label" htmlFor="review-priority">
              الأولوية
            </label>
            <select
              id="review-priority"
              className="filters__select"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="all">جميع الأولويات</option>
              <option value="CRITICAL">حرج</option>
              <option value="HIGH">عالٍ</option>
              <option value="MEDIUM">متوسط</option>
              <option value="LOW">منخفض</option>
            </select>
          </div>

          <div className="filters__group">
            <label className="filters__label" htmlFor="review-decision">
              حالة الاعتماد
            </label>
            <select
              id="review-decision"
              className="filters__select"
              value={decisionStatus}
              onChange={(e) => setDecisionStatus(e.target.value)}
            >
              <option value="all">جميع الحالات</option>
              {DECISION_OPTIONS.map((s) => (
                <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div className="filters__group">
            <label className="filters__label" htmlFor="review-no-supplier">
              <input
                id="review-no-supplier"
                type="checkbox"
                checked={noSupplier}
                onChange={(e) => setNoSupplier(e.target.checked)}
                style={{ marginLeft: '0.4rem' }}
              />
              بدون مورد
            </label>
          </div>

          <div className="filters__group filters__group--search">
            <label className="filters__label" htmlFor="review-search">
              البحث
            </label>
            <input
              id="review-search"
              type="search"
              className="filters__input"
              placeholder="ابحث بالكود أو الاسم..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>

        {/* Messages */}
        {errorMessage && (
          <div className="review-message review-message--error" role="alert">
            {errorMessage}
            <button className="review-message__close" onClick={() => setErrorMessage(null)}>✕</button>
          </div>
        )}
        {successMessage && (
          <div className="review-message review-message--success" role="status">
            {successMessage}
            <button className="review-message__close" onClick={() => setSuccessMessage(null)}>✕</button>
          </div>
        )}

        {/* Bulk actions bar */}
        {selectedProducts.length > 0 && (
          <div className="review-bulk-bar">
            <span className="review-bulk-bar__count">
              تم اختيار {selectedProducts.length} منتج
            </span>
            <div className="review-bulk-bar__actions">
              <select
                className="filters__select"
                value={bulkDecisionStatus}
                onChange={(e) => setBulkDecisionStatus(e.target.value as DecisionStatus)}
              >
                {DECISION_OPTIONS.map((s) => (
                  <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>
                ))}
              </select>
              <input
                type="text"
                className="filters__input"
                placeholder="ملاحظة..."
                value={bulkBuyerNote}
                onChange={(e) => setBulkBuyerNote(e.target.value)}
                style={{ width: '200px' }}
              />
              <button
                className="btn btn--primary"
                onClick={handleBulkUpdate}
                disabled={bulkMutation.isPending}
              >
                {bulkMutation.isPending ? 'جاري الحفظ...' : 'تطبيق على المختار'}
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {isPending && (
          <div className="state-message" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            جاري تحميل البيانات...
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="state-message state-message--error" role="alert">
            <p>تعذّر تحميل بيانات المراجعة.</p>
            <p className="state-message__detail">
              {error instanceof Error ? error.message : 'خطأ غير معروف'}
            </p>
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="table-wrapper">
            <div className="table-scroll">
              <table className="review-table" role="grid" aria-label="منتجات للمراجعة">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={selectAll}
                        onChange={toggleSelectAll}
                        aria-label="اختيار الكل"
                      />
                    </th>
                    <th>كود المنتج</th>
                    <th>اسم المنتج</th>
                    <th>الكمية المتاحة</th>
                    <th>أيام التغطية</th>
                    <th>الكمية المقترحة</th>
                    <th>المورد المقترح</th>
                    <th>الأولوية</th>
                    <th>حالة البيانات</th>
                    <th>آخر استلام</th>
                    <th>الكمية المعتمدة</th>
                    <th>المورد المعتمد</th>
                    <th>حالة الاعتماد</th>
                    <th>ملاحظة المشتري</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="table-empty">
                        لا توجد منتجات تطابق المعايير المحددة
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const edit = getEdit(row);
                      const isSaving = savingProduct === row.productCode;
                      const hasChanges = edits[row.productCode] !== undefined;
                      return (
                        <tr key={row.productCode} className={hasChanges ? 'review-row--dirty' : ''}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedSet.has(row.productCode)}
                              onChange={() => toggleSelect(row.productCode)}
                              aria-label={`اختيار ${row.productCode}`}
                            />
                          </td>
                          <td className="review-cell--code">{row.productCode}</td>
                          <td className="review-cell--name">{row.productName}</td>
                          <td>{formatQty(row.freeQty)}</td>
                          <td>{formatQty(row.actualCoverageDays)}</td>
                          <td className="review-cell--qty">{formatQty(row.suggestedQty)}</td>
                          <td>{row.proposedSupplierName ?? '—'}</td>
                          <td>
                            <span className={`priority-badge priority-badge--${row.priority.toLowerCase()}`}>
                              {PRIORITY_LABELS[row.priority] ?? row.priority}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge status-badge--${row.dataStatus === 'SUFFICIENT' ? 'approved' : 'needs-supplier'}`}>
                              {DATA_STATUS_LABELS[row.dataStatus] ?? row.dataStatus}
                            </span>
                          </td>
                          <td>{formatDate(row.latestReceiptAt)}</td>
                          <td>
                            <input
                              type="number"
                              className="review-input review-input--qty"
                              value={edit.approvedQty ?? ''}
                              onChange={(e) => updateEdit(row.productCode, 'approvedQty', e.target.value ? Number(e.target.value) : null)}
                              min="0"
                              disabled={isSaving}
                              aria-label={`الكمية المعتمدة لـ ${row.productCode}`}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="review-input"
                              value={edit.approvedSupplierName ?? ''}
                              onChange={(e) => updateEdit(row.productCode, 'approvedSupplierName', e.target.value || null)}
                              disabled={isSaving}
                              aria-label={`المورد المعتمد لـ ${row.productCode}`}
                            />
                          </td>
                          <td>
                            <select
                              className="filters__select"
                              value={edit.decisionStatus}
                              onChange={(e) => updateEdit(row.productCode, 'decisionStatus', e.target.value as DecisionStatus)}
                              disabled={isSaving}
                              aria-label={`حالة الاعتماد لـ ${row.productCode}`}
                            >
                              {DECISION_OPTIONS.map((s) => (
                                <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              className="review-input"
                              value={edit.buyerNote ?? ''}
                              onChange={(e) => updateEdit(row.productCode, 'buyerNote', e.target.value || null)}
                              disabled={isSaving}
                              aria-label={`ملاحظة المشتري لـ ${row.productCode}`}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn--primary btn--sm"
                              onClick={() => handleSaveRow(row)}
                              disabled={isSaving || !hasChanges}
                            >
                              {isSaving ? '...' : 'حفظ'}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination" aria-label="التنقل بين الصفحات">
              <button
                className="pagination__btn"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                aria-label="الصفحة السابقة"
              >
                ‹ السابق
              </button>
              <span className="pagination__info">
                صفحة {pagination.page.toLocaleString('ar-SA')} من{' '}
                {Math.max(1, pagination.totalPages).toLocaleString('ar-SA')}
                {' '}({pagination.total.toLocaleString('ar-SA')} منتج)
              </span>
              <button
                className="pagination__btn"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                aria-label="الصفحة التالية"
              >
                التالي ›
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
