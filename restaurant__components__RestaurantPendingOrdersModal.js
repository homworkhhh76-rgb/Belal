import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import React, { useMemo, useState } from 'react';
import { Search, X, UtensilsCrossed, Clock3, UserRound, Trash2, ShoppingCart, RefreshCw } from 'lucide-react';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';

const h = React.createElement;
const STATUS_LABELS = {
  sent: 'مرسل للمطبخ', preparing: 'قيد التحضير', partially_ready: 'جاهز جزئياً',
  ready: 'جاهز', served: 'تم التسليم', waiting_payment: 'بانتظار الحساب', draft: 'مسودة'
};

export const RestaurantPendingOrdersModal = ({ isOpen, onClose }) => {
  const { orders, tables, recallOrderToPOS, cancelRestaurantOrder } = useRestaurant();
  const { settings, showToast } = useApp();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState('');

  const getOrderTable = (order) => (tables || []).find((t) => t.id === order?.tableId);
  const getTableLabel = (order) => {
    const table = getOrderTable(order);
    const tableName = String(order?.tableName || table?.name || '').trim();
    const tableNumber = String(order?.tableNumber || table?.tableNumber || '').trim();
    if (order?.orderType === 'takeaway') return order?.customerName ? `سفري — ${order.customerName}` : 'طلب سفري';
    if (tableName) return tableName;
    if (tableNumber) return `طاولة ${tableNumber}`;
    return 'طاولة غير محددة';
  };

  const pending = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (orders || [])
      .filter(o => o && o.cashierPending === true && ['ready','served','waiting_payment'].includes(o.status))
      .filter(o => {
        if (!q) return true;
        const table = getOrderTable(o);
        return [o.customerName,o.customerPhone,o.waiterName,o.tableName,o.tableNumber,table?.name,table?.tableNumber,getTableLabel(o),o.orderNumber,o.queueNumber]
          .some(v => String(v || '').toLowerCase().includes(q));
      })
      .sort((a,b) => new Date(b.updatedAt || b.readyAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.readyAt || a.createdAt || 0).getTime());
  }, [orders, tables, query]);

  if (!isOpen) return null;

  const recall = (order) => {
    recallOrderToPOS(order);
    onClose?.();
  };
  const remove = async (order) => {
    if (!window.confirm(`حذف طلب ${order.tableNumber ? 'الطاولة ' + order.tableNumber : order.orderNumber} من قائمة المطعم؟\nسيتم تسجيله كطلب ملغي ولن يتحول إلى فاتورة.`)) return;
    setBusyId(order.id);
    try {
      await cancelRestaurantOrder(order.id, 'حذف من قائمة طلبات المطعم بواسطة الكاشير', false);
      showToast('تم حذف الطلب من قائمة الطلبات غير المحاسبة', 'info');
    } finally { setBusyId(''); }
  };

  return h(ModalLayer, { className: 'fixed inset-0 z-[80] bg-black/65 p-2 sm:p-4 flex items-center justify-center', onClick:onClose },
    h('div', { dir:'rtl', className:'w-full max-w-3xl max-h-[88dvh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden', onClick:e=>e.stopPropagation() },
      h('div', { className:'p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0' },
        h('div', { className:'flex items-center gap-2 min-w-0' },
          h('div', { className:'w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0' }, h(UtensilsCrossed,{className:'w-5 h-5'})),
          h('div',{className:'min-w-0'}, h('h3',{className:'text-sm sm:text-base font-black text-slate-900 dark:text-white'},'طلبات المطعم غير المحاسبة'), h('p',{className:'text-[10px] sm:text-xs text-slate-500'},'مثل الفواتير المعلقة — استدعاء، بحث أو حذف الطلب'))
        ),
        h('button',{type:'button',onClick:onClose,className:'w-9 h-9 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 hover:bg-slate-100'},h(X,{className:'w-4 h-4'}))
      ),
      h('div',{className:'p-3 border-b border-slate-100 dark:border-slate-800 shrink-0'},
        h('div',{className:'relative'}, h(Search,{className:'absolute right-3 top-2.5 w-4 h-4 text-slate-400'}), h('input',{value:query,onChange:e=>setQuery(e.target.value),placeholder:'بحث باسم العميل أو الطاولة أو الجرسون...',className:'w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 outline-none focus:border-amber-500'}))
      ),
      h('div',{className:'flex-1 min-h-0 overflow-y-auto p-3 space-y-2 custom-scrollbar'},
        pending.length===0 ? h('div',{className:'py-16 text-center text-slate-400'},h(UtensilsCrossed,{className:'w-10 h-10 mx-auto mb-3 opacity-30'}),h('p',{className:'text-sm font-bold'},'لا توجد طلبات مطعم غير محاسبة')) :
        pending.map(order => h('div',{key:order.id,className:'p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-xs'},
          h('div',{className:'flex items-start justify-between gap-3'},
            h('div',{className:'min-w-0 flex-1'},
              h('div',{className:'flex items-center gap-2 flex-wrap'},
                h('span',{className:'font-black text-sm text-slate-900 dark:text-white'},getTableLabel(order)),
                h('span',{className:`px-2 py-0.5 rounded-full text-[9px] font-black ${['ready','served','waiting_payment'].includes(order.status)?'bg-violet-100 text-violet-700':'bg-amber-100 text-amber-700'}`},STATUS_LABELS[order.status] || order.status)
              ),
              h('div',{className:'flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-500'},
                h('span',{className:'inline-flex items-center gap-1'},h(UserRound,{className:'w-3 h-3'}),order.waiterName || t("الجرسون")),
                h('span',{className:'inline-flex items-center gap-1'},h(Clock3,{className:'w-3 h-3'}),new Date(order.createdAt || Date.now()).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})),
                order.customerName ? h('span',{className:'font-bold text-slate-700 dark:text-slate-200'},t("العميل: ")+order.customerName) : null,
                h('span',{className:'font-black text-violet-600'},`${Number(order.total||0).toLocaleString('ar-EG')} ${settings.currencySymbol||'₪'}`)
              ),
              h('div',{className:'mt-2 text-[10px] text-slate-500 truncate'},(order.items||[]).filter(i=>i.status!=='cancelled').map(i=>`${i.quantity}× ${i.productName}`).join('، '))
            ),
            h('div',{className:'flex items-center gap-1.5 shrink-0'},
              h('button',{type:'button',onClick:()=>recall(order),className:'px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[10px] font-black flex items-center gap-1.5'},h(ShoppingCart,{className:'w-3.5 h-3.5'}),'استدعاء'),
              h('button',{type:'button',disabled:busyId===order.id,onClick:()=>remove(order),className:'w-9 h-9 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center disabled:opacity-40',title:'حذف الطلب'},busyId===order.id?h(RefreshCw,{className:'w-3.5 h-3.5 animate-spin'}):h(Trash2,{className:'w-3.5 h-3.5'}))
            )
          )
        ))
      )
    )
  );
};
