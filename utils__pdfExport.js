import { renderElementTablePages, resolveExportElement } from './utils__canvasRenderer.js?v=7.9.4.136-localization';

const safe=v=>String(v||'export').replace(/[\\/:*?"<>|]+/g,'-').trim()||'export';
const withExt=(name,ext)=>safe(name).toLowerCase().endsWith(ext)?safe(name):safe(name)+ext;
const enc=new TextEncoder();const b=s=>enc.encode(s);
function concat(parts){const len=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(len);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function saveBlob(name,blob){
  if(!(blob instanceof Blob)||!blob.size)return false;
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=safe(name);a.rel='noopener';a.style.display='none';document.body.appendChild(a);
  try{a.click();}catch(_){try{window.open(url,'_blank');}catch(__){}}
  a.remove();setTimeout(()=>{try{URL.revokeObjectURL(url);}catch(_){}},60000);return true;
}
function b64Bytes(dataUrl){const b64=String(dataUrl||'').split(',')[1]||'',bin=atob(b64),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function jpeg(canvas,quality=.9){const bytes=b64Bytes(canvas.toDataURL('image/jpeg',quality));return{bytes,width:canvas.width,height:canvas.height};}
function paper(v){const s=String(v||'').toLowerCase();if(s.includes('58'))return'58mm';if(s.includes('80'))return'80mm';if(s.includes('a4'))return'a4';return'';}
function pageFromCanvas(canvas,options={}){
  const p=paper(options.paperSize),j=jpeg(canvas,options.jpegQuality??.9);
  if(p==='58mm'||p==='80mm'){const ptPerMm=72/25.4,pageW=(p==='58mm'?58:80)*ptPerMm,pageH=Math.max(40*ptPerMm,pageW*canvas.height/canvas.width);return{...j,pageW,pageH,x:0,y:0,drawW:pageW,drawH:pageH};}
  const landscape=String(options.orientation||'').toLowerCase()==='landscape',pageW=landscape?841.89:595.28,pageH=landscape?595.28:841.89,margin=Number(options.marginPt??28.35),maxW=pageW-margin*2,maxH=pageH-margin*2,ratio=Math.min(maxW/canvas.width,maxH/canvas.height),drawW=canvas.width*ratio,drawH=canvas.height*ratio;return{...j,pageW,pageH,x:(pageW-drawW)/2,y:(pageH-drawH)/2,drawW,drawH};
}
function buildPdf(pages){
  const objects=new Map(),kids=[];objects.set(1,b('<< /Type /Catalog /Pages 2 0 R >>'));
  pages.forEach((p,i)=>{const pageId=3+i*3,imageId=pageId+1,contentId=pageId+2;kids.push(`${pageId} 0 R`);objects.set(pageId,b(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pageW.toFixed(2)} ${p.pageH.toFixed(2)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));objects.set(imageId,concat([b(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`),p.bytes,b('\nendstream')]));const stream=b(`q\n${p.drawW.toFixed(2)} 0 0 ${p.drawH.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)} cm\n/Im0 Do\nQ\n`);objects.set(contentId,concat([b(`<< /Length ${stream.length} >>\nstream\n`),stream,b('endstream')]));});
  objects.set(2,b(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`));const max=2+pages.length*3,header=concat([b('%PDF-1.4\n%'),new Uint8Array([0xe2,0xe3,0xcf,0xd3]),b('\n')]),parts=[header],offsets=new Array(max+1).fill(0);let len=header.length;for(let id=1;id<=max;id++){const body=objects.get(id);if(!body)continue;offsets[id]=len;const pre=b(`${id} 0 obj\n`),post=b('\nendobj\n');parts.push(pre,body,post);len+=pre.length+body.length+post.length;}const xrefPos=len;let xref=`xref\n0 ${max+1}\n0000000000 65535 f \n`;for(let id=1;id<=max;id++)xref+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;xref+=`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;parts.push(b(xref));return new Blob([concat(parts)],{type:'application/pdf'});
}
export function canvasesToPDFBlob(canvases,options={}){try{const pages=(canvases||[]).filter(Boolean).map(c=>pageFromCanvas(c,options));if(!pages.length)return null;return buildPdf(pages);}catch(err){console.error('PDF blob export failed',err);return null;}}
export async function downloadCanvasesAsPDF(canvases,filename,options={}){try{const blob=canvasesToPDFBlob(canvases,options);if(!blob)return false;return saveBlob(withExt(filename,'.pdf'),blob);}catch(err){console.error('PDF export failed',err);return false;}}
export async function downloadCanvasAsPDF(canvas,filename,options={}){return downloadCanvasesAsPDF([canvas],filename,options);}
export async function downloadElementAsPDF(target,filename,title='',options={}){try{const el=resolveExportElement(target);if(!el)return false;const canvases=await renderElementTablePages(el,{...options,title:title||options.title});if(!canvases.length)return false;return downloadCanvasesAsPDF(canvases,filename,{...options,orientation:options.orientation||'landscape'});}catch(err){console.error('Fast PDF export failed',err);return false;}}
