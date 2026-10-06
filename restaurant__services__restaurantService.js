import { getAllFromStore, getFromStore, saveToStore } from './restaurant__services__db.js?v=7.9.4.136-localization';
// Default Sections
export const DEFAULT_RESTAURANT_SECTIONS = [
    { id: 'sec-indoor', name: 'الصالة الداخلية', displayOrder: 1 },
    { id: 'sec-outdoor', name: 'الصالة الخارجية (التراس)', displayOrder: 2 },
    { id: 'sec-family', name: 'قسم العائلات', displayOrder: 3 },
    { id: 'sec-vip', name: 'صالة VIP', displayOrder: 4 },
];
// Default Kitchen Sections
export const DEFAULT_KITCHEN_SECTIONS = [
    { id: 'ks-main', name: 'المطبخ الرئيسي (الوجبات والبيتزا)', isDefault: true },
    { id: 'ks-bar', name: 'بار المشروبات والقهوة والعصائر' },
    { id: 'ks-dessert', name: 'قسم الحلويات والمخبوزات' },
    { id: 'ks-grill', name: 'المشاوي والشاورما' },
];
// Default Tables
export const DEFAULT_RESTAURANT_TABLES = [
    { id: 'tbl-1', tableNumber: 'T-01', sectionId: 'sec-indoor', sectionName: 'الصالة الداخلية', seats: 2, status: 'available' },
    { id: 'tbl-2', tableNumber: 'T-02', sectionId: 'sec-indoor', sectionName: 'الصالة الداخلية', seats: 4, status: 'available' },
    { id: 'tbl-3', tableNumber: 'T-03', sectionId: 'sec-indoor', sectionName: 'الصالة الداخلية', seats: 4, status: 'available' },
    { id: 'tbl-4', tableNumber: 'T-04', sectionId: 'sec-indoor', sectionName: 'الصالة الداخلية', seats: 6, status: 'available' },
    { id: 'tbl-5', tableNumber: 'T-05', sectionId: 'sec-family', sectionName: 'قسم العائلات', seats: 6, status: 'available' },
    { id: 'tbl-6', tableNumber: 'T-06', sectionId: 'sec-family', sectionName: 'قسم العائلات', seats: 8, status: 'available' },
    { id: 'tbl-7', tableNumber: 'T-07', sectionId: 'sec-outdoor', sectionName: 'الصالة الخارجية (التراس)', seats: 4, status: 'available' },
    { id: 'tbl-8', tableNumber: 'T-08', sectionId: 'sec-outdoor', sectionName: 'الصالة الخارجية (التراس)', seats: 4, status: 'available' },
    { id: 'tbl-9', tableNumber: 'VIP-01', sectionId: 'sec-vip', sectionName: 'صالة VIP', seats: 10, status: 'available' },
];
// Audio chime synthesizers via Web Audio API (Reliable, no external MP3 dependencies!)
export function playChimeSound(type) {
    if (typeof window === 'undefined')
        return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass)
            return;
        const ctx = new AudioContextClass();
        if (type === 'new_order') {
            // Pleasant double bell (C5 -> G5)
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc1.frequency.setValueAtTime(783.99, ctx.currentTime + 0.15); // G5
            gain1.gain.setValueAtTime(0.3, ctx.currentTime);
            gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            osc1.start();
            osc1.stop(ctx.currentTime + 0.5);
        }
        else if (type === 'ready') {
            // Cheerful ready chime (G5 -> E6)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(783.99, ctx.currentTime);
            osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.18);
            gain.gain.setValueAtTime(0.35, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.6);
        }
        else {
            // Subtle warning tone
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        }
    }
    catch (err) {
        console.warn('Audio play error (ignored):', err);
    }
}
// Initialization of restaurant defaults in database.
// IMPORTANT: seed only once per company. This prevents deleted/custom tables from
// being recreated or overwriting cloud data every time the restaurant provider reloads.
export async function initRestaurantDefaults() {
    let sections = await getAllFromStore('restaurant_sections');
    let tables = await getAllFromStore('restaurant_tables');
    let kitchenSections = await getAllFromStore('kitchen_sections');
    const marker = await getFromStore('settings', 'restaurant_bootstrap_v2').catch(() => null);

    if (!marker?.seeded) {
        const hasRestaurantData = (sections?.length || 0) + (tables?.length || 0) + (kitchenSections?.length || 0) > 0;

        // On a truly new company, create the starter layout once.
        if (!hasRestaurantData) {
            for (const sec of DEFAULT_RESTAURANT_SECTIONS) {
                await saveToStore('restaurant_sections', { ...sec, createdAt: new Date().toISOString() });
            }
            for (const tbl of DEFAULT_RESTAURANT_TABLES) {
                await saveToStore('restaurant_tables', { ...tbl, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            }
            for (const ks of DEFAULT_KITCHEN_SECTIONS) {
                await saveToStore('kitchen_sections', { ...ks, createdAt: new Date().toISOString() });
            }
            sections = await getAllFromStore('restaurant_sections');
            tables = await getAllFromStore('restaurant_tables');
            kitchenSections = await getAllFromStore('kitchen_sections');
        } else {
            // Existing/cloud restaurant data must be preserved exactly.
            // Only create a basic kitchen section if none exists at all.
            if (!kitchenSections || kitchenSections.length === 0) {
                const ks = { ...DEFAULT_KITCHEN_SECTIONS[0], createdAt: new Date().toISOString() };
                await saveToStore('kitchen_sections', ks);
                kitchenSections = [ks];
            }
        }

        await saveToStore('settings', {
            key: 'restaurant_bootstrap_v2',
            seeded: true,
            seededAt: new Date().toISOString(),
        });
    }

    return {
        sections: sections || [],
        tables: tables || [],
        kitchenSections: kitchenSections || [],
    };
}
// Generate unique order and kitchen ticket IDs
export function generateOrderNumber() {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-R-${rand}`;
}
export function generateTakeawayQueueNumber() {
    const rand = Math.floor(10 + Math.random() * 90);
    return `A-${rand}`;
}
export function generateKitchenTicketId() {
    return `KT-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
}
