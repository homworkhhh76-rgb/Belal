import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState } from 'react';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import { LayoutGrid, Plus, Users, Receipt, ArrowRightLeft, Merge, Sparkles, Edit2, Trash2, XCircle, CheckCircle2, Coffee, DollarSign, Utensils, FolderPlus, } from 'lucide-react';
const STATUS_CONFIG = {
    available: {
        label: 'فارغة',
        bg: 'bg-violet-50/70 dark:bg-violet-950/30',
        text: 'text-violet-700 dark:text-violet-400',
        border: 'border-violet-200 dark:border-violet-800',
        dot: 'bg-violet-500',
    },
    occupied: {
        label: 'مشغولة',
        bg: 'bg-blue-50/70 dark:bg-blue-950/30',
        text: 'text-blue-700 dark:text-blue-400',
        border: 'border-blue-200 dark:border-blue-800',
        dot: 'bg-blue-500',
    },
    reserved: {
        label: 'محجوزة',
        bg: 'bg-purple-50/70 dark:bg-purple-950/30',
        text: 'text-purple-700 dark:text-purple-400',
        border: 'border-purple-200 dark:border-purple-800',
        dot: 'bg-purple-500',
    },
    new_order: {
        label: 'طلب جديد',
        bg: 'bg-amber-50/80 dark:bg-amber-950/30',
        text: 'text-amber-700 dark:text-amber-400',
        border: 'border-amber-300 dark:border-amber-700',
        dot: 'bg-amber-500 animate-ping',
    },
    preparing: {
        label: 'قيد التحضير',
        bg: 'bg-orange-50/80 dark:bg-orange-950/30',
        text: 'text-orange-700 dark:text-orange-400',
        border: 'border-orange-300 dark:border-orange-700',
        dot: 'bg-orange-500 animate-pulse',
    },
    partially_ready: {
        label: 'جاهز جزئياً',
        bg: 'bg-yellow-50/80 dark:bg-yellow-950/30',
        text: 'text-yellow-700 dark:text-yellow-400',
        border: 'border-yellow-300 dark:border-yellow-700',
        dot: 'bg-yellow-500',
    },
    ready: {
        label: 'جاهز بالكامل 🔥',
        bg: 'bg-violet-100/80 dark:bg-violet-900/40',
        text: 'text-violet-800 dark:text-violet-300',
        border: 'border-violet-400 dark:border-violet-600',
        dot: 'bg-violet-600 animate-bounce',
    },
    waiting_payment: {
        label: 'طلب الحساب 💳',
        bg: 'bg-rose-50/80 dark:bg-rose-950/30',
        text: 'text-rose-700 dark:text-rose-400',
        border: 'border-rose-300 dark:border-rose-700',
        dot: 'bg-rose-500 animate-pulse',
    },
    cleaning: {
        label: 'بحاجة تنظيف 🧹',
        bg: 'bg-slate-100 dark:bg-slate-800',
        text: 'text-slate-600 dark:text-slate-300',
        border: 'border-dashed border-slate-300 dark:border-slate-600',
        dot: 'bg-slate-400',
    },
};
export const RestaurantTablesView = () => {
    const { sections, tables, orders, addTable, updateTable, deleteTable, deleteRestaurantOrder, updateTableStatus, transferTableOrder, mergeTableOrders, requestBillForTable, recallOrderToPOS, addSection, deleteSection, } = useRestaurant();
    const { setActiveTab, showToast, settings } = useApp();
    const [selectedSectionId, setSelectedSectionId] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    // Modals
    const [showAddTableModal, setShowAddTableModal] = useState(false);
    const [editingTable, setEditingTable] = useState(null);
    const [showTransferModal, setShowTransferModal] = useState(null);
    const [transferTargetId, setTransferTargetId] = useState('');
    const [showMergeModal, setShowMergeModal] = useState(null);
    const [mergeTargetId, setMergeTargetId] = useState('');
    const [showSectionsModal, setShowSectionsModal] = useState(false);
    const [newSectionName, setNewSectionName] = useState('');
    const [ticketModalOrder, setTicketModalOrder] = useState(null);
    // Table Form State
    const [tableNumber, setTableNumber] = useState('');
    const [tableName, setTableName] = useState('');
    const [tableSeats, setTableSeats] = useState(4);
    const [tableSectionId, setTableSectionId] = useState(sections[0]?.id || '');
    const filteredTables = tables.filter((tbl) => {
        if (selectedSectionId !== 'all' && tbl.sectionId !== selectedSectionId)
            return false;
        if (filterStatus !== 'all' && tbl.status !== filterStatus)
            return false;
        return true;
    });
    const availableCount = tables.filter((t) => t.status === 'available').length;
    const occupiedCount = tables.filter((t) => t.status !== 'available' && t.status !== 'cleaning' && t.status !== 'reserved').length;
    const waitingPaymentCount = tables.filter((t) => t.status === 'waiting_payment').length;
    const handleOpenAdd = () => {
        setEditingTable(null);
        setTableNumber(`T-${tables.length + 1}`);
        setTableName('');
        setTableSeats(4);
        setTableSectionId(sections[0]?.id || '');
        setShowAddTableModal(true);
    };
    const handleOpenEdit = (tbl) => {
        setEditingTable(tbl);
        setTableNumber(tbl.tableNumber);
        setTableName(tbl.name || '');
        setTableSeats(tbl.seats);
        setTableSectionId(tbl.sectionId);
        setShowAddTableModal(true);
    };
    const handleSaveTable = async (e) => {
        e.preventDefault();
        if (!tableNumber.trim()) {
            showToast('يرجى تحديد رقم أو كود الطاولة', 'error');
            return;
        }
        const sec = sections.find((s) => s.id === tableSectionId);
        const data = {
            tableNumber,
            name: tableName || undefined,
            seats: Number(tableSeats) || 4,
            sectionId: tableSectionId,
            sectionName: sec?.name || 'الصالة الرئيسية',
        };
        if (editingTable) {
            await updateTable(editingTable.id, data);
            showToast('تم تحديث بيانات الطاولة', 'success');
        }
        else {
            await addTable(data);
            showToast('تمت إضافة الطاولة بنجاح', 'success');
        }
        setShowAddTableModal(false);
    };
    const handleTransferSubmit = async (e) => {
        e.preventDefault();
        if (!showTransferModal || !transferTargetId)
            return;
        await transferTableOrder(showTransferModal.id, transferTargetId);
        setShowTransferModal(null);
        setTransferTargetId('');
    };
    const handleMergeSubmit = async (e) => {
        e.preventDefault();
        if (!showMergeModal || !mergeTargetId)
            return;
        await mergeTableOrders(mergeTargetId, showMergeModal.id);
        setShowMergeModal(null);
        setMergeTargetId('');
    };
    const handleAddSection = async (e) => {
        e.preventDefault();
        if (!newSectionName.trim())
            return;
        await addSection({ name: newSectionName });
        setNewSectionName('');
        showToast('تمت إضافة الصالة بنجاح', 'success');
    };
    const handleDeleteCurrentOrder = async (tbl, currentOrder) => {
        if (!currentOrder?.id) return;
        const ok = window.confirm(`حذف الطلب الحالي للطاولة ${tbl.tableNumber} نهائياً وإفراغ الطاولة؟`);
        if (!ok) return;
        await deleteRestaurantOrder(currentOrder.id);
        showToast('تم حذف الطلب وإفراغ الطاولة ومزامنة الحذف', 'success');
    };
    const handleDeleteTable = async (tbl) => {
        const hasOrder = !!tbl.currentOrderId;
        const msg = hasOrder
            ? `حذف الطاولة ${tbl.tableNumber} نهائياً؟ سيتم أيضاً حذف طلبها الحالي ومزامنة الحذف على الأجهزة.`
            : `حذف الطاولة ${tbl.tableNumber} نهائياً ومزامنة الحذف على الأجهزة؟`;
        if (!window.confirm(msg)) return;
        await deleteTable(tbl.id);
        showToast('تم حذف الطاولة ومزامنة الحذف', 'success');
    };
    return (_jsxs("div", { className: "p-4 sm:p-6 space-y-5 max-w-7xl mx-auto text-right select-none", children: [_jsxs("div", { className: "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsxs("h1", { className: "text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(LayoutGrid, { className: "w-6 h-6 text-amber-600" }), _jsx("span", { children: "\u0625\u062F\u0627\u0631\u0629 \u0635\u0627\u0644\u0627\u062A \u0648\u0637\u0627\u0648\u0644\u0627\u062A \u0627\u0644\u0645\u0637\u0639\u0645" })] }), _jsx("p", { className: "text-xs sm:text-sm text-slate-500 mt-0.5", children: "\u0645\u062A\u0627\u0628\u0639\u0629 \u062D\u0627\u0644\u0629 \u0627\u0644\u0637\u0627\u0648\u0644\u0627\u062A \u0644\u062D\u0638\u064A\u0627\u064B\u060C \u0641\u062A\u062D \u0627\u0644\u0637\u0644\u0628\u0627\u062A\u060C \u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629 \u0644\u0644\u0643\u0627\u0634\u064A\u0631 \u0648\u0625\u0635\u062F\u0627\u0631 \u062A\u0630\u0627\u0643\u0631 \u0627\u0644\u0645\u0637\u0628\u062E" })] }), _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("button", { onClick: () => setShowSectionsModal(true), className: "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 shadow-xs", children: [_jsx(FolderPlus, { className: "w-4 h-4 text-amber-600" }), _jsx("span", { children: "\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0635\u0627\u0644\u0627\u062A" })] }), _jsxs("button", { onClick: () => setActiveTab('restaurant_waiter'), className: "flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 transition", children: [_jsx(Utensils, { className: "w-4 h-4" }), _jsx("span", { children: t("واجهة الجرسون") })] }), _jsxs("button", { onClick: handleOpenAdd, className: "flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition", children: [_jsx(Plus, { className: "w-4 h-4" }), _jsx("span", { children: "\u0625\u0636\u0627\u0641\u0629 \u0637\u0627\u0648\u0644\u0629 \u062C\u062F\u064A\u062F\u0629" })] })] })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-4 gap-3", children: [_jsxs("div", { className: "p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs text-slate-500 font-medium", children: "\u0637\u0627\u0648\u0644\u0627\u062A \u0641\u0627\u0631\u063A\u0629" }), _jsx("div", { className: "text-xl font-black text-violet-600 mt-0.5", children: availableCount })] }), _jsx("div", { className: "w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-600 flex items-center justify-center font-black", children: _jsx(CheckCircle2, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs text-slate-500 font-medium", children: "\u0637\u0627\u0648\u0644\u0627\u062A \u0645\u0634\u063A\u0648\u0644\u0629" }), _jsx("div", { className: "text-xl font-black text-blue-600 mt-0.5", children: occupiedCount })] }), _jsx("div", { className: "w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center font-black", children: _jsx(Users, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs text-slate-500 font-medium", children: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628" }), _jsx("div", { className: "text-xl font-black text-rose-600 mt-0.5", children: waitingPaymentCount })] }), _jsx("div", { className: "w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center font-black", children: _jsx(DollarSign, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs text-slate-500 font-medium", children: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0637\u0627\u0648\u0644\u0627\u062A" }), _jsx("div", { className: "text-xl font-black text-slate-900 dark:text-white mt-0.5", children: tables.length })] }), _jsx("div", { className: "w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-black", children: _jsx(Coffee, { className: "w-5 h-5" }) })] })] }), _jsxs("div", { className: "flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800", children: [_jsxs("div", { className: "flex items-center gap-1.5 overflow-x-auto w-full md:w-auto slim-scrollbar pb-1 md:pb-0", children: [_jsxs("button", { onClick: () => setSelectedSectionId('all'), className: `px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${selectedSectionId === 'all'
                                    ? 'bg-amber-600 text-white shadow-xs'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`, children: ["\u0643\u0627\u0641\u0629 \u0627\u0644\u0635\u0627\u0644\u0627\u062A (", tables.length, ")"] }), sections.map((sec) => (_jsxs("button", { onClick: () => setSelectedSectionId(sec.id), className: `px-3 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${selectedSectionId === sec.id
                                    ? 'bg-amber-600 text-white shadow-xs'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`, children: [sec.name, " (", tables.filter((t) => t.sectionId === sec.id).length, ")"] }, sec.id)))] }), _jsxs("div", { className: "flex items-center gap-2 w-full md:w-auto", children: [_jsx("span", { className: "text-xs text-slate-500 font-semibold whitespace-nowrap", children: t("الحالة:") }), _jsxs("select", { value: filterStatus, onChange: (e) => setFilterStatus(e.target.value), className: "w-full md:w-44 p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold", children: [_jsxs("option", { value: "all", children: ["\u0627\u0644\u0643\u0644 (", tables.length, ")"] }), _jsxs("option", { value: "available", children: ["\u0641\u0627\u0631\u063A\u0629 (", availableCount, ")"] }), _jsxs("option", { value: "occupied", children: ["\u0645\u0634\u063A\u0648\u0644\u0629 (", occupiedCount, ")"] }), _jsx("option", { value: "new_order", children: "\u0637\u0644\u0628 \u062C\u062F\u064A\u062F" }), _jsx("option", { value: "preparing", children: "\u0642\u064A\u062F \u0627\u0644\u062A\u062D\u0636\u064A\u0631" }), _jsx("option", { value: "ready", children: "\u062C\u0627\u0647\u0632 \u0644\u0644\u0627\u0633\u062A\u0644\u0627\u0645" }), _jsxs("option", { value: "waiting_payment", children: ["\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062D\u0633\u0627\u0628 (", waitingPaymentCount, ")"] }), _jsx("option", { value: "cleaning", children: "\u0628\u062D\u0627\u062C\u0629 \u062A\u0646\u0638\u064A\u0641" }), _jsx("option", { value: "reserved", children: "\u0645\u062D\u062C\u0648\u0632\u0629" })] })] })] }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4", children: filteredTables.map((tbl) => {
                    const cfg = STATUS_CONFIG[tbl.status] || STATUS_CONFIG.available;
                    const currentOrder = tbl.currentOrderId ? orders.find((o) => o.id === tbl.currentOrderId) : null;
                    return (_jsxs("div", { className: `rounded-2xl border ${cfg.border} ${cfg.bg} p-4 shadow-xs flex flex-col justify-between space-y-3 transition hover:shadow-md relative overflow-hidden`, children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xs flex flex-col items-center justify-center", children: [_jsx("span", { className: "text-sm font-black text-slate-900 dark:text-white leading-none", children: tbl.tableNumber }), _jsxs("span", { className: "text-[10px] text-slate-500 font-bold mt-0.5 flex items-center gap-0.5", children: [_jsx(Users, { className: "w-3 h-3" }), " ", tbl.seats] })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: `w-2 h-2 rounded-full ${cfg.dot}` }), _jsx("span", { className: `text-xs font-black ${cfg.text}`, children: cfg.label })] }), _jsx("span", { className: "text-[11px] text-slate-500 font-semibold block mt-0.5", children: tbl.sectionName || 'الصالة العامة' })] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("button", { onClick: () => handleOpenEdit(tbl), className: "p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/60 dark:hover:bg-slate-800", title: "\u062A\u0639\u062F\u064A\u0644 \u0627\u0644\u0637\u0627\u0648\u0644\u0629", children: _jsx(Edit2, { className: "w-4 h-4" }) }), currentOrder && (_jsx("button", { onClick: () => handleDeleteCurrentOrder(tbl, currentOrder), className: "p-1 rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50", title: "\u062D\u0630\u0641 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u062D\u0627\u0644\u064A \u0648\u0625\u0641\u0631\u0627\u063A \u0627\u0644\u0637\u0627\u0648\u0644\u0629", children: _jsx(XCircle, { className: "w-4 h-4" }) })), _jsx("button", { onClick: () => handleDeleteTable(tbl), className: "p-1 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50", title: "\u062D\u0630\u0641 \u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u0646\u0647\u0627\u0626\u064A\u0627\u064B", children: _jsx(Trash2, { className: "w-4 h-4" }) })] })] }), _jsx("div", { className: "bg-white/80 dark:bg-slate-900/80 rounded-xl p-2.5 border border-slate-200/60 dark:border-slate-800/80 space-y-1.5 text-xs", children: tbl.status === 'available' ? (_jsx("div", { className: "text-center py-2 text-slate-400 font-semibold", children: "\u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u062C\u0627\u0647\u0632\u0629 \u0644\u0644\u0632\u0628\u0627\u0626\u0646" })) : tbl.status === 'cleaning' ? (_jsx("div", { className: "text-center py-1 text-slate-600 dark:text-slate-300 font-bold", children: "\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062A\u0639\u0642\u064A\u0645 \u0648\u0627\u0644\u062A\u062C\u0647\u064A\u0632" })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex justify-between items-center text-slate-600 dark:text-slate-300", children: [_jsx("span", { children: t("الجرسون:") }), _jsx("span", { className: "font-bold text-slate-900 dark:text-white", children: tbl.waiterName || t("الكاشير") })] }), tbl.customerName && (_jsxs("div", { className: "flex justify-between items-center text-slate-600 dark:text-slate-300", children: [_jsx("span", { children: "\u0627\u0644\u0632\u0628\u0648\u0646:" }), _jsx("span", { className: "font-bold", children: tbl.customerName })] })), _jsxs("div", { className: "flex justify-between items-center pt-1 border-t border-slate-100 dark:border-slate-800 font-bold", children: [_jsx("span", { children: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0637\u0644\u0628:" }), _jsxs("span", { className: "text-violet-600 dark:text-violet-400 font-mono text-sm font-black", children: [(tbl.orderTotal || 0).toLocaleString('ar-EG'), " ", settings.currencySymbol || '₪'] })] })] })) }), _jsxs("div", { className: "pt-1 flex flex-col gap-1.5", children: [tbl.status === 'available' && (_jsxs("button", { onClick: () => {
                                            // Navigate to waiter view with this table pre-selected
                                            setActiveTab('restaurant_waiter');
                                        }, className: "w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5", children: [_jsx(Plus, { className: "w-4 h-4" }), _jsx("span", { children: "\u0641\u062A\u062D \u0637\u0644\u0628 \u062C\u062F\u064A\u062F" })] })), tbl.status === 'cleaning' && (_jsxs("button", { onClick: () => updateTableStatus(tbl.id, 'available'), className: "w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5", children: [_jsx(Sparkles, { className: "w-4 h-4" }), _jsx("span", { children: "\u062A\u0645 \u0627\u0644\u062A\u0646\u0638\u064A\u0641 (\u062C\u0627\u0647\u0632\u0629)" })] })), tbl.status !== 'available' && tbl.status !== 'cleaning' && (_jsxs("div", { className: "grid grid-cols-2 gap-1.5", children: [_jsxs("button", { onClick: () => {
                                                    if (currentOrder) {
                                                        recallOrderToPOS(currentOrder);
                                                    }
                                                    else {
                                                        showToast('لا يوجد طلب نشط لهذه الطاولة', 'error');
                                                    }
                                                }, className: "py-1.5 px-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-[11px] flex items-center justify-center gap-1 shadow-xs transition", title: "\u0627\u0633\u062A\u062F\u0639\u0627\u0621 \u0644\u0644\u0643\u0627\u0634\u064A\u0631 \u0644\u062A\u0633\u062F\u064A\u062F \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629", children: [_jsx(Receipt, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u062D\u0633\u0627\u0628 \u0644\u0644\u0643\u0627\u0634\u064A\u0631" })] }), _jsxs("button", { onClick: () => requestBillForTable(tbl.id), className: "py-1.5 px-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-bold text-[11px] border border-rose-200 dark:border-rose-800 flex items-center justify-center gap-1 transition", children: [_jsx(DollarSign, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u0637\u0644\u0628 \u0627\u0644\u062D\u0633\u0627\u0628" })] }), _jsxs("button", { onClick: () => {
                                                    setShowTransferModal(tbl);
                                                    setTransferTargetId('');
                                                }, className: "py-1.5 px-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1 transition", children: [_jsx(ArrowRightLeft, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u0646\u0642\u0644 \u0637\u0627\u0648\u0644\u0629" })] }), _jsxs("button", { onClick: () => {
                                                    setShowMergeModal(tbl);
                                                    setMergeTargetId('');
                                                }, className: "py-1.5 px-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] flex items-center justify-center gap-1 transition", children: [_jsx(Merge, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u062F\u0645\u062C \u0637\u0627\u0648\u0644\u0629" })] })] }))] })] }, tbl.id));
                }) }), showAddTableModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(LayoutGrid, { className: "w-5 h-5 text-amber-600" }), _jsx("span", { children: editingTable ? 'تعديل بيانات الطاولة' : 'إضافة طاولة جديدة' })] }), _jsxs("form", { onSubmit: handleSaveTable, className: "space-y-3 text-xs", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0631\u0642\u0645 \u0623\u0648 \u0643\u0648\u062F \u0627\u0644\u0637\u0627\u0648\u0644\u0629 *" }), _jsx("input", { type: "text", required: true, placeholder: "\u0645\u062B\u0627\u0644: T-01 \u0623\u0648 5 \u0623\u0648 VIP-1", value: tableNumber, onChange: (e) => setTableNumber(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u0633\u0645 \u0627\u0644\u0637\u0627\u0648\u0644\u0629 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)" }), _jsx("input", { type: "text", placeholder: "\u0645\u062B\u0627\u0644: \u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u0646\u0627\u0641\u0630\u0629\u060C \u0631\u0643\u0646 \u0627\u0644\u062D\u062F\u064A\u0642\u0629", value: tableName, onChange: (e) => setTableName(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u0644\u0635\u0627\u0644\u0629 / \u0627\u0644\u0642\u0633\u0645" }), _jsx("select", { value: tableSectionId, onChange: (e) => setTableSectionId(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold", children: sections.map((sec) => (_jsx("option", { value: sec.id, children: sec.name }, sec.id))) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0639\u062F\u062F \u0627\u0644\u0645\u0642\u0627\u0639\u062F" }), _jsx("input", { type: "number", min: 1, max: 50, value: tableSeats, onChange: (e) => setTableSeats(parseInt(e.target.value) || 2), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold font-mono" })] })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-3 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowAddTableModal(false), className: "px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold", children: t("إلغاء") }), _jsx("button", { type: "submit", className: "px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md", children: "\u062D\u0641\u0638 \u0627\u0644\u0637\u0627\u0648\u0644\u0629" })] })] })] }) })), showTransferModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(ArrowRightLeft, { className: "w-5 h-5 text-blue-600" }), _jsxs("span", { children: ["\u0646\u0642\u0644 \u0627\u0644\u0637\u0644\u0628 \u0645\u0646 \u0637\u0627\u0648\u0644\u0629 ", showTransferModal.tableNumber] })] }), _jsxs("form", { onSubmit: handleTransferSubmit, className: "space-y-3.5 text-xs", children: [_jsx("p", { className: "text-slate-500", children: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u0641\u0627\u0631\u063A\u0629 \u0627\u0644\u062A\u064A \u062A\u0631\u063A\u0628 \u0628\u0646\u0642\u0644 \u0637\u0644\u0628 \u0627\u0644\u0632\u0628\u0648\u0646 \u0625\u0644\u064A\u0647\u0627:" }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-700 dark:text-slate-300 mb-1 font-bold", children: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u062C\u062F\u064A\u062F\u0629 (\u0627\u0644\u0645\u062A\u0627\u062D\u0629):" }), _jsxs("select", { required: true, value: transferTargetId, onChange: (e) => setTransferTargetId(e.target.value), className: "w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold text-sm", children: [_jsx("option", { value: "", children: "-- \u0627\u0636\u063A\u0637 \u0644\u0644\u0627\u062E\u062A\u064A\u0627\u0631 --" }), tables
                                                    .filter((t) => t.id !== showTransferModal.id && t.status === 'available')
                                                    .map((t) => (_jsxs("option", { value: t.id, children: ["\u0637\u0627\u0648\u0644\u0629 ", t.tableNumber, " - ", t.sectionName, " (", t.seats, " \u0645\u0642\u0627\u0639\u062F)"] }, t.id)))] })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-3 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowTransferModal(null), className: "px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold", children: t("إلغاء") }), _jsx("button", { type: "submit", disabled: !transferTargetId, className: "px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold shadow-md", children: "\u062A\u0623\u0643\u064A\u062F \u0646\u0642\u0644 \u0627\u0644\u0637\u0644\u0628" })] })] })] }) })), showMergeModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(Merge, { className: "w-5 h-5 text-purple-600" }), _jsxs("span", { children: ["\u062F\u0645\u062C \u0637\u0627\u0648\u0644\u0629 ", showMergeModal.tableNumber, " \u0645\u0639 \u0637\u0627\u0648\u0644\u0629 \u0623\u062E\u0631\u0649"] })] }), _jsxs("form", { onSubmit: handleMergeSubmit, className: "space-y-3.5 text-xs", children: [_jsxs("p", { className: "text-slate-500", children: ["\u0633\u064A\u062A\u0645 \u062A\u062C\u0645\u064A\u0639 \u0623\u0635\u0646\u0627\u0641 \u0648\u0645\u062C\u0645\u0648\u0639 \u0637\u0627\u0648\u0644\u0629 ", showMergeModal.tableNumber, " \u0641\u064A \u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u0645\u062E\u062A\u0627\u0631\u0629 \u0648\u062A\u062D\u0631\u064A\u0631 \u0647\u0630\u0647 \u0627\u0644\u0637\u0627\u0648\u0644\u0629:"] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-700 dark:text-slate-300 mb-1 font-bold", children: "\u062F\u0645\u062C \u0641\u064A \u0627\u0644\u0637\u0627\u0648\u0644\u0629 \u0627\u0644\u0645\u0633\u062A\u0647\u062F\u0641\u0629:" }), _jsxs("select", { required: true, value: mergeTargetId, onChange: (e) => setMergeTargetId(e.target.value), className: "w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold text-sm", children: [_jsx("option", { value: "", children: "-- \u0627\u0636\u063A\u0637 \u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0637\u0627\u0648\u0644\u0629 \u0646\u0634\u0637\u0629 --" }), tables
                                                    .filter((t) => t.id !== showMergeModal.id && t.currentOrderId)
                                                    .map((t) => (_jsxs("option", { value: t.id, children: ["\u0637\u0627\u0648\u0644\u0629 ", t.tableNumber, " (\u0625\u062C\u0645\u0627\u0644\u064A: ", t.orderTotal || 0, " ", settings.currencySymbol || '₪', ")"] }, t.id)))] })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-3 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowMergeModal(null), className: "px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold", children: t("إلغاء") }), _jsx("button", { type: "submit", disabled: !mergeTargetId, className: "px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-bold shadow-md", children: "\u062A\u0623\u0643\u064A\u062F \u062F\u0645\u062C \u0627\u0644\u0637\u0627\u0648\u0644\u0627\u062A" })] })] })] }) })), showSectionsModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(FolderPlus, { className: "w-5 h-5 text-amber-600" }), _jsx("span", { children: "\u0625\u062F\u0627\u0631\u0629 \u0623\u0642\u0633\u0627\u0645 \u0648\u0635\u0627\u0644\u0627\u062A \u0627\u0644\u0645\u0637\u0639\u0645" })] }), _jsxs("form", { onSubmit: handleAddSection, className: "flex gap-2 text-xs", children: [_jsx("input", { type: "text", required: true, placeholder: "\u0627\u0633\u0645 \u0627\u0644\u0635\u0627\u0644\u0629 (\u0645\u062B\u0644: \u0631\u0643\u0646 \u0627\u0644\u0642\u0647\u0648\u0629\u060C \u0627\u0644\u062A\u0631\u0627\u0633 \u0627\u0644\u063A\u0631\u0628\u064A)", value: newSectionName, onChange: (e) => setNewSectionName(e.target.value), className: "flex-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold" }), _jsx("button", { type: "submit", className: "px-4 py-2 rounded-xl bg-amber-600 text-white font-bold whitespace-nowrap", children: "\u0625\u0636\u0627\u0641\u0629 \u0635\u0627\u0644\u0629" })] }), _jsx("div", { className: "space-y-1.5 max-h-60 overflow-y-auto", children: sections.map((sec) => (_jsxs("div", { className: "p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs", children: [_jsx("span", { className: "font-bold", children: sec.name }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-slate-400 font-mono text-[11px]", children: [tables.filter((t) => t.sectionId === sec.id).length, " \u0637\u0627\u0648\u0644\u0629"] }), sections.length > 1 && (_jsx("button", { onClick: () => deleteSection(sec.id), className: "p-1 rounded text-rose-500 hover:bg-rose-50", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) }))] })] }, sec.id))) }), _jsx("div", { className: "flex justify-end pt-3 border-t", children: _jsx("button", { type: "button", onClick: () => setShowSectionsModal(false), className: "px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold", children: t("إغلاق") }) })] }) }))] }));
};
