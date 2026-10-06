import { decodeCustomerPortalAccess } from './customer-portal-codec.js?v=7.9.4.136-localization';
import { TRIAL_DATABASE } from './trial__config.js?v=7.9.4.136-localization';

const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const date=v=>{try{return new Intl.DateTimeFormat('ar-EG-u-nu-latn',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v))}catch(_){return String(v||'-')}};
const money=(v,currency)=>`${num(v).toFixed(2)} ${currency||''}`;
const unwrap=v=>v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'v')?(v.deleted?null:v.v):v;
const alive=v=>v&&!v.deletedAt;
let state=null;

async function resolvePortalAccessCode(){
  const params=new URLSearchParams(location.search);
  const c=String(params.get('c')||'').toUpperCase(),u=String(params.get('u')||'').toUpperCase();
  if(/^[A-Z2-9]{5}$/.test(c)&&/^[A-Z2-9]{5}$/.test(u)){
    const path=`oscar/public/customer_short_links/${c}/${u}`;
    const direct=window.OscarActivation?.tursoDirect;
    if(direct){
      try{
        const row=await direct.readExact(TRIAL_DATABASE,path);
        if(row?.accessCode)return row.accessCode;
      }catch(_){ }
    }
    try{
      const response=await fetch(`/api/customer-short-link?c=${encodeURIComponent(c)}&u=${encodeURIComponent(u)}`,{cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(response.ok&&data?.accessCode)return data.accessCode;
    }catch(_){ }
    throw new Error('تعذر فتح الرابط المختصر. أعد إنشاء رابط العميل من البرنامج ثم أرسله مرة أخرى.');
  }
  return location.hash;
}

function fail(message){document.getElementById('app').innerHTML=`<div class="error"><div class="error-box"><b>تعذر فتح صفحة العميل</b><div style="font-size:11px;margin-top:8px">${esc(message||'الرابط غير صالح أو انتهت صلاحيته.')}</div></div></div>`;}
function prefix(companyId,store){return `oscar/companies/${encodeURIComponent(companyId)}/d/${encodeURIComponent(store)}/`;}
function exact(companyId,store,key){return prefix(companyId,store)+encodeURIComponent(String(key));}
async function readData(access){
  const direct=window.OscarActivation?.tursoDirect;if(!direct)throw new Error('محرك الاتصال غير متاح.');
  const db={databaseURL:access.d,authToken:access.t,table:'oscar_rtdb'};
  const companyPath=`oscar/companies/${encodeURIComponent(access.c)}/access/company`;
  const [companyRaw,customerRaw,settingsRaw,invoiceRows,voucherRows]=await Promise.all([
    direct.readExact(db,companyPath),
    direct.readExact(db,exact(access.c,'customers',access.u)),
    direct.readExact(db,exact(access.c,'settings','store_config')),
    direct.listPrefix(db,prefix(access.c,'invoices')),
    direct.listPrefix(db,prefix(access.c,'vouchers')),
  ]);
  const company=unwrap(companyRaw)||{};
  if(company.status&&company.status!=='active')throw new Error('هذه الخدمة غير متاحة حالياً.');
  if(company.endAt&&Date.now()>=new Date(company.endAt).getTime())throw new Error('هذه الخدمة غير متاحة حالياً.');
  const customer=unwrap(customerRaw);
  if(!customer||customer.deletedAt)throw new Error('حساب العميل غير موجود.');
  if(String(customer.portalNonce||'')!==String(access.n||''))throw new Error('تم إصدار رابط أحدث لهذا العميل. اطلب رابطاً جديداً من المتجر.');
  const settings=unwrap(settingsRaw)||{};
  const invoices=invoiceRows.map(r=>unwrap(r.payload)).filter(x=>alive(x)&&String(x.customerId||'')===String(customer.id)).sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0));
  const vouchers=voucherRows.map(r=>unwrap(r.payload)).filter(x=>alive(x)&&x.partyType==='customer'&&String(x.partyId||'')===String(customer.id)).sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0));
  return {access,company,customer,settings,invoices,vouchers,db};
}
function movementRows(s){
  const rows=[];
  for(const x of s.invoices) rows.push({kind:'invoice',date:x.date||x.createdAt,data:x});
  for(const x of s.vouchers) rows.push({kind:'voucher',date:x.date||x.createdAt,data:x});
  return rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
}
function invoiceCard(inv,currency){
  const isReturn=inv.type==='return';
  const items=(inv.items||[]).map(it=>`<div class="item"><div><div class="item-name">${esc(it.productName||'صنف')}</div><div class="item-meta">${esc(it.unitName||'-')} • ${esc(it.quantity)} × ${money(it.unitPrice,currency)}</div></div><div class="item-total">${money(it.total,currency)}</div></div>`).join('');
  return `<div class="card"><button class="invoice-toggle" type="button"><div class="row"><div><span class="badge ${isReturn?'return':'sale'}">${isReturn?'مرتجع':'فاتورة بيع'}</span><div class="strong" style="margin-top:6px">#${esc(inv.invoiceNumber||'-')}</div><div class="muted">${date(inv.date||inv.createdAt)}</div></div><div style="text-align:left"><div class="amount ${isReturn?'green':''}">${money(inv.grandTotal,currency)}</div><div class="muted">مدفوع ${money(inv.paidAmount,currency)}</div>${num(inv.remainingAmount)>0?`<div class="muted red">باقي ${money(inv.remainingAmount,currency)}</div>`:''}</div></div></button><div class="details">${items||'<div class="muted">لا توجد أصناف مسجلة.</div>'}${inv.notes?`<div class="notes"><b>ملاحظات:</b> ${esc(inv.notes)}</div>`:''}</div></div>`;
}
function voucherCard(v,currency){const receipt=v.type==='receipt';return `<div class="card"><div class="row"><div><span class="badge ${receipt?'receipt':'payment'}">${receipt?'دفعة / سند قبض':'صرف / سحب'}</span><div class="strong" style="margin-top:6px">سند #${esc(v.voucherNumber||'-')}</div><div class="muted">${date(v.date||v.createdAt)}</div></div><div style="text-align:left"><div class="amount ${receipt?'green':'red'}">${receipt?'+':'-'} ${money(v.amount,currency)}</div>${v.notes?`<div class="muted">${esc(v.notes)}</div>`:''}</div></div></div>`;}
function movementCard(m,currency){return m.kind==='invoice'?invoiceCard(m.data,currency):voucherCard(m.data,currency);}
function render(s){
 const currency=s.settings.currencySymbol||'₪',bal=num(s.customer.balance),totalInvoices=s.invoices.reduce((a,x)=>a+num(x.grandTotal),0),totalPaid=s.invoices.reduce((a,x)=>a+num(x.paidAmount),0)+s.vouchers.filter(v=>v.type==='receipt').reduce((a,x)=>a+num(x.amount),0);
 const logo=s.settings.logoSourceUrl||s.settings.logoUrl||'./brand-logo.png',store=s.settings.storeName||s.company.companyName||'المتجر';
 const paymentParams=new URLSearchParams(); paymentParams.set('store',store);
 const incomingParams=new URLSearchParams(location.search); const shortC=incomingParams.get('c'),shortU=incomingParams.get('u');
 if(shortC&&shortU){paymentParams.set('c',shortC);paymentParams.set('u',shortU);}
 const paymentHref=`./معتمد.html?${paymentParams.toString()}${shortC&&shortU?'':location.hash}`;
 const movements=movementRows(s);
 document.title=`${s.customer.name} - ${store}`;
 document.getElementById('app').innerHTML=`<div class="top"><div class="brand"><img class="logo" src="${esc(logo)}" onerror="this.onerror=null;this.src='./brand-logo.png'"><div><h1>${esc(store)}</h1><p>${esc(s.settings.subtitle||'بوابة العميل')}</p></div><button class="refresh" id="refreshBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg><span>تحديث</span></button></div><div class="customer"><div class="hello">مرحباً بك</div><div class="customer-name">${esc(s.customer.name)}</div>${s.customer.phone?`<div class="hello">${esc(s.customer.phone)}</div>`:''}</div></div><div class="content"><div class="balance-card"><div class="balance-label">الرصيد الحالي</div><div class="balance ${bal>0?'debt':bal<0?'credit':'zero'}">${money(Math.abs(bal),currency)}</div><div class="balance-note">${bal>0?'مبلغ مستحق للمتجر':bal<0?'رصيد دائن لك لدى المتجر':'الحساب خالص حالياً'}</div><div class="balance-actions"><a class="pay-btn" id="payBtn" href="${esc(paymentHref)}"><span class="pay-icon">₪</span><span class="pay-copy">سداد الدين<small>إرسال دفعة وإيصال</small></span></a></div></div><div class="stats"><div class="stat"><b>${s.invoices.length}</b><span>الفواتير</span></div><div class="stat"><b>${s.vouchers.length}</b><span>الدفعات والسندات</span></div><div class="stat"><b>${money(totalInvoices,currency)}</b><span>إجمالي الفواتير</span></div></div><div class="tabs"><button class="tab active" data-tab="moves">الحركات</button><button class="tab" data-tab="invoices">الفواتير</button><button class="tab" data-tab="payments">الدفعات</button></div><section class="section active" data-section="moves"><div class="section-title">حركة الحساب</div><div class="list">${movements.length?movements.map(x=>movementCard(x,currency)).join(''):'<div class="empty">لا توجد حركات مسجلة حتى الآن.</div>'}</div></section><section class="section" data-section="invoices"><div class="section-title">الفواتير بالتفصيل</div><div class="list">${s.invoices.length?s.invoices.map(x=>invoiceCard(x,currency)).join(''):'<div class="empty">لا توجد فواتير مسجلة.</div>'}</div></section><section class="section" data-section="payments"><div class="section-title">الدفعات والسحب</div><div class="list">${s.vouchers.length?s.vouchers.map(x=>voucherCard(x,currency)).join(''):'<div class="empty">لا توجد دفعات أو سندات مسجلة.</div>'}</div></section><div class="last-update">آخر تحديث: ${date(new Date())}</div><div class="footer">بيانات للعرض فقط • يتم تحديثها مباشرة من نظام ${esc(store)}</div></div>`;
 document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x.dataset.section===b.dataset.tab));});
 document.querySelectorAll('.invoice-toggle').forEach(b=>b.onclick=()=>b.nextElementSibling?.classList.toggle('open'));
 $('#refreshBtn').onclick=async()=>{const b=$('#refreshBtn');b.disabled=true;b.classList.add('refreshing');try{state=await readData(state.access);render(state);}catch(e){fail(e.message)}finally{if(b.isConnected){b.disabled=false;b.classList.remove('refreshing')}}};
}
async function boot(){try{const access=await decodeCustomerPortalAccess(await resolvePortalAccessCode());state=await readData(access);render(state);}catch(e){console.error(e);fail(e?.message||e);}}
boot();
