import { encodeCustomerPortalAccess } from './customer-portal-codec.js?v=7.9.4.136-localization';
import { TRIAL_DATABASE } from './trial__config.js?v=7.9.4.136-localization';

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean=v=>String(v??'').trim();

function fnvCode(input,len=5){
  let h=2166136261>>>0;
  const text=String(input||'oscar');
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  let out='';
  for(let i=0;i<len;i++){
    h=(Math.imul(h^((h>>>13)&0xffff),2246822519)+3266489917)>>>0;
    out+=ALPHABET[h%ALPHABET.length];
  }
  return out;
}
function randomCode(len=5){
  const bytes=new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');
}
function makeNonce(){
  const bytes=crypto.getRandomValues(new Uint8Array(10));
  let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
  return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
async function registerShortLink({companyCode,customerCode,accessCode,companyId,customerId}){
  let registryOk=false, serverOk=false;
  // سجل عام صغير للرابط المختصر يعمل حتى على الاستضافة الثابتة بدون server.js.
  try{
    const direct=window.OscarActivation?.tursoDirect;
    if(direct){
      const path=`oscar/public/customer_short_links/${companyCode}/${customerCode}`;
      await direct.writeExact(TRIAL_DATABASE,path,{accessCode,companyCode,customerCode,companyId,customerId,updatedAt:new Date().toISOString()},Date.now(),false);
      registryOk=true;
    }
  }catch(_){ }
  // نبقي مسار server.js اختيارياً كنسخة ثانية إذا كان الخادم المحلي مستخدماً.
  try{
    const response=await fetch('/api/customer-short-link',{
      method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
      body:JSON.stringify({companyCode,customerCode,accessCode,companyId,customerId})
    });
    const data=await response.json().catch(()=>null);
    serverOk=!!(response.ok&&data?.ok);
  }catch(_){ }
  return registryOk||serverOk;
}

export function getCompanyPortalCode(companyId){return fnvCode(clean(companyId)||'oscar',5);}

export async function createCustomerPortalLinks(customer,{saveCustomer=null,forceNew=false}={}){
  const runtime=window.OscarActivation?.readRuntime?.()||null;
  const readDb=runtime?.customerDatabase||null;
  if(!runtime?.companyId||!readDb?.databaseURL||!readDb?.authToken) throw new Error('بوابة العملاء تحتاج ملف دخول يحتوي على بيانات القراءة السحابية.');
  let current={...(customer||{})};
  let changed=false;
  if(!current.id) throw new Error('بيانات العميل غير مكتملة.');
  if(forceNew||!current.portalNonce){current.portalNonce=makeNonce();changed=true;}
  if(forceNew||!/^[A-Z2-9]{5}$/.test(clean(current.portalShortCode))){current.portalShortCode=randomCode(5);changed=true;}
  current.portalEnabled=true;
  if(changed){current.portalUpdatedAt=new Date().toISOString();if(saveCustomer)await saveCustomer(current);}
  const accessCode=await encodeCustomerPortalAccess({d:readDb.databaseURL,t:readDb.authToken,c:runtime.companyId,u:current.id,n:current.portalNonce});
  const companyCode=getCompanyPortalCode(runtime.companyId);
  const customerCode=clean(current.portalShortCode).toUpperCase();
  const base=new URL('./customer.html',window.location.href);base.search='';base.hash='';
  const longPortal=new URL(base.toString());longPortal.hash=accessCode;
  const paymentBase=new URL('./معتمد.html',window.location.href);paymentBase.search='';paymentBase.hash=accessCode;
  const shortPortal=new URL(base.toString());shortPortal.searchParams.set('c',companyCode);shortPortal.searchParams.set('u',customerCode);
  const shortPayment=new URL('./معتمد.html',window.location.href);shortPayment.search='';shortPayment.hash='';shortPayment.searchParams.set('c',companyCode);shortPayment.searchParams.set('u',customerCode);
  const registered=await registerShortLink({companyCode,customerCode,accessCode,companyId:runtime.companyId,customerId:current.id});
  const portalUrl=shortPortal.toString(),paymentUrl=shortPayment.toString(),isShort=true;
  if(changed&&window.OscarCloudSync?.syncNow&&navigator.onLine!==false){try{await window.OscarCloudSync.syncNow({manual:false,force:true});}catch(_){}}
  return {customer:current,portalUrl,paymentUrl,accessCode,companyCode,customerCode,isShort,registered,longPortalUrl:longPortal.toString(),longPaymentUrl:paymentBase.toString()};
}
