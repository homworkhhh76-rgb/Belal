import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useMemo, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react';
import { formatStockBreakdown } from './utils__unitTree.js?v=7.9.4.136-localization';

const h = React.createElement;
const makeRow = (products = []) => {
  const product = products.find((p) => !p.deletedAt) || null;
  const unit = product?.units?.find((u) => u.isDefaultSale) || product?.units?.[0] || null;
  return { id: `tr-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, productId: product?.id || '', unitId: unit?.id || '', quantity: 1 };
};

export const TransferForm = () => {
  const { products, warehouses, settings, getProductStock, transferStockBatch, showToast } = useApp();
  const activeProducts = useMemo(() => products.filter((p) => !p.deletedAt && p.status !== 'archived'), [products]);
  const [fromId, setFromId] = useState(settings.activeWarehouseId || warehouses[0]?.id || '');
  const [toId, setToId] = useState(warehouses.find((w) => w.id !== (settings.activeWarehouseId || warehouses[0]?.id))?.id || warehouses[1]?.id || warehouses[0]?.id || '');
  const [rows, setRows] = useState(() => [makeRow(activeProducts)]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const updateRow = (id, patch) => setRows((prev) => prev.map((row) => row.id === id ? { ...row, ...patch } : row));
  const addRow = () => setRows((prev) => [makeRow(activeProducts), ...prev]);
  const removeRow = (id) => setRows((prev) => prev.length > 1 ? prev.filter((row) => row.id !== id) : prev);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!fromId || !toId || fromId === toId) {
      showToast('اختر مخزنين مختلفين للتحويل', 'warning');
      return;
    }
    const valid = rows.filter((row) => row.productId && row.unitId && Number(row.quantity) > 0);
    if (!valid.length) {
      showToast('أضف صنفاً واحداً على الأقل للتحويل', 'warning');
      return;
    }
    setBusy(true);
    try {
      const ok = await transferStockBatch(fromId, toId, valid, notes);
      if (ok) {
        setRows([makeRow(activeProducts)]);
        setNotes('');
      }
    } finally {
      setBusy(false);
    }
  };

  const whOptions = warehouses.map((w) => ({ id: w.id, label: w.name, subLabel: w.code || undefined }));

  return h('form', { onSubmit: submit, className: 'rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs max-w-3xl mx-auto space-y-4' },
    h('div', { className: 'border-b border-slate-100 dark:border-slate-800 pb-3 flex items-center justify-between gap-3' },
      h('div', { className: 'flex items-center gap-2 min-w-0' },
        h(ArrowLeftRight, { className: 'w-5 h-5 text-violet-600 shrink-0' }),
        h('div', { className: 'min-w-0' },
          h('h3', { className: 'text-sm font-black text-slate-900 dark:text-white' }, 'تحويل أصناف بين المخازن'),
          h('p', { className: 'text-[11px] text-slate-500 mt-0.5' }, 'يمكن إضافة أكثر من صنف في نفس عملية التحويل')
        )
      ),
      h('button', { type: 'button', onClick: addRow, className: 'shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-black hover:bg-violet-700' },
        h(Plus, { className: 'w-4 h-4' }), h('span', null, t("إضافة صنف"))
      )
    ),
    h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-3' },
      h('div', null,
        h('label', { className: 'text-xs font-semibold block mb-1' }, 'من مخزن:'),
        h(SearchableDropdown, { id: 'transfer-batch-from', options: whOptions, selectedId: fromId, onSelect: setFromId, placeholder: 'اختر مخزن المصدر...' })
      ),
      h('div', null,
        h('label', { className: 'text-xs font-semibold block mb-1' }, 'إلى مخزن:'),
        h(SearchableDropdown, { id: 'transfer-batch-to', options: whOptions, selectedId: toId, onSelect: setToId, placeholder: 'اختر مخزن المستلم...' })
      )
    ),
    h('div', { className: 'space-y-2' },
      ...rows.map((row, index) => {
        const product = activeProducts.find((p) => p.id === row.productId);
        const unitOptions = (product?.units || []).map((u) => ({ id: u.id, label: u.name, subLabel: `×${u.conversionToBase || 1}` }));
        const productOptions = activeProducts.map((p) => {
          const stock = getProductStock(p.id, fromId);
          return { id: p.id, label: p.name, subLabel: `المتوفر: ${formatStockBreakdown(stock, p.units, p.baseUnitName)}` };
        });
        return h('div', { key: row.id, className: 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-3' },
          h('div', { className: 'flex items-center justify-between gap-2 mb-2' },
            h('span', { className: 'text-[11px] font-black text-slate-600 dark:text-slate-300' }, `الصنف ${rows.length - index}`),
            h('button', { type: 'button', onClick: () => removeRow(row.id), disabled: rows.length <= 1, className: 'w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30', title: 'حذف الصنف من التحويل' }, h(Trash2, { className: 'w-4 h-4' }))
          ),
          h('div', { className: 'grid grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px] gap-2.5' },
            h('div', null,
              h('label', { className: 'text-[11px] font-semibold block mb-1' }, t("الصنف:")),
              h(SearchableDropdown, {
                id: `transfer-product-${row.id}`, options: productOptions, selectedId: row.productId,
                onSelect: (productId) => {
                  const p = activeProducts.find((x) => x.id === productId);
                  const u = p?.units?.find((x) => x.isDefaultSale) || p?.units?.[0];
                  updateRow(row.id, { productId, unitId: u?.id || '' });
                }, placeholder: 'اختر الصنف...'
              })
            ),
            h('div', null,
              h('label', { className: 'text-[11px] font-semibold block mb-1' }, t("الوحدة:")),
              h(SearchableDropdown, { id: `transfer-unit-${row.id}`, options: unitOptions, selectedId: row.unitId, onSelect: (unitId) => updateRow(row.id, { unitId }), placeholder: 'اختر الوحدة...' })
            ),
            h('div', null,
              h('label', { className: 'text-[11px] font-semibold block mb-1' }, t("الكمية:")),
              h('input', { type: 'number', inputMode: 'decimal', min: '0.001', step: 'any', value: row.quantity, onChange: (e) => updateRow(row.id, { quantity: e.target.value }), className: 'w-full px-3 py-2 text-xs border rounded-xl font-mono font-bold bg-white dark:bg-slate-900' })
            )
          )
        );
      })
    ),
    h('div', null,
      h('label', { className: 'text-xs font-semibold block mb-1' }, 'ملاحظات التحويل:'),
      h('input', { type: 'text', value: notes, onChange: (e) => setNotes(e.target.value), placeholder: 'ملاحظات اختيارية...', className: 'w-full px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-900' })
    ),
    h('div', { className: 'flex items-center justify-between gap-3 pt-1' },
      h('button', { type: 'button', onClick: addRow, className: 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 text-violet-700 text-xs font-black hover:bg-violet-50' }, h(Plus, { className: 'w-4 h-4' }), h('span', null, 'إضافة صنف آخر')),
      h('button', { type: 'submit', disabled: busy, className: 'px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-black shadow-md' }, busy ? 'جاري التحويل...' : `تأكيد التحويل (${rows.length})`)
    )
  );
};
