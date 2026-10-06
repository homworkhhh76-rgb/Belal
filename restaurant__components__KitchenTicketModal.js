import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import { printElementOnly } from './utils__export.js?v=7.9.4.136-localization';

const h = React.createElement;
const money = (value) => Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addonUnitTotal = (item) => (item?.addons || []).reduce((sum, addon) => sum + Number(addon?.price || 0), 0);
const unitTotal = (item) => Number(item?.unitPrice || 0) + addonUnitTotal(item);
const lineTotal = (item) => unitTotal(item) * Number(item?.quantity || 0);

export const KitchenTicketModal = ({ order, isAdditionOnly = false, onClose }) => {
  const { settings } = useApp();
  if (!order) return null;

  const printerWidth = settings.kitchenTicketWidth || '80mm';
  const currency = settings.currencySymbol || '₪';
  const allItems = (order.items || []).filter((item) => item && item.status !== 'cancelled');
  const additionItems = allItems.filter((item) => item.isAddition);
  const displayItems = isAdditionOnly && additionItems.length ? additionItems : allItems;
  const grandTotal = displayItems.reduce((sum, item) => sum + lineTotal(item), 0);
  const itemCount = displayItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const orderNote = typeof order.notes === 'string'
    ? order.notes
    : String(order.notes?.kitchenNotes || order.notes?.general || '');

  const handlePrint = async () => {
    const el = document.getElementById('kitchen-ticket-print-area');
    if (!el) return;
    await printElementOnly(el, printerWidth, `${isAdditionOnly ? 'إضافة للمطبخ' : 'تذكرة المطبخ'} ${order.orderNumber || ''}`);
  };

  const infoRow = (label, value) => h('div', {
    style: { display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start', marginBottom: '2px' }
  }, h('span', null, label), h('strong', { style: { textAlign: 'left' } }, value));

  const itemRow = (item, idx) => {
    const qty = Number(item.quantity || 0);
    const one = unitTotal(item);
    const total = lineTotal(item);
    return h('div', {
      key: item.id || idx,
      style: {
        padding: '6px 0',
        borderBottom: '1px dashed #94a3b8',
        breakInside: 'avoid',
        pageBreakInside: 'avoid'
      }
    },
      h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 34px 62px 68px',
          gap: '4px',
          alignItems: 'start',
          fontSize: printerWidth === '58mm' ? '9px' : '10px',
          lineHeight: '1.35'
        }
      },
        h('div', { style: { fontWeight: 900, wordBreak: 'break-word' } }, item.productName || 'صنف'),
        h('div', { style: { textAlign: 'center', fontWeight: 900, border: '1px solid #111', borderRadius: '4px', padding: '2px 1px' } }, qty),
        h('div', { style: { textAlign: 'center', fontWeight: 800, whiteSpace: 'nowrap' } }, money(one)),
        h('div', { style: { textAlign: 'center', fontWeight: 900, whiteSpace: 'nowrap' } }, money(total))
      ),
      item.sizeVariant && h('div', { style: { marginTop: '3px', fontSize: '9px', fontWeight: 700 } }, `الحجم: ${item.sizeVariant.name}`),
      item.addons && item.addons.length > 0 && h('div', { style: { marginTop: '2px', fontSize: '9px', fontWeight: 700 } }, `إضافات: ${item.addons.map((a) => `+ ${a.name}`).join('، ')}`),
      item.removals && item.removals.length > 0 && h('div', { style: { marginTop: '2px', fontSize: '9px', fontWeight: 700 } }, `استبعاد: ${item.removals.map((r) => `- ${r}`).join('، ')}`),
      item.notes && h('div', { style: { marginTop: '3px', padding: '3px 5px', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '9px', fontWeight: 800 } }, `ملاحظة: ${item.notes}`)
    );
  };

  return createPortal(h('div', {
    className: 'waiter-frost-overlay select-none',
    style: { zIndex: 2147483600, padding: '10px' },
    onMouseDown: (event) => { if (event.target === event.currentTarget) onClose?.(); }
  },
    h('div', {
      className: 'bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col',
      style: { width: 'min(96vw, 760px)', maxHeight: '94dvh' }
    },
      h('div', { className: 'flex items-center justify-between p-3 border-b bg-slate-50 shrink-0' },
        h('div', { className: 'flex items-center gap-2' },
          h(Printer, { className: 'w-5 h-5 text-violet-600' }),
          h('div', null,
            h('h3', { className: 'text-sm font-black text-slate-900' }, isAdditionOnly ? 'فاتورة إضافة للمطبخ' : 'فاتورة المطبخ / الجرسون'),
            h('div', { className: 'text-[10px] text-slate-500' }, `${displayItems.length} أصناف • ${itemCount} كمية`)
          )
        ),
        h('button', { onClick: onClose, className: 'w-9 h-9 rounded-xl border bg-white flex items-center justify-center text-slate-600' }, h(X, { className: 'w-4 h-4' }))
      ),
      h('div', {
        className: 'flex-1 min-h-0 overflow-y-auto overscroll-contain bg-slate-100 p-2 sm:p-4',
        style: { WebkitOverflowScrolling: 'touch' }
      },
        h('div', {
          id: 'kitchen-ticket-print-area',
          'data-paper': printerWidth,
          dir: 'rtl',
          className: 'bg-white text-black rounded-xl shadow-sm border border-slate-200 mx-auto',
          style: {
            width: printerWidth === '58mm' ? 'min(100%, 360px)' : 'min(100%, 470px)',
            padding: printerWidth === '58mm' ? '10px' : '14px',
            fontFamily: 'Cairo, Arial, sans-serif',
            fontSize: '11px',
            lineHeight: '1.45',
            direction: 'rtl',
            textAlign: 'right',
            overflow: 'visible'
          }
        },
          h('div', { style: { textAlign: 'center', borderBottom: '2px dashed #111', paddingBottom: '7px', marginBottom: '7px' } },
            h('div', { style: { fontSize: '15px', fontWeight: 900 } }, settings.storeName || 'كاش توب 3'),
            h('div', { style: { fontSize: '14px', fontWeight: 900, marginTop: '2px' } }, isAdditionOnly ? 'إضافة جديدة للطلب' : 'فاتورة طلب المطبخ'),
            h('div', { style: { fontSize: '12px', fontWeight: 900, marginTop: '3px' } }, order.orderType === 'dine_in'
              ? `طاولة: ${order.tableNumber || 'غير محدد'}${order.sectionName ? ` - ${order.sectionName}` : ''}`
              : `سفري / تيك أواي: ${order.queueNumber || order.orderNumber || ''}`),
            h('div', { style: { fontSize: '9px', marginTop: '2px' } }, `الطلب: #${order.orderNumber || ''}${order.kitchenTicketId ? ` | التذكرة: #${String(order.kitchenTicketId).slice(-8)}` : ''}`)
          ),
          h('div', { style: { borderBottom: '1px dashed #111', paddingBottom: '6px', marginBottom: '6px', fontSize: '10px' } },
            infoRow('الجرسون:', order.waiterName || 'الكاشير'),
            order.customerName ? infoRow('العميل:', order.customerName) : null,
            order.guestCount ? infoRow('عدد الأفراد:', order.guestCount) : null,
            infoRow('وقت الإرسال:', new Date(order.lastKitchenSendAt || order.sentToKitchenAt || order.createdAt || Date.now()).toLocaleString('ar-EG'))
          ),
          h('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) 34px 62px 68px',
              gap: '4px',
              padding: '4px 0',
              borderTop: '2px solid #111',
              borderBottom: '2px solid #111',
              fontSize: printerWidth === '58mm' ? '8px' : '9px',
              fontWeight: 900,
              textAlign: 'center'
            }
          },
            h('div', { style: { textAlign: 'right' } }, t("الصنف")),
            h('div', null, 'كمية'),
            h('div', null, `السعر ${currency}`),
            h('div', null, `الإجمالي ${currency}`)
          ),
          h('div', { style: { overflow: 'visible' } }, displayItems.map(itemRow)),
          h('div', {
            style: {
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
              padding: '8px 0', marginTop: '2px', borderTop: '2px solid #111', borderBottom: '2px dashed #111', fontWeight: 900
            }
          },
            h('span', null, `الإجمالي (${itemCount}):`),
            h('span', { style: { fontSize: '14px', whiteSpace: 'nowrap' } }, `${money(grandTotal)} ${currency}`)
          ),
          orderNote ? h('div', { style: { marginTop: '8px', border: '2px solid #111', padding: '6px', fontWeight: 900, fontSize: '10px', borderRadius: '5px', whiteSpace: 'pre-wrap' } }, `ملاحظات الطلب: ${orderNote}`) : null,
          h('div', { style: { textAlign: 'center', marginTop: '8px', fontSize: '8px' } }, 'فاتورة مطبخ داخلية • تشمل الكمية والسعر والإجمالي')
        )
      ),
      h('div', { className: 'p-3 border-t bg-white flex items-center justify-end gap-2 shrink-0' },
        h('button', { type: 'button', onClick: onClose, className: 'h-10 px-4 rounded-xl border bg-white text-xs font-bold text-slate-700' }, t("إغلاق")),
        h('button', { type: 'button', onClick: handlePrint, className: 'h-10 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black flex items-center gap-2 shadow-sm' },
          h(Printer, { className: 'w-4 h-4' }), 'طباعة الفاتورة'
        )
      )
    )
  ), document.body);
};
