const BUILD='7.9.4.136-localization';
const CACHE=`oscar-accounting-${BUILD}`;
const RUNTIME_CACHE=`oscar-accounting-runtime-${BUILD}`;
const LOCAL=["./services__financialClose.js?v=7.9.4.136-localization","./hooks__appNavigation.js?v=7.9.4.136-localization","./services__i18n.js?v=7.9.4.136-localization","./locales__ui.js?v=7.9.4.136-localization","./components__common__LanguagePicker.js?v=7.9.4.136-localization","./components__sales__SalesFilters.js?v=7.9.4.136-localization","./components__common__StartupScreen.js?v=7.9.4.136-localization","./utils__customerStatement.js?v=7.9.4.136-localization","./components__customers__StatementTable.js?v=7.9.4.136-localization","./services__cartReturn.js?v=7.9.4.136-localization","./components__common__ModalLayer.js?v=7.9.4.136-localization","./components__products__ProductActions.js?v=7.9.4.136-localization","./components__pos__CategoryStrip.js?v=7.9.4.136-localization","./utils__overlayGuard.js?v=7.9.4.136-localization","./components__common__DesktopNavigation.js?v=7.9.4.136-localization","./components__pos__DesktopCheckout.js?v=7.9.4.136-localization","./services__customerPortalLinks.js?v=7.9.4.136-localization","./components__common__MessageActionButtons.js?v=7.9.4.136-localization","./components__common__BrandLogoImage.js?v=7.9.4.136-localization","./components__settings__TelegramQuickGuide.js?v=7.9.4.136-localization","./components__messages__MessageTemplatesView.js?v=7.9.4.136-localization","./components__support__SupportView.js?v=7.9.4.136-localization","./services__productImages.js?v=7.9.4.136-localization","./services__telegram.js?v=7.9.4.136-localization","./services__telegramReports.js?v=7.9.4.136-localization","./services__printer.js?v=7.9.4.136-localization","./utils__permissions.js?v=7.9.4.136-localization","./components__purchases__PurchaseAIScanModal.js?v=7.9.4.136-localization","./services__ai.js?v=7.9.4.136-localization","./services__aiActions.js?v=7.9.4.136-localization","./utils__aiMatching.js?v=7.9.4.136-localization","./App.js?v=7.9.4.136-localization","./app-icon.png","./brand-logo.png","./p2p-palpay.jpg","./p2p-jawwal-pay.png","./p2p-bank-palestine.jpg","./app.css","./components__accounts__AccountsView.js?v=7.9.4.136-localization","./components__auth__LoginGate.js?v=7.9.4.136-localization","./components__barcodes__BarcodesView.js?v=7.9.4.136-localization","./components__categories__CategoriesView.js?v=7.9.4.136-localization","./components__common__BottomNav.js?v=7.9.4.136-localization","./components__common__ProductImage.js?v=7.9.4.136-localization","./components__common__Dropdown.js?v=7.9.4.136-localization","./components__common__Header.js?v=7.9.4.136-localization","./components__common__NotificationsModal.js?v=7.9.4.136-localization","./components__common__Pagination.js?v=7.9.4.136-localization","./components__common__PWAInstallButton.js?v=7.9.4.136-localization","./components__common__Sidebar.js?v=7.9.4.136-localization","./components__common__Toast.js?v=7.9.4.136-localization","./components__customers__CustomersView.js?v=7.9.4.136-localization","./components__dashboard__DashboardView.js?v=7.9.4.136-localization","./components__employees__EmployeesView.js?v=7.9.4.136-localization","./components__expenses__ExpensesView.js?v=7.9.4.136-localization","./components__financial__FinancialYearsView.js?v=7.9.4.136-localization","./components__inventory__InventoryView.js?v=7.9.4.136-localization","./components__inventory__TransferForm.js?v=7.9.4.136-localization","./components__pos__CameraScannerModal.js?v=7.9.4.136-localization","./components__pos__CartPanel.js?v=7.9.4.136-localization","./components__pos__FullCartView.js?v=7.9.4.136-localization","./components__pos__HoldInvoicesModal.js?v=7.9.4.136-localization","./components__pos__POSView.js?v=7.9.4.136-localization","./components__pos__PaymentModal.js?v=7.9.4.136-localization","./components__pos__ProductGrid.js?v=7.9.4.136-localization","./components__pos__ThermalReceiptModal.js?v=7.9.4.136-localization","./components__products__ProductsView.js?v=7.9.4.136-localization","./components__purchases__PurchasesView.js?v=7.9.4.136-localization","./components__reports__ReportsView.js?v=7.9.4.136-localization","./components__sales__SalesView.js?v=7.9.4.136-localization","./components__settings__SettingsView.js?v=7.9.4.136-localization","./components__suppliers__SuppliersView.js?v=7.9.4.136-localization","./components__sync__SyncModal.js?v=7.9.4.136-localization","./components__trash__TrashView.js?v=7.9.4.136-localization","./components__vouchers__VouchersView.js?v=7.9.4.136-localization","./context__AppContext.js?v=7.9.4.136-localization","./hooks__usePWAInstall.js?v=7.9.4.136-localization","./icon-192.png","./icon-192.png?v=7.9.4.136-localization","./icon-512.png","./icon-512.png?v=7.9.4.136-localization","./icon-maskable-512.png","./icon-maskable-512.png?v=7.9.4.136-localization","./icon.svg","./index.html","./main.js?v=7.9.4.136-localization","./manifest.webmanifest","./services__audio.js?v=7.9.4.136-localization","./services__db.js?v=7.9.4.136-localization","./trial__config.js?v=7.9.4.136-localization","./types__index.js?v=7.9.4.136-localization","./utils__export.js?v=7.9.4.136-localization","./utils__canvasRenderer.js?v=7.9.4.136-localization","./utils__imageExport.js?v=7.9.4.136-localization","./utils__pdfExport.js?v=7.9.4.136-localization","./utils__professionalExport.js?v=7.9.4.136-localization","./brand__logo.js?v=7.9.4.136-localization","./utils__unitTree.js?v=7.9.4.136-localization","./utils__code128.js?v=7.9.4.136-localization","./utils__qrcode.js?v=7.9.4.136-localization","./oscar-activation-runtime.js?v=7.9.4.136-localization","./oscar-cloud-sync.js?v=7.9.4.136-localization","./restaurant__context__AppContext.js?v=7.9.4.136-localization","./restaurant__context__RestaurantContext.js?v=7.9.4.136-localization","./restaurant__services__restaurantService.js?v=7.9.4.136-localization","./restaurant__services__db.js?v=7.9.4.136-localization","./restaurant__services__kitchenPrint.js?v=7.9.4.136-localization","./restaurant__components__RestaurantSettingsPanel.js?v=7.9.4.136-localization","./restaurant__components__RestaurantTablesView.js?v=7.9.4.136-localization","./restaurant__components__RestaurantWasteView.js?v=7.9.4.136-localization","./restaurant__components__RestaurantKDSView.js?v=7.9.4.136-localization","./restaurant__components__RestaurantWaiterView.js?v=7.9.4.136-localization","./restaurant__components__ItemModifierModal.js?v=7.9.4.136-localization","./restaurant__components__KitchenTicketModal.js?v=7.9.4.136-localization","./trial-payment.html","./support.html","./oscar-ledger.html","./oscar-ledger-cloud.js?v=7.9.4.136-localization","./oscar-ledger-sync.js?v=7.9.4.136-localization","./ledger-assets/download-icon.png","./trial-admin.html","./admin.html","./master-admin.js?v=7.9.4.136-localization","./customer.html","./معتمد.html","./customer-portal.js?v=7.9.4.136-localization","./customer-portal-codec.js?v=7.9.4.136-localization"];
const REMOTE=[
  'https://esm.sh/react@19.3.0',
  'https://esm.sh/react-dom@19.3.0?external=react',
  'https://esm.sh/react-dom@19.3.0/client?external=react',
  'https://esm.sh/react@19.3.0/jsx-runtime',
  'https://esm.sh/lucide-react@0.546.0?external=react',
  'https://esm.sh/jsbarcode@3.12.3',
  'https://esm.sh/xlsx@0.18.5',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@200;300;400;500;600;700;800;900&display=swap'
];
const cacheable=r=>!!r&&(r.ok||r.type==='opaque');
async function putFresh(cache,url){try{const req=new Request(url,{cache:'no-cache',mode:url.startsWith('http')?'cors':'same-origin'});const r=await fetch(req);if(cacheable(r))await cache.put(url,r.clone())}catch(_){} }

