import { TELEGRAM_BOT_TOKEN, normalizeTelegramRecipients, sendTelegramTextToRecipients, sendTelegramPhotoBlobToRecipients, sendTelegramDocumentBlobToRecipients, buildFullTelegramReportText } from './services__telegram.js?v=7.9.4.136-localization';
import { renderExecutiveReportCanvas, renderTablePages } from './utils__canvasRenderer.js?v=7.9.4.136-localization';
import { canvasesToPDFBlob } from './utils__pdfExport.js?v=7.9.4.136-localization';
import { canvasToImageBlob } from './utils__imageExport.js?v=7.9.4.136-localization';

const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const money=v=>num(v).toFixed(2);
const active=x=>x && !x.deletedAt && x.status!=='archived';
const todayBounds=()=>{const a=new Date();a.setHours(0,0,0,0);const b=new Date();b.setHours(23,59,59,999);return[a.getTime(),b.getTime()];};
const inRange=(v,a,b)=>{const t=new Date(v||0).getTime();return Number.isFinite(t)&&t>=a&&t<=b;};
const dateText=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ar-EG'):'-';};
const safeName=v=>String(v||'Oscar').replace(/[\\/:*?"<>|]+/g,'-').trim()||'Oscar';

async function blobToBase64(blob){
  if(!(blob instanceof Blob)) return '';
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=()=>reject(r.error||new Error('تعذر قراءة الملف'));r.readAsDataURL(blob);});
}

function inventoryRows(app){
  const products=(app.products||[]).filter(active), stock=app.stock||[], wh=app.warehouses||[];
  const whName=new Map(wh.map(x=>[x.id,x.name])); const prodMap=new Map(products.map(x=>[x.id,x]));
  return stock.filter(x=>num(x.baseQuantity ?? x.quantity)!==0 && prodMap.has(x.productId)).map((s,i)=>{
    const p=prodMap.get(s.productId), q=num(s.baseQuantity ?? s.quantity), cost=num(p.costPrice);
    return [i+1,p.name||'-',whName.get(s.warehouseId)||s.warehouseId||'-',money(q),money(cost),money(q*cost)];
  }).sort((a,b)=>num(b[5])-num(a[5]));
}
function customerRows(app){
  return (app.customers||[]).filter(c=>active(c)&&!c?.isVirtual&&c?.id!=='cust-walkin').map((c,i)=>{
    const bal=num(c.balance);return [i+1,c.name||'-',c.phone||'-',bal>0?'عليه لنا':bal<0?'له علينا':'مسدد',money(Math.max(0,bal)),money(Math.max(0,-bal))];
  }).sort((a,b)=>num(b[4])-num(a[4]));
}
function supplierRows(app){
  return (app.suppliers||[]).filter(active).map((c,i)=>{
    const bal=num(c.balance);return [i+1,c.name||'-',c.phone||'-',bal>0?'له علينا':bal<0?'عليه لنا':'مسدد',money(Math.max(0,bal)),money(Math.max(0,-bal))];
  }).sort((a,b)=>num(b[4])-num(a[4]));
}
function expenseGroupRows(app,onlyToday=false){
  const [a,b]=todayBounds(); const ex=(app.expenses||[]).filter(active).filter(x=>!onlyToday||inRange(x.date||x.createdAt,a,b));
  const g={};for(const e of ex){const k=String(e.category||'غير مصنف').trim()||'غير مصنف';if(!g[k])g[k]={count:0,total:0};g[k].count++;g[k].total+=num(e.amount);}
  return Object.entries(g).sort((x,y)=>y[1].total-x[1].total).map(([k,v],i)=>[i+1,k,v.count,money(v.total)]);
}


