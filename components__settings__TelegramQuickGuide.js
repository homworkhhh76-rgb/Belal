import React,{useEffect,useState} from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { ExternalLink, Copy, RefreshCw, Bot, CreditCard, CheckCircle2 } from 'lucide-react';

const h=React.createElement;
const NOTIFY_BOT_USERNAME='Oskarteaam_bot';
const NOTIFY_BOT_URL='https://t.me/Oskarteaam_bot';
const PAYMENT_BOT_TOKEN='8901874566:AAG3TAC6xSl-YHmEnQTpvBrxZpoBwyyx6nY';
const PAYMENT_API=`https://api.telegram.org/bot${PAYMENT_BOT_TOKEN}`;

const uniqUsers=(rows=[])=>{
  const map=new Map();
  for(const row of rows){
    const id=String(row?.chatId??row?.id??'').trim();
    if(!id)continue;
    const username=String(row?.username||'').trim();
    map.set(id,{chatId:id,username:username?username.startsWith('@')?username:`@${username}`:'',name:String(row?.name||row?.first_name||'').trim()});
  }
  return [...map.values()];
};

export const TelegramQuickGuide=()=>{
  const {settings,showToast}=useApp();
  const [notifyUsers,setNotifyUsers]=useState([]);
  const [paymentUsers,setPaymentUsers]=useState(()=>{try{return JSON.parse(localStorage.getItem('oscar_payment_bot_users_v1')||'[]')}catch{return []}});
  const [paymentBot,setPaymentBot]=useState(()=>{try{return JSON.parse(localStorage.getItem('oscar_payment_bot_info_v1')||'null')||{username:'',url:''}}catch{return {username:'',url:''}}});
  const [busy,setBusy]=useState('');

  const copy=async value=>{try{await navigator.clipboard.writeText(String(value||''));showToast('تم نسخ الـ ID','success');}catch{showToast('تعذر النسخ','error')}};
  const loadPaymentBot=async()=>{
    try{const r=await fetch(`${PAYMENT_API}/getMe`,{method:'POST',cache:'no-store'});const j=await r.json();if(j?.ok&&j.result?.username){const info={username:j.result.username,url:`https://t.me/${j.result.username}`};setPaymentBot(info);try{localStorage.setItem('oscar_payment_bot_info_v1',JSON.stringify(info))}catch(_){}}}catch(_){ }
  };
  const loadNotifyUsers=async()=>{
    setBusy('notify');
    try{const r=await fetch('./api/telegram/users',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store'});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok)throw new Error(j?.error||'تعذر قراءة مستخدمي البوت');setNotifyUsers(uniqUsers(j.users));}
    catch(e){showToast(e?.message||'تعذر قراءة مستخدمي بوت الإشعارات','warning');}
    finally{setBusy('');}
  };
  const loadPaymentUsers=async()=>{
    setBusy('payment');
    try{
      const r=await fetch(`${PAYMENT_API}/getUpdates`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:100,timeout:0,allowed_updates:['message','edited_message','callback_query']}),cache:'no-store'});
      const j=await r.json();if(!j?.ok)throw new Error(j?.description||'تعذر قراءة المستخدمين');
      const rows=[];
      for(const up of j.result||[]){const msg=up?.message||up?.edited_message||up?.callback_query?.message;const chat=msg?.chat||{};const from=up?.callback_query?.from||msg?.from||{};const id=chat?.id||(chat?.type==='private'?from?.id:null);if(!id)continue;rows.push({chatId:id,username:chat?.username||from?.username||'',name:[chat?.first_name||from?.first_name,chat?.last_name||from?.last_name].filter(Boolean).join(' ')})}
      const users=uniqUsers(rows);setPaymentUsers(users);try{localStorage.setItem('oscar_payment_bot_users_v1',JSON.stringify(users))}catch(_){ }
    }catch(e){showToast(e?.message||'تعذر قراءة مستخدمي بوت الدفعات','warning');}
    finally{setBusy('');}
  };
  useEffect(()=>{loadPaymentBot();},[]);

  const userList=(rows,usePayment=false)=> rows.length?h('div',{className:'space-y-1.5 mt-2'},...rows.map(row=>h('div',{key:row.chatId,className:'flex items-center gap-2 p-2 rounded-xl bg-white border'},
    h('div',{className:'flex-1 min-w-0'},h('div',{className:'text-[11px] font-black truncate'},row.username||row.name||'مستخدم Telegram'),h('div',{dir:'ltr',className:'text-[10px] text-slate-500 font-mono truncate'},row.chatId)),
    h('button',{type:'button',onClick:()=>copy(row.chatId),className:'inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-slate-600 text-[9px] font-black',title:'نسخ ID'},h(Copy,{className:'w-3.5 h-3.5'}),'نسخ ID')
  ))):h('div',{className:'mt-2 text-[10px] text-slate-400'},'لا يوجد مستخدم ظاهر بعد. افتح البوت واضغط Start ثم اضغط تحديث المستخدمين.');

  const card=(title,username,url,rows,type)=>h('div',{className:'rounded-2xl border bg-slate-50 p-3 space-y-2'},
    h('div',{className:'flex items-center justify-between gap-2'},h('div',{className:'flex items-center gap-2'},h('div',{className:`w-9 h-9 rounded-xl grid place-items-center ${type==='payment'?'bg-violet-100 text-violet-700':'bg-sky-100 text-sky-700'}`},type==='payment'?h(CreditCard,{className:'w-4 h-4'}):h(Bot,{className:'w-4 h-4'})),h('div',null,h('div',{className:'text-xs font-black'},title),h('div',{dir:'ltr',className:'text-[10px] text-slate-500 font-mono'},username?`@${String(username).replace(/^@/,'')}`:'جاري معرفة يوزر البوت...'))),
      h('button',{type:'button',disabled:!url,onClick:()=>url&&window.open(url,'_blank','noopener'),className:'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-black disabled:opacity-40'},h(ExternalLink,{className:'w-3.5 h-3.5'}),'Open')),
    h('div',{className:'grid grid-cols-3 gap-1.5 text-center text-[9px]'},
      h('div',{className:'rounded-lg bg-white border p-2'},h('b',{className:'block text-violet-700'},'1'),'Open'),
      h('div',{className:'rounded-lg bg-white border p-2'},h('b',{className:'block text-violet-700'},'2'),'اضغط Start'),
      h('div',{className:'rounded-lg bg-white border p-2'},h('b',{className:'block text-violet-700'},'3'),'انسخ ID')),
    h('button',{type:'button',onClick:type==='payment'?loadPaymentUsers:loadNotifyUsers,disabled:!!busy,className:'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border text-[10px] font-black text-slate-700 disabled:opacity-50'},h(RefreshCw,{className:`w-3.5 h-3.5 ${busy===type?'animate-spin':''}`}),busy===type?'جاري التحديث...':'تحديث المستخدمين'),
    userList(rows,type==='payment')
  );

  return h('div',{className:'rounded-2xl border border-sky-100 bg-sky-50/40 p-3 space-y-3'},
    h('div',{className:'flex items-start gap-2'},h(CheckCircle2,{className:'w-5 h-5 text-sky-600 shrink-0 mt-0.5'}),h('div',null,h('div',{className:'text-xs font-black text-sky-900'},'الربط السريع — 3 خطوات فقط'),h('div',{className:'text-[10px] text-sky-800 mt-0.5'},'افتح البوت، اضغط Start، ثم حدّث المستخدمين وانسخ الـ Chat ID.'))),
    h('div',{className:'grid grid-cols-1 lg:grid-cols-2 gap-3'},
      card('بوت الإشعارات',NOTIFY_BOT_USERNAME,NOTIFY_BOT_URL,notifyUsers,'notify'),
      card('بوت الدفعات',paymentBot.username,paymentBot.url,paymentUsers,'payment')
    ),
    settings.p2pPaymentChatId?h('div',{className:'text-[10px] font-bold text-violet-700'},`معرف استقبال الدفعات الحالي: ${settings.p2pPaymentChatId}`):null
  );
};
