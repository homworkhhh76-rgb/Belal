import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { peekCachedStoreStats } from './services__db.js?v=7.9.4.136-localization';
import { BarChart3, Wallet, Users, Package, ShoppingCart, PackagePlus, ClipboardList, Receipt, ArrowLeft, CalendarDays, TrendingUp, CircleDot } from 'lucide-react';

const h = React.createElement;
const nf = new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const pad=n=>String(n).padStart(2,'0');
const localDateKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfDay=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
const endOfDay=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
const addDays=(d,n)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds());
const money=(value,symbol)=>`${nf.format(Number(value)||0)} ${symbol||''}`.trim();
const invoiceTime=inv=>new Date(inv?.date||inv?.createdAt||0).getTime();
const safeDate=value=>{const d=new Date(value||0);return Number.isFinite(d.getTime())?d:null;};

const periodRange=(period,from,to)=>{
  const now=new Date();
  if(period==='today')return{start:startOfDay(now),end:endOfDay(now)};
  if(period==='week')return{start:startOfDay(addDays(now,-6)),end:endOfDay(now)};
  if(period==='month')return{start:new Date(now.getFullYear(),now.getMonth(),1),end:endOfDay(now)};
  if(period==='custom'){
    const s=from?startOfDay(new Date(`${from}T12:00:00`)):null;
    const e=to?endOfDay(new Date(`${to}T12:00:00`)):null;
    return{start:s,end:e};
  }
  return{start:null,end:null};
};
const previousRange=range=>{
  if(!range.start||!range.end)return null;
  const len=range.end.getTime()-range.start.getTime()+1;
  return{start:new Date(range.start.getTime()-len),end:new Date(range.start.getTime()-1)};
};
const inRange=(row,range)=>{
  const t=invoiceTime(row);if(!t)return false;
  if(range.start&&t<range.start.getTime())return false;
  if(range.end&&t>range.end.getTime())return false;
  return true;
};
const makeBuckets=(period,range)=>{
  const now=new Date();
  if(period==='today')return Array.from({length:6},(_,i)=>{const s=new Date(now.getFullYear(),now.getMonth(),now.getDate(),i*4);const e=new Date(now.getFullYear(),now.getMonth(),now.getDate(),i*4+3,59,59,999);return{start:s,end:e,label:`${pad(i*4)}:00`};});
  if(period==='week')return Array.from({length:7},(_,i)=>{const d=addDays(range.end||now,-6+i);return{start:startOfDay(d),end:endOfDay(d),label:d.toLocaleDateString('ar-EG',{weekday:'short'})};});
  if(period==='month'){
    const base=range.start||new Date(now.getFullYear(),now.getMonth(),1);const end=range.end||now;const days=Math.max(1,Math.ceil((end.getTime()-base.getTime()+1)/86400000));const step=Math.max(1,Math.ceil(days/6));
    const out=[];for(let i=0;i<6;i++){const s=addDays(base,i*step);if(s>end)break;const e=endOfDay(addDays(s,step-1));out.push({start:s,end:e>end?end:e,label:`${s.getDate()}/${s.getMonth()+1}`});}return out;
  }
  if(period==='custom'&&range.start&&range.end){
    const days=Math.max(1,Math.ceil((range.end-range.start+1)/86400000));const count=Math.min(7,days);const step=Math.max(1,Math.ceil(days/count));const out=[];for(let i=0;i<count;i++){const s=addDays(range.start,i*step);if(s>range.end)break;const e=endOfDay(addDays(s,step-1));out.push({start:s,end:e>range.end?range.end:e,label:`${s.getDate()}/${s.getMonth()+1}`});}return out;
  }
  return Array.from({length:6},(_,i)=>{const d=new Date(now.getFullYear(),now.getMonth()-5+i,1);return{start:d,end:new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59,999),label:d.toLocaleDateString('ar-EG',{month:'short'})};});
};
const Chart=({values,labels})=>{
  const width=600,height=140,padY=10,bottom=124;
  const max=Math.max(1,...values);const step=values.length>1?width/(values.length-1):width;
  const pts=values.map((v,i)=>[Math.round(i*step*10)/10,Math.round((bottom-(Number(v)||0)/max*(bottom-padY))*10)/10]);
  const line=pts.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ');
  const area=pts.length?`${line} L${pts[pts.length-1][0]} ${bottom} L0 ${bottom} Z`:'';
  return h(React.Fragment,null,
    h('div',{className:'osd-chart-wrap'},h('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'الرسم البياني للمبيعات'},
      h('defs',null,h('linearGradient',{id:'osdChartGradient',x1:'0',y1:'0',x2:'0',y2:'1'},h('stop',{offset:'0%',stopColor:'#7C3AED',stopOpacity:'.18'}),h('stop',{offset:'100%',stopColor:'#7C3AED',stopOpacity:'0'}))),
      h('g',{stroke:'#edf2ef',strokeDasharray:'4 5'},h('path',{d:'M0 10H600M0 48H600M0 86H600M0 124H600'})),
      h('path',{d:area,fill:'url(#osdChartGradient)'}),h('path',{d:line,fill:'none',stroke:'#7C3AED',strokeWidth:'2.8',strokeLinejoin:'round',strokeLinecap:'round'}),
      ...pts.map((p,i)=>h('circle',{key:i,cx:p[0],cy:p[1],r:3,fill:'#fff',stroke:'#7C3AED',strokeWidth:2}))
    )),
    h('div',{className:'osd-chart-labels'},...labels.map((label,i)=>h('span',{key:i},label)))
  );
};