function appReportData(app){
  return {
    invoices:app.invoices||[], purchases:app.purchases||[], expenses:app.expenses||[], customers:app.customers||[], suppliers:app.suppliers||[],
    products:app.products||[], categories:app.categories||[], stock:app.stock||[], stock_movements:app.stockMovements||[], warehouses:app.warehouses||[],
    accounts:app.accounts||[], transfers:app.transfers||[], vouchers:app.vouchers||[], shifts:app.shifts||[], employees:app.employees||[],
    held_invoices:app.heldInvoices||[], audit_logs:app.auditLogs||[],
  };
}
function periodBounds(hours=24){const b=Date.now(),a=b-Math.max(1,num(hours)||24)*3600000;return[a,b];}
function expenseRowsForHours(app,hours=24){
  const [a,b]=periodBounds(hours), ex=(app.expenses||[]).filter(active).filter(x=>inRange(x.date||x.createdAt,a,b));
  const g={}; for(const e of ex){const k=String(e.category||'غير مصنف').trim()||'غير مصنف';if(!g[k])g[k]={count:0,total:0};g[k].count++;g[k].total+=num(e.amount);}
  return Object.entries(g).sort((x,y)=>y[1].total-x[1].total).map(([k,v],i)=>[i+1,k,v.count,money(v.total)]);
}
export function buildLast24HoursReportModel(app,hours=24){
  const [a,b]=periodBounds(hours), currency=app.settings?.currencySymbol||'';
  const sales=(app.invoices||[]).filter(x=>x?.type==='sale'&&!x.deletedAt&&inRange(x.date||x.createdAt,a,b));
  const returns=(app.invoices||[]).filter(x=>x?.type==='return'&&!x.deletedAt&&inRange(x.date||x.createdAt,a,b));
  const purchases=(app.purchases||[]).filter(x=>!x?.deletedAt&&inRange(x.date||x.createdAt,a,b));
  const expenses=(app.expenses||[]).filter(active).filter(x=>inRange(x.date||x.createdAt,a,b));
  const vouchers=(app.vouchers||[]).filter(x=>active(x)&&inRange(x.date||x.createdAt,a,b));
  const transfers=(app.transfers||[]).filter(x=>active(x)&&inRange(x.date||x.createdAt,a,b));
  const customers=(app.customers||[]).filter(c=>active(c)&&!c?.isVirtual&&c?.id!=='cust-walkin'), suppliers=(app.suppliers||[]).filter(active), products=(app.products||[]).filter(active);
  const salesTotal=sales.reduce((s,x)=>s+num(x.grandTotal),0), salesPaid=sales.reduce((s,x)=>s+num(x.paidAmount),0), salesDebt=sales.reduce((s,x)=>s+num(x.remainingAmount),0);
  const returnTotal=returns.reduce((s,x)=>s+num(x.grandTotal),0), purchaseTotal=purchases.reduce((s,x)=>s+num(x.grandTotal),0), purchaseDebt=purchases.reduce((s,x)=>s+num(x.remainingAmount),0), expenseTotal=expenses.reduce((s,x)=>s+num(x.amount),0);
  const productMap=new Map(products.map(p=>[String(p.id||''),p]));
  const itemCostTotal=(it)=>{
    if(it&&it.fifoCostTotal!==undefined&&it.fifoCostTotal!==null&&Number.isFinite(Number(it.fifoCostTotal)))return num(it.fifoCostTotal);
    if(it&&it.costPriceAtSale!==undefined&&it.costPriceAtSale!==null&&Number.isFinite(Number(it.costPriceAtSale)))return num(it.quantity)*num(it.costPriceAtSale);
    const p=productMap.get(String(it?.productId||'')); return num(it?.baseQuantity ?? (num(it?.quantity)*Math.max(1,num(it?.conversionFactor)||1)))*num(p?.costPrice);
  };
  const cogsSales=sales.reduce((sum,inv)=>sum+(inv.items||[]).reduce((a,it)=>a+itemCostTotal(it),0),0), cogsReturns=returns.reduce((sum,inv)=>sum+(inv.items||[]).reduce((a,it)=>a+itemCostTotal(it),0),0), cogs=cogsSales-cogsReturns;
  const netSales=salesTotal-returnTotal, approxProfit=netSales-cogs-expenseTotal;
  const receipts=vouchers.filter(x=>x?.type==='receipt'), payments=vouchers.filter(x=>x?.type==='payment');
  const receiptTotal=receipts.reduce((s,x)=>s+num(x.amount),0), paymentTotal=payments.reduce((s,x)=>s+num(x.amount),0), transferTotal=transfers.reduce((s,x)=>s+num(x.amount),0);
  const customerDebt=customers.reduce((s,x)=>s+Math.max(0,num(x.balance)),0), customerCredit=customers.reduce((s,x)=>s+Math.max(0,-num(x.balance)),0);
  const supplierDue=suppliers.reduce((s,x)=>s+Math.max(0,num(x.balance)),0), supplierCredit=suppliers.reduce((s,x)=>s+Math.max(0,-num(x.balance)),0);
  const invRows=inventoryRows(app), inventoryCost=invRows.reduce((s,r)=>s+num(r[5]),0), inventoryQty=invRows.reduce((s,r)=>s+num(r[3]),0);
  const paidCount=sales.filter(x=>num(x.remainingAmount)<=0.000001).length, debtCount=sales.length-paidCount;
  const metrics=[
    {icon:'sales',label:`صافي مبيعات آخر ${hours} ساعة`,value:`${money(netSales)} ${currency}`,sub:`${sales.length} فاتورة • ${debtCount} آجل/جزئي`,tone:'emerald'},
    {icon:'stock',label:'تكلفة المخزون الحالية',value:`${money(inventoryCost)} ${currency}`,sub:`${products.length} صنف • ${money(inventoryQty)} وحدة`,tone:'blue'},
    {icon:'customers',label:'ديون العملاء لنا',value:`${money(customerDebt)} ${currency}`,sub:`${customers.length} عميل`,tone:'rose'},
    {icon:'suppliers',label:'مستحق الموردين',value:`${money(supplierDue)} ${currency}`,sub:`${suppliers.length} مورد`,tone:'amber'},
    {icon:'expense',label:`مصروفات آخر ${hours} ساعة`,value:`${money(expenseTotal)} ${currency}`,sub:`${expenses.length} عملية`,tone:'rose'},
    {icon:'generic',label:`مشتريات آخر ${hours} ساعة`,value:`${money(purchaseTotal)} ${currency}`,sub:`${purchases.length} فاتورة`,tone:'blue'},
  ];
  const summaryRows=[
    ['المبيعات','عدد الفواتير',String(sales.length),`مسدد ${paidCount} • آجل/جزئي ${debtCount}`],
    ['المبيعات','الإجمالي',`${money(salesTotal)} ${currency}`,`محصل ${money(salesPaid)} • متبقي ${money(salesDebt)}`],
    ['المرتجعات','إجمالي المرتجعات',`${money(returnTotal)} ${currency}`,`${returns.length} عملية`],
    ['المبيعات','تكلفة البضاعة المباعة',`${money(cogs)} ${currency}`,`صافي ربح تقريبي ${money(approxProfit)} ${currency}`],
    ['المشتريات','إجمالي المشتريات',`${money(purchaseTotal)} ${currency}`,`متبقي للموردين ${money(purchaseDebt)} ${currency}`],
    ['المصروفات','إجمالي المصروفات',`${money(expenseTotal)} ${currency}`,`${expenses.length} عملية`],
    ['السندات','قبض / صرف',`${money(receiptTotal)} / ${money(paymentTotal)} ${currency}`,`${receipts.length} قبض • ${payments.length} صرف`],
    ['الحسابات','تحويلات الحسابات',`${money(transferTotal)} ${currency}`,`${transfers.length} عملية`],
    ['العملاء','لنا على العملاء',`${money(customerDebt)} ${currency}`,`لهم علينا ${money(customerCredit)} ${currency}`],
    ['الموردون','للموردين علينا',`${money(supplierDue)} ${currency}`,`لنا عليهم ${money(supplierCredit)} ${currency}`],
    ['المخزون','التكلفة الحالية',`${money(inventoryCost)} ${currency}`,`إجمالي الكمية ${money(inventoryQty)}`],
  ];
  const text=buildFullTelegramReportText(appReportData(app),app.settings||{},hours);
  return {sales,returns,purchases,expenses,metrics,summaryRows,text,inventoryCost,customerDebt,customerCredit,supplierDue,supplierCredit,cogs,approxProfit};
}

