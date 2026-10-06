import {useSyncExternalStore} from 'react';
import {messages} from './locales__ui.js?v=7.9.4.136-localization';
export const languages=[{id:'ar',label:'العربية',dir:'rtl'},{id:'en',label:'English',dir:'ltr'},{id:'fr',label:'Français',dir:'ltr'},{id:'es',label:'Español',dir:'ltr'},{id:'hi',label:'हिन्दी',dir:'ltr'},{id:'zh',label:'中文',dir:'ltr'}];
let language='ar';try{const saved=localStorage.getItem('ct-language');if(languages.some(l=>l.id===saved))language=saved}catch{}
const listeners=new Set();
function apply(){if(typeof document!=='undefined'){document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';document.body?.setAttribute('dir',language==='ar'?'rtl':'ltr')}}
apply();
export function getLanguage(){return language}
export function setLanguage(value){if(!languages.some(l=>l.id===value))return;language=value;try{localStorage.setItem('ct-language',value)}catch{}apply();listeners.forEach(fn=>fn())}
export function useLanguage(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getLanguage,()=> 'ar')}
export function t(source){if(typeof source!=='string'||language==='ar')return source;const index=languages.findIndex(l=>l.id===language)-1;if(messages[source])return messages[source][index];const key=source.trim().replace(/[:：*]+$/,'').trim();if(messages[key])return source.replace(key,messages[key][index]);return source}

export function toSourceText(value){for(const [source,translations] of Object.entries(messages)){if(translations.includes(value))return source}return value}
