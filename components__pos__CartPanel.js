import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { Trash2, Plus, Minus, PauseCircle, CreditCard, User, UserPlus, Tag, ChevronDown, Clock, X } from 'lucide-react';

const h = React.createElement;

const EditablePrice = ({ value, onCommit, currency, scaleMode=false }) => {
  const [text, setText] = useState(String(Number(value || 0).toFixed(2)));
  useEffect(() => setText(String(Number(value || 0).toFixed(2))), [value]);
  const commit = () => {
    const normalized = String(text).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫،]/g, '.');
    const n = Number(normalized);
    if (Number.isFinite(n) && n >= 0) onCommit(n);
    else setText(String(Number(value || 0).toFixed(2)));
  };
  return h('label', { className: 'flex items-center gap-1 text-[10px] text-slate-500 font-bold' },
    h('span', null, scaleMode ? t("المبلغ") : t("السعر")),
    h('input', {
      type: 'text', inputMode: 'decimal', dir: 'ltr', value: text,
      onFocus: (e) => e.currentTarget.select(),
      onChange: (e) => setText(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } },
      className: 'w-20 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center text-[11px] font-mono font-black text-slate-900 dark:text-white focus:outline-none focus:border-violet-500',
    }),
    h('span', { className: 'text-[9px] text-slate-400' }, currency)
  );
};

