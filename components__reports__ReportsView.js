import {t} from './services__i18n.js?v=7.9.4.136-localization';
import {downloadProfessionalTablePDF,downloadProfessionalTableImage} from './utils__professionalExport.js?v=7.9.4.136-localization';
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { exportToCSV, downloadBlob } from './utils__export.js?v=7.9.4.136-localization';
import { getAllFromStore } from './services__db.js?v=7.9.4.136-localization';
import { Download, ReceiptText, Package, Users, Truck, WalletCards, CalendarDays, CircleDollarSign, FileText, Image as ImageIcon, TrendingUp } from 'lucide-react';

const h = React.createElement;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => num(v).toFixed(2);
const EPS = 0.000001;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

const Metric = ({ label, value, sub, tone = 'slate', icon: Icon }) => h('div', {
  className: `ct-report-metric rounded-2xl border p-4 bg-white dark:bg-slate-900 shadow-xs ${tone === 'emerald' ? 'border-violet-200 dark:border-violet-900' : tone === 'rose' ? 'border-rose-200 dark:border-rose-900' : tone === 'blue' ? 'border-blue-200 dark:border-blue-900' : 'border-slate-200 dark:border-slate-800'}`
},
  h('div', { className: 'flex items-center justify-between gap-2' },
    h('div', { className: 'text-[11px] font-bold text-slate-500' }, label),
    Icon ? h('div', { className:`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${tone === 'emerald' ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-600' : tone === 'rose' ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600' : tone === 'blue' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}` }, h(Icon,{className:'w-4 h-4'})) : null
  ),
  h('div', { className: `mt-1 text-xl font-black font-mono ${tone === 'emerald' ? 'text-violet-700 dark:text-violet-400' : tone === 'rose' ? 'text-rose-600' : tone === 'blue' ? 'text-blue-700 dark:text-blue-400' : 'text-slate-900 dark:text-white'}` }, value),
  sub ? h('div', { className: 'mt-1 text-[10px] text-slate-400' }, sub) : null
);

const Section = ({ icon: Icon, title, subtitle, children }) => h('section', { className: 'rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 p-3 sm:p-5 space-y-4' },
  h('div', { className: 'flex items-start gap-3' },
    h('div', { className: 'p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800' }, h(Icon, { className: 'w-5 h-5 text-violet-600' })),
    h('div', null,
      h('h3', { className: 'font-black text-base text-slate-900 dark:text-white' }, title),
      subtitle ? h('p', { className: 'text-[11px] text-slate-500 mt-0.5' }, subtitle) : null
    )
  ),
  children
);

