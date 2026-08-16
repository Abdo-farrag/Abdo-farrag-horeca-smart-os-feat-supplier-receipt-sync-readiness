import { useEffect, useId, useState } from 'react';
import type { SupplierDirectoryItem } from '@horeca/contracts';
import { searchSuppliers } from '../api/purchase-drafts.js';

interface SupplierComboboxProps {
  label: string;
  value: SupplierDirectoryItem | null;
  onChange: (supplier: SupplierDirectoryItem | null) => void;
  allowClear?: boolean;
}

export function SupplierCombobox({
  label,
  value,
  onChange,
  allowClear = false,
}: SupplierComboboxProps) {
  const id = useId();
  const [query, setQuery] = useState(value?.supplierName ?? '');
  const [items, setItems] = useState<SupplierDirectoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setLoading(true);
      searchSuppliers(query)
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query]);

  return (
    <div className="supplier-combobox">
      <label htmlFor={id} className="filters__label">{label}</label>
      <input
        id={id}
        className="filters__input"
        type="search"
        value={query}
        placeholder="ابحث باسم المورد أو الكود..."
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          if (value) onChange(null);
          setOpen(true);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
      />
      {allowClear && value && (
        <button
          type="button"
          className="supplier-combobox__clear"
          onClick={() => { onChange(null); setQuery(''); }}
        >
          مسح المورد
        </button>
      )}
      {open && (
        <ul id={`${id}-options`} className="supplier-combobox__options" role="listbox">
          {loading && <li className="supplier-combobox__empty">جاري البحث...</li>}
          {!loading && items.length === 0 && (
            <li className="supplier-combobox__empty">لا يوجد مورد نشط مطابق</li>
          )}
          {!loading && items.map((supplier) => (
            <li key={supplier.supplierId}>
              <button
                type="button"
                role="option"
                aria-selected={value?.supplierId === supplier.supplierId}
                onClick={() => {
                  onChange(supplier);
                  setQuery(supplier.supplierName);
                  setOpen(false);
                }}
              >
                <strong>{supplier.supplierName}</strong>
                <span>{supplier.supplierCode ?? `Odoo #${supplier.supplierId}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
