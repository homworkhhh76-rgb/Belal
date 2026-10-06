import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import { ProductActions } from './components__products__ProductActions.js?v=7.9.4.136-localization';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, usePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { SearchableDropdown } from './components__common__Dropdown.js?v=7.9.4.136-localization';
import { BarcodeCameraModal } from './components__pos__CameraScannerModal.js?v=7.9.4.136-localization';
import { calculateUnitConversions, formatStockBreakdown } from './utils__unitTree.js?v=7.9.4.136-localization';
import { exportToCSV } from './utils__export.js?v=7.9.4.136-localization';
import { downloadElementAsPDF } from './utils__pdfExport.js?v=7.9.4.136-localization';
import { downloadElementAsImage } from './utils__imageExport.js?v=7.9.4.136-localization';
import { downloadProfessionalTablePDF, downloadProfessionalTableImage } from './utils__professionalExport.js?v=7.9.4.136-localization';
import { isTrialAccount } from './trial__config.js?v=7.9.4.136-localization';
import { uploadProductImageToTelegram, createPendingProductImageState, isProductImageOfflineError, ensureProductImageAutoSync } from './services__productImages.js?v=7.9.4.136-localization';
import { ProductImage } from './components__common__ProductImage.js?v=7.9.4.136-localization';
import { playBeepSound } from './services__audio.js?v=7.9.4.136-localization';
import { Plus, Search, Trash2, Edit, Layers, FolderTree, X, Download, Image as ImageIcon, FileSpreadsheet, Camera, ChevronDown, } from 'lucide-react';
const h = React.createElement;
const normalizeArabicDigits = (value) => String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫،]/g, '.')
    .replace(/٬/g, '');
