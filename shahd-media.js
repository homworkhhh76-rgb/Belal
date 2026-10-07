(() => {
  'use strict';

  // Same image-storage bot used by Cash Top 3. Binary files never enter Turso;
  // only Telegram file identifiers are returned to the Shahd data model.
  const BOT_TOKEN = '8893463288:AAHn77qegDsR3Yu1LYGicM0Dfh1Fznw4agg';
  const CHAT_ID = '6764610810';
  const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const FILE_ROOT = `https://api.telegram.org/file/bot${BOT_TOKEN}`;
  const DB_NAME = 'shahd_media_v1';
  const DB_VERSION = 1;
  const STORE = 'attachments';
  let dbPromise = null;
  let syncing = null;
  let timer = null;

  const clean = v => String(v ?? '').trim();
  const uid = () => `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)){
          const s=db.createObjectStore(STORE,{keyPath:'id'});
          s.createIndex('pending','pending',{unique:false});
          s.createIndex('ownerKey','ownerKey',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('تعذر فتح مخزن صور شهد.'));
    });
    return dbPromise;
  }
  async function put(row){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(row);tx.oncomplete=()=>res(row);tx.onerror=()=>rej(tx.error)})}
  async function get(id){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}
  async function all(){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error)})}

  function publicMeta(row){
    if(!row) return null;
    return {
      id:row.id,kind:row.kind,name:row.name,mime:row.mime,size:Number(row.size||0),
      telegramFileId:clean(row.telegramFileId),telegramUniqueId:clean(row.telegramUniqueId),
      pending:row.pending===true,storage:row.pending?'telegram-pending':'telegram',updatedAt:row.updatedAt||new Date().toISOString()
    };
  }

  async function telegram(method, body){
    let response;
    try{response=await fetch(`${API}/${method}`,{method:'POST',body,cache:'no-store'});}catch(e){const err=new Error('لا يوجد اتصال بخدمة حفظ الصور حالياً.');err.code='OFFLINE';throw err;}
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.ok!==true){const err=new Error(data?.description||`Telegram HTTP ${response.status}`);err.code=response.status>=500?'OFFLINE':'TELEGRAM';throw err;}
    return data.result;
  }

  async function uploadBlob(blob,name,mime){
    if(offline()){const err=new Error('لا يوجد إنترنت.');err.code='OFFLINE';throw err;}
    const form=new FormData();form.append('chat_id',CHAT_ID);form.append('disable_notification','true');
    const isImage=/^image\//i.test(mime||blob?.type||'');
    form.append(isImage?'photo':'document',blob,name||`shahd-${Date.now()}`);
    const result=await telegram(isImage?'sendPhoto':'sendDocument',form);
    if(isImage){
      const photos=Array.isArray(result?.photo)?result.photo:[],best=photos[photos.length-1]||{};
      if(!best.file_id)throw new Error('لم يرجع Telegram معرف الصورة.');
      return {fileId:String(best.file_id),uniqueId:String(best.file_unique_id||'')};
    }
    const doc=result?.document||{};
    if(!doc.file_id)throw new Error('لم يرجع Telegram معرف الملف.');
    return {fileId:String(doc.file_id),uniqueId:String(doc.file_unique_id||'')};
  }

  async function saveFile(ownerType,ownerId,kind,file,existingMeta=null){
    if(!(file instanceof Blob))throw new Error('اختر ملفاً صحيحاً.');
    const id=clean(existingMeta?.id)||uid(), name=clean(file.name)||`${kind}-${Date.now()}`, mime=clean(file.type)||'application/octet-stream';
    let row={id,ownerType:clean(ownerType),ownerId:clean(ownerId),ownerKey:`${clean(ownerType)}::${clean(ownerId)}`,kind:clean(kind),name,mime,size:Number(file.size||0),blob:file,pending:true,telegramFileId:clean(existingMeta?.telegramFileId),telegramUniqueId:clean(existingMeta?.telegramUniqueId),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await put(row);
    if(!offline()){
      try{
        const up=await uploadBlob(file,name,mime);
        row={...row,blob:null,pending:false,telegramFileId:up.fileId,telegramUniqueId:up.uniqueId,updatedAt:new Date().toISOString()};
        await put(row);
      }catch(err){if(err?.code!=='OFFLINE')throw err;}
    }
    return publicMeta(row);
  }

  async function resolveFileBlob(meta){
    const local=meta?.id?await get(meta.id):null;
    if(local?.pending&&local.blob)return local.blob;
    const fileId=clean(meta?.telegramFileId||local?.telegramFileId);
    if(!fileId)throw new Error('الملف ما زال بانتظار الرفع إلى Telegram.');
    const params=new URLSearchParams();params.set('file_id',fileId);
    const info=await telegram('getFile',params);
    const path=clean(info?.file_path);if(!path)throw new Error('تعذر تحديد مسار الملف على Telegram.');
    const response=await fetch(`${FILE_ROOT}/${path}`,{cache:'no-store'});if(!response.ok)throw new Error('تعذر تنزيل الملف من Telegram.');
    return response.blob();
  }

  async function openAttachment(meta){
    const blob=await resolveFileBlob(meta);
    const url=URL.createObjectURL(blob);
    const w=window.open(url,'_blank','noopener');
    if(!w){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();}
    setTimeout(()=>URL.revokeObjectURL(url),120000);
  }

  async function uploadTransient(blob,name='shahd-image.jpg'){
    if(offline())return null;
    const mime=clean(blob?.type)||'image/jpeg';
    try{return await uploadBlob(blob,name,mime)}catch(_){return null;}
  }

  async function syncPending(){
    if(syncing)return syncing;
    syncing=(async()=>{
      if(offline())return {processed:0};
      const rows=(await all()).filter(r=>r?.pending&&r.blob);
      let processed=0;
      for(const row of rows){
        try{
          const up=await uploadBlob(row.blob,row.name,row.mime);
          const next={...row,blob:null,pending:false,telegramFileId:up.fileId,telegramUniqueId:up.uniqueId,updatedAt:new Date().toISOString()};
          await put(next);processed++;
          window.dispatchEvent(new CustomEvent('shahd:media-uploaded',{detail:{ownerType:next.ownerType,ownerId:next.ownerId,kind:next.kind,meta:publicMeta(next)}}));
        }catch(err){if(err?.code==='OFFLINE')break;}
      }
      return {processed};
    })();
    try{return await syncing}finally{syncing=null}
  }

  function schedule(delay=900){clearTimeout(timer);timer=setTimeout(()=>syncPending().catch(()=>{}),delay)}
  window.addEventListener('online',()=>schedule(250));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(700)});
  setTimeout(()=>schedule(1200),0);

  window.ShahdMedia=Object.freeze({saveFile,openAttachment,resolveFileBlob,uploadTransient,syncPending});
})();
