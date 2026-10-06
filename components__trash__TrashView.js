import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, usePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { RotateCcw, Trash2 } from 'lucide-react';

const h = React.createElement;

export const TrashView = () => {
  const {
    products, customers, suppliers, expenses,
    restoreProduct, restoreCustomer, restoreSupplier, restoreExpense,
    permanentDeleteProduct, permanentDeleteCustomer, permanentDeleteSupplier, permanentDeleteExpense,
    showToast,
  } = useApp();
  const [activeTab, setActiveTab] = useState('products');
  const [busyId, setBusyId] = useState('');
  const deletedProducts = (products || []).filter(p => p.deletedAt);
  const deletedCustomers = (customers || []).filter(c => c.deletedAt);
  const deletedSuppliers = (suppliers || []).filter(s => s.deletedAt);
  const deletedExpenses = (expenses || []).filter(e => e.deletedAt);
  const groups = { products: deletedProducts, customers: deletedCustomers, suppliers: deletedSuppliers, expenses: deletedExpenses };
  const activeItems = groups[activeTab] || [];
  const pager = usePagination(activeItems, 50, activeTab);

  const restore = item => {
    if (activeTab === 'products') return restoreProduct(item.id);
    if (activeTab === 'customers') return restoreCustomer(item.id);
    if (activeTab === 'suppliers') return restoreSupplier(item.id);
    return restoreExpense(item.id);
  };
  const permanentlyDelete = async (item) => {
    const label = activeTab === 'expenses' ? (item.category || 'المصروف') : (item.name || 'العنصر');
    if (!window.confirm(`حذف «${label}» نهائياً من قاعدة البيانات؟\nلا يمكن التراجع عن هذه العملية.`)) return;
    setBusyId(item.id);
    try {
      if (activeTab === 'products') await permanentDeleteProduct?.(item.id);
      else if (activeTab === 'customers') await permanentDeleteCustomer?.(item.id);
      else if (activeTab === 'suppliers') await permanentDeleteSupplier?.(item.id);
      else await permanentDeleteExpense?.(item.id);
    } catch (error) {
      console.error(error);
      showToast?.('تعذر الحذف النهائي. حاول مرة أخرى.', 'error');
    } finally { setBusyId(''); }
  };
  const emptyText = {
    products: 'لا توجد أصناف في سلة المحذوفات', customers: 'لا يوجد عملاء في سلة المحذوفات',
    suppliers: 'لا يوجد موردون في سلة المحذوفات', expenses: 'لا توجد مصروفات في سلة المحذوفات'
  }[activeTab];
  const restoreText = { products:'استرجاع الصنف', customers:'استرجاع العميل', suppliers:'استرجاع المورد', expenses:'استرجاع المصروف' }[activeTab];
  const itemTitle = item => activeTab === 'expenses' ? `${item.category || 'مصروف'} - ${Number(item.amount || 0).toFixed(2)}` : item.name;
  const itemSub = item => {
    if (activeTab === 'products') return `حُذف بتاريخ: ${new Date(item.deletedAt).toLocaleString('ar-EG')}`;
    if (activeTab === 'customers') return `الهاتف: ${item.phone || '-'}`;
    if (activeTab === 'suppliers') return `الشركة: ${item.company || '-'}`;
    return item.notes || '-';
  };

  const tabButton = (id, label, count) => h('button', {
    type:'button', onClick:()=>setActiveTab(id),
    className:`px-3 py-1.5 rounded-lg transition whitespace-nowrap ${activeTab===id?'bg-white dark:bg-slate-900 text-violet-600 shadow-xs':'text-slate-500'}`
  }, `${label} (${count})`);

  return h('div',{id:'trash-screen',className:'p-4 sm:p-6 space-y-4 max-w-5xl mx-auto text-right select-none'},
    h('div',{className:'flex flex-col sm:flex-row sm:items-center justify-between gap-4'},
      h('div',null,h('h2',{className:'text-xl font-black text-slate-900 dark:text-white'},t("سلة المحذوفات")),h('p',{className:'text-xs text-slate-500 mt-0.5'},'استرجع العنصر أو احذفه نهائياً من قاعدة البيانات. الحذف النهائي لا يمكن التراجع عنه.')),
      h('div',{className:'flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold overflow-x-auto'},
        tabButton('products','الأصناف',deletedProducts.length), tabButton('customers','العملاء',deletedCustomers.length),
        tabButton('suppliers','الموردون',deletedSuppliers.length), tabButton('expenses','المصروفات',deletedExpenses.length)
      )
    ),
    h('div',{className:'rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden'},
      activeItems.length===0 ? h('div',{className:'p-12 text-center text-xs text-slate-400'},emptyText) :
      h('div',{className:'divide-y divide-slate-100 dark:divide-slate-800'},
        ...pager.pageItems.map(item=>h('div',{key:item.id,className:'p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3'},
          h('div',{className:'min-w-0'},h('h4',{className:'font-bold text-sm text-slate-900 dark:text-white truncate'},itemTitle(item)),h('span',{className:'text-xs text-slate-400'},itemSub(item))),
          h('div',{className:'shrink-0 flex items-center gap-2'},
            h('button',{type:'button',disabled:busyId===item.id,onClick:()=>restore(item),className:'flex items-center gap-1.5 px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-lg transition disabled:opacity-40'},h(RotateCcw,{className:'w-3.5 h-3.5'}),restoreText),
            h('button',{type:'button',disabled:busyId===item.id,onClick:()=>permanentlyDelete(item),className:'flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition disabled:opacity-40'},h(Trash2,{className:'w-3.5 h-3.5'}),busyId===item.id?'جاري الحذف...':'حذف نهائي')
          )
        ))
      )
    ),
    h(Pagination,{pager})
  );
};
