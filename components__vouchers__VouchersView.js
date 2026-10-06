import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, useDatabasePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { exportToCSV, printElementOnly, warmExportLibraries } from './utils__export.js?v=7.9.4.136-localization';
import { downloadProfessionalTablePDF, downloadProfessionalTableImage, downloadProfessionalVoucherPDF, downloadProfessionalVoucherImage } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { getBrandLogoDataUrl, getBrandLogoDisplayUrl } from './brand__logo.js?v=7.9.4.136-localization';
import { FileSpreadsheet, ArrowDownLeft, ArrowUpRight, Search, Trash2, Printer, Download, Image as ImageIcon, FileText, CreditCard, User, Building2, AlertCircle, Eye, X } from 'lucide-react';

const h = React.createElement;
const money = (v) => (Number(v) || 0).toFixed(2);

export const VouchersView = () => {
  const { createVoucher, deleteVoucher, customers, suppliers, accounts, settings, currentUser, showToast, queryAllStoreRecords, queryStoreStats } = useApp();
  const [activeTabFilter, setActiveTabFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewingVoucher, setViewingVoucher] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [voucherPaperSize, setVoucherPaperSize] = useState(settings.printerWidth || '80mm');
  const tableContainerRef = useRef(null);
  const voucherPrintRef = useRef(null);

  const [formType, setFormType] = useState('receipt');
  const [formPartyType, setFormPartyType] = useState('customer');
  const [formPartyId, setFormPartyId] = useState('');
  const [formPartyCustomName, setFormPartyCustomName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formSourceType, setFormSourceType] = useState('account');
  const defaultAccountId = accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '';
  const [formAccountId, setFormAccountId] = useState(defaultAccountId);
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => { warmExportLibraries(); }, []);
  useEffect(() => { if (!viewingVoucher) setVoucherPaperSize(settings.printerWidth || '80mm'); }, [settings.printerWidth, viewingVoucher]);

  const canManageVouchers = currentUser?.permissions?.canManageVouchers === true;
  const years = Array.isArray(settings.financialYears) ? settings.financialYears : [];
  const activeFY = settings.activeFinancialYearId || years.find(y=>y?.status==='open')?.id || 'fy-initial';
  const legacyFY = years[0]?.id || activeFY;
  const voucherQueryOptions = {
    search: searchTerm,
    filters: { financialYearId: activeFY, type: activeTabFilter },
    legacyFinancialYearId: legacyFY,
    sortField: 'date',
    sortDirection: 'desc',
    deletedMode: 'exclude',
    pageSize: 50,
  };
  const vouchersPager = useDatabasePagination('vouchers', voucherQueryOptions, `${activeFY}|${activeTabFilter}|${searchTerm}`);
  const filteredVouchers = vouchersPager.pageItems;
  const [voucherTotals, setVoucherTotals] = useState({ receipts: 0, payments: 0 });
  useEffect(() => {
    if (typeof queryStoreStats !== 'function') return undefined;
    let cancelled = false;
    Promise.all([
      queryStoreStats('vouchers', { filters:{ financialYearId: activeFY, type:'receipt' }, legacyFinancialYearId:legacyFY, sumFields:['amount'], deletedMode:'exclude' }),
      queryStoreStats('vouchers', { filters:{ financialYearId: activeFY, type:'payment' }, legacyFinancialYearId:legacyFY, sumFields:['amount'], deletedMode:'exclude' }),
    ]).then(([receipts,payments]) => {
      if (cancelled) return;
      setVoucherTotals({
        receipts: Number(receipts?.ranges?.all?.sums?.amount || 0),
        payments: Number(payments?.ranges?.all?.sums?.amount || 0),
      });
    }).catch((err)=>console.warn('Voucher totals failed',err));
    return () => { cancelled = true; };
  }, [activeFY, legacyFY]);
  const totalReceipts = voucherTotals.receipts;
  const totalPayments = voucherTotals.payments;

  const openNew = (type) => {
    setFormType(type);
    setFormPartyType(type === 'receipt' ? 'customer' : 'supplier');
    setFormPartyId(type === 'receipt' ? (customers[0]?.id || '') : (suppliers[0]?.id || ''));
    setFormPartyCustomName('');
    setFormAmount('');
    setFormDate(new Date().toISOString().slice(0,10));
    setFormSourceType('account');
    setFormAccountId(accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '');
    setFormNotes('');
    setIsModalOpen(true);
  };

  const submitVoucher = async (e) => {
    e.preventDefault();
    const amount = Number(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) { showToast('يرجى تحديد مبلغ السند بشكل صحيح', 'error'); return; }
    let partyName = formPartyCustomName.trim();
    if (formPartyType === 'customer') partyName = customers.find(c => c.id === formPartyId)?.name || partyName;
    if (formPartyType === 'supplier') partyName = suppliers.find(s => s.id === formPartyId)?.name || partyName;
    if (!partyName) partyName = formPartyType === 'customer' ? 'عميل غير محدد' : formPartyType === 'supplier' ? 'مورد غير محدد' : 'جهة خارجية';
    const effectiveSourceType = formType === 'receipt' ? 'account' : formSourceType;
    if (effectiveSourceType === 'account' && !formAccountId) { showToast(formType === 'receipt' ? 'اختر الحساب الذي سيتم الإيداع فيه' : 'اختر الحساب الذي سيتم الصرف منه', 'warning'); return; }
    const created = await createVoucher({
      type: formType, partyType: formPartyType, partyId: formPartyId || undefined, partyName, amount,
      date: formDate ? new Date(formDate).toISOString() : undefined,
      sourceType: effectiveSourceType, accountId: effectiveSourceType === 'account' ? formAccountId : undefined,
      notes: formNotes.trim() || undefined,
    });
    if (created) { setIsModalOpen(false); setViewingVoucher(created); setVoucherPaperSize(settings.printerWidth || '80mm'); }
  };

  const voucherExportData = (rowsSource = []) => ({
    headers: ['رقم السند','النوع','التاريخ','الجهة','المبلغ','الحساب/المصدر','البيان','المستخدم'],
    rows: rowsSource.map(v => [v.voucherNumber, v.type === 'receipt' ? 'سند قبض' : 'سند صرف', new Date(v.date).toLocaleString('ar-EG'), v.partyName, Number(v.amount)||0, v.sourceType === 'account' ? (v.accountName || 'حساب مالي') : 'بدون حساب', v.notes || '', v.userName || ''])
  });
  const loadAllFilteredVouchers = async () => typeof queryAllStoreRecords === 'function'
    ? queryAllStoreRecords('vouchers', { ...voucherQueryOptions, pageSize: 200 })
    : filteredVouchers;
  const exportTablePDF = async () => {
    const {headers,rows}=voucherExportData(await loadAllFilteredVouchers());
    const ok = await downloadProfessionalTablePDF({title:'كشف سندات القبض والصرف',headers,rows,settings,orientation:'landscape',filename:`كشف-السندات-${new Date().toISOString().slice(0,10)}.pdf`});
    if (!ok) showToast('تعذر إنشاء ملف PDF', 'error');
  };
  const exportTableImage = async () => {
    const {headers,rows}=voucherExportData(await loadAllFilteredVouchers());
    const ok = await downloadProfessionalTableImage({title:'كشف سندات القبض والصرف',headers,rows,settings,orientation:'landscape',filename:`كشف-السندات-${new Date().toISOString().slice(0,10)}.png`});
    if (!ok) showToast('تعذر حفظ الصورة', 'error');
  };
  const exportCSV = async () => {
    const { headers, rows } = voucherExportData(await loadAllFilteredVouchers());
    exportToCSV(`سندات-${new Date().toISOString().slice(0,10)}`, headers, rows);
  };

  const paperPreviewWidth = voucherPaperSize === '58mm' ? '219px' : voucherPaperSize === 'a4' ? 'min(794px,100%)' : '302px';
  const logo = getBrandLogoDataUrl(settings);

  const voucherPaper = viewingVoucher ? h('div', {
    ref: voucherPrintRef,
    id: 'printable-voucher-paper',
    'data-paper': voucherPaperSize,
    dir: 'rtl',
    className: 'voucher-paper bg-white text-black border border-slate-200 rounded-xl shadow-sm text-right overflow-hidden',
    style: { width: paperPreviewWidth, maxWidth: '100%', fontFamily: "'Cairo',Arial,sans-serif", padding: voucherPaperSize === 'a4' ? '28px' : voucherPaperSize === '58mm' ? '10px' : '14px' }
  },
    h('div',{className:'text-center pb-3 border-b border-dashed border-gray-300'},
      h('img',{src:logo,alt:'الشعار',className:'h-12 max-w-[120px] mx-auto mb-1 object-contain'}),
      h('h3',{className:'text-base font-black leading-tight'},settings.storeName || 'كاش توب 3'),
      h('p',{className:'text-[10px] text-gray-500 font-semibold'},settings.subtitle || 'نظام محاسبة وكاشير'),
      settings.address ? h('p',{className:'text-[9px] text-gray-500'},settings.address) : null,
      settings.phone ? h('p',{className:'text-[9px] text-gray-500'},`هاتف: ${settings.phone}`) : null,
      settings.taxNumber ? h('p',{className:'text-[9px] text-gray-500'},`الرقم الضريبي: ${settings.taxNumber}`) : null
    ),
    h('div',{className:'py-3 text-center border-b border-dashed border-gray-300'},
      h('div',{className:`inline-block px-3 py-1 rounded-md text-xs font-black ${viewingVoucher.type==='receipt'?'bg-violet-100 text-violet-800':'bg-amber-100 text-amber-800'}`},viewingVoucher.type==='receipt'?'سند قبض مالي':'سند صرف مالي'),
      h('div',{className:'text-xs font-black text-gray-800 mt-1'},`رقم السند: #${viewingVoucher.voucherNumber}`),
      h('div',{className:'text-[9px] text-gray-500'},new Date(viewingVoucher.date).toLocaleString('ar-EG'))
    ),
    h('div',{className:'py-3 space-y-2 border-b border-dashed border-gray-300 text-[11px]'},
      h('div',{className:'flex justify-between gap-3'},h('span',{className:'text-gray-500'},viewingVoucher.type==='receipt'?'استلمنا من:':'صرفنا إلى:'),h('span',{className:'font-black text-gray-900 text-left'},viewingVoucher.partyName || '-')),
      h('div',{className:'flex justify-between gap-3'},h('span',{className:'text-gray-500'},viewingVoucher.type==='receipt'?'في حساب:':'من حساب:'),h('span',{className:'font-bold text-gray-800 text-left'},viewingVoucher.sourceType==='account'?(viewingVoucher.accountName || 'حساب مالي'):'بدون حساب')),
      h('div',{className:'flex justify-between items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-gray-200'},h('span',{className:'font-black text-gray-700'},t("المبلغ:")),h('span',{className:'text-lg font-black text-violet-700 font-mono',dir:'ltr'},`${money(viewingVoucher.amount)} ${settings.currencySymbol || ''}`)),
      viewingVoucher.notes ? h('div',{className:'pt-1'},h('span',{className:'text-gray-500 block text-[9px]'},'البيان:'),h('div',{className:'text-[10px] font-semibold bg-gray-50 p-2 rounded border border-gray-100'},viewingVoucher.notes)) : null
    ),
    h('div',{className:'pt-4 grid grid-cols-2 text-center text-[9px] text-gray-500 gap-3'},
      h('div',null,h('span',null,'المستلم'),h('div',{className:'mt-6 border-b border-gray-300'})),
      h('div',null,h('span',null,'أمين الصندوق / الكاشير'),h('div',{className:'mt-6 border-b border-gray-300'}),h('span',{className:'text-[8px] text-gray-400 block mt-1'},viewingVoucher.userName || 'المدير'))
    ),
    h('div',{className:'mt-5 text-center text-[8px] text-gray-400'},`نظام ${settings.storeName || 'كاش توب 3'} - سند مالي رسمي`)
  ) : null;

  return h('div',{id:'vouchers-view-container',className:'p-3 sm:p-5 space-y-4 max-w-7xl mx-auto select-none min-h-full'},
    h('div',{className:'flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800'},
      h('div',null,h('div',{className:'flex items-center gap-2'},h(FileSpreadsheet,{className:'w-5 h-5 text-violet-600'}),h('h2',{className:'text-lg font-black'},t("سندات القبض والصرف")))),
      h('div',{id:'voucher-create-actions',className:'flex gap-2 flex-wrap'},
        h('button',{type:'button',disabled:!canManageVouchers,onClick:()=>openNew('receipt'),className:'px-3 py-2 rounded-xl bg-violet-600 text-white text-xs font-black flex items-center gap-1.5'},h(ArrowDownLeft,{className:'w-4 h-4'}),'سند قبض'),
        h('button',{type:'button',disabled:!canManageVouchers,onClick:()=>openNew('payment'),className:'px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-black flex items-center gap-1.5'},h(ArrowUpRight,{className:'w-4 h-4'}),'سند صرف')
      )
    ),
    h('div',{className:'grid grid-cols-3 gap-2'},
      h('div',{className:'p-3 rounded-xl bg-white border text-center'},h('div',{className:'text-[10px] text-slate-500'},'إجمالي القبض'),h('div',{className:'font-black text-violet-600 font-mono'},`${money(totalReceipts)} ${settings.currencySymbol}`)),
      h('div',{className:'p-3 rounded-xl bg-white border text-center'},h('div',{className:'text-[10px] text-slate-500'},'إجمالي الصرف'),h('div',{className:'font-black text-amber-600 font-mono'},`${money(totalPayments)} ${settings.currencySymbol}`)),
      h('div',{className:'p-3 rounded-xl bg-white border text-center'},h('div',{className:'text-[10px] text-slate-500'},'الصافي'),h('div',{className:'font-black text-slate-900 font-mono'},`${money(totalReceipts-totalPayments)} ${settings.currencySymbol}`))
    ),
    h('div',{className:'flex flex-wrap items-center gap-2'},
      ...[['all','الكل'],['receipt','قبض'],['payment','صرف']].map(([id,label])=>h('button',{key:id,type:'button',onClick:()=>setActiveTabFilter(id),className:`px-3 py-1.5 rounded-lg text-xs font-bold ${activeTabFilter===id?'bg-slate-900 text-white':'bg-white border text-slate-600'}`},label)),
      h('div',{className:'relative flex-1 min-w-[180px]'},h(Search,{className:'absolute right-2.5 top-2.5 w-4 h-4 text-slate-400'}),h('input',{value:searchTerm,onChange:e=>setSearchTerm(e.target.value),placeholder:'بحث في السندات...',className:'w-full pr-8 pl-3 py-2 text-xs border rounded-xl bg-white'})),
      h('button',{type:'button',onClick:exportTableImage,className:'p-2 rounded-lg bg-white border',title:t("صورة")},h(ImageIcon,{className:'w-4 h-4 text-blue-600'})),
      h('button',{type:'button',onClick:exportTablePDF,className:'p-2 rounded-lg bg-white border',title:'PDF'},h(Download,{className:'w-4 h-4 text-rose-600'})),
      h('button',{type:'button',onClick:exportCSV,className:'p-2 rounded-lg bg-white border',title:'Excel/CSV'},h(FileSpreadsheet,{className:'w-4 h-4 text-violet-600'}))
    ),
    h('div',{ref:tableContainerRef,id:'vouchers-table-card',className:'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 overflow-x-auto'},
      h('table',{className:'w-full text-xs text-right min-w-[760px]'},
        h('thead',{className:'bg-slate-50 text-slate-500'},h('tr',null,...['#','النوع','التاريخ','الجهة','المبلغ','الحساب/المصدر','البيان',''].map((x,i)=>h('th',{key:i,className:'p-3'},x)))),
        h('tbody',{className:'divide-y'},...(vouchersPager.totalItems?vouchersPager.pageItems.map(v=>h('tr',{key:v.id,className:'hover:bg-slate-50'},
          h('td',{className:'p-3 font-mono font-bold'},v.voucherNumber),
          h('td',{className:'p-3'},h('span',{className:`px-2 py-1 rounded-lg font-bold ${v.type==='receipt'?'bg-violet-50 text-violet-700':'bg-amber-50 text-amber-700'}`},v.type==='receipt'?'قبض':'صرف')),
          h('td',{className:'p-3 text-slate-500'},new Date(v.date).toLocaleDateString('ar-EG')),
          h('td',{className:'p-3 font-bold'},v.partyName || '-'),
          h('td',{className:'p-3 font-mono font-black'},`${money(v.amount)} ${settings.currencySymbol}`),
          h('td',{className:'p-3'},v.sourceType==='account'?(v.accountName||'حساب مالي'):'بدون حساب'),
          h('td',{className:'p-3 text-slate-500 max-w-[220px] truncate'},v.notes||'-'),
          h('td',{className:'p-3'},h('div',{className:'flex gap-1'},h('button',{type:'button',onClick:()=>{setViewingVoucher(v);setVoucherPaperSize(settings.printerWidth||'80mm');},className:'p-1.5 rounded-lg hover:bg-violet-50 text-violet-700'},h(Eye,{className:'w-4 h-4'})),h('button',{type:'button',onClick:()=>setDeleteConfirmId(v.id),className:'p-1.5 rounded-lg hover:bg-rose-50 text-rose-600'},h(Trash2,{className:'w-4 h-4'}))))
        )):[h('tr',{key:'empty'},h('td',{colSpan:8,className:'p-8 text-center text-slate-400'},'لا توجد سندات مطابقة'))]))
      ),
      h(Pagination,{pager:vouchersPager})
    ),
    isModalOpen ? createPortal(h('div',{className:'voucher-editor-overlay fixed inset-0 oscar-bounded-modal z-[100] bg-black/60 p-0 flex items-stretch justify-center overflow-hidden'},
      h('div',{className:'voucher-editor-stage w-screen h-full overflow-y-auto custom-scrollbar flex items-center justify-center p-3'},
      h('form',{onSubmit:submitVoucher,className:'voucher-editor-panel w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl p-4 sm:p-5 space-y-4 text-right'},
        h('div',{className:'flex items-center justify-between'},h('h3',{className:'font-black'},formType==='receipt'?'إضافة سند قبض':'إضافة سند صرف'),h('button',{type:'button',onClick:()=>setIsModalOpen(false),className:'p-1 text-slate-400'},h(X,{className:'w-5 h-5'}))),
        h('div',{className:'grid grid-cols-2 gap-3'},
          h('div',null,h(SearchableDropdown,{id:'voucher-party-type',label:'نوع الجهة',options:[{id:'customer',label:'عميل'},{id:'supplier',label:'مورد'},{id:'other',label:'جهة أخرى'}],selectedId:formPartyType,onSelect:(id)=>{setFormPartyType(id);setFormPartyId(id==='customer'?(customers[0]?.id||''):id==='supplier'?(suppliers[0]?.id||''):'');},placeholder:'اختر الجهة'})),
          h('div',null,h('label',{className:'text-xs font-bold block mb-1'},t("التاريخ")),h('input',{type:'date',value:formDate,onChange:e=>setFormDate(e.target.value),className:'w-full px-3 py-2 text-xs border rounded-xl'}))
        ),
        formPartyType==='customer' ? h(SearchableDropdown,{id:'voucher-customer',label:t("العميل"),options:customers.map(c=>({id:c.id,label:c.name,subLabel:c.phone||''})),selectedId:formPartyId,onSelect:setFormPartyId,placeholder:'اختر العميل'}) : formPartyType==='supplier' ? h(SearchableDropdown,{id:'voucher-supplier',label:t("المورد"),options:suppliers.map(s=>({id:s.id,label:s.name,subLabel:s.phone||''})),selectedId:formPartyId,onSelect:setFormPartyId,placeholder:'اختر المورد'}) : h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'اسم الجهة'),h('input',{value:formPartyCustomName,onChange:e=>setFormPartyCustomName(e.target.value),className:'w-full px-3 py-2 text-xs border rounded-xl'})),
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},t("المبلغ")),h('input',{type:'number',inputMode:'decimal',step:'any',min:'0.01',required:true,value:formAmount,onChange:e=>setFormAmount(e.target.value),className:'w-full px-3 py-2 text-sm font-mono font-black border rounded-xl'})),
        formType==='payment' ? h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'طريقة الصرف'),h(SearchableDropdown,{id:'voucher-source-type',options:[{id:'account',label:'من حساب'},{id:'debt_without_account',label:'بدون حساب'}],selectedId:formSourceType,onSelect:setFormSourceType,placeholder:'اختر طريقة الصرف'})) : null,
        (formType==='receipt'||formSourceType==='account') ? h(SearchableDropdown,{id:'voucher-account',label:formType==='receipt'?'في حساب':'من حساب',options:accounts.map(a=>({id:a.id,label:a.name,subLabel:`الرصيد: ${money(a.balance)} ${settings.currencySymbol}`})),selectedId:formAccountId,onSelect:setFormAccountId,placeholder:t("اختر الحساب")}) : null,
        h('div',null,h('label',{className:'text-xs font-bold block mb-1'},'البيان / ملاحظات'),h('textarea',{rows:2,value:formNotes,onChange:e=>setFormNotes(e.target.value),className:'w-full px-3 py-2 text-xs border rounded-xl'})),
        h('div',{className:'flex justify-end gap-2 pt-2 border-t'},h('button',{type:'button',onClick:()=>setIsModalOpen(false),className:'px-4 py-2 text-xs font-bold text-slate-500'},t("إلغاء")),h('button',{type:'submit',className:`px-5 py-2 rounded-xl text-white text-xs font-black ${formType==='receipt'?'bg-violet-600':'bg-amber-600'}`},formType==='receipt'?'حفظ سند القبض':'حفظ سند الصرف'))
      ))
    ), document.body) : null,
    viewingVoucher ? createPortal(h('div',{className:'fixed inset-x-0 oscar-bounded-modal z-[120] bg-black/70 backdrop-blur-[2px] p-2 sm:p-3 flex items-stretch justify-center overflow-hidden'},
      h('div',{className:`w-full ${voucherPaperSize==='a4'?'max-w-4xl':'max-w-md'} h-full max-h-full bg-slate-100 dark:bg-slate-950 rounded-2xl shadow-2xl p-2 sm:p-3 flex flex-col overflow-hidden`},
        h('div',{className:'no-print flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl p-2 border mb-2 shrink-0'},
          h('div',{className:'flex items-center gap-1'},...['80mm','58mm','a4'].map(id=>h('button',{key:id,type:'button',onClick:()=>setVoucherPaperSize(id),className:`px-2.5 py-1.5 rounded-lg text-[11px] font-black ${voucherPaperSize===id?'bg-violet-600 text-white':'bg-slate-100 text-slate-600'}`},id==='80mm'?'80 ملم':id==='58mm'?'58 ملم':'A4'))),
          h('div',{className:'flex items-center gap-1'},
            h('button',{type:'button',onClick:async()=>{const ok=await printElementOnly(voucherPrintRef.current,voucherPaperSize,`سند ${viewingVoucher.voucherNumber}`);if(!ok)showToast('تعذر تجهيز الطباعة','error');},className:'px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-black flex items-center gap-1'},h(Printer,{className:'w-3.5 h-3.5'}),t("طباعة")),
            h('button',{type:'button',onClick:async()=>{const ok=await downloadProfessionalVoucherImage(viewingVoucher,settings,`سند-${viewingVoucher.voucherNumber}.png`,voucherPaperSize);if(!ok)showToast('تعذر حفظ صورة السند','error');else showToast('تم تجهيز صورة السند','success');},className:'p-2 rounded-lg bg-white border',title:'حفظ صورة'},h(ImageIcon,{className:'w-4 h-4 text-blue-600'})),
            h('button',{type:'button',onClick:async()=>{const ok=await downloadProfessionalVoucherPDF(viewingVoucher,settings,`سند-${viewingVoucher.voucherNumber}.pdf`,voucherPaperSize);if(!ok)showToast('تعذر حفظ PDF','error');else showToast('تم تجهيز PDF','success');},className:'p-2 rounded-lg bg-white border',title:'PDF'},h(Download,{className:'w-4 h-4 text-rose-600'})),
            h('button',{type:'button',onClick:()=>setViewingVoucher(null),className:'p-2 rounded-lg bg-slate-100 text-slate-500'},h(X,{className:'w-4 h-4'}))
          )
        ),
        h('div',{className:'flex-1 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain touch-pan-y custom-scrollbar flex justify-center items-start p-2'},voucherPaper)
      )
    ), document.body) : null,
    deleteConfirmId ? h('div',{className:'fixed inset-0 z-[130] bg-black/60 p-4 flex items-center justify-center'},h('div',{className:'w-full max-w-sm bg-white rounded-2xl p-5 text-right'},h('div',{className:'flex items-center gap-2 text-rose-600 mb-2'},h(AlertCircle,{className:'w-5 h-5'}),h('h3',{className:'font-black'},'حذف السند؟')),h('p',{className:'text-xs text-slate-500'},'سيتم حذف السند وإلغاء أثره المالي.'),h('div',{className:'flex justify-end gap-2 mt-4'},h('button',{type:'button',onClick:()=>setDeleteConfirmId(null),className:'px-3 py-2 text-xs font-bold'},'تراجع'),h('button',{type:'button',onClick:async()=>{await deleteVoucher(deleteConfirmId);setDeleteConfirmId(null);},className:'px-4 py-2 bg-rose-600 text-white text-xs font-black rounded-xl'},t("حذف"))))) : null
  );
};
