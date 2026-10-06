import {toSourceText} from './services__i18n.js?v=7.9.4.136-localization';
import {useEffect,useRef,useState} from 'react';
const layers=[];let currentTab='dashboard';let navigate=null;let fromBack=false;let seq=0;let pendingClose=null;
const visible=e=>!!e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
export function closeLayerElement(root){
 const buttons=Array.from(root?.querySelectorAll('button')||[]).filter(visible);
 const close=buttons.find(b=>/^(إلغاء|الغاء|إغلاق|اغلاق|إغلاق العرض|رجوع|Close|Cancel|Back)$/.test(toSourceText((b.dataset.originalText||b.textContent||'').trim()))||/إغلاق|إلغاء|Close|Cancel/.test(toSourceText(b.getAttribute('aria-label')||'')))||buttons.find(b=>b.querySelector('svg.lucide-x'));
 if(close){close.click();return true}return false;
}
function onHistoryBack(){
 const top=layers.at(-1);
 if(top&&history.state?.ctLayer!==top.id){top.close();return}
 const next=history.state?.ctTab;
 if(next&&next!==currentTab&&navigate){fromBack=true;navigate(next)}
}
if(typeof window!=='undefined')window.addEventListener('popstate',onHistoryBack);
export function registerLayer(close){
 const id='ct-layer-'+(++seq);layers.push({id,close});const replace=pendingClose&&history.state?.ctLayer===pendingClose;pendingClose=null;
 history[replace?'replaceState':'pushState']({...history.state,ctApp:true,ctTab:currentTab,ctLayer:id},'');
 return()=>{const i=layers.findIndex(x=>x.id===id);if(i>=0)layers.splice(i,1);if(history.state?.ctLayer===id){pendingClose=id;queueMicrotask(()=>{if(pendingClose===id){pendingClose=null;if(history.state?.ctLayer===id)history.back()}})}};
}
export function useAppNavigation(tab,setTab){
 const last=useRef(null);
 useEffect(()=>{navigate=setTab;return()=>{navigate=null}},[setTab]);
 useEffect(()=>{currentTab=tab;if(last.current===null){history.replaceState({...history.state,ctApp:true,ctTab:tab},'')}
 else if(last.current!==tab){if(fromBack)fromBack=false;else{const replace=!!history.state?.ctLayer&&!layers.length;pendingClose=null;history[replace?'replaceState':'pushState']({ctApp:true,ctTab:tab},'')}}
 last.current=tab},[tab]);
}
export function usePullRefresh(ref,onRefresh,enabled=true){
 const latest=useRef(onRefresh);latest.current=onRefresh;const [distance,setDistance]=useState(0);const [refreshing,setRefreshing]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el||!enabled)return;let start=null,amount=0,running=false;
 const reset=()=>{start=null;amount=0;setDistance(0)};
 const down=e=>{if(running||e.touches.length!==1||document.querySelector('[aria-modal="true"]')||e.target.closest('input,textarea,button,select,[contenteditable]'))return;let node=e.target;while(node&&node!==el){if(node.scrollTop>1)return;node=node.parentElement}start={x:e.touches[0].clientX,y:e.touches[0].clientY}};
 const move=e=>{if(!start)return;const dx=e.touches[0].clientX-start.x,dy=e.touches[0].clientY-start.y;if(Math.abs(dx)>25||dy<0){reset();return}if(dy>8){e.preventDefault();amount=Math.min(88,dy*.42);setDistance(amount)}};
 const up=async()=>{if(!start)return;start=null;if(amount<60){reset();return}running=true;setRefreshing(true);setDistance(60);try{await latest.current()}finally{running=false;setRefreshing(false);reset()}};
 el.addEventListener('touchstart',down,{passive:true});el.addEventListener('touchmove',move,{passive:false});el.addEventListener('touchend',up);el.addEventListener('touchcancel',reset);
 return()=>{el.removeEventListener('touchstart',down);el.removeEventListener('touchmove',move);el.removeEventListener('touchend',up);el.removeEventListener('touchcancel',reset)};
 },[ref,enabled]);return {distance,refreshing};
}
