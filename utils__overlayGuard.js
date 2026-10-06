// A dismissing pointer must never activate the page after its menu disappears.
let swallowClick=false;
const selectors='.invoice-actions-menu,.customer-actions-menu';
document.addEventListener('pointerdown',e=>{swallowClick=false;const menu=document.querySelector(selectors);if(!menu||menu.contains(e.target))return;swallowClick=true;e.preventDefault();e.stopImmediatePropagation();document.dispatchEvent(new Event('cash-top:close-action-menus'));},true);
document.addEventListener('pointerup',e=>{if(swallowClick){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('click',e=>{if(!swallowClick)return;swallowClick=false;e.preventDefault();e.stopImmediatePropagation();},true);
