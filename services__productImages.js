/* Oscar product-image storage — direct Telegram photo mode.
 * Images are sent with Telegram Bot API sendPhoto (not sendDocument/sticker),
 * and only Telegram identifiers + a refreshable file URL are stored on products.
 * If the device is offline, the image stays locally with the product until the
 * internet returns, then it is uploaded automatically in the background.
 */
import { getAllFromStore, putInStore } from './services__db.js?v=7.9.4.136-localization';

const PRODUCT_IMAGE_BOT_TOKEN = '8893463288:AAHn77qegDsR3Yu1LYGicM0Dfh1Fznw4agg';
const LEGACY_IMAGE_BOT_TOKEN = '8901874566:AAG3TAC6xSl-YHmEnQTpvBrxZpoBwyyx6nY';
const PRODUCT_IMAGE_CHAT_ID = '6764610810';
const TELEGRAM_API = `https://api.telegram.org/bot${PRODUCT_IMAGE_BOT_TOKEN}`;
const TELEGRAM_FILE_ROOT = `https://api.telegram.org/file/bot${PRODUCT_IMAGE_BOT_TOKEN}`;
const LEGACY_TELEGRAM_API = `https://api.telegram.org/bot${LEGACY_IMAGE_BOT_TOKEN}`;
const LEGACY_TELEGRAM_FILE_ROOT = `https://api.telegram.org/file/bot${LEGACY_IMAGE_BOT_TOKEN}`;
const CACHE_TTL = 45 * 60 * 1000;
const CACHE_PREFIX = 'oscar_product_image_url_v64::';
const memoryCache = new Map();
let autoSyncStarted = false;
let syncPromise = null;
let syncTimer = null;
let syncIdleId = null;

const clean = v => String(v ?? '').trim();
const isDataImage = value => /^data:image\/(png|jpe?g|webp);base64,/i.test(clean(value));
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const cacheKey = fileId => `${CACHE_PREFIX}${clean(fileId)}`;

function buildError(message, code='generic'){
  const err = new Error(message);
  err.code = code;
  return err;
}

export function isProductImageOfflineError(error){
  const msg = clean(error?.message || error).toLowerCase();
  return error?.code === 'offline' || isOffline() || msg.includes('الإنترنت') || msg.includes('internet') || msg.includes('network') || msg.includes('failed to fetch');
}

function readCache(fileId){
  const id=clean(fileId); if(!id) return null;
  const mem=memoryCache.get(id);
  if(mem && Number(mem.expiresAt||0)>Date.now()) return mem;
  if(mem) memoryCache.delete(id);
  try{
    const raw=localStorage.getItem(cacheKey(id));
    if(!raw) return null;
    const row=JSON.parse(raw);
    if(row?.url && Number(row.expiresAt||0)>Date.now()){
      memoryCache.set(id,row);
      return row;
    }
    localStorage.removeItem(cacheKey(id));
  }catch(_){ }
  return null;
}
function writeCache(fileId,url,filePath=''){
  const id=clean(fileId); const safeUrl=clean(url); if(!id||!safeUrl) return;
  const row={url:safeUrl,filePath:clean(filePath),expiresAt:Date.now()+CACHE_TTL};
  memoryCache.set(id,row);
  try{localStorage.setItem(cacheKey(id),JSON.stringify(row));}catch(_){ }
}
export function peekProductImageUrl(fileId){
  const id=clean(fileId);
  if(!id) return '';
  return readCache(id)?.url || '';
}

export function forgetProductImageUrl(fileId){
  const id=clean(fileId); if(!id) return;
  memoryCache.delete(id);
  try{localStorage.removeItem(cacheKey(id));}catch(_){ }
}

async function telegramJson(method,{body=null,api=TELEGRAM_API}={}){
  const opts={method:'POST',cache:'no-store'};
  if(body instanceof FormData) opts.body=body;
  else if(body){
    const params=new URLSearchParams();
    for(const [k,v] of Object.entries(body)) if(v!==undefined&&v!==null) params.append(k,String(v));
    opts.body=params;
  }
  let response;
  try{response=await fetch(`${api}/${method}`,opts);}catch(_){
    throw buildError('تعذر الاتصال بخدمة حفظ الصور. تحقق من الإنترنت ثم أعد المحاولة.','offline');
  }
  const data=await response.json().catch(()=>null);
  if(!response.ok||data?.ok!==true) throw buildError(data?.description||data?.error||`Telegram HTTP ${response.status}`, response.status >= 500 ? 'telegram' : 'generic');
  return data;
}

export function getProductImageSrc(product){
  const localImage = clean(product?.imageData || product?.imageUrl || '');
  const fileId=clean(product?.imageTelegramFileId);
  if(product?.imagePendingUpload && localImage) return localImage;
  if(fileId) return readCache(fileId)?.url || clean(product?.imageTelegramUrl || '') || localImage;
  return localImage;
}

