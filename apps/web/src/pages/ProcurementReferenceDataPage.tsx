import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  applyReferenceData,
  downloadReferenceData,
  previewReferenceData,
  type ReferenceImportApplyResult,
  type ReferenceImportPreview,
} from '../api/reference-data.js';

export function ProcurementReferenceDataPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReferenceImportPreview | null>(null);
  const [applied, setApplied] = useState<ReferenceImportApplyResult | null>(null);

  const downloadMutation = useMutation({ mutationFn: downloadReferenceData });
  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('FILE_REQUIRED');
      return previewReferenceData(file);
    },
    onSuccess: (result) => {
      setPreview(result);
      setApplied(null);
    },
  });
  const applyMutation = useMutation({
    mutationFn: (batchId: string) => applyReferenceData(batchId),
    onSuccess: setApplied,
  });

  const canApply = !!preview
    && preview.invalidRows === 0
    && !applyMutation.isPending
    && !applied;

  return (
    <div className="overview-page reference-page" dir="rtl">
      <header className="overview-header">
        <div className="overview-header__brand">
          <h1 className="overview-header__title">Horeca Smart OS</h1>
          <span className="overview-header__subtitle">إدارة بيانات المشتريات المرجعية</span>
        </div>
        <nav className="overview-header__nav">
          <button className="btn--nav" onClick={() => navigate('/procurement')}>نظرة عامة</button>
          <button className="btn--nav" onClick={() => navigate('/procurement/review')}>مراجعة المشتريات</button>
          <button className="btn--nav btn--nav-active" aria-current="page">بيانات الموردين والبراندات</button>
        </nav>
      </header>

      <main className="overview-main reference-main">
        <section className="overview-action-bar reference-hero">
          <div className="overview-action-bar__info">
            <h2 className="overview-action-bar__title">تحديث الموردين والبراندات جماعيًا</h2>
            <p className="overview-action-bar__subtitle">
              نزّل البيانات الحالية، عدّل ملف Excel، ثم اعرض المعاينة قبل تطبيق أي تغيير على Supabase.
            </p>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
          >
            {downloadMutation.isPending ? 'جاري التنزيل...' : 'تنزيل ملف البيانات الحالي'}
          </button>
        </section>

        <section className="reference-card" aria-labelledby="upload-title">
          <h3 id="upload-title">رفع الملف المعدّل</h3>
          <p>المعاينة لا تكتب أي بيانات. التغييرات تُطبق فقط عند الضغط على زر التطبيق بعد نجاح الفحص.</p>
          <div className="reference-upload-row">
            <label className="reference-file-label">
              <span>ملف Excel المعدّل</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPreview(null);
                  setApplied(null);
                }}
              />
            </label>
            <button
              className="btn btn--primary"
              disabled={!file || previewMutation.isPending}
              onClick={() => previewMutation.mutate()}
            >
              {previewMutation.isPending ? 'جاري الفحص...' : 'معاينة التغييرات'}
            </button>
          </div>
          {previewMutation.isError && (
            <p className="state-message state-message--error" role="alert">
              تعذر فحص الملف. تأكد أنك تستخدم ملف Excel الذي تم تنزيله من هذه الصفحة.
            </p>
          )}
        </section>

        {preview && (
          <section className="reference-card" aria-live="polite">
            <div className="reference-summary">
              <div><strong>{preview.totalRows}</strong><span>إجمالي الصفوف</span></div>
              <div><strong>{preview.validRows}</strong><span>صفوف صالحة</span></div>
              <div className={preview.invalidRows ? 'reference-summary--danger' : ''}>
                <strong>{preview.invalidRows}</strong><span>صفوف بها أخطاء</span>
              </div>
              <div><strong>{preview.changes.length}</strong><span>تغييرات متوقعة</span></div>
            </div>

            {preview.errors.length > 0 && (
              <div className="reference-table-wrap">
                <h3>الأخطاء التي يجب إصلاحها</h3>
                <table className="reference-table">
                  <thead><tr><th>الصف</th><th>كود الخطأ</th><th>التفاصيل</th></tr></thead>
                  <tbody>
                    {preview.errors.map((error, index) => (
                      <tr key={`${error.row_number}-${error.error_code}-${index}`}>
                        <td>{error.row_number}</td>
                        <td><code>{error.error_code}</code></td>
                        <td>{error.error_message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.changes.length > 0 && (
              <div className="reference-table-wrap">
                <h3>ملخص التغييرات</h3>
                <table className="reference-table">
                  <thead><tr><th>الصف</th><th>الشركة</th><th>المنتج</th><th>المورد</th><th>نوع التغيير</th></tr></thead>
                  <tbody>
                    {preview.changes.slice(0, 200).map((change) => (
                      <tr key={`${change.rowNumber}-${change.productCode ?? ''}-${change.supplierId ?? ''}`}>
                        <td>{change.rowNumber}</td>
                        <td>{change.companyId ?? '—'}</td>
                        <td>{change.productCode ?? '—'}</td>
                        <td>{change.supplierId ?? '—'}</td>
                        <td>{change.changeType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="reference-apply-row">
              <p>
                {preview.invalidRows > 0
                  ? 'أصلح الأخطاء ثم ارفع الملف مرة أخرى قبل التطبيق.'
                  : 'المعاينة سليمة. سيتم تطبيق نفس الصفوف التي تم فحصها دون إمكانية استبدالها.'}
              </p>
              <button
                className="btn btn--primary"
                disabled={!canApply}
                onClick={() => preview && applyMutation.mutate(preview.batchId)}
              >
                {applyMutation.isPending ? 'جاري التطبيق...' : 'تطبيق التحديثات'}
              </button>
            </div>
          </section>
        )}

        {applyMutation.isError && (
          <div className="state-message state-message--error" role="alert">
            تعذر تطبيق التحديثات. لم يتم تطبيق Batch جزئي.
          </div>
        )}
        {applied && (
          <div className="state-message reference-success" role="status">
            <strong>تم تطبيق التحديثات بنجاح</strong>
            <span>إضافة {applied.inserted} — تحديث {applied.updated} — تخطي {applied.skipped}</span>
          </div>
        )}
      </main>
    </div>
  );
}