export function buildDailyReportModel(app){
  const [a,b]=todayBounds(), currency=app.settings?.currencySymbol||'';
  const sales=(app.invoices||[]).filter(x=>x?.type==='sale'&&!x.deletedAt&&inRange(x.date,a,b));
  const returns=(app.invoices||[]).filter(x=>x?.type==='return'&&!x.deletedAt&&inRange(x.date,a,b));
  const purchases=(app.purchases||[]).filter(x=>!x?.deletedAt&&inRange(x.date,a,b));
  const expenses=(app.expenses||[]).filter(active).filter(x=>inRange(x.date||x.createdAt,a,b));
  const customers=(app.customers||[]).filter(c=>active(c)&&!c?.isVirtual&&c?.id!=='cust-walkin'), suppliers=(app.suppliers||[]).filter(active), products=(app.products||[]).filter(active);
  const salesTotal=sales.reduce((s,x)=>s+num(x.grandTotal),0), salesPaid=sales.reduce((s,x)=>s+num(x.paidAmount),0), salesDebt=sales.reduce((s,x)=>s+num(x.remainingAmount),0);
  const returnTotal=returns.reduce((s,x)=>s+num(x.grandTotal),0), purchaseTotal=purchases.reduce((s,x)=>s+num(x.grandTotal),0), expenseTotal=expenses.reduce((s,x)=>s+num(x.amount),0);
  const customerDebt=customers.reduce((s,x)=>s+Math.max(0,num(x.balance)),0), customerCredit=customers.reduce((s,x)=>s+Math.max(0,-num(x.balance)),0);
  const supplierDue=suppliers.reduce((s,x)=>s+Math.max(0,num(x.balance)),0), supplierCredit=suppliers.reduce((s,x)=>s+Math.max(0,-num(x.balance)),0);
  const invRows=inventoryRows(app), inventoryCost=invRows.reduce((s,r)=>s+num(r[5]),0), inventoryQty=invRows.reduce((s,r)=>s+num(r[3]),0);
  const paidCount=sales.filter(x=>num(x.remainingAmount)<=0.000001).length, debtCount=sales.length-paidCount;
  const metrics=[
    {icon:'sales',label:'صافي مبيعات اليوم',value:`${money(salesTotal-returnTotal)} ${currency}`,sub:`${sales.length} فاتورة • ${debtCount} آجل`,tone:'emerald'},
    {icon:'stock',label:'تكلفة المخزون',value:`${money(inventoryCost)} ${currency}`,sub:`${products.length} صنف • ${money(inventoryQty)} وحدة`,tone:'blue'},
    {icon:'customers',label:'ديون العملاء لنا',value:`${money(customerDebt)} ${currency}`,sub:`${customers.length} عميل`,tone:'rose'},
    {icon:'suppliers',label:'مستحق الموردين',value:`${money(supplierDue)} ${currency}`,sub:`${suppliers.length} مورد`,tone:'amber'},
    {icon:'expense',label:'مصروفات اليوم',value:`${money(expenseTotal)} ${currency}`,sub:`${expenses.length} عملية`,tone:'rose'},
    {icon:'generic',label:'مشتريات اليوم',value:`${money(purchaseTotal)} ${currency}`,sub:`${purchases.length} فاتورة`,tone:'blue'},
  ];
  const summaryRows=[
    ['المبيعات','عدد الفواتير',String(sales.length),`مسدد ${paidCount} • آجل/جزئي ${debtCount}`],
    ['المبيعات','الإجمالي',`${money(salesTotal)} ${currency}`,`مدفوع ${money(salesPaid)} • متبقي ${money(salesDebt)}`],
    ['المرتجعات','إجمالي المرتجعات',`${money(returnTotal)} ${currency}`,`${returns.length} عملية`],
    ['المشتريات','إجمالي المشتريات',`${money(purchaseTotal)} ${currency}`,`${purchases.length} فاتورة`],
    ['المصروفات','إجمالي المصروفات',`${money(expenseTotal)} ${currency}`,`${expenses.length} عملية`],
    ['العملاء','لنا على العملاء',`${money(customerDebt)} ${currency}`,`لهم علينا ${money(customerCredit)} ${currency}`],
    ['الموردون','للموردين علينا',`${money(supplierDue)} ${currency}`,`لنا عليهم ${money(supplierCredit)} ${currency}`],
    ['المخزون','التكلفة الحالية',`${money(inventoryCost)} ${currency}`,`إجمالي الكمية ${money(inventoryQty)}`],
  ];
  const text=[
    `📊 التقرير اليومي — ${app.settings?.storeName||'كاش توب 3'}`,
    `📅 ${new Date().toLocaleDateString('ar-EG')}`,
    `المبيعات: ${money(salesTotal)} ${currency} | صافي بعد المرتجعات: ${money(salesTotal-returnTotal)} ${currency}`,
    `عدد فواتير البيع: ${sales.length} | مسدد: ${paidCount} | آجل/جزئي: ${debtCount}`,
    `المدفوع: ${money(salesPaid)} ${currency} | المتبقي: ${money(salesDebt)} ${currency}`,
    `المشتريات: ${money(purchaseTotal)} ${currency} | المصروفات: ${money(expenseTotal)} ${currency}`,
    `ديون العملاء لنا: ${money(customerDebt)} ${currency} | للعملاء علينا: ${money(customerCredit)} ${currency}`,
    `للموردين علينا: ${money(supplierDue)} ${currency} | لنا على الموردين: ${money(supplierCredit)} ${currency}`,
    `تكلفة المخزون الحالية: ${money(inventoryCost)} ${currency}`,
  ].join('\n');
  return {sales,returns,purchases,expenses,metrics,summaryRows,text,inventoryCost,customerDebt,customerCredit,supplierDue,supplierCredit};
}