const CartPanelImpl = ({ onOpenPayment }) => {
  const {
    cart, customers, selectedCustomer, setSelectedCustomer, saveCustomer,
    updateCartItemUnit, updateCartItemQuantity, updateCartItemPrice, updateCartItemScaleAmount,
    removeFromCart, clearCart, holdCurrentInvoice, heldInvoices, setShowHoldInvoicesModal,
    settings, invoiceDiscountType, setInvoiceDiscountType, invoiceDiscountValue, setInvoiceDiscountValue, invoiceAdditionalCharges,
  } = useApp();
  const [activeUnitDropdown, setActiveUnitDropdown] = useState(null);
  const [unitMenuPos, setUnitMenuPos] = useState(null);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    if (!activeUnitDropdown) return;
    const closeOutside = (e) => {
      const holder = e.target?.closest?.('[data-cart-unit-menu]');
      if (!holder || holder.getAttribute('data-cart-unit-menu') !== activeUnitDropdown) { setActiveUnitDropdown(null); setUnitMenuPos(null); }
    };
    const esc = (e) => { if (e.key === 'Escape') { setActiveUnitDropdown(null); setUnitMenuPos(null); } };
    const closeOnScroll = () => { setActiveUnitDropdown(null); setUnitMenuPos(null); };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', esc);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('pointerdown', closeOutside, true); document.removeEventListener('keydown', esc); document.removeEventListener('scroll', closeOnScroll, true); };
  }, [activeUnitDropdown]);

  const subtotal = cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const beforeInvoiceDiscount = Math.max(0, subtotal + cart.reduce((s,i)=>s + Number(i.quantity||0)*Number(i.unitPrice||0)*(Number(i.taxRate)||0)/100,0));
  const rawDiscount = Number(invoiceDiscountValue) || 0;
  const invoiceDiscountAmount = invoiceDiscountType === 'percent'
    ? Math.min(beforeInvoiceDiscount, beforeInvoiceDiscount * Math.max(0, Math.min(100, rawDiscount)) / 100)
    : Math.min(beforeInvoiceDiscount, Math.max(0, rawDiscount));
  const rawGrandTotal = Math.max(0, beforeInvoiceDiscount - invoiceDiscountAmount) + Math.max(0,Number(invoiceAdditionalCharges)||0);
  const grandTotal = settings.scaleModeEnabled ? Math.round(rawGrandTotal) : rawGrandTotal;

  const customerOptions = useMemo(() => {
    const hasSelectedCustomerInList = !!selectedCustomer?.id && (selectedCustomer.id === 'cust-walkin' || customers.some((c) => String(c.id) === String(selectedCustomer.id)));
    return [
      { id: 'cust-walkin', label: t("عميل نقدي"), subLabel: 'الافتراضي للبيع النقدي المباشر' },
      ...(!hasSelectedCustomerInList && selectedCustomer?.name ? [{ id:selectedCustomer.id, label:selectedCustomer.name, subLabel:'عميل طلب المطعم' }] : []),
      ...[...customers]
        .filter((c) => c && c.id !== 'cust-walkin' && !c.deletedAt)
        .sort((a,b) => String(a.name||'').localeCompare(String(b.name||''),'ar'))
        .map((c) => ({ id:c.id, label:c.name, subLabel:c.phone || undefined, badge:c.balance > 0 ? `دين: ${c.balance} ${settings.currencySymbol}` : undefined }))
    ];
  }, [customers, selectedCustomer?.id, selectedCustomer?.name, settings.currencySymbol]);

  const addQuickCustomer = async (e) => {
    e.preventDefault();
    if (!quickName.trim()) return;
    const customer = { id:`cust-${Date.now()}`, name:quickName.trim(), phone:quickPhone.trim(), balance:0, creditLimit:1000, priceList:'retail', createdAt:new Date().toISOString() };
    await saveCustomer(customer);
    setSelectedCustomer(customer);
    setQuickName(''); setQuickPhone(''); setShowQuickCustomer(false);
  };

  const panel = h('div', { id: 'pos-cart-panel', ref: rootRef, className: 'flex flex-col h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 text-right select-none shadow-xs' },
    h('div', { className: 'p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30' },
      h('div', { className: 'flex items-center gap-1.5' },
        h('div', { className: 'flex-1 min-w-0' }, h(SearchableDropdown, {
          id: 'cart-customer-select', options: customerOptions, selectedId: selectedCustomer?.id,
          onSelect: (id) => { if (id === 'cust-walkin') setSelectedCustomer({ id:'cust-walkin', name:'عميل نقدي', balance:0, priceList:'retail', isVirtual:true }); else { const found = customers.find((c) => c.id === id) || (String(selectedCustomer?.id) === String(id) ? selectedCustomer : null); if (found) setSelectedCustomer(found); } },
          icon: h(User, { className: 'w-4 h-4' }), placeholder: 'اختر العميل...',
        })),
        h('button', { type:'button', onClick:()=>setShowQuickCustomer(true), className:'shrink-0 w-9 h-9 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 flex items-center justify-center hover:bg-violet-100', title:'إضافة عميل جديد' }, h(UserPlus,{className:'w-4.5 h-4.5'}))
      )
    ),
    h('div', { className: 'flex-1 overflow-y-auto p-1.5 space-y-1.5 custom-scrollbar' },
      cart.length === 0
        ? h('div', { className: 'h-full flex flex-col items-center justify-center text-center p-6 text-slate-400' },
            h('div', { className: 'w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-2' }, h(Tag, { className: 'w-5 h-5 text-slate-300' })),
            h('p', { className: 'text-sm font-bold text-slate-600 dark:text-slate-400' }, 'السلة فارغة')
          )
        : cart.map((item) => {
            const key = `${item.productId}-${item.unitId}`;
            const lineTotal = Number(item.quantity || 0) * Number(item.unitPrice || 0);
            const editableValue = settings.scaleModeEnabled ? lineTotal : item.unitPrice;
            return h('div', { key, className: 'p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40' },
              h('div', { className: 'flex items-center justify-between gap-2' },
                h('div', { className: 'font-bold text-[11px] leading-5 text-slate-900 dark:text-white truncate flex-1' }, item.productName),
                h('button', { type: 'button', onClick: () => removeFromCart(item.productId, item.unitId), className: 'p-1 rounded text-slate-400 hover:text-rose-500' }, h(Trash2, { className: 'w-3.5 h-3.5' }))
              ),
              h('div', { className: 'flex items-center justify-between gap-2 mt-1' },
                h('div', { className: 'relative', 'data-cart-unit-menu': key },
                  h('button', { type: 'button', onPointerDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); const menuW=Math.max(170,Math.min(240,r.width+80)); const menuH=Math.min(240,50+((item.availableUnits||[]).length*40)); const below=window.innerHeight-r.bottom-8; const openUp=below<menuH&&r.top>below; const left=Math.min(Math.max(8,r.right-menuW),Math.max(8,window.innerWidth-menuW-8)); const top=openUp?Math.max(8,r.top-menuH-6):Math.min(window.innerHeight-menuH-8,r.bottom+6); setUnitMenuPos({top,left,width:menuW}); setActiveUnitDropdown((v) => v === key ? null : key); }, className: 'flex items-center gap-1 px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/60 border border-violet-200 dark:border-violet-800 text-violet-800 dark:text-violet-300 font-bold text-[10px]' },
                    h('span', null, item.unitName), h(ChevronDown, { className: 'w-3 h-3 text-violet-600' })
                  )
                ),
                h(EditablePrice, { value: editableValue, currency: settings.currencySymbol, scaleMode: !!settings.scaleModeEnabled, onCommit: (n) => settings.scaleModeEnabled ? updateCartItemScaleAmount(item.productId, item.unitId, n) : updateCartItemPrice(item.productId, item.unitId, n) })
              ),
              h('div', { className: 'flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60' },
                h('div', { className: 'flex items-center gap-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5' },
                  h('button', { type: 'button', onClick: () => updateCartItemQuantity(item.productId, item.unitId, item.quantity - 1), className: 'p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800' }, h(Minus, { className: 'w-3 h-3' })),
                  h('input', { type: 'number', step: 'any', min: '0.001', value: item.quantity, onChange: (e) => updateCartItemQuantity(item.productId, item.unitId, parseFloat(e.target.value) || 0.001), className: 'w-11 text-center text-xs font-bold font-mono bg-transparent focus:outline-none' }),
                  h('button', { type: 'button', onClick: () => updateCartItemQuantity(item.productId, item.unitId, item.quantity + 1), className: 'p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800' }, h(Plus, { className: 'w-3 h-3' }))
                ),
                h('div', { className: 'text-sm font-black text-violet-600 dark:text-violet-400 font-mono' }, `${lineTotal.toFixed(2)} ${settings.currencySymbol}`)
              )
            );
          })
    ),
    h('div', { className: 'cart-checkout-dock p-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-800/95 space-y-2 shrink-0' },
      h('div', { className: 'flex items-center gap-1.5 flex-wrap rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1.5' },
        h('span', { className: 'text-[10px] font-bold text-slate-500' }, t("خصم الفاتورة")),
        h('div', { className: 'inline-flex rounded-lg overflow-hidden border border-slate-200' },
          h('button', { type: 'button', onClick: () => setInvoiceDiscountType('fixed'), className: `px-2 py-1 text-[10px] font-bold ${invoiceDiscountType === 'fixed' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600'}` }, 'مبلغ'),
          h('button', { type: 'button', onClick: () => setInvoiceDiscountType('percent'), className: `px-2 py-1 text-[10px] font-bold ${invoiceDiscountType === 'percent' ? 'bg-violet-600 text-white' : 'bg-white text-slate-600'}` }, '%')
        ),
        h('input', { type: 'text', inputMode: 'decimal', dir: 'ltr', value: invoiceDiscountValue ?? '', onFocus: (e) => e.currentTarget.select(), onChange: (e) => setInvoiceDiscountValue(e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫،]/g, '.').replace(/[^0-9.]/g, '')), className: 'w-16 px-2 py-1 text-[11px] font-mono font-bold border rounded-lg bg-white' }),
        h('span', { className: 'text-[10px] font-bold text-rose-600' }, `-${invoiceDiscountAmount.toFixed(2)} ${settings.currencySymbol}`)
      ),
      h('div', { className: 'space-y-1 text-xs' },
        h('div', { className: 'flex justify-between text-slate-600 dark:text-slate-400' }, h('span', null, t("المجموع:")), h('span', { className: 'font-mono font-bold' }, `${subtotal.toFixed(2)} ${settings.currencySymbol}`)),
        h('div', { className: 'flex justify-between text-base font-black pt-1 border-t border-slate-200 dark:border-slate-700' }, h('span', null, settings.scaleModeEnabled ? 'الصافي المقرب:' : 'الصافي:'), h('span', { className: 'text-violet-600 font-mono' }, `${grandTotal.toFixed(2)} ${settings.currencySymbol}`))
      ),
      h('button', { id: 'btn-checkout', 'data-enter-primary':'true', disabled: cart.length === 0, onClick: onOpenPayment, className: 'w-full py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-black text-sm flex items-center justify-center gap-2 shadow-md' },
        h(CreditCard, { className: 'w-5 h-5' }), h('span', null, 'الدفع الفوري [F9]')
      ),
      h('div', { className: 'grid grid-cols-3 gap-1.5' },
        h('button', { disabled: cart.length === 0, onClick: () => holdCurrentInvoice(), className: 'py-1.5 px-2 rounded-lg bg-slate-200 text-[11px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0' }, h(PauseCircle, { className: 'w-3.5 h-3.5 shrink-0 text-amber-500' }), h('span', { className: 'leading-none' }, t("تعليق"))),
        h('button', { onClick: () => setShowHoldInvoicesModal(true), className: 'relative py-1.5 px-2 rounded-lg bg-slate-200 text-[11px] font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0' }, h(Clock, { className: 'w-3.5 h-3.5 shrink-0 text-slate-500' }), h('span', { className: 'leading-none' }, t("المعلقة")), heldInvoices.length > 0 ? h('span', { className: 'mr-1 px-1.5 rounded-full bg-amber-500 text-white text-[9px]' }, heldInvoices.length) : null),
        h('button', { disabled: cart.length === 0, onClick: clearCart, className: 'py-1.5 px-2 rounded-lg bg-rose-100 text-rose-700 text-[11px] font-bold disabled:opacity-40 inline-flex items-center justify-center gap-1.5 whitespace-nowrap min-w-0' }, h(Trash2, { className: 'w-3.5 h-3.5 shrink-0' }), h('span', { className: 'leading-none' }, t("تفريغ")))
      )
    )
  );

  const activeMenuItem = activeUnitDropdown ? cart.find((i)=>`${i.productId}-${i.unitId}`===activeUnitDropdown) : null;
  const unitPortal = activeUnitDropdown&&unitMenuPos&&activeMenuItem&&typeof document!=='undefined' ? createPortal(
    h('div',{'data-cart-unit-menu':activeUnitDropdown,onPointerDown:(e)=>e.stopPropagation(),style:{position:'fixed',top:`${unitMenuPos.top}px`,left:`${unitMenuPos.left}px`,width:`${unitMenuPos.width}px`,zIndex:2147483000},className:'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-2xl max-h-[240px] overflow-y-auto'},
      ...(activeMenuItem.availableUnits||[]).map((u)=>h('button',{key:u.id,type:'button',onClick:()=>{setActiveUnitDropdown(null);setUnitMenuPos(null);updateCartItemUnit(activeMenuItem.productId,activeMenuItem.unitId,u.id);},className:`w-full text-right px-3 py-2 text-xs rounded-lg flex items-center justify-between gap-3 ${u.id===activeMenuItem.unitId?'bg-violet-600 text-white font-bold':'text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'}`},h('span',{className:'truncate'},u.name),h('span',{className:'text-[9px] opacity-80 font-mono shrink-0'},`${u.salePrice} ${settings.currencySymbol}`)))
    ),document.body) : null;
  const customerPortal = showQuickCustomer&&typeof document!=='undefined' ? createPortal(
    h(ModalLayer, { className: 'fixed inset-0 p-4 flex items-center justify-center',style:{zIndex:2147483500,background:'rgba(15,23,42,.55)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)'}, onPointerDown:(e)=>{if(e.target===e.currentTarget)setShowQuickCustomer(false);} },
      h('form', { onSubmit:addQuickCustomer, className:'w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 space-y-3 text-right' },
        h('div',{className:'flex items-center justify-between'},h('h3',{className:'font-black text-sm'},'إضافة عميل سريع'),h('button',{type:'button',onClick:()=>setShowQuickCustomer(false),className:'p-1 text-slate-400'},h(X,{className:'w-5 h-5'}))),
        h('input',{required:true,value:quickName,onChange:(e)=>setQuickName(e.target.value),placeholder:t("اسم العميل *"),autoFocus:false,className:'w-full px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'}),
        h('input',{value:quickPhone,onChange:(e)=>setQuickPhone(e.target.value),placeholder:t("رقم الهاتف"),autoFocus:false,className:'w-full px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'}),
        h('button',{type:'submit',className:'w-full py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black'},'حفظ واختيار العميل')
      )
    ),document.body) : null;
  return h(React.Fragment, null,panel,unitPortal,customerPortal);
};

export const CartPanel = React.memo(CartPanelImpl);
