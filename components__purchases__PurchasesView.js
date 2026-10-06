import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, useDatabasePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { getBrandLogoDataUrl, getBrandLogoDisplayUrl } from './brand__logo.js?v=7.9.4.136-localization';
import { printElementOnly, warmExportLibraries } from './utils__export.js?v=7.9.4.136-localization';
import { downloadProfessionalPurchaseInvoicePDF, downloadProfessionalPurchaseInvoiceImage, downloadProfessionalTableExcel } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { Plus, Trash2, Building2, Eye, X, Pencil, Image as ImageIcon, FileDown, FileSpreadsheet, Printer, AlertTriangle, ReceiptText } from 'lucide-react';

const h = React.createElement;
const money = (n) => Number(n || 0).toFixed(2);
const normalizeDigits = (value) => String(value ?? '')
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٫،]/g, '.').replace(/٬/g, '');
const cleanNumber = (value) => {
  let v = normalizeDigits(value).replace(/[^0-9.]/g, '');
  const i = v.indexOf('.');
  if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
  return v;
};
const num = (value) => { const n = Number(normalizeDigits(value)); return Number.isFinite(n) ? n : 0; };
const safeDate = (value) => {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

export const PurchasesView = () => {
  const app = useApp();
  const products = Array.isArray(app.products) ? app.products.filter(Boolean) : [];
  const suppliers = Array.isArray(app.suppliers) ? app.suppliers.filter(Boolean) : [];
  const warehouses = Array.isArray(app.warehouses) ? app.warehouses.filter(Boolean) : [];
  const accounts = Array.isArray(app.accounts) ? app.accounts.filter(Boolean) : [];
  const settings = app.settings || {};
  const { createPurchaseInvoice, updatePurchaseInvoice, deletePurchase, saveSupplier, saveWarehouse, currentUser, showToast, queryAllStoreRecords } = app;
  const primaryWarehouse = warehouses[0] || warehouses.find((w) => w?.id === settings.activeWarehouseId) || warehouses.find((w) => w?.isDefault);

  const activeProducts = products.filter((p) => !p.deletedAt && p.status !== 'archived' && Array.isArray(p.units) && p.units.length > 0);
  const [mode, setMode] = useState('list');
  const [editingId, setEditingId] = useState(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState(primaryWarehouse?.id || settings.activeWarehouseId || warehouses[0]?.id || '');
  const [accountId, setAccountId] = useState(accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '');
  const [paid, setPaid] = useState('');
  const [discountType, setDiscountType] = useState('fixed');
  const [discountValue, setDiscountValue] = useState('');
  const [notes, setNotes] = useState('');
  const [viewing, setViewing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showQuickSupp, setShowQuickSupp] = useState(false);
  const [showQuickWarehouse, setShowQuickWarehouse] = useState(false);
  const [quickWarehouseName, setQuickWarehouseName] = useState('');
  const [quickWarehouseCode, setQuickWarehouseCode] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [exporting, setExporting] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0,10));
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const singleRef = useRef(null);
  const statementRef = useRef(null);
  const todayIso = new Date().toISOString().slice(0,10);
  const firstDayIso = `${todayIso.slice(0,8)}01`;
  const [showPurchaseStatement, setShowPurchaseStatement] = useState(false);
  const [statementFrom, setStatementFrom] = useState(firstDayIso);
  const [statementTo, setStatementTo] = useState(todayIso);
  const [statementRows, setStatementRows] = useState([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const financialYears = Array.isArray(settings.financialYears) ? settings.financialYears : [];
  const activeFinancialYearId = settings.activeFinancialYearId || financialYears.find((y)=>y?.status==='open')?.id || 'fy-initial';
  const legacyFinancialYearId = financialYears[0]?.id || activeFinancialYearId;
  const [financialYearFilter, setFinancialYearFilter] = useState(activeFinancialYearId);

  useEffect(() => {
    if (warehouses.length) {
      const preferred = warehouses[0];
      if (!warehouseId || !warehouses.some((w) => w.id === warehouseId)) setWarehouseId(preferred?.id || '');
    }
    if (suppliers.length && (!supplierId || !suppliers.some((x) => x.id === supplierId))) setSupplierId(suppliers[0].id);
    const preferredAccount = accounts.find((a) => a?.isDefault) || accounts[0];
    if (preferredAccount && (!accountId || !accounts.some((a) => a.id === accountId))) setAccountId(preferredAccount.id);
  }, [warehouses, suppliers, accounts, settings.activeWarehouseId]);

  useEffect(() => {
    if (activeFinancialYearId && !financialYears.some((y)=>y?.id===financialYearFilter) && financialYearFilter !== 'all') setFinancialYearFilter(activeFinancialYearId);
  }, [activeFinancialYearId, settings.financialYears]);

  const makeRow = (p = activeProducts[0]) => ({
    productId: p?.id || '',
    unitId: p?.units?.[0]?.id || '',
    quantity: '1',
    unitPrice: Number(p?.units?.[0]?.costPrice || 0) > 0 ? String(p.units[0].costPrice) : '',
    expiryDate: p?.expiryDate || '',
  });
  const [rows, setRows] = useState([makeRow()]);

  const subtotal = rows.reduce((s, r) => s + num(r.quantity) * num(r.unitPrice), 0);
  const discountAmount = discountType === 'percent'
    ? Math.min(subtotal, subtotal * Math.max(0, Math.min(100, num(discountValue))) / 100)
    : Math.min(subtotal, Math.max(0, num(discountValue)));
  const total = Math.max(0, subtotal - discountAmount);
  const paidSafe = Math.min(total, Math.max(0, num(paid)));
  const debt = Math.max(0, total - paidSafe);
  const canDelete = currentUser?.permissions?.canDeleteInvoice === true;

  const updateRow = (index, patch) => setRows((prev) => prev.map((row, i) => {
    if (i !== index) return row;
    const next = { ...row, ...patch };
    if (patch.productId && patch.productId !== row.productId) {
      const p = activeProducts.find((x) => x.id === patch.productId);
      const u = p?.units?.[0];
      next.unitId = u?.id || '';
      next.unitPrice = Number(u?.costPrice || 0) > 0 ? String(u.costPrice) : '';
      next.expiryDate = p?.expiryDate || '';
    }
    if (patch.unitId && patch.unitId !== row.unitId) {
      const p = activeProducts.find((x) => x.id === next.productId);
      const u = p?.units?.find((x) => x.id === patch.unitId);
      if (u) next.unitPrice = Number(u.costPrice || 0) > 0 ? String(u.costPrice) : '';
    }
    return next;
  }));

  const submit = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (!supplier) { showToast('اختر المورد', 'warning'); return; }
    if (!warehouseId) { showToast('اختر المخزن المستلم', 'warning'); return; }
    if (!rows.length || rows.some((r) => !r.productId || num(r.quantity) <= 0)) { showToast('أضف صنفاً صحيحاً وحدد الكمية', 'warning'); return; }
    if (paidSafe > 0 && !accountId) { showToast('اختر حساب دفع المبلغ المدفوع', 'warning'); return; }

    const items = rows.map((r) => {
      const p = activeProducts.find((x) => x.id === r.productId);
      const u = p?.units?.find((x) => x.id === r.unitId) || p?.units?.[0];
      const factor = Number(u?.conversionToBase || 1);
      return {
        productId: r.productId,
        productName: p?.name || 'صنف',
        unitId: u?.id || r.unitId,
        unitName: u?.name || 'وحدة',
        quantity: num(r.quantity),
        unitPrice: num(r.unitPrice),
        conversionFactor: factor,
        baseQuantity: num(r.quantity) * factor,
        total: num(r.quantity) * num(r.unitPrice),
        expiryDate: r.expiryDate || p?.expiryDate || '',
      };
    });
    const payments = paidSafe > 0 ? [{ method: 'cash', amount: paidSafe, accountId, accountName: accounts.find((a) => a.id === accountId)?.name || 'الصندوق' }] : [];
    const paymentType = paidSafe <= 0 ? 'debt' : paidSafe >= total ? 'cash' : 'partial';
    const savePayload = {
      supplierId: supplier.id, supplierName: supplier.name, warehouseId, items,
      paymentType, paidAmount: paidSafe, payments,
      discountType, discountValue: num(discountValue), discountAmount, notes,
      date: purchaseDate || undefined, supplierInvoiceNumber: supplierInvoiceNumber.trim(),
    };
    const res = editingId ? await updatePurchaseInvoice?.(editingId, savePayload) : await createPurchaseInvoice?.(savePayload);
    if (res) {
      setMode('list');
      setEditingId(null);
      setRows([makeRow()]);
      setPaid(''); setDiscountValue(''); setNotes(''); setSupplierInvoiceNumber(''); setPurchaseDate(new Date().toISOString().slice(0,10));
      const preferred = warehouses[0];
      if (preferred) setWarehouseId(preferred.id);
    }
    } catch (err) {
      console.error('Purchase save failed:', err);
      showToast?.(`تعذر حفظ فاتورة المشتريات: ${String(err?.message || err || 'خطأ غير معروف')}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditPurchase = (p) => {
    if (!p) return;
    if ((p.financialYearId || activeFinancialYearId) !== activeFinancialYearId) { showToast?.('الفاتورة ضمن سنة مالية مؤرشفة. يمكن عرضها وطباعتها فقط.', 'warning'); return; }
    setEditingId(p.id);
    setSupplierId(p.supplierId || suppliers[0]?.id || '');
    setWarehouseId(p.warehouseId || primaryWarehouse?.id || '');
    setAccountId(p.payments?.[0]?.accountId || accounts.find((a)=>a.isDefault)?.id || accounts[0]?.id || '');
    setPaid(String(Number(p.paidAmount || 0)));
    setDiscountType(p.discountType || 'fixed');
    setDiscountValue(String(Number(p.discountValue ?? p.discountTotal ?? 0)));
    setNotes(p.notes || '');
    setPurchaseDate(String(p.date || new Date().toISOString()).slice(0,10));
    setSupplierInvoiceNumber(p.supplierInvoiceNumber || '');
    setRows((p.items || []).map((it) => ({ productId:it.productId || '', unitId:it.unitId || '', quantity:String(Number(it.quantity || 0)), unitPrice:String(Number(it.unitPrice || 0)), expiryDate:it.expiryDate || '' })));
    setViewing(null);
    setMode('new');
    showToast?.(`تعديل فاتورة ${p.invoiceNumber}: عند الحفظ سيتم عكس القيد القديم وتسجيل الجديد`, 'info');
  };

  const addSupplier = async (e) => {
    e.preventDefault();
    if (!quickName.trim()) return;
    const ns = { id: 'supp-' + Date.now(), name: quickName.trim(), phone: quickPhone.trim(), balance: 0, createdAt: new Date().toISOString() };
    await saveSupplier?.(ns);
    setSupplierId(ns.id); setShowQuickSupp(false); setQuickName(''); setQuickPhone('');
  };

  const addWarehouse = async (e) => {
    e.preventDefault();
    const name = quickWarehouseName.trim();
    if (!name) return;
    const wh = { id: `wh-${Date.now()}`, name, code: quickWarehouseCode.trim() || `WH-${String(Date.now()).slice(-4)}`, isDefault: warehouses.length === 0, createdAt: new Date().toISOString() };
    await saveWarehouse?.(wh);
    setWarehouseId(wh.id);
    setShowQuickWarehouse(false);
    setQuickWarehouseName('');
    setQuickWarehouseCode('');
  };

  const supplierOpts = suppliers.map((s) => ({ id: s.id, label: s.name || 'مورد', subLabel: s.phone || '', badge: Number(s.balance) ? `رصيد ${money(s.balance)}` : undefined }));
  const whOpts = warehouses.map((w) => ({ id: w.id, label: w.name || 'مخزن', subLabel: w.code || '' }));
  const accountOpts = accounts.map((a) => ({ id: a.id, label: a.name || 'حساب', subLabel: `الرصيد: ${money(a.balance)} ${settings.currencySymbol || ''}` }));
  const purchaseQueryOptions = {
    filters: { financialYearId: financialYearFilter },
    legacyFinancialYearId,
    sortField: 'date',
    sortDirection: 'desc',
    deletedMode: 'exclude',
    pageSize: 50,
  };
  const purchasesPager = useDatabasePagination('purchases', purchaseQueryOptions, financialYearFilter);
  const sortedPurchases = purchasesPager.pageItems;
  const statementTotals = statementRows.reduce((acc,row)=>{ acc.total += num(row.grandTotal); acc.paid += num(row.paidAmount); acc.debt += num(row.remainingAmount); return acc; },{total:0,paid:0,debt:0});

  useEffect(() => {
    if (!showPurchaseStatement || typeof queryAllStoreRecords !== 'function') return undefined;
    let cancelled = false;
    setStatementLoading(true);
    const from = new Date(`${statementFrom || todayIso}T00:00:00`).toISOString();
    const to = new Date(`${statementTo || todayIso}T23:59:59.999`).toISOString();
    queryAllStoreRecords('purchases', {
      ...purchaseQueryOptions,
      dateFrom: from,
      dateTo: to,
      pageSize: 200,
    }).then((rows) => {
      if (!cancelled) setStatementRows(Array.isArray(rows) ? rows : []);
    }).catch((err) => {
      console.error('Purchase statement load failed:', err);
      if (!cancelled) {
        setStatementRows([]);
        showToast?.('تعذر تحميل كشف المشتريات', 'error');
      }
    }).finally(() => { if (!cancelled) setStatementLoading(false); });
    return () => { cancelled = true; };
  }, [showPurchaseStatement, statementFrom, statementTo, financialYearFilter, legacyFinancialYearId]);

  const form = h('div', { className: 'rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm space-y-4' },
    h('div', { className: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
      h(SearchableDropdown, { id: 'purchase-supplier', label: t("المورد:"), options: supplierOpts, selectedId: supplierId, onSelect: setSupplierId, onQuickAdd: () => setShowQuickSupp(true), quickAddLabel: '+ مورد جديد', icon: h(Building2, { className: 'w-4 h-4' }) }),
      h(SearchableDropdown, { id: 'purchase-warehouse', label: 'المخزن المستلم:', options: whOpts, selectedId: warehouseId, onSelect: setWarehouseId, onQuickAdd: () => setShowQuickWarehouse(true), quickAddLabel: '+ إضافة مخزن', placeholder: 'ابحث عن مخزن...' }),
      h(SearchableDropdown, { id: 'purchase-account', label: paidSafe > 0 ? 'حساب دفع المبلغ المدفوع:' : 'الحساب (يستخدم عند الدفع):', options: accountOpts, selectedId: accountId, onSelect: setAccountId, placeholder: 'ابحث عن حساب...' })
    ),
    h('div',{className:'grid grid-cols-1 sm:grid-cols-2 gap-3'},
      h('div',null,h('label',{className:'text-[11px] font-bold block mb-1'},'تاريخ فاتورة المورد'),h('input',{type:'date',value:purchaseDate,onChange:e=>setPurchaseDate(e.target.value),className:'w-full px-3 py-2 border rounded-xl text-xs bg-white dark:bg-slate-900 dark:border-slate-700'})),
      h('div',null,h('label',{className:'text-[11px] font-bold block mb-1'},'رقم فاتورة المورد'),h('input',{value:supplierInvoiceNumber,onChange:e=>setSupplierInvoiceNumber(e.target.value),placeholder:'يُقرأ تلقائياً من الصورة أو أدخله يدوياً',className:'w-full px-3 py-2 border rounded-xl text-xs bg-white dark:bg-slate-900 dark:border-slate-700'}))
    ),
    h('div', { className: 'overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl slim-scrollbar' },
      h('table', { className: 'w-full min-w-[900px] text-xs text-right' },
        h('thead', null, h('tr', { className: 'bg-slate-50 dark:bg-slate-800 border-b text-slate-500' }, ...['الصنف', 'الوحدة', 'الكمية', 'سعر الشراء', 'الانتهاء', 'الإجمالي', ''].map((x, i) => h('th', { key: i, className: 'p-2.5' }, x)))),
        h('tbody', null,
          ...rows.map((r, i) => {
            const p = activeProducts.find((x) => x.id === r.productId);
            const prodOpts = activeProducts.map((x) => ({ id: x.id, label: x.name || 'صنف', subLabel: x.sku || x.internalCode || 'صنف' }));
            const unitOpts = (p?.units || []).map((x) => ({ id: x.id, label: x.name || 'وحدة', subLabel: `×${x.conversionToBase || 1} ${p?.baseUnitName || ''}` }));
            return h('tr', { key: i, className: 'border-b last:border-b-0 align-top dark:border-slate-800' },
              h('td', { className: 'p-2 min-w-64' },
                h(SearchableDropdown, { id: `purchase-product-${i}`, options: prodOpts, selectedId: r.productId, onSelect: (id) => updateRow(i, { productId: id }), placeholder: 'ابحث عن الصنف...' }),
              ),
              h('td', { className: 'p-2 min-w-44' }, h(SearchableDropdown, { id: `purchase-unit-${i}`, options: unitOpts, selectedId: r.unitId, onSelect: (id) => updateRow(i, { unitId: id }), placeholder: 'ابحث عن الوحدة...' })),
              h('td', { className: 'p-2' }, h('input', { type: 'text', inputMode: 'decimal', dir: 'ltr', value: r.quantity, onFocus: (e) => e.currentTarget.select(), onChange: (e) => updateRow(i, { quantity: cleanNumber(e.target.value) }), className: 'w-24 px-2 py-2 border rounded-lg text-center font-mono font-bold bg-white dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:border-violet-500' })),
              h('td', { className: 'p-2' }, h('input', { type: 'text', inputMode: 'decimal', dir: 'ltr', value: r.unitPrice, onFocus: (e) => e.currentTarget.select(), onChange: (e) => updateRow(i, { unitPrice: cleanNumber(e.target.value) }), placeholder: '0.00', className: 'w-28 px-2 py-2 border rounded-lg text-center font-mono font-bold bg-white dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:border-violet-500' })),
              h('td', { className: 'p-2' }, h('input', { type: 'date', value: r.expiryDate || '', onChange: (e) => updateRow(i, { expiryDate: e.target.value }), className: 'px-2 py-2 border rounded-lg text-xs bg-white dark:bg-slate-900 dark:border-slate-700' })),
              h('td', { className: 'p-2 font-mono font-black text-violet-700' }, `${money(num(r.quantity) * num(r.unitPrice))} ${settings.currencySymbol || ''}`),
              h('td', { className: 'p-2' }, h('button', { type: 'button', onClick: () => setRows((x) => x.filter((_, idx) => idx !== i)), className: 'p-2 text-rose-600' }, h(Trash2, { className: 'w-4 h-4' })))
            );
          })
        )
      )
    ),
    h('button', { type: 'button', onClick: () => setRows((r) => [...r, makeRow()]), className: 'flex items-center gap-1 text-xs font-bold text-violet-700' }, h(Plus, { className: 'w-4 h-4' }), t("إضافة صنف")),
    h('div', { className: 'grid grid-cols-1 sm:grid-cols-5 gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3' },
      h('div', null, h('label', { className: 'text-[11px] font-bold block mb-1' }, t("نوع الخصم")), h('div', { className: 'flex gap-1' },
        h('button', { type: 'button', onClick: () => setDiscountType('fixed'), className: `flex-1 py-2 rounded-lg text-xs font-bold border ${discountType === 'fixed' ? 'bg-violet-600 text-white' : 'bg-white text-slate-700'}` }, 'مبلغ'),
        h('button', { type: 'button', onClick: () => setDiscountType('percent'), className: `flex-1 py-2 rounded-lg text-xs font-bold border ${discountType === 'percent' ? 'bg-violet-600 text-white' : 'bg-white text-slate-700'}` }, '%')
      )),
      h('div', null, h('label', { className: 'text-[11px] font-bold block mb-1' }, t("قيمة الخصم")), h('input', { type: 'text', inputMode: 'decimal', dir: 'ltr', value: discountValue, onFocus: (e) => e.currentTarget.select(), onChange: (e) => setDiscountValue(cleanNumber(e.target.value)), placeholder: discountType === 'percent' ? '0 - 100' : '0.00', className: 'w-full px-3 py-2 border rounded-lg font-mono bg-white dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:border-violet-500' })),
      h('div', null, h('label', { className: 'text-[11px] font-bold block mb-1' }, t("المبلغ المدفوع")), h('input', { type: 'text', inputMode: 'decimal', dir: 'ltr', value: paid, onFocus: (e) => e.currentTarget.select(), onChange: (e) => setPaid(cleanNumber(e.target.value)), placeholder: '0.00', className: 'w-full px-3 py-2 border rounded-lg font-mono font-bold text-violet-700 bg-white dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:border-violet-500' })),
      h('div', { className: 'rounded-lg bg-white dark:bg-slate-900 border dark:border-slate-700 p-2' }, h('div', { className: 'text-[10px] text-slate-500' }, 'الباقي دين'), h('div', { className: 'font-mono font-black text-rose-600 text-lg' }, `${money(debt)} ${settings.currencySymbol || ''}`)),
      h('div', { className: 'rounded-lg bg-white dark:bg-slate-900 border dark:border-slate-700 p-2' }, h('div', { className: 'text-[10px] text-slate-500' }, 'الصافي بعد الخصم'), h('div', { className: 'font-mono font-black text-violet-700 text-lg' }, `${money(total)} ${settings.currencySymbol || ''}`))
    ),
    h('input', { value: notes, onChange: (e) => setNotes(e.target.value), placeholder: 'ملاحظات فاتورة الشراء...', className: 'w-full px-3 py-2 border rounded-xl text-xs bg-white dark:bg-slate-900 dark:border-slate-700' }),
    h('div', { className: 'flex justify-end gap-2' }, h('button', { type: 'button', onClick: () => { setMode('list'); setEditingId(null); }, className: 'px-4 py-2 border rounded-xl text-xs font-bold' }, t("إلغاء")), h('button', { type: 'button', onClick: submit, disabled: isSaving, className: 'px-6 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-60' }, isSaving ? 'جاري الحفظ محلياً...' : (editingId ? 'حفظ تعديل الفاتورة' : 'حفظ فاتورة الشراء')))
  );


  const exportPurchase = async (kind) => {
    if (!viewing || exporting) return;
    setExporting(kind);
    try {
      const base = `purchase-${viewing.invoiceNumber || viewing.id || 'invoice'}`;
      let ok = false;
      if (kind === 'pdf') ok = await downloadProfessionalPurchaseInvoicePDF(viewing, settings, `${base}.pdf`);
      if (kind === 'image') ok = await downloadProfessionalPurchaseInvoiceImage(viewing, settings, `${base}.png`);
      if (kind === 'excel') {
        const items = Array.isArray(viewing.items) ? viewing.items : [];
        const rows = items.map((it, i) => [
          i + 1,
          it?.productName || 'صنف',
          it?.unitName || '-',
          num(it?.quantity),
          num(it?.unitPrice),
          num(it?.total),
        ]);
        rows.push(['', '', '', '', 'الإجمالي قبل الخصم', num(viewing.subtotal)]);
        if (num(viewing.discountTotal ?? viewing.discountAmount) > 0) rows.push(['', '', '', '', 'الخصم', -num(viewing.discountTotal ?? viewing.discountAmount)]);
        rows.push(['', '', '', '', 'صافي الفاتورة', num(viewing.grandTotal)]);
        rows.push(['', '', '', '', 'المدفوع', num(viewing.paidAmount)]);
        rows.push(['', '', '', '', 'الباقي دين', num(viewing.remainingAmount)]);
        ok = await downloadProfessionalTableExcel({
          title: 'فاتورة مشتريات',
          subtitle: `رقم النظام: ${viewing.invoiceNumber || '-'}${viewing.supplierInvoiceNumber ? ` • فاتورة المورد: ${viewing.supplierInvoiceNumber}` : ''} • المورد: ${viewing.supplierName || 'مورد'} • التاريخ: ${safeDate(viewing.date).toLocaleString('ar-EG')}`,
          headers: ['#', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الإجمالي'],
          rows,
          settings,
          filename: `${base}.xls`,
        });
      }
      if (!ok) showToast?.('تعذر إنشاء الملف، حاول مرة أخرى', 'error');
    } catch (err) {
      console.error(err);
      showToast?.('تعذر إنشاء الملف', 'error');
    } finally {
      setExporting('');
    }
  };

  const list = h('div', { className: 'rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm' },
    (!purchasesPager.loading && purchasesPager.totalItems === 0)
      ? h('div', { className: 'min-h-64 flex flex-col items-center justify-center p-8 text-center' }, h(ReceiptText, { className: 'w-10 h-10 text-slate-300 mb-3' }), h('div', { className: 'font-black text-slate-700 dark:text-slate-200' }, 'لا توجد فواتير مشتريات بعد'), h('p', { className: 'text-xs text-slate-400 mt-1' }, 'اضغط «فاتورة شراء جديدة» لتسجيل أول عملية توريد.'))
      : h('div', { className: 'overflow-x-auto slim-scrollbar' }, h('table', { className: 'w-full min-w-[760px] text-xs text-right' },
          h('thead', null, h('tr', { className: 'bg-slate-50 dark:bg-slate-800 border-b text-slate-500 dark:border-slate-700' }, ...['الرقم', 'التاريخ', 'المورد', 'الإجمالي', 'المدفوع', 'الدين', ''].map((x, i) => h('th', { key: i, className: 'p-3' }, x)))),
          h('tbody', null, ...purchasesPager.pageItems.map((p, index) => h('tr', { key: p.id || index, className: 'border-b last:border-0 dark:border-slate-800' },
            h('td', { className: 'p-3 font-mono font-bold' }, p.invoiceNumber || `PUR-${index + 1}`),
            h('td', { className: 'p-3' }, safeDate(p.date).toLocaleDateString('ar-EG')),
            h('td', { className: 'p-3 font-bold' }, p.supplierName || 'مورد'),
            h('td', { className: 'p-3 font-mono' }, `${money(p.grandTotal)} ${settings.currencySymbol || ''}`),
            h('td', { className: 'p-3 font-mono text-violet-700' }, money(p.paidAmount)),
            h('td', { className: 'p-3 font-mono text-rose-600' }, money(p.remainingAmount)),
            h('td', { className: 'p-3 flex gap-1' }, h('button', { type: 'button', onClick: () => { warmExportLibraries(); setViewing(p); }, className: 'p-2 rounded-lg border dark:border-slate-700', title:t("عرض") }, h(Eye, { className: 'w-4 h-4' })), ((p.financialYearId || activeFinancialYearId) === activeFinancialYearId ? h('button', { type:'button', onClick:()=>startEditPurchase(p), className:'p-2 rounded-lg border dark:border-slate-700 text-blue-600', title:'تعديل مع قيد عكسي' }, h(Pencil,{className:'w-4 h-4'})) : null), (canDelete && (p.financialYearId || activeFinancialYearId) === activeFinancialYearId) ? h('button', { type: 'button', onClick: () => setDeleting(p.id), className: 'p-2 rounded-lg border dark:border-slate-700 text-rose-600' }, h(Trash2, { className: 'w-4 h-4' })) : null)
          )))
        ),
        h(Pagination,{pager:purchasesPager})
      )
  );

  const purchaseStatementModal = showPurchaseStatement ? h('div',{className:'fixed inset-0 p-2 sm:p-5 flex items-center justify-center bg-slate-950/65',style:{zIndex:2147482500}},
    h('div',{className:'w-full max-w-5xl max-h-[96vh] bg-slate-100 rounded-2xl overflow-hidden flex flex-col shadow-2xl'},
      h('div',{className:'no-print shrink-0 p-3 bg-white border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2'},
        h('div',null,h('div',{className:'font-black text-sm'},'كشف المشتريات والتوريد'),h('div',{className:'text-[10px] text-slate-500'},'حدد الفترة ثم اطبع الكشف أو احفظه PDF من نافذة الطباعة')),
        h('div',{className:'flex flex-wrap gap-2 items-end'},
          h('label',{className:'text-[10px] font-bold'},t("من"),h('input',{type:'date',value:statementFrom,onChange:e=>setStatementFrom(e.target.value),className:'block mt-1 px-2 py-1.5 border rounded-lg text-xs'})),
          h('label',{className:'text-[10px] font-bold'},t("إلى"),h('input',{type:'date',value:statementTo,onChange:e=>setStatementTo(e.target.value),className:'block mt-1 px-2 py-1.5 border rounded-lg text-xs'})),
          h('button',{type:'button',disabled:statementLoading,onClick:async()=>{if(statementRef.current){const ok=await printElementOnly(statementRef.current,'a4',`كشف مشتريات ${statementFrom} إلى ${statementTo}`);if(!ok)showToast?.('تعذر تجهيز كشف المشتريات للطباعة','error');}},className:'px-3 py-2 rounded-xl bg-violet-600 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5'},h(Printer,{className:'w-4 h-4'}),statementLoading?'جارٍ التحميل...':'طباعة / PDF'),
          h('button',{type:'button',onClick:()=>setShowPurchaseStatement(false),className:'p-2 rounded-xl border bg-white'},h(X,{className:'w-4 h-4'}))
        )
      ),
      h('div',{className:'flex-1 overflow-auto p-3 sm:p-5'},
        h('article',{ref:statementRef,dir:'rtl',className:'mx-auto bg-white text-slate-900 border rounded-xl overflow-hidden',style:{width:'100%',maxWidth:'980px',fontFamily:"'Cairo',Arial,sans-serif",padding:'10mm',boxSizing:'border-box'}},
          h('header',{className:'text-center pb-4 border-b-2 border-violet-600'},
            h('img',{src:getBrandLogoDisplayUrl(settings),alt:'',style:{width:'64px',height:'64px',objectFit:'contain',margin:'0 auto 6px'}}),
            h('h2',{className:'text-xl font-black'},settings.storeName || 'كاش توب 3'),
            h('div',{className:'text-sm font-black text-violet-700 mt-1'},'كشف المشتريات والتوريد'),
            h('div',{className:'text-[11px] text-slate-500 mt-2'},`${statementFrom || '-'}  ←  ${statementTo || '-'} • ${financialYears.find(y=>y.id===financialYearFilter)?.name || (financialYearFilter==='all'?'كل السنوات':'السنة المالية الحالية')}`),
            h('div',{className:'text-[10px] text-slate-400 mt-1'},[settings.address,settings.phone?`هاتف: ${settings.phone}`:'',settings.taxNumber?`الرقم الضريبي: ${settings.taxNumber}`:''].filter(Boolean).join(' • '))
          ),
          h('div',{className:'grid grid-cols-2 sm:grid-cols-4 gap-2 my-4'},
            h('div',{className:'border rounded-lg p-2 text-center'},h('div',{className:'text-[10px] text-slate-500'},'عدد الفواتير'),h('div',{className:'font-black'},String(statementRows.length))),
            h('div',{className:'border rounded-lg p-2 text-center'},h('div',{className:'text-[10px] text-slate-500'},t("الإجمالي")),h('div',{className:'font-black'},`${money(statementTotals.total)} ${settings.currencySymbol||''}`)),
            h('div',{className:'border rounded-lg p-2 text-center'},h('div',{className:'text-[10px] text-slate-500'},t("المدفوع")),h('div',{className:'font-black text-violet-700'},`${money(statementTotals.paid)} ${settings.currencySymbol||''}`)),
            h('div',{className:'border rounded-lg p-2 text-center'},h('div',{className:'text-[10px] text-slate-500'},t("المتبقي")),h('div',{className:'font-black text-rose-700'},`${money(statementTotals.debt)} ${settings.currencySymbol||''}`))
          ),
          h('table',{className:'w-full text-[11px] border-collapse'},
            h('thead',null,h('tr',{className:'bg-violet-600 text-white'},...['#','التاريخ','رقم الفاتورة','المورد','الإجمالي','المدفوع','المتبقي'].map((x,i)=>h('th',{key:i,className:'border border-violet-500 p-2 text-right'},x)))),
            h('tbody',null,...(statementRows.length?statementRows:[null]).map((row,i)=>row?h('tr',{key:row.id||i},
              h('td',{className:'border p-2'},i+1),h('td',{className:'border p-2'},safeDate(row.date).toLocaleDateString('ar-EG')),h('td',{className:'border p-2 font-mono'},row.invoiceNumber||'-'),h('td',{className:'border p-2 font-bold'},row.supplierName||'-'),h('td',{className:'border p-2'},money(row.grandTotal)),h('td',{className:'border p-2'},money(row.paidAmount)),h('td',{className:'border p-2'},money(row.remainingAmount))
            ):h('tr',{key:'empty'},h('td',{colSpan:7,className:'border p-6 text-center text-slate-400'},'لا توجد مشتريات في الفترة المختارة'))))
          )
        )
      )
    )
  ) : null;

  return h('div', { id: 'purchases-screen', className: 'p-4 sm:p-6 space-y-4 max-w-7xl mx-auto text-right min-h-full' },
    h('div', { className: 'flex flex-wrap items-center justify-between gap-2' },
      h('div',{className:'flex items-center gap-2 flex-wrap'},
        h(SearchableDropdown,{id:'purchases-financial-group',label:t('المجموعة المالية'),selectedId:financialYearFilter,onSelect:setFinancialYearFilter,options:[{id:'all',label:t('كل المجموعات المالية')},...financialYears.map(y=>({id:y.id,label:y.name,subLabel:y.id===activeFinancialYearId?t('الحالية'):t('أرشيف')}))]}),
        h('button',{type:'button',onClick:()=>setShowPurchaseStatement(true),className:'px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-xs font-black flex items-center gap-1.5'},h(Printer,{className:'w-4 h-4'}),'كشف مشتريات من تاريخ إلى تاريخ')
      ),
      h('button', { type: 'button', onClick: () => { setEditingId(null); setMode(mode === 'list' ? 'new' : 'list'); }, className: 'px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold shadow-sm' }, mode === 'new' ? 'عرض السجل' : 'فاتورة شراء جديدة')
    ),
    mode === 'new' ? form : list,
    purchaseStatementModal,
    viewing ? h(ModalLayer, { className: 'fixed inset-x-0 oscar-bounded-modal p-2 sm:p-5 flex items-stretch sm:items-center justify-center overflow-hidden', style:{zIndex:2147482000,background:'rgba(15,23,42,.62)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)'} },
      h('div', { className: 'w-full max-w-3xl h-full max-h-full sm:h-auto bg-slate-100 dark:bg-slate-950 rounded-2xl shadow-2xl overflow-hidden flex flex-col' },
        h('div',{className:'no-print shrink-0 flex items-center justify-between gap-2 p-3 bg-white dark:bg-slate-900 border-b dark:border-slate-800'},
          h('div',null,h('div',{className:'font-black text-sm'},`فاتورة مشتريات #${viewing.invoiceNumber || ''}`),h('div',{className:'text-[10px] text-slate-400'},'معاينة جاهزة للطباعة والحفظ')),
          h('button',{type:'button',onClick:()=>setViewing(null),className:'p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800'},h(X,{className:'w-5 h-5'}))
        ),
        h('div',{className:'flex-1 overflow-y-auto p-3 sm:p-5 custom-scrollbar'},
          h('article',{ref:singleRef,id:'purchase-invoice-export',dir:'rtl',className:'mx-auto w-full max-w-[720px] bg-white text-slate-900 rounded-xl border border-slate-200 shadow-sm overflow-hidden',style:{fontFamily:"'Cairo',Arial,sans-serif",colorScheme:'light'}},
            h('header',{className:'p-5 sm:p-6 text-center border-b border-slate-200'},
              h('img',{src:getBrandLogoDisplayUrl(settings),alt:'الشعار',className:'w-16 h-16 object-contain mx-auto mb-2'}),
              h('h2',{className:'text-xl font-black leading-tight'},settings.storeName || 'كاش توب 3'),
              h('div',{className:'text-[11px] text-violet-700 font-bold mt-1'},'فاتورة مشتريات وتوريد'),
              h('div',{className:'mt-2 text-[10px] text-slate-500 leading-5'},
                settings.address ? h('div',null,settings.address) : null,
                h('div',null,[settings.phone ? `هاتف: ${settings.phone}` : '',settings.taxNumber ? `الرقم الضريبي: ${settings.taxNumber}` : ''].filter(Boolean).join('   •   '))
              )
            ),
            h('section',{className:'grid grid-cols-2 gap-x-5 gap-y-2 p-4 sm:p-5 text-[11px] border-b border-slate-200 bg-slate-50/70'},
              h('div',null,h('span',{className:'text-slate-400'},t("رقم الفاتورة: ")),h('b',{className:'font-mono'},viewing.invoiceNumber || '-')),
              h('div',null,h('span',{className:'text-slate-400'},t("التاريخ: ")),h('b',null,safeDate(viewing.date).toLocaleString('ar-EG'))),
              viewing.supplierInvoiceNumber ? h('div',null,h('span',{className:'text-slate-400'},'فاتورة المورد: '),h('b',{className:'font-mono'},viewing.supplierInvoiceNumber)) : null,
              h('div',null,h('span',{className:'text-slate-400'},t("المورد: ")),h('b',null,viewing.supplierName || 'مورد')),
              h('div',null,h('span',{className:'text-slate-400'},t("المخزن: ")),h('b',null,warehouses.find((w)=>w.id===viewing.warehouseId)?.name || '-'))
            ),
            h('div',{className:'p-3 sm:p-5'},
              h('table',{className:'w-full text-[10px] sm:text-[11px] border-collapse'},
                h('thead',null,h('tr',{className:'bg-slate-100 border-y border-slate-200'},
                  h('th',{className:'p-2 text-right'},t("الصنف")),h('th',{className:'p-2 text-center'},t("الوحدة")),h('th',{className:'p-2 text-center'},t("الكمية")),h('th',{className:'p-2 text-center'},t("السعر")),h('th',{className:'p-2 text-left'},t("الإجمالي"))
                )),
                h('tbody',null,...(Array.isArray(viewing.items)?viewing.items:[]).map((it,i)=>h('tr',{key:it?.id||`${it?.productId||'p'}-${i}`,className:'border-b border-slate-100'},
                  h('td',{className:'p-2 font-bold'},it?.productName||'صنف'),h('td',{className:'p-2 text-center'},it?.unitName||'-'),h('td',{className:'p-2 text-center font-mono'},num(it?.quantity)),h('td',{className:'p-2 text-center font-mono'},money(it?.unitPrice)),h('td',{className:'p-2 text-left font-mono font-bold'},money(it?.total))
                )))
              ),
              h('div',{className:'mt-4 mr-auto w-full sm:w-72 text-[11px] space-y-2'},
                h('div',{className:'flex justify-between'},h('span',{className:'text-slate-500'},'الإجمالي قبل الخصم'),h('b',{className:'font-mono'},`${money(viewing.subtotal)} ${settings.currencySymbol||''}`)),
                h('div',{className:'flex justify-between'},h('span',{className:'text-slate-500'},t("الخصم")),h('b',{className:'font-mono text-rose-600'},`${money(viewing.discountTotal ?? viewing.discountAmount)} ${settings.currencySymbol||''}`)),
                h('div',{className:'flex justify-between border-t pt-2 text-sm'},h('span',{className:'font-black'},'صافي الفاتورة'),h('b',{className:'font-mono text-violet-700'},`${money(viewing.grandTotal)} ${settings.currencySymbol||''}`)),
                h('div',{className:'flex justify-between'},h('span',{className:'text-slate-500'},t("المبلغ المدفوع")),h('b',{className:'font-mono text-violet-700'},`${money(viewing.paidAmount)} ${settings.currencySymbol||''}`)),
                h('div',{className:'flex justify-between'},h('span',{className:'text-slate-500'},'الباقي دين'),h('b',{className:'font-mono text-rose-600'},`${money(viewing.remainingAmount)} ${settings.currencySymbol||''}`))
              ),
              viewing.notes ? h('div',{className:'mt-4 p-3 rounded-lg bg-slate-50 border border-slate-100 text-[10px]'},h('b',null,t("ملاحظات: ")),viewing.notes) : null
            ),
            h('footer',{className:'px-5 py-4 text-center text-[9px] text-slate-400 border-t border-slate-200'},settings.receiptFooterMessage || 'شكراً لتعاملكم معنا')
          )
        ),
        h('div',{className:'no-print shrink-0 p-3 bg-white dark:bg-slate-900 border-t dark:border-slate-800 flex flex-wrap items-center justify-center gap-2'},
          h('button',{type:'button',disabled:!!exporting,onClick:()=>exportPurchase('pdf'),className:'min-w-[92px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold disabled:opacity-50'},h(FileDown,{className:'w-4 h-4'}),exporting==='pdf'?'جاري...':'PDF'),
          h('button',{type:'button',disabled:!!exporting,onClick:()=>exportPurchase('image'),className:'min-w-[92px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold disabled:opacity-50'},h(ImageIcon,{className:'w-4 h-4'}),exporting==='image'?'جاري...':t("صورة")),
          h('button',{type:'button',disabled:!!exporting,onClick:()=>exportPurchase('excel'),className:'min-w-[92px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 text-xs font-bold disabled:opacity-50'},h(FileSpreadsheet,{className:'w-4 h-4'}),exporting==='excel'?'جاري...':'Excel'),
          h('button',{type:'button',onClick:async()=>{if(singleRef.current){const ok=await printElementOnly(singleRef.current,settings.printerWidth||'80mm',`فاتورة مشتريات ${viewing.invoiceNumber||''}`);if(!ok)showToast?.('تعذر تجهيز الطباعة','error');}},className:'min-w-[92px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold'},h(Printer,{className:'w-4 h-4'}),t("طباعة"))
        )
      )
    ) : null,
    deleting ? h(ModalLayer, { className: 'fixed inset-0 z-[60] bg-black/60 p-4 flex items-center justify-center' }, h('div', { className: 'w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-5 text-center space-y-3' }, h(AlertTriangle, { className: 'w-9 h-9 text-rose-600 mx-auto' }), h('div', { className: 'font-black' }, 'حذف فاتورة المشتريات؟'), h('div', { className: 'flex gap-2' }, h('button', { type: 'button', onClick: () => setDeleting(null), className: 'flex-1 py-2 border rounded-xl' }, t("إلغاء")), h('button', { type: 'button', onClick: async () => { if (await deletePurchase?.(deleting)) { setDeleting(null); setViewing(null); } }, className: 'flex-1 py-2 bg-rose-600 text-white rounded-xl' }, t("حذف"))))) : null,
    showQuickSupp ? h(ModalLayer, { className: 'fixed inset-0 z-[70] bg-black/60 p-4 flex items-center justify-center' }, h('form', { onSubmit: addSupplier, className: 'w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-4 space-y-3' }, h('div', { className: 'font-black' }, 'مورد جديد'), h('input', { required: true, value: quickName, onChange: (e) => setQuickName(e.target.value), placeholder: 'اسم المورد', className: 'w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700' }), h('input', { value: quickPhone, onChange: (e) => setQuickPhone(e.target.value), placeholder: 'الهاتف', className: 'w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700' }), h('div', { className: 'flex gap-2' }, h('button', { type: 'button', onClick: () => setShowQuickSupp(false), className: 'flex-1 p-2 border rounded-lg' }, t("إلغاء")), h('button', { type: 'submit', className: 'flex-1 p-2 bg-violet-600 text-white rounded-lg' }, t("حفظ"))))) : null,
    showQuickWarehouse ? h(ModalLayer, { className: 'fixed inset-0 z-[72] bg-black/60 p-4 flex items-center justify-center' }, h('form', { onSubmit: addWarehouse, className: 'w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl p-4 space-y-3 shadow-2xl' }, h('div', { className: 'font-black' }, 'إضافة مخزن جديد'), h('input', { required: true, value: quickWarehouseName, onChange: (e) => setQuickWarehouseName(e.target.value), placeholder: 'اسم المخزن', className: 'w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700' }), h('input', { value: quickWarehouseCode, onChange: (e) => setQuickWarehouseCode(e.target.value), placeholder: 'الكود (اختياري)', className: 'w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-700' }), h('div', { className: 'flex gap-2' }, h('button', { type: 'button', onClick: () => setShowQuickWarehouse(false), className: 'flex-1 p-2 border rounded-lg' }, t("إلغاء")), h('button', { type: 'submit', className: 'flex-1 p-2 bg-violet-600 text-white rounded-lg font-bold' }, 'حفظ واختيار')))) : null
  );
};