export async function generateDailyReportArtifacts(app){
  const m=buildLast24HoursReportModel(app,24), settings=app.settings||{}, day=new Date().toISOString().slice(0,10), store=safeName(settings.storeName||'Oscar');
  const summary=await renderExecutiveReportCanvas({title:'التقرير اليومي الشامل',subtitle:'الفترة: آخر 24 ساعة حتى لحظة إنشاء التقرير',metrics:m.metrics,headers:['القسم','المؤشر','القيمة','التفاصيل'],rows:m.summaryRows,settings});
  const saleRows=m.sales.map((x,i)=>[i+1,x.invoiceNumber||'-',dateText(x.date),x.customerName||'عميل نقدي',money(x.grandTotal),money(x.paidAmount),money(x.remainingAmount)]);
  const expenseRows=m.expenses.map((x,i)=>[i+1,dateText(x.date||x.createdAt),x.category||'غير مصنف',x.notes||'-',money(x.amount)]);
  const pages=[summary];
  pages.push(...await renderTablePages({title:'فواتير مبيعات آخر 24 ساعة',subtitle:`عدد الفواتير: ${saleRows.length}`,headers:['#','الفاتورة','التاريخ','العميل','الإجمالي','المدفوع','المتبقي'],rows:saleRows,settings,orientation:'landscape'}));
  pages.push(...await renderTablePages({title:'مصروفات آخر 24 ساعة',subtitle:`عدد العمليات: ${expenseRows.length}`,headers:['#','التاريخ','النوع','البيان','المبلغ'],rows:expenseRows,settings,orientation:'landscape'}));
  const pdf=canvasesToPDFBlob(pages,{orientation:'landscape',jpegQuality:.9});
  const image=await canvasToImageBlob(summary,{type:'image/jpeg',quality:.92});
  return {text:m.text,pdf,image,pdfName:`${store}_Daily_24H_Report_${day}.pdf`,imageName:`${store}_Daily_24H_Report_${day}.jpg`};
}

