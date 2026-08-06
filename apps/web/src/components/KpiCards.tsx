import type { ProcurementSummary, SyncStatus } from '../types.js';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-SA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
}

interface KpiCardProps {
  label: string;
  value: string | number;
  variant?: 'critical' | 'warning' | 'neutral';
}

function KpiCard({ label, value, variant = 'neutral' }: KpiCardProps) {
  return (
    <div className={`kpi-card kpi-card--${variant}`}>
      <span className="kpi-card__value">
        {typeof value === 'number' ? formatNumber(value) : value}
      </span>
      <span className="kpi-card__label">{label}</span>
    </div>
  );
}

interface KpiCardsProps {
  summary: ProcurementSummary;
  syncStatus: SyncStatus | null;
}

export function KpiCards({ summary, syncStatus }: KpiCardsProps) {
  const isStale =
    !syncStatus?.finishedAt || syncStatus.freshnessStatus !== 'UPDATED';

  return (
    <div className="kpi-grid" role="region" aria-label="مؤشرات الأداء">
      <KpiCard
        label="بحاجة للشراء"
        value={summary.needsPurchase}
        variant={summary.needsPurchase > 0 ? 'warning' : 'neutral'}
      />
      <KpiCard
        label="منتجات حرجة"
        value={summary.critical}
        variant={summary.critical > 0 ? 'critical' : 'neutral'}
      />
      <KpiCard
        label="إجمالي الكمية المقترحة"
        value={summary.totalSuggestedQty}
      />
      <KpiCard
        label="بدون مورد"
        value={summary.noSupplier}
        variant={summary.noSupplier > 0 ? 'warning' : 'neutral'}
      />
      <KpiCard
        label="بيانات غير كافية"
        value={summary.insufficientData}
        variant={summary.insufficientData > 0 ? 'warning' : 'neutral'}
      />
      <div className={`kpi-card kpi-card--sync${isStale ? ' kpi-card--stale' : ''}`}>
        <span className="kpi-card__value kpi-card__value--sm">
          {formatDateTime(syncStatus?.finishedAt ?? null)}
        </span>
        <span className="kpi-card__label">آخر مزامنة ناجحة</span>
        {isStale && (
          <span
            className="kpi-card__stale-badge"
            role="alert"
            aria-label="تحذير: البيانات قديمة"
          >
            بيانات قديمة
          </span>
        )}
      </div>
    </div>
  );
}
