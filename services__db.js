import { calculateUnitConversions } from './utils__unitTree.js?v=7.9.4.136-localization';
const DB_BASE_NAME = 'Oscar_Accounting_POS_DB';
const DB_VERSION = 9;
export const getTenantId = () => String(window.OscarActivation?.readRuntime?.()?.companyId || 'local').trim() || 'local';
const dbNameForTenant = (tenantId = getTenantId()) => `${DB_BASE_NAME}__${encodeURIComponent(String(tenantId || 'local').trim() || 'local')}`;
let cachedTenant = '';
// Realtime sync broadcast channel for cross-tab communication
export const syncChannel = typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('oscar_pos_sync')
    : null;
let cachedDB = null;
let dbOpenPromise = null;
let openingTenant = '';

// Close a cached connection immediately when a different company is activated.
// This prevents an in-flight/open IndexedDB handle from ever leaking into the next tenant.
if (typeof window !== 'undefined') {
    window.addEventListener('oscar:activation-loaded', (event) => {
        const nextTenant = String(event?.detail?.companyId || '').trim();
        if (cachedDB && cachedTenant && nextTenant && cachedTenant !== nextTenant) {
            try { cachedDB.close(); } catch {}
            cachedDB = null;
            cachedTenant = '';
            dbOpenPromise = null;
            openingTenant = '';
        }
    });
}
let storageStatusPromise = null;
export async function enablePersistentLocalStorage() {
    if (storageStatusPromise) return storageStatusPromise;
    storageStatusPromise = (async () => {
        try {
            const storage = typeof navigator !== 'undefined' ? navigator.storage : null;
            if (!storage) return { supported: false, persisted: false };
            let persisted = false;
            try { persisted = !!(await storage.persisted?.()); } catch {}
            if (!persisted) { try { persisted = !!(await storage.persist?.()); } catch {} }
            let estimate = {};
            try { estimate = await storage.estimate?.() || {}; } catch {}
            const detail = { supported: true, persisted, usage: Number(estimate.usage || 0), quota: Number(estimate.quota || 0), at: Date.now() };
            try { localStorage.setItem('oscar_storage_status_v1', JSON.stringify(detail)); } catch {}
            try { window.dispatchEvent(new CustomEvent('oscar:storage-status', { detail })); } catch {}
            return detail;
        } catch (error) {
            return { supported: false, persisted: false, error: String(error?.message || error) };
        }
    })();
    return storageStatusPromise;
}
function openDB() {
    const wantedTenant = getTenantId();
    if (cachedDB && cachedTenant === wantedTenant) {
        return Promise.resolve(cachedDB);
    }
    if (cachedDB && cachedTenant !== wantedTenant) { try { cachedDB.close(); } catch {} cachedDB = null; dbOpenPromise = null; }
    if (dbOpenPromise) {
        if (openingTenant === wantedTenant) return dbOpenPromise;
        return dbOpenPromise.catch(() => null).then(() => {
            if (cachedDB && cachedTenant !== wantedTenant) { try { cachedDB.close(); } catch {} cachedDB = null; cachedTenant = ''; }
            dbOpenPromise = null;
            openingTenant = '';
            return openDB();
        });
    }
    openingTenant = wantedTenant;
    dbOpenPromise = new Promise((resolve, reject) => {
        try {
            if (typeof window === 'undefined' || !window.indexedDB) throw new Error('IndexedDB is not supported');
            const dbName = dbNameForTenant(wantedTenant);
            let fellBackToExistingVersion = false;
            const wireRequest = (request) => {
                request.onblocked = () => console.warn('IndexedDB version upgrade blocked by another connection');
                request.onerror = () => {
                    // Never downgrade an existing customer database. Older builds used version 6,
                    // while some real installations are already at version 7+. In that case open
                    // the database at its existing version instead of failing with VersionError.
                    if (!fellBackToExistingVersion && request.error?.name === 'VersionError') {
                        fellBackToExistingVersion = true;
                        try { wireRequest(indexedDB.open(dbName)); return; }
                        catch (fallbackError) {
                            dbOpenPromise = null; openingTenant = ''; reject(fallbackError); return;
                        }
                    }
                    dbOpenPromise = null;
                    openingTenant = '';
                    reject(request.error || new Error('Failed to open database'));
                };
                request.onsuccess = () => {
                    cachedDB = request.result;
                    cachedTenant = wantedTenant;
                    openingTenant = wantedTenant;
                    cachedDB.onclose = () => {
                        cachedDB = null;
                        cachedTenant = '';
                        dbOpenPromise = null;
                        openingTenant = '';
                    };
                    cachedDB.onversionchange = () => {
                        cachedDB?.close();
                        cachedDB = null;
                        cachedTenant = '';
                        dbOpenPromise = null;
                        openingTenant = '';
                    };
                    resolve(cachedDB);
                };
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    const stores = [
                        'products','categories','warehouses','stock','stock_movements','invoices','purchases','customers','suppliers','partner_statements','accounts','transfers','expenses','shifts','audit_logs','held_invoices','sync_queue','settings','vouchers','employees','restaurant_tables','restaurant_sections','restaurant_orders','kitchen_sections','table_reservations','recipes','waste_records',
                    ];
                    stores.forEach((storeName) => {
                        if (!db.objectStoreNames.contains(storeName)) {
                            if (storeName === 'stock') db.createObjectStore(storeName, { keyPath: ['productId', 'warehouseId'] });
                            else if (storeName === 'settings') db.createObjectStore(storeName, { keyPath: 'key' });
                            else db.createObjectStore(storeName, { keyPath: 'id' });
                        }
                    });
                    // v8: real database-side pagination. These indexes let record screens walk
                    // only the requested page instead of materializing whole historical tables.
                    const indexSpecs = {
                        invoices: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId'],['type','type'],['paymentType','paymentType'],['customerId','customerId']],
                        purchases: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId'],['supplierId','supplierId']],
                        stock_movements: [['date','date'],['financialYearId','financialYearId'],['productId','productId'],['warehouseId','warehouseId'],['productWarehouseDate',['productId','warehouseId','date']]],
                        expenses: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId'],['category','category']],
                        vouchers: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId'],['type','type'],['partyId','partyId']],
                        transfers: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId']],
                        audit_logs: [['date','date'],['timestamp','timestamp'],['createdAt','createdAt'],['financialYearId','financialYearId']],
                        partner_statements: [['date','date'],['createdAt','createdAt'],['financialYearId','financialYearId'],['partnerId','partnerId'],['partyId','partyId']],
                        held_invoices: [['date','date'],['createdAt','createdAt']],
                        customers: [['createdAt','createdAt'],['name','name'],['phone','phone']],
                        suppliers: [['createdAt','createdAt'],['name','name'],['phone','phone']],
                    };
                    for (const [storeName, specs] of Object.entries(indexSpecs)) {
                        if (!db.objectStoreNames.contains(storeName)) continue;
                        const os = event.target.transaction.objectStore(storeName);
                        for (const [indexName, keyPath] of specs) {
                            if (!os.indexNames.contains(indexName)) {
                                try { os.createIndex(indexName, keyPath, { unique: false }); } catch (_) {}
                            }
                        }
                    }
                };
            };
            wireRequest(indexedDB.open(dbName, DB_VERSION));
        } catch (e) {
            dbOpenPromise = null;
            openingTenant = '';
            reject(e);
        }
    });
    return dbOpenPromise;
}
// Cloud sync capture is intentionally kept outside IndexedDB transactions.
function captureCloud(storeName, value, opts={}) {
    try { if (!window.OscarCloudSync?.suppress) return window.OscarCloudSync?.captureStoreChange?.(storeName, value, opts) || Promise.resolve(false); } catch (e) { console.warn('Cloud capture warning', e); }
    return Promise.resolve(false);
}
// Local-first cloud capture scheduler. IndexedDB commits always finish before any
// queue/network work starts. Changes are coalesced and flushed during an idle slice
// so saving invoices stays instant even on 120Hz phones.
const cloudCaptureBuffer = new Map();
let cloudCaptureTimer = null;
function cloudCaptureKey(storeName, value, opts={}) {
    let key = opts?.key;
    if (key === undefined || key === null) {
        if (storeName === 'stock') key = [value?.productId || '', value?.warehouseId || ''];
        else if (storeName === 'settings') key = value?.key || 'store_config';
        else key = value?.id || '';
    }
    return `${storeName}::${JSON.stringify(key)}`;
}
async function flushCloudCaptureBuffer() {
    cloudCaptureTimer = null;
    const entries = [...cloudCaptureBuffer.values()];
    cloudCaptureBuffer.clear();
    for (const entry of entries) {
        const waits = [0, 220, 850, 2200];
        for (let i = 0; i < waits.length; i += 1) {
            if (waits[i]) await new Promise(resolve => setTimeout(resolve, waits[i]));
            try {
                const captured = await captureCloud(entry.storeName, entry.value, entry.opts);
                if (captured !== false) break;
            } catch (e) {
                if (i === waits.length - 1) console.warn('Cloud capture retry warning', e);
            }
        }
    }
    try { window.OscarCloudSync?.requestSync?.(180); } catch {}
}
function scheduleCloudCapture(storeName, value, opts={}) {
    if (typeof window === 'undefined') return;
    let cloudValue = value;
    // Product image bytes selected while offline stay only in local IndexedDB.
    // Turso receives metadata now, then the Telegram file_id on the later automatic update.
    if (storeName === 'products' && cloudValue && typeof cloudValue === 'object' && typeof cloudValue.imageData === 'string' && cloudValue.imageData.startsWith('data:image/')) {
        cloudValue = { ...cloudValue, imageData: '' };
    }
    cloudCaptureBuffer.set(cloudCaptureKey(storeName, cloudValue, opts), { storeName, value: cloudValue, opts });
    if (cloudCaptureTimer) return;
    const run = () => {
        cloudCaptureTimer = setTimeout(() => {
            const job = () => flushCloudCaptureBuffer().catch(e => console.warn('Cloud capture schedule warning', e));
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(job, { timeout: 450 });
            else job();
        }, 24);
    };
    run();
}
function broadcastStoreUpdated(storeName) {
    try { if (syncChannel) syncChannel.postMessage({ type: 'STORE_UPDATED', storeName, tenantId: getTenantId() }); } catch {}
}
// Commit many local records atomically in ONE IndexedDB transaction.
// The promise resolves as soon as the local transaction is durable; cloud capture is
// deliberately scheduled afterwards so the UI never waits for network/sync work.
export async function commitLocalBatch(operations = [], notifySync = true, options = {}) {
    const ops = (Array.isArray(operations) ? operations : []).filter(op => op?.storeName && (op.type === 'put' || op.type === 'delete'));
    if (!ops.length) return { committed: 0, stores: [] };
    if(notifySync&&!options.fiscalClose)for(const op of ops)if(FISCAL_LOCKED_STORES.has(op.storeName))await assertOpenFinancialRecord(await getFromStore(op.storeName,op.type==='delete'?op.key:recordKey(op.storeName,op.value))||op.value);
    const db = await openDB();
    const stores = [...new Set(ops.map(op => op.storeName))];
    const stamp = new Date().toISOString();
    const prepared = ops.map(op => {
        if (op.type !== 'put') return op;
        const value = (op.storeName === 'stock' && notifySync && op.value && typeof op.value === 'object')
            ? { ...op.value, updatedAt: stamp }
            : op.value;
        return { ...op, value };
    });
    return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, 'readwrite');
        try {
            for (const op of prepared) {
                const store = tx.objectStore(op.storeName);
                if (op.type === 'delete') store.delete(op.key);
                else store.put(op.value);
            }
        } catch (error) {
            // A synchronous DataError must roll back already queued writes too.
            try { tx.abort(); } catch {}
            reject(error);
            return;
        }
        tx.oncomplete = () => {
            // Resolve local save FIRST. Everything below runs later in the event loop.
            resolve({ committed: prepared.length, stores });
            if (!notifySync) return;
            setTimeout(() => {
                const touched = new Set();
                for (const op of prepared) {
                    touched.add(op.storeName);
                    if (op.type === 'delete') {
                        adjustCachedQueryMetadata(op.storeName, op.before || null, null, 'delete');
                        scheduleCloudCapture(op.storeName, null, { deleted:true, key:op.key });
                    } else {
                        adjustCachedQueryMetadata(op.storeName, op.before || null, op.value, op.actionHint || 'update');
                        scheduleCloudCapture(op.storeName, op.value);
                    }
                    try {
                        window.dispatchEvent(new CustomEvent('oscar:db-mutation', { detail: {
                            action: op.actionHint || (op.type === 'delete' ? 'delete' : 'update'),
                            storeName: op.storeName, value: op.type === 'delete' ? (op.before || null) : op.value,
                            before: op.before || null, key: op.key, localBatch:true, at: new Date().toISOString()
                        } }));
                    } catch {}
                }
                touched.forEach(broadcastStoreUpdated);
            }, 0);
        };
        tx.onerror = () => reject(tx.error || new Error('تعذر الحفظ المحلي'));
        tx.onabort = () => reject(tx.error || new Error('تعذر إكمال الحفظ المحلي'));
    });
}

