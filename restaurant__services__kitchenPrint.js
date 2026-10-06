import { printElementOnly } from './utils__export.js?v=7.9.4.136-localization';

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const noteText = (notes) => typeof notes === 'string'
  ? notes
  : String(notes?.kitchenNotes || notes?.general || '');

const money = (value) => Number(value || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const addonUnitTotal = (item) => (item?.addons || []).reduce((sum, addon) => sum + Number(addon?.price || 0), 0);
const unitTotal = (item) => Number(item?.unitPrice || 0) + addonUnitTotal(item);
const lineTotal = (item) => unitTotal(item) * Number(item?.quantity || 0);

function selectItems(order, options = {}) {
  const all = (order?.items || []).filter(item => item && item.status !== 'cancelled');
  const ids = new Set((options.itemIds || []).filter(Boolean));
  if (ids.size) return all.filter(item => ids.has(item.id));
  if (options.isAdditionOnly) {
    const additions = all.filter(item => item.isAddition);
    if (additions.length) return additions;
  }
  return all;
}

export async function printKitchenTicketDirect(order, settings = {}, options = {}) {
  if (!order || typeof document === 'undefined') return false;
  const items = selectItems(order, options);
  if (!items.length) return false;

  const width = settings.kitchenTicketWidth || '80mm';
  const currency = settings.currencySymbol || '₪';
  const note = noteText(order.notes);
  const title = options.isAdditionOnly ? 'إضافة جديدة للمطبخ' : 'فاتورة طلب المطبخ';
  const place = order.orderType === 'dine_in'
    ? `طاولة ${order.tableNumber || '-'}${order.sectionName ? ` - ${order.sectionName}` : ''}`
    : `سفري ${order.queueNumber || order.orderNumber || ''}`;
  const sentAt = order.lastKitchenSendAt || order.sentToKitchenAt || order.createdAt || new Date().toISOString();
  const grandTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const small = width === '58mm';

  const root = document.createElement('div');
  root.setAttribute('dir', 'rtl');
  root.dataset.paper = width;
  root.style.cssText = `width:${small ? '58mm' : '80mm'};max-width:100%;background:#fff;color:#000;padding:${small ? '2.2mm' : '3mm'};font-family:Cairo,Arial,sans-serif;font-size:${small ? '9px' : '10px'};line-height:1.4;direction:rtl;text-align:right;overflow:visible;`;

  const itemRows = items.map(item => {
    const qty = Number(item.quantity || 0);
    const one = unitTotal(item);
    const total = lineTotal(item);
    const details = [
      item.sizeVariant?.name ? `الحجم: ${item.sizeVariant.name}` : '',
      item.addons?.length ? `إضافات: ${item.addons.map(a => `+ ${a.name}`).join('، ')}` : '',
      item.removals?.length ? `استبعاد: ${item.removals.map(r => `- ${r}`).join('، ')}` : '',
      item.notes ? `ملاحظة: ${item.notes}` : ''
    ].filter(Boolean).map(text => `<div style="font-size:${small ? '7.5px' : '8.5px'};font-weight:700;margin-top:2px">${esc(text)}</div>`).join('');
    return `<div style="padding:5px 0;border-bottom:1px dashed #888;break-inside:avoid;page-break-inside:avoid">
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 30px 52px 58px;gap:3px;align-items:start;font-size:${small ? '8px' : '9px'};line-height:1.35">
        <div style="font-weight:900;word-break:break-word">${esc(item.productName || 'صنف')}</div>
        <div style="text-align:center;font-weight:900;border:1px solid #000;border-radius:3px;padding:1px">${esc(qty)}</div>
        <div style="text-align:center;font-weight:800;white-space:nowrap">${esc(money(one))}</div>
        <div style="text-align:center;font-weight:900;white-space:nowrap">${esc(money(total))}</div>
      </div>${details}
    </div>`;
  }).join('');

  root.innerHTML = `
    <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:6px;margin-bottom:6px">
      <div style="font-size:${small ? '13px' : '15px'};font-weight:900">${esc(settings.storeName || 'كاش توب 3')}</div>
      <div style="font-size:${small ? '12px' : '14px'};font-weight:900;margin-top:2px">${esc(title)}</div>
      <div style="font-size:${small ? '10px' : '12px'};font-weight:900;margin-top:3px">${esc(place)}</div>
      <div style="font-size:${small ? '7.5px' : '9px'};margin-top:2px">الطلب: #${esc(order.orderNumber || '')}${order.kitchenTicketId ? ` | التذكرة: #${esc(String(order.kitchenTicketId).slice(-8))}` : ''}</div>
    </div>
    <div style="border-bottom:1px dashed #000;padding-bottom:5px;margin-bottom:5px;font-size:${small ? '8px' : '9px'}">
      <div><b>الجرسون:</b> ${esc(order.waiterName || '-')}</div>
      ${order.customerName ? `<div><b>العميل:</b> ${esc(order.customerName)}</div>` : ''}
      ${order.guestCount ? `<div><b>الأفراد:</b> ${esc(order.guestCount)}</div>` : ''}
      <div><b>وقت الإرسال:</b> ${esc(new Date(sentAt).toLocaleString('ar-EG'))}</div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 30px 52px 58px;gap:3px;padding:3px 0;border-top:2px solid #000;border-bottom:2px solid #000;font-size:${small ? '7px' : '8px'};font-weight:900;text-align:center">
      <div style="text-align:right">الصنف</div><div>كمية</div><div>السعر ${esc(currency)}</div><div>الإجمالي ${esc(currency)}</div>
    </div>
    <div style="overflow:visible">${itemRows}</div>
    <div style="display:flex;justify-content:space-between;gap:6px;align-items:center;padding:7px 0;margin-top:2px;border-top:2px solid #000;border-bottom:2px dashed #000;font-weight:900">
      <span>الإجمالي (${esc(itemCount)}):</span><span style="font-size:${small ? '11px' : '13px'};white-space:nowrap">${esc(money(grandTotal))} ${esc(currency)}</span>
    </div>
    ${note ? `<div style="margin-top:7px;border:2px solid #000;padding:6px;font-weight:900;font-size:${small ? '8px' : '9px'};white-space:pre-wrap"><b>ملاحظات الطلب:</b><br>${esc(note)}</div>` : ''}
    <div style="text-align:center;margin-top:7px;font-size:${small ? '6.5px' : '8px'}">فاتورة مطبخ داخلية • الكمية + السعر + الإجمالي</div>`;

  root.style.position = 'fixed';
  root.style.left = '-10000px';
  root.style.top = '0';
  root.style.zIndex = '-1';
  document.body.appendChild(root);
  try {
    return await printElementOnly(root, width, `${title} ${order.orderNumber || ''}`);
  } finally {
    setTimeout(() => { try { root.remove(); } catch (_) {} }, 1000);
  }
}
