import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import {
  ChefHat, Flame, Clock, Printer, CheckCircle2, Volume2, VolumeX,
  Utensils, ShoppingBag, Trash2, StickyNote, TimerReset, CircleDot, X
} from 'lucide-react';
import { KitchenTicketModal } from './restaurant__components__KitchenTicketModal.js?v=7.9.4.136-localization';
import { printKitchenTicketDirect } from './restaurant__services__kitchenPrint.js?v=7.9.4.136-localization';

const h = React.createElement;
const noteText = notes => typeof notes === 'string' ? notes : String(notes?.kitchenNotes || notes?.general || '');

export const RestaurantKDSView = () => {
  const { orders, updateOrderStatus, updateOrderItemStatus, cancelRestaurantOrder } = useRestaurant();
  const { settings, showToast } = useApp();
  const [filterTab, setFilterTab] = useState('active');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [ticketModalOrder, setTicketModalOrder] = useState(null);
  const [detailsModalOrder, setDetailsModalOrder] = useState(null);
  const autoPrintBusyRef = useRef(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => tick(v => v + 1), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!settings.autoPrintKitchenTicket || autoPrintBusyRef.current) return;
    const runtime = window.OscarActivation?.readRuntime?.();
    const storageKey = `oscar_kitchen_autoprinted_v3::${runtime?.companyId || 'local'}`;
    let printed = {};
    try { printed = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { printed = {}; }
    const candidates = (orders || []).filter(order => {
      if (!order || ['draft','cancelled','paid'].includes(order.status)) return false;
      const sentAt = order.lastKitchenSendAt || order.sentToKitchenAt;
      if (!sentAt) return false;
      const key = `${order.id}::${sentAt}`;
      return !printed[key];
    }).sort((a,b) => new Date(a.lastKitchenSendAt || a.sentToKitchenAt).getTime() - new Date(b.lastKitchenSendAt || b.sentToKitchenAt).getTime());
    if (!candidates.length) return;
    autoPrintBusyRef.current = true;
    (async () => {
      for (const order of candidates) {
        const sentAt = order.lastKitchenSendAt || order.sentToKitchenAt;
        const key = `${order.id}::${sentAt}`;
        printed[key] = Date.now();
        try {
          localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(Object.entries(printed).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,250))));
        } catch {}
        const ok = await printKitchenTicketDirect(order, settings, {
          isAdditionOnly: !!order.lastKitchenSendIsAddition,
          itemIds: order.lastKitchenSendItemIds || []
        });
        if (!ok) showToast('تعذر فتح طباعة تذكرة المطبخ تلقائياً على هذا الجهاز', 'warning');
        await new Promise(resolve => setTimeout(resolve, 450));
      }
    })().finally(() => { autoPrintBusyRef.current = false; });
  }, [orders, settings.autoPrintKitchenTicket, settings.kitchenTicketWidth, settings.kitchenTicketShowPrices, settings.storeName, settings.currencySymbol, showToast]);

  const targetMinutes = Number(settings.targetPrepTimeMinutes || 15);
  const activeStatuses = ['sent', 'preparing', 'partially_ready'];
  const counts = useMemo(() => ({
    active: (orders || []).filter(o => activeStatuses.includes(o?.status)).length,
    sent: (orders || []).filter(o => o?.status === 'sent').length,
    preparing: (orders || []).filter(o => ['preparing', 'partially_ready'].includes(o?.status)).length,
    ready: (orders || []).filter(o => o?.status === 'ready').length,
  }), [orders]);

  const filteredOrders = (orders || []).filter(order => {
    if (!order || ['cancelled', 'draft'].includes(order.status)) return false;
    if (filterTab === 'active') return activeStatuses.includes(order.status);
    if (filterTab === 'new') return order.status === 'sent';
    if (filterTab === 'preparing') return ['preparing', 'partially_ready'].includes(order.status);
    if (filterTab === 'ready') return order.status === 'ready';
    if (filterTab === 'completed') return ['served', 'paid'].includes(order.status);
    return true;
  });

  const elapsed = start => start ? Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 60000)) : 0;
  const toggleItemReady = async (orderId, itemId, status) => {
    await updateOrderItemStatus(orderId, itemId, status === 'ready' ? 'preparing' : 'ready');
  };
  const start = async id => {
    await updateOrderStatus(id, 'preparing', 'بدء التحضير في المطبخ');
    showToast('تم بدء تحضير الطلب', 'info');
  };
  const fullyReady = async id => {
    await updateOrderStatus(id, 'ready', 'اكتمل تحضير الطلب بالكامل');
    showToast('تم اعتماد الطلب جاهز بالكامل وإرساله للكاشير', 'success');
  };
  const served = async id => {
    await updateOrderStatus(id, 'served', 'تم تسليم الطلب للعميل');
    showToast('تم تسليم الطلب', 'success');
  };
  const remove = async order => {
    if (!window.confirm(`حذف الطلب ${order.tableNumber ? 'طاولة ' + order.tableNumber : order.orderNumber} من المطبخ؟`)) return;
    await cancelRestaurantOrder(order.id, 'حذف من شاشة المطبخ', false);
    showToast('تم حذف الطلب من شاشة المطبخ', 'info');
  };

  const tabButton = (id, label, count) => h('button', {
    key: id,
    onClick: () => setFilterTab(id),
    className: `px-3 py-2 rounded-xl text-[11px] sm:text-xs font-black whitespace-nowrap border transition ${filterTab === id
      ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`
  }, count === undefined ? label : `${label} (${count})`);

  return h('div', {
    dir: 'rtl',
    className: 'flex flex-col h-full w-full bg-slate-50 text-slate-900 overflow-hidden select-none text-right'
  },
    h('div', { className: 'bg-white border-b border-slate-200 px-3 sm:px-5 py-3 shadow-sm shrink-0' },
      h('div', { className: 'flex flex-col lg:flex-row lg:items-center justify-between gap-3' },
        h('div', { className: 'flex items-center gap-3 min-w-0' },
          h('div', { className: 'w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0' }, h(ChefHat, { className: 'w-6 h-6' })),
          h('div', { className: 'min-w-0' },
            h('div', { className: 'font-black text-base sm:text-lg text-slate-900' }, 'شاشة المطبخ'),
            h('div', { className: 'text-[10px] sm:text-[11px] text-slate-500 font-semibold' }, 'الطلبات والأصناف والملاحظات تصل مباشرة من الجرسون')
          )
        ),
        h('div', { className: 'grid grid-cols-4 gap-1.5 sm:gap-2 w-full lg:w-auto' },
          h('div', { className: 'rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-center min-w-0' }, h('div', { className: 'text-[9px] text-slate-500 font-bold' }, 'النشطة'), h('div', { className: 'text-sm font-black text-slate-900' }, counts.active)),
          h('div', { className: 'rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-center min-w-0' }, h('div', { className: 'text-[9px] text-amber-700 font-bold' }, 'جديدة'), h('div', { className: 'text-sm font-black text-amber-700' }, counts.sent)),
          h('div', { className: 'rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-2 text-center min-w-0' }, h('div', { className: 'text-[9px] text-blue-700 font-bold' }, 'تحضير'), h('div', { className: 'text-sm font-black text-blue-700' }, counts.preparing)),
          h('div', { className: 'rounded-xl border border-violet-200 bg-violet-50 px-2.5 py-2 text-center min-w-0' }, h('div', { className: 'text-[9px] text-violet-700 font-bold' }, 'جاهزة'), h('div', { className: 'text-sm font-black text-violet-700' }, counts.ready))
        )
      ),
      h('div', { className: 'mt-3 flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar' },
        tabButton('active', 'النشطة', counts.active),
        tabButton('new', 'جديدة', counts.sent),
        tabButton('preparing', 'قيد التحضير', counts.preparing),
        tabButton('ready', 'جاهزة بالكامل', counts.ready),
        tabButton('completed', 'المسلّمة'),
        h('button', {
          onClick: () => setSoundEnabled(v => !v),
          className: `mr-auto shrink-0 p-2 rounded-xl border ${soundEnabled ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-white border-slate-200 text-slate-500'}`,
          title: soundEnabled ? 'الصوت مفعل' : 'الصوت متوقف'
        }, soundEnabled ? h(Volume2, { className: 'w-4 h-4' }) : h(VolumeX, { className: 'w-4 h-4' }))
      )
    ),



    h('div', { className: 'flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 custom-scrollbar' },
      filteredOrders.length === 0
        ? h('div', { className: 'h-full min-h-64 flex flex-col items-center justify-center text-slate-400' },
            h(CheckCircle2, { className: 'w-14 h-14 opacity-25' }),
            h('div', { className: 'mt-2 font-black text-sm text-slate-500' }, 'لا توجد طلبات هنا'),
            h('div', { className: 'mt-1 text-[11px]' }, 'أي طلب جديد سيظهر على الشاشة فور وصوله من الجرسون')
          )
        : h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4' },
            filteredOrders.map(order => {
              const mins = elapsed(order.sentToKitchenAt || order.createdAt);
              const overdue = mins > targetMinutes;
              const isReady = order.status === 'ready';
              const note = noteText(order.notes);
              const items = (order.items || []).filter(i => i.status !== 'cancelled');
              const readyItems = items.filter(i => i.status === 'ready').length;
              return h('article', {
                key: order.id,
                onClick: () => setDetailsModalOrder(order),
                className: `rounded-2xl border bg-white overflow-hidden shadow-sm cursor-pointer transition hover:shadow-md ${isReady ? 'border-violet-300' : overdue ? 'border-rose-300' : 'border-slate-200'}`
              },
                h('div', { className: `p-3 border-b ${isReady ? 'bg-violet-50 border-violet-200' : overdue ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-100'} flex items-center justify-between gap-2` },
                  h('div', { className: 'flex items-center gap-2 min-w-0' },
                    h('div', { className: `w-11 h-11 rounded-xl border flex flex-col items-center justify-center shrink-0 ${isReady ? 'bg-white border-violet-200 text-violet-700' : 'bg-slate-50 border-slate-200 text-slate-700'}` },
                      order.orderType === 'dine_in' ? h(Utensils, { className: 'w-4 h-4' }) : h(ShoppingBag, { className: 'w-4 h-4' }),
                      h('span', { className: 'text-[9px] font-black mt-0.5' }, order.tableNumber || order.queueNumber || 'سفري')
                    ),
                    h('div', { className: 'min-w-0 flex-1' },
                      h('div', { className: 'font-black text-sm text-slate-900 truncate' }, order.orderType === 'dine_in' ? `طاولة ${order.tableNumber || order.tableName || '-'}` : 'طلب سفري'),
                      h('div', { className: 'text-[10px] text-slate-700 font-black truncate' }, `العميل: ${order.customerName || '-'}`),
                      h('div', { className: 'text-[10px] text-slate-500 font-semibold truncate' }, `الجرسون: ${order.waiterName || '-'} • #${String(order.orderNumber || '').slice(-5)}`)
                    )
                  ),
                  h('div', { className: `shrink-0 px-2 py-1 rounded-lg text-[10px] font-black flex items-center gap-1 ${overdue && !isReady ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}` },
                    h(Clock, { className: 'w-3.5 h-3.5' }), `${mins} د`
                  )
                ),

                h('div', { className: 'px-3 pt-3 flex items-center justify-between text-[10px] font-bold text-slate-500' },
                  h('span', null, `الأصناف ${items.length}`),
                  h('span', { className: readyItems === items.length && items.length ? 'text-violet-700' : '' }, `${readyItems}/${items.length} جاهز`)
                ),

                h('div', { className: 'p-3 space-y-2 max-h-80 overflow-y-auto custom-scrollbar' },
                  items.map(item => {
                    const ready = item.status === 'ready';
                    return h('button', {
                      key: item.id,
                      onClick: (e) => { e.stopPropagation(); toggleItemReady(order.id, item.id, item.status); },
                      className: `w-full p-2.5 rounded-xl border text-right flex items-start justify-between gap-2 transition ${ready ? 'bg-violet-50 text-violet-900 border-violet-200' : 'bg-slate-50 text-slate-900 border-slate-200 hover:bg-slate-100'}`
                    },
                      h('div', { className: 'min-w-0 flex-1' },
                        h('div', { className: 'font-black text-base leading-7 tracking-normal' }, `${item.quantity} × ${item.productName}`),
                        h('div', { className: `text-[11px] leading-5 font-bold ${ready ? 'text-violet-700' : 'text-slate-500'}` }, ready ? 'جاهز — اضغط للتراجع' : 'اضغط عند انتهاء تحضير الصنف')
                      ),
                      ready ? h(CheckCircle2, { className: 'w-5 h-5 text-violet-600 shrink-0 mt-0.5' }) : h(CircleDot, { className: 'w-5 h-5 text-slate-300 shrink-0 mt-0.5' })
                    );
                  }),
                  note && h('div', { className: 'p-3 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-950 text-sm font-black leading-6' },
                    h(StickyNote, { className: 'inline w-4 h-4 ml-1 text-amber-600' }), `ملاحظات الطلب: ${note}`
                  )
                ),

                h('div', { className: 'p-3 border-t border-slate-100 bg-slate-50 flex items-center gap-2' },
                  h('div',{className:'flex items-center gap-2 shrink-0'},
                    h('button', { onClick: (e) => { e.stopPropagation(); setTicketModalOrder(order); }, className: 'w-10 h-10 p-0 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 flex items-center justify-center shadow-sm', title: 'طباعة التذكرة' }, h(Printer, { className: 'w-4 h-4' })),
                    h('button', { onClick: (e) => { e.stopPropagation(); remove(order); }, className: 'w-10 h-10 p-0 rounded-xl border border-rose-300 bg-white text-rose-600 hover:bg-rose-50 flex items-center justify-center shadow-sm', title: 'حذف الطلب' }, h(Trash2, { className: 'w-4 h-4' }))
                  ),
                  order.status === 'sent' && h('button', { onClick: (e) => { e.stopPropagation(); start(order.id); }, className: 'flex-1 h-10 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs shadow-sm flex items-center justify-center gap-1.5 active:scale-[.98]' }, h(Flame, { className: 'w-4 h-4' }), 'بدء التحضير'),
                  ['preparing', 'partially_ready'].includes(order.status) && h('button', { onClick: (e) => { e.stopPropagation(); fullyReady(order.id); }, className: 'flex-1 h-10 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-black text-xs shadow-sm flex items-center justify-center gap-1.5 active:scale-[.98]' }, h(CheckCircle2, { className: 'w-4 h-4' }), 'جاهز بالكامل'),
                  order.status === 'ready' && h('button', { onClick: (e) => { e.stopPropagation(); served(order.id); }, className: 'flex-1 h-10 px-3 rounded-xl font-black text-xs shadow-sm flex items-center justify-center gap-1.5 active:scale-[.98]', style:{backgroundColor:'#0f766e',color:'#ffffff',border:'1px solid #0f766e'} }, h(TimerReset, { className: 'w-4 h-4' }), 'تم التسليم')
                )
              );
            })
          )
    ),
    detailsModalOrder && h(ModalLayer, {
      className: 'fixed inset-0 flex items-center justify-center bg-black/60 p-2 sm:p-4',
      style: { zIndex: 9998 },
      onClick: () => setDetailsModalOrder(null)
    },
      h('div', {
        className: 'bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col w-full max-w-2xl',
        style: { maxHeight: 'calc(100dvh - 150px)' },
        onClick: e => e.stopPropagation()
      },
        h('div', { className: 'p-3 sm:p-4 border-b bg-white flex items-start justify-between gap-3 shrink-0' },
          h('div', { className: 'min-w-0' },
            h('div', { className: 'font-black text-lg text-slate-900' }, detailsModalOrder.orderType === 'dine_in' ? `طلب طاولة ${detailsModalOrder.tableNumber || detailsModalOrder.tableName || '-'}` : 'طلب سفري'),
            h('div', { className: 'mt-1 text-xs text-slate-600 font-bold flex flex-wrap gap-x-3 gap-y-1' },
              h('span', null, `العميل: ${detailsModalOrder.customerName || '-'}`),
              h('span', null, `الجرسون: ${detailsModalOrder.waiterName || '-'}`),
              detailsModalOrder.orderType === 'dine_in' ? h('span', null, `رقم الطاولة: ${detailsModalOrder.tableNumber || detailsModalOrder.tableName || '-'}`) : null
            )
          ),
          h('button', { onClick: () => setDetailsModalOrder(null), className: 'w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-600 flex items-center justify-center shrink-0' }, h(X, { className: 'w-5 h-5' }))
        ),
        h('div', { className: 'flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2 custom-scrollbar', style: { WebkitOverflowScrolling: 'touch' } },
          (detailsModalOrder.items || []).filter(i => i.status !== 'cancelled').map((item, idx) => h('div', {
            key: item.id || idx,
            className: `rounded-xl border p-3 ${item.status === 'ready' ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-slate-50'}`
          },
            h('div', { className: 'flex items-center justify-between gap-3' },
              h('div', { className: 'font-black text-base text-slate-900' }, `${item.quantity} × ${item.productName}`),
              h('div', { className: `text-[10px] font-black px-2 py-1 rounded-lg ${item.status === 'ready' ? 'bg-violet-100 text-violet-700' : 'bg-white text-slate-500 border border-slate-200'}` }, item.status === 'ready' ? 'جاهز' : 'قيد العمل')
            ),
            item.unitName ? h('div', { className: 'text-[11px] text-slate-600 font-bold mt-1' }, `الوحدة: ${item.unitName}`) : null,
            item.notes ? h('div', { className: 'mt-2 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2' }, `ملاحظة: ${item.notes}`) : null
          )),
          noteText(detailsModalOrder.notes) ? h('div', { className: 'mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-black text-amber-950' }, `ملاحظات الطلب: ${noteText(detailsModalOrder.notes)}`) : null
        )
      )
    ),
    ticketModalOrder && h(KitchenTicketModal, { order: ticketModalOrder, onClose: () => setTicketModalOrder(null) })
  );
};
