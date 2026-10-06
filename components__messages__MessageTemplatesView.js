import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React,{useMemo,useState} from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { createCustomerPortalLinks } from './services__customerPortalLinks.js?v=7.9.4.136-localization';
import { Save, Send, UserRound, ReceiptText, Link2, Copy, MessageSquareText } from 'lucide-react';

const h=React.createElement;
const DEFAULTS={
  invoiceWhatsApp:`مرحباً {customer_name} 👋\nتم إصدار فاتورتك رقم {invoice_no} من {store_name}.\n\nالإجمالي: {invoice_total} {currency}\nالمدفوع: {paid_amount} {currency}\nالمتبقي: {remaining_amount} {currency}\n\nرابط السداد:\n{payment_link}\n\nشكراً لتعاملكم معنا.`,
  invoiceSms:`{store_name} - فاتورة {invoice_no}\nالإجمالي {invoice_total} {currency}، المتبقي {remaining_amount} {currency}.\nللسداد: {payment_link}`,
  customerWhatsApp:`مرحباً {customer_name} 👋\nرصيدك الحالي لدى {store_name}: {balance} {currency}.\n\nيمكنك السداد ومتابعة حسابك من الرابط:\n{payment_link}\n\nشكراً لك.`,
  customerSms:`{store_name}: رصيدك الحالي {balance} {currency}. للسداد: {payment_link}`,
};
const INVOICE_VARS=[
 {label:'اسم المتجر',token:'{store_name}'},{label:t("اسم العميل"),token:'{customer_name}'},{label:'رقم هاتف العميل',token:'{customer_phone}'},
 {label:t("رقم الفاتورة"),token:'{invoice_no}'},{label:'تاريخ الفاتورة',token:'{invoice_date}'},{label:'إجمالي الفاتورة',token:'{invoice_total}'},
 {label:t("المبلغ المدفوع"),token:'{paid_amount}'},{label:'المبلغ المتبقي',token:'{remaining_amount}'},{label:t("العملة"),token:'{currency}'},
 {label:'رابط السداد',token:'{payment_link}'},{label:'رابط صفحة العميل',token:'{customer_link}'}
];
const CUSTOMER_VARS=[
 {label:'اسم المتجر',token:'{store_name}'},{label:t("اسم العميل"),token:'{customer_name}'},{label:'رقم هاتف العميل',token:'{customer_phone}'},
 {label:'رصيد العميل',token:'{balance}'},{label:t("العملة"),token:'{currency}'},{label:'رابط السداد',token:'{payment_link}'},
 {label:'رابط صفحة العميل',token:'{customer_link}'},{label:'كود العميل',token:'{customer_code}'}
];
const money=v=>Number(v||0).toFixed(2);
const phoneDigits=value=>{
  let s=String(value||'').trim().replace(/[^0-9+]/g,'');
  if(s.startsWith('00'))s='+'+s.slice(2);
  if(s.startsWith('+'))return s;
  const d=s.replace(/\D/g,'');
  if(/^0\d{8,10}$/.test(d))return '+970'+d.slice(1);
  return d?`+${d}`:'';
};
const applyVars=(template,vars)=>String(template||'').replace(/\{[a-z0-9_]+\}/gi,m=>Object.prototype.hasOwnProperty.call(vars,m)?String(vars[m]??''):m);
const dateText=v=>{try{return new Date(v||Date.now()).toLocaleDateString('ar-EG-u-nu-latn')}catch{return ''}};

const WhatsAppSvg=()=>h('svg',{viewBox:'0 0 24 24',className:'w-5 h-5 block',fill:'none','aria-hidden':'true',style:{display:'block',margin:'0'}},
  h('path',{d:'M20.5 11.7A8.5 8.5 0 0 1 7.9 19.1L3.5 20.5l1.4-4.2A8.5 8.5 0 1 1 20.5 11.7Z',stroke:'currentColor',strokeWidth:'1.8',strokeLinejoin:'round'}),
  h('path',{d:'M8.2 7.7c.3-.4.6-.4.9-.2l1.1 1.6c.2.3.1.6-.1.9l-.6.7c.7 1.4 1.9 2.5 3.4 3.1l.7-.8c.2-.3.5-.4.8-.2l1.7.9c.3.2.4.5.3.8-.3 1.1-1.3 1.8-2.5 1.8-3.6-.1-7.3-3.4-7.5-7.1 0-.6.2-1.1.5-1.5Z',fill:'currentColor'})
);
const SmsSvg=()=>h('svg',{viewBox:'0 0 24 24',className:'w-5 h-5 block',fill:'none','aria-hidden':'true',style:{display:'block',margin:'0'}},
  h('rect',{x:'3',y:'4',width:'18',height:'14',rx:'3',stroke:'currentColor',strokeWidth:'1.8'}),
  h('path',{d:'m6 8 6 4 6-4M8 20h8',stroke:'currentColor',strokeWidth:'1.8',strokeLinecap:'round',strokeLinejoin:'round'})
);