// Generic CRUD operations
function recordKey(storeName, value) {
    if (storeName === 'stock') return [value?.productId, value?.warehouseId];
    if (storeName === 'settings') return value?.key;
    return value?.id;
}
function stableRecord(value) {
    if (value === undefined) return '__undefined__';
    try {
        if (!value || typeof value !== 'object') return JSON.stringify(value);
        const sort = (v) => Array.isArray(v) ? v.map(sort) : (v && typeof v === 'object' ? Object.keys(v).sort().reduce((o,k)=>(o[k]=sort(v[k]),o),{}) : v);
        return JSON.stringify(sort(value));
    } catch { return String(value); }
}
function sameRecord(a, b) { return stableRecord(a) === stableRecord(b); }
export async function getAllFromStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ---------- Database-side pagination / search / aggregate helpers ----------
// Historical screens use these helpers so React never needs to hold every old record.
// Online: query Turso directly with LIMIT/OFFSET + COUNT and cache only opened pages.
// Offline: walk IndexedDB with a cursor and keep at most the requested page in memory.
const PAGE_SORT_FIELD = {
    invoices: 'date', purchases: 'date', stock_movements: 'date', expenses: 'date',
    vouchers: 'date', transfers: 'date', audit_logs: 'date', partner_statements: 'date',
    held_invoices: 'date', customers: 'createdAt', suppliers: 'createdAt',
};
const PAGED_HISTORY_STORES = new Set(['invoices','purchases','stock_movements','expenses','vouchers','transfers','audit_logs','partner_statements','held_invoices']);
export const isPagedHistoryStore = (storeName) => PAGED_HISTORY_STORES.has(String(storeName || ''));

function normalizedComparable(value) {
    if (value === undefined || value === null) return '';
    return String(value);
}
function normalizeInvoiceSearch(value){return String(value??'').toLowerCase().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/[\u064B-\u065F\u0670ـ]/g,'').trim();}
function recordMatchesPageQuery(row, options = {}) {
    if (!row || typeof row !== 'object') return false;
    const filters = options.filters && typeof options.filters === 'object' ? options.filters : {};
    const legacyFinancialYearId = options.legacyFinancialYearId || '';
    for (const [field, wanted] of Object.entries(filters)) {
        if (wanted === undefined || wanted === '' || wanted === 'all') continue;
        let actual = row?.[field];
        if (field === 'financialYearId' && (actual === undefined || actual === null || actual === '')) actual = legacyFinancialYearId;
        if (Array.isArray(wanted)) {
            if (!wanted.map(normalizedComparable).includes(normalizedComparable(actual))) return false;
        } else if (wanted === null) {
            if (!(actual === undefined || actual === null || actual === '')) return false;
        } else if (normalizedComparable(actual) !== normalizedComparable(wanted)) return false;
    }
    const deletedMode = options.deletedMode || 'exclude';
    if (deletedMode === 'exclude' && row.deletedAt) return false;
    if (deletedMode === 'only' && !row.deletedAt) return false;
    const dateField = options.dateField || PAGE_SORT_FIELD[options.storeName] || 'date';
    const rawDate = row?.[dateField] || row?.date || row?.createdAt || row?.timestamp || '';
    const t = rawDate ? new Date(rawDate).getTime() : 0;
    if (options.dateFrom) {
        const from = new Date(options.dateFrom).getTime();
        if (Number.isFinite(from) && (!Number.isFinite(t) || t < from)) return false;
    }
    if (options.dateTo) {
        const to = new Date(options.dateTo).getTime();
        if (Number.isFinite(to) && (!Number.isFinite(t) || t > to)) return false;
    }
    const numericGt = options.numericGt || {};
    for (const [field, threshold] of Object.entries(numericGt)) if (!(Number(row?.[field]) > Number(threshold))) return false;
    const numericGte = options.numericGte || {};
    for (const [field, threshold] of Object.entries(numericGte)) if (!(Number(row?.[field]) >= Number(threshold))) return false;
    const numericLt = options.numericLt || {};
    for (const [field, threshold] of Object.entries(numericLt)) if (!(Number(row?.[field]) < Number(threshold))) return false;
    const numericLte = options.numericLte || {};
    for (const [field, threshold] of Object.entries(numericLte)) if (!(Number(row?.[field]) <= Number(threshold))) return false;
    const tokens=normalizeInvoiceSearch(options.search).split(/\s+/).filter(Boolean);
    if(tokens.length){let blob='';try{blob=normalizeInvoiceSearch(JSON.stringify(row))}catch{}if(!tokens.every(token=>blob.includes(token)))return false;}
    return true;
}

