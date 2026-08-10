import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logout } from '../api/auth.js';
import {
  useCompanyPurchaseReview,
  useSaveCompanyDecision,
  useBulkSaveCompanyDecisions,
} from '../hooks/useReview.js';
import { downloadPurchaseExport } from '../api/review.js';
import {
  companyPurchaseRowKey,
  type CompanyFilter,
  type DecisionStatus,
  type CompanyPurchaseRow,
  type SupplierReadiness,
  type PurchaseExportScope,
} from '../types.js';

const PRIORITY_LABELS: Record<string, string> = {
  CRITICAL: 'حرج',
  HIGH: 'عالٍ',
  MEDIUM: 'متوسط',
  LOW: 'منخفض',
};

const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  NEW: 'جديد',
  UNDER_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  DEFERRED: 'مؤجل',
};

const SUPPLIER_READINESS_LABELS: Record<SupplierReadiness, string> = {
  VERIFIED_RECEIPT: 'مورد موثّق من استلام فعلي',
  FALLBACK_NEEDS_REVIEW: 'المورد الأساسي — يحتاج مراجعة',
  NEEDS_SUPPLIER: 'يحتاج تحديد مورد',
};

const DECISION_OPTIONS: DecisionStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'DEFERRED',
];

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

function formatCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 });
}

interface RowEditState {
  approvedQty: number | null;
  approvedSupplierName: string | null;
  decisionStatus: DecisionStatus;
  buyerNote: string | null;
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

  const saveDecisionMutation = useSaveCompanyDecision();
  const bulkMutation = useBulkSaveCompanyDecisions();

  const [bulkDecisionStatus, setBulkDecisionStatus] = useState<DecisionStatus>('UNDER_REVIEW');
  const [bulkBuyerNote, setBulkBuyerNote] = useState('');

  // Export state
  const [exportingScope, setExportingScope] = useState<PurchaseExportScope | null>(null);

  // Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [company, priority, decisionStatus, noSupplier, debouncedSearch]);

  const filters = { company, priority, decisionStatus, noSupplier, search: debouncedSearch, page };
  const { data, isPending, isError, error, refetch } = useCompanyPurchaseReview(filters);

  const rows = data?.rows ?? [];
  const pagination = data?.pagination ?? { page: 1, total: 0, pageSize: 50, totalPages: 1 };

  // Edits state keyed by `${companyId}:${productCode}`
  const [edits, setEdits] = useState<Record<string, RowEditState>>({});

  // Saving row key
  const [savingRowKey, setSavingRowKey] = useState<string | null>(null);

  // Selected rows by rowKey
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  const toggleSelectAll = useCallback(() => {
    setSelectedSet((prev) => {
      const allRowKeys = rows.map(companyPurchaseRowKey);
      if (allRowKeys.length > 0 && prev.size === allRowKeys.length) {
        return new Set();
      }
      return new Set(allRowKeys);
    });
  }, [rows]);