export async function resolveProductImageUrl(fileId,{force=false}={}){
  const id=clean(fileId);
  if(!id) return '';
  if(!force){const cached=readCache(id);if(cached?.url) return cached.url;}
  if(force) forgetProductImageUrl(id);
  let data=null, fileRoot=TELEGRAM_FILE_ROOT;
  try{
    data=await telegramJson('getFile',{body:{file_id:id},api:TELEGRAM_API});
  }catch(primaryError){
    // الصور القديمة التي حُفظت قبل نقل التخزين إلى بوت التقارير تبقى قابلة للعرض.
    try{data=await telegramJson('getFile',{body:{file_id:id},api:LEGACY_TELEGRAM_API});fileRoot=LEGACY_TELEGRAM_FILE_ROOT;}
    catch(_){throw primaryError;}
  }
  const filePath=clean(data?.result?.file_path);
  if(!filePath) throw buildError('تعذر الحصول على رابط الصورة من Telegram.','generic');
  const url=`${fileRoot}/${filePath}`;
  writeCache(id,url,filePath);
  return url;
}

export async function uploadProductImageToTelegram(dataUrl, filename='product.jpg'){
  const raw=clean(dataUrl);
  if(!isDataImage(raw)) throw buildError('صورة الصنف غير صالحة.','generic');
  if(isOffline()) throw buildError('لا يوجد اتصال بالإنترنت حالياً.','offline');
  let blob;
  try{blob=await (await fetch(raw)).blob();}catch(_){throw buildError('تعذر تجهيز صورة الصنف للإرسال.','generic');}

  const base=(clean(filename)||'product.jpg').replace(/[\/:*?"<>|]+/g,'-').replace(/\.[a-z0-9]+$/i,'').slice(0,100)||'product';
  const safeName=`${base}.jpg`;
  const form=new FormData();
  form.append('chat_id',PRODUCT_IMAGE_CHAT_ID);
  form.append('photo',blob,safeName);
  form.append('disable_notification','true');

  const data=await telegramJson('sendPhoto',{body:form});
  const photos=Array.isArray(data?.result?.photo)?data.result.photo:[];
  if(!photos.length) throw buildError('Telegram لم يرجع معرّف الصورة.','generic');
  const best=photos[photos.length-1]||{};
  const fileId=clean(best.file_id);
  if(!fileId) throw buildError('Telegram لم يرجع معرّف الصورة.','generic');
  const fileUniqueId=clean(best.file_unique_id);

  let url='';
  try{url=await resolveProductImageUrl(fileId,{force:true});}catch(_){ }
  return {fileId,fileUniqueId,url,width:Number(best.width||0),height:Number(best.height||0)};
}

export function createPendingProductImageState(dataUrl, filename='product.jpg'){
  const name=(clean(filename)||'product.jpg').slice(0,140);
  return {
    imageData: clean(dataUrl),
    imagePendingUpload: true,
    imagePendingName: name,
    imageTelegramFileId: '',
    imageTelegramUniqueId: '',
    imageTelegramUrl: '',
    imageStorage: 'telegram-pending',
    imageUpdatedAt: new Date().toISOString(),
  };
}

export async function syncPendingProductImages({limit=12}={}){
  if(syncPromise) return syncPromise;
  syncPromise = (async()=>{
    if(isOffline()) return {processed:0, skipped:'offline'};
    const rows = await getAllFromStore('products').catch(()=>[]);
    const pending = (Array.isArray(rows)?rows:[]).filter((product)=> !!product && !product.deletedAt && product.imagePendingUpload && isDataImage(product.imageData));
    let processed = 0;
    for(const product of pending.slice(0, Math.max(1, Number(limit)||12))){
      try{
        const cleanName = clean(product.name || product.internalCode || product.id || 'product').replace(/[\/:*?"<>|]+/g,'-').slice(0,80) || 'product';
        const uploaded = await uploadProductImageToTelegram(product.imageData, `${cleanName}-${Date.now()}.jpg`);
        const updated = {
          ...product,
          imageData: '',
          imagePendingUpload: false,
          imagePendingName: '',
          imageTelegramFileId: uploaded.fileId,
          imageTelegramUniqueId: uploaded.fileUniqueId,
          imageTelegramUrl: uploaded.url || '',
          imageStorage: 'telegram-photo',
          imageUpdatedAt: new Date().toISOString(),
        };
        await putInStore('products', updated);
        processed += 1;
      }catch(error){
        if(isProductImageOfflineError(error)) break;
      }
    }
    return {processed};
  })();
  try{return await syncPromise;} finally {syncPromise = null;}
}

function schedulePendingSync(delay=1200){
  if(typeof window === 'undefined') return;
  if(syncTimer) clearTimeout(syncTimer);
  if(syncIdleId && 'cancelIdleCallback' in window){ try{window.cancelIdleCallback(syncIdleId);}catch(_){} syncIdleId=null; }
  syncTimer = setTimeout(()=>{
    syncTimer=null;
    const run=()=>{syncIdleId=null;syncPendingProductImages().catch(()=>{});};
    if('requestIdleCallback' in window) syncIdleId=window.requestIdleCallback(run,{timeout:1800});
    else run();
  }, Math.max(500, Number(delay)||0));
}

export function ensureProductImageAutoSync(){
  if(autoSyncStarted || typeof window === 'undefined') return;
  autoSyncStarted = true;
  const wake = () => schedulePendingSync(900);
  try{ window.addEventListener('online', wake); }catch(_){ }
  try{ window.addEventListener('focus', wake); }catch(_){ }
  try{ document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) wake(); }); }catch(_){ }
  try{ window.addEventListener('oscar:db-mutation', (event)=>{ if(event?.detail?.storeName === 'products') wake(); }); }catch(_){ }
  schedulePendingSync(1800);
}
