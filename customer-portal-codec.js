const enc = new TextEncoder();
const dec = new TextDecoder();
const PORTAL_SECRET = 'OSCAR-CUSTOMER-PORTAL-2026-V1|READONLY|MZAUTH';

function b64url(bytes){
  let out='';
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step) out += String.fromCharCode(...bytes.subarray(i,i+step));
  return btoa(out).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64url(text){
  let s=String(text||'').replace(/-/g,'+').replace(/_/g,'/');
  while(s.length%4) s+='=';
  const bin=atob(s), out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function key(){
  const digest=await crypto.subtle.digest('SHA-256',enc.encode(PORTAL_SECRET));
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function streamTransform(bytes,type){
  const C = type==='compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if(!C) return null;
  try{
    const stream=new Blob([bytes]).stream().pipeThrough(new C('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }catch(_){return null;}
}
export async function encodeCustomerPortalAccess(payload){
  if(!crypto?.subtle) throw new Error('هذا المتصفح لا يدعم تشفير رابط العميل.');
  const compact={v:1,d:String(payload?.d||''),t:String(payload?.t||''),c:String(payload?.c||''),u:String(payload?.u||''),n:String(payload?.n||'')};
  if(!compact.d||!compact.t||!compact.c||!compact.u||!compact.n) throw new Error('بيانات رابط العميل غير مكتملة.');
  const plain=enc.encode(JSON.stringify(compact));
  const compressed=await streamTransform(plain,'compress');
  const useCompressed=compressed && compressed.length+8<plain.length;
  const body=useCompressed?compressed:plain;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),body));
  const packed=new Uint8Array(1+iv.length+cipher.length);
  packed[0]=useCompressed?1:0; packed.set(iv,1); packed.set(cipher,13);
  return 'cp1.'+b64url(packed);
}
export async function decodeCustomerPortalAccess(code){
  const rawCode=String(code||'').trim().replace(/^#/,'');
  if(!rawCode.startsWith('cp1.')) throw new Error('رابط العميل غير صالح.');
  const raw=unb64url(rawCode.slice(4));
  if(raw.length<30) throw new Error('رابط العميل غير مكتمل.');
  const flag=raw[0],iv=raw.slice(1,13),cipher=raw.slice(13);
  let bytes;
  try{bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},await key(),cipher));}
  catch(_){throw new Error('تعذر فتح رابط العميل أو تم تعديل الرابط.');}
  if(flag===1){const inflated=await streamTransform(bytes,'decompress');if(!inflated)throw new Error('تعذر فك بيانات رابط العميل.');bytes=inflated;}
  let payload;try{payload=JSON.parse(dec.decode(bytes));}catch(_){throw new Error('بيانات رابط العميل غير صالحة.');}
  if(payload?.v!==1||!payload.d||!payload.t||!payload.c||!payload.u||!payload.n)throw new Error('بيانات رابط العميل غير مكتملة.');
  return payload;
}