export const ReportsView = () => {
  const app = useApp();
  const [reportReady,setReportReady]=useState(!app.ensureFullHistoryStores);
  const [reportError,setReportError]=useState('');
  useEffect(()=>{let alive=true;if(app.ensureFullHistoryStores)app.ensureFullHistoryStores(['invoices','purchases','expenses','vouchers']).then(()=>{if(alive)setReportReady(true)}).catch(e=>{if(alive)setReportError(e.message||'تعذر تحميل التقارير')});return()=>{alive=false}},[app.ensureFullHistoryStores]);
  const invoices = Array.isArray(app.invoices) ? app.invoices : [];
  const purchases = Array.isArray(app.purchases) ? app.purchases : [];
  const expenses = Array.isArray(app.expenses) ? app.expenses : [];
  const products = Array.isArray(app.products) ? app.products : [];
  const stock = Array.isArray(app.stock) ? app.stock : [];
  const customers = Array.isArray(app.customers) ? app.customers : [];
  const suppliers = Array.isArray(app.suppliers) ? app.suppliers : [];
  const warehouses = Array.isArray(app.warehouses) ? app.warehouses : [];
  const settings = app.settings || {};
  const currency = settings.currencySymbol || '';
  const financialYears = Array.isArray(settings.financialYears) ? settings.financialYears : [];
  const activeFinancialYearId = settings.activeFinancialYearId || financialYears.find(y=>y?.status==='open')?.id || 'fy-initial';
  const legacyFinancialYearId = financialYears[0]?.id || activeFinancialYearId;
  const inActiveYear = row => String(row?.financialYearId || legacyFinancialYearId) === String(activeFinancialYearId);

  const [period, setPeriod] = useState('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [wasteRecords, setWasteRecords] = useState([]);

  useEffect(() => {
    let alive = true;
    getAllFromStore('waste_records').then((rows) => {
      if (alive) setWasteRecords(Array.isArray(rows) ? rows : []);
    }).catch(() => { if (alive) setWasteRecords([]); });
    return () => { alive = false; };
  }, []);

  const periodBounds = useMemo(() => {
    const now = new Date();
    if (period === 'today') return [startOfDay(now), endOfDay(now)];
    if (period === 'week') return [startOfDay(new Date(now.getTime() - 6 * 86400000)), endOfDay(now)];
    if (period === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0), endOfDay(now)];
    if (period === 'year') return [new Date(now.getFullYear(),0,1),endOfDay(now)];
    if (period === 'custom') {
      const from = fromDate ? startOfDay(new Date(`${fromDate}T00:00:00`)) : null;
      const to = toDate ? endOfDay(new Date(`${toDate}T00:00:00`)) : null;
      return [from, to];
    }
    return [null, null];
  }, [period, fromDate, toDate]);

  const inPeriod = (dateValue) => {
    if (!dateValue) return false;
    const t = new Date(dateValue).getTime();
    if (!Number.isFinite(t)) return false;
    const [from, to] = periodBounds;
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  };

  const sales = invoices.filter((x) => !x?.deletedAt && inActiveYear(x) && x?.type === 'sale' && inPeriod(x.date));
  const returns = invoices.filter((x) => !x?.deletedAt && inActiveYear(x) && x?.type === 'return' && inPeriod(x.date));
  const periodPurchases = purchases.filter((x) => inActiveYear(x) && inPeriod(x.date));
  const periodExpenses = expenses.filter((x) => inActiveYear(x) && !x?.deletedAt && inPeriod(x.date || x.createdAt));

  const paidSales = sales.filter((x) => num(x.remainingAmount) <= EPS);
  const debtSales = sales.filter((x) => num(x.remainingAmount) > EPS);
  const paidPurchases = periodPurchases.filter((x) => num(x.remainingAmount) <= EPS);
  const debtPurchases = periodPurchases.filter((x) => num(x.remainingAmount) > EPS);
  const salesTotal = sales.reduce((s, x) => s + num(x.grandTotal), 0);
  const salesPaid = sales.reduce((s, x) => s + num(x.paidAmount), 0);
  const salesDebt = sales.reduce((s, x) => s + num(x.remainingAmount), 0);
  const returnsTotal = returns.reduce((s, x) => s + num(x.grandTotal), 0);
  const purchasesTotal = periodPurchases.reduce((s, x) => s + num(x.grandTotal), 0);
  const purchasesPaid = periodPurchases.reduce((s, x) => s + num(x.paidAmount), 0);
  const purchasesDebt = periodPurchases.reduce((s, x) => s + num(x.remainingAmount), 0);

  const receiptTotal=(app.vouchers||[]).filter(x=>!x.deletedAt&&x.type==='receipt'&&inActiveYear(x)&&inPeriod(x.date)).reduce((t,x)=>t+num(x.amount),0);
  const incomeTotal=salesPaid+receiptTotal-returns.reduce((t,x)=>t+num(x.paidAmount),0);
  const revenueTotal=salesTotal-returnsTotal;
  // Profit engine: FIFO cost saved on invoice lines is preferred, then cost at sale,
  // then the current product cost as a legacy fallback.
  const productById = new Map(products.map((p) => [String(p?.id || ''), p]));
  const lineCost = (item) => {
    if (item?.fifoCostTotal !== undefined && item?.fifoCostTotal !== null && Number.isFinite(Number(item.fifoCostTotal))) return num(item.fifoCostTotal);
    if (item?.costPriceAtSale !== undefined && item?.costPriceAtSale !== null && Number.isFinite(Number(item.costPriceAtSale))) return num(item.quantity) * num(item.costPriceAtSale);
    const p = productById.get(String(item?.productId || ''));
    const baseQty = num(item?.baseQuantity ?? (num(item?.quantity) * Math.max(1, num(item?.conversionFactor) || 1)));
    return baseQty * num(p?.costPrice);
  };
  const soldCost = sales.reduce((sum, inv) => sum + (Array.isArray(inv?.items) ? inv.items : []).reduce((s, it) => s + lineCost(it), 0), 0);
  const returnedCost = returns.reduce((sum, inv) => sum + (Array.isArray(inv?.items) ? inv.items : []).reduce((s, it) => s + lineCost(it), 0), 0);
  const cogs = soldCost - returnedCost;
  const netSales = salesTotal - returnsTotal;
  const salesProfit = netSales - cogs;

  const isWasteExpense = (e) => !!e?.inventoryLoss || /(?:هالك|تالف|تالفة|منتهي|منتهية)/i.test(`${e?.category || ''} ${e?.notes || ''}`);
  const wasteExpenses = periodExpenses.filter(isWasteExpense);
  const operatingExpenses = periodExpenses.filter((e) => !isWasteExpense(e));
  const wasteExpenseTotal = wasteExpenses.reduce((s, e) => s + num(e.amount), 0);
  const restaurantWaste = wasteRecords.filter((w) => !w?.deletedAt && inPeriod(w?.date || w?.createdAt));
  const restaurantWasteTotal = restaurantWaste.reduce((s, w) => s + num(w?.cost ?? w?.estimatedCost), 0);
  const wasteTotal = wasteExpenseTotal + restaurantWasteTotal;
  const operatingExpenseTotal = operatingExpenses.reduce((s, e) => s + num(e.amount), 0);
  const netProfit = salesProfit - operatingExpenseTotal - wasteTotal;

  const activeProducts = products.filter((p) => !p?.deletedAt && p?.status !== 'archived');
  const activeWarehouseId = settings.activeWarehouseId || warehouses.find((w) => w?.isDefault)?.id || warehouses[0]?.id || '';
  const inventoryByWarehouse = warehouses.map((wh) => {
    let skuCount = 0;
    let quantity = 0;
    let costValue = 0;
    for (const p of activeProducts) {
      const qty = stock.filter((r) => r?.productId === p.id && String(r?.warehouseId) === String(wh.id)).reduce((s, r) => s + num(r.baseQuantity), 0);
      if (Math.abs(qty) > EPS) skuCount += 1;
      quantity += qty;
      costValue += qty * num(p.costPrice);
    }
    return { id: wh.id, name: wh.name || 'مخزن', skuCount, quantity, costValue };
  });
  const activeWarehouseReport = inventoryByWarehouse.find((w) => String(w.id) === String(activeWarehouseId)) || { skuCount:0, quantity:0, costValue:0, name:'المخزن' };
  const allInventoryCost = inventoryByWarehouse.reduce((s, w) => s + num(w.costValue), 0);

  const activeCustomers = customers.filter((x) => !x?.deletedAt && !x?.isVirtual && x?.id !== 'cust-walkin');
  const customersOnThem = activeCustomers.reduce((s, x) => s + Math.max(0, num(x.balance)), 0);
  const customersForThem = activeCustomers.reduce((s, x) => s + Math.max(0, -num(x.balance)), 0);
  const indebtedCustomers = activeCustomers.filter((x) => num(x.balance) > EPS).length;
  const creditCustomers = activeCustomers.filter((x) => num(x.balance) < -EPS).length;
  const settledCustomers = activeCustomers.filter((x) => Math.abs(num(x.balance)) <= EPS).length;

  const activeSuppliers = suppliers.filter((x) => !x?.deletedAt);
  const suppliersForThem = activeSuppliers.reduce((s, x) => s + Math.max(0, num(x.balance)), 0);
  const suppliersOnThem = activeSuppliers.reduce((s, x) => s + Math.max(0, -num(x.balance)), 0);
  const suppliersWeOwe = activeSuppliers.filter((x) => num(x.balance) > EPS).length;
  const suppliersOweUs = activeSuppliers.filter((x) => num(x.balance) < -EPS).length;
  const settledSuppliers = activeSuppliers.filter((x) => Math.abs(num(x.balance)) <= EPS).length;

  const expenseTotal = periodExpenses.reduce((s, e) => s + num(e.amount), 0);
  const expenseGroups = Object.values(periodExpenses.reduce((acc, e) => {
    const key = String(e.category || 'غير مصنف').trim() || 'غير مصنف';
    if (!acc[key]) acc[key] = { category:key, count:0, amount:0 };
    acc[key].count += 1;
    acc[key].amount += num(e.amount);
    return acc;
  }, {})).sort((a,b) => b.amount - a.amount);

  const periodLabel = period === 'today' ? 'اليوم' : period === 'week' ? 'آخر 7 أيام' : period === 'month' ? 'هذا الشهر' : period === 'year' ? 'هذا العام' : period === 'all' ? 'كل الفترات' : `${fromDate || 'البداية'} إلى ${toDate || 'اليوم'}`;

  const summaryData = () => {
    const headers = ['القسم', 'المؤشر', 'القيمة'];
    const rows = [
      ['الدخل','إجمالي الدخل المقبوض',incomeTotal],
      ['الإيرادات','صافي إيرادات المبيعات شامل الضريبة',revenueTotal],
      ['القبض','سندات القبض',receiptTotal],
      ['الفواتير','عدد فواتير المبيعات',sales.length],
      ['الفواتير','فواتير مبيعات مسددة',paidSales.length],
      ['الفواتير','فواتير مبيعات آجلة/جزئية',debtSales.length],
      ['الفواتير','إجمالي المبيعات',money(salesTotal)],
      ['الفواتير','تكلفة البضاعة المباعة',money(cogs)],
      ['الفواتير','أرباح المبيعات',money(salesProfit)],
      ['الفواتير','المصروفات التشغيلية',money(operatingExpenseTotal)],
      ['الفواتير','الهالك والتالف',money(wasteTotal)],
      ['الفواتير','صافي الأرباح',money(netProfit)],
      ['الفواتير','إجمالي ديون الفواتير',money(salesDebt)],
      ['المشتريات','عدد فواتير المشتريات',periodPurchases.length],
      ['المشتريات','إجمالي المشتريات',money(purchasesTotal)],
      ['المخازن','عدد الأصناف النشطة',activeProducts.length],
      ['المخازن','تكلفة المخزون الكلية بسعر الشراء',money(allInventoryCost)],
      ['العملاء','إجمالي العملاء',activeCustomers.length],
      ['العملاء','علينا للعملاء',money(customersForThem)],
      ['العملاء','على العملاء لنا',money(customersOnThem)],
      ['الموردين','للموردين علينا',money(suppliersForThem)],
      ['الموردين','على الموردين لنا',money(suppliersOnThem)],
      ['المصروفات','عدد المصروفات',periodExpenses.length],
      ['المصروفات','إجمالي المصروفات',money(expenseTotal)],
    ];
    return {headers,rows};
  };

  const exportSummary=()=>{const {headers,rows}=summaryData();exportToCSV('تقرير_'+periodLabel,headers,rows)};
  const periodButtons = [
    ['today','اليوم'], ['week','أسبوع'], ['month','شهر'], ['year','سنة'], ['custom','من / إلى'], ['all','الكل']
  ];
  const exportReport=async(kind)=>{try{const fn=kind==='pdf'?downloadProfessionalTablePDF:downloadProfessionalTableImage;const ok=await fn({...summaryData(),title:t("التقارير الشاملة"),subtitle:periodLabel,settings,filename:'تقرير_'+periodLabel+'.'+(kind==='pdf'?'pdf':'png'),orientation:'portrait'});if(ok===false)throw Error('تعذر إنشاء الملف');app.showToast?.('تم تنزيل التقرير','success')}catch(e){app.showToast?.(e.message,'error')}};
  const exportProfessionalPdf=()=>exportReport('pdf');
  const exportProfessionalImage=()=>exportReport('image');

  if(!reportReady)return h('div',{className:'p-6 text-center',role:'status'},reportError||'جاري تجهيز التقارير الكاملة…');
  return h('div', { id:'reports-screen', className:'p-3 sm:p-6 space-y-5 max-w-7xl mx-auto text-right select-none' },
    h('div', { className:'flex flex-col xl:flex-row xl:items-end justify-between gap-4' },
      h('div', null,
        h('h2', { className:'text-xl font-black text-slate-900 dark:text-white' }, t("التقارير الشاملة")),
        h('p', { className:'text-xs text-slate-500 mt-1' }, `تقارير الفواتير والمخازن والعملاء والموردين والمصروفات — الفترة: ${periodLabel}`)
      ),
      h('div', { className:'flex flex-wrap items-end gap-2' },
        h('div', { className:'flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800' }, ...periodButtons.map(([id,label]) => h('button', {
          key:id, type:'button', onClick:()=>setPeriod(id), className:`px-3 py-2 rounded-lg text-[11px] font-black ${period===id?'bg-white dark:bg-slate-900 text-violet-600 shadow-sm':'text-slate-500'}`
        }, t(label)))),
        h('label', { className:'text-[10px] font-bold text-slate-500' }, t("من تاريخ"), h('input', { type:'date', value:fromDate, onChange:(e)=>{setFromDate(e.target.value);setPeriod('custom');}, className:'block mt-1 px-2 py-1.5 rounded-lg border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs' })),
        h('label', { className:'text-[10px] font-bold text-slate-500' }, t("إلى تاريخ"), h('input', { type:'date', value:toDate, onChange:(e)=>{setToDate(e.target.value);setPeriod('custom');}, className:'block mt-1 px-2 py-1.5 rounded-lg border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs' })),
        h('button', { type:'button', onClick:exportSummary, className:'inline-flex items-center gap-2 px-3 py-2 rounded-xl border bg-white dark:bg-slate-900 dark:border-slate-700 text-xs font-bold' }, h(Download,{className:'w-4 h-4 text-violet-600'}),'Excel'),
        h('button', { type:'button', onClick:exportProfessionalPdf, className:'inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-black shadow-sm' }, h(FileText,{className:'w-4 h-4'}),'PDF احترافي'),
        h('button', { type:'button', onClick:exportProfessionalImage, className:'inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-black shadow-sm' }, h(ImageIcon,{className:'w-4 h-4'}),'صورة التقرير')
      )
    ),

    h('section',{className:'ct-income-overview'},h(Metric,{label:'إجمالي الدخل المقبوض',value:money(incomeTotal)+' '+currency,sub:'دفعات البيع + سندات القبض − المبالغ المستردة',tone:'emerald',icon:WalletCards}),h(Metric,{label:'إجمالي الإيرادات',value:money(revenueTotal)+' '+currency,sub:'المبيعات − المرتجعات، شامل الضريبة؛ دون تكرار سداد الديون',tone:'blue',icon:TrendingUp})),
    h(Section, { icon:ReceiptText, title:'قسم تقارير الفواتير', subtitle:'عدد الفواتير، المسدد، الآجل/الجزئي، والمبالغ خلال الفترة المحددة' },
      h('div', { className:'grid grid-cols-2 lg:grid-cols-4 gap-3' },
        h(Metric,{label:'عدد فواتير المبيعات',value:String(sales.length),sub:`${paidSales.length} مسددة • ${debtSales.length} آجلة/جزئية`,tone:'blue'}),
        h(Metric,{label:'إجمالي فواتير المبيعات',value:`${money(salesTotal)} ${currency}`,sub:`مدفوع ${money(salesPaid)} • متبقي ${money(salesDebt)}`,tone:'emerald'}),
        h(Metric,{label:'عدد المرتجعات',value:String(returns.length),sub:`قيمة المرتجع ${money(returnsTotal)} ${currency}`,tone:'rose'}),
        h(Metric,{label:'صافي المبيعات بعد المرتجعات',value:`${money(salesTotal-returnsTotal)} ${currency}`,sub:'إجمالي البيع مطروحاً منه المرتجعات',tone:'emerald'})
      ),
      h('div', { className:'grid grid-cols-1 sm:grid-cols-2 gap-3' },
        h(Metric,{label:'أرباح المبيعات',value:`${money(salesProfit)} ${currency}`,sub:`صافي المبيعات ${money(netSales)} − تكلفة البضاعة ${money(cogs)}`,tone:salesProfit>=0?'emerald':'rose',icon:TrendingUp}),
        h(Metric,{label:'صافي الأرباح',value:`${money(netProfit)} ${currency}`,sub:`بعد خصم المصروفات ${money(operatingExpenseTotal)} + الهالك ${money(wasteTotal)}`,tone:netProfit>=0?'emerald':'rose',icon:CircleDollarSign})
      ),
      h('div', { className:'grid grid-cols-2 lg:grid-cols-4 gap-3' },
        h(Metric,{label:'عدد فواتير المشتريات',value:String(periodPurchases.length),sub:`${paidPurchases.length} مسددة • ${debtPurchases.length} آجلة/جزئية`}),
        h(Metric,{label:'إجمالي المشتريات',value:`${money(purchasesTotal)} ${currency}`}),
        h(Metric,{label:'المدفوع للمشتريات',value:`${money(purchasesPaid)} ${currency}`,tone:'blue'}),
        h(Metric,{label:'المتبقي للموردين من الفواتير',value:`${money(purchasesDebt)} ${currency}`,tone:'rose'})
      )
    ),

    h(Section, { icon:Package, title:'قسم تقارير المخازن', subtitle:'تكلفة المخزن = كمية الرصيد الحالية × سعر الشراء/التكلفة للصنف' },
      h('div', { className:'grid grid-cols-2 lg:grid-cols-4 gap-3' },
        h(Metric,{label:'عدد الأصناف المسجلة',value:String(activeProducts.length),sub:'الأصناف النشطة غير المحذوفة'}),
        h(Metric,{label:`أصناف بها رصيد — ${activeWarehouseReport.name}`,value:String(activeWarehouseReport.skuCount),tone:'blue'}),
        h(Metric,{label:'إجمالي عدد الوحدات الأساسية بالمخزن',value:money(activeWarehouseReport.quantity),sub:'مجموع أرصدة الأصناف بوحداتها الأساسية'}),
        h(Metric,{label:'تكلفة المخزن بسعر الشراء',value:`${money(activeWarehouseReport.costValue)} ${currency}`,sub:'الكمية × تكلفة الشراء',tone:'emerald'})
      ),
      h('div',{className:'overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'},
        h('table',{className:'w-full text-xs'},
          h('thead',{className:'bg-slate-50 dark:bg-slate-800/60 text-slate-500'},h('tr',null,h('th',{className:'p-3 text-right'},t("المخزن")),h('th',{className:'p-3 text-center'},'عدد الأصناف'),h('th',{className:'p-3 text-center'},'إجمالي الكمية'),h('th',{className:'p-3 text-left'},'تكلفة المخزون'))),
          h('tbody',null,...inventoryByWarehouse.map((w)=>h('tr',{key:w.id,className:'border-t border-slate-100 dark:border-slate-800'},h('td',{className:'p-3 font-bold'},w.name),h('td',{className:'p-3 text-center font-mono'},w.skuCount),h('td',{className:'p-3 text-center font-mono'},money(w.quantity)),h('td',{className:'p-3 text-left font-mono font-black text-violet-700'},`${money(w.costValue)} ${currency}`))) )
        )
      )
    ),

    h(Section, { icon:Users, title:'قسم تقارير العملاء', subtitle:'لنا = العميل مدين لنا، علينا = للعميل رصيد دائن عندنا' },
      h('div',{className:'grid grid-cols-2 lg:grid-cols-5 gap-3'},
        h(Metric,{label:'إجمالي العملاء',value:String(activeCustomers.length)}),
        h(Metric,{label:'إجمالي الديون لنا على العملاء',value:`${money(customersOnThem)} ${currency}`,tone:'rose'}),
        h(Metric,{label:'إجمالي لهم علينا',value:`${money(customersForThem)} ${currency}`,tone:'blue'}),
        h(Metric,{label:'العملاء المديونية',value:String(indebtedCustomers),sub:`${creditCustomers} لديهم رصيد دائن`}),
        h(Metric,{label:'العملاء المسددون',value:String(settledCustomers),tone:'emerald'})
      )
    ),

    h(Section, { icon:Truck, title:'قسم تقارير الموردين', subtitle:'لهم = المبلغ المستحق للمورد، عليهم = رصيد لنا عند المورد' },
      h('div',{className:'grid grid-cols-2 lg:grid-cols-5 gap-3'},
        h(Metric,{label:'إجمالي الموردين',value:String(activeSuppliers.length)}),
        h(Metric,{label:'إجمالي لهم علينا',value:`${money(suppliersForThem)} ${currency}`,tone:'rose'}),
        h(Metric,{label:'إجمالي عليهم لنا',value:`${money(suppliersOnThem)} ${currency}`,tone:'blue'}),
        h(Metric,{label:'موردون لهم مستحقات',value:String(suppliersWeOwe)}),
        h(Metric,{label:'موردون مسددون',value:String(settledSuppliers),sub:`${suppliersOweUs} عليهم رصيد لنا`,tone:'emerald'})
      )
    ),

    h(Section, { icon:WalletCards, title:'قسم تقارير المصروفات', subtitle:'إحصائيات المصروفات خلال الفترة المختارة' },
      h('div',{className:'grid grid-cols-2 lg:grid-cols-4 gap-3'},
        h(Metric,{label:'عدد المصروفات',value:String(periodExpenses.length)}),
        h(Metric,{label:'إجمالي المصروفات',value:`${money(expenseTotal)} ${currency}`,tone:'rose'}),
        h(Metric,{label:'عدد أنواع المصروف',value:String(expenseGroups.length)}),
        h(Metric,{label:'متوسط المصروف',value:`${money(periodExpenses.length ? expenseTotal/periodExpenses.length : 0)} ${currency}`})
      ),

    )
  );
};
