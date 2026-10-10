const CACHE_NAME = 'shahd-accounting-v25-payment-voucher-fix-offline';
const APP_SHELL = [
  './','./index.html','./styles.css','./permissions.js','./shahd-turso.js','./auth-sync.js','./shahd-media.js','./app.js',
  './manifest.webmanifest','./shahd-logo.jpg','./icon-192.png','./icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    // Cache files individually so one optional file can never break the whole offline install.
    await Promise.all(APP_SHELL.map(async url=>{try{await cache.add(new Request(url,{cache:'reload'}));}catch(_){}}));
    // index.html is the critical offline fallback.
    const index=await cache.match('./index.html');
    if(!index)throw new Error('Offline shell was not cached.');
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function refresh(request){
  try{
    const live=await fetch(request,{cache:'no-store'});
    if(live?.ok){const cache=await caches.open(CACHE_NAME);await cache.put(request,live.clone());}
  }catch(_){}
}

self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(/\/admin(?:\.html|\.js)?$/i.test(url.pathname))return;

  if(event.request.mode==='navigate'){
    event.respondWith((async()=>{
      const cached=await caches.match('./index.html',{ignoreSearch:true});
      if(cached){event.waitUntil(refresh(event.request));return cached;}
      try{return await fetch(event.request);}catch(_){return new Response('تطبيق شهد غير متاح دون إنترنت قبل فتحه مرة واحدة أثناء الاتصال.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
    })());
    return;
  }

  if(!/\.(?:html|js|css|webmanifest|png|jpg|jpeg|svg)$/i.test(url.pathname))return;
  event.respondWith((async()=>{
    const cached=await caches.match(event.request,{ignoreSearch:true});
    if(cached){event.waitUntil(refresh(event.request));return cached;}
    try{
      const live=await fetch(event.request);
      if(live?.ok){const cache=await caches.open(CACHE_NAME);await cache.put(event.request,live.clone());}
      return live;
    }catch(_){return new Response('',{status:504,statusText:'Offline'});}
  })());
});
