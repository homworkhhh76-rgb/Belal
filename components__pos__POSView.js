import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { DesktopCheckout } from './components__pos__DesktopCheckout.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { ProductGrid } from './components__pos__ProductGrid.js?v=7.9.4.136-localization';
import { CartPanel } from './components__pos__CartPanel.js?v=7.9.4.136-localization';
import { FullCartView } from './components__pos__FullCartView.js?v=7.9.4.136-localization';
import { PaymentModal } from './components__pos__PaymentModal.js?v=7.9.4.136-localization';
import { CameraScannerModal } from './components__pos__CameraScannerModal.js?v=7.9.4.136-localization';
import { HoldInvoicesModal } from './components__pos__HoldInvoicesModal.js?v=7.9.4.136-localization';
import { RestaurantPendingOrdersModal } from './restaurant__components__RestaurantPendingOrdersModal.js?v=7.9.4.136-localization';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { Barcode, Camera, Maximize2, UtensilsCrossed } from 'lucide-react';
export const POSView = () => {
    const { cart, handleScannedBarcode, setShowCameraModal, holdCurrentInvoice, settings, products, searchQuery, setSearchQuery } = useApp();
    const { orders } = useRestaurant();
    const [desktopSearchTarget,setDesktopSearchTarget]=useState(null);
    useEffect(()=>{const media=window.matchMedia('(min-width:1024px)');const sync=()=>setDesktopSearchTarget(media.matches?document.getElementById('ct-catalog-search-target'):null);sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync)},[]);
    const [isPaymentOpen, setIsPaymentOpen] = useState(false);
    const [isFullCartOpen, setIsFullCartOpen] = useState(false);
    const [isFullCartContentReady, setIsFullCartContentReady] = useState(false);
    const cartOpenFrameRef = useRef(0);
    const [isRestaurantOrdersOpen, setIsRestaurantOrdersOpen] = useState(false);
    const pendingRestaurantCount = (orders || []).filter((o) => o && o.cashierPending === true && ['ready','served','waiting_payment'].includes(o.status)).length;
    const [barcodeInput, setBarcodeInput] = useState('');
    const barcodeInputRef = useRef(null);
    const openPaymentModal = useCallback(() => {
        // أغلق أي تركيز حالي أولاً حتى لا تظهر لوحة المفاتيح عند فتح نافذة الدفع.
        if (typeof document !== 'undefined') document.activeElement?.blur?.();
        if(window.matchMedia('(min-width:1024px)').matches){document.getElementById('desktop-payment')?.querySelector('[data-ct-sell]')?.click();return;}
        setIsPaymentOpen(true);
    }, []);
    useEffect(() => {
        let buffer = '';
        let lastKeyTime = Date.now();
        const handleKeyDown = (e) => {
            if(e.defaultPrevented || document.querySelector('.ct-payment-dialog-layer')) return;
            if (e.key === 'F9') {
                e.preventDefault();
                if (cart.length > 0)
                    openPaymentModal();
                return;
            }
            if (e.key === 'F2') {
                e.preventDefault();
                barcodeInputRef.current?.focus();
                return;
            }
            if (e.key === 'F4') {
                e.preventDefault();
                if (cart.length > 0)
                    holdCurrentInvoice();
                return;
            }
            // عند الكتابة داخل حقل بحث/نص لا نتعامل مع الحروف كأنها ماسح باركود.
            // قارئ الباركود يظل يعمل من خلال الحقل نفسه أو عند عدم وجود تركيز على حقل إدخال.
            const target = e.target;
            const isEditableTarget = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
            if (isEditableTarget)
                return;
            const currentTime = Date.now();
            if (currentTime - lastKeyTime > 100)
                buffer = '';
            lastKeyTime = currentTime;
            if (e.key === 'Enter') {
                if (buffer.length > 2) {
                    const handled = handleScannedBarcode(buffer);
                    if (handled) {
                        e.preventDefault();
                        buffer = '';
                        return;
                    }
                }
                buffer = '';
            }
            else if (e.key.length === 1) {
                buffer += e.key;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [cart, handleScannedBarcode, holdCurrentInvoice, openPaymentModal]);
    const handleManualBarcodeSubmit = (e) => {
        e.preventDefault();
        const clean = barcodeInput.trim();
        if (!clean)
            return;
        // لو الإدخال يطابق باركوداً فعلياً أو كان رقماً، نفّذ المسح كالمعتاد.
        // أما الأسماء والحروف فتبقى بحثاً مباشراً في شبكة الأصناف بدون رسالة باركود غير موجود.
        const hasExactBarcode = (products || []).some((prod) => !(prod?.deletedAt || prod?.status === 'archived') && (prod.units || []).some((unit) => (unit.barcodes || []).some((code) => String(code).trim() === clean)));
        if (hasExactBarcode || /^[0-9٠-٩]+$/.test(clean)) {
            const handled = handleScannedBarcode(clean);
            if (handled) {
                setBarcodeInput('');
                setSearchQuery('');
            }
            return;
        }
        setSearchQuery(clean);
    };
    const closeFullCart = useCallback(() => {
        if (cartOpenFrameRef.current) cancelAnimationFrame(cartOpenFrameRef.current);
        cartOpenFrameRef.current = 0;
        setIsFullCartContentReady(false);
        setIsFullCartOpen(false);
    }, []);
    const openFullCartInstant = useCallback((e) => {
        if (e?.type === 'pointerdown') e.preventDefault?.();
        if (isFullCartOpen) return;
        // Paint the lightweight shell in the same input turn, then mount the heavy
        // cart body on the next frame. This keeps touch feedback immediate without
        // keeping a duplicate full-cart tree mounted all the time.
        flushSync(() => setIsFullCartOpen(true));
        cartOpenFrameRef.current = requestAnimationFrame(() => {
            cartOpenFrameRef.current = 0;
            setIsFullCartContentReady(true);
        });
    }, [isFullCartOpen]);
    useEffect(() => () => {
        if (cartOpenFrameRef.current) cancelAnimationFrame(cartOpenFrameRef.current);
    }, []);
    const searchForm=_jsxs("form", { onSubmit: handleManualBarcodeSubmit, className: "flex-1 max-w-lg flex items-center gap-1.5", children: [_jsxs("div", { className: "relative flex-1 min-w-0", children: [_jsx(Barcode, { className: "absolute right-2.5 top-2.5 w-4 h-4 text-violet-600 dark:text-violet-400 pointer-events-none" }), _jsx("input", { ref: barcodeInputRef, type: "search", inputMode: "search", autoComplete: "off", id: "pos-barcode-input", value: barcodeInput, onChange: (e) => { const value = e.target.value; setBarcodeInput(value); setSearchQuery(value); }, placeholder: "ابحث عن صنف بالاسم أو الكود أو الباركود [F2]...", className: "w-full pr-9 pl-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-violet-500 focus:bg-white" })] }), _jsxs("button", { type: "button", id: "btn-pos-camera", onClick: () => setShowCameraModal(true), className: "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold transition", title: "\u0641\u062a\u062d \u0643\u0627\u0645\u064a\u0631\u0627 \u0627\u0644\u0647\u0627\u062a\u0641/\u0627\u0644\u062c\u0647\u0627\u0632 \u0644\u0645\u0633\u062d \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f", children: [_jsx(Camera, { className: "w-3.5 h-3.5 text-violet-600" }), _jsx("span", { className: "hidden sm:inline", children: t("كاميرا") })] })] });
    return (_jsxs("div", { id: "pos-screen", className: "flex flex-col h-full min-h-0 bg-slate-100 dark:bg-slate-950 overflow-hidden", children: [_jsxs("div", { className: "ct-pos-toolbar bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center justify-between gap-2 shadow-xs shrink-0 select-none", children: [desktopSearchTarget ? createPortal(searchForm,desktopSearchTarget) : searchForm, _jsx("div",{id:"ct-item-tools-target"}), _jsxs("div", { className: "flex items-center gap-1.5 shrink-0", children: [_jsx("div",{id:"ct-summary-target",className:"ct-summary-target"}), settings.isRestaurantModeEnabled && _jsxs("button", { type: "button", onClick: () => setIsRestaurantOrdersOpen(true), className: "relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-bold", children: [_jsx(UtensilsCrossed, { className: "w-3.5 h-3.5" }), _jsx("span", { className: "hidden sm:inline", children: t("طلبات المطعم") }), pendingRestaurantCount > 0 && _jsx("span", { className: "min-w-5 h-5 px-1 rounded-full bg-rose-600 text-white text-[9px] font-black flex items-center justify-center", children: pendingRestaurantCount })] }), _jsxs("button", { onPointerDown: openFullCartInstant, onClick: (e) => { if (e.detail === 0) openFullCartInstant(e); }, className: "ct-expand-cart flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-xs bg-violet-600 text-white shadow-violet-600/20", title: "\u0641\u062a\u062d \u0627\u0644\u0633\u0644\u0629 \u0641\u064a \u0646\u0627\u0641\u0630\u0629 \u0639\u0631\u064a\u0636\u0629", children: [_jsx(Maximize2, { className: "w-3.5 h-3.5" }), _jsx("span", { className: "hidden sm:inline", children: "\u0627\u0644\u0633\u0644\u0629 \u0627\u0644\u0639\u0631\u064a\u0636\u0629" }), _jsx("span", { className: "sm:hidden", children: t("السلة") }), _jsx("span", { className: "rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]", children: cart.length })] })] }), _jsxs("div", { className: "hidden xl:flex items-center gap-3 text-[11px] text-slate-400 font-mono", children: [_jsx("span", { children: "[F9] \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u0633\u0631\u064a\u0639" }), _jsx("span", { children: "[F2] \u0645\u0633\u062d \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f" }), _jsx("span", { children: "[F4] \u062a\u0639\u0644\u064a\u0642 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629" })] })] }), _jsxs("div", { id:"ct-pos-workspace", className: "flex-1 min-h-0 flex overflow-hidden", children: [_jsx("div", { className: "ct-catalog-pane flex-1 h-full min-w-0 overflow-hidden flex", children: _jsx(ProductGrid, {}) }), _jsx("div", { className: "ct-desktop-host", children: _jsx(DesktopCheckout, {}) })] }), isFullCartOpen && _jsx(ModalLayer, { id: "full-cart-modal-backdrop", className: "fixed top-0 inset-x-0 z-[45] bg-black/65 p-1.5 sm:p-4 flex items-center justify-center overflow-hidden", style: { height: 'var(--oscar-app-height, 100dvh)' }, onClick: closeFullCart, children: _jsx("div", { id: "full-cart-modal-box", className: "w-[calc(100vw-0.75rem)] sm:w-[calc(100vw-2rem)] max-w-[1600px] rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200/70 dark:border-slate-700 bg-slate-100 dark:bg-slate-950", style: { height: 'calc(var(--oscar-app-height, 100dvh) - 0.75rem)', maxHeight: 'calc(var(--oscar-app-height, 100dvh) - 0.75rem)' }, onClick: (e) => e.stopPropagation(), children: isFullCartContentReady ? _jsx(FullCartView, { onOpenPayment: openPaymentModal, onToggleLayout: closeFullCart }) : _jsx("div", { className: "h-full w-full bg-slate-100 dark:bg-slate-950" }) }) }), _jsx(PaymentModal, { isOpen: isPaymentOpen, onClose: () => setIsPaymentOpen(false), onSuccess: () => {
                    setIsPaymentOpen(false);
                    closeFullCart();
                } }), _jsx(CameraScannerModal, {}), _jsx(HoldInvoicesModal, {}), _jsx(RestaurantPendingOrdersModal, { isOpen: isRestaurantOrdersOpen, onClose: () => setIsRestaurantOrdersOpen(false) })] }));
};
