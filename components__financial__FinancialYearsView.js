import {t} from './services__i18n.js?v=7.9.4.136-localization';
import {ModalLayer} from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import {downloadBlob} from './utils__export.js?v=7.9.4.136-localization';
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { queryAllStoreRecords, getAllFromStore } from './services__db.js?v=7.9.4.136-localization';
import {
  CalendarRange, Archive, LockKeyhole, PlayCircle, ReceiptText, Truck, FileSpreadsheet,
  Receipt, ArrowLeftRight, PackageSearch, WalletCards, Users, Building2, Boxes, Eye,
  FolderArchive, Download, ChevronLeft, ShieldCheck, Clock3, X, DatabaseBackup
} from 'lucide-react';

const h=React.createElement;
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const money=v=>num(v).toFixed(2);
const dt=v=>{if(!v)return '-';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ar-EG'):'-'};
const dateOnly=v=>{if(!v)return '-';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleDateString('ar-EG'):'-'};

const Metric=({icon:Icon,label,value,sub,tone='emerald'})=>h('div',{className:'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs'},
  h('div',{className:'flex items-start justify-between gap-3'},
    h('div',{className:'min-w-0'},h('div',{className:'text-[10px] font-bold text-slate-500'},label),h('div',{className:'mt-1 text-lg font-black text-slate-900 dark:text-white font-mono'},value),sub?h('div',{className:'text-[9px] text-slate-400 mt-1'},sub):null),
    h('div',{className:`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone==='indigo'?'bg-indigo-50 text-indigo-600':tone==='amber'?'bg-amber-50 text-amber-600':tone==='blue'?'bg-blue-50 text-blue-600':'bg-violet-50 text-violet-600'}`},h(Icon,{className:'w-4 h-4'}))));

export const FinancialYearsView=()=>{
  const { settings, openNewFinancialYear, showToast, accounts, stock, products, customers, suppliers }=useApp();
  const years=Array.isArray(settings.financialYears)?settings.financialYears:[];
  const activeId=settings.activeFinancialYearId||years.find(y=>y?.status==='open')?.id||'fy-initial';
  const active=years.find(y=>y?.id===activeId)||years[years.length-1]||null;
  const legacyId=years[0]?.id||activeId;
  const [name,setName]=useState('');const [closedName,setClosedName]=useState('');const [showClose,setShowClose]=useState(false);const [archiveError,setArchiveError]=useState('');
  const [startDate,setStartDate]=useState(new Date().toISOString().slice(0,10));
  const [busy,setBusy]=useState(false);
  const [selectedId,setSelectedId]=useState(activeId);
  const [archive,setArchive]=useState({});
  const [loading,setLoading]=useState(true);
  const selected=years.find(y=>y?.id===selectedId)||active;

  useEffect(()=>{if(!years.some(y=>y?.id===selectedId))setSelectedId(activeId)},[activeId,settings.financialYears]);
  useEffect(()=>{
    let alive=true;setLoading(true);setArchiveError('');
    const stores=['invoices','purchases','vouchers','expenses','stock_movements','transfers','audit_logs','partner_statements','shifts','held_invoices','waste_records','restaurant_orders'];
    Promise.all(stores.map(async store=>[store,await queryAllStoreRecords(store,{pageSize:200,deletedMode:'all'})]))
      .then(rows=>{if(alive)setArchive(Object.fromEntries(rows))})
      .catch(e=>{if(alive)setArchiveError(e.message||'تعذر تحميل الأرشيف كاملاً')}).finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};
  },[settings.financialYears,settings.activeFinancialYearId]);

  const belongs=(row,yearId)=>String(row?.financialYearId||legacyId)===String(yearId);
  const rowsFor=(store,yearId=selectedId)=>(archive[store]||[]).filter(r=>belongs(r,yearId));
  const selectedData=useMemo(()=>{
    const invoices=rowsFor('invoices');
    const sales=invoices.filter(x=>x?.type==='sale');
    const returns=invoices.filter(x=>x?.type==='return');
    const purchases=rowsFor('purchases');
    const vouchers=rowsFor('vouchers');
    const expenses=rowsFor('expenses').filter(x=>!x?.deletedAt);
    const stockMovements=rowsFor('stock_movements');
    const transfers=rowsFor('transfers');
    const shifts=rowsFor('shifts');
    const partnerStatements=rowsFor('partner_statements');
    const auditLogs=rowsFor('audit_logs');
    const heldInvoices=rowsFor('held_invoices');
    const wasteRecords=rowsFor('waste_records');
    const restaurantOrders=rowsFor('restaurant_orders');
    return {invoices,sales,returns,purchases,vouchers,expenses,stockMovements,transfers,shifts,partnerStatements,auditLogs,heldInvoices,wasteRecords,restaurantOrders,
      salesTotal:sales.reduce((a,x)=>a+num(x.grandTotal),0),returnsTotal:returns.reduce((a,x)=>a+num(x.grandTotal),0),
      purchaseTotal:purchases.reduce((a,x)=>a+num(x.grandTotal),0),expenseTotal:expenses.reduce((a,x)=>a+num(x.amount),0)};
  },[archive,selectedId,legacyId]);

  const staticBalances=useMemo(()=>{
    const inventoryCost=(stock||[]).reduce((sum,row)=>{const p=(products||[]).find(x=>x.id===row.productId);return sum+num(row.baseQuantity)*num(p?.costPrice)},0);
    return {
      accountBalance:(accounts||[]).reduce((a,x)=>a+num(x.balance),0),
      customerDebt:(customers||[]).reduce((a,x)=>a+Math.max(0,num(x.balance)),0),
      supplierDebt:(suppliers||[]).reduce((a,x)=>a+Math.max(0,num(x.balance)),0),
      inventoryCost
    };
  },[accounts,stock,products,customers,suppliers]);

  const startNew=async e=>{
    e?.preventDefault?.();
    if(busy)return;
    const ok=window.confirm(`سيتم إغلاق «${active?.name||'السنة الحالية'}» وأرشفة جميع حركاتها، ثم فتح سنة جديدة.\n\nستستمر الحسابات والمخزون وأرصدة العملاء والموردين كما هي. متابعة؟`);
    if(!ok)return;
    setBusy(true);
    try{
      const y=await openNewFinancialYear({name:name.trim(),closedName:closedName.trim(),startDate});
      if(y){setShowClose(false);setName('');setStartDate(new Date().toISOString().slice(0,10));setSelectedId(y.id);showToast('تم ترحيل الثوابت والأرصدة إلى السنة الجديدة وأرشفة الحركات السابقة','success');}
    }catch(err){showToast(err?.message||'تعذر فتح السنة المالية الجديدة','error')}
    finally{setBusy(false)}
  };

  const downloadGroup=()=>{
    if(loading||archiveError||!selected)return;
    const data=Object.fromEntries(Object.keys(archive).map(store=>[store,rowsFor(store,selected.id)]));
    const snapshot=(data.audit_logs||[]).find(x=>x.type==='fiscal_closing_snapshot');
    const payload={format:'cash-top-financial-group',version:1,exportedAt:new Date().toISOString(),group:selected,readOnly:true,data,closingBalances:snapshot?.masters||null};
    const filename=String(selected.name||'المجموعة').replace(/[\\/:*?"<>|]/g,'-')+'.json';
    downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),filename);
  };
  const previewRows=[
    ['فواتير المبيعات',ReceiptText,selectedData.sales.map(x=>({date:x.date,ref:x.invoiceNumber||x.id,name:x.customerName||'عميل',amount:x.grandTotal}))],
    ['المرتجعات',ReceiptText,selectedData.returns.map(x=>({date:x.date,ref:x.invoiceNumber||x.id,name:x.customerName||'عميل',amount:-num(x.grandTotal)}))],
    ['المشتريات',Truck,selectedData.purchases.map(x=>({date:x.date,ref:x.invoiceNumber||x.id,name:x.supplierName||'مورد',amount:x.grandTotal}))],
    ['السندات',FileSpreadsheet,selectedData.vouchers.map(x=>({date:x.date,ref:x.voucherNumber||x.id,name:x.partyName||'-',amount:x.type==='receipt'?x.amount:-num(x.amount)}))],
    ['المصروفات',Receipt,selectedData.expenses.map(x=>({date:x.date||x.createdAt,ref:x.category||x.id,name:x.notes||'-',amount:-num(x.amount)}))],
    ['التحويلات',ArrowLeftRight,selectedData.transfers.map(x=>({date:x.date,ref:x.fromAccountName||'حساب',name:`إلى ${x.toAccountName||'حساب'}`,amount:x.amount}))],
    ['حركات المخزون',PackageSearch,selectedData.stockMovements.map(x=>({date:x.date,ref:x.type||x.referenceType||'-',name:`${x.productName||'صنف'} — ${x.warehouseName||'مخزن'}`,amount:x.baseQuantityChange}))],
    ['حسابات العملاء والموردين',Users,selectedData.partnerStatements.map(x=>({date:x.date,ref:x.referenceNumber||x.referenceType||'-',name:`${x.partnerName||x.partyName||'-'} — ${x.description||x.type||''}`,amount:num(x.debit)-num(x.credit)}))],
    ['الورديات',Clock3,selectedData.shifts.map(x=>({date:x.startTime||x.date,ref:`وردية ${x.shiftNumber||x.id}`,name:`${x.cashierName||'-'} — ${x.status==='closed'?'مغلقة':'مفتوحة'}`,amount:x.difference||0}))],
    ['سجل العمليات',DatabaseBackup,selectedData.auditLogs.map(x=>({date:x.date||x.createdAt,ref:x.referenceNumber||x.type||'-',name:x.description||x.type||'عملية',amount:x.amount||x.debtReversed||0}))],
    ['الفواتير المعلقة المؤرشفة',ReceiptText,selectedData.heldInvoices.map(x=>({date:x.date||x.createdAt,ref:x.invoiceNumber||x.id,name:x.customerName||'عميل',amount:x.subtotal||x.grandTotal||0}))],
    ['الهالك والاستهلاك',Receipt,selectedData.wasteRecords.map(x=>({date:x.date||x.createdAt,ref:x.reason||x.type||x.id,name:x.productName||x.itemName||'هالك',amount:x.cost||x.amount||0}))],
    ['طلبات المطعم',ReceiptText,selectedData.restaurantOrders.map(x=>({date:x.date||x.createdAt,ref:x.orderNumber||x.id,name:x.tableName||x.customerName||'طلب',amount:x.total||x.grandTotal||0}))],
  ];

  return h('div',{className:'p-4 sm:p-6 space-y-5 max-w-7xl mx-auto text-right'},
    h('div',{className:'flex flex-col lg:flex-row lg:items-center justify-between gap-4'},
      h('div',{className:'flex items-start gap-3'},h('div',{className:'w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center'},h(CalendarRange,{className:'w-6 h-6'})),h('div',null,h('h2',{className:'text-xl font-black text-slate-900 dark:text-white'},t("المجموعات المالية والأرشيف")),h('p',{className:'text-xs text-slate-500 mt-1'},'كل سنة مستقلة بحركاتها. عند فتح سنة جديدة تُؤرشف الحركات القديمة وتستمر الثوابت والأرصدة والمخزون كما هي.'))),
      h('div',{className:'px-4 py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-800 text-xs font-black'},`المجموعة المفتوحة: ${active?.name||t("الحالية")}`)),

    h('div',{className:'grid grid-cols-2 lg:grid-cols-4 gap-3'},
      h(Metric,{icon:WalletCards,label:'أرصدة الحسابات المرحلة',value:`${money(staticBalances.accountBalance)} ${settings.currencySymbol||''}`,sub:'تبقى مستمرة بين السنوات',tone:'blue'}),
      h(Metric,{icon:Boxes,label:'قيمة المخزون الحالية',value:`${money(staticBalances.inventoryCost)} ${settings.currencySymbol||''}`,sub:'المخزون لا يبدأ من صفر',tone:'emerald'}),
      h(Metric,{icon:Users,label:'ديون العملاء المرحلة',value:`${money(staticBalances.customerDebt)} ${settings.currencySymbol||''}`,sub:`${(customers||[]).length} عميل`,tone:'amber'}),
      h(Metric,{icon:Building2,label:'مستحق الموردين المرحل',value:`${money(staticBalances.supplierDebt)} ${settings.currencySymbol||''}`,sub:`${(suppliers||[]).length} مورد`,tone:'indigo'})),

    h('section',{className:'rounded-3xl border border-indigo-200 dark:border-indigo-900 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm'},
      h('div',{className:'flex items-center gap-2 mb-4'},h(PlayCircle,{className:'w-5 h-5 text-indigo-600'}),h('div',null,h('div',{className:'font-black text-sm'},'إغلاق المجموعة الحالية وفتح مجموعة جديدة'),h('div',{className:'text-[10px] text-slate-500 mt-0.5'},'لا يوجد تاريخ نهاية مسبق. الإغلاق يحدث فقط لحظة فتح السنة التالية.'))),
      showClose?h(ModalLayer,{className:'fixed inset-0 bg-black/50 flex items-center justify-center p-4',onClick:()=>!busy&&setShowClose(false)},h('div',{className:'ct-financial-close-dialog',onClick:e=>e.stopPropagation()},h('h3',null,t("إغلاق المجموعة المالية")),h('label',null,t("اسم المجموعة المؤرشفة"),h('input',{value:closedName,onChange:e=>setClosedName(e.target.value),required:true})),h('form',{onSubmit:startNew,className:'grid grid-cols-1 sm:grid-cols-[1fr_180px_auto] gap-3 items-end'},
        h('label',{className:'text-[11px] font-bold'},t("اسم المجموعة الجديدة"),h('input',{value:name,onChange:e=>setName(e.target.value),placeholder:'مثال: السنة المالية 2027',className:'block w-full mt-1 px-3 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-xs'})),
        h('label',{className:'text-[11px] font-bold'},t("تاريخ البداية"),h('input',{type:'date',value:startDate,onChange:e=>setStartDate(e.target.value),className:'block w-full mt-1 px-3 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-xs'})),
        h('button',{type:'submit',disabled:busy,className:'h-[42px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black disabled:opacity-50'},busy?'جاري الأرشفة...':'إغلاق وفتح الجديدة')),h('button',{type:'button',disabled:busy,onClick:()=>setShowClose(false)},t("إلغاء")))):h('button',{type:'button',className:'ct-financial-close-button',onClick:()=>{setClosedName(active?.name||'');setShowClose(true)}},t("إغلاق المجموعة المالية")),
      h('div',{className:'mt-3 flex items-start gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-[10px] leading-5 text-slate-600 dark:text-slate-300'},h(ShieldCheck,{className:'w-4 h-4 text-violet-600 shrink-0 mt-0.5'}),h('span',null,'يتم أرشفة فواتير البيع والمرتجعات والمشتريات والسندات والمصروفات وحركات المخزون والتحويلات والورديات وسجل العمليات. تبقى الأصناف والكميات والحسابات والعملاء والموردون وأرصدتهم والإعدادات والمخازن مستخدمة في السنة الجديدة.'))),

    h('section',{className:'space-y-3'},
      h('div',{className:'flex items-center gap-2'},h(Archive,{className:'w-5 h-5 text-slate-500'}),h('h3',{className:'font-black text-sm'},t("المجموعات المالية"))),
      h('div',{className:'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'},...years.slice().reverse().map(year=>{
        const current=year.id===activeId;
        const counts={sales:(archive.invoices||[]).filter(r=>belongs(r,year.id)&&r.type==='sale').length,purchases:(archive.purchases||[]).filter(r=>belongs(r,year.id)).length,vouchers:(archive.vouchers||[]).filter(r=>belongs(r,year.id)).length};
        return h('button',{key:year.id,type:'button',onClick:()=>setSelectedId(year.id),className:`text-right p-4 rounded-2xl border transition ${selectedId===year.id?'border-indigo-500 ring-2 ring-indigo-100 bg-indigo-50/40':'border-slate-200 bg-white hover:border-indigo-300'} dark:bg-slate-900`},
          h('div',{className:'flex items-start justify-between gap-2'},h('div',null,h('div',{className:'font-black text-sm flex items-center gap-2'},h(FolderArchive,{size:22}),year.name||'مجموعة مالية'),h('div',{className:'text-[10px] text-slate-500 mt-1'},`${dateOnly(year.startDate)} ← ${current?t("مفتوحة"):dateOnly(year.endDate)}`)),h('span',{className:`px-2 py-1 rounded-full text-[9px] font-black ${current?'bg-violet-100 text-violet-700':'bg-slate-100 text-slate-600'}`},current?t("مفتوحة"):t("مؤرشفة"))),
          h('div',{className:'grid grid-cols-3 gap-1 mt-3 text-center'},h('div',{className:'rounded-lg bg-slate-50 p-2'},h('b',{className:'block text-xs'},counts.sales),h('span',{className:'text-[8px] text-slate-500'},'مبيعات')),h('div',{className:'rounded-lg bg-slate-50 p-2'},h('b',{className:'block text-xs'},counts.purchases),h('span',{className:'text-[8px] text-slate-500'},'مشتريات')),h('div',{className:'rounded-lg bg-slate-50 p-2'},h('b',{className:'block text-xs'},counts.vouchers),h('span',{className:'text-[8px] text-slate-500'},'سندات'))));
      }))),

    archiveError?h('p',{role:'alert',className:'text-rose-600'},archiveError):null,
    selected?h('section',{className:'rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4'},
      h('div',{className:'flex flex-col sm:flex-row sm:items-center justify-between gap-3'},h('div',{className:'flex items-center gap-2'},selected.id===activeId?h(Clock3,{className:'w-5 h-5 text-violet-600'}):h(LockKeyhole,{className:'w-5 h-5 text-slate-500'}),h('div',null,h('div',{className:'font-black text-base'},selected.name),h('button',{type:'button',onClick:downloadGroup,disabled:loading||!!archiveError,className:'ct-archive-download'},h(Download,{size:16}),t("تحميل بيانات المجموعة")),h('div',{className:'text-[10px] text-slate-500'},selected.id===activeId?'السنة الحالية — قابلة لإضافة الحركات':'سنة مؤرشفة — عرض وقراءة فقط'))),loading?h('span',{className:'text-[10px] text-slate-400'},'جاري تحميل الأرشيف...'):null),
      h('div',{className:'grid grid-cols-2 md:grid-cols-4 gap-3'},
        h(Metric,{icon:ReceiptText,label:t("صافي المبيعات"),value:`${money(selectedData.salesTotal-selectedData.returnsTotal)} ${settings.currencySymbol||''}`,sub:`${selectedData.sales.length} بيع • ${selectedData.returns.length} مرتجع`}),
        h(Metric,{icon:Truck,label:t("المشتريات"),value:`${money(selectedData.purchaseTotal)} ${settings.currencySymbol||''}`,sub:`${selectedData.purchases.length} فاتورة`,tone:'blue'}),
        h(Metric,{icon:Receipt,label:t("المصروفات"),value:`${money(selectedData.expenseTotal)} ${settings.currencySymbol||''}`,sub:`${selectedData.expenses.length} عملية`,tone:'amber'}),
        h(Metric,{icon:PackageSearch,label:'حركات المخزون',value:String(selectedData.stockMovements.length),sub:`${selectedData.transfers.length} تحويل مالي`,tone:'indigo'})),
      ...previewRows.map(([title,Icon,rows])=>h('div',{key:title,className:'rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden'},
        h('div',{className:'flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800/60'},h('div',{className:'flex items-center gap-2'},h(Icon,{className:'w-4 h-4 text-indigo-600'}),h('b',{className:'text-xs'},title)),h('span',{className:'text-[9px] text-slate-500'},`${rows.length} سجل`)),
        rows.length
          ? h('div',{className:'overflow-x-auto'},
              h('table',{className:'w-full text-[10px] min-w-[620px]'},
                h('thead',null,
                  h('tr',{className:'text-slate-400 border-b'},
                    h('th',{className:'p-2 text-right'},t("التاريخ")),
                    h('th',{className:'p-2 text-right'},t("المرجع")),
                    h('th',{className:'p-2 text-right'},'الجهة / البيان'),
                    h('th',{className:'p-2 text-left'},'القيمة'))),
                h('tbody',null,
                  ...rows.slice(0,50).map((r,i)=>h('tr',{key:`${title}-${i}`,className:'border-b last:border-0'},
                    h('td',{className:'p-2 whitespace-nowrap'},dt(r.date)),
                    h('td',{className:'p-2 font-bold'},String(r.ref||'-')),
                    h('td',{className:'p-2'},String(r.name||'-')),
                    h('td',{className:`p-2 text-left font-mono font-bold ${num(r.amount)<0?'text-rose-600':'text-slate-800'}`},`${money(r.amount)} ${settings.currencySymbol||''}`))))))
          : h('div',{className:'p-4 text-center text-[10px] text-slate-400'},'لا توجد سجلات في هذا القسم')))
    ):null
  );
};
