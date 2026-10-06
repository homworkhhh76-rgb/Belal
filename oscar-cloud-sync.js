/* Cash Top 3 Cloud Sync v2 - IndexedDB durable queue, tenant isolated, local-first delta sync */
(()=>{'use strict';
const VERSION='OscarSyncV3-RestaurantRealtime';
const STORES=new Set(['products','categories','warehouses','stock','stock_movements','invoices','purchases','customers','suppliers','partner_statements','accounts','transfers','expenses','shifts','audit_logs','held_invoices','settings','vouchers','employees','restaurant_tables','restaurant_sections','restaurant_orders','kitchen_sections','table_reservations','recipes','waste_records']);
const REALTIME_STORES=new Set(['restaurant_tables','restaurant_sections','restaurant_orders','kitchen_sections','table_reservations','recipes','waste_records']);
const PAGED_HISTORY_STORES=new Set(['invoices','purchases','stock_movements','expenses','vouchers','transfers','audit_logs','partner_statements','held_invoices']);
const META_PREFIX='oscar_sync_meta_v2::', LEGACY_PENDING_PREFIX='oscar_sync_pending_v1::', DEVICE_KEY='oscar_sync_device_v1', RT_SEEN_PREFIX='oscar_rt_seen_v3::';
let bridge=null, initialized=false, busy=false, suppress=false, syncTimer=null, probeTimer=null, bc=null, schemaTenant='', seq=0, lastProbe=0, lastRealtimePull=0, realtimePullBusy=false, rerunRequested=false;
let pendingCache=null, pendingHydrated=false, hydratePromise=null;
const safe=v=>String(v??'').trim();
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const tenant=()=>safe(window.OscarActivation?.readRuntime?.()?.companyId||'');
const cfg=()=>window.OscarActivation?.readDatabaseAccess?.(tenant())||window.OscarActivation?.readRuntime?.()?.database||null;
function deviceId(){let x=localStorage.getItem(DEVICE_KEY);if(!x){x='DEV-'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem(DEVICE_KEY,x)}return x}
function metaKey(t=tenant()){return META_PREFIX+encodeURIComponent(t||'none')}
function legacyPendingKey(t=tenant()){return LEGACY_PENDING_PREFIX+encodeURIComponent(t||'none')}
function realtimeSeenKey(t=tenant()){return RT_SEEN_PREFIX+encodeURIComponent(t||'none')}
function readRealtimeSeen(){try{return JSON.parse(localStorage.getItem(realtimeSeenKey())||'{}')}catch(_){return{}}}
function writeRealtimeSeen(v){try{localStorage.setItem(realtimeSeenKey(),JSON.stringify(v||{}))}catch(_){}}
function readMeta(){try{return JSON.parse(localStorage.getItem(metaKey())||'{}')}catch(_){return{}}}
function writeMeta(m){try{localStorage.setItem(metaKey(),JSON.stringify(m||{}))}catch(_){}}
function readLegacyPending(){try{return JSON.parse(localStorage.getItem(legacyPendingKey())||'{}')}catch(_){return{}}}
function readPending(){return pendingCache||readLegacyPending()||{}}
function pendingCount(){return Object.keys(readPending()).length}
function pendingItems(){return Object.entries(readPending()).sort((a,b)=>Number(b[1]?.rev||0)-Number(a[1]?.rev||0)).map(([id,o])=>({id,entity:o.store,syncId:String(o.rev||id),timestamp:o.timestamp||Date.now(),action:o.deleted?'delete':'upsert',data:o.value||null,status:'pending',attempts:Number(o.attempts||0)}))}
function nextRev(){const now=Date.now()*1000;seq=(seq+1)%900;return now+seq}
function keyString(store,value,explicit){if(explicit!==undefined&&explicit!==null){if(store==='stock')return JSON.stringify(Array.isArray(explicit)?explicit:[explicit]);return String(explicit)}if(store==='stock')return JSON.stringify([value?.productId||'',value?.warehouseId||'']);if(store==='settings')return String(value?.key||'store_config');return String(value?.id||'')}
function actualKey(store,k){if(store==='stock'){try{return JSON.parse(k)}catch(_){return String(k)}}return k}
const pk=(store,key)=>store+'\u0001'+key;
const prefix=()=>`oscar/companies/${encodeURIComponent(tenant())}/d/`;
const pathFor=(store,key)=>prefix()+encodeURIComponent(store)+'/'+encodeURIComponent(key);
function parsePath(path){const p=String(path||''),pre=prefix();if(!p.startsWith(pre))return null;const rest=p.slice(pre.length),cut=rest.indexOf('/');if(cut<1)return null;try{return{store:decodeURIComponent(rest.slice(0,cut)),key:decodeURIComponent(rest.slice(cut+1))}}catch(_){return null}}
function emitStatus(extra={}){const detail={version:VERSION,pending:pendingCount(),busy,isOnline:navigator.onLine!==false,tenant:tenant(),queueStorage:'indexeddb',...extra};try{window.dispatchEvent(new CustomEvent('oscar:sync-status',{detail}))}catch(_){}}
function broadcast(type){try{bc?.postMessage?.({type,tenant:tenant(),deviceId:deviceId(),at:Date.now()})}catch(_){}}
async function hydratePending(){
  if(pendingHydrated)return readPending();
  if(hydratePromise)return hydratePromise;
  hydratePromise=(async()=>{
    const merged={...readLegacyPending()};
    if(bridge){
      try{
        const rows=await bridge.getAllFromStore('sync_queue');
        const stale=[];
        for(const row of rows||[]){
          if(!row?.__oscarCloudOp||!row.id||!row.store){if(row?.id)stale.push(row.id);continue;}
          const {id,__oscarCloudOp,...op}=row;
          const cur=merged[id];
          if(!cur||Number(op.rev||0)>=Number(cur.rev||0))merged[id]=op;
        }
        await Promise.allSettled(stale.map(id=>bridge.deleteFromStore('sync_queue',id,false)));
      }catch(e){console.warn('[OscarSync] queue hydrate warning',e)}
    }
    pendingCache=merged;pendingHydrated=true;
    if(bridge){
      await Promise.allSettled(Object.entries(merged).map(([id,o])=>bridge.putInStore('sync_queue',{id,__oscarCloudOp:true,...clone(o)},false)));
    }
    try{localStorage.removeItem(legacyPendingKey())}catch(_){ }
    emitStatus({state:'queue-ready'});
    return merged;
  })().finally(()=>{hydratePromise=null});
  return hydratePromise;
}
async function persistPendingOp(id,op){
  if(!pendingHydrated)await hydratePending();
  pendingCache=pendingCache||{};pendingCache[id]=clone(op);
  if(bridge)await bridge.putInStore('sync_queue',{id,__oscarCloudOp:true,...clone(op)},false);
  emitStatus();
}
async function removePendingOp(id,rev=0){
  if(!pendingHydrated)await hydratePending();
  const cur=pendingCache?.[id];
  if(cur&&rev&&Number(cur.rev||0)!==Number(rev||0))return false;
  if(pendingCache)delete pendingCache[id];
  if(bridge)await bridge.deleteFromStore('sync_queue',id,false).catch(()=>{});
  emitStatus();return true;
}
async function captureStoreChange(store,value,{deleted=false,key,localUserWrite=false}={}){
  if((suppress&&!localUserWrite)||!STORES.has(store)||!tenant())return false;
  const k=keyString(store,value,key);if(!k)return false;
  let outgoing=deleted?null:clone(value);
  // Product photos selected while offline stay only in IndexedDB until Telegram upload succeeds.
  // Never place their base64 bytes in the Turso sync queue/database.
  if(store==='products'&&outgoing&&outgoing.imagePendingUpload&&typeof outgoing.imageData==='string'&&outgoing.imageData.startsWith('data:image/')){
    outgoing={...outgoing,imageData:'',imagePendingUpload:false,imagePendingName:'',imageStorage:outgoing.imageTelegramFileId?'telegram-photo':''};
  }
  const rev=nextRev(),id=pk(store,k),op={store,key:k,deleted:!!deleted,value:outgoing,rev,deviceId:deviceId(),timestamp:Date.now(),attempts:0};
  await persistPendingOp(id,op);
  const realtime=REALTIME_STORES.has(store)||(store==='settings'&&k==='store_config');
  broadcast('local-change');
  requestSync(realtime?15:80);
  // Restaurant/settings operations should leave the device immediately.
  // Use a compact single-record flush first; the durable queue remains the fallback.
  if(realtime&&navigator.onLine!==false){
    Promise.resolve().then(()=>flushRealtimeOp(id,op)).catch(()=>requestSync(60));
  }
  return true;
}
async function ensureSchema(){const t=tenant(),d=window.OscarActivation?.tursoDirect,c=cfg();if(!t||!d||!c?.databaseURL||!c?.authToken)throw Error('بيانات مزامنة الشركة غير متاحة.');const table=d.table(c),metaTable=table+'_syncmeta';if(schemaTenant===t)return{d,c,table,metaTable};await d.ensure(c);const[info]=await d.pipeline(c,[{sql:`PRAGMA table_info(${table})`,args:[]}]);const cols=d.rows(info).map(x=>String(x.name));if(!cols.includes('sync_batch')){try{await d.pipeline(c,[{sql:`ALTER TABLE ${table} ADD COLUMN sync_batch INTEGER NOT NULL DEFAULT 0`,args:[]}])}catch(e){if(!/duplicate column|already exists/i.test(String(e?.message||e)))throw e}}await d.pipeline(c,[{sql:`CREATE TABLE IF NOT EXISTS ${metaTable} (id INTEGER PRIMARY KEY CHECK(id=1),batch INTEGER NOT NULL DEFAULT 0)`,args:[]},{sql:`INSERT OR IGNORE INTO ${metaTable}(id,batch) VALUES(1,0)`,args:[]},{sql:`CREATE INDEX IF NOT EXISTS idx_${table}_sync_batch ON ${table}(sync_batch,path)`,args:[]}]);schemaTenant=t;return{d,c,table,metaTable}}
async function remoteBatch(s){const[r]=await s.d.pipeline(s.c,[{sql:`SELECT batch FROM ${s.metaTable} WHERE id=1`,args:[]}]);return Number(s.d.rows(r)[0]?.batch||0)}
function buildStatements(s,batch){const st=[{sql:`UPDATE ${s.metaTable} SET batch=batch+1 WHERE id=1`,args:[]}];for(const[id,o]of batch){const env={v:o.deleted?null:o.value,deleted:!!o.deleted,rev:Number(o.rev||nextRev()),deviceId:o.deviceId||deviceId(),tenantId:tenant()};st.push({sql:`INSERT INTO ${s.table}(path,payload,deleted,updated_at,sync_batch) VALUES(?,?,?,?,(SELECT batch FROM ${s.metaTable} WHERE id=1)) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,deleted=excluded.deleted,updated_at=excluded.updated_at,sync_batch=excluded.sync_batch WHERE excluded.updated_at>=${s.table}.updated_at`,args:[pathFor(o.store,o.key),JSON.stringify(env),o.deleted?1:0,Number(o.rev||nextRev())]})}return st}
async function flushRealtimeOp(id,op){
  if(!op||navigator.onLine===false||!tenant())return false;
  const s=await ensureSchema();
  try{
    await s.d.pipeline(s.c,buildStatements(s,[[id,op]]),30000);
    await removePendingOp(id,op.rev);
    broadcast('synced');
    emitStatus({state:'realtime-pushed',realtimeStore:op.store});
    return true;
  }catch(e){
    console.warn('[OscarSync] realtime push fallback queued',e);
    return false;
  }
}
function realtimePaths(){
  const pre=prefix(), ranges=[];
  for(const store of REALTIME_STORES){const p=pre+encodeURIComponent(store)+'/';ranges.push([p,p+'\uffff']);}
  return ranges;
}
function revToMs(rev){const n=Number(rev||0);return n>100000000000000?Math.floor(n/1000):n}
function isoMs(v){const t=new Date(v||0).getTime();return Number.isFinite(t)?t:0}
function movementKey(productId,warehouseId){return String(productId||'')+'\u0001'+String(warehouseId||'')}
async function prepareRemoteValue(store,key,value,remoteRev,{deleted=false,latestMovementMap=null,repairs=null}={}){
  if(!bridge)return{skip:false,value};
  if(store==='settings'&&key==='store_config'&&value&&typeof value==='object'){
    try{
      const local=await bridge.getFromStore?.('settings','store_config');
      if(local?.activeWarehouseId){
        return{skip:false,value:{...value,activeWarehouseId:local.activeWarehouseId}};
      }
    }catch(_){ }
    return{skip:false,value};
  }
  if(store==='products'&&!deleted){
    let local=null;try{local=await bridge.getFromStore?.('products',actualKey('products',key))}catch(_){local=null}
    if(local?.imagePendingUpload&&typeof local.imageData==='string'&&local.imageData.startsWith('data:image/')){
      const localImageTs=isoMs(local.imageUpdatedAt),remoteImageTs=isoMs(value?.imageUpdatedAt);
      if(!value?.imageTelegramFileId||!remoteImageTs||localImageTs>=remoteImageTs){
        return{skip:false,value:{...value,imageData:local.imageData,imagePendingUpload:true,imagePendingName:local.imagePendingName||'',imageStorage:'telegram-pending',imageUpdatedAt:local.imageUpdatedAt||value?.imageUpdatedAt}};
      }
    }
    return{skip:false,value};
  }
  if(store!=='stock')return{skip:false,value};
  let local=null;try{local=await bridge.getFromStore?.('stock',actualKey('stock',key))}catch(_){local=null}
  if(!local)return{skip:false,value};
  const localTs=isoMs(local.updatedAt),remotePayloadTs=isoMs(value?.updatedAt),remoteTs=remotePayloadTs||revToMs(remoteRev);
  if(localTs&&remoteTs&&localTs>remoteTs+2){if(repairs)repairs.push(local);return{skip:true,value:local}}
  const localQty=Number(local.baseQuantity)||0,remoteQty=deleted?0:(Number(value?.baseQuantity)||0);
  // Legacy cloud rows had no updatedAt. A zero/delete is accepted only when the latest
  // stock movement agrees with it; otherwise preserve the verified local balance and repair cloud.
  if(localQty>0&&remoteQty===0&&!remotePayloadTs){
    let latest=latestMovementMap?.get(movementKey(local.productId,local.warehouseId));
    if(!latest&&!latestMovementMap&&bridge?.getLatestStockMovementLocal){
      try{latest=await bridge.getLatestStockMovementLocal(local.productId,local.warehouseId)}catch(_){latest=null}
    }
    const latestBalance=Number(latest?.newBaseBalance);
    if(Number.isFinite(latestBalance)){
      if(Math.abs(latestBalance-localQty)<0.000001){if(repairs)repairs.push(local);return{skip:true,value:local}}
      if(Math.abs(latestBalance-remoteQty)<0.000001)return{skip:false,value};
    }else if(local.balanceVerifiedByMovement){
      if(repairs)repairs.push(local);return{skip:true,value:local};
    }
  }
  return{skip:false,value};
}
async function pullRealtimeSnapshot({force=false}={}){
  if(realtimePullBusy||!bridge||!tenant()||navigator.onLine===false||document.visibilityState==='hidden')return{applied:0};
  const now=Date.now();if(!force&&now-lastRealtimePull<2200)return{applied:0};lastRealtimePull=now;realtimePullBusy=true;
  try{
    await hydratePending();
    const s=await ensureSchema(),ranges=realtimePaths(),parts=[],args=[];
    for(const [lo,hi] of ranges){parts.push('(path>=? AND path<?)');args.push(lo,hi);}
    const settingsPath=pathFor('settings','store_config');parts.push('path=?');args.push(settingsPath);
    const [r]=await s.d.pipeline(s.c,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE ${parts.join(' OR ')} ORDER BY path`,args}],45000);
    const rows=s.d.rows(r),pending=readPending(),seen=readRealtimeSeen();let applied=0;const touched=new Set();
    suppress=true;
    try{
      for(const row of rows){
        const parsed=parsePath(row.path);if(!parsed)continue;
        const isRelevant=REALTIME_STORES.has(parsed.store)||(parsed.store==='settings'&&parsed.key==='store_config');if(!isRelevant)continue;
        let env=null;try{env=typeof row.payload==='string'?JSON.parse(row.payload):row.payload}catch(_){env=null}
        if(env?.tenantId&&safe(env.tenantId)!==tenant())continue;
        const remoteRev=Number(row.updated_at||env?.rev||0),id=pk(parsed.store,parsed.key),local=pending[id];
        if(local&&Number(local.rev||0)>remoteRev)continue;
        if(!force&&Number(seen[row.path]||0)>=remoteRev)continue;
        const deleted=Number(row.deleted)===1||env?.deleted===true;
        const rawValue=env&&Object.prototype.hasOwnProperty.call(env,'v')?env.v:env;
        const prepared=await prepareRemoteValue(parsed.store,parsed.key,rawValue,remoteRev,{deleted});
        if(prepared.skip){seen[row.path]=remoteRev||Date.now();continue;}
        if(deleted)await bridge.deleteFromStore(parsed.store,actualKey(parsed.store,parsed.key),false);
        else if(prepared.value!=null)await bridge.putInStore(parsed.store,prepared.value,false);
        else continue;
        seen[row.path]=remoteRev||Date.now();applied++;touched.add(parsed.store);
      }
    }finally{suppress=false}
    writeRealtimeSeen(seen);
    if(applied){
      try{await bridge.onApplied?.([...touched])}catch(_){}
      try{window.dispatchEvent(new CustomEvent('oscar:sync-applied',{detail:{applied,stores:[...touched],realtime:true}}))}catch(_){}
      broadcast('synced');
    }
    return{applied,changedStores:[...touched],remoteRows:rows.length,realtime:true};
  }catch(e){
    console.warn('[OscarSync] realtime pull warning',e);return{applied:0,error:true,message:String(e?.message||e)};
  }finally{realtimePullBusy=false}
}
async function pushPending(){
  await hydratePending();const all=Object.entries(readPending());if(!all.length)return{uploaded:0,remaining:0};const s=await ensureSchema();let uploaded=0;
  for(let i=0;i<all.length;i+=60){const batch=all.slice(i,i+60);try{
    await s.d.pipeline(s.c,buildStatements(s,batch),Math.max(30000,batch.length*700));
    for(const[id,o]of batch)if(await removePendingOp(id,o.rev))uploaded++;
  }catch(err){console.warn('[OscarSync] batch failed',err);for(const pair of batch){try{await s.d.pipeline(s.c,buildStatements(s,[pair]),30000);const[id,o]=pair;if(await removePendingOp(id,o.rev))uploaded++;}catch(e){const[id,o]=pair,cur=readPending()[id];if(cur&&Number(cur.rev||0)===Number(o.rev||0)){cur.attempts=Number(cur.attempts||0)+1;cur.lastError=String(e?.message||e).slice(0,300);await persistPendingOp(id,cur)}}}}
  }
  return{uploaded,remaining:pendingCount()}
}
async function applyRows(rows,batch){
  if(!bridge)return{applied:0};
  await hydratePending();
  const pending=readPending(),touched=new Set(),repairs=[];let applied=0;
  // Apply movements before stock balances. This lets us verify whether an incoming legacy zero
  // is backed by an actual inventory movement instead of blindly erasing a valid local balance.
  const ordered=[...(rows||[])].sort((a,b)=>{
    const pa=parsePath(a.path),pb=parsePath(b.path),sa=pa?.store==='stock'?1:0,sb=pb?.store==='stock'?1:0;
    return sa-sb;
  });
  suppress=true;
  try{
    let latestMovementMap=null;
    for(const row of ordered){
      const parsed=parsePath(row.path);if(!parsed||!STORES.has(parsed.store))continue;
      let env=null;try{env=typeof row.payload==='string'?JSON.parse(row.payload):row.payload}catch(_){env=null}
      if(env?.tenantId&&safe(env.tenantId)!==tenant())continue;
      const remoteRev=Number(row.updated_at||env?.rev||0),id=pk(parsed.store,parsed.key),localPending=pending[id];
      if(localPending&&Number(localPending.rev||0)>remoteRev)continue;
      const deleted=Number(row.deleted)===1||env?.deleted===true;
      const rawValue=env&&Object.prototype.hasOwnProperty.call(env,'v')?env.v:env;
      const prepared=await prepareRemoteValue(parsed.store,parsed.key,rawValue,remoteRev,{deleted,latestMovementMap,repairs});
      if(prepared.skip)continue;
      if(deleted)await bridge.deleteFromStore(parsed.store,actualKey(parsed.store,parsed.key),false);
      else if(prepared.value!=null)await bridge.putInStore(parsed.store,prepared.value,false);
      else continue;
      applied++;touched.add(parsed.store);
    }
  }finally{suppress=false}
  // Repair any stale legacy cloud zero using the local balance that was verified by movements.
  if(repairs.length){
    const unique=new Map();for(const row of repairs)unique.set(keyString('stock',row),row);
    for(const row of unique.values()){try{await captureStoreChange('stock',row)}catch(_){}}
  }
  const m=readMeta();m.remoteBatch=Math.max(Number(m.remoteBatch||0),Number(batch||0));m.batchInitialized=true;m.lastPullAt=Date.now();writeMeta(m);
  if(applied){try{await bridge.onApplied?.([...touched])}catch(_){}try{window.dispatchEvent(new CustomEvent('oscar:sync-applied',{detail:{applied,stores:[...touched],remoteBatch:batch}}))}catch(_){}broadcast('synced')}
  if(repairs.length)requestSync(40);
  return{applied,changedStores:[...touched]}
}
async function pullChanges({force=false}={}){const s=await ensureSchema(),m=readMeta(),remote=await remoteBatch(s),last=Number(m.remoteBatch||0),pre=prefix(),hi=pre+'\uffff';if(!force&&m.batchInitialized&&remote<=last)return{applied:0,remoteBatch:remote,remoteRows:0};let r;if(!m.batchInitialized||(force&&last===0)){const where=['path>=?','path<?'],args=[pre,hi];for(const store of PAGED_HISTORY_STORES){const lo=pre+encodeURIComponent(store)+'/',up=lo+'\uffff';where.push('NOT (path>=? AND path<?)');args.push(lo,up)}[r]=await s.d.pipeline(s.c,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE ${where.join(' AND ')} ORDER BY path`,args}],60000)}else{[r]=await s.d.pipeline(s.c,[{sql:`SELECT path,payload,deleted,updated_at,sync_batch FROM ${s.table} WHERE path>=? AND path<? AND sync_batch>? ORDER BY sync_batch,path`,args:[pre,hi,last]}],60000)}const rows=s.d.rows(r);const out=await applyRows(rows,remote);if(!rows.length){m.remoteBatch=remote;m.batchInitialized=true;m.lastPullAt=Date.now();writeMeta(m)}return{...out,remoteBatch:remote,remoteRows:rows.length}}