export const MessageTemplatesView=()=>{
  const {settings,updateSettings,customers,invoices,saveCustomer,showToast}=useApp();
  const saved=settings.messageTemplates||{};
  const [draft,setDraft]=useState(()=>({...DEFAULTS,...saved}));
  const [invoiceId,setInvoiceId]=useState('');
  const [customerId,setCustomerId]=useState('');
  const [activeField,setActiveField]=useState('invoiceWhatsApp');
  const [busy,setBusy]=useState('');
  const liveCustomers=useMemo(()=>customers.filter(x=>!x.deletedAt),[customers]);
  const sales=useMemo(()=>invoices.filter(x=>!x.deletedAt&&x.type!=='return').slice().sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0)),[invoices]);
  const selectedInvoice=sales.find(x=>x.id===invoiceId)||null;
  const invoiceCustomer=selectedInvoice?liveCustomers.find(c=>String(c.id)===String(selectedInvoice.customerId))||null:null;
  const selectedCustomer=liveCustomers.find(c=>c.id===customerId)||null;

  const saveTemplates=async()=>{await updateSettings({messageTemplates:draft});showToast('تم حفظ قوالب الرسائل','success');};
  const addVar=(v)=>setDraft(prev=>({...prev,[activeField]:`${prev[activeField]||''}${prev[activeField]?.endsWith(' ')?'':' '}${v}`}));
  const prepareLinks=async(customer)=>{
    if(!customer)throw new Error('اختر عميلاً مرتبطاً بالرسالة أولاً.');
    return createCustomerPortalLinks(customer,{saveCustomer});
  };
  const invoiceVars=async()=>{
    if(!selectedInvoice)throw new Error('اختر فاتورة أولاً.');
    if(!invoiceCustomer)throw new Error('الفاتورة غير مرتبطة بعميل مسجل.');
    const links=await prepareLinks(invoiceCustomer);
    return {
      '{store_name}':settings.storeName||'كاش توب 3','{customer_name}':invoiceCustomer.name||selectedInvoice.customerName||'عميل','{customer_phone}':invoiceCustomer.phone||'',
      '{invoice_no}':selectedInvoice.invoiceNumber||selectedInvoice.number||selectedInvoice.id||'', '{invoice_date}':dateText(selectedInvoice.date||selectedInvoice.createdAt),
      '{invoice_total}':money(selectedInvoice.grandTotal??selectedInvoice.total),'{paid_amount}':money(selectedInvoice.paidAmount),'{remaining_amount}':money(selectedInvoice.remainingAmount),
      '{currency}':settings.currencySymbol||'₪','{payment_link}':links.paymentUrl,'{customer_link}':links.portalUrl,
    };
  };
  const customerVars=async()=>{
    if(!selectedCustomer)throw new Error('اختر عميلاً أولاً.');
    const links=await prepareLinks(selectedCustomer);
    return {
      '{store_name}':settings.storeName||'كاش توب 3','{customer_name}':selectedCustomer.name||'عميل','{customer_phone}':selectedCustomer.phone||'',
      '{balance}':money(Math.max(0,Number(selectedCustomer.balance||0))),'{currency}':settings.currencySymbol||'₪','{payment_link}':links.paymentUrl,'{customer_link}':links.portalUrl,'{customer_code}':links.customerCode,
    };
  };
  const send=async(kind,channel)=>{
    const key=`${kind}${channel==='whatsapp'?'WhatsApp':'Sms'}`;
    setBusy(key);
    try{
      const vars=kind==='invoice'?await invoiceVars():await customerVars();
      const customer=kind==='invoice'?invoiceCustomer:selectedCustomer;
      const phone=phoneDigits(customer?.phone);
      if(!phone)throw new Error('العميل لا يملك رقم هاتف صالحاً.');
      const message=applyVars(draft[key],vars);
      if(channel==='whatsapp'){
        const digits=phone.replace(/\D/g,'');
        const url=`https://api.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`;
        window.location.assign(url);
      }else{
        location.href=`sms:${phone}?body=${encodeURIComponent(message)}`;
      }
    }catch(error){showToast(error?.message||'تعذر تجهيز الرسالة','error');}
    finally{setBusy('');}
  };
  const copyPreview=async(kind,channel)=>{
    try{
      const vars=kind==='invoice'?await invoiceVars():await customerVars();
      const key=`${kind}${channel==='whatsapp'?'WhatsApp':'Sms'}`;
      await navigator.clipboard.writeText(applyVars(draft[key],vars));showToast('تم نسخ الرسالة','success');
    }catch(error){showToast(error?.message||'تعذر نسخ الرسالة','error');}
  };
  const editor=(kind,title,vars,recordSelect)=>h('section',{className:'rounded-3xl bg-white border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4'},
    h('div',{className:'flex items-center gap-3 border-b pb-3'},h('div',{className:'w-10 h-10 rounded-2xl bg-violet-50 text-violet-700 grid place-items-center'},kind==='invoice'?h(ReceiptText,{className:'w-5 h-5'}):h(UserRound,{className:'w-5 h-5'})),h('div',null,h('h3',{className:'font-black text-slate-900'},title),h('p',{className:'text-[11px] text-slate-500 mt-0.5'},'غيّر النص كما تريد، والمتغيرات تُستبدل تلقائياً عند الإرسال.'))),
    recordSelect,
    h('div',{className:'rounded-2xl bg-slate-50 border p-3'},h('div',{className:'text-[11px] font-black text-slate-600 mb-2'},'المتغيرات المتاحة'),h('div',{className:'flex flex-wrap gap-1.5'},...vars.map(v=>h('button',{type:'button',key:v.token,onClick:()=>addVar(v.token),title:v.token,className:'px-2.5 py-1.5 rounded-lg bg-white border text-[10px] font-black text-violet-700 hover:bg-violet-50'},v.label)))),
    ...['WhatsApp','Sms'].map(channel=>{
      const key=`${kind}${channel}`;const isWa=channel==='WhatsApp';
      return h('div',{key,className:'rounded-2xl border border-slate-200 overflow-hidden'},
        h('div',{className:`px-3 py-2 flex items-center justify-between ${isWa?'bg-violet-50 text-violet-800':'bg-blue-50 text-blue-800'}`},h('div',{className:'flex items-center gap-2 font-black text-xs'},isWa?h(WhatsAppSvg):h(SmsSvg),isWa?'قالب WhatsApp':'قالب SMS'),h('span',{className:'text-[9px] font-bold opacity-70'},'قابل للتعديل')),
        h('textarea',{value:draft[key]||'',onFocus:()=>setActiveField(key),onChange:e=>setDraft({...draft,[key]:e.target.value}),rows:isWa?7:4,className:'w-full p-3 text-xs leading-6 bg-white resize-y outline-none',dir:'rtl'}),
        h('div',{className:'p-2.5 border-t flex flex-wrap gap-2 justify-end'},
          h('button',{type:'button',onClick:()=>copyPreview(kind,isWa?'whatsapp':'sms'),className:'inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-[10px] font-black text-slate-600'},h(Copy,{className:'w-3.5 h-3.5'}),'نسخ المعاينة'),
          h('button',{type:'button',disabled:!!busy,onClick:()=>send(kind,isWa?'whatsapp':'sms'),className:`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[10px] font-black disabled:opacity-50 ${isWa?'bg-violet-600':'bg-blue-600'}`},busy===key?h('span',{className:'w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin'}):h(Send,{className:'w-3.5 h-3.5'}),isWa?'فتح WhatsApp':'فتح الرسائل')
        )
      );
    })
  );

  return h('div',{className:'p-4 sm:p-6 max-w-5xl mx-auto space-y-5 text-right'},
    h('div',{className:'flex flex-col sm:flex-row sm:items-center justify-between gap-3'},h('div',null,h('div',{className:'flex items-center gap-2'},h(MessageSquareText,{className:'w-6 h-6 text-violet-600'}),h('h2',{className:'text-xl font-black'},t("قوالب الرسائل"))),h('p',{className:'text-xs text-slate-500 mt-1'},'قوالب جاهزة للفواتير والعملاء مع رابط سداد مختصر ومباشر.')),h('button',{type:'button',onClick:saveTemplates,className:'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-xs font-black'},h(Save,{className:'w-4 h-4'}),'حفظ القوالب')),
    h('div',{className:'rounded-2xl border border-violet-100 bg-violet-50/50 p-3 text-[11px] text-violet-900 leading-6'},h('div',{className:'font-black flex items-center gap-1.5'},h(Link2,{className:'w-4 h-4'}),'رابط الدفع المختصر'),h('div',null,'عند الإرسال ينشئ كاش توب 3 كود شركة من 5 خانات وكود عميل من 5 خانات، ويضع رابط السداد القصير داخل الرسالة تلقائياً.')),
    editor('invoice','قوالب رسائل الفواتير',INVOICE_VARS,h('select',{value:invoiceId,onChange:e=>setInvoiceId(e.target.value),className:'w-full px-3 py-2.5 rounded-xl border bg-white text-xs'},h('option',{value:''},'اختر فاتورة للإرسال...'),...sales.map(inv=>h('option',{key:inv.id,value:inv.id},`#${inv.invoiceNumber||inv.id} — ${inv.customerName||liveCustomers.find(c=>String(c.id)===String(inv.customerId))?.name||'عميل'} — ${money(inv.grandTotal)} ${settings.currencySymbol||'₪'}`)))),
    editor('customer','قوالب رسائل العملاء',CUSTOMER_VARS,h('select',{value:customerId,onChange:e=>setCustomerId(e.target.value),className:'w-full px-3 py-2.5 rounded-xl border bg-white text-xs'},h('option',{value:''},'اختر عميلاً للإرسال...'),...liveCustomers.map(c=>h('option',{key:c.id,value:c.id},`${c.name} — ${c.phone||'بدون هاتف'} — ${money(c.balance)} ${settings.currencySymbol||'₪'}`))))
  );
};