  const toggleSelect = useCallback((key: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const allSelected = rows.length > 0 && selectedSet.size === rows.length;
  const selectedRows = rows.filter((r) => selectedSet.has(companyPurchaseRowKey(r)));

  const getEdit = (row: CompanyPurchaseRow): RowEditState => {
    const key = companyPurchaseRowKey(row);
    return (
      edits[key] ?? {
        approvedQty: row.approvedQty,
        approvedSupplierName: row.supplierName,
        decisionStatus: row.decisionStatus ?? 'NEW',
        buyerNote: row.buyerNote,
      }
    );
  };

  const updateEdit = (row: CompanyPurchaseRow, field: keyof RowEditState, value: unknown) => {
    const key = companyPurchaseRowKey(row);
    setEdits((prev) => {
      const current = prev[key] ?? {
        approvedQty: row.approvedQty,
        approvedSupplierName: row.supplierName,
        decisionStatus: row.decisionStatus ?? 'NEW',
        buyerNote: row.buyerNote,
      };
      return {
        ...prev,
        [key]: {
          ...current,
          [field]: value,
        },
      };
    });
  };

  const handleSaveRow = async (row: CompanyPurchaseRow) => {
    const key = companyPurchaseRowKey(row);
    const edit = getEdit(row);

    // Client-side decision validation: APPROVED requires qty > 0
    if (edit.decisionStatus === 'APPROVED') {
      if (edit.approvedQty === null || edit.approvedQty === undefined || edit.approvedQty <= 0) {
        setErrorMessage('حالة معتمد تتطلب كمية معتمدة أكبر من صفر');
        return;
      }
    }

    setSavingRowKey(key);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await saveDecisionMutation.mutateAsync({
        companyId: row.companyId,
        productCode: row.productCode,
        decisionStatus: edit.decisionStatus,
        approvedQty: edit.approvedQty,
        approvedSupplierId: row.supplierId ?? null,
        approvedSupplierName: edit.approvedSupplierName ?? row.supplierName ?? null,
        buyerNote: edit.buyerNote ?? null,
        expectedVersion: row.version,
      });

      setSuccessMessage(`تم حفظ القرار لـ ${row.companyName} (${row.productCode})`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل الحفظ';
      if (msg.includes('VERSION_CONFLICT')) {
        setErrorMessage(
          'تعارض في الإصدار للمنتج. تم تعديل البيانات بواسطة شخص آخر, يرجى إعادة التحميل.',
        );
      } else {
        setErrorMessage(msg);
      }
    } finally {
      setSavingRowKey(null);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedRows.length === 0) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await bulkMutation.mutateAsync({
        items: selectedRows.map((r) => {
          const edit = getEdit(r);
          return {
            companyId: r.companyId,
            productCode: r.productCode,
            decisionStatus: bulkDecisionStatus,
            approvedQty: edit.approvedQty,
            approvedSupplierId: r.supplierId ?? null,
            approvedSupplierName: edit.approvedSupplierName ?? r.supplierName ?? null,
            buyerNote: bulkBuyerNote || edit.buyerNote || null,
            expectedVersion: r.version,
          };
        }),
        decisionStatus: bulkDecisionStatus,
        buyerNote: bulkBuyerNote || null,
      });

      setSuccessMessage(`تم تحديث ${selectedRows.length} عنصر بنجاح`);
      setSelectedSet(new Set());
      setBulkBuyerNote('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل التحديث الجماعي';
      if (msg.includes('VERSION_CONFLICT')) {
        setErrorMessage(
          'تعارض في الإصدار للمنتج. تم تعديل البيانات بواسطة شخص آخر, يرجى إعادة التحميل.',
        );
      } else {
        setErrorMessage(msg);
      }
    }
  };

  const handleExport = async (scope: PurchaseExportScope) => {
    setExportingScope(scope);
    setErrorMessage(null);

    try {
      await downloadPurchaseExport(scope);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل التصدير';
      setErrorMessage(msg);
    } finally {
      setExportingScope(null);
    }
  };

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="review-page" dir="rtl">
      <header className="review-header">
        <div className="review-header__brand">
          <h1 className="review-header__title">Horeca Smart OS</h1>
          <span className="review-header__subtitle">مراجعة مشتريات الشركات</span>
        </div>
        <nav className="review-header__nav">
          <button className="btn--nav" onClick={() => navigate('/')}>
            نظرة عامة
          </button>
          <button
            className="btn--nav btn--nav-active"
            onClick={() => navigate('/procurement/review')}
            aria-current="page"
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

      <main className="review-main">
        {/* Top title and short note */}
        <div className="review-top-section">
          <div>
            <h2 className="review-title">مراجعة مشتريات الشركات</h2>
            <p className="review-subtitle">
              تتم مراجعة احتياجات MAS وHoreca Smart بصورة مستقلة.
            </p>
          </div>
          <div className="review-export-actions">
            <button
              className="btn btn--primary"
              onClick={() => handleExport('draft')}
              disabled={exportingScope !== null}
            >
              {exportingScope === 'draft' ? 'جاري التصدير...' : 'تصدير مسودة Excel'}
            </button>
            <button
              className="btn btn--primary"
              onClick={() => handleExport('approved')}
              disabled={exportingScope !== null}
            >
              {exportingScope === 'approved' ? 'جاري التصدير...' : 'تصدير المعتمد Excel'}
            </button>
          </div>
        </div>

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
              <option value="all">الكل</option>
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
                <option key={s} value={s}>
                  {DECISION_STATUS_LABELS[s]}
                </option>
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

        {/* Error / Success Messages */}
        {errorMessage && (
          <div className="review-message review-message--error" role="alert">
            <span>{errorMessage}</span>
            <button
              className="review-message__close"
              onClick={() => setErrorMessage(null)}
              aria-label="إغلاق التنبيه"
            >
              ✕
            </button>
          </div>
        )}
        {successMessage && (
          <div className="review-message review-message--success" role="status">
            <span>{successMessage}</span>
            <button
              className="review-message__close"
              onClick={() => setSuccessMessage(null)}
              aria-label="إغلاق التنبيه"
            >
              ✕
            </button>
          </div>
        )}

        {/* Bulk Action Bar */}
        {selectedRows.length > 0 && (
          <div className="review-bulk-bar">
            <span className="review-bulk-bar__count">
              تم اختيار {selectedRows.length} عنصر
            </span>
            <div className="review-bulk-bar__actions">
              <select
                className="filters__select"
                value={bulkDecisionStatus}
                onChange={(e) => setBulkDecisionStatus(e.target.value as DecisionStatus)}
                aria-label="حالة الاعتماد الجماعي"
              >
                {DECISION_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {DECISION_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                className="filters__input"
                placeholder="ملاحظة..."
                value={bulkBuyerNote}
                onChange={(e) => setBulkBuyerNote(e.target.value)}
                style={{ width: '200px' }}
                aria-label="ملاحظة الاعتماد الجماعي"
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
            <p>
              {error instanceof Error &&
              (error.message.includes('COMPANY_REVIEW_UNAVAILABLE') ||
                error.message.includes('REVIEW_UNAVAILABLE') ||
                (error as any).status === 503)
                ? 'شاشة المراجعة جاهزة، لكن تحديث قاعدة البيانات لم يُطبّق بعد.'
                : 'تعذّر تحميل بيانات المراجعة.'}
            </p>
            <p className="state-message__detail">
              {error instanceof Error ? error.message : 'خطأ غير معروف'}
            </p>
            <button className="btn btn--primary btn--sm" onClick={() => refetch()}>
              إعادة المحاولة
            </button>
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="table-wrapper">
            <div className="table-scroll">
              <table className="review-table" role="grid" aria-label="خطة مشتريات الشركات">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        aria-label="اختيار الكل"
                      />
                    </th>
                    <th scope="col">الشركة</th>
                    <th scope="col">كود المنتج</th>
                    <th scope="col">اسم المنتج</th>
                    <th scope="col">الأولوية</th>
                    <th scope="col">المتاح</th>
                    <th scope="col">الطلب اليومي</th>
                    <th scope="col">أيام التغطية</th>
                    <th scope="col">التغطية المستهدفة</th>
                    <th scope="col">الكمية المقترحة</th>
                    <th scope="col">الكمية المعتمدة</th>
                    <th scope="col">المورد</th>
                    <th scope="col">جاهزية المورد</th>
                    <th scope="col">آخر استلام</th>
                    <th scope="col">آخر سعر وحدة</th>
                    <th scope="col">القيمة التقديرية</th>
                    <th scope="col">حالة الاعتماد</th>
                    <th scope="col">ملاحظة المشتري</th>
                    <th scope="col">جاهز للشراء</th>
                    <th scope="col" style={{ width: 70 }}>
                      حفظ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={20} className="table-empty">
                        لا توجد مشتريات مطابقة
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const key = companyPurchaseRowKey(row);
                      const edit = getEdit(row);
                      const isSaving = savingRowKey === key;
                      const hasChanges = edits[key] !== undefined;

                      return (
                        <tr
                          key={key}
                          data-testid={`row-${key}`}
                          className={hasChanges ? 'review-row--dirty' : ''}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedSet.has(key)}
                              onChange={() => toggleSelect(key)}
                              aria-label={`اختيار ${row.companyName} ${row.productCode}`}
                            />
                          </td>
                          <td>
                            <span
                              className={`company-badge company-badge--${
                                row.companyId === 1 ? 'mas' : 'horeca'
                              }`}
                            >
                              {row.companyName}
                            </span>
                          </td>
                          <td className="review-cell--code">{row.productCode}</td>
                          <td className="review-cell--name" title={row.productName}>
                            {row.productName}
                          </td>
                          <td>
                            <span
                              className={`priority-badge priority-badge--${row.priority.toLowerCase()}`}
                            >
                              {PRIORITY_LABELS[row.priority] ?? row.priority}
                            </span>
                          </td>
                          <td className="review-cell--qty">{formatQty(row.freeQty)}</td>
                          <td className="review-cell--qty">
                            {formatQty(row.effectiveDailyDemand)}
                          </td>
                          <td>{formatQty(row.coverageDays)}</td>
                          <td>{row.targetCoverageDays}</td>
                          <td className="review-cell--qty">{formatQty(row.suggestedQty)}</td>
                          <td>
                            <input
                              type="number"
                              className="review-input review-input--qty"
                              value={edit.approvedQty ?? ''}
                              onChange={(e) =>
                                updateEdit(
                                  row,
                                  'approvedQty',
                                  e.target.value ? Number(e.target.value) : null,
                                )
                              }
                              min="0"
                              disabled={isSaving}
                              aria-label={`الكمية المعتمدة لـ ${row.companyName} ${row.productCode}`}
                            />
                          </td>
                          <td className="review-cell--name">
                            {edit.approvedSupplierName ?? row.supplierName ?? '—'}
                          </td>
                          <td>
                            <span
                              className={`readiness-badge readiness-badge--${row.supplierReadiness.toLowerCase()}`}
                            >
                              {SUPPLIER_READINESS_LABELS[row.supplierReadiness] ??
                                row.supplierReadiness}
                            </span>
                          </td>
                          <td>{formatDate(row.latestReceiptAt)}</td>
                          <td>{formatCurrency(row.latestUnitCost)}</td>
                          <td>{formatCurrency(row.estimatedValue)}</td>
                          <td>
                            <select
                              className="filters__select"
                              value={edit.decisionStatus}
                              onChange={(e) =>
                                updateEdit(row, 'decisionStatus', e.target.value as DecisionStatus)
                              }
                              disabled={isSaving}
                              aria-label={`حالة الاعتماد لـ ${row.companyName} ${row.productCode}`}
                            >
                              {DECISION_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {DECISION_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              className="review-input"
                              value={edit.buyerNote ?? ''}
                              onChange={(e) =>
                                updateEdit(row, 'buyerNote', e.target.value || null)
                              }
                              disabled={isSaving}
                              aria-label={`ملاحظة المشتري لـ ${row.companyName} ${row.productCode}`}
                            />
                          </td>
                          <td>
                            <span
                              className={`ready-badge ready-badge--${
                                row.readyForPo ? 'yes' : 'no'
                              }`}
                            >
                              {row.readyForPo ? 'جاهز للشراء' : 'غير جاهز للشراء'}
                            </span>
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                aria-label="الصفحة السابقة"
              >
                ‹ السابق
              </button>
              <span className="pagination__info">
                صفحة {pagination.page.toLocaleString('ar-SA')} من{' '}
                {Math.max(1, pagination.totalPages).toLocaleString('ar-SA')}{' '}
                ({pagination.total.toLocaleString('ar-SA')} عنصر)
              </span>
              <button
                className="pagination__btn"
                onClick={() => setPage((p) => p + 1)}
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
