import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import { Plus, Minus, X, Check, UtensilsCrossed } from 'lucide-react';
// Preset common modifiers for restaurants & cafés
const SIZES = [
    { name: 'عادي / وسط', priceDiff: 0 },
    { name: 'كبير (L)', priceDiff: 5 },
    { name: 'عائلي (XL)', priceDiff: 12 },
];
const ADDONS = [
    { id: 'ad-cheese', name: 'جبنة إضافية', price: 4 },
    { id: 'ad-sauce', name: 'صوص إضافي', price: 2 },
    { id: 'ad-mushrooms', name: 'فطر طازج', price: 3 },
    { id: 'ad-meat', name: 'لحم إضافي', price: 8 },
    { id: 'ad-bacon', name: 'بيكون / ديك رومي', price: 6 },
    { id: 'ad-bread', name: 'خبز إضافي', price: 1.5 },
    { id: 'ad-milk', name: 'حليب نباتي / لوز', price: 3 },
    { id: 'ad-syrup', name: 'نكهة سيروب إضافية', price: 2.5 },
];
const REMOVALS = [
    'بدون بصل',
    'بدون مخلل',
    'بدون طماطم',
    'بدون مايونيز',
    'بدون سكر',
    'بدون ثلج',
    'قليل الملح',
    'بدون بهارات',
];
const QUICK_NOTES = ['حار جداً 🔥', 'استعجل الطلب ⏱️', 'سفري محكم 🥡', 'مشروب دافئ ☕'];
export const ItemModifierModal = ({ product, initialItem, onConfirm, onClose }) => {
    const { settings } = useApp();
    const currency = settings?.currencySymbol || '₪';
    const defaultUnit = (product.units || []).find((u) => u.isDefaultSale) || (product.units || [])[0];
    const basePrice = Number(defaultUnit?.salePrice ?? product.sellingPrice ?? product.salePrice ?? 0) || 0;
    const [quantity, setQuantity] = useState(initialItem?.quantity || 1);
    const [selectedSize, setSelectedSize] = useState(initialItem?.sizeVariant || SIZES[0]);
    const [selectedAddons, setSelectedAddons] = useState(initialItem?.addons || []);
    const [selectedRemovals, setSelectedRemovals] = useState(initialItem?.removals || []);
    const [notes, setNotes] = useState(initialItem?.notes || '');
    const toggleAddon = (addon) => {
        setSelectedAddons((prev) => {
            const exists = prev.find((a) => a.id === addon.id);
            if (exists) {
                return prev.filter((a) => a.id !== addon.id);
            }
            else {
                return [...prev, { id: addon.id, name: addon.name, price: addon.price, type: 'addon' }];
            }
        });
    };
    const toggleRemoval = (removal) => {
        setSelectedRemovals((prev) => prev.includes(removal) ? prev.filter((r) => r !== removal) : [...prev, removal]);
    };
    const appendNote = (note) => {
        setNotes((prev) => (prev ? `${prev} - ${note}` : note));
    };
    const addonsTotal = selectedAddons.reduce((sum, a) => sum + (Number(a.price) || 0), 0);
    const currentUnitPrice = basePrice + (selectedSize.priceDiff || 0);
    const lineTotal = (currentUnitPrice + addonsTotal) * quantity;
    const handleSave = () => {
        onConfirm({
            productId: product.id,
            productName: product.name,
            quantity,
            unitPrice: currentUnitPrice,
            sizeVariant: selectedSize,
            addons: selectedAddons,
            removals: selectedRemovals,
            notes,
        });
        onClose();
    };
    return (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 select-none", children: _jsxs("div", { className: "w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]", children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(UtensilsCrossed, { className: "w-5 h-5 text-violet-600" }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-black text-slate-900 dark:text-white", children: product.name }), _jsxs("p", { className: "text-[11px] text-slate-500", children: ["\u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u0623\u0633\u0627\u0633\u064A: ", basePrice, " ", currency] })] })] }), _jsx("button", { onClick: onClose, className: "p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/50", children: _jsx(X, { className: "w-4 h-4" }) })] }), _jsxs("div", { className: "p-4 space-y-4 overflow-y-auto flex-1 text-right text-xs slim-scrollbar", children: [_jsxs("div", { className: "flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700", children: [_jsx("span", { className: "font-bold text-slate-700 dark:text-slate-200", children: t("الكمية:") }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { type: "button", onClick: () => setQuantity((q) => Math.max(1, q - 1)), className: "w-8 h-8 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 flex items-center justify-center font-black hover:bg-slate-100", children: _jsx(Minus, { className: "w-4 h-4" }) }), _jsx("span", { className: "font-black font-mono text-base text-slate-900 dark:text-white w-6 text-center", children: quantity }), _jsx("button", { type: "button", onClick: () => setQuantity((q) => q + 1), className: "w-8 h-8 rounded-lg bg-violet-600 text-white flex items-center justify-center font-black hover:bg-violet-700 shadow-xs", children: _jsx(Plus, { className: "w-4 h-4" }) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 font-bold mb-2", children: "\u0627\u0644\u062D\u062C\u0645 / \u0627\u0644\u0635\u062D\u0646:" }), _jsx("div", { className: "grid grid-cols-3 gap-2", children: SIZES.map((sz) => {
                                        const isSelected = selectedSize.name === sz.name;
                                        return (_jsxs("button", { type: "button", onClick: () => setSelectedSize(sz), className: `p-2.5 rounded-xl border text-center transition ${isSelected
                                                ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-black ring-1 ring-violet-500'
                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`, children: [_jsx("div", { className: "font-bold", children: sz.name }), _jsx("div", { className: "text-[10px] text-slate-500 mt-0.5", children: sz.priceDiff > 0 ? `${sz.priceDiff > 0 ? "+" : ""}${sz.priceDiff} ${currency}` : 'السعر الأساسي' })] }, sz.name));
                                    }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 font-bold mb-2", children: "\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062A (Addons):" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: ADDONS.map((addon) => {
                                        const isSelected = selectedAddons.some((a) => a.id === addon.id);
                                        return (_jsxs("button", { type: "button", onClick: () => toggleAddon(addon), className: `p-2 rounded-xl border flex items-center justify-between transition ${isSelected
                                                ? 'border-violet-500 bg-violet-50/70 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 font-bold'
                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`, children: [_jsx("span", { children: addon.name }), _jsxs("span", { className: "font-mono text-[10px] bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded", children: ["+", addon.price, " ", currency] })] }, addon.id));
                                    }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 font-bold mb-2", children: "\u0627\u0644\u0627\u0633\u062A\u0628\u0639\u0627\u062F (\u0628\u062F\u0648\u0646):" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: REMOVALS.map((rem) => {
                                        const isSelected = selectedRemovals.includes(rem);
                                        return (_jsx("button", { type: "button", onClick: () => toggleRemoval(rem), className: `px-3 py-1.5 rounded-lg border text-[11px] transition font-medium ${isSelected
                                                ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-bold'
                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`, children: rem }, rem));
                                    }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 font-bold mb-2", children: "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0633\u0631\u064A\u0639\u0629 \u0644\u0644\u0645\u0637\u0628\u062E:" }), _jsx("div", { className: "flex flex-wrap gap-1.5 mb-2", children: QUICK_NOTES.map((qn) => (_jsx("button", { type: "button", onClick: () => appendNote(qn), className: "px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-[11px] font-semibold", children: qn }, qn))) }), _jsx("textarea", { rows: 2, value: notes, onChange: (e) => setNotes(e.target.value), placeholder: "\u0627\u0643\u062A\u0628 \u062A\u0639\u0644\u064A\u0645\u0627\u062A \u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0637\u0627\u0647\u064A \u0623\u0648 \u0627\u0644\u0628\u0627\u0631...", className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700" })] })] }), _jsxs("div", { className: "p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "text-[11px] text-slate-500 block", children: "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A \u0644\u0644\u0635\u0646\u0641:" }), _jsxs("span", { className: "text-base font-black text-violet-600 font-mono", children: [lineTotal.toLocaleString('ar-SA'), " ", currency] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: onClose, className: "px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200/50", children: t("إلغاء") }), _jsxs("button", { type: "button", onClick: handleSave, className: "flex items-center gap-1.5 px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-md shadow-violet-600/20 transition", children: [_jsx(Check, { className: "w-4 h-4" }), _jsx("span", { children: "\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0635\u0646\u0641" })] })] })] })] }) }));
};
