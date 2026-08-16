import { useState } from 'react';
import type {
  CompanyPurchaseRow,
  PurchaseDraftLine,
  SupplierDirectoryItem,
} from '@horeca/contracts';
import {
  changePurchaseDraftSupplier,
  createPurchaseDraft,
  downloadPurchaseDraftRfq,
  fetchPurchaseDraft,
  setPurchaseDraftRfqReference,
  transitionPurchaseDraft,
  updatePurchaseDraftLine,
  type PurchaseDraftSnapshot,
} from '../api/purchase-drafts.js';
import { SupplierCombobox } from './SupplierCombobox.js';

interface PurchaseDraftPanelProps {
  selectedRows: CompanyPurchaseRow[];
  onClose: () => void;
}

const WARNING_LABELS: Record<string, string> = {
  PACKAGING_REVIEW_REQUIRED: 'راجع عبوة الشراء أو الحد الأدنى',
  MISSING_PRICE: 'السعر غير متاح ويحتاج تأكيدًا',
  OTHER_SUPPLIER_PRICE: 'سعر استرشادي من مورد آخر',
  BRAND_UNDEFINED: 'براند غير محدد',
};

function LineEditor({
  snapshot,
  line,
  onUpdated,
}: {
  snapshot: PurchaseDraftSnapshot;
  line: PurchaseDraftLine;
  onUpdated: (line: PurchaseDraftLine) => void;
}) {
  const [quantity, setQuantity] = useState(String(line.approvedQty));
  const [price, setPrice] = useState(line.unitPrice === null ? '' : String(line.unitPrice));
  const [saving, setSaving] = useState(false);

  return (
    <tr>
      <td>{line.productCode}</td>
      <td>{line.productName}</td>
      <td>{line.brandName ?? 'براند غير محدد'}</td>
      <td>{line.suggestedQty.toLocaleString('ar-SA')}</td>
      <td>
        <input
          aria-label={`كمية المسودة ${line.productCode}`}
          type="number"
          min="0.01"
          className="review-input review-input--qty"
          value={quantity}
          disabled={snapshot.draft.status !== 'DRAFT' || saving}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </td>
      <td>{line.purchaseUom ?? 'راجع Odoo'}</td>
      <td>
        <input
          aria-label={`سعر المسودة ${line.productCode}`}
          type="number"
          min="0"
          className="review-input review-input--qty"
          value={price}
          disabled={snapshot.draft.status !== 'DRAFT' || saving}
          onChange={(event) => setPrice(event.target.value)}
        />
      </td>
      <td>{line.warnings.map((warning) => WARNING_LABELS[warning] ?? warning).join('، ') || '—'}</td>
      <td>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={snapshot.draft.status !== 'DRAFT' || saving || Number(quantity) <= 0}
          onClick={async () => {
            setSaving(true);
            try {
              onUpdated(await updatePurchaseDraftLine(snapshot.draft.id, line.id, {
                approvedQty: Number(quantity),
                unitPrice: price === '' ? null : Number(price),
                expectedVersion: line.version,
              }));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? '...' : 'حفظ'}
        </button>
      </td>
    </tr>
  );
}

export function PurchaseDraftPanel({ selectedRows, onClose }: PurchaseDraftPanelProps) {
  const companyIds = new Set(selectedRows.map((row) => row.companyId));
  const selectionValid = selectedRows.length > 0 && companyIds.size === 1;
  const [supplier, setSupplier] = useState<SupplierDirectoryItem | null>(null);
  const [expectedReceiptDate, setExpectedReceiptDate] = useState('');
  const [buyerNote, setBuyerNote] = useState('');
  const [snapshot, setSnapshot] = useState<PurchaseDraftSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rfqName, setRfqName] = useState('');
  const [rfqId, setRfqId] = useState('');

  const replaceLine = (updated: PurchaseDraftLine) => {
    setSnapshot((current) => current && ({
      ...current,
      lines: current.lines.map((line) => line.id === updated.id ? updated : line),
    }));
  };

  return (
    <section className="purchase-draft-panel" aria-label="مسودة طلب عرض سعر">
      <div className="purchase-draft-panel__header">
        <div>
          <h3>مسودة طلب عرض سعر لـ Odoo</h3>
          <p>شركة واحدة + مورد واحد. لا يتم إنشاء أي طلب داخل Odoo تلقائيًا.</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onClose}>إغلاق</button>
      </div>

      {!selectionValid && !snapshot && (
        <div className="review-message review-message--error" role="alert">
          اختر منتجات من شركة واحدة فقط لإنشاء المسودة.
        </div>
      )}

      {!snapshot && selectionValid && (
        <div className="purchase-draft-panel__setup">
          <div className="purchase-draft-panel__summary">
            <strong>{selectedRows[0]?.companyName}</strong>
            <span>{selectedRows.length} منتج</span>
            <span>تُنسخ الكمية المقترحة تلقائيًا ثم تُقرّب حسب عبوة Odoo.</span>
          </div>
          <SupplierCombobox label="مورد هذه المسودة" value={supplier} onChange={setSupplier} />
          <label className="filters__label">
            تاريخ الاستلام المتوقع
            <input
              type="date"
              className="filters__input"
              value={expectedReceiptDate}
              onChange={(event) => setExpectedReceiptDate(event.target.value)}
            />
          </label>
          <label className="filters__label">
            ملاحظة المشتري
            <input
              className="filters__input"
              value={buyerNote}
              onChange={(event) => setBuyerNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!supplier || busy}
            onClick={async () => {
              if (!supplier || !selectedRows[0]) return;
              setBusy(true);
              setError(null);
              try {
                setSnapshot(await createPurchaseDraft({
                  companyId: selectedRows[0].companyId,
                  supplierId: supplier.supplierId,
                  expectedReceiptDate: expectedReceiptDate || null,
                  buyerNote: buyerNote || null,
                  items: selectedRows.map((row) => ({
                    productCode: row.productCode,
                    expectedRecommendationVersion: row.version,
                  })),
                }));
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'فشل إنشاء المسودة');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'جاري الإنشاء...' : 'إنشاء المسودة'}
          </button>
        </div>
      )}

      {error && <div className="review-message review-message--error" role="alert">{error}</div>}

      {snapshot && (
        <>
          <div className="purchase-draft-panel__toolbar">
            <div>
              <strong>{snapshot.draft.companyName}</strong>
              <span>{snapshot.draft.supplierName}</span>
              <span className="status-badge">{snapshot.draft.status}</span>
            </div>
            {snapshot.draft.status === 'DRAFT' && (
              <SupplierCombobox
                label="تغيير مورد هذه المسودة فقط"
                value={null}
                onChange={async (nextSupplier) => {
                  if (!nextSupplier) return;
                  setBusy(true);
                  try {
                    await changePurchaseDraftSupplier(snapshot.draft.id, {
                      supplierId: nextSupplier.supplierId,
                      expectedVersion: snapshot.draft.version,
                    });
                    setSnapshot(await fetchPurchaseDraft(snapshot.draft.id));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            )}
          </div>
          <div className="table-scroll">
            <table className="review-table" aria-label="سطور مسودة طلب عرض السعر">
              <thead><tr>
                <th>الكود</th><th>المنتج</th><th>البراند</th><th>المقترح</th>
                <th>المعتمد</th><th>وحدة الشراء</th><th>السعر</th><th>تنبيهات</th><th>حفظ</th>
              </tr></thead>
              <tbody>{snapshot.lines.map((line) => (
                <LineEditor key={line.id} snapshot={snapshot} line={line} onUpdated={replaceLine} />
              ))}</tbody>
            </table>
          </div>
          <div className="purchase-draft-panel__actions">
            {snapshot.draft.status === 'DRAFT' && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const updated = await transitionPurchaseDraft(snapshot.draft.id, {
                      status: 'READY_FOR_EXPORT', expectedVersion: snapshot.draft.version,
                    });
                    setSnapshot({ ...snapshot, draft: updated });
                  } finally { setBusy(false); }
                }}
              >جاهز للتصدير</button>
            )}
            {(snapshot.draft.status === 'READY_FOR_EXPORT' || snapshot.draft.status === 'EXPORTED') && (
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await downloadPurchaseDraftRfq(snapshot.draft.id);
                    if (snapshot.draft.status === 'READY_FOR_EXPORT') {
                      setSnapshot({
                        ...snapshot,
                        draft: { ...snapshot.draft, status: 'EXPORTED', version: snapshot.draft.version + 1 },
                      });
                    }
                  } finally { setBusy(false); }
                }}
              >تنزيل Excel لإدخاله في Odoo</button>
            )}
          </div>
          {snapshot.draft.status === 'EXPORTED' && !snapshot.draft.odooRfqName && (
            <div className="purchase-draft-panel__rfq-reference">
              <label className="filters__label">
                رقم RFQ في Odoo
                <input
                  className="filters__input"
                  value={rfqName}
                  placeholder="مثال: P00051"
                  onChange={(event) => setRfqName(event.target.value)}
                />
              </label>
              <label className="filters__label">
                Odoo ID (اختياري)
                <input
                  className="filters__input"
                  type="number"
                  min="1"
                  value={rfqId}
                  onChange={(event) => setRfqId(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!rfqName.trim() || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const updated = await setPurchaseDraftRfqReference(snapshot.draft.id, {
                      odooRfqName: rfqName.trim(),
                      odooRfqId: rfqId ? Number(rfqId) : null,
                      expectedVersion: snapshot.draft.version,
                    });
                    setSnapshot({ ...snapshot, draft: updated });
                  } finally { setBusy(false); }
                }}
              >حفظ مرجع Odoo</button>
            </div>
          )}
          {snapshot.draft.odooRfqName && (
            <div className="purchase-draft-panel__reference-confirmed">
              تم تسجيل RFQ في Odoo: <strong>{snapshot.draft.odooRfqName}</strong>
            </div>
          )}
        </>
      )}
    </section>
  );
}
