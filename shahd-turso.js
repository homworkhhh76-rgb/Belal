/* Shahd Accounting — direct Turso browser client (CashTop-style static mode)
 * Uses the same Turso database configured in the supplied CASH TOP package.
 * Static-web mode: works from normal hosting and compatible local HTML preview without a custom API server.
 */
(() => {
  'use strict';
  const DATABASE_URL = "libsql://cash-top-homworkhhh76-rgb.aws-eu-west-1.turso.io";
  const AUTH_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODUwODYwNTIsImlkIjoiMDE5ZjlmNjYtOTQwMS03MmEwLTkyNzItYjVhZjA2ODczZmIyIiwia2lkIjoicVgzS01DZ0pwQnp3eGo1Tzl2SHhaWUJGem9sTWFsa24tTU5JOTRlMTl6YyIsInJpZCI6ImQxZmE2MjhjLThiYTMtNDJhNS04MzhmLTc1MGJhNGQwYWE1YiJ9.Dl9BkY70zPZCzGnf_MHg2A7GtWsnd6BRGQoUyEeEPIz3BWbkDj70xD-B7x5U5VG8aBoiljNtCpg0OHJCjnuoAA";
  const PIPELINE_URL = DATABASE_URL.replace(/^libsql:\/\//i,'https://').replace(/\/+$/,'') + '/v2/pipeline';
  const SCHEMA_MARK = 'shahd_turso_schema_v14';
  let schemaPromise = null;

  const typedArg = value => {
    if (value === null || value === undefined) return {type:'null'};
    if (typeof value === 'number' && Number.isInteger(value)) return {type:'integer',value:String(value)};
    if (typeof value === 'number') return {type:'float',value:String(value)};
    if (typeof value === 'boolean') return {type:'integer',value:value?'1':'0'};
    return {type:'text',value:String(value)};
  };
  const cell = c => {
    if (!c || c.type === 'null') return null;
    if (c.type === 'integer' || c.type === 'float') { const n=Number(c.value); return Number.isFinite(n)?n:c.value; }
    return c.value;
  };
  const rowsToObjects = result => {
    const names=(result?.cols||[]).map(c=>c.name);
    return (result?.rows||[]).map(row=>Object.fromEntries(row.map((c,i)=>[names[i],cell(c)])));
  };
  async function pipelineRaw(statements, timeout=45000) {
    const list=Array.isArray(statements)?statements:[];
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
    try {
      const response=await fetch(PIPELINE_URL,{
        method:'POST',
        headers:{Authorization:`Bearer ${AUTH_TOKEN}`,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify({requests:[...list.map(s=>({type:'execute',stmt:{sql:s.sql,args:(s.args||[]).map(typedArg)}})),{type:'close'}]}),
        signal:controller.signal,cache:'no-store'
      });
      const text=await response.text();
      if(!response.ok) throw Object.assign(new Error(`Turso HTTP ${response.status}: ${text.slice(0,300)}`),{code:'TURSO_HTTP',status:response.status});
      let data; try{data=JSON.parse(text)}catch(_ ){throw new Error('استجابة Turso غير صالحة.')}
      return list.map((_,i)=>{
        const item=data.results?.[i];
        if(item?.type==='ok') return {ok:true,result:item.response?.result||{cols:[],rows:[],affected_row_count:0}};
        return {ok:false,error:item?.error?.message||item?.error||'SQL_ERROR'};
      });
    } finally { clearTimeout(timer); }
  }
  async function pipeline(statements, timeout=45000) {
    const res=await pipelineRaw(statements,timeout);
    const failed=res.find(x=>!x.ok); if(failed) throw new Error(`Turso SQL: ${failed.error}`);
    return res.map(x=>x.result);
  }
  async function ensureSchema(force=false) {
    if(schemaPromise) return schemaPromise;
    if(!force){try{if(localStorage.getItem(SCHEMA_MARK)==='1'){schemaPromise=Promise.resolve(true);return schemaPromise}}catch(_){}}
    schemaPromise=(async()=>{
      // First successful run creates the Shahd-only tables inside the same Turso database.
      const ddl=[
        `CREATE TABLE IF NOT EXISTS shahd_companies (
          id TEXT PRIMARY KEY, company_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active', expires_at INTEGER NOT NULL, max_users INTEGER NOT NULL DEFAULT 10,
          auth_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS idx_shahd_companies_key ON shahd_companies(company_key)`,
        `CREATE TABLE IF NOT EXISTS shahd_users (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee',
          permissions_json TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1, auth_version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(company_id, username)
        )`,
        `CREATE INDEX IF NOT EXISTS idx_shahd_users_company ON shahd_users(company_id, active)`,
        `CREATE TABLE IF NOT EXISTS shahd_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, company_id TEXT NOT NULL,
          entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_by TEXT, device_id TEXT
        )`,
        `CREATE INDEX IF NOT EXISTS idx_shahd_events_company_id ON shahd_events(company_id, id)`,
        `CREATE INDEX IF NOT EXISTS idx_shahd_events_entity ON shahd_events(company_id, entity_type, entity_id, id)`
      ];
      await pipeline(ddl.map(sql=>({sql})),60000);
      try{localStorage.setItem(SCHEMA_MARK,'1')}catch(_ ){}
      return true;
    })().catch(e=>{schemaPromise=null;throw e});
    return schemaPromise;
  }
  async function query(sql,args=[],timeout=30000) {
    await ensureSchema();
    try{const [r]=await pipeline([{sql,args}],timeout);return rowsToObjects(r)}catch(e){
      if(/no such table/i.test(String(e?.message||''))){try{localStorage.removeItem(SCHEMA_MARK)}catch(_){ }schemaPromise=null;await ensureSchema(true);const [r]=await pipeline([{sql,args}],timeout);return rowsToObjects(r)}
      throw e;
    }
  }
  async function execute(sql,args=[],timeout=30000) {
    await ensureSchema();
    try{const [r]=await pipeline([{sql,args}],timeout);return r}catch(e){
      if(/no such table/i.test(String(e?.message||''))){try{localStorage.removeItem(SCHEMA_MARK)}catch(_){ }schemaPromise=null;await ensureSchema(true);const [r]=await pipeline([{sql,args}],timeout);return r}
      throw e;
    }
  }
  function uuid(prefix='id') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`; }
  function salt() { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`; }
  async function hashPassword(password,saltValue) {
    const data=new TextEncoder().encode(`${saltValue}:${String(password||'')}`);
    const digest=await crypto.subtle.digest('SHA-256',data);
    return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  // v11/v12 stored company-user passwords with PBKDF2-SHA256 (120k rounds, Base64).
  // v14+ uses the lighter SHA-256(salt:password) format.  Keep both readable so
  // companies created in older releases do not suddenly reject the correct password.
  async function legacyPbkdf2Password(password,saltValue) {
    const enc=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',enc.encode(String(password||'')),'PBKDF2',false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(String(saltValue||'')),iterations:120000,hash:'SHA-256'},key,256);
    const bytes=new Uint8Array(bits);let binary='';
    for(const b of bytes)binary+=String.fromCharCode(b);
    return btoa(binary);
  }
  async function verifyPassword(password,saltValue,storedHash) {
    const stored=String(storedHash||'').trim();
    if(!stored)return {ok:false,scheme:'none'};
    const current=await hashPassword(password,saltValue);
    if(current===stored.toLowerCase())return {ok:true,scheme:'current'};
    // Legacy hashes are Base64 (normally 44 chars) and may end with '='.
    try{
      const legacy=await legacyPbkdf2Password(password,saltValue);
      if(legacy===stored)return {ok:true,scheme:'legacy'};
    }catch(_){ }
    return {ok:false,scheme:'unknown'};
  }
  function json(value,fallback={}) { try{return JSON.parse(String(value||''))}catch(_ ){return fallback} }
  window.SHAHD_TURSO=Object.freeze({
    databaseURL:DATABASE_URL,pipelineUrl:PIPELINE_URL,ensureSchema,pipeline,pipelineRaw,query,execute,rowsToObjects,
    uuid,salt,hashPassword,legacyPbkdf2Password,verifyPassword,json
  });
})();