const PAGE_SORT_FIELD={invoices:'date',purchases:'date',stock_movements:'date',expenses:'date',vouchers:'date',transfers:'date',audit_logs:'date',partner_statements:'date',held_invoices:'date',customers:'createdAt',suppliers:'createdAt'};
const SAFE_FIELD=/^[A-Za-z_][A-Za-z0-9_]*$/;
function jsonValueExpr(field){if(!SAFE_FIELD.test(String(field||'')))throw Error('حقل فلترة غير صالح');return `COALESCE(json_extract(payload,'$.v.${field}'),json_extract(payload,'$.${field}'))`}
function normalizeInvoiceSearch(value){return String(value??'').toLowerCase().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'').trim();}
function pendingValueMatches(value,opts={}){
  if(!value||typeof value!=='object')return false;const filters=opts.filters&&typeof opts.filters==='object'?opts.filters:{};
  for(const [field,wanted] of Object.entries(filters)){if(wanted===undefined||wanted===''||wanted==='all')continue;let actual=value?.[field];if(field==='financialYearId'&&(actual===undefined||actual===null||actual===''))actual=opts.legacyFinancialYearId||'';if(Array.isArray(wanted)){if(!wanted.map(String).includes(String(actual??'')))return false}else if(wanted===null){if(!(actual===undefined||actual===null||actual===''))return false}else if(String(actual??'')!==String(wanted))return false}
  const deletedMode=opts.deletedMode||'exclude';if(deletedMode==='exclude'&&value.deletedAt)return false;if(deletedMode==='only'&&!value.deletedAt)return false;
  const dateField=opts.dateField||PAGE_SORT_FIELD[opts.storeName]||'date',raw=value?.[dateField]||value?.date||value?.createdAt||value?.timestamp||'',t=raw?new Date(raw).getTime():0;
  if(opts.dateFrom){const f=new Date(opts.dateFrom).getTime();if(Number.isFinite(f)&&(!Number.isFinite(t)||t<f))return false}if(opts.dateTo){const z=new Date(opts.dateTo).getTime();if(Number.isFinite(z)&&(!Number.isFinite(t)||t>z))return false}
  for(const [f,x] of Object.entries(opts.numericGt||{}))if(!(Number(value?.[f])>Number(x)))return false;for(const [f,x] of Object.entries(opts.numericGte||{}))if(!(Number(value?.[f])>=Number(x)))return false;for(const [f,x] of Object.entries(opts.numericLt||{}))if(!(Number(value?.[f])<Number(x)))return false;for(const [f,x] of Object.entries(opts.numericLte||{}))if(!(Number(value?.[f])<=Number(x)))return false;
  const tokens=normalizeInvoiceSearch(opts.search).split(/\s+/).filter(Boolean);if(tokens.length){let blob='';try{blob=normalizeInvoiceSearch(JSON.stringify(value))}catch{}if(!tokens.every(token=>blob.includes(token)))return false}return true
}
function buildPagedWhere(store,opts={},s){
  if(!STORES.has(store))throw Error('جدول غير صالح');const p=prefix()+encodeURIComponent(store)+'/',hi=p+'\uffff',where=['path>=?','path<?','deleted=0'],args=[p,hi];
  const filters=opts.filters&&typeof opts.filters==='object'?opts.filters:{};
  for(const [field,wanted] of Object.entries(filters)){if(wanted===undefined||wanted===''||wanted==='all')continue;const expr=jsonValueExpr(field);if(field==='financialYearId'&&opts.legacyFinancialYearId){if(Array.isArray(wanted)){const qs=wanted.map(()=>'?').join(',');where.push(`COALESCE(${expr},?) IN (${qs})`);args.push(opts.legacyFinancialYearId,...wanted)}else{where.push(`COALESCE(${expr},?)=?`);args.push(opts.legacyFinancialYearId,wanted)}continue}if(Array.isArray(wanted)){if(!wanted.length)continue;where.push(`${expr} IN (${wanted.map(()=>'?').join(',')})`);args.push(...wanted)}else if(wanted===null){where.push(`(${expr} IS NULL OR ${expr}='')`)}else{where.push(`${expr}=?`);args.push(wanted)}}
  const deletedMode=opts.deletedMode||'exclude',delExpr=jsonValueExpr('deletedAt');if(deletedMode==='exclude')where.push(`(${delExpr} IS NULL OR ${delExpr}='')`);else if(deletedMode==='only')where.push(`(${delExpr} IS NOT NULL AND ${delExpr}<>'')`);
  const dateField=opts.dateField||PAGE_SORT_FIELD[store]||'date',dateExpr=jsonValueExpr(dateField);if(opts.dateFrom){where.push(`${dateExpr}>=?`);args.push(String(opts.dateFrom))}if(opts.dateTo){where.push(`${dateExpr}<=?`);args.push(String(opts.dateTo))}
  for(const [field,threshold] of Object.entries(opts.numericGt||{})){where.push(`CAST(COALESCE(${jsonValueExpr(field)},0) AS REAL)>?`);args.push(Number(threshold))}for(const [field,threshold] of Object.entries(opts.numericGte||{})){where.push(`CAST(COALESCE(${jsonValueExpr(field)},0) AS REAL)>=?`);args.push(Number(threshold))}for(const [field,threshold] of Object.entries(opts.numericLt||{})){where.push(`CAST(COALESCE(${jsonValueExpr(field)},0) AS REAL)<?`);args.push(Number(threshold))}for(const [field,threshold] of Object.entries(opts.numericLte||{})){where.push(`CAST(COALESCE(${jsonValueExpr(field)},0) AS REAL)<=?`);args.push(Number(threshold))}
  const tokens=normalizeInvoiceSearch(opts.search).split(/\s+/).filter(Boolean);
  if(tokens.length){
    let expr="lower(CAST(search_value.atom AS TEXT))";
    for(const [from,to] of [...'٠١٢٣٤٥٦٧٨٩'].map((x,i)=>[x,String(i)]).concat([...'۰۱۲۳۴۵۶۷۸۹'].map((x,i)=>[x,String(i)]),[['أ','ا'],['إ','ا'],['آ','ا'],['ى','ي'],['ـ',''],...[...'ًٌٍَُِّْٰ'].map(x=>[x,''])]))expr=`replace(${expr},'${from}','${to}')`;
    for(const token of tokens){where.push(`EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END) AS search_value WHERE search_value.atom IS NOT NULL AND instr(${expr},?)>0)`);args.push(token)}
  }
  return{where:where.join(' AND '),args,dateExpr};
}
async function queryStorePage(store,opts={}){
  const s=await ensureSchema(),page=Math.max(1,Number(opts.page||1)),pageSize=Math.min(250,Math.max(1,Number(opts.pageSize||50))),offset=(page-1)*pageSize,b=buildPagedWhere(store,{...opts,storeName:store},s),sortField=opts.sortField||PAGE_SORT_FIELD[store]||'date',sortExpr=`COALESCE(${jsonValueExpr(sortField)},${jsonValueExpr('createdAt')},${jsonValueExpr('date')},updated_at)`,dir=String(opts.sortDirection||'desc').toLowerCase()==='asc'?'ASC':'DESC';
  const [countR,listR]=await s.d.pipeline(s.c,[{sql:`SELECT COUNT(*) AS cnt FROM ${s.table} WHERE ${b.where}`,args:b.args},{sql:`SELECT path,payload,deleted,updated_at FROM ${s.table} WHERE ${b.where} ORDER BY ${sortExpr} ${dir},path ${dir} LIMIT ? OFFSET ?`,args:[...b.args,pageSize,offset]}],45000);
  let total=Number(s.d.rows(countR)[0]?.cnt||0),items=[];const keys=[];for(const row of s.d.rows(listR)){const parsed=parsePath(row.path);if(!parsed)continue;let env=null;try{env=typeof row.payload==='string'?JSON.parse(row.payload):row.payload}catch(_){env=null}const value=env&&Object.prototype.hasOwnProperty.call(env,'v')?env.v:env;if(value!=null){items.push(value);keys.push(parsed.key)}}
  // Overlay durable local pending operations so a just-saved invoice appears instantly before upload completes.
  const pending=Object.values(readPending()).filter(o=>o?.store===store);if(pending.length){const byId=new Map(items.map((x,i)=>[String(x?.id??keys[i]??''),x]));let added=0;for(const op of pending){const id=String(op?.value?.id??actualKey(store,op?.key)??'');if(op.deleted){if(byId.delete(id))total=Math.max(0,total-1);continue}if(!pendingValueMatches(op.value,{...opts,storeName:store}))continue;if(byId.has(id))byId.set(id,op.value);else if(page===1){byId.set(id,op.value);added++;total++}}items=[...byId.values()];if(added||pending.length){const f=sortField;items.sort((a,b)=>{const av=a?.[f]||a?.createdAt||a?.date||'',bv=b?.[f]||b?.createdAt||b?.date||'';return dir==='ASC'?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av))});items=items.slice(0,pageSize)}}
  return{items,total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize)),source:'cloud'};
}
async function queryStoreStats(store,opts={}){
  const s=await ensureSchema(),base=buildPagedWhere(store,{...opts,dateFrom:null,dateTo:null,storeName:store},s),sumFields=(Array.isArray(opts.sumFields)?opts.sumFields:[]).filter(x=>SAFE_FIELD.test(String(x))),ranges=Array.isArray(opts.ranges)&&opts.ranges.length?opts.ranges:[{key:'all',from:opts.dateFrom||null,to:opts.dateTo||null}],dateField=opts.dateField||PAGE_SORT_FIELD[store]||'date',dateExpr=jsonValueExpr(dateField),statements=[];
  for(const range of ranges){let where=base.where,args=[...base.args];if(range.from){where+=` AND ${dateExpr}>=?`;args.push(String(range.from))}if(range.to){where+=` AND ${dateExpr}<=?`;args.push(String(range.to))}const sums=sumFields.map(f=>`,COALESCE(SUM(CAST(COALESCE(${jsonValueExpr(f)},0) AS REAL)),0) AS sum_${f}`).join('');statements.push({sql:`SELECT COUNT(*) AS cnt${sums} FROM ${s.table} WHERE ${where}`,args})}
  const rs=await s.d.pipeline(s.c,statements,45000),out={};ranges.forEach((range,i)=>{const row=s.d.rows(rs[i])[0]||{},sums={};for(const f of sumFields)sums[f]=Number(row[`sum_${f}`]||0);out[range.key||'all']={count:Number(row.cnt||0),sums}});return{ranges:out,source:'cloud'};
}
async function syncNow({manual=false,force=false}={}){await hydratePending().catch(()=>{});if(busy){rerunRequested=true;return{busy:true,remaining:pendingCount()}}if(!tenant())return{unavailable:true};if(navigator.onLine===false){emitStatus({state:'offline'});return{offline:true,remaining:pendingCount()}}busy=true;emitStatus({state:'syncing'});try{const pushed=pendingCount()?await pushPending():{uploaded:0,remaining:0};const pulled=await pullChanges({force:!!force});const rt=await pullRealtimeSnapshot({force:!!force});const changedStores=[...new Set([...(pulled.changedStores||[]),...(rt.changedStores||[])])];const result={...pushed,...pulled,realtimeApplied:Number(rt.applied||0),changedStores,remaining:pendingCount(),success:true};emitStatus({state:'success',lastSuccessAt:Date.now(),result});return result}catch(e){console.error('[OscarSync]',e);emitStatus({state:'error',message:String(e?.message||e)});return{error:true,message:String(e?.message||e),remaining:pendingCount()}}finally{busy=false;emitStatus();if(rerunRequested||pendingCount()){rerunRequested=false;requestSync(25)}}}
function requestSync(delay=120){if(!tenant()||navigator.onLine===false)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow({force:false}).catch(()=>{}),Math.max(60,delay))}
async function checkRemote({force=false}={}){if(busy||!tenant()||navigator.onLine===false||document.visibilityState==='hidden')return;const now=Date.now();if(!force&&now-lastProbe<350)return;lastProbe=now;if(pendingCount())return syncNow({force:false});try{const s=await ensureSchema(),r=await remoteBatch(s),m=readMeta();if(!m.batchInitialized||r>Number(m.remoteBatch||0))return syncNow({force:false});return pullRealtimeSnapshot({force:!!force})}catch(e){emitStatus({state:'error',message:String(e?.message||e)})}}
function startProbe(){if(probeTimer)return;const tick=async()=>{try{await checkRemote()}catch(_){}probeTimer=setTimeout(tick,30000)};probeTimer=setTimeout(tick,1200)}
async function initialize(opts={}){bridge=opts.bridge||bridge;if(!tenant()||!bridge)return{tenant:tenant(),unavailable:true};initialized=true;if(pendingHydrated){const early={...(pendingCache||{})};pendingHydrated=false;pendingCache=null;hydratePromise=null;await hydratePending();for(const[id,o]of Object.entries(early)){const cur=readPending()[id];if(!cur||Number(o.rev||0)>=Number(cur.rev||0))await persistPendingOp(id,o);}}else{await hydratePending();}setupBroadcast();startProbe();if(navigator.onLine===false){emitStatus({state:'offline'});return{tenant:tenant(),offline:true,remoteRows:0,remaining:pendingCount()}}emitStatus({state:'syncing',busy:true,startup:true});const first=await syncNow({force:true});return{tenant:tenant(),...first,remaining:pendingCount()}}
function setupBroadcast(){try{bc?.close?.();bc='BroadcastChannel'in window?new BroadcastChannel('oscar-cloud-sync-v2'):null;if(bc)bc.onmessage=e=>{const m=e.data||{};if(m.tenant!==tenant()||m.deviceId===deviceId())return;if(m.type==='local-change'||m.type==='synced')setTimeout(()=>checkRemote({force:true}),m.type==='synced'?20:120)}}catch(_){bc=null}}
function resetForTenant(){schemaTenant='';lastProbe=0;lastRealtimePull=0;rerunRequested=false;pendingCache=null;pendingHydrated=false;hydratePromise=null;setupBroadcast();if(bridge)hydratePending().catch(()=>{});emitStatus({state:'tenant-reset'})}
window.addEventListener('online',()=>{emitStatus({state:'online'});pendingCount()?requestSync(40):checkRemote({force:true})});
window.addEventListener('offline',()=>emitStatus({state:'offline'}));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(()=>checkRemote({force:true}),100)});
window.addEventListener('focus',()=>checkRemote({force:true}));
window.OscarCloudSync={version:VERSION,initialize,syncNow,checkRemote,pullRealtimeNow:(opts={})=>pullRealtimeSnapshot({force:true,...opts}),queryStorePage,queryStoreStats,requestSync,pendingCount,pendingItems,captureStoreChange,resetForTenant,get busy(){return busy},get suppress(){return suppress}};
})();