// ---------- Persistent tiny query metadata cache ----------
// Only aggregate numbers and paging metadata are persisted here. Historical table rows
// remain in IndexedDB/cloud. This lets offline screens keep values such as "137 invoices"
// without forcing a scan of all historical rows.
let queryMetaMemory = null;
let queryMetaTenant = '';
function stableCacheValue(value) {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(stableCacheValue);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((out, key) => {
            if (key === 'page' || key === 'source' || key === 'countTotal') return out;
            out[key] = stableCacheValue(value[key]);
            return out;
        }, {});
    }
    return value;
}
function queryMetaStorageKey() {
    return `cash_top_3_query_meta_v2::${getTenantId()}`;
}
function readQueryMetaCache() {
    const tenant = getTenantId();
    if (queryMetaMemory && queryMetaTenant === tenant) return queryMetaMemory;
    queryMetaTenant = tenant;
    try {
        const parsed = JSON.parse(localStorage.getItem(queryMetaStorageKey()) || 'null');
        queryMetaMemory = parsed && typeof parsed === 'object'
            ? { pageMeta: parsed.pageMeta || {}, stats: parsed.stats || {} }
            : { pageMeta: {}, stats: {} };
    } catch {
        queryMetaMemory = { pageMeta: {}, stats: {} };
    }
    return queryMetaMemory;
}
function writeQueryMetaCache() {
    try { localStorage.setItem(queryMetaStorageKey(), JSON.stringify(readQueryMetaCache())); } catch {}
}
function hashQuerySignature(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
}
function queryMetaSignature(kind, storeName, options = {}) {
    const normalized = stableCacheValue(options || {});
    return `${kind}:${storeName}:${hashQuerySignature(JSON.stringify(normalized))}`;
}
function pruneQueryMetaBucket(bucket, max = 80) {
    const entries = Object.entries(bucket || {});
    if (entries.length <= max) return;
    entries.sort((a,b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0));
    for (let i = 0; i < entries.length - max; i += 1) delete bucket[entries[i][0]];
}
function cachePageMetadata(storeName, options, result) {
    if (!result) return;
    const cache = readQueryMetaCache();
    const key = queryMetaSignature('page', storeName, options);
    cache.pageMeta[key] = {
        storeName,
        options: stableCacheValue(options || {}),
        total: Math.max(0, Number(result.total || 0)),
        pageSize: Math.max(1, Number(result.pageSize || options?.pageSize || 50)),
        updatedAt: Date.now(),
    };
    pruneQueryMetaBucket(cache.pageMeta, 80);
    writeQueryMetaCache();
}
function getCachedPageMetadata(storeName, options) {
    const cache = readQueryMetaCache();
    return cache.pageMeta[queryMetaSignature('page', storeName, options)] || null;
}
function cacheStatsMetadata(storeName, options, result) {
    if (!result?.ranges) return;
    const cache = readQueryMetaCache();
    const key = queryMetaSignature('stats', storeName, options);
    cache.stats[key] = {
        storeName,
        options: stableCacheValue(options || {}),
        result: stableCacheValue(result),
        updatedAt: Date.now(),
    };
    pruneQueryMetaBucket(cache.stats, 80);
    writeQueryMetaCache();
}
function getCachedStatsMetadata(storeName, options) {
    const cache = readQueryMetaCache();
    return cache.stats[queryMetaSignature('stats', storeName, options)]?.result || null;
}
export function peekCachedStoreStats(storeName, options = {}) {
    const cached = getCachedStatsMetadata(storeName, options);
    if (!cached?.ranges) return null;
    return { ...cached, source:'aggregate-cache', offline: typeof navigator !== 'undefined' && navigator.onLine === false };
}
function rowMatchesStatRange(row, storeName, options, range) {
    if (!row || !recordMatchesPageQuery(row, { ...options, dateFrom:null, dateTo:null, storeName })) return false;
    const dateField = options?.dateField || PAGE_SORT_FIELD[storeName] || 'date';
    const rawDate = row?.[dateField] || row?.date || row?.createdAt || row?.timestamp || '';
    const t = rawDate ? new Date(rawDate).getTime() : 0;
    if (range?.from) {
        const from = new Date(range.from).getTime();
        if (Number.isFinite(from) && (!Number.isFinite(t) || t < from)) return false;
    }
    if (range?.to) {
        const to = new Date(range.to).getTime();
        if (Number.isFinite(to) && (!Number.isFinite(t) || t > to)) return false;
    }
    return true;
}
function adjustCachedQueryMetadata(storeName, beforeValue, afterValue, actionHint = '') {
    try {
        const cache = readQueryMetaCache();
        let anyChanged = false;
        for (const entry of Object.values(cache.pageMeta || {})) {
            if (entry?.storeName !== storeName) continue;
            if (actionHint === 'update' && !beforeValue) continue;
            const opts = entry.options || {};
            const beforeMatch = !!beforeValue && recordMatchesPageQuery(beforeValue, { ...opts, storeName });
            const afterMatch = !!afterValue && recordMatchesPageQuery(afterValue, { ...opts, storeName });
            const delta = Number(afterMatch) - Number(beforeMatch);
            if (delta) {
                entry.total = Math.max(0, Number(entry.total || 0) + delta);
                entry.updatedAt = Date.now();
                anyChanged = true;
            }
        }
        for (const entry of Object.values(cache.stats || {})) {
            if (entry?.storeName !== storeName || !entry?.result?.ranges) continue;
            if (actionHint === 'update' && !beforeValue) continue;
            const opts = entry.options || {};
            const ranges = Array.isArray(opts.ranges) && opts.ranges.length
                ? opts.ranges
                : [{ key:'all', from:opts.dateFrom || null, to:opts.dateTo || null }];
            const sumFields = Array.isArray(opts.sumFields) ? opts.sumFields : [];
            let entryChanged = false;
            for (const range of ranges) {
                const key = range.key || 'all';
                const bucket = entry.result.ranges[key];
                if (!bucket) continue;
                const beforeMatch = rowMatchesStatRange(beforeValue, storeName, opts, range);
                const afterMatch = rowMatchesStatRange(afterValue, storeName, opts, range);
                const delta = Number(afterMatch) - Number(beforeMatch);
                if (delta) {
                    bucket.count = Math.max(0, Number(bucket.count || 0) + delta);
                    entryChanged = true;
                }
                for (const field of sumFields) {
                    const beforeSum = beforeMatch ? (Number(beforeValue?.[field]) || 0) : 0;
                    const afterSum = afterMatch ? (Number(afterValue?.[field]) || 0) : 0;
                    if (beforeSum !== afterSum) {
                        bucket.sums = bucket.sums || {};
                        bucket.sums[field] = Number(bucket.sums[field] || 0) + afterSum - beforeSum;
                        entryChanged = true;
                    }
                }
            }
            if (entryChanged) {
                entry.updatedAt = Date.now();
                anyChanged = true;
            }
        }
        if (anyChanged) writeQueryMetaCache();
    } catch {}
}

function localSortSource(store, storeName, options = {}) {
    const requested = String(options.sortField || PAGE_SORT_FIELD[storeName] || '');
    if (requested && store.indexNames?.contains?.(requested)) return store.index(requested);
    const fallback = PAGE_SORT_FIELD[storeName];
    if (fallback && store.indexNames?.contains?.(fallback)) return store.index(fallback);
    return store;
}
export async function countStoreRecords(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).count();
        req.onsuccess = () => resolve(Number(req.result || 0));
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error || new Error(`تعذر عد سجلات ${storeName}`));
    });
}

export async function getLatestStockMovementLocal(productId, warehouseId) {
    if (productId === undefined || productId === null || warehouseId === undefined || warehouseId === null) return null;
    const db = await openDB();
    try {
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction('stock_movements', 'readonly');
            const store = tx.objectStore('stock_movements');
            if (!store.indexNames.contains('productWarehouseDate') || typeof IDBKeyRange === 'undefined') {
                resolve(undefined);
                return;
            }
            const idx = store.index('productWarehouseDate');
            const range = IDBKeyRange.bound([productId, warehouseId, ''], [productId, warehouseId, '\uffff']);
            const req = idx.openCursor(range, 'prev');
            req.onsuccess = () => resolve(req.result?.value || null);
            req.onerror = () => reject(req.error);
            tx.onerror = () => reject(tx.error || new Error('تعذر قراءة آخر حركة مخزون'));
        });
        if (result !== undefined) return result;
    } catch (_) {}
    // Compatibility fallback for databases whose existing version is newer than this build
    // and therefore could not receive the compound v9 index.
    const page = await queryStorePageLocal('stock_movements', {
        page: 1, pageSize: 1, source: 'local', countTotal: false, deletedMode: 'all',
        sortField: 'date', sortDirection: 'desc', filters: { productId, warehouseId },
    });
    return page.items?.[0] || null;
}

