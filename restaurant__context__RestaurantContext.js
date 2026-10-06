import { jsx as _jsx } from "react/jsx-runtime";
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getAllFromStore, getFromStore, deleteFromStore, putInStore, syncChannel, } from './restaurant__services__db.js?v=7.9.4.136-localization';
import { initRestaurantDefaults, generateOrderNumber, generateTakeawayQueueNumber, generateKitchenTicketId, playChimeSound, } from './restaurant__services__restaurantService.js?v=7.9.4.136-localization';
import { useApp } from './restaurant__context__AppContext.js?v=7.9.4.136-localization';
const RestaurantContext = createContext(null);
const RESTAURANT_STORES = new Set([
    'restaurant_sections',
    'restaurant_tables',
    'restaurant_orders',
    'kitchen_sections',
    'table_reservations',
    'recipes',
    'waste_records',
]);
const isRestaurantTab = (tab) => String(tab || '').startsWith('restaurant_');
const makeRestaurantId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const RestaurantProvider = ({ children }) => {
    const { products, customers, setSelectedCustomer, setCart, setActiveTab, showToast, settings, isLoaded, isCloudReady, activeTab, refreshData, } = useApp();
    const [sections, setSections] = useState([]);
    const [tables, setTables] = useState([]);
    const [orders, setOrders] = useState([]);
    const [kitchenSections, setKitchenSections] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [wasteRecords, setWasteRecords] = useState([]);
    const [activeRestaurantOrder, setActiveRestaurantOrder] = useState(null);
    const refreshRestaurantData = useCallback(async () => {
        try {
            const defaults = await initRestaurantDefaults();
            const [secList, tblList, ordList, ksList, resList, recList, wstList, productRows] = await Promise.all([
                getAllFromStore('restaurant_sections'),
                getAllFromStore('restaurant_tables'),
                getAllFromStore('restaurant_orders'),
                getAllFromStore('kitchen_sections'),
                getAllFromStore('table_reservations'),
                getAllFromStore('recipes'),
                getAllFromStore('waste_records'),
                getAllFromStore('products'),
            ]);
            setSections(secList && secList.length > 0 ? secList : defaults.sections);
            setTables(tblList && tblList.length > 0 ? tblList : defaults.tables);
            setKitchenSections(ksList && ksList.length > 0 ? ksList : defaults.kitchenSections);
            setOrders(ordList ? ordList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : []);
            setReservations(resList || []);
            const reconciledRecipes = [];
            let productCostChanged = false;
            for (const rawRecipe of (recList || [])) {
                const ingredients = rawRecipe.ingredients || rawRecipe.items || [];
                const recipeCost = ingredients.reduce((sum, ing) => {
                    const raw = (productRows || []).find((p) => p.id === (ing.ingredientProductId || ing.productId));
                    const unit = (raw?.units || []).find((u) => u.id === (ing.ingredientUnitId || ing.unitId)) || (raw?.units || []).find((u) => (Number(u.conversionToBase) || 1) === 1) || (raw?.units || [])[0];
                    const factor = Number(ing.conversionFactor ?? unit?.conversionToBase ?? 1) || 1;
                    const baseQty = Number(ing.baseQuantity) > 0 ? Number(ing.baseQuantity) : (Number(ing.quantity) || 0) * factor;
                    const baseCost = Number(raw?.costPrice) || (Number(unit?.costPrice) / Math.max(1, Number(unit?.conversionToBase) || 1)) || 0;
                    return sum + baseQty * baseCost;
                }, 0);
                const roundedCost = Number(recipeCost.toFixed(4));
                const recipe = Math.abs(Number(rawRecipe.recipeCost || 0) - roundedCost) > 0.0001 ? { ...rawRecipe, recipeCost: roundedCost, costPrice: roundedCost, updatedAt: new Date().toISOString() } : rawRecipe;
                if (recipe !== rawRecipe) await putInStore('recipes', recipe);
                reconciledRecipes.push(recipe);
                const productId = recipe.productId || recipe.mealProductId;
                const meal = (productRows || []).find((p) => p.id === productId);
                if (meal && Math.abs(Number(meal.costPrice || 0) - roundedCost) > 0.0001) {
                    const updatedUnits = (meal.units || []).map((u) => ({ ...u, costPrice: Number((roundedCost * Math.max(1, Number(u.conversionToBase) || 1)).toFixed(4)) }));
                    await putInStore('products', { ...meal, costPrice: roundedCost, units: updatedUnits, manufacturedCost: roundedCost, manufacturedCostUpdatedAt: new Date().toISOString() });
                    productCostChanged = true;
                }
            }
            setRecipes(reconciledRecipes);
            setWasteRecords(wstList ? wstList.sort((a, b) => new Date(b.date || b.loggedAt || 0).getTime() - new Date(a.date || a.loggedAt || 0).getTime()) : []);
            if (productCostChanged) refreshData?.().catch?.(() => {});
        }
        catch (e) {
            console.warn('Error loading restaurant data:', e);
        }
    }, [refreshData]);
    useEffect(() => {
        // Wait until AppContext has completed the initial cloud pull. Previously the
        // restaurant provider could seed defaults before cloud data arrived, which made
        // tables/orders appear to disappear or get replaced after reopening the page.
        if (!isLoaded || !isCloudReady) return;
        let cancelled = false;
        const loadLatest = async () => {
            await refreshRestaurantData();
            try { await window.OscarCloudSync?.checkRemote?.({ force: true }); } catch {}
            if (!cancelled) await refreshRestaurantData();
        };
        loadLatest();

        const handleSync = (e) => {
            const msg = e?.data || {};
            if (msg.type?.startsWith('restaurant_') || (msg.type === 'STORE_UPDATED' && RESTAURANT_STORES.has(msg.storeName))) {
                refreshRestaurantData();
            }
        };
        syncChannel?.addEventListener?.('message', handleSync);
        return () => {
            cancelled = true;
            syncChannel?.removeEventListener?.('message', handleSync);
        };
    }, [isLoaded, isCloudReady, refreshRestaurantData]);

    useEffect(() => {
        if (!isLoaded || !isCloudReady) return;
        const onApplied = (event) => {
            const stores = event?.detail?.stores || [];
            if (stores.some((name) => RESTAURANT_STORES.has(name))) refreshRestaurantData();
        };
        const onRestaurantLocalChange = () => refreshRestaurantData();
        window.addEventListener('oscar:sync-applied', onApplied);
        window.addEventListener('oscar:restaurant-order-change', onRestaurantLocalChange);
        return () => {
            window.removeEventListener('oscar:sync-applied', onApplied);
            window.removeEventListener('oscar:restaurant-order-change', onRestaurantLocalChange);
        };
    }, [isLoaded, isCloudReady, refreshRestaurantData]);

    useEffect(() => {
        // Every time a restaurant page is opened, pull the latest remote delta and
        // reload IndexedDB. Keep a light realtime probe while the page stays open.
        if (!isLoaded || !isCloudReady || !isRestaurantTab(activeTab)) return;
        let stopped = false;
        const pull = async () => {
            try { await window.OscarCloudSync?.checkRemote?.({ force: true }); } catch {}
            if (!stopped) await refreshRestaurantData();
        };
        pull();
        const timer = setInterval(() => {
            try { window.OscarCloudSync?.checkRemote?.({ force: false }); } catch {}
        }, 900);
        return () => {
            stopped = true;
            clearInterval(timer);
        };
    }, [isLoaded, isCloudReady, activeTab, refreshRestaurantData]);

    // Section Operations
    const addSection = async (sec) => {
        const newSec = {
            id: makeRestaurantId('sec'),
            name: sec.name || 'صالة جديدة',
            displayOrder: sec.displayOrder || sections.length + 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await putInStore('restaurant_sections', newSec);
        setSections((prev) => [...prev, newSec]);
        syncChannel?.postMessage({ type: 'restaurant_section_change' });
    };
    const updateSection = async (id, sec) => {
        const existing = (await getFromStore('restaurant_sections', id).catch(() => null)) || sections.find((s) => s.id === id);
        if (!existing)
            return;
        const updated = { ...existing, ...sec, updatedAt: new Date().toISOString() };
        await putInStore('restaurant_sections', updated);
        setSections((prev) => prev.map((s) => (s.id === id ? updated : s)));
        syncChannel?.postMessage({ type: 'restaurant_section_change' });
    };
    const deleteSection = async (id) => {
        await deleteFromStore('restaurant_sections', id);
        setSections((prev) => prev.filter((s) => s.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_section_change' });
    };
    // Table Operations
    const addTable = async (tbl) => {
        const newTbl = {
            id: makeRestaurantId('tbl'),
            tableNumber: tbl.tableNumber || `T-${tables.length + 1}`,
            name: tbl.name || '',
            sectionId: tbl.sectionId || sections[0]?.id || 'sec-indoor',
            sectionName: tbl.sectionName || sections.find((s) => s.id === tbl.sectionId)?.name || 'الصالة الرئيسية',
            seats: tbl.seats || 4,
            status: 'available',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await putInStore('restaurant_tables', newTbl);
        setTables((prev) => [...prev, newTbl]);
        syncChannel?.postMessage({ type: 'restaurant_table_change' });
    };
    const updateTable = async (id, tbl) => {
        const existing = (await getFromStore('restaurant_tables', id).catch(() => null)) || tables.find((t) => t.id === id);
        if (!existing)
            return;
        const updated = { ...existing, ...tbl, updatedAt: new Date().toISOString() };
        await putInStore('restaurant_tables', updated);
        setTables((prev) => prev.map((t) => (t.id === id ? updated : t)));
        syncChannel?.postMessage({ type: 'restaurant_table_change' });
    };
    const forceRestaurantCloudSync = () => {
        try { window.dispatchEvent(new CustomEvent('oscar:restaurant-order-change')); } catch {}
        try { window.OscarCloudSync?.requestSync?.(0); } catch {}
        try { window.OscarCloudSync?.syncNow?.({ force: true }).catch(() => {}); } catch {}
    };
    const deleteRestaurantOrder = async (orderId) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing) return;
        await deleteFromStore('restaurant_orders', orderId);
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        if (activeRestaurantOrder?.id === orderId) {
            setActiveRestaurantOrder(null);
            setCart((prev) => (prev || []).filter((x) => x.restaurantOrderId !== orderId));
        }
        if (existing.tableId) {
            const linkedTable = (await getFromStore('restaurant_tables', existing.tableId).catch(() => null)) || tables.find((t) => t.id === existing.tableId);
            if (linkedTable?.currentOrderId === orderId) {
                await updateTableStatus(existing.tableId, 'available');
            }
        }
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
        forceRestaurantCloudSync();
    };
    const deleteTable = async (id) => {
        const existing = (await getFromStore('restaurant_tables', id).catch(() => null)) || tables.find((t) => t.id === id);
        if (existing?.currentOrderId) {
            await deleteFromStore('restaurant_orders', existing.currentOrderId);
            setOrders((prev) => prev.filter((o) => o.id !== existing.currentOrderId));
            if (activeRestaurantOrder?.id === existing.currentOrderId) {
                setActiveRestaurantOrder(null);
                setCart((prev) => (prev || []).filter((x) => x.restaurantOrderId !== existing.currentOrderId));
            }
        }
        await deleteFromStore('restaurant_tables', id);
        setTables((prev) => prev.filter((t) => t.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_table_change' });
        if (existing?.currentOrderId) syncChannel?.postMessage({ type: 'restaurant_order_change' });
        forceRestaurantCloudSync();
    };
    const updateTableStatus = async (tableId, status, details) => {
        const existing = (await getFromStore('restaurant_tables', tableId).catch(() => null)) || tables.find((t) => t.id === tableId);
        if (!existing)
            return;
        const updated = {
            ...existing,
            status,
            ...details,
            updatedAt: new Date().toISOString(),
        };
        if (status === 'available') {
            updated.currentOrderId = undefined;
            updated.customerName = undefined;
            updated.waiterId = undefined;
            updated.waiterName = undefined;
            updated.orderTotal = undefined;
            updated.openedAt = undefined;
            updated.guestCount = undefined;
        }
        await putInStore('restaurant_tables', updated);
        setTables((prev) => prev.map((t) => (t.id === tableId ? updated : t)));
        syncChannel?.postMessage({ type: 'restaurant_table_change' });
    };
    // Order Operations
    const createOrder = async (orderData) => {
        const orderNumber = generateOrderNumber();
        const queueNumber = orderData.orderType !== 'dine_in' ? generateTakeawayQueueNumber() : undefined;
        const kitchenTicketId = generateKitchenTicketId();
        const now = new Date().toISOString();
        const items = (orderData.items || []).map((item) => ({
            ...item,
            id: item.id || 'roi-' + Math.random().toString(36).substring(2, 9),
            status: item.status || 'new',
        }));
        const subtotal = items.reduce((sum, item) => {
            const addonsSum = (item.addons || []).reduce((a, b) => a + (Number(b.price) || 0), 0);
            return sum + (item.unitPrice + addonsSum) * item.quantity;
        }, 0);
        let serviceCharge = 0;
        if (settings?.enableServiceChargeDineIn && orderData.orderType === 'dine_in') {
            serviceCharge = settings.serviceChargeType === 'percentage'
                ? subtotal * (settings.serviceChargeRate / 100)
                : settings.serviceChargeRate;
        }
        const total = subtotal + serviceCharge - (orderData.discount || 0);
        const newOrder = {
            id: makeRestaurantId('rord'),
            orderNumber,
            queueNumber,
            orderType: orderData.orderType || 'dine_in',
            tableId: orderData.tableId,
            tableNumber: orderData.tableNumber,
            tableName: orderData.tableName,
            sectionName: orderData.sectionName,
            waiterId: orderData.waiterId,
            waiterName: orderData.waiterName,
            customerId: orderData.customerId,
            customerName: orderData.customerName,
            customerPhone: orderData.customerPhone,
            guestCount: orderData.guestCount,
            status: 'draft',
            priority: orderData.priority || 'normal',
            items,
            subtotal,
            serviceCharge,
            tax: 0,
            discount: orderData.discount || 0,
            total,
            createdAt: now,
            kitchenTicketId,
            timeline: [
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: 'إنشاء مسودة الطلب',
                    userName: orderData.waiterName || 'الكاشير/الجرسون',
                },
            ],
            notes: orderData.notes,
        };
        await putInStore('restaurant_orders', newOrder);
        setOrders((prev) => [newOrder, ...prev]);
        // If assigned to a table, update table status
        if (newOrder.tableId) {
            await updateTableStatus(newOrder.tableId, 'new_order', {
                currentOrderId: newOrder.id,
                waiterId: newOrder.waiterId,
                waiterName: newOrder.waiterName,
                customerName: newOrder.customerName,
                openedAt: now,
                orderTotal: newOrder.total,
                guestCount: newOrder.guestCount,
            });
        }
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
        return newOrder;
    };
    const updateOrder = async (orderId, updates) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing)
            return;
        let items = updates.items !== undefined ? updates.items : existing.items;
        const subtotal = items.reduce((sum, item) => {
            const addonsSum = (item.addons || []).reduce((a, b) => a + (Number(b.price) || 0), 0);
            return sum + (item.unitPrice + addonsSum) * item.quantity;
        }, 0);
        const updated = {
            ...existing,
            ...updates,
            items,
            subtotal,
            total: subtotal + (updates.serviceCharge ?? existing.serviceCharge) - (updates.discount ?? existing.discount),
            updatedAt: new Date().toISOString(),
        };
        await putInStore('restaurant_orders', updated);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
        if (updated.tableId) {
            const tbl = tables.find((t) => t.id === updated.tableId);
            if (tbl) {
                await updateTable(updated.tableId, { orderTotal: updated.total });
            }
        }
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
        return updated;
    };
    const sendOrderToKitchen = async (orderId, options) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing)
            return;
        const now = new Date().toISOString();
        const justSentItemIds = existing.items.filter((item) => item.status === 'new').map((item) => item.id);
        const updatedItems = existing.items.map((item) => {
            if (item.status === 'new') {
                return {
                    ...item,
                    status: 'sent',
                    sentAt: now,
                    isAddition: options?.isAddition || false,
                };
            }
            return item;
        });
        const isAddition = options?.isAddition || existing.status !== 'draft';
        const additionTicketId = isAddition ? generateKitchenTicketId() : undefined;
        const timelineEvent = {
            id: 'tl-' + Date.now(),
            timestamp: now,
            action: isAddition ? 'إرسال أصناف إضافية للمطبخ' : 'إرسال الطلب للمطبخ',
            userName: existing.waiterName || 'الجرسون',
        };
        const updatedOrder = {
            ...existing,
            status: 'sent',
            items: updatedItems,
            // Any new kitchen send hides the order from the cashier again until
            // the kitchen explicitly presses "جاهز بالكامل".
            cashierPending: false,
            sentToKitchenAt: existing.sentToKitchenAt || now,
            lastKitchenSendAt: now,
            lastKitchenSendItemIds: justSentItemIds,
            lastKitchenSendIsAddition: !!isAddition,
            updatedAt: now,
            additionTicketIds: additionTicketId
                ? [...(existing.additionTicketIds || []), additionTicketId]
                : existing.additionTicketIds,
            timeline: [...(existing.timeline || []), timelineEvent],
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
        // Update table status to preparing
        if (updatedOrder.tableId) {
            await updateTableStatus(updatedOrder.tableId, 'preparing');
        }
        // Play sound if configured
        if (settings?.soundOnNewOrder !== false) {
            playChimeSound('new_order');
        }
        showToast('تم إرسال الطلب إلى شاشة المطبخ بنجاح', 'success');
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
        try { window.dispatchEvent(new CustomEvent('oscar:restaurant-order-change', { detail: { orderId, action: 'sent_to_kitchen' } })); } catch {}
        try { window.OscarCloudSync?.requestSync?.(0); } catch {}
        try { window.OscarCloudSync?.syncNow?.({ force: true }).catch(() => {}); } catch {}
        return updatedOrder;
    };
    const updateOrderItemStatus = async (orderId, itemId, status, cancelledReason) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing)
            return;
        const now = new Date().toISOString();
        const updatedItems = existing.items.map((item) => {
            if (item.id === itemId) {
                return {
                    ...item,
                    status,
                    readyAt: status === 'ready' ? now : item.readyAt,
                    cancelledReason: cancelledReason || item.cancelledReason,
                };
            }
            return item;
        });
        // Check overall order status based on item statuses
        const activeItems = updatedItems.filter((i) => i.status !== 'cancelled');
        const allReady = activeItems.length > 0 && activeItems.every((i) => i.status === 'ready' || i.status === 'served');
        const someReady = activeItems.some((i) => i.status === 'ready');
        const anyPreparing = activeItems.some((i) => i.status === 'preparing');
        let newOrderStatus = existing.status;
        let newTableStatus;
        if (allReady) {
            // Individual item checkboxes never expose the order to the cashier.
            // The kitchen must press the explicit "جاهز بالكامل" button.
            newOrderStatus = 'partially_ready';
            newTableStatus = 'partially_ready';
        }
        else if (someReady) {
            newOrderStatus = 'partially_ready';
            newTableStatus = 'partially_ready';
        }
        else if (anyPreparing) {
            newOrderStatus = 'preparing';
            newTableStatus = 'preparing';
        }
        const updatedOrder = {
            ...existing,
            items: updatedItems,
            status: newOrderStatus,
            readyAt: existing.readyAt,
            cashierPending: existing.cashierPending === true,
            cashierPendingAt: existing.cashierPendingAt,
            updatedAt: now,
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
        if (updatedOrder.tableId && newTableStatus) {
            await updateTableStatus(updatedOrder.tableId, newTableStatus);
        }
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
    };
    const updateOrderStatus = async (orderId, status, note) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing) return;
        const now = new Date().toISOString();
        const isExplicitFullyReady = status === 'ready';
        const nextItems = isExplicitFullyReady
            ? (existing.items || []).map((item) => item.status === 'cancelled' ? item : { ...item, status: 'ready', readyAt: item.readyAt || now })
            : existing.items;
        const alreadyVisibleToCashier = existing.cashierPending === true;
        const cashierPending = isExplicitFullyReady ? true : alreadyVisibleToCashier;
        const timelineEvent = {
            id: 'tl-' + Date.now(),
            timestamp: now,
            action: isExplicitFullyReady ? 'اعتماد الطلب جاهز بالكامل وإرساله للكاشير' : `تغيير حالة الطلب إلى: ${status}`,
            userName: 'المستخدم',
            note,
        };
        const updatedOrder = {
            ...existing,
            items: nextItems,
            status,
            preparingAt: status === 'preparing' ? (existing.preparingAt || now) : existing.preparingAt,
            readyAt: isExplicitFullyReady ? (existing.readyAt || now) : existing.readyAt,
            servedAt: status === 'served' ? (existing.servedAt || now) : existing.servedAt,
            cashierPending,
            cashierPendingAt: isExplicitFullyReady ? (existing.cashierPendingAt || now) : existing.cashierPendingAt,
            updatedAt: now,
            timeline: [...(existing.timeline || []), timelineEvent],
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
        if (updatedOrder.tableId) {
            const tableStatusMap = { preparing: 'preparing', partially_ready: 'partially_ready', ready: 'ready', served: 'occupied', waiting_payment: 'waiting_payment' };
            const matchingTableStatus = tableStatusMap[status];
            if (matchingTableStatus) await updateTableStatus(updatedOrder.tableId, matchingTableStatus);
        }
        if (isExplicitFullyReady && settings?.soundOnOrderReady !== false) playChimeSound('ready');
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
        try { window.dispatchEvent(new CustomEvent('oscar:restaurant-order-change', { detail: { orderId, action: status } })); } catch {}
        try { window.OscarCloudSync?.requestSync?.(0); } catch {}
        try { window.OscarCloudSync?.syncNow?.({ force: true }).catch(() => {}); } catch {}
        return updatedOrder;
    };
    const requestBillForTable = async (tableId) => {
        const table = tables.find((t) => t.id === tableId);
        if (!table || !table.currentOrderId) return;
        const order = (await getFromStore('restaurant_orders', table.currentOrderId).catch(() => null)) || orders.find((o) => o.id === table.currentOrderId);
        if (!order?.cashierPending) {
            showToast('لا يظهر الطلب للكاشير قبل اعتماد "جاهز بالكامل" من المطبخ', 'info');
            return;
        }
        await updateOrderStatus(table.currentOrderId, 'waiting_payment', 'طلب العميل الحساب');
        await updateTableStatus(tableId, 'waiting_payment');
        showToast(`تم طلب الحساب للطاولة ${table.tableNumber}`, 'info');
    };
    const transferTableOrder = async (fromTableId, toTableId) => {
        const fromTable = tables.find((t) => t.id === fromTableId);
        const toTable = tables.find((t) => t.id === toTableId);
        if (!fromTable || !toTable || !fromTable.currentOrderId) {
            showToast('تعذر نقل الطاولة: الطاولة الحالية لا تحتوي على طلب نشط', 'error');
            return;
        }
        if (toTable.status !== 'available') {
            showToast(`الطاولة المستهدفة (${toTable.tableNumber}) غير فارغة!`, 'error');
            return;
        }
        const order = orders.find((o) => o.id === fromTable.currentOrderId);
        if (!order)
            return;
        const now = new Date().toISOString();
        const updatedOrder = {
            ...order,
            tableId: toTable.id,
            tableNumber: toTable.tableNumber,
            tableName: toTable.name,
            sectionName: toTable.sectionName,
            timeline: [
                ...order.timeline,
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: `نقل الطلب من طاولة ${fromTable.tableNumber} إلى طاولة ${toTable.tableNumber}`,
                    userName: 'الكاشير/الجرسون',
                },
            ],
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === order.id ? updatedOrder : o)));
        // Free original table
        await updateTableStatus(fromTable.id, 'available');
        // Occupy target table with order
        await updateTableStatus(toTable.id, fromTable.status, {
            currentOrderId: order.id,
            waiterId: order.waiterId,
            waiterName: order.waiterName,
            customerName: order.customerName,
            openedAt: fromTable.openedAt || now,
            orderTotal: order.total,
            guestCount: order.guestCount,
        });
        showToast(`تم نقل الطلب بنجاح إلى طاولة ${toTable.tableNumber}`, 'success');
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
    };
    const mergeTableOrders = async (targetTableId, sourceTableId) => {
        const targetTable = tables.find((t) => t.id === targetTableId);
        const sourceTable = tables.find((t) => t.id === sourceTableId);
        if (!targetTable?.currentOrderId || !sourceTable?.currentOrderId) {
            showToast('يجب أن تحتوي كلا الطاولتين على طلبات نشطة للدمج!', 'error');
            return;
        }
        const targetOrder = orders.find((o) => o.id === targetTable.currentOrderId);
        const sourceOrder = orders.find((o) => o.id === sourceTable.currentOrderId);
        if (!targetOrder || !sourceOrder)
            return;
        const combinedItems = [...targetOrder.items, ...sourceOrder.items];
        const subtotal = combinedItems.reduce((sum, item) => {
            const addonsSum = (item.addons || []).reduce((a, b) => a + (Number(b.price) || 0), 0);
            return sum + (item.unitPrice + addonsSum) * item.quantity;
        }, 0);
        const now = new Date().toISOString();
        const updatedTargetOrder = {
            ...targetOrder,
            items: combinedItems,
            subtotal,
            total: subtotal + targetOrder.serviceCharge - targetOrder.discount,
            timeline: [
                ...targetOrder.timeline,
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: `دمج طلب الطاولة ${sourceTable.tableNumber} في هذا الطلب`,
                    userName: 'الكاشير',
                },
            ],
        };
        // Close source order
        const updatedSourceOrder = {
            ...sourceOrder,
            status: 'cancelled',
            cashierPending: false,
            timeline: [
                ...sourceOrder.timeline,
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: `تم دمج الطلب في طاولة ${targetTable.tableNumber}`,
                    userName: 'الكاشير',
                },
            ],
        };
        await putInStore('restaurant_orders', updatedTargetOrder);
        await putInStore('restaurant_orders', updatedSourceOrder);
        setOrders((prev) => prev.map((o) => o.id === targetOrder.id ? updatedTargetOrder : o.id === sourceOrder.id ? updatedSourceOrder : o));
        // Free source table
        await updateTableStatus(sourceTable.id, 'available');
        // Update target table total
        await updateTable(targetTable.id, { orderTotal: updatedTargetOrder.total });
        showToast(`تم دمج طاولتي ${sourceTable.tableNumber} و ${targetTable.tableNumber} بنجاح`, 'success');
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
    };
    const cancelRestaurantOrder = async (orderId, reason, voidWasted) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing)
            return;
        const now = new Date().toISOString();
        const updatedOrder = {
            ...existing,
            status: 'cancelled',
            timeline: [
                ...existing.timeline,
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: `إلغاء الطلب: ${reason}`,
                    userName: 'المشرف',
                },
            ],
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
        // Free table if dine-in
        if (existing.tableId) {
            await updateTableStatus(existing.tableId, 'available');
        }
        // Record waste if requested
        if (voidWasted) {
            for (const item of existing.items) {
                if (item.status === 'preparing' || item.status === 'ready' || item.status === 'sent') {
                    await addWasteRecord({
                        date: now,
                        productId: item.productId,
                        productName: item.productName,
                        quantity: item.quantity,
                        unitName: 'وجبة',
                        estimatedCost: item.unitPrice * 0.5,
                        reason: 'customer_cancelled_after_prep',
                        reasonDetails: `إلغاء طلب ${existing.orderNumber}: ${reason}`,
                        reportedBy: 'نظام المطعم',
                        restaurantOrderId: existing.id,
                    });
                }
            }
        }
        showToast('تم إلغاء الطلب بنجاح', 'info');
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
    };
    const closeOrderAfterPayment = async (orderId, invoiceId) => {
        const existing = (await getFromStore('restaurant_orders', orderId).catch(() => null)) || orders.find((o) => o.id === orderId);
        if (!existing)
            return;
        const now = new Date().toISOString();
        const updatedOrder = {
            ...existing,
            status: 'paid',
            paidAt: now,
            invoiceId,
            cashierPending: false,
            cashierClosedAt: now,
            timeline: [
                ...existing.timeline,
                {
                    id: 'tl-' + Date.now(),
                    timestamp: now,
                    action: `تم تسديد الحساب وإصدار فاتورة #${invoiceId}`,
                    userName: 'الكاشير',
                },
            ],
        };
        await putInStore('restaurant_orders', updatedOrder);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? updatedOrder : o)));
        // Update table
        if (existing.tableId) {
            const nextStatus = settings?.tableAfterPayment === 'available' ? 'available' : 'cleaning';
            await updateTableStatus(existing.tableId, nextStatus);
        }
        setActiveRestaurantOrder(null);
        syncChannel?.postMessage({ type: 'restaurant_order_change' });
    };
    // Convert a restaurant order to the existing cashier cart format.
    const orderToCartItems = useCallback((order) => {
        return (order?.items || [])
            .filter((item) => item.status !== 'cancelled')
            .map((item) => {
                const prod = (products || []).find((p) => p.id === item.productId);
                const finalUnitPrice = Number(item.unitPrice || 0);
                const notesParts = [];
                const units = prod?.units || [];
                const defaultUnit = units.find((u) => u.isDefaultSale) || units[0];
                const selectedUnit = units.find((u) => String(u.id) === String(item.unitId))
                    || units.find((u) => String(u.name || '') === String(item.unitName || ''))
                    || defaultUnit;
                const conversionFactor = Number(item.conversionFactor || selectedUnit?.conversionToBase) || 1;
                return {
                    productId: item.productId,
                    productName: item.productName,
                    unitId: item.unitId || selectedUnit?.id || 'u-piece',
                    unitName: item.unitName || selectedUnit?.name || 'وجبة',
                    availableUnits: units.length ? units : [{ id:'u-piece', name:'وجبة', conversionToBase:1, costPrice:Number(item.unitPrice||0)*0.5, salePrice:finalUnitPrice, isDefaultSale:true }],
                    quantity: Number(item.quantity || 1),
                    conversionFactor,
                    unitPrice: finalUnitPrice,
                    discount: 0,
                    taxRate: Number(prod?.taxRate) || 0,
                    costPriceAtSale: (Number(prod?.costPrice) || 0) * conversionFactor,
                    baseStockAvailable: 999,
                    notes: notesParts.join(' | '),
                    restaurantOrderId: order.id,
                    restaurantOrderItemId: item.id,
                    restaurantTableNumber: order.tableNumber,
                    restaurantWaiterName: order.waiterName,
                    restaurantOrderNumber: order.orderNumber,
                };
            });
    }, [products]);

    // Recall order to POS Cart. The restaurant order remains open until payment.
    const recallOrderToPOS = (order) => {
        const cartItems = orderToCartItems(order);
        setCart(cartItems);
        const restaurantCustomerName = String(order?.customerName || '').trim();
        if (restaurantCustomerName) {
            const normalized = restaurantCustomerName.toLocaleLowerCase('ar');
            const matchedCustomer = (customers || []).find((c) => !c?.deletedAt && String(c.name || '').trim().toLocaleLowerCase('ar') === normalized);
            setSelectedCustomer(matchedCustomer || {
                id: `restaurant-customer-${order.id}`,
                name: restaurantCustomerName,
                phone: order.customerPhone || '',
                balance: 0,
                priceList: 'retail',
                isVirtual: true,
                restaurantOrderId: order.id,
            });
        } else {
            setSelectedCustomer({ id:'cust-walkin', name:'عميل نقدي', balance:0, priceList:'retail', isVirtual:true });
        }
        setActiveRestaurantOrder(order);
        setActiveTab('pos');
        const tableText = order.tableName || (order.tableNumber ? `طاولة ${order.tableNumber}` : 'طلب سفري');
        showToast(`تم استدعاء ${tableText} للكاشير`, 'success');
    };

    // If the waiter adds items to the same table while the cashier already has the order open,
    // merge the new/updated restaurant lines into the cashier cart automatically.
    useEffect(() => {
        if (!activeRestaurantOrder?.id) return;
        const latest = orders.find((o) => o.id === activeRestaurantOrder.id);
        if (!latest || latest.status === 'paid' || latest.status === 'cancelled') return;
        if (latest === activeRestaurantOrder) return;
        const latestItems = orderToCartItems(latest);
        setCart((prev) => {
            const manualItems = (prev || []).filter((x) => x.restaurantOrderId !== latest.id);
            const previousRestaurant = new Map((prev || []).filter((x) => x.restaurantOrderId === latest.id).map((x) => [x.restaurantOrderItemId, x]));
            const mergedRestaurant = latestItems.map((x) => {
                const before = previousRestaurant.get(x.restaurantOrderItemId);
                return before ? { ...before, ...x } : x;
            });
            return [...mergedRestaurant, ...manualItems];
        });
        setActiveRestaurantOrder(latest);
        if (latest.cashierPending || ['ready','served','waiting_payment'].includes(latest.status)) {
            showToast(`تحديث طلب ${latest.tableNumber ? `الطاولة ${latest.tableNumber}` : latest.orderNumber} وصل للكاشير`, 'info');
        }
    }, [orders, activeRestaurantOrder, orderToCartItems, setCart, showToast]);

    const clearActiveRestaurantOrder = () => {
        setActiveRestaurantOrder(null);
    };
    // Kitchen Sections CRUD
    const addKitchenSection = async (ks) => {
        const newKs = {
            id: makeRestaurantId('ks'),
            name: ks.name || 'قسم جديد',
            printerName: ks.printerName,
            isDefault: ks.isDefault || false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await putInStore('kitchen_sections', newKs);
        setKitchenSections((prev) => [...prev, newKs]);
        syncChannel?.postMessage({ type: 'restaurant_ks_change' });
    };
    const updateKitchenSection = async (id, ks) => {
        const existing = (await getFromStore('kitchen_sections', id).catch(() => null)) || kitchenSections.find((k) => k.id === id);
        if (!existing)
            return;
        const updated = { ...existing, ...ks };
        await putInStore('kitchen_sections', updated);
        setKitchenSections((prev) => prev.map((k) => (k.id === id ? updated : k)));
        syncChannel?.postMessage({ type: 'restaurant_ks_change' });
    };
    const deleteKitchenSection = async (id) => {
        await deleteFromStore('kitchen_sections', id);
        setKitchenSections((prev) => prev.filter((k) => k.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_ks_change' });
    };
    // Reservations
    const addReservation = async (res) => {
        const newRes = {
            id: makeRestaurantId('res'),
            customerName: res.customerName || '',
            customerPhone: res.customerPhone || '',
            guestCount: res.guestCount || 2,
            date: res.date || new Date().toISOString().slice(0, 10),
            time: res.time || '20:00',
            tableId: res.tableId,
            tableNumber: res.tableNumber,
            notes: res.notes,
            status: 'confirmed',
            createdAt: new Date().toISOString(),
        };
        await putInStore('table_reservations', newRes);
        setReservations((prev) => [...prev, newRes]);
        if (newRes.tableId) {
            await updateTableStatus(newRes.tableId, 'reserved', { customerName: newRes.customerName });
        }
        syncChannel?.postMessage({ type: 'restaurant_reservation_change' });
    };
    const updateReservation = async (id, res) => {
        const existing = (await getFromStore('table_reservations', id).catch(() => null)) || reservations.find((r) => r.id === id);
        if (!existing)
            return;
        const updated = { ...existing, ...res, updatedAt: new Date().toISOString() };
        await putInStore('table_reservations', updated);
        setReservations((prev) => prev.map((r) => (r.id === id ? updated : r)));
        syncChannel?.postMessage({ type: 'restaurant_reservation_change' });
    };
    const deleteReservation = async (id) => {
        await deleteFromStore('table_reservations', id);
        setReservations((prev) => prev.filter((r) => r.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_reservation_change' });
    };
    // Recipes & Waste
    const saveRecipe = async (recipeData) => {
        const id = recipeData.id || makeRestaurantId('rcp');
        const productId = recipeData.mealProductId || recipeData.productId || '';
        const productName = recipeData.mealProductName || recipeData.productName || 'وجبة';
        const items = recipeData.items || recipeData.ingredients || [];
        const ingredients = recipeData.ingredients || recipeData.items || [];
        const recipeCost = ingredients.reduce((sum, ing) => {
            const raw = products.find((p) => p.id === (ing.ingredientProductId || ing.productId));
            const unit = (raw?.units || []).find((u) => u.id === (ing.ingredientUnitId || ing.unitId)) || (raw?.units || []).find((u) => (Number(u.conversionToBase) || 1) === 1) || (raw?.units || [])[0];
            const factor = Number(ing.conversionFactor ?? unit?.conversionToBase ?? 1) || 1;
            const baseQty = Number(ing.baseQuantity) > 0 ? Number(ing.baseQuantity) : (Number(ing.quantity) || 0) * factor;
            const baseCost = Number(raw?.costPrice) || (Number(unit?.costPrice) / Math.max(1, Number(unit?.conversionToBase) || 1)) || 0;
            return sum + baseQty * baseCost;
        }, 0);
        const roundedRecipeCost = Number(recipeCost.toFixed(4));
        const recipe = {
            id,
            productId,
            productName,
            mealProductId: productId,
            mealProductName: productName,
            items,
            ingredients,
            recipeCost: roundedRecipeCost,
            costPrice: roundedRecipeCost,
            notes: recipeData.notes,
            updatedAt: new Date().toISOString(),
        };
        await putInStore('recipes', recipe);
        const manufacturedProduct = products.find((p) => p.id === productId);
        if (manufacturedProduct) {
            const updatedUnits = (manufacturedProduct.units || []).map((u) => ({ ...u, costPrice: Number((roundedRecipeCost * Math.max(1, Number(u.conversionToBase) || 1)).toFixed(4)) }));
            await putInStore('products', { ...manufacturedProduct, costPrice: roundedRecipeCost, units: updatedUnits, manufacturedCost: roundedRecipeCost, manufacturedCostUpdatedAt: new Date().toISOString() });
            refreshData?.().catch?.(() => {});
        }
        setRecipes((prev) => {
            const idx = prev.findIndex((r) => r.id === id || (productId && r.productId === productId));
            if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = recipe;
                return copy;
            }
            return [...prev, recipe];
        });
        syncChannel?.postMessage({ type: 'restaurant_recipe_change' });
    };
    const deleteRecipe = async (id) => {
        await deleteFromStore('recipes', id);
        setRecipes((prev) => prev.filter((r) => r.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_recipe_change' });
    };
    const addWasteRecord = async (waste) => {
        const newWaste = {
            id: waste.id || makeRestaurantId('wst'),
            date: waste.date || new Date().toISOString(),
            productId: waste.productId || '',
            productName: waste.productName || waste.itemName || 'صنف تالف',
            itemName: waste.itemName || waste.productName || 'صنف تالف',
            quantity: waste.quantity || 1,
            unit: waste.unit || waste.unitName || 'قطعة',
            unitName: waste.unitName || waste.unit || 'قطعة',
            estimatedCost: waste.estimatedCost ?? waste.cost ?? 0,
            cost: waste.cost ?? waste.estimatedCost ?? 0,
            reason: waste.reason || 'other',
            reasonDetails: waste.reasonDetails || waste.notes,
            notes: waste.notes || waste.reasonDetails,
            reportedBy: waste.reportedBy || 'المسؤول',
            restaurantOrderId: waste.restaurantOrderId,
        };
        await putInStore('waste_records', newWaste);
        setWasteRecords((prev) => [newWaste, ...prev]);
        syncChannel?.postMessage({ type: 'restaurant_waste_change' });
    };
    const deleteWasteRecord = async (id) => {
        await deleteFromStore('waste_records', id);
        setWasteRecords((prev) => prev.filter((row) => row.id !== id));
        syncChannel?.postMessage({ type: 'restaurant_waste_change' });
        showToast?.('تم حذف سجل الهالك/الاستهلاك', 'info');
    };
    const updateReservationStatus = async (id, status) => {
        await updateReservation(id, { status });
    };
    return (_jsx(RestaurantContext.Provider, { value: {
            sections,
            tables,
            orders,
            kitchenSections,
            reservations,
            recipes,
            wasteRecords,
            wasteLogs: wasteRecords,
            activeRestaurantOrder,
            setActiveRestaurantOrder,
            addSection,
            updateSection,
            deleteSection,
            addTable,
            updateTable,
            deleteTable,
            deleteRestaurantOrder,
            updateTableStatus,
            createOrder,
            updateOrder,
            sendOrderToKitchen,
            updateOrderItemStatus,
            updateOrderStatus,
            requestBillForTable,
            transferTableOrder,
            mergeTableOrders,
            cancelRestaurantOrder,
            closeOrderAfterPayment,
            recallOrderToPOS,
            clearActiveRestaurantOrder,
            addKitchenSection,
            updateKitchenSection,
            deleteKitchenSection,
            addReservation,
            updateReservation,
            updateReservationStatus,
            deleteReservation,
            saveRecipe,
            addRecipe: saveRecipe,
            updateRecipe: saveRecipe,
            deleteRecipe,
            addWasteRecord,
            logWaste: addWasteRecord,
            deleteWasteRecord,
            deleteWaste: deleteWasteRecord,
            refreshRestaurantData,
        }, children: children }));
};
export const useRestaurant = () => {
    const context = useContext(RestaurantContext);
    if (!context) {
        throw new Error('useRestaurant must be used within a RestaurantProvider');
    }
    return context;
};
