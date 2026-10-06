import { getAllFromStore, getFromStore, putInStore } from './services__db.js?v=7.9.4.136-localization';
import { renderInvoiceCanvas, renderVoucherCanvas, renderTableCanvas } from './utils__canvasRenderer.js?v=7.9.4.136-localization';

// Telegram integration for Cash Top 3.
// The owner explicitly requested embedding this token in the app build.
export const TELEGRAM_BOT_TOKEN = '8893463288:AAHn77qegDsR3Yu1LYGicM0Dfh1Fznw4agg';
export const TELEGRAM_BOT_USERNAME = 'Oskarteaam_bot';
export const TELEGRAM_BOT_URL = 'http://t.me/Oskarteaam_bot';

const API_ROOT = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const MAX_TELEGRAM_TEXT = 3900;
const OUTBOX_LIMIT = 250;
const SENT_LIMIT = 800;
let automationStarted = false;
let automationTimer = null;
let flushing = false;
let lastServerSnapshotAt = 0;
let serverManagedUntil = 0;
let lastServerConfigKey = '';

const runtimeTenant = () => {
  try {
    const runtime = window.OscarActivation?.readRuntime?.();
    return String(runtime?.companyId || runtime?.tenantId || runtime?.companyKey || 'local');
  } catch { return 'local'; }
};
const outboxKey = () => `oscar_telegram_outbox_v2::${runtimeTenant()}`;
const sentKey = () => `oscar_telegram_sent_v2::${runtimeTenant()}`;

const safeJsonParse = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};
const readLocalArray = (key) => {
  try {
    const value = safeJsonParse(localStorage.getItem(key) || '[]', []);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
};
const writeLocalArray = (key, value, limit = 500) => {
  try { localStorage.setItem(key, JSON.stringify((Array.isArray(value) ? value : []).slice(-limit))); } catch {}
};

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const money = (value, symbol = '₪') => `${asNumber(value).toFixed(2)} ${symbol}`;
const fmtQty = (value) => {
  const n = asNumber(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
};
const fmtDateTime = (value) => {
  const d = value ? new Date(value) : new Date();
  if (!Number.isFinite(d.getTime())) return String(value || '');
  try { return d.toLocaleString('ar-EG-u-nu-latn', { hour12:true }); } catch { return d.toISOString(); }
};
const normalizeId = (value) => String(value ?? '').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));

const normalizeUsername = (value) => {
  const raw = String(value || '').trim().replace(/^@+/, '');
  return raw ? `@${raw}` : '';
};

export function normalizeTelegramRecipients(value) {
  const input = Array.isArray(value) ? value : [];
  const seen = new Set();
  const rows = [];
  for (const item of input) {
    const raw = typeof item === 'object' && item ? item : { chatId:item };
    const chatId = normalizeId(raw.chatId ?? raw.id ?? raw.userId);
    const username = normalizeUsername(raw.username || '');
    // Sales/movements/report recipients are linked by numeric Chat ID only.
    if (!/^-?\d{5,20}$/.test(chatId) || seen.has(chatId)) continue;
    seen.add(chatId);
    rows.push({
      chatId,
      username,
      label: String(raw.label || raw.name || username || '').trim(),
      enabled: raw.enabled !== false,
    });
  }
  return rows;
}

const splitTelegramText = (text) => {
  const lines = String(text || '').split('\n');
  const parts = [];
  let current = '';
  for (let line of lines) {
    if (line.length > MAX_TELEGRAM_TEXT) {
      const chunks = line.match(new RegExp(`.{1,${MAX_TELEGRAM_TEXT}}`, 'gs')) || [line];
      for (const chunk of chunks) {
        if (current) { parts.push(current); current = ''; }
        parts.push(chunk);
      }
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_TELEGRAM_TEXT) {
      if (current) parts.push(current);
      current = line;
    } else current = next;
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
};

async function getStoreSettings() {
  const row = await getFromStore('settings', 'store_config').catch(() => null);
  return row || {};
}

function enabledRecipients(settings = {}) {
  if (settings.telegramEnabled === false) return [];
  return normalizeTelegramRecipients(Array.isArray(settings.telegramRecipients)?settings.telegramRecipients:[settings.telegramChatId||settings.telegramChatID||'']).filter(x => x.enabled !== false);
}

async function botRequest(method, payload) {
  // Same direct Bot API transport as payment and image uploads: exact configured chat_id.
  const form=new FormData();
  for(const [key,value] of Object.entries(payload||{})){if(value!==undefined&&value!==null)form.append(key,typeof value==='object'?JSON.stringify(value):String(value));}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{const response=await fetch(`${API_ROOT}/${method}`,{method:'POST',body:form,cache:'no-store',signal:controller.signal});const data=await response.json().catch(()=>({}));if(!response.ok||data?.ok!==true)throw new Error(data?.description||data?.error||`Telegram HTTP ${response.status}`);return data}finally{clearTimeout(timer)}
}

export async function resolveTelegramUsername(username, { linkToken = '' } = {}) {
  const normalized = normalizeUsername(username);
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(normalized)) {
    throw new Error('اكتب يوزر Telegram صحيح مثل @username');
  }
  const wanted = normalized.slice(1).toLowerCase();
  let lastTelegramError = '';

  // 0) لو كان اليوزر مربوطاً سابقاً على نفس الجهاز، استخدم الـ Chat ID المحفوظ فوراً.
  try {
    const settings = await getStoreSettings();
    const cached = normalizeTelegramRecipients(settings.telegramRecipients).find((r) =>
      String(r.username || '').replace(/^@+/, '').toLowerCase() === wanted && normalizeId(r.chatId)
    );
    if (cached) return { chatId:String(cached.chatId), username:normalizeUsername(cached.username || normalized), name:String(cached.label || '').trim() };
  } catch {}

  // 1) المسار المفضل: خادم كاش توب 3 يحتفظ بقائمة مستخدمي البوت التي تم التقاطها من Telegram.
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch('./api/telegram/resolve', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ username:normalized, linkToken:String(linkToken || '') }),
      cache:'no-store',
      signal:controller.signal,
    });
    clearTimeout(timer);
    const type = String(response.headers?.get?.('content-type') || '');
    const data = /json/i.test(type) ? await response.json().catch(() => ({})) : {};
    if (response.ok && data?.ok && data?.result?.chatId) {
      return {
        chatId:String(data.result.chatId),
        username:normalizeUsername(data.result.username || normalized),
        name:String(data.result.name || data.result.firstName || '').trim(),
      };
    }
    if (data?.error) lastTelegramError = String(data.error);
  } catch (error) {
    if (error?.name !== 'AbortError') lastTelegramError = String(error?.message || lastTelegramError || '');
  }

  // 2) حاول قراءة سجل المستخدمين من الخادم مباشرة؛ هذا يفيد عندما تم استهلاك تحديث /start مسبقاً.
  try {
    const response = await fetch('./api/telegram/users', { cache:'no-store' });
    const type = String(response.headers?.get?.('content-type') || '');
    const data = /json/i.test(type) ? await response.json().catch(() => ({})) : {};
    const users = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : []);
    const row = users.find((item) => String(item?.username || item?.user_name || item?.telegram_username || '').replace(/^@+/, '').toLowerCase() === wanted);
    const chatId = normalizeId(row?.chatId ?? row?.chat_id ?? row?.id);
    if (row && chatId) {
      return { chatId, username:normalizeUsername(row.username || row.user_name || row.telegram_username || normalized), name:String(row.name || row.firstName || row.first_name || '').trim() };
    }
  } catch {}

  // 3) لو البوت مربوط بـ Webhook خارجي، حاول الاستفادة من سجل المستخدمين في نفس استضافة الـ Webhook.
  try {
    const infoRes = await fetch(`${API_ROOT}/getWebhookInfo`, { method:'GET', cache:'no-store' });
    const info = await infoRes.json().catch(() => ({}));
    const webhookUrl = String(info?.result?.url || '').trim();
    if (infoRes.ok && info?.ok && webhookUrl) {
      let origin = '';
      try { origin = new URL(webhookUrl).origin; } catch {}
      const candidates = origin ? [
        `${origin}/api/telegram/users`,
        `${origin}/api/users`,
        `${origin}/telegram/users`,
      ] : [];
      for (const endpoint of candidates) {
        try {
          const response = await fetch(endpoint, { cache:'no-store' });
          if (!response.ok) continue;
          const data = await response.json().catch(() => null);
          const users = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : (Array.isArray(data?.result) ? data.result : []));
          const row = users.find((item) => String(item?.username || item?.user_name || item?.telegram_username || '').replace(/^@+/, '').toLowerCase() === wanted);
          const chatId = normalizeId(row?.chatId ?? row?.chat_id ?? row?.telegram_id ?? row?.user_id ?? row?.id);
          if (row && chatId) {
            return { chatId, username:normalizeUsername(row.username || row.user_name || row.telegram_username || normalized), name:String(row.name || row.firstName || row.first_name || '').trim() };
          }
        } catch {}
      }
    }
  } catch {}

  // 4) محاولة getChat كمسار إضافي لبعض أنواع محادثات Telegram.
  try {
    const response = await fetch(`${API_ROOT}/getChat`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chat_id:normalized }), cache:'no-store'
    });
    const data = await response.json().catch(() => ({}));
    const chat = data?.result || {};
    const foundUsername = String(chat?.username || '').trim();
    if (response.ok && data?.ok && chat?.id && (!foundUsername || foundUsername.toLowerCase() === wanted)) {
      return { chatId:String(chat.id), username:normalizeUsername(foundUsername || normalized), name:String(chat.first_name || chat.title || '').trim() };
    }
  } catch {}

  // 5) Fallback للاستضافة الثابتة: نفحص تحديثات البوت الحديثة مباشرة.
  // عند الربط الجديد نبحث أيضاً عن كود start فريد، لذلك لا نعتمد على بقاء تحديث Start القديم.
  try {
    const response = await fetch(`${API_ROOT}/getUpdates`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ limit:100, timeout:0, allowed_updates:['message','edited_message','callback_query'] }),
      cache:'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      lastTelegramError = String(data?.description || data?.error || `Telegram HTTP ${response.status}`);
    } else if (Array.isArray(data.result)) {
      for (let i=data.result.length-1; i>=0; i--) {
        const update = data.result[i] || {};
        const msg = update.message || update.edited_message || update.callback_query?.message;
        const chat = msg?.chat || {};
        const from = update.callback_query?.from || msg?.from || {};
        const foundUsername = String(chat.username || from.username || '').trim();
        const chatId = chat.id || (chat.type === 'private' ? from.id : null);
        const text = String(msg?.text || '').trim();
        const tokenMatched = !!linkToken && (text === `/start ${linkToken}` || text.includes(String(linkToken)));
        const usernameMatched = foundUsername && foundUsername.toLowerCase() === wanted;
        if (chatId && (tokenMatched || usernameMatched)) {
          return {
            chatId:String(chatId),
            username:normalizeUsername(foundUsername || normalized),
            name:String(chat.first_name || from.first_name || '').trim(),
          };
        }
      }
    }
  } catch (error) {
    lastTelegramError = String(error?.message || lastTelegramError || '');
  }

  const webhookConflict = /webhook|conflict|409/i.test(lastTelegramError);
  if (webhookConflict) {
    throw new Error(`تعذر قراءة مستخدمي البوت لأن Telegram مربوط حالياً باستضافة Webhook أخرى. سنعيد محاولة الربط برسالة Start جديدة.`);
  }
  throw new Error(lastTelegramError || `لم أجد ${normalized} ضمن مستخدمي البوت بعد.`);
}

