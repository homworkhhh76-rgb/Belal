const CACHE_NAME = 'shahd-accounting-v20-fast-session-mobile-nav';
const ASSETS = [
  './','./index.html','./styles.css','./permissions.js','./shahd-turso.js','./auth-sync.js','./app.js',
  './manifest.webmanifest','./shahd-logo.jpg','./icon-192.png','./icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function backgroundRefresh(request) {
  try { const response=await fetch(request,{cache:'no-store'}); if(response?.ok){const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());} } catch (_) {}
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url=new URL(event.request.url);
  if (/\/admin(?:\.html|\.js)?$/i.test(url.pathname)) return; // admin is intentionally not cached
  if (url.origin !== self.location.origin) return;
  const localAsset = event.request.mode==='navigate' || /\.(?:html|js|css|webmanifest|png|jpg|jpeg|svg)$/.test(url.pathname);
  if(!localAsset)return;
  event.respondWith((async()=>{
    const cached=await caches.match(event.request,{ignoreSearch:true});
    if(cached){event.waitUntil(backgroundRefresh(event.request));return cached;}
    try{const live=await fetch(event.request);if(live?.ok){const cache=await caches.open(CACHE_NAME);cache.put(event.request,live.clone());}return live;}catch(_){
      if(event.request.mode==='navigate')return caches.match('./index.html');
      throw _;
    }
  })());
});
