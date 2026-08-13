(() => {
  'use strict';

  const T = window.SHAHD_TURSO;
  const PERMS = window.SHAHD_PERMISSIONS || { managerPermissions:{}, viewForRoute:{}, entityPermissions:{} };
  const DB_NAME = 'shahd_offline_v11';
  const DB_VERSION = 3;
  const LEGACY_STATE_KEY = 'shahd_property_accounting_v1';
  const COMPANY_HINT_KEY = 'shahd_company_key_hint_v1';
  const ACTIVE_PROFILE_KEY = 'shahd_active_profile_v19';
  const SYNC_SAFETY_VERSION = 21;
  const DEVICE_KEY = 'shahd_device_id_v1';
  const STATE_COLLECTIONS = ['projects','buildings','tenants','movements','debts','debtPayments'];
  const SETTINGS_ENTITY_ID = '__settings__';
  const WRITE_DEBOUNCE_MS = 1600;
  const IDLE_PULL_MS = 90000;
  const LICENSE_CHECK_MS = 120000;
  const BATCH_SIZE = 60;
  const PULL_LIMIT = 600;

  let dbPromise=null, currentSession=null, currentState=null, lastLocalState=null, runtimeCredentials=null;
  let syncTimer=null, idleTimer=null, persistChain=Promise.resolve(), syncing=false, started=false, lastSyncAt=0, lastSyncError='', lastLicenseCheck=0;

  const now=()=>Date.now();
  const clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
  const normalKey=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'-');
  const compactKey=v=>normalKey(v).replace(/[^A-Z0-9]/g,'');
  const normalUser=v=>String(v||'').trim().toLowerCase();
  const uuid=()=>T?.uuid?.('op')||`op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeJson=(v,f={})=>{try{return JSON.parse(String(v||''))}catch(_){return f}};

  if(!T) throw new Error('تعذر تحميل اتصال قاعدة البيانات.');

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('states')) db.createObjectStore('states',{keyPath:'companyId'});
        if(!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles',{keyPath:'profileKey'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('recordMeta')){
          const s=db.createObjectStore('recordMeta',{keyPath:'key'});s.createIndex('scopeKey','scopeKey',{unique:false});
        }
        if(!db.objectStoreNames.contains('queue')){
          const s=db.createObjectStore('queue',{keyPath:'queueKey'});s.createIndex('scopeKey','scopeKey',{unique:false});s.createIndex('createdAt','createdAt',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('تعذر فتح التخزين المحلي.'));
    });
    return dbPromise;
  }
  async function getOne(store,key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}
  async function putOne(store,value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})}
  async function deleteOne(store,key){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)})}
  async function getAllByIndex(store,index,value){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).index(index).getAll(value);r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
  async function getAllStore(store){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}

  function deviceId(){let id=localStorage.getItem(DEVICE_KEY);if(!id){id=T.uuid('dev');localStorage.setItem(DEVICE_KEY,id)}return id}
  async function requestPersistentStorage(){try{await navigator.storage?.persist?.()}catch(_){}}

  async function verifier(password,salt){
    const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(String(password||'')),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:90000,hash:'SHA-256'},key,256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  }

  function sessionProfileKey(companyKey,username){return `${compactKey(companyKey)}::${normalUser(username)}`}
  function legacySessionProfileKey(companyKey,username){return `${normalKey(companyKey)}::${normalUser(username)}`}
  async function cacheOfflineProfile(loginData,companyKey,username,password){
    const salt=`${T.salt()}::${normalKey(companyKey)}::${normalUser(username)}`;
    const verify=await verifier(password,salt);
    await putOne('profiles',{
      profileKey:sessionProfileKey(companyKey,username),companyKey:normalKey(companyKey),username:normalUser(username),salt,verifier:verify,cachedAt:now(),
      session:{...loginData}
    });
  }
  async function offlineLogin(companyKey,username,password){
    let p=await getOne('profiles',sessionProfileKey(companyKey,username));
    if(!p)p=await getOne('profiles',legacySessionProfileKey(companyKey,username));
    if(!p)throw Object.assign(new Error('لا توجد بيانات دخول محفوظة لهذا الحساب على هذا الجهاز. يلزم تسجيل دخول واحد أثناء توفر الإنترنت.'),{code:'OFFLINE_PROFILE_MISSING'});
    if(await verifier(password,p.salt)!==p.verifier)throw Object.assign(new Error('اسم المستخدم أو كلمة المرور غير صحيحة.'),{code:'BAD_CREDENTIALS'});
    if(Number(p.session?.licenseExpiresAt||0)&&now()>=Number(p.session.licenseExpiresAt))throw Object.assign(new Error('انتهت مدة مفتاح الشركة. يجب تمديد المفتاح أولاً.'),{code:'LICENSE_EXPIRED'});
    return {...p.session,offline:true};
  }

  async function restoreActiveSession(){
    let key=localStorage.getItem(ACTIVE_PROFILE_KEY)||'';
    let p=key?await getOne('profiles',key):null;
    // Migrate smoothly from v18: if the explicit active-session marker does not
    // exist yet, restore the most recently cached profile for the last company.
    if(!p){
      const hint=compactKey(localStorage.getItem(COMPANY_HINT_KEY)||''),profiles=(await getAllStore('profiles')).filter(x=>x?.session);
      const candidates=(hint?profiles.filter(x=>compactKey(x.companyKey||x.session?.companyKey)===hint):profiles).sort((a,b)=>Number(b.cachedAt||0)-Number(a.cachedAt||0));
      p=candidates[0]||null;if(p){key=p.profileKey;localStorage.setItem(ACTIVE_PROFILE_KEY,key)}
    }
    if(!p?.session){localStorage.removeItem(ACTIVE_PROFILE_KEY);return null;}
    const session={...p.session,offline:navigator.onLine===false,restored:true};
    if(Number(session.licenseExpiresAt||0)&&now()>=Number(session.licenseExpiresAt)){localStorage.removeItem(ACTIVE_PROFILE_KEY);return null;}
    localStorage.setItem(COMPANY_HINT_KEY,p.companyKey||session.companyKey||'');
    return session;
  }

  async function persistActiveSessionSnapshot(){
    const key=localStorage.getItem(ACTIVE_PROFILE_KEY)||'';
    if(!key||!currentSession)return;
    const p=await getOne('profiles',key);
    if(!p)return;
    p.session={...p.session,...currentSession,offline:false,restored:false};
    p.cachedAt=now();
    await putOne('profiles',p);
  }

  function hasPermission(permission){if(!permission)return true;if(currentSession?.role==='manager')return true;return currentSession?.permissions?.[permission]===true}
  function userScope(companyId=currentSession?.companyId,userId=currentSession?.userId){return `${companyId||'none'}::${userId||'none'}`}
  function stateKey(companyId){return `state::${userScope(companyId)}`}
  function cursorKey(companyId){return `cursor::${userScope(companyId)}`}
  function recordKey(companyId,type,id){return `${userScope(companyId)}::${type}::${id}`}
  function queueKey(companyId,type,id){return `${userScope(companyId)}::${type}::${id}`}

  function normalizeState(input,defaultsFactory){
    const base=typeof defaultsFactory==='function'?defaultsFactory():{projects:[],buildings:[],tenants:[],movements:[],debts:[],debtPayments:[],settings:{}};
    const v=input&&typeof input==='object'?input:{};
    return {...base,...v,projects:Array.isArray(v.projects)?v.projects:[],buildings:Array.isArray(v.buildings)?v.buildings:[],tenants:Array.isArray(v.tenants)?v.tenants:[],movements:Array.isArray(v.movements)?v.movements:[],debts:Array.isArray(v.debts)?v.debts:[],debtPayments:Array.isArray(v.debtPayments)?v.debtPayments:[],settings:{...(base.settings||{}),...(v.settings||{})}};
  }
  function filterStateForSession(input,defaultsFactory){
    const s=normalizeState(input,defaultsFactory);
    const map={projects:'projects.view',buildings:'buildings.view',tenants:'tenants.view',movements:'movements.view',debts:'debts.view',debtPayments:'debts.view'};
    for(const [k,p] of Object.entries(map))if(!hasPermission(p))s[k]=[];
    if(!hasPermission('settings.view'))s.settings={...(typeof defaultsFactory==='function'?defaultsFactory().settings:{})};
    return s;
  }
  async function loadCompanyState(companyId,defaultsFactory){
    const rec=await getOne('states',stateKey(companyId));if(rec?.state)return filterStateForSession(rec.state,defaultsFactory);
    let legacy=null;try{legacy=JSON.parse(localStorage.getItem(LEGACY_STATE_KEY)||'null')}catch(_){ }
    if(legacy&&typeof legacy==='object'){
      const s=filterStateForSession(legacy,defaultsFactory);await putOne('states',{companyId:stateKey(companyId),tenantId:companyId,state:s,updatedAt:now()});localStorage.removeItem(LEGACY_STATE_KEY);await seedLegacyQueue(companyId,s);return s;
    }
    return filterStateForSession(null,defaultsFactory);
  }
  async function seedLegacyQueue(companyId,s){
    const ops=[];for(const type of STATE_COLLECTIONS)for(const rec of(s[type]||[]))if(rec?.id)ops.push({entityType:type,entityId:String(rec.id),action:'create',payload:rec,patch:rec});
    ops.push({entityType:'settings',entityId:SETTINGS_ENTITY_ID,action:'create',payload:s.settings||{},patch:s.settings||{}});await writeQueueOperations(companyId,ops,true);
  }

  function objectPatch(before,after){const p={};const keys=new Set([...Object.keys(before||{}),...Object.keys(after||{})]);for(const k of keys)if(JSON.stringify(before?.[k])!==JSON.stringify(after?.[k]))p[k]=after?.[k]===undefined?null:after?.[k];return p}
  async function getRecordRev(companyId,type,id){return Number((await getOne('recordMeta',recordKey(companyId,type,id)))?.remoteRev||0)}
  async function setRecordRev(companyId,type,id,remoteRev){return putOne('recordMeta',{key:recordKey(companyId,type,id),scopeKey:userScope(companyId),companyId,entityType:type,entityId:id,remoteRev:Number(remoteRev||0),updatedAt:now()})}

  function canWriteEntity(type,action){
    if(currentSession?.role==='manager')return true;
    if(type==='settings')return hasPermission('settings.edit');
    const map=PERMS.entityPermissions?.[type]||{};const perm=map[action==='create'?'create':action==='delete'?'delete':'edit'];return perm?hasPermission(perm):false;
  }
  async function writeQueueOperations(companyId,ops,forceCreate=false){
    if(!ops.length)return;const db=await openDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('queue','readwrite'),store=tx.objectStore('queue');
      for(const op of ops){
        // v21 data-safety: synchronization is non-destructive. A missing local row is never
        // allowed to become a cloud delete event. This prevents an empty/new device from
        // wiping records that exist on another device.
        if(op.action==='delete')continue;
        if(!canWriteEntity(op.entityType,op.action))continue;
        const qk=queueKey(companyId,op.entityType,op.entityId),g=store.get(qk);
        g.onsuccess=()=>{
          const ex=g.result;
          if(ex?.action==='create'&&op.action==='delete'){store.delete(qk);return}
          let action=forceCreate?'create':op.action;if(ex?.action==='create'&&action==='edit')action='create';if(ex?.action==='edit'&&action==='delete')action='delete';
          const patch=action==='create'?op.payload:{...(ex?.patch||{}),...(op.patch||{})};
          store.put({queueKey:qk,opId:ex?.opId||uuid(),companyId,userId:currentSession?.userId||'',scopeKey:userScope(companyId),entityType:op.entityType,entityId:op.entityId,action,payload:clone(op.payload||{}),patch:clone(patch||{}),baseRev:Number(ex?.baseRev??op.baseRev??0),attempts:Number(ex?.attempts||0),lastError:ex?.lastError||'',createdAt:Number(ex?.createdAt||now()),updatedAt:now(),deviceId:deviceId()});
        };
      }
      tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function diffAndQueue(previous,next){
    const companyId=currentSession?.companyId;if(!companyId)return;const ops=[];
    for(const type of STATE_COLLECTIONS){
      const before=new Map((previous?.[type]||[]).filter(x=>x?.id).map(x=>[String(x.id),x])),after=new Map((next?.[type]||[]).filter(x=>x?.id).map(x=>[String(x.id),x]));
      for(const [id,a] of after){const b=before.get(id);if(!b)ops.push({entityType:type,entityId:id,action:'create',payload:a,patch:a,baseRev:0});else if(JSON.stringify(b)!==JSON.stringify(a))ops.push({entityType:type,entityId:id,action:'edit',payload:a,patch:objectPatch(b,a),baseRev:await getRecordRev(companyId,type,id)})}
      // Intentionally do not infer deletions from absence in the local state.
      // Local state can be partial, permission-filtered, stale, or from a newly added device.
    }
    if(JSON.stringify(previous?.settings||{})!==JSON.stringify(next?.settings||{})){
      const baseRev=await getRecordRev(companyId,'settings',SETTINGS_ENTITY_ID);ops.push({entityType:'settings',entityId:SETTINGS_ENTITY_ID,action:baseRev?'edit':'create',payload:next.settings||{},patch:baseRev?objectPatch(previous?.settings||{},next.settings||{}):next.settings||{},baseRev});
    }
    await writeQueueOperations(companyId,ops);
  }

  async function queueItems(){if(!currentSession?.companyId)return[];return(await getAllByIndex('queue','scopeKey',userScope())).sort((a,b)=>a.createdAt-b.createdAt)}
  async function queueCount(){return (await queueItems()).length}
  function emitStatus(extra={}){queueCount().then(count=>window.dispatchEvent(new CustomEvent('shahd:sync-status',{detail:{count,syncing,lastSyncAt,lastSyncError,online:navigator.onLine!==false,...extra}}))).catch(()=>{})}

  async function persistState(nextState){
    if(!currentSession?.companyId)return;const snap=clone(nextState),prev=clone(lastLocalState||currentState||snap);currentState=snap;lastLocalState=snap;
    persistChain=persistChain.catch(()=>null).then(async()=>{await putOne('states',{companyId:stateKey(currentSession.companyId),tenantId:currentSession.companyId,state:snap,updatedAt:now()});await diffAndQueue(prev,snap);emitStatus();scheduleSync(WRITE_DEBOUNCE_MS);cleanLocalStorage()}).catch(e=>{lastSyncError=e?.message||String(e);emitStatus();console.error(e)});
    return persistChain;
  }
  function cleanLocalStorage(){try{for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(k?.startsWith('shahd_temp_'))localStorage.removeItem(k)}}catch(_){}}
  async function getCursor(companyId){return Number((await getOne('meta',cursorKey(companyId)))?.value||0)}
  async function setCursor(companyId,value){return putOne('meta',{key:cursorKey(companyId),value:Number(value||0),updatedAt:now()})}

  function allowedTypes(){
    const out=[];if(hasPermission('projects.view'))out.push('projects');if(hasPermission('buildings.view'))out.push('buildings');if(hasPermission('tenants.view'))out.push('tenants');if(hasPermission('movements.view'))out.push('movements');if(hasPermission('debts.view'))out.push('debts','debtPayments');if(hasPermission('settings.view'))out.push('settings');return [...new Set(out)];
  }
  function parseEvent(row){return {remoteRev:Number(row.id||0),entityType:String(row.entity_type||''),entityId:String(row.entity_id||''),deleted:String(row.action||'')==='delete',payload:safeJson(row.payload,{})}}
  async function applyRemoteChanges(changes,queueMap){
    if(!changes?.length||!currentState)return false;let changed=false;
    for(const rec of changes){const type=rec.entityType,id=String(rec.entityId),rev=Number(rec.remoteRev||0),key=`${type}::${id}`,queued=queueMap.get(key);let payload=rec.payload&&typeof rec.payload==='object'?rec.payload:{};
      if(queued){queued.baseRev=rev;if(queued.action==='edit'){payload={...payload,...(queued.patch||{})};queued.payload=clone(payload);await putOne('queue',queued);if(type==='settings')currentState.settings=payload;else{const coll=currentState[type]||(currentState[type]=[]),idx=coll.findIndex(x=>String(x.id)===id);if(idx>=0)coll[idx]=payload;else coll.push(payload)}changed=true}else await putOne('queue',queued);await setRecordRev(currentSession.companyId,type,id,rev);continue}
      if(type==='settings'){if(!rec.deleted){currentState.settings=payload;changed=true}}
      else if(STATE_COLLECTIONS.includes(type)){const coll=currentState[type]||(currentState[type]=[]),idx=coll.findIndex(x=>String(x.id)===id);if(rec.deleted){/* v21 safety: keep the existing local record; cloud tombstones never erase accounting data */}else if(idx>=0){coll[idx]=payload;changed=true}else{coll.push(payload);changed=true}}
      await setRecordRev(currentSession.companyId,type,id,rev);
    }
    if(changed){lastLocalState=clone(currentState);await putOne('states',{companyId:stateKey(currentSession.companyId),tenantId:currentSession.companyId,state:clone(currentState),updatedAt:now()});window.dispatchEvent(new CustomEvent('shahd:state-remote',{detail:{state:clone(currentState)}}))}
    return changed;
  }

  async function onlineLogin(companyKey,username,password){
    await T.ensureSchema();
    const key=normalKey(companyKey), keyCompact=compactKey(companyKey), user=normalUser(username);
    // Manager accounts created by older Shahd releases defaulted to "manager",
    // while newer login examples often use "admin".  For those two reserved
    // aliases only, allow the single company manager to be resolved by role.
    // All employee usernames remain exact and isolated per company.
    const rows=await T.query(`SELECT c.id AS company_id,c.company_key,c.name AS company_name,c.status,c.expires_at,c.max_users,c.auth_version AS company_auth_version,
      u.id AS user_id,u.username,u.display_name,u.password_hash,u.password_salt,u.role,u.permissions_json,u.active,u.auth_version AS user_auth_version
      FROM shahd_companies c JOIN shahd_users u ON u.company_id=c.id
      WHERE (UPPER(TRIM(c.company_key))=? OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(c.company_key)),'-',''),' ',''),'_','')=?)
        AND (LOWER(TRIM(u.username))=? OR (? IN ('admin','manager') AND u.role='manager'))
      ORDER BY CASE WHEN LOWER(TRIM(u.username))=? THEN 0 ELSE 1 END, u.created_at ASC LIMIT 1`,[key,keyCompact,user,user,user]);
    const r=rows[0];
    if(!r){
      // Make the reason useful instead of masking database / account issues as
      // a generic password failure.  This costs only on a failed login.
      const companies=await T.query(`SELECT id,company_key FROM shahd_companies WHERE UPPER(TRIM(company_key))=? OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(company_key)),'-',''),' ',''),'_','')=? LIMIT 1`,[key,keyCompact]);
      if(!companies.length)throw Object.assign(new Error('مفتاح الشركة غير موجود. تأكد من المفتاح أو أنشئه من لوحة الأدمن.'),{code:'BAD_COMPANY_KEY'});
      throw Object.assign(new Error('اسم المستخدم غير موجود داخل هذه الشركة. إذا كان حساب المدير قديماً جرّب admin أو manager.'),{code:'BAD_USERNAME'});
    }
    if(String(r.status)!=='active')throw Object.assign(new Error('مفتاح الشركة موقوف. راجع الإدارة.'),{code:'LICENSE_STOPPED'});
    if(Number(r.expires_at||0)&&now()>=Number(r.expires_at))throw Object.assign(new Error('انتهت مدة مفتاح الشركة. يجب تمديد الاشتراك.'),{code:'LICENSE_EXPIRED'});
    if(Number(r.active)!==1)throw Object.assign(new Error('تم إيقاف هذا المستخدم.'),{code:'USER_DISABLED'});
    const passwordCheck=T.verifyPassword?await T.verifyPassword(password,r.password_salt,r.password_hash):{ok:(await T.hashPassword(password,r.password_salt)===String(r.password_hash)),scheme:'current'};
    if(!passwordCheck.ok)throw Object.assign(new Error('كلمة المرور غير صحيحة لهذا المستخدم.'),{code:'BAD_CREDENTIALS'});
    // Upgrade old v11/v12 password hashes after the first successful login.
    if(passwordCheck.scheme==='legacy'){
      try{const newSalt=T.salt(),upgraded=await T.hashPassword(password,newSalt);await T.execute(`UPDATE shahd_users SET password_hash=?,password_salt=?,updated_at=? WHERE id=?`,[upgraded,newSalt,now(),r.user_id])}catch(_){ }
    }
    const role=String(r.role||'employee'),permissions=role==='manager'?{...PERMS.managerPermissions}:safeJson(r.permissions_json,{});
    return {companyId:r.company_id,companyKey:r.company_key,companyName:r.company_name,licenseExpiresAt:Number(r.expires_at||0),maxUsers:Number(r.max_users||0),companyAuthVersion:Number(r.company_auth_version||0),userId:r.user_id,username:r.username,displayName:r.display_name,role,permissions,userAuthVersion:Number(r.user_auth_version||0),offline:false};
  }

  async function validateRemoteSession(force=false){
    if(!currentSession||navigator.onLine===false)return true;if(!force&&now()-lastLicenseCheck<LICENSE_CHECK_MS)return true;
    const rows=await T.query(`SELECT c.status,c.expires_at,c.auth_version AS company_auth_version,u.active,u.auth_version AS user_auth_version
      FROM shahd_companies c JOIN shahd_users u ON u.company_id=c.id WHERE c.id=? AND u.id=? LIMIT 1`,[currentSession.companyId,currentSession.userId]);
    lastLicenseCheck=now();const r=rows[0];
    if(!r)throw Object.assign(new Error('تم إلغاء الحساب أو الشركة.'),{code:'AUTH_REVOKED'});
    if(String(r.status)!=='active')throw Object.assign(new Error('تم إيقاف مفتاح الشركة.'),{code:'LICENSE_STOPPED'});
    if(Number(r.expires_at||0)&&now()>=Number(r.expires_at))throw Object.assign(new Error('انتهت مدة مفتاح الشركة.'),{code:'LICENSE_EXPIRED'});
    if(Number(r.active)!==1)throw Object.assign(new Error('تم إيقاف المستخدم.'),{code:'USER_DISABLED'});
    if(Number(r.company_auth_version||0)!==Number(currentSession.companyAuthVersion||0)||Number(r.user_auth_version||0)!==Number(currentSession.userAuthVersion||0))throw Object.assign(new Error('تم تحديث صلاحيات أو بيانات الدخول. سجل الدخول من جديد.'),{code:'AUTH_REVOKED'});
    currentSession.licenseExpiresAt=Number(r.expires_at||0);persistActiveSessionSnapshot().catch(()=>{});return true;
  }
  async function handleAuthFailure(e){if(['LICENSE_STOPPED','LICENSE_EXPIRED','AUTH_REVOKED','USER_DISABLED'].includes(e?.code)){await forceLogout(e.message);return true}return false}


  async function migrateLegacyCloudRecords(){
    if(!currentSession?.companyId||navigator.onLine===false)return;
    const mark=`shahd_events_migrated_v14::${currentSession.companyId}`;if(localStorage.getItem(mark)==='1')return;
    try{
      const count=(await T.query(`SELECT COUNT(*) AS total FROM shahd_events WHERE company_id=?`,[currentSession.companyId]))[0];
      if(Number(count?.total||0)===0){
        let rows=[];try{rows=await T.query(`SELECT entity_type,entity_id,payload,deleted,remote_rev,updated_at,updated_by FROM shahd_records WHERE company_id=? ORDER BY remote_rev ASC`,[currentSession.companyId],60000)}catch(_){rows=[]}
        for(let i=0;i<rows.length;i+=50){
          const chunk=rows.slice(i,i+50),stmts=chunk.map(r=>({sql:`INSERT OR IGNORE INTO shahd_events(op_id,company_id,entity_type,entity_id,action,payload,created_at,updated_by,device_id) VALUES(?,?,?,?,?,?,?,?,?)`,args:[`legacy:${currentSession.companyId}:${r.entity_type}:${r.entity_id}:${r.remote_rev||0}`,currentSession.companyId,r.entity_type,r.entity_id,Number(r.deleted)===1?'delete':'edit',r.payload||'{}',Number(r.updated_at||now()),r.updated_by||'legacy','legacy-migration']}));
          if(stmts.length)await T.pipelineRaw(stmts,60000);
        }
      }
      localStorage.setItem(mark,'1');
    }catch(_){ }
  }

  async function syncNow({manual=false}={}){
    if(syncing||!currentSession?.companyId)return{skipped:true};if(navigator.onLine===false){currentSession.offline=true;applySessionUi();emitStatus({offline:true});return{offline:true}};
    syncing=true;lastSyncError='';emitStatus();
    try{
      await T.ensureSchema();await validateRemoteSession(false);await migrateLegacyCloudRecords();
      const items=await queueItems();
      // Drop any destructive delete operations left in the local queue by older releases
      // before they can ever reach the cloud.
      for(const q of items)if(q.action==='delete')await deleteOne('queue',q.queueKey);
      const safeItems=items.filter(q=>q.action!=='delete'),batch=safeItems.slice(0,BATCH_SIZE),since=await getCursor(currentSession.companyId),types=allowedTypes();
      const statements=batch.map(q=>({sql:`INSERT OR IGNORE INTO shahd_events(op_id,company_id,entity_type,entity_id,action,payload,created_at,updated_by,device_id) VALUES(?,?,?,?,?,?,?,?,?)`,args:[q.opId||q.queueKey,currentSession.companyId,q.entityType,q.entityId,q.action,JSON.stringify(q.action==='delete'?{}:q.payload||{}),now(),currentSession.userId,deviceId()]}));
      let changeIndex=-1,maxIndex=-1;
      if(types.length){
        const marks=types.map(()=>'?').join(',');
        if(since===0){changeIndex=statements.length;statements.push({sql:`SELECT e.id,e.entity_type,e.entity_id,e.action,e.payload FROM shahd_events e JOIN (SELECT entity_type,entity_id,MAX(id) AS max_id FROM shahd_events WHERE company_id=? AND action<>'delete' AND entity_type IN (${marks}) GROUP BY entity_type,entity_id) x ON x.max_id=e.id ORDER BY e.id ASC`,args:[currentSession.companyId,...types]})}
        else{changeIndex=statements.length;statements.push({sql:`SELECT id,entity_type,entity_id,action,payload FROM shahd_events WHERE company_id=? AND id>? AND action<>'delete' AND entity_type IN (${marks}) ORDER BY id ASC LIMIT ?`,args:[currentSession.companyId,since,...types,PULL_LIMIT]})}
      }
      maxIndex=statements.length;statements.push({sql:`SELECT COALESCE(MIN(id),0) AS min_id,COALESCE(MAX(id),0) AS max_id FROM shahd_events WHERE company_id=?`,args:[currentSession.companyId]});
      const results=await T.pipelineRaw(statements,Math.max(45000,1200*statements.length));
      const failures=new Map();
      for(let i=0;i<batch.length;i++){
        const q=batch[i],r=results[i];
        if(r?.ok)await deleteOne('queue',q.queueKey);else{q.attempts=Number(q.attempts||0)+1;q.lastError=String(r?.error||'تعذر رفع العملية');q.updatedAt=now();await putOne('queue',q);failures.set(q.queueKey,q)}
      }
      let changeRows=[];if(changeIndex>=0&&results[changeIndex]?.ok)changeRows=T.rowsToObjects(results[changeIndex].result);else if(changeIndex>=0&&!results[changeIndex]?.ok)throw new Error(results[changeIndex].error||'تعذر سحب التغييرات');
      const maxRows=results[maxIndex]?.ok?T.rowsToObjects(results[maxIndex].result):[],minRemote=Number(maxRows[0]?.min_id||0),maxRemote=Number(maxRows[0]?.max_id||since);
      const remaining=await queueItems(),qMap=new Map(remaining.map(q=>[`${q.entityType}::${q.entityId}`,q]));
      const changes=changeRows.map(parseEvent);await applyRemoteChanges(changes,qMap);
      let newCursor=maxRemote;const compactedGap=since>0&&minRemote>0&&since<minRemote-1;if(compactedGap)newCursor=0;else if(since!==0&&changeRows.length>=PULL_LIMIT)newCursor=Number(changeRows.at(-1)?.id||since);await setCursor(currentSession.companyId,newCursor);
      currentSession.offline=false;applySessionUi();lastSyncAt=now();lastSyncError=failures.size?`${failures.size} عملية ما زالت في الطابور`:'';
      const remainingCount=await queueCount();emitStatus({manual,remaining:remainingCount,failed:failures.size});
      if((remainingCount||newCursor<maxRemote||compactedGap)&&navigator.onLine!==false)scheduleSync(failures.size?5000:700);
      maybeCompactRemote().catch(()=>{});
      return{ok:true,remaining:remainingCount,failed:failures.size,changes:changes.length,cursor:newCursor};
    }catch(e){if(await handleAuthFailure(e))return{loggedOut:true};lastSyncError=e?.message||String(e);emitStatus({error:lastSyncError});if(manual)throw e;return{error:lastSyncError}}
    finally{syncing=false;emitStatus()}
  }

  async function maybeCompactRemote(){
    if(currentSession?.role!=='manager'||navigator.onLine===false)return;
    const key=`shahd_remote_compact_v14::${currentSession.companyId}`,last=Number(localStorage.getItem(key)||0);
    if(now()-last<7*24*60*60*1000)return;
    localStorage.setItem(key,String(now()));
    try{
      await T.execute(`DELETE FROM shahd_events WHERE company_id=? AND id < (SELECT COALESCE(MAX(id),0)-5000 FROM shahd_events WHERE company_id=?) AND id NOT IN (SELECT MAX(id) FROM shahd_events WHERE company_id=? GROUP BY entity_type,entity_id) AND id NOT IN (SELECT MAX(id) FROM shahd_events WHERE company_id=? AND action<>'delete' GROUP BY entity_type,entity_id)`,[currentSession.companyId,currentSession.companyId,currentSession.companyId,currentSession.companyId],60000);
    }catch(_){localStorage.removeItem(key)}
  }

  function scheduleSync(delay=WRITE_DEBOUNCE_MS){clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncNow().catch(()=>{}),Math.max(250,delay))}
  function startIdleSync(){clearInterval(idleTimer);idleTimer=setInterval(()=>{if(document.visibilityState!=='visible'||navigator.onLine===false||syncing)return;if(now()-lastSyncAt>=IDLE_PULL_MS)syncNow().catch(()=>{})},30000)}

  function setLoginStatus(message,type='info'){const b=document.getElementById('loginStatus');if(!b)return;b.textContent=message||'';b.className=`login-status ${type}${message?' show':''}`}
  function showLogin(message=''){const g=document.getElementById('loginGate'),s=document.getElementById('appShell');document.body.classList.remove('shahd-authenticated');document.body.classList.add('shahd-logged-out');if(g)g.hidden=false;if(s)s.hidden=true;requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));if(message)setLoginStatus(message,'error')}
  function applySessionUi(){const g=document.getElementById('loginGate'),s=document.getElementById('appShell');document.body.classList.remove('shahd-logged-out');document.body.classList.add('shahd-authenticated');if(g)g.hidden=true;if(s)s.hidden=false;requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'auto'}));const n=document.getElementById('sessionUserName'),c=document.getElementById('sessionCompanyName'),o=document.getElementById('sessionOfflineBadge');if(n)n.textContent=currentSession?.displayName||currentSession?.username||'';if(c)c.textContent=currentSession?.companyName||'';if(o)o.hidden=!currentSession?.offline;window.dispatchEvent(new CustomEvent('shahd:session',{detail:{session:currentSession}}))}
  async function forceLogout(message='تم تسجيل الخروج.'){clearTimeout(syncTimer);clearInterval(idleTimer);localStorage.removeItem(ACTIVE_PROFILE_KEY);currentSession=null;runtimeCredentials=null;syncing=false;showLogin(message);window.dispatchEvent(new CustomEvent('shahd:logout',{detail:{message}}))}

  function isTransportError(e){const m=String(e?.message||e||'').toLowerCase();return e?.name==='AbortError'||/failed to fetch|network|load failed|fetch|turso http 5\d\d|timeout|timed out/.test(m)}
  async function doLogin(companyKey,username,password){
    const ck=normalKey(companyKey),un=normalUser(username);if(!ck||!un||!password)throw new Error('أدخل مفتاح الشركة واسم المستخدم وكلمة المرور.');runtimeCredentials={companyKey:ck,username:un,password};let session;
    if(navigator.onLine!==false){
      try{
        const old=await getOne('profiles',sessionProfileKey(ck,un))||await getOne('profiles',legacySessionProfileKey(ck,un));
        session=await onlineLogin(ck,un,password);
        if(old&&(Number(old.session?.userAuthVersion||0)!==session.userAuthVersion||JSON.stringify(old.session?.permissions||{})!==JSON.stringify(session.permissions||{})))await setCursor(session.companyId,0);
        await cacheOfflineProfile(session,ck,un,password);
        if(session.role==='manager'&&normalUser(session.username)!==un)await cacheOfflineProfile(session,ck,normalUser(session.username),password);
      }catch(e){
        if(['BAD_CREDENTIALS','BAD_COMPANY_KEY','BAD_USERNAME','LICENSE_STOPPED','LICENSE_EXPIRED','USER_DISABLED'].includes(e.code))throw e;
        // Offline fallback is only for a real transport outage. SQL/schema errors
        // must stay visible instead of being mislabeled as wrong credentials.
        if(isTransportError(e)){
          try{session=await offlineLogin(ck,un,password)}catch(off){if(off?.code==='OFFLINE_PROFILE_MISSING')throw Object.assign(new Error('تعذر الاتصال بالسحابة ولا توجد جلسة محفوظة لهذا الحساب على الجهاز.'),{code:'NETWORK_OFFLINE'});throw off}
        }else throw Object.assign(new Error(`تعذر التحقق من الحساب: ${e?.message||e}`),{code:'LOGIN_SYSTEM_ERROR'});
      }
    }else session=await offlineLogin(ck,un,password);
    currentSession=session;localStorage.setItem(COMPANY_HINT_KEY,ck);let activeKey=sessionProfileKey(ck,un);if(!(await getOne('profiles',activeKey))){const legacyKey=legacySessionProfileKey(ck,un);if(await getOne('profiles',legacyKey))activeKey=legacyKey;}localStorage.setItem(ACTIVE_PROFILE_KEY,activeKey);applySessionUi();return session;
  }

  async function activateSession(session,defaultsFactory,{backgroundSync=true}={}){
    currentSession=session;
    currentState=await loadCompanyState(session.companyId,defaultsFactory);
    lastLocalState=clone(currentState);
    applySessionUi();
    startIdleSync();
    const result={state:clone(currentState),session:currentSession};
    window.dispatchEvent(new CustomEvent('shahd:session-ready',{detail:result}));
    if(backgroundSync&&navigator.onLine!==false)setTimeout(()=>syncNow().catch(()=>{}),500);
    return result;
  }

  async function start(defaultsFactory){
    if(started)return{state:clone(currentState),session:currentSession};
    started=true;await openDb();requestPersistentStorage();
    const form=document.getElementById('loginForm'),keyInput=document.getElementById('companyKey');if(keyInput)keyInput.value=localStorage.getItem(COMPANY_HINT_KEY)||'';
    let firstResolved=false,resolveFirst;const firstLogin=new Promise(resolve=>{resolveFirst=resolve});
    form?.addEventListener('submit',async e=>{
      e.preventDefault();setLoginStatus('جاري التحقق من الحساب...','info');const btn=form.querySelector('button[type="submit"]');if(btn)btn.disabled=true;
      try{
        const fd=new FormData(form),session=await doLogin(fd.get('companyKey'),fd.get('username'),fd.get('password'));
        const result=await activateSession(session,defaultsFactory,{backgroundSync:true});setLoginStatus('','info');
        if(!firstResolved){firstResolved=true;resolveFirst(result)}
      }catch(err){setLoginStatus(err?.message||'تعذر تسجيل الدخول.','error')}finally{if(btn)btn.disabled=false}
    });
    try{
      const restored=await restoreActiveSession();
      if(restored){
        const result=await activateSession(restored,defaultsFactory,{backgroundSync:true});
        firstResolved=true;resolveFirst(result);return result;
      }
    }catch(_){localStorage.removeItem(ACTIVE_PROFILE_KEY)}
    showLogin();return firstLogin;
  }

  async function listUsers(){
    if(!hasPermission('users.view'))throw new Error('ليس لديك صلاحية عرض المستخدمين.');
    const rows=await T.query(`SELECT id,username,display_name,role,permissions_json,active,created_at,updated_at FROM shahd_users WHERE company_id=? ORDER BY created_at ASC`,[currentSession.companyId]);
    return{users:rows.map(r=>({id:r.id,username:r.username,displayName:r.display_name,role:r.role,permissions:safeJson(r.permissions_json,{}),active:Number(r.active)===1,createdAt:r.created_at,updatedAt:r.updated_at}))};
  }
  async function saveUser(user){
    const editing=Boolean(user.id);if(!hasPermission(editing?'users.edit':'users.create'))throw new Error('ليس لديك صلاحية إدارة المستخدمين.');
    const username=normalUser(user.username),display=String(user.displayName||'').trim();if(!username||!display)throw new Error('أدخل اسم المستخدم واسم الموظف.');
    const ts=now(),permissions=JSON.stringify(user.permissions||{});
    if(editing){
      const existing=(await T.query(`SELECT id,role FROM shahd_users WHERE id=? AND company_id=? LIMIT 1`,[user.id,currentSession.companyId]))[0];if(!existing)throw new Error('المستخدم غير موجود.');if(existing.role==='manager'&&user.id===currentSession.userId&&user.password===undefined){}
      if(String(user.password||'')){const salt=T.salt(),hash=await T.hashPassword(user.password,salt);await T.execute(`UPDATE shahd_users SET username=?,display_name=?,password_hash=?,password_salt=?,permissions_json=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND company_id=?`,[username,display,hash,salt,permissions,ts,user.id,currentSession.companyId])}
      else await T.execute(`UPDATE shahd_users SET username=?,display_name=?,permissions_json=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND company_id=?`,[username,display,permissions,ts,user.id,currentSession.companyId]);
      return{ok:true,id:user.id};
    }
    if(!String(user.password||''))throw new Error('أدخل كلمة مرور المستخدم الجديد.');
    const checks=await T.pipeline([{sql:`SELECT max_users FROM shahd_companies WHERE id=? LIMIT 1`,args:[currentSession.companyId]},{sql:`SELECT COUNT(*) AS total FROM shahd_users WHERE company_id=? AND active=1`,args:[currentSession.companyId]}]);
    const max=Number(T.rowsToObjects(checks[0])[0]?.max_users||0),count=Number(T.rowsToObjects(checks[1])[0]?.total||0);if(max&&count>=max)throw new Error('تم الوصول إلى الحد الأقصى للمستخدمين لهذه الشركة.');
    const id=T.uuid('usr'),salt=T.salt(),hash=await T.hashPassword(user.password,salt);await T.execute(`INSERT INTO shahd_users(id,company_id,username,display_name,password_hash,password_salt,role,permissions_json,active,auth_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,1,?,?)`,[id,currentSession.companyId,username,display,hash,salt,'employee',permissions,ts,ts]);return{ok:true,id};
  }
  async function toggleUser(id,active){if(!hasPermission('users.disable'))throw new Error('ليس لديك صلاحية إيقاف المستخدمين.');if(id===currentSession.userId&&!active)throw new Error('لا يمكنك إيقاف حسابك الحالي.');await T.execute(`UPDATE shahd_users SET active=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND company_id=?`,[active?1:0,now(),id,currentSession.companyId]);return{ok:true}}
  async function storageStats(){try{const e=await navigator.storage?.estimate?.();return{usage:Number(e?.usage||0),quota:Number(e?.quota||0),persisted:await navigator.storage?.persisted?.()}}catch(_){return{usage:0,quota:0,persisted:false}}}

  window.addEventListener('online',()=>{if(currentSession){currentSession.offline=false;applySessionUi();scheduleSync(250)}});
  window.addEventListener('offline',()=>{if(currentSession){currentSession.offline=true;applySessionUi();emitStatus({offline:true})}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentSession&&navigator.onLine!==false&&now()-lastSyncAt>30000)scheduleSync(300)});
  setInterval(()=>{if(currentSession?.licenseExpiresAt&&now()>=Number(currentSession.licenseExpiresAt))forceLogout('انتهت مدة مفتاح الشركة. يجب تمديد الاشتراك ثم تسجيل الدخول من جديد.')},60000);

  window.ShahdCloud=Object.freeze({start,persistState,syncNow,queueCount,queueItems,hasPermission,getSession:()=>currentSession,getState:()=>clone(currentState),forceLogout,listUsers,saveUser,toggleUser,storageStats});
})();