const telegramLinkToken = () => `oscar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`.replace(/[^A-Za-z0-9_-]/g,'').slice(0,60);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ربط موثوق: إن لم يعد تحديث /start القديم موجوداً، نولّد Start جديداً بكود فريد وننتظر التقاطه.
export async function linkTelegramUsername(username, { timeoutMs = 70000, onLinkRequired = null } = {}) {
  const normalized = normalizeUsername(username);
  try {
    return await resolveTelegramUsername(normalized);
  } catch (firstError) {
    const linkToken = telegramLinkToken();
    const deepLink = `${TELEGRAM_BOT_URL}?start=${encodeURIComponent(linkToken)}`;
    try { if (typeof onLinkRequired === 'function') onLinkRequired({ deepLink, linkToken, error:firstError }); } catch {}
    try {
      if (typeof window !== 'undefined' && window?.open) window.open(deepLink, '_blank', 'noopener');
    } catch {}

    const deadline = Date.now() + Math.max(15000, Number(timeoutMs) || 70000);
    let lastError = firstError;
    while (Date.now() < deadline) {
      await sleep(2200);
      try {
        const resolved = await resolveTelegramUsername(normalized, { linkToken });
        if (resolved?.chatId) return resolved;
      } catch (error) { lastError = error; }
    }
    const detail = String(lastError?.message || '').trim();
    throw new Error(`لم يكتمل ربط ${normalized}. افتح @${TELEGRAM_BOT_USERNAME} من الرابط الذي ظهر، واضغط Start ثم ارجع للبرنامج وأعد المحاولة.${detail ? ` (${detail})` : ''}`);
  }
}

async function sendTextToChat(chatId, text, { silent=false } = {}) {
  const parts = splitTelegramText(text);
  const results = [];
  for (const part of parts) {
    const data = await botRequest('sendMessage', {
      chat_id: normalizeId(chatId),
      text: part,
      disable_web_page_preview: true,
      disable_notification: !!silent,
    });
    results.push(data?.result || data);
  }
  return results;
}


async function sendPhotoToChat(chatId, photoDataUrl, { caption='', filename='oskar.png', silent=false } = {}) {
  const form = new FormData();
  form.append('chat_id', normalizeId(chatId));
  if (caption) form.append('caption', String(caption).slice(0, 1024));
  if (silent) form.append('disable_notification', 'true');
  form.append('photo', dataUrlToBlob(photoDataUrl), filename || 'oskar.png');
  const response = await fetch(`${API_ROOT}/sendPhoto`, { method:'POST', body:form, cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.description || data?.error || `Telegram HTTP ${response.status}`);
  return data;
}

function dataUrlToBlob(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('تعذر تجهيز الصورة للإرسال');
  const mime = match[1] || 'image/png';
  const body = match[3] || '';
  const bytes = match[2] ? atob(body) : decodeURIComponent(body);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type:mime });
}

async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) throw new Error('ملف غير صالح للإرسال');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(blob);
  });
}

async function sendDocumentToChat(chatId, blob, { caption='', filename='oscar-file.bin', silent=false } = {}) {
  if (!(blob instanceof Blob)) throw new Error('تعذر تجهيز الملف للإرسال');
  if (!normalizeId(chatId)) throw new Error('Chat ID غير صالح');
  // Telegram Bot API currently accepts large documents, but keep browser memory sane.
  if (blob.size > 49 * 1024 * 1024) throw new Error('حجم الملف أكبر من الحد المسموح للإرسال عبر البوت');

  const form = new FormData();
  form.append('chat_id', normalizeId(chatId));
  if (caption) form.append('caption', String(caption).slice(0, 1024));
  if (silent) form.append('disable_notification', 'true');
  form.append('document', blob, filename || 'oscar-file.bin');
  const response = await fetch(`${API_ROOT}/sendDocument`, { method:'POST', body:form, cache:'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.description || data?.error || `Telegram HTTP ${response.status}`);
  return data;
}

export async function sendTelegramTextToRecipients(text, { settings=null, silent=false } = {}) {
  return deliverToRecipients(text, { settings, queueOnFailure:false, silent });
}

export async function sendTelegramPhotoBlobToRecipients(blob, { settings=null, caption='', filename='oscar.png', silent=false } = {}) {
  const config = settings || await getStoreSettings();
  const recipients = enabledRecipients(config);
  if (!recipients.length) return { ok:false, skipped:true, reason:'NO_RECIPIENTS', sent:0, failed:0 };
  const dataUrl = await blobToDataUrl(blob);
  return deliverPhotoDataUrlToRecipients(dataUrl, { settings:config, caption, filename, silent });
}

export async function sendTelegramDocumentBlobToRecipients(blob, { settings=null, caption='', filename='oscar-file.bin', silent=false } = {}) {
  const config = settings || await getStoreSettings();
  const recipients = enabledRecipients(config);
  if (!recipients.length) return { ok:false, skipped:true, reason:'NO_RECIPIENTS', sent:0, failed:0 };
  let sent = 0;
  const failures = [];
  for (const recipient of recipients) {
    try {
      await sendDocumentToChat(recipient.chatId, blob, { caption, filename, silent });
      sent += 1;
    } catch (error) {
      failures.push({ chatId:recipient.chatId, username:recipient.username || '', error:String(error?.message || error) });
    }
  }
  return failures.length ? { ok:false, sent, failed:failures.length, failures } : { ok:true, sent, failed:0 };
}

async function canvasToDataUrl(canvas, type='image/png', quality=0.95) {
  if (!canvas) throw new Error('لا يوجد محتوى صورة');
  if (typeof canvas.toDataURL === 'function') return canvas.toDataURL(type, quality);
  throw new Error('تعذر تحويل الصورة');
}

async function deliverPhotoDataUrlToRecipients(photoDataUrl, { settings=null, caption='', filename='oskar.png', silent=false } = {}) {
  const config = settings || await getStoreSettings();
  const recipients = enabledRecipients(config);
  if (!recipients.length) return { ok:false, skipped:true, reason:'NO_RECIPIENTS', sent:0, failed:0 };
  let sent = 0;
  const failures = [];
  for (const recipient of recipients) {
    try {
      await sendPhotoToChat(recipient.chatId, photoDataUrl, { caption, filename, silent });
      sent += 1;
    } catch (error) {
      failures.push({ chatId:recipient.chatId, error:String(error?.message || error) });
    }
  }
  return failures.length ? { ok:false, sent, failed:failures.length, failures } : { ok:true, sent, failed:0 };
}

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, color='#0f172a', font='600 22px Cairo, Arial', align='right') {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = align;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else current = test;
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push('');
  lines.forEach((line, idx) => ctx.fillText(line, x, y + idx * lineHeight));
  return y + lines.length * lineHeight;
}

async function renderSummaryCanvas({ title='', subtitle='', lines=[], accent='#0ea5e9', settings={}, footer='' } = {}) {
  try { await document.fonts?.ready; } catch {}
  const width = 1200;
  const margin = 56;
  const probe = document.createElement('canvas').getContext('2d');
  const allLines = Array.isArray(lines) ? lines.filter(Boolean).map(x => String(x)) : [];
  let estimated = 320;
  probe.font = '600 22px Cairo, Arial';
  for (const line of allLines) {
    const words = String(line).split(/\s+/).filter(Boolean);
    let current = '';
    let count = 0;
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (probe.measureText(test).width > width - margin * 2 - 40 && current) { count += 1; current = word; }
      else current = test;
    }
    if (current || !words.length) count += 1;
    estimated += count * 34 + 8;
  }
  estimated += footer ? 70 : 20;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.max(760, estimated);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const grad = ctx.createLinearGradient(0,0,canvas.width,0);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,canvas.width,160);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.arc(canvas.width - 130, 32, 180, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 42px Cairo, Arial';
  ctx.textAlign = 'right';
  ctx.fillText(String(title || settings?.storeName || 'كاش توب 3'), canvas.width - margin, 72);
  ctx.font = '600 22px Cairo, Arial';
  ctx.fillStyle = '#dbeafe';
  ctx.fillText(String(subtitle || settings?.storeName || ''), canvas.width - margin, 114);
  ctx.font = '700 18px Cairo, Arial';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(fmtDateTime(new Date()), canvas.width - margin, 144);

  let y = 220;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  const cardX = 34;
  const cardW = canvas.width - 68;
  const cardH = canvas.height - 260;
  const radius = 26;
  ctx.beginPath();
  ctx.moveTo(cardX + radius, y - 22);
  ctx.lineTo(cardX + cardW - radius, y - 22);
  ctx.quadraticCurveTo(cardX + cardW, y - 22, cardX + cardW, y - 22 + radius);
  ctx.lineTo(cardX + cardW, y - 22 + cardH - radius);
  ctx.quadraticCurveTo(cardX + cardW, y - 22 + cardH, cardX + cardW - radius, y - 22 + cardH);
  ctx.lineTo(cardX + radius, y - 22 + cardH);
  ctx.quadraticCurveTo(cardX, y - 22 + cardH, cardX, y - 22 + cardH - radius);
  ctx.lineTo(cardX, y - 22 + radius);
  ctx.quadraticCurveTo(cardX, y - 22, cardX + radius, y - 22);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  for (const line of allLines) {
    y = drawWrapped(ctx, line, canvas.width - margin - 14, y, canvas.width - margin * 2 - 28, 32, '#0f172a', '600 22px Cairo, Arial', 'right') + 10;
  }
  if (footer) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 18px Cairo, Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(footer), canvas.width / 2, canvas.height - 36);
  }
  return canvas;
}

