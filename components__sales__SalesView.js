import {registerLayer} from './hooks__appNavigation.js?v=7.9.4.136-localization';
import {t} from './services__i18n.js?v=7.9.4.136-localization';
import {SalesFilters,salesDateRange} from './components__sales__SalesFilters.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, useDatabasePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { MessageActionButtons } from './components__common__MessageActionButtons.js?v=7.9.4.136-localization';
import { downloadProfessionalTablePDF, downloadProfessionalTableImage, downloadProfessionalTableExcel, downloadProfessionalInvoicePDF, downloadProfessionalInvoiceImage, downloadProfessionalInvoiceExcel } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { getBrandLogoDataUrl, getBrandLogoDisplayUrl, DEFAULT_LOGO_DATA_URL } from './brand__logo.js?v=7.9.4.136-localization';
import { Search, Printer, RotateCcw, Download, Eye, X, AlertCircle, Trash2, Pencil, Image as ImageIcon, FileSpreadsheet, MoreVertical, MessageCircle } from 'lucide-react';
export const SalesView = () => {
    const { customers, warehouses, accounts, settings, currentUser, deleteInvoice, beginEditSaleInvoice, setShowThermalModal, createReturnInvoice, showToast, queryAllStoreRecords, } = useApp();
    const [filtersOpen,setFiltersOpen]=useState(false);
    const [extraFilters,setExtraFilters]=useState({period:'all'});
    const [search, setSearch] = useState('');
    const [filterType, setFilterType] = useState('all');
    const [filterPayment, setFilterPayment] = useState('all');
    const financialYears = Array.isArray(settings.financialYears) ? settings.financialYears : [];
    const activeFinancialYearId = settings.activeFinancialYearId || financialYears.find((y) => y?.status === 'open')?.id || 'fy-initial';
    const legacyFinancialYearId = financialYears[0]?.id || activeFinancialYearId;
    const [financialYearFilter, setFinancialYearFilter] = useState('all');
    useEffect(() => {
        if (activeFinancialYearId && financialYearFilter !== 'all' && !financialYears.some((y) => y?.id === financialYearFilter)) setFinancialYearFilter(activeFinancialYearId);
    }, [activeFinancialYearId, settings.financialYears]);
    // Selected invoice for detail view modal
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [invoiceActionMenu, setInvoiceActionMenu] = useState(null);
 useEffect(()=>{if(invoiceActionMenu)return registerLayer(()=>setInvoiceActionMenu(null))},[invoiceActionMenu]);
    // Delete invoice confirmation modal
    const [deleteConfirmId, setDeleteConfirmId] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    // Return Invoice Modal
    const [returnTargetInvoice, setReturnTargetInvoice] = useState(null);
    const [returnQtys, setReturnQtys] = useState({});
    const [refundAccountId, setRefundAccountId] = useState(accounts.find(a=>a.isDefault)?.id || accounts[0]?.id || '');
    const [returnNotes, setReturnNotes] = useState('');
    const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
    const tableContainerRef = useRef(null);
    const invoiceModalRef = useRef(null);
    const canDeleteInvoice = currentUser?.permissions?.canDeleteInvoice === true;
    useEffect(() => {
        if (!invoiceActionMenu) return;
        const close = (e) => {
            if (e.target?.closest?.('.invoice-actions-menu') || e.target?.closest?.('.invoice-row-more')) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            e.stopImmediatePropagation?.();
            setInvoiceActionMenu(null);
        };
        const esc = (e) => { if (e.key === 'Escape') setInvoiceActionMenu(null); };
        const onScroll = () => setInvoiceActionMenu(null);
        const dismiss=()=>setInvoiceActionMenu(null);
        document.addEventListener('cash-top:close-action-menus',dismiss);
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('keydown', esc);
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('cash-top:close-action-menus',dismiss);
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('keydown', esc);
            document.removeEventListener('scroll', onScroll, true);
        };
    }, [invoiceActionMenu]);
    // True database-side pagination: only the requested 50 rows are fetched.
    const salesQueryOptions = {
        search,
        filters: { financialYearId: financialYearFilter, type: filterType, paymentType: filterPayment,customerId:extraFilters.customerId||'all',warehouseId:extraFilters.warehouseId||'all' },
        ...salesDateRange(extraFilters),
        ...(extraFilters.status==='paid'?{numericLte:{remainingAmount:0}}:extraFilters.status==='debt'?{numericGt:{remainingAmount:0},numericLte:{paidAmount:0}}:extraFilters.status==='partial'?{numericGt:{remainingAmount:0,paidAmount:0}}:{}),
        legacyFinancialYearId,
        sortField: 'date',
        sortDirection: 'desc',
        deletedMode: 'exclude',
        pageSize: 50,
    };
    const salesPager = useDatabasePagination('invoices', salesQueryOptions, `${search}|${filterType}|${filterPayment}|${financialYearFilter}|${JSON.stringify(extraFilters)}`);
    const filteredInvoices = salesPager.pageItems;
    const getSalesExportData = (sourceRows = filteredInvoices) => {
        const headers = ['رقم الفاتورة', 'النوع', 'التاريخ', 'العميل', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'إجمالي الصنف', 'طريقة الدفع / الصندوق', 'إجمالي الفاتورة', 'المدفوع', 'المتبقي'];
        const rows = [];
        sourceRows.forEach((inv) => {
            const items = Array.isArray(inv.items) && inv.items.length ? inv.items : [null];
            items.forEach((item) => rows.push([
                inv.invoiceNumber,
                inv.type === 'sale' ? 'بيع' : 'مرتجع',
                new Date(inv.date).toLocaleString('ar-EG'),
                inv.customerName || 'زبون عام',
                item?.productName || '-',
                item?.unitName || '-',
                Number(item?.quantity || 0),
                Number(item?.unitPrice || 0),
                Number(item?.total || 0),
                (() => {
                    const typeLabel = inv.paymentType === 'cash' ? 'نقدي' : inv.paymentType === 'debt' ? 'آجل' : inv.paymentType === 'multi' ? 'متعدد' : inv.paymentType === 'partial' ? 'جزئي' : (inv.paymentType || '-');
                    const names = [...new Set((Array.isArray(inv.payments) ? inv.payments : []).map((p) => p?.accountName || accounts.find((a) => a.id === p?.accountId)?.name || '').filter(Boolean))];
                    return names.length ? `${typeLabel} - ${names.join(' + ')}` : typeLabel;
                })(),
                Number(inv.grandTotal || 0),
                Number(inv.paidAmount || 0),
                Number(inv.remainingAmount || 0),
            ]));
        });
        return { headers, rows };
    };
    const loadAllFilteredInvoicesForExport = async () => {
        if (typeof queryAllStoreRecords !== 'function') return filteredInvoices;
        return await queryAllStoreRecords('invoices', { ...salesQueryOptions, pageSize: 200 });
    };
    const handleExportExcel = async () => {
        const allRows = await loadAllFilteredInvoicesForExport();
        const { headers, rows } = getSalesExportData(allRows);
        await downloadProfessionalTableExcel({
            title: 'سجل فواتير المبيعات',
            subtitle: `الفرع: ${settings.activeBranchName || 'الفرع الرئيسي'}`,
            headers, rows, settings,
            filename: `فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}.xlsx`,
        });
        showToast('تم إنشاء ملف Excel احترافي بالترويسة والشعار', 'success');
    };
    const handleExportPDF = async () => {
        const allRows = await loadAllFilteredInvoicesForExport();
        const { headers, rows } = getSalesExportData(allRows);
        await downloadProfessionalTablePDF({
            title: 'سجل فواتير المبيعات',
            subtitle: `الفرع: ${settings.activeBranchName || 'الفرع الرئيسي'}`,
            headers, rows, settings, orientation: 'landscape',
            filename: `سجل_فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}.pdf`,
        });
        showToast('تم إنشاء ملف PDF احترافي بالترويسة والشعار', 'success');
    };
    const handleExportImage = async () => {
        const allRows = await loadAllFilteredInvoicesForExport();
        const { headers, rows } = getSalesExportData(allRows);
        await downloadProfessionalTableImage({ title:'سجل فواتير المبيعات', subtitle:`الفرع: ${settings.activeBranchName || 'الفرع الرئيسي'}`, headers, rows, settings, orientation:'landscape', filename:`سجل_فواتير_المبيعات_${new Date().toISOString().slice(0,10)}.png` });
        showToast('تم إنشاء صورة احترافية لسجل المبيعات', 'success');
    };
    const handleExportSingleInvoicePDF = async (inv) => {
        await downloadProfessionalInvoicePDF(inv, settings, `فاتورة_مبيعات_${inv.invoiceNumber}.pdf`);
        showToast('تم تحميل PDF احترافي للفاتورة بالترويسة والشعار', 'success');
    };
    const handleExportSingleInvoiceExcel = async (inv) => {
        await downloadProfessionalInvoiceExcel(inv, settings, `فاتورة_مبيعات_${inv.invoiceNumber}.xlsx`);
        showToast('تم تحميل Excel احترافي للفاتورة بالترويسة والشعار', 'success');
    };
    const handleExportSingleInvoiceImage = async (inv) => {
        await downloadProfessionalInvoiceImage(inv, settings, `فاتورة_مبيعات_${inv.invoiceNumber}.png`);
        showToast('تم تحميل صورة الفاتورة بنجاح', 'success');
    };
    const handleDeleteInvoice = async () => {
        if (!deleteConfirmId)
            return;
        if (!canDeleteInvoice) {
            showToast('ليس لديك صلاحية لحذف فواتير المبيعات', 'error');
            return;
        }
        setIsDeleting(true);
        try {
            await deleteInvoice(deleteConfirmId);
            showToast('تم حذف الفاتورة وإلغاء أثرها المخزني والمالي بنجاح', 'success');
            setDeleteConfirmId(null);
            if (selectedInvoice?.id === deleteConfirmId) {
                setSelectedInvoice(null);
            }
        }
        catch (err) {
            showToast(err.message || 'فشل حذف الفاتورة', 'error');
        }
        finally {
            setIsDeleting(false);
        }
    };
    const handleOpenReturnModal = (inv) => {
        setReturnTargetInvoice(inv);
        const initialQtys = {};
        inv.items.forEach((item) => {
            initialQtys[item.id] = 0; // Default 0 for safe selective return
        });
        setReturnQtys(initialQtys);
        setReturnNotes('');
    };
    const handleConfirmReturn = async () => {
        if (!returnTargetInvoice || isSubmittingReturn)
            return;
        const itemsToReturn = returnTargetInvoice.items
            .filter((i) => (returnQtys[i.id] || 0) > 0)
            .map((i) => ({
            productId: i.productId,
            unitId: i.unitId,
            quantity: returnQtys[i.id],
            unitPrice: i.unitPrice,
        }));
        if (itemsToReturn.length === 0) {
            showToast('يرجى تحديد كمية صنف واحد على الأقل للإرجاع', 'warning');
            return;
        }
        setIsSubmittingReturn(true);
        try {
            const retInv = await createReturnInvoice({
                originalInvoiceId: returnTargetInvoice.id,
                items: itemsToReturn,
                refundAccountId,
                notes: returnNotes,
            });
            if (retInv) {
                setReturnTargetInvoice(null);
                if (settings.autoPrintReceipt) {
                    setShowThermalModal(retInv);
                }
            }
        }
        finally {
            setIsSubmittingReturn(false);
        }
    };
    return (_jsxs("div", { id: "sales-screen", className: "p-4 sm:p-6 space-y-4 max-w-7xl mx-auto text-right select-none", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-black text-slate-900 dark:text-white", children: "\u0633\u062c\u0644 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0648\u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631" }), _jsx("p", { className: "text-xs text-slate-500 mt-0.5", children: "\u0639\u0631\u0636 \u0648\u062a\u062f\u0642\u064a\u0642 \u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a\u060c \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629\u060c \u0627\u0644\u062a\u0635\u062f\u064a\u0631\u060c \u0648\u062d\u0630\u0641 \u0623\u0648 \u0625\u0631\u062c\u0627\u0639 \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631" })] }), _jsxs("div", { className: "flex items-center gap-2 flex-wrap self-start sm:self-auto", children: [_jsxs("button", { id: "btn-export-sales-pdf", onClick: handleExportPDF, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0634\u0641 \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631 \u0643\u0640 PDF", children: [_jsx(Download, { className: "w-3.5 h-3.5 text-rose-600" }), _jsx("span", { children: "PDF" })] }), _jsxs("button", { id: "btn-export-sales-image", onClick: handleExportImage, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0634\u0641 \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631 \u0643\u0635\u0648\u0631\u0629", children: [_jsx(ImageIcon, { className: "w-3.5 h-3.5 text-blue-600" }), _jsx("span", { children: t("صورة") })] }), _jsxs("button", { id: "btn-export-sales-csv", onClick: handleExportExcel, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition shadow-xs", title: "\u062a\u0635\u062f\u064a\u0631 \u062c\u062f\u0648\u0644 Excel", children: [_jsx(FileSpreadsheet, { className: "w-3.5 h-3.5 text-violet-600" }), _jsx("span", { children: "Excel" })] })] })] }), _jsxs("div", { className: "ct-sales-toolbar p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center gap-3", children: [_jsxs("div", { className: "flex-1 min-w-[200px] relative", children: [_jsx(Search, { className: "absolute right-3 top-2.5 w-4 h-4 text-slate-400" }), _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "\u0628\u062d\u062b \u0628\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629\u060c \u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644\u060c \u0627\u0644\u0635\u0646\u0641...", className: "w-full pr-9 pl-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-violet-500" })] }), _jsxs("div", { className: "flex items-center gap-1 text-xs", children: [_jsxs("button", { onClick: () => setFilterType('all'), className: `px-3 py-1.5 rounded-lg font-bold transition ${filterType === 'all'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`, children: ["\u0627\u0644\u0643\u0644 (", salesPager.totalItems, ")"] }), _jsx("button", { onClick: () => setFilterType('sale'), className: `px-3 py-1.5 rounded-lg font-bold transition ${filterType === 'sale'
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`, children: "\u0645\u0628\u064a\u0639\u0627\u062a" }), _jsx("button", { onClick: () => setFilterType('return'), className: `px-3 py-1.5 rounded-lg font-bold transition ${filterType === 'return'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`, children: t("مرتجعات") })] }), _jsx("div", { className: "ct-sales-inline-filter", children: _jsx(SearchableDropdown,{id:'sales-financial-group',label:t("المجموعة المالية"),selectedId:financialYearFilter,onSelect:setFinancialYearFilter,options:[{id:'all',label:t("كل المجموعات المالية")},...financialYears.map(year=>({id:year.id,label:year.name,subLabel:year.id===activeFinancialYearId?'الحالية':'أرشيف'}))]}) }), _jsx("div", { className: "ct-sales-inline-filter", children: _jsx(SearchableDropdown, { id: "sales-payment-filter", options: [{id:"multi",label:t("دفع متعدد")},{id:"all",label:t("كافة طرق الدفع")},{id:"cash",label:t("نقدي (كاش)")},{id:"debt",label:t("آجل (دين)")},{id:"partial",label:t("دفع جزئي")}], selectedId: filterPayment, onSelect: setFilterPayment, placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u062f\u0641\u0639..." }) })] }), React.createElement('div',{className:'ct-sales-filter-tools'},React.createElement('button',{type:'button',className:'ct-filter-launch',onClick:()=>setFiltersOpen(true),'aria-label':t("فلترة الفواتير")},React.createElement('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2},React.createElement('path',{d:'M3 6h18M3 12h18M3 18h18M8 3v6M16 9v6M9 15v6'})),'فلترة')),filtersOpen&&React.createElement(SalesFilters,{value:extraFilters,onApply:setExtraFilters,onClose:()=>setFiltersOpen(false),customers:customers||[],warehouses:warehouses||[]}),React.createElement('div',{className:'ct-mobile-sales'},...filteredInvoices.map(inv=>React.createElement('article',{className:'ct-invoice-card',key:inv.id},React.createElement('div',{className:'ct-invoice-card-top'},React.createElement('b',null,inv.invoiceNumber),React.createElement('span',{className:'ct-invoice-state '+(inv.type==='return'?'return':Number(inv.remainingAmount)>0?'debt':'paid')},inv.type==='return'?t("مرتجع"):Number(inv.remainingAmount)>0?(Number(inv.paidAmount)>0?t("جزئي"):t("آجل")):t("مدفوع")),React.createElement('button',{type:'button',title:'إجراءات الفاتورة',className:'invoice-row-more',onClick:e=>{const r=e.currentTarget.getBoundingClientRect();setInvoiceActionMenu({invoice:inv,isReturn:inv.type==='return',isArchivedFinancialYear:(inv.financialYearId||activeFinancialYearId)!==activeFinancialYearId,top:Math.max(8,Math.min(r.bottom,innerHeight-340)),left:Math.max(8,Math.min(innerWidth-200,r.left))})}},React.createElement(MoreVertical,{size:20}))),React.createElement('div',{className:'ct-invoice-customer'},inv.customerName||t("زبون عام")),React.createElement('div',{className:'ct-invoice-card-bottom'},React.createElement('span',null,new Date(inv.date).toLocaleDateString('ar-EG')),React.createElement('strong',null,Number(inv.grandTotal||0).toFixed(2)+' '+settings.currencySymbol))))), _jsx("div", { id: "sales-table-card", ref: tableContainerRef, className: "ct-desktop-sales rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden", children: _jsx("div", { className: "overflow-x-auto max-w-full slim-scrollbar", children: filteredInvoices.length === 0 ? (_jsx("div", { className: "p-12 text-center text-xs text-slate-400", children: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0641\u0648\u0627\u062a\u064a\u0631 \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u062e\u064a\u0627\u0631\u0627\u062a \u0627\u0644\u0628\u062d\u062b" })) : (_jsxs("table", { className: "w-full text-xs text-right whitespace-nowrap min-w-[880px]", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-slate-500 font-semibold", children: [_jsx("th", { className: "p-3", children: t("رقم الفاتورة") }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u0646\u0648\u0639" }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u062a\u0627\u0631\u064a\u062e \u0648\u0627\u0644\u0648\u0642\u062a" }), _jsx("th", { className: "p-3", children: t("العميل") }), _jsx("th", { className: "p-3", children: t("الأصناف") }), _jsx("th", { className: "p-3", children: t("طريقة الدفع") }), _jsx("th", { className: "p-3 text-left", children: "\u0627\u0644\u0635\u0627\u0641\u064a" }), _jsx("th", { className: "p-3 text-left", children: t("المدفوع") }), _jsx("th", { className: "p-3 text-left", children: "\u0627\u0644\u0645\u062a\u0628\u0642\u064a (\u062f\u064a\u0646)" }), _jsx("th", { className: "p-3 text-center", children: t("إجراءات") })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800/60", children: salesPager.pageItems.map((inv) => {
                                    const isReturn = inv.type === 'return';
                                    const isArchivedFinancialYear = (inv.financialYearId || activeFinancialYearId) !== activeFinancialYearId;
                                    return (_jsxs("tr", { className: "hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors", children: [_jsx("td", { className: "p-3 font-mono font-bold text-slate-900 dark:text-white", children: inv.invoiceNumber }), _jsx("td", { className: "p-3", children: _jsx("span", { className: `px-2 py-0.5 rounded text-[10px] font-bold ${isReturn
                                                        ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                                        : 'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300'}`, children: isReturn ? t("مرتجع") : 'بيع' }) }), _jsxs("td", { className: "p-3 text-slate-500 font-mono text-[11px]", children: [new Date(inv.date).toLocaleDateString('ar-EG'), " - ", new Date(inv.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })] }), _jsx("td", { className: "p-3 font-medium text-slate-800 dark:text-slate-200", children: inv.customerName || t("زبون عام") }), _jsxs("td", { className: "p-3 text-slate-500 font-mono", children: [inv.items.length, " \u0635\u0646\u0641"] }), _jsx("td", { className: "p-3", children: _jsx("span", { className: "px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300", children: inv.paymentType === 'cash' ? t("نقدي") : inv.paymentType === 'debt' ? t("آجل") : t("جزئي") }) }), _jsxs("td", { className: "p-3 text-left font-mono font-bold text-slate-900 dark:text-white", children: [inv.grandTotal.toFixed(2), " ", settings.currencySymbol] }), _jsx("td", { className: "p-3 text-left font-mono text-violet-600 dark:text-violet-400 font-semibold", children: inv.paidAmount.toFixed(2) }), _jsx("td", { className: "p-3 text-left font-mono text-rose-600 dark:text-rose-400 font-semibold", children: inv.remainingAmount > 0 ? inv.remainingAmount.toFixed(2) : '-' }), _jsx("td", { onClick: (e) => e.stopPropagation(), className: "p-3 invoice-actions-cell", children: _jsx("button", { type: "button", className: "invoice-row-more", title: "إجراءات الفاتورة", onClick: (e) => { e.stopPropagation(); const r=e.currentTarget.getBoundingClientRect(); const menuW=184; const menuH=330; setInvoiceActionMenu({ invoice:inv, isReturn, isArchivedFinancialYear, top:Math.max(8,Math.min(r.top,window.innerHeight-menuH-8)), left:Math.max(8,Math.min(window.innerWidth-menuW-8,r.left-menuW-6)) }); }, children: _jsx(MoreVertical, { className: "w-5 h-5" }) }) })] }, inv.id));
                                }) })] })) }) }), _jsx(Pagination, { pager: salesPager }), invoiceActionMenu && typeof document !== 'undefined' ? createPortal(_jsxs("div", { className: "cash-action-menu invoice-actions-menu", style: { position:"fixed", top:`${invoiceActionMenu.top}px`, left:`${invoiceActionMenu.left}px`, zIndex:2147483300 }, children: [
    _jsxs("button", { type:"button", onClick:()=>{ const inv=invoiceActionMenu.invoice; setInvoiceActionMenu(null); setSelectedInvoice(inv); }, children:[_jsx(Eye,{className:"w-4 h-4"}),_jsx("span",{children:t("عرض التفاصيل")})] }),
    !invoiceActionMenu.isReturn ? _jsxs("div", { className:"invoice-action-messages", children:[_jsx(MessageCircle,{className:"w-4 h-4"}),_jsx("span",{children:"الرسائل"}),_jsx(MessageActionButtons,{invoice:invoiceActionMenu.invoice,kind:"invoice"})] }) : null,
    _jsxs("button", { type:"button", onClick:()=>{ const inv=invoiceActionMenu.invoice; setInvoiceActionMenu(null); setShowThermalModal(inv); }, children:[_jsx(Printer,{className:"w-4 h-4"}),_jsx("span",{children:t("إيصال")})] }),
    !invoiceActionMenu.isReturn && !invoiceActionMenu.isArchivedFinancialYear ? _jsxs("button", { type:"button", onClick:()=>{ const inv=invoiceActionMenu.invoice; setInvoiceActionMenu(null); beginEditSaleInvoice?.(inv.id); }, children:[_jsx(Pencil,{className:"w-4 h-4"}),_jsx("span",{children:t("تعديل")})] }) : null,
    !invoiceActionMenu.isReturn && !invoiceActionMenu.isArchivedFinancialYear ? _jsxs("button", { type:"button", onClick:()=>{ const inv=invoiceActionMenu.invoice; setInvoiceActionMenu(null); handleOpenReturnModal(inv); }, children:[_jsx(RotateCcw,{className:"w-4 h-4"}),_jsx("span",{children:t("مرتجع")})] }) : null,
    !invoiceActionMenu.isArchivedFinancialYear ? _jsxs("button", { type:"button", className:"danger", onClick:()=>{ const id=invoiceActionMenu.invoice.id; setInvoiceActionMenu(null); setDeleteConfirmId(id); }, children:[_jsx(Trash2,{className:"w-4 h-4"}),_jsx("span",{children:t("حذف")})] }) : null
]}),document.body) : null, selectedInvoice && typeof document !== 'undefined' ? createPortal(_jsx(ModalLayer, { className: "invoice-detail-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in", children: _jsxs("div", { className: "invoice-detail-panel w-full max-w-xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right", children: [_jsxs("div", { className: "invoice-detail-actions p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-2 flex-wrap", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsxs("button", { onClick: () => handleExportSingleInvoicePDF(selectedInvoice), className: "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100", children: [_jsx(Download, { className: "w-3.5 h-3.5 text-rose-600" }), _jsx("span", { children: "PDF" })] }), _jsxs("button", { onClick: () => handleExportSingleInvoiceExcel(selectedInvoice), className: "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100", children: [_jsx(FileSpreadsheet, { className: "w-3.5 h-3.5 text-violet-600" }), _jsx("span", { children: "Excel" })] }), _jsxs("button", { onClick: () => handleExportSingleInvoiceImage(selectedInvoice), className: "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100", children: [_jsx(ImageIcon, { className: "w-3.5 h-3.5 text-blue-600" }), _jsx("span", { children: t("صورة") })] }), _jsxs("button", { onClick: () => {
                                                setShowThermalModal(selectedInvoice);
                                                setSelectedInvoice(null);
                                            }, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700", children: [_jsx(Printer, { className: "w-3.5 h-3.5" }), _jsx("span", { children: t("إيصال") })] })] }), _jsx("button", { onClick: () => setSelectedInvoice(null), className: "px-4 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-xs font-bold hover:bg-slate-300", children: t("إغلاق") })] }), _jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40", children: [_jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: [t("تفاصيل الفاتورة: "), selectedInvoice.invoiceNumber] }), _jsx("span", { className: "text-[11px] text-slate-500", children: new Date(selectedInvoice.date).toLocaleString('ar-EG') })] }), null] }), _jsxs("div", { id: "single-invoice-print-area", className: "invoice-detail-body p-4 space-y-4 max-h-[70vh] overflow-y-auto", children: [_jsxs("div", { className: "text-center pb-3 border-b border-dashed border-slate-300", children: [_jsx("img", { src: getBrandLogoDisplayUrl(settings), alt: settings.storeName, className: "h-16 max-w-[160px] mx-auto mb-2 object-contain", onError: (e) => { e.currentTarget.onerror = null; e.currentTarget.src = DEFAULT_LOGO_DATA_URL; } }), _jsx("h2", { className: "text-base font-black text-slate-900 dark:text-white", children: settings.storeName }), null, _jsx("p", { className: "text-[10px] text-slate-500 mt-1", children: [settings.address || '', settings.phone ? ` • ${settings.phone}` : ''] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("span", { className: "text-slate-400", children: t("العميل:") }), ' ', _jsx("strong", { className: "text-slate-800 dark:text-slate-200", children: selectedInvoice.customerName || t("عميل نقدي") })] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-400", children: t("الكاشير:") }), ' ', _jsx("strong", { className: "text-slate-800 dark:text-slate-200", children: selectedInvoice.cashierName })] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-400", children: t("طريقة الدفع:") }), ' ', _jsx("strong", { className: "text-slate-800 dark:text-slate-200", children: selectedInvoice.paymentType === 'cash' ? t("نقدي") : selectedInvoice.paymentType === 'debt' ? t("آجل") : t("دفع جزئي") })] }), _jsxs("div", { children: [_jsx("span", { className: "text-slate-400", children: "\u0627\u0644\u0645\u0628\u0644\u063a \u0627\u0644\u0635\u0627\u0641\u064a:" }), ' ', _jsxs("strong", { className: "text-violet-600 font-mono", children: [selectedInvoice.grandTotal.toFixed(2), " ", settings.currencySymbol] })] })] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-xs text-right whitespace-nowrap", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-200 dark:border-slate-700 text-slate-400", children: [_jsx("th",{className:"pb-1.5",children:"#"}), _jsx("th", { className: "pb-1.5", children: t("الصنف") }), _jsx("th", { className: "pb-1.5", children: t("الوحدة") }), _jsx("th", { className: "pb-1.5 text-center", children: t("الكمية") }), _jsx("th", { className: "pb-1.5 text-left", children: t("السعر") }), _jsx("th", { className: "pb-1.5 text-left", children: t("الإجمالي") })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: selectedInvoice.items.map((item, i) => (_jsxs("tr", { className: "py-1.5", children: [_jsx("td",{className:"py-2",children:i+1}), _jsx("td", { className: "py-2 font-medium", children: item.productName }), _jsx("td", { className: "py-2 text-slate-500", children: item.unitName }), _jsx("td", { className: "py-2 text-center font-mono font-bold", children: item.quantity }), _jsx("td", { className: "py-2 text-left font-mono", children: item.unitPrice.toFixed(2) }), _jsx("td", { className: "py-2 text-left font-mono font-bold text-slate-900 dark:text-white", children: item.total.toFixed(2) })] }, i))) })] }) })] }), ] }) }), document.body) : null, deleteConfirmId && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in", children: _jsxs("div", { className: "w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-800 text-right space-y-4", children: [_jsxs("div", { className: "flex items-center gap-3 text-rose-600", children: [_jsx("div", { className: "p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40", children: _jsx(AlertCircle, { className: "w-6 h-6" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u062a\u0623\u0643\u064a\u062f \u062d\u0630\u0641 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629" }), _jsx("p", { className: "text-xs text-slate-500", children: "\u0647\u0630\u0627 \u0627\u0644\u0625\u062c\u0631\u0627\u0621 \u0633\u064a\u0642\u0648\u0645 \u0628\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0646\u0647\u0627\u0626\u064a\u0627\u064b" })] })] }), _jsxs("p", { className: "text-xs text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl", children: ["\u0639\u0646\u062f \u0627\u0644\u062d\u0630\u0641\u060c \u0633\u064a\u062a\u0645 ", _jsx("strong", { children: "\u0625\u0639\u0627\u062f\u0629 \u0643\u0645\u064a\u0627\u062a \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u062a\u062c\u0631" }), " \u062a\u0644\u0642\u0627\u0626\u064a\u0627\u064b\u060c \u0648\u0625\u0644\u063a\u0627\u0621 \u0623\u064a \u0645\u0628\u0627\u0644\u063a \u0623\u0648 \u062f\u064a\u0648\u0646 \u0645\u0633\u062c\u0644\u0629 \u0639\u0644\u0649 \u0627\u0644\u0639\u0645\u064a\u0644 \u0623\u0648 \u0627\u0644\u0635\u0646\u062f\u0648\u0642."] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800", children: [_jsx("button", { type: "button", onClick: () => setDeleteConfirmId(null), className: "px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 hover:bg-slate-50", children: t("إلغاء") }), _jsx("button", { type: "button", disabled: isDeleting, onClick: handleDeleteInvoice, className: "px-4 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 shadow-md shadow-rose-600/20 disabled:opacity-50", children: isDeleting ? 'جاري الحذف...' : 'نعم، احذف الفاتورة' })] })] }) })), returnTargetInvoice && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in", children: _jsxs("div", { className: "w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right", children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-rose-50/50 dark:bg-rose-950/20", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(RotateCcw, { className: "w-5 h-5 text-rose-600" }), _jsxs("div", { children: [_jsxs("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: ["\u0625\u0631\u062c\u0627\u0639 \u0623\u0635\u0646\u0627\u0641 \u0645\u0646 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629: ", returnTargetInvoice.invoiceNumber] }), _jsx("p", { className: "text-xs text-slate-500", children: "\u062d\u062f\u062f \u0627\u0644\u0643\u0645\u064a\u0627\u062a \u0627\u0644\u0645\u0631\u0627\u062f \u0625\u0631\u062c\u0627\u0639\u0647\u0627 \u0625\u0644\u0649 \u0627\u0644\u0645\u062e\u0632\u0646" })] })] }), _jsx("button", { onClick: () => setReturnTargetInvoice(null), className: "p-1 rounded-md text-slate-400 hover:text-slate-600", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-4 space-y-4 max-h-[70vh] overflow-y-auto", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block", children: "\u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0627\u0644\u0645\u062a\u0636\u0645\u0646\u0629 \u0641\u064a \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629:" }), returnTargetInvoice.items.map((item) => (_jsxs("div", { className: "flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-bold text-slate-800 dark:text-slate-200", children: item.productName }), _jsxs("div", { className: "text-[11px] text-slate-400", children: [t("الوحدة: "), item.unitName, " | \u0627\u0644\u0633\u0639\u0631: ", item.unitPrice, " ", settings.currencySymbol, " | \u0627\u0644\u0645\u0628\u0627\u0639: ", item.quantity] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs text-slate-500", children: "\u0643\u0645\u064a\u0629 \u0627\u0644\u0625\u0631\u062c\u0627\u0639:" }), _jsx("input", { type: "number", min: "0", max: item.quantity, value: returnQtys[item.id] || 0, onChange: (e) => {
                                                                const val = Math.min(item.quantity, Math.max(0, parseFloat(e.target.value) || 0));
                                                                setReturnQtys((prev) => ({ ...prev, [item.id]: val }));
                                                            }, className: "w-16 px-2 py-1 text-xs font-mono font-bold text-center border rounded-lg bg-white dark:bg-slate-900" })] })] }, item.id)))] }), _jsxs("div", { children: [_jsx(SearchableDropdown, { label: "\u0631\u062f \u0627\u0644\u0645\u0628\u0644\u063a \u0645\u0646 \u0627\u0644\u062d\u0633\u0627\u0628 \u0627\u0644\u0645\u0627\u0644\u064a:", id: "sales-refund-account", options: accounts.map((acc) => ({ id: acc.id, label: acc.name, subLabel: `\u0627\u0644\u0631\u0635\u064a\u062f: ${acc.balance} ${settings.currencySymbol}` })), selectedId: refundAccountId, onSelect: setRefundAccountId, placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u062d\u0633\u0627\u0628..." })] }), _jsx("div", { children: _jsx("input", { type: "text", placeholder: "\u0633\u0628\u0628 \u0627\u0644\u0625\u0631\u062c\u0627\u0639 (\u0645\u062b\u0644\u0627\u064b: \u062a\u0627\u0644\u0641\u060c \u0645\u0646\u062a\u0647\u064a\u060c \u062e\u0637\u0623 \u0632\u0628\u0648\u0646)...", value: returnNotes, onChange: (e) => setReturnNotes(e.target.value), className: "w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" }) })] }), _jsxs("div", { className: "p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex justify-between gap-2", children: [_jsx("button", { type: "button", onClick: () => setReturnTargetInvoice(null), className: "px-4 py-2 text-xs font-bold text-slate-600 rounded-lg hover:bg-slate-200", children: t("إلغاء") }), _jsx("button", { type: "button", id: "btn-confirm-return", disabled: isSubmittingReturn, onClick: handleConfirmReturn, className: "px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 disabled:opacity-50", children: "\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0625\u0631\u062c\u0627\u0639 \u0648\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646" })] })] }) }))] }));
};
