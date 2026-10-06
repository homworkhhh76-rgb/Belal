/**
 * Cash Top 3 POS + Cash Top AI secure server (Node 18+)
 * Run:
 *   OPENROUTER_API_KEY="..." node server.js
 * Optional:
 *   OPENROUTER_MODEL="google/gemini-2.5-flash:free" PORT=8787 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = String(process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash:free').trim();
const ALLOWED_ORIGIN = String(process.env.OSCAR_ALLOWED_ORIGIN || '').trim();

const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '8893463288:AAHn77qegDsR3Yu1LYGicM0Dfh1Fznw4agg').trim();
const TELEGRAM_CHAT_IDS = String(process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '').trim();
const PRODUCT_IMAGE_BOT_TOKEN = String(process.env.PRODUCT_IMAGE_BOT_TOKEN || TELEGRAM_BOT_TOKEN).trim();
const PRODUCT_IMAGE_CHAT_ID = String(process.env.PRODUCT_IMAGE_CHAT_ID || '6764610810').trim();
const productImagePathCache = new Map();
const TELEGRAM_DATA_DIR = String(process.env.OSCAR_DATA_DIR || path.join(os.homedir(), '.oscar-accounting')).trim();
try { fs.mkdirSync(TELEGRAM_DATA_DIR, { recursive:true }); } catch(_) {}
const TELEGRAM_STATE_FILE = path.join(TELEGRAM_DATA_DIR, 'telegram-state.json');
const TELEGRAM_USERS_FILE = path.join(TELEGRAM_DATA_DIR, 'telegram-users.json');
const PORTAL_SHORTLINKS_FILE = path.join(TELEGRAM_DATA_DIR, 'customer-short-links.json');
let telegramUsersSyncBusy = false;
let telegramState = { config:{ token:'', chatIds:'', dailyReportEnabled:false, dailyBackupEnabled:true }, snapshot:{}, lastDailyReportSentAt:0, lastDailyBackupSentAt:0 };
try { const saved=JSON.parse(fs.readFileSync(TELEGRAM_STATE_FILE,'utf8')); if(saved&&typeof saved==='object') telegramState={...telegramState,...saved,config:{...telegramState.config,...(saved.config||{})},snapshot:{...(saved.snapshot||{})}}; } catch(_) {}
const persistTelegramState=()=>{ try{fs.writeFileSync(TELEGRAM_STATE_FILE,JSON.stringify(telegramState));}catch(err){console.warn('Telegram state persistence unavailable:',err?.message||err);} };
const parseChatIds=v=>String(v||'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
const telegramConfig=()=>({ token:String(TELEGRAM_BOT_TOKEN||'').trim(), chatIds:parseChatIds(telegramState.config?.chatIds||'') });
const telegramReady=()=>{const c=telegramConfig();return !!(c.token&&c.chatIds.length);};


const normalizeTelegramUsername = (value) => String(value || '').trim().replace(/^@+/, '').toLowerCase();
const readTelegramUsersState = () => {
  try { const parsed=JSON.parse(fs.readFileSync(TELEGRAM_USERS_FILE,'utf8')); return parsed&&typeof parsed==='object'?parsed:{offset:0,users:{}}; }
  catch { return {offset:0,users:{}}; }
};
const writeTelegramUsersState = (state) => { try { fs.writeFileSync(TELEGRAM_USERS_FILE,JSON.stringify(state,null,2),'utf8'); return true; } catch(e){ console.error('Telegram users state write error:',e); return false; } };
async function telegramRawCall(method,payload={}){
  const token=telegramConfig().token; if(!token) throw new Error('Telegram Bot Token غير مضبوط');
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
  const data=await response.json().catch(()=>({})); if(!response.ok||data?.ok===false) throw new Error(data?.description||`Telegram HTTP ${response.status}`); return data;
}
function rememberTelegramUser(state,update){
  const msg=update?.message||update?.edited_message||update?.callback_query?.message;
  const chat=msg?.chat||{}, from=update?.callback_query?.from||msg?.from||{};
  const username=String(chat?.username||from?.username||'').trim(), key=normalizeTelegramUsername(username);
  const chatId=chat?.id||(chat?.type==='private'?from?.id:null); if(!key||!chatId) return false;
  const previous=state.users?.[key]||{}; state.users=state.users||{};
  state.users[key]={...previous,chatId:String(chatId),username:`@${username}`,firstName:String(chat?.first_name||from?.first_name||previous.firstName||'').trim(),lastName:String(chat?.last_name||from?.last_name||previous.lastName||'').trim(),type:String(chat?.type||previous.type||'private'),lastSeenAt:new Date().toISOString()};
  return true;
}
async function refreshTelegramUsers({maxBatches=5}={}){
  if(telegramUsersSyncBusy||!telegramConfig().token) return readTelegramUsersState(); telegramUsersSyncBusy=true;
  try{
    const state=readTelegramUsersState(); state.users=state.users||{}; let offset=Number(state.offset||0),changed=false;
    for(let batch=0;batch<Math.max(1,maxBatches);batch++){
      const data=await telegramRawCall('getUpdates',{offset,limit:100,timeout:0,allowed_updates:['message','edited_message','callback_query']});
      const updates=Array.isArray(data?.result)?data.result:[]; if(!updates.length) break;
      for(const update of updates){if(rememberTelegramUser(state,update)) changed=true; const id=Number(update?.update_id); if(Number.isFinite(id)) offset=Math.max(offset,id+1);}
      if(updates.length<100) break;
    }
    if(offset!==Number(state.offset||0)){state.offset=offset;changed=true;} state.updatedAt=new Date().toISOString();
    if(changed||!fs.existsSync(TELEGRAM_USERS_FILE)) writeTelegramUsersState(state); return state;
  }finally{telegramUsersSyncBusy=false;}
}
async function handleTelegramResolve(req,res,origin){
  let body; try{body=await readBody(req,256*1024);}catch(e){return sendJson(res,400,{ok:false,error:e.message},origin);}
  const key=normalizeTelegramUsername(body?.username); if(!/^[a-z0-9_]{5,32}$/i.test(key)) return sendJson(res,400,{ok:false,error:'اكتب يوزر Telegram صحيح مثل @username'},origin);
  let state=readTelegramUsersState(), row=state.users?.[key], syncError='';
  if(!row?.chatId){
    try{state=await refreshTelegramUsers({maxBatches:8}); row=state.users?.[key];}
    catch(e){syncError=String(e?.message||e); console.error('Telegram user sync error:',syncError);}
  }
  if(!row?.chatId){
    const suffix=/webhook|conflict|409/i.test(syncError)?' البوت مربوط بـ Webhook آخر؛ استخدم رابط Start الجديد من البرنامج ليتم تحديث الربط.':' افتح البوت من رابط الربط الجديد واضغط Start ثم ارجع للبرنامج.';
    return sendJson(res,404,{ok:false,error:`لم يتم العثور على @${key}.${suffix}`,telegram_error:syncError||null},origin);
  }
  return sendJson(res,200,{ok:true,result:{chatId:row.chatId,username:row.username||`@${key}`,name:[row.firstName,row.lastName].filter(Boolean).join(' ').trim()}},origin);
}
async function handleTelegramUsers(req,res,origin){
  try{await refreshTelegramUsers({maxBatches:5});}catch(e){console.error('Telegram users refresh error:',e?.message||e);}
  const state=readTelegramUsersState();
  const users=Object.values(state.users||{}).map(row=>({chatId:String(row.chatId||''),username:row.username||'',name:[row.firstName,row.lastName].filter(Boolean).join(' ').trim(),type:row.type||'private',lastSeenAt:row.lastSeenAt||null})).filter(row=>row.chatId).sort((a,b)=>String(b.lastSeenAt||'').localeCompare(String(a.lastSeenAt||'')));
  return sendJson(res,200,{ok:true,users,updatedAt:state.updatedAt||null},origin);
}
async function handleTelegramProxy(req,res,origin){
  let body; try{body=await readBody(req,8*1024*1024);}catch(e){return sendJson(res,400,{ok:false,error:e.message},origin);}
  const method=String(body?.method||'').trim(), allowed=new Set(['sendMessage','sendPhoto','sendDocument','getMe']);
  if(!allowed.has(method)) return sendJson(res,400,{ok:false,error:'Telegram method is not allowed'},origin);
  try{
    const payload=body?.payload||{};
    if(method==='sendPhoto' || method==='sendDocument'){
      const isPhoto=method==='sendPhoto';
      const raw=String(isPhoto?payload.photoDataUrl:payload.fileDataUrl||''), match=raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s); if(!match) return sendJson(res,400,{ok:false,error:isPhoto?'صورة Telegram غير صالحة':'ملف Telegram غير صالح'},origin);
      const mime=match[1]||(isPhoto?'image/png':'application/octet-stream'), bodyData=match[3]||'', buffer=match[2]?Buffer.from(bodyData,'base64'):Buffer.from(decodeURIComponent(bodyData),'utf8');
      const form=new FormData(); form.append('chat_id',String(payload.chat_id||'')); if(payload.caption)form.append('caption',String(payload.caption).slice(0,1024)); if(payload.disable_notification)form.append('disable_notification','true');
      const field=isPhoto?'photo':'document'; form.append(field,new Blob([buffer],{type:mime}),String(payload.filename||(isPhoto?'oscar.png':'oscar-file.bin')));
      const token=telegramConfig().token; const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',body:form}); const data=await response.json().catch(()=>({})); if(!response.ok||data?.ok===false) throw new Error(data?.description||`Telegram HTTP ${response.status}`); return sendJson(res,200,data,origin);
    }
    const data=await telegramRawCall(method,payload); return sendJson(res,200,data,origin);
  }catch(e){return sendJson(res,502,{ok:false,error:String(e?.message||e)},origin);}
}

async function telegramApi(method,{chatId,text,base64,filename,mime='application/octet-stream',caption=''}={}){
  const cfg=telegramConfig(); if(!cfg.token) throw new Error('Telegram Bot Token غير مضبوط');
  const url=`https://api.telegram.org/bot${cfg.token}/${method}`;
  let response;
  if(method==='sendMessage'){
    response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:String(text||'').slice(0,4000)})});
  } else {
    const field=method==='sendPhoto'?'photo':'document'; const form=new FormData(); form.append('chat_id',chatId); if(caption) form.append('caption',String(caption).slice(0,900));
    const bytes=Buffer.from(String(base64||''),'base64'); if(!bytes.length) throw new Error(`ملف ${filename||field} فارغ`);
    form.append(field,new Blob([bytes],{type:mime}),filename||`oscar.${method==='sendPhoto'?'jpg':'bin'}`);
    response=await fetch(url,{method:'POST',body:form});
  }
  const data=await response.json().catch(()=>({})); if(!response.ok||data?.ok===false) throw new Error(data?.description||`Telegram HTTP ${response.status}`); return data;
}
function splitTelegramServerText(text,max=3900){
  const lines=String(text||'').split('\n'), parts=[]; let current='';
  for(const rawLine of lines){
    const line=String(rawLine||'');
    if(line.length>max){
      if(current){parts.push(current);current='';}
      for(let i=0;i<line.length;i+=max) parts.push(line.slice(i,i+max));
      continue;
    }
    const next=current?`${current}\n${line}`:line;
    if(next.length>max){if(current)parts.push(current);current=line;}else current=next;
  }
  if(current)parts.push(current); return parts.filter(Boolean);
}
async function telegramBroadcast(kind,payload={}){
  const cfg=telegramConfig(); if(!cfg.chatIds.length) throw new Error('لم يتم تحديد Chat ID للمستلمين');
  const out=[];
  for(const chatId of cfg.chatIds){
    if(kind==='sendMessage'){
      for(const part of splitTelegramServerText(payload.text)) out.push(await telegramApi(kind,{...payload,text:part,chatId}));
    } else out.push(await telegramApi(kind,{...payload,chatId}));
  }
  return out;
}
async function sendStoredDailyReport(){
  const snap=telegramState.snapshot||{}; if(!telegramReady()) throw new Error('إعدادات Telegram غير مكتملة'); if(!snap.reportText&&!snap.dailyPdfBase64) throw new Error('لا توجد نسخة حديثة من التقرير اليومي');
  if(snap.reportText) await telegramBroadcast('sendMessage',{text:snap.reportText});
  if(snap.dailyImageBase64) await telegramBroadcast('sendPhoto',{base64:snap.dailyImageBase64,filename:snap.dailyImageName||'daily-report.jpg',mime:'image/jpeg',caption:`صورة التقرير — ${snap.storeName||'كاش توب 3'}`});
  if(snap.dailyPdfBase64) await telegramBroadcast('sendDocument',{base64:snap.dailyPdfBase64,filename:snap.dailyPdfName||'daily-report.pdf',mime:'application/pdf',caption:`PDF التقرير اليومي — ${snap.storeName||'كاش توب 3'}`});
}
async function sendStoredCustomerReport(){
  const snap=telegramState.snapshot||{}; if(!telegramReady()) throw new Error('إعدادات Telegram غير مكتملة'); if(!snap.customerPdfBase64) throw new Error('لا يوجد تقرير عملاء مرفوع بعد');
  await telegramBroadcast('sendDocument',{base64:snap.customerPdfBase64,filename:snap.customerPdfName||'customers-debts.pdf',mime:'application/pdf',caption:`تقرير العملاء والديون — ${snap.storeName||'كاش توب 3'}`});
}
async function sendStoredAllReports(){
  const snap=telegramState.snapshot||{}; if(!telegramReady()) throw new Error('إعدادات Telegram غير مكتملة'); if(snap.allReportsText||snap.reportText) await telegramBroadcast('sendMessage',{text:snap.allReportsText||snap.reportText});
  if(snap.allReportsImageBase64) await telegramBroadcast('sendPhoto',{base64:snap.allReportsImageBase64,filename:snap.allReportsImageName||'reports-summary.jpg',mime:'image/jpeg',caption:`ملخص التقارير — ${snap.storeName||'كاش توب 3'}`});
  if(snap.allReportsPdfBase64) await telegramBroadcast('sendDocument',{base64:snap.allReportsPdfBase64,filename:snap.allReportsPdfName||'all-reports.pdf',mime:'application/pdf',caption:`جميع التقارير — ${snap.storeName||'كاش توب 3'}`});
  else if(snap.dailyPdfBase64) await telegramBroadcast('sendDocument',{base64:snap.dailyPdfBase64,filename:snap.dailyPdfName||'daily-report.pdf',mime:'application/pdf',caption:'التقرير اليومي'});
  if(snap.customerPdfBase64) await telegramBroadcast('sendDocument',{base64:snap.customerPdfBase64,filename:snap.customerPdfName||'customers-debts.pdf',mime:'application/pdf',caption:'تقرير العملاء والديون'});
}
async function sendStoredBackup(){
  const snap=telegramState.snapshot||{}; if(!telegramReady()) throw new Error('إعدادات Telegram غير مكتملة'); if(!snap.backupBase64) throw new Error('لا توجد نسخة احتياطية مرفوعة');
  await telegramBroadcast('sendDocument',{base64:snap.backupBase64,filename:snap.backupName||'CashTop3_Backup.json',mime:'application/json',caption:`نسخة احتياطية — ${snap.storeName||'كاش توب 3'}`});
}
async function handleTelegram(req,res,origin){
  let body; try{body=await readBody(req,90*1024*1024);}catch(e){return sendJson(res,400,{ok:false,error:e.message},origin);}
  try{
    const action=String(body.action||'');
    if(action==='status') return sendJson(res,200,{ok:true,configured:telegramReady(),dailyReportEnabled:!!telegramState.config.dailyReportEnabled,dailyBackupEnabled:!!telegramState.config.dailyBackupEnabled,lastDailyReportSentAt:telegramState.lastDailyReportSentAt||0,lastDailyBackupSentAt:telegramState.lastDailyBackupSentAt||0,hasSnapshot:!!telegramState.snapshot?.dailyPdfBase64},origin);
    if(action==='save_config'){
      const c=body.config||{}, prevR=!!telegramState.config.dailyReportEnabled, prevB=!!telegramState.config.dailyBackupEnabled;
      telegramState.config={...telegramState.config,token:String(TELEGRAM_BOT_TOKEN||'').trim(),chatIds:String(c.chatIds ?? '').trim(),dailyReportEnabled:!!c.dailyReportEnabled,dailyBackupEnabled:!!c.dailyBackupEnabled};
      const now=Date.now(); if(!prevR&&telegramState.config.dailyReportEnabled) telegramState.lastDailyReportSentAt=now; /* لا نعتبر النسخة الاحتياطية مُرسلة لمجرد تفعيل الخيار؛ يُحدَّث وقتها فقط بعد إرسال ناجح فعلياً. */
      persistTelegramState(); return sendJson(res,200,{ok:true,configured:telegramReady()},origin);
    }
    if(action==='snapshot'){telegramState.snapshot={...telegramState.snapshot,...(body.snapshot||{}),updatedAt:Date.now()};persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    if(action==='upload_customer_report'){telegramState.snapshot={...telegramState.snapshot,customerPdfBase64:String(body.pdfBase64||''),customerPdfName:String(body.pdfName||'customers-debts.pdf'),updatedAt:Date.now()};persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    if(action==='upload_all_reports'){telegramState.snapshot={...telegramState.snapshot,allReportsPdfBase64:String(body.pdfBase64||''),allReportsPdfName:String(body.pdfName||'all-reports.pdf'),allReportsImageBase64:String(body.imageBase64||''),allReportsImageName:String(body.imageName||'reports-summary.jpg'),allReportsText:String(body.text||''),updatedAt:Date.now()};persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    if(action==='upload_backup'){telegramState.snapshot={...telegramState.snapshot,backupBase64:String(body.backupBase64||''),backupName:String(body.backupName||'CashTop3_Backup.json'),updatedAt:Date.now()};persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    if(action==='mark_backup_sent'){telegramState.lastDailyBackupSentAt=Math.max(Number(body.sentAt||0)||0,Date.now()-1000);persistTelegramState();return sendJson(res,200,{ok:true,lastDailyBackupSentAt:telegramState.lastDailyBackupSentAt},origin);}
    if(action==='send_daily_now'){await sendStoredDailyReport();telegramState.lastDailyReportSentAt=Date.now();persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    if(action==='send_customer_report'){await sendStoredCustomerReport();return sendJson(res,200,{ok:true},origin);}
    if(action==='send_all_reports'){await sendStoredAllReports();return sendJson(res,200,{ok:true},origin);}
    if(action==='send_backup'){await sendStoredBackup();telegramState.lastDailyBackupSentAt=Date.now();persistTelegramState();return sendJson(res,200,{ok:true},origin);}
    return sendJson(res,400,{ok:false,error:'أمر Telegram غير معروف'},origin);
  }catch(e){console.error('Telegram error:',e);return sendJson(res,502,{ok:false,error:String(e?.message||e)},origin);}
}
async function checkTelegramSchedules(){
  if(!telegramReady()) return; const now=Date.now(), day=24*60*60*1000;
  try{if(telegramState.config.dailyReportEnabled&&telegramState.snapshot?.dailyPdfBase64&&now-numSafe(telegramState.lastDailyReportSentAt)>=day){await sendStoredDailyReport();telegramState.lastDailyReportSentAt=now;persistTelegramState();}}catch(e){console.error('Scheduled daily report failed:',e?.message||e);}
  try{if(telegramState.config.dailyBackupEnabled&&telegramState.snapshot?.backupBase64&&now-numSafe(telegramState.lastDailyBackupSentAt)>=day){await sendStoredBackup();telegramState.lastDailyBackupSentAt=now;persistTelegramState();}}catch(e){console.error('Scheduled backup failed:',e?.message||e);}
}
function numSafe(v){const n=Number(v);return Number.isFinite(n)?n:0;}


function readPortalShortLinks(){
  try{const parsed=JSON.parse(fs.readFileSync(PORTAL_SHORTLINKS_FILE,'utf8'));return parsed&&typeof parsed==='object'?parsed:{links:{}};}catch{return {links:{}};}
}
function writePortalShortLinks(state){
  try{fs.writeFileSync(PORTAL_SHORTLINKS_FILE,JSON.stringify(state,null,2),'utf8');return true;}catch(e){console.error('Portal short-link write error:',e);return false;}
}
function portalShortKey(companyCode,customerCode){return `${String(companyCode||'').toUpperCase()}:${String(customerCode||'').toUpperCase()}`;}
async function handleCustomerShortLink(req,res,origin){
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'){
    const c=String(url.searchParams.get('c')||'').toUpperCase(),u=String(url.searchParams.get('u')||'').toUpperCase();
    if(!/^[A-Z2-9]{5}$/.test(c)||!/^[A-Z2-9]{5}$/.test(u)) return sendJson(res,400,{ok:false,error:'كود الرابط غير صالح'},origin);
    const state=readPortalShortLinks(),row=state.links?.[portalShortKey(c,u)];
    if(!row?.accessCode) return sendJson(res,404,{ok:false,error:'الرابط المختصر غير موجود'},origin);
    return sendJson(res,200,{ok:true,accessCode:row.accessCode,companyCode:c,customerCode:u},origin);
  }
  if(req.method==='POST'){
    let body;try{body=await readBody(req,256*1024);}catch(e){return sendJson(res,400,{ok:false,error:e.message},origin);}
    const c=String(body?.companyCode||'').toUpperCase(),u=String(body?.customerCode||'').toUpperCase(),accessCode=String(body?.accessCode||'').trim();
    if(!/^[A-Z2-9]{5}$/.test(c)||!/^[A-Z2-9]{5}$/.test(u)||!accessCode.startsWith('cp1.')) return sendJson(res,400,{ok:false,error:'بيانات الرابط المختصر غير صالحة'},origin);
    const state=readPortalShortLinks();state.links=state.links||{};
    state.links[portalShortKey(c,u)]={accessCode,companyId:String(body?.companyId||''),customerId:String(body?.customerId||''),updatedAt:new Date().toISOString()};
    const keys=Object.keys(state.links);if(keys.length>12000){keys.sort((a,b)=>String(state.links[a]?.updatedAt||'').localeCompare(String(state.links[b]?.updatedAt||''))).slice(0,keys.length-10000).forEach(k=>delete state.links[k]);}
    if(!writePortalShortLinks(state)) return sendJson(res,500,{ok:false,error:'تعذر حفظ الرابط المختصر'},origin);
    return sendJson(res,200,{ok:true},origin);
  }
  return sendJson(res,405,{ok:false,error:'GET/POST فقط'},origin);
}

const MIME = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon',
};

const sendJson = (res, status, data, origin='') => {
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
};

const readBody = (req, max=28*1024*1024) => new Promise((resolve,reject)=>{
  let size=0, chunks=[];
  req.on('data',chunk=>{ size+=chunk.length; if(size>max){ reject(new Error('الطلب كبير جداً')); req.destroy(); return; } chunks.push(chunk); });
  req.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')); }catch{ reject(new Error('JSON غير صالح')); } });
  req.on('error',reject);
});



function productImageTelegramUrl(method){
  if(!PRODUCT_IMAGE_BOT_TOKEN) throw new Error('PRODUCT_IMAGE_BOT_TOKEN غير مضبوط على الخادم');
  return `https://api.telegram.org/bot${PRODUCT_IMAGE_BOT_TOKEN}/${method}`;
}
async function productImageTelegramCall(method,payload={}){
  const response=await fetch(productImageTelegramUrl(method),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false) throw new Error(data?.description||`Telegram HTTP ${response.status}`);
  return data;
}
async function uploadProductImageBuffer(buffer,mime,filename){
  if(!PRODUCT_IMAGE_CHAT_ID) throw new Error('PRODUCT_IMAGE_CHAT_ID غير مضبوط على الخادم');
  const form=new FormData();
  form.append('chat_id',PRODUCT_IMAGE_CHAT_ID);
  form.append('disable_notification','true');
  form.append('photo',new Blob([buffer],{type:mime}),filename||'product.jpg');
  const response=await fetch(productImageTelegramUrl('sendPhoto'),{method:'POST',body:form});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false) throw new Error(data?.description||`Telegram HTTP ${response.status}`);
  const photos=Array.isArray(data?.result?.photo)?data.result.photo:[];
  const best=photos[photos.length-1]||{};
  if(!best?.file_id) throw new Error('Telegram لم يرجع file_id للصورة.');
  return {fileId:String(best.file_id),fileUniqueId:String(best.file_unique_id||''),mimeType:String(mime||'image/jpeg'),fileName:String(filename||'product.jpg')};
}
async function resolveProductImagePath(fileId,{force=false}={}){
  const id=String(fileId||'').trim();
  if(!id) throw new Error('file_id مطلوب');
  const cached=productImagePathCache.get(id);
  if(!force&&cached&&cached.expiresAt>Date.now()) return cached.filePath;
  const data=await productImageTelegramCall('getFile',{file_id:id});
  const filePath=String(data?.result?.file_path||'').trim();
  if(!filePath) throw new Error('تعذر الحصول على مسار الصورة من Telegram.');
  productImagePathCache.set(id,{filePath,expiresAt:Date.now()+45*60*1000});
  return filePath;
}
async function fetchProductImageFile(fileId,{force=false}={}){
  const filePath=await resolveProductImagePath(fileId,{force});
  const url=`https://api.telegram.org/file/bot${PRODUCT_IMAGE_BOT_TOKEN}/${filePath}`;
  const response=await fetch(url,{cache:'no-store'});
  if(response.ok) return response;
  if(!force){productImagePathCache.delete(String(fileId||''));return fetchProductImageFile(fileId,{force:true});}
  throw new Error(`Telegram file HTTP ${response.status}`);
}
async function handleProductImageUpload(req,res,origin){
  let body; try{body=await readBody(req,12*1024*1024);}catch(e){return sendJson(res,400,{ok:false,error:e.message},origin);}
  const raw=String(body?.dataUrl||''),match=raw.match(/^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s);
  if(!match) return sendJson(res,400,{ok:false,error:'صورة غير صالحة. استخدم PNG أو JPG أو WEBP.'},origin);
  let buffer; try{buffer=Buffer.from(match[2],'base64');}catch(_){buffer=null;}
  if(!buffer?.length) return sendJson(res,400,{ok:false,error:'بيانات الصورة فارغة.'},origin);
  if(buffer.length>8*1024*1024) return sendJson(res,413,{ok:false,error:'حجم الصورة أكبر من الحد المسموح.'},origin);
  const fallbackExt=match[1].includes('png')?'png':match[1].includes('webp')?'webp':'jpg';
  const safeName=String(body?.filename||`product.${fallbackExt}`).replace(/[\\/:*?"<>|]+/g,'-').slice(0,120)||`product.${fallbackExt}`;
  try{
    const saved=await uploadProductImageBuffer(buffer,match[1],safeName);
    return sendJson(res,200,{ok:true,...saved,url:`/api/oscar-product-image?file_id=${encodeURIComponent(saved.fileId)}`},origin);
  }catch(e){return sendJson(res,502,{ok:false,error:String(e?.message||e)},origin);}
}
async function handleProductImageGet(req,res,origin){
  let fileId=''; try{fileId=new URL(req.url,'http://localhost').searchParams.get('file_id')||'';}catch(_){ }
  if(!fileId){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});return res.end('file_id required');}
  try{
    const upstream=await fetchProductImageFile(fileId);
    const type=upstream.headers.get('content-type')||'image/webp';
    const length=upstream.headers.get('content-length');
    const headers={'Content-Type':type,'Cache-Control':'private, max-age=300, stale-while-revalidate=3600','X-Content-Type-Options':'nosniff'};
    if(length) headers['Content-Length']=length;
    if(ALLOWED_ORIGIN&&origin===ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin']=origin;
    res.writeHead(200,headers);
    if(req.method==='HEAD') return res.end();
    const ab=await upstream.arrayBuffer();
    return res.end(Buffer.from(ab));
  }catch(e){
    res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});
    return res.end('Product image unavailable');
  }
}