export const DashboardView=()=>{
  const {products,customers,accounts,settings,setActiveTab,getProductStock,queryStoreStats,queryStorePage}=useApp();
  const [period,setPeriod]=useState('today');
  const [customFrom,setCustomFrom]=useState(localDateKey(new Date()));
  const [customTo,setCustomTo]=useState(localDateKey(new Date()));
  const range=useMemo(()=>periodRange(period,customFrom,customTo),[period,customFrom,customTo]);
  const years=Array.isArray(settings.financialYears)?settings.financialYears:[];
  const activeFY=settings.activeFinancialYearId||years.find(y=>y?.status==='open')?.id||'fy-initial';
  const legacyFY=years[0]?.id||activeFY;
  const previous=previousRange(range);
  const buckets=useMemo(()=>makeBuckets(period,range),[period,range.start?.getTime(),range.end?.getTime()]);
  const toIso=d=>d?d.toISOString():null;
  const dashboardStatsOptions=useMemo(()=>{
    const ranges=[{key:'current',from:toIso(range.start),to:toIso(range.end)}];
    if(previous) ranges.push({key:'previous',from:toIso(previous.start),to:toIso(previous.end)});
    buckets.forEach((b,i)=>ranges.push({key:`bucket_${i}`,from:toIso(b.start),to:toIso(b.end)}));
    return {filters:{financialYearId:activeFY,type:'sale'},legacyFinancialYearId:legacyFY,deletedMode:'exclude',dateField:'date',ranges,sumFields:['grandTotal','paidAmount']};
  },[activeFY,legacyFY,range.start?.getTime(),range.end?.getTime(),previous?.start?.getTime(),previous?.end?.getTime(),buckets]);
  const [salesMetrics,setSalesMetrics]=useState(()=>{
    const cached=peekCachedStoreStats('invoices',dashboardStatsOptions);
    const current=cached?.ranges?.current;
    const prev=cached?.ranges?.previous;
    return {
      count:Number(current?.count||0),
      total:Number(current?.sums?.grandTotal||0),
      paid:Number(current?.sums?.paidAmount||0),
      previousTotal:Number(prev?.sums?.grandTotal||0),
      chartValues:buckets.map((_,i)=>Number(cached?.ranges?.[`bucket_${i}`]?.sums?.grandTotal||0)),
      recent:[],loading:true,hasSnapshot:!!current
    };
  });
  useEffect(()=>{
    if(typeof queryStoreStats!=='function'||typeof queryStorePage!=='function') return undefined;
    let cancelled=false;
    const cached=peekCachedStoreStats('invoices',dashboardStatsOptions);
    if(cached?.ranges?.current){
      const current=cached.ranges.current; const prev=cached.ranges.previous;
      setSalesMetrics(old=>({
        ...old,count:Number(current.count||0),total:Number(current.sums?.grandTotal||0),paid:Number(current.sums?.paidAmount||0),
        previousTotal:Number(prev?.sums?.grandTotal||0),chartValues:buckets.map((_,i)=>Number(cached.ranges?.[`bucket_${i}`]?.sums?.grandTotal||0)),
        loading:true,hasSnapshot:true
      }));
    } else setSalesMetrics(old=>({...old,loading:true}));
    Promise.all([
      queryStoreStats('invoices',dashboardStatsOptions),
      queryStorePage('invoices',{
        page:1,pageSize:7,filters:{financialYearId:activeFY,type:'sale'},legacyFinancialYearId:legacyFY,deletedMode:'exclude',sortField:'date',sortDirection:'desc',dateFrom:toIso(range.start),dateTo:toIso(range.end)
      })
    ]).then(([stats,page])=>{
      if(cancelled)return;
      const current=stats?.ranges?.current||{count:0,sums:{}};
      const prev=stats?.ranges?.previous||{count:0,sums:{}};
      setSalesMetrics({
        count:Number(current.count||0),
        total:Number(current.sums?.grandTotal||0),
        paid:Number(current.sums?.paidAmount||0),
        previousTotal:Number(prev.sums?.grandTotal||0),
        chartValues:buckets.map((_,i)=>Number(stats?.ranges?.[`bucket_${i}`]?.sums?.grandTotal||0)),
        recent:Array.isArray(page?.items)?page.items:[],
        loading:false,hasSnapshot:true,
      });
    }).catch(err=>{console.warn('Dashboard aggregate load failed',err);if(!cancelled)setSalesMetrics(prev=>({...prev,loading:false}));});
    return()=>{cancelled=true;};
  },[queryStoreStats,queryStorePage,dashboardStatsOptions,activeFY,legacyFY,period,customFrom,customTo,buckets]);
  const salesTotal=salesMetrics.total;
  const previousTotal=salesMetrics.previousTotal;
  const trend=previous&&previousTotal>0?((salesTotal-previousTotal)/previousTotal*100):(previous&&salesTotal>0?100:0);
  const accountBalance=accounts.reduce((s,a)=>s+(Number(a?.balance)||0),0);
  const debtors=customers.filter(c=>!c?.deletedAt&&(Number(c?.balance)||0)>0);
  const debt=debtors.reduce((s,c)=>s+(Number(c.balance)||0),0);
  const lowStock=products.filter(p=>!p?.deletedAt&&p?.status!=='archived'&&p?.reorderPoint!==undefined&&getProductStock(p.id,settings.activeWarehouseId)<=Number(p.reorderPoint||0));
  const paid=salesMetrics.paid;
  const collectionRate=salesTotal>0?Math.round(paid/salesTotal*100):0;
  const chartValues=salesMetrics.chartValues.length===buckets.length?salesMetrics.chartValues:buckets.map(()=>0);
  const recent=salesMetrics.recent;
  const filteredSalesCount=salesMetrics.count;
  const showSalesSnapshot=salesMetrics.hasSnapshot||!salesMetrics.loading;
  const salesTotalLabel=showSalesSnapshot?nf.format(salesTotal):'…';
  const salesCountLabel=showSalesSnapshot?String(filteredSalesCount):'…';
  const symbol=settings.currencySymbol||'₪';
  const periodLabel={today:'اليوم',week:'آخر 7 أيام',month:'هذا الشهر',all:'جميع الفترات',custom:'فترة مخصصة'}[period];
  const quick=[
    {id:'pos',title:t("فاتورة جديدة"),sub:'فتح الكاشير وبدء البيع',icon:ShoppingCart},
    {id:'products',title:t("إضافة صنف"),sub:'إدارة الأصناف والوحدات',icon:PackagePlus},
    {id:'inventory',title:t("جرد المخزون"),sub:'مراجعة وتسوية الكميات',icon:ClipboardList},
    {id:'expenses',title:t("تسجيل مصروف"),sub:'إضافة حركة مصروف جديدة',icon:Receipt},
  ];
  const badge=inv=>inv.paymentType==='cash'||Number(inv.remainingAmount||0)<=0?['مدفوعة','paid']:inv.paymentType==='debt'?['آجلة','credit']:['مدفوعة جزئياً','partial'];
  return h('div',{className:'osd-root'},
    h('section',{className:'osd-period card'},h('div',{className:'osd-period-label'},h(CalendarDays,{className:'osd-mini-icon'}),h('span',null,t("الفترة")),h('small',null,periodLabel)),h('div',{className:'osd-segments'},...['today','week','month','all','custom'].map(id=>h('button',{key:id,type:'button',className:`osd-segment ${period===id?'active':''}`,onClick:()=>setPeriod(id)},({today:'اليوم',week:'الأسبوع',month:'الشهر',all:'الكل',custom:'مخصص'})[id]))),period==='custom'?h('div',{className:'osd-custom'},h('label',null,h('span',null,t("من")),h('input',{type:'date',value:customFrom,onChange:e=>setCustomFrom(e.target.value)})),h('label',null,h('span',null,t("إلى")),h('input',{type:'date',value:customTo,onChange:e=>setCustomTo(e.target.value)}))):null),
    h('section',{className:'osd-kpi-grid'},
      h('article',{className:'osd-kpi card'},h('div',{className:'osd-kpi-top'},h('h2',null,t("إجمالي المبيعات")),h('div',{className:'osd-icon-tile'},h(BarChart3,null))),h('div',{className:'osd-kpi-value'},h('span',{dir:'ltr'},salesTotalLabel),h('small',null,symbol)),h('div',{className:'osd-kpi-bottom'},period==='all'?h('span',null,`${salesCountLabel} فاتورة`):h(React.Fragment,null,h('span',{className:`osd-trend ${trend<0?'down':''}`},`${trend>=0?'+':''}${trend.toFixed(1)}%`),h('span',null,t("عن الفترة السابقة"))))),
      h('article',{className:'osd-kpi card'},h('div',{className:'osd-kpi-top'},h('h2',null,t("أرصدة الحسابات")),h('div',{className:'osd-icon-tile'},h(Wallet,null))),h('div',{className:'osd-kpi-value'},h('span',{dir:'ltr'},nf.format(accountBalance)),h('small',null,symbol)),h('div',{className:'osd-kpi-bottom'},h('span',{className:'osd-dot'}),h('span',null,'النقدي والبنك والمحافظ'))),
      h('article',{className:'osd-kpi card debt'},h('div',{className:'osd-kpi-top'},h('h2',null,t("إجمالي ديون العملاء")),h('div',{className:'osd-icon-tile'},h(Users,null))),h('div',{className:'osd-kpi-value'},h('span',{dir:'ltr'},nf.format(debt)),h('small',null,symbol)),h('div',{className:'osd-kpi-bottom'},h('span',null,`${debtors.length} عميل`),h('span',null,'لديهم رصيد مستحق'))),
      h('article',{className:'osd-kpi card stock'},h('div',{className:'osd-kpi-top'},h('h2',null,t("تنبيهات المخزون")),h('div',{className:'osd-icon-tile'},h(Package,null))),h('div',{className:'osd-kpi-value'},h('span',{dir:'ltr'},lowStock.length),h('small',null,'أصناف')),h('div',{className:'osd-kpi-bottom'},h('span',null,'وصلت إلى حد إعادة الطلب')))
    ),
    h('section',{className:'osd-overview'},
      h('article',{className:'osd-sales-chart card'},h('div',{className:'osd-card-head'},h('div',null,h('h2',null,t("حركة المبيعات")),h('p',null,`إيرادات ${periodLabel}`)),h('span',{className:'osd-legend'},h('span',{className:'osd-dot'}),t("المبيعات"))),h(Chart,{values:chartValues,labels:buckets.map(x=>x.label)})),
      h('article',{className:'osd-insight card'},h('div',{className:'osd-insight-top'},h(TrendingUp,null),t("نظرة على أعمالك")),h('div',null,h('h3',null,t("الأرقام الواضحة،"),h('br'),t("بداية القرار الصحيح.")),h('p',null,showSalesSnapshot?(filteredSalesCount?`سجلت ${filteredSalesCount} فاتورة خلال ${periodLabel}.`:'ابدأ بتسجيل مبيعاتك لتظهر المؤشرات هنا.'):'جارٍ تحديث المؤشرات…')),h('div',{className:'osd-insight-foot'},h('span',null,t("نسبة التحصيل")),h('strong',null,`${collectionRate}%`)))
    ),
    h('div',{className:'osd-section-heading'},h('div',null,h('h2',null,t("دخول سريع")),h('span',null,'انتقل مباشرة إلى أقسام النظام'))),
    h('section',{className:'osd-actions'},...quick.map(item=>h('button',{key:item.id,type:'button',className:'osd-action',onClick:()=>setActiveTab(item.id)},h('div',{className:'osd-action-icon'},h(item.icon,null)),h('div',null,h('strong',null,item.title),h('small',null,item.sub)),h(ArrowLeft,{className:'osd-action-arrow'})))),
    h('section',{className:'osd-invoices card'},h('div',{className:'osd-invoice-head'},h('div',null,h('h2',null,t("آخر الفواتير")),h('p',null,`أحدث عمليات البيع ضمن ${periodLabel}`)),h('button',{type:'button',onClick:()=>setActiveTab('sales')},t("عرض كافة الفواتير"),h(ArrowLeft,null))),
      recent.length===0?h('div',{className:'osd-empty'},'لا توجد فواتير مبيعات ضمن الفترة المحددة.'):
      h(React.Fragment,null,
        h('div',{className:'osd-table-wrap'},h('table',{className:'osd-table'},h('thead',null,h('tr',null,h('th',null,t("رقم الفاتورة")),h('th',null,t("العميل")),h('th',null,t("التاريخ")),h('th',null,t("الوقت")),h('th',null,t("الحالة")),h('th',null,t("الإجمالي")))),h('tbody',null,...recent.map(inv=>{const b=badge(inv),d=safeDate(inv.date);return h('tr',{key:inv.id},h('td',null,h('span',{className:'osd-invoice-id'},inv.invoiceNumber||inv.id)),h('td',null,inv.customerName||t("زبون عام")),h('td',null,d?d.toLocaleDateString('ar-EG'):'—'),h('td',null,d?d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'}):'—'),h('td',null,h('span',{className:`osd-badge ${b[1]}`},b[0])),h('td',{className:'osd-amount'},money(inv.grandTotal,symbol)));})))),
        h('div',{className:'osd-mobile-invoices'},...recent.map(inv=>{const b=badge(inv),d=safeDate(inv.date);return h('article',{key:inv.id,className:'osd-invoice-item'},h('div',{className:'osd-invoice-top'},h('div',null,h('span',{className:'osd-invoice-id'},inv.invoiceNumber||inv.id),h('strong',null,inv.customerName||t("زبون عام"))),h('span',{className:`osd-badge ${b[1]}`},b[0])),h('div',{className:'osd-invoice-bottom'},h('span',null,d?`${d.toLocaleDateString('ar-EG')} • ${d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}`:'—'),h('strong',null,money(inv.grandTotal,symbol))));}))
      ),
      h('div',{className:'osd-invoice-footer'},h('span',null,`عرض ${recent.length} من ${salesCountLabel} فاتورة`),h('span',null,`إجمالي الفترة: ${money(salesTotal,symbol)}`))
    ),
  );
};
