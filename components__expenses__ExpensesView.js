import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, usePagination, useDatabasePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { downloadProfessionalTablePDF, downloadProfessionalTableExcel } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { Plus, Search, Trash2, Edit2, FileSpreadsheet, FileText, Settings2, UsersRound, Receipt, WalletCards, X } from 'lucide-react';

const h = React.createElement;
const DEFAULT_EXPENSE_CATEGORIES = [
  'نثريات وضيافة',
  'كهرباء ومياه',
  'إيجار المحل',
  'أجور ورواتب عمال',
  'صيانة ونظافة',
  'بضائع تالفة ومنتهية',
  'أكياس وتغليف وطباعة',
  'نقل وشحن',
  'أخرى',
];
const dayKey = value => {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const todayKey = () => dayKey(new Date());
const monthStartKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-01`;
};
const safePart = v => String(v || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').trim() || 'الكل';
const money = v => (Number(v) || 0).toFixed(2);
const uniq = arr => [...new Set((arr || []).map(v => String(v || '').trim()).filter(Boolean))];
const isLaborCategory = name => /(?:عمال|عامل|رواتب|أجور|اجور|أجر|اجر)/i.test(String(name || ''));
const partyClass = v => v === 'customer' ? 'customer' : v === 'supplier' ? 'supplier' : 'other';
const paymentClassLabel = v => v === 'sales' ? 'دفعات المبيعات' : v === 'customer' ? 'سندات قبض العملاء' : v === 'supplier' ? 'سندات قبض الموردين' : 'دفعات أخرى';
const paymentMethodLabel = v => ({cash:'نقدي',card:'بطاقة',bank:'تحويل بنكي',wallet:'محفظة',transfer:'تحويل',credit:'آجل'}[String(v||'').toLowerCase()] || String(v||'غير محدد'));

export const ExpensesView = () => {
  const {
    expenses, vouchers, invoices, accounts, settings, recordExpense, updateExpense,
    softDeleteExpense, updateSettings, showToast, setActiveTab, queryAllStoreRecords, queryStoreStats
  } = useApp();

  const years = Array.isArray(settings.financialYears) ? settings.financialYears : [];
  const activeFY = settings.activeFinancialYearId || years.find(y=>y?.status==='open')?.id || 'fy-initial';
  const legacyFY = years[0]?.id || activeFY;
  const configuredCategories = useMemo(() => {
    const configured = Array.isArray(settings.expenseCategories) && settings.expenseCategories.length
      ? settings.expenseCategories : DEFAULT_EXPENSE_CATEGORIES;
    return uniq(configured);
  }, [settings.expenseCategories]);
  const historicalCategories = useMemo(() => uniq((expenses || []).filter(e => !e.deletedAt).map(e => e.category)), [expenses]);
  const filterCategories = useMemo(() => uniq([...configuredCategories, ...historicalCategories]), [configuredCategories, historicalCategories]);

  const [mode, setMode] = useState('expenses');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedReceiptClass, setSelectedReceiptClass] = useState('all');
  const [dateFrom, setDateFrom] = useState(monthStartKey());
  const [dateTo, setDateTo] = useState(todayKey());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(configuredCategories[0] || 'أخرى');
  const [accountId, setAccountId] = useState(accounts.find(a => a.isDefault)?.id || accounts[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [showTypeManager, setShowTypeManager] = useState(false);
  const [newType, setNewType] = useState('');

  useEffect(() => {
    if (!configuredCategories.includes(category)) setCategory(configuredCategories[0] || 'أخرى');
  }, [configuredCategories, category]);
  useEffect(() => {
    if (!accountId && accounts[0]?.id) setAccountId(accounts.find(a => a.isDefault)?.id || accounts[0].id);
  }, [accounts, accountId]);
  useEffect(() => {
    const onAIDraft = event => {
      const data = event?.detail || {};
      const nextAmount = Number(data.amount || 0);
      if (nextAmount > 0) setAmount(String(nextAmount));
      if (data.category) {
        const incoming = String(data.category).trim();
        setCategory(configuredCategories.includes(incoming) ? incoming : (configuredCategories.includes('أخرى') ? 'أخرى' : configuredCategories[0]));
      }
      if (data.notes) setNotes(String(data.notes));
      setEditingExpense(null);
      setShowAddModal(true);
    };
    window.addEventListener('oscar:ai-expense-draft', onAIDraft);
    return () => window.removeEventListener('oscar:ai-expense-draft', onAIDraft);
  }, [configuredCategories]);

  const inPeriod = value => {
    const key = dayKey(value);
    if (!key) return false;
    if (dateFrom && key < dateFrom) return false;
    if (dateTo && key > dateTo) return false;
    return true;
  };
  const q = search.trim().toLowerCase();
  const toStartIso = value => value ? new Date(`${value}T00:00:00`).toISOString() : null;
  const toEndIso = value => value ? new Date(`${value}T23:59:59.999`).toISOString() : null;
  const laborCategories = filterCategories.filter(isLaborCategory);
  const expenseFilters = {
    financialYearId: activeFY,
    category: selectedCategory !== 'all' ? selectedCategory : (mode === 'labor' ? laborCategories : 'all'),
  };
  const expenseQueryOptions = {
    search,
    filters: expenseFilters,
    legacyFinancialYearId: legacyFY,
    dateFrom: toStartIso(dateFrom),
    dateTo: toEndIso(dateTo),
    sortField: 'date',
    sortDirection: 'desc',
    deletedMode: 'exclude',
    pageSize: 50,
  };
  const expensePager = useDatabasePagination('expenses', expenseQueryOptions, `${mode}|${search}|${selectedCategory}|${dateFrom}|${dateTo}|${activeFY}`);
  const filteredExpenses = expensePager.pageItems;
  const [expenseSummary,setExpenseSummary] = useState({count:0,total:0});
  useEffect(()=>{
    if(mode==='receipts'||typeof queryStoreStats!=='function')return undefined;
    let cancelled=false;
    queryStoreStats('expenses',{...expenseQueryOptions,sumFields:['amount']}).then(r=>{
      if(cancelled)return;
      const a=r?.ranges?.all||{};
      setExpenseSummary({count:Number(a.count||0),total:Number(a.sums?.amount||0)});
    }).catch(err=>console.warn('Expense aggregate failed',err));
    return()=>{cancelled=true;};
  },[mode,search,selectedCategory,dateFrom,dateTo,activeFY,legacyFY,filterCategories.join('|')]);

  const [receiptInvoices,setReceiptInvoices] = useState([]);
  const [receiptVouchers,setReceiptVouchers] = useState([]);
  useEffect(()=>{
    if(mode!=='receipts'||typeof queryAllStoreRecords!=='function')return undefined;
    let cancelled=false;
    const common={legacyFinancialYearId:legacyFY,dateFrom:toStartIso(dateFrom),dateTo:toEndIso(dateTo),deletedMode:'exclude',sortField:'date',sortDirection:'desc',pageSize:200};
    Promise.all([
      queryAllStoreRecords('invoices',{...common,filters:{financialYearId:activeFY,type:'sale'}}),
      queryAllStoreRecords('vouchers',{...common,filters:{financialYearId:activeFY,type:'receipt'}}),
    ]).then(([is,vs])=>{if(!cancelled){setReceiptInvoices(is||[]);setReceiptVouchers(vs||[]);}}).catch(err=>console.warn('Receipt report load failed',err));
    return()=>{cancelled=true;};
  },[mode,dateFrom,dateTo,activeFY,legacyFY]);

  const incomingPayments = useMemo(() => {
    const rows = [];
    for (const inv of receiptInvoices) {
      const breakdown = Array.isArray(inv.payments) ? inv.payments.filter(p => Number(p?.amount) > 0) : [];
      if (breakdown.length) {
        breakdown.forEach((p, idx) => {
          const account = accounts.find(a => a.id === p.accountId);
          rows.push({
            id:`sale-${inv.id}-${idx}`, date:inv.date, classId:'sales', reference:inv.invoiceNumber || inv.id,
            partyName:inv.customerName || 'زبون نقدي', amount:Number(p.amount)||0, accountName:account?.name || p.accountName || 'حساب مالي',
            method:paymentMethodLabel(p.method), notes:inv.notes || '', source:'فاتورة مبيعات'
          });
        });
      } else if (Number(inv.paidAmount) > 0) {
        rows.push({
          id:`sale-${inv.id}`, date:inv.date, classId:'sales', reference:inv.invoiceNumber || inv.id,
          partyName:inv.customerName || 'زبون نقدي', amount:Number(inv.paidAmount)||0, accountName:'حساب البيع',
          method:inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'partial' ? 'دفع جزئي' : paymentMethodLabel(inv.paymentType), notes:inv.notes || '', source:'فاتورة مبيعات'
        });
      }
    }
    for (const v of receiptVouchers) {
      rows.push({
        id:`voucher-${v.id}`, date:v.date, classId:partyClass(v.partyType), reference:v.voucherNumber || v.id,
        partyName:v.partyName || '-', amount:Number(v.amount)||0, accountName:v.accountName || 'حساب مالي',
        method:'سند قبض', notes:v.notes || '', source:'سند قبض'
      });
    }
    return rows.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime());
  }, [receiptInvoices, receiptVouchers, accounts]);
  const filteredReceipts = incomingPayments.filter(v => {
    if (selectedReceiptClass !== 'all' && v.classId !== selectedReceiptClass) return false;
    if (!q) return true;
    return String(v.partyName || '').toLowerCase().includes(q) || String(v.notes || '').toLowerCase().includes(q) || String(v.reference || '').toLowerCase().includes(q) || String(v.accountName || '').toLowerCase().includes(q) || String(v.method || '').toLowerCase().includes(q);
  });

  const receiptPager = usePagination(filteredReceipts, 50, `${mode}|${search}|${selectedReceiptClass}|${dateFrom}|${dateTo}`);

  const total = mode === 'receipts'
    ? filteredReceipts.reduce((s, v) => s + (Number(v.amount) || 0), 0)
    : expenseSummary.total;
  const count = mode === 'receipts' ? filteredReceipts.length : expenseSummary.count;
  const receiptSummary = useMemo(() => {
    const base = { sales:0, customer:0, supplier:0, other:0 };
    incomingPayments.forEach(v => { base[v.classId] = (base[v.classId] || 0) + (Number(v.amount) || 0); });
    return base;
  }, [incomingPayments]);

  const periodLabel = dateFrom || dateTo
    ? `الفترة: ${dateFrom || 'البداية'} إلى ${dateTo || 'اليوم'}`
    : 'كافة الفترات';
  const reportMeta = (expenseRowsSource = filteredExpenses) => {
    if (mode === 'receipts') {
      const cls = selectedReceiptClass === 'all' ? 'كل الدفعات المدخلة' : paymentClassLabel(selectedReceiptClass);
      return {
        title: `كشف الدفعات المدخلة - ${cls}`,
        filename: `كشف_الدفعات_المدخلة_${safePart(cls)}_${safePart(dateFrom || 'الكل')}_${safePart(dateTo || 'الكل')}`,
        headers: ['المرجع','التاريخ','التصنيف','الجهة','المبلغ','طريقة الدفع','الحساب المودع فيه','البيان'],
        rows: filteredReceipts.map(v => [v.reference || '-', new Date(v.date).toLocaleString('ar-EG'), paymentClassLabel(v.classId), v.partyName || '-', Number(v.amount)||0, v.method || '-', v.accountName || 'حساب مالي', v.notes || '']),
      };
    }
    const selectedText = selectedCategory === 'all' ? (mode === 'labor' ? 'كل بنود العمال والأجور' : 'كل أنواع المصروفات') : selectedCategory;
    return {
      title: mode === 'labor' ? `كشف العمال والأجور - ${selectedText}` : `كشف المصروفات - ${selectedText}`,
      filename: `${mode === 'labor' ? 'كشف_العمال' : 'كشف_المصروفات'}_${safePart(selectedText)}_${safePart(dateFrom || 'الكل')}_${safePart(dateTo || 'الكل')}`,
      headers: ['التاريخ','نوع المصروف','المبلغ','الحساب المسدد منه','البيان'],
      rows: expenseRowsSource.map(e => [new Date(e.date).toLocaleString('ar-EG'), e.category || '-', Number(e.amount)||0, e.accountName || '-', e.notes || '']),
    };
  };
  const exportPDF = async () => {
    if (!count) return showToast('لا توجد بيانات ضمن الفلترة الحالية', 'warning');
    const fullRows = mode === 'receipts' ? null : await queryAllStoreRecords?.('expenses',{...expenseQueryOptions,pageSize:200});
    const r = reportMeta(fullRows || filteredExpenses);
    const ok = await downloadProfessionalTablePDF({
      title:r.title,
      subtitle:`${periodLabel} • عدد الحركات: ${count} • الإجمالي: ${money(total)} ${settings.currencySymbol}`,
      headers:r.headers, rows:r.rows, settings, orientation:'landscape', filename:`${r.filename}.pdf`
    });
    showToast(ok ? 'تم تنزيل كشف PDF حسب الفلترة الحالية' : 'تعذر إنشاء ملف PDF', ok ? 'success' : 'error');
  };
  const exportExcel = async () => {
    if (!count) return showToast('لا توجد بيانات ضمن الفلترة الحالية', 'warning');
    const fullRows = mode === 'receipts' ? null : await queryAllStoreRecords?.('expenses',{...expenseQueryOptions,pageSize:200});
    const r = reportMeta(fullRows || filteredExpenses);
    const ok = await downloadProfessionalTableExcel({
      title:r.title,
      subtitle:`${periodLabel} • عدد الحركات: ${count} • الإجمالي: ${money(total)} ${settings.currencySymbol}`,
      headers:r.headers, rows:r.rows, settings, filename:`${r.filename}.xls`,
      extraTopRows:[[mode === 'receipts' ? 'التصنيف' : 'نوع المصروف', mode === 'receipts' ? (selectedReceiptClass === 'all' ? 'الكل' : paymentClassLabel(selectedReceiptClass)) : (selectedCategory === 'all' ? 'الكل' : selectedCategory), 'من', dateFrom || '-', 'إلى', dateTo || '-']]
    });
    showToast(ok ? 'تم تنزيل كشف Excel حسب الفلترة الحالية' : 'تعذر إنشاء ملف Excel', ok ? 'success' : 'error');
  };

  const setQuickRange = kind => {
    if (kind === 'all') { setDateFrom(''); setDateTo(''); return; }
    if (kind === 'today') { const t=todayKey(); setDateFrom(t); setDateTo(t); return; }
    if (kind === 'month') { setDateFrom(monthStartKey()); setDateTo(todayKey()); }
  };
  const openNewExpense = () => {
    setEditingExpense(null);
    setAmount('');
    setNotes('');
    if (mode === 'labor') {
      const labor = configuredCategories.find(isLaborCategory) || configuredCategories[0] || 'أخرى';
      setCategory(labor);
    } else setCategory(configuredCategories[0] || 'أخرى');
    setAccountId(accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '');
    setShowAddModal(true);
  };
  useEffect(()=>{
    const eventName='cash-top:quick-add-expense';
    const open=()=>{
      if(window.__cashTopPendingQuickAction===eventName) window.__cashTopPendingQuickAction='';
      openNewExpense();
    };
    window.addEventListener(eventName,open);
    if(window.__cashTopPendingQuickAction===eventName) requestAnimationFrame(open);
    return()=>window.removeEventListener(eventName,open);
  },[mode,configuredCategories.join('|'),accounts.map(a=>a.id).join('|')]);
  const editExpense = exp => {
    setEditingExpense(exp);
    setAmount(String(exp.amount || ''));
    setCategory(exp.category || configuredCategories[0] || 'أخرى');
    setAccountId(exp.accountId || accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '');
    setNotes(exp.notes || '');
    setShowAddModal(true);
  };
  const saveExpense = async e => {
    e.preventDefault();
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return showToast('يرجى إدخال مبلغ مصروف صحيح', 'warning');
    const account = accounts.find(a => a.id === accountId);
    if (!account) return showToast('يرجى اختيار حساب مالي صالح', 'warning');
    if (editingExpense) await updateExpense({ ...editingExpense, amount:numericAmount, category, accountId, accountName:account.name, notes });
    else await recordExpense({ amount:numericAmount, category, accountId, notes });
    setShowAddModal(false); setEditingExpense(null); setAmount(''); setNotes('');
  };
  const addExpenseType = async e => {
    e.preventDefault();
    const name = newType.trim();
    if (!name) return;
    if (configuredCategories.some(x => x.toLowerCase() === name.toLowerCase())) return showToast('هذا النوع موجود بالفعل', 'warning');
    await updateSettings({ expenseCategories:[...configuredCategories, name] });
    setNewType('');
  };
  const removeExpenseType = async name => {
    const next = configuredCategories.filter(x => x !== name);
    if (!next.length) return showToast('يجب إبقاء نوع مصروف واحد على الأقل', 'warning');
    await updateSettings({ expenseCategories:next });
    if (category === name) setCategory(next[0]);
    if (selectedCategory === name) setSelectedCategory('all');
  };

  const modeButton = (id, label, Icon) => h('button', {
    type:'button', onClick:()=>{ setMode(id); setSearch(''); setSelectedCategory('all'); setSelectedReceiptClass('all'); },
    className:`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${mode===id?'bg-violet-600 text-white border-violet-600 shadow-sm':'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`
  }, h(Icon,{className:'w-4 h-4'}), label);

  const expenseRows = expensePager.pageItems.map(exp => h('tr',{key:exp.id,className:'border-b border-slate-100 hover:bg-slate-50/70'},
    h('td',{className:'p-3 text-slate-500'},new Date(exp.date).toLocaleString('ar-EG')),
    h('td',{className:'p-3 font-bold'},exp.category || '-'),
    h('td',{className:'p-3 font-mono font-black text-rose-600'},`${money(exp.amount)} ${settings.currencySymbol}`),
    h('td',{className:'p-3'},exp.accountName || '-'),
    h('td',{className:'p-3 max-w-[260px] truncate',title:exp.notes||''},exp.notes || '-'),
    h('td',{className:'p-3'},h('div',{className:'flex gap-1 justify-end'},
      h('button',{type:'button',onClick:()=>editExpense(exp),className:'p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50',title:t("تعديل")},h(Edit2,{className:'w-3.5 h-3.5'})),
      h('button',{type:'button',onClick:()=>softDeleteExpense(exp.id),className:'p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50',title:t("حذف")},h(Trash2,{className:'w-3.5 h-3.5'}))
    ))
  ));
  const receiptRows = receiptPager.pageItems.map(v => h('tr',{key:v.id,className:'border-b border-slate-100 hover:bg-slate-50/70'},
    h('td',{className:'p-3 font-mono font-bold'},v.reference || '-'),
    h('td',{className:'p-3 text-slate-500'},new Date(v.date).toLocaleString('ar-EG')),
    h('td',{className:'p-3'},h('span',{className:'px-2 py-1 rounded-lg bg-violet-50 text-violet-700 font-bold'},paymentClassLabel(v.classId))),
    h('td',{className:'p-3 font-bold'},v.partyName || '-'),
    h('td',{className:'p-3 font-mono font-black text-violet-700'},`${money(v.amount)} ${settings.currencySymbol}`),
    h('td',{className:'p-3'},v.method || '-'),
    h('td',{className:'p-3'},v.accountName || 'حساب مالي'),
    h('td',{className:'p-3 max-w-[260px] truncate',title:v.notes||''},v.notes || '-')
  ));

  return h('div',{id:'expenses-screen',className:'p-4 sm:p-6 space-y-4 max-w-7xl mx-auto text-right select-none'},
    h('div',{className:'flex flex-col lg:flex-row lg:items-center justify-between gap-3'},
      h('div',null,
        h('h2',{className:'text-xl font-black text-slate-900'},'المصروفات والكشوفات'),
        h('p',{className:'text-xs text-slate-500 mt-1'},'كشوفات مصنفة حسب النوع والفترة والفلترة، مع تنزيل PDF وExcel احترافي')
      ),
      h('div',{className:'flex flex-wrap items-center gap-2'},
        mode !== 'receipts' && h('button',{type:'button',onClick:openNewExpense,className:'flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold shadow-sm'},h(Plus,{className:'w-4 h-4'}),t("تسجيل مصروف")),
        mode === 'expenses' && h('button',{type:'button',onClick:()=>setShowTypeManager(true),className:'flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold'},h(Settings2,{className:'w-4 h-4'}),'أنواع المصروف'),
        h('button',{type:'button',onClick:exportPDF,className:'flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold'},h(FileText,{className:'w-4 h-4 text-rose-600'}),'PDF'),
        h('button',{type:'button',onClick:exportExcel,className:'flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold'},h(FileSpreadsheet,{className:'w-4 h-4 text-violet-600'}),'Excel')
      )
    ),

    h('div',{className:'grid grid-cols-3 gap-2'},
      modeButton('expenses','المصروفات',Receipt),
      modeButton('labor','كشف العمال / الأجور',UsersRound),
      modeButton('receipts','الدفعات المدخلة',WalletCards)
    ),

    h('div',{className:'rounded-2xl bg-white border border-slate-200 shadow-sm p-3 space-y-3'},
      h('div',{className:'expense-filter-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end'},
        h('div',{className:'relative lg:col-span-2'},
          h('label',{className:'block text-[10px] text-slate-500 font-bold mb-1'},'بحث داخل الكشف'),
          h(Search,{className:'absolute right-3 top-8 w-4 h-4 text-slate-400'}),
          h('input',{value:search,onChange:e=>setSearch(e.target.value),placeholder:mode==='receipts'?'ابحث بالجهة أو رقم السند أو البيان...':'ابحث بالنوع أو البيان أو الحساب...',className:'w-full pr-9 pl-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50'})
        ),
        mode === 'receipts'
          ? h('div',null,h('label',{className:'block text-[10px] text-slate-500 font-bold mb-1'},'تصنيف الدفعة'),h(SearchableDropdown,{id:'receipt-class-filter',options:[{id:'all',label:'كل الدفعات'},{id:'sales',label:'دفعات المبيعات'},{id:'customer',label:'سندات قبض العملاء'},{id:'supplier',label:'سندات قبض الموردين'},{id:'other',label:'دفعات أخرى'}],selectedId:selectedReceiptClass,onSelect:setSelectedReceiptClass,placeholder:t("التصنيف")}))
          : h('div',null,h('label',{className:'block text-[10px] text-slate-500 font-bold mb-1'},'نوع المصروف'),h(SearchableDropdown,{id:'expense-category-filter',options:[{id:'all',label:mode==='labor'?'كل بنود العمال والأجور':'كل أنواع المصروفات'},...filterCategories.filter(c=>mode!=='labor'||isLaborCategory(c)).map(c=>({id:c,label:c}))],selectedId:selectedCategory,onSelect:setSelectedCategory,placeholder:'نوع المصروف'})),
        h('div',null,h('label',{className:'block text-[10px] text-slate-500 font-bold mb-1'},t("من تاريخ")),h('input',{type:'date',value:dateFrom,onChange:e=>setDateFrom(e.target.value),className:'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white'})),
        h('div',null,h('label',{className:'block text-[10px] text-slate-500 font-bold mb-1'},t("إلى تاريخ")),h('input',{type:'date',value:dateTo,onChange:e=>setDateTo(e.target.value),className:'w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white'}))
      ),
      h('div',{className:'flex flex-wrap gap-2 justify-between items-center border-t border-slate-100 pt-3'},
        h('div',{className:'flex gap-1.5'},
          h('button',{type:'button',onClick:()=>setQuickRange('today'),className:'px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600'},t("اليوم")),
          h('button',{type:'button',onClick:()=>setQuickRange('month'),className:'px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600'},t("هذا الشهر")),
          h('button',{type:'button',onClick:()=>setQuickRange('all'),className:'px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600'},t("كل الفترات"))
        ),
        h('div',{className:'text-xs font-bold text-slate-600'},`${periodLabel} • ${count} حركة • الإجمالي: `,h('span',{className:mode==='receipts'?'text-violet-700 font-mono':'text-rose-600 font-mono'},`${money(total)} ${settings.currencySymbol}`))
      )
    ),

    mode === 'receipts' && h('div',{className:'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3'},
      [['sales','دفعات المبيعات'],['customer','سندات قبض العملاء'],['supplier','سندات قبض الموردين'],['other','دفعات أخرى']].map(([key,label])=>h('button',{key,onClick:()=>setSelectedReceiptClass(key),className:`text-right p-3 rounded-2xl border bg-white shadow-sm ${selectedReceiptClass===key?'border-violet-500 ring-1 ring-violet-100':'border-slate-200'}`},h('div',{className:'text-[11px] text-slate-500 font-bold'},label),h('div',{className:'mt-1 text-lg font-black font-mono text-violet-700'},`${money(receiptSummary[key])} ${settings.currencySymbol}`)))
    ),

    h('div',{className:'rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden'},
      h('div',{className:'overflow-x-auto slim-scrollbar'},
        count === 0 ? h('div',{className:'p-12 text-center text-xs text-slate-400'},'لا توجد حركات ضمن الفترة والفلترة المحددة') :
        mode === 'receipts'
          ? h('table',{className:'w-full text-xs text-right whitespace-nowrap min-w-[1050px]'},
              h('thead',null,h('tr',{className:'bg-slate-50 text-slate-500 border-b'},['المرجع','التاريخ','التصنيف','الجهة','المبلغ','طريقة الدفع','الحساب المودع فيه','البيان'].map(x=>h('th',{key:x,className:'p-3'},x)))),
              h('tbody',null,receiptRows)
            )
          : h('table',{className:'w-full text-xs text-right whitespace-nowrap min-w-[850px]'},
              h('thead',null,h('tr',{className:'bg-slate-50 text-slate-500 border-b'},['التاريخ','نوع المصروف','المبلغ','الحساب المسدد منه','البيان','إجراءات'].map(x=>h('th',{key:x,className:'p-3'},x)))),
              h('tbody',null,expenseRows)
            )
      ),
      h(Pagination,{pager:mode==='receipts'?receiptPager:expensePager})
    ),

    mode === 'receipts' && h('div',{className:'flex justify-end'},h('button',{type:'button',onClick:()=>setActiveTab?.('vouchers'),className:'text-xs font-bold text-violet-700 hover:underline'},'فتح سندات القبض والصرف ←')),

    showAddModal && h('div',{className:'fixed inset-0 z-[70] bg-black/60 p-3 flex items-center justify-center',onClick:()=>setShowAddModal(false)},
      h('form',{onSubmit:saveExpense,onClick:e=>e.stopPropagation(),className:'w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4 text-right max-h-[calc(100dvh-130px)] overflow-y-auto'},
        h('div',{className:'flex justify-between items-center'},h('h3',{className:'text-sm font-black'},editingExpense?t("تعديل المصروف"):'تسجيل مصروف جديد'),h('button',{type:'button',onClick:()=>setShowAddModal(false),className:'p-1.5 rounded-lg hover:bg-slate-100'},h(X,{className:'w-4 h-4'}))),
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},t("المبلغ *")),h('input',{type:'number',step:'any',min:'0.01',required:true,value:amount,onChange:e=>setAmount(e.target.value),className:'w-full px-3 py-2 text-sm font-mono font-bold border rounded-xl'})),
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'نوع المصروف *'),h(SearchableDropdown,{id:'expense-category-editor',options:configuredCategories.map(c=>({id:c,label:c})),selectedId:category,onSelect:setCategory,placeholder:'اختر نوع المصروف'})),
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'صرف من الحساب *'),h(SearchableDropdown,{id:'expense-account-editor',options:accounts.map(a=>({id:a.id,label:a.name,subLabel:`الرصيد: ${money(a.balance)} ${settings.currencySymbol}`})),selectedId:accountId,onSelect:setAccountId,placeholder:t("اختر الحساب")})),
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'البيان / الملاحظات'),h('input',{type:'text',value:notes,onChange:e=>setNotes(e.target.value),placeholder:'تفاصيل المصروف...',className:'w-full px-3 py-2 text-xs border rounded-xl'})),
        h('div',{className:'flex justify-between pt-2 border-t'},h('button',{type:'button',onClick:()=>setShowAddModal(false),className:'px-3 py-2 text-xs text-slate-500'},t("إلغاء")),h('button',{type:'submit',className:'px-5 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold'},editingExpense?t("حفظ التعديل"):'تأكيد التسجيل'))
      )
    ),

    showTypeManager && h('div',{className:'fixed inset-0 z-[75] bg-black/60 p-3 flex items-center justify-center',onClick:()=>setShowTypeManager(false)},
      h('div',{onClick:e=>e.stopPropagation(),className:'expense-types-modal-panel w-full max-w-md rounded-2xl bg-white shadow-2xl text-right overflow-hidden flex flex-col max-h-[calc(100dvh-130px)]'},
        h('div',{className:'shrink-0 flex justify-between items-center p-4 border-b border-slate-100 bg-white'},h('div',null,h('h3',{className:'text-sm font-black'},'إدارة أنواع المصروف'),h('p',{className:'text-[10px] text-slate-500 mt-1'},'الأنواع الجديدة تتزامن ضمن إعدادات الشركة، والحركات القديمة تبقى محفوظة.')),h('button',{type:'button',onClick:()=>setShowTypeManager(false),className:'p-1.5 rounded-lg hover:bg-slate-100'},h(X,{className:'w-4 h-4'}))),
        h('form',{onSubmit:addExpenseType,className:'shrink-0 flex gap-2 p-4 border-b border-slate-100'},h('input',{value:newType,onChange:e=>setNewType(e.target.value),placeholder:'مثال: وقود، مواصلات، أجور يومية...',className:'flex-1 min-w-0 px-3 py-2 text-xs border rounded-xl'}),h('button',{type:'submit',className:'shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold'},'إضافة')),
        h('div',{className:'expense-types-modal-scroll flex-1 min-h-0 overflow-y-auto p-4 space-y-2 custom-scrollbar'},configuredCategories.map(name=>h('div',{key:name,className:'flex justify-between items-center p-2.5 rounded-xl border border-slate-200 bg-slate-50'},h('span',{className:'text-xs font-bold'},name),h('button',{type:'button',onClick:()=>removeExpenseType(name),className:'p-1.5 rounded-lg text-rose-600 hover:bg-rose-50',title:'حذف النوع من القائمة'},h(Trash2,{className:'w-3.5 h-3.5'})))))
      )
    )
  );
};