async function buildNotificationCanvas(detail, settings) {
  const row = detail?.value || detail?.before || {};
  const text = formatMutationMessage(detail, settings);
  if (!text) return null;
  if (detail?.storeName === 'vouchers') {
    return renderVoucherCanvas(row, settings, { paperSize:'a4' });
  }
  const lines = text.split('\n').filter(Boolean);
  const title = lines.shift() || 'إشعار كاش توب 3';
  return renderSummaryCanvas({
    title,
    subtitle: settings?.storeName || 'كاش توب 3',
    lines: lines.slice(0, 24),
    accent: detail?.storeName === 'expenses' ? '#dc2626' : detail?.storeName === 'customers' ? '#0284c7' : '#0ea5e9',
    settings,
    footer: 'إشعار تلقائي من نظام كاش توب 3'
  });
}

async function sendCanvasToRecipients(canvas, { settings=null, caption='', filename='oskar.png', silent=false } = {}) {
  const dataUrl = await canvasToDataUrl(canvas, 'image/png', 0.95);
  return deliverPhotoDataUrlToRecipients(dataUrl, { settings, caption, filename, silent });
}

async function buildReportImageCards(data, settings, periodHours=24) {
  const symbol = settings?.currencySymbol || '₪';
  const now = Date.now();
  const since = now - Math.max(1, asNumber(periodHours) || 24) * 3600000;
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const customers = Array.isArray(data.customers) ? data.customers : [];
  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  const products = (Array.isArray(data.products) ? data.products : []).filter(p => !p?.deletedAt && p?.status !== 'archived');
  const stock = Array.isArray(data.stock) ? data.stock : [];
  const warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  const vouchers = Array.isArray(data.vouchers) ? data.vouchers : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const heldInvoices = Array.isArray(data.held_invoices) ? data.held_invoices : [];
  const auditLogs = Array.isArray(data.audit_logs) ? data.audit_logs : [];
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const recentSales = invoices.filter(x => x?.type === 'sale' && !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentReturns = invoices.filter(x => x?.type === 'return' && !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentPurchases = purchases.filter(x => !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentExpenses = expenses.filter(x => !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentVouchers = vouchers.filter(x => dateMs(x.date || x.createdAt) >= since);
  const recentTransfers = transfers.filter(x => dateMs(x.date || x.createdAt) >= since);
  const recentAuditLogs = auditLogs.filter(x => dateMs(x.timestamp || x.date || x.createdAt) >= since);
  const salesGross = recentSales.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const returnsTotal = recentReturns.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const netSales = salesGross - returnsTotal;
  const purchasesTotal = recentPurchases.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const expensesTotal = recentExpenses.reduce((s,x)=>s+asNumber(x.amount),0);
  const receiptsTotal = recentVouchers.filter(x=>x?.type==='receipt').reduce((s,x)=>s+asNumber(x.amount),0);
  const paymentsTotal = recentVouchers.filter(x=>x?.type==='payment').reduce((s,x)=>s+asNumber(x.amount),0);
  const transfersTotal = recentTransfers.reduce((s,x)=>s+asNumber(x.amount),0);
  const customerDebts = customers.filter(c=>!c?.deletedAt && asNumber(c.balance)>0).sort((a,b)=>asNumber(b.balance)-asNumber(a.balance));
  const supplierDebts = suppliers.filter(s=>!s?.deletedAt && asNumber(s.balance)>0).sort((a,b)=>asNumber(b.balance)-asNumber(a.balance));
  const productStockMap = new Map();
  for (const row of stock) {
    const qty = asNumber(row.baseQuantity ?? row.quantity);
    productStockMap.set(row.productId, (productStockMap.get(row.productId)||0) + qty);
  }
  const lowStock = products.filter(p => p.reorderPoint !== undefined && (productStockMap.get(p.id)||0) <= asNumber(p.reorderPoint));
  const outOfStock = products.filter(p => (productStockMap.get(p.id)||0) <= 0);
  const inventoryCostValue = products.reduce((s,p)=>s + Math.max(0,productStockMap.get(p.id)||0)*asNumber(p.costPrice),0);
  const liveAccounts = accounts.filter(a=>!a?.deletedAt);

  const cards = [];
  cards.push(await renderSummaryCanvas({
    title:`📊 تقرير شامل — آخر ${periodHours} ساعة`,
    subtitle: settings?.storeName || 'كاش توب 3',
    accent:'#0284c7',
    settings,
    lines:[
      `• فواتير البيع: ${recentSales.length} | ${money(salesGross,symbol)}`,
      `• المرتجعات: ${recentReturns.length} | ${money(returnsTotal,symbol)}`,
      `• صافي المبيعات: ${money(netSales,symbol)}`,
      `• المشتريات: ${recentPurchases.length} | ${money(purchasesTotal,symbol)}`,
      `• المصروفات: ${recentExpenses.length} | ${money(expensesTotal,symbol)}`,
      `• سندات القبض: ${money(receiptsTotal,symbol)}`,
      `• سندات الصرف: ${money(paymentsTotal,symbol)}`,
      `• التحويلات بين الحسابات: ${money(transfersTotal,symbol)}`,
    ],
    footer:'تم الإنشاء تلقائياً من نظام كاش توب 3'
  }));
  cards.push(await renderSummaryCanvas({
    title:'👥 العملاء والموردون والحسابات',
    subtitle: `إجمالي العملاء ${customers.filter(c=>!c?.deletedAt).length} • الموردون ${suppliers.filter(s=>!s?.deletedAt).length}`,
    accent:'#7C3AED',
    settings,
    lines:[
      `• عملاء عليهم رصيد: ${customerDebts.length} | ${money(customerDebts.reduce((s,c)=>s+asNumber(c.balance),0),symbol)}`,
      ...customerDebts.slice(0,8).map((c,i)=>`${i+1}) ${c.name || 'عميل'}: ${money(c.balance,symbol)}`),
      `• إجمالي المستحق للموردين: ${money(supplierDebts.reduce((s,c)=>s+asNumber(c.balance),0),symbol)}`,
      ...supplierDebts.slice(0,6).map((c,i)=>`${i+1}) ${c.name || 'مورد'}: ${money(c.balance,symbol)}`),
      `• الحسابات المالية: ${liveAccounts.length} | إجمالي ${money(liveAccounts.reduce((sum,a)=>sum+asNumber(a.balance),0),symbol)}`,
    ],
    footer:'أرصدة وديون حتى لحظة الإرسال'
  }));
  cards.push(await renderSummaryCanvas({
    title:'📦 المخزون والمخازن',
    subtitle:`أصناف نشطة ${products.length} • أقسام ${categories.filter(c=>!c?.deletedAt).length}`,
    accent:'#ea580c',
    settings,
    lines:[
      `• قيمة المخزون بالتكلفة: ${money(inventoryCostValue,symbol)}`,
      `• أصناف ناقصة: ${lowStock.length}`,
      `• أصناف رصيدها صفر/سالب: ${outOfStock.length}`,
      `• المخازن/الفروع: ${warehouses.length}`,
      ...lowStock.slice(0,10).map((p,i)=>`${i+1}) ${p.name}: ${fmtQty(productStockMap.get(p.id)||0)} ${p.baseUnitName || 'وحدة'}`),
    ],
    footer:'ملخص المخزون الحالي'
  }));
  cards.push(await renderSummaryCanvas({
    title:'⚙️ التشغيل والإدارة',
    subtitle:'ملخص إداري وتشغيلي',
    accent:'#7c3aed',
    settings,
    lines:[
      `• الموظفون المسجلون: ${employees.filter(e=>!e?.deletedAt).length}`,
      `• الفواتير المعلقة حالياً: ${heldInvoices.filter(x=>!x?.deletedAt).length}`,
      `• الورديات المفتوحة: ${shifts.filter(s=>s?.status==='open').length}`,
      `• سجل العمليات خلال الفترة: ${recentAuditLogs.length}`,
      `• إجمالي فواتير البيع بالنظام: ${invoices.filter(x=>x?.type==='sale').length}`,
      `• إجمالي المرتجعات بالنظام: ${invoices.filter(x=>x?.type==='return').length}`,
      `• إجمالي فواتير المشتريات بالنظام: ${purchases.length}`,
    ],
    footer:'ملخص عام لكل ما يخص الموقع'
  }));
  return cards;
}

function enqueueOutbox(item) {
  const rows = readLocalArray(outboxKey());
  const key = String(item?.key || '');
  if (key && rows.some(x => x?.key === key)) return;
  rows.push({ ...item, id:item?.id || `tgq-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, queuedAt:Date.now(), tries:0 });
  writeLocalArray(outboxKey(), rows, OUTBOX_LIMIT);
}
function wasSent(key) {
  if (!key) return false;
  return readLocalArray(sentKey()).includes(key);
}
function markSent(key) {
  if (!key) return;
  const rows = readLocalArray(sentKey()).filter(x => x !== key);
  rows.push(key);
  writeLocalArray(sentKey(), rows, SENT_LIMIT);
}

async function deliverToRecipients(text, { settings=null, key='', queueOnFailure=true, silent=false } = {}) {
  const config = settings || await getStoreSettings();
  const recipients = enabledRecipients(config);
  if (!recipients.length) return { ok:false, skipped:true, reason:'NO_RECIPIENTS', sent:0, failed:0 };
  if (key && wasSent(key)) return { ok:true, duplicate:true, sent:0, failed:0 };
  let sent = 0;
  const failures = [];
  for (const recipient of recipients) {
    try {
      await sendTextToChat(recipient.chatId, text, { silent });
      sent += 1;
    } catch (error) {
      failures.push({ chatId:recipient.chatId, error:String(error?.message || error) });
    }
  }
  if (failures.length) {
    if (queueOnFailure) enqueueOutbox({ type:'broadcast', text, key, silent, recipients:failures.map(x => x.chatId) });
    return { ok:false, sent, failed:failures.length, failures };
  }
  if (key) markSent(key);
  return { ok:true, sent, failed:0 };
}

export async function flushTelegramOutbox() {
  if (flushing) return { ok:false, busy:true };
  flushing = true;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok:false, offline:true };
    const settings = await getStoreSettings();
    if (!enabledRecipients(settings).length) return { ok:false, skipped:true };
    let queue = readLocalArray(outboxKey());
    const kept = [];
    let sent = 0;
    for (const item of queue) {
      if (!item?.text) continue;
      const targetRecipients = Array.isArray(item.recipients) && item.recipients.length
        ? normalizeTelegramRecipients(item.recipients.map(chatId => ({chatId, enabled:true}))).filter(r=>enabledRecipients(settings).some(active=>active.chatId===r.chatId))
        : enabledRecipients(settings);
      const failedIds=[];
      for (const recipient of targetRecipients) {
        try { await sendTextToChat(recipient.chatId, item.text, { silent:!!item.silent }); }
        catch { failedIds.push(recipient.chatId); }
      }
      if (failedIds.length) {
        kept.push({ ...item, recipients:failedIds, tries:asNumber(item.tries)+1, lastTryAt:Date.now() });
      } else {
        sent += 1;
        if (item.key) markSent(item.key);
      }
    }
    writeLocalArray(outboxKey(), kept, OUTBOX_LIMIT);
    return { ok:kept.length===0, sent, pending:kept.length };
  } finally { flushing = false; }
}

export async function testTelegramRecipient(chatId) {
  const id = normalizeId(chatId);
  if (!id) throw new Error('أدخل Chat ID أولاً');
  const settings = await getStoreSettings();
  const storeName = String(settings.storeName || 'كاش توب 3');
  await sendTextToChat(id, `✅ تم إعداد ${storeName} بنجاح للإرسال إلى هذا Chat ID.\nستصل هنا إشعارات الحركات التي يفعّلها المدير وجميع التقارير حسب إعدادات البرنامج.`);
  return true;
}

export async function testAllTelegramRecipients() {
  const settings = await getStoreSettings();
  const recipients = enabledRecipients(settings);
  if (!recipients.length) throw new Error('لا يوجد أي Chat ID مضاف');
  const storeName = String(settings.storeName || 'كاش توب 3');
  return deliverToRecipients(`✅ اختبار ربط Telegram\nالنظام: ${storeName}\nالوقت: ${fmtDateTime(new Date())}`, { settings, queueOnFailure:false });
}

function invoiceTitle(invoice, typeHint='') {
  if (typeHint === 'purchase' || String(invoice?.invoiceNumber || '').startsWith('PUR-')) return '📥 فاتورة مشتريات جديدة';
  if (invoice?.type === 'return' || typeHint === 'return') return '↩️ مرتجع مبيعات جديد';
  return '🧾 فاتورة مبيعات جديدة';
}

function formatInvoiceMessage(invoice, settings, typeHint='') {
  const symbol = settings?.currencySymbol || '₪';
  const type = typeHint || (invoice?.type === 'return' ? 'return' : (String(invoice?.invoiceNumber||'').startsWith('PUR-') ? 'purchase' : 'sale'));
  const rows = [];
  rows.push(invoiceTitle(invoice, type));
  rows.push(`🏪 ${settings?.storeName || 'كاش توب 3'}`);
  rows.push(`رقم الفاتورة: ${invoice?.invoiceNumber || invoice?.id || '-'}`);
  if (invoice?.supplierInvoiceNumber) rows.push(`رقم فاتورة المورد: ${invoice.supplierInvoiceNumber}`);
  rows.push(`التاريخ: ${fmtDateTime(invoice?.date || invoice?.createdAt)}`);
  if (type === 'purchase') rows.push(`المورد: ${invoice?.supplierName || '-'}`);
  else rows.push(`العميل: ${invoice?.customerName || '-'}`);
  if (invoice?.cashierName) rows.push(`الكاشير: ${invoice.cashierName}`);
  if (invoice?.warehouseName) rows.push(`المخزن: ${invoice.warehouseName}`);
  rows.push('');
  rows.push('الأصناف:');
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  items.forEach((item, idx) => {
    const qty = fmtQty(item?.quantity);
    const unit = item?.unitName || 'وحدة';
    const unitPrice = money(item?.unitPrice, symbol);
    const total = money(item?.total ?? (asNumber(item?.quantity)*asNumber(item?.unitPrice)), symbol);
    rows.push(`${idx+1}) ${item?.productName || item?.name || 'صنف'} — ${qty} ${unit} × ${unitPrice} = ${total}`);
  });
  if (!items.length) rows.push('لا توجد تفاصيل أصناف محفوظة.');
  rows.push('');
  rows.push(`الإجمالي قبل الخصم: ${money(invoice?.subtotal, symbol)}`);
  if (asNumber(invoice?.discountTotal) || asNumber(invoice?.invoiceDiscountAmount)) rows.push(`الخصم: ${money(asNumber(invoice?.discountTotal)||asNumber(invoice?.invoiceDiscountAmount), symbol)}`);
  if (asNumber(invoice?.taxTotal)) rows.push(`الضريبة: ${money(invoice.taxTotal, symbol)}`);
  rows.push(`الإجمالي النهائي: ${money(invoice?.grandTotal, symbol)}`);
  rows.push(`المدفوع: ${money(invoice?.paidAmount, symbol)}`);
  if (asNumber(invoice?.remainingAmount)) rows.push(`المتبقي: ${money(invoice.remainingAmount, symbol)}`);
  if (asNumber(invoice?.changeAmount)) rows.push(`الباقي للعميل: ${money(invoice.changeAmount, symbol)}`);
  if (invoice?.paymentType) rows.push(`طريقة الدفع: ${invoice.paymentType}`);
  if (invoice?.notes) rows.push(`ملاحظات: ${invoice.notes}`);
  return rows.join('\n');
}

export async function notifyTelegramInvoice(invoice, typeHint='') {
  try {
    if (!invoice?.id) return { ok:false, skipped:true };
    const settings = await getStoreSettings();
    if (settings.telegramEnabled === false) return { ok:false, skipped:true };
    const type = typeHint || (invoice?.type === 'return' ? 'return' : (String(invoice?.invoiceNumber||'').startsWith('PUR-') ? 'purchase' : 'sale'));
    if (type === 'sale' && settings.telegramInvoiceNotifications === false) return { ok:false, skipped:true };
    if (type === 'purchase' && settings.telegramPurchaseNotifications === false) return { ok:false, skipped:true };
    if (type === 'return' && settings.telegramReturnNotifications === false) return { ok:false, skipped:true };
    const text = formatInvoiceMessage(invoice, settings, type);
    const result = await deliverToRecipients(text, { settings, key:`invoice:${type}:${invoice.id}` });
    if (settings.telegramSendImages !== false) {
      try {
        const canvas = await renderInvoiceCanvas(invoice, settings, { paperSize:'a4' });
        const caption = `${invoiceTitle(invoice, type)}
رقم: ${invoice?.invoiceNumber || invoice?.id || '-'}
${type === 'purchase' ? `المورد: ${invoice?.supplierName || '-'}` : `العميل: ${invoice?.customerName || '-'}`}`;
        await sendCanvasToRecipients(canvas, {
          settings,
          caption,
          filename: `${type}-${invoice?.invoiceNumber || invoice?.id || 'invoice'}.png`,
        });
      } catch (imgError) {
        console.warn('Telegram invoice image notification failed', imgError);
      }
    }
    return result;
  } catch (error) {
    console.warn('Telegram invoice notification failed', error);
    return { ok:false, error:String(error?.message || error) };
  }
}

const TELEGRAM_MUTATION_RULES = {
  customers: { setting:'telegramNotifyCustomers', label:'العملاء', icon:'👤' },
  suppliers: { setting:'telegramNotifySuppliers', label:'الموردون', icon:'🚚' },
  vouchers: { setting:'telegramNotifyVouchers', label:'سندات القبض والصرف', icon:'💵' },
  expenses: { setting:'telegramNotifyExpenses', label:'المصروفات', icon:'💸' },
  transfers: { setting:'telegramNotifyTransfers', label:'التحويلات المالية', icon:'🔁' },
  accounts: { setting:'telegramNotifyAccounts', label:'الحسابات المالية', icon:'🏦' },
  products: { setting:'telegramNotifyProducts', label:'الأصناف', icon:'📦' },
  categories: { setting:'telegramNotifyProducts', label:'أقسام الأصناف', icon:'🗂️' },
  stock_movements: { setting:'telegramNotifyInventory', label:'حركات المخزون', icon:'📊' },
  warehouses: { setting:'telegramNotifyWarehouses', label:'المخازن والفروع', icon:'🏬' },
  employees: { setting:'telegramNotifyEmployees', label:'الموظفون', icon:'👨‍💼' },
  shifts: { setting:'telegramNotifyShifts', label:'الورديات', icon:'🧾' },
  held_invoices: { setting:'telegramNotifyHeldInvoices', label:'الفواتير المعلقة', icon:'⏸️' },
  restaurant_orders: { setting:'telegramNotifyRestaurant', label:'طلبات المطعم', icon:'🍽️' },
  table_reservations: { setting:'telegramNotifyRestaurant', label:'حجوزات الطاولات', icon:'🪑' },
  waste_records: { setting:'telegramNotifyInventory', label:'التالف والهالك', icon:'🗑️' },
  recipes: { setting:'telegramNotifyProducts', label:'الوصفات والتصنيع', icon:'🧪' },
  audit_logs: { setting:'telegramNotifyAuditLogs', label:'سجل العمليات', icon:'🛡️' },
};

const actionArabic = (action) => action === 'delete' ? 'حذف' : action === 'update' ? 'تعديل' : 'إضافة';
const rowDate = (row) => row?.date || row?.createdAt || row?.updatedAt || row?.timestamp || new Date().toISOString();
const rowId = (row, fallback='') => row?.id || row?.invoiceNumber || row?.voucherNumber || row?.code || fallback || '-';
const compactText = (value, max=180) => {
  const t = String(value ?? '').trim().replace(/\s+/g,' ');
  return t.length > max ? `${t.slice(0,max-1)}…` : t;
};

function invoiceMutationRule(value, storeName) {
  if (storeName === 'purchases') return { setting:'telegramPurchaseNotifications', label:'المشتريات', icon:'📥', type:'purchase' };
  if (storeName !== 'invoices') return null;
  const type = value?.type === 'return' ? 'return' : 'sale';
  return type === 'return'
    ? { setting:'telegramReturnNotifications', label:'المرتجعات', icon:'↩️', type }
    : { setting:'telegramInvoiceNotifications', label:'المبيعات', icon:'🧾', type };
}

function formatMutationMessage(detail, settings) {
  const { storeName, action } = detail || {};
  const row = detail?.value || detail?.before || {};
  const symbol = settings?.currencySymbol || '₪';
  const invoiceRule = invoiceMutationRule(row, storeName);
  const rule = invoiceRule || TELEGRAM_MUTATION_RULES[storeName];
  if (!rule) return null;
  const lines = [`${rule.icon} ${actionArabic(action)} — ${rule.label}`, `🏪 ${settings?.storeName || 'كاش توب 3'}`, `🕒 ${fmtDateTime(rowDate(row))}`];

  if (storeName === 'invoices' || storeName === 'purchases') {
    lines.push(`رقم الفاتورة: ${row?.invoiceNumber || row?.id || '-'}`);
    lines.push(`${storeName === 'purchases' ? 'المورد' : 'العميل'}: ${row?.supplierName || row?.customerName || '-'}`);
    lines.push(`الإجمالي: ${money(row?.grandTotal, symbol)}`);
    if (row?.paidAmount !== undefined) lines.push(`المدفوع: ${money(row.paidAmount, symbol)}`);
    if (asNumber(row?.remainingAmount)) lines.push(`المتبقي: ${money(row.remainingAmount, symbol)}`);
  } else if (storeName === 'vouchers') {
    lines[0] = `${row?.type === 'receipt' ? '📥 سند قبض' : '📤 سند صرف'} — ${actionArabic(action)}`;
    lines.push(`رقم السند: ${row?.voucherNumber || row?.id || '-'}`);
    lines.push(`الطرف: ${row?.partyName || '-'}`);
    lines.push(`المبلغ: ${money(row?.amount, symbol)}`);
    if (row?.accountName) lines.push(`الحساب: ${row.accountName}`);
    if (row?.userName) lines.push(`بواسطة: ${row.userName}`);
  } else if (storeName === 'expenses') {
    lines.push(`البند: ${row?.category || row?.type || 'مصروف'}`);
    lines.push(`المبلغ: ${money(row?.amount, symbol)}`);
    if (row?.accountName) lines.push(`الحساب: ${row.accountName}`);
    if (row?.userName) lines.push(`بواسطة: ${row.userName}`);
  } else if (storeName === 'transfers') {
    lines.push(`من: ${row?.fromAccountName || row?.fromAccountId || '-'}`);
    lines.push(`إلى: ${row?.toAccountName || row?.toAccountId || '-'}`);
    lines.push(`المبلغ: ${money(row?.amount, symbol)}`);
    if (row?.userName) lines.push(`بواسطة: ${row.userName}`);
  } else if (storeName === 'customers' || storeName === 'suppliers') {
    lines.push(`الاسم: ${row?.name || '-'}`);
    if (row?.phone) lines.push(`الهاتف: ${row.phone}`);
    if (row?.balance !== undefined) lines.push(`الرصيد الحالي: ${money(row.balance, symbol)}`);
    if (row?.openingBalance !== undefined && asNumber(row.openingBalance)) lines.push(`الرصيد الافتتاحي: ${money(row.openingBalance, symbol)}`);
  } else if (storeName === 'accounts') {
    lines.push(`الحساب: ${row?.name || '-'}`);
    if (row?.type) lines.push(`النوع: ${row.type}`);
    lines.push(`الرصيد: ${money(row?.balance, symbol)}`);
  } else if (storeName === 'products') {
    lines.push(`الصنف: ${row?.name || '-'}`);
    if (row?.sku) lines.push(`SKU: ${row.sku}`);
    if (row?.barcode) lines.push(`الباركود: ${row.barcode}`);
    if (row?.sellingPrice !== undefined) lines.push(`سعر البيع: ${money(row.sellingPrice, symbol)}`);
    if (row?.costPrice !== undefined) lines.push(`التكلفة: ${money(row.costPrice, symbol)}`);
  } else if (storeName === 'stock_movements') {
    lines.push(`الصنف: ${row?.productName || row?.itemName || row?.productId || '-'}`);
    if (row?.warehouseName || row?.warehouseId) lines.push(`المخزن: ${row?.warehouseName || row?.warehouseId}`);
    const delta = row?.baseQuantityChange ?? row?.quantityChange ?? row?.quantity;
    if (delta !== undefined) lines.push(`الحركة: ${asNumber(delta) >= 0 ? '+' : ''}${fmtQty(delta)} ${row?.unitName || row?.baseUnitName || 'وحدة'}`);
    if (row?.newBaseBalance !== undefined) lines.push(`الرصيد بعد الحركة: ${fmtQty(row.newBaseBalance)}`);
    if (row?.reason || row?.referenceType) lines.push(`السبب: ${row?.reason || row?.referenceType}`);
  } else if (storeName === 'warehouses') {
    lines.push(`المخزن/الفرع: ${row?.name || '-'}`);
    if (row?.code) lines.push(`الكود: ${row.code}`);
  } else if (storeName === 'employees') {
    lines.push(`الموظف: ${row?.name || '-'}`);
    if (row?.roleName || row?.role) lines.push(`الدور: ${row?.roleName || row?.role}`);
    if (row?.phone) lines.push(`الهاتف: ${row.phone}`);
  } else if (storeName === 'shifts') {
    lines.push(`الموظف: ${row?.userName || row?.employeeName || row?.cashierName || '-'}`);
    lines.push(`الحالة: ${row?.status === 'open' ? 'مفتوحة' : row?.status === 'closed' ? 'مغلقة' : (row?.status || '-')}`);
    if (row?.openingCash !== undefined) lines.push(`رصيد البداية: ${money(row.openingCash, symbol)}`);
    if (row?.expectedCash !== undefined) lines.push(`النقد المتوقع: ${money(row.expectedCash, symbol)}`);
    if (row?.actualCash !== undefined) lines.push(`النقد الفعلي: ${money(row.actualCash, symbol)}`);
  } else if (storeName === 'held_invoices') {
    lines.push(`المرجع: ${row?.invoiceNumber || row?.name || row?.id || '-'}`);
    lines.push(`عدد الأصناف: ${Array.isArray(row?.items) ? row.items.length : 0}`);
    if (row?.grandTotal !== undefined) lines.push(`الإجمالي: ${money(row.grandTotal, symbol)}`);
  } else if (storeName === 'waste_records') {
    lines.push(`الصنف: ${row?.productName || row?.name || row?.productId || '-'}`);
    lines.push(`الكمية: ${fmtQty(row?.quantity || row?.baseQuantity || 0)}`);
    if (row?.reason) lines.push(`السبب: ${row.reason}`);
  } else if (storeName === 'restaurant_orders') {
    lines.push(`الطلب: ${row?.orderNumber || row?.id || '-'}`);
    if (row?.tableName || row?.tableNumber) lines.push(`الطاولة: ${row?.tableName || row?.tableNumber}`);
    if (row?.total !== undefined || row?.grandTotal !== undefined) lines.push(`الإجمالي: ${money(row?.grandTotal ?? row?.total, symbol)}`);
    if (row?.status) lines.push(`الحالة: ${row.status}`);
  } else if (storeName === 'table_reservations') {
    lines.push(`العميل: ${row?.customerName || row?.name || '-'}`);
    if (row?.tableName || row?.tableNumber) lines.push(`الطاولة: ${row?.tableName || row?.tableNumber}`);
    if (row?.reservationTime || row?.date) lines.push(`الموعد: ${fmtDateTime(row?.reservationTime || row?.date)}`);
  } else if (storeName === 'audit_logs') {
    lines.push(`العملية: ${row?.action || row?.type || '-'}`);
    if (row?.userName) lines.push(`المستخدم: ${row.userName}`);
    if (row?.description) lines.push(`التفاصيل: ${compactText(row.description)}`);
  } else {
    lines.push(`الاسم/المرجع: ${row?.name || rowId(row, detail?.key)}`);
  }
  if (row?.notes) lines.push(`ملاحظات: ${compactText(row.notes)}`);
  return lines.join('\n');
}

async function notifyTelegramMutation(detail) {
  try {
    if (!detail?.storeName || detail?.bulk) return { ok:false, skipped:true };
    if (['settings','sync_queue','stock','partner_statements'].includes(detail.storeName)) return { ok:false, skipped:true };
    const row = detail?.value || detail?.before || {};
    const invoiceRule = invoiceMutationRule(row, detail.storeName);
    const rule = invoiceRule || TELEGRAM_MUTATION_RULES[detail.storeName];
    if (!rule) return { ok:false, skipped:true };
    // New invoices use the dedicated detailed formatter called from the save flow.
    if (detail.action === 'add' && (detail.storeName === 'invoices' || detail.storeName === 'purchases')) return { ok:false, skipped:true };
    const settings = await getStoreSettings();
    if (settings.telegramEnabled === false || settings[rule.setting] === false) return { ok:false, skipped:true };
    const text = formatMutationMessage(detail, settings);
    if (!text) return { ok:false, skipped:true };
    const keyBase = rowId(row, Array.isArray(detail.key) ? detail.key.join(':') : detail.key);
    const stamp = String(row?.updatedAt || row?.createdAt || row?.date || detail?.at || Date.now());
    const result = await deliverToRecipients(text, { settings, key:`mutation:${detail.storeName}:${detail.action}:${keyBase}:${stamp}` });
    if (settings.telegramSendImages !== false) {
      try {
        const canvas = await buildNotificationCanvas(detail, settings);
        if (canvas) {
          const caption = `${actionArabic(detail.action)} — ${rule.label}`;
          await sendCanvasToRecipients(canvas, {
            settings,
            caption,
            filename: `${detail.storeName}-${detail.action}-${keyBase || 'item'}.png`,
          });
        }
      } catch (imgError) {
        console.warn('Telegram mutation image notification failed', imgError);
      }
    }
    return result;
  } catch (error) {
    console.warn('Telegram mutation notification failed', error);
    return { ok:false, error:String(error?.message || error) };
  }
}

const dateMs = (value) => {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

export function buildFullTelegramReportText(data, settings, periodHours=24) {
  const symbol = settings?.currencySymbol || '₪';
  const now = Date.now();
  const since = now - Math.max(1, asNumber(periodHours) || 24) * 3600000;
  const invoices = Array.isArray(data.invoices) ? data.invoices : [];
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  const expenses = Array.isArray(data.expenses) ? data.expenses : [];
  const customers = Array.isArray(data.customers) ? data.customers : [];
  const suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
  const products = (Array.isArray(data.products) ? data.products : []).filter(p => !p?.deletedAt && p?.status !== 'archived');
  const stock = Array.isArray(data.stock) ? data.stock : [];
  const warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  const vouchers = Array.isArray(data.vouchers) ? data.vouchers : [];
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  const stockMovements = Array.isArray(data.stock_movements) ? data.stock_movements : [];
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const heldInvoices = Array.isArray(data.held_invoices) ? data.held_invoices : [];
  const auditLogs = Array.isArray(data.audit_logs) ? data.audit_logs : [];
  const categories = Array.isArray(data.categories) ? data.categories : [];

  const recentSales = invoices.filter(x => x?.type === 'sale' && !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentReturns = invoices.filter(x => x?.type === 'return' && !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentPurchases = purchases.filter(x => !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentExpenses = expenses.filter(x => !x?.deletedAt && dateMs(x.date || x.createdAt) >= since);
  const recentVouchers = vouchers.filter(x => dateMs(x.date || x.createdAt) >= since);
  const recentTransfers = transfers.filter(x => dateMs(x.date || x.createdAt) >= since);
  const recentStockMovements = stockMovements.filter(x => dateMs(x.date || x.createdAt || x.timestamp) >= since);
  const recentAuditLogs = auditLogs.filter(x => dateMs(x.timestamp || x.date || x.createdAt) >= since);
  const newCustomers = customers.filter(x => !x?.deletedAt && !x?.isVirtual && String(x?.id||'') !== 'cust-walkin' && dateMs(x.createdAt || x.date) >= since);
  const newSuppliers = suppliers.filter(x => !x?.deletedAt && dateMs(x.createdAt || x.date) >= since);

  const salesGross = recentSales.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const returnsTotal = recentReturns.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const netSales = salesGross - returnsTotal;
  const salesPaid = recentSales.reduce((s,x)=>s+asNumber(x.paidAmount),0);
  const salesRemaining = recentSales.reduce((s,x)=>s+asNumber(x.remainingAmount),0);
  const purchasesTotal = recentPurchases.reduce((s,x)=>s+asNumber(x.grandTotal),0);
  const purchaseRemaining = recentPurchases.reduce((s,x)=>s+asNumber(x.remainingAmount),0);
  const expensesTotal = recentExpenses.reduce((s,x)=>s+asNumber(x.amount),0);
  const receiptsTotal = recentVouchers.filter(x=>x?.type==='receipt').reduce((s,x)=>s+asNumber(x.amount),0);
  const paymentsTotal = recentVouchers.filter(x=>x?.type==='payment').reduce((s,x)=>s+asNumber(x.amount),0);
  const transfersTotal = recentTransfers.reduce((s,x)=>s+asNumber(x.amount),0);
  const salesAverage = recentSales.length ? salesGross / recentSales.length : 0;
  const productById = new Map(products.map(p=>[String(p.id||''),p]));
  const itemCostTotal = (it) => {
    if (it && it.fifoCostTotal !== undefined && it.fifoCostTotal !== null && Number.isFinite(Number(it.fifoCostTotal))) return asNumber(it.fifoCostTotal);
    if (it && it.costPriceAtSale !== undefined && it.costPriceAtSale !== null && Number.isFinite(Number(it.costPriceAtSale))) return asNumber(it.quantity) * asNumber(it.costPriceAtSale);
    const p = productById.get(String(it?.productId||''));
    return asNumber(it?.baseQuantity ?? (asNumber(it?.quantity) * Math.max(1,asNumber(it?.conversionFactor)||1))) * asNumber(p?.costPrice);
  };
  const cogs = recentSales.reduce((s,inv)=>s+(inv.items||[]).reduce((a,it)=>a+itemCostTotal(it),0),0)
    - recentReturns.reduce((s,inv)=>s+(inv.items||[]).reduce((a,it)=>a+itemCostTotal(it),0),0);
  const approxProfit = netSales - cogs - expensesTotal;
  const expenseByCategory = new Map();
  for (const exp of recentExpenses) expenseByCategory.set(exp.category || 'أخرى', (expenseByCategory.get(exp.category || 'أخرى') || 0) + asNumber(exp.amount));
  const topExpenseCategories = [...expenseByCategory.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);

  const realCustomers = customers.filter(c=>!c?.deletedAt && !c?.isVirtual && String(c?.id||'') !== 'cust-walkin');
  const realSuppliers = suppliers.filter(s=>!s?.deletedAt);
  const customerDebts = realCustomers.filter(c=>asNumber(c.balance)>0).sort((a,b)=>asNumber(b.balance)-asNumber(a.balance));
  const customerCredits = realCustomers.filter(c=>asNumber(c.balance)<0).sort((a,b)=>asNumber(a.balance)-asNumber(b.balance));
  const supplierDebts = realSuppliers.filter(s=>asNumber(s.balance)>0).sort((a,b)=>asNumber(b.balance)-asNumber(a.balance));
  const supplierCredits = realSuppliers.filter(s=>asNumber(s.balance)<0).sort((a,b)=>asNumber(a.balance)-asNumber(b.balance));
  const totalCustomerDebt = customerDebts.reduce((s,c)=>s+asNumber(c.balance),0);
  const totalCustomerCredit = customerCredits.reduce((s,c)=>s+Math.abs(asNumber(c.balance)),0);
  const totalSupplierDebt = supplierDebts.reduce((s,c)=>s+asNumber(c.balance),0);
  const totalSupplierCredit = supplierCredits.reduce((s,c)=>s+Math.abs(asNumber(c.balance)),0);

  const productStockMap = new Map();
  for (const row of stock) {
    const qty = asNumber(row.baseQuantity ?? row.quantity);
    productStockMap.set(row.productId, (productStockMap.get(row.productId)||0) + qty);
  }
  const lowStock = products.filter(p => p.reorderPoint !== undefined && (productStockMap.get(p.id)||0) <= asNumber(p.reorderPoint))
    .sort((a,b)=>(productStockMap.get(a.id)||0)-(productStockMap.get(b.id)||0));
  const outOfStock = products.filter(p => (productStockMap.get(p.id)||0) <= 0);
  const inventoryCostValue = products.reduce((s,p)=>s + Math.max(0,productStockMap.get(p.id)||0)*asNumber(p.costPrice),0);
  const baseSellingPrice = (p) => {
    const direct = asNumber(p?.sellingPrice ?? p?.salePrice);
    if (direct) return direct;
    const units = Array.isArray(p?.units) ? p.units : [];
    const base = units.find(u => String(u?.id||'') === String(p?.baseUnitId||'')) || units.find(u => asNumber(u?.conversionToBase || 1) === 1) || units[0];
    return asNumber(base?.salePrice ?? base?.sellingPrice ?? base?.price);
  };
  const inventorySaleValue = products.reduce((s,p)=>s + Math.max(0,productStockMap.get(p.id)||0)*baseSellingPrice(p),0);

  const soldMap = new Map();
  for (const inv of recentSales) for (const item of (inv.items||[])) {
    const key = item.productId || item.productName;
    const old = soldMap.get(key) || { name:item.productName || 'صنف', qty:0, total:0 };
    old.qty += asNumber(item.baseQuantity || item.quantity);
    old.total += asNumber(item.total);
    soldMap.set(key, old);
  }
  const topSold = [...soldMap.values()].sort((a,b)=>b.total-a.total).slice(0,10);

  const lines = [];
  lines.push(`📊 جميع تقارير كاش توب 3 — آخر ${periodHours} ساعة`);
  lines.push(`🏪 ${settings?.storeName || 'كاش توب 3'}`);
  lines.push(`🕒 ${fmtDateTime(new Date())}`);
  lines.push('');
  lines.push('💰 المبيعات والحركة');
  lines.push(`• فواتير البيع: ${recentSales.length} | ${money(salesGross,symbol)}`);
  lines.push(`• المرتجعات: ${recentReturns.length} | ${money(returnsTotal,symbol)}`);
  lines.push(`• صافي المبيعات: ${money(netSales,symbol)}`);
  lines.push(`• المحصل من فواتير البيع: ${money(salesPaid,symbol)}`);
  lines.push(`• المتبقي من مبيعات الفترة: ${money(salesRemaining,symbol)}`);
  lines.push(`• المشتريات: ${recentPurchases.length} | ${money(purchasesTotal,symbol)}`);
  lines.push(`• المتبقي للموردين من مشتريات الفترة: ${money(purchaseRemaining,symbol)}`);
  lines.push(`• المصروفات: ${recentExpenses.length} | ${money(expensesTotal,symbol)}`);
  lines.push(`• متوسط فاتورة البيع: ${money(salesAverage,symbol)}`);
  lines.push(`• سندات القبض: ${recentVouchers.filter(x=>x?.type==='receipt').length} | ${money(receiptsTotal,symbol)}`);
  lines.push(`• سندات الصرف: ${recentVouchers.filter(x=>x?.type==='payment').length} | ${money(paymentsTotal,symbol)}`);
  lines.push(`• التحويلات بين الحسابات: ${recentTransfers.length} | ${money(transfersTotal,symbol)}`);
  lines.push(`• تكلفة البضاعة المباعة: ${money(cogs,symbol)}`);
  lines.push(`• صافي ربح تقريبي للفترة: ${money(approxProfit,symbol)}`);
  lines.push('');
  lines.push('👥 العملاء والديون');
  lines.push(`• عدد العملاء: ${realCustomers.length}`);
  lines.push(`• عملاء جدد خلال الفترة: ${newCustomers.length}`);
  lines.push(`• عملاء عليهم رصيد: ${customerDebts.length} | ${money(totalCustomerDebt,symbol)}`);
  lines.push(`• أرصدة لصالح العملاء: ${customerCredits.length} | ${money(totalCustomerCredit,symbol)}`);
  customerDebts.slice(0,15).forEach((c,i)=>lines.push(`  ${i+1}) ${c.name || 'عميل'}: ${money(c.balance,symbol)}`));
  if (customerDebts.length > 15) lines.push(`  ... و${customerDebts.length-15} عميل آخر`);
  lines.push('');
  lines.push('🚚 الموردون');
  lines.push(`• عدد الموردين: ${realSuppliers.length}`);
  lines.push(`• موردون جدد خلال الفترة: ${newSuppliers.length}`);
  lines.push(`• إجمالي المستحق للموردين: ${money(totalSupplierDebt,symbol)}`);
  lines.push(`• أرصدة لنا على الموردين: ${supplierCredits.length} | ${money(totalSupplierCredit,symbol)}`);
  supplierDebts.slice(0,12).forEach((s,i)=>lines.push(`  ${i+1}) ${s.name || 'مورد'}: ${money(s.balance,symbol)}`));
  if (supplierDebts.length > 12) lines.push(`  ... و${supplierDebts.length-12} مورد آخر`);
  lines.push('');
  lines.push('🏦 الحسابات المالية');
  const liveAccounts = accounts.filter(a=>!a?.deletedAt);
  lines.push(`• عدد الحسابات: ${liveAccounts.length}`);
  lines.push(`• إجمالي أرصدة الحسابات: ${money(liveAccounts.reduce((sum,a)=>sum+asNumber(a.balance),0),symbol)}`);
  liveAccounts.forEach(a=>lines.push(`• ${a.name || 'حساب'}: ${money(a.balance,symbol)}`));
  if (topExpenseCategories.length) {
    lines.push('');
    lines.push('💸 المصروفات حسب النوع خلال الفترة');
    topExpenseCategories.forEach(([name,total],i)=>lines.push(`${i+1}) ${name}: ${money(total,symbol)}`));
  }
  lines.push('');
  lines.push('📦 المخزون');
  lines.push(`• عدد الأصناف النشطة: ${products.length}`);
  lines.push(`• عدد الأقسام: ${categories.filter(c=>!c?.deletedAt).length}`);
  lines.push(`• حركات المخزون خلال الفترة: ${recentStockMovements.length}`);
  lines.push(`• أصناف رصيدها صفر/سالب: ${outOfStock.length}`);
  lines.push(`• قيمة المخزون بالتكلفة: ${money(inventoryCostValue,symbol)}`);
  lines.push(`• قيمة المخزون بسعر البيع: ${money(inventorySaleValue,symbol)}`);
  lines.push(`• النواقص/تحت حد الطلب: ${lowStock.length}`);
  lowStock.slice(0,25).forEach((p,i)=>lines.push(`  ${i+1}) ${p.name}: ${fmtQty(productStockMap.get(p.id)||0)} ${p.baseUnitName || 'وحدة'} / حد ${fmtQty(p.reorderPoint)}`));
  if (lowStock.length > 25) lines.push(`  ... و${lowStock.length-25} صنف ناقص آخر`);
  lines.push('');
  lines.push('🏬 المخازن');
  warehouses.forEach(w => {
    const rows = stock.filter(s=>s.warehouseId===w.id);
    const itemCount = new Set(rows.filter(r=>asNumber(r.baseQuantity ?? r.quantity)!==0).map(r=>r.productId)).size;
    const cost = rows.reduce((sum,r)=>{
      const p=products.find(x=>x.id===r.productId); return sum + Math.max(0,asNumber(r.baseQuantity ?? r.quantity))*asNumber(p?.costPrice);
    },0);
    lines.push(`• ${w.name || w.id}: ${itemCount} صنف برصيد | قيمة ${money(cost,symbol)}`);
  });
  lines.push('');
  lines.push('👨‍💼 التشغيل والإدارة');
  lines.push(`• الموظفون المسجلون: ${employees.filter(e=>!e?.deletedAt).length}`);
  lines.push(`• الفواتير المعلقة حالياً: ${heldInvoices.filter(x=>!x?.deletedAt).length}`);
  lines.push(`• عمليات السجل خلال الفترة: ${recentAuditLogs.length}`);
  lines.push(`• إجمالي فواتير البيع المسجلة بالنظام: ${invoices.filter(x=>x?.type==='sale'&&!x?.deletedAt).length}`);
  lines.push(`• إجمالي المرتجعات المسجلة بالنظام: ${invoices.filter(x=>x?.type==='return'&&!x?.deletedAt).length}`);
  lines.push(`• إجمالي فواتير المشتريات المسجلة بالنظام: ${purchases.filter(x=>!x?.deletedAt).length}`);
  if (topSold.length) {
    lines.push('');
    lines.push('🔥 أعلى الأصناف مبيعاً خلال الفترة');
    topSold.forEach((x,i)=>lines.push(`${i+1}) ${x.name}: ${money(x.total,symbol)}`));
  }
  const openShifts = shifts.filter(s=>s?.status==='open');
  if (openShifts.length) {
    lines.push('');
    lines.push(`🧾 ورديات مفتوحة: ${openShifts.length}`);
    openShifts.slice(0,8).forEach(s=>lines.push(`• ${s.userName || s.employeeName || s.cashierName || 'موظف'} — المتوقع ${money(s.expectedCash,symbol)}`));
  }
  return lines.join('\n');
}

async function collectReportData() {
  const names = ['invoices','purchases','expenses','customers','suppliers','products','categories','stock','stock_movements','warehouses','accounts','transfers','vouchers','shifts','employees','held_invoices','audit_logs'];
  const values = await Promise.all(names.map(name => getAllFromStore(name).catch(()=>[])));
  return Object.fromEntries(names.map((name,i)=>[name,values[i]]));
}


async function syncServerReportSnapshot(settings, { force=false } = {}) {
  const now = Date.now();
  const recipients = enabledRecipients(settings).map(x => x.chatId);
  const enabled = settings.telegramEnabled !== false && settings.telegramAutoReportEnabled !== false && recipients.length > 0;
  const periodHours = Math.max(1, asNumber(settings.telegramReportIntervalHours) || 24);
  const configKey = `${enabled?'1':'0'}|${periodHours}|${recipients.join(',')}`;
  if (!force && configKey === lastServerConfigKey && now - lastServerSnapshotAt < 5 * 60 * 1000 && serverManagedUntil > now) return { managed:true, cached:true };
  try {
    let text = '';
    if (enabled) {
      const data = await collectReportData();
      text = buildFullTelegramReportText(data, settings, periodHours);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const response = await fetch('./api/telegram/state', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({
        tenantId:runtimeTenant(),
        storeName:String(settings.storeName || 'كاش توب 3'),
        recipients,
        text,
        enabled,
        intervalHours:periodHours,
      }),
      cache:'no-store',
      signal:controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return { managed:false };
    const result = await response.json().catch(()=>({}));
    if (!result?.ok || !result?.managed) return { managed:false };
    lastServerSnapshotAt = now;
    serverManagedUntil = now + 10 * 60 * 1000;
    lastServerConfigKey = configKey;
    if (result.lastSentAt) {
      await putInStore('settings', { key:'telegram_report_state', lastReportAt:result.lastSentAt, serverManaged:true, updatedAt:new Date().toISOString() }).catch(()=>{});
    }
    return result;
  } catch {
    return { managed:false };
  }
}

export async function sendFullTelegramReport({ manual=false, force=false } = {}) {
  const settings = await getStoreSettings();
  if (settings.telegramEnabled === false) throw new Error('ربط Telegram متوقف من الإعدادات');
  if (!enabledRecipients(settings).length) throw new Error('أضف Chat ID واحداً على الأقل');
  const periodHours = Math.max(1, asNumber(settings.telegramReportIntervalHours) || 24);
  const data = await collectReportData();
  const text = buildFullTelegramReportText(data, settings, periodHours);
  const key = manual ? '' : `report:${Math.floor(Date.now()/(periodHours*3600000))}`;
  const result = await deliverToRecipients(text, { settings, key, queueOnFailure:!manual });
  if (settings.telegramSendImages !== false) {
    try {
      const cards = await buildReportImageCards(data, settings, periodHours);
      for (let i = 0; i < cards.length; i++) {
        await sendCanvasToRecipients(cards[i], {
          settings,
          caption: `📊 ${settings?.storeName || 'كاش توب 3'} — تقرير ${i + 1}/${cards.length}`,
          filename: `report-${i + 1}.png`,
          silent: !manual,
        });
      }
    } catch (imgError) {
      console.warn('Telegram report image sending failed', imgError);
    }
  }
  if (result.ok && !manual) {
    await putInStore('settings', { key:'telegram_report_state', lastReportAt:new Date().toISOString(), lastSuccessAt:new Date().toISOString() }).catch(()=>{});
  }
  if (!result.ok && !result.skipped && manual) {
    const firstError = result.failures?.[0]?.error || 'تعذر إرسال التقرير';
    throw new Error(firstError);
  }
  return result;
}

async function autoReportTick() {
  try {
    const settings = await getStoreSettings();
    await flushTelegramOutbox().catch(()=>{});
    const serverState = await syncServerReportSnapshot(settings);
    if (settings.telegramEnabled === false || settings.telegramAutoReportEnabled === false) return;
    if (!enabledRecipients(settings).length) return;
    const hours = Math.max(1, asNumber(settings.telegramReportIntervalHours) || 24);
    const intervalMs = hours * 3600000;
    if (serverState?.managed) return;
    const state = await getFromStore('settings','telegram_report_state').catch(()=>null);
    const last = dateMs(state?.lastReportAt);
    if (!last) {
      await putInStore('settings', { key:'telegram_report_state', lastReportAt:new Date().toISOString(), initializedAt:new Date().toISOString() }).catch(()=>{});
      return;
    }
    if (Date.now() - last < intervalMs) return;
    const result = await sendFullTelegramReport({ manual:false, force:true });
    if (!result?.ok && !result?.skipped) console.warn('Automatic Telegram report failed', result);
  } catch (error) {
    console.warn('Telegram scheduler tick failed', error);
  }
}

export function startTelegramAutomation() {
  if (automationStarted) return () => {};
  automationStarted = true;
  // New PDF/image daily scheduling is managed by services__telegramReports.js + server.js.
  // This legacy runtime remains responsible for instant business-event notifications
  // and retrying queued Telegram messages only, so reports are never duplicated.
  const run = () => flushTelegramOutbox().catch(()=>{});
  const onMutation = (event) => {
    const detail = event?.detail;
    if (!detail) return;
    Promise.resolve().then(() => notifyTelegramMutation(detail)).catch(()=>{});
  };
  setTimeout(run, 1500);
  automationTimer = setInterval(run, 60 * 1000);
  const onOnline = () => setTimeout(run, 300);
  window.addEventListener('online', onOnline);
  window.addEventListener('oscar:db-mutation', onMutation);
  return () => {
    if (automationTimer) clearInterval(automationTimer);
    automationTimer = null;
    automationStarted = false;
    window.removeEventListener('online', onOnline);
    window.removeEventListener('oscar:db-mutation', onMutation);
  };
}
