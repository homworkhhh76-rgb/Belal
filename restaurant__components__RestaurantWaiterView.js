import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import { Utensils, Search, Plus, Minus, Trash2, Send, Printer, Users, ShoppingBag, ShoppingCart, AlertTriangle, Lock, X, StickyNote, ChevronDown } from 'lucide-react';
import { KitchenTicketModal } from './restaurant__components__KitchenTicketModal.js?v=7.9.4.136-localization';

const h = React.createElement;
const orderNoteText = (notes) => typeof notes === 'string' ? notes : String(notes?.kitchenNotes || notes?.general || '');

export const RestaurantWaiterView = () => {
  const { tables, orders, recipes, createOrder, updateOrder, sendOrderToKitchen, updateOrderItemStatus } = useRestaurant();
  const { products, categories, activeEmployee, currentUser, showToast, settings } = useApp();
  const [orderType, setOrderType] = useState('dine_in');
  const [selectedTableId, setSelectedTableId] = useState(tables.find(t => t.status === 'available')?.id || tables[0]?.id || '');
  const [guestCount, setGuestCount] = useState(2);
  const [customerName, setCustomerName] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [draftItems, setDraftItems] = useState([]);
  const [activeExistingOrder, setActiveExistingOrder] = useState(null);
  const [orderNote, setOrderNote] = useState('');
  const [showTicketModal, setShowTicketModal] = useState(null);
  const [isAdditionTicket, setIsAdditionTicket] = useState(false);
  const [ignoreHydrateTableId, setIgnoreHydrateTableId] = useState('');
  const [cancelModalItem, setCancelModalItem] = useState(null);
  const [cancelReason, setCancelReason] = useState('طلب العميل التراجع');
  const [managerPin, setManagerPin] = useState('');
  const selectedTable = tables.find(t => t.id === selectedTableId);

  useEffect(() => {
    if (!selectedTableId && (tables || []).length) {
      setSelectedTableId(tables.find(t => t.status === 'available')?.id || tables[0].id);
    }
  }, [tables, selectedTableId]);

  useEffect(() => {
    if (orderType === 'dine_in' && selectedTable?.currentOrderId) {
      const existing = orders.find(o => o.id === selectedTable.currentOrderId);
      if (existing && !['paid','cancelled'].includes(existing.status)) {
        setActiveExistingOrder(existing);
        setCustomerName(existing.customerName || '');
        setGuestCount(existing.guestCount || 2);
        if (ignoreHydrateTableId !== selectedTableId) {
          setDraftItems(existing.items || []);
          setOrderNote(orderNoteText(existing.notes));
        }
        return;
      }
    }
    setActiveExistingOrder(null);
    setDraftItems([]);
    setOrderNote('');
    if (orderType === 'dine_in') setCustomerName('');
  }, [selectedTableId, orderType, selectedTable?.currentOrderId, orders, ignoreHydrateTableId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (cancelModalItem) setCancelModalItem(null);
      else if (isCartOpen) setIsCartOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCartOpen, cancelModalItem]);

  const recipeProductIds = useMemo(() => new Set((recipes || []).map(r => r.productId || r.mealProductId).filter(Boolean)), [recipes]);
  const restaurantProducts = useMemo(() => (products || []).filter(p => {
    if (!p || p.deletedAt || p.status === 'archived') return false;
    const channel = String(p.salesChannel || 'both').toLowerCase();
    const rawOnly = ['raw_material','raw','ingredient'].includes(channel) || !!p.isRawMaterialOnly;
    if (rawOnly) return false;
    return ['restaurant','restaurant_only','both'].includes(channel) || p.showInRestaurant === true || p.restaurantEnabled === true || p.availableInRestaurant === true || recipeProductIds.has(p.id);
  }), [products, recipeProductIds]);

  const restaurantCategories = useMemo(() => (categories || []).filter(cat => restaurantProducts.some(p => p.categoryId === cat.id)), [categories, restaurantProducts]);
  const filteredProducts = useMemo(() => restaurantProducts.filter(p => {
    if (selectedCategoryId !== 'all' && p.categoryId !== selectedCategoryId) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || String(p.barcode || '').toLowerCase().includes(q) || (p.units || []).some(u => (u.barcodes || []).some(b => String(b).toLowerCase().includes(q)));
  }), [restaurantProducts, selectedCategoryId, searchTerm]);

  const handleQuickAdd = (product) => {
    const defaultUnit = (product.units || []).find(u => u.isDefaultSale) || (product.units || [])[0];
    const unitId = defaultUnit?.id || 'u-piece';
    const unitName = defaultUnit?.name || product.baseUnitName || 'حبة';
    const conversionFactor = Number(defaultUnit?.conversionToBase) || 1;
    const unitPrice = Number(defaultUnit?.salePrice ?? product.sellingPrice ?? product.salePrice ?? 0) || 0;
    setDraftItems(prev => {
      const idx = prev.findIndex(i => i.status === 'new' && i.productId === product.id && String(i.unitId || unitId) === String(unitId));
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: Number(copy[idx].quantity || 0) + 1 };
        return copy;
      }
      return [...prev, {
        id: 'roi-' + Date.now() + '-' + Math.random().toString(36).slice(2,7),
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitId,
        unitName,
        conversionFactor,
        unitPrice,
        status: 'new'
      }];
    });
  };

  const updateItemUnit = (index, unitId) => {
    setDraftItems(prev => {
      const item = prev[index];
      if (!item || item.status !== 'new') return prev;
      const product = (products || []).find(p => p.id === item.productId);
      const unit = (product?.units || []).find(u => String(u.id) === String(unitId));
      if (!unit) return prev;
      const copy = [...prev];
      copy[index] = {
        ...item,
        unitId: unit.id,
        unitName: unit.name || item.unitName || 'حبة',
        conversionFactor: Number(unit.conversionToBase) || 1,
        unitPrice: Number(unit.salePrice ?? product?.sellingPrice ?? product?.salePrice ?? item.unitPrice ?? 0) || 0,
      };
      return copy;
    });
  };

  const updateItemQty = (index, delta) => {
    setDraftItems(prev => {
      const item = prev[index];
      if (!item) return prev;
      if (item.status !== 'new' && delta < 0) { setCancelModalItem(item); return prev; }
      const next = Number(item.quantity || 0) + delta;
      if (next <= 0) return prev.filter((_,i) => i !== index);
      const copy = [...prev];
      copy[index] = { ...item, quantity: next };
      return copy;
    });
  };

  const handleRemoveItem = (item, index) => item.status !== 'new' ? setCancelModalItem(item) : setDraftItems(prev => prev.filter((_,i) => i !== index));
  const subtotal = draftItems.reduce((sum,item) => item.status === 'cancelled' ? sum : sum + Number(item.unitPrice || 0) * Number(item.quantity || 0), 0);
  const cartQty = draftItems.filter(i => i.status !== 'cancelled').reduce((n,i) => n + Number(i.quantity || 0), 0);
  const productQty = (productId) => draftItems.filter(i => i.productId === productId && i.status !== 'cancelled').reduce((n,i) => n + Number(i.quantity || 0), 0);

  const forceRestaurantSync = () => {
    try { window.dispatchEvent(new CustomEvent('oscar:restaurant-order-change')); } catch {}
    try { window.OscarCloudSync?.requestSync?.(0); } catch {}
    try { window.OscarCloudSync?.syncNow?.({ force:true }).catch(() => {}); } catch {}
  };

  const handleSendToKitchen = async () => {
    const activeItems = draftItems.filter(i => i.status !== 'cancelled');
    const noteChangedForExisting = !!activeExistingOrder && orderNoteText(activeExistingOrder.notes) !== orderNote.trim();
    if (!activeItems.length && !noteChangedForExisting) return showToast('الطلب فارغ! اختر الأصناف أولاً', 'error');
    if (orderType === 'dine_in' && !selectedTable) return showToast('يرجى تحديد الطاولة', 'error');
    const notes = orderNote.trim() ? { kitchenNotes: orderNote.trim() } : undefined;
    try {
      let ticketOrder = null;
      if (activeExistingOrder) {
        const hasNewItems = draftItems.some(i => i.status === 'new');
        const noteChanged = orderNoteText(activeExistingOrder.notes) !== orderNote.trim();
        if (!hasNewItems && !noteChanged) return showToast('لا توجد أصناف أو ملاحظات جديدة لإرسالها', 'info');
        const draftContainsSentLines = draftItems.some(i => i.status !== 'new' && i.status !== 'cancelled');
        const itemsForUpdate = draftContainsSentLines ? draftItems : [...(activeExistingOrder.items || []), ...draftItems];
        const updated = await updateOrder(activeExistingOrder.id, {
          items: itemsForUpdate,
          customerName: customerName || activeExistingOrder.customerName,
          guestCount: guestCount || activeExistingOrder.guestCount,
          notes
        });
        if (hasNewItems) {
          ticketOrder = await sendOrderToKitchen(activeExistingOrder.id, { isAddition:true });
          setIsAdditionTicket(true);
        } else {
          ticketOrder = updated;
          setIsAdditionTicket(false);
          showToast('تم تحديث ملاحظات الطلب في المطبخ', 'success');
        }
        setActiveExistingOrder(ticketOrder || updated || activeExistingOrder);
      } else {
        const created = await createOrder({
          orderType,
          tableId: orderType === 'dine_in' ? selectedTable?.id : undefined,
          tableNumber: orderType === 'dine_in' ? selectedTable?.tableNumber : undefined,
          tableName: orderType === 'dine_in' ? selectedTable?.name : undefined,
          sectionName: orderType === 'dine_in' ? selectedTable?.sectionName : undefined,
          waiterId: activeEmployee?.id || 'emp-waiter',
          waiterName: activeEmployee?.name || 'الجرسون',
          customerName,
          guestCount: orderType === 'dine_in' ? guestCount : undefined,
          items: draftItems,
          notes
        });
        ticketOrder = await sendOrderToKitchen(created.id);
        setIsAdditionTicket(false);
        setActiveExistingOrder(orderType === 'dine_in' ? (ticketOrder || created) : null);
      }
      setDraftItems([]);
      setOrderNote('');
      setIsCartOpen(false);
      if (orderType === 'dine_in' && selectedTableId) setIgnoreHydrateTableId(selectedTableId);
      else { setIgnoreHydrateTableId(''); setCustomerName(''); }
      if (ticketOrder) setShowTicketModal(ticketOrder);
      forceRestaurantSync();
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء إرسال الطلب', 'error');
    }
  };

  const handleConfirmCancelItem = async () => {
    if (!cancelModalItem || !activeExistingOrder) return;
    if (managerPin !== '1234' && !currentUser?.permissions?.canDeleteInvoice) return showToast('رمز المشرف غير صحيح أو لا تملك صلاحية الإلغاء', 'error');
    await updateOrderItemStatus(activeExistingOrder.id, cancelModalItem.id, 'cancelled', cancelReason);
    setDraftItems(prev => prev.map(i => i.id === cancelModalItem.id ? { ...i, status:'cancelled', cancelledReason:cancelReason } : i));
    setCancelModalItem(null);
    setManagerPin('');
    forceRestaurantSync();
  };

  const money = n => Number(n || 0).toLocaleString('ar-EG');

  const cartModal = isCartOpen ? createPortal(
    h('div', {
      id:'waiter-cart-backdrop',
      className:'waiter-frost-overlay',
      onMouseDown:(e)=>{ if (e.target === e.currentTarget) setIsCartOpen(false); }
    },
      h('section', { id:'waiter-cart-modal', className:'waiter-order-dialog', role:'dialog', 'aria-modal':'true', 'aria-label':'سلة طلب الجرسون' },
        h('header', { className:'waiter-dialog-header' },
          h('div', { className:'waiter-dialog-title-wrap' },
            h('div', { className:'waiter-dialog-icon' }, h(ShoppingCart,{size:19})),
            h('div', null,
              h('div', { className:'waiter-dialog-title' }, orderType==='dine_in' ? `طلب طاولة ${selectedTable?.tableNumber || selectedTable?.name || '-'}` : 'طلب سفري'),
              h('div', { className:'waiter-dialog-subtitle' }, `${activeEmployee?.name || t("الجرسون")} • ${cartQty} قطعة${activeExistingOrder ? ' • طلب مفتوح' : ''}`)
            )
          ),
          h('button', { type:'button', onClick:()=>setIsCartOpen(false), className:'waiter-icon-button', 'aria-label':t("إغلاق") }, h(X,{size:18}))
        ),
        h('div', { className:'waiter-dialog-body custom-scrollbar' },
          draftItems.length === 0
            ? h('div', { className:'waiter-cart-empty' }, h(ShoppingCart,{size:34}), h('strong',null,'السلة فارغة'), h('span',null,'اضغط على أي صنف لإضافته للطلب'))
            : draftItems.map((item,idx) => {
                const sent = item.status !== 'new';
                const product = (products || []).find(p=>p.id===item.productId);
                const units = product?.units || [];
                const defaultUnit = units.find(u=>u.isDefaultSale) || units[0];
                const selectedUnitId = item.unitId || defaultUnit?.id || '';
                return h('article', { key:item.id || idx, className:`waiter-cart-line ${item.status==='cancelled'?'is-cancelled':''} ${sent?'is-sent':''}` },
                  h('div', { className:'waiter-cart-line-top' },
                    h('div', { className:'waiter-cart-line-info' },
                      h('strong', { className:'waiter-cart-line-name' }, item.productName),
                      h('div', { className:'waiter-cart-line-meta' },
                        item.status==='new' && units.length>1
                          ? h('label', { className:'waiter-unit-select-wrap' },
                              h('select', { value:selectedUnitId, onChange:e=>updateItemUnit(idx,e.target.value), className:'waiter-unit-select' }, units.map(u=>h('option',{key:u.id,value:u.id},`${u.name} — ${money(u.salePrice)} ${settings.currencySymbol||'₪'}`))),
                              h(ChevronDown,{size:13})
                            )
                          : h('span', { className:'waiter-meta-pill' }, item.unitName || defaultUnit?.name || 'حبة'),
                        h('span', { className:`waiter-status-pill ${item.status==='new'?'new':item.status==='ready'?'ready':'sent'}` }, item.status==='new'?'جديد':item.status==='ready'?'جاهز':'مرسل للمطبخ')
                      )
                    ),
                    h('div', { className:'waiter-line-total' }, `${money(Number(item.unitPrice)*Number(item.quantity))} ${settings.currencySymbol||'₪'}`)
                  ),
                  item.status!=='cancelled' && h('div', { className:'waiter-cart-line-actions' },
                    h('div', { className:'waiter-qty-control' },
                      h('button',{type:'button',onClick:()=>updateItemQty(idx,-1),'aria-label':'تقليل الكمية'},h(Minus,{size:14})),
                      h('span',null,item.quantity),
                      h('button',{type:'button',onClick:()=>updateItemQty(idx,1),'aria-label':'زيادة الكمية'},h(Plus,{size:14}))
                    ),
                    h('div', { className:'waiter-line-unit-price' }, `${money(item.unitPrice)} ${settings.currencySymbol||'₪'} / ${item.unitName||defaultUnit?.name||'حبة'}`),
                    h('button',{type:'button',onClick:()=>handleRemoveItem(item,idx),className:'waiter-remove-button','aria-label':'حذف الصنف'},h(Trash2,{size:17}))
                  )
                );
              })
        ),
        h('footer', { className:'waiter-dialog-footer' },
          h('div', { className:'waiter-footer-fields' },
            h('label', { className:'waiter-field waiter-customer-field' },
              h('span',null,t("اسم العميل")),
              h('input',{value:customerName,onChange:e=>setCustomerName(e.target.value),placeholder:t("اختياري")})
            ),
            h('label', { className:'waiter-field waiter-note-field' },
              h('span',null,h(StickyNote,{size:14}),'ملاحظات للمطبخ'),
              h('textarea',{value:orderNote,onChange:e=>setOrderNote(e.target.value),onKeyDown:e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSendToKitchen();}},rows:2,placeholder:'مثال: بدون ملح، مستعجل...'})
            )
          ),
          h('div', { className:'waiter-footer-summary' },
            h('div', { className:'waiter-total-box' }, h('span',null,t("الإجمالي")), h('strong',null,`${money(subtotal)} ${settings.currencySymbol||'₪'}`)),
            h('div', { className:'waiter-footer-buttons' },
              activeExistingOrder && h('button',{type:'button',onClick:()=>{setShowTicketModal(activeExistingOrder);setIsAdditionTicket(false);},className:'waiter-secondary-action'},h(Printer,{size:16}),t("طباعة")),
              h('button',{type:'button',id:'waiter-send-kitchen','data-enter-primary':'true',onClick:handleSendToKitchen,disabled:!draftItems.length && !orderNote.trim(),className:'waiter-primary-action'},h(Send,{size:17}),activeExistingOrder?'إرسال التحديث':'إرسال للمطبخ')
            )
          )
        )
      )
    ),
    document.body
  ) : null;

  const cancelModal = cancelModalItem ? createPortal(
    h('div', { className:'waiter-frost-overlay waiter-confirm-overlay', onMouseDown:e=>{if(e.target===e.currentTarget)setCancelModalItem(null);} },
      h('section', { className:'waiter-confirm-dialog', role:'alertdialog', 'aria-modal':'true' },
        h('div',{className:'waiter-confirm-heading'},h('div',{className:'waiter-confirm-icon'},h(AlertTriangle,{size:20})),h('div',null,h('strong',null,'إلغاء صنف مرسل للمطبخ'),h('span',null,cancelModalItem.productName))),
        h('label',{className:'waiter-field'},h('span',null,'سبب الإلغاء'),h('select',{value:cancelReason,onChange:e=>setCancelReason(e.target.value)},['طلب العميل التراجع','خطأ الجرسون في الاختيار','غير متوفر في المطبخ','تأخر التحضير'].map(x=>h('option',{key:x,value:x},x)))),
        h('label',{className:'waiter-field waiter-pin-field'},h('span',null,'رمز المشرف'),h('div',{className:'waiter-pin-wrap'},h(Lock,{size:16}),h('input',{type:'password',value:managerPin,onChange:e=>setManagerPin(e.target.value),placeholder:'PIN'}))),
        h('div',{className:'waiter-confirm-actions'},h('button',{type:'button',onClick:()=>setCancelModalItem(null),className:'waiter-secondary-action'},'تراجع'),h('button',{type:'button',onClick:handleConfirmCancelItem,className:'waiter-danger-action'},'تأكيد الحذف'))
      )
    ),
    document.body
  ) : null;

  return h(React.Fragment,null,
    h('div',{dir:'rtl',className:'waiter-v2-root'},
      h('div',{className:'waiter-v2-topbar'},
        h('div',{className:'waiter-v2-order-controls'},
          h('div',{className:'waiter-v2-segment'},
            h('button',{type:'button',onClick:()=>{setIgnoreHydrateTableId('');setOrderType('dine_in')},className:orderType==='dine_in'?'active':''},h(Utensils,{size:16}),'طاولة'),
            h('button',{type:'button',onClick:()=>{setIgnoreHydrateTableId('');setOrderType('takeaway')},className:orderType==='takeaway'?'active':''},h(ShoppingBag,{size:16}),'سفري')
          ),
          orderType==='dine_in'
            ? h('label',{className:'waiter-v2-select'},h('select',{value:selectedTableId,onChange:e=>{setIgnoreHydrateTableId('');setSelectedTableId(e.target.value)}},tables.map((t,idx)=>{const label=t.tableNumber ?? t.name ?? (idx+1); const section=t.sectionName?` • ${t.sectionName}`:''; return h('option',{key:t.id,value:t.id},`طاولة ${label}${section} — ${t.status==='available'?'متاحة':'مشغولة'}`)})),h(ChevronDown,{size:15}))
            : h('div',{className:'waiter-v2-takeaway-note'},h(ShoppingBag,{size:16}),h('span',null,'طلب سفري جديد')),
          orderType==='dine_in' && h('label',{className:'waiter-v2-guests',title:'عدد الأفراد'},h(Users,{size:16}),h('input',{type:'number',min:1,max:25,value:guestCount,onChange:e=>setGuestCount(parseInt(e.target.value)||1)}),h('span',null,'أفراد')),
          activeExistingOrder && h('span',{className:'waiter-v2-open-order'},'طلب مفتوح')
        ),
        h('button',{type:'button',className:'waiter-v2-cart-summary',onClick:()=>setIsCartOpen(true)},h('span',{className:'waiter-v2-cart-icon'},h(ShoppingCart,{size:18}),cartQty>0&&h('b',null,cartQty)),h('span',{className:'waiter-v2-cart-copy'},h('small',null,t("السلة")),h('strong',null,`${money(subtotal)} ${settings.currencySymbol||'₪'}`)))
      ),
      h('div',{className:'waiter-v2-discovery'},
        h('div',{className:'waiter-v2-search'},h(Search,{size:17}),h('input',{value:searchTerm,onChange:e=>setSearchTerm(e.target.value),placeholder:'ابحث باسم الصنف أو الباركود...'})),
        h('div',{className:'waiter-v2-categories custom-scrollbar'},
          h('button',{type:'button',onClick:()=>setSelectedCategoryId('all'),className:selectedCategoryId==='all'?'active':''},`الكل ${restaurantProducts.length}`),
          restaurantCategories.map(cat=>h('button',{type:'button',key:cat.id,onClick:()=>setSelectedCategoryId(cat.id),className:selectedCategoryId===cat.id?'active':''},cat.name))
        )
      ),
      h('main',{className:'waiter-v2-products custom-scrollbar'},
        filteredProducts.length===0
          ? h('div',{className:'waiter-v2-empty'},h(Search,{size:30}),h('strong',null,'لا توجد أصناف مطابقة'),h('span',null,'غيّر البحث أو التصنيف'))
          : h('div',{className:'waiter-v2-grid'},filteredProducts.map(prod=>{
              const unit=(prod.units||[]).find(u=>u.isDefaultSale)||(prod.units||[])[0];
              const price=Number(unit?.salePrice??prod.sellingPrice??prod.salePrice??0)||0;
              const qty=productQty(prod.id);
              return h('button',{type:'button',key:prod.id,onClick:()=>handleQuickAdd(prod),className:`waiter-v2-product ${qty?'has-qty':''}`},
                qty>0&&h('span',{className:'waiter-v2-product-qty'},qty),
                h('div',{className:'waiter-v2-product-head'},h('span',{className:'waiter-v2-product-category'},prod.categoryName||'مطعم'),h('span',{className:'waiter-v2-product-plus'},h(Plus,{size:16}))),
                h('strong',{className:'waiter-v2-product-name'},prod.name),
                h('div',{className:'waiter-v2-product-foot'},h('span',{className:'waiter-v2-product-unit'},unit?.name||prod.baseUnitName||'حبة'),h('b',null,`${money(price)} ${settings.currencySymbol||'₪'}`))
              );
            }))
      ),
      h('button',{id:'waiter-cart-fab',type:'button',onClick:()=>setIsCartOpen(true),className:'waiter-v2-fab'},h(ShoppingCart,{size:22}),cartQty>0&&h('span',null,cartQty))
    ),
    cartModal,
    cancelModal,
    showTicketModal && h(KitchenTicketModal,{order:showTicketModal,isAdditionOnly:isAdditionTicket,onClose:()=>setShowTicketModal(null)})
  );
};