export async function queryStorePageLocal(storeName, options = {}) {
    const pageSize = Math.min(250, Math.max(1, Number(options.pageSize || 50)));
    const page = Math.max(1, Number(options.page || 1));
    const start = (page - 1) * pageSize;
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const source = localSortSource(store, storeName, options);
        const direction = String(options.sortDirection || 'desc').toLowerCase() === 'asc' ? 'next' : 'prev';
        const request = source.openCursor(null, direction);
        const items = [];
        let total = 0;
        const countTotal = options.countTotal !== false;
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const value = cursor.value;
            if (recordMatchesPageQuery(value, { ...options, storeName })) {
                if (total >= start && items.length < pageSize) items.push(value);
                total += 1;
                // Startup hydration only needs the requested page. Stop the IndexedDB
                // cursor as soon as that page is full instead of walking years of history.
                if (!countTotal && items.length >= pageSize) return;
            }
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => {
            const effectiveTotal = countTotal ? total : (start + items.length);
            const totalPages = countTotal ? Math.max(1, Math.ceil(total / pageSize)) : Math.max(1, page + (items.length >= pageSize ? 1 : 0));
            resolve({ items, total: effectiveTotal, page, pageSize, totalPages, source: 'indexeddb', totalExact: countTotal });
        };
        tx.onerror = () => reject(tx.error || new Error(`تعذر قراءة ${storeName}`));
    });
}
export async function queryStorePage(storeName, options = {}) {
    const normalized = { page: 1, pageSize: 50, sortDirection: 'desc', ...options };
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const meta = getCachedPageMetadata(storeName, normalized);

    // Explicit local reads are used to paint page 1 instantly from IndexedDB.
    if (normalized.source === 'local') {
        const local = await queryStorePageLocal(storeName, { ...normalized, countTotal: normalized.countTotal === true });
        if (meta) {
            const total = Math.max(Number(meta.total || 0), Number(local.items?.length || 0));
            return { ...local, total, totalPages: Math.max(1, Math.ceil(total / normalized.pageSize)), totalExact:true, source:'indexeddb-cache' };
        }
        return local;
    }

    let remoteError = null;
    if (online && window.OscarCloudSync?.queryStorePage) {
        try {
            const remote = await window.OscarCloudSync.queryStorePage(storeName, normalized);
            if (remote && Array.isArray(remote.items)) {
                // Cache only pages the user actually opens. No cloud capture / echo.
                if (remote.items.length) await bulkPut(storeName, remote.items, false).catch(() => {});
                cachePageMetadata(storeName, normalized, remote);
                return { ...remote, source: remote.source || 'cloud' };
            }
        } catch (error) {
            remoteError = error;
            console.warn(`Paged cloud query fallback (${storeName})`, error);
        }
    }

    if(normalized.requireRemote&&(!online||remoteError||!window.OscarCloudSync?.queryStorePage))throw new Error('تعذر التحقق من اكتمال الأرشيف على الخادم. أعد المحاولة عند توفر الاتصال.');

    // Page 2+ is intentionally network-on-demand. We never reconstruct an old page from
    // a partial IndexedDB history because that could show the wrong 50 records.
    if (Number(normalized.page || 1) > 1) {
        if (online && remoteError) throw new Error('تعذر تحميل السجلات القديمة. أعد المحاولة بعد التحقق من الاتصال.');
        if (!meta) return queryStorePageLocal(storeName, {...normalized, countTotal:true});
        const total = Math.max(0, Number(meta?.total || 0));
        return {
            items: [], total, page: Number(normalized.page || 1), pageSize: normalized.pageSize,
            totalPages: Math.max(1, Math.ceil(total / normalized.pageSize)), source:'offline-missing',
            totalExact: !!meta, offlineUnavailable:true,
        };
    }

    // Page 1 remains available offline. Stop as soon as the first 50 cached rows are read;
    // use the persisted cloud count so the general statistics stay unchanged offline.
    const local = await queryStorePageLocal(storeName, { ...normalized, source:'local', countTotal:false });
    if (meta) {
        const total = Math.max(Number(meta.total || 0), Number(local.items?.length || 0));
        return { ...local, total, totalPages: Math.max(1, Math.ceil(total / normalized.pageSize)), totalExact:true, source:'indexeddb-cache' };
    }
    return local;
}
export async function queryAllStoreRecords(storeName, options = {}) {
    const pageSize = Math.min(250, Math.max(50, Number(options.pageSize || 200)));
    const out = [];
    let page = 1, totalPages = 1;
    do {
        const result = await queryStorePage(storeName, { ...options, page, pageSize });
        if (result.offlineUnavailable) throw new Error('بعض السجلات القديمة غير متاحة دون اتصال. اتصل بالإنترنت ثم أعد التصدير.');
        out.push(...(result.items || []));
        totalPages = Math.max(1, Number(result.totalPages || Math.ceil(Number(result.total || 0) / pageSize) || 1));
        page += 1;
    } while (page <= totalPages);
    return out;
}
export async function queryStoreStatsLocal(storeName, options = {}) {
    const ranges = Array.isArray(options.ranges) && options.ranges.length ? options.ranges : [{ key: 'all', from: options.dateFrom || null, to: options.dateTo || null }];
    const sumFields = Array.isArray(options.sumFields) ? options.sumFields : [];
    const result = {};
    ranges.forEach((r) => { result[r.key || 'all'] = { count: 0, sums: Object.fromEntries(sumFields.map(f => [f, 0])) }; });
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.openCursor();
        req.onsuccess = () => {
            const cur = req.result;
            if (!cur) return;
            const row = cur.value;
            if (recordMatchesPageQuery(row, { ...options, dateFrom: null, dateTo: null, search: options.search || '', storeName })) {
                const rawDate = row?.[options.dateField || PAGE_SORT_FIELD[storeName] || 'date'] || row?.date || row?.createdAt || row?.timestamp || '';
                const t = rawDate ? new Date(rawDate).getTime() : 0;
                for (const r of ranges) {
                    const from = r.from ? new Date(r.from).getTime() : null;
                    const to = r.to ? new Date(r.to).getTime() : null;
                    if (from !== null && Number.isFinite(from) && (!Number.isFinite(t) || t < from)) continue;
                    if (to !== null && Number.isFinite(to) && (!Number.isFinite(t) || t > to)) continue;
                    const bucket = result[r.key || 'all'];
                    bucket.count += 1;
                    for (const field of sumFields) bucket.sums[field] += Number(row?.[field]) || 0;
                }
            }
            cur.continue();
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error(`تعذر حساب إحصائيات ${storeName}`));
    });
    return { ranges: result, source: 'indexeddb' };
}
export async function queryStoreStats(storeName, options = {}) {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online && options.source !== 'local' && window.OscarCloudSync?.queryStoreStats) {
        try {
            const remote = await window.OscarCloudSync.queryStoreStats(storeName, options);
            if (remote?.ranges) cacheStatsMetadata(storeName, options, remote);
            return remote;
        } catch (error) { console.warn(`Cloud aggregate fallback (${storeName})`, error); }
    }
    // Prefer the last exact aggregate obtained from the full cloud database. A local scan can
    // contain only cached pages, so using it first would incorrectly turn e.g. 137 into 50.
    const cached = getCachedStatsMetadata(storeName, options);
    if (cached?.ranges) return { ...cached, source:'aggregate-cache', offline:true };
    return queryStoreStatsLocal(storeName, options);
}

