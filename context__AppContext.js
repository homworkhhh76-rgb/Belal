import {buildFinancialClose,fiscalStores,fiscalMasters} from './services__financialClose.js?v=7.9.4.136-localization';
import {buildCartReturn} from './services__cartReturn.js?v=7.9.4.136-localization';
import { jsx as _jsx } from "react/jsx-runtime";
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { assertOpenFinancialRecord, getAllFromStore, getFromStore, putInStore, deleteFromStore, clearStore, bulkPut, commitLocalBatch, queryStorePage, queryAllStoreRecords, queryStoreStats, getLatestStockMovementLocal, initializeDatabase, seedDatabaseDefaults, cleanupLegacyDemoSeedIfPristine, ensurePrimaryShowroomWarehouse, resetDatabase, exportDatabaseBackup, importDatabaseBackup, syncChannel, DEFAULT_SETTINGS, CASH_CUSTOMER, DEFAULT_CATEGORIES, DEFAULT_WAREHOUSES, DEFAULT_ACCOUNTS, DEFAULT_SUPPLIERS, getDemoProducts, getDemoStock, DEFAULT_EMPLOYEES, } from './services__db.js?v=7.9.4.136-localization';
import { calculateUnitConversions, findUnitByBarcode, toBaseQuantity } from './utils__unitTree.js?v=7.9.4.136-localization';
import { playBeepSound, playSuccessSound, playErrorSound } from './services__audio.js?v=7.9.4.136-localization';
import { notifyTelegramInvoice } from './services__telegram.js?v=7.9.4.136-localization';
import { isManagerAccess, normalizeEmployeePermissions, canAccessTab, firstAllowedTab } from './utils__permissions.js?v=7.9.4.136-localization';
import { isTrialAccount, TRIAL_LIMITS } from './trial__config.js?v=7.9.4.136-localization';
const AppContext = createContext(null);
const recordTime = (item = {}) => {
    const fields = ['createdAt', 'date', 'timestamp', 'startTime', 'updatedAt'];
    for (const field of fields) {
        const value = item?.[field];
        if (!value) continue;
        const t = new Date(value).getTime();
        if (Number.isFinite(t)) return t;
    }
    const idMatch = String(item?.id || '').match(/(\d{10,})/);
    return idMatch ? Number(idMatch[1]) : 0;
};
const newestFirst = (items = []) => [...(items || [])].sort((a, b) => recordTime(b) - recordTime(a));
const normalizeCurrencySettings = (value) => {
    if (!value) return value;
    const currency = String(value.currency || '').trim().toUpperCase();
    const symbol = String(value.currencySymbol || '').trim();
    if (currency && symbol) return value;
    return { ...value, currency: currency || 'ILS', currencySymbol: symbol || '₪' };
};
const normalizeActiveWarehouseSettings = (value, warehouseRows = []) => {
    if (!value) return value;
    const rows = Array.isArray(warehouseRows) ? warehouseRows.filter(Boolean) : [];
    if (!rows.length) return value;
    const wanted = String(value.activeWarehouseId || '');
    if (wanted && rows.some(w => String(w.id) === wanted)) return value;
    const fallback = rows.find(w => w?.isDefault) || rows.find(w => w?.id === 'wh-main') || rows[0];
    return fallback?.id ? { ...value, activeWarehouseId: fallback.id } : value;
};
const finiteNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const normalizeAccountRecord = (account) => {
    if (!account || typeof account !== 'object') return account;
    return { ...account, balance: finiteNumber(account.balance, 0) };
};
const normalizeShiftRecord = (shift) => {
    if (!shift || typeof shift !== 'object') return shift;
    const openingCash = finiteNumber(shift.openingCash, 0);
    const totalCashSales = finiteNumber(shift.totalCashSales, 0);
    const totalOtherSales = finiteNumber(shift.totalOtherSales, 0);
    const totalCashReturns = finiteNumber(shift.totalCashReturns, 0);
    const totalCashExpenses = finiteNumber(shift.totalCashExpenses, 0);
    const expectedCash = Number.isFinite(Number(shift.expectedCash))
        ? Number(shift.expectedCash)
        : openingCash + totalCashSales - totalCashReturns - totalCashExpenses;
    return {
        ...shift,
        shiftNumber: Math.max(0, Math.trunc(finiteNumber(shift.shiftNumber, 0))),
        openingCash,
        totalCashSales,
        totalOtherSales,
        totalCashReturns,
        totalCashExpenses,
        expectedCash,
        actualCash: shift.actualCash == null ? shift.actualCash : finiteNumber(shift.actualCash, 0),
        difference: shift.difference == null ? shift.difference : finiteNumber(shift.difference, 0),
    };
};
// Legacy stock rows did not carry a modification timestamp. Backfill it from the
// latest local stock movement when possible so stale cloud balances cannot win by accident.
const backfillLocalStockMetadata = async () => {
    try {
        const companyId = String(window.OscarActivation?.readRuntime?.()?.companyId || 'local');
        const markerKey = `oscar-stock-meta-backfill-v109::${companyId}`;
        try { if (localStorage.getItem(markerKey) === '1') return false; } catch (_) {}
        // Fast path: most current installs already have updatedAt on every stock row.
        // Avoid reading the entire stock_movements store on every startup.
        const rows = await getAllFromStore('stock');
        if (!Array.isArray(rows) || !rows.length) {
            try { localStorage.setItem(markerKey, '1'); } catch (_) {}
            return false;
        }
        const needsBackfill = rows.some((row) => row && !row.updatedAt);
        if (!needsBackfill) {
            try { localStorage.setItem(markerKey, '1'); } catch (_) {}
            return false;
        }
        const patched = [];
        const legacyRows = rows.filter((row) => row && !row.updatedAt);
        // Never materialize the movement table: read only one newest matching row per
        // legacy stock balance through the compound product/warehouse/date index.
        for (let i = 0; i < legacyRows.length; i += 12) {
            const batch = legacyRows.slice(i, i + 12);
            const resolved = await Promise.all(batch.map(async (row) => ({
                row,
                mov: await getLatestStockMovementLocal(row.productId, row.warehouseId).catch(() => null),
            })));
            for (const { row, mov } of resolved) {
                if (!mov) continue;
                const time = new Date(mov.date || mov.createdAt || 0).getTime();
                if (!Number.isFinite(time) || time <= 0) continue;
                const next = { ...row, updatedAt: new Date(time).toISOString() };
                const movementBalance = Number(mov?.newBaseBalance);
                const rowBalance = Number(row.baseQuantity);
                if (Number.isFinite(movementBalance) && Number.isFinite(rowBalance) && Math.abs(movementBalance - rowBalance) < 0.000001) {
                    next.balanceVerifiedByMovement = true;
                }
                patched.push(next);
            }
        }
        if (patched.length) await bulkPut('stock', patched, false);
        try { localStorage.setItem(markerKey, '1'); } catch (_) {}
        return patched.length > 0;
    } catch (_) { return false; }
};
export const AppProvider = ({ children }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [startupProgress,setStartupProgress]=useState(5);
    const [isCloudReady, setIsCloudReady] = useState(false);
    // Database state
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState([]);
    const [warehouses, setWarehouses] = useState([]);
    const [stock, setStock] = useState([]);
    const [stockMovements, setStockMovements] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [purchases, setPurchases] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [transfers, setTransfers] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [shifts, setShifts] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [heldInvoices, setHeldInvoices] = useState([]);
    const [syncQueue, setSyncQueue] = useState([]);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [partnerStatements, setPartnerStatements] = useState([]);
    const [vouchers, setVouchers] = useState([]);
    const [employees, setEmployees] = useState(DEFAULT_EMPLOYEES);
    const [activeEmployee, setActiveEmployee] = useState(DEFAULT_EMPLOYEES[0]);
    // UI state
    const [activeTab, setActiveTabState] = useState('dashboard');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [posCartLayout, setPosCartLayout] = useState('split');
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState(null);
    // Remote sync is allowed to continue, but visual dataset replacement is postponed
    // while the user is actively editing any field. This prevents disappearing text
    // across settings and all data-entry screens.
    const deferredRemoteStoresRef = useRef(new Set());
    const deferredRemoteTimerRef = useRef(null);
    // Modals state
    const [showThermalModal, setShowThermalModal] = useState(null);
    const [showCameraModal, setShowCameraModal] = useState(false);
    const [showHoldInvoicesModal, setShowHoldInvoicesModal] = useState(false);
    const [showSyncModal, setShowSyncModal] = useState(false);
    // Active cashier user linked to selected activeEmployee
    const currentUser = useMemo(() => {
        const rt = window.OscarActivation?.readRuntime?.();
        const account = rt?.account;
        const sameEmployee = !!account?.id && !!activeEmployee?.id && String(account.id) === String(activeEmployee.id);
        const liveEmployee = sameEmployee ? activeEmployee : null;
        const roleCode = String(liveEmployee?.role || account?.role || activeEmployee?.role || (rt?.type === 'company-manager' ? 'admin' : 'custom')).trim().toLowerCase();
        let permissions = normalizeEmployeePermissions(liveEmployee?.permissions ?? account?.permissions ?? activeEmployee?.permissions ?? {}, roleCode);
        if (rt?.type === 'company-manager') {
            permissions = { ...permissions, canDiscount:true, canEditPrice:true, canDeleteInvoice:true, canDeleteProducts:true, canManagePurchases:true, canManageVouchers:true, canManageInventory:true, canViewReports:true };
        }
        return {
            id: account?.id || activeEmployee?.id || 'emp-admin',
            name: liveEmployee?.name || account?.name || account?.displayName || activeEmployee?.name || 'مدير النظام',
            role: liveEmployee?.roleName || account?.roleName || activeEmployee?.roleName || account?.role || 'موظف',
            roleCode,
            permissions,
            isCompanyManager: rt?.type === 'company-manager',
            companyId: rt?.companyId || '',
            companyName: rt?.companyName || settings.storeName,
        };
    }, [activeEmployee, settings.storeName]);

    const accessArgs = useMemo(() => ({
        currentUser,
        activeEmployee,
        runtime: window.OscarActivation?.readRuntime?.() || null,
        restaurantEnabled: !!settings.isRestaurantModeEnabled,
    }), [currentUser, activeEmployee, settings.isRestaurantModeEnabled]);

    const setActiveTab = useCallback((nextTab) => {
        setActiveTabState(prev => {
            const wanted = typeof nextTab === 'function' ? nextTab(prev) : nextTab;
            if (canAccessTab(wanted, accessArgs)) return wanted;
            return firstAllowedTab(accessArgs) || 'no_access';
        });
    }, [accessArgs]);

    useEffect(() => {
        if (!isLoaded) return;
        if (activeTab === 'no_access') {
            const first = firstAllowedTab(accessArgs);
            if (first) setActiveTabState(first);
            return;
        }
        if (!canAccessTab(activeTab, accessArgs)) {
            setActiveTabState(firstAllowedTab(accessArgs) || 'no_access');
        }
    }, [isLoaded, activeTab, accessArgs]);
    // Cart state
    const [cart, setCart] = useState([]);
    const [invoiceAdditionalCharges, setInvoiceAdditionalCharges] = useState(0);
    const [invoiceDiscountType, setInvoiceDiscountType] = useState('fixed');
    const [invoiceDiscountValue, setInvoiceDiscountValue] = useState(0);
    const [selectedCustomer, setSelectedCustomer] = useState(CASH_CUSTOMER);
    const [editingSaleInvoiceId, setEditingSaleInvoiceId] = useState(null);
    // Toast helper
    const showToast = useCallback((message, type = 'info') => {
        try { window.__OSCAR_ACTION_LOADING__?.stop?.(); } catch (_) {}
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 2600);
    }, []);
    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);
    // Reload all stores from IndexedDB
    const reloadData = useCallback(async () => {
        try {
            const [prods, cats, whs, stk, stkMovs, invs, purchs, custs, supps, accs, trans, exps, shfts, audits, helds, syncs, sett, stmts, vouchs, emps,] = await Promise.all([
                getAllFromStore('products'),
                getAllFromStore('categories'),
                getAllFromStore('warehouses'),
                getAllFromStore('stock'),
                queryStorePage('stock_movements', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items),
                queryStorePage('invoices', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items),
                queryStorePage('purchases', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items),
                getAllFromStore('customers'),
                getAllFromStore('suppliers'),
                getAllFromStore('accounts'),
                queryStorePage('transfers', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items),
                queryStorePage('expenses', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items),
                getAllFromStore('shifts'),
                queryStorePage('audit_logs', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items),
                queryStorePage('held_invoices', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items),
                getAllFromStore('sync_queue'),
                getFromStore('settings', 'store_config'),
                queryStorePage('partner_statements', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items),
                queryStorePage('vouchers', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items),
                getAllFromStore('employees'),
            ]);
            setProducts(newestFirst(prods));
            setCategories((cats || []).sort((a, b) => a.displayOrder - b.displayOrder));
            setWarehouses(whs || []);
            setStock(stk || []);
            setStockMovements((stkMovs || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            setInvoices((invs || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            setPurchases((purchs || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            const registeredCustomers = (custs || []).filter((c) => c && c.id !== CASH_CUSTOMER.id);
            setCustomers(newestFirst(registeredCustomers));
            setSuppliers(newestFirst(supps));
            const normalizedAccounts = (accs || []).map(normalizeAccountRecord);
            const orderedAccounts = newestFirst(normalizedAccounts);
            orderedAccounts.sort((a, b) => Number(Boolean(b?.isDefault)) - Number(Boolean(a?.isDefault)));
            setAccounts(orderedAccounts);
            setTransfers((trans || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            setExpenses((exps || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            const normalizedShifts = (shfts || []).map(normalizeShiftRecord).sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
            setShifts(normalizedShifts);
            // Fresh GitHub Pages installs pull records from Turso into a new IndexedDB.
            // Older cloud rows may contain money fields as strings; write one corrected copy back
            // so cashboxes and shifts remain numeric on every following load/device.
            const accountRepairNeeded = (accs || []).some((row) => typeof row?.balance !== 'number' || !Number.isFinite(row?.balance));
            const shiftMoneyFields = ['openingCash','totalCashSales','totalOtherSales','totalCashReturns','totalCashExpenses','expectedCash'];
            const shiftRepairNeeded = (shfts || []).some((row) => shiftMoneyFields.some((field) => typeof row?.[field] !== 'number' || !Number.isFinite(row?.[field])));
            if (accountRepairNeeded && normalizedAccounts.length) await bulkPut('accounts', normalizedAccounts);
            if (shiftRepairNeeded && normalizedShifts.length) await bulkPut('shifts', normalizedShifts);
            setAuditLogs((audits || []).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
            setHeldInvoices(newestFirst(helds));
            setSyncQueue(window.OscarCloudSync?.pendingItems?.() || syncs || []);
            setPartnerStatements(newestFirst(stmts));
            setVouchers((vouchs || []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
            if (emps && emps.length > 0) {
                setEmployees(newestFirst(emps));
                const loginAccountId = window.OscarActivation?.readRuntime?.()?.account?.id;
                setActiveEmployee((prev) => emps.find((e) => e.id === loginAccountId) || emps.find((e) => e.id === prev.id) || emps[0]);
            }
            if (sett) {
                let normalizedSettings = normalizeActiveWarehouseSettings(normalizeCurrencySettings(sett), whs || []);
                let settingsChanged = normalizedSettings.currency !== sett.currency || normalizedSettings.currencySymbol !== sett.currencySymbol || normalizedSettings.activeWarehouseId !== sett.activeWarehouseId;
                // One-time migration: restaurant mode is enabled by default from v7.9.4.22 onward.
                // After this marker is written, the user's own on/off choice is always preserved.
                if (normalizedSettings.restaurantModeDefaultInitialized !== true) {
                    normalizedSettings = { ...normalizedSettings, isRestaurantModeEnabled: normalizedSettings.isRestaurantModeEnabled === true, restaurantModeDefaultInitialized: true };
                    settingsChanged = true;
                }
                // v7.9.4.45: enable the 24-hour Telegram backup once for existing companies.
                // The marker preserves the user's later choice if they turn it off manually.
                if (normalizedSettings.telegramBackupDefaultV45Initialized !== true) {
                    normalizedSettings = { ...normalizedSettings, telegramDailyBackupEnabled: true, telegramBackupDefaultV45Initialized: true };
                    settingsChanged = true;
                }
                // v7.9.4.53: P2P payment methods are manual-only. Older builds seeded three
                // demo methods automatically; remove them only when they are still the untouched seed.
                if (normalizedSettings.p2pMethodsManualOnlyV53Initialized !== true) {
                    const methods = Array.isArray(normalizedSettings.p2pPaymentMethods) ? normalizedSettings.p2pPaymentMethods : [];
                    const byId = Object.fromEntries(methods.map((m) => [String(m?.id || ''), m]));
                    const looksLikeLegacySeed = methods.length === 3
                        && byId.palpay && byId['jawwal-pay'] && byId['bank-palestine']
                        && String(byId.palpay?.fields?.[0]?.value || '') === 'انور أحمد الندا'
                        && String(byId.palpay?.fields?.[1]?.value || '') === '0597603119'
                        && String(byId['jawwal-pay']?.fields?.[0]?.value || '') === 'انور أحمد الندا'
                        && String(byId['jawwal-pay']?.fields?.[1]?.value || '') === '0597603119'
                        && String(byId['bank-palestine']?.fields?.[2]?.value || '') === '3143732'
                        && String(byId['bank-palestine']?.fields?.[3]?.value || '') === 'PS11PALS045521437320993100000';
                    normalizedSettings = {
                        ...normalizedSettings,
                        p2pPaymentMethods: looksLikeLegacySeed ? [] : methods,
                        p2pMethodsManualOnlyV53Initialized: true,
                    };
                    settingsChanged = true;
                }
                // v7.9.4.48: financial years are open-ended. Existing data is assigned to
                // the initial year only when the user later opens a new year.
                if (normalizedSettings.financialYearInitializedV48 !== true || !Array.isArray(normalizedSettings.financialYears) || !normalizedSettings.activeFinancialYearId) {
                    const [oldestInvPage, oldestPurPage] = await Promise.all([
                        queryStorePage('invoices', { page:1, pageSize:1, sortField:'date', sortDirection:'asc', deletedMode:'all' }).catch(()=>({items:[]})),
                        queryStorePage('purchases', { page:1, pageSize:1, sortField:'date', sortDirection:'asc', deletedMode:'all' }).catch(()=>({items:[]})),
                    ]);
                    const allDocumentDates = [...(oldestInvPage.items || []), ...(oldestPurPage.items || [])]
                        .map((row) => new Date(row?.date || row?.createdAt || 0).getTime())
                        .filter((value) => Number.isFinite(value) && value > 0);
                    const startIso = allDocumentDates.length ? new Date(Math.min(...allDocumentDates)).toISOString() : new Date().toISOString();
                    const initialId = normalizedSettings.activeFinancialYearId || 'fy-initial';
                    const existingYears = Array.isArray(normalizedSettings.financialYears) ? normalizedSettings.financialYears : [];
                    const initialYear = existingYears.find((year) => year?.id === initialId) || { id: initialId, name: 'السنة المالية الحالية', startDate: startIso, endDate: null, status: 'open', createdAt: new Date().toISOString() };
                    normalizedSettings = { ...normalizedSettings, financialYears: existingYears.length ? existingYears : [initialYear], activeFinancialYearId: initialId, financialYearInitializedV48: true };
                    settingsChanged = true;
                }
                setSettings(normalizedSettings);
                if (settingsChanged) {
                    await putInStore('settings', { key: 'store_config', ...normalizedSettings });
                }
            }
            // Cash customer is virtual and always the POS fallback; it is never taken from the customers table.
            setSelectedCustomer((prev) => {
                if (!prev || prev.id === CASH_CUSTOMER.id) return CASH_CUSTOMER;
                return registeredCustomers.find((c) => c.id === prev.id) || CASH_CUSTOMER;
            });
        }
        catch (err) {
            console.error('Error reloading database:', err);
        }
        finally {
            setIsLoaded(true);
        }
    }, []);
    // Reload only the local IndexedDB datasets that actually changed. This keeps live sync fast
    // and avoids re-reading the whole local database after every remote delta.
    const reloadStores = useCallback(async (storeNames = []) => {
        const wanted = new Set(Array.isArray(storeNames) ? storeNames : [storeNames]);
        if (!wanted.size) return;
        const jobs = [];
        if (wanted.has('products')) jobs.push(getAllFromStore('products').then(v => setProducts(newestFirst(v))));
        if (wanted.has('categories')) jobs.push(getAllFromStore('categories').then(v => setCategories((v || []).sort((a,b)=>(a.displayOrder||0)-(b.displayOrder||0)))));
        if (wanted.has('warehouses')) jobs.push(getAllFromStore('warehouses').then(v => setWarehouses(v || [])));
        if (wanted.has('stock')) jobs.push(getAllFromStore('stock').then(v => setStock(v || [])));
        if (wanted.has('stock_movements')) jobs.push(queryStorePage('stock_movements', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items).then(v => setStockMovements((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('invoices')) jobs.push(queryStorePage('invoices', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items).then(v => setInvoices((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('purchases')) jobs.push(queryStorePage('purchases', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items).then(v => setPurchases((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('customers')) jobs.push(getAllFromStore('customers').then(v => { const real=(v||[]).filter(c=>c&&c.id!==CASH_CUSTOMER.id); setCustomers(newestFirst(real)); setSelectedCustomer(prev => (!prev || prev.id===CASH_CUSTOMER.id) ? CASH_CUSTOMER : (real.find(c=>c.id===prev.id)||CASH_CUSTOMER)); }));
        if (wanted.has('suppliers')) jobs.push(getAllFromStore('suppliers').then(v => setSuppliers(newestFirst(v))));
        if (wanted.has('accounts')) jobs.push(getAllFromStore('accounts').then(v => { const x=newestFirst((v || []).map(normalizeAccountRecord)); x.sort((a,b)=>Number(Boolean(b?.isDefault))-Number(Boolean(a?.isDefault))); setAccounts(x); }));
        if (wanted.has('transfers')) jobs.push(queryStorePage('transfers', { page:1, pageSize:50, sortField:'date', source:'local', countTotal:false }).then(r=>r.items).then(v => setTransfers((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('expenses')) jobs.push(queryStorePage('expenses', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items).then(v => setExpenses((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('shifts')) jobs.push(getAllFromStore('shifts').then(v => setShifts((v || []).map(normalizeShiftRecord).sort((a,b)=>new Date(b.startTime).getTime()-new Date(a.startTime).getTime()))));
        if (wanted.has('audit_logs')) jobs.push(queryStorePage('audit_logs', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items).then(v => setAuditLogs((v || []).sort((a,b)=>new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime()))));
        if (wanted.has('held_invoices')) jobs.push(queryStorePage('held_invoices', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items).then(v => setHeldInvoices(newestFirst(v))));
        if (wanted.has('partner_statements')) jobs.push(queryStorePage('partner_statements', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items).then(v => setPartnerStatements(newestFirst(v))));
        if (wanted.has('vouchers')) jobs.push(queryStorePage('vouchers', { page:1, pageSize:50, sortField:'date', deletedMode:'all', source:'local', countTotal:false }).then(r=>r.items).then(v => setVouchers((v || []).sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()))));
        if (wanted.has('employees')) jobs.push(getAllFromStore('employees').then(v => { if(v?.length){ setEmployees(newestFirst(v)); const loginId=window.OscarActivation?.readRuntime?.()?.account?.id; setActiveEmployee(prev => v.find(e=>e.id===loginId)||v.find(e=>e.id===prev?.id)||v[0]); } }));
        if (wanted.has('settings')) jobs.push(Promise.all([getFromStore('settings','store_config'), getAllFromStore('warehouses')]).then(async ([v, whRows]) => {
            if (!v) return;
            let normalizedSettings = normalizeActiveWarehouseSettings(normalizeCurrencySettings(v), whRows || []);
            let settingsChanged = normalizedSettings.currency !== v.currency || normalizedSettings.currencySymbol !== v.currencySymbol || normalizedSettings.activeWarehouseId !== v.activeWarehouseId;
            if (normalizedSettings.telegramBackupDefaultV45Initialized !== true) {
                normalizedSettings = { ...normalizedSettings, telegramDailyBackupEnabled: true, telegramBackupDefaultV45Initialized: true };
                settingsChanged = true;
            }
            setSettings(normalizedSettings);
            if (settingsChanged) {
                await putInStore('settings', { key: 'store_config', ...normalizedSettings });
            }
        }));
        if (wanted.has('sync_queue')) jobs.push(Promise.resolve().then(()=>setSyncQueue(window.OscarCloudSync?.pendingItems?.() || [])));
        await Promise.allSettled(jobs);
    }, []);
    // Heavy history is loaded in full only for screens that truly need a whole-ledger view
    // (reports/accounts/financial archive). Normal record screens stay page-based.
    const fullHistoryLoadedRef = useRef(new Set());
    const ensureFullHistoryStores = useCallback(async (storeNames = []) => {
        const names = [...new Set((Array.isArray(storeNames) ? storeNames : [storeNames]).filter(Boolean))];
        const pending = names.filter((name) => !fullHistoryLoadedRef.current.has(name));
        if (!pending.length) return true;
        const rowsByStore = {};
        await Promise.all(pending.map(async (name) => {
            rowsByStore[name] = await queryAllStoreRecords(name, { pageSize: 200, deletedMode: 'all' });
        }));
        for (const name of pending) {
            const rows = rowsByStore[name] || [];
            if (name === 'invoices') setInvoices(rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)));
            else if (name === 'purchases') setPurchases(rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)));
            else if (name === 'stock_movements') setStockMovements(rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)));
            else if (name === 'transfers') setTransfers(rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)));
            else if (name === 'expenses') setExpenses(rows.sort((a,b)=>new Date(b.date||b.createdAt||0)-new Date(a.date||a.createdAt||0)));
            else if (name === 'audit_logs') setAuditLogs(rows.sort((a,b)=>new Date(b.timestamp||b.date||0)-new Date(a.timestamp||a.date||0)));
            else if (name === 'held_invoices') setHeldInvoices(newestFirst(rows));
            else if (name === 'partner_statements') setPartnerStatements(newestFirst(rows));
            else if (name === 'vouchers') setVouchers(rows.sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)));
            fullHistoryLoadedRef.current.add(name);
        }
        return true;
    }, []);
    useEffect(() => {
        if (!isLoaded) return;
        const byTab = {
            reports: ['invoices','purchases','expenses','vouchers','stock_movements','transfers','audit_logs','partner_statements'],
            accounts: ['invoices','purchases','expenses','vouchers','transfers','audit_logs'],
            financial: ['invoices','purchases','expenses','vouchers','stock_movements','transfers','audit_logs','partner_statements','held_invoices'],
            financial_years: ['invoices','purchases','expenses','vouchers','stock_movements','transfers','audit_logs','partner_statements','held_invoices'],
            trash: ['expenses'],
        };
        const needed = byTab[activeTab];
        if (needed) ensureFullHistoryStores(needed).catch((err) => console.warn('Full history on-demand load warning:', err));
    }, [activeTab, isLoaded, ensureFullHistoryStores]);

    const isUserEditingField = useCallback(() => {
        if (typeof document === 'undefined') return false;
        const el = document.activeElement;
        if (!el || el === document.body) return false;
        if (el.matches?.('input, textarea, select, [contenteditable="true"]')) return true;
        return !!el.closest?.('[data-oscar-draft-lock="true"]');
    }, []);
    const isUserInteracting = useCallback(() => {
        if (typeof window === 'undefined' || typeof performance === 'undefined') return false;
        const last = Number(window.__OSCAR_LAST_INTERACTION_AT__ || 0);
        return last > 0 && (performance.now() - last) < 420;
    }, []);
    const scheduleDeferredRemoteRefresh = useCallback(() => {
        if (deferredRemoteTimerRef.current) clearTimeout(deferredRemoteTimerRef.current);
        const run = async () => {
            deferredRemoteTimerRef.current = null;
            if (!deferredRemoteStoresRef.current.size) return;
            if (isUserEditingField() || isUserInteracting()) {
                deferredRemoteTimerRef.current = setTimeout(run, 260);
                return;
            }
            const names = Array.from(deferredRemoteStoresRef.current);
            deferredRemoteStoresRef.current.clear();
            try {
                if (names.includes('*')) await reloadData();
                else await reloadStores(names);
            } catch (err) { console.warn('Deferred sync UI refresh warning:', err); }
        };
        deferredRemoteTimerRef.current = setTimeout(run, 220);
    }, [isUserEditingField, isUserInteracting, reloadData, reloadStores]);
    const applyRemoteRefresh = useCallback(async (storeNames = []) => {
        const names = Array.isArray(storeNames) ? storeNames.filter(Boolean) : [storeNames].filter(Boolean);
        // Remote data can land in IndexedDB immediately, but do not replace large
        // React datasets in the middle of a tap/click/typing burst. Yield a few
        // hundred milliseconds so controls always respond first.
        if (isUserEditingField() || isUserInteracting()) {
            if (!names.length) deferredRemoteStoresRef.current.add('*');
            else names.forEach((name) => deferredRemoteStoresRef.current.add(name));
            scheduleDeferredRemoteRefresh();
            return false;
        }
        if (!names.length || names.includes('*')) await reloadData();
        else await reloadStores(names);
        return true;
    }, [isUserEditingField, isUserInteracting, reloadData, reloadStores, scheduleDeferredRemoteRefresh]);
    useEffect(() => {
        const flush = () => scheduleDeferredRemoteRefresh();
        document.addEventListener('focusout', flush, true);
        document.addEventListener('change', flush, true);
        return () => {
            if (deferredRemoteTimerRef.current) clearTimeout(deferredRemoteTimerRef.current);
            document.removeEventListener('focusout', flush, true);
            document.removeEventListener('change', flush, true);
        };
    }, [scheduleDeferredRemoteRefresh]);
    // Initial load with guaranteed fallback
    useEffect(() => {
        let isMounted = true;
        let startupIdleId = 0;
        let startupTimerId = 0;
        const cancelDeferredStartupLoad = () => {
            if (startupIdleId && 'cancelIdleCallback' in window) { try { window.cancelIdleCallback(startupIdleId); } catch (_) {} }
            if (startupTimerId) window.clearTimeout(startupTimerId);
            startupIdleId = 0; startupTimerId = 0;
        };
        const scheduleDeferredStartupLoad = () => {
            const run = () => {
                startupIdleId = 0; startupTimerId = 0;
                if (!isMounted) return;
                // Large historical stores are not required to draw the first usable screen.
                // Read them after first paint so old movement/audit/statement history never blocks startup.
                reloadStores(['stock_movements', 'audit_logs', 'partner_statements', 'vouchers'])
                    .catch((err) => console.warn('Deferred history load warning:', err));
            };
            if ('requestIdleCallback' in window) startupIdleId = window.requestIdleCallback(run, { timeout: 850 });
            else startupTimerId = window.setTimeout(run, 70);
        };
        setIsCloudReady(false);
        initializeDatabase({ deferSeed: true })
            .then(async () => {
            if (!isMounted) return;
            // Prepare the real local stock before the application is allowed to render.
            // This removes the brief false-zero state and gives sync reliable legacy metadata.
            await backfillLocalStockMetadata();
            // Old production builds accidentally inserted demo company data into new keys.
            // Remove only the untouched demo pack; never touch real user-entered records.
            await cleanupLegacyDemoSeedIfPristine();
            setStartupProgress(25);
            let existingSettings = await getFromStore('settings', 'store_config');
            // Existing installations now open from the operational snapshot first.
            // Very large historical stores (movements/audit/statements/vouchers) load during idle time,
            // so they cannot hold the whole app on a white/loading screen.
            if (existingSettings) {
                await reloadStores([
                    'products', 'categories', 'warehouses', 'stock',
                    'invoices', 'purchases', 'customers', 'suppliers', 'accounts',
                    'transfers', 'expenses', 'shifts', 'held_invoices',
                    'employees', 'settings', 'sync_queue'
                ]);
                if (isMounted) {
                    setIsLoaded(true);
                    scheduleDeferredStartupLoad();
                }
            }
            setStartupProgress(45);
            let syncResult = null;
            try {
                syncResult = await window.OscarCloudSync?.initialize?.({
                    bridge: {
                        putInStore, deleteFromStore, getAllFromStore, getFromStore, getLatestStockMovementLocal,
                        onApplied: async (stores) => { if (isMounted) await applyRemoteRefresh(stores || []); }
                    }
                });
            } catch (syncError) { console.warn('Cloud sync bootstrap warning:', syncError); }
            setStartupProgress(80);
            if(navigator.onLine!==false){
                let completedPages=0;
                const firstPages=Promise.allSettled(['invoices','purchases','vouchers','expenses','stock_movements'].map(store=>queryStorePage(store,{page:1,pageSize:50,sortField:'date'}).finally(()=>{if(isMounted)setStartupProgress(80+(++completedPages)*3)}))).then(async()=>{if(isMounted)await reloadStores(['invoices','purchases','vouchers','expenses','stock_movements'])});
                let firstPageTimer;await Promise.race([firstPages,new Promise(resolve=>{firstPageTimer=setTimeout(resolve,5000)})]);clearTimeout(firstPageTimer);
            }
            // If an older client had already uploaded the demo pack into this new tenant,
            // clean it after the first pull as well. Deletions are queued back to cloud.
            const cleanedRemoteDemo = await cleanupLegacyDemoSeedIfPristine();
            if (cleanedRemoteDemo && isMounted) await reloadData();
            if (isMounted) setIsCloudReady(true);
            // Remove the old persisted walk-in customer. Cash customer is now virtual POS-only.
            try {
                const oldWalkIn = await getFromStore('customers', CASH_CUSTOMER.id);
                if (oldWalkIn) {
                    await deleteFromStore('customers', CASH_CUSTOMER.id);
                    if (isMounted) await reloadStores(['customers']);
                }
            } catch (_) {}
            // Keep the primary warehouse normalized locally even when old/cloud data still uses the previous name.
            const showroomNormalized = await ensurePrimaryShowroomWarehouse().catch(() => false);
            if (showroomNormalized && existingSettings) await reloadStores(['warehouses', 'settings']);
            if (!existingSettings) {
                existingSettings = await getFromStore('settings', 'store_config');
                // A brand-new company starts empty. Never import an unidentified legacy
                // database because it may belong to another activation/company.
                if (!existingSettings) await seedDatabaseDefaults();
                await reloadData();
            }
            if (window.OscarCloudSync?.pendingCount?.()) window.OscarCloudSync.requestSync?.(80);
        })
            .catch((err) => {
            console.warn('Database initialization warning:', err);
            if (isMounted) {
                setStartupProgress(100);
                setIsCloudReady(true);
                setIsLoaded(true);
            }
        })
            .finally(() => {
            if (isMounted) {
                setStartupProgress(100);
                setIsCloudReady(true);
                setIsLoaded(true);
            }
        });
        // Cross-tab real-time listener
        if (syncChannel) {
            const handleMessage = (event) => {
                const msg = event?.data || {};
                const tenantId = window.OscarActivation?.readRuntime?.()?.companyId || '';
                if (msg.tenantId && msg.tenantId !== tenantId) return;
                msg.storeName ? applyRemoteRefresh([msg.storeName]) : applyRemoteRefresh([]);
            };
            syncChannel.addEventListener('message', handleMessage);
            return () => {
                isMounted = false;
                cancelDeferredStartupLoad();
                syncChannel.removeEventListener('message', handleMessage);
            };
        }
        return () => {
            isMounted = false;
            cancelDeferredStartupLoad();
        };
    }, [reloadData, reloadStores, applyRemoteRefresh]);
    useEffect(() => {
        let frame = 0, latestDetail = {}, lastSignature = '';
        const flushStatus = () => {
            frame = 0;
            const d = latestDetail || {};
            const syncing = !!d.busy || d.state === 'syncing';
            const queue = window.OscarCloudSync?.pendingItems?.() || [];
            const signature = `${syncing ? 1 : 0}|${queue.length}|${queue[0]?.id || ''}|${queue[0]?.syncId || ''}`;
            if (signature === lastSignature) return;
            lastSignature = signature;
            React.startTransition(() => {
                setIsSyncing(syncing);
                setSyncQueue(queue);
            });
        };
        const onStatus = (event) => {
            latestDetail = event?.detail || {};
            if (!frame) frame = requestAnimationFrame(flushStatus);
        };
        const onApplied = (event) => applyRemoteRefresh(event?.detail?.stores || []);
        window.addEventListener('oscar:sync-status', onStatus);
        window.addEventListener('oscar:sync-applied', onApplied);
        onStatus({ detail: {} });
        return () => {
            if (frame) cancelAnimationFrame(frame);
            window.removeEventListener('oscar:sync-status', onStatus);
            window.removeEventListener('oscar:sync-applied', onApplied);
        };
    }, [applyRemoteRefresh]);
    // Online / Offline monitor
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            showToast('تمت استعادة الاتصال بالإنترنت - جاهز للمزامنة', 'success');
            window.OscarCloudSync?.syncNow?.({ force: true });
        };
        const handleOffline = () => {
            setIsOnline(false);
        };
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);
    // Keep the active warehouse valid even if an older synced settings record arrives.
    // This is intentionally silent: inventory must never flash or stay at zero because of a stale warehouse id.
    useEffect(() => {
        if (!isLoaded || !warehouses.length) return;
        const normalized = normalizeActiveWarehouseSettings(settings, warehouses);
        if (!normalized || normalized.activeWarehouseId === settings.activeWarehouseId) return;
        setSettings(normalized);
        putInStore('settings', { key: 'store_config', ...normalized }).catch(() => {});
    }, [isLoaded, warehouses, settings]);
    // Active shift
    const activeShift = useMemo(() => {
        const found = shifts.find((s) => s.status === 'open') || null;
        return found ? normalizeShiftRecord(found) : null;
    }, [shifts]);
    // O(1) stock lookup. Product grids call this hundreds of times while scrolling;
    // a memoized index avoids repeated Array.find/filter work on every render/frame.
    const stockLookup = useMemo(() => {
        const byWarehouse = new Map(), totals = new Map();
        for (const row of stock || []) {
            const productId = String(row?.productId || '');
            const warehouseId = String(row?.warehouseId || '');
            const qty = Number(row?.baseQuantity) || 0;
            byWarehouse.set(`${productId}::${warehouseId}`, qty);
            totals.set(productId, (totals.get(productId) || 0) + qty);
        }
        return { byWarehouse, totals };
    }, [stock]);
    const getProductStock = useCallback((productId, warehouseId) => {
        const requestedWh = warehouseId || settings.activeWarehouseId;
        const targetWh = requestedWh && warehouses.some(w => String(w.id) === String(requestedWh))
            ? requestedWh
            : (warehouses.find(w => w?.isDefault)?.id || warehouses.find(w => w?.id === 'wh-main')?.id || warehouses[0]?.id || '');
        if (warehouseId || targetWh) return stockLookup.byWarehouse.get(`${String(productId)}::${String(targetWh)}`) || 0;
        return stockLookup.totals.get(String(productId)) || 0;
    }, [stockLookup, settings.activeWarehouseId, warehouses]);
    // Cart operations
    const addToCart = useCallback((product, unit, quantity = 1) => {
        const targetUnit = unit || product.units.find((u) => u.isDefaultSale) || product.units[0];
        if (!targetUnit)
            return;
        const baseStock = getProductStock(product.id, settings.activeWarehouseId);
        setCart((prev) => {
            const existingIndex = prev.findIndex((item) => item.productId === product.id && item.unitId === targetUnit.id);
            if (existingIndex >= 0) {
                const updatedItem = {
                    ...prev[existingIndex],
                    quantity: prev[existingIndex].quantity + quantity,
                    lastAddedAt: Date.now(),
                };
                // آخر صنف تمت إضافته/زيادته يظهر أولاً في السلة.
                return [updatedItem, ...prev.filter((_, index) => index !== existingIndex)];
            }
            return [
                {
                    productId: product.id,
                    productName: product.name,
                    unitId: targetUnit.id,
                    unitName: targetUnit.name,
                    availableUnits: product.units,
                    quantity: quantity,
                    conversionFactor: targetUnit.conversionToBase || 1,
                    unitPrice: targetUnit.salePrice || product.sellingPrice,
                    catalogUnitPrice: Number(targetUnit.salePrice || product.sellingPrice || 0),
                    discount: 0,
                    taxRate: product.taxRate || 0,
                    costPriceAtSale: (product.costPrice || 0) * (targetUnit.conversionToBase || 1),
                    baseStockAvailable: baseStock,
                    lastAddedAt: Date.now(),
                },
                ...prev,
            ];
        });
        playBeepSound(settings.scannerBeepEnabled);
    }, [getProductStock, settings.activeWarehouseId, settings.scannerBeepEnabled]);
    const updateCartItemUnit = useCallback((productId, oldUnitId, newUnitId) => {
        setCart((prev) => {
            const index = prev.findIndex((item) => item.productId === productId && item.unitId === oldUnitId);
            if (index === -1)
                return prev;
            const currentItem = prev[index];
            const newUnit = currentItem.availableUnits.find((u) => u.id === newUnitId);
            if (!newUnit)
                return prev;
            const updated = [...prev];
            updated[index] = {
                ...currentItem,
                unitId: newUnit.id,
                unitName: newUnit.name,
                conversionFactor: newUnit.conversionToBase || 1,
                unitPrice: newUnit.salePrice,
                catalogUnitPrice: Number(newUnit.salePrice || 0),
                costPriceAtSale: (currentItem.costPriceAtSale / currentItem.conversionFactor) * (newUnit.conversionToBase || 1),
            };
            return updated;
        });
    }, []);
    const updateCartItemQuantity = useCallback((productId, unitId, quantity) => {
        if (quantity <= 0) {
            removeFromCart(productId, unitId);
            return;
        }
        setCart((prev) => prev.map((item) => item.productId === productId && item.unitId === unitId ? { ...item, quantity } : item));
    }, []);
    const updateCartItemPrice = useCallback((productId, unitId, unitPrice) => {
        const nextPrice = Number(unitPrice);
        if (!Number.isFinite(nextPrice) || nextPrice < 0) return;
        setCart((prev) => prev.map((item) => item.productId === productId && item.unitId === unitId ? { ...item, unitPrice: nextPrice } : item));
    }, []);
    const updateCartItemScaleAmount = useCallback((productId, unitId, enteredAmount) => {
        const amount = Number(enteredAmount);
        if (!Number.isFinite(amount) || amount < 0) return;
        setCart((prev) => prev.map((item) => {
            if (item.productId !== productId || item.unitId !== unitId) return item;
            const unit = (item.availableUnits || []).find((u) => u.id === item.unitId);
            const referencePrice = Number(item.catalogUnitPrice ?? unit?.salePrice ?? item.unitPrice ?? 0);
            if (!Number.isFinite(referencePrice) || referencePrice <= 0) return item;
            const quantity = amount <= 0 ? 0.001 : amount / referencePrice;
            return { ...item, unitPrice: referencePrice, catalogUnitPrice: referencePrice, quantity: Math.max(0.001, Number(quantity.toFixed(4))) };
        }));
    }, []);
    const updateCartItemDiscount = useCallback((productId, unitId, discount) => {
        setCart((prev) => prev.map((item) => item.productId === productId && item.unitId === unitId ? { ...item, discount: Math.max(0, discount) } : item));
    }, []);
    const removeFromCart = useCallback((productId, unitId) => {
        setCart((prev) => prev.filter((item) => !(item.productId === productId && item.unitId === unitId)));
    }, []);
    const clearCart = useCallback(() => {
        setCart([]);
        setInvoiceAdditionalCharges(0);
        setInvoiceDiscountType('fixed');
        setInvoiceDiscountValue(0);
        // Every new sale starts as a direct cash sale.
        setSelectedCustomer(CASH_CUSTOMER);
        setEditingSaleInvoiceId(null);
    }, []);
    // Hold current invoice
    const holdCurrentInvoice = useCallback(async (notes) => {
        if (cart.length === 0) {
            showToast('السلة فارغة، لا يمكن تعليق فاتورة فارغة', 'warning');
            return;
        }
        const held = {
            id: 'held-' + Date.now(),
            date: new Date().toISOString(),
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            customerId: selectedCustomer?.id || CASH_CUSTOMER.id,
            customerName: selectedCustomer?.name || CASH_CUSTOMER.name,
            items: [...cart],
            additionalCharges: invoiceAdditionalCharges, invoiceDiscountType, invoiceDiscountValue,
            subtotal: cart.reduce((s, i) => s + (i.quantity * i.unitPrice), 0),
            notes,
        };
        await putInStore('held_invoices', held);
        setHeldInvoices((prev) => [held, ...prev]);
        clearCart();
        showToast('تم تعليق الفاتورة بنجاح ويمكن استرجاعها في أي وقت', 'success');
    }, [cart, selectedCustomer, invoiceAdditionalCharges, invoiceDiscountType, invoiceDiscountValue, clearCart, showToast, settings.activeFinancialYearId]);
    const restoreHeldInvoice = useCallback(async (heldId) => {
        const held = heldInvoices.find((h) => h.id === heldId);
        await assertOpenFinancialRecord(held);
        if (!held)
            return;
        if (cart.length > 0) {
            await holdCurrentInvoice('فاتورة مستبدلة تلقائياً');
        }
        setCart(held.items);
        setInvoiceAdditionalCharges(Number(held.additionalCharges)||0);
        setInvoiceDiscountType(held.invoiceDiscountType||'fixed');
        setInvoiceDiscountValue(Number(held.invoiceDiscountValue)||0);
        setSelectedCustomer(held.customerId === CASH_CUSTOMER.id ? CASH_CUSTOMER : (customers.find((c) => c.id === held.customerId) || CASH_CUSTOMER));
        await deleteFromStore('held_invoices', heldId);
        setHeldInvoices((prev) => prev.filter((h) => h.id !== heldId));
        setShowHoldInvoicesModal(false);
        showToast('تم استعادة الفاتورة المعلقة إلى السلة', 'info');
    }, [heldInvoices, cart.length, holdCurrentInvoice, customers, showToast]);
    const deleteHeldInvoice = useCallback(async (heldId) => {
        await deleteFromStore('held_invoices', heldId);
        setHeldInvoices((prev) => prev.filter((h) => h.id !== heldId));
    }, []);
    // Handle scanned barcode (hardware scanner or camera)
    const handleScannedBarcode = useCallback((barcode) => {
        if (!barcode || barcode.trim() === '')
            return false;
        const clean = barcode.trim();
        for (const prod of products) {
            if (prod.status === 'archived' || prod.deletedAt)
                continue;
            const salesChannel = String(prod.salesChannel || 'both').toLowerCase();
            if (salesChannel === 'restaurant' || salesChannel === 'restaurant_only' || salesChannel === 'raw_material' || salesChannel === 'raw' || salesChannel === 'ingredient' || prod.isRawMaterialOnly)
                continue;
            const matchedUnit = findUnitByBarcode(prod, clean);
            if (matchedUnit) {
                addToCart(prod, matchedUnit, 1);
                showToast(`تمت إضافة: ${prod.name} (${matchedUnit.name})`, 'success');
                return true;
            }
        }
        playErrorSound(settings.scannerBeepEnabled);
        showToast(`لم يتم العثور على صنف بالباركود: ${clean}`, 'warning');
        return false;
    }, [products, addToCart, showToast, settings.scannerBeepEnabled]);
    // Create Sale Invoice (invoice discount + FIFO cost consumption)
    const createSaleInvoice = useCallback(async (payload = {}) => {
        if (isTrialAccount() && !payload.isEdit && invoices.filter((row) => row?.type === 'sale').length >= TRIAL_LIMITS.salesInvoices) {
            showToast(`وصلت إلى الحد المتاح لفواتير المبيعات (${TRIAL_LIMITS.salesInvoices}).`, 'warning');
            return null;
        }
        const isDirectSale = Array.isArray(payload.items) && payload.items.length > 0;
        const saleCart = isDirectSale ? payload.items : cart;
        if (saleCart.length === 0) { showToast('السلة فارغة!', 'error'); return null; }
        // Use the already-synced in-memory snapshot for an instant local save.
        // Remote changes update these states separately; saving never waits for fresh cloud/database reads.
        const sourceProducts = products;
        const sourceStock = stock;
        const sourceAccounts = accounts;
        const sourceCustomers = customers;
        const liveActiveShift = activeShift || null;
        const warehouseId = payload.warehouseIdOverride || settings.activeWarehouseId;
        const warehouse = warehouses.find((w) => w.id === warehouseId) || warehouses[0];
        const now = new Date().toISOString();
        const invoiceDate = payload.dateOverride || now;
        const invoiceNumber = payload.invoiceNumberOverride || `INV-${Date.now().toString().slice(-6)}`;
        const invoiceId = payload.invoiceIdOverride || `inv-${Date.now()}`;
        const syncId = `sale-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const recipes = await getAllFromStore('recipes').catch(() => []);
        const recipeByProductId = new Map((recipes || []).map((r) => [r.productId || r.mealProductId, r]).filter((x) => x[0]));
        let subtotal = 0, lineDiscountTotal = 0, taxTotal = 0;
        const productCopies = [...sourceProducts];
        const changedProductIds = new Set();
        const consumeFifo = (productId, baseQty, fallbackBaseCost) => {
            const idx = productCopies.findIndex(x=>x.id===productId);
            if (idx < 0) return baseQty * fallbackBaseCost;
            if (!changedProductIds.has(productId)) {
                const original = productCopies[idx];
                productCopies[idx] = { ...original, fifoBatches: Array.isArray(original.fifoBatches) ? original.fifoBatches.map(b=>({...b})) : [] };
                changedProductIds.add(productId);
            }
            const p = productCopies[idx];
            let left = Math.max(0, baseQty), totalCost = 0;
            const candidates = p.fifoBatches.filter(b => (b.warehouseId === warehouseId || !b.warehouseId) && Number(b.remainingBaseQty)>0)
              .sort((a,b)=>new Date(a.receivedAt||0)-new Date(b.receivedAt||0));
            for (const batch of candidates) {
                if (left <= 0) break;
                const take = Math.min(left, Number(batch.remainingBaseQty)||0);
                totalCost += take * (Number(batch.unitCost)||fallbackBaseCost);
                batch.remainingBaseQty = Math.max(0,(Number(batch.remainingBaseQty)||0)-take);
                left -= take;
            }
            if (left > 0) totalCost += left * fallbackBaseCost;
            return totalCost;
        };
        const invoiceItems = saleCart.map((item) => {
            const lineSubtotal = item.quantity * item.unitPrice;
            const lineDiscount = 0;
            const lineTax = lineSubtotal * (item.taxRate / 100);
            const lineTotal = lineSubtotal + lineTax;
            subtotal += lineSubtotal; lineDiscountTotal += 0; taxTotal += lineTax;
            const baseQuantity = item.quantity * item.conversionFactor;
            const fallbackBaseCost = item.conversionFactor ? (item.costPriceAtSale / item.conversionFactor) : item.costPriceAtSale;
            const recipe = recipeByProductId.get(item.productId);
            const recipeConsumption = [];
            let fifoLineCost = 0;
            if (recipe && Array.isArray(recipe.ingredients || recipe.items) && (recipe.ingredients || recipe.items).length > 0) {
                const ingredients = recipe.ingredients || recipe.items;
                for (const ing of ingredients) {
                    const ingProduct = productCopies.find((p) => p.id === ing.ingredientProductId || p.id === ing.productId);
                    if (!ingProduct) continue;
                    const ingUnits = ingProduct.units || [];
                    const ingUnit = ingUnits.find((u) => u.id === (ing.ingredientUnitId || ing.unitId)) || ingUnits.find((u) => u.name === ing.unit) || ingUnits.find((u) => u.id === ingProduct.baseUnitId) || ingUnits.find((u) => (Number(u.conversionToBase) || 1) === 1) || ingUnits[0];
                    const factor = Number(ing.conversionFactor ?? ingUnit?.conversionToBase ?? 1) || 1;
                    const qtyPerMeal = Number(ing.quantity) || 0;
                    const basePerMeal = Number(ing.baseQuantity) > 0 ? Number(ing.baseQuantity) : qtyPerMeal * factor;
                    const requiredBaseQty = basePerMeal * item.quantity;
                    if (requiredBaseQty <= 0) continue;
                    const ingredientBaseCost = Number(ingProduct.costPrice) || (Number(ingUnit?.costPrice) / Math.max(1, Number(ingUnit?.conversionToBase) || 1)) || 0;
                    const cost = consumeFifo(ingProduct.id, requiredBaseQty, ingredientBaseCost);
                    fifoLineCost += cost;
                    recipeConsumption.push({
                        recipeId: recipe.id,
                        productId: ingProduct.id,
                        productName: ingProduct.name,
                        unitId: ingUnit?.id || '',
                        unitName: ingUnit?.name || ing.unit || ingProduct.baseUnitName || 'وحدة',
                        quantityPerMeal: qtyPerMeal,
                        conversionFactor: factor,
                        baseQuantityPerMeal: basePerMeal,
                        soldMealQuantity: item.quantity,
                        baseQuantity: requiredBaseQty,
                        fifoCostTotal: cost,
                    });
                }
                if (recipeConsumption.length === 0) {
                    fifoLineCost = consumeFifo(item.productId, baseQuantity, fallbackBaseCost || 0);
                }
            } else {
                fifoLineCost = consumeFifo(item.productId, baseQuantity, fallbackBaseCost || 0);
            }
            return { id:'item-'+Math.random().toString(36).substring(2,9), productId:item.productId, productName:item.productName, unitId:item.unitId, unitName:item.unitName, quantity:item.quantity, conversionFactor:item.conversionFactor, baseQuantity, unitPrice:item.unitPrice, discount:0, taxRate:item.taxRate, total:lineTotal, fifoCostTotal:fifoLineCost, costPriceAtSale:item.quantity>0?fifoLineCost/item.quantity:0, isManufacturedMeal:recipeConsumption.length>0, recipeId:recipe?.id, recipeConsumption };
        });
        const beforeInvoiceDiscount = Math.max(0, subtotal - lineDiscountTotal + taxTotal);
        const effectiveDiscountType = payload.invoiceDiscountType || invoiceDiscountType;
        const rawDiscount = Number(payload.invoiceDiscountValue ?? invoiceDiscountValue)||0;
        const invoiceDiscountAmount = effectiveDiscountType === 'percent' ? Math.min(beforeInvoiceDiscount, beforeInvoiceDiscount*Math.max(0,Math.min(100,rawDiscount))/100) : Math.min(beforeInvoiceDiscount,Math.max(0,rawDiscount));
        const discountTotal = lineDiscountTotal + invoiceDiscountAmount;
        const additionalCharges = Math.max(0, Number(payload.additionalCharges ?? (isDirectSale ? 0 : invoiceAdditionalCharges))||0);
        const rawGrandTotal = Math.max(0, beforeInvoiceDiscount - invoiceDiscountAmount) + additionalCharges;
        const grandTotal = settings.scaleModeEnabled ? Math.round(rawGrandTotal) : rawGrandTotal;
        const roundingAdjustment = grandTotal - rawGrandTotal;
        const payments = Array.isArray(payload.payments) ? payload.payments.filter(p => p && Number(p.amount) > 0 && p.accountId) : [];
        let paid = Number(payload.paidAmount)||0;
        const remaining = Math.max(0, grandTotal - paid);
        const change = Math.max(0, paid - grandTotal);
        const selectedLiveCustomer = selectedCustomer?.id ? (sourceCustomers.find((c) => c.id === selectedCustomer.id) || selectedCustomer) : CASH_CUSTOMER;
        const saleCustomer = payload.forceCashCustomer ? CASH_CUSTOMER : (payload.customerObject || (payload.customerId ? (sourceCustomers.find((c) => c.id === payload.customerId) || selectedLiveCustomer || CASH_CUSTOMER) : (selectedLiveCustomer || CASH_CUSTOMER)));
        if ((payload.paymentType === 'debt' || payload.paymentType === 'partial') && saleCustomer.id === CASH_CUSTOMER.id) { showToast('يجب اختيار عميل مسجل للبيع الآجل أو الدفع الجزئي!', 'error'); return null; }
        const invoice = { id:invoiceId, invoiceNumber, type:'sale', date:invoiceDate, financialYearId: payload.financialYearIdOverride || settings.activeFinancialYearId || 'fy-initial', customerId:saleCustomer.id, customerName:saleCustomer.name, cashierId:currentUser.id, cashierName:currentUser.name, shiftId:liveActiveShift?.id, branchId:settings.activeBranchName, warehouseId, items:invoiceItems, subtotal, lineDiscountTotal, invoiceDiscountType:effectiveDiscountType, invoiceDiscountValue:rawDiscount, invoiceDiscountAmount, discountTotal, taxTotal, additionalCharges, roundingAdjustment, grandTotal, paidAmount:Math.min(paid,grandTotal), remainingAmount:remaining, changeAmount:change, paymentType:payload.paymentType, payments, status:'completed', notes:payload.notes, syncId, isSynced:false, createdAt:payload.createdAtOverride || now, updatedAt:now, editedAt:payload.isEdit ? now : undefined };
        const updatedStockList=[...sourceStock], newMovements=[], changedStockKeys=new Set();
        const deductStock = (productId, productName, baseQty, movementMeta = {}) => {
            const stockIndex=updatedStockList.findIndex(s=>s.productId===productId&&s.warehouseId===warehouseId);
            const currentQty=stockIndex>=0?Number(updatedStockList[stockIndex].baseQuantity)||0:0;
            const newQty=currentQty-baseQty;
            if(stockIndex>=0) updatedStockList[stockIndex]={...updatedStockList[stockIndex],baseQuantity:newQty}; else updatedStockList.push({productId,warehouseId,baseQuantity:newQty});
            changedStockKeys.add(`${productId}::${warehouseId}`);
            newMovements.push({id:'mov-'+Math.random().toString(36).substring(2,9),date:now,financialYearId:settings.activeFinancialYearId||'fy-initial',productId,productName,warehouseId,warehouseName:warehouse?.name||'صالة العرض',type:movementMeta.type||'sale',unitName:movementMeta.unitName||'وحدة أساسية',quantityInUnit:movementMeta.quantityInUnit??baseQty,conversionFactor:movementMeta.conversionFactor||1,baseQuantityChange:-baseQty,newBaseBalance:newQty,referenceId:invoice.id,referenceType:'INVOICE',userId:currentUser.id,userName:currentUser.name,recipeId:movementMeta.recipeId,manufacturedProductId:movementMeta.manufacturedProductId,manufacturedProductName:movementMeta.manufacturedProductName});
        };
        for (const item of invoiceItems) {
            if (item.isManufacturedMeal && Array.isArray(item.recipeConsumption) && item.recipeConsumption.length > 0) {
                for (const ing of item.recipeConsumption) {
                    deductStock(ing.productId, ing.productName, ing.baseQuantity, {
                        type:'recipe_sale',
                        unitName:ing.unitName,
                        quantityInUnit:(Number(ing.quantityPerMeal)||0) * (Number(ing.soldMealQuantity)||0),
                        conversionFactor:ing.conversionFactor,
                        recipeId:item.recipeId,
                        manufacturedProductId:item.productId,
                        manufacturedProductName:item.productName,
                    });
                }
            } else {
                deductStock(item.productId, item.productName, item.baseQuantity, {type:'sale',unitName:item.unitName,quantityInUnit:item.quantity,conversionFactor:item.conversionFactor});
            }
        }
        const updatedAccounts=[...sourceAccounts], changedAccountIds=new Set();
        for(const p of payments){const i=updatedAccounts.findIndex(a=>a.id===p.accountId);if(i>=0){updatedAccounts[i]={...updatedAccounts[i],balance:(Number(updatedAccounts[i].balance)||0)+(Number(p.amount)||0)};changedAccountIds.add(p.accountId);}}
        let updatedCustomer = null, customerStatement = null, updatedShift = null;
        if(remaining>0&&saleCustomer.id!==CASH_CUSTOMER.id){const newBalance=(Number(saleCustomer.balance)||0)+remaining;updatedCustomer={...saleCustomer,balance:newBalance};customerStatement={id:'stmt-'+Date.now(),date:now,financialYearId:settings.activeFinancialYearId||'fy-initial',type:'sale',partnerType:'customer',partnerId:saleCustomer.id,partnerName:saleCustomer.name,referenceType:'SALE',referenceId:invoice.id,referenceNumber:invoiceNumber,description:`فاتورة مبيعات آجل رقم ${invoiceNumber}`,debit:remaining,credit:0,runningBalance:newBalance};}
        if(liveActiveShift){const cashPaid=payments.filter(p=>p.method==='cash').reduce((x,p)=>x+(Number(p.amount)||0),0)-change;const otherPaid=payments.filter(p=>p.method!=='cash').reduce((x,p)=>x+(Number(p.amount)||0),0);updatedShift={...liveActiveShift,totalCashSales:(Number(liveActiveShift.totalCashSales)||0)+Math.max(0,cashPaid),totalOtherSales:(Number(liveActiveShift.totalOtherSales)||0)+otherPaid,expectedCash:(Number(liveActiveShift.expectedCash)||0)+Math.max(0,cashPaid)};}
        // One atomic IndexedDB commit: invoice + stock + accounts + debt + shift.
        // This is the durability point shown to the cashier; cloud queue/network starts afterwards.
        const localOps = [{ type:'put', storeName:'invoices', value:invoice, actionHint: payload.isEdit ? 'update' : 'add' }];
        for (const row of updatedStockList) if (changedStockKeys.has(`${row.productId}::${row.warehouseId}`)) localOps.push({ type:'put', storeName:'stock', value:row, actionHint:'update' });
        for (const movement of newMovements) localOps.push({ type:'put', storeName:'stock_movements', value:movement, actionHint:'add' });
        for (const prod of productCopies) if (changedProductIds.has(prod.id)) localOps.push({ type:'put', storeName:'products', value:prod, actionHint:'update' });
        for (const acc of updatedAccounts) if (changedAccountIds.has(acc.id)) localOps.push({ type:'put', storeName:'accounts', value:acc, actionHint:'update' });
        if (updatedCustomer) localOps.push({ type:'put', storeName:'customers', value:updatedCustomer, actionHint:'update' });
        if (customerStatement) localOps.push({ type:'put', storeName:'partner_statements', value:customerStatement, actionHint:'add' });
        if (updatedShift) localOps.push({ type:'put', storeName:'shifts', value:updatedShift, actionHint:'update' });
        await commitLocalBatch(localOps);
        // Update the open screen from the already-saved local data; no full database reload and no cloud wait.
        setInvoices(prev => [invoice, ...prev.filter(x => x.id !== invoice.id)]);
        setStock(updatedStockList);
        setStockMovements(prev => [...newMovements, ...prev]);
        setProducts(productCopies);
        setAccounts(updatedAccounts);
        if(updatedCustomer)setCustomers(prev => prev.some(c=>c.id===updatedCustomer.id) ? prev.map(c => c.id===updatedCustomer.id?updatedCustomer:c) : [updatedCustomer,...prev]);
        if(customerStatement)setPartnerStatements(prev => [customerStatement, ...prev]);
        if(updatedShift)setShifts(prev => prev.map(x => x.id===updatedShift.id?updatedShift:x));
        playSuccessSound(settings.scannerBeepEnabled); if(!isDirectSale) clearCart(); setEditingSaleInvoiceId(null); notifyTelegramInvoice(invoice,'sale').catch(()=>{}); showToast(payload.isEdit ? `تم تعديل الفاتورة [${invoiceNumber}] مع عكس القيد القديم وإعادة احتساب الجديد` : `تم حفظ الفاتورة بنجاح [${invoiceNumber}]`,'success'); return invoice;
    }, [cart, invoiceDiscountType, invoiceDiscountValue, invoiceAdditionalCharges, settings, warehouses, products, customers, selectedCustomer, currentUser, activeShift, stock, accounts, invoices, clearCart, showToast]);
    // Transaction reversal helpers: all invoice changes pass through the same accounting/stock logic.
    const addStockDelta = useCallback(async ({ rows, productId, warehouseId, delta, movement }) => {
        const qty = finiteNumber(delta, 0);
        if (!productId || !warehouseId || Math.abs(qty) < 0.0000001) return rows;
        const nextRows = [...rows];
        const index = nextRows.findIndex((row) => row.productId === productId && String(row.warehouseId) === String(warehouseId));
        const current = index >= 0 ? finiteNumber(nextRows[index].baseQuantity, 0) : 0;
        const next = current + qty;
        const stamped = { productId, warehouseId, baseQuantity: next, updatedAt: new Date().toISOString() };
        if (index >= 0) nextRows[index] = { ...nextRows[index], ...stamped };
        else nextRows.push(stamped);
        if (movement) {
            await putInStore('stock_movements', {
                id: movement.id || `mov-reverse-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                date: movement.date || new Date().toISOString(),
                financialYearId: movement.financialYearId || settings.activeFinancialYearId || 'fy-initial',
                productId,
                warehouseId,
                baseQuantityChange: qty,
                newBaseBalance: next,
                userId: currentUser.id,
                userName: currentUser.name,
                ...movement,
            });
        }
        return nextRows;
    }, [currentUser, settings.activeFinancialYearId]);

    const appendReversalStatement = useCallback(async ({ partnerType, partner, amount, referenceType, referenceId, referenceNumber, description, direction }) => {
        const value = Math.max(0, finiteNumber(amount, 0));
        if (!partner?.id || value <= 0) return;
        const nextBalance = finiteNumber(partner.balance, 0) + (direction === 'increase' ? value : -value);
        const store = partnerType === 'supplier' ? 'suppliers' : 'customers';
        await putInStore(store, { ...partner, balance: nextBalance });
        await putInStore('partner_statements', {
            id: `stmt-rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            date: new Date().toISOString(),
            type: 'reversal',
            partnerType,
            partnerId: partner.id,
            partnerName: partner.name,
            referenceType,
            referenceId,
            referenceNumber,
            description,
            debit: direction === 'increase' ? value : 0,
            credit: direction === 'increase' ? 0 : value,
            runningBalance: nextBalance,
            isReversal: true,
        });
    }, []);

    const restoreFifoQuantity = useCallback((productRows, productId, warehouseId, baseQty, costTotal, sourceMeta = {}) => {
        const qty = Math.max(0, finiteNumber(baseQty, 0));
        if (!productId || qty <= 0) return productRows;
        const next = productRows.map((p) => p.id === productId ? { ...p, fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.map((b) => ({ ...b })) : [] } : p);
        const index = next.findIndex((p) => p.id === productId);
        if (index < 0) return next;
        const unitCost = qty > 0 ? Math.max(0, finiteNumber(costTotal, 0)) / qty : 0;
        next[index].fifoBatches.push({
            id: `batch-reversal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            purchaseId: sourceMeta.purchaseId || sourceMeta.referenceId || 'reversal',
            warehouseId,
            receivedAt: new Date().toISOString(),
            expiryDate: '',
            unitCost,
            remainingBaseQty: qty,
            reversalBatch: true,
            sourceReferenceId: sourceMeta.referenceId,
            sourceReturnId: sourceMeta.returnId,
        });
        next[index].updatedAt = new Date().toISOString();
        return next;
    }, []);

    const removeReturnFifoBatches = useCallback((productRows, returnId) => productRows.map((p) => ({
        ...p,
        fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.filter((b) => b.sourceReturnId !== returnId) : p.fifoBatches,
    })), []);

    // Create Return Invoice. Debt is reversed first; only the paid portion is refunded from the original payment accounts.
    const createReturnInvoice = useCallback(async (payload) => {
        const original = await getFromStore('invoices', payload.originalInvoiceId);
        await assertOpenFinancialRecord(original);
        if (!original || original.type !== 'sale') {
            showToast('لم يتم العثور على فاتورة المبيعات الأصلية', 'error');
            return null;
        }
        const linkedReturns = await queryAllStoreRecords('invoices', {
            filters: { type: 'return', originalInvoiceId: original.id },
            deletedMode: 'all',
            pageSize: 200,
        });
        const now = new Date().toISOString();
        const returnNumber = `RET-${Date.now().toString().slice(-6)}`;
        const syncId = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const alreadyReturnedByKey = new Map();
        for (const ret of linkedReturns) {
            for (const item of (ret.items || [])) {
                const key = `${item.productId}\u0001${item.unitId || ''}`;
                alreadyReturnedByKey.set(key, finiteNumber(alreadyReturnedByKey.get(key), 0) + finiteNumber(item.quantity, 0));
            }
        }
        const originalGross = (original.items || []).reduce((sum, item) => sum + Math.max(0, finiteNumber(item.total, finiteNumber(item.quantity, 0) * finiteNumber(item.unitPrice, 0))), 0) || Math.max(0, finiteNumber(original.grandTotal, 0));
        const priorReturnTotal = linkedReturns.reduce((sum, ret) => sum + Math.max(0, finiteNumber(ret.grandTotal, 0)), 0);
        const remainingReturnableValue = Math.max(0, finiteNumber(original.grandTotal, 0) - priorReturnTotal);
        if (remainingReturnableValue <= 0.000001) {
            showToast('تم إرجاع كامل قيمة هذه الفاتورة سابقاً', 'warning');
            return null;
        }
        const returnItems = [];
        let selectedGross = 0;
        for (const reqItem of (payload.items || [])) {
            const originalItem = (original.items || []).find((x) => x.productId === reqItem.productId && x.unitId === reqItem.unitId);
            if (!originalItem) continue;
            const key = `${originalItem.productId}\u0001${originalItem.unitId || ''}`;
            const availableQty = Math.max(0, finiteNumber(originalItem.quantity, 0) - finiteNumber(alreadyReturnedByKey.get(key), 0));
            const qty = Math.min(availableQty, Math.max(0, finiteNumber(reqItem.quantity, 0)));
            if (qty <= 0) continue;
            const proportion = finiteNumber(originalItem.quantity, 0) > 0 ? qty / finiteNumber(originalItem.quantity, 0) : 0;
            const grossLine = Math.max(0, finiteNumber(originalItem.total, finiteNumber(originalItem.quantity, 0) * finiteNumber(originalItem.unitPrice, 0))) * proportion;
            selectedGross += grossLine;
            const recipeConsumption = Array.isArray(originalItem.recipeConsumption) ? originalItem.recipeConsumption.map((ing) => ({
                ...ing,
                soldMealQuantity: qty,
                baseQuantity: finiteNumber(ing.baseQuantity, 0) * proportion,
                fifoCostTotal: finiteNumber(ing.fifoCostTotal, 0) * proportion,
            })) : [];
            returnItems.push({
                id: `ret-item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                productId: originalItem.productId,
                productName: originalItem.productName,
                unitId: originalItem.unitId,
                unitName: originalItem.unitName,
                quantity: qty,
                conversionFactor: finiteNumber(originalItem.conversionFactor, 1) || 1,
                baseQuantity: finiteNumber(originalItem.baseQuantity, finiteNumber(originalItem.quantity, 0) * finiteNumber(originalItem.conversionFactor, 1)) * proportion,
                unitPrice: finiteNumber(originalItem.unitPrice, 0),
                discount: finiteNumber(originalItem.discount, 0) * proportion,
                taxRate: finiteNumber(originalItem.taxRate, 0),
                total: grossLine,
                fifoCostTotal: finiteNumber(originalItem.fifoCostTotal, 0) * proportion,
                costPriceAtSale: finiteNumber(originalItem.costPriceAtSale, 0),
                isManufacturedMeal: !!originalItem.isManufacturedMeal,
                recipeId: originalItem.recipeId,
                recipeConsumption,
            });
        }
        if (!returnItems.length || selectedGross <= 0) {
            showToast('حدد كمية صحيحة للإرجاع', 'warning');
            return null;
        }
        const proportionalNet = originalGross > 0 ? finiteNumber(original.grandTotal, 0) * (selectedGross / originalGross) : selectedGross;
        const refundTotal = Math.min(remainingReturnableValue, Math.max(0, proportionalNet));
        const priorDebtReversed = linkedReturns.reduce((sum, ret) => sum + Math.max(0, finiteNumber(ret.returnAllocation?.debtReversed, 0)), 0);
        const originalDebt = Math.max(0, finiteNumber(original.remainingAmount, 0));
        const debtStillOpenFromInvoice = Math.max(0, originalDebt - priorDebtReversed);
        const debtReversed = Math.min(refundTotal, debtStillOpenFromInvoice);
        let paidRefundLeft = Math.max(0, refundTotal - debtReversed);
        const priorRefundByAccount = new Map();
        for (const ret of linkedReturns) {
            for (const row of (ret.returnAllocation?.accountRefunds || [])) {
                priorRefundByAccount.set(row.accountId, finiteNumber(priorRefundByAccount.get(row.accountId), 0) + finiteNumber(row.amount, 0));
            }
        }
        const originalPayments = Array.isArray(original.payments) ? original.payments.filter((p) => p?.accountId && finiteNumber(p.amount, 0) > 0) : [];
        const availablePayments = originalPayments.map((p) => ({ ...p, available: Math.max(0, finiteNumber(p.amount, 0) - finiteNumber(priorRefundByAccount.get(p.accountId), 0)) })).filter((p) => p.available > 0.000001);
        const liveReturnAccounts = await getAllFromStore('accounts');
        const accountRefunds = [];
        for (const p of availablePayments) {
            if (paidRefundLeft <= 0.000001) break;
            const amount = Math.min(p.available, paidRefundLeft);
            accountRefunds.push({ accountId: p.accountId, accountName: p.accountName, method: p.method || 'account', amount });
            paidRefundLeft -= amount;
        }
        if (paidRefundLeft > 0.000001) {
            const fallback = (liveReturnAccounts || []).find((a) => a.id === payload.refundAccountId) || (liveReturnAccounts || []).find((a) => a.isDefault) || (liveReturnAccounts || [])[0];
            if (!fallback) {
                showToast('لا يوجد حساب مالي لإرجاع الجزء المدفوع من الفاتورة', 'error');
                return null;
            }
            accountRefunds.push({ accountId: fallback.id, accountName: fallback.name, method: fallback.type === 'cash' ? 'cash' : 'account', amount: paidRefundLeft });
            paidRefundLeft = 0;
        }
        const returnInvoice = {
            id: `ret-${Date.now()}`,
            invoiceNumber: returnNumber,
            type: 'return',
            date: now,
            financialYearId: original.financialYearId || settings.activeFinancialYearId || 'fy-initial',
            customerId: original.customerId,
            customerName: original.customerName,
            cashierId: currentUser.id,
            cashierName: currentUser.name,
            shiftId: activeShift?.id,
            branchId: original.branchId,
            warehouseId: original.warehouseId,
            items: returnItems,
            subtotal: refundTotal,
            discountTotal: 0,
            taxTotal: 0,
            grandTotal: refundTotal,
            paidAmount: accountRefunds.reduce((s, p) => s + finiteNumber(p.amount, 0), 0),
            remainingAmount: 0,
            changeAmount: 0,
            paymentType: debtReversed > 0 && accountRefunds.length ? 'partial_reverse' : (debtReversed > 0 ? 'debt_reverse' : 'refund'),
            payments: accountRefunds,
            status: 'completed',
            originalInvoiceId: original.id,
            notes: payload.notes,
            returnAllocation: { debtReversed, accountRefunds },
            syncId,
            isSynced: false,
            createdAt: now,
        };
        await putInStore('invoices', returnInvoice);
        const [liveReturnStock, liveReturnProducts] = await Promise.all([getAllFromStore('stock'), getAllFromStore('products')]);
        let updatedStockList = [...(Array.isArray(liveReturnStock) ? liveReturnStock : stock)];
        let updatedProducts = (Array.isArray(liveReturnProducts) && liveReturnProducts.length ? liveReturnProducts : products).map((p) => ({ ...p, fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.map((b) => ({ ...b })) : [] }));
        const restoreOne = async (productId, productName, baseQty, costTotal, meta = {}) => {
            const qty = Math.max(0, finiteNumber(baseQty, 0));
            if (!productId || qty <= 0) return;
            updatedStockList = await addStockDelta({ rows: updatedStockList, productId, warehouseId: original.warehouseId, delta: qty, movement: {
                productName, warehouseName: warehouses.find((w) => String(w.id) === String(original.warehouseId))?.name || 'المخزن', type: meta.type || 'sales_return', unitName: meta.unitName || 'وحدة أساسية', quantityInUnit: meta.quantityInUnit ?? qty, conversionFactor: meta.conversionFactor || 1, referenceId: returnInvoice.id, referenceType: 'SALES_RETURN', originalReferenceId: original.id, recipeId: meta.recipeId, manufacturedProductId: meta.manufacturedProductId, manufacturedProductName: meta.manufacturedProductName,
            }});
            updatedProducts = restoreFifoQuantity(updatedProducts, productId, original.warehouseId, qty, costTotal, { referenceId: original.id, returnId: returnInvoice.id });
        };
        for (const item of returnItems) {
            if (item.isManufacturedMeal && item.recipeConsumption.length) {
                for (const ing of item.recipeConsumption) await restoreOne(ing.productId, ing.productName, ing.baseQuantity, ing.fifoCostTotal, { type: 'recipe_sales_return', unitName: ing.unitName, quantityInUnit: finiteNumber(ing.quantityPerMeal, 0) * finiteNumber(item.quantity, 0), conversionFactor: ing.conversionFactor, recipeId: item.recipeId, manufacturedProductId: item.productId, manufacturedProductName: item.productName });
            } else {
                await restoreOne(item.productId, item.productName, item.baseQuantity, item.fifoCostTotal, { unitName: item.unitName, quantityInUnit: item.quantity, conversionFactor: item.conversionFactor });
            }
        }
        await bulkPut('stock', updatedStockList);
        await bulkPut('products', updatedProducts);
        if (debtReversed > 0 && original.customerId && original.customerId !== CASH_CUSTOMER.id) {
            const liveCustomersForReturn = await getAllFromStore('customers');
            const cust = (liveCustomersForReturn || []).find((c) => c.id === original.customerId);
            if (cust) await appendReversalStatement({ partnerType: 'customer', partner: cust, amount: debtReversed, referenceType: 'SALES_RETURN', referenceId: returnInvoice.id, referenceNumber: returnNumber, description: `قيد عكسي لمرتجع مبيعات ${returnNumber}`, direction: 'decrease' });
        }
        const updatedAccounts = (liveReturnAccounts || []).map((a) => ({ ...a }));
        for (const refund of accountRefunds) {
            const ai = updatedAccounts.findIndex((a) => a.id === refund.accountId);
            if (ai >= 0) updatedAccounts[ai].balance = finiteNumber(updatedAccounts[ai].balance, 0) - finiteNumber(refund.amount, 0);
        }
        if (updatedAccounts.length) await bulkPut('accounts', updatedAccounts);
        if (activeShift) {
            const cashRefund = accountRefunds.filter((r) => r.method === 'cash' || (liveReturnAccounts || []).find((a) => a.id === r.accountId)?.type === 'cash').reduce((s, r) => s + finiteNumber(r.amount, 0), 0);
            if (cashRefund > 0) await putInStore('shifts', { ...activeShift, totalCashReturns: finiteNumber(activeShift.totalCashReturns, 0) + cashRefund, expectedCash: finiteNumber(activeShift.expectedCash, 0) - cashRefund });
        }
        await putInStore('audit_logs', { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date: now, financialYearId: settings.activeFinancialYearId || 'fy-initial', type: 'sales_return_reverse_entry', referenceId: returnInvoice.id, originalReferenceId: original.id, amount: refundTotal, debtReversed, accountRefunds, userId: currentUser.id, userName: currentUser.name });
        await reloadData();
        notifyTelegramInvoice(returnInvoice,'return').catch(()=>{});
        showToast(`تم تسجيل المرتجع وعكس المخزون والدين والدفع [${returnNumber}]`, 'success');
        return returnInvoice;
    }, [invoices, products, customers, currentUser, activeShift, accounts, stock, warehouses, reloadData, showToast, addStockDelta, restoreFifoQuantity, appendReversalStatement, settings.activeFinancialYearId]);
    const cartReturnBusy=useRef(false);
    const createCartReturnInvoice=useCallback(async(payload={})=>{
        if(cartReturnBusy.current)return null;
        cartReturnBusy.current=true;
        try {
            const [liveProducts,liveStock,liveAccounts,liveCustomers,liveShifts]=await Promise.all(['products','stock','accounts','customers','shifts'].map(getAllFromStore));
            const id=`ret-${crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
            const {invoice,operations}=buildCartReturn({cart,products:liveProducts,stock:liveStock,accounts:liveAccounts,customers:liveCustomers,settings,customer:selectedCustomer,user:currentUser,shift:liveShifts.find(s=>s.id===activeShift?.id),payload,discountType:invoiceDiscountType,discountValue:invoiceDiscountValue,id,now:new Date().toISOString()});
            await commitLocalBatch(operations);
            clearCart();
            await reloadStores(['invoices','stock','products','accounts','customers','shifts','partner_statements','sync_queue']).catch(()=>{});
            notifyTelegramInvoice(invoice,'return').catch(()=>{});
            showToast('تم حفظ المرتجع وإعادة المخزون وتسوية الحساب','success');
            return invoice;
        } catch(error){showToast(error?.message||'تعذر حفظ المرتجع','error');return null;}
        finally{cartReturnBusy.current=false;}
    },[cart,settings,selectedCustomer,currentUser,activeShift,invoiceDiscountType,invoiceDiscountValue,clearCart,reloadStores,showToast]);
    // Create Purchase Invoice (local-first: durable local save first, cloud sync later)
    const createPurchaseInvoice = useCallback(async (payload) => {
        if (isTrialAccount() && !payload?.isEdit && purchases.length >= TRIAL_LIMITS.purchaseInvoices) {
            showToast(`وصلت إلى الحد المتاح لفواتير المشتريات (${TRIAL_LIMITS.purchaseInvoices}).`, 'warning');
            return null;
        }
        const sourceProducts = products;
        const sourceStock = stock;
        const sourceAccounts = accounts;
        const sourceSuppliers = suppliers;
        const now=new Date().toISOString(); const purchaseDate=payload?.date ? new Date(`${String(payload.date).slice(0,10)}T12:00:00`).toISOString() : (payload?.dateOverride || now); const invoiceNumber=payload?.invoiceNumberOverride || `PUR-${Date.now().toString().slice(-6)}`; const purchaseId=payload?.invoiceIdOverride || `pur-${Date.now()}`; const syncId=`pur-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
        const targetWarehouse = warehouses.find(w=>w.id===payload?.warehouseId) || warehouses.find(w=>w.id===settings.activeWarehouseId) || warehouses.find(w=>w.isDefault) || warehouses.find(w=>/صالة\s*العرض/.test(String(w.name||''))) || warehouses[0];
        if(!targetWarehouse) throw new Error('لا يوجد مخزن رئيسي. أضف صالة العرض من المخازن أولاً.');
        const warehouseId=targetWarehouse.id;
        const items=Array.isArray(payload?.items)?payload.items.filter(i=>i?.productId&&Number(i.quantity)>0):[];
        if(!items.length) throw new Error('أضف صنفاً واحداً على الأقل إلى فاتورة المشتريات.');
        const payments=Array.isArray(payload?.payments)?payload.payments.filter(p=>p&&p.accountId&&Number(p.amount)>0):[];
        const subtotal=items.reduce((x,i)=>x+(Number(i.total)||0),0);
        const discountTotal=Math.max(0,Math.min(subtotal,Number(payload.discountAmount)||0));
        const grandTotal=Math.max(0,subtotal-discountTotal); const paidAmount=Math.min(grandTotal,Math.max(0,Number(payload.paidAmount)||0)); const remaining=Math.max(0,grandTotal-paidAmount); const ratio=subtotal>0?grandTotal/subtotal:1;
        const purchaseInvoice={id:purchaseId,invoiceNumber,supplierInvoiceNumber:payload.supplierInvoiceNumber||'',date:purchaseDate,financialYearId:payload.financialYearIdOverride || settings.activeFinancialYearId || 'fy-initial',supplierId:payload.supplierId,supplierName:payload.supplierName,warehouseId,warehouseName:targetWarehouse.name||'صالة العرض',items:items.map((it,idx)=>({id:`pur-it-${Date.now()}-${idx}`,...it})),subtotal,discountType:payload.discountType||'fixed',discountValue:Number(payload.discountValue)||0,discountTotal,taxTotal:0,grandTotal,paidAmount,remainingAmount:remaining,paymentType:payload.paymentType,payments,notes:payload.notes||'',syncId,isSynced:false,createdAt:payload.createdAtOverride || now,updatedAt:now,editedAt:payload.isEdit?now:undefined};
        const updatedProducts=[...sourceProducts]; const updatedStockList=[...sourceStock],newMovements=[],changedProductIds=new Set(),changedStockKeys=new Set();
        for(const item of items){const pi=updatedProducts.findIndex(p=>p.id===item.productId);const si=updatedStockList.findIndex(x=>x.productId===item.productId&&x.warehouseId===warehouseId);const currentBaseStock=si>=0?Number(updatedStockList[si].baseQuantity)||0:0;const currentTotalBaseStock=updatedStockList.filter(x=>x.productId===item.productId).reduce((sum,row)=>sum+Math.max(0,Number(row.baseQuantity)||0),0);const baseQty=Math.max(0,Number(item.baseQuantity)||0);const newBaseStock=currentBaseStock+baseQty;
          if(pi>=0){if(!changedProductIds.has(item.productId)){const original=updatedProducts[pi];updatedProducts[pi]={...original,fifoBatches:Array.isArray(original.fifoBatches)?original.fifoBatches.map(b=>({...b})):[]};changedProductIds.add(item.productId);}const currentCost=Number(updatedProducts[pi].costPrice)||0;const unitCost=((Number(item.unitPrice)||0)*ratio)/Math.max(0.00000001,(Number(item.conversionFactor)||1));let batches=updatedProducts[pi].fifoBatches||[];if(currentBaseStock>0&&!batches.some(b=>(b.warehouseId===warehouseId||!b.warehouseId)&&Number(b.remainingBaseQty)>0)){batches.push({id:`legacy-${item.productId}-${warehouseId}`,purchaseId:'legacy',warehouseId,receivedAt:'2000-01-01T00:00:00.000Z',expiryDate:updatedProducts[pi].expiryDate||'',unitCost:currentCost,remainingBaseQty:currentBaseStock});}batches.push({id:`batch-${purchaseInvoice.id}-${item.productId}-${Math.random().toString(36).slice(2,6)}`,purchaseId:purchaseInvoice.id,warehouseId,receivedAt:purchaseDate,expiryDate:item.expiryDate||updatedProducts[pi].expiryDate||'',unitCost,remainingBaseQty:baseQty});const oldVal=Math.max(0,currentTotalBaseStock)*currentCost,newVal=baseQty*unitCost,totalUnits=Math.max(0,currentTotalBaseStock)+baseQty,newWAC=totalUnits>0?(oldVal+newVal)/totalUnits:unitCost;updatedProducts[pi]={...updatedProducts[pi],costPrice:parseFloat(newWAC.toFixed(4)),fifoBatches:batches,updatedAt:now};}
          if(si>=0)updatedStockList[si]={...updatedStockList[si],baseQuantity:newBaseStock};else updatedStockList.push({productId:item.productId,warehouseId,baseQuantity:newBaseStock});changedStockKeys.add(`${item.productId}::${warehouseId}`);
          newMovements.push({id:'mov-'+Math.random().toString(36).substring(2,9),date:purchaseDate,financialYearId:settings.activeFinancialYearId||'fy-initial',productId:item.productId,productName:item.productName,warehouseId,warehouseName:targetWarehouse.name||'صالة العرض',type:'purchase',unitName:item.unitName,quantityInUnit:item.quantity,conversionFactor:item.conversionFactor,baseQuantityChange:baseQty,newBaseBalance:newBaseStock,referenceId:purchaseInvoice.id,referenceType:'PURCHASE',userId:currentUser.id,userName:currentUser.name});}
        const updatedAccounts=[...sourceAccounts],changedAccountIds=new Set();for(const pay of payments){const ai=updatedAccounts.findIndex(a=>a.id===pay.accountId);if(ai>=0){updatedAccounts[ai]={...updatedAccounts[ai],balance:(Number(updatedAccounts[ai].balance)||0)-(Number(pay.amount)||0)};changedAccountIds.add(pay.accountId);}}
        let updatedSupplier=null,supplierStatement=null;
        if(remaining>0){const supp=sourceSuppliers.find(s=>s.id===payload.supplierId) || (payload.supplierObject?.id===payload.supplierId ? payload.supplierObject : null);if(supp){const nb=(Number(supp.balance)||0)+remaining;updatedSupplier={...supp,balance:nb};supplierStatement={id:'stmt-'+Date.now(),date:purchaseDate,financialYearId:settings.activeFinancialYearId||'fy-initial',type:'purchase',partnerType:'supplier',partnerId:supp.id,partnerName:supp.name,partyType:'supplier',partyId:supp.id,referenceType:'PURCHASE',referenceId:purchaseInvoice.id,referenceNumber:invoiceNumber,description:`فاتورة مشتريات رقم ${invoiceNumber}`,debit:0,credit:remaining,runningBalance:nb};}}
        const purchaseOps=[{type:'put',storeName:'purchases',value:purchaseInvoice,actionHint:payload?.isEdit?'update':'add'}];
        for(const prod of updatedProducts)if(changedProductIds.has(prod.id))purchaseOps.push({type:'put',storeName:'products',value:prod,actionHint:'update'});
        for(const row of updatedStockList)if(changedStockKeys.has(`${row.productId}::${row.warehouseId}`))purchaseOps.push({type:'put',storeName:'stock',value:row,actionHint:'update'});
        for(const movement of newMovements)purchaseOps.push({type:'put',storeName:'stock_movements',value:movement,actionHint:'add'});
        for(const acc of updatedAccounts)if(changedAccountIds.has(acc.id))purchaseOps.push({type:'put',storeName:'accounts',value:acc,actionHint:'update'});
        if(updatedSupplier)purchaseOps.push({type:'put',storeName:'suppliers',value:updatedSupplier,actionHint:'update'});
        if(supplierStatement)purchaseOps.push({type:'put',storeName:'partner_statements',value:supplierStatement,actionHint:'add'});
        await commitLocalBatch(purchaseOps);
        setPurchases(prev => [purchaseInvoice, ...prev.filter(x=>x.id!==purchaseInvoice.id)]);
        setProducts(updatedProducts);setStock(updatedStockList);setStockMovements(prev=>[...newMovements,...prev]);setAccounts(updatedAccounts);
        if(updatedSupplier)setSuppliers(prev=>prev.some(x=>x.id===updatedSupplier.id)?prev.map(x=>x.id===updatedSupplier.id?updatedSupplier:x):[updatedSupplier,...prev]);if(supplierStatement)setPartnerStatements(prev=>[supplierStatement,...prev]);
        playSuccessSound(settings.scannerBeepEnabled);notifyTelegramInvoice(purchaseInvoice,'purchase').catch(()=>{});showToast(payload?.isEdit ? `تم تعديل فاتورة الشراء [${invoiceNumber}] مع عكس القيد القديم وإعادة احتساب الجديد` : `تم تسجيل فاتورة الشراء بنجاح [${invoiceNumber}]`,'success');return purchaseInvoice;
    }, [warehouses,products,stock,accounts,suppliers,purchases,currentUser,showToast,settings.activeWarehouseId,settings.activeFinancialYearId,settings.scannerBeepEnabled]);

    // Damaged/expired stock: deduct quantity and exact FIFO cost as a loss expense.
    const recordDamagedStock = useCallback(async (productId, warehouseId, baseQuantity, reason='تالف / منتهي الصلاحية') => {
        const prod=products.find(p=>p.id===productId); const qty=Math.max(0,Number(baseQuantity)||0); if(!prod||qty<=0)return false;
        const current=getProductStock(productId,warehouseId); if(current<=0){showToast('لا يوجد رصيد متاح لهذا الصنف','warning');return false;} const actual=Math.min(current,qty); const now=new Date().toISOString();
        const pcopy={...prod,fifoBatches:Array.isArray(prod.fifoBatches)?prod.fifoBatches.map(b=>({...b})):[]}; let left=actual,cost=0;const batches=pcopy.fifoBatches.filter(b=>(b.warehouseId===warehouseId||!b.warehouseId)&&Number(b.remainingBaseQty)>0).sort((a,b)=>new Date(a.receivedAt||0)-new Date(b.receivedAt||0));for(const b of batches){if(left<=0)break;const take=Math.min(left,Number(b.remainingBaseQty)||0);cost+=take*(Number(b.unitCost)||prod.costPrice||0);b.remainingBaseQty-=take;left-=take;}if(left>0)cost+=left*(Number(prod.costPrice)||0);
        const updatedStock=[...stock];const si=updatedStock.findIndex(x=>x.productId===productId&&x.warehouseId===warehouseId);const newBalance=current-actual;if(si>=0)updatedStock[si]={...updatedStock[si],baseQuantity:newBalance};else updatedStock.push({productId,warehouseId,baseQuantity:newBalance});
        await putInStore('products',{...pcopy,updatedAt:now});await bulkPut('stock',updatedStock);await putInStore('stock_movements',{id:'mov-damage-'+Date.now(),date:now,financialYearId:settings.activeFinancialYearId||'fy-initial',productId,productName:prod.name,warehouseId,warehouseName:warehouses.find(w=>w.id===warehouseId)?.name||'المخزن',type:'damage',unitName:prod.baseUnitName,quantityInUnit:actual,conversionFactor:1,baseQuantityChange:-actual,newBaseBalance,referenceType:'DAMAGE',userId:currentUser.id,userName:currentUser.name,notes:reason});await putInStore('expenses',{id:'exp-damage-'+Date.now(),date:now,financialYearId:settings.activeFinancialYearId||'fy-initial',category:'تالف ومخزون منتهي',amount:parseFloat(cost.toFixed(4)),accountId:null,accountName:'خسارة مخزون',notes:`${reason}: ${prod.name} × ${actual} ${prod.baseUnitName}`,userId:currentUser.id,userName:currentUser.name,createdAt:now,inventoryLoss:true,deletedAt:null});
        await reloadData();showToast(`تم خصم التالف من المخزون وتسجيل خسارة ${cost.toFixed(2)} ${settings.currencySymbol}`,'success');return true;
    },[products,stock,warehouses,currentUser,getProductStock,reloadData,showToast,settings.currencySymbol]);
    // Stock operations
    const adjustStock = useCallback(async (productId, warehouseId, newBaseQty, reason = 'تسوية جرد') => {
        const prod = products.find((p) => p.id === productId);
        if (!prod)
            return;
        const currentQty = getProductStock(productId, warehouseId);
        const diff = newBaseQty - currentQty;
        const now = new Date().toISOString();
        const updatedStockList = [...stock];
        const stockIdx = updatedStockList.findIndex((s) => s.productId === productId && s.warehouseId === warehouseId);
        if (stockIdx >= 0) {
            updatedStockList[stockIdx] = {
                ...updatedStockList[stockIdx],
                baseQuantity: newBaseQty,
            };
        }
        else {
            updatedStockList.push({
                productId,
                warehouseId,
                baseQuantity: newBaseQty,
            });
        }
        const movement = {
            id: 'mov-' + Date.now(),
            date: now,
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            productId,
            productName: prod.name,
            warehouseId,
            warehouseName: warehouses.find((w) => w.id === warehouseId)?.name || 'المخزن',
            type: 'inventory_adjustment',
            unitName: prod.baseUnitName,
            quantityInUnit: Math.abs(diff),
            conversionFactor: 1,
            baseQuantityChange: diff,
            newBaseBalance: newBaseQty,
            referenceType: 'ADJUSTMENT',
            userId: currentUser.id,
            userName: currentUser.name,
            notes: reason,
        };
        await bulkPut('stock', updatedStockList);
        await putInStore('stock_movements', movement);
        await reloadData();
        showToast(`تم تعديل رصيد ${prod.name} إلى ${newBaseQty} ${prod.baseUnitName}`, 'info');
    }, [products, getProductStock, stock, warehouses, currentUser, reloadData, showToast, settings.activeFinancialYearId]);
    const adjustStockCount = useCallback(async (warehouseId, adjustments, reason = 'تسوية جرد دوري') => {
        if (!warehouseId || adjustments.length === 0)
            return;
        const now = new Date().toISOString();
        const updatedStockList = [...stock];
        const movements = [];
        adjustments.forEach((entry, index) => {
            const prod = products.find((p) => p.id === entry.productId);
            if (!prod || !Number.isFinite(entry.actualQty))
                return;
            const stockIdx = updatedStockList.findIndex((item) => item.productId === entry.productId && item.warehouseId === warehouseId);
            const currentQty = stockIdx >= 0 ? updatedStockList[stockIdx].baseQuantity : 0;
            const nextQty = Math.max(0, entry.actualQty);
            const diff = nextQty - currentQty;
            if (stockIdx >= 0) {
                updatedStockList[stockIdx] = { ...updatedStockList[stockIdx], baseQuantity: nextQty };
            }
            else {
                updatedStockList.push({ productId: entry.productId, warehouseId, baseQuantity: nextQty });
            }
            const unitBreakdown = Array.isArray(entry.unitBreakdown) ? entry.unitBreakdown.filter((row) => Number(row?.quantity) >= 0) : [];
            const breakdownText = unitBreakdown.length
                ? unitBreakdown.map((row) => `${Number(row.quantity) || 0} ${row.unitName || ''}`).join(' + ')
                : '';
            movements.push({
                id: `mov-count-${Date.now()}-${index}`,
                date: now,
                financialYearId: settings.activeFinancialYearId || 'fy-initial',
                productId: entry.productId,
                productName: prod.name,
                warehouseId,
                warehouseName: warehouses.find((w) => w.id === warehouseId)?.name || 'المخزن',
                type: 'inventory_adjustment',
                unitName: prod.baseUnitName,
                quantityInUnit: Math.abs(diff),
                conversionFactor: 1,
                baseQuantityChange: diff,
                newBaseBalance: nextQty,
                countUnitBreakdown: unitBreakdown,
                referenceType: 'STOCK_COUNT',
                userId: currentUser.id,
                userName: currentUser.name,
                notes: breakdownText ? `${reason} — الجرد: ${breakdownText}` : reason,
            });
        });
        await bulkPut('stock', updatedStockList);
        for (const movement of movements)
            await putInStore('stock_movements', movement);
        await reloadData();
        showToast(`تم اعتماد الجرد وتحديث ${movements.length} صنف بنجاح`, 'success');
    }, [stock, products, warehouses, currentUser, reloadData, showToast, settings.activeFinancialYearId]);
    const transferStock = useCallback(async (productId, fromWarehouseId, toWarehouseId, unit, quantity, notes) => {
        const prod = products.find((p) => p.id === productId);
        if (!prod)
            return;
        const baseQuantity = toBaseQuantity(quantity, unit);
        const fromQty = getProductStock(productId, fromWarehouseId);
        if (!settings.allowNegativeStock && fromQty < baseQuantity) {
            showToast('الكمية المراد تحويلها أكبر من المتوفر في المخزن المصدر!', 'error');
            return;
        }
        const now = new Date().toISOString();
        const updatedStockList = [...stock];
        // Deduct from source
        const fromIdx = updatedStockList.findIndex((s) => s.productId === productId && s.warehouseId === fromWarehouseId);
        const newFromQty = (fromIdx >= 0 ? updatedStockList[fromIdx].baseQuantity : 0) - baseQuantity;
        if (fromIdx >= 0) {
            updatedStockList[fromIdx] = { ...updatedStockList[fromIdx], baseQuantity: newFromQty };
        }
        else {
            updatedStockList.push({ productId, warehouseId: fromWarehouseId, baseQuantity: newFromQty });
        }
        // Add to destination
        const toIdx = updatedStockList.findIndex((s) => s.productId === productId && s.warehouseId === toWarehouseId);
        const newToQty = (toIdx >= 0 ? updatedStockList[toIdx].baseQuantity : 0) + baseQuantity;
        if (toIdx >= 0) {
            updatedStockList[toIdx] = { ...updatedStockList[toIdx], baseQuantity: newToQty };
        }
        else {
            updatedStockList.push({ productId, warehouseId: toWarehouseId, baseQuantity: newToQty });
        }
        const movOut = {
            id: 'mov-' + Date.now() + '-out',
            date: now,
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            productId,
            productName: prod.name,
            warehouseId: fromWarehouseId,
            warehouseName: warehouses.find((w) => w.id === fromWarehouseId)?.name || '',
            type: 'transfer_out',
            unitName: unit.name,
            quantityInUnit: quantity,
            conversionFactor: unit.conversionToBase || 1,
            baseQuantityChange: -baseQuantity,
            newBaseBalance: newFromQty,
            userId: currentUser.id,
            userName: currentUser.name,
            notes: `تحويل إلى ${warehouses.find((w) => w.id === toWarehouseId)?.name || ''} ${notes ? `(${notes})` : ''}`,
        };
        const movIn = {
            id: 'mov-' + Date.now() + '-in',
            date: now,
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            productId,
            productName: prod.name,
            warehouseId: toWarehouseId,
            warehouseName: warehouses.find((w) => w.id === toWarehouseId)?.name || '',
            type: 'transfer_in',
            unitName: unit.name,
            quantityInUnit: quantity,
            conversionFactor: unit.conversionToBase || 1,
            baseQuantityChange: baseQuantity,
            newBaseBalance: newToQty,
            userId: currentUser.id,
            userName: currentUser.name,
            notes: `تحويل من ${warehouses.find((w) => w.id === fromWarehouseId)?.name || ''} ${notes ? `(${notes})` : ''}`,
        };
        await bulkPut('stock', updatedStockList);
        await putInStore('stock_movements', movOut);
        await putInStore('stock_movements', movIn);
        await reloadData();
        showToast(`تم تحويل ${quantity} ${unit.name} من ${prod.name} بنجاح`, 'success');
    }, [products, getProductStock, settings.allowNegativeStock, settings.activeFinancialYearId, stock, warehouses, currentUser, reloadData, showToast]);
    const transferStockBatch = useCallback(async (fromWarehouseId, toWarehouseId, items, notes = '') => {
        if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
            showToast('يجب اختيار مخزنين مختلفين للتحويل', 'error');
            return false;
        }
        const rows = (items || []).filter((row) => row?.productId && row?.unitId && Number(row?.quantity) > 0);
        if (!rows.length) {
            showToast('أضف صنفاً واحداً على الأقل للتحويل', 'warning');
            return false;
        }
        const now = new Date().toISOString();
        const updatedStockList = [...stock];
        const movements = [];
        const fromName = warehouses.find((w) => w.id === fromWarehouseId)?.name || '';
        const toName = warehouses.find((w) => w.id === toWarehouseId)?.name || '';
        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const prod = products.find((p) => p.id === row.productId);
            const unit = prod?.units?.find((u) => u.id === row.unitId) || prod?.units?.[0];
            if (!prod || !unit) {
                showToast('تعذر تحديد أحد الأصناف أو وحداته', 'error');
                return false;
            }
            const quantity = Number(row.quantity);
            const baseQuantity = toBaseQuantity(quantity, unit);
            const fromIdx = updatedStockList.findIndex((x) => x.productId === prod.id && x.warehouseId === fromWarehouseId);
            const currentFrom = Number(fromIdx >= 0 ? updatedStockList[fromIdx].baseQuantity : 0) || 0;
            if (!settings.allowNegativeStock && currentFrom < baseQuantity) {
                showToast(`الكمية المطلوبة من «${prod.name}» أكبر من المتوفر في المخزن المصدر`, 'error');
                return false;
            }
            const newFromQty = currentFrom - baseQuantity;
            if (fromIdx >= 0) updatedStockList[fromIdx] = { ...updatedStockList[fromIdx], baseQuantity: newFromQty };
            else updatedStockList.push({ productId: prod.id, warehouseId: fromWarehouseId, baseQuantity: newFromQty });
            const toIdx = updatedStockList.findIndex((x) => x.productId === prod.id && x.warehouseId === toWarehouseId);
            const currentTo = Number(toIdx >= 0 ? updatedStockList[toIdx].baseQuantity : 0) || 0;
            const newToQty = currentTo + baseQuantity;
            if (toIdx >= 0) updatedStockList[toIdx] = { ...updatedStockList[toIdx], baseQuantity: newToQty };
            else updatedStockList.push({ productId: prod.id, warehouseId: toWarehouseId, baseQuantity: newToQty });
            const stamp = `${Date.now()}-${index}`;
            movements.push({
                id: `mov-${stamp}-out`, date: now, financialYearId: settings.activeFinancialYearId || 'fy-initial', productId: prod.id, productName: prod.name,
                warehouseId: fromWarehouseId, warehouseName: fromName, type: 'transfer_out',
                unitName: unit.name, quantityInUnit: quantity, conversionFactor: unit.conversionToBase || 1,
                baseQuantityChange: -baseQuantity, newBaseBalance: newFromQty, userId: currentUser.id, userName: currentUser.name,
                notes: `تحويل جماعي إلى ${toName}${notes ? ` (${notes})` : ''}`,
            });
            movements.push({
                id: `mov-${stamp}-in`, date: now, financialYearId: settings.activeFinancialYearId || 'fy-initial', productId: prod.id, productName: prod.name,
                warehouseId: toWarehouseId, warehouseName: toName, type: 'transfer_in',
                unitName: unit.name, quantityInUnit: quantity, conversionFactor: unit.conversionToBase || 1,
                baseQuantityChange: baseQuantity, newBaseBalance: newToQty, userId: currentUser.id, userName: currentUser.name,
                notes: `تحويل جماعي من ${fromName}${notes ? ` (${notes})` : ''}`,
            });
        }
        await bulkPut('stock', updatedStockList);
        await bulkPut('stock_movements', movements);
        await reloadData();
        showToast(`تم تحويل ${rows.length} صنف بنجاح`, 'success');
        return true;
    }, [products, settings.allowNegativeStock, stock, warehouses, currentUser, reloadData, showToast]);
    // Master Data CRUD
    const saveProduct = useCallback(async (product) => {
        // Re-verify unit conversions and, for a brand-new product, post opening stock exactly once.
        const verifiedUnits = calculateUnitConversions(product.units, product.baseUnitId);
        const existedBefore = products.some((p) => p.id === product.id);
        if (isTrialAccount() && !existedBefore && products.filter((row) => !row?.deletedAt).length >= TRIAL_LIMITS.products) {
            showToast(`وصلت إلى الحد المتاح للأصناف (${TRIAL_LIMITS.products}).`, 'warning');
            return false;
        }
        const openingStockSet = product.openingStockSet === true;
        const openingBaseQuantity = Math.max(0, Number(product.openingBaseQuantity) || 0);
        const now = new Date().toISOString();
        const baseUnit = verifiedUnits.find((u) => u.id === product.baseUnitId) || verifiedUnits[0];
        const cleanProduct = {
            ...product,
            units: verifiedUnits.map((u) => ({ ...u, openingQuantity: Number(u.openingQuantity) || 0 })),
            openingBaseQuantity,
            updatedAt: now,
        };
        // Production accounts normally keep only Telegram's file_id in Turso.
        // If an image was selected while offline, keep the local data URL temporarily
        // until auto-upload finishes and replaces it with Telegram identifiers.
        if (typeof cleanProduct.imageData === 'string' && cleanProduct.imageData.startsWith('data:image/') && !cleanProduct.imagePendingUpload) {
            cleanProduct.imageData = '';
        }
        if (existedBefore && openingStockSet) {
            const warehouseId = settings.activeWarehouseId || warehouses[0]?.id;
            if (warehouseId) {
                const liveStockRows = await getAllFromStore('stock').catch(() => stock || []);
                const stockRow = (Array.isArray(liveStockRows) ? liveStockRows : []).find((row) => row.productId === product.id && row.warehouseId === warehouseId);
                const currentQty = Number(stockRow?.baseQuantity) || 0;
                const targetQty = Math.max(0, openingBaseQuantity);
                const delta = targetQty - currentQty;
                if (Math.abs(delta) > 0.0000001) {
                    const fifo = Array.isArray(cleanProduct.fifoBatches) ? cleanProduct.fifoBatches.map((b) => ({ ...b })) : [];
                    const baseCost = Math.max(0, Number(baseUnit?.costPrice ?? product.costPrice) || 0);
                    if (delta > 0) {
                        fifo.push({
                            id: `opening-edit-${product.id}-${Date.now()}`,
                            purchaseId: 'opening-stock-edit',
                            warehouseId,
                            receivedAt: now,
                            expiryDate: product.expiryDate || '',
                            unitCost: baseCost,
                            remainingBaseQty: delta,
                        });
                    } else {
                        let left = Math.abs(delta);
                        const candidates = fifo
                            .filter((b) => (b.warehouseId === warehouseId || !b.warehouseId) && Number(b.remainingBaseQty) > 0)
                            .sort((a, b) => new Date(a.receivedAt || 0).getTime() - new Date(b.receivedAt || 0).getTime());
                        for (const batch of candidates) {
                            if (left <= 0) break;
                            const take = Math.min(left, Math.max(0, Number(batch.remainingBaseQty) || 0));
                            batch.remainingBaseQty = Math.max(0, (Number(batch.remainingBaseQty) || 0) - take);
                            left -= take;
                        }
                    }
                    cleanProduct.fifoBatches = fifo;
                    await putInStore('stock', { ...(stockRow || {}), productId: product.id, warehouseId, baseQuantity: targetQty, updatedAt: now });
                    await putInStore('stock_movements', {
                        id: `mov-opening-edit-${product.id}-${Date.now()}`,
                        date: now,
                        financialYearId: settings.activeFinancialYearId || 'fy-initial',
                        productId: product.id,
                        productName: product.name,
                        warehouseId,
                        warehouseName: warehouses.find((w) => w.id === warehouseId)?.name || 'صالة العرض',
                        type: 'opening_adjustment',
                        unitName: baseUnit?.name || product.baseUnitName || 'حبة',
                        quantityInUnit: targetQty,
                        conversionFactor: 1,
                        baseQuantityChange: delta,
                        newBaseBalance: targetQty,
                        unitBreakdown: Array.isArray(product.openingUnitBreakdown) ? product.openingUnitBreakdown : [],
                        referenceType: 'OPENING_EDIT',
                        userId: currentUser.id,
                        userName: currentUser.name,
                        notes: `تعديل الكمية الافتتاحية من ${currentQty} إلى ${targetQty} ${baseUnit?.name || product.baseUnitName || 'حبة'}`,
                    });
                }
            }
        }
        if (!existedBefore && openingBaseQuantity > 0) {
            const warehouseId = settings.activeWarehouseId || warehouses[0]?.id;
            const baseCost = Math.max(0, Number(baseUnit?.costPrice ?? product.costPrice) || 0);
            cleanProduct.fifoBatches = [
                ...(Array.isArray(cleanProduct.fifoBatches) ? cleanProduct.fifoBatches : []),
                { id: `opening-${product.id}-${Date.now()}`, purchaseId: 'opening-stock', warehouseId, receivedAt: now, expiryDate: product.expiryDate || '', unitCost: baseCost, remainingBaseQty: openingBaseQuantity },
            ];
            if (warehouseId) {
                await putInStore('stock', { productId: product.id, warehouseId, baseQuantity: openingBaseQuantity });
                // نحفظ الكمية الافتتاحية حسب كل وحدة بدلاً من دمجها كسطر واحد بالوحدة الأساسية.
                const openingRows = Array.isArray(product.openingUnitBreakdown) && product.openingUnitBreakdown.length
                    ? product.openingUnitBreakdown
                    : [{ unitId: baseUnit?.id, unitName: baseUnit?.name || product.baseUnitName || 'حبة', quantity: openingBaseQuantity, conversionToBase: 1, baseQuantity: openingBaseQuantity }];
                let runningBalance = 0;
                for (let index = 0; index < openingRows.length; index += 1) {
                    const row = openingRows[index];
                    const rowBase = Math.max(0, Number(row.baseQuantity) || (Number(row.quantity) || 0) * (Number(row.conversionToBase) || 1));
                    runningBalance += rowBase;
                    await putInStore('stock_movements', {
                        id: `mov-opening-${product.id}-${Date.now()}-${index}`,
                        date: now,
                        productId: product.id,
                        productName: product.name,
                        warehouseId,
                        warehouseName: warehouses.find((w) => w.id === warehouseId)?.name || 'صالة العرض',
                        type: 'opening',
                        unitName: row.unitName || baseUnit?.name || product.baseUnitName || 'حبة',
                        quantityInUnit: Number(row.quantity) || 0,
                        conversionFactor: Number(row.conversionToBase) || 1,
                        baseQuantityChange: rowBase,
                        newBaseBalance: runningBalance,
                        referenceType: 'OPENING',
                        userId: currentUser.id,
                        userName: currentUser.name,
                        notes: Number(row.conversionToBase) > 1
                            ? `كمية افتتاحية: ${row.quantity} ${row.unitName} = ${rowBase} ${baseUnit?.name || product.baseUnitName || 'حبة'}`
                            : `كمية افتتاحية: ${row.quantity} ${row.unitName || baseUnit?.name || 'حبة'}`,
                    });
                }
            }
        }
        cleanProduct.openingStockSet = false;
        await putInStore('products', cleanProduct);
        // Refresh only stores touched by product save; avoid re-reading every large table.
        await reloadStores(['products','stock','stock_movements','sync_queue']);
        showToast(`تم حفظ الصنف: ${cleanProduct.name}`, 'success');
        return true;
    }, [products, settings.activeWarehouseId, settings.activeFinancialYearId, warehouses, currentUser, stock, reloadStores, showToast]);
    const softDeleteProduct = useCallback(async (productId) => {
        const prod = products.find((p) => p.id === productId);
        if (!prod)
            return;
        const updated = {
            ...prod,
            deletedAt: new Date().toISOString(),
        };
        await putInStore('products', updated);
        await reloadData();
        showToast(`تم نقل الصنف «${prod.name}» إلى سلة المحذوفات`, 'info');
    }, [products, reloadData, showToast]);
    const restoreProduct = useCallback(async (productId) => {
        const prod = products.find((p) => p.id === productId);
        if (!prod) return false;
        if (isTrialAccount() && products.filter((row) => !row?.deletedAt).length >= TRIAL_LIMITS.products) {
            showToast(`لا يمكن استرجاع الصنف. الحساب التجريبي يسمح بحد أقصى ${TRIAL_LIMITS.products} أصناف نشطة. احذف صنفاً حالياً أولاً.`, 'warning');
            return false;
        }
        const updated = { ...prod, deletedAt: null };
        await putInStore('products', updated);
        await reloadData();
        showToast(`تم استرجاع الصنف «${prod.name}» بنجاح`, 'success');
        return true;
    }, [products, reloadData, showToast]);
    const permanentDeleteProduct = useCallback(async (productId) => {
        const relatedStock = (stock || []).filter((row) => row?.productId === productId);
        for (const row of relatedStock) {
            try { await deleteFromStore('stock', [productId, row.warehouseId]); } catch (_) {}
        }
        await deleteFromStore('products', productId);
        await reloadData();
        showToast('تم حذف الصنف نهائياً من قاعدة البيانات', 'info');
    }, [stock, reloadData, showToast]);
    const saveCategory = useCallback(async (category) => {
        const existedBefore = categories.some((row) => row.id === category.id);
        if (isTrialAccount() && !existedBefore && categories.filter((row) => !row?.deletedAt).length >= TRIAL_LIMITS.categories) {
            showToast(`وصلت إلى الحد المتاح للتصنيفات (${TRIAL_LIMITS.categories}).`, 'warning');
            return false;
        }
        await putInStore('categories', category);
        await reloadStores(['categories','sync_queue']);
        showToast('تم حفظ التصنيف', 'success');
        return true;
    }, [categories, reloadStores, showToast]);
    const deleteCategory = useCallback(async (categoryId) => {
        await deleteFromStore('categories', categoryId);
        await reloadData();
        showToast('تم حذف التصنيف', 'info');
    }, [reloadData, showToast]);
    const saveCustomer = useCallback(async (customer) => {
        const existing = customers.find((c) => c.id === customer.id);
        if (isTrialAccount() && !existing && customers.filter((row) => !row?.deletedAt).length >= TRIAL_LIMITS.customers) {
            showToast(`وصلت إلى الحد المتاح للعملاء (${TRIAL_LIMITS.customers}).`, 'warning');
            return false;
        }
        const openingBalanceAmount = Math.max(0, Number(customer.openingBalanceAmount) || 0);
        const openingBalanceSide = customer.openingBalanceSide === 'theirs' ? 'theirs' : 'ours';
        const oldOpeningAmount = Math.max(0, Number(existing?.openingBalanceAmount) || 0);
        const oldOpeningSide = existing?.openingBalanceSide === 'theirs' ? 'theirs' : 'ours';
        const oldOpeningSigned = oldOpeningAmount > 0 ? (oldOpeningSide === 'ours' ? oldOpeningAmount : -oldOpeningAmount) : 0;
        const newOpeningSigned = openingBalanceAmount > 0 ? (openingBalanceSide === 'ours' ? openingBalanceAmount : -openingBalanceAmount) : 0;
        const currentBalance = existing ? (Number(existing.balance) || 0) : (Number(customer.balance) || 0);
        const nextBalance = currentBalance - oldOpeningSigned + newOpeningSigned;
        const nextCustomer = { ...customer, openingBalanceAmount, openingBalanceSide, balance: nextBalance };
        await putInStore('customers', nextCustomer);
        const openingStatementId = `stmt-opening-customer-${customer.id}`;
        if (openingBalanceAmount > 0) {
            await putInStore('partner_statements', {
                id: openingStatementId,
                partnerType: 'customer',
                partnerId: customer.id,
                partnerName: customer.name,
                date: customer.createdAt || new Date().toISOString(),
                type: 'opening',
                referenceType: 'OPENING_BALANCE',
                referenceId: customer.id,
                referenceNumber: 'OPENING',
                description: `رصيد افتتاحي للعميل - ${openingBalanceSide === 'ours' ? 'لنا' : 'علينا'}`,
                debit: newOpeningSigned > 0 ? openingBalanceAmount : 0,
                credit: newOpeningSigned < 0 ? openingBalanceAmount : 0,
                runningBalance: newOpeningSigned,
            });
        } else if (oldOpeningAmount > 0) {
            await deleteFromStore('partner_statements', openingStatementId);
        }
        await reloadStores(['customers','partner_statements','sync_queue']);
        showToast(`تم حفظ العميل: ${customer.name}`, 'success');
        return true;
    }, [customers, reloadStores, showToast]);
    const deleteCustomer = useCallback(async (customerId) => {
        const cust = customers.find((c) => c.id === customerId);
        if (cust) {
            await putInStore('customers', { ...cust, deletedAt: new Date().toISOString() });
            await reloadData();
            showToast('تم نقل العميل إلى سلة المحذوفات', 'info');
        }
    }, [customers, reloadData, showToast]);
    const softDeleteCustomer = deleteCustomer;
    const restoreCustomer = useCallback(async (customerId) => {
        const cust = customers.find((c) => c.id === customerId);
        if (!cust) return false;
        if (isTrialAccount() && customers.filter((row) => !row?.deletedAt).length >= TRIAL_LIMITS.customers) {
            showToast(`لا يمكن استرجاع العميل. الحساب التجريبي يسمح بحد أقصى ${TRIAL_LIMITS.customers} عميلاً نشطاً. احذف عميلاً حالياً أولاً.`, 'warning');
            return false;
        }
        await putInStore('customers', { ...cust, deletedAt: null });
        await reloadData();
        showToast(`تم استرجاع العميل «${cust.name}»`, 'success');
        return true;
    }, [customers, reloadData, showToast]);
    const permanentDeleteCustomer = useCallback(async (customerId) => {
        await deleteFromStore('customers', customerId);
        await reloadData();
        showToast('تم حذف العميل نهائياً من قاعدة البيانات', 'info');
    }, [reloadData, showToast]);
    const saveSupplier = useCallback(async (supplier) => {
        const existing = suppliers.find((s) => s.id === supplier.id);
        const openingBalanceAmount = Math.max(0, Number(supplier.openingBalanceAmount) || 0);
        const openingBalanceSide = supplier.openingBalanceSide === 'ours' ? 'ours' : 'theirs';
        const oldOpeningAmount = Math.max(0, Number(existing?.openingBalanceAmount) || 0);
        const oldOpeningSide = existing?.openingBalanceSide === 'ours' ? 'ours' : 'theirs';
        // Supplier balance convention: positive = علينا للمورد, negative = لنا عند المورد.
        const oldOpeningSigned = oldOpeningAmount > 0 ? (oldOpeningSide === 'theirs' ? oldOpeningAmount : -oldOpeningAmount) : 0;
        const newOpeningSigned = openingBalanceAmount > 0 ? (openingBalanceSide === 'theirs' ? openingBalanceAmount : -openingBalanceAmount) : 0;
        const currentBalance = existing ? (Number(existing.balance) || 0) : (Number(supplier.balance) || 0);
        const nextBalance = currentBalance - oldOpeningSigned + newOpeningSigned;
        const nextSupplier = { ...supplier, openingBalanceAmount, openingBalanceSide, balance: nextBalance };
        await putInStore('suppliers', nextSupplier);
        const openingStatementId = `stmt-opening-supplier-${supplier.id}`;
        if (openingBalanceAmount > 0) {
            await putInStore('partner_statements', {
                id: openingStatementId,
                partnerType: 'supplier',
                partnerId: supplier.id,
                partnerName: supplier.name,
                date: supplier.createdAt || new Date().toISOString(),
                type: 'opening',
                referenceType: 'OPENING_BALANCE',
                referenceId: supplier.id,
                referenceNumber: 'OPENING',
                description: `رصيد افتتاحي للمورد - ${openingBalanceSide === 'ours' ? 'لنا' : 'علينا'}`,
                debit: newOpeningSigned < 0 ? openingBalanceAmount : 0,
                credit: newOpeningSigned > 0 ? openingBalanceAmount : 0,
                runningBalance: newOpeningSigned,
            });
        } else if (oldOpeningAmount > 0) {
            await deleteFromStore('partner_statements', openingStatementId);
        }
        await reloadData();
        showToast(`تم حفظ المورد: ${supplier.name}`, 'success');
    }, [suppliers, reloadData, showToast]);
    const deleteSupplier = useCallback(async (supplierId) => {
        const supp = suppliers.find((s) => s.id === supplierId);
        if (supp) {
            await putInStore('suppliers', { ...supp, deletedAt: new Date().toISOString() });
            await reloadData();
            showToast('تم نقل المورد إلى سلة المحذوفات', 'info');
        }
    }, [suppliers, reloadData, showToast]);
    const softDeleteSupplier = deleteSupplier;
    const restoreSupplier = useCallback(async (supplierId) => {
        const supp = suppliers.find((s) => s.id === supplierId);
        if (!supp)
            return;
        await putInStore('suppliers', { ...supp, deletedAt: null });
        await reloadData();
        showToast(`تم استرجاع المورد «${supp.name}»`, 'success');
    }, [suppliers, reloadData, showToast]);
    const permanentDeleteSupplier = useCallback(async (supplierId) => {
        await deleteFromStore('suppliers', supplierId);
        await reloadData();
        showToast('تم حذف المورد نهائياً من قاعدة البيانات', 'info');
    }, [reloadData, showToast]);
    const saveAccount = useCallback(async (account) => {
        // Always keep one starred/default account. The starred account is used automatically
        // in every account/cashbox dropdown across POS, vouchers, expenses and purchases.
        const mustBeDefault = Boolean(account.isDefault) || accounts.length === 0 || !accounts.some((a) => a.isDefault && a.id !== account.id);
        const nextAccount = normalizeAccountRecord({ ...account, isDefault: mustBeDefault });
        if (nextAccount.isDefault) {
            for (const existing of accounts) {
                if (existing.id !== nextAccount.id && existing.isDefault) {
                    await putInStore('accounts', { ...existing, isDefault: false });
                }
            }
        }
        await putInStore('accounts', nextAccount);
        await reloadData();
        showToast(nextAccount.isDefault ? 'تم حفظ الحساب وتعيينه كحساب افتراضي ★' : 'تم حفظ الحساب المالي', 'success');
    }, [accounts, reloadData, showToast]);
    const deleteAccount = useCallback(async (accountId) => {
        const account = accounts.find((a) => a.id === accountId);
        if (!account)
            return;
        if (accounts.length <= 1) {
            showToast('يجب الإبقاء على حساب مالي واحد على الأقل', 'warning');
            return;
        }
        const remaining = accounts.filter((a) => a.id !== accountId);
        await deleteFromStore('accounts', accountId);
        if (account.isDefault && remaining.length > 0) {
            await putInStore('accounts', { ...remaining[0], isDefault: true });
        }
        await reloadData();
        showToast(`تم حذف الحساب «${account.name}»`, 'info');
    }, [accounts, reloadData, showToast]);
    const transferBetweenAccounts = useCallback(async (fromId, toId, amount, notes) => {
        const fromAcc = accounts.find((a) => a.id === fromId);
        const toAcc = accounts.find((a) => a.id === toId);
        if (!fromAcc || !toAcc)
            return;
        const numericAmount = finiteNumber(amount, 0);
        const fromBalance = finiteNumber(fromAcc.balance, 0);
        const toBalance = finiteNumber(toAcc.balance, 0);
        if (numericAmount <= 0) {
            showToast('يرجى إدخال مبلغ تحويل صالح', 'warning');
            return;
        }
        if (fromBalance < numericAmount) {
            showToast('الرصيد في الحساب المصدر غير كافٍ!', 'error');
            return;
        }
        await putInStore('accounts', normalizeAccountRecord({ ...fromAcc, balance: fromBalance - numericAmount }));
        await putInStore('accounts', normalizeAccountRecord({ ...toAcc, balance: toBalance + numericAmount }));
        const transferRecord = {
            id: 'trans-' + Date.now(),
            date: new Date().toISOString(),
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            fromAccountId: fromId,
            fromAccountName: fromAcc.name,
            toAccountId: toId,
            toAccountName: toAcc.name,
            amount: numericAmount,
            notes,
            userId: currentUser.id,
            userName: currentUser.name,
        };
        await putInStore('transfers', transferRecord);
        await reloadData();
        showToast(`تم تحويل ${amount} ${settings.currencySymbol} بنجاح`, 'success');
    }, [accounts, currentUser, settings.currencySymbol, settings.activeFinancialYearId, reloadData, showToast]);
    const saveExpense = useCallback(async (exp) => {
        const newExpense = {
            ...exp,
            id: 'exp-' + Date.now(),
            financialYearId: exp.financialYearId || settings.activeFinancialYearId || 'fy-initial',
            createdAt: new Date().toISOString(),
        };
        await putInStore('expenses', newExpense);
        const acc = accounts.find((a) => a.id === exp.accountId);
        if (acc)
            await putInStore('accounts', { ...acc, balance: acc.balance - exp.amount });
        if (activeShift && acc?.type === 'cash') {
            await putInStore('shifts', {
                ...activeShift,
                totalCashExpenses: activeShift.totalCashExpenses + exp.amount,
                expectedCash: activeShift.expectedCash - exp.amount,
            });
        }
        await reloadData();
        showToast('تم تسجيل المصروف بنجاح', 'success');
    }, [accounts, activeShift, reloadData, showToast, settings.activeFinancialYearId]);
    const recordExpense = useCallback(async (payload) => {
        const acc = accounts.find((a) => a.id === payload.accountId);
        if (!acc) {
            showToast('يرجى اختيار حساب مالي صالح للمصروف', 'error');
            return;
        }
        await saveExpense({
            date: payload.date || new Date().toISOString(),
            category: payload.category,
            amount: payload.amount,
            accountId: acc.id,
            accountName: acc.name,
            notes: payload.notes,
            userId: currentUser.id,
            userName: currentUser.name,
            deletedAt: null,
        });
    }, [accounts, currentUser, saveExpense, showToast]);
    const updateExpense = useCallback(async (nextExpense) => {
        const previous = expenses.find((e) => e.id === nextExpense.id);
        await assertOpenFinancialRecord(previous);
        if (!previous)
            return;
        const oldAcc = accounts.find((a) => a.id === previous.accountId);
        const newAcc = accounts.find((a) => a.id === nextExpense.accountId);
        if (!newAcc) {
            showToast('الحساب المالي الجديد غير موجود', 'error');
            return;
        }
        if (oldAcc && oldAcc.id === newAcc.id) {
            await putInStore('accounts', {
                ...oldAcc,
                balance: oldAcc.balance + previous.amount - nextExpense.amount,
            });
        }
        else {
            if (oldAcc)
                await putInStore('accounts', { ...oldAcc, balance: oldAcc.balance + previous.amount });
            await putInStore('accounts', { ...newAcc, balance: newAcc.balance - nextExpense.amount });
        }
        await putInStore('expenses', {
            ...nextExpense,
            accountName: newAcc.name,
            deletedAt: null,
        });
        await reloadData();
        showToast('تم تعديل المصروف وإعادة احتساب أثره المالي', 'success');
    }, [expenses, accounts, reloadData, showToast]);
    const deleteExpense = useCallback(async (id) => {
        const exp = expenses.find((e) => e.id === id);
        await assertOpenFinancialRecord(exp);
        if (!exp || exp.deletedAt)
            return;
        const acc = accounts.find((a) => a.id === exp.accountId);
        if (acc)
            await putInStore('accounts', { ...acc, balance: acc.balance + exp.amount });
        if (activeShift && acc?.type === 'cash') {
            await putInStore('shifts', {
                ...activeShift,
                totalCashExpenses: Math.max(0, activeShift.totalCashExpenses - exp.amount),
                expectedCash: activeShift.expectedCash + exp.amount,
            });
        }
        await putInStore('audit_logs', { id:`audit-exp-del-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date:new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type:'expense_deleted_reversal', referenceId:exp.id, originalDate:exp.date || exp.createdAt, accountId:exp.accountId, accountName:exp.accountName, amount:finiteNumber(exp.amount,0), category:exp.category, userId:currentUser.id, userName:currentUser.name });
        await putInStore('expenses', { ...exp, deletedAt: new Date().toISOString() });
        await reloadData();
        showToast('تم نقل المصروف إلى سلة المحذوفات وإلغاء أثره المالي', 'info');
    }, [expenses, accounts, activeShift, currentUser, reloadData, showToast]);
    const softDeleteExpense = deleteExpense;
    const permanentDeleteExpense = useCallback(async (id) => {
        const exp = expenses.find((e) => e.id === id);
        await assertOpenFinancialRecord(exp);
        if (!exp?.deletedAt) {
            showToast('يجب نقل المصروف إلى سلة المحذوفات أولاً', 'warning');
            return false;
        }
        await deleteFromStore('expenses', id);
        await reloadData();
        showToast('تم حذف المصروف نهائياً من قاعدة البيانات', 'info');
        return true;
    }, [expenses, reloadData, showToast]);
    const restoreExpense = useCallback(async (id) => {
        const exp = expenses.find((e) => e.id === id);
        await assertOpenFinancialRecord(exp);
        if (!exp || !exp.deletedAt)
            return;
        const acc = accounts.find((a) => a.id === exp.accountId);
        if (acc)
            await putInStore('accounts', { ...acc, balance: acc.balance - exp.amount });
        await putInStore('expenses', { ...exp, deletedAt: null });
        await reloadData();
        showToast('تم استرجاع المصروف وإعادة تطبيق أثره المالي', 'success');
    }, [expenses, accounts, reloadData, showToast]);
    const saveWarehouse = useCallback(async (warehouse) => {
        const existedBefore = warehouses.some((row) => row.id === warehouse.id);
        if (isTrialAccount() && !existedBefore && warehouses.length >= TRIAL_LIMITS.warehouses) {
            showToast('لا يمكن إضافة مخزن أو فرع آخر إلى هذا الحساب.', 'warning');
            return false;
        }
        if (warehouse.isDefault) {
            for (const existing of warehouses) {
                if (existing.id !== warehouse.id && existing.isDefault) {
                    await putInStore('warehouses', { ...existing, isDefault: false });
                }
            }
        }
        await putInStore('warehouses', warehouse);
        await reloadData();
        showToast('تم حفظ المخزن/الفرع بنجاح', 'success');
        return true;
    }, [warehouses, reloadData, showToast]);
    const deleteWarehouse = useCallback(async (warehouseId) => {
        const warehouse = warehouses.find((w) => w.id === warehouseId);
        if (!warehouse)
            return;
        if (warehouses.length <= 1) {
            showToast('يجب الإبقاء على مخزن واحد على الأقل', 'warning');
            return;
        }
        const hasStock = stock.some((item) => item.warehouseId === warehouseId && Math.abs(item.baseQuantity) > 0.00001);
        if (hasStock) {
            showToast('لا يمكن حذف مخزن يحتوي على رصيد. انقل أو صفّر المخزون أولاً.', 'warning');
            return;
        }
        await deleteFromStore('warehouses', warehouseId);
        const remaining = warehouses.filter((w) => w.id !== warehouseId);
        if (warehouse.isDefault && remaining.length > 0) {
            await putInStore('warehouses', { ...remaining[0], isDefault: true });
        }
        if (settings.activeWarehouseId === warehouseId && remaining.length > 0) {
            const nextSettings = { ...settings, activeWarehouseId: remaining[0].id };
            await putInStore('settings', { key: 'store_config', ...nextSettings });
        }
        await reloadData();
        showToast(`تم حذف المخزن «${warehouse.name}»`, 'info');
    }, [warehouses, stock, settings, reloadData, showToast]);
    const refreshData = reloadData;
    // Vouchers (سندات القبض والصرف)
    const createVoucher = useCallback(async (payload) => {
        if (!payload.amount || payload.amount <= 0) {
            showToast('يرجى إدخال مبلغ صحيح للسند', 'error');
            return null;
        }
        const now = payload.date ? new Date(payload.date).toISOString() : new Date().toISOString();
        const nextNumber = (vouchers[0]?.voucherNumber || 100) + 1;
        const voucherId = 'vouch-' + Date.now();
        const account = accounts.find((a) => a.id === payload.accountId);
        const voucher = {
            id: voucherId,
            voucherNumber: nextNumber,
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            type: payload.type,
            partyType: payload.partyType,
            partyId: payload.partyId,
            partyName: payload.partyName,
            amount: payload.amount,
            date: now,
            sourceType: payload.sourceType,
            accountId: payload.accountId,
            accountName: account?.name,
            notes: payload.notes,
            userId: currentUser.id,
            userName: currentUser.name,
            createdAt: new Date().toISOString(),
        };
        await putInStore('vouchers', voucher);
        // 1. Account financial impact (if paid/received via account)
        if (payload.sourceType === 'account' && account) {
            const newBalance = payload.type === 'receipt'
                ? account.balance + payload.amount
                : account.balance - payload.amount;
            await putInStore('accounts', { ...account, balance: newBalance });
        }
        // 2. Customer or Supplier balance impact
        if (payload.partyType === 'customer' && payload.partyId) {
            const cust = customers.find((c) => c.id === payload.partyId);
            if (cust) {
                const newCustBalance = payload.type === 'receipt'
                    ? cust.balance - payload.amount
                    : cust.balance + payload.amount;
                await putInStore('customers', { ...cust, balance: newCustBalance });
                const stmt = {
                    id: 'stmt-' + Date.now(),
                    financialYearId: settings.activeFinancialYearId || 'fy-initial',
                    partnerType: 'customer',
                    partnerId: cust.id,
                    partnerName: cust.name,
                    date: now,
                    referenceType: payload.type === 'receipt' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
                    referenceId: voucher.id,
                    referenceNumber: voucher.voucherNumber.toString(),
                    description: `${payload.type === 'receipt' ? 'سند قبض' : 'سند صرف'} رقم ${voucher.voucherNumber} ${payload.notes ? `(${payload.notes})` : ''}`,
                    debit: payload.type === 'payment' ? payload.amount : 0,
                    credit: payload.type === 'receipt' ? payload.amount : 0,
                    runningBalance: newCustBalance,
                };
                await putInStore('partner_statements', stmt);
            }
        }
        else if (payload.partyType === 'supplier' && payload.partyId) {
            const supp = suppliers.find((s) => s.id === payload.partyId);
            if (supp) {
                const newSuppBalance = payload.type === 'payment'
                    ? supp.balance - payload.amount
                    : supp.balance + payload.amount;
                await putInStore('suppliers', { ...supp, balance: newSuppBalance });
                const stmt = {
                    id: 'stmt-' + Date.now(),
                    financialYearId: settings.activeFinancialYearId || 'fy-initial',
                    partnerType: 'supplier',
                    partnerId: supp.id,
                    partnerName: supp.name,
                    date: now,
                    referenceType: payload.type === 'receipt' ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER',
                    referenceId: voucher.id,
                    referenceNumber: voucher.voucherNumber.toString(),
                    description: `${payload.type === 'receipt' ? 'سند قبض (استرداد)' : 'سند صرف توريد'} رقم ${voucher.voucherNumber} ${payload.notes ? `(${payload.notes})` : ''}`,
                    debit: payload.type === 'payment' ? payload.amount : 0,
                    credit: payload.type === 'receipt' ? payload.amount : 0,
                    runningBalance: newSuppBalance,
                };
                await putInStore('partner_statements', stmt);
            }
        }
        await reloadData();
        showToast(`تم حفظ ${payload.type === 'receipt' ? 'سند القبض' : 'سند الصرف'} رقم [${nextNumber}] بنجاح`, 'success');
        return voucher;
    }, [vouchers, accounts, customers, suppliers, currentUser, reloadData, showToast, settings.activeFinancialYearId]);
    const deleteVoucher = useCallback(async (id) => {
        const v = vouchers.find((item) => item.id === id);
        await assertOpenFinancialRecord(v);
        if (!v)
            return;
        // Reverse account
        if (v.sourceType === 'account' && v.accountId) {
            const acc = accounts.find((a) => a.id === v.accountId);
            if (acc) {
                const revBalance = v.type === 'receipt' ? acc.balance - v.amount : acc.balance + v.amount;
                await putInStore('accounts', { ...acc, balance: revBalance });
            }
        }
        // Reverse customer or supplier
        if (v.partyType === 'customer' && v.partyId) {
            const cust = customers.find((c) => c.id === v.partyId);
            if (cust) {
                const revBalance = v.type === 'receipt' ? cust.balance + v.amount : cust.balance - v.amount;
                await putInStore('customers', { ...cust, balance: revBalance });
            }
        }
        else if (v.partyType === 'supplier' && v.partyId) {
            const supp = suppliers.find((s) => s.id === v.partyId);
            if (supp) {
                const revBalance = v.type === 'payment' ? supp.balance + v.amount : supp.balance - v.amount;
                await putInStore('suppliers', { ...supp, balance: revBalance });
            }
        }
        await putInStore('audit_logs', { id:`audit-voucher-del-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date:new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type:'voucher_deleted_reversal', referenceId:v.id, originalDate:v.date || v.createdAt, voucherNumber:v.voucherNumber, partyName:v.partyName, voucherType:v.type, accountId:v.accountId, accountName:v.accountName, amount:finiteNumber(v.amount,0), userId:currentUser.id, userName:currentUser.name });
        await deleteFromStore('vouchers', id);
        await reloadData();
        showToast('تم حذف السند وإلغاء أثره المالي بنجاح', 'info');
    }, [vouchers, accounts, customers, suppliers, currentUser, reloadData, showToast, settings.activeFinancialYearId]);
    const recordCustomerPayment = useCallback(async (payload) => {
        const customer = customers.find((c) => c.id === payload.customerId);
        if (!customer) {
            showToast('العميل غير موجود', 'error');
            return;
        }
        await createVoucher({
            type: 'receipt',
            partyType: 'customer',
            partyId: customer.id,
            partyName: customer.name,
            amount: payload.amount,
            sourceType: 'account',
            accountId: payload.accountId,
            notes: payload.notes,
        });
    }, [customers, createVoucher, showToast]);
    const recordSupplierPayment = useCallback(async (payload) => {
        const supplier = suppliers.find((s) => s.id === payload.supplierId);
        if (!supplier) {
            showToast('المورد غير موجود', 'error');
            return;
        }
        await createVoucher({
            type: 'payment',
            partyType: 'supplier',
            partyId: supplier.id,
            partyName: supplier.name,
            amount: payload.amount,
            sourceType: 'account',
            accountId: payload.accountId,
            notes: payload.notes,
        });
    }, [suppliers, createVoucher, showToast]);
    // Employees CRUD
    const saveEmployee = useCallback(async (employee) => {
        const existedBefore = employees.some((row) => row.id === employee?.id);
        if (isTrialAccount() && !existedBefore) {
            showToast('إضافة موظفين جدد غير متاحة لهذا الحساب.', 'warning');
            return false;
        }
        const roleCode = String(employee?.role || 'custom').trim().toLowerCase();
        const nextEmployee = { ...employee, permissions: normalizeEmployeePermissions(employee?.permissions || {}, roleCode), authVersion: employee.authVersion || `AUTH-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, updatedAt: new Date().toISOString() };
        await putInStore('employees', nextEmployee);
        await reloadStores(['employees','sync_queue']);
        showToast(`تم حفظ بيانات الموظف [${nextEmployee.name}] بنجاح`, 'success');
        return true;
    }, [employees, reloadStores, showToast]);
    const deleteEmployee = useCallback(async (id) => {
        await deleteFromStore('employees', id);
        await reloadData();
        showToast('تم حذف الموظف بنجاح', 'info');
    }, [reloadData, showToast]);
    // Reverse a sales-return document itself (used when deleting a return or cascading from original sale deletion).
    const reverseReturnInvoice = useCallback(async (ret, { deleteRecord = true } = {}) => {
        if (!ret || ret.type !== 'return') return false;
        await assertOpenFinancialRecord(ret);
        const [liveReverseStock, liveReverseProducts] = await Promise.all([getAllFromStore('stock'), getAllFromStore('products')]);
        let updatedStockList = [...(liveReverseStock || [])];
        let updatedProducts = (Array.isArray(liveReverseProducts) && liveReverseProducts.length ? liveReverseProducts : products).map((p) => ({ ...p, fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.map((b) => ({ ...b })) : [] }));
        const deductOne = async (productId, productName, baseQty, meta = {}) => {
            const qty = Math.max(0, finiteNumber(baseQty, 0));
            if (!productId || qty <= 0) return;
            updatedStockList = await addStockDelta({ rows: updatedStockList, productId, warehouseId: ret.warehouseId, delta: -qty, movement: {
                productName, warehouseName: warehouses.find((w) => String(w.id) === String(ret.warehouseId))?.name || 'المخزن', type: meta.type || 'reverse_sales_return', unitName: meta.unitName || 'وحدة أساسية', quantityInUnit: meta.quantityInUnit ?? qty, conversionFactor: meta.conversionFactor || 1, referenceId: ret.id, referenceType: 'RETURN_REVERSAL', originalReferenceId: ret.originalInvoiceId, isReversal: true,
            }});
        };
        for (const item of (ret.items || [])) {
            if (item.isManufacturedMeal && Array.isArray(item.recipeConsumption) && item.recipeConsumption.length) {
                for (const ing of item.recipeConsumption) await deductOne(ing.productId, ing.productName, ing.baseQuantity, { type: 'reverse_recipe_sales_return', unitName: ing.unitName, quantityInUnit: finiteNumber(ing.quantityPerMeal, 0) * finiteNumber(item.quantity, 0), conversionFactor: ing.conversionFactor });
            } else {
                await deductOne(item.productId, item.productName, finiteNumber(item.baseQuantity, finiteNumber(item.quantity, 0) * finiteNumber(item.conversionFactor, 1)), { unitName: item.unitName, quantityInUnit: item.quantity, conversionFactor: item.conversionFactor });
            }
        }
        updatedProducts = removeReturnFifoBatches(updatedProducts, ret.id);
        await bulkPut('stock', updatedStockList);
        await bulkPut('products', updatedProducts);
        const debtReversed = Math.max(0, finiteNumber(ret.returnAllocation?.debtReversed, ret.paymentType === 'customer_balance' ? ret.grandTotal : 0));
        if (debtReversed > 0 && ret.customerId && ret.customerId !== CASH_CUSTOMER.id) {
            const currentCustomers = await getAllFromStore('customers');
            const cust = currentCustomers.find((c) => c.id === ret.customerId);
            if (cust) await appendReversalStatement({ partnerType: 'customer', partner: cust, amount: debtReversed, referenceType: 'RETURN_REVERSAL', referenceId: ret.id, referenceNumber: ret.invoiceNumber, description: `عكس مرتجع المبيعات ${ret.invoiceNumber}`, direction: 'increase' });
        }
        const refunds = Array.isArray(ret.returnAllocation?.accountRefunds) ? ret.returnAllocation.accountRefunds : (Array.isArray(ret.payments) ? ret.payments : []);
        const currentAccounts = await getAllFromStore('accounts');
        const nextAccounts = currentAccounts.map((a) => ({ ...a }));
        for (const refund of refunds) {
            const ai = nextAccounts.findIndex((a) => a.id === refund.accountId);
            if (ai >= 0) nextAccounts[ai].balance = finiteNumber(nextAccounts[ai].balance, 0) + finiteNumber(refund.amount, 0);
        }
        if (nextAccounts.length) await bulkPut('accounts', nextAccounts);
        const shift = ret.shiftId ? (await getAllFromStore('shifts')).find((x) => x.id === ret.shiftId) : null;
        if (shift) {
            const cashRefund = refunds.filter((r) => r.method === 'cash' || currentAccounts.find((a) => a.id === r.accountId)?.type === 'cash').reduce((s, r) => s + finiteNumber(r.amount, 0), 0);
            if (cashRefund > 0) await putInStore('shifts', { ...shift, totalCashReturns: finiteNumber(shift.totalCashReturns, 0) - cashRefund, expectedCash: finiteNumber(shift.expectedCash, 0) + cashRefund });
        }
        await putInStore('audit_logs', { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date: new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type: 'return_deleted_reversal', referenceId: ret.id, originalReferenceId: ret.originalInvoiceId, originalDate: ret.date, referenceNumber: ret.invoiceNumber, amount: ret.grandTotal, debtReversed, refundsReversed: refunds, userId: currentUser.id, userName: currentUser.name });
        if (deleteRecord) await deleteFromStore('invoices', ret.id);
        return true;
    }, [products, warehouses, currentUser, addStockDelta, removeReturnFifoBatches, appendReversalStatement]);

    // Sales invoice deletion with a true reverse entry for inventory, customer debt, payment accounts, shift totals and FIFO.
    const deleteInvoice = useCallback(async (id, options = {}) => {
        const inv = await getFromStore('invoices', id);
        await assertOpenFinancialRecord(inv);
        if (!inv) return false;
        if (inv.type === 'return') {
            await reverseReturnInvoice(inv, { deleteRecord: true });
            await reloadData();
            if (!options.silent) showToast(`تم حذف المرتجع [${inv.invoiceNumber}] وعكس أثره بالكامل`, 'success');
            return true;
        }
        // If returns already exist, cancel their effects first so the original sale can be reversed exactly once.
        const linkedReturns = await queryAllStoreRecords('invoices', {
            filters: { type: 'return', originalInvoiceId: inv.id },
            deletedMode: 'all',
            pageSize: 200,
        });
        for (const ret of linkedReturns) await reverseReturnInvoice(ret, { deleteRecord: true });
        const [liveDeleteStock, liveDeleteProducts] = await Promise.all([getAllFromStore('stock'), getAllFromStore('products')]);
        let updatedStockList = [...(liveDeleteStock || [])];
        let updatedProducts = (Array.isArray(liveDeleteProducts) && liveDeleteProducts.length ? liveDeleteProducts : products).map((p) => ({ ...p, fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.map((b) => ({ ...b })) : [] }));
        const restoreOne = async (productId, productName, baseQty, costTotal, meta = {}) => {
            const qty = Math.max(0, finiteNumber(baseQty, 0));
            if (!productId || qty <= 0) return;
            updatedStockList = await addStockDelta({ rows: updatedStockList, productId, warehouseId: inv.warehouseId, delta: qty, movement: {
                productName, warehouseName: warehouses.find((w) => String(w.id) === String(inv.warehouseId))?.name || 'المخزن', type: meta.type || 'sale_delete_reversal', unitName: meta.unitName || 'وحدة أساسية', quantityInUnit: meta.quantityInUnit ?? qty, conversionFactor: meta.conversionFactor || 1, referenceId: inv.id, referenceType: 'SALE_DELETE_REVERSAL', isReversal: true, recipeId: meta.recipeId, manufacturedProductId: meta.manufacturedProductId, manufacturedProductName: meta.manufacturedProductName,
            }});
            updatedProducts = restoreFifoQuantity(updatedProducts, productId, inv.warehouseId, qty, costTotal, { referenceId: inv.id });
        };
        for (const item of (inv.items || [])) {
            if (item.isManufacturedMeal && Array.isArray(item.recipeConsumption) && item.recipeConsumption.length) {
                for (const ing of item.recipeConsumption) await restoreOne(ing.productId, ing.productName, ing.baseQuantity, ing.fifoCostTotal, { type: 'recipe_sale_delete_reversal', unitName: ing.unitName, quantityInUnit: finiteNumber(ing.quantityPerMeal, 0) * finiteNumber(item.quantity, 0), conversionFactor: ing.conversionFactor, recipeId: item.recipeId, manufacturedProductId: item.productId, manufacturedProductName: item.productName });
            } else {
                await restoreOne(item.productId, item.productName, finiteNumber(item.baseQuantity, finiteNumber(item.quantity, 0) * finiteNumber(item.conversionFactor, 1)), item.fifoCostTotal, { unitName: item.unitName, quantityInUnit: item.quantity, conversionFactor: item.conversionFactor });
            }
        }
        await bulkPut('stock', updatedStockList);
        await bulkPut('products', updatedProducts);
        const currentCustomers = await getAllFromStore('customers');
        const cust = currentCustomers.find((c) => c.id === inv.customerId);
        const debtAmount = Math.max(0, finiteNumber(inv.remainingAmount, 0));
        if (cust && debtAmount > 0 && inv.customerId !== CASH_CUSTOMER.id) await appendReversalStatement({ partnerType: 'customer', partner: cust, amount: debtAmount, referenceType: 'SALE_DELETE_REVERSAL', referenceId: inv.id, referenceNumber: inv.invoiceNumber, description: `قيد عكسي لحذف فاتورة المبيعات ${inv.invoiceNumber}`, direction: 'decrease' });
        const currentAccounts = await getAllFromStore('accounts');
        const updatedAccounts = currentAccounts.map((a) => ({ ...a }));
        for (const pay of (inv.payments || [])) {
            const ai = updatedAccounts.findIndex((a) => a.id === pay.accountId);
            if (ai >= 0) updatedAccounts[ai].balance = finiteNumber(updatedAccounts[ai].balance, 0) - finiteNumber(pay.amount, 0);
        }
        if (updatedAccounts.length) await bulkPut('accounts', updatedAccounts);
        const shift = inv.shiftId ? (await getAllFromStore('shifts')).find((x) => x.id === inv.shiftId) : null;
        if (shift) {
            const cashPaid = (inv.payments || []).filter((p) => p.method === 'cash' || currentAccounts.find((a) => a.id === p.accountId)?.type === 'cash').reduce((s, p) => s + finiteNumber(p.amount, 0), 0) - Math.max(0, finiteNumber(inv.changeAmount, 0));
            const otherPaid = (inv.payments || []).filter((p) => !(p.method === 'cash' || currentAccounts.find((a) => a.id === p.accountId)?.type === 'cash')).reduce((s, p) => s + finiteNumber(p.amount, 0), 0);
            await putInStore('shifts', { ...shift, totalCashSales: finiteNumber(shift.totalCashSales, 0) - Math.max(0, cashPaid), totalOtherSales: finiteNumber(shift.totalOtherSales, 0) - otherPaid, expectedCash: finiteNumber(shift.expectedCash, 0) - Math.max(0, cashPaid) });
        }
        await putInStore('audit_logs', { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date: new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type: 'sale_deleted_reversal', referenceId: inv.id, referenceNumber: inv.invoiceNumber, originalDate: inv.date, debtReversed: debtAmount, paymentsReversed: inv.payments || [], userId: currentUser.id, userName: currentUser.name });
        await deleteFromStore('invoices', id);
        await reloadData();
        if (!options.silent) showToast(`تم حذف الفاتورة [${inv.invoiceNumber}] وعكس المخزون والدين والدفع بالكامل`, 'success');
        return true;
    }, [products, warehouses, currentUser, reloadData, showToast, addStockDelta, restoreFifoQuantity, appendReversalStatement, reverseReturnInvoice]);

    // Purchase invoice deletion with full reverse entry. Purchased stock is removed even if the resulting stock becomes negative.
    const deletePurchase = useCallback(async (id, options = {}) => {
        const pur = await getFromStore('purchases', id);
        await assertOpenFinancialRecord(pur);
        if (!pur) return false;
        const [livePurchaseDeleteStock, livePurchaseDeleteProducts] = await Promise.all([getAllFromStore('stock'), getAllFromStore('products')]);
        let updatedStockList = [...(livePurchaseDeleteStock || [])];
        let updatedProducts = (Array.isArray(livePurchaseDeleteProducts) && livePurchaseDeleteProducts.length ? livePurchaseDeleteProducts : products).map((p) => ({ ...p, fifoBatches: Array.isArray(p.fifoBatches) ? p.fifoBatches.map((b) => ({ ...b })) : [] }));
        for (const item of (pur.items || [])) {
            const baseQty = Math.max(0, finiteNumber(item.baseQuantity, finiteNumber(item.quantity, 0) * finiteNumber(item.conversionFactor, 1)));
            updatedStockList = await addStockDelta({ rows: updatedStockList, productId: item.productId, warehouseId: pur.warehouseId, delta: -baseQty, movement: {
                productName: item.productName, warehouseName: pur.warehouseName || warehouses.find((w) => String(w.id) === String(pur.warehouseId))?.name || 'المخزن', type: 'purchase_delete_reversal', unitName: item.unitName, quantityInUnit: item.quantity, conversionFactor: item.conversionFactor, referenceId: pur.id, referenceType: 'PURCHASE_DELETE_REVERSAL', isReversal: true,
            }});
            const pi = updatedProducts.findIndex((p) => p.id === item.productId);
            if (pi >= 0) {
                updatedProducts[pi].fifoBatches = (updatedProducts[pi].fifoBatches || []).filter((b) => b.purchaseId !== pur.id);
                const positive = updatedProducts[pi].fifoBatches.filter((b) => finiteNumber(b.remainingBaseQty, 0) > 0);
                const qtyTotal = positive.reduce((s, b) => s + finiteNumber(b.remainingBaseQty, 0), 0);
                const valueTotal = positive.reduce((s, b) => s + finiteNumber(b.remainingBaseQty, 0) * finiteNumber(b.unitCost, 0), 0);
                if (qtyTotal > 0) updatedProducts[pi].costPrice = parseFloat((valueTotal / qtyTotal).toFixed(4));
                updatedProducts[pi].updatedAt = new Date().toISOString();
            }
        }
        await bulkPut('stock', updatedStockList);
        await bulkPut('products', updatedProducts);
        const currentSuppliers = await getAllFromStore('suppliers');
        const supp = currentSuppliers.find((s) => s.id === pur.supplierId);
        const debtAmount = Math.max(0, finiteNumber(pur.remainingAmount, 0));
        if (supp && debtAmount > 0) await appendReversalStatement({ partnerType: 'supplier', partner: supp, amount: debtAmount, referenceType: 'PURCHASE_DELETE_REVERSAL', referenceId: pur.id, referenceNumber: pur.invoiceNumber, description: `قيد عكسي لحذف فاتورة المشتريات ${pur.invoiceNumber}`, direction: 'decrease' });
        const currentAccounts = await getAllFromStore('accounts');
        const updatedAccounts = currentAccounts.map((a) => ({ ...a }));
        for (const pay of (pur.payments || [])) {
            const ai = updatedAccounts.findIndex((a) => a.id === pay.accountId);
            if (ai >= 0) updatedAccounts[ai].balance = finiteNumber(updatedAccounts[ai].balance, 0) + finiteNumber(pay.amount, 0);
        }
        if (updatedAccounts.length) await bulkPut('accounts', updatedAccounts);
        await putInStore('audit_logs', { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date: new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type: 'purchase_deleted_reversal', referenceId: pur.id, referenceNumber: pur.invoiceNumber, originalDate: pur.date, debtReversed: debtAmount, paymentsReversed: pur.payments || [], userId: currentUser.id, userName: currentUser.name });
        await deleteFromStore('purchases', id);
        await reloadData();
        if (!options.silent) showToast(`تم حذف فاتورة الشراء [${pur.invoiceNumber}] وعكس المخزون وحساب المورد والدفع بالكامل`, 'success');
        return true;
    }, [products, warehouses, currentUser, reloadData, showToast, addStockDelta, appendReversalStatement]);
    // Load a completed sale back into the cashier cart without touching balances yet.
    // The old financial/stock effect is reversed only when the edited invoice is actually saved.
    const beginEditSaleInvoice = useCallback(async (id) => {
        const inv = invoices.find((row) => row.id === id && row.type === 'sale') || await getFromStore('invoices', id);
        if (!inv || inv.type !== 'sale') { showToast('لم يتم العثور على فاتورة المبيعات', 'error'); return false; }
        const returnCheck = await queryStorePage('invoices', { page:1, pageSize:1, filters:{ type:'return', originalInvoiceId:id }, deletedMode:'all' }).catch(()=>({items:[]}));
        const hasReturns = (returnCheck.items || []).length > 0;
        if (hasReturns) { showToast('لا يمكن تعديل فاتورة عليها مرتجع. احذف المرتجع أولاً ثم عدّل الفاتورة.', 'warning'); return false; }
        const restoredCart = (inv.items || []).map((item) => {
            const product = products.find((p) => p.id === item.productId);
            const unit = product?.units?.find((u) => u.id === item.unitId) || product?.units?.[0];
            return {
                productId: item.productId,
                productName: item.productName || product?.name || 'صنف',
                unitId: item.unitId || unit?.id || '',
                unitName: item.unitName || unit?.name || 'وحدة',
                availableUnits: product?.units || [],
                quantity: finiteNumber(item.quantity, 0),
                conversionFactor: finiteNumber(item.conversionFactor, unit?.conversionToBase || 1) || 1,
                unitPrice: finiteNumber(item.unitPrice, unit?.salePrice || product?.sellingPrice || 0),
                catalogUnitPrice: finiteNumber(unit?.salePrice, item.unitPrice || 0),
                discount: finiteNumber(item.discount, 0),
                taxRate: finiteNumber(item.taxRate, product?.taxRate || 0),
                costPriceAtSale: finiteNumber(item.costPriceAtSale, (product?.costPrice || 0) * (unit?.conversionToBase || 1)),
                baseStockAvailable: getProductStock(item.productId, inv.warehouseId) + finiteNumber(item.baseQuantity, 0),
                lastAddedAt: Date.now(),
            };
        });
        setCart(restoredCart);
        setInvoiceAdditionalCharges(Number(inv.additionalCharges)||0);
        const cust = inv.customerId === CASH_CUSTOMER.id ? CASH_CUSTOMER : (customers.find((c) => c.id === inv.customerId) || CASH_CUSTOMER);
        setSelectedCustomer(cust);
        setInvoiceDiscountType(inv.invoiceDiscountType || 'fixed');
        setInvoiceDiscountValue(finiteNumber(inv.invoiceDiscountValue, 0));
        setEditingSaleInvoiceId(inv.id);
        setActiveTab('pos');
        showToast(`تم إرجاع الفاتورة [${inv.invoiceNumber}] للسلة للتعديل. لن يتغير الحساب إلا عند الحفظ.`, 'info');
        return true;
    }, [invoices, products, customers, getProductStock, setActiveTab, showToast]);

    const updateSaleInvoice = useCallback(async (id, payload = {}) => {
        const old = await getFromStore('invoices', id);
        await assertOpenFinancialRecord(old);
        if (!old || old.type !== 'sale') throw new Error('فاتورة المبيعات غير موجودة');
        const returnCheck = await queryStorePage('invoices', {
            page: 1,
            pageSize: 1,
            filters: { type: 'return', originalInvoiceId: id },
            deletedMode: 'all',
        });
        if ((returnCheck.items || []).length) throw new Error('لا يمكن تعديل فاتورة عليها مرتجع قبل إلغاء المرتجع');
        const reversed = await deleteInvoice(id, { silent: true });
        if (!reversed) throw new Error('تعذر عكس الفاتورة القديمة');
        try {
            const replacement = await createSaleInvoice({
                ...payload,
                invoiceIdOverride: old.id,
                invoiceNumberOverride: old.invoiceNumber,
                dateOverride: old.date,
                createdAtOverride: old.createdAt || old.date,
                warehouseIdOverride: old.warehouseId,
                isEdit: true,
            });
            await putInStore('audit_logs', { id:`audit-edit-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date:new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type:'sale_edited_reversal_repost', referenceId:old.id, referenceNumber:old.invoiceNumber, userId:currentUser.id, userName:currentUser.name });
            setEditingSaleInvoiceId(null);
            return replacement;
        } catch (error) {
            let restored = false;
            try {
                const restorePayload = {
                    items: (old.items || []).map((it) => ({ ...it })), customerId: old.customerId, paymentType: old.paymentType, paidAmount: old.paidAmount, payments: old.payments || [], notes: old.notes,
                    invoiceDiscountType: old.invoiceDiscountType || 'fixed', invoiceDiscountValue: old.invoiceDiscountValue || 0, additionalCharges:Number(old.additionalCharges)||0,
                    invoiceIdOverride: old.id, invoiceNumberOverride: old.invoiceNumber, dateOverride: old.date, createdAtOverride: old.createdAt || old.date, warehouseIdOverride: old.warehouseId,
                };
                restored = !!(await createSaleInvoice(restorePayload));
            } catch (_) {}
            setEditingSaleInvoiceId(null);
            await reloadData();
            throw new Error(restored ? `تعذر حفظ التعديل وتمت إعادة الفاتورة القديمة كما كانت: ${String(error?.message || error)}` : `تم عكس الفاتورة القديمة لكن تعذر حفظ التعديل أو استعادتها: ${String(error?.message || error)}`);
        }
    }, [deleteInvoice, createSaleInvoice, currentUser, reloadData]);

    const updatePurchaseInvoice = useCallback(async (id, payload = {}) => {
        const old = await getFromStore('purchases', id);
        await assertOpenFinancialRecord(old);
        if (!old) throw new Error('فاتورة المشتريات غير موجودة');
        const reversed = await deletePurchase(id, { silent: true });
        if (!reversed) throw new Error('تعذر عكس فاتورة المشتريات القديمة');
        try {
            const replacement = await createPurchaseInvoice({
                ...payload,
                invoiceIdOverride: old.id,
                invoiceNumberOverride: old.invoiceNumber,
                createdAtOverride: old.createdAt || old.date,
                isEdit: true,
            });
            await putInStore('audit_logs', { id:`audit-edit-pur-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, date:new Date().toISOString(), financialYearId: settings.activeFinancialYearId || 'fy-initial', type:'purchase_edited_reversal_repost', referenceId:old.id, referenceNumber:old.invoiceNumber, userId:currentUser.id, userName:currentUser.name });
            return replacement;
        } catch (error) {
            let restored = false;
            try {
                restored = !!(await createPurchaseInvoice({
                    supplierId:old.supplierId, supplierName:old.supplierName, warehouseId:old.warehouseId, items:(old.items || []).map((it)=>({ ...it })), paymentType:old.paymentType, paidAmount:old.paidAmount, payments:old.payments || [],
                    discountType:old.discountType || 'fixed', discountValue:old.discountValue || 0, discountAmount:old.discountTotal || 0, notes:old.notes || '', date:String(old.date || '').slice(0,10), supplierInvoiceNumber:old.supplierInvoiceNumber || '',
                    invoiceIdOverride:old.id, invoiceNumberOverride:old.invoiceNumber, createdAtOverride:old.createdAt || old.date,
                }));
            } catch (_) {}
            await reloadData();
            throw new Error(restored ? `تعذر حفظ التعديل وتمت إعادة فاتورة المشتريات القديمة كما كانت: ${String(error?.message || error)}` : `تم عكس فاتورة المشتريات القديمة لكن تعذر حفظ التعديل أو استعادتها: ${String(error?.message || error)}`);
        }
    }, [deletePurchase, createPurchaseInvoice, currentUser, reloadData]);

    // Cashier Shifts
    const openShift = useCallback(async (openingCash) => {
        const normalizedOpeningCash = Math.max(0, finiteNumber(openingCash, 0));
        const currentOpen = shifts.find((s) => s?.status === 'open');
        if (currentOpen) {
            showToast('يوجد وردية مفتوحة بالفعل', 'warning');
            return;
        }
        const lastShiftNumber = shifts.reduce((max, row) => Math.max(max, Math.trunc(finiteNumber(row?.shiftNumber, 0))), 0);
        const newShift = normalizeShiftRecord({
            id: 'shift-' + Date.now(),
            shiftNumber: lastShiftNumber + 1,
            financialYearId: settings.activeFinancialYearId || 'fy-initial',
            cashierId: currentUser.id,
            cashierName: currentUser.name,
            startTime: new Date().toISOString(),
            openingCash: normalizedOpeningCash,
            totalCashSales: 0,
            totalOtherSales: 0,
            totalCashReturns: 0,
            totalCashExpenses: 0,
            expectedCash: normalizedOpeningCash,
            status: 'open',
        });
        await putInStore('shifts', newShift);
        await reloadData();
        showToast('تم فتح الوردية بنجاح', 'success');
    }, [shifts, currentUser, reloadData, showToast, settings.activeFinancialYearId]);
    const closeShift = useCallback(async (actualCash, notes) => {
        if (!activeShift)
            return;
        const normalizedShift = normalizeShiftRecord(activeShift);
        const normalizedActualCash = Math.max(0, finiteNumber(actualCash, 0));
        const diff = normalizedActualCash - finiteNumber(normalizedShift.expectedCash, 0);
        const closedShift = normalizeShiftRecord({
            ...normalizedShift,
            endTime: new Date().toISOString(),
            actualCash: normalizedActualCash,
            difference: diff,
            status: 'closed',
            notes,
        });
        await putInStore('shifts', closedShift);
        await reloadData();
        showToast(`تم إغلاق الوردية. الفرق: ${diff >= 0 ? `+${diff}` : diff} ${settings.currencySymbol}`, diff === 0 ? 'success' : 'warning');
    }, [activeShift, settings.currencySymbol, reloadData, showToast]);
    const fiscalCloseBusy=useRef(false);
    const openNewFinancialYear = useCallback(async ({name,startDate,closedName}={})=>{
        if(fiscalCloseBusy.current)throw Error('جاري إغلاق المجموعة');
        if(!isManagerAccess({currentUser,activeEmployee}))throw Error('إغلاق المجموعة متاح للمدير فقط');
        if(navigator.onLine===false)throw Error('اتصل بالإنترنت لمراجعة اكتمال السجلات قبل الإغلاق');
        fiscalCloseBusy.current=true;
        try{
          const sync=await window.OscarCloudSync?.syncNow?.({manual:true,force:true});
          if(sync?.error)throw Error('تعذرت المزامنة قبل الإغلاق');
          const entries=await Promise.all([...fiscalStores,...fiscalMasters].map(async store=>[store,await queryAllStoreRecords(store,{pageSize:200,deletedMode:'all',requireRemote:true})]));
          const current=await getFromStore('settings','store_config')||settings;
          if(current.activeFinancialYearId!==settings.activeFinancialYearId)throw Error('تغيرت المجموعة الحالية، حدّث الصفحة قبل الإغلاق');
          const result=buildFinancialClose({settings:current,data:Object.fromEntries(entries),name,startDate,closedName,user:currentUser});
          await commitLocalBatch(result.operations,true,{fiscalClose:true});
          setSettings(result.nextSettings);fullHistoryLoadedRef.current.clear();await reloadData();
          showToast('تم إغلاق المجموعة وحفظ الأرشيف والأرصدة الافتتاحية','success');return result.newYear;
        }finally{fiscalCloseBusy.current=false}
    },[settings,currentUser,activeEmployee,reloadData,showToast]);
    const settingsWriteQueue=useRef(Promise.resolve());
    const persistSettingsPatch=useCallback((patch)=>{
        const task=settingsWriteQueue.current.catch(()=>{}).then(async()=>{
            const current=await getFromStore('settings','store_config')||{};
            const row={...current,...patch,key:'store_config',settingsUpdatedAt:new Date().toISOString()};
            await putInStore('settings',row,false);
            setSettings(row);
            // Queue durably before reporting success, even during a concurrent remote refresh.
            try {
                const captured=await window.OscarCloudSync?.captureStoreChange?.('settings',row,{localUserWrite:true});
                if(captured!==true)await putInStore('settings',row);
            }catch{await putInStore('settings',row);}
            return row;
        });
        settingsWriteQueue.current=task;
        return task;
    },[]);
    const saveSettings=useCallback(async(next)=>{const saved=await persistSettingsPatch(next);showToast('تم حفظ الإعدادات وإضافتها للمزامنة','success');return saved},[persistSettingsPatch,showToast]);
    const updateSettings=useCallback(async(patch)=>{const saved=await persistSettingsPatch(patch);showToast('تم تحديث الإعدادات وإضافتها للمزامنة','success');return saved},[persistSettingsPatch,showToast]);
    // Professional tenant cloud sync
    const syncPendingQueue = useCallback(async () => {
        setIsSyncing(true);
        try {
            const result = await window.OscarCloudSync?.syncNow?.({ manual: true, force: true });
            if (result?.error) throw new Error(result.message || 'فشل الاتصال');
            setSyncQueue(window.OscarCloudSync?.pendingItems?.() || []);
            if (result?.changedStores?.length) await applyRemoteRefresh(result.changedStores);
            showToast(result?.applied ? `تمت المزامنة وتحديث الشاشة (${result.applied} تغيير)` : 'اكتملت المزامنة — البيانات محدثة', 'success');
        } catch (err) {
            console.error('Sync failed:', err);
            showToast('تعذر الاتصال الآن. بياناتك محفوظة محلياً وستتم المحاولة تلقائياً.', 'warning');
        } finally { setIsSyncing(false); }
    }, [showToast, reloadStores]);
    const refreshCurrentPage=useCallback(async(tab)=>{
      const map={pos:['products','stock','categories'],products:['products','categories','stock'],sales:['invoices'],purchases:['purchases'],customers:['customers','partner_statements'],suppliers:['suppliers','partner_statements'],accounts:['accounts','transfers','shifts'],expenses:['expenses'],vouchers:['vouchers'],inventory:['stock','stock_movements'],settings:['settings'],dashboard:['invoices','accounts','customers','stock'],reports:['invoices','purchases','expenses','vouchers']};
      const names=map[tab]||['settings'];
      if(navigator.onLine!==false)await Promise.all(names.map(store=>queryStorePage(store,{page:1,pageSize:50,deletedMode:'all',forceRefresh:true})));
      for(const name of names)fullHistoryLoadedRef.current.delete(name);
      await reloadStores(names);if(tab==='reports')await ensureFullHistoryStores(names);
    },[reloadStores,ensureFullHistoryStores]);
    const retrySyncItem = useCallback(async () => {
        await syncPendingQueue();
    }, [syncPendingQueue]);
    // Reset & Backup
    const handleResetData = useCallback(async (withDemo) => {
        await resetDatabase(withDemo);
        clearCart();
        await reloadData();
        showToast(withDemo ? 'تمت استعادة البيانات التجريبية' : 'تم تصفير البيانات بنجاح', 'info');
    }, [clearCart, reloadData, showToast]);
    const handleExportBackup = useCallback(async () => {
        return await exportDatabaseBackup();
    }, []);
    const handleImportBackup = useCallback(async (json) => {
        await importDatabaseBackup(json);
        clearCart();
        await reloadData();
        showToast('تمت استعادة النسخة الاحتياطية بنجاح', 'success');
    }, [clearCart, reloadData, showToast]);
    const value = {
        isLoaded,
        startupProgress,
        isCloudReady,
        products,
        categories,
        warehouses,
        stock,
        stockMovements,
        invoices,
        purchases,
        customers,
        suppliers,
        accounts,
        transfers,
        expenses,
        shifts,
        activeShift,
        auditLogs,
        heldInvoices,
        syncQueue,
        settings,
        partnerStatements,
        vouchers,
        employees,
        activeEmployee,
        setActiveEmployee,
        activeTab,
        setActiveTab,
        mobileSidebarOpen,
        setMobileSidebarOpen,
        posCartLayout,
        setPosCartLayout,
        isOnline,
        isSyncing,
        toasts,
        showToast,
        removeToast,
        showThermalModal,
        setShowThermalModal,
        showCameraModal,
        setShowCameraModal,
        showHoldInvoicesModal,
        setShowHoldInvoicesModal,
        showSyncModal,
        setShowSyncModal,
        searchQuery,
        setSearchQuery,
        selectedCategory,
        setSelectedCategory,
        currentUser,
        cart,
        setCart,
        invoiceDiscountType,
        setInvoiceDiscountType,
        invoiceDiscountValue,
        setInvoiceDiscountValue,
        selectedCustomer,
        setSelectedCustomer,
        addToCart,
        updateCartItemUnit,
        invoiceAdditionalCharges, setInvoiceAdditionalCharges,
        updateCartItemQuantity,
        updateCartItemPrice,
        updateCartItemScaleAmount,
        updateCartItemDiscount,
        removeFromCart,
        clearCart,
        holdCurrentInvoice,
        restoreHeldInvoice,
        deleteHeldInvoice,
        createSaleInvoice,
        createReturnInvoice,
        createCartReturnInvoice,
        createPurchaseInvoice,
        editingSaleInvoiceId,
        beginEditSaleInvoice,
        updateSaleInvoice,
        updatePurchaseInvoice,
        recordDamagedStock,
        adjustStock,
        adjustStockCount,
        transferStock,
        transferStockBatch,
        getProductStock,
        saveProduct,
        softDeleteProduct,
        restoreProduct,
        permanentDeleteProduct,
        saveCategory,
        deleteCategory,
        saveCustomer,
        deleteCustomer,
        softDeleteCustomer,
        restoreCustomer,
        permanentDeleteCustomer,
        recordCustomerPayment,
        saveSupplier,
        deleteSupplier,
        softDeleteSupplier,
        restoreSupplier,
        permanentDeleteSupplier,
        recordSupplierPayment,
        saveAccount,
        deleteAccount,
        transferBetweenAccounts,
        saveExpense,
        recordExpense,
        updateExpense,
        deleteExpense,
        softDeleteExpense,
        restoreExpense,
        permanentDeleteExpense,
        saveWarehouse,
        deleteWarehouse,
        refreshData,
        ensureFullHistoryStores,
        queryStorePage,
        queryAllStoreRecords,
        queryStoreStats,
        createVoucher,
        deleteVoucher,
        saveEmployee,
        deleteEmployee,
        deleteInvoice,
        deletePurchase,
        openShift,
        closeShift,
        saveSettings,
        updateSettings,
        openNewFinancialYear,
        syncPendingQueue,
        refreshCurrentPage,
        retrySyncItem,
        handleScannedBarcode,
        handleResetData,
        handleExportBackup,
        handleImportBackup,
    };
    return _jsx(AppContext.Provider, { value: value, children: children });
};
export const useApp = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
};