export async function generateCustomersDebtsArtifacts(app){
  const settings=app.settings||{}, currency=settings.currencySymbol||'', rows=customerRows(app), day=new Date().toISOString().slice(0,10), store=safeName(settings.storeName||'Oscar');
  const onUs=rows.reduce((s,r)=>s+num(r[5]),0), onThem=rows.reduce((s,r)=>s+num(r[4]),0);
  const pages=await renderTablePages({title:'تقرير العملاء والديون',subtitle:`إجمالي العملاء: ${rows.length} • لنا عليهم: ${money(onThem)} ${currency} • لهم علينا: ${money(onUs)} ${currency}`,headers:['#','العميل','الهاتف','الحالة','لنا عليه','له علينا'],rows,settings,orientation:'landscape'});
  return {pdf:canvasesToPDFBlob(pages,{orientation:'landscape',jpegQuality:.9}),pdfName:`${store}_Customers_Debts_${day}.pdf`};
}

export async function generateAllReportsArtifacts(app){
  const settings=app.settings||{}, currency=settings.currencySymbol||'', day=new Date().toISOString().slice(0,10), store=safeName(settings.storeName||'Oscar'), m=buildLast24HoursReportModel(app,24);
  const pages=[];
  pages.push(await renderExecutiveReportCanvas({title:'التقارير الشاملة — آخر 24 ساعة',subtitle:'ملخص الإدارة والمبيعات والمخزون والعملاء والموردين والمصروفات حتى لحظة الإرسال',metrics:m.metrics,headers:['القسم','المؤشر','القيمة','التفاصيل'],rows:m.summaryRows,settings}));
  pages.push(...await renderTablePages({title:'تقرير المخزون وتكلفة المخازن',subtitle:'القيمة = الرصيد بالوحدة الأساسية × سعر الشراء',headers:['#','الصنف','المخزن','الكمية','سعر الشراء','التكلفة'],rows:inventoryRows(app),settings,orientation:'landscape'}));
  pages.push(...await renderTablePages({title:'تقرير العملاء والديون',subtitle:`العملة: ${currency}`,headers:['#','العميل','الهاتف','الحالة','لنا عليه','له علينا'],rows:customerRows(app),settings,orientation:'landscape'}));
  pages.push(...await renderTablePages({title:'تقرير الموردين والأرصدة',subtitle:`العملة: ${currency}`,headers:['#','المورد','الهاتف','الحالة','له علينا','لنا عليه'],rows:supplierRows(app),settings,orientation:'landscape'}));
  pages.push(...await renderTablePages({title:'مصروفات آخر 24 ساعة حسب النوع',subtitle:'الفترة: آخر 24 ساعة حتى لحظة إنشاء التقرير',headers:['#','نوع المصروف','عدد العمليات','الإجمالي'],rows:expenseRowsForHours(app,24),settings,orientation:'landscape'}));
  const pdf=canvasesToPDFBlob(pages,{orientation:'landscape',jpegQuality:.9});
  const image=await canvasToImageBlob(pages[0],{type:'image/jpeg',quality:.92});
  return {pdf,image,pdfName:`${store}_All_Reports_24H_${day}.pdf`,imageName:`${store}_Reports_24H_Summary_${day}.jpg`,text:m.text};
}

