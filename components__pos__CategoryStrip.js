import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React from 'react';
import {useApp} from './context__AppContext.js?v=7.9.4.136-localization';
const h=React.createElement;
export function CategoryStrip(){const {categories,selectedCategory,setSelectedCategory}=useApp();return h('div',{className:'ct-rail-categories','aria-label':'تصنيفات الأصناف'},h('button',{type:'button',className:selectedCategory===null?'active':'',onClick:()=>setSelectedCategory(null)},t("الكل")),...categories.filter(c=>!c.deletedAt).map(c=>h('button',{type:'button',key:c.id,className:selectedCategory===c.id?'active':'',onClick:()=>setSelectedCategory(selectedCategory===c.id?null:c.id)},c.name)))}
