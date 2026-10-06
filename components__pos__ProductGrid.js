import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Layers } from 'lucide-react';
import { ProductImage } from './components__common__ProductImage.js?v=7.9.4.136-localization';

const h = React.createElement;

const normalizedSalesChannel = (p) => String((p && p.salesChannel) || 'both').toLowerCase();
const isRawMaterialOnly = (p) => {
  const c = normalizedSalesChannel(p);
  return c === 'raw_material' || c === 'raw' || c === 'ingredient' || !!(p && p.isRawMaterialOnly);
};
const isCashierVisibleProduct = (p) => {
  const c = normalizedSalesChannel(p);
  return !isRawMaterialOnly(p) && c !== 'restaurant' && c !== 'restaurant_only';
};
const unitStockLines = (baseStock, units=[]) => {
  const total = Math.max(0, Number(baseStock) || 0);
  if (!units.length) return [];
  const baseUnit = units.find(u => (Number(u.conversionToBase)||1) === 1) || units[0];
  const sorted = [...units].sort((a,b)=>(Number(b.conversionToBase)||1)-(Number(a.conversionToBase)||1));
  let remaining = total;
  const parts = [];
  for (const u of sorted) {
    const factor = Math.max(1, Number(u.conversionToBase)||1);
    if (factor > 1) {
      const count = Math.floor((remaining + 1e-9) / factor);
      if (count > 0) {
        const baseEquivalent = count * factor;
        parts.push({ id:u.id, name:u.name, value:count, factor, baseEquivalent, baseUnitName:baseUnit?.name || 'حبة' });
        remaining = Math.max(0, remaining - baseEquivalent);
      }
    } else if (remaining > 0 || parts.length === 0) {
      const value = Number.isInteger(remaining) ? remaining : Math.round(remaining*100)/100;
      parts.push({ id:u.id, name:u.name, value, factor:1, baseEquivalent:value, baseUnitName:u.name });
      remaining = 0;
    }
  }
  return parts.length ? parts : [{ id:baseUnit?.id || 'base', name:baseUnit?.name || 'حبة', value:0, factor:1, baseEquivalent:0, baseUnitName:baseUnit?.name || 'حبة' }];
};