export async function generateBackupArtifact(app){
  const json=await app.handleExportBackup?.(); const text=typeof json==='string'?json:JSON.stringify(json||{},null,2); const day=new Date().toISOString().slice(0,10), store=safeName(app.settings?.storeName||'Oscar');
  return {blob:new Blob([text],{type:'application/json;charset=utf-8'}),name:`${store}_Backup_${day}.json`};
}

export async function telegramRequest(body){
  const r=await fetch('/api/oscar-telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const data=await r.json().catch(()=>null);
  if(!r.ok||data?.ok!==true) throw new Error(data?.error||data?.message||`خادم Telegram غير متاح (${r.status})`);
  return data;
}

function enabledReportRecipients(settings){
  return normalizeTelegramRecipients(settings?.telegramRecipients).filter(x=>x.enabled!==false&&String(x.chatId||'').trim());
}
function deliveryError(result,label){
  if(result?.ok) return null;
  if(result?.reason==='NO_RECIPIENTS'||result?.skipped) return new Error('لا يوجد Chat ID فعّال. أضف المعرف من إعدادات Telegram أولاً.');
  const first=result?.failures?.[0];
  return new Error(`${label} فشل${first?.error?`: ${first.error}`:''}`);
}
function requireDelivery(result,label){ const e=deliveryError(result,label); if(e) throw e; return result; }
async function bestEffortServer(action){ try{return await telegramRequest(action);}catch{return null;} }

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let backupAutomationBusy = false;
const backupTenantKey = () => {
  try {
    const rt = window.OscarActivation?.readRuntime?.() || {};
    return String(rt.companyId || rt.tenantId || rt.companyName || 'local').trim() || 'local';
  } catch (_) { return 'local'; }
};
const backupStampKey = () => `oscar_daily_full_backup_last_v77::${backupTenantKey()}`;
function readLocalBackupStamp(){ try{return Number(localStorage.getItem(backupStampKey())||0)||0;}catch(_){return 0;} }
function writeLocalBackupStamp(value){ try{localStorage.setItem(backupStampKey(),String(Number(value)||Date.now()));}catch(_){ } }

export async function checkDailyBackupDue(app,{force=false}={}){
  if(backupAutomationBusy) return {ok:true,skipped:'busy'};
  const current = typeof app === 'function' ? app() : app;
  if(!current?.settings?.telegramDailyBackupEnabled) return {ok:true,skipped:'disabled'};
  if(typeof navigator!=='undefined' && navigator.onLine===false) return {ok:true,skipped:'offline'};
  const recipients=enabledReportRecipients(current.settings||{});
  if(!recipients.length) return {ok:true,skipped:'no-recipients'};
  backupAutomationBusy=true;
  try{
    const now=Date.now();
    const status=await bestEffortServer({action:'status'});
    const last=Math.max(readLocalBackupStamp(),Number(status?.lastDailyBackupSentAt||0)||0);
    if(!force && last>0 && now-last<BACKUP_INTERVAL_MS) return {ok:true,skipped:'not-due',last};
    const result=await sendBackupNow(current);
    writeLocalBackupStamp(now);
    return {...result,automatic:true};
  }finally{backupAutomationBusy=false;}
}

export function startDailyBackupAutomation(getApp){
  if(typeof window==='undefined') return ()=>{};
  let stopped=false, queued=false, idleId=0, delayTimer=0;
  const actuallyRun=()=>{
    queued=false;
    idleId=0;
    delayTimer=0;
    if(stopped) return;
    checkDailyBackupDue(getApp).catch(()=>{});
  };
  const run=()=>{
    if(stopped || queued) return;
    queued=true;
    const last=Number(window.__OSCAR_LAST_INTERACTION_AT__||0);
    const busy=last>0 && typeof performance!=='undefined' && (performance.now()-last)<700;
    if(busy){ delayTimer=window.setTimeout(()=>{queued=false;run();},760); return; }
    if('requestIdleCallback' in window) idleId=window.requestIdleCallback(actuallyRun,{timeout:2200});
    else delayTimer=window.setTimeout(actuallyRun,700);
  };
  const onVisible=()=>{if(!document.hidden)run();};
  const onCustom=()=>run();
  const timer=window.setInterval(run,60*1000);
  window.addEventListener('online',run);
  window.addEventListener('focus',run);
  window.addEventListener('oscar-backup-check',onCustom);
  document.addEventListener('visibilitychange',onVisible);
  window.setTimeout(run,900);
  return()=>{
    stopped=true;
    window.clearInterval(timer);
    if(delayTimer) window.clearTimeout(delayTimer);
    if(idleId && 'cancelIdleCallback' in window) try{window.cancelIdleCallback(idleId);}catch(_){}
    window.removeEventListener('online',run);
    window.removeEventListener('focus',run);
    window.removeEventListener('oscar-backup-check',onCustom);
    document.removeEventListener('visibilitychange',onVisible);
  };
}

export async function saveTelegramConfig(settings){
  // Manual sending must work even on static hosting / HTML preview without server.js.
  // server.js remains an optional background worker for 24h scheduling only.
  const recipients=enabledReportRecipients(settings);
  const token=String(TELEGRAM_BOT_TOKEN||'').trim();
  const chatIds=recipients.map(x=>x.chatId).join(',');
  const dailyReportEnabled=settings?.telegramAutoReportEnabled !== undefined ? !!settings.telegramAutoReportEnabled : !!settings?.telegramDailyReportEnabled;
  const dailyBackupEnabled=!!settings?.telegramDailyBackupEnabled;
  if(!token||!recipients.length) return {ok:false,configured:false,serverAvailable:false,directReady:false};
  try{
    const res=await telegramRequest({action:'save_config',config:{token,chatIds,dailyReportEnabled,dailyBackupEnabled}});
    return {...res,ok:true,configured:true,serverAvailable:true,directReady:true};
  }catch(error){
    // This is expected on static hosting. Direct Bot API still works.
    return {ok:true,configured:true,serverAvailable:false,directReady:true,warning:String(error?.message||error)};
  }
}

export async function uploadTelegramSnapshot(app,{includeBackup=true}={}){
  const daily=await generateDailyReportArtifacts(app); const backup=includeBackup?await generateBackupArtifact(app):null;
  const payload={action:'snapshot',snapshot:{storeName:app.settings?.storeName||'كاش توب 3',reportText:daily.text,dailyPdfBase64:await blobToBase64(daily.pdf),dailyPdfName:daily.pdfName,dailyImageBase64:await blobToBase64(daily.image),dailyImageName:daily.imageName}};
  if(backup){payload.snapshot.backupBase64=await blobToBase64(backup.blob);payload.snapshot.backupName=backup.name;}
  return bestEffortServer(payload);
}

export async function sendDailyReportNow(app){
  const settings=app.settings||{};
  if(!enabledReportRecipients(settings).length) throw new Error('لا يوجد Chat ID فعّال. أضفه من الإعدادات وتأكد أن صاحب المعرف فتح البوت وضغط Start.');
  const a=await generateDailyReportArtifacts(app);
  requireDelivery(await sendTelegramTextToRecipients(a.text,{settings}),'إرسال نص التقرير');
  requireDelivery(await sendTelegramPhotoBlobToRecipients(a.image,{settings,caption:`صورة التقرير اليومي — ${settings.storeName||'كاش توب 3'}`,filename:a.imageName}),'إرسال صورة التقرير');
  const result=requireDelivery(await sendTelegramDocumentBlobToRecipients(a.pdf,{settings,caption:`PDF التقرير اليومي — ${settings.storeName||'كاش توب 3'}`,filename:a.pdfName}),'إرسال PDF التقرير');
  await saveTelegramConfig(settings).catch(()=>{});
  await bestEffortServer({action:'snapshot',snapshot:{storeName:settings.storeName||'كاش توب 3',reportText:a.text,dailyPdfBase64:await blobToBase64(a.pdf),dailyPdfName:a.pdfName,dailyImageBase64:await blobToBase64(a.image),dailyImageName:a.imageName}});
  return {ok:true,sent:result.sent,mode:'direct'};
}
export async function sendCustomersReportNow(app){
  const settings=app.settings||{};
  if(!enabledReportRecipients(settings).length) throw new Error('لا يوجد Chat ID فعّال. أضفه من الإعدادات وتأكد أن صاحب المعرف فتح البوت وضغط Start.');
  const a=await generateCustomersDebtsArtifacts(app);
  const result=requireDelivery(await sendTelegramDocumentBlobToRecipients(a.pdf,{settings,caption:`تقرير العملاء والديون — ${settings.storeName||'كاش توب 3'}`,filename:a.pdfName}),'إرسال تقرير العملاء والديون');
  await saveTelegramConfig(settings).catch(()=>{});
  await bestEffortServer({action:'upload_customer_report',pdfBase64:await blobToBase64(a.pdf),pdfName:a.pdfName});
  return {ok:true,sent:result.sent,mode:'direct'};
}
export async function sendAllReportsNow(app){
  const settings=app.settings||{};
  if(!enabledReportRecipients(settings).length) throw new Error('لا يوجد Chat ID فعّال. أضفه من الإعدادات وتأكد أن صاحب المعرف فتح البوت وضغط Start.');
  const a=await generateAllReportsArtifacts(app);
  requireDelivery(await sendTelegramTextToRecipients(a.text,{settings}),'إرسال نص التقارير');
  requireDelivery(await sendTelegramPhotoBlobToRecipients(a.image,{settings,caption:`ملخص التقارير — ${settings.storeName||'كاش توب 3'}`,filename:a.imageName}),'إرسال صورة التقارير');
  const result=requireDelivery(await sendTelegramDocumentBlobToRecipients(a.pdf,{settings,caption:`جميع التقارير — ${settings.storeName||'كاش توب 3'}`,filename:a.pdfName}),'إرسال ملف التقارير');
  await saveTelegramConfig(settings).catch(()=>{});
  await bestEffortServer({action:'upload_all_reports',pdfBase64:await blobToBase64(a.pdf),pdfName:a.pdfName,imageBase64:await blobToBase64(a.image),imageName:a.imageName,text:a.text});
  return {ok:true,sent:result.sent,mode:'direct'};
}
export async function sendBackupNow(app){
  const settings=app.settings||{};
  if(!enabledReportRecipients(settings).length) throw new Error('لا يوجد Chat ID فعّال. أضفه من الإعدادات وتأكد أن صاحب المعرف فتح البوت وضغط Start.');
  const a=await generateBackupArtifact(app);
  const result=requireDelivery(await sendTelegramDocumentBlobToRecipients(a.blob,{settings,caption:`نسخة احتياطية كاملة — ${settings.storeName||'كاش توب 3'}`,filename:a.name}),'إرسال النسخة الاحتياطية');
  await saveTelegramConfig(settings).catch(()=>{});
  const sentAt=Date.now();
  writeLocalBackupStamp(sentAt);
  await bestEffortServer({action:'upload_backup',backupBase64:await blobToBase64(a.blob),backupName:a.name});
  await bestEffortServer({action:'mark_backup_sent',sentAt});
  return {ok:true,sent:result.sent,mode:'direct',sentAt};
}