const stripFence = (text='') => String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
const parseJsonLoose = (text='') => {
  const clean=stripFence(text);
  try { return JSON.parse(clean); } catch {}
  const first=clean.indexOf('{'), last=clean.lastIndexOf('}');
  if(first>=0 && last>first){ try{return JSON.parse(clean.slice(first,last+1));}catch{} }
  return null;
};

async function callOpenRouter(messages, {temperature=0.15, max_tokens=2200}={}) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY غير مضبوط على الخادم');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type':'application/json',
      'X-Title':'Cash Top 3 POS AI',
    },
    body:JSON.stringify({ model:OPENROUTER_MODEL, messages, temperature, max_tokens }),
  });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data?.error?.message || data?.message || `OpenRouter HTTP ${response.status}`);
  const content = data?.choices?.[0]?.message?.content;
  if(Array.isArray(content)) return content.map(x=>x?.text||'').join('\n');
  return String(content || '');
}

const assistantSystem = `أنت "مساعد كاش توب AI" داخل نظام محاسبة ونقاط بيع عربي RTL.
تجيب فقط بناءً على بيانات النظام المرسلة في context، ولا تخترع أرقاماً غير موجودة.
افهم العربية العامية والفصحى. العملة موجودة في context.currency.
يمكنك: تحليل المبيعات، المشتريات، المخزون، الأصناف الناقصة، الديون، الموردين، المصروفات، أداء المطعم، كشف المؤشرات غير المعتادة، واقتراح كميات شراء بشكل تقريبي مع توضيح أنها اقتراحات.
إذا طلب المستخدم تسجيل مصروف بصيغة طبيعية، استخرج المبلغ والبند والملاحظات فقط ولا تحفظه مباشرة. أرجع action من نوع expense_draft حتى يراجع المستخدم قبل الحفظ.
إذا طلب فتح شاشة، استخدم action من نوع navigate. الشاشات المسموحة: pos,sales,purchases,products,inventory,customers,suppliers,accounts,expenses,reports,restaurant_tables,restaurant_waiter,restaurant_kitchen.
إذا طلب تعبئة فاتورة مشتريات من صورة، وجّهه إلى شاشة المشتريات واستخدم action type purchase.
لا تدّعي أن تقرير PDF/Excel تم تنزيله إذا لم يحدث. يمكنك تلخيص البيانات أو توجيهه إلى شاشة التقارير.
أرجع JSON فقط بالشكل:
{"answer":"نص عربي واضح ومختصر","action":null}
أو action:
{"answer":"...","action":{"type":"navigate","tab":"reports","label":"فتح التقارير"}}
أو:
{"answer":"راجعت المصروف...","action":{"type":"expense_draft","label":"مراجعة المصروف قبل الحفظ","data":{"amount":250,"category":"أجور ورواتب عمال","notes":"أجرة عمال"}}}
بنود المصروف المفضلة: نثريات وضيافة، كهرباء ومياه، إيجار المحل، أجور ورواتب عمال، صيانة ونظافة، بضائع تالفة ومنتهية، أكياس وتغليف وطباعة، نقل وشحن، أخرى.`;

