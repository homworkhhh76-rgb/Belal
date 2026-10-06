import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { Trash2, Plus, Minus, CreditCard, User, UserPlus, ChevronDown, LayoutGrid, Search, PauseCircle, Clock, ShoppingBag, X } from 'lucide-react';

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
  return h('div', { className: 'inline-flex items-center gap-1' },
    h('input', {
      type: 'text', inputMode: 'decimal', dir: 'ltr', value: text,
      onFocus: (e) => e.currentTarget.select(), onChange: (e) => setText(e.target.value), onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur(); } },
      title: scaleMode ? 'في وضع الميزان: اكتب المبلغ المطلوب وسيتم حساب الكمية تلقائياً' : 'تعديل سعر البيع لهذا السطر فقط',
      className: 'w-24 px-2 py-1.5 text-center font-mono font-black rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-violet-500',
    }),
    h('span', { className: 'text-[10px] text-slate-400' }, currency)
  );
};

export const FullCartView = ({ onOpenPayment, onToggleLayout }) => {
  const {
    cart, customers, selectedCustomer, setSelectedCustomer, saveCustomer,
    updateCartItemUnit, updateCartItemQuantity, updateCartItemPrice, updateCartItemScaleAmount,
    removeFromCart, clearCart, holdCurrentInvoice, heldInvoices, setShowHoldInvoicesModal,
    settings, products, addToCart,
    invoiceDiscountType, setInvoiceDiscountType, invoiceDiscountValue, setInvoiceDiscountValue, invoiceAdditionalCharges,
  } = useApp();
  const [activeUnitDropdown, setActiveUnitDropdown] = useState(null);
  const [unitMenuPos, setUnitMenuPos] = useState(null);
  const [quickProductSearch, setQuickProductSearch] = useState('');
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');

  useEffect(() => {
    if (!activeUnitDropdown) return;
    const closeOutside = (e) => {
      const holder = e.target?.closest?.('[data-full-cart-unit-menu]');
      if (!holder || holder.getAttribute('data-full-cart-unit-menu') !== activeUnitDropdown) { setActiveUnitDropdown(null); setUnitMenuPos(null); }
    };
    const esc = (e) => { if (e.key === 'Escape') { setActiveUnitDropdown(null); setUnitMenuPos(null); } };
    const closeOnScroll = () => { setActiveUnitDropdown(null); setUnitMenuPos(null); };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', esc);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => { document.removeEventListener('pointerdown', closeOutside, true); document.removeEventListener('keydown', esc); document.removeEventListener('scroll', closeOnScroll, true); };
  }, [activeUnitDropdown]);

  const subtotal = cart.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const beforeInvoiceDiscount=subtotal+cart.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.unitPrice||0)*(Number(i.taxRate)||0)/100,0);
  const rawDiscount = Number(invoiceDiscountValue) || 0;
  const invoiceDiscountAmount = invoiceDiscountType === 'percent'
    ? Math.min(beforeInvoiceDiscount, beforeInvoiceDiscount * Math.max(0, Math.min(100, rawDiscount)) / 100)
    : Math.min(beforeInvoiceDiscount, Math.max(0, rawDiscount));
  const rawGrandTotal = Math.max(0, beforeInvoiceDiscount - invoiceDiscountAmount) + Math.max(0,Number(invoiceAdditionalCharges)||0);
  const grandTotal = settings.scaleModeEnabled ? Math.round(rawGrandTotal) : rawGrandTotal;
  const totalItemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const q = quickProductSearch.trim().toLowerCase();
  const quickProducts = q
    ? products.filter((p) => !p.deletedAt && p.status !== 'archived' && (
        String(p.name || '').toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q) ||
        (p.units || []).some((u) => (u.barcodes || []).some((b) => String(b).includes(q)))
      )).slice(0, 8)
    : [];

  const hasSelectedCustomerInList = !!selectedCustomer?.id && (selectedCustomer.id === 'cust-walkin' || customers.some((c) => String(c.id) === String(selectedCustomer.id)));
  const customerOptions = [
    { id:'cust-walkin', label:t("عميل نقدي"), subLabel:'الافتراضي للبيع النقدي المباشر' },
    ...(!hasSelectedCustomerInList && selectedCustomer?.name ? [{ id:selectedCustomer.id, label:selectedCustomer.name, subLabel:'عميل طلب المطعم' }] : []),
    ...[...customers].filter((c)=>c && c.id!=='cust-walkin' && !c.deletedAt).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ar')).map((c)=>({ id:c.id, label:c.name, subLabel:c.phone || undefined, badge:c.balance > 0 ? `دين: ${c.balance}` : undefined }))
  ];

  const addQuickCustomer = async (e) => {
    e.preventDefault();
    if (!quickName.trim()) return;
    const customer = { id:`cust-${Date.now()}`, name:quickName.trim(), phone:quickPhone.trim(), balance:0, creditLimit:1000, priceList:'retail', createdAt:new Date().toISOString() };
    await saveCustomer(customer);
    setSelectedCustomer(customer);
    setQuickName(''); setQuickPhone(''); setShowQuickCustomer(false);
  };

  const view = h('div', { id: 'full-page-cart-view', className: 'w-full min-w-0 flex-1 flex flex-col h-full min-h-0 bg-slate-100 dark:bg-slate-950 overflow-hidden select-none' },
    h('div', { className: 'bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-3 shadow-xs shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-3' },
      h('div', { className: 'flex items-center gap-3' },
        h('div', { className: 'p-2 rounded-xl bg-violet-50 dark:bg-violet-950/50 text-violet-600' }, h(ShoppingBag, { className: 'w-5 h-5' })),
        h('div', null, h('div', { className: 'flex items-center gap-2' },
          h('h2', { className: 'text-base font-black text-slate-900 dark:text-white' }, 'سلة المبيعات'),
          h('span', { className: 'px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 font-bold text-[11px]' }, `${cart.length} أصناف (${totalItemCount} قطعة)`)
        ))
      ),
      h('div', { className: 'relative flex-1 max-w-sm' },
        h(Search, { className: 'absolute right-3 top-2.5 w-4 h-4 text-slate-400 pointer-events-none' }),
        h('input', { type: 'text', value: quickProductSearch, onChange: (e) => setQuickProductSearch(e.target.value), placeholder: 'إضافة صنف سريع للسلة...', className: 'w-full pr-9 pl-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-violet-500' }),
        quickProducts.length > 0 && h('div', { className: 'absolute top-full right-0 left-0 mt-1 z-40 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 max-h-48 overflow-y-auto' },
          ...quickProducts.map((p) => { const unit=(p.units||[]).find((u)=>u.isDefaultSale)||(p.units||[])[0]; if(!unit)return null; return h('button',{key:p.id,type:'button',onClick:()=>{addToCart(p,unit);setQuickProductSearch('');},className:'w-full text-right p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between text-xs'},h('div',null,h('span',{className:'font-bold'},p.name),h('span',{className:'text-[10px] text-slate-400 block font-mono'},(unit.barcodes||[])[0]||p.sku||'')),h('span',{className:'font-bold font-mono text-violet-600'},`${unit.salePrice} ${settings.currencySymbol}`)); })
        )
      ),
      h('div', { className: 'flex items-center gap-2 min-w-0' },
        h('div', { className: 'w-56 max-w-[55vw]' }, h(SearchableDropdown, { id:'full-cart-customer-select', options:customerOptions, selectedId:selectedCustomer?.id, onSelect:(id)=>{if(id==='cust-walkin')setSelectedCustomer({id:'cust-walkin',name:'عميل نقدي',balance:0,priceList:'retail',isVirtual:true});else{const found=customers.find((c)=>c.id===id)||(String(selectedCustomer?.id)===String(id)?selectedCustomer:null);if(found)setSelectedCustomer(found);}}, icon:h(User,{className:'w-4 h-4'}), placeholder:'اختر العميل...' })),
        h('button',{type:'button',onClick:()=>setShowQuickCustomer(true),className:'shrink-0 w-9 h-9 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 flex items-center justify-center hover:bg-violet-100',title:'إضافة عميل جديد'},h(UserPlus,{className:'w-4 h-4'})),
        h('button', { type: 'button', onClick: onToggleLayout, className: 'flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold' }, h(LayoutGrid, { className: 'w-4 h-4 text-violet-600' }), h('span', { className: 'hidden sm:inline' }, 'عرض مقسم'))
      )
    ),
    h('div', { className: 'flex-1 min-h-0 p-2 sm:p-3 overflow-hidden flex flex-col' },
      h('div', { className: 'w-full min-w-0 flex-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col overflow-hidden' },
        cart.length === 0
          ? h('div', { className: 'flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-400' }, h('div', { className: 'w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3' }, h(ShoppingBag, { className: 'w-8 h-8 text-slate-300' })), h('h3', { className: 'text-base font-bold text-slate-700 dark:text-slate-300' }, 'السلة فارغة حالياً'))
          : h('div', { className: 'w-full min-w-0 flex-1 overflow-auto custom-scrollbar' },
              h('table', { className: 'w-full text-right text-xs whitespace-nowrap min-w-[760px] xl:min-w-0 table-auto' },
                h('thead', { className: 'sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/90 border-b text-slate-600 dark:text-slate-300 font-bold' }, h('tr', null,
                  h('th',{className:'py-2.5 px-3 w-10 text-center'},'#'),h('th',{className:'py-2.5 px-3'},t("اسم الصنف")),h('th',{className:'py-2.5 px-3'},t("الباركود")),h('th',{className:'py-2.5 px-3'},t("الوحدة")),h('th',{className:'py-2.5 px-3 text-center'},t("الكمية")),h('th',{className:'py-2.5 px-3'},settings.scaleModeEnabled?'مبلغ السطر':'سعر البيع'),h('th',{className:'py-2.5 px-3'},t("الإجمالي")),h('th',{className:'py-2.5 px-3 w-12'},'')
                )),
                h('tbody', null, ...cart.map((item, idx) => {
                  const key=`${item.productId}-${item.unitId}`; const activeUnit=(item.availableUnits||[]).find((u)=>u.id===item.unitId); const barcode=(activeUnit?.barcodes||[])[0]||'-'; const lineTotal=Number(item.quantity||0)*Number(item.unitPrice||0); const editableValue=settings.scaleModeEnabled?lineTotal:item.unitPrice;
                  return h('tr',{key,className:'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30'},
                    h('td',{className:'py-2 px-3 text-center text-slate-400 font-mono'},idx+1),
                    h('td',{className:'py-2 px-3 font-bold text-slate-900 dark:text-white max-w-[260px] truncate'},item.productName),
                    h('td',{className:'py-2 px-3 font-mono text-[11px] text-slate-500'},barcode),
                    h('td',{className:'py-2 px-3'},h('div',{className:'relative inline-block','data-full-cart-unit-menu':key},
                      h('button',{type:'button',onPointerDown:(e)=>e.stopPropagation(),onClick:(e)=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();const menuW=Math.max(180,Math.min(260,r.width+70));const menuH=Math.min(260,52+((item.availableUnits||[]).length*42));const below=window.innerHeight-r.bottom-8;const openUp=below<menuH&&r.top>below;const left=Math.min(Math.max(8,r.right-menuW),Math.max(8,window.innerWidth-menuW-8));const top=openUp?Math.max(8,r.top-menuH-6):Math.min(window.innerHeight-menuH-8,r.bottom+6);setUnitMenuPos({top,left,width:menuW});setActiveUnitDropdown((v)=>v===key?null:key);},className:'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/60 border border-violet-200 dark:border-violet-800 text-violet-800 dark:text-violet-300 font-bold text-xs'},h('span',null,item.unitName),h(ChevronDown,{className:'w-3.5 h-3.5'}))
                    )),
                    h('td',{className:'py-2 px-3 text-center'},h('div',{className:'inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border rounded-xl p-1'},h('button',{type:'button',onClick:()=>updateCartItemQuantity(item.productId,item.unitId,item.quantity-1),className:'w-7 h-7 flex items-center justify-center rounded-lg bg-white dark:bg-slate-900'},h(Minus,{className:'w-3.5 h-3.5'})),h('input',{type:'number',step:'any',min:'0.001',value:item.quantity,onChange:(e)=>updateCartItemQuantity(item.productId,item.unitId,parseFloat(e.target.value)||0.001),className:'w-14 text-center text-sm font-black font-mono bg-transparent focus:outline-none'}),h('button',{type:'button',onClick:()=>updateCartItemQuantity(item.productId,item.unitId,item.quantity+1),className:'w-7 h-7 flex items-center justify-center rounded-lg bg-white dark:bg-slate-900'},h(Plus,{className:'w-3.5 h-3.5'})))),
                    h('td',{className:'py-2 px-3'},h(EditablePrice,{value:editableValue,currency:settings.currencySymbol,scaleMode:!!settings.scaleModeEnabled,onCommit:(n)=>settings.scaleModeEnabled?updateCartItemScaleAmount(item.productId,item.unitId,n):updateCartItemPrice(item.productId,item.unitId,n)})),
                    h('td',{className:'py-2 px-3 font-mono font-black text-base text-violet-600'},`${lineTotal.toFixed(2)} ${settings.currencySymbol}`),
                    h('td',{className:'py-2 px-3 text-center'},h('button',{type:'button',onClick:()=>removeFromCart(item.productId,item.unitId),className:'p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50'},h(Trash2,{className:'w-4 h-4'})))
                  );
                }))
              )
            )
      )
    ),
    h('div', { className: 'full-cart-checkout-dock bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-3 sm:px-6 shadow-lg shrink-0 select-none' },
      h('div', { className: 'max-w-7xl mx-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3' },
        h('div', { className: 'flex flex-wrap items-center gap-4 sm:gap-6 text-xs' },
          h('div', null, h('span', { className: 'text-slate-400 block text-[10px]' }, 'إجمالي الأصناف:'), h('span', { className: 'font-bold text-sm font-mono' }, `${subtotal.toFixed(2)} ${settings.currencySymbol}`)),
          h('div', { className: 'pr-4 border-r border-slate-200 dark:border-slate-700' }, h('span', { className: 'text-violet-600 font-bold block text-xs' }, settings.scaleModeEnabled?'الصافي المقرب المطلوب:':'الصافي النهائي المطلوب:'), h('span', { className: 'font-black text-2xl text-violet-600 font-mono' }, `${grandTotal.toFixed(2)} ${settings.currencySymbol}`))
        ),
        h('div', { id: 'full-cart-invoice-discount', className: 'flex items-center gap-1.5 flex-wrap rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-2 py-1.5' },
          h('span', { className: 'text-[10px] font-bold text-slate-500' }, t("خصم الفاتورة")),
          h('div', { className: 'inline-flex rounded-lg overflow-hidden border border-slate-200' }, h('button', { type:'button', onClick:()=>setInvoiceDiscountType('fixed'), className:`px-2 py-1 text-[10px] font-bold ${invoiceDiscountType==='fixed'?'bg-violet-600 text-white':'bg-white text-slate-600'}` }, 'مبلغ'), h('button', { type:'button', onClick:()=>setInvoiceDiscountType('percent'), className:`px-2 py-1 text-[10px] font-bold ${invoiceDiscountType==='percent'?'bg-violet-600 text-white':'bg-white text-slate-600'}` }, '%')),
          h('input',{type:'text',inputMode:'decimal',dir:'ltr',value:invoiceDiscountValue??'',onFocus:(e)=>e.currentTarget.select(),onChange:(e)=>setInvoiceDiscountValue(e.target.value.replace(/[٠-٩]/g,(d)=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫،]/g,'.').replace(/[^0-9.]/g,'')),className:'w-16 px-2 py-1 text-[11px] font-mono font-bold border rounded-lg bg-white'}),
          h('span',{className:'text-[10px] font-bold text-rose-600'},`-${invoiceDiscountAmount.toFixed(2)} ${settings.currencySymbol}`)
        ),
        h('div',{className:'flex flex-wrap items-center gap-2'},
          h('button',{type:'button',disabled:cart.length===0,onClick:clearCart,className:'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 text-rose-700 text-[11px] font-bold disabled:opacity-40 whitespace-nowrap shrink-0'},h(Trash2,{className:'w-4 h-4 shrink-0'}),h('span',{className:'leading-none'},'تفريغ السلة')),
          h('button',{type:'button',disabled:cart.length===0,onClick:()=>holdCurrentInvoice(),className:'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-amber-200 text-amber-700 text-[11px] font-bold disabled:opacity-40 whitespace-nowrap shrink-0'},h(PauseCircle,{className:'w-4 h-4 shrink-0'}),h('span',{className:'leading-none'},'تعليق [F4]')),
          h('button',{type:'button',onClick:()=>setShowHoldInvoicesModal(true),className:'relative inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-[11px] font-bold whitespace-nowrap shrink-0'},h(Clock,{className:'w-4 h-4 shrink-0'}),h('span',{className:'leading-none'},t("المعلقة")),heldInvoices.length>0?h('span',{className:'px-1.5 rounded-full bg-amber-500 text-white text-[9px]'},heldInvoices.length):null),
          h('button',{id:'btn-full-cart-payment','data-enter-primary':'true',type:'button',disabled:cart.length===0,onClick:onOpenPayment,className:'flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-3 rounded-2xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-black text-sm shadow-lg'},h(CreditCard,{className:'w-5 h-5'}),'الدفع الفوري وإصدار الفاتورة [F9]')
        )
      )
    )
  );

  const activeMenuItem = activeUnitDropdown ? cart.find((i)=>`${i.productId}-${i.unitId}`===activeUnitDropdown) : null;
  const unitPortal = activeUnitDropdown&&unitMenuPos&&activeMenuItem&&typeof document!=='undefined' ? createPortal(
    h('div',{'data-full-cart-unit-menu':activeUnitDropdown,onPointerDown:(e)=>e.stopPropagation(),style:{position:'fixed',top:`${unitMenuPos.top}px`,left:`${unitMenuPos.left}px`,width:`${unitMenuPos.width}px`,zIndex:2147483000},className:'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1.5 shadow-2xl max-h-[260px] overflow-y-auto'},
      ...(activeMenuItem.availableUnits||[]).map((u)=>h('button',{key:u.id,type:'button',onClick:()=>{setActiveUnitDropdown(null);setUnitMenuPos(null);updateCartItemUnit(activeMenuItem.productId,activeMenuItem.unitId,u.id);},className:`w-full text-right px-3 py-2 text-xs rounded-lg flex items-center justify-between gap-3 ${u.id===activeMenuItem.unitId?'bg-violet-600 text-white font-bold':'text-slate-700 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'}`},h('span',{className:'truncate'},u.name),h('span',{className:'text-[10px] font-mono opacity-80 shrink-0'},`${u.salePrice} ${settings.currencySymbol}`)))
    ),document.body) : null;
  const customerPortal = showQuickCustomer&&typeof document!=='undefined' ? createPortal(
    h('div',{className:'fixed inset-0 p-4 flex items-center justify-center',style:{zIndex:2147483500,background:'rgba(15,23,42,.55)'},onPointerDown:(e)=>{if(e.target===e.currentTarget)setShowQuickCustomer(false);}},
      h('form',{onSubmit:addQuickCustomer,className:'w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-4 space-y-3 text-right'},
        h('div',{className:'flex items-center justify-between'},h('h3',{className:'font-black text-sm'},'إضافة عميل سريع'),h('button',{type:'button',onClick:()=>setShowQuickCustomer(false),className:'p-1 text-slate-400'},h(X,{className:'w-5 h-5'}))),
        h('input',{required:true,value:quickName,onChange:(e)=>setQuickName(e.target.value),placeholder:t("اسم العميل *"),autoFocus:false,className:'w-full px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'}),
        h('input',{value:quickPhone,onChange:(e)=>setQuickPhone(e.target.value),placeholder:t("رقم الهاتف"),autoFocus:false,className:'w-full px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'}),
        h('button',{type:'submit',className:'w-full py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black'},'حفظ واختيار العميل')
      )
    ),document.body) : null;

  return h(React.Fragment,null,view,unitPortal,customerPortal);
};