export async function getFromStore(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
export async function putInStore(storeName, value, notifySync = true) {
    if(notifySync&&FISCAL_LOCKED_STORES.has(storeName))await assertOpenFinancialRecord(await getFromStore(storeName,recordKey(storeName,value))||value);
    const db = await openDB();
    const key = recordKey(storeName, value);
    const stockStamp = new Date().toISOString();
    let beforeValue = null, changed = true, action = 'add';
    let storedValue = value;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const write = () => {
            storedValue = (storeName === 'stock' && notifySync && value && typeof value === 'object')
                ? { ...value, updatedAt: stockStamp }
                : value;
            store.put(storedValue);
        };
        if (notifySync) {
            const req = store.get(key);
            req.onsuccess = () => {
                beforeValue = req.result ?? null;
                changed = !sameRecord(beforeValue, value);
                action = beforeValue ? 'update' : 'add';
                if (changed) write();
            };
            req.onerror = (event) => { try { event.preventDefault(); event.stopPropagation(); } catch {} beforeValue = null; changed = true; action = 'add'; write(); };
        } else write();
        tx.oncomplete = () => {
            resolve();
            if (notifySync && changed) setTimeout(() => {
                adjustCachedQueryMetadata(storeName, beforeValue, storedValue, action);
                scheduleCloudCapture(storeName, storedValue);
                broadcastStoreUpdated(storeName);
                try {
                    window.dispatchEvent(new CustomEvent('oscar:db-mutation', { detail: {
                        action, storeName, value: storedValue, before: beforeValue, at: new Date().toISOString()
                    } }));
                } catch {}
            }, 0);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error(`تعذر حفظ ${storeName}`));
    });
}
export async function deleteFromStore(storeName, key, notifySync = true) {
    if(notifySync&&FISCAL_LOCKED_STORES.has(storeName))await assertOpenFinancialRecord(await getFromStore(storeName,key));
    const db = await openDB();
    let beforeValue = null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (notifySync) {
            const req = store.get(key);
            req.onsuccess = () => { beforeValue = req.result ?? null; store.delete(key); };
            req.onerror = (event) => { try { event.preventDefault(); event.stopPropagation(); } catch {} store.delete(key); };
        } else store.delete(key);
        tx.oncomplete = () => {
            resolve();
            if (notifySync) setTimeout(() => {
                adjustCachedQueryMetadata(storeName, beforeValue, null, 'delete');
                scheduleCloudCapture(storeName, null, { deleted: true, key });
                broadcastStoreUpdated(storeName);
                try {
                    window.dispatchEvent(new CustomEvent('oscar:db-mutation', { detail: {
                        action: 'delete', storeName, value: beforeValue, before: beforeValue, key, at: new Date().toISOString()
                    } }));
                } catch {}
            }, 0);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error(`تعذر حذف ${storeName}`));
    });
}
export async function clearStore(storeName, notifySync = true) {
    const existing = notifySync ? await getAllFromStore(storeName).catch(() => []) : [];
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => {
            resolve();
            if (notifySync) setTimeout(() => {
                existing.forEach(v => scheduleCloudCapture(storeName, null, { deleted:true, key: storeName === 'stock' ? [v.productId, v.warehouseId] : (storeName === 'settings' ? v.key : v.id) }));
                broadcastStoreUpdated(storeName);
            }, 0);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error(`تعذر مسح ${storeName}`));
    });
}
// Bulk put items
export async function bulkPut(storeName, items, notifySync = true) {
    if(notifySync&&FISCAL_LOCKED_STORES.has(storeName))for(const item of items||[])await assertOpenFinancialRecord(await getFromStore(storeName,recordKey(storeName,item))||item);
    const rows = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!rows.length) return;
    const db = await openDB();
    const changedItems = [];
    const stamp = new Date().toISOString();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const putChanged = (item) => {
            const stored = (storeName === 'stock' && notifySync && item && typeof item === 'object') ? { ...item, updatedAt: stamp } : item;
            changedItems.push(stored);
            store.put(stored);
        };
        if (!notifySync) rows.forEach(item => store.put(item));
        else rows.forEach(item => {
            const req = store.get(recordKey(storeName, item));
            req.onsuccess = () => { if (!sameRecord(req.result, item)) putChanged(item); };
            req.onerror = (event) => { try { event.preventDefault(); event.stopPropagation(); } catch {} putChanged(item); };
        });
        tx.oncomplete = () => {
            resolve();
            if (notifySync && changedItems.length) setTimeout(() => {
                changedItems.forEach(item => scheduleCloudCapture(storeName, item));
                broadcastStoreUpdated(storeName);
                try {
                    if (changedItems.length <= 25) changedItems.forEach(item => window.dispatchEvent(new CustomEvent('oscar:db-mutation', { detail: { action:'update', storeName, value:item, before:null, bulk:true, at:new Date().toISOString() } })));
                } catch {}
            }, 0);
        };
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error(`تعذر حفظ مجموعة ${storeName}`));
    });
}
// Initial default settings
export const DEFAULT_SETTINGS = {
    storeName: 'كاش توب 3',
    subtitle: 'نظام محاسبة وكاشير',
    phone: '0599-123456',
    address: 'فلسطين - الشارع العام',
    taxNumber: '300987654',
    currency: 'ILS',
    currencySymbol: '₪',
    taxRate: 0,
    theme: 'light',
    printerWidth: '80mm',
    autoPrintReceipt: true,
    printOnSave: true,
    scaleModeEnabled: false,
    receiptShowLogo: true,
    receiptShowStoreInfo: true,
    receiptShowBarcode: true,
    scannerBeepEnabled: true,
    expenseCategories: ['نثريات وضيافة','كهرباء ومياه','إيجار المحل','أجور ورواتب عمال','صيانة ونظافة','بضائع تالفة ومنتهية','أكياس وتغليف وطباعة','نقل وشحن','أخرى'],
    isRestaurantModeEnabled: false,
    restaurantModeDefaultInitialized: true,
    autoPrintKitchenTicket: false,
    kitchenTicketWidth: '80mm',
    kitchenTicketShowPrices: false,
    targetPrepTimeMinutes: 15,
    tableAfterPayment: 'available',
    enableKitchenSoundAlerts: true,
    allowNegativeStock: false,
    warnSellingBelowCost: true,
    receiptFooterMessage: 'شكراً لاستخدام كاش توب 3 - نسعد بخدمتكم دائماً',
    barcodePrefix: '21',
    telegramBotToken: '',
    telegramChatIds: '',
    p2pPaymentChatId: '',
    p2pPaymentMethods: [],
    p2pMethodsManualOnlyV53Initialized: true,
    telegramDailyReportEnabled: false,
    telegramDailyBackupEnabled: true,
    telegramBackupDefaultV45Initialized: true,
    dismissedNotificationIds: [],
    telegramEnabled: true,
    telegramBotUsername: 'Oskarteaam_bot',
    telegramBotUrl: 'http://t.me/Oskarteaam_bot',
    telegramInvoiceNotifications: true,
    telegramPurchaseNotifications: true,
    telegramReturnNotifications: true,
    telegramNotifyCustomers: true,
    telegramNotifySuppliers: true,
    telegramNotifyVouchers: true,
    telegramNotifyExpenses: true,
    telegramNotifyTransfers: true,
    telegramNotifyAccounts: true,
    telegramNotifyProducts: true,
    telegramNotifyInventory: true,
    telegramNotifyWarehouses: true,
    telegramNotifyEmployees: true,
    telegramNotifyShifts: true,
    telegramNotifyHeldInvoices: true,
    telegramNotifyRestaurant: true,
    telegramNotifyAuditLogs: true,
    telegramAutoReportEnabled: true,
    telegramReportIntervalHours: 24,
    telegramSendImages: true,
    telegramRecipients: [],
    activeWarehouseId: 'wh-main',
    activeBranchName: 'الفرع الرئيسي',
    financialYears: [],
    activeFinancialYearId: '',
    financialYearInitializedV48: false,
};
// Initial Warehouses
export const DEFAULT_WAREHOUSES = [
    { id: 'wh-main', name: 'صالة العرض', code: 'SHOWROOM', isDefault: true },
    { id: 'wh-shop', name: 'المخزن الإضافي', code: 'WH-2', isDefault: false },
];
// Initial Categories
export const DEFAULT_CATEGORIES = [
    { id: 'cat-drinks', name: 'مشروبات وعصائر', color: '#0284c7', displayOrder: 1 },
    { id: 'cat-dairy', name: 'ألبان وأجبان', color: '#16a34a', displayOrder: 2 },
    { id: 'cat-food', name: 'مواد غذائية وتموين', color: '#d97706', displayOrder: 3 },
    { id: 'cat-sweets', name: 'حلويات وشوكولاتة', color: '#db2777', displayOrder: 4 },
    { id: 'cat-cleaners', name: 'منظفات وعناية', color: '#7c3aed', displayOrder: 5 },
    { id: 'cat-frozen', name: 'مجمدات ولحوم', color: '#2563eb', displayOrder: 6 },
    { id: 'cat-bakery', name: 'مخبوزات وطحين', color: '#b45309', displayOrder: 7 },
];
// Initial Financial Accounts
export const DEFAULT_ACCOUNTS = [
    { id: 'acc-cash', name: 'الصندوق الرئيسي (الكاش)', type: 'cash', balance: 1500, isDefault: true },
    { id: 'acc-bank', name: 'حساب البنك (فلسطين/العربي)', type: 'bank', balance: 12000, accountNumber: 'PS-1234-5678', isDefault: false },
    { id: 'acc-wallet', name: 'المحفظة الإلكترونية (Jawwal Pay / PalPay)', type: 'wallet', balance: 850, isDefault: false },
    { id: 'acc-card', name: 'جهاز نقاط البيع (فيزا / ماستركارد)', type: 'card', balance: 2400, isDefault: false },
];
// Initial Demo Products demonstrating the Multi-level Unit Tree
export function getDemoProducts() {
    // 1. Mineral water with full 4-level tree: مشطاح -> كرتونة -> باكيت -> حبة
    const waterUnits = calculateUnitConversions([
        {
            id: 'u-water-piece',
            name: 'حبة',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['625100100101'],
            salePrice: 1.5,
            wholesalePrice: 1.2,
            costPrice: 0.9,
            isDefaultSale: true,
        },
        {
            id: 'u-water-pack',
            name: 'باكيت (6 حبات)',
            childUnitId: 'u-water-piece',
            multiplier: 6,
            conversionToBase: 6,
            barcodes: ['625100100106'],
            salePrice: 8.0,
            wholesalePrice: 7.0,
            costPrice: 5.4,
        },
        {
            id: 'u-water-carton',
            name: 'كرتونة (12 باكيت)',
            childUnitId: 'u-water-pack',
            multiplier: 12,
            conversionToBase: 72,
            barcodes: ['625100100112'],
            salePrice: 90.0,
            wholesalePrice: 80.0,
            costPrice: 64.8,
        },
        {
            id: 'u-water-pallet',
            name: 'مشطاح (50 كرتونة)',
            childUnitId: 'u-water-carton',
            multiplier: 50,
            conversionToBase: 3600,
            barcodes: ['625100100150'],
            salePrice: 4200.0,
            wholesalePrice: 3900.0,
            costPrice: 3240.0,
        },
    ], 'u-water-piece');
    // 2. Coca Cola 330ml Can: كرتونة -> درزن -> حبة
    const colaUnits = calculateUnitConversions([
        {
            id: 'u-cola-piece',
            name: 'حبة',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['5449000000996'],
            salePrice: 2.5,
            wholesalePrice: 2.1,
            costPrice: 1.75,
            isDefaultSale: true,
        },
        {
            id: 'u-cola-dozen',
            name: 'درزن (12 حبة)',
            childUnitId: 'u-cola-piece',
            multiplier: 12,
            conversionToBase: 12,
            barcodes: ['5449000000128'],
            salePrice: 28.0,
            wholesalePrice: 24.0,
            costPrice: 21.0,
        },
        {
            id: 'u-cola-carton',
            name: 'كرتونة (24 حبة)',
            childUnitId: 'u-cola-dozen',
            multiplier: 2,
            conversionToBase: 24,
            barcodes: ['5449000000241'],
            salePrice: 54.0,
            wholesalePrice: 48.0,
            costPrice: 42.0,
        },
    ], 'u-cola-piece');
    // 3. Rice (Sugar / Grains): شوال كبير -> كيس 5 كجم -> كيس 1 كجم
    const riceUnits = calculateUnitConversions([
        {
            id: 'u-rice-1kg',
            name: 'كيس 1 كجم',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['625200300101'],
            salePrice: 7.0,
            wholesalePrice: 6.0,
            costPrice: 5.0,
            isDefaultSale: true,
        },
        {
            id: 'u-rice-5kg',
            name: 'كيس 5 كجم',
            childUnitId: 'u-rice-1kg',
            multiplier: 5,
            conversionToBase: 5,
            barcodes: ['625200300105'],
            salePrice: 32.0,
            wholesalePrice: 28.0,
            costPrice: 24.0,
        },
        {
            id: 'u-rice-sack',
            name: 'شوال (25 كجم)',
            childUnitId: 'u-rice-5kg',
            multiplier: 5,
            conversionToBase: 25,
            barcodes: ['625200300125'],
            salePrice: 150.0,
            wholesalePrice: 135.0,
            costPrice: 115.0,
        },
    ], 'u-rice-1kg');
    // 4. Fresh Milk 1L: كرتونة -> حبة
    const milkUnits = calculateUnitConversions([
        {
            id: 'u-milk-piece',
            name: 'حبة',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['625300400101'],
            salePrice: 6.0,
            wholesalePrice: 5.4,
            costPrice: 4.8,
            isDefaultSale: true,
        },
        {
            id: 'u-milk-carton',
            name: 'كرتونة (12 حبة)',
            childUnitId: 'u-milk-piece',
            multiplier: 12,
            conversionToBase: 12,
            barcodes: ['625300400112'],
            salePrice: 68.0,
            wholesalePrice: 62.0,
            costPrice: 57.6,
        },
    ], 'u-milk-piece');
    // 5. Chocolate Biscuit: كرتونة -> باكيت -> حبة
    const biscuitUnits = calculateUnitConversions([
        {
            id: 'u-bisc-piece',
            name: 'حبة',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['625400500101'],
            salePrice: 1.0,
            wholesalePrice: 0.8,
            costPrice: 0.65,
            isDefaultSale: true,
        },
        {
            id: 'u-bisc-pack',
            name: 'باكيت (12 حبة)',
            childUnitId: 'u-bisc-piece',
            multiplier: 12,
            conversionToBase: 12,
            barcodes: ['625400500112'],
            salePrice: 10.0,
            wholesalePrice: 8.5,
            costPrice: 7.5,
        },
        {
            id: 'u-bisc-carton',
            name: 'كرتونة (6 باكيت)',
            childUnitId: 'u-bisc-pack',
            multiplier: 6,
            conversionToBase: 72,
            barcodes: ['625400500172'],
            salePrice: 55.0,
            wholesalePrice: 48.0,
            costPrice: 43.0,
        },
    ], 'u-bisc-piece');
    // 6. Ariel Washing Powder: كرتونة -> كيس
    const arielUnits = calculateUnitConversions([
        {
            id: 'u-ariel-bag',
            name: 'كيس 2.5 كجم',
            childUnitId: null,
            multiplier: 1,
            conversionToBase: 1,
            barcodes: ['625500600101'],
            salePrice: 28.0,
            wholesalePrice: 25.0,
            costPrice: 22.0,
            isDefaultSale: true,
        },
        {
            id: 'u-ariel-carton',
            name: 'كرتونة (4 أكياس)',
            childUnitId: 'u-ariel-bag',
            multiplier: 4,
            conversionToBase: 4,
            barcodes: ['625500600104'],
            salePrice: 105.0,
            wholesalePrice: 95.0,
            costPrice: 86.0,
        },
    ], 'u-ariel-bag');
    return [
        {
            id: 'prod-water',
            name: 'مياه معدنية أروى 500 مل',
            shortName: 'مياه أروى',
            sku: 'WAT-500',
            internalCode: '1001',
            categoryId: 'cat-drinks',
            brand: 'أروى Arwa',
            costPrice: 0.9,
            sellingPrice: 1.5,
            reorderPoint: 200,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-water-piece',
            baseUnitName: 'حبة',
            units: waterUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'prod-cola',
            name: 'كوكاكولا علب 330 مل',
            shortName: 'كولا علب',
            sku: 'COLA-330',
            internalCode: '1002',
            categoryId: 'cat-drinks',
            brand: 'Coca-Cola',
            costPrice: 1.75,
            sellingPrice: 2.5,
            reorderPoint: 100,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-cola-piece',
            baseUnitName: 'حبة',
            units: colaUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'prod-rice',
            name: 'أرز صنوايت كالروز ممتاز',
            shortName: 'أرز صنوايت',
            sku: 'RICE-SUN',
            internalCode: '1003',
            categoryId: 'cat-food',
            brand: 'Sunwhite',
            costPrice: 5.0,
            sellingPrice: 7.0,
            reorderPoint: 50,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-rice-1kg',
            baseUnitName: 'كيس 1 كجم',
            units: riceUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'prod-milk',
            name: 'حليب الجنيدي طازج 1 لتر',
            shortName: 'حليب الجنيدي',
            sku: 'MILK-JND',
            internalCode: '1004',
            categoryId: 'cat-dairy',
            brand: 'الجنيدي',
            costPrice: 4.8,
            sellingPrice: 6.0,
            reorderPoint: 36,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-milk-piece',
            baseUnitName: 'حبة',
            units: milkUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'prod-bisc',
            name: 'بسكويت أوريو شوكولاتة الأصلي',
            shortName: 'أوريو',
            sku: 'OREO-CHOC',
            internalCode: '1005',
            categoryId: 'cat-sweets',
            brand: 'Oreo',
            costPrice: 0.65,
            sellingPrice: 1.0,
            reorderPoint: 120,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-bisc-piece',
            baseUnitName: 'حبة',
            units: biscuitUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        {
            id: 'prod-ariel',
            name: 'مسحوق غسيل أوتوماتيك أريال 2.5 كجم',
            shortName: 'أريال 2.5 كجم',
            sku: 'ARL-25',
            internalCode: '1006',
            categoryId: 'cat-cleaners',
            brand: 'Ariel',
            costPrice: 22.0,
            sellingPrice: 28.0,
            reorderPoint: 20,
            taxRate: 0,
            status: 'active',
            baseUnitId: 'u-ariel-bag',
            baseUnitName: 'كيس 2.5 كجم',
            units: arielUnits,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
    ];
}
// Initial stock per warehouse
export function getDemoStock() {
    return [
        { productId: 'prod-water', warehouseId: 'wh-main', baseQuantity: 3780 }, // 1 مشطاح + 2 كرتونة + 6 باكيت
        { productId: 'prod-water', warehouseId: 'wh-shop', baseQuantity: 144 }, // 2 كرتونة
        { productId: 'prod-cola', warehouseId: 'wh-main', baseQuantity: 480 }, // 20 كرتونة
        { productId: 'prod-cola', warehouseId: 'wh-shop', baseQuantity: 72 }, // 3 كرتونة
        { productId: 'prod-rice', warehouseId: 'wh-main', baseQuantity: 250 }, // 10 شوالات
        { productId: 'prod-rice', warehouseId: 'wh-shop', baseQuantity: 25 }, // 5 أكياس 5 كجم
        { productId: 'prod-milk', warehouseId: 'wh-main', baseQuantity: 120 }, // 10 كراتين
        { productId: 'prod-milk', warehouseId: 'wh-shop', baseQuantity: 24 }, // 2 كرتونة
        { productId: 'prod-bisc', warehouseId: 'wh-main', baseQuantity: 720 }, // 10 كراتين
        { productId: 'prod-bisc', warehouseId: 'wh-shop', baseQuantity: 144 }, // 2 كرتونة
        { productId: 'prod-ariel', warehouseId: 'wh-main', baseQuantity: 60 }, // 15 كرتونة
        { productId: 'prod-ariel', warehouseId: 'wh-shop', baseQuantity: 12 }, // 3 كراتين
    ];
}
// Virtual cash customer used only inside the POS. It is never stored in the customers table.
export const CASH_CUSTOMER = Object.freeze({
    id: 'cust-walkin',
    name: 'عميل نقدي',
    phone: '',
    address: '',
    balance: 0,
    priceList: 'retail',
    isVirtual: true,
});
// Initial Demo Customers (registered customers only)
export const DEFAULT_CUSTOMERS = [
    {
        id: 'cust-1',
        name: 'أحمد محمود القواسمي',
        phone: '0599-223344',
        whatsapp: '0599223344',
        address: 'الشارع الرئيسي - عمارة الأمل',
        balance: 450.0, // له دين سابق
        creditLimit: 1500,
        priceList: 'retail',
        notes: 'زبون دائم يسدد نهاية كل شهر',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'cust-2',
        name: 'كافتيريا السلام (جملة)',
        phone: '0568-778899',
        address: 'شارع الجامعة',
        balance: 1200.0,
        creditLimit: 3000,
        priceList: 'wholesale',
        notes: 'يشتري بالكرتونة أسبوعياً',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'cust-3',
        name: 'مها إبراهيم عودة',
        phone: '0598-112233',
        address: 'حي الزيتون',
        balance: 0,
        creditLimit: 500,
        priceList: 'retail',
        createdAt: new Date().toISOString(),
    },
];
// Initial Demo Suppliers
export const DEFAULT_SUPPLIERS = [
    {
        id: 'supp-1',
        name: 'شركة المشروبات الوطنية (كوكاكولا وكابي)',
        phone: '02-2987654',
        address: 'بيتونيا - المنطقة الصناعية',
        companyName: 'المشروبات الوطنية كوكاكولا',
        balance: 3450.0, // نحن مدينون لهم
        notes: 'توريد كل ثلاثاء وخميس',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'supp-2',
        name: 'شركة الجنيدي للألبان والصناعات الغذائية',
        phone: '02-2228899',
        address: 'الخليل - عين سارة',
        companyName: 'الجنيدي',
        balance: 1800.0,
        notes: 'توريد يومي للألبان الطازجة',
        createdAt: new Date().toISOString(),
    },
    {
        id: 'supp-3',
        name: 'شركة الأمل للتجارة العامة والتوزيع',
        phone: '0599-880011',
        address: 'رام الله',
        companyName: 'الأمل للمواد الغذائية',
        balance: 0,
        notes: 'وكيل أرز صنوايت وزيوت',
        createdAt: new Date().toISOString(),
    },
];
// Initial Shift
export const DEFAULT_SHIFT = {
    id: 'shift-1',
    shiftNumber: 1,
    cashierId: 'usr-cashier-1',
    cashierName: 'أبو أحمد (الكاشير الأول)',
    startTime: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    openingCash: 500.0,
    totalCashSales: 1250.0,
    totalOtherSales: 450.0,
    totalCashReturns: 0,
    totalCashExpenses: 50.0,
    expectedCash: 1700.0,
    status: 'open',
};
// Initial Employees
export const DEFAULT_EMPLOYEES = [
    {
        id: 'emp-admin',
        name: 'أحمد القواسمي (المدير العام)',
        phone: '0599-112233',
        role: 'admin',
        roleName: 'مدير عام',
        pin: '1234',
        active: true,
        permissions: {
            canDiscount: true,
            canEditPrice: true,
            canDeleteInvoice: true,
            canDeleteProducts: true,
            canManagePurchases: true,
            canManageVouchers: true,
            canManageInventory: true,
            canViewReports: true,
            canAccessSettings: true,
            canAccessCashier: true,
            canAccessDashboard: true,
            canAccessSales: true,
            canAccessPurchases: true,
            canAccessVouchers: true,
            canAccessEmployees: true,
            canAccessProducts: true,
            canAccessCategories: true,
            canAccessInventory: true,
            canAccessCustomers: true,
            canAccessSuppliers: true,
            canAccessAccounts: true,
            canAccessExpenses: true,
            canAccessBarcodes: true,
            canAccessReports: true,
            canAccessTrash: true,
            canAccessAI: true,
            canAccessRestaurantTables: true,
            canAccessRestaurantWaiter: true,
            canAccessRestaurantKitchen: true,
            canAccessRestaurantOrders: true,
            canAccessRestaurantWaste: true,
        },
        createdAt: new Date().toISOString(),
    },
    {
        id: 'emp-cashier-1',
        name: 'محمود ناصر (كاشير أول)',
        phone: '0599-445566',
        role: 'cashier',
        roleName: 'كاشير',
        pin: '1111',
        active: true,
        permissions: {
            canDiscount: true,
            canEditPrice: false,
            canDeleteInvoice: false,
            canDeleteProducts: false,
            canManagePurchases: false,
            canManageVouchers: true,
            canManageInventory: false,
            canViewReports: false,
            canAccessSettings: false,
            canAccessCashier: true,
            canAccessDashboard: false,
            canAccessSales: true,
            canAccessPurchases: false,
            canAccessVouchers: false,
            canAccessEmployees: false,
            canAccessProducts: false,
            canAccessCategories: false,
            canAccessInventory: false,
            canAccessCustomers: true,
            canAccessSuppliers: false,
            canAccessAccounts: false,
            canAccessExpenses: false,
            canAccessBarcodes: false,
            canAccessReports: false,
            canAccessTrash: false,
            canAccessAI: false,
            canAccessRestaurantTables: false,
            canAccessRestaurantWaiter: false,
            canAccessRestaurantKitchen: false,
            canAccessRestaurantOrders: false,
            canAccessRestaurantWaste: false,
        },
        createdAt: new Date().toISOString(),
    },
    {
        id: 'emp-accountant',
        name: 'سارة رضوان (محاسبة مالية)',
        phone: '0599-778899',
        role: 'accountant',
        roleName: 'محاسب',
        pin: '2222',
        active: true,
        permissions: {
            canDiscount: false,
            canEditPrice: false,
            canDeleteInvoice: true,
            canDeleteProducts: false,
            canManagePurchases: true,
            canManageVouchers: true,
            canManageInventory: true,
            canViewReports: true,
            canAccessSettings: false,
            canAccessCashier: false,
            canAccessDashboard: true,
            canAccessSales: true,
            canAccessPurchases: true,
            canAccessVouchers: true,
            canAccessEmployees: false,
            canAccessProducts: false,
            canAccessCategories: false,
            canAccessInventory: true,
            canAccessCustomers: true,
            canAccessSuppliers: true,
            canAccessAccounts: true,
            canAccessExpenses: true,
            canAccessBarcodes: false,
            canAccessReports: true,
            canAccessTrash: false,
            canAccessAI: false,
            canAccessRestaurantTables: false,
            canAccessRestaurantWaiter: false,
            canAccessRestaurantKitchen: false,
            canAccessRestaurantOrders: false,
            canAccessRestaurantWaste: false,
        },
        createdAt: new Date().toISOString(),
    },
];
// Initial Vouchers
export const DEFAULT_VOUCHERS = [
    {
        id: 'vouch-1',
        voucherNumber: 101,
        type: 'receipt',
        partyType: 'customer',
        partyId: 'cust-1',
        partyName: 'أحمد محمود القواسمي',
        amount: 150.0,
        date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        sourceType: 'account',
        accountId: 'acc-cash',
        accountName: 'الصندوق النقدي الرئيسي (الكاشير)',
        notes: 'دفعة نقدية تحت الحساب',
        userId: 'emp-admin',
        userName: 'أحمد القواسمي',
        createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    },
    {
        id: 'vouch-2',
        voucherNumber: 102,
        type: 'payment',
        partyType: 'supplier',
        partyId: 'supp-1',
        partyName: 'شركة المشروبات الوطنية كوكاكولا كابي',
        amount: 500.0,
        date: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        sourceType: 'account',
        accountId: 'acc-cash',
        accountName: 'الصندوق النقدي الرئيسي (الكاشير)',
        notes: 'سداد دفعة نقدية من حساب توريد سابق',
        userId: 'emp-admin',
        userName: 'أحمد القواسمي',
        createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    },
];
export async function ensurePrimaryShowroomWarehouse() {
    try {
        const rows = await getAllFromStore('warehouses');
        if (!Array.isArray(rows) || !rows.length) return false;
        const main = rows.find(w => w?.id === 'wh-main') || rows.find(w => w?.isDefault) || rows.find(w => /صالة\s*العرض/.test(String(w?.name || '')));
        if (!main) return false;
        const oldDefaultNames = new Set(['المخزن الرئيسي','المستودع الرئيسي','واجهة المحل (الرفوف)']);
        const next = rows.map(w => ({
            ...w,
            isDefault: w.id === main.id,
            ...(w.id === main.id && (w.id === 'wh-main' || oldDefaultNames.has(String(w.name || ''))) ? { name: 'صالة العرض', code: 'SHOWROOM' } : {})
        }));
        await bulkPut('warehouses', next, false);
        const settings = await getFromStore('settings', 'store_config');
        if (settings && settings.activeWarehouseId !== main.id) await putInStore('settings', { ...settings, activeWarehouseId: main.id }, false);
        return true;
    } catch { return false; }
}

// Seed a NEW company with production-safe empty data only.
// Never inject demo products/customers/suppliers/stock into a real activation key.
export async function seedDatabaseDefaults() {
    const settings = await getFromStore('settings', 'store_config');
    const rt = window.OscarActivation?.readRuntime?.() || {};
    const companyId = String(rt.companyId || '').trim();
    const companyName = String(rt.companyName || '').trim();
    const trialProfile = rt.plan === 'trial' && rt.trialProfile && typeof rt.trialProfile === 'object' ? rt.trialProfile : null;
    if (settings) {
        if (trialProfile) {
            const profileLogo = String(trialProfile.logo || '').trim();
            const next = {
                ...settings,
                ...(!String(settings.storeName || '').trim() && trialProfile.companyName ? { storeName: String(trialProfile.companyName) } : {}),
                ...(!String(settings.address || '').trim() && trialProfile.address ? { address: String(trialProfile.address) } : {}),
                ...(!String(settings.phone || '').trim() && trialProfile.phone ? { phone: String(trialProfile.phone) } : {}),
                ...(!String(settings.currency || '').trim() && trialProfile.currency ? { currency: String(trialProfile.currency) } : {}),
                ...(!String(settings.currencySymbol || '').trim() && trialProfile.currencySymbol ? { currencySymbol: String(trialProfile.currencySymbol) } : {}),
                ...(!String(settings.logoUrl || '').trim() && !String(settings.logoSourceUrl || '').trim() && profileLogo ? { logoUrl: profileLogo, logoSourceUrl: '' } : {}),
            };
            if (JSON.stringify(next) !== JSON.stringify(settings)) {
                await putInStore('settings', next);
                return true;
            }
        }
        return false;
    }
    await putInStore('settings', {
        key: 'store_config',
        ...DEFAULT_SETTINGS,
        ...(companyName ? { storeName: companyName } : {}),
        ...(trialProfile ? {
            storeName: String(trialProfile.companyName || companyName || DEFAULT_SETTINGS.storeName),
            address: String(trialProfile.address || ''),
            phone: String(trialProfile.phone || ''),
            currency: String(trialProfile.currency || DEFAULT_SETTINGS.currency),
            currencySymbol: String(trialProfile.currencySymbol || DEFAULT_SETTINGS.currencySymbol),
            logoUrl: String(trialProfile.logo || ''),
            logoSourceUrl: '',
            activeWarehouseId: 'wh-main',
            activeBranchName: 'الفرع الرئيسي',
        } : {}),
        tenantId: companyId,
        seedMode: trialProfile ? 'trial-empty' : 'production-empty',
    });
    await bulkPut('warehouses', [{ ...DEFAULT_WAREHOUSES[0], isDefault: true }]);
    await bulkPut('accounts', [{ ...DEFAULT_ACCOUNTS[0], balance: 0, isDefault: true }]);
    const account = rt.account || null;
    if (account?.id) {
        await putInStore('employees', {
            ...account,
            id: account.id,
            name: account.name || account.displayName || 'مدير النظام',
            displayName: account.displayName || account.name || 'مدير النظام',
            role: account.role || (rt.type === 'company-manager' ? 'admin' : 'custom'),
            roleName: account.roleName || account.role || (rt.type === 'company-manager' ? 'مدير النظام' : 'موظف'),
            active: account.active !== false,
            system: account.system !== false,
            permissions: account.permissions ?? rt.permissions ?? {},
            createdAt: account.createdAt || new Date().toISOString(),
        });
    }
    await putInStore('audit_logs', {
        id: `log-init-${companyId || Date.now()}`,
        timestamp: new Date().toISOString(),
        userId: account?.id || 'system',
        userName: account?.name || account?.displayName || 'مدير النظام',
        action: 'تهيئة النظام',
        targetType: 'SYSTEM',
        targetId: 'initial_setup',
        details: 'تم بدء قاعدة شركة جديدة فارغة بدون بيانات تجريبية.',
    });
    return true;
}

// Older builds seeded six demo products and sample customers/suppliers into every new key.
// Remove that exact untouched demo pack only when the tenant has no real business activity.
// User-entered data is never cleared or overwritten.
export async function cleanupLegacyDemoSeedIfPristine() {
    try {
        const demoProductIds = ['prod-water','prod-cola','prod-rice','prod-milk','prod-bisc','prod-ariel'];
        const demoCustomerIds = ['cust-1','cust-2','cust-3'];
        const demoSupplierIds = ['supp-1','supp-2','supp-3'];
        const demoVoucherIds = ['vouch-1','vouch-2'];

        // Startup safety: counts are enough to detect real activity. Never deserialize
        // entire invoice/purchase/movement histories just to check the legacy demo seed.
        const activityStores = ['invoices','purchases','stock_movements','transfers','expenses','partner_statements'];
        const activityCounts = await Promise.all(activityStores.map((name) => countStoreRecords(name)));
        if (activityCounts.some((count) => count > 0)) return false;

        const [productCount, customerCount, supplierCount, voucherCount, demoProducts, demoCustomers, demoSuppliers, demoVouchers] = await Promise.all([
            countStoreRecords('products'), countStoreRecords('customers'), countStoreRecords('suppliers'), countStoreRecords('vouchers'),
            Promise.all(demoProductIds.map((id) => getFromStore('products', id))),
            Promise.all(demoCustomerIds.map((id) => getFromStore('customers', id))),
            Promise.all(demoSupplierIds.map((id) => getFromStore('suppliers', id))),
            Promise.all(demoVoucherIds.map((id) => getFromStore('vouchers', id))),
        ]);
        const foundProducts = demoProducts.filter(Boolean);
        const foundCustomers = demoCustomers.filter(Boolean);
        const foundSuppliers = demoSuppliers.filter(Boolean);
        const foundVouchers = demoVouchers.filter(Boolean);
        if (!foundProducts.length || productCount !== foundProducts.length || customerCount !== foundCustomers.length || supplierCount !== foundSuppliers.length || voucherCount !== foundVouchers.length) return false;

        const demoProductSet = new Set(demoProductIds);
        for (const id of demoProductIds) if (await getFromStore('products', id)) await deleteFromStore('products', id);
        const stockRows = await getAllFromStore('stock');
        for (const row of stockRows || []) if (demoProductSet.has(String(row?.productId || ''))) await deleteFromStore('stock', [row.productId, row.warehouseId]);
        for (const id of demoCustomerIds) if (await getFromStore('customers', id)) await deleteFromStore('customers', id);
        for (const id of demoSupplierIds) if (await getFromStore('suppliers', id)) await deleteFromStore('suppliers', id);
        for (const id of demoVoucherIds) if (await getFromStore('vouchers', id)) await deleteFromStore('vouchers', id);

        const categories = await getAllFromStore('categories');
        const demoCategoryIds = new Set(['cat-drinks','cat-dairy','cat-food','cat-sweets','cat-cleaners','cat-frozen','cat-bakery']);
        for (const x of categories || []) if (demoCategoryIds.has(String(x?.id || ''))) await deleteFromStore('categories', x.id);
        const shifts = await getAllFromStore('shifts');
        for (const x of shifts || []) if (String(x?.id || '') === 'shift-1') await deleteFromStore('shifts', x.id);
        const auditInit = await getFromStore('audit_logs', 'log-init');
        if (auditInit) await deleteFromStore('audit_logs', 'log-init');
        const warehouses = await getAllFromStore('warehouses');
        for (const x of warehouses || []) if (String(x?.id || '') === 'wh-shop') await deleteFromStore('warehouses', x.id);

        const accounts = await getAllFromStore('accounts');
        const demoAccountIds = new Set(['acc-cash','acc-bank','acc-wallet','acc-card']);
        const accountsAreDemoOnly = Array.isArray(accounts) && accounts.length > 0 && accounts.every(x => demoAccountIds.has(String(x?.id || '')));
        if (accountsAreDemoOnly) {
            for (const x of accounts) await deleteFromStore('accounts', x.id);
            await putInStore('accounts', { ...DEFAULT_ACCOUNTS[0], balance: 0, isDefault: true });
        }

        const rt = window.OscarActivation?.readRuntime?.() || {};
        const loginAccount = rt.account || null;
        const employees = await getAllFromStore('employees');
        const demoEmployeeIds = new Set(['emp-admin','emp-cashier-1','emp-accountant']);
        for (const x of employees || []) {
            if (demoEmployeeIds.has(String(x?.id || '')) && String(x?.id || '') !== String(loginAccount?.id || '')) await deleteFromStore('employees', x.id);
        }
        if (loginAccount?.id) {
            await putInStore('employees', {
                ...loginAccount,
                id: loginAccount.id,
                name: loginAccount.name || loginAccount.displayName || 'مدير النظام',
                displayName: loginAccount.displayName || loginAccount.name || 'مدير النظام',
                role: loginAccount.role || (rt.type === 'company-manager' ? 'admin' : 'custom'),
                roleName: loginAccount.roleName || loginAccount.role || (rt.type === 'company-manager' ? 'مدير النظام' : 'موظف'),
                active: loginAccount.active !== false,
                system: loginAccount.system !== false,
                permissions: loginAccount.permissions ?? rt.permissions ?? {},
                createdAt: loginAccount.createdAt || new Date().toISOString(),
            });
        }
        const cfg = await getFromStore('settings', 'store_config');
        if (cfg) await putInStore('settings', { ...cfg, tenantId: String(rt.companyId || ''), seedMode: 'production-empty' });
        return true;
    } catch (error) {
        console.warn('Demo seed cleanup skipped:', error);
        return false;
    }
}

// One-time upgrade path: move the data from the old single-company database
// into the first tenant database only when that tenant is still empty.
export async function migrateLegacyDatabaseIfNeeded() {
    // Disabled intentionally. A legacy single-company database has no trustworthy
    // tenant identity, so automatically copying it into a newly created key can
    // mix one company's data into another. Existing tenant databases are untouched.
    return false;
}

export async function initializeDatabase(options = {}) {
    await openDB();
    enablePersistentLocalStorage().catch(() => {});
    if (!options.deferSeed) await seedDatabaseDefaults();
    await ensurePrimaryShowroomWarehouse().catch(() => {});
    return true;
}
// Reset Database to clean state
export async function resetDatabase(withDemo = false) {
    const stores = [
        'products',
        'categories',
        'warehouses',
        'stock',
        'stock_movements',
        'invoices',
        'purchases',
        'customers',
        'suppliers',
        'partner_statements',
        'accounts',
        'transfers',
        'expenses',
        'shifts',
        'audit_logs',
        'held_invoices',
        'sync_queue',
        'settings',
        'vouchers',
        'employees',
        'restaurant_tables',
        'restaurant_sections',
        'restaurant_orders',
        'kitchen_sections',
        'table_reservations',
        'recipes',
        'waste_records',
    ];
    for (const store of stores) {
        await clearStore(store);
    }
    await putInStore('settings', { key: 'store_config', ...DEFAULT_SETTINGS });
    await bulkPut('warehouses', DEFAULT_WAREHOUSES);
    await bulkPut('categories', DEFAULT_CATEGORIES);
    await bulkPut('accounts', DEFAULT_ACCOUNTS);
    // No virtual cash customer is stored in the customers table.
    await bulkPut('employees', DEFAULT_EMPLOYEES);
    if (withDemo) {
        await bulkPut('customers', DEFAULT_CUSTOMERS);
        await bulkPut('suppliers', DEFAULT_SUPPLIERS);
        await bulkPut('products', getDemoProducts());
        await bulkPut('stock', getDemoStock());
        await bulkPut('vouchers', DEFAULT_VOUCHERS);
        await putInStore('shifts', DEFAULT_SHIFT);
    }
    if (syncChannel) {
        syncChannel.postMessage({ type: 'DATABASE_RESET' });
    }
}
// Export database to JSON
export async function exportDatabaseBackup() {
    const data = {};
    const stores = [
        'products',
        'categories',
        'warehouses',
        'stock',
        'stock_movements',
        'invoices',
        'purchases',
        'customers',
        'suppliers',
        'partner_statements',
        'accounts',
        'transfers',
        'expenses',
        'shifts',
        'audit_logs',
        'settings',
        'vouchers',
        'employees',
        'restaurant_tables',
        'restaurant_sections',
        'restaurant_orders',
        'kitchen_sections',
        'table_reservations',
        'recipes',
        'waste_records',
    ];
    for (const store of stores) {
        data[store] = await getAllFromStore(store);
    }
    return JSON.stringify(data, null, 2);
}
// Import database from JSON
export async function importDatabaseBackup(jsonString) {
    const data = JSON.parse(jsonString);
    for (const store in data) {
        if (Array.isArray(data[store])) {
            await clearStore(store);
            await bulkPut(store, data[store]);
        }
    }
    if (syncChannel) {
        syncChannel.postMessage({ type: 'DATABASE_RESET' });
    }
}
export const db = {
    exportCompleteBackup: async () => {
        const jsonStr = await exportDatabaseBackup();
        return JSON.parse(jsonStr);
    },
    importBackup: async (data) => {
        const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
        await importDatabaseBackup(jsonStr);
    },
    resetToSeedData: async () => {
        await resetDatabase();
    },
};

export async function assertOpenFinancialRecord(row){
 if(!row)return;
 const config=await getFromStore('settings','store_config')||{};
 const years=config.financialYears||[];const yearId=row.financialYearId||years[0]?.id||config.activeFinancialYearId;
 if(row.financialYearArchivedAt||years.some(y=>y.id===yearId&&y.status==='closed'))throw Error('المجموعة المالية مؤرشفة: السجل للقراءة فقط');
}

const FISCAL_LOCKED_STORES=new Set(['invoices','purchases','vouchers','expenses','stock_movements','transfers','audit_logs','partner_statements','shifts','held_invoices','waste_records','restaurant_orders']);
