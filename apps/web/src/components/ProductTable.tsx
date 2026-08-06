import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import type { Pagination, ProcurementRow, Priority, SupplierStatus } from '../types.js';

const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: 'حرج',
  HIGH: 'عالٍ',
  MEDIUM: 'متوسط',
  LOW: 'منخفض',
};

const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  PENDING_REVIEW: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  NEEDS_SUPPLIER: 'بدون مورد',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-SA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatQty(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('ar-SA', { maximumFractionDigits: 2 });
}

const columns: ColumnDef<ProcurementRow>[] = [
  { accessorKey: 'productCode', header: 'كود المنتج', size: 110 },
  { accessorKey: 'productName', header: 'اسم المنتج', size: 200 },
  {
    accessorKey: 'freeQty',
    header: 'الكمية المتاحة',
    cell: ({ getValue }) => formatQty(getValue<number>()),
    size: 110,
  },
  {
    accessorKey: 'effectiveDailyDemand',
    header: 'الطلب اليومي',
    cell: ({ getValue }) => formatQty(getValue<number>()),
    size: 100,
  },
  {
    accessorKey: 'actualCoverageDays',
    header: 'أيام التغطية الفعلية',
    cell: ({ getValue }) => formatQty(getValue<number | null>()),
    size: 130,
  },
  {
    accessorKey: 'suggestedQty',
    header: 'الكمية المقترحة',
    cell: ({ getValue }) => formatQty(getValue<number | null>()),
    size: 115,
  },
  {
    accessorKey: 'priority',
    header: 'الأولوية',
    cell: ({ getValue }) => {
      const p = getValue<Priority>();
      return (
        <span className={`priority-badge priority-badge--${p.toLowerCase()}`}>
          {PRIORITY_LABELS[p]}
        </span>
      );
    },
    size: 80,
  },
  {
    accessorKey: 'proposedSupplierName',
    header: 'المورد المقترح',
    cell: ({ getValue }) => getValue<string | null>() ?? '—',
    size: 150,
  },
  {
    accessorKey: 'supplierStatus',
    header: 'حالة المورد',
    cell: ({ getValue }) => {
      const s = getValue<SupplierStatus>();
      return (
        <span className={`status-badge status-badge--${s.toLowerCase().replace(/_/g, '-')}`}>
          {SUPPLIER_STATUS_LABELS[s]}
        </span>
      );
    },
    size: 115,
  },
  {
    accessorKey: 'latestReceiptAt',
    header: 'آخر استلام',
    cell: ({ getValue }) => formatDate(getValue<string | null>()),
    size: 100,
  },
];

interface ProductTableProps {
  rows: ProcurementRow[];
  pagination: Pagination;
  onPageChange: (page: number) => void;
}

export function ProductTable({ rows, pagination, onPageChange }: ProductTableProps) {
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: pagination.totalPages,
    state: {
      pagination: {
        pageIndex: pagination.page - 1,
        pageSize: pagination.pageSize,
      },
    },
    onPaginationChange: () => {},
  });

  return (
    <div className="table-wrapper">
      <div className="table-scroll">
        <table className="product-table" role="grid" aria-label="قائمة المنتجات">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} style={{ width: header.getSize() }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  لا توجد منتجات تطابق المعايير المحددة
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination" aria-label="التنقل بين الصفحات">
        <button
          className="pagination__btn"
          onClick={() => onPageChange(pagination.page - 1)}
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
          onClick={() => onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          aria-label="الصفحة التالية"
        >
          التالي ›
        </button>
      </div>
    </div>
  );
}