const ProductGridImpl = () => {
  const { products, categories, selectedCategory, setSelectedCategory, searchQuery, addToCart, getProductStock, settings, setActiveTab, softDeleteProduct } = useApp();
  const [renderLimit,setRenderLimit]=React.useState(48);const scrollRef=React.useRef(null);const moreRef=React.useRef(null);
  const deferredSearch = React.useDeferredValue(searchQuery);
  const visibleProducts = React.useMemo(() => products.filter(p => !p.deletedAt && p.status !== 'archived' && isCashierVisibleProduct(p)), [products]);
  const categoryCounts = React.useMemo(() => {
    const map = new Map();
    for (const p of visibleProducts) map.set(p.categoryId, (map.get(p.categoryId) || 0) + 1);
    return map;
  }, [visibleProducts]);
  const filteredProducts = React.useMemo(() => {
    const q = String(deferredSearch || '').toLowerCase().trim();
    return visibleProducts.filter(p => {
      if (selectedCategory && p.categoryId !== selectedCategory) return false;
      if (!q) return true;
      const matchName = p.name?.toLowerCase().includes(q) || p.shortName?.toLowerCase().includes(q);
      const matchSku = p.sku?.toLowerCase().includes(q) || p.internalCode?.toLowerCase?.().includes(q);
      const matchBrand = p.brand?.toLowerCase().includes(q);
      const matchBarcode = (p.units||[]).some(u => (u.barcodes||[]).some(b => String(b).toLowerCase().includes(q)));
      return matchName || matchSku || matchBrand || matchBarcode;
    });
  }, [visibleProducts, selectedCategory, deferredSearch]);
  React.useEffect(()=>setRenderLimit(48),[selectedCategory,deferredSearch]);
  React.useEffect(()=>{if(!moreRef.current||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setRenderLimit(n=>Math.min(filteredProducts.length,n+48))},{root:scrollRef.current,rootMargin:'200px'});observer.observe(moreRef.current);return()=>observer.disconnect()},[renderLimit,filteredProducts.length]);
  return h('div', { className:'flex flex-col h-full overflow-hidden text-right select-none' },
    h('div',{className:'ct-catalog-head'},h('strong',{className:'ct-catalog-heading'},`${t('كافة الأصناف')} (${visibleProducts.length})`),h('div',{id:'ct-catalog-search-target'})),
    h('div', { className:'ct-catalog-categories p-2 border-b border-slate-200 bg-white overflow-x-auto custom-scrollbar shrink-0 w-full min-w-full' },
      h('div', { className:'flex items-center gap-1.5 min-w-full w-max' },
        h('button', { onClick:()=>setSelectedCategory(null), className:`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 ${selectedCategory===null?'bg-slate-900 text-white':'bg-slate-100 text-slate-600 hover:bg-slate-200'}` }, `${t('كافة الأصناف')} (${visibleProducts.length})`),
        ...categories.map(cat => {
          const active=selectedCategory===cat.id;
          const count=categoryCounts.get(cat.id)||0;
          return h('button',{key:cat.id,onClick:()=>setSelectedCategory(active?null:cat.id),className:`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 flex items-center gap-1.5 ${active?'bg-violet-600 text-white':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`},
            h('span',{className:'w-2 h-2 rounded-full shrink-0',style:{backgroundColor:cat.color||'#10b981'}}), h('span',null,cat.name), h('span',{className:`text-[10px] ${active?'text-violet-100':'text-slate-400'}`},`(${count})`));
        })
      )
    ),
    h('div', { ref:scrollRef,className:'flex-1 overflow-y-auto p-3 custom-scrollbar' },
      filteredProducts.length===0 ? null :
      h('div',{className:'oscar-pos-product-grid'}, ...filteredProducts.slice(0,renderLimit).map(product=>{
        const baseStock=getProductStock(product.id,settings.activeWarehouseId);
        const defaultUnit=(product.units||[]).find(u=>u.isDefaultSale)||(product.units||[])[0];
        const low=product.reorderPoint!==undefined&&baseStock<=product.reorderPoint;
        const out=baseStock<=0;
        const lines=unitStockLines(baseStock,product.units||[]);
        return h('div',{key:product.id,id:`product-card-${product.id}`,onClick:()=>defaultUnit&&addToCart(product,defaultUnit,1),className:'oscar-product-card group relative flex flex-col justify-between p-3 rounded-xl border border-slate-200/80 bg-white hover:border-violet-500/70 hover:shadow-md cursor-pointer active:scale-[.995]'},
          h('div',{className:'ct-product-body'},
            h(ProductImage,{product,alt:product.name,wrapperClassName:'mb-2 rounded-xl overflow-hidden bg-slate-50 border border-slate-100',className:'w-full aspect-square object-cover object-center'}),
            h('div',{className:'ct-product-stock-old flex items-start justify-between gap-2 mb-1.5'},
              h('span',{className:'text-[10px] text-slate-400 truncate pt-0.5'},product.brand||product.sku||product.internalCode||'صنف'),
              h('div',{className:`rounded-lg px-2 py-1 min-w-[72px] text-[9px] font-bold leading-4 ${out?'bg-rose-50 text-rose-700':low?'bg-amber-50 text-amber-700':'bg-violet-50 text-violet-700'}`},
                ...lines.map(x=>h('div',{key:x.id,className:'flex items-center justify-between gap-1 whitespace-nowrap'},
                  h('span',{className:'font-mono font-black'},x.value),
                  h('span',{className:'font-semibold'},x.name)))
              )
            ),
            h('h4',{className:'text-xs font-bold text-slate-900 line-clamp-2 group-hover:text-violet-600 leading-snug mb-2'},product.name)
          ),
          h('div',{className:'ct-catalog-desktop-meta'},h('strong',null,`${Number(defaultUnit?.salePrice||0).toFixed(2)} ${settings.currencySymbol}`),h('div',null,h('span',null,`متوفر ${baseStock}`),h('button',{type:'button',onClick:e=>{e.stopPropagation();defaultUnit&&addToCart(product,defaultUnit,1)}},defaultUnit?.name||''))),
          h('div',{className:'ct-product-units-old pt-2 border-t border-slate-100'},
            h('div',{className:'text-[10px] text-slate-400 mb-1 flex items-center gap-1'},h(Layers,{className:'w-2.5 h-2.5'}),h('span',null,'اختر وحدة للبيع:')),
            h('div',{className:'flex flex-wrap gap-1'},...(product.units||[]).map(unit=>h('button',{key:unit.id,type:'button',onClick:e=>{e.stopPropagation();addToCart(product,unit,1);},className:`flex items-center justify-between gap-1 px-1.5 py-1 rounded-md text-[10px] font-semibold active:scale-95 ${unit.isDefaultSale?'bg-violet-50 text-violet-800 border border-violet-300/70':'bg-slate-100 text-slate-700 hover:bg-slate-200'}`,title:`إضافة ${unit.name} بسعر ${unit.salePrice} ${settings.currencySymbol}`},h('span',null,unit.name),h('span',{className:'font-mono font-bold'},unit.salePrice))))
          )
        );
      })),filteredProducts.length>renderLimit&&h('button',{ref:moreRef,type:'button',className:'ct-more-products',onClick:()=>setRenderLimit(n=>n+48)},t("عرض المزيد"))
    )
  );
};

export const ProductGrid = React.memo(ProductGridImpl);
