import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useRef } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, usePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { formatStockBreakdown } from './utils__unitTree.js?v=7.9.4.136-localization';
import { downloadElementAsPDF } from './utils__pdfExport.js?v=7.9.4.136-localization';
import { downloadElementAsImage } from './utils__imageExport.js?v=7.9.4.136-localization';
import { downloadProfessionalTablePDF, downloadProfessionalTableExcel, downloadProfessionalTableImage } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { TransferForm } from './components__inventory__TransferForm.js?v=7.9.4.136-localization';
import { BarcodeCameraModal } from './components__pos__CameraScannerModal.js?v=7.9.4.136-localization';
import { playBeepSound } from './services__audio.js?v=7.9.4.136-localization';
import { ArrowLeftRight, Building2, Download, Search, Image as ImageIcon, FileSpreadsheet, Trash2, Camera, X, } from 'lucide-react';
export const InventoryView = () => {
    const { products, warehouses, settings, getProductStock, adjustStockCount, transferStock, recordDamagedStock, showToast, } = useApp();
    const [activeSubTab, setActiveSubTab] = useState('balance');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState(settings.activeWarehouseId || warehouses[0]?.id || '');
    const [search, setSearch] = useState('');
    const stockTableRef = useRef(null);
    const countTableRef = useRef(null);
    // Stock count state: productId -> { unitId: quantity }
    const [actualCounts, setActualCounts] = useState({});
    const [countNotes, setCountNotes] = useState('');
    const [countSearch, setCountSearch] = useState('');
    const [countScannerOpen, setCountScannerOpen] = useState(false);
    // Transfer state
    const [transferFrom, setTransferFrom] = useState(warehouses[0]?.id || '');
    const [transferTo, setTransferTo] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
    const [transferProductId, setTransferProductId] = useState(products[0]?.id || '');
    const [transferUnitId, setTransferUnitId] = useState(products[0]?.units[0]?.id || '');
    const [transferQty, setTransferQty] = useState(1);
    const [transferNotes, setTransferNotes] = useState('');
    const activeProducts = products.filter((p) => !p.deletedAt);
    const filteredProducts = activeProducts.filter((p) => {
        if (!search.trim())
            return true;
        const q = search.toLowerCase().trim();
        return (p.name.toLowerCase().includes(q) ||
            p.sku?.toLowerCase().includes(q) ||
            p.internalCode?.includes(q));
    });
    const inventoryPager = usePagination(filteredProducts, 50, `${search}|${selectedWarehouseId}|balance`);
    const countFilteredProducts = activeProducts.filter((p) => {
        const q = countSearch.toLowerCase().trim();
        if (!q) return true;
        const barcodeMatch = (p.units || []).some((u) => (u.barcodes || []).some((b) => String(b || '').toLowerCase().includes(q)));
        return String(p.name || '').toLowerCase().includes(q)
            || String(p.shortName || '').toLowerCase().includes(q)
            || String(p.sku || '').toLowerCase().includes(q)
            || String(p.internalCode || '').toLowerCase().includes(q)
            || barcodeMatch;
    });
    const countPager = usePagination(countFilteredProducts, 50, `${selectedWarehouseId}|count|${countSearch}`);
    const unitFactor = (unit) => Math.max(1, Number(unit?.conversionToBase) || 1);
    const countUnitsFor = (prod) => Array.isArray(prod?.units) && prod.units.length ? prod.units : [{ id: prod?.baseUnitId || 'base', name: prod?.baseUnitName || 'حبة', conversionToBase: 1 }];
    const decomposeStock = (prod, baseQty) => {
        const result = {};
        let remaining = Math.max(0, Number(baseQty) || 0);
        const sorted = [...countUnitsFor(prod)].sort((a, b) => unitFactor(b) - unitFactor(a));
        sorted.forEach((unit, index) => {
            const factor = unitFactor(unit);
            if (index === sorted.length - 1 || factor === 1) {
                const qty = factor === 1 ? remaining : remaining / factor;
                result[unit.id] = Math.round((qty + Number.EPSILON) * 1000) / 1000;
                remaining = 0;
            } else {
                const qty = Math.floor((remaining + 1e-9) / factor);
                result[unit.id] = qty;
                remaining -= qty * factor;
            }
        });
        return result;
    };
    const countStateFor = (prod) => {
        const row = actualCounts[prod.id] || {};
        const units = countUnitsFor(prod);
        const entries = units.filter((u) => row[u.id] !== undefined && row[u.id] !== '');
        const hasInput = entries.length > 0;
        const currentStock = getProductStock(prod.id, selectedWarehouseId);
        const unitBreakdown = entries.map((u) => {
            const quantity = Math.max(0, Number(row[u.id]) || 0);
            const conversionToBase = unitFactor(u);
            return { unitId: u.id, unitName: u.name || prod.baseUnitName || 'حبة', quantity, conversionToBase, baseQuantity: quantity * conversionToBase };
        });
        const actualBase = hasInput ? unitBreakdown.reduce((sum, item) => sum + item.baseQuantity, 0) : currentStock;
        return { row, units, hasInput, currentStock, actualBase, unitBreakdown, placeholders: decomposeStock(prod, currentStock) };
    };
    const setCountUnit = (productId, unitId, raw) => {
        setActualCounts((prev) => {
            const next = { ...prev };
            const row = { ...(next[productId] || {}) };
            if (raw === '') delete row[unitId];
            else row[unitId] = Math.max(0, Number(raw) || 0);
            if (Object.keys(row).length) next[productId] = row;
            else delete next[productId];
            return next;
        });
    };

    const handleCountBarcodeDetected = (code) => {
        const clean = String(code || '').trim();
        if (!clean) return;
        const product = activeProducts.find((p) =>
            String(p.sku || '') === clean
            || String(p.internalCode || '') === clean
            || (p.units || []).some((u) => (u.barcodes || []).some((b) => String(b || '') === clean))
        );
        playBeepSound(settings.scannerBeepEnabled);
        setCountScannerOpen(false);
        if (!product) {
            setCountSearch(clean);
            showToast(`لم يتم العثور على صنف بالباركود ${clean}`, 'warning');
            return;
        }
        setCountSearch(product.name || clean);
        showToast(`تم العثور على: ${product.name}`, 'success');
        window.requestAnimationFrame(() => {
            const selector = `[data-count-product-id="${String(product.id).replace(/"/g, '\"')}"]`;
            document.querySelector(selector)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        });
    };

    const handleApplyStockCount = async () => {
        const adjustments = activeProducts.map((prod) => {
            const state = countStateFor(prod);
            if (!state.hasInput) return null;
            return { productId: prod.id, actualQty: state.actualBase, unitBreakdown: state.unitBreakdown };
        }).filter(Boolean);
        if (adjustments.length === 0) {
            showToast('يرجى إدخال الجرد الفعلي لصنف واحد على الأقل', 'warning');
            return;
        }
        await adjustStockCount(selectedWarehouseId, adjustments, countNotes || 'تسوية جرد دوري');
        setActualCounts({});
        setCountNotes('');
        setActiveSubTab('balance');
    };
    const handleApplyTransfer = async (e) => {
        e.preventDefault();
        if (transferFrom === transferTo) {
            showToast('يجب اختيار مخزن مستلم مختلف عن المخزن المحول منه', 'error');
            return;
        }
        const prod = products.find((p) => p.id === transferProductId);
        if (!prod)
            return;
        const unit = prod.units.find((u) => u.id === transferUnitId) || prod.units[0];
        if (!unit) {
            showToast('تعذر تحديد وحدة الصنف للتحويل', 'error');
            return;
        }
        await transferStock(transferProductId, transferFrom, transferTo, unit, transferQty, transferNotes);
        setTransferQty(1);
        setTransferNotes('');
        setActiveSubTab('balance');
    };
    const getStockExportData = () => {
        const warehouseName = warehouses.find((w) => w.id === selectedWarehouseId)?.name || 'المخزن';
        const headers = ['الصنف', 'الكود', 'الوحدة الأساسية', 'الرصيد الفعلي', 'تفكيك الوحدات', 'التكلفة', 'قيمة المخزون'];
        const rows = filteredProducts.map((p) => {
            const stock = getProductStock(p.id, selectedWarehouseId);
            return [
                p.name,
                p.sku || p.internalCode || '',
                p.baseUnitName,
                stock,
                formatStockBreakdown(stock, p.units),
                Number(p.costPrice || 0),
                Number(stock || 0) * Number(p.costPrice || 0),
            ];
        });
        return { warehouseName, headers, rows };
    };
    const handleExportStockExcel = async () => {
        const { warehouseName, headers, rows } = getStockExportData();
        await downloadProfessionalTableExcel({
            title: `كشف أرصدة المخزون - ${warehouseName}`,
            subtitle: `الفرع: ${settings.activeBranchName || 'الفرع الرئيسي'}`,
            headers, rows, settings,
            filename: `أرصدة_المخزون_${warehouseName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
        });
        showToast('تم إنشاء ملف Excel احترافي بالترويسة والشعار', 'success');
    };
    const getCountExportData = () => {
        const warehouseName = warehouses.find((w) => w.id === selectedWarehouseId)?.name || 'المخزن';
        const headers = ['الصنف', 'الرصيد الدفتري', 'الجرد حسب الوحدات', 'الإجمالي بالوحدة الأساسية', 'الفرق', 'قيمة الفرق'];
        const rows = activeProducts.map((prod) => {
            const state = countStateFor(prod);
            const actualText = state.hasInput
                ? state.unitBreakdown.map((u) => `${u.quantity} ${u.unitName}`).join(' + ')
                : formatStockBreakdown(state.currentStock, prod.units, prod.baseUnitName);
            const diff = state.actualBase - state.currentStock;
            return [prod.name, formatStockBreakdown(state.currentStock, prod.units, prod.baseUnitName), actualText, state.actualBase, diff, diff * Number(prod.costPrice || 0)];
        });
        return { warehouseName, headers, rows };
    };
    const handleExportCountPDF = async () => {
        const { warehouseName, headers, rows } = getCountExportData();
        await downloadProfessionalTablePDF({ title:`تقرير الجرد الفعلي - ${warehouseName}`, subtitle:countNotes || 'الجرد والتسوية', headers, rows, settings, orientation:'landscape', filename:`تقرير_الجرد_الفعلي_${new Date().toISOString().slice(0,10)}.pdf` });
        showToast('تم تصدير كشف الجرد كاملاً كـ PDF', 'success');
    };
    const handleExportCountImage = async () => {
        const { warehouseName, headers, rows } = getCountExportData();
        await downloadProfessionalTableImage({ title:`تقرير الجرد الفعلي - ${warehouseName}`, subtitle:countNotes || 'الجرد والتسوية', headers, rows, settings, orientation:'landscape', filename:`تقرير_الجرد_الفعلي_${new Date().toISOString().slice(0,10)}.png` });
        showToast('تم تصدير كشف الجرد كاملاً كصورة', 'success');
    };
    const handleExportStockPDF = async () => {
        const { warehouseName, headers, rows } = getStockExportData();
        await downloadProfessionalTablePDF({
            title: `كشف أرصدة المخزون - ${warehouseName}`,
            subtitle: `الفرع: ${settings.activeBranchName || 'الفرع الرئيسي'}`,
            headers, rows, settings, orientation: 'landscape',
            filename: `أرصدة_المخزون_${warehouseName}_${new Date().toISOString().slice(0, 10)}.pdf`,
        });
        showToast('تم إنشاء ملف PDF احترافي بالترويسة والشعار', 'success');
    };
    return (_jsxs("div", { id: "inventory-screen", className: "p-4 sm:p-6 space-y-4 max-w-7xl mx-auto text-right select-none", children: [_jsxs("div", { className: "inventory-heading-row flex flex-col sm:flex-row sm:items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-black text-slate-900 dark:text-white", children: "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0648\u0627\u0644\u062c\u0631\u062f \u0648\u0627\u0644\u062a\u062d\u0648\u064a\u0644\u0627\u062a" }), _jsx("p", { className: "text-xs text-slate-500 mt-0.5", children: "\u0645\u062a\u0627\u0628\u0639\u0629 \u062f\u0642\u064a\u0642\u0629 \u0644\u0644\u0623\u0631\u0635\u062f\u0629\u060c \u062c\u0631\u062f \u0641\u0639\u0644\u064a \u0648\u062a\u0633\u0648\u064a\u0629 \u0641\u0631\u0648\u0642\u0627\u062a\u060c \u0648\u062a\u062d\u0648\u064a\u0644\u0627\u062a \u0628\u064a\u0646 \u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u062e\u0627\u0632\u0646" })] }), _jsxs("div", { className: "inventory-toolbar flex items-center gap-2", children: [_jsxs("div", { className: "inventory-tabs flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold", children: [_jsx("button", { onClick: () => setActiveSubTab('balance'), className: `inventory-tab-button px-3 py-1.5 rounded-lg transition ${activeSubTab === 'balance' ? 'bg-white dark:bg-slate-900 text-violet-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`, children: "\u0623\u0631\u0635\u062f\u0629 \u0627\u0644\u0645\u062e\u0632\u0648\u0646" }), _jsx("button", { onClick: () => setActiveSubTab('count'), className: `inventory-tab-button px-3 py-1.5 rounded-lg transition ${activeSubTab === 'count' ? 'bg-white dark:bg-slate-900 text-violet-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`, children: "\u0627\u0644\u062c\u0631\u062f \u0648\u0627\u0644\u062a\u0633\u0648\u064a\u0629" }), _jsx("button", { onClick: () => setActiveSubTab('transfer'), className: `inventory-tab-button px-3 py-1.5 rounded-lg transition ${activeSubTab === 'transfer' ? 'bg-white dark:bg-slate-900 text-violet-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'}`, children: "\u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0628\u064a\u0646 \u0627\u0644\u0645\u062e\u0627\u0632\u0646" })] }), activeSubTab === 'balance' && (_jsxs("div", { className: "inventory-export-actions flex items-center gap-1.5 flex-wrap", children: [_jsxs("button", { onClick: handleExportStockPDF, className: "inventory-export-button flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0640 PDF", children: [_jsx(Download, { className: "w-3.5 h-3.5 text-rose-600" }), _jsx("span", { children: "PDF" })] }), _jsxs("button", { onClick: async () => {
                                            if (!stockTableRef.current)
                                                return;
                                            await downloadElementAsImage('stock-balance-table-card', `أرصدة_المخزون_${new Date().toISOString().slice(0, 10)}.png`);
                                            showToast('تم تصدير كشف المخزون كصورة بنجاح', 'success');
                                        }, className: "inventory-export-button flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0635\u0648\u0631\u0629", children: [_jsx(ImageIcon, { className: "w-3.5 h-3.5 text-blue-600" }), _jsx("span", { children: t("صورة") })] }), _jsxs("button", { onClick: handleExportStockExcel, className: "inventory-export-button flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", children: [_jsx(FileSpreadsheet, { className: "w-3.5 h-3.5 text-violet-600" }), _jsx("span", { children: "Excel" })] })] }))] })] }), activeSubTab === 'balance' && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Building2, { className: "w-4 h-4 text-violet-600" }), _jsx("span", { className: "text-xs font-bold", children: "\u0627\u0644\u0645\u062e\u0632\u0646 \u0627\u0644\u062d\u0627\u0644\u064a:" }), _jsx("div", { className: "min-w-[210px]", children: _jsx(SearchableDropdown, { id: "inventory-warehouse", options: warehouses.map((w) => ({ id: w.id, label: w.name, subLabel: w.code || undefined })), selectedId: selectedWarehouseId, onSelect: setSelectedWarehouseId, placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u0645\u062e\u0632\u0646..." }) })] }), _jsxs("div", { className: "relative min-w-[200px]", children: [_jsx(Search, { className: "absolute right-3 top-2.5 w-4 h-4 text-slate-400" }), _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "\u0628\u062d\u062b \u0641\u064a \u0627\u0644\u0623\u0635\u0646\u0627\u0641...", className: "w-full pr-9 pl-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" })] })] }), _jsx("div", { id: "stock-balance-table-card", ref: stockTableRef, className: "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden", children: _jsx("div", { className: "overflow-x-auto max-w-full slim-scrollbar", children: _jsxs("table", { className: "w-full text-xs text-right whitespace-nowrap min-w-[720px]", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 font-semibold", children: [_jsx("th", { className: "p-3", children: t("الصنف") }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u0643\u0648\u062f" }), _jsx("th", { className: "p-3 text-center", children: "\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a (\u0628\u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629)" }), _jsx("th", { className: "p-3", children: "\u062a\u0641\u0643\u064a\u0643 \u0627\u0644\u0631\u0635\u064a\u062f \u0628\u0634\u062c\u0631\u0629 \u0627\u0644\u0648\u062d\u062f\u0627\u062a" }), _jsx("th", { className: "p-3 text-left", children: "\u0627\u0644\u062a\u0643\u0644\u0641\u0629 \u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a\u0629 \u0644\u0644\u0631\u0635\u064a\u062f" }), _jsx("th", { className: "p-3 text-center", children: "\u062a\u0627\u0644\u0641" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: inventoryPager.pageItems.map((prod) => {
                                            const stock = getProductStock(prod.id, selectedWarehouseId);
                                            const totalVal = stock * (prod.costPrice || 0);
                                            return (_jsxs("tr", { className: "hover:bg-slate-50/50", children: [_jsx("td", { className: "p-3 font-bold text-slate-900 dark:text-white", children: prod.name }), _jsx("td", { className: "p-3 font-mono text-slate-400", children: prod.sku || prod.internalCode || '-' }), _jsx("td", { className: "p-3 text-center", children: _jsxs("span", { className: `px-2 py-0.5 rounded font-mono font-bold text-xs ${stock <= (prod.reorderPoint || 0)
                                                                ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                                                : 'bg-violet-50 dark:bg-violet-950 text-violet-800 dark:text-violet-300'}`, children: formatStockBreakdown(stock, prod.units, prod.baseUnitName) }) }), _jsx("td", { className: "p-3 text-slate-600 dark:text-slate-300 font-medium", children: formatStockBreakdown(stock, prod.units) }), _jsxs("td", { className: "p-3 text-left font-mono font-bold text-slate-900 dark:text-white", children: [totalVal.toFixed(2), " ", settings.currencySymbol] }), _jsx("td", { className: "p-3 text-center", children: _jsxs("button", { type: "button", onClick: async () => { const raw = window.prompt("\u0643\u0645\u064a\u0629 \u0627\u0644\u062a\u0627\u0644\u0641 \u0628\u0627\u0644\u0648\u062d\u062f\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629", "1"); if (raw === null) return; const qty = parseFloat(raw); if (!(qty > 0)) { showToast("\u0623\u062f\u062e\u0644 \u0643\u0645\u064a\u0629 \u0635\u062d\u064a\u062d\u0629", "warning"); return; } await recordDamagedStock(prod.id, selectedWarehouseId, qty); }, className: "inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-bold text-[10px]", children: [_jsx(Trash2, { className: "w-3.5 h-3.5" }), "\u062a\u0627\u0644\u0641"] }) })] }, prod.id));
                                        }) })] }) }) })] })), activeSubTab === 'balance' && (_jsx(Pagination, { pager: inventoryPager })), activeSubTab === 'count' && (_jsxs("div", { className: "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062c\u0631\u062f \u0627\u0644\u0641\u0639\u0644\u064a \u0648\u0645\u0637\u0627\u0628\u0642\u0629 \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062a" }), _jsx("p", { className: "text-xs text-slate-500", children: "\u0623\u062f\u062e\u0644 \u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0641\u0639\u0644\u064a\u0629 \u0627\u0644\u0645\u0648\u062c\u0648\u062f\u0629 \u0639\u0644\u0649 \u0627\u0644\u0631\u0641. \u0633\u064a\u062a\u0645 \u0627\u062d\u062a\u0633\u0627\u0628 \u0627\u0644\u0639\u062c\u0632 \u0648\u0627\u0644\u0641\u0627\u0626\u0636 \u0648\u062a\u0633\u0648\u064a\u0629 \u0627\u0644\u0642\u064a\u0648\u062f \u0641\u0648\u0631\u0627\u064b." })] }), _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("button", { type: "button", onClick: handleExportCountPDF, className: "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-xs font-semibold", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0640 PDF", children: [_jsx(Download, { className: "w-3.5 h-3.5 text-rose-600" }), _jsx("span", { children: "PDF" })] }), _jsxs("button", { type: "button", onClick: handleExportCountImage, className: "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-slate-700 dark:text-slate-300 text-xs font-semibold", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0635\u0648\u0631\u0629", children: [_jsx(ImageIcon, { className: "w-3.5 h-3.5 text-blue-600" }), _jsx("span", { children: t("صورة") })] }), _jsxs("div", { className: "flex items-center gap-1.5 mr-2", children: [_jsx("span", { className: "text-xs font-semibold", children: "\u0645\u062e\u0632\u0646 \u0627\u0644\u062c\u0631\u062f:" }), _jsx("div", { className: "min-w-[190px]", children: _jsx(SearchableDropdown, { id: "count-warehouse", options: warehouses.map((w) => ({ id: w.id, label: w.name, subLabel: w.code || undefined })), selectedId: selectedWarehouseId, onSelect: setSelectedWarehouseId, placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u0645\u062e\u0632\u0646..." }) })] })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "relative flex-1", children: [_jsx(Search, { className: "absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" }), _jsx("input", { type: "search", value: countSearch, onChange: (e) => setCountSearch(e.target.value), placeholder: "ابحث باسم الصنف أو الكود أو الباركود...", className: "w-full h-11 pr-10 pl-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold focus:outline-none focus:border-violet-500" }), countSearch ? _jsx("button", { type: "button", onClick: () => setCountSearch(''), className: "absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700", title: "مسح البحث", children: _jsx(X, { className: "w-3.5 h-3.5" }) }) : null] }), _jsxs("button", { type: "button", onClick: () => setCountScannerOpen(true), className: "h-11 px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black inline-flex items-center gap-1.5 shadow-sm active:scale-[.98] transition-transform", children: [_jsx(Camera, { className: "w-4 h-4" }), _jsx("span", { className: "hidden sm:inline", children: "مسح باركود" })] })] }), _jsx("div", { id: "stock-count-table-card", ref: countTableRef, className: "overflow-x-auto max-w-full slim-scrollbar border rounded-xl", children: _jsxs("table", { className: "w-full text-xs text-right min-w-[920px]", children: [_jsx("thead", { children: _jsxs("tr", { className: "bg-slate-50 dark:bg-slate-800/60 border-b text-slate-500", children: [_jsx("th", { className: "p-2.5", children: t("الصنف") }), _jsx("th", { className: "p-2.5 text-center", children: "\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u062f\u0641\u062a\u0631\u064a \u0627\u0644\u0645\u0633\u062c\u0644" }), _jsx("th", { className: "p-2.5 text-center", children: "\u0627\u0644\u062c\u0631\u062f \u0627\u0644\u0641\u0639\u0644\u064a \u062d\u0633\u0628 \u062c\u0645\u064a\u0639 \u0627\u0644\u0648\u062d\u062f\u0627\u062a" }), _jsx("th", { className: "p-2.5 text-center", children: "\u0627\u0644\u0641\u0631\u0642 (\u0639\u062c\u0632 / \u0641\u0627\u0626\u0636)" }), _jsx("th", { className: "p-2.5 text-left", children: "\u0642\u064a\u0645\u0629 \u0627\u0644\u0641\u0631\u0642 \u0627\u0644\u0645\u0627\u0644\u064a\u0629" })] }) }), _jsx("tbody", { className: "divide-y", children: countPager.pageItems.map((prod) => {
                                        const state = countStateFor(prod);
                                        const diff = state.actualBase - state.currentStock;
                                        const diffVal = diff * (prod.costPrice || 0);
                                        return (_jsxs("tr", { "data-count-product-id": prod.id, className: "hover:bg-slate-50/50 align-top", children: [
                                            _jsx("td", { className: "p-2.5 font-medium whitespace-nowrap", children: prod.name }),
                                            _jsx("td", { className: "p-2.5 text-center font-mono font-bold text-slate-600 min-w-[150px]", children: formatStockBreakdown(state.currentStock, prod.units, prod.baseUnitName) }),
                                            _jsx("td", { className: "p-2.5 min-w-[430px]", children: _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2", children: state.units.map((unit) => _jsxs("label", { className: "block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 shadow-xs focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100", children: [
                                                _jsxs("div", { className: "flex items-center justify-between gap-1 mb-1.5", children: [_jsx("span", { className: "text-[11px] font-black text-slate-700 dark:text-slate-200 truncate", title: unit.name, children: unit.name || prod.baseUnitName || "حبة" }), _jsx("span", { className: "text-[8px] font-bold text-slate-400 whitespace-nowrap", children: unitFactor(unit) === 1 ? "أساسية" : `×${unitFactor(unit)}` })] }),
                                                _jsx("input", { type: "number", min: "0", step: "any", inputMode: "decimal", placeholder: String(state.placeholders[unit.id] ?? 0), value: state.row[unit.id] ?? '', onChange: (e) => setCountUnit(prod.id, unit.id, e.target.value), className: "w-full h-10 px-2 border border-slate-200 dark:border-slate-700 rounded-lg text-center text-sm font-mono font-black bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-violet-500" }),
                                                _jsx("div", { className: "mt-1 text-[8px] text-slate-400 text-center", children: unitFactor(unit) === 1 ? `الكمية بـ ${unit.name || prod.baseUnitName || 'حبة'}` : `${unit.name || t("الوحدة")} = ${unitFactor(unit)} ${prod.baseUnitName || t("وحدة أساسية")}` })
                                            ] }, unit.id)) }) }),
                                            _jsx("td", { className: "p-2.5 text-center font-mono font-bold", children: diff === 0 ? (_jsx("span", { className: "text-slate-400", children: "مطابق" })) : diff > 0 ? (_jsxs("span", { className: "text-violet-600", children: ["+", Math.round(diff * 1000) / 1000, " (فائض)"] })) : (_jsxs("span", { className: "text-rose-600", children: [Math.round(diff * 1000) / 1000, " (عجز)"] })) }),
                                            _jsx("td", { className: "p-2.5 text-left font-mono font-bold", children: diffVal !== 0 ? (_jsxs("span", { className: diffVal > 0 ? 'text-violet-600' : 'text-rose-600', children: [diffVal.toFixed(2), " ", settings.currencySymbol] })) : ('-') })
                                        ] }, prod.id));
                                    }) })] }) }), _jsxs("div", { className: "flex flex-col sm:flex-row items-center justify-between gap-3 pt-3", children: [_jsx("input", { type: "text", placeholder: "\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u062c\u0631\u062f \u0627\u0644\u062f\u0648\u0631\u064a (\u0645\u062b\u0644\u0627\u064b: \u062c\u0631\u062f \u0646\u0647\u0627\u064a\u0629 \u0627\u0644\u0634\u0647\u0631)...", value: countNotes, onChange: (e) => setCountNotes(e.target.value), className: "w-full sm:w-96 px-3 py-2 text-xs border rounded-xl" }), _jsx("button", { onClick: handleApplyStockCount, className: "px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-md transition", children: "\u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062c\u0631\u062f \u0648\u062a\u0633\u0648\u064a\u0629 \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062a \u0622\u0644\u064a\u0627\u064b" })] })] })), activeSubTab === 'count' && (_jsx(Pagination, { pager: countPager })), activeSubTab === 'transfer' && (_jsx(TransferForm, {})), _jsx(BarcodeCameraModal, { open: countScannerOpen, onClose: () => setCountScannerOpen(false), onDetected: handleCountBarcodeDetected, title: "بحث بالباركود في الجرد", autoClose: true })] }));
};
