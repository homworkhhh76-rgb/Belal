import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { createPortal } from 'react-dom';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { useRestaurant } from './restaurant__context__RestaurantContext.js?v=7.9.4.136-localization';
import { Banknote, Clock, Split, CheckCircle2, RotateCcw, X, AlertCircle, Coins, } from 'lucide-react';
export const PaymentModal = ({ isOpen, onClose, onSuccess, embedded = false, controls = null, footerControls = null, accountContainer = null }) => {
    const { cart, customers, invoices, createCartReturnInvoice, selectedCustomer, setSelectedCustomer, accounts, settings, createSaleInvoice, updateSaleInvoice, editingSaleInvoiceId, setShowThermalModal, saveCustomer, showToast, invoiceDiscountType, setInvoiceDiscountType, invoiceDiscountValue, setInvoiceDiscountValue, invoiceAdditionalCharges, setInvoiceAdditionalCharges, } = useApp();
    const { activeRestaurantOrder, closeOrderAfterPayment } = useRestaurant();
    // Grand total calculation
    const subtotal = cart.reduce((s, i) => s + (i.quantity * i.unitPrice), 0);
    const taxTotal = cart.reduce((s, i) => {
        const lineSub = i.quantity * i.unitPrice;
        return s + lineSub * ((Number(i.taxRate)||0) / 100);
    }, 0);
    const beforeInvoiceDiscount = Math.round((subtotal + taxTotal) * 100) / 100;
    const invoiceDiscountAmount = invoiceDiscountType === 'percent' ? Math.min(beforeInvoiceDiscount, beforeInvoiceDiscount * Math.max(0, Math.min(100, Number(invoiceDiscountValue) || 0)) / 100) : Math.min(beforeInvoiceDiscount, Math.max(0, Number(invoiceDiscountValue) || 0));
    const rawGrandTotal = Math.max(0, beforeInvoiceDiscount - invoiceDiscountAmount) + Math.max(0, Number(invoiceAdditionalCharges)||0);
    const grandTotal = settings.scaleModeEnabled ? Math.round(rawGrandTotal) : Math.round(rawGrandTotal * 100) / 100;
    const defaultAccountId = accounts.find((a) => a.isDefault)?.id || accounts.find((a) => a.type === 'cash')?.id || accounts[0]?.id || '';
    const [paymentType, setPaymentType] = useState('cash');
    const [cashGiven, setCashGiven] = useState(grandTotal.toString());
    const [selectedAccountId, setSelectedAccountId] = useState(defaultAccountId);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Multi-payment split rows
    const [multiRows, setMultiRows] = useState([
        { accountId: defaultAccountId, method: 'cash', amount: grandTotal },
    ]);
    // Quick new customer modal inside dropdown
    const [showQuickCustModal, setShowQuickCustModal] = useState(false);
    const [newCustName, setNewCustName] = useState('');
    const [newCustPhone, setNewCustPhone] = useState('');
    useEffect(() => {
        if (embedded) return;
        if (isOpen) {
            // لا نركز أي حقل تلقائياً عند فتح نافذة الدفع حتى لا تظهر لوحة المفاتيح على الجوال.
            if (!embedded && typeof document !== 'undefined') {
                document.activeElement?.blur?.();
                requestAnimationFrame(() => document.activeElement?.blur?.());
            }
            const edited = editingSaleInvoiceId ? invoices.find((x) => x.id === editingSaleInvoiceId) : null;
            if (edited) {
                const oldType = ['cash','debt','partial','multi'].includes(edited.paymentType) ? edited.paymentType : (Number(edited.remainingAmount || 0) > 0 ? (Number(edited.paidAmount || 0) > 0 ? 'partial' : 'debt') : 'cash');
                setPaymentType(oldType);
                setCashGiven(String(oldType === 'cash' ? grandTotal : Number(edited.paidAmount || 0)));
                setNotes(edited.notes || '');
                setSelectedAccountId(edited.payments?.[0]?.accountId || defaultAccountId);
                setMultiRows(Array.isArray(edited.payments) && edited.payments.length ? edited.payments.map((p) => ({ accountId:p.accountId, method:p.method || 'cash', amount:Number(p.amount || 0) })) : [{ accountId: defaultAccountId, method: 'cash', amount: grandTotal }]);
            } else {
                setPaymentType('cash');
                setCashGiven(grandTotal.toString());
                setNotes('');
                setSelectedAccountId(defaultAccountId);
                setMultiRows([{ accountId: defaultAccountId, method: 'cash', amount: grandTotal }]);
            }
        }
    }, [isOpen, grandTotal, accounts, editingSaleInvoiceId, invoices]);
    useEffect(() => { if (!embedded) return; if(paymentType==='cash') setCashGiven(String(grandTotal)); }, [embedded,grandTotal,paymentType]);
    useEffect(() => { if (!embedded || !editingSaleInvoiceId) return; const edited=invoices.find(i=>i.id===editingSaleInvoiceId);if(edited){setPaymentType(edited.paymentType||'cash');setCashGiven(String(edited.paidAmount||0));setNotes(edited.notes||'');setMultiRows(edited.payments||[]);setSelectedAccountId(edited.payments?.[0]?.accountId||defaultAccountId);} },[embedded,editingSaleInvoiceId]);
    useEffect(() => { if(!embedded) return; if(!cart.length){setPaymentType('cash');setCashGiven('0');setNotes('');setSelectedAccountId(defaultAccountId);setMultiRows([{accountId:defaultAccountId,method:'cash',amount:0}]);} },[embedded,cart.length,defaultAccountId]);
    useEffect(() => { if(embedded && paymentType!=='multi' && !editingSaleInvoiceId) setMultiRows([{accountId:defaultAccountId,method:accounts.find(a=>a.id===defaultAccountId)?.type||'cash',amount:grandTotal}]); },[embedded,grandTotal,paymentType,defaultAccountId]);
    useEffect(() => { if(embedded && !selectedAccountId && defaultAccountId)setSelectedAccountId(defaultAccountId); },[embedded,defaultAccountId,selectedAccountId]);
    const [summaryTarget,setSummaryTarget]=useState(null);
    const [showDiscount,setShowDiscount]=useState(false);
    const [accountTarget,setAccountTarget]=useState(null);
    useEffect(()=>setAccountTarget(accountContainer),[accountContainer]);
    const [notesTarget,setNotesTarget]=useState(null);
    const [returnMode,setReturnMode]=useState(false);
    useEffect(()=>{if(!embedded)return;const timer=setTimeout(()=>{setNotesTarget(document.getElementById('ct-invoice-notes-target'))},0);return()=>clearTimeout(timer)},[embedded]);
    useEffect(()=>{if(!cart.length)setReturnMode(false)},[cart.length]);
    const [paymentDialog,setPaymentDialog]=useState(null);
    const [draftPaid,setDraftPaid]=useState('');
    const [draftAccount,setDraftAccount]=useState('');
    const [draftRows,setDraftRows]=useState([]);
    const [draftDiscountType,setDraftDiscountType]=useState('fixed');
    const [draftDiscountValue,setDraftDiscountValue]=useState(0);
    useEffect(()=>{if(!embedded)return;const add=()=>setShowQuickCustModal(true);window.addEventListener('ct-quick-customer',add);return()=>window.removeEventListener('ct-quick-customer',add)},[embedded]);
    useEffect(()=>{if(!paymentDialog&&!showDiscount)return;const close=e=>{if(e.key==='Escape'){e.preventDefault();setPaymentDialog(null);setShowDiscount(false)}};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[paymentDialog,showDiscount]);
    useEffect(()=>{if(embedded)setSummaryTarget(document.getElementById('ct-summary-target'));},[embedded]);
    if (!isOpen)
        return null;
    const numCashGiven = embedded && paymentType==='cash' ? grandTotal : (parseFloat(cashGiven) || 0);
    const change = Math.max(0, numCashGiven - grandTotal);
    const remainingDebt = Math.max(0, grandTotal - numCashGiven);
    const handleQuickAddCustomer = async (e) => {
        e.preventDefault();
        if (!newCustName.trim())
            return;
        const newCust = {
            id: 'cust-' + Date.now(),
            name: newCustName.trim(),
            phone: newCustPhone.trim(),
            balance: 0,
            creditLimit: 1000,
            priceList: 'retail',
            createdAt: new Date().toISOString(),
        };
        await saveCustomer(newCust);
        setSelectedCustomer(newCust);
        setShowQuickCustModal(false);
        setNewCustName('');
        setNewCustPhone('');
    };
    const handleAddQuickCash = (amount) => {
        setCashGiven(amount.toString());
    };
    const handleIncrementCash = (step) => {
        const cur = parseFloat(cashGiven) || 0;
        setCashGiven((cur + step).toString());
    };
    const handleSubmit = async () => {
        if (isSubmitting || !cart.length)
            return;
        if ((paymentType === 'debt' || paymentType === 'partial') && (!selectedCustomer || selectedCustomer.id === 'cust-walkin')) {
            showToast('يجب اختيار عميل مسجل لإجراء البيع الآجل أو الجزئي', 'error');
            return;
        }
        if ((paymentType === 'cash' || paymentType === 'partial') && !selectedAccountId) {
            showToast('اختر صندوق / حساب الدفع أولاً', 'warning');
            return;
        }
        if (['cash','partial'].includes(paymentType) && (!Number.isFinite(Number(cashGiven)) || numCashGiven < 0)) {showToast('أدخل مبلغاً صحيحاً غير سالب','error');return;}
        if(paymentType==='cash' && numCashGiven<grandTotal){showToast('المبلغ أقل من الإجمالي، اختر الدفع الجزئي','warning');return;}
        if(paymentType==='partial' && numCashGiven>grandTotal){showToast('الدفع الجزئي لا يتجاوز إجمالي الفاتورة','warning');return;}
        const splitTotal=multiRows.reduce((s,r)=>s+Number(r.amount||0),0);
        if(paymentType==='multi' && (multiRows.some(r=>!Number.isFinite(Number(r.amount)) || Number(r.amount)<0 || (Number(r.amount)>0&&!accounts.some(a=>a.id===r.accountId))) || splitTotal>grandTotal+0.005)){showToast('تحقق من مبالغ وحسابات الدفع المتعدد','error');return;}
        if(paymentType==='multi' && splitTotal<grandTotal-0.005 && (!selectedCustomer || selectedCustomer.id==='cust-walkin')){showToast('اختر عميلاً مسجلاً لحفظ المبلغ المتبقي كدين','warning');return;}
        setIsSubmitting(true);
        try {
            let paidAmount = 0;
            let payments = [];
            if (paymentType === 'cash') {
                paidAmount = Math.min(numCashGiven, grandTotal);
                payments = [
                    {
                        method: accounts.find((a) => a.id === selectedAccountId)?.type || 'cash',
                        amount: paidAmount,
                        accountId: selectedAccountId,
                        accountName: accounts.find((a) => a.id === selectedAccountId)?.name || 'الصندوق',
                    },
                ];
            }
            else if (paymentType === 'debt') {
                paidAmount = 0;
                payments = [];
            }
            else if (paymentType === 'partial') {
                paidAmount = numCashGiven;
                payments = [
                    {
                        method: accounts.find((a) => a.id === selectedAccountId)?.type || 'cash',
                        amount: paidAmount,
                        accountId: selectedAccountId,
                        accountName: accounts.find((a) => a.id === selectedAccountId)?.name || 'الصندوق',
                    },
                ];
            }
            else if (paymentType === 'multi') {
                paidAmount = multiRows.reduce((s, r) => s + (r.amount || 0), 0);
                payments = multiRows.map((r) => ({
                    method: r.method,
                    amount: r.amount,
                    accountId: r.accountId,
                    accountName: accounts.find((a) => a.id === r.accountId)?.name || '',
                }));
            }
            const savePayload = { paymentType, paidAmount, payments, notes, additionalCharges: Math.max(0, Number(invoiceAdditionalCharges)||0) };
            const inv = returnMode ? await createCartReturnInvoice(savePayload) : editingSaleInvoiceId
                ? await updateSaleInvoice(editingSaleInvoiceId, savePayload)
                : await createSaleInvoice(savePayload);
            if (inv) {
                if (!returnMode && activeRestaurantOrder?.id) {
                    try { await closeOrderAfterPayment(activeRestaurantOrder.id, inv.id); } catch (e) { console.warn('Restaurant close after payment warning', e); }
                }
                // Open the receipt from the already-saved local invoice first, then close payment.
                // This prevents a slow refresh/sync from swallowing the print action.
                if ((settings.printOnSave ?? settings.autoPrintReceipt)) setShowThermalModal(inv);
                try { onSuccess?.(); } catch (e) { console.warn('Payment success callback warning', e); }
                onClose?.();
            }
        }
        catch (err) {
            console.error('Payment save failed:', err);
            showToast(`تعذر إتمام الفاتورة: ${String(err?.message || err || 'خطأ غير معروف')}`, 'error');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    if(embedded){
      const h=React.createElement;
      const paid=paymentType==='debt'?0:paymentType==='multi'?multiRows.reduce((sum,r)=>sum+Number(r.amount||0),0):numCashGiven;
      const debt=Math.max(0,grandTotal-paid);
      const customerOptions=[{id:'cust-walkin',label:t("عميل نقدي")},...customers.filter(c=>c&&c.id!=='cust-walkin'&&!c.deletedAt).map(c=>({id:c.id,label:c.name,subLabel:c.phone}))];
      if(selectedCustomer?.id&&!customerOptions.some(c=>c.id===selectedCustomer.id))customerOptions.push({id:selectedCustomer.id,label:selectedCustomer.name});
      const chooseCustomer=id=>setSelectedCustomer(id==='cust-walkin'?{id:'cust-walkin',name:'عميل نقدي',balance:0,isVirtual:true}:customers.find(c=>c.id===id)||selectedCustomer);
      const field=(label,child)=>h('label',{className:'ct-compact-field'},h('span',null,label),child);
      const openPayment=type=>{if(type==='debt'){setPaymentType(paymentType==='debt'?'cash':'debt');return}setDraftPaid(paymentType==='partial'?cashGiven:'');setDraftAccount(selectedAccountId||defaultAccountId);setDraftRows(multiRows.map(r=>({...r})));setPaymentDialog(type)};
      const mode=(type,label)=>h('button',{type:'button',className:`ct-mode ${paymentType===type?'active':''}`,'aria-pressed':paymentType===type,onClick:()=>openPayment(type)},h(type==='multi'?Split:type==='partial'?Coins:Clock,{size:15}),label);
      const modes=h('div',{className:'ct-top-payment-modes'},mode('debt','آجل'),mode('multi','دفع متعدد'),mode('partial','دفع جزئي'),h('button',{type:'button',className:`ct-mode ${invoiceDiscountAmount>0?'active':''}`,onClick:()=>{setDraftDiscountType(invoiceDiscountType);setDraftDiscountValue(invoiceDiscountValue);setShowDiscount(true)}},t("الخصم")));
      const draftTotal=draftRows.reduce((sum,r)=>sum+Number(r.amount||0),0);
      const applyPayment=e=>{e.preventDefault();const amount=paymentDialog==='multi'?draftTotal:Number(draftPaid);if(!Number.isFinite(amount)||amount<0||amount>grandTotal+0.005||(paymentDialog==='partial'&&draftPaid.trim()==='')||(paymentDialog==='multi'&&draftRows.some(r=>!Number.isFinite(Number(r.amount))||Number(r.amount)<0))){showToast('أدخل مبلغاً صحيحاً بين صفر وإجمالي الفاتورة','error');return}if(paymentDialog==='partial'){if(!draftAccount){showToast('اختر الحساب أو الصندوق','warning');return}setCashGiven(String(amount));setSelectedAccountId(draftAccount)}else setMultiRows(draftRows);setPaymentType(paymentDialog);setPaymentDialog(null)};
      const dialog=(title,content,onSubmit,onClose)=>h(ModalLayer,{className:'ct-payment-dialog-layer',onClick:e=>{if(e.target===e.currentTarget)onClose()}},h('form',{className:'ct-payment-dialog',onSubmit,onKeyDown:e=>{if(e.key==='Enter')e.stopPropagation()},onClick:e=>e.stopPropagation()},h('header',null,h('strong',null,title),h('button',{type:'button','aria-label':t("إغلاق"),onClick:onClose},h(X,{size:19}))),h('div',{className:'ct-payment-dialog-body'},content),h('footer',null,h('button',{type:'button',onClick:onClose},t("إلغاء")),h('button',{type:'submit',className:'ct-apply-payment'},t("تطبيق")))));
      const paymentPopup=paymentDialog&&dialog(paymentDialog==='multi'?'الدفع المتعدد':'الدفع الجزئي',h(React.Fragment,null,h('div',{className:'ct-dialog-required'},'المبلغ المطلوب',h('strong',null,`${grandTotal.toFixed(2)} ${settings.currencySymbol}`)),paymentDialog==='multi'?h('div',{className:'ct-account-payment-rows'},...accounts.map((acc,index)=>h('label',{key:acc.id},h('span',null,acc.name),h('input',{'aria-label':`المبلغ المدفوع - ${acc.name}`,autoFocus:index===0,type:'number',min:0,step:'any',placeholder:'0.00',value:draftRows.find(r=>r.accountId===acc.id)?.amount??'',onChange:e=>{const amount=e.target.value===''?0:Number(e.target.value);setDraftRows(prev=>[...prev.filter(r=>r.accountId!==acc.id),{accountId:acc.id,method:acc.type||'cash',amount}])}})))):h(React.Fragment,null,field('المبلغ المدفوع',h('input',{autoFocus:true,'aria-label':'المبلغ المدفوع جزئياً',type:'number',min:0,max:grandTotal,step:'any',required:true,value:draftPaid,onChange:e=>setDraftPaid(e.target.value)})),h(SearchableDropdown,{id:'partial-payment-account',label:t("الحساب / الصندوق"),options:accounts.map(a=>({id:a.id,label:a.name})),selectedId:draftAccount,onSelect:setDraftAccount})),h('div',{className:'ct-dialog-debt'},'المتبقي كدين',h('strong',null,`${Math.max(0,grandTotal-(paymentDialog==='multi'?draftTotal:Number(draftPaid)||0)).toFixed(2)} ${settings.currencySymbol}`))),applyPayment,()=>setPaymentDialog(null));
      const discountPopup=showDiscount&&dialog('خصم الفاتورة',h('div',{className:'ct-discount-row'},h(SearchableDropdown,{id:'invoice-discount-kind',label:t("نوع الخصم"),options:[{id:'fixed',label:t("خصم مبلغ")},{id:'percent',label:t("خصم %")}],selectedId:draftDiscountType,onSelect:setDraftDiscountType}),h('input',{'aria-label':t("قيمة الخصم"),type:'number',min:0,step:'any',autoFocus:true,value:draftDiscountValue,onChange:e=>setDraftDiscountValue(Math.max(0,Number(e.target.value)||0))}),h('span',null,`${(draftDiscountType==='percent'?Math.min(beforeInvoiceDiscount,beforeInvoiceDiscount*Math.min(100,Number(draftDiscountValue)||0)/100):Math.min(beforeInvoiceDiscount,Number(draftDiscountValue)||0)).toFixed(2)} ${settings.currencySymbol}`)),e=>{e.preventDefault();setInvoiceDiscountType(draftDiscountType);setInvoiceDiscountValue(draftDiscountValue);setShowDiscount(false)},()=>setShowDiscount(false));
      return h(React.Fragment,null,accountTarget?createPortal(h(SearchableDropdown,{id:'desktop-payment-account',label:'صندوق الدفع',options:accounts.map(a=>({id:a.id,label:a.name})),selectedId:selectedAccountId,onSelect:id=>{setSelectedAccountId(id);setPaymentType('cash')}}),accountTarget):null,notesTarget?createPortal(h('label',{className:'ct-outlined-field'},h('span',null,t("ملاحظات")),h('input',{'aria-label':t("ملاحظات الفاتورة"),value:notes,onChange:e=>setNotes(e.target.value),placeholder:t("ملاحظات الفاتورة")})),notesTarget):null,summaryTarget?createPortal(modes,summaryTarget):null,paymentPopup,discountPopup,h('div',{id:'desktop-payment',className:'ct-compact-payment'},h('div',{className:'ct-payment-scroll'},controls,
        footerControls),
        h('div',{className:'ct-compact-sell'},h('div',{className:'ct-sale-totals'},...[[ 'الإجمالي',grandTotal,'total'],['المدفوع',Math.min(paid,grandTotal),'paid'],['المتبقي',debt,'debt']].map(([label,value,cls])=>h('div',{key:cls,className:cls},h('span',null,label),h('strong',null,`${value.toFixed(2)} ${settings.currencySymbol}`)))),paid>grandTotal&&h('small',null,`الباقي للعميل: ${(paid-grandTotal).toFixed(2)} ${settings.currencySymbol}`),h('div',{className:'ct-sell-actions'},h('button',{type:'button',className:`ct-return-toggle ${returnMode?'active':''}`,'aria-pressed':returnMode,title:t("مرتجع أصناف السلة"),disabled:isSubmitting||!cart.length||!!editingSaleInvoiceId,onClick:()=>setReturnMode(!returnMode)},h(RotateCcw,{size:17}),returnMode?t("عودة للبيع"):t("مرتجع")),h('button',{id:'btn-confirm-payment',type:'button','data-ct-sell':true,'data-enter-primary':true,disabled:isSubmitting||!cart.length||!!paymentDialog||showDiscount||showQuickCustModal,onClick:handleSubmit},h(CheckCircle2,{size:16}),isSubmitting?'جارٍ الحفظ...':returnMode?'حفظ المرتجع [Enter]':t("بيع وحفظ [Enter]"))))),
        showQuickCustModal&&h(ModalLayer,{className:'fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4',role:'dialog','aria-modal':true},h('form',{className:'ct-quick-customer',onSubmit:handleQuickAddCustomer},h('strong',null,t("إضافة عميل")),h('input',{required:true,placeholder:t("اسم العميل"),value:newCustName,onChange:e=>setNewCustName(e.target.value)}),h('input',{placeholder:t("رقم الهاتف"),value:newCustPhone,onChange:e=>setNewCustPhone(e.target.value)}),h('div',null,h('button',{type:'button',onClick:()=>setShowQuickCustModal(false)},t("إلغاء")),h('button',{type:'submit'},t("حفظ"))))));
    }
    return (_jsxs(ModalLayer, { id: embedded ? "desktop-payment" : "modal-payment-backdrop", className: embedded ? "ct-payment-inline" : "fixed inset-0 z-[65] flex items-center justify-center bg-black/70 p-4 animate-in fade-in", children: [_jsxs("div", { id: embedded ? "desktop-payment-box" : "modal-payment-box", className: embedded ? "ct-payment-box" : "w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right flex flex-col max-h-[95vh]", children: [controls, _jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-base font-black text-slate-900 dark:text-white", children: "\u0625\u062a\u0645\u0627\u0645 \u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u062f\u0641\u0639" }), _jsx("p", { className: "text-xs text-slate-500", children: "\u0627\u062e\u062a\u0631 \u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0633\u062f\u0627\u062f \u0648\u0623\u0643\u062f \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629" })] }), _jsx("button", { onClick: onClose, className: "p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-4 space-y-4 overflow-y-auto flex-1 custom-scrollbar", children: [_jsxs("div", { className: "p-4 rounded-xl bg-slate-900 text-white flex items-center justify-between shadow-inner", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs font-semibold text-slate-400", children: t("الصافي المطلوب:") }), _jsxs("div", { className: "text-3xl font-black tracking-tight text-violet-400 mt-0.5", children: [grandTotal.toFixed(2), " ", _jsx("span", { className: "text-sm font-normal text-white", children: settings.currencySymbol })] })] }), _jsxs("div", { className: "text-left text-xs text-slate-400", children: [_jsxs("div", { children: ["\u0639\u062f\u062f \u0627\u0644\u0623\u0635\u0646\u0627\u0641: ", cart.length] }), _jsxs("div", { id: "payment-invoice-discount", className: embedded ? "ct-discount" : "hidden", children: [_jsx("span", { className: "text-[11px] font-bold text-slate-600", children: "\u062e\u0635\u0645 \u0643\u0627\u0645\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629" }), _jsxs("div", { className: "inline-flex rounded-lg overflow-hidden border bg-white", children: [_jsx("button", { type: "button", onClick: () => setInvoiceDiscountType('fixed'), className: `px-2 py-1 text-[10px] font-bold ${invoiceDiscountType === 'fixed' ? 'bg-violet-600 text-white' : 'text-slate-600'}`, children: t("ثابت") }), _jsx("button", { type: "button", onClick: () => setInvoiceDiscountType('percent'), className: `px-2 py-1 text-[10px] font-bold ${invoiceDiscountType === 'percent' ? 'bg-violet-600 text-white' : 'text-slate-600'}`, children: "%" })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("input", { type: "number", min: "0", step: "any", value: invoiceDiscountValue, onChange: (e) => setInvoiceDiscountValue(parseFloat(e.target.value) || 0), className: "w-full px-2 py-1.5 text-xs font-mono font-bold border rounded-lg bg-white" }), _jsxs("span", { className: "text-[10px] text-rose-600 whitespace-nowrap", children: ["\u062e\u0635\u0645 ", invoiceDiscountAmount.toFixed(2)] })] })] }), _jsxs("div", { children: ["\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0642\u0637\u0639: ", cart.reduce((s, i) => s + i.quantity, 0)] })] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5", children: t("طريقة الدفع:") }), _jsxs("div", { className: "grid grid-cols-4 gap-2", children: [_jsxs("button", { type: "button", onClick: () => setPaymentType('cash'), className: `flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-bold transition ${paymentType === 'cash'
                                                    ? 'border-violet-600 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`, children: [_jsx(Banknote, { className: "w-5 h-5 mb-1" }), _jsx("span", { children: t("نقدي (كاش)") })] }), _jsxs("button", { type: "button", onClick: () => setPaymentType('debt'), className: `flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-bold transition ${paymentType === 'debt'
                                                    ? 'border-rose-600 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`, children: [_jsx(Clock, { className: "w-5 h-5 mb-1" }), _jsx("span", { children: t("آجل (دين)") })] }), _jsxs("button", { type: "button", onClick: () => setPaymentType('partial'), className: `flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-bold transition ${paymentType === 'partial'
                                                    ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`, children: [_jsx(Coins, { className: "w-5 h-5 mb-1" }), _jsx("span", { children: t("دفع جزئي") })] }), _jsxs("button", { type: "button", onClick: () => setPaymentType('multi'), className: `flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-bold transition ${paymentType === 'multi'
                                                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'}`, children: [_jsx(Split, { className: "w-5 h-5 mb-1" }), _jsx("span", { children: t("دفع متعدد") })] })] })] }), _jsxs("div", { children: [_jsx(SearchableDropdown, { id: "payment-customer-dropdown", label: t("العميل:"), placeholder: "\u0627\u062e\u062a\u0631 \u0627\u0644\u0639\u0645\u064a\u0644...", options: [{ id:'cust-walkin', label:t("عميل نقدي"), subLabel:'الافتراضي للبيع النقدي المباشر' }, ...customers.filter((c)=>c && c.id!=='cust-walkin' && !c.deletedAt).map((c) => ({
                                            id: c.id,
                                            label: c.name,
                                            subLabel: c.phone || 'بدون هاتف',
                                            badge: c.balance > 0 ? `عليه: ${c.balance} ${settings.currencySymbol}` : undefined,
                                        }))], selectedId: selectedCustomer?.id, onSelect: (id) => {
                                            if (id === 'cust-walkin') setSelectedCustomer({ id:'cust-walkin', name:'عميل نقدي', balance:0, priceList:'retail', isVirtual:true });
                                            else { const found = customers.find((c) => c.id === id); if (found) setSelectedCustomer(found); }
                                        }, onQuickAdd: () => setShowQuickCustModal(true), quickAddLabel: "+ \u0639\u0645\u064a\u0644 \u062c\u062f\u064a\u062f" }), paymentType !== 'cash' && selectedCustomer?.id === 'cust-walkin' && (_jsxs("p", { className: "mt-1 text-[11px] text-rose-500 font-medium flex items-center gap-1", children: [_jsx(AlertCircle, { className: "w-3.5 h-3.5" }), "\u062a\u0646\u0628\u064a\u0647: \u064a\u062c\u0628 \u0627\u062e\u062a\u064a\u0627\u0631 \u0639\u0645\u064a\u0644 \u0645\u0633\u062c\u0644 \u0644\u0644\u0622\u062c\u0644 \u0623\u0648 \u0627\u0644\u062f\u0641\u0639 \u0627\u0644\u062c\u0632\u0626\u064a"] }))] }), (paymentType === 'cash' || paymentType === 'partial') && (_jsxs("div", { className: "space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800", children: [_jsx(SearchableDropdown, { id: "payment-account-dropdown", label: "صندوق / حساب الدفع:", placeholder: "اختر الصندوق أو الحساب...", options: accounts.map((a) => ({ id: a.id, label: a.name, subLabel: `${a.isDefault ? '★ الافتراضي • ' : ''}الرصيد: ${Number(a.balance || 0).toFixed(2)} ${settings.currencySymbol}` })), selectedId: selectedAccountId, onSelect: setSelectedAccountId }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300", children: paymentType === 'cash' ? 'المبلغ المستلم من الزبون:' : 'المبلغ المدفوع مقدماً:' }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { type: "button", onClick: () => handleAddQuickCash(grandTotal), className: "px-2 py-0.5 rounded bg-violet-100 text-violet-800 text-[11px] font-bold hover:bg-violet-200", children: "\u0628\u0627\u0644\u0636\u0628\u0637" }), _jsx("button", { type: "button", onClick: () => handleIncrementCash(10), className: "px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold hover:bg-slate-300", children: "+10" }), _jsx("button", { type: "button", onClick: () => handleIncrementCash(50), className: "px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold hover:bg-slate-300", children: "+50" }), _jsx("button", { type: "button", onClick: () => handleIncrementCash(100), className: "px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-bold hover:bg-slate-300", children: "+100" })] })] }), _jsx("input", { type: "number", step: "any", id: "cash-received-input", value: cashGiven, onChange: (e) => setCashGiven(e.target.value), className: "w-full px-3 py-2 text-xl font-mono font-bold text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-violet-500 text-left" }), _jsxs("div", { className: "grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700", children: [_jsxs("div", { className: "p-2 rounded-lg bg-violet-50/60 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40", children: [_jsx("span", { className: "text-[11px] text-violet-800 dark:text-violet-300 font-semibold block", children: "\u0627\u0644\u0628\u0627\u0642\u064a \u0644\u0644\u0632\u0628\u0648\u0646 (\u0627\u0644\u0641\u0643\u0629):" }), _jsxs("div", { className: "text-lg font-black text-violet-700 dark:text-violet-400 font-mono", children: [change.toFixed(2), " ", settings.currencySymbol] })] }), _jsxs("div", { className: "p-2 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40", children: [_jsx("span", { className: "text-[11px] text-rose-800 dark:text-rose-300 font-semibold block", children: "\u0627\u0644\u0645\u062a\u0628\u0642\u064a \u0639\u0644\u064a\u0647 (\u062f\u064a\u0646):" }), _jsxs("div", { className: "text-lg font-black text-rose-700 dark:text-rose-400 font-mono", children: [remainingDebt.toFixed(2), " ", settings.currencySymbol] })] })] })] })), paymentType === 'multi' && (_jsxs("div", { className: "space-y-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800", children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block", children: "\u062a\u0648\u0632\u064a\u0639 \u0627\u0644\u0645\u0628\u0627\u0644\u063a \u0639\u0644\u0649 \u0627\u0644\u062d\u0633\u0627\u0628\u0627\u062a:" }), accounts.map((acc) => {
                                        const row = multiRows.find((r) => r.accountId === acc.id);
                                        return (_jsxs("div", { className: "flex items-center justify-between gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700", children: [_jsx("span", { className: "text-xs font-semibold", children: acc.name }), _jsx("input", { type: "number", step: "any", placeholder: "0.00", value: row ? row.amount : '', onChange: (e) => {
                                                        const val = parseFloat(e.target.value) || 0;
                                                        setMultiRows((prev) => {
                                                            const rest = prev.filter((r) => r.accountId !== acc.id);
                                                            return val > 0 ? [...rest, { accountId: acc.id, method: acc.type, amount: val }] : rest;
                                                        });
                                                    }, className: "w-28 px-2 py-1 text-xs font-mono font-bold text-left rounded border border-slate-200 dark:border-slate-700" })] }, acc.id));
                                    })] })), _jsx("div", { children: _jsx("input", { type: "text", value: notes, onChange: (e) => setNotes(e.target.value), placeholder: "\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0639\u0644\u0649 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 (\u0627\u062e\u062a\u064a\u0627\u0631\u064a)...", className: "w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none" }) })] }), _jsxs("div", { className: "p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3", children: [_jsx("button", { type: "button", onClick: onClose, className: "px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition", children: t("إلغاء") }), _jsxs("button",{type:'button',className:'ct-mobile-return-toggle',disabled:!cart.length||isSubmitting||!!editingSaleInvoiceId,'aria-pressed':returnMode,onClick:()=>setReturnMode(v=>!v),children:[_jsx(RotateCcw,{size:18}),returnMode?t("عودة للبيع"):t("مرتجع")]}), _jsxs("button", { type: "button", id: "btn-confirm-payment", "data-enter-primary": "true", disabled: isSubmitting || !cart.length, onClick: handleSubmit, "data-ct-sell": embedded ? "true" : undefined, className: "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-md shadow-violet-600/20 transition disabled:opacity-50", children: [_jsx(CheckCircle2, { className: "w-4 h-4" }), _jsx("span", { children: returnMode ? t("حفظ وطباعة المرتجع [Enter]") : embedded ? t("بيع وحفظ الفاتورة [Enter]") : t("تأكيد وطباعة الفاتورة [Enter]") })] })] })] }), showQuickCustModal && (_jsx(ModalLayer, { className: "fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4", children: _jsxs("form", { onSubmit: handleQuickAddCustomer, className: "w-full max-w-xs bg-white dark:bg-slate-900 p-4 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-3", children: [_jsx("h4", { className: "font-bold text-sm text-slate-900 dark:text-white", children: "\u0625\u0636\u0627\u0641\u0629 \u0639\u0645\u064a\u0644 \u0633\u0631\u064a\u0639" }), _jsx("input", { type: "text", placeholder: t("اسم العميل *"), value: newCustName, onChange: (e) => setNewCustName(e.target.value), required: true, className: "w-full px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:border-violet-500 bg-white dark:bg-slate-800" }), _jsx("input", { type: "text", placeholder: t("رقم الهاتف"), value: newCustPhone, onChange: (e) => setNewCustPhone(e.target.value), className: "w-full px-3 py-1.5 text-xs border rounded-lg focus:outline-none focus:border-violet-500 bg-white dark:bg-slate-800" }), _jsxs("div", { className: "flex justify-end gap-2 pt-1", children: [_jsx("button", { type: "button", onClick: () => setShowQuickCustModal(false), className: "px-3 py-1 text-xs text-slate-500", children: t("إلغاء") }), _jsx("button", { type: "submit", className: "px-3 py-1 bg-violet-600 text-white rounded-lg text-xs font-bold", children: t("حفظ العميل") })] })] }) }))] }));
};