const scanSystem = `أنت محرك قراءة فواتير مشتريات عربي/إنجليزي دقيق داخل نظام محاسبة.
اقرأ الصور كما هي. لا تخترع صنفاً أو رقماً غير واضح. إذا كان الرقم غير مؤكد ضع confidence منخفضاً أو null للقيمة.
استخرج المورد ورقم الفاتورة والتاريخ والعملة والخصم والمدفوع إن ظهر، وكل بنود الفاتورة.
افهم الوحدات المتكافئة لغوياً: حبة/قطعة/pcs، كرتونة/كرتون/carton/box، باكيت/pack، مشطاح/طبلية/pallet، كيلو/kg، غرام/g، لتر/l، مل/ml، دزينة/dozen، كيس/bag.
سعر الوحدة هو السعر المقابل لوحدة السطر في الصورة، والكمية هي عدد تلك الوحدة.
قد تكون الفاتورة عدة صور؛ اجمعها معاً وتجنب تكرار البنود إذا كانت الصور متداخلة.
أرجع JSON فقط، بلا Markdown، بالشكل التالي:
{
 "supplier":{"name":"","phone":"","taxNumber":""},
 "invoiceNumber":"", "date":"YYYY-MM-DD أو null", "currency":"", "subtotal":0, "discount":0, "grandTotal":0, "paidAmount":null,
 "items":[{"name":"","barcode":"","unit":"","quantity":1,"unitPrice":0,"total":0,"confidence":0.0}],
 "confidence":0.0,
 "warnings":["..."]
}
إذا لم يظهر حقل اتركه فارغاً أو null. لا تستنتج أسعاراً غير ظاهرة إلا إذا كان total وquantity واضحين ويمكن حساب unitPrice رياضياً؛ والعكس صحيح.`;