const cleanDecimalInput = (value) => {
    let v = normalizeArabicDigits(value).replace(/[^0-9.]/g, '');
    const dot = v.indexOf('.');
    if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
    return v;
};
const toNumber = (value, fallback = 0) => {
    const n = Number(normalizeArabicDigits(value));
    return Number.isFinite(n) ? n : fallback;
};
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;
const compressProductImage = (file) => new Promise((resolve, reject) => {
    if (!file) { resolve(''); return; }
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) { reject(new Error('اختر صورة PNG أو JPG أو WEBP.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
    reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('الصورة غير صالحة.'));
        img.onload = () => {
            const maxSide = 1200;
            const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', .9));
        };
        img.src = reader.result;
    };
    reader.readAsDataURL(file);
});
export const ProductsView = () => {
    const { products, categories, settings, saveProduct, saveCategory, softDeleteProduct, getProductStock, showToast, } = useApp();
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const tableContainerRef = useRef(null);
    const productImageRef = useRef(null);
    const productCameraRef = useRef(null);
    const openingBaselineRef = useRef('');
    const trialImageMode = false; // صور الأصناف ترفع إلى Telegram في جميع أنواع الحسابات
    // Modal State for Product Editor
    const [editingProduct, setEditingProduct] = useState(null);
    useEffect(()=>{const pending=window.__cashTopEditProduct;if(pending){delete window.__cashTopEditProduct;handleOpenEdit(pending);}},[]);
    const [isNew, setIsNew] = useState(false);
    const [imageDraft, setImageDraft] = useState(null);
    const [imageRemoved, setImageRemoved] = useState(false);
    const [imageSaving, setImageSaving] = useState(false);
    const productImageUploadEnabled = true;
    useEffect(() => { ensureProductImageAutoSync(); }, []);
    const [barcodeScanUnitId, setBarcodeScanUnitId] = useState(null);
    const [unitEntryMode, setUnitEntryMode] = useState('single');
    const [unitDraft, setUnitDraft] = useState(null);
    const [additionalOptionsOpen, setAdditionalOptionsOpen] = useState(false);
    const categoryPresetColors = ['#7c3aed','#8b5cf6','#a855f7','#6366f1','#2563eb','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899'];
    const [quickCategoryOpen, setQuickCategoryOpen] = useState(false);
    const [quickCategoryName, setQuickCategoryName] = useState('');
    const [quickCategoryColor, setQuickCategoryColor] = useState('#7c3aed');
    const openQuickCategory = () => {
        setQuickCategoryName('');
        setQuickCategoryColor('#7c3aed');
        setQuickCategoryOpen(true);
    };
    const saveQuickCategory = async (e) => {
        e?.preventDefault?.();
        const name = quickCategoryName.trim();
        if (!name) { showToast('اكتب اسم التصنيف', 'warning'); return; }
        const duplicate = (categories || []).find((c) => String(c.name || '').trim().toLowerCase() === name.toLowerCase());
        if (duplicate) {
            setEditingProduct((prev) => prev ? ({ ...prev, categoryId: duplicate.id }) : prev);
            setQuickCategoryOpen(false);
            showToast('التصنيف موجود وتم اختياره', 'info');
            return;
        }
        const category = { id: 'cat-' + Date.now(), name, color: quickCategoryColor, sortOrder: (categories?.length || 0) + 1 };
        try {
            await saveCategory(category);
            setEditingProduct((prev) => prev ? ({ ...prev, categoryId: category.id }) : prev);
            setQuickCategoryOpen(false);
            showToast('تمت إضافة التصنيف واختياره', 'success');
        } catch (err) {
            showToast(err?.message || 'تعذر إضافة التصنيف', 'error');
        }
    };
    // Filter products
    const activeProducts = products.filter((p) => !p.deletedAt);
    const filteredProducts = activeProducts.filter((p) => {
        if (selectedCategory !== 'all' && p.categoryId !== selectedCategory)
            return false;
        if (search.trim()) {
            const q = search.toLowerCase().trim();
            const matchName = p.name.toLowerCase().includes(q) || (p.shortName && p.shortName.toLowerCase().includes(q));
            const matchSku = p.sku?.toLowerCase().includes(q) || p.internalCode?.includes(q);
            const matchBarcode = p.units.some((u) => u.barcodes.some((b) => b.includes(q)));
            return matchName || matchSku || matchBarcode;
        }
        return true;
    });
    const productsPager = usePagination(filteredProducts, 50, `${search}|${selectedCategory}`);

    const decomposeOpeningStock = (prod, baseQty) => {
        const rows = Array.isArray(prod?.units) && prod.units.length ? [...prod.units] : [];
        const result = {};
        let remaining = Math.max(0, Number(baseQty) || 0);
        rows.sort((a, b) => Math.max(1, toNumber(b.conversionToBase, 1)) - Math.max(1, toNumber(a.conversionToBase, 1)));
        rows.forEach((unit, index) => {
            const factor = Math.max(1, toNumber(unit.conversionToBase, 1));
            if (index === rows.length - 1 || factor === 1) {
                const qty = factor === 1 ? remaining : remaining / factor;
                result[unit.id] = String(Math.round((qty + Number.EPSILON) * 1000) / 1000);
                remaining = 0;
            } else {
                const qty = Math.floor((remaining + 1e-9) / factor);
                result[unit.id] = String(qty);
                remaining -= qty * factor;
            }
        });
        return result;
    };
    const handleOpenNew = () => {
        const defaultBaseUnitId = 'u-' + Date.now();
        const newProd = {
            id: 'prod-' + Date.now(),
            name: '',
            shortName: '',
            sku: '',
            internalCode: (products.length + 1001).toString(),
            categoryId: categories[0]?.id || '',
            brand: '',
            imageData: '',
            costPrice: 0,
            sellingPrice: 0,
            reorderPoint: 10,
            expiryDate: '',
            taxRate: 0,
            status: 'active',
            salesChannel: 'both',
            baseUnitId: defaultBaseUnitId,
            baseUnitName: 'حبة',
            units: [
                {
                    id: defaultBaseUnitId,
                    name: 'حبة',
                    childUnitId: null,
                    multiplier: 1,
                    conversionToBase: 1,
                    barcodes: [],
                    salePrice: '',
                    openingQuantity: '',
                    wholesalePrice: '',
                    costPrice: '',
                    isDefaultSale: true,
                },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        openingBaselineRef.current = JSON.stringify({});
        setEditingProduct(newProd);
        setImageDraft(null);
        setImageRemoved(false);
        setIsNew(true);
        setUnitEntryMode('single');
        setUnitDraft(null);
        setAdditionalOptionsOpen(false);
    };
    useEffect(() => {
        const eventName = 'cash-top:quick-add-product';
        const open = () => {
            handleOpenNew();
            if (typeof window !== 'undefined') window.__cashTopPendingQuickAction = '';
        };
        window.addEventListener(eventName, open);
        if (typeof window !== 'undefined' && window.__cashTopPendingQuickAction === eventName) {
            const t = setTimeout(open, 0);
            return () => { clearTimeout(t); window.removeEventListener(eventName, open); };
        }
        return () => window.removeEventListener(eventName, open);
    }, [products.length, categories.length]);
    const handleOpenEdit = (prod) => {
        // عند تعديل الصنف نعرض الرصيد الحالي موزعاً على وحداته. إذا غيّر المستخدم
        // هذه القيم نعتبرها رصيداً مستهدفاً جديداً للمخزون، أما تركها كما هي فلا يغيّر الرصيد.
        const clone = JSON.parse(JSON.stringify(prod));
        clone.salesChannel = clone.salesChannel || 'both';
        const currentBaseStock = getProductStock(prod.id, settings.activeWarehouseId || undefined);
        const breakdown = decomposeOpeningStock(clone, currentBaseStock);
        clone.units = (clone.units || []).map((u) => ({ ...u, openingQuantity: breakdown[u.id] ?? '' }));
        openingBaselineRef.current = JSON.stringify(Object.fromEntries(clone.units.map((u) => [u.id, String(u.openingQuantity ?? '')])));
        setEditingProduct(clone);
        setImageDraft(null);
        setImageRemoved(false);
        setIsNew(false);
        setUnitEntryMode((clone.units || []).length > 1 ? 'larger' : 'single');
        setUnitDraft(null);
        setAdditionalOptionsOpen(false);
    };
    const handleSaveModal = async (e) => {
        e.preventDefault();
        if (!editingProduct) return;
        if (!editingProduct.name.trim()) {
            showToast('يرجى إدخال اسم الصنف', 'warning');
            return;
        }
        if (editingProduct.units.length === 0) {
            showToast('يجب أن يحتوي الصنف على وحدة واحدة على الأقل', 'warning');
            return;
        }
        const rawOpeningMap = Object.fromEntries((editingProduct.units || []).map((u) => [u.id, String(u.openingQuantity ?? '')]));
        const openingStockEdited = isNew || JSON.stringify(rawOpeningMap) !== openingBaselineRef.current;
        const numericUnits = editingProduct.units.map((u) => ({
            ...u,
            multiplier: u.id === editingProduct.baseUnitId ? 1 : Math.max(1, toNumber(u.multiplier, 1)),
            salePrice: Math.max(0, toNumber(u.salePrice, 0)),
            wholesalePrice: Math.max(0, toNumber(u.wholesalePrice, 0)),
            openingQuantity: Math.max(0, toNumber(u.openingQuantity, 0)),
            costPrice: Math.max(0, toNumber(u.costPrice, 0)),
            barcodes: Array.isArray(u.barcodes) ? u.barcodes.map((b) => String(b).trim()).filter(Boolean) : [],
        }));
        let updatedUnits = calculateUnitConversions(numericUnits, editingProduct.baseUnitId);
        const baseIndex = updatedUnits.findIndex((u) => u.id === editingProduct.baseUnitId);
        const baseCost = baseIndex >= 0 ? toNumber(updatedUnits[baseIndex].costPrice, 0) : 0;
        // عند وجود وحدة أكبر، سعر شرائها هو المرجع. تكلفة الوحدة الأصغر تُحسب تلقائياً
        // = سعر شراء الوحدة الأكبر ÷ عدد الوحدات الأصغر بداخلها.
        const largerCostSource = [...updatedUnits]
            .filter((u) => u.id !== editingProduct.baseUnitId && toNumber(u.costPrice, 0) > 0)
            .sort((a, b) => toNumber(b.conversionToBase, 1) - toNumber(a.conversionToBase, 1))[0];
        const source = largerCostSource || (baseCost <= 0
            ? [...updatedUnits].sort((a, b) => toNumber(b.conversionToBase, 1) - toNumber(a.conversionToBase, 1)).find((u) => toNumber(u.costPrice, 0) > 0)
            : null);
        if (source) {
            const sourceFactor = Math.max(1, toNumber(source.conversionToBase, 1));
            const calculatedBaseCost = toNumber(source.costPrice, 0) / sourceFactor;
            updatedUnits = updatedUnits.map((u) => ({
                ...u,
                costPrice: round4(calculatedBaseCost * Math.max(1, toNumber(u.conversionToBase, 1))),
            }));
        }
        const openingUnitBreakdown = openingStockEdited
            ? updatedUnits.filter((u) => Math.max(0, toNumber(u.openingQuantity, 0)) > 0).map((u) => ({
                unitId: u.id, unitName: u.name, quantity: Math.max(0, toNumber(u.openingQuantity, 0)),
                conversionToBase: Math.max(1, toNumber(u.conversionToBase, 1)),
                baseQuantity: Math.max(0, toNumber(u.openingQuantity, 0)) * Math.max(1, toNumber(u.conversionToBase, 1)),
            }))
            : [];
        const openingBaseQuantity = openingUnitBreakdown.reduce((sum, row) => sum + row.baseQuantity, 0);
        const defaultUnit = updatedUnits.find((u) => u.isDefaultSale) || updatedUnits[0];
        const finalBaseUnit = updatedUnits.find((u) => u.id === editingProduct.baseUnitId) || updatedUnits[0];
        const finalProd = {
            ...editingProduct,
            reorderPoint: Math.max(0, toNumber(editingProduct.reorderPoint, 0)),
            units: updatedUnits,
            baseUnitName: finalBaseUnit?.name || 'حبة',
            sellingPrice: toNumber(defaultUnit?.salePrice, 0),
            costPrice: toNumber(finalBaseUnit?.costPrice, 0),
            openingBaseQuantity,
            openingUnitBreakdown,
            openingStockSet: openingStockEdited,
            updatedAt: new Date().toISOString(),
        };
        let productToSave = finalProd;
        if (imageRemoved) {
            productToSave = {
                ...productToSave,
                imageData: '',
                imagePendingUpload: false,
                imagePendingName: '',
                imageTelegramFileId: '',
                imageTelegramUniqueId: '',
                imageTelegramUrl: '',
                imageStorage: '',
                imageUpdatedAt: new Date().toISOString()
            };
        }
        else if (imageDraft?.dataUrl) {
            let uploaded = imageDraft.uploaded || null;
            if (!uploaded?.fileId && !imageDraft?.queued) {
                setImageSaving(true);
                try {
                    const cleanName = String(editingProduct.name || 'product').replace(/[\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'product';
                    uploaded = await uploadProductImageToTelegram(imageDraft.dataUrl, `${cleanName}-${Date.now()}.jpg`);
                    setImageDraft((prev) => prev ? ({ ...prev, uploaded, queued:false }) : prev);
                } catch (err) {
                    if (isProductImageOfflineError(err)) {
                        const pendingImage = createPendingProductImageState(imageDraft.dataUrl, imageDraft.name || 'product.jpg');
                        productToSave = { ...productToSave, ...pendingImage };
                        setImageDraft((prev) => prev ? ({ ...prev, queued: true }) : prev);
                        showToast('لا يوجد إنترنت. تم حفظ الصورة محلياً وسيتم رفعها تلقائياً عند عودة الاتصال.', 'info');
                    } else {
                        showToast(String(err?.message || err || 'تعذر حفظ صورة الصنف'), 'error');
                        return;
                    }
                } finally {
                    setImageSaving(false);
                }
            }
            if (uploaded?.fileId) {
                productToSave = {
                    ...productToSave,
                    imageData: '',
                    imagePendingUpload: false,
                    imagePendingName: '',
                    imageTelegramFileId: uploaded.fileId,
                    imageTelegramUniqueId: uploaded.fileUniqueId,
                    imageTelegramUrl: uploaded.url || '',
                    imageStorage: 'telegram-photo',
                    imageUpdatedAt: new Date().toISOString()
                };
            } else if (imageDraft?.queued || productToSave.imagePendingUpload) {
                const pendingImage = createPendingProductImageState(imageDraft.dataUrl, imageDraft.name || 'product.jpg');
                productToSave = { ...productToSave, ...pendingImage };
            }
        } else if (productToSave.imagePendingUpload && productToSave.imageData) {
            productToSave = { ...productToSave, imageStorage: productToSave.imageStorage || 'telegram-pending' };
        } else {
            productToSave = { ...productToSave, imageData: '' };
        }
        const saved = await saveProduct(productToSave);
        if (saved !== false) {
            setEditingProduct(null);
            setImageDraft(null);
            setImageRemoved(false);
        }
    };
    const handleProductImageFile = async (file) => {
        if (!file || !editingProduct || imageSaving) return;
        setImageRemoved(false);
        setImageSaving(true);
        try {
            const imageData = await compressProductImage(file);
            const draftName = String(file.name || 'product.jpg');
            setImageDraft({ dataUrl: imageData, name: draftName, uploaded: null, queued: false });
            const cleanName = String(editingProduct.name || file.name || 'product').replace(/[\/:*?"<>|]+/g, '-').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 80) || 'product';
            try {
                const uploaded = await uploadProductImageToTelegram(imageData, `${cleanName}-${Date.now()}.jpg`);
                setImageDraft((prev) => prev ? ({ ...prev, uploaded, queued: false }) : prev);
                setEditingProduct((prev) => prev ? ({
                    ...prev,
                    imageData: '',
                    imagePendingUpload: false,
                    imagePendingName: '',
                    imageTelegramFileId: uploaded.fileId,
                    imageTelegramUniqueId: uploaded.fileUniqueId,
                    imageTelegramUrl: uploaded.url || '',
                    imageStorage: 'telegram-photo',
                    imageUpdatedAt: new Date().toISOString(),
                }) : prev);
                showToast('تم رفع صورة الصنف بنجاح', 'success');
            } catch (err) {
                if (isProductImageOfflineError(err)) {
                    const pendingImage = createPendingProductImageState(imageData, draftName);
                    setImageDraft((prev) => prev ? ({ ...prev, queued: true }) : prev);
                    setEditingProduct((prev) => prev ? ({ ...prev, ...pendingImage }) : prev);
                    showToast('لا يوجد إنترنت. تم حفظ الصورة محلياً وستُرفع تلقائياً عند عودة الاتصال.', 'info');
                } else {
                    throw err;
                }
            }
        } catch (err) {
            setImageDraft(null);
            showToast(String(err?.message || err || 'تعذر إضافة صورة الصنف'), 'error');
        } finally {
            setImageSaving(false);
            if (productImageRef.current) productImageRef.current.value = '';
            if (productCameraRef.current) productCameraRef.current.value = '';
        }
    };
    // وحدة أكبر من خلال نافذة مستقلة فوق نافذة إضافة الصنف.
    const openParentUnitModal = () => {
        if (!editingProduct) return;
        const currentUnits = [...(editingProduct.units || [])];
        const topUnit = currentUnits[currentUnits.length - 1];
        if (!topUnit) return;
        setUnitEntryMode('larger');
        setUnitDraft({
            id: 'u-' + Date.now(),
            name: currentUnits.length === 1 ? 'كرتونة' : currentUnits.length === 2 ? 'مشطاح' : 'طرد',
            childUnitId: topUnit.id,
            multiplier: '12',
            conversionToBase: Math.max(1, toNumber(topUnit.conversionToBase, 1)) * 12,
            barcodes: [],
            salePrice: '',
            openingQuantity: '',
            wholesalePrice: '',
            costPrice: '',
            isDefaultSale: false,
        });
    };
    const handleAddParentUnit = openParentUnitModal;
    const handleSaveUnitDraft = () => {
        if (!editingProduct || !unitDraft) return;
        const child = editingProduct.units.find((u) => u.id === unitDraft.childUnitId) || editingProduct.units[editingProduct.units.length - 1];
        const name = String(unitDraft.name || '').trim();
        const multiplier = Math.max(1, toNumber(unitDraft.multiplier, 1));
        if (!name) { showToast('اكتب اسم الوحدة الأكبر', 'warning'); return; }
        const added = {
            ...unitDraft,
            name,
            multiplier,
            conversionToBase: Math.max(1, toNumber(child?.conversionToBase, 1)) * multiplier,
            salePrice: cleanDecimalInput(unitDraft.salePrice || ''),
            costPrice: cleanDecimalInput(unitDraft.costPrice || ''),
            barcodes: Array.isArray(unitDraft.barcodes) ? unitDraft.barcodes.filter(Boolean) : [],
        };
        setEditingProduct((prev) => prev ? ({ ...prev, units: calculateUnitConversions([...(prev.units || []), added], prev.baseUnitId) }) : prev);
        setUnitDraft(null);
        setUnitEntryMode('larger');
    };
    const handleRemoveUnit = (unitId) => {
        if (!editingProduct || editingProduct.units.length <= 1) {
            showToast('لا يمكن حذف الوحدة الأساسية الوحيدة للصنف', 'warning');
            return;
        }
        if (unitId === editingProduct.baseUnitId) {
            showToast('لا يمكن حذف الوحدة الأساسية، قم بتعيين وحدة أساسية أخرى أولاً', 'error');
            return;
        }
        const filtered = editingProduct.units.filter((u) => u.id !== unitId);
        setEditingProduct({
            ...editingProduct,
            units: calculateUnitConversions(filtered, editingProduct.baseUnitId),
        });
        if (filtered.length <= 1) setUnitEntryMode('single');
    };
    const handleDetectedUnitBarcode = (code) => {
        if (!barcodeScanUnitId || !code) return;
        const clean = normalizeArabicDigits(code).trim();
        if (!clean) return;
        const targetUnitId = barcodeScanUnitId;
        if (targetUnitId === '__unit_draft__') {
            setUnitDraft((prev) => prev ? ({ ...prev, barcodes: [clean, ...(prev.barcodes || []).filter((x) => x !== clean)] }) : prev);
        } else {
            setEditingProduct((prev) => prev ? ({
                ...prev,
                units: prev.units.map((u) => u.id === targetUnitId
                    ? ({ ...u, barcodes: [clean, ...(u.barcodes || []).filter((x) => x !== clean)] })
                    : u),
            }) : prev);
        }
        // في شاشة إضافة/تعديل الصنف: قراءة واحدة فقط، صوت الماسح ثم إغلاق الكاميرا فوراً.
        // ماسح الكاشير منفصل ويظل مفتوحاً للمسح المتتابع كما هو.
        playBeepSound(settings.scannerBeepEnabled);
        setBarcodeScanUnitId(null);
        showToast(`تم التقاط الباركود: ${clean}`, 'success');
    };
    const updateUnitField = (unitId, field, value, recalculate = false) => {
        setEditingProduct((prev) => {
            if (!prev) return prev;
            const updated = prev.units.map((u) => u.id === unitId ? { ...u, [field]: value } : u);
            return { ...prev, units: recalculate ? calculateUnitConversions(updated, prev.baseUnitId) : updated };
        });
    };
    const recalculateCostsFromUnit = (sourceUnitId) => {
        setEditingProduct((prev) => {
            if (!prev) return prev;
            const normalized = calculateUnitConversions(prev.units.map((u) => ({
                ...u,
                multiplier: u.id === prev.baseUnitId ? 1 : Math.max(1, toNumber(u.multiplier, 1)),
            })), prev.baseUnitId);
            const source = normalized.find((u) => u.id === sourceUnitId);
            const sourceCost = toNumber(source?.costPrice, 0);
            if (!source || sourceCost <= 0) return { ...prev, units: normalized };
            const sourceFactor = Math.max(1, toNumber(source.conversionToBase, 1));
            const baseCost = sourceCost / sourceFactor;
            return {
                ...prev,
                units: normalized.map((u) => ({
                    ...u,
                    costPrice: String(round4(baseCost * Math.max(1, toNumber(u.conversionToBase, 1)))),
                })),
            };
        });
    };
    const renderUnitCard = (unit, idx, isBase, childUnit) => {
        const numberInput = (label, field, extraClass = '') => h('div', { className: 'min-w-0' },
            h('label', { className: 'text-[10px] text-slate-400 block mb-1' }, label),
            h('input', {
                type: 'text', inputMode: 'decimal', dir: 'ltr',
                value: unit[field] === null || unit[field] === undefined ? '' : String(unit[field]),
                onChange: (e) => updateUnitField(unit.id, field, cleanDecimalInput(e.target.value)),
                onFocus: (e) => e.currentTarget.select(),
                onBlur: field === 'costPrice' ? () => recalculateCostsFromUnit(unit.id) : undefined,
                autoComplete: 'off', spellCheck: false,
                placeholder: '0',
                className: `product-number-input w-full px-2.5 py-2 text-xs font-mono font-bold border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:border-violet-500 ${extraClass}`
            })
        );
        return h('div', { key: unit.id, className: `unit-editor-card p-3 rounded-xl border bg-white dark:bg-slate-900 space-y-3 min-w-0 overflow-hidden ${unit.isDefaultSale ? 'border-violet-500 ring-1 ring-violet-500/20' : 'border-slate-200 dark:border-slate-700'}` },
            h('div', { className: 'flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0' },
                h('div', { className: 'flex items-center gap-2 min-w-0 flex-1' },
                    h('span', { className: 'w-6 h-6 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold' }, idx + 1),
                    h('input', {
                        type: 'text', value: unit.name || '',
                        onChange: (e) => updateUnitField(unit.id, 'name', e.target.value),
                        placeholder: 'اسم الوحدة (حبة، كرتونة...)',
                        className: 'min-w-0 flex-1 sm:max-w-56 px-2.5 py-2 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:border-violet-500'
                    }),
                    isBase && h('span', { className: 'shrink-0 px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' }, t("وحدة أساسية"))
                ),
                h('div', { className: 'flex items-center gap-2 shrink-0' },
                    h('label', { className: 'flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 cursor-pointer' },
                        h('input', { type: 'radio', name: 'defaultSaleUnit', checked: !!unit.isDefaultSale, onChange: () => {
                            setEditingProduct((prev) => prev ? ({ ...prev, units: prev.units.map((u) => ({ ...u, isDefaultSale: u.id === unit.id })) }) : prev);
                        }}),
                        h('span', null, 'افتراضية للبيع')
                    ),
                    !isBase && h('button', { type: 'button', onClick: () => handleRemoveUnit(unit.id), className: 'p-1.5 text-slate-400 hover:text-rose-500 rounded-lg', title: 'حذف هذه الوحدة' }, h(Trash2, { className: 'w-4 h-4' }))
                )
            ),
            !isBase && h('div', { className: 'unit-conversion-strip block w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden slim-scrollbar rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700' },
                h('div', { className: 'w-max min-w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-500 whitespace-nowrap' },
                    h('span', { className: 'font-bold text-slate-600 dark:text-slate-300' }, 'تحتوي على'),
                    h('input', {
                        type: 'text', inputMode: 'decimal', dir: 'ltr',
                        value: unit.multiplier === null || unit.multiplier === undefined ? '' : String(unit.multiplier),
                        onChange: (e) => updateUnitField(unit.id, 'multiplier', cleanDecimalInput(e.target.value), false),
                        onFocus: (e) => e.currentTarget.select(),
                        onBlur: () => updateUnitField(unit.id, 'multiplier', String(Math.max(1, toNumber(unit.multiplier, 1))), true),
                        className: 'w-16 px-2 py-1.5 text-center font-bold font-mono border border-amber-300 rounded-lg bg-white dark:bg-slate-900 focus:outline-none focus:border-violet-500'
                    }),
                    h('span', null, `من (${childUnit?.name || 'الوحدة السابقة'})`),
                    h('span', { className: 'text-[11px] font-mono font-bold text-violet-600 px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/40' }, `= ${unit.conversionToBase || 1} وحدة أساسية`)
                )
            ),
            h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 min-w-0' },
                numberInput('سعر بيع مفرق:', 'salePrice'),
                numberInput('الكمية الافتتاحية:', 'openingQuantity'),
                (!isBase || (editingProduct?.units || []).length <= 1) ? numberInput('سعر الشراء / التكلفة:', 'costPrice') : null,
                h('div', { className: 'min-w-0' },
                    h('label', { className: 'text-[10px] text-slate-400 block mb-1' }, 'باركود الوحدة:'),
                    h('div', { className: 'flex items-center gap-1 min-w-0' },
                        h('input', {
                            type: 'text', inputMode: 'numeric', dir: 'ltr',
                            value: (unit.barcodes || []).join(', '),
                            onFocus: (e) => e.currentTarget.select(),
                            onChange: (e) => updateUnitField(unit.id, 'barcodes', e.target.value.split(',').map((c) => normalizeArabicDigits(c).trim()).filter(Boolean)),
                            placeholder: '6251001, 6251002',
                            className: 'min-w-0 flex-1 px-2.5 py-2 text-xs font-mono border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 focus:outline-none focus:border-violet-500'
                        }),
                        h('button', { type: 'button', onClick: () => setBarcodeScanUnitId(unit.id), className: 'barcode-camera-button shrink-0 w-10 h-9 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 cursor-pointer active:scale-95 transition hover:bg-violet-100', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 0 }, title: 'فتح كاميرا سريعة لالتقاط الباركود' },
                            h(Camera, { className: 'w-5 h-5 block shrink-0' })
                        )
                    )
                )
            )
        );
    };
    const hasCurrentImage = !!(editingProduct && (imageDraft?.dataUrl || (!imageRemoved && (editingProduct.imageData || editingProduct.imageUrl || editingProduct.imageTelegramFileId))));
    const editorImageProduct = editingProduct ? (imageDraft?.dataUrl ? { ...editingProduct, imageData:imageDraft.dataUrl, imageTelegramFileId:'', imagePendingUpload: !!imageDraft?.queued } : editingProduct) : null;
    const editorImagePreview = h('div', { className: 'relative w-20 h-20 shrink-0' },
        hasCurrentImage
            ? h(ProductImage, { product: editorImageProduct, alt: t("صورة الصنف"), className: 'w-20 h-20 rounded-xl object-cover border border-slate-200 bg-white' })
            : h('div', { className: 'w-20 h-20 rounded-xl border border-dashed border-slate-300 bg-white text-slate-300', style:{display:'flex',alignItems:'center',justifyContent:'center'} }, h(ImageIcon, { className: 'w-7 h-7', style:{display:'block',margin:'auto'} })),
        imageSaving
            ? h('div', { className: 'absolute inset-0 rounded-xl bg-white/85 dark:bg-slate-900/85 grid place-items-center border border-violet-200' },
                h('div', { className: 'flex flex-col items-center gap-1' },
                    h('span', { className: 'block w-9 h-9 rounded-full border-[3px] border-violet-100 border-t-violet-600 animate-spin' }),
                )
            )
            : null
    );
    const getProductsExportData = () => ({
        headers:['الصنف','الكود','التصنيف','الوحدات','سعر البيع','التكلفة','المخزون'],
        rows: filteredProducts.map(p => { const cat=categories.find(c=>c.id===p.categoryId); const stock=getProductStock(p.id, settings.activeWarehouseId); const units=(p.units||[]).map(u=>`${u.name} ×${u.factorToBase || 1}`).join(' / '); const sale=(p.units||[]).find(u=>u.isDefaultSale)?.salePrice ?? p.salePrice ?? 0; return [p.name,p.sku||p.internalCode||'',cat?.name||'عام',units,Number(sale||0),Number(p.costPrice||0),Number(stock||0)]; })
    });
    const handleProductsPDF = async () => { const {headers,rows}=getProductsExportData(); await downloadProfessionalTablePDF({title:'دليل الأصناف',headers,rows,settings,orientation:'landscape',filename:`دليل_الأصناف_${new Date().toISOString().slice(0,10)}.pdf`}); showToast('تم تصدير دليل الأصناف كاملاً كـ PDF','success'); };
    const handleProductsImage = async () => { const {headers,rows}=getProductsExportData(); await downloadProfessionalTableImage({title:'دليل الأصناف',headers,rows,settings,orientation:'landscape',filename:`دليل_الأصناف_${new Date().toISOString().slice(0,10)}.png`}); showToast('تم تصدير دليل الأصناف كاملاً كصورة','success'); };
    return (_jsxs("div", { id: "products-screen", className: "p-4 sm:p-6 space-y-4 max-w-7xl mx-auto text-right select-none", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-black text-slate-900 dark:text-white", children: "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0648\u0634\u062c\u0631\u0629 \u0627\u0644\u0648\u062d\u062f\u0627\u062a" }), _jsx("p", { className: "text-xs text-slate-500 mt-0.5", children: "\u062a\u0639\u062f\u062f \u0648\u062d\u062f\u0627\u062a \u062d\u0642\u064a\u0642\u064a (\u0645\u0634\u0637\u0627\u062d\u060c \u0643\u0631\u062a\u0648\u0646\u0629\u060c \u0628\u0627\u0643\u064a\u062a\u060c \u062d\u0628\u0629)\u060c \u0628\u0627\u0631\u0643\u0648\u062f \u0645\u062a\u0639\u062f\u062f \u0644\u0643\u0644 \u0648\u062d\u062f\u0629\u060c \u0648\u062a\u062a\u0628\u0639 \u0627\u0644\u0645\u062e\u0632\u0648\u0646" })] }), _jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("button", { onClick: handleProductsPDF, className: "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0640 PDF", children: [_jsx(Download, { className: "w-4 h-4 text-rose-600" }), _jsx("span", { children: "PDF" })] }), _jsxs("button", { onClick: handleProductsImage, className: "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", title: "\u062a\u0646\u0632\u064a\u0644 \u0643\u0635\u0648\u0631\u0629", children: [_jsx(ImageIcon, { className: "w-4 h-4 text-blue-600" }), _jsx("span", { children: t("صورة") })] }), _jsxs("button", { onClick: () => {
                                    const headers = ['اسم الصنف', 'التصنيف', 'الباركود', 'سعر البيع', 'التكلفة'];
                                    const rows = filteredProducts.map((p) => {
                                        const cat = categories.find((c) => c.id === p.categoryId)?.name || 'عام';
                                        const defaultUnit = p.units.find((u) => u.isDefaultSale) || p.units[0];
                                        return [
                                            p.name,
                                            cat,
                                            defaultUnit?.barcodes?.join(' - ') || '',
                                            defaultUnit?.salePrice?.toString() || '',
                                            p.costPrice?.toString() || '',
                                        ];
                                    });
                                    exportToCSV(`دليل_الأصناف_${new Date().toISOString().slice(0, 10)}`, headers, rows);
                                    showToast('تم تصدير ملف Excel بنجاح', 'success');
                                }, className: "flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-50 transition shadow-xs", children: [_jsx(FileSpreadsheet, { className: "w-4 h-4 text-violet-600" }), _jsx("span", { children: "Excel" })] }), _jsxs("button", { id: "btn-add-product", onClick: handleOpenNew, className: "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition shadow-md shadow-violet-600/20 self-start sm:self-auto", children: [_jsx(Plus, { className: "w-4 h-4" }), _jsx("span", { children: t("إضافة صنف") })] })] })] }), _jsxs("div", { className: "ct-products-search-row p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center gact-products-search-row p-3", children: [_jsxs("div", { className: "flex-1 min-w-[220px] relative", children: [_jsx(Search, { className: "absolute right-3 top-2.5 w-4 h-4 text-slate-400" }), _jsx("input", { type: "text", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "\u0628\u062d\u062b \u0628\u0627\u0644\u0627\u0633\u0645\u060c \u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f\u060c \u0627\u0644\u0643\u0648\u062f\u060c \u0627\u0644\u0639\u0644\u0627\u0645\u0629 \u0627\u0644\u062a\u062c\u0627\u0631\u064a\u0629...", className: "w-full pr-9 pl-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-violet-500" })] }), _jsx("div", { className: "min-w-[190px]", children: _jsx(SearchableDropdown, { id: "products-filter-category", options: [{id:"all",label:`\u0643\u0627\u0641\u0629 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u0627\u062a (${activeProducts.length})`}, ...categories.map((c) => ({ id:c.id, label:c.name }))], selectedId: selectedCategory, onSelect: setSelectedCategory, placeholder: "\u0627\u0628\u062d\u062b \u0639\u0646 \u0627\u0644\u062a\u0635\u0646\u064a\u0641..." }) })] }), _jsx("div", { id: "products-table-container", ref: tableContainerRef, className: "rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden", children: _jsx("div", { className: "overflow-x-auto max-w-full slim-scrollbar", children: filteredProducts.length === 0 ? (_jsx("div", { className: "p-12 text-center text-xs text-slate-400", children: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0635\u0646\u0627\u0641 \u062a\u0637\u0627\u0628\u0642 \u0645\u0639\u0627\u064a\u064a\u0631 \u0627\u0644\u0628\u062d\u062b" })) : (_jsxs("table", { className: "w-full text-xs text-right whitespace-nowrap min-w-[800px]", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-500 font-semibold", children: [_jsx("th", { className: "p-3", children: t("اسم الصنف") }), _jsx("th", { className: "p-3", children: t("التصنيف") }), _jsx("th", { className: "p-3", children: "\u0634\u062c\u0631\u0629 \u0627\u0644\u0648\u062d\u062f\u0627\u062a \u0648\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f" }), _jsx("th", { className: "p-3 text-left", children: "\u0633\u0639\u0631 \u0627\u0644\u0628\u064a\u0639 (\u0627\u0644\u0627\u0641\u062a\u0631\u0627\u0636\u064a)" }), _jsx("th", { className: "p-3 text-left", children: "\u0627\u0644\u062a\u0643\u0644\u0641\u0629 (\u0627\u0644\u0648\u062d\u062f\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629)" }), _jsx("th", { className: "p-3 text-center", children: "\u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u062a\u0648\u0641\u0631" }), _jsx("th", { className: "p-3 text-center", children: t("إجراءات") })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: productsPager.pageItems.map((prod) => {
                                    const baseStock = getProductStock(prod.id, settings.activeWarehouseId);
                                    const cat = categories.find((c) => c.id === prod.categoryId);
                                    return (_jsxs("tr", { className: "hover:bg-slate-50/60 dark:hover:bg-slate-800/30", children: [_jsx("td", { className: "p-3", children: _jsxs("div", { className: "flex items-center gap-2.5 min-w-0", children: [_jsx(ProductImage, { product: prod, alt: prod.name, className: "w-12 h-12 rounded-xl object-cover border border-slate-200 bg-white shrink-0", fallback: _jsx("div", { className: "w-12 h-12 rounded-xl border border-slate-200 bg-slate-50 text-slate-300 shrink-0", style: { display: "flex", alignItems: "center", justifyContent: "center" }, children: _jsx(ImageIcon, { className: "w-5 h-5", style: { display: "block", margin: "auto" } }) }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "font-bold text-slate-900 dark:text-white truncate max-w-[210px]", children: prod.name }), _jsxs("div", { className: "text-[10px] text-slate-400 font-mono truncate max-w-[210px]", children: [prod.sku || prod.internalCode || 'صنف', " ", prod.brand && `• ${prod.brand}`] })] })] }) }), _jsx("td", { className: "p-3", children: _jsx("span", { className: "px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300", children: cat?.name || t("عام") }) }), _jsx("td", { className: "p-3", children: _jsx("div", { className: "flex flex-wrap items-center gap-1", children: prod.units.map((u, i) => (_jsxs("span", { className: `px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex items-center gap-1 ${u.isDefaultSale
                                                            ? 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-800'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`, title: `سعر البيع: ${u.salePrice} | الباركود: ${u.barcodes.join(', ')}`, children: [_jsx("span", { children: u.name }), _jsx("span", { className: "text-[9px] opacity-70", children: u.conversionToBase > 1 && `(×${u.conversionToBase})` }), i < prod.units.length - 1 && _jsx("span", { className: "opacity-40", children: "\u2190" })] }, u.id))) }) }), _jsxs("td", { className: "p-3 text-left font-mono font-bold text-slate-900 dark:text-white", children: [prod.sellingPrice.toFixed(2), " ", settings.currencySymbol] }), _jsxs("td", { className: "p-3 text-left font-mono text-slate-500", children: [prod.costPrice.toFixed(2), " ", settings.currencySymbol] }), _jsxs("td", { className: "p-3 text-center", children: [_jsxs("span", { className: `px-2 py-0.5 rounded font-mono font-bold text-xs ${baseStock <= (prod.reorderPoint || 0)
                                                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                                                            : 'bg-violet-50 dark:bg-violet-950 text-violet-800 dark:text-violet-300'}`, title: formatStockBreakdown(baseStock, prod.units), children: formatStockBreakdown(baseStock, prod.units, prod.baseUnitName) }), _jsx("div", { className: "text-[9px] text-slate-400 mt-0.5 truncate max-w-[140px]", children: formatStockBreakdown(baseStock, prod.units) })] }), _jsx("td", {className:"p-3 text-center",children:_jsx(ProductActions,{product:prod,onEdit:handleOpenEdit,onDelete:softDeleteProduct})})] }, prod.id));
                                }) })] })) }) }), _jsx(Pagination, { pager: productsPager }), editingProduct && (_jsx(ModalLayer, { className: "product-editor-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto animate-in fade-in", children: _jsxs("form", { onSubmit: handleSaveModal, className: "product-editor-modal-panel w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right my-6", children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(FolderTree, { className: "w-5 h-5 text-violet-600" }), _jsxs("div", { children: [_jsx("h3", { className: "text-base font-black text-slate-900 dark:text-white", children: isNew ? 'إضافة صنف جديد مع شجرة وحدات' : `تعديل صنف: ${editingProduct.name}` }), _jsx("p", { className: "text-xs text-slate-500", children: "\u062d\u062f\u062f \u0627\u0644\u0648\u062d\u062f\u0629 \u0627\u0644\u0635\u063a\u0631\u0649 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629 \u062b\u0645 \u0623\u0636\u0641 \u0627\u0644\u0648\u062d\u062f\u0627\u062a \u0627\u0644\u0623\u0643\u0628\u0631 (\u0628\u0627\u0643\u064a\u062a\u060c \u0643\u0631\u062a\u0648\u0646\u0629\u060c \u0645\u0634\u0637\u0627\u062d)" })] })] }), _jsx("button", { type: "button", onClick: () => setEditingProduct(null), className: "p-1 rounded-lg text-slate-400 hover:text-slate-600", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "product-editor-body p-4 sm:p-5 space-y-5 max-h-[75vh] overflow-y-auto overflow-x-hidden custom-scrollbar", children: [productImageUploadEnabled ? _jsxs("div", { className: "p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 flex items-center gap-3", children: [editorImagePreview, _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("div", { className: "text-xs font-black text-slate-800 dark:text-white", children: t("صورة الصنف") }), _jsxs("div", { className: "flex items-center gap-2 mt-2 flex-wrap", children: [_jsx("button", { type: "button", disabled: imageSaving, onClick: () => productImageRef.current?.click(), className: "px-3 py-1.5 rounded-lg bg-violet-600 disabled:opacity-60 text-white text-[10px] font-bold", children: hasCurrentImage ? "تغيير الصورة" : t("اختيار صورة") }), _jsxs("button", { type: "button", disabled: imageSaving, onClick: () => productCameraRef.current?.click(), className: "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-violet-200 bg-white text-violet-700 disabled:opacity-60 text-[10px] font-bold", children: [_jsx(Camera,{className:"w-3.5 h-3.5"}),_jsx("span",{children:t("كاميرا")})] }), hasCurrentImage ? _jsx("button", { type: "button", disabled: imageSaving, onClick: () => { setImageDraft(null); setImageRemoved(true); setEditingProduct((prev) => prev ? ({ ...prev, imageData: '', imagePendingUpload:false }) : prev); }, className: "px-2 py-1.5 text-rose-600 disabled:opacity-50 text-[10px] font-bold", children: t("إزالة") }) : null] }), _jsx("input", { ref: productImageRef, type: "file", accept: "image/png,image/jpeg,image/webp", className: "hidden", disabled: imageSaving, onChange: (e) => handleProductImageFile(e.target.files?.[0]) }), _jsx("input", { ref: productCameraRef, type: "file", accept: "image/*", capture: "environment", className: "hidden", disabled: imageSaving, onChange: (e) => handleProductImageFile(e.target.files?.[0]) })] })] }) : null, _jsxs("div", { className: "oscar-mobile-form-grid grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3", children: [_jsxs("div", { className: "ct-product-name-field min-w-0", children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: t("اسم الصنف الكامل *") }), _jsx("input", { type: "text", required: true, value: editingProduct.name, onChange: (e) => setEditingProduct((prev) => prev ? ({ ...prev, name: e.target.value }) : prev), placeholder: "مثال: مياه معدنية أروى 500 مل", className: "w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" })] }), _jsxs("div", { children: [_jsx(SearchableDropdown, { label: t("التصنيف:"), id: "product-category", options: categories.map((c) => ({ id: c.id, label: c.name })), selectedId: editingProduct.categoryId, onSelect: (id) => setEditingProduct((prev) => prev ? ({ ...prev, categoryId: id }) : prev), onQuickAdd: openQuickCategory, quickAddLabel: "+ تصنيف جديد", placeholder: "ابحث عن التصنيف..." })] })] }), _jsxs("div", { className: "p-3 sm:p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-3 min-w-0 overflow-hidden", children: [_jsxs("div", { className: "rounded-xl border border-slate-200 bg-white dark:bg-slate-900 p-3", children: [_jsx("div", { className: "text-xs font-black text-slate-800 dark:text-white mb-2", children: t("طريقة إدخال الوحدة") }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx("button", { type: "button", onClick: () => { if ((editingProduct.units || []).length > 1) { showToast('احذف الوحدات الأكبر أولاً للرجوع إلى قطعة واحدة', 'warning'); return; } setUnitEntryMode('single'); }, className: `px-3 py-2.5 rounded-xl text-xs font-black border ${unitEntryMode === 'single' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700'}`, children: t("قطعة واحدة") }), _jsx("button", { type: "button", onClick: openParentUnitModal, className: `px-3 py-2.5 rounded-xl text-xs font-black border ${unitEntryMode === 'larger' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-600 border-slate-200 dark:border-slate-700'}`, children: t("وحدة أكبر") })] }), (editingProduct.units || []).length > 1 ? _jsx("p", { className: "mt-2 text-[10px] text-violet-700 font-bold", children: "سعر شراء الوحدة الأصغر يُحسب تلقائياً من سعر شراء الوحدة الأكبر ÷ عدد القطع بداخلها." }) : null] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Layers, { className: "w-4 h-4 text-violet-600" }), _jsx("h4", { className: "text-xs font-bold text-slate-900 dark:text-white", children: t("شجرة الوحدات الهرمية والباركودات:") })] }), _jsxs("button", { type: "button", onClick: handleAddParentUnit, className: "flex items-center gap-1 px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition", children: [_jsx(Plus, { className: "w-3.5 h-3.5" }), _jsx("span", { children: t("وحدة أكبر") })] })] }), _jsx("div", { className: "space-y-3", children: editingProduct.units.map((unit, idx) => {
                                                const isBase = unit.id === editingProduct.baseUnitId;
                                                const childUnit = editingProduct.units.find((u) => u.id === unit.childUnitId);
                                                return renderUnitCard(unit, idx, isBase, childUnit);
                                            }) }) ] }), _jsxs("div", { className: "ct-product-extra pt-1", children: [_jsxs("button", { type: "button", onClick: () => setAdditionalOptionsOpen((v) => !v), "aria-expanded": additionalOptionsOpen, className: "w-full px-4 py-3 flex items-center justify-between gap-3 text-right rounded-xl border border-violet-100 dark:border-slate-800 bg-violet-50/60 dark:bg-slate-800/40 hover:bg-violet-50 dark:hover:bg-slate-800 transition", children: [_jsx("span", { className: "text-xs font-black text-slate-800 dark:text-white", children: t("خيارات إضافية") }), _jsx(ChevronDown, { className: `w-4 h-4 text-violet-600 transition-transform duration-200 ${additionalOptionsOpen ? 'rotate-180' : ''}` })] }), additionalOptionsOpen ? _jsxs("div", { className: "mt-3 px-1 grid grid-cols-1 sm:grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx(SearchableDropdown,{id:'product-sales-channel',label:t("مكان ظهور الصنف"),selectedId:editingProduct.salesChannel||'both',onSelect:id=>setEditingProduct(prev=>prev?({...prev,salesChannel:id}):prev),options:[{id:'shop',label:t("المحل / الكاشير فقط")},{id:'restaurant',label:t("المطعم والجرسون فقط")},{id:'both',label:t("المحل والمطعم معاً")},{id:'raw_material',label:t("مادة خام فقط - للوصفات والتصنيع")}]})] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: "العلامة التجارية (الماركة):" }), _jsx("input", { type: "text", value: editingProduct.brand || '', onChange: (e) => setEditingProduct((prev) => prev ? ({ ...prev, brand: e.target.value }) : prev), placeholder: "مثال: أروى، كوكاكولا، الجنيدي", className: "w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: "كود الصنف الداخلي (SKU):" }), _jsx("input", { type: "text", value: editingProduct.internalCode || '', onChange: (e) => setEditingProduct((prev) => prev ? ({ ...prev, internalCode: e.target.value }) : prev), className: "w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: "حد إعادة الطلب (تنبيه النواقص):" }), _jsx("input", { type: "text", inputMode: "decimal", dir: "ltr", value: editingProduct.reorderPoint ?? '', onChange: (e) => setEditingProduct((prev) => prev ? ({ ...prev, reorderPoint: cleanDecimalInput(e.target.value) }) : prev), className: "w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono" })] }), _jsxs("div", { className: "sm:col-span-2", children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: "تاريخ انتهاء الصلاحية:" }), _jsx("input", { type: "date", value: editingProduct.expiryDate || '', onChange: (e) => setEditingProduct((prev) => prev ? ({ ...prev, expiryDate: e.target.value }) : prev), className: "w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" })] })] }) : null] })] }), _jsxs("div", { className: "p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex justify-between", children: [_jsx("button", { type: "button", onClick: () => setEditingProduct(null), className: "px-4 py-2 text-xs font-bold text-slate-600 rounded-lg hover:bg-slate-200", children: t("إلغاء") }), _jsx("button", { type: "submit", id: "btn-save-product-modal", disabled: imageSaving, className: "px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-md shadow-violet-600/20", children: imageSaving ? _jsx('span', { className: 'inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin' }) : t("حفظ الصنف") })] })] }) })), quickCategoryOpen && editingProduct ? _jsx(ModalLayer, { className: "fixed inset-0 flex items-center justify-center bg-black/65 p-3", style: { zIndex: 120000 }, children: _jsxs("form", { onSubmit: saveQuickCategory, className: "w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right", children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-black text-slate-900 dark:text-white", children: "إضافة تصنيف جديد" }), _jsx("p", { className: "text-[10px] text-slate-400 mt-1", children: "سيتم إضافته واختياره للصنف مباشرة" })] }), _jsx("button", { type: "button", onClick: () => setQuickCategoryOpen(false), className: "p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1", children: "اسم التصنيف" }), _jsx("input", { autoFocus: true, type: "text", required: true, value: quickCategoryName, onChange: (e) => setQuickCategoryName(e.target.value), placeholder: "مثال: مشروبات وعصائر", className: "w-full px-3 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2", children: "لون التصنيف" }), _jsx("div", { className: "flex flex-wrap gap-2", children: categoryPresetColors.map((c) => _jsx("button", { type: "button", onClick: () => setQuickCategoryColor(c), className: `w-8 h-8 rounded-full border-2 transition-transform ${quickCategoryColor === c ? 'scale-110 border-violet-700 ring-2 ring-violet-300' : 'border-white dark:border-slate-900'}`, style: { backgroundColor: c }, title: c }, c)) })] })] }), _jsxs("div", { className: "p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2", children: [_jsx("button", { type: "button", onClick: () => setQuickCategoryOpen(false), className: "px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800", children: t("إلغاء") }), _jsx("button", { type: "submit", className: "px-5 py-2 rounded-xl text-white text-xs font-black shadow-md active:scale-[.98] transition-transform", style: { backgroundColor: "#7C3AED", color: "#FFFFFF", border: "1px solid #6D28D9" }, children: "حفظ التصنيف" })] })] }) }) : null, unitDraft && editingProduct ? _jsx(ModalLayer, { className: "fixed inset-0 flex items-center justify-center bg-black/70 p-3", style: { zIndex: 100000 }, children: _jsxs("div", { className: "w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-right", children: [_jsxs("div", { className: "flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-black text-slate-900 dark:text-white", children: t("وحدة أكبر") }), _jsx("p", { className: "text-[10px] text-slate-400 mt-1", children: "أدخل بيانات الوحدة ثم اضغط إضافة الوحدة" })] }), _jsx("button", { type: "button", onClick: () => { setUnitDraft(null); if ((editingProduct.units || []).length <= 1) setUnitEntryMode('single'); }, className: "p-1.5 rounded-lg text-slate-400 hover:bg-slate-100", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "p-4 space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 block mb-1", children: "اسم الوحدة الأكبر" }), _jsx("input", { type: "text", value: unitDraft.name || '', onChange: (e) => setUnitDraft((p) => p ? ({ ...p, name:e.target.value }) : p), placeholder: "مثال: كرتونة", className: "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white dark:bg-slate-800 text-xs font-bold focus:outline-none focus:border-violet-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 block mb-1", children: `كم ${(editingProduct.units.find((u)=>u.id===unitDraft.childUnitId)?.name || editingProduct.baseUnitName || 'قطعة')} في ${unitDraft.name || t("الوحدة")}؟` }), _jsx("input", { type: "text", inputMode: "decimal", dir: "ltr", value: unitDraft.multiplier ?? '', onChange: (e) => setUnitDraft((p) => p ? ({ ...p, multiplier:cleanDecimalInput(e.target.value) }) : p), placeholder: "12", className: "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white dark:bg-slate-800 text-xs font-mono font-black focus:outline-none focus:border-violet-500" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsxs("div", { children: [_jsx("label", { className: "text-[11px] font-bold text-slate-600 block mb-1", children: `سعر شراء ${unitDraft.name || t("الوحدة")}` }), _jsx("input", { type: "text", inputMode: "decimal", dir: "ltr", value: unitDraft.costPrice ?? '', onChange: (e) => setUnitDraft((p) => p ? ({ ...p, costPrice:cleanDecimalInput(e.target.value) }) : p), placeholder: "0", className: "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono font-bold focus:outline-none focus:border-violet-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "text-[11px] font-bold text-slate-600 block mb-1", children: `سعر بيع ${unitDraft.name || t("الوحدة")}` }), _jsx("input", { type: "text", inputMode: "decimal", dir: "ltr", value: unitDraft.salePrice ?? '', onChange: (e) => setUnitDraft((p) => p ? ({ ...p, salePrice:cleanDecimalInput(e.target.value) }) : p), placeholder: "0", className: "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono font-bold focus:outline-none focus:border-violet-500" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-bold text-slate-700 block mb-1", children: `باركود ${unitDraft.name || t("الوحدة")}` }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "text", inputMode: "numeric", dir: "ltr", value: (unitDraft.barcodes || []).join(', '), onChange: (e) => setUnitDraft((p) => p ? ({ ...p, barcodes:e.target.value.split(',').map((x)=>normalizeArabicDigits(x).trim()).filter(Boolean) }) : p), placeholder: "امسح أو اكتب الباركود", className: "min-w-0 flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono focus:outline-none focus:border-violet-500" }), _jsx("button", { type: "button", onClick: () => setBarcodeScanUnitId('__unit_draft__'), className: "w-11 h-10 shrink-0 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 flex items-center justify-center", title: "قراءة الباركود بالكاميرا", children: _jsx(Camera, { className: "w-5 h-5" }) })] })] }), _jsxs("div", { className: "rounded-xl bg-violet-50 border border-violet-100 p-3 text-[10px] leading-5 text-violet-800 font-bold", children: ["بعد الإضافة سيبقى سعر بيع وباركود الوحدة الأصغر مستقلين، وسعر شرائها سيُحسب تلقائياً من سعر شراء ", unitDraft.name || t("الوحدة"), "."] })] }), _jsxs("div", { className: "p-3 border-t border-slate-100 flex items-center justify-between gap-2", children: [_jsx("button", { type: "button", onClick: () => { setUnitDraft(null); if ((editingProduct.units || []).length <= 1) setUnitEntryMode('single'); }, className: "px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100", children: t("إلغاء") }), _jsx("button", { type: "button", onClick: handleSaveUnitDraft, className: "px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black", children: "إضافة الوحدة" })] })] }) }) : null, _jsx(BarcodeCameraModal, { open: !!barcodeScanUnitId, onClose: () => setBarcodeScanUnitId(null), onDetected: handleDetectedUnitBarcode, title: "التقاط باركود الوحدة", autoClose: true })] }));
};