async function cacheRemoteTree(cache,url,seen=new Set(),depth=0){
  if(depth>5||seen.has(url))return;seen.add(url);
  try{
    const r=await fetch(new Request(url,{cache:'no-cache',mode:'cors'}));
    if(!cacheable(r))return;
    await cache.put(url,r.clone());
    const type=(r.headers.get('content-type')||'').toLowerCase();
    if(!(type.includes('javascript')||type.includes('ecmascript')||type.includes('css')))return;
    const text=await r.clone().text();
    const deps=new Set();
    if(type.includes('css')){
      for(const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)){const spec=m[1];if(spec&& !spec.startsWith('data:'))deps.add(new URL(spec,url).href)}
    }else{
      for(const m of text.matchAll(/(?:from\s*|import\s*\(?)['"]([^'"]+)['"]/g)){const spec=m[1];if(spec&&(spec.startsWith('/')||spec.startsWith('./')||spec.startsWith('../')||/^https?:/.test(spec)))deps.add(new URL(spec,url).href)}
    }
    await Promise.allSettled([...deps].map(dep=>cacheRemoteTree(cache,dep,seen,depth+1)));
  }catch(_){}
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled(LOCAL.map(u=>putFresh(cache,u)));
  const runtime=await caches.open(RUNTIME_CACHE);
  await Promise.allSettled(REMOTE.map(u=>cacheRemoteTree(runtime,u)));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Keep the previous Oscar caches as an offline safety net. Old builds used to
  // delete them during every update, which could leave the app unable to open
  // when the network disappeared before the new dependency tree finished caching.
  await self.clients.claim();
})()));
async function update(cache,request){try{const fresh=await fetch(new Request(request,{cache:'no-cache'}));if(cacheable(fresh))await cache.put(request,fresh.clone());return fresh}catch(_){return null}}
async function matchPreviousOscarCache(request,{runtime=false,ignoreSearch=false}={}){
  try{
    const keys=(await caches.keys()).filter((key)=>runtime
      ? key.startsWith('oscar-accounting-runtime-')
      : key.startsWith('oscar-accounting-')&&!key.startsWith('oscar-accounting-runtime-'));
    for(let i=keys.length-1;i>=0;i--){
      const key=keys[i];
      if(key===(runtime?RUNTIME_CACHE:CACHE))continue;
      const oldCache=await caches.open(key);
      const hit=await oldCache.match(request,{ignoreSearch});
      if(hit)return hit;
    }
  }catch(_){}
  return null;
}
async function sameOriginResponse(request,event){
  const cache=await caches.open(CACHE);
  // Prefer an exact versioned hit. If this build has not been cached yet, try the
  // network once so an old ignoreSearch entry cannot pin the app to stale code.
  const exact=await cache.match(request);
  if(exact)return exact;
  const fallback=await cache.match(request,{ignoreSearch:true});
  const fresh=await update(cache,request);if(fresh)return fresh;
  // Offline safety: when the new build has never been fetched, an older local
  // copy is still better than a blank screen. The next online launch refreshes it.
  if(fallback)return fallback;
  const previous=await matchPreviousOscarCache(request,{ignoreSearch:true});
  if(previous)return previous;
  if(request.mode==='navigate'){
    const localIndex=await cache.match('./index.html',{ignoreSearch:true});
    if(localIndex)return localIndex;
    const oldIndex=await matchPreviousOscarCache(new Request(new URL('./index.html',self.location.href)),{ignoreSearch:true});
    if(oldIndex)return oldIndex;
    return Response.error();
  }
  return new Response('',{status:503,statusText:'Offline'});
}
async function externalResponse(request,event){
  const cache=await caches.open(RUNTIME_CACHE);
  const cached=await cache.match(request);
  if(cached)return cached;
  const fresh=await update(cache,request);if(fresh)return fresh;
  const previous=await matchPreviousOscarCache(request,{runtime:true,ignoreSearch:false});
  if(previous)return previous;
  return new Response('',{status:503,statusText:'Offline'});
}
self.addEventListener('fetch',event=>{
  const request=event.request;if(request.method!=='GET')return;
  const url=new URL(request.url);
  event.respondWith(url.origin===self.location.origin?sameOriginResponse(request,event):externalResponse(request,event));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