async function handleAI(req,res,origin){
  if(!OPENROUTER_API_KEY) return sendJson(res,503,{error:'خادم Cash Top AI جاهز لكن مفتاح OpenRouter غير مضبوط. اضبط OPENROUTER_API_KEY ثم أعد تشغيل الخادم.'},origin);
  let body;
  try { body=await readBody(req); } catch(e){ return sendJson(res,400,{error:e.message},origin); }
  try {
    if(body.task==='health') return sendJson(res,200,{ok:true,model:OPENROUTER_MODEL},origin);
    if(body.task==='purchase_invoice_scan'){
      const images=Array.isArray(body.images)?body.images.filter(x=>typeof x==='string'&&x.startsWith('data:image/')).slice(0,6):[];
      if(!images.length) return sendJson(res,400,{error:'لم تصل صورة فاتورة صالحة'},origin);
      const catalog=body.catalog||{};
      const supplierNames=(catalog.suppliers||[]).slice(0,250).map(x=>x?.name).filter(Boolean);
      const productList=(catalog.products||[]).slice(0,600).map(p=>({name:p?.name,sku:p?.sku,units:(p?.units||[]).map(u=>u?.name).filter(Boolean)}));
      const text=`اقرأ فاتورة المشتريات من الصور. هذه أسماء من النظام للمساعدة على التعرف والمطابقة فقط، ولا تجبر التطابق إذا الصورة مختلفة.\nالموردون الموجودون: ${JSON.stringify(supplierNames)}\nالأصناف والوحدات الموجودة: ${JSON.stringify(productList)}`;
      const content=[{type:'text',text},...images.map(url=>({type:'image_url',image_url:{url}}))];
      const raw=await callOpenRouter([{role:'system',content:scanSystem},{role:'user',content}],{temperature:0.05,max_tokens:4000});
      const parsed=parseJsonLoose(raw);
      if(!parsed) throw new Error('تعذر تفسير نتيجة قراءة الفاتورة. حاول بصورة أوضح.');
      return sendJson(res,200,{result:parsed,model:OPENROUTER_MODEL},origin);
    }
    if(body.task==='assistant_chat'){
      const context=body.context||{};
      const history=(Array.isArray(body.history)?body.history:[]).slice(-10).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content||'').slice(0,3000)}));
      const message=String(body.message||'').slice(0,4000);
      const contextText=JSON.stringify(context).slice(0,180000);
      const messages=[{role:'system',content:assistantSystem},{role:'system',content:`بيانات النظام الحالية (JSON):\n${contextText}`},...history,{role:'user',content:message}];
      const raw=await callOpenRouter(messages,{temperature:0.18,max_tokens:1800});
      const parsed=parseJsonLoose(raw);
      if(parsed?.answer) return sendJson(res,200,{answer:String(parsed.answer),action:parsed.action||null,model:OPENROUTER_MODEL},origin);
      return sendJson(res,200,{answer:raw||'لم يصل رد.',action:null,model:OPENROUTER_MODEL},origin);
    }
    return sendJson(res,400,{error:'مهمة AI غير معروفة'},origin);
  } catch(e){
    console.error('Cash Top AI error:',e);
    return sendJson(res,502,{error:String(e?.message||e)},origin);
  }
}

