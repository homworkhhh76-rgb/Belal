import { renderElementTableCanvas, resolveExportElement } from './utils__canvasRenderer.js?v=7.9.4.136-localization';

const safe=v=>String(v||'export').replace(/[\\/:*?"<>|]+/g,'-').trim()||'export';
const withExt=(name,ext)=>safe(name).toLowerCase().endsWith(ext)?safe(name):safe(name)+ext;
function saveBlob(name,blob){
  if(!(blob instanceof Blob)||!blob.size)return false;
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safe(name);a.rel='noopener';a.style.display='none';document.body.appendChild(a);
  try{a.click();}catch(_){try{window.open(url,'_blank');}catch(__){}}
  a.remove();setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(_){}},60000);return true;
}
function dataUrlBlob(dataUrl){const [head,data='']=String(dataUrl||'').split(',');const mime=(head.match(/data:([^;]+)/)||[])[1]||'image/png';const bin=atob(data),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);return new Blob([bytes],{type:mime});}
function canvasBlob(canvas,type='image/png',quality=.95){
  return new Promise((resolve,reject)=>{
    if(!canvas)return reject(new Error('لا يوجد محتوى للصورة'));
    const fallback=()=>{try{resolve(dataUrlBlob(canvas.toDataURL(type,quality)));}catch(e){reject(e);}};
    if(typeof canvas.toBlob!=='function')return fallback();
    try{canvas.toBlob(b=>b&&b.size?resolve(b):fallback(),type,quality);}catch(_){fallback();}
  });
}
export async function canvasToImageBlob(canvas,options={}){const type=options.type||'image/png';return await canvasBlob(canvas,type,options.quality??.95);}
export async function downloadCanvasAsImage(canvas,filename,options={}){
  try{const type=options.type||'image/png',blob=await canvasToImageBlob(canvas,options);return saveBlob(withExt(filename,type==='image/jpeg'?'.jpg':'.png'),blob);}catch(err){console.error('PNG export failed',err);return false;}
}
export async function downloadElementAsImage(target,filename,options={}){
  try{const el=resolveExportElement(target);if(!el)return false;const canvas=await renderElementTableCanvas(el,options);if(!canvas)return false;return downloadCanvasAsImage(canvas,filename,options);}catch(err){console.error('Fast image export failed',err);return false;}
}
