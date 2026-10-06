import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
import { Trash2, Plus, BookOpen, Scale, AlertTriangle, } from 'lucide-react';
export const RestaurantWasteView = () => {
    const { recipes, wasteLogs, addRecipe, updateRecipe, deleteRecipe, logWaste, deleteWasteRecord, } = useRestaurant();
    const { products, showToast, settings } = useApp();
    const normalizedChannel = (p) => String((p && p.salesChannel) || 'both').toLowerCase();
    const isRawMaterial = (p) => {
        const c = normalizedChannel(p);
        return c === 'raw_material' || c === 'raw' || c === 'ingredient' || !!(p && p.isRawMaterialOnly);
    };
    const activeProducts = (products || []).filter((p) => p && !p.deletedAt && p.status !== 'archived');
    const mealProducts = activeProducts.filter((p) => !isRawMaterial(p) && (normalizedChannel(p) === 'restaurant' || normalizedChannel(p) === 'both' || p.showInRestaurant === true || p.restaurantEnabled === true));
    const ingredientProducts = [...activeProducts].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
    const getBaseUnit = (p) => (p?.units || []).find((u) => u.id === p.baseUnitId) || (p?.units || []).find((u) => (Number(u.conversionToBase) || 1) === 1) || (p?.units || [])[0];
    const [activeTab, setActiveTab] = useState('recipes');
    // Recipe Modal State
    const [showRecipeModal, setShowRecipeModal] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState(mealProducts[0]?.id || '');
    const [recipeIngredients, setRecipeIngredients] = useState([]);
    // Waste Modal State
    const [showWasteModal, setShowWasteModal] = useState(false);
    const [wasteItemName, setWasteItemName] = useState('');
    const [wasteQty, setWasteQty] = useState(1);
    const [wasteUnit, setWasteUnit] = useState('كجم');
    const [wasteCost, setWasteCost] = useState(25);
    const [wasteReason, setWasteReason] = useState('burnt_in_cooking');
    const [wasteNotes, setWasteNotes] = useState('');
    // Add ingredient row
    const handleAddIngredientRow = () => {
        if (ingredientProducts.length === 0) { showToast('لا توجد أصناف متاحة لإضافتها كمكونات للوصفة.', 'warning'); return; }
        const firstProd = ingredientProducts[0];
        const unit = getBaseUnit(firstProd);
        setRecipeIngredients((prev) => [
            ...prev,
            {
                ingredientProductId: firstProd.id,
                ingredientName: firstProd.name,
                quantity: 1,
                ingredientUnitId: unit?.id || '',
                unit: unit?.name || firstProd.baseUnitName || 'حبة',
                conversionFactor: Number(unit?.conversionToBase) || 1,
                baseQuantity: Number(unit?.conversionToBase) || 1,
            },
        ]);
    };
    const handleRemoveIngredientRow = (idx) => {
        setRecipeIngredients((prev) => prev.filter((_, i) => i !== idx));
    };
    const handleSaveRecipe = async (e) => {
        e.preventDefault();
        const prod = products.find((p) => p.id === selectedProductId);
        if (!prod)
            return;
        const normalizedIngredients = recipeIngredients.map((ing) => {
            const raw = ingredientProducts.find((p) => p.id === ing.ingredientProductId);
            const unit = (raw?.units || []).find((u) => u.id === ing.ingredientUnitId) || getBaseUnit(raw);
            const factor = Number(unit?.conversionToBase ?? ing.conversionFactor ?? 1) || 1;
            const qty = Number(ing.quantity) || 0;
            return {
                ...ing,
                ingredientName: raw?.name || ing.ingredientName,
                ingredientUnitId: unit?.id || ing.ingredientUnitId || '',
                unit: unit?.name || ing.unit || raw?.baseUnitName || 'حبة',
                conversionFactor: factor,
                baseQuantity: qty * factor,
            };
        }).filter((ing) => ing.ingredientProductId && ing.quantity > 0);
        if (normalizedIngredients.length === 0) {
            showToast('أضف مكوناً واحداً على الأقل للوصفة', 'error');
            return;
        }
        await addRecipe({
            mealProductId: prod.id,
            mealProductName: prod.name,
            ingredients: normalizedIngredients,
        });
        showToast(`تم حفظ وصفة ومكونات وجبة ${prod.name}`, 'success');
        setShowRecipeModal(false);
        setRecipeIngredients([]);
    };
    const handleSaveWaste = async (e) => {
        e.preventDefault();
        if (!wasteItemName) {
            showToast('يرجى كتابة اسم المادة التالفة', 'error');
            return;
        }
        await logWaste({
            itemName: wasteItemName,
            quantity: Number(wasteQty) || 1,
            unit: wasteUnit,
            cost: Number(wasteCost) || 0,
            reason: wasteReason,
            notes: wasteNotes,
        });
        showToast('تم تسجيل الهالك وخصمه من أرباح المطبخ', 'success');
        setShowWasteModal(false);
        setWasteItemName('');
    };
    const totalWasteCost = wasteLogs.reduce((sum, w) => sum + (w.cost || 0), 0);
    return (_jsxs("div", { className: "p-4 sm:p-6 space-y-5 max-w-7xl mx-auto text-right select-none", children: [_jsxs("div", { className: "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsxs("h1", { className: "text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(Scale, { className: "w-6 h-6 text-amber-600" }), _jsx("span", { children: "\u0648\u0635\u0641\u0627\u062A \u0627\u0644\u0648\u062C\u0628\u0627\u062A \u0648\u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0647\u0627\u0644\u0643 (BOM & Waste)" })] }), _jsx("p", { className: "text-xs sm:text-sm text-slate-500 mt-0.5", children: "\u0631\u0628\u0637 \u0627\u0644\u0648\u062C\u0628\u0627\u062A \u0628\u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u062E\u0627\u0645 \u0641\u064A \u0627\u0644\u0645\u062E\u0632\u0648\u0646\u060C \u0648\u062E\u0635\u0645 \u0627\u0644\u0645\u0643\u0648\u0646\u0627\u062A \u0622\u0644\u064A\u0627\u064B \u0648\u062A\u0633\u062C\u064A\u0644 \u062A\u0627\u0644\u0641 \u0627\u0644\u0645\u0637\u0628\u062E" })] }), _jsx("div", { className: "flex items-center gap-2", children: activeTab === 'recipes' ? (_jsxs("button", { onClick: () => {
                                setRecipeIngredients([]);
                                handleAddIngredientRow();
                                setShowRecipeModal(true);
                            }, className: "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition", children: [_jsx(Plus, { className: "w-4 h-4" }), _jsx("span", { children: "\u0625\u0636\u0627\u0641\u0629 \u0648\u0635\u0641\u0629 \u0648\u062C\u0628\u0629 (\u0645\u0643\u0648\u0646\u0627\u062A)" })] })) : (_jsxs("button", { onClick: () => setShowWasteModal(true), className: "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition", children: [_jsx(Trash2, { className: "w-4 h-4" }), _jsx("span", { children: "\u062A\u0633\u062C\u064A\u0644 \u0647\u0627\u0644\u0643 / \u062A\u0627\u0644\u0641 \u0645\u0637\u0628\u062E" })] })) })] }), _jsxs("div", { className: "flex items-center gap-2 border-b border-slate-200 dark:border-slate-800", children: [_jsxs("button", { onClick: () => setActiveTab('recipes'), className: `pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'recipes'
                            ? 'border-amber-600 text-amber-600 dark:text-amber-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700'}`, children: [_jsx(BookOpen, { className: "w-4 h-4" }), _jsxs("span", { children: ["\u0648\u0635\u0641\u0627\u062A \u0627\u0644\u0648\u062C\u0628\u0627\u062A \u0648\u0645\u0643\u0648\u0646\u0627\u062A\u0647\u0627 (", recipes.length, ")"] })] }), _jsxs("button", { onClick: () => setActiveTab('waste'), className: `pb-3 px-4 text-xs font-bold flex items-center gap-2 border-b-2 transition ${activeTab === 'waste'
                            ? 'border-rose-600 text-rose-600 dark:text-rose-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700'}`, children: [_jsx(Trash2, { className: "w-4 h-4" }), _jsxs("span", { children: ["\u0633\u062C\u0644 \u0627\u0644\u0647\u0627\u0644\u0643 \u0648\u0627\u0644\u062A\u0627\u0644\u0641 (", wasteLogs.length, ")"] })] })] }), activeTab === 'recipes' && (_jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", children: recipes.length === 0 ? (_jsx("div", { className: "col-span-full p-12 text-center text-xs text-slate-400 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800", children: "\u0644\u0645 \u064A\u062A\u0645 \u062A\u0639\u0631\u064A\u0641 \u0648\u0635\u0641\u0627\u062A \u0648\u062C\u0628\u0627\u062A \u0628\u0639\u062F. \u0627\u0636\u063A\u0637 \u00AB\u0625\u0636\u0627\u0641\u0629 \u0648\u0635\u0641\u0629 \u0648\u062C\u0628\u0629\u00BB \u0644\u0631\u0628\u0637 \u0627\u0644\u0648\u062C\u0628\u0629 \u0628\u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u062E\u0627\u0645 (\u0644\u062D\u0648\u0645\u060C \u062E\u0628\u0632\u060C \u062E\u0636\u0627\u0631\u060C \u0628\u0647\u0627\u0631\u0627\u062A)." })) : (recipes.map((recipe) => (_jsxs("div", { className: "p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3", children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-black text-sm text-slate-900 dark:text-white", children: recipe.mealProductName }), _jsxs("span", { className: "text-[11px] text-slate-500", children: [recipe.ingredients.length, " \u0645\u0643\u0648\u0646\u0627\u062A \u0645\u0631\u062A\u0628\u0637\u0629 \u0628\u0627\u0644\u0645\u062E\u0632\u0648\u0646"] })] }), _jsx("button", { onClick: () => deleteRecipe(recipe.id), className: "p-1 rounded text-rose-400 hover:text-rose-600 hover:bg-rose-50", children: _jsx(Trash2, { className: "w-4 h-4" }) })] }), _jsxs("div", { className: "space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs", children: [_jsxs("div", { className: "flex items-center justify-between rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50 px-2.5 py-2", children: [_jsx("span", { className: "font-bold text-violet-800 dark:text-violet-300", children: "تكلفة المنتج المصنّع" }), _jsxs("span", { className: "font-mono font-black text-violet-700 dark:text-violet-300", children: [Number(recipe.recipeCost || recipe.costPrice || 0).toFixed(2), " ", settings?.currencySymbol || "₪"] })] }), _jsx("div", { className: "space-y-1.5", children: recipe.ingredients.map((ing, idx) => (_jsxs("div", { className: "flex justify-between items-center p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60", children: [_jsx("span", { className: "font-semibold text-slate-700 dark:text-slate-300", children: ing.ingredientName }), _jsxs("span", { className: "font-mono font-bold text-amber-600", children: [ing.quantity, " ", ing.unit] })] }, idx))) })] })] }, recipe.id)))) })), activeTab === 'waste' && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "w-5 h-5 text-rose-600" }), _jsx("span", { className: "text-xs font-bold text-rose-800 dark:text-rose-300", children: "\u0625\u062C\u0645\u0627\u0644\u064A \u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0647\u0627\u0644\u0643 \u0648\u0627\u0644\u062A\u0627\u0644\u0641 \u0627\u0644\u0645\u0633\u062C\u0644:" })] }), _jsxs("span", { className: "font-mono font-black text-base text-rose-600", children: [totalWasteCost.toLocaleString('ar-SA'), " ₪"] })] }), _jsx("div", { className: "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden", children: _jsx("div", { className: "overflow-x-auto max-w-full slim-scrollbar", children: wasteLogs.length === 0 ? (_jsx("div", { className: "p-8 text-center text-xs text-slate-400", children: "\u0644\u0627 \u064A\u0648\u062C\u062F \u0647\u0627\u0644\u0643 \u0645\u0633\u062C\u0644" })) : (_jsxs("table", { className: "w-full text-xs text-right whitespace-nowrap min-w-[700px]", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-500 font-semibold", children: [_jsx("th", { className: "p-3", children: "\u0627\u0644\u0645\u0627\u062F\u0629 / \u0627\u0644\u0635\u0646\u0641" }), _jsx("th", { className: "p-3", children: t("الكمية") }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u062A\u0642\u062F\u064A\u0631\u064A\u0629" }), _jsx("th", { className: "p-3", children: "\u0633\u0628\u0628 \u0627\u0644\u0647\u0627\u0644\u0643" }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u0645\u0633\u062C\u0644" }), _jsx("th", { className: "p-3", children: "\u0627\u0644\u062A\u0627\u0631\u064A\u062E \u0648\u0627\u0644\u0648\u0642\u062A" }), _jsx("th", { className: "p-3", children: t("ملاحظات") }), _jsx("th", { className: "p-3 text-center", children: "\u0625\u062C\u0631\u0627\u0621" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: wasteLogs.map((log) => (_jsxs("tr", { className: "hover:bg-slate-50/50 dark:hover:bg-slate-800/30", children: [_jsx("td", { className: "p-3 font-bold text-slate-900 dark:text-white", children: log.itemName }), _jsxs("td", { className: "p-3 font-mono", children: [log.quantity, " ", log.unit] }), _jsxs("td", { className: "p-3 font-mono font-bold text-rose-600", children: [log.cost.toLocaleString('ar-SA'), " ₪"] }), _jsx("td", { className: "p-3", children: _jsx("span", { className: "px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700", children: log.reason === 'burnt_in_cooking'
                                                            ? 'احتراق أثناء الطهي 🔥'
                                                            : log.reason === 'expired'
                                                                ? 'انتهاء صلاحية ⌛'
                                                                : log.reason === 'customer_returned'
                                                                    ? 'مرتجع من الزبون ↩️'
                                                                    : 'تلف تخزين 📦' }) }), _jsx("td", { className: "p-3 text-slate-600 dark:text-slate-300", children: log.loggedByName || log.reportedBy || 'المشرف' }), _jsx("td", { className: "p-3 text-slate-500 font-mono text-[11px]", children: new Date(log.loggedAt || log.date || log.createdAt || Date.now()).toLocaleString('ar-SA') }), _jsx("td", { className: "p-3 text-slate-500 text-[11px]", children: log.notes || '-' }), _jsx("td", { className: "p-3 text-center", children: _jsx("button", { type: "button", onClick: async () => { if (window.confirm('حذف سجل الهالك/الاستهلاك نهائياً؟')) await deleteWasteRecord?.(log.id); }, className: "inline-flex p-2 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100", title: "حذف السجل", children: _jsx(Trash2, { className: "w-4 h-4" }) }) })] }, log.id))) })] })) }) })] })), showRecipeModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4 max-h-[90vh] overflow-y-auto text-xs", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(BookOpen, { className: "w-5 h-5 text-amber-600" }), _jsx("span", { children: "\u0631\u0628\u0637 \u0648\u062C\u0628\u0629 \u0628\u0645\u0643\u0648\u0646\u0627\u062A \u0627\u0644\u0645\u0648\u0627\u062F \u0627\u0644\u062E\u0627\u0645 (BOM Recipe)" })] }), _jsxs("form", { onSubmit: handleSaveRecipe, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u062E\u062A\u0631 \u0627\u0644\u0648\u062C\u0628\u0629 \u0627\u0644\u062C\u0627\u0647\u0632\u0629:" }), _jsx("select", { value: selectedProductId, onChange: (e) => setSelectedProductId(e.target.value), className: "w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold", children: mealProducts.map((p) => (_jsxs("option", { value: p.id, children: [p.name, " (", p.categoryName || 'وجبات', ")"] }, p.id))) })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("label", { className: "font-bold text-slate-700 dark:text-slate-300", children: "\u0627\u0644\u0645\u0643\u0648\u0646\u0627\u062A \u0627\u0644\u0645\u0633\u062A\u0647\u0644\u0643\u0629 \u0645\u0646 \u0627\u0644\u0645\u062E\u0632\u0646:" }), _jsxs("button", { type: "button", onClick: handleAddIngredientRow, className: "flex items-center gap-1 text-[11px] font-bold text-amber-600 hover:text-amber-700", children: [_jsx(Plus, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u0625\u0636\u0627\u0641\u0629 \u0645\u0627\u062F\u0629 \u062E\u0627\u0645" })] })] }), _jsx("div", { className: "space-y-2", children: recipeIngredients.map((ing, idx) => (_jsxs("div", { className: "flex items-center gap-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border", children: [_jsx("select", { value: ing.ingredientProductId, onChange: (e) => {
                                                            const p = products.find((x) => x.id === e.target.value);
                                                            const copy = [...recipeIngredients];
                                                            copy[idx].ingredientProductId = e.target.value;
                                                            copy[idx].ingredientName = p?.name || '';
                                                            const unit = getBaseUnit(p);
                                                            copy[idx].ingredientUnitId = unit?.id || '';
                                                            copy[idx].unit = unit?.name || p?.baseUnitName || 'حبة';
                                                            copy[idx].conversionFactor = Number(unit?.conversionToBase) || 1;
                                                            copy[idx].baseQuantity = (Number(copy[idx].quantity) || 0) * (Number(unit?.conversionToBase) || 1);
                                                            setRecipeIngredients(copy);
                                                        }, className: "flex-1 p-1.5 rounded-lg bg-white dark:bg-slate-700 border text-xs font-bold", children: ingredientProducts.map((p) => (_jsx("option", { value: p.id, children: isRawMaterial(p) ? `${p.name} — مادة خام` : p.name }, p.id))) }), _jsx("input", { type: "number", step: "0.01", min: "0.01", value: ing.quantity, onChange: (e) => {
                                                            const copy = [...recipeIngredients];
                                                            copy[idx].quantity = parseFloat(e.target.value) || 1;
                                                            copy[idx].baseQuantity = (Number(copy[idx].quantity) || 0) * (Number(copy[idx].conversionFactor) || 1);
                                                            setRecipeIngredients(copy);
                                                        }, className: "w-16 p-1.5 rounded-lg bg-white dark:bg-slate-700 border text-center font-bold font-mono text-xs" }), _jsx("select", { value: ing.ingredientUnitId || '', onChange: (e) => {
                                                            const copy = [...recipeIngredients];
                                                            const raw = ingredientProducts.find((p) => p.id === copy[idx].ingredientProductId);
                                                            const unit = (raw?.units || []).find((u) => u.id === e.target.value) || getBaseUnit(raw);
                                                            copy[idx].ingredientUnitId = unit?.id || '';
                                                            copy[idx].unit = unit?.name || raw?.baseUnitName || 'حبة';
                                                            copy[idx].conversionFactor = Number(unit?.conversionToBase) || 1;
                                                            copy[idx].baseQuantity = (Number(copy[idx].quantity) || 0) * (Number(unit?.conversionToBase) || 1);
                                                            setRecipeIngredients(copy);
                                                        }, className: "w-24 p-1.5 rounded-lg bg-white dark:bg-slate-700 border text-xs font-bold", children: ((ingredientProducts.find((p) => p.id === ing.ingredientProductId)?.units || [])).map((u) => (_jsx("option", { value: u.id, children: u.name }, u.id))) }), _jsx("button", { type: "button", onClick: () => handleRemoveIngredientRow(idx), className: "p-1 rounded text-rose-500 hover:bg-rose-50", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] }, idx))) })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-3 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowRecipeModal(false), className: "px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold", children: t("إلغاء") }), _jsx("button", { type: "submit", className: "px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md", children: "\u062D\u0641\u0638 \u0648\u0635\u0641\u0629 \u0627\u0644\u0648\u062C\u0628\u0629" })] })] })] }) })), showWasteModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", children: _jsxs("div", { className: "w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 border border-slate-200 dark:border-slate-800 space-y-4 text-xs", children: [_jsxs("h3", { className: "text-base font-bold text-slate-900 dark:text-white flex items-center gap-2", children: [_jsx(Trash2, { className: "w-5 h-5 text-rose-600" }), _jsx("span", { children: "\u062A\u0633\u062C\u064A\u0644 \u0647\u0627\u0644\u0643 / \u062A\u0627\u0644\u0641 \u0641\u064A \u0627\u0644\u0645\u0637\u0628\u062E" })] }), _jsxs("form", { onSubmit: handleSaveWaste, className: "space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u0633\u0645 \u0627\u0644\u0635\u0646\u0641 \u0623\u0648 \u0627\u0644\u0645\u0627\u062F\u0629 *" }), _jsx("input", { type: "text", required: true, placeholder: "\u0645\u062B\u0627\u0644: \u0644\u062D\u0645 \u0628\u0631\u062C\u0631 \u0645\u062D\u062A\u0631\u0642\u060C \u062D\u0644\u064A\u0628 \u0645\u0646\u062A\u0647\u064A \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629...", value: wasteItemName, onChange: (e) => setWasteItemName(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u0644\u0643\u0645\u064A\u0629 \u0627\u0644\u062A\u0627\u0644\u0641\u0629" }), _jsx("input", { type: "number", step: "0.1", min: "0.1", value: wasteQty, onChange: (e) => setWasteQty(parseFloat(e.target.value) || 1), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: t("الوحدة") }), _jsxs("select", { value: wasteUnit, onChange: (e) => setWasteUnit(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold", children: [_jsx("option", { value: "\u062D\u0628\u0629", children: "\u062D\u0628\u0629" }), _jsx("option", { value: "\u0643\u062C\u0645", children: "\u0643\u062C\u0645" }), _jsx("option", { value: "\u062C\u0631\u0627\u0645", children: "\u062C\u0631\u0627\u0645" }), _jsx("option", { value: "\u0644\u062A\u0631", children: "\u0644\u062A\u0631" }), _jsx("option", { value: "\u0648\u062C\u0628\u0629", children: "\u0648\u062C\u0628\u0629 \u0643\u0627\u0645\u0644\u0629" })] })] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0627\u0644\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A\u0629 (₪)" }), _jsx("input", { type: "number", min: "0", step: "0.5", value: wasteCost, onChange: (e) => setWasteCost(parseFloat(e.target.value) || 0), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0633\u0628\u0628 \u0627\u0644\u062A\u0644\u0641" }), _jsxs("select", { value: wasteReason, onChange: (e) => setWasteReason(e.target.value), className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border font-bold", children: [_jsx("option", { value: "burnt_in_cooking", children: "\u0627\u062D\u062A\u0631\u0627\u0642 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u0637\u0647\u064A" }), _jsx("option", { value: "expired", children: "\u0627\u0646\u062A\u0647\u0627\u0621 \u0627\u0644\u0635\u0644\u0627\u062D\u064A\u0629" }), _jsx("option", { value: "customer_returned", children: "\u0645\u0631\u062A\u062C\u0639 \u0623\u0648 \u0631\u0641\u0636 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644" }), _jsx("option", { value: "damaged", children: "\u062A\u0644\u0641 \u0623\u062B\u0646\u0627\u0621 \u0627\u0644\u062A\u062E\u0632\u064A\u0646 / \u0627\u0644\u0646\u0642\u0644" }), _jsx("option", { value: "other", children: "\u0623\u062E\u0631\u0649" })] })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-slate-500 mb-1 font-semibold", children: "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u062A\u0648\u0636\u064A\u062D\u064A\u0629" }), _jsx("textarea", { rows: 2, value: wasteNotes, onChange: (e) => setWasteNotes(e.target.value), placeholder: "\u0633\u0628\u0628 \u0648\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u062D\u0627\u062F\u062B\u0629...", className: "w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border" })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-3 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowWasteModal(false), className: "px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold", children: t("إلغاء") }), _jsx("button", { type: "submit", className: "px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-md", children: "\u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0647\u0627\u0644\u0643" })] })] })] }) }))] }));
};