const server=http.createServer(async(req,res)=>{
  const origin=String(req.headers.origin||'');
  if(req.method==='OPTIONS' && (req.url.startsWith('/api/oscar-ai') || req.url.startsWith('/api/oscar-telegram') || req.url.startsWith('/api/telegram') || req.url.startsWith('/api/oscar-product-image') || req.url.startsWith('/api/customer-short-link'))){
    const headers={'Access-Control-Allow-Methods':'GET, POST, HEAD, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'};
    if(ALLOWED_ORIGIN && origin===ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin']=origin;
    res.writeHead(204,headers); return res.end();
  }
  if(req.url.startsWith('/api/customer-short-link')){
    return handleCustomerShortLink(req,res,origin);
  }
  if(req.url.startsWith('/api/oscar-product-image')){
    if(req.method==='POST') return handleProductImageUpload(req,res,origin);
    if(req.method==='GET'||req.method==='HEAD') return handleProductImageGet(req,res,origin);
    return sendJson(res,405,{ok:false,error:'GET/POST فقط'},origin);
  }
  if(req.url.startsWith('/api/oscar-ai')){
    if(req.method!=='POST') return sendJson(res,405,{error:'POST فقط'},origin);
    return handleAI(req,res,origin);
  }
  if(req.url.startsWith('/api/oscar-telegram')){
    if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'POST فقط'},origin);
    return handleTelegram(req,res,origin);
  }
  if(req.url.startsWith('/api/telegram/resolve')){
    if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'POST فقط'},origin);
    return handleTelegramResolve(req,res,origin);
  }
  if(req.url.startsWith('/api/telegram/users')){
    if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'POST فقط'},origin);
    return handleTelegramUsers(req,res,origin);
  }
  if(req.url.startsWith('/api/telegram')){
    if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'POST فقط'},origin);
    return handleTelegramProxy(req,res,origin);
  }
  if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405);return res.end('Method Not Allowed');}
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { pathname='/'; }
  if(pathname==='/') pathname='/index.html';
  const filePath=path.resolve(ROOT,'.'+pathname);
  if(!filePath.startsWith(ROOT) || path.basename(filePath).startsWith('.')){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(filePath,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
    const ext=path.extname(filePath).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control': ext==='.html'?'no-cache':'public, max-age=300'});
    if(req.method==='HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});
server.listen(PORT,()=>{console.log(`Cash Top 3 + AI + Telegram: http://localhost:${PORT}`);setTimeout(()=>checkTelegramSchedules().catch(()=>{}),5000);const timer=setInterval(()=>checkTelegramSchedules().catch(()=>{}),60000);timer.unref?.();});
