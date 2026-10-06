import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useEffect, useState } from 'react';
import { X, ScanLine, Upload, AlertTriangle, CheckCircle2, LoaderCircle, Sparkles, Image as ImageIcon } from 'lucide-react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { scanPurchaseInvoice } from './services__ai.js?v=7.9.4.136-localization';
import { findBestSupplier, findBestProduct, findBestUnit } from './utils__aiMatching.js?v=7.9.4.136-localization';

const h = React.createElement;
const n = (v) => Number(v || 0) || 0;
const clean = (v) => String(v ?? '').trim();

export const PurchaseAIScanModal = ({ open, onClose, onApply }) => {
  const app = useApp();
  const products = (app.products || []).filter((p) => p && !p.deletedAt && Array.isArray(p.units) && p.units.length);
  const suppliers = (app.suppliers || []).filter(Boolean);
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [raw, setRaw] = useState(null);
  const [supplierMatch, setSupplierMatch] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setPreviews([]);
      setBusy(false);
      setRaw(null);
      setSupplierMatch('');
      setLines([]);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    const rows = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(rows);
    return () => rows.forEach((row) => { if (row.url) URL.revokeObjectURL(row.url); });
  }, [files]);

  const loadResult = (result) => {
    const parsed = result || {};
    setRaw(parsed);
    const sm = findBestSupplier(parsed?.supplier?.name, suppliers);
    setSupplierMatch(sm?.supplier?.id || '');
    const mapped = (parsed?.items || []).map((item, index) => {
      const pm = findBestProduct(item?.name, products, item?.barcode);
      const product = pm?.product || null;
      const um = product ? findBestUnit(item?.unit, product) : null;
      return {
        key: `ai-${index}-${Date.now()}`,
        sourceName: clean(item?.name),
        sourceUnit: clean(item?.unit),
        confidence: n(item?.confidence),
        productId: product?.id || '',
        unitId: um?.unit?.id || '',
        productScore: pm?.score || 0,
        unitScore: um?.score || 0,
        quantity: n(item?.quantity) || 1,
        unitPrice: n(item?.unitPrice),
        total: n(item?.total),
        barcode: clean(item?.barcode),
      };
    });
    setLines(mapped);
  };

  const analyze = async () => {
    if (!files.length) {
      setError('أرفق صورة واضحة لفاتورة المشتريات.');
      return;
    }
    setBusy(true);
    setError('');
    setRaw(null);
    try {
      const catalog = {
        suppliers: suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name })),
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku || product.internalCode,
          units: (product.units || []).map((unit) => ({ id: unit.id, name: unit.name, factor: unit.conversionToBase, barcodes: Array.isArray(unit.barcodes) ? unit.barcodes : (unit.barcode ? [unit.barcode] : []) })),
        })),
      };
      const response = await scanPurchaseInvoice({ files, catalog });
      loadResult(response?.result || response);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (index, patch) => {
    setLines((previous) => previous.map((line, idx) => {
      if (idx !== index) return line;
      const next = { ...line, ...patch };
      if (patch.productId !== undefined && patch.productId !== line.productId) {
        const product = products.find((item) => item.id === patch.productId);
        const unitMatch = product ? findBestUnit(line.sourceUnit, product) : null;
        next.unitId = unitMatch?.unit?.id || product?.units?.[0]?.id || '';
      }
      return next;
    }));
  };

  const unmatched = lines.filter((line) => !line.productId || !line.unitId);
  const recognizedTotal = lines.reduce((sum, line) => sum + (line.total || line.quantity * line.unitPrice), 0);

  const apply = async () => {
    if (!lines.length) {
      setError('لا توجد أصناف مقروءة.');
      return;
    }
    if (unmatched.length) {
      setError(`يوجد ${unmatched.length} صنف/وحدة بدون مطابقة. اختر المطابقة يدوياً أولاً.`);
      return;
    }

    let finalSupplierId = supplierMatch;
    const supplierName = clean(raw?.supplier?.name);
    if (!finalSupplierId && supplierName) {
      const newSupplier = {
        id: `supp-${Date.now()}`,
        name: supplierName,
        phone: clean(raw?.supplier?.phone),
        balance: 0,
        createdAt: new Date().toISOString(),
        notes: 'أضيف من تعبئة فاتورة مشتريات بالذكاء الاصطناعي',
      };
      await app.saveSupplier?.(newSupplier);
      finalSupplierId = newSupplier.id;
    }
    if (!finalSupplierId) {
      setError('لم يتم تحديد المورد. اختر مورداً موجوداً أو اكتب اسم المورد في النص.');
      return;
    }

    const rows = lines.map((line) => {
      const product = products.find((item) => item.id === line.productId);
      const unit = product?.units?.find((item) => item.id === line.unitId) || product?.units?.[0];
      return {
        productId: product.id,
        unitId: unit.id,
        quantity: String(line.quantity || 1),
        unitPrice: String(line.unitPrice || (line.total && line.quantity ? line.total / line.quantity : 0) || ''),
        expiryDate: '',
      };
    });

    onApply?.({
      supplierId: finalSupplierId,
      supplierName: supplierName || suppliers.find((item) => item.id === finalSupplierId)?.name || '',
      rows,
      invoiceNumber: clean(raw?.invoiceNumber),
      date: raw?.date || '',
      discount: n(raw?.discount),
      paidAmount: raw?.paidAmount == null ? null : n(raw.paidAmount),
      notes: `تمت التعبئة عبر Cash Top AI من صورة${files.length > 1 ? ' متعددة' : ''}${raw?.currency ? ` • العملة المقروءة: ${raw.currency}` : ''}`,
      raw,
    });
    onClose?.();
  };

  const productOptions = () => products.map((product) => h('option', { key: product.id, value: product.id }, product.name));

  const unitOptions = (product) => (product?.units || []).map((unit) => h('option', { key: unit.id, value: unit.id }, unit.name));

  const statusBadge = (ok) => ok
    ? h('span', { className: 'inline-flex items-center gap-1 text-violet-700 font-bold' }, h(CheckCircle2, { className: 'w-4 h-4' }), 'مطابق')
    : h('span', { className: 'inline-flex items-center gap-1 text-amber-700 font-bold' }, h(AlertTriangle, { className: 'w-4 h-4' }), 'راجع');

  const renderMobileLine = (line, index) => {
    const product = products.find((item) => item.id === line.productId);
    const ok = Boolean(line.productId && line.unitId);
    return h('div', { key: line.key, className: 'rounded-2xl border bg-white p-3 space-y-3 shadow-sm' },
      h('div', { className: 'flex items-start justify-between gap-2' },
        h('div', null,
          h('div', { className: 'font-black text-xs' }, line.sourceName || 'غير واضح'),
          h('div', { className: 'text-[10px] text-slate-400 mt-0.5' }, `الوحدة المقروءة: ${line.sourceUnit || '-'}`)
        ),
        statusBadge(ok)
      ),
      h('div', null,
        h('label', { className: 'text-[10px] font-bold block mb-1' }, 'مطابقة الصنف'),
        h('select', { value: line.productId, onChange: (event) => updateLine(index, { productId: event.target.value }), className: 'w-full px-3 py-2.5 border rounded-xl bg-white text-xs' },
          h('option', { value: '' }, 'اختر الصنف...'),
          ...productOptions()
        )
      ),
      h('div', null,
        h('label', { className: 'text-[10px] font-bold block mb-1' }, t("الوحدة")),
        h('select', { value: line.unitId, onChange: (event) => updateLine(index, { unitId: event.target.value }), className: 'w-full px-3 py-2.5 border rounded-xl bg-white text-xs' },
          h('option', { value: '' }, 'اختر الوحدة...'),
          ...unitOptions(product)
        )
      ),
      h('div', { className: 'grid grid-cols-2 gap-2' },
        h('div', null,
          h('label', { className: 'text-[10px] font-bold block mb-1' }, t("الكمية")),
          h('input', { type: 'number', step: 'any', min: '0', value: line.quantity, onChange: (event) => updateLine(index, { quantity: n(event.target.value) }), className: 'w-full px-2 py-2.5 border rounded-xl font-mono text-center' })
        ),
        h('div', null,
          h('label', { className: 'text-[10px] font-bold block mb-1' }, 'سعر الوحدة'),
          h('input', { type: 'number', step: 'any', min: '0', value: line.unitPrice, onChange: (event) => updateLine(index, { unitPrice: n(event.target.value) }), className: 'w-full px-2 py-2.5 border rounded-xl font-mono text-center' })
        )
      ),
      h('div', { className: 'flex justify-between rounded-xl bg-slate-50 border px-3 py-2 text-xs' },
        h('span', { className: 'text-slate-500' }, 'إجمالي السطر'),
        h('b', { className: 'font-mono' }, (line.quantity * line.unitPrice || line.total || 0).toFixed(2))
      )
    );
  };

  const renderDesktopRow = (line, index) => {
    const product = products.find((item) => item.id === line.productId);
    const ok = Boolean(line.productId && line.unitId);
    return h('tr', { key: line.key, className: 'border-b last:border-0' },
      h('td', { className: 'p-2' },
        h('div', { className: 'font-bold' }, line.sourceName || 'غير واضح'),
        h('div', { className: 'text-[10px] text-slate-400' }, `الوحدة المقروءة: ${line.sourceUnit || '-'}`)
      ),
      h('td', { className: 'p-2 min-w-64' },
        h('select', { value: line.productId, onChange: (event) => updateLine(index, { productId: event.target.value }), className: 'w-full px-2 py-2 border rounded-lg bg-white' },
          h('option', { value: '' }, 'اختر الصنف...'),
          ...productOptions()
        )
      ),
      h('td', { className: 'p-2 min-w-40' },
        h('select', { value: line.unitId, onChange: (event) => updateLine(index, { unitId: event.target.value }), className: 'w-full px-2 py-2 border rounded-lg bg-white' },
          h('option', { value: '' }, 'اختر الوحدة...'),
          ...unitOptions(product)
        )
      ),
      h('td', { className: 'p-2' }, h('input', { type: 'number', step: 'any', min: '0', value: line.quantity, onChange: (event) => updateLine(index, { quantity: n(event.target.value) }), className: 'w-24 px-2 py-2 border rounded-lg font-mono text-center' })),
      h('td', { className: 'p-2' }, h('input', { type: 'number', step: 'any', min: '0', value: line.unitPrice, onChange: (event) => updateLine(index, { unitPrice: n(event.target.value) }), className: 'w-28 px-2 py-2 border rounded-lg font-mono text-center' })),
      h('td', { className: 'p-2 font-mono font-black' }, (line.quantity * line.unitPrice || line.total || 0).toFixed(2)),
      h('td', { className: 'p-2' }, statusBadge(ok))
    );
  };

  const summaryCard = (label, value, mono = false) => h('div', { className: 'p-3 rounded-xl border bg-slate-50' },
    h('div', { className: 'text-[10px] text-slate-400' }, label),
    h('div', { className: `font-black text-xs mt-1${mono ? ' font-mono' : ''}` }, value || '-')
  );

  if (!open) return null;

  const uploadBlock = h('div', { className: 'rounded-2xl border border-violet-200 bg-violet-50/50 p-3 sm:p-4 space-y-3' },
    h('div', { className: 'flex items-center gap-2' }, h(ImageIcon, { className: 'w-4 h-4 text-violet-700' }), h('div', { className: 'font-black text-xs' }, 'أرفق صورة فاتورة المشتريات')),
    h('div', { className: 'text-[10px] text-slate-500 leading-5' }, 'يدعم الصور فقط. يقرأ اسم المنتج والوحدة والكمية وسعر الوحدة وإجمالي السطر، مع المورد ورقم الفاتورة والتاريخ إن كانت ظاهرة.'),
    h('div', { className: 'flex flex-col sm:flex-row sm:items-center justify-between gap-3' },
      h('div', null,
        h('div', { className: 'font-black text-xs' }, 'صورة أو عدة صور للفاتورة'),
        h('div', { className: 'text-[10px] text-slate-500 mt-1' }, 'لأفضل نتيجة: صوّر الورقة كاملة، بإضاءة جيدة، وبدون قصّ الأعمدة أو الأسعار.')
      ),
      h('label', { className: 'cursor-pointer inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-violet-200 text-violet-700 text-xs font-black shadow-sm' },
        h(Upload, { className: 'w-4 h-4' }),
        'إرفاق صورة',
        h('input', { type: 'file', accept: 'image/*', multiple: true, className: 'hidden', onChange: (event) => {
          const all = Array.from(event.target.files || []);
          const picked = all.filter((file) => String(file?.type || '').toLowerCase().startsWith('image/') || /\.(?:jpe?g|png|webp|gif|bmp)$/i.test(String(file?.name || '')));
          setFiles(picked.slice(0, 8));
          if (picked.length < all.length) app.showToast?.('المسموح فقط صور الفاتورة', 'warning');
          if (picked.length > 8) app.showToast?.('يمكن تحليل حتى 8 صور في المرة الواحدة', 'warning');
          event.target.value = '';
        } })
      )
    ),
    previews.length ? h('div', { className: 'grid grid-cols-3 sm:grid-cols-6 gap-2' }, ...previews.map((item, index) =>
      h('div', { key: index, className: 'relative' },
        h('img', { src: item.url, alt: `صورة الفاتورة ${index + 1}`, className: 'w-full aspect-square object-cover rounded-xl border bg-white' }),
        h('button', { type: 'button', onClick: () => setFiles((prev) => prev.filter((_, idx) => idx !== index)), className: 'absolute top-1 left-1 w-6 h-6 rounded-full bg-slate-900/80 text-white flex items-center justify-center', title: 'حذف الصورة' }, h(X, { className: 'w-3.5 h-3.5' }))
      )
    )) : null,
    files.length ? h('button', { type: 'button', disabled: busy, onClick: analyze, className: 'w-full sm:w-auto px-5 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black flex items-center justify-center gap-2 disabled:opacity-50' },
      busy ? h(LoaderCircle, { className: 'w-4 h-4 animate-spin' }) : h(Sparkles, { className: 'w-4 h-4' }),
      busy ? 'جاري قراءة الصورة بدقة...' : 'قراءة الصورة وتعبئة الفاتورة'
    ) : null
  );

  const resultBlock = raw ? h(React.Fragment, null,
    h('div', { className: 'grid grid-cols-2 md:grid-cols-4 gap-2' },
      summaryCard('المورد المقروء', raw?.supplier?.name || 'غير واضح'),
      summaryCard('رقم فاتورة المورد', raw?.invoiceNumber || '-', true),
      summaryCard('التاريخ', raw?.date || '-'),
      summaryCard('الإجمالي المقروء', n(raw?.grandTotal || recognizedTotal).toFixed(2), true)
    ),
    h('div', { className: 'p-3 rounded-2xl border' },
      h('label', { className: 'text-[11px] font-bold block mb-1' }, 'مطابقة المورد'),
      h('select', { value: supplierMatch, onChange: (event) => setSupplierMatch(event.target.value), className: 'w-full px-3 py-2.5 border rounded-xl text-xs bg-white' },
        h('option', { value: '' }, raw?.supplier?.name ? `إنشاء مورد جديد باسم: ${raw.supplier.name}` : 'اختر المورد'),
        ...suppliers.map((supplier) => h('option', { key: supplier.id, value: supplier.id }, supplier.name))
      )
    ),
    h('div', { className: 'md:hidden space-y-3' }, ...lines.map(renderMobileLine)),
    h('div', { className: 'hidden md:block overflow-x-auto border rounded-2xl' },
      h('table', { className: 'w-full min-w-[980px] text-xs text-right' },
        h('thead', null,
          h('tr', { className: 'bg-slate-50 text-slate-500 border-b' },
            ...['المقروء', 'مطابقة الصنف', 'الوحدة', 'الكمية', 'سعر الوحدة', 'إجمالي السطر', 'الحالة'].map((label, index) => h('th', { key: index, className: 'p-2.5' }, label))
          )
        ),
        h('tbody', null, ...lines.map(renderDesktopRow))
      )
    ),
    Array.isArray(raw?.warnings) && raw.warnings.length ? h('div', { className: 'rounded-xl bg-amber-50 border border-amber-200 p-3' },
      h('div', { className: 'font-black text-xs text-amber-800 mb-1' }, 'ملاحظات القراءة'),
      ...raw.warnings.map((warning, index) => h('div', { key: index, className: 'text-[11px] text-amber-700' }, `• ${warning}`))
    ) : null
  ) : null;

  return h('div', { className: 'oscar-ai-overlay oscar-purchase-ai-overlay fixed z-[2147483000] bg-black/65 backdrop-blur-[3px] flex justify-center', onClick: onClose },
    h('section', { onClick: (event) => event.stopPropagation(), className: 'oscar-ai-panel oscar-purchase-ai-panel w-full max-w-5xl bg-white shadow-2xl overflow-hidden flex flex-col text-right' },
      h('header', { className: 'shrink-0 p-3 sm:p-4 border-b flex items-center justify-between gap-3' },
        h('div', { className: 'flex items-center gap-2 min-w-0' },
          h('div', { className: 'w-10 h-10 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0' }, h(ScanLine, { className: 'w-5 h-5' })),
          h('div', { className: 'min-w-0' },
            h('div', { className: 'font-black text-sm truncate' }, 'تعبئة فاتورة المشتريات بالذكاء الاصطناعي'),
            h('div', { className: 'text-[10px] text-slate-500' }, 'قراءة احترافية من صور الفواتير فقط')
          )
        ),
        h('button', { type: 'button', onClick: onClose, title: t("إغلاق"), className: 'w-9 h-9 rounded-xl bg-slate-900 text-white shadow flex items-center justify-center hover:bg-slate-700' }, h(X, { className: 'w-5 h-5 stroke-[3]' }))
      ),
      h('div', { className: 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-5 space-y-4' },
        uploadBlock,
        error ? h('div', { className: 'rounded-xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 text-xs flex gap-2' }, h(AlertTriangle, { className: 'w-4 h-4 shrink-0' }), h('span', null, error)) : null,
        resultBlock
      ),
      h('footer', { className: 'shrink-0 p-3 border-t bg-white flex items-center justify-between gap-2' },
        h('div', { className: 'text-[10px] text-slate-400' }, raw ? `${lines.length} سطر • ${unmatched.length} بحاجة مراجعة` : 'لن يتم حفظ أي شيء قبل مراجعتك.'),
        h('div', { className: 'flex gap-2' },
          h('button', { type: 'button', onClick: onClose, className: 'px-3 sm:px-4 py-2 rounded-xl border text-xs font-bold' }, t("إلغاء")),
          h('button', { type: 'button', disabled: !raw || busy, onClick: apply, className: 'px-4 sm:px-5 py-2 rounded-xl bg-violet-600 text-white text-xs font-black disabled:opacity-40' }, 'تعبئة الفاتورة')
        )
      )
    )
  );
};
