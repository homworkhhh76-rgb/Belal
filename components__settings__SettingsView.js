import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useRef } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { usePWAInstall } from './hooks__usePWAInstall.js?v=7.9.4.136-localization';
import { db } from './services__db.js?v=7.9.4.136-localization';
import { smartPrinter } from './services__printer.js?v=7.9.4.136-localization';
import { TELEGRAM_BOT_URL, normalizeTelegramRecipients, testTelegramRecipient, testAllTelegramRecipients, sendFullTelegramReport } from './services__telegram.js?v=7.9.4.136-localization';
import { saveTelegramConfig } from './services__telegramReports.js?v=7.9.4.136-localization';
import { materializeLogoSource, getBrandLogoDisplayUrl, DEFAULT_LOGO_DATA_URL } from './brand__logo.js?v=7.9.4.136-localization';
import { BrandLogoImage } from './components__common__BrandLogoImage.js?v=7.9.4.136-localization';
import { uploadProductImageToTelegram } from './services__productImages.js?v=7.9.4.136-localization';
import { TelegramQuickGuide } from './components__settings__TelegramQuickGuide.js?v=7.9.4.136-localization';
import { Store, Printer, ShieldCheck, Building2, Database, Download, Upload, RefreshCw, Trash2, Save, Edit2, X, Bluetooth, Cable, Bot, Send, ExternalLink, UserPlus, MessageCircle, CreditCard, WalletCards, Landmark, ArrowLeftRight, SlidersHorizontal, Warehouse, Settings2 } from 'lucide-react';
const P2P_ICON_OPTIONS = [
    ['palpay','PalPay'],['jawwal-pay','Jawwal Pay'],['bank-palestine','بنك فلسطين'],
    ['bank','بنك آخر'],['wallet','محفظة إلكترونية'],['card','بطاقة / نقطة بيع'],['transfer','تحويل مالي'],['other','طريقة أخرى'],
];
const P2P_BUILTIN_LOGOS = {
    'palpay':'./p2p-palpay.jpg',
    'jawwal-pay':'./p2p-jawwal-pay.png',
    'bank-palestine':'./p2p-bank-palestine.jpg',
};
const normalizeP2PMethods = (raw) => {
    const source = Array.isArray(raw) ? raw : [];
    return source.map((method,index) => {
        const id = String(method?.id || `p2p-${index+1}`).trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64) || `p2p-${index+1}`;
        const fields = Array.isArray(method?.fields) ? method.fields : [];
        return {
            id,
            name:String(method?.name || `طريقة دفع ${index+1}`).trim().slice(0,80),
            icon:P2P_ICON_OPTIONS.some(([value])=>value===method?.icon) ? method.icon : 'bank',
            logoUrl:String(method?.logoUrl || '').trim().slice(0,2000),
            logoTelegramFileId:String(method?.logoTelegramFileId || '').trim().slice(0,300),
            logoTelegramUniqueId:String(method?.logoTelegramUniqueId || '').trim().slice(0,300),
            logoUpdatedAt:String(method?.logoUpdatedAt || '').trim().slice(0,80),
            qrImageUrl:String(method?.qrImageUrl || '').trim().slice(0,2000),
            qrTelegramFileId:String(method?.qrTelegramFileId || '').trim().slice(0,300),
            qrTelegramUniqueId:String(method?.qrTelegramUniqueId || '').trim().slice(0,300),
            qrUpdatedAt:String(method?.qrUpdatedAt || '').trim().slice(0,80),
            note:String(method?.note || '').slice(0,400),
            fields:fields.map((field,fieldIndex)=>({
                id:String(field?.id || `field-${fieldIndex+1}`).trim().replace(/[^A-Za-z0-9_-]/g,'-').slice(0,64) || `field-${fieldIndex+1}`,
                label:String(field?.label || `بيان ${fieldIndex+1}`).slice(0,80),
                value:String(field?.value || '').slice(0,500),
            })),
        };
    }).filter((method)=>method.name);
};
export const SettingsView = () => {
    const { settings, updateSettings, warehouses, saveWarehouse, deleteWarehouse, showToast, refreshData, currentUser, openNewFinancialYear, } = useApp();
    const { isInstallable, isInstalled, isIOS, isSecureContext, promptInstall } = usePWAInstall();
    const [printerState, setPrinterState] = useState(() => smartPrinter.getState());
    useEffect(() => smartPrinter.subscribe(setPrinterState), []);
    useEffect(() => { smartPrinter.autoReconnect().catch(() => {}); }, []);
    // Local copy of settings for form editing
    const [formSettings, setFormSettings] = useState(settings);
    const draftBaseline=useRef(settings);
    // Warehouse modal / editing
    const [newWarehouseName, setNewWarehouseName] = useState('');
    const [newWarehouseCode, setNewWarehouseCode] = useState('');
    const [editingWarehouse, setEditingWarehouse] = useState(null);
    const [telegramChatIdInput, setTelegramChatIdInput] = useState('');
    const [telegramBusy, setTelegramBusy] = useState('');
    const [logoUploadBusy, setLogoUploadBusy] = useState(false);
    const [p2pImageBusy, setP2PImageBusy] = useState('');
    const [newFinancialYearName, setNewFinancialYearName] = useState('');
    const [newFinancialYearStart, setNewFinancialYearStart] = useState(new Date().toISOString().slice(0, 10));
    const [financialYearBusy, setFinancialYearBusy] = useState(false);
    // Keep local drafts stable while the user is typing. Cloud sync may update `settings`
    // in the background, but it must never overwrite an in-progress form.
    const [settingsDraftLocked, setSettingsDraftLocked] = useState(false);
    const [settingsSection, setSettingsSection] = useState('general');
    const markSettingsDraft = () => setSettingsDraftLocked(true);
    const isTelegramManager = !!(currentUser?.isCompanyManager || ['admin','manager','owner'].includes(String(currentUser?.roleCode || '').toLowerCase()) || /مدير|admin|manager|owner/i.test(String(currentUser?.role || '')));
    const syncTelegramServerConfig = async (draft) => { try { await saveTelegramConfig(draft || formSettings); } catch (error) { console.warn('Telegram server config sync skipped', error); } };
    useEffect(() => {
        // Only accept a background settings refresh before the user starts editing.
        // Once editing starts, preserve the local draft until the page is left/reopened.
        if (!settingsDraftLocked) {setFormSettings(settings);draftBaseline.current=settings;}
    }, [settings, settingsDraftLocked]);
    useEffect(() => {
        const root = document.getElementById('settings-screen');
        if (!root) return;
        const nodes = Array.from(root.children);
        for (const node of nodes) {
            if (node.id === 'settings-section-nav' || node.dataset?.settingsHeader === '1') continue;
            let section = '';
            if (node.tagName === 'FORM') section = 'general';
            else if (node.id === 'settings-financial-years' || /إدارة الفروع والمخازن/.test(node.textContent || '')) section = 'inventory';
            else if (node.id === 'settings-p2p-methods' || node.id === 'settings-telegram') section = 'telegram';
            else if (node.id === 'settings-install-app' || /النسخ الاحتياطي واستعادة البيانات/.test(node.textContent || '')) section = 'system';
            if (!section) continue;
            node.dataset.settingsSection = section;
            node.style.display = section === settingsSection ? '' : 'none';
        }
    }, [settingsSection, warehouses.length, settingsDraftLocked, formSettings]);
    const logoPreviewUrl = getBrandLogoDisplayUrl(formSettings);
    const resolveLogoSettings = async (draftSettings) => {
        const nextSettings = { ...draftSettings };
        const explicitUrl = typeof nextSettings.logoSourceUrl === 'string' ? nextSettings.logoSourceUrl.trim() : '';
        const legacyUrl = !explicitUrl && typeof nextSettings.logoUrl === 'string' && nextSettings.logoUrl.trim() && !/^data:image\//i.test(nextSettings.logoUrl.trim()) ? nextSettings.logoUrl.trim() : '';
        const inputUrl = explicitUrl || legacyUrl;
        if (!inputUrl) {
            if (typeof nextSettings.logoUrl === 'string' && /^data:image\//i.test(nextSettings.logoUrl.trim())) {
                nextSettings.logoSourceUrl = '';
                return nextSettings;
            }
            nextSettings.logoUrl = '';
            nextSettings.logoSourceUrl = '';
            return nextSettings;
        }
        const resolved = await materializeLogoSource(inputUrl);
        nextSettings.logoSourceUrl = resolved.logoSourceUrl || inputUrl;
        nextSettings.logoUrl = resolved.logoUrl || nextSettings.logoUrl || '';
        if (!resolved.logoUrl)
            showToast('تم حفظ رابط الصورة. إذا لم يظهر في الفواتير فاستعمل رابطاً مباشراً للصورة.', 'warning');
        return nextSettings;
    };
    const handleSettingsLogoUpload = async (file) => {
        if (!file) return;
        if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) { showToast('اختر صورة PNG أو JPG أو WEBP', 'warning'); return; }
        setLogoUploadBusy(true);
        try {
            const original = await new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=()=>reject(new Error('تعذر قراءة الشعار')); r.readAsDataURL(file); });
            const image = await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('تعذر قراءة الصورة'));img.src=original;});
            const canvas=document.createElement('canvas');
            const scale=Math.min(1,512/Math.max(image.width,image.height));
            canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
            canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
            const dataUrl=canvas.toDataURL('image/webp',0.85);
            const patch={logoUrl:dataUrl,logoSourceUrl:'',logoTelegramFileId:'',logoTelegramUniqueId:'',logoStorage:'synced-settings',logoUpdatedAt:new Date().toISOString()};
            setFormSettings(prev=>({...prev,...patch}));
            await updateSettings(patch);
            // Keep a compact durable image in settings; Telegram is an additional copy.
            try {
                const uploaded=await uploadProductImageToTelegram(dataUrl,`store-logo-${Date.now()}.webp`);
                const cloudPatch={logoSourceUrl:uploaded.url||'',logoTelegramFileId:uploaded.fileId,logoTelegramUniqueId:uploaded.fileUniqueId,logoStorage:'cloud-photo'};
                await updateSettings(cloudPatch);
                setFormSettings(prev=>({...prev,...cloudPatch}));
            } catch { /* The saved image remains available offline and in settings sync. */ }
            showToast('تم تحديث شعار المحل وظهر في الواجهة.', 'success');
        } catch(error) { showToast(error?.message || 'تعذر حفظ شعار المحل', 'error'); }
        finally { setLogoUploadBusy(false); }
    };
    const handleSaveGeneral = async (e) => {
        e.preventDefault();
        const nextSettings = formSettings.logoTelegramFileId ? { ...formSettings } : await resolveLogoSettings(formSettings);
        setFormSettings(nextSettings);
        const changed=Object.fromEntries(Object.entries(nextSettings).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(draftBaseline.current[key])));
        const saved=await updateSettings(changed);
        draftBaseline.current=saved;setFormSettings(saved);setSettingsDraftLocked(false);
        syncTelegramServerConfig(nextSettings).catch(()=>{});
        showToast('تم حفظ الإعدادات بنجاح', 'success');
    };
    const handleAddWarehouse = async (e) => {
        e.preventDefault();
        if (!newWarehouseName.trim())
            return;
        const newW = {
            id: editingWarehouse?.id || 'wh-' + Date.now(),
            name: newWarehouseName.trim(),
            code: newWarehouseCode.trim() || editingWarehouse?.code || 'WH-' + (warehouses.length + 1),
            isDefault: editingWarehouse?.isDefault || false,
        };
        await saveWarehouse(newW);
        setNewWarehouseName('');
        setNewWarehouseCode('');
        setEditingWarehouse(null);
    };
    const handleOpenFinancialYear = async (e) => {
        e?.preventDefault?.();
        if (financialYearBusy) return;
        const ok = window.confirm('فتح سنة مالية جديدة سيؤرشف فواتير المبيعات والمشتريات الخاصة بالسنة الحالية. لا يوجد تاريخ نهاية مستقل؛ تنتهي السنة الحالية عند بداية الجديدة. متابعة؟');
        if (!ok) return;
        setFinancialYearBusy(true);
        try {
            const result = await openNewFinancialYear?.({ name: newFinancialYearName, startDate: newFinancialYearStart });
            if (result) { setNewFinancialYearName(''); setNewFinancialYearStart(new Date().toISOString().slice(0,10)); }
        } finally { setFinancialYearBusy(false); }
    };
    // Full Database JSON Export
    const handleExportBackup = async () => {
        const backupData = await db.exportCompleteBackup();
        const blob = new Blob([JSON.stringify(backupData, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Oscar_Accounting_Backup_${new Date().toISOString().split('T')[0]}.json`;
        link.rel = 'noopener';
        link.style.position = 'fixed';
        link.style.left = '-9999px';
        document.body.appendChild(link);
        try { link.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, view:window })); }
        catch (_) { try { link.click(); } catch (_) { window.open(url, '_blank', 'noopener'); } }
        setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 15000);
        showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    };
    // Full Database JSON Restore
    const handleImportBackup = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const json = JSON.parse(event.target?.result);
                await db.importBackup(json);
                await refreshData();
                showToast('تم استرجاع النسخة الاحتياطية بنجاح!', 'success');
            }
            catch (err) {
                showToast('ملف النسخة الاحتياطية غير صالح', 'error');
            }
        };
        reader.readAsText(file);
    };
    const handleInstallApp = async () => {
        if (isInstalled) {
            showToast('التطبيق مثبت بالفعل على هذا الجهاز', 'success');
            return;
        }
        if (!isInstallable) {
            if (isIOS)
                showToast('على iPhone/iPad استخدم Safari ثم مشاركة ← إضافة إلى الشاشة الرئيسية', 'warning');
            else if (!isSecureContext)
                showToast('تثبيت التطبيق يحتاج فتح النظام عبر HTTPS أو localhost في Chrome', 'warning');
            else
                showToast('نافذة التثبيت غير متاحة الآن. افتح النظام عبر Chrome وانتظر لحظات ثم أعد المحاولة.', 'warning');
            return;
        }
        const result = await promptInstall();
        if (result?.installed)
            showToast('تم بدء تثبيت تطبيق كاش توب 3 على الجهاز', 'success');
        else if (result?.outcome === 'dismissed')
            showToast('تم إلغاء التثبيت', 'warning');
        else if (result?.alreadyInstalled)
            showToast('التطبيق مثبت بالفعل على هذا الجهاز', 'success');
        else
            showToast('تعذر فتح نافذة التثبيت من Chrome الآن', 'warning');
    };
    const handleConnectBluetoothPrinter = async () => {
        try {
            const state = await smartPrinter.connectBluetooth();
            if (state.systemMode) {
                showToast(state.isIOS
                    ? 'تم تفعيل طباعة iPhone. عند طباعة الفاتورة ستفتح نافذة طباعة النظام/AirPrint لاختيار الطابعة.'
                    : 'المتصفح لا يتيح Bluetooth مباشر؛ تم تفعيل طباعة النظام. اختر الطابعة من نافذة الطباعة عند الفاتورة.', 'success');
            } else {
                showToast(`تم الاتصال بالطابعة ${state.name || ''}`.trim(), 'success');
            }
        } catch (err) {
            if (err?.name === 'NotFoundError') {
                showToast('لم يتم اختيار طابعة. إذا كانت الطابعة Bluetooth Classic ولا تظهر بالقائمة، استخدم طباعة النظام.', 'warning');
                return;
            }
            showToast(err?.message || 'تعذر الاتصال بطابعة البلوتوث', 'error');
        }
    };
    const handleConnectSerialPrinter = async () => {
        try {
            const state = await smartPrinter.connectSerial();
            if (state.systemMode) showToast('Web Serial غير متاح هنا؛ تم تفعيل طباعة النظام بدلاً منه.', 'success');
            else showToast(`تم الاتصال بالطابعة ${state.name || ''}`.trim(), 'success');
        } catch (err) {
            if (err?.name === 'NotFoundError') return;
            showToast(err?.message || 'تعذر الاتصال بالطابعة عبر Serial', 'error');
        }
    };
    const handleEnableSystemPrinter = async () => {
        const state = await smartPrinter.enableSystemPrint();
        showToast(`تم تفعيل ${state.name || 'طباعة النظام'}. ستختار الطابعة وقت الطباعة.`, 'success');
    };
    const handleReconnectPrinter = async () => {
        try {
            await smartPrinter.autoReconnect({ retries: 3 });
            const state = smartPrinter.getState();
            if (state.connected) showToast(`تمت إعادة الاتصال بالطابعة ${state.name || state.preferredName || ''}`.trim(), 'success');
            else showToast('تعذر الوصول للطابعة المحفوظة. تأكد أنها تعمل والبلوتوث مفتوح.', 'warning');
        } catch (err) {
            showToast(err?.message || 'تعذر إعادة الاتصال بالطابعة', 'error');
        }
    };
    const handleDisconnectPrinter = async () => {
        await smartPrinter.disconnect({ forget:true });
        showToast('تم فصل الطابعة وإلغاء الربط المحفوظ', 'info');
    };
    const handleResetSeedData = async () => {
        if (window.confirm('هل أنت متأكد من إعادة تعيين البيانات وتحميل البيانات التجريبية الشاملة؟')) {
            await db.resetToSeedData();
            await refreshData();
            showToast('تمت إعادة ضبط البيانات بنجاح', 'success');
        }
    };
    const telegramRecipients = normalizeTelegramRecipients(formSettings.telegramRecipients);
    const handleAddTelegramRecipient = async () => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        const chatId = String(telegramChatIdInput || '').trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
        if (!/^-?\d{5,20}$/.test(chatId)) {
            showToast('اكتب Chat ID رقمي صحيح مثل 6764610810', 'warning');
            return;
        }
        setTelegramBusy(`add:${chatId}`);
        try {
            const nextRecipients = [
                ...telegramRecipients.filter((r) => String(r.chatId || '').trim() !== chatId),
                { chatId, username:'', label:`Chat ID ${chatId}`, enabled:true },
            ];
            const nextTelegramSettings = {
                ...formSettings,
                telegramEnabled:true,
                telegramBotUsername:'Oskarteaam_bot',
                telegramBotUrl:TELEGRAM_BOT_URL,
                telegramRecipients:nextRecipients,
            };
            await updateSettings(Object.fromEntries(Object.entries(nextTelegramSettings).filter(([key])=>key.startsWith('telegram'))));
            await syncTelegramServerConfig(nextTelegramSettings);
            setFormSettings((prev) => ({ ...prev, telegramEnabled:true, telegramRecipients:nextRecipients }));
            setTelegramChatIdInput('');
            try {
                await testTelegramRecipient(chatId);
                showToast(`تم حفظ Chat ID ${chatId} وإرسال رسالة اختبار بنجاح`, 'success');
            } catch (error) {
                showToast(`تم حفظ Chat ID ${chatId} لكن رسالة الاختبار فشلت: ${error?.message || 'تأكد أن الحساب فتح البوت وضغط Start'}`, 'warning');
            }
        } catch (error) {
            showToast(error?.message || 'تعذر حفظ Chat ID', 'error');
        } finally {
            setTelegramBusy('');
        }
    };
    const handleToggleTelegramRecipient = async (chatId) => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        const nextRecipients = telegramRecipients.map((r) => r.chatId === chatId ? { ...r, enabled: r.enabled === false } : r);
        await updateSettings({ telegramRecipients: nextRecipients });
        await syncTelegramServerConfig({ ...formSettings, telegramRecipients: nextRecipients });
    };
    const handleRemoveTelegramRecipient = async (chatId) => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        const nextRecipients = telegramRecipients.filter((r) => r.chatId !== chatId);
        await updateSettings({ telegramRecipients: nextRecipients });
        await syncTelegramServerConfig({ ...formSettings, telegramRecipients: nextRecipients });
    };
    const handleTestTelegramRecipient = async (chatId) => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        setTelegramBusy(`test:${chatId}`);
        try {
            await testTelegramRecipient(chatId);
            showToast('وصلت رسالة الاختبار إلى Telegram بنجاح', 'success');
        }
        catch (error) {
            showToast(`تعذر الإرسال. يجب فتح البوت والضغط على Start أولاً. ${error?.message || ''}`.trim(), 'error');
        }
        finally { setTelegramBusy(''); }
    };
    const handleTestAllTelegram = async () => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        setTelegramBusy('test-all');
        try {
            const result = await testAllTelegramRecipients();
            if (result?.ok) showToast(`تم إرسال الاختبار إلى ${result.sent || telegramRecipients.length} معرف`, 'success');
            else throw new Error(result?.failures?.[0]?.error || 'فشل الإرسال');
        }
        catch (error) { showToast(error?.message || 'تعذر اختبار معرفات Telegram', 'error'); }
        finally { setTelegramBusy(''); }
    };
    const handleSendTelegramReportNow = async () => {
        if (!isTelegramManager) { showToast('إعدادات Telegram متاحة للمدير فقط', 'error'); return; }
        setTelegramBusy('report');
        try {
            const result = await sendFullTelegramReport({ manual: true, force: true });
            showToast(`تم إرسال جميع التقارير إلى ${result?.sent || telegramRecipients.filter(r => r.enabled !== false).length} معرف`, 'success');
        }
        catch (error) { showToast(error?.message || 'تعذر إرسال تقرير Telegram', 'error'); }
        finally { setTelegramBusy(''); }
    };
    const handleSaveP2PPaymentChatId = async () => {
        if (!isTelegramManager) { showToast('إعداد استقبال دفعات العملاء متاح للمدير فقط', 'error'); return; }
        const chatId = String(formSettings.p2pPaymentChatId || '').trim();
        if (chatId && !/^-?\d{5,20}$/.test(chatId)) {
            showToast('اكتب Chat ID رقمي صحيحاً مثل 6764610810', 'warning');
            return;
        }
        await updateSettings({ p2pPaymentChatId: chatId });
        setFormSettings((prev) => ({ ...prev, p2pPaymentChatId: chatId }));
        showToast(chatId ? 'تم حفظ معرف استقبال دفعات العملاء' : 'تم إلغاء معرف استقبال دفعات العملاء', 'success');
    };
    const p2pPaymentMethods = normalizeP2PMethods(formSettings.p2pPaymentMethods);
    const setP2PMethods = (next) => { markSettingsDraft(); setFormSettings((prev) => ({ ...prev, p2pPaymentMethods: normalizeP2PMethods(typeof next === 'function' ? next(normalizeP2PMethods(prev.p2pPaymentMethods)) : next) })); };
    const readImageDataUrl = (file) => new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(String(r.result||'')); r.onerror=()=>reject(new Error('تعذر قراءة الصورة')); r.readAsDataURL(file); });
    const uploadP2PImage = async (methodId,file,kind='logo') => {
        if(!file) return;
        if(!/^image\/(png|jpe?g|webp)$/i.test(file.type||'')){showToast('اختر صورة PNG أو JPG أو WEBP','warning');return;}
        const busyKey=`${methodId}:${kind}`; setP2PImageBusy(busyKey);
        try{
            const dataUrl=await readImageDataUrl(file);
            const uploaded=await uploadProductImageToTelegram(dataUrl,`${kind==='qr'?'payment-qr':'payment-logo'}-${methodId}-${Date.now()}.jpg`);
            if(kind==='qr') patchP2PMethod(methodId,{qrImageUrl:uploaded.url||'',qrTelegramFileId:uploaded.fileId,qrTelegramUniqueId:uploaded.fileUniqueId,qrUpdatedAt:new Date().toISOString()});
            else patchP2PMethod(methodId,{logoUrl:uploaded.url||'',logoTelegramFileId:uploaded.fileId,logoTelegramUniqueId:uploaded.fileUniqueId,logoUpdatedAt:new Date().toISOString()});
            showToast(kind==='qr'?'تم حفظ صورة QR':'تم حفظ صورة طريقة الدفع','success');
        }catch(error){showToast(error?.message||'تعذر حفظ الصورة','error');}
        finally{setP2PImageBusy('');}
    };
    const patchP2PMethod = (methodId, patch) => setP2PMethods((items) => items.map((item) => item.id === methodId ? { ...item, ...patch } : item));
    const patchP2PField = (methodId, fieldId, patch) => setP2PMethods((items) => items.map((item) => item.id === methodId ? { ...item, fields:item.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) } : item));
    const addP2PField = (methodId) => setP2PMethods((items) => items.map((item) => item.id === methodId ? { ...item, fields:[...item.fields,{ id:`field-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, label:'بيان جديد', value:'' }] } : item));
    const removeP2PField = (methodId, fieldId) => setP2PMethods((items) => items.map((item) => item.id === methodId ? { ...item, fields:item.fields.filter((field) => field.id !== fieldId) } : item));
    const addP2PMethod = () => setP2PMethods((items) => [...items,{ id:`method-${Date.now()}`, name:'', icon:'bank', logoUrl:'', logoTelegramFileId:'', logoTelegramUniqueId:'', qrImageUrl:'', qrTelegramFileId:'', qrTelegramUniqueId:'', note:'', fields:[{ id:`field-${Date.now()}`, label:'اسم المستفيد', value:'' }] }]);
    const removeP2PMethod = (methodId) => {
        
        if (!window.confirm('حذف طريقة الدفع من صفحة سداد العملاء؟')) return;
        setP2PMethods((items) => items.filter((item) => item.id !== methodId));
    };
    const handleSaveP2PMethods = async () => {
        if (!isTelegramManager) { showToast('إعداد طرق الدفع متاح للمدير فقط', 'error'); return; }
        const normalized = normalizeP2PMethods(formSettings.p2pPaymentMethods).filter((item) => item.name.trim());
        if (normalized.some((item) => !item.fields.some((field) => String(field.value || '').trim()))) { showToast('كل طريقة دفع مضافة يجب أن تحتوي على معلومة تحويل واحدة على الأقل', 'warning'); return; }
        await updateSettings({ p2pPaymentMethods: normalized });
        setFormSettings((prev) => ({ ...prev, p2pPaymentMethods: normalized }));
        showToast(normalized.length ? 'تم حفظ طرق الدفع وستظهر مباشرة في رابط العميل' : 'تم حفظ الإعدادات بدون طرق دفع — لن تظهر أي طريقة في رابط العميل', 'success');
    };
    const telegramNotificationOptions = [
        ['telegramInvoiceNotifications','المبيعات وفواتير البيع'],
        ['telegramPurchaseNotifications','المشتريات وفواتير الموردين'],
        ['telegramReturnNotifications','المرتجعات'],
        ['telegramNotifyCustomers','العملاء وتغيّر أرصدتهم'],
        ['telegramNotifySuppliers','الموردون وتغيّر أرصدتهم'],
        ['telegramNotifyVouchers','سندات القبض والصرف'],
        ['telegramNotifyExpenses','المصروفات'],
        ['telegramNotifyTransfers','التحويلات بين الحسابات'],
        ['telegramNotifyAccounts','تغيّرات الحسابات المالية'],
        ['telegramNotifyProducts','الأصناف والأقسام والوصفات'],
        ['telegramNotifyInventory','حركات المخزون والتالف'],
        ['telegramNotifyWarehouses','المخازن والفروع'],
        ['telegramNotifyEmployees','الموظفون'],
        ['telegramNotifyShifts','فتح وإغلاق وتعديل الورديات'],
        ['telegramNotifyHeldInvoices','الفواتير المعلقة'],
        ['telegramNotifyRestaurant','طلبات وحجوزات المطعم'],
        ['telegramNotifyAuditLogs','سجل العمليات والتدقيق'],
        ['telegramSendImages','إرسال صور مصممة للفواتير والسندات والتنبيهات والتقارير'],
    ];
    const financialYears = Array.isArray(settings.financialYears) ? settings.financialYears : [];
    const activeFinancialYear = financialYears.find((year) => year?.id === settings.activeFinancialYearId) || financialYears.find((year) => year?.status === 'open');
    const financialYearCard = false && React.createElement('div',{id:'settings-financial-years',className:'p-5 rounded-2xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/70 shadow-xs space-y-4'},
        React.createElement('div',{className:'flex items-center gap-3 border-b pb-3 border-slate-100 dark:border-slate-800'},React.createElement('div',{className:'w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-xl'},'🗓️'),React.createElement('div',null,React.createElement('h3',{className:'text-sm font-black text-slate-900 dark:text-white'},'السنوات المالية والأرشيف'),React.createElement('p',{className:'text-[11px] text-slate-500 mt-0.5'},'السنة المالية تبقى مفتوحة بلا تاريخ نهاية. عند فتح سنة جديدة تُغلق الحالية تلقائياً وتنتقل فواتيرها إلى الأرشيف.'))),
        React.createElement('div',{className:'rounded-xl bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900 p-3'},React.createElement('div',{className:'text-[10px] font-bold text-indigo-600'},'السنة المالية المفتوحة الآن'),React.createElement('div',{className:'text-sm font-black mt-1'},activeFinancialYear?.name || 'السنة المالية الحالية'),React.createElement('div',{className:'text-[10px] text-slate-500 mt-1'},`تبدأ: ${activeFinancialYear?.startDate ? new Date(activeFinancialYear.startDate).toLocaleDateString('ar-EG') : 'من أول بيانات النظام'} • تاريخ النهاية: مفتوح حتى إنشاء سنة جديدة`)),
        React.createElement('form',{onSubmit:handleOpenFinancialYear,className:'grid grid-cols-1 sm:grid-cols-[1fr_170px_auto] gap-2 items-end'},React.createElement('label',{className:'text-[11px] font-bold'},'اسم السنة الجديدة',React.createElement('input',{value:newFinancialYearName,onChange:e=>setNewFinancialYearName(e.target.value),placeholder:'مثال: السنة المالية 2027',className:'block w-full mt-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'})),React.createElement('label',{className:'text-[11px] font-bold'},t("تاريخ البداية"),React.createElement('input',{type:'date',value:newFinancialYearStart,onChange:e=>setNewFinancialYearStart(e.target.value),className:'block w-full mt-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-800'})),React.createElement('button',{type:'submit',disabled:financialYearBusy,className:'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black disabled:opacity-50'},financialYearBusy?'جاري الفتح...':'فتح سنة جديدة')),
        financialYears.length>1 ? React.createElement('div',{className:'space-y-2'},React.createElement('div',{className:'text-[11px] font-black text-slate-600'},'السنوات المؤرشفة'),...financialYears.filter(y=>y?.id!==settings.activeFinancialYearId).slice().reverse().map(year=>React.createElement('div',{key:year.id,className:'flex items-center justify-between gap-3 p-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800/50'},React.createElement('div',{className:'font-bold text-xs'},year.name||'سنة مالية'),React.createElement('div',{className:'text-[10px] text-slate-500'},`${year.startDate?new Date(year.startDate).toLocaleDateString('ar-EG'):'-'} ← ${year.endDate?new Date(year.endDate).toLocaleDateString('ar-EG'):'-'}`)))) : null
    );
    const p2pMethodsCard = isTelegramManager ? React.createElement('div',{id:'settings-p2p-methods',className:'p-5 rounded-2xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-900/70 shadow-xs space-y-4'},
        React.createElement('div',{className:'flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3 border-slate-100 dark:border-slate-800'},
            React.createElement('div',{className:'flex items-center gap-3'},React.createElement('div',{className:'w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center'},React.createElement(CreditCard,{className:'w-5 h-5 text-violet-600'})),React.createElement('div',null,React.createElement('h3',{className:'text-sm font-black text-slate-900 dark:text-white'},'طرق دفع رابط العميل P2P'),React.createElement('p',{className:'text-[11px] text-slate-500 mt-0.5 leading-5'},'أضف فقط طرق الدفع التي تريد إظهارها للعميل، ويمكنك اختيار صورة لكل طريقة مباشرة من جهازك.'))),
            React.createElement('button',{type:'button',onClick:addP2PMethod,className:'px-3 py-2 rounded-xl bg-violet-50 text-violet-700 border border-violet-200 text-xs font-black'},'+ إضافة طريقة دفع')
        ),
        ...p2pPaymentMethods.map((method,index)=>React.createElement('div',{key:method.id,className:'rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/60 dark:bg-slate-800/30'},
            React.createElement('div',{className:'flex items-center justify-between gap-2'},React.createElement('div',{className:'text-xs font-black text-slate-800 dark:text-slate-100'},`طريقة ${index+1}: ${method.name||'بدون اسم'}`),React.createElement('button',{type:'button',onClick:()=>removeP2PMethod(method.id),className:'px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 text-[10px] font-black'},'حذف الطريقة')),
            React.createElement('div',{className:'grid grid-cols-1 sm:grid-cols-2 gap-2'},
                React.createElement('label',{className:'text-[10px] font-bold text-slate-600'},'اسم طريقة الدفع',React.createElement('input',{value:method.name,onChange:e=>patchP2PMethod(method.id,{name:e.target.value}),placeholder:'مثال: بنك فلسطين',className:'block w-full mt-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-900'})),
                React.createElement('label',{className:'text-[10px] font-bold text-slate-600'},'نوع طريقة الدفع / الشعار',React.createElement('select',{value:method.icon,onChange:e=>patchP2PMethod(method.id,{icon:e.target.value}),className:'block w-full mt-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-900'},...P2P_ICON_OPTIONS.map(([value,label])=>React.createElement('option',{key:value,value},label)))), React.createElement('div',{className:'mt-2 h-14 rounded-xl border bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden'}, (method.logoUrl || P2P_BUILTIN_LOGOS[method.icon]) ? React.createElement('img',{src:method.logoUrl || P2P_BUILTIN_LOGOS[method.icon],alt:method.name||'طريقة دفع',className:'max-h-12 max-w-[150px] object-contain',onError:e=>{e.currentTarget.style.display='none'}}) : React.createElement(Landmark,{className:'w-6 h-6 text-slate-400'})),
                React.createElement('div',{className:'text-[10px] font-bold text-slate-600'},React.createElement('div',null,'صورة طريقة الدفع'),React.createElement('div',{className:'mt-1 flex items-center gap-2 flex-wrap'},React.createElement('label',{className:'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-violet-700 cursor-pointer font-black'},p2pImageBusy===`${method.id}:logo`?'جاري الحفظ...':t("اختيار صورة"),React.createElement('input',{type:'file',accept:'image/png,image/jpeg,image/webp',className:'hidden',disabled:!!p2pImageBusy,onChange:e=>{const f=e.target.files?.[0];e.target.value='';uploadP2PImage(method.id,f,'logo')}})),method.logoUrl?React.createElement('button',{type:'button',onClick:()=>patchP2PMethod(method.id,{logoUrl:'',logoTelegramFileId:'',logoTelegramUniqueId:'',logoUpdatedAt:''}),className:'px-2.5 py-2 rounded-xl border border-rose-200 bg-white text-rose-600 font-black'},'مسح الصورة'):null)),
                React.createElement('div',{className:'text-[10px] font-bold text-slate-600'},React.createElement('div',null,'صورة الباركود / QR (اختياري)'),React.createElement('div',{className:'mt-1 flex items-center gap-2 flex-wrap'},React.createElement('label',{className:'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-blue-700 cursor-pointer font-black'},p2pImageBusy===`${method.id}:qr`?'جاري الحفظ...':'اختيار صورة QR',React.createElement('input',{type:'file',accept:'image/png,image/jpeg,image/webp',className:'hidden',disabled:!!p2pImageBusy,onChange:e=>{const f=e.target.files?.[0];e.target.value='';uploadP2PImage(method.id,f,'qr')}})),method.qrImageUrl?React.createElement('button',{type:'button',onClick:()=>patchP2PMethod(method.id,{qrImageUrl:'',qrTelegramFileId:'',qrTelegramUniqueId:'',qrUpdatedAt:''}),className:'px-2.5 py-2 rounded-xl border border-rose-200 bg-white text-rose-600 font-black'},'مسح QR'):null))
            ),
            React.createElement('label',{className:'text-[10px] font-bold text-slate-600'},'ملاحظة تظهر للعميل',React.createElement('textarea',{value:method.note,onChange:e=>patchP2PMethod(method.id,{note:e.target.value}),rows:2,placeholder:'مثال: حوّل إلى الحساب ثم أرفق صورة الإيصال',className:'block w-full mt-1 px-3 py-2 text-xs border rounded-xl bg-white dark:bg-slate-900 resize-y'})),
            React.createElement('div',{className:'space-y-2'},
                React.createElement('div',{className:'flex items-center justify-between'},React.createElement('div',{className:'text-[11px] font-black text-slate-700 dark:text-slate-200'},'معلومات التحويل'),React.createElement('button',{type:'button',onClick:()=>addP2PField(method.id),className:'px-2.5 py-1.5 rounded-lg bg-white border text-violet-700 text-[10px] font-black'},'+ حقل')),
                ...method.fields.map((field)=>React.createElement('div',{key:field.id,className:'grid grid-cols-[minmax(100px,.75fr)_minmax(0,1.25fr)_auto] gap-2 items-center'},React.createElement('input',{value:field.label,onChange:e=>patchP2PField(method.id,field.id,{label:e.target.value}),placeholder:'اسم الحقل',className:'px-2.5 py-2 text-[11px] border rounded-lg bg-white dark:bg-slate-900'}),React.createElement('input',{value:field.value,onChange:e=>patchP2PField(method.id,field.id,{value:e.target.value}),placeholder:'القيمة',dir:'auto',className:'px-2.5 py-2 text-[11px] border rounded-lg bg-white dark:bg-slate-900'}),React.createElement('button',{type:'button',onClick:()=>removeP2PField(method.id,field.id),className:'w-9 h-9 rounded-lg bg-rose-50 text-rose-600 border border-rose-100 font-black'},'×')))
            )
        )),
        React.createElement('div',{className:'flex flex-wrap gap-2 pt-1'},React.createElement('button',{type:'button',onClick:handleSaveP2PMethods,className:'px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black'},'حفظ طرق الدفع'),React.createElement('span',{className:'text-[10px] text-slate-500 self-center'},'بعد الحفظ تُزامن الطرق وتظهر في صفحة سداد العميل تلقائياً.'))
    ) : null;
    const telegramCard = isTelegramManager ? _jsxs("div", { id: "settings-telegram", className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-sky-200 dark:border-sky-900/70 shadow-xs space-y-4", children: [
        _jsxs("div", { className: "flex items-start justify-between gap-3 border-b pb-3 border-slate-100 dark:border-slate-800", children: [
            _jsxs("div", { className: "flex items-center gap-3", children: [
                _jsx("div", { className: "w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center shrink-0", children: _jsx(Bot, { className: "w-5 h-5 text-sky-600" }) }),
                _jsxs("div", { children: [
                    _jsx("h3", { className: "text-sm font-black text-slate-900 dark:text-white", children: "ربط Telegram والإشعارات" }),
                    _jsx("p", { className: "text-[11px] text-slate-500 mt-0.5 leading-5", children: "الطريقة بسيطة: افتح البوت، اضغط Start، ثم اضغط «تحديث المستخدمين» وانسخ الـ Chat ID الذي ظهر لك." })
                ] })
            ] }),
            _jsxs("label", { className: "flex items-center gap-2 text-[11px] font-bold text-slate-600", children: [
                _jsx("span", { children: "تفعيل" }),
                _jsx("input", { type: "checkbox", checked: formSettings.telegramEnabled !== false, onChange: (e) => setFormSettings({ ...formSettings, telegramEnabled: e.target.checked }), className: "w-5 h-5 accent-sky-600 rounded" })
            ] })
        ] }),
        _jsx(TelegramQuickGuide, {}),
        _jsxs("div", { className: "rounded-xl border-2 border-violet-200 bg-violet-50/60 dark:bg-violet-950/20 dark:border-violet-900 p-3 space-y-2", children: [
            _jsxs("div", { children: [
                _jsx("div", { className: "text-xs font-black text-violet-800 dark:text-violet-200", children: "استقبال دفعات رابط العميل (P2P)" }),
                _jsx("div", { className: "text-[10px] text-slate-500 mt-1 leading-5", children: "للدفعات: افتح «بوت الدفعات» من زر Open أعلاه، اضغط Start، ثم اضغط تحديث المستخدمين وانسخ الـ ID وضعه هنا." })
            ] }),
            _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2", children: [
                _jsx("input", { type: "text", dir: "ltr", value: formSettings.p2pPaymentChatId || '', onChange: (e) => setFormSettings({ ...formSettings, p2pPaymentChatId: e.target.value }), placeholder: "Chat ID مثال: 6764610810", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, className: "w-full px-3 py-2 text-xs border rounded-lg bg-white dark:bg-slate-800 font-mono" }),
                _jsxs("button", { type: "button", onClick: handleSaveP2PPaymentChatId, className: "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-black", children: [_jsx(Save, { className: "w-4 h-4" }), _jsx("span", { children: "حفظ معرف الدفعات" })] })
            ] })
        ] }),
        _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2", children: [
            _jsx("input", { type: "text", dir: "ltr", value: telegramChatIdInput, onChange: (e) => setTelegramChatIdInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTelegramRecipient(); } }, placeholder: "Chat ID مثال: 6764610810", autoCapitalize: "none", autoCorrect: "off", spellCheck: false, className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 font-mono" }),
            _jsxs("button", { type: "button", onClick: handleAddTelegramRecipient, disabled: !!telegramBusy, className: "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-black", children: [_jsx(UserPlus, { className: "w-4 h-4" }), _jsx("span", { children: telegramBusy.startsWith('add:') ? "جاري الحفظ..." : "إضافة المعرف" })] })
        ] }),
        telegramRecipients.length ? _jsx("div", { className: "space-y-2", children: telegramRecipients.map((recipient) => _jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/50", children: [
            _jsxs("div", { className: "flex-1 min-w-0", children: [
                _jsx("div", { className: "text-xs font-black text-slate-800 dark:text-slate-100 truncate", children: `Chat ID: ${recipient.chatId}` }),
                _jsx("div", { className: "text-[10px] text-slate-500 truncate", children: 'معرف Telegram الذي ستصل إليه الإشعارات والتقارير'  })
            ] }),
            _jsxs("div", { className: "flex items-center gap-1.5", children: [
                _jsxs("button", { type: "button", onClick: () => handleToggleTelegramRecipient(recipient.chatId), className: `px-2.5 py-1.5 rounded-lg text-[10px] font-black ${recipient.enabled !== false ? 'bg-violet-100 text-violet-700' : 'bg-slate-200 text-slate-500'}`, children: [recipient.enabled !== false ? 'مفعّل' : 'متوقف'] }),
                _jsxs("button", { type: "button", onClick: () => handleTestTelegramRecipient(recipient.chatId), disabled: !!telegramBusy, className: "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border text-sky-700 text-[10px] font-black disabled:opacity-50", children: [_jsx(MessageCircle, { className: "w-3.5 h-3.5" }), _jsx("span", { children: telegramBusy === `test:${recipient.chatId}` ? 'يرسل...' : 'اختبار' })] }),
                _jsx("button", { type: "button", onClick: () => handleRemoveTelegramRecipient(recipient.chatId), className: "p-1.5 rounded-lg bg-white border text-rose-600", title: "حذف المعرف", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })
            ] })
        ] }, recipient.chatId)) }) : _jsx("div", { className: "p-3 rounded-xl border border-dashed text-center text-xs text-slate-400", children: "لم تتم إضافة أي Chat ID Telegram بعد." }),
        _jsx("div", { className: "space-y-2", children: [
            _jsx("div", { className: "text-xs font-black text-slate-700 dark:text-slate-200", children: "ما الذي يرسله البوت؟ — المدير فقط يتحكم بهذه المفاتيح" }),
            _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2", children: telegramNotificationOptions.map(([key,label]) => _jsxs("label", { className: "flex items-center justify-between gap-3 p-3 rounded-xl border bg-slate-50 dark:bg-slate-800", children: [_jsx("span", { className: "text-[11px] font-bold", children: label }), _jsx("input", { type: "checkbox", checked: formSettings[key] !== false, onChange: (e) => setFormSettings({ ...formSettings, [key]: e.target.checked }), className: "w-5 h-5 accent-sky-600" })] }, key)) }),
            _jsxs("label", { className: "flex items-center justify-between gap-3 p-3 rounded-xl border border-sky-200 bg-sky-50/60 dark:bg-sky-950/20", children: [_jsxs("span", { children: [_jsx("span", { className: "text-xs font-black block", children: "إرسال جميع تقارير البرنامج تلقائياً كل 24 ساعة" }), _jsx("span", { className: "text-[10px] text-slate-500", children: "المبيعات، المرتجعات، المشتريات، القبض والصرف، المصروفات، العملاء والمديونون، الموردون، الحسابات، المخزون، النواقص، المخازن، الموظفون، الورديات وسجل العمليات." })] }), _jsx("input", { type: "checkbox", checked: formSettings.telegramAutoReportEnabled !== false, onChange: (e) => setFormSettings({ ...formSettings, telegramAutoReportEnabled: e.target.checked, telegramReportIntervalHours: 24 }), className: "w-5 h-5 accent-sky-600" })] })
        ] }),
        _jsxs("div", { className: "flex flex-wrap gap-2 pt-1", children: [
            _jsxs("button", { type: "button", onClick: handleSendTelegramReportNow, disabled: !!telegramBusy || !telegramRecipients.some(r => r.enabled !== false), className: "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-black", children: [_jsx(Send, { className: "w-4 h-4" }), _jsx("span", { children: telegramBusy === 'report' ? 'جاري إرسال جميع التقارير...' : 'إرسال جميع التقارير الآن' })] }),
            _jsx("button", { type: "button", onClick: handleTestAllTelegram, disabled: !!telegramBusy || !telegramRecipients.some(r => r.enabled !== false), className: "px-4 py-2 rounded-xl border border-sky-200 text-sky-700 bg-white text-xs font-black disabled:opacity-50", children: telegramBusy === 'test-all' ? 'جاري الاختبار...' : 'اختبار جميع المعرفات' }),
            _jsx("button", { type: "button", onClick: async () => { if (!isTelegramManager) return; const nextTelegramSettings = { ...formSettings, telegramEnabled: formSettings.telegramEnabled !== false, telegramReportIntervalHours: 24, telegramBotUsername: 'Oskarteaam_bot', telegramBotUrl: TELEGRAM_BOT_URL, telegramRecipients }; await updateSettings(Object.fromEntries(Object.entries(nextTelegramSettings).filter(([key])=>key.startsWith('telegram')))); await syncTelegramServerConfig(nextTelegramSettings); showToast('تم حفظ إعدادات Telegram', 'success'); }, className: "px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-black", children: "حفظ إعدادات Telegram" })
        ] })
    ] }) : null;
    const settingsSectionItems = [
        ['general', Store, 'عام وطباعة'],
        ['inventory', Warehouse, 'المخازن والسياسات'],
        ['telegram', Bot, 'Telegram والدفع'],
        ['system', Database, 'التطبيق والنسخ'],
    ];
    const settingsSectionNav = _jsx("div", { id: "settings-section-nav", className: "grid grid-cols-2 sm:grid-cols-4 gap-2 p-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-slate-800 shadow-sm", children: settingsSectionItems.map(([id,Icon,label]) => _jsxs("button", { type: "button", onClick: () => setSettingsSection(id), className: `flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[11px] sm:text-xs font-black transition ${settingsSection===id ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-violet-50'}`, children: [_jsx(Icon,{className:'w-4 h-4'}), _jsx('span',{children:label})] }, id)) });
    return (_jsxs("div", { id: "settings-screen", onInputCapture: markSettingsDraft, onChangeCapture: markSettingsDraft, onClickCapture: markSettingsDraft, "data-oscar-draft-lock": "true", className: "p-4 sm:p-6 space-y-6 max-w-4xl mx-auto text-right select-none", children: [_jsxs("div", { "data-settings-header": "1", children: [_jsx("h2", { className: "text-xl font-black text-slate-900 dark:text-white", children: "\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645 \u0648\u0627\u0644\u0646\u0633\u062e \u0627\u0644\u0627\u062d\u062a\u064a\u0627\u0637\u064a" }), _jsx("p", { className: "text-xs text-slate-500 mt-0.5", children: "\u062a\u062e\u0635\u064a\u0635 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u062d\u0644\u060c \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u062d\u0631\u0627\u0631\u064a\u0629\u060c \u0633\u064a\u0627\u0633\u0629 \u0627\u0644\u0628\u064a\u0639 \u0628\u0627\u0644\u0633\u0627\u0644\u0628\u060c \u0627\u0644\u0641\u0631\u0648\u0639\u060c \u0648\u0627\u0644\u0646\u0633\u062e \u0627\u0644\u0627\u062d\u062a\u064a\u0627\u0637\u064a \u0627\u0644\u0643\u0627\u0645\u0644" })] }), settingsSectionNav, _jsxs("form", { onSubmit: handleSaveGeneral, onInputCapture: markSettingsDraft, onChangeCapture: markSettingsDraft, "data-oscar-draft-lock": "true", className: "space-y-6", children: [_jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx(Store, { className: "w-5 h-5 text-violet-600" }), _jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u0645\u0646\u0634\u0623\u0629 \u0648\u0627\u0644\u0645\u062a\u062c\u0631" })] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "\u0627\u0633\u0645 \u0627\u0644\u0645\u062d\u0644 \u0623\u0648 \u0627\u0644\u0633\u0648\u0628\u0631\u0645\u0627\u0631\u0643\u062a:" }), _jsx("input", { type: "text", value: formSettings.storeName, onChange: (e) => setFormSettings({ ...formSettings, storeName: e.target.value }), className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "\u0631\u0645\u0632 \u0627\u0644\u0639\u0645\u0644\u0629 \u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a:" }), _jsx("input", { type: "text", value: formSettings.currencySymbol, onChange: (e) => setFormSettings({ ...formSettings, currencySymbol: e.target.value }), className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 font-mono font-bold" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641 \u0648\u0627\u0644\u062a\u0648\u0627\u0635\u0644:" }), _jsx("input", { type: "text", value: formSettings.phone, onChange: (e) => setFormSettings({ ...formSettings, phone: e.target.value }), className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: t("العنوان والموقع:") }), _jsx("input", { type: "text", value: formSettings.address, onChange: (e) => setFormSettings({ ...formSettings, address: e.target.value }), className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0636\u0631\u064a\u0628\u064a (\u0625\u0646 \u0648\u062c\u062f):" }), _jsx("input", { type: "text", value: formSettings.taxNumber || '', onChange: (e) => setFormSettings({ ...formSettings, taxNumber: e.target.value }), className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800 font-mono" })] }), _jsxs("div", { className: "sm:col-span-2 space-y-3", children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "شعار المحل / الشركة:" }), _jsxs("div", { className: "flex items-center gap-3 p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/50", children: [_jsx(BrandLogoImage, { settings: formSettings, alt: "معاينة الشعار", className: "w-16 h-16 object-cover rounded-lg bg-white border" }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-xs font-bold text-slate-800 dark:text-slate-100", children: "اختر صورة من جهازك" }), _jsx("div", { className: "text-[10px] text-slate-500 mt-1 leading-5", children: "اختر شعار الشركة من جهازك، وسيتم حفظه تلقائياً ليظهر في الواجهة والفواتير." }), _jsxs("label", { className: "mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-[10px] font-black cursor-pointer", children: [logoUploadBusy ? _jsx("span", { className: "w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" }) : _jsx(Upload, { className: "w-3.5 h-3.5" }), _jsx("span", { children: logoUploadBusy ? "جاري حفظ الشعار..." : "اختيار صورة من الجهاز" }), _jsx("input", { type: "file", accept: "image/png,image/jpeg,image/webp", className: "hidden", disabled: logoUploadBusy, onChange: (e) => { const file=e.target.files?.[0]; e.target.value=''; handleSettingsLogoUpload(file); } })] })] }), _jsx("button", { type: "button", onClick: () => setFormSettings({ ...formSettings, logoSourceUrl: '', logoUrl: '', logoTelegramFileId:'', logoTelegramUniqueId:'', logoStorage:'' }), className: "px-3 py-2 text-[11px] font-bold rounded-lg border border-rose-200 text-rose-600 bg-white", children: "مسح" })] })] })] })] }), _jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx(Printer, { className: "w-5 h-5 text-violet-600" }), _jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u062d\u0631\u0627\u0631\u064a\u0629 \u0648\u0627\u0644\u0625\u064a\u0635\u0627\u0644\u0627\u062a" })] }), _jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx(SearchableDropdown, { label: "\u0645\u0642\u0627\u0633 \u0648\u0631\u0642 \u0627\u0644\u0637\u0627\u0628\u0639\u0629 \u0627\u0644\u062d\u0631\u0627\u0631\u064a\u0629:", id: "settings-printer-width", options: [{id:"80mm",label:"80 \u0645\u0644\u0645",subLabel:"\u0637\u0627\u0628\u0639\u0629 \u062d\u0631\u0627\u0631\u064a\u0629 \u0642\u064a\u0627\u0633\u064a\u0629 \u0639\u0631\u064a\u0636\u0629"},{id:"58mm",label:"58 \u0645\u0644\u0645",subLabel:"\u0637\u0627\u0628\u0639\u0629 \u062d\u0631\u0627\u0631\u064a\u0629 \u0635\u063a\u064a\u0631\u0629 \u0648\u0645\u062d\u0645\u0648\u0644\u0629"},{id:"a4",label:"A4",subLabel:"\u0641\u0627\u062a\u0648\u0631\u0629 \u0643\u0627\u0645\u0644\u0629 \u0639\u0644\u0649 \u0648\u0631\u0642 A4"}], selectedId: formSettings.printerWidth, onSelect: (id) => setFormSettings({ ...formSettings, printerWidth: id }), placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u0645\u0642\u0627\u0633..." })] }), _jsxs("div", { className: "flex items-center justify-between p-3 border rounded-lg bg-slate-50 dark:bg-slate-800", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs font-bold block", children: "\u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0639\u0646\u062f \u0627\u0644\u062d\u0641\u0638:" }), _jsx("span", { className: "text-[11px] text-slate-400", children: "\u0641\u062a\u062d \u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0637\u0628\u0627\u0639\u0629 \u0645\u0628\u0627\u0634\u0631\u0629 \u0628\u0639\u062f \u062d\u0641\u0638 \u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0628\u064a\u0639" })] }), _jsx("input", { type: "checkbox", checked: (formSettings.printOnSave ?? formSettings.autoPrintReceipt), onChange: (e) => setFormSettings({ ...formSettings, printOnSave: e.target.checked, autoPrintReceipt: e.target.checked }), className: "w-5 h-5 accent-violet-600 rounded" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "text-xs font-semibold block mb-1", children: "\u062a\u0630\u064a\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0627\u0644\u0645\u0637\u0628\u0648\u0639 (\u0631\u0633\u0627\u0644\u0629 \u0623\u0633\u0641\u0644 \u0627\u0644\u0625\u064a\u0635\u0627\u0644):" }), _jsx("input", { type: "text", value: formSettings.receiptFooterMessage, onChange: (e) => setFormSettings({ ...formSettings, receiptFooterMessage: e.target.value }), placeholder: "\u0634\u0643\u0631\u0627\u064b \u0644\u0632\u064a\u0627\u0631\u062a\u0643\u0645! \u0627\u0644\u0628\u0636\u0627\u0639\u0629 \u0627\u0644\u0645\u0628\u0627\u0639\u0629 \u062a\u0631\u062f \u0648\u062a\u0633\u062a\u0628\u062f\u0644 \u062e\u0644\u0627\u0644 3 \u0623\u064a\u0627\u0645", className: "w-full px-3 py-2 text-xs border rounded-lg bg-slate-50 dark:bg-slate-800" })] })] })] }), _jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-900 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Bluetooth, { className: "w-5 h-5 text-violet-600" }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-black text-slate-900 dark:text-white", children: "طابعة Bluetooth / Serial" }), _jsx("p", { className: "text-[11px] text-slate-500", children: "اختر الطابعة مرة واحدة من داخل البرنامج. يتم حفظها على هذا الجهاز ويعيد النظام الاتصال بها تلقائياً أثناء التنقل أو بعد رجوع التطبيق من الخلفية." })] })] }), _jsx("span", { className: `px-2.5 py-1 rounded-full text-[10px] font-black ${printerState.ready ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`, children: printerState.connected ? `متصل مباشر • ${printerState.name || printerState.preferredName || 'الطابعة'}` : printerState.systemMode ? `جاهز • ${printerState.name || 'طباعة النظام'}` : printerState.hasRememberedPrinter ? `محفوظة • ${printerState.preferredName || 'الطابعة'}` : 'لم يتم اختيار طابعة' })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: handleConnectBluetoothPrinter, disabled: !!printerState.connecting, className: "flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold disabled:opacity-40", children: [_jsx(Bluetooth, { className: "w-4 h-4" }), _jsx("span", { children: printerState.connecting === 'bluetooth' ? 'جاري الاتصال...' : (printerState.bluetoothSupported ? 'اختيار / تغيير طابعة Bluetooth' : (printerState.isIOS ? 'تفعيل طباعة iPhone / Bluetooth' : 'تفعيل طباعة Bluetooth / النظام')) })] }), (!printerState.ready && printerState.hasRememberedPrinter) ? _jsxs("button", { type: "button", onClick: handleReconnectPrinter, disabled: !!printerState.connecting, className: "flex items-center gap-2 px-4 py-2 rounded-xl border border-blue-200 text-blue-700 bg-blue-50 text-xs font-bold disabled:opacity-40", children: [_jsx(RefreshCw, { className: "w-4 h-4" }), _jsx("span", { children: "إعادة الاتصال بالطابعة المحفوظة" })] }) : null, _jsxs("button", { type: "button", onClick: handleConnectSerialPrinter, disabled: !!printerState.connecting, className: "flex items-center gap-2 px-4 py-2 rounded-xl border border-violet-200 dark:border-violet-900 text-violet-700 dark:text-violet-300 bg-violet-50/60 dark:bg-violet-950/20 text-xs font-bold disabled:opacity-40", children: [_jsx(Cable, { className: "w-4 h-4" }), _jsx("span", { children: "اختيار طابعة Serial" })] }), _jsxs("button", { type: "button", onClick: handleEnableSystemPrinter, disabled: !!printerState.connecting, className: "flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 bg-white text-xs font-bold disabled:opacity-40", children: [_jsx(Printer, { className: "w-4 h-4" }), _jsx("span", { children: printerState.isIOS ? "طباعة iPhone / AirPrint" : "طباعة النظام" })] }), (printerState.ready || printerState.hasRememberedPrinter) ? _jsxs("button", { type: "button", onClick: handleDisconnectPrinter, className: "flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 text-rose-600 bg-rose-50 text-xs font-bold", children: [_jsx(X, { className: "w-4 h-4" }), _jsx("span", { children: "فصل الطابعة" })] }) : null] }), _jsx("p", { className: "text-[10px] leading-relaxed text-slate-400", children: "زر Bluetooth ظاهر دائماً. Chrome/Edge يستخدم اتصال ESC/POS مباشر عند توفر Web Bluetooth. على iPhone/Safari أو الطابعات Bluetooth Classic يستخدم النظام نافذة الطباعة/AirPrint أو تعريف الطابعة المثبت على الجهاز، ولا يتم إخفاء الزر." })] }), _jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx(ShieldCheck, { className: "w-5 h-5 text-violet-600" }), _jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u0633\u064a\u0627\u0633\u0627\u062a \u0627\u0644\u0628\u064a\u0639 \u0648\u0627\u0644\u0645\u062e\u0632\u0648\u0646" })] }), _jsxs("div", { className: "flex items-center justify-between p-3 border rounded-lg bg-slate-50 dark:bg-slate-800", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs font-bold block", children: "\u0627\u0644\u0633\u0645\u0627\u062d \u0628\u0627\u0644\u0628\u064a\u0639 \u0628\u0627\u0644\u0633\u0627\u0644\u0628 (Negative Stock):" }), _jsx("span", { className: "text-[11px] text-slate-400", children: "\u0625\u062a\u0645\u0627\u0645 \u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u0628\u064a\u0639 \u0628\u0627\u0644\u0643\u0627\u0634\u064a\u0631 \u062d\u062a\u0649 \u0644\u0648 \u0643\u0627\u0646\u062a \u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0633\u062c\u0644\u0629 \u0628\u0627\u0644\u0645\u062e\u0632\u0646 0 (\u0645\u0646\u0627\u0633\u0628 \u0644\u0644\u0633\u0648\u0628\u0631\u0645\u0627\u0631\u0643\u062a \u0644\u062a\u062c\u0646\u0628 \u062a\u0639\u0637\u064a\u0644 \u0627\u0644\u0632\u0628\u0627\u0626\u0646)" })] }), _jsx("input", { type: "checkbox", checked: formSettings.allowNegativeStock, onChange: (e) => setFormSettings({ ...formSettings, allowNegativeStock: e.target.checked }), className: "w-5 h-5 accent-violet-600 rounded" }), _jsxs("div", { className: "flex items-center justify-between p-3 border rounded-lg bg-slate-50 dark:bg-slate-800", children: [_jsxs("div", { children: [_jsx("span", { className: "text-xs font-bold block", children: "تفعيل بيع الميزان" }), _jsx("span", { className: "text-[11px] text-slate-400", children: "عند تعديل مبلغ الصنف في السلة تُحسب الكمية تلقائياً ويُقرب صافي الفاتورة لأقرب عدد صحيح." })] }), _jsx("input", { type: "checkbox", checked: !!formSettings.scaleModeEnabled, onChange: (e) => setFormSettings({ ...formSettings, scaleModeEnabled: e.target.checked }), className: "w-5 h-5 accent-violet-600 rounded" })] })] })] }), _jsx("div", { className: "flex justify-end", children: _jsxs("button", { type: "submit", className: "flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-md transition", children: [_jsx(Save, { className: "w-4 h-4" }), _jsx("span", { children: "\u062d\u0641\u0638 \u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0639\u0627\u0645\u0629" })] }) })] }), _jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx(Building2, { className: "w-5 h-5 text-violet-600" }), _jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0641\u0631\u0648\u0639 \u0648\u0627\u0644\u0645\u062e\u0627\u0632\u0646" })] }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3", children: warehouses.map((w) => (_jsxs("div", { className: `p-3 rounded-xl border flex items-center justify-between ${w.id === settings.activeWarehouseId
                                ? 'border-violet-500 bg-violet-50/40 dark:bg-violet-950/20'
                                : 'bg-slate-50 dark:bg-slate-800/40'}`, children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs font-bold text-slate-900 dark:text-white", children: w.name }), _jsxs("div", { className: "text-[10px] text-slate-400 font-mono", children: ["\u0627\u0644\u0643\u0648\u062f: ", w.code] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [w.id === settings.activeWarehouseId ? (_jsx("span", { className: "px-2 py-0.5 rounded text-[10px] font-bold bg-violet-600 text-white", children: "\u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a \u0627\u0644\u0646\u0634\u0637" })) : (_jsx("button", { type: "button", onClick: () => updateSettings({ activeWarehouseId: w.id }), className: "px-2 py-1 text-[10px] font-bold text-slate-600 hover:text-violet-600 hover:bg-slate-200 rounded", children: "\u062a\u0641\u0639\u064a\u0644" })), _jsx("button", { type: "button", onClick: () => {
                                                setEditingWarehouse(w);
                                                setNewWarehouseName(w.name);
                                                setNewWarehouseCode(w.code);
                                            }, className: "p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50", title: "\u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0645\u062e\u0632\u0646", children: _jsx(Edit2, { className: "w-3.5 h-3.5" }) }), _jsx("button", { type: "button", onClick: () => deleteWarehouse(w.id), className: "p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50", title: "\u062d\u0630\u0641 \u0627\u0644\u0645\u062e\u0632\u0646", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] })] }, w.id))) }), _jsxs("form", { onSubmit: handleAddWarehouse, className: "flex gap-2 pt-2", children: [_jsx("input", { type: "text", placeholder: "\u0627\u0633\u0645 \u0627\u0644\u0641\u0631\u0639 \u0623\u0648 \u0627\u0644\u0645\u062e\u0632\u0646 \u0627\u0644\u062c\u062f\u064a\u062f...", value: newWarehouseName, onChange: (e) => setNewWarehouseName(e.target.value), className: "flex-1 px-3 py-1.5 text-xs border rounded-lg" }), _jsx("input", { type: "text", placeholder: "\u0627\u0644\u0643\u0648\u062f (\u0627\u062e\u062a\u064a\u0627\u0631\u064a)", value: newWarehouseCode, onChange: (e) => setNewWarehouseCode(e.target.value), className: "w-28 px-3 py-1.5 text-xs border rounded-lg font-mono" }), _jsx("button", { type: "submit", className: "px-4 py-1.5 bg-violet-600 text-white text-xs font-bold rounded-lg", children: editingWarehouse ? t("حفظ التعديل") : 'إضافة مخزن' }), editingWarehouse && (_jsx("button", { type: "button", onClick: () => {
                                    setEditingWarehouse(null);
                                    setNewWarehouseName('');
                                    setNewWarehouseCode('');
                                }, className: "px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-slate-500 text-xs font-bold rounded-lg", title: "\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0639\u062f\u064a\u0644", children: _jsx(X, { className: "w-4 h-4" }) }))] })] }), financialYearCard, p2pMethodsCard, telegramCard, _jsxs("div", { id: "settings-install-app", className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-900/70 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-3 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx("div", { className: "w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center shrink-0", children: _jsx(Download, { className: "w-5 h-5 text-violet-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "تثبيت التطبيق على الجهاز" }), _jsx("p", { className: "text-[11px] text-slate-500 mt-0.5", children: "تثبيت مباشر من Chrome كتطبيق مستقل بأيقونة على الجهاز وتشغيل أسرع وأفضل للأوفلاين." })] })] }), _jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center gap-3", children: [_jsxs("button", { id: "btn-settings-install-pwa", type: "button", onClick: handleInstallApp, disabled: isInstalled, className: `inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition shadow-sm ${isInstalled ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 text-white active:scale-[.98]'}`, children: [_jsx(Download, { className: "w-4 h-4" }), _jsx("span", { children: isInstalled ? "التطبيق مثبت" : "تثبيت التطبيق" })] }), _jsx("div", { className: `text-[11px] font-semibold ${isInstalled ? 'text-violet-600' : isInstallable ? 'text-violet-600' : 'text-slate-500'}`, children: isInstalled ? "التطبيق مثبت على هذا الجهاز" : isInstallable ? "جاهز للتثبيت عبر Chrome — اضغط الزر لفتح نافذة التثبيت" : isIOS ? "على iPhone/iPad: Safari ← مشاركة ← إضافة إلى الشاشة الرئيسية" : isSecureContext ? "بانتظار توفر نافذة التثبيت من Chrome" : "التثبيت يحتاج HTTPS أو localhost" })] })] }), _jsxs("div", { className: "p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4", children: [_jsxs("div", { className: "flex items-center gap-2 border-b pb-3 border-slate-100 dark:border-slate-800", children: [_jsx(Database, { className: "w-5 h-5 text-violet-600" }), _jsx("h3", { className: "text-sm font-bold text-slate-900 dark:text-white", children: "\u0627\u0644\u0646\u0633\u062e \u0627\u0644\u0627\u062d\u062a\u064a\u0627\u0637\u064a \u0648\u0627\u0633\u062a\u0639\u0627\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a" })] }), _jsx("p", { className: "text-xs text-slate-500", children: "\u0646\u0638\u0627\u0645 \u0623\u0648\u0633\u0643\u0627\u0631 \u0627\u0644\u0645\u062d\u0627\u0633\u0628\u064a \u064a\u062e\u0632\u0646 \u0643\u0627\u0641\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0645\u062d\u0644\u064a\u0627\u064b \u0648\u0628\u0634\u0643\u0644 \u0622\u0645\u0646 \u0641\u064a \u062c\u0647\u0627\u0632\u0643 \u0639\u0628\u0631 \u0645\u062a\u0635\u0641\u062d \u0627\u0644\u0648\u064a\u0628 \u0628\u062f\u0648\u0646 \u0627\u0644\u062d\u0627\u062c\u0629 \u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a. \u064a\u0645\u0643\u0646\u0643 \u062d\u0641\u0638 \u0646\u0633\u062e\u0629 \u0627\u062d\u062a\u064a\u0627\u0637\u064a\u0629 \u062f\u0648\u0631\u064a\u0629 \u0628\u0645\u0644\u0641 JSON." }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 pt-2", children: [_jsxs("button", { onClick: handleExportBackup, className: "flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-xs transition", children: [_jsx(Download, { className: "w-4 h-4" }), _jsx("span", { children: "\u062a\u0635\u062f\u064a\u0631 \u0646\u0633\u062e\u0629 \u0627\u062d\u062a\u064a\u0627\u0637\u064a\u0629 \u0643\u0627\u0645\u0644\u0629 (JSON)" })] }), _jsxs("label", { className: "flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer transition", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("span", { children: "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0646\u0633\u062e\u0629 \u0627\u062d\u062a\u064a\u0627\u0637\u064a\u0629 \u0645\u0646 \u0645\u0644\u0641" }), _jsx("input", { type: "file", accept: ".json", onChange: handleImportBackup, className: "hidden" })] }), _jsxs("button", { onClick: handleResetSeedData, className: "flex items-center gap-1.5 px-3 py-2 text-slate-500 hover:text-rose-600 text-xs font-semibold mr-auto transition", children: [_jsx(RefreshCw, { className: "w-3.5 h-3.5" }), _jsx("span", { children: "\u0625\u0639\u0627\u062f\u0629 \u0636\u0628\u0637 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0644\u0644\u0648\u0636\u0639 \u0627\u0644\u062a\u062c\u0631\u064a\u0628\u064a \u0627\u0644\u0623\u0648\u0644\u064a" })] })] })] })] }));
};
