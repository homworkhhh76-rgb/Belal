import {customerStatementModel,statementHeaders} from './utils__customerStatement.js?v=7.9.4.136-localization';
import { getBrandLogoDataUrl, DEFAULT_LOGO_DATA_URL } from './brand__logo.js?v=7.9.4.136-localization';
import { code128Geometry } from './utils__code128.js?v=7.9.4.136-localization';

const imageCache = new Map();
const num = v => { const n=Number(v); return Number.isFinite(n)?n:0; };
const money = v => num(v).toFixed(2);
const normalize = v => String(v ?? '').replace(/\s+/g,' ').trim();
const dateText = v => { const d=new Date(v); return Number.isFinite(d.getTime())?d.toLocaleString('ar-EG'):'-'; };

export function resolveExportElement(target){
  if(!target) return null;
  if(typeof target==='string') return document.getElementById(target);
  return target instanceof HTMLElement ? target : null;
}

export function documentBrandSettings(extra={}){
  const header=document.getElementById('main-header');
  const storeName=extra.storeName || 'كاش توب 3';
  const subtitle=header?.querySelector('h1 + span')?.textContent?.trim() || extra.subtitle || '';
  const logo=header?.querySelector('img')?.currentSrc || header?.querySelector('img')?.src || extra.logo;
  return {...extra,storeName,subtitle,logo};
}

async function loadImage(src){
  src=String(src||'').trim(); if(!src) return null;
  if(imageCache.has(src)) return imageCache.get(src);
  const p=new Promise(resolve=>{const img=new Image(); if(/^https?:/i.test(src)) img.crossOrigin='anonymous'; img.onload=()=>resolve(img); img.onerror=()=>resolve(null); img.src=src;});
  imageCache.set(src,p); return p;
}

function setFont(ctx,size=24,weight=600){ctx.font=`${weight} ${size}px Cairo, Arial, Tahoma, sans-serif`;ctx.direction='rtl';ctx.textBaseline='middle';}
function txt(ctx,value,x,y,size=24,weight=600,align='right',color='#0f172a'){
  setFont(ctx,size,weight);ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(normalize(value)||'-',x,y);
}
function line(ctx,x1,y1,x2,y2,w=1,color='#cbd5e1'){ctx.strokeStyle=color;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
function roundedRect(ctx,x,y,w,h,r=12,fill='#fff',stroke='#e2e8f0',lw=1){
  const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
}
function wrap(ctx,value,maxWidth,size=22,weight=600,maxLines=3){
 setFont(ctx,size,weight);const words=normalize(value).split(' ').filter(Boolean);if(!words.length)return ['-'];const lines=[];let cur='';
 for(const word of words){let parts=[];let part='';for(const char of word){if(part&&ctx.measureText(part+char).width>maxWidth){parts.push(part);part=char}else part+=char}if(part)parts.push(part);
 for(const piece of parts){const next=cur?cur+' '+piece:piece;if(cur&&ctx.measureText(next).width>maxWidth){lines.push(cur);cur=piece}else cur=next;if(lines.length>=maxLines)return lines.slice(0,maxLines)}}
 if(cur&&lines.length<maxLines)lines.push(cur);return lines;
}

function wrapped(ctx,value,x,y,maxWidth,size=22,weight=600,align='right',color='#0f172a',lineH=30,maxLines=3){
  const lines=wrap(ctx,value,maxWidth,size,weight,maxLines);lines.forEach((s,i)=>txt(ctx,s,x,y+i*lineH,size,weight,align,color));return lines.length;
}
function createCanvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));const ctx=c.getContext('2d',{alpha:false,desynchronized:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);return {canvas:c,ctx};}

async function drawBrand(ctx,w,settings,title,subtitle='',top=34){
  let y=top; let logoSrc='';
  try{ logoSrc=getBrandLogoDataUrl(settings||{}); }catch(_){ logoSrc=settings?.logo||DEFAULT_LOGO_DATA_URL; }
  const logo=await loadImage(logoSrc||settings?.logo||DEFAULT_LOGO_DATA_URL);
  if(logo){const maxW=Math.min(settings.invoiceBrand?240:170,w*.28),maxH=settings.invoiceBrand?130:92,ratio=Math.min(maxW/logo.width,maxH/logo.height);const dw=Math.max(45,logo.width*ratio),dh=Math.max(35,logo.height*ratio);ctx.drawImage(logo,(w-dw)/2,y,dw,dh);y+=dh+14;}
  txt(ctx,settings?.storeName||'كاش توب 3',w/2,y+19,34,900,'center');y+=52;
  if(settings?.subtitle){txt(ctx,settings.subtitle,w/2,y,17,700,'center','#7C3AED');y+=30;}
  const details=[settings?.address,settings?.phone?`هاتف: ${settings.phone}`:'',settings?.taxNumber?`الرقم الضريبي: ${settings.taxNumber}`:''].filter(Boolean).join(' • ');
  if(details){wrapped(ctx,details,w/2,y,w-90,16,600,'center','#64748b',24,2);y+=40;}
  line(ctx,32,y,w-32,y,3,'#7C3AED');y+=38;
  if(title){txt(ctx,title,w/2,y,28,900,'center','#0f172a');y+=38;}
  if(subtitle){wrapped(ctx,subtitle,w/2,y,w-100,16,600,'center','#64748b',23,2);y+=38;}
  return y;
}

function columnWeights(headers){return headers.map(h=>{const s=normalize(h);if(/الصنف|البيان|الملاحظ|التفاصيل|العنوان|الاسم/.test(s))return 1.7;if(/التاريخ|الحساب|الجهة|العميل|المورد/.test(s))return 1.25;if(/^#|رقم|النوع|الوحدة|الكمية/.test(s))return .85;return 1;});}
function tableColumnGeometry(headers,x,w){const weights=columnWeights(headers),sum=weights.reduce((a,b)=>a+b,0);const widths=weights.map(v=>w*v/sum);let cursor=x+w;const cols=[];for(let i=0;i<widths.length;i++){cols.push({right:cursor,width:widths[i],center:cursor-widths[i]/2});cursor-=widths[i];}return cols;}
function cellLines(ctx,v,width,fontSize,header=false){return wrap(ctx,v,Math.max(20,width-16),fontSize,header?800:600,header?2:Infinity);}
function rowHeight(ctx,row,cols,fontSize,min=58){let maxLines=1;row.forEach((v,i)=>{maxLines=Math.max(maxLines,cellLines(ctx,v,cols[i]?.width||80,fontSize,false).length)});return Math.max(min,22+maxLines*(fontSize+8));}
function drawTable(ctx,{x,y,w,headers,rows,fontSize=19,headH=60,alternate=true,maxRows=null,plainHeader=false}){
  const data=maxRows==null?rows:rows.slice(0,maxRows);const cols=tableColumnGeometry(headers,x,w);roundedRect(ctx,x,y,w,headH,7,plainHeader?'#fff':'#7C3AED',plainHeader?'#cbd5e1':'#6D28D9',1.2);
  headers.forEach((h,i)=>{const ls=cellLines(ctx,h,cols[i].width,fontSize,true);const start=y+headH/2-(ls.length-1)*(fontSize+5)/2;ls.forEach((s,j)=>txt(ctx,s,cols[i].center,start+j*(fontSize+5),fontSize,900,'center',plainHeader?'#111':'#fff'));});
  let cy=y+headH;const heights=[];data.forEach(r=>heights.push(rowHeight(ctx,r,cols,fontSize,56)));
  data.forEach((r,ri)=>{const rh=heights[ri];ctx.fillStyle=alternate&&ri%2?'#f5f0ff':'#fff';ctx.fillRect(x,cy,w,rh);line(ctx,x,cy,x+w,cy,1,'#e2e8f0');r.forEach((v,i)=>{const ls=cellLines(ctx,v,cols[i].width,fontSize,false);const start=cy+rh/2-(ls.length-1)*(fontSize+7)/2;ls.forEach((s,j)=>txt(ctx,s,cols[i].center,start+j*(fontSize+7),fontSize,600,'center','#0f172a'));});cy+=rh;});
  line(ctx,x,cy,x+w,cy,1.2,'#cbd5e1');let edge=x+w;for(let i=0;i<cols.length;i++){line(ctx,edge,y,edge,cy,1,'#cbd5e1');edge-=cols[i].width;}line(ctx,x,y,x,cy,1,'#cbd5e1');return cy;
}

export async function renderTableCanvas({title='تقرير',subtitle='',headers=[],rows=[],settings={},orientation='landscape',pageNote=''}){
  try{await document.fonts?.ready;}catch(_){}
  settings=documentBrandSettings(settings);
  const w=orientation==='landscape'?1600:1120;const ctxProbe=document.createElement('canvas').getContext('2d');const cols=tableColumnGeometry(headers,48,w-96);const fs=headers.length>9?16:headers.length>7?17:19;let bodyH=0;(rows||[]).forEach(r=>bodyH+=rowHeight(ctxProbe,r,cols,fs,56));const probe=createCanvas(w,800);const brandEnd=await drawBrand(probe.ctx,w,settings,title,subtitle,30);const h=Math.max(900,brandEnd+bodyH+220);const {canvas,ctx}=createCanvas(w,h);let y=await drawBrand(ctx,w,settings,title,subtitle,30);
  roundedRect(ctx,48,y,w-96,52,10,'#f8fafc','#e2e8f0');txt(ctx,`تاريخ التقرير: ${new Date().toLocaleString('ar-EG')}`,w-68,y+26,16,600,'right','#64748b');txt(ctx,pageNote||`عدد السجلات: ${(rows||[]).length}`,68,y+26,16,700,'left','#334155');y+=70;
  y=drawTable(ctx,{x:48,y,w:w-96,headers,rows,fontSize:fs});y+=38;txt(ctx,`تم إنشاء هذا التقرير من نظام ${settings.storeName||'كاش توب 3'}`,w/2,y,14,600,'center','#94a3b8');return canvas;
}


function drawMetricGlyph(ctx,type,cx,cy,size=34,color='#7C3AED'){
  ctx.save(); ctx.strokeStyle=color; ctx.fillStyle=color; ctx.lineWidth=Math.max(2,size*.08); ctx.lineCap='round'; ctx.lineJoin='round';
  const r=size*.42;
  if(type==='sales'){
    ctx.strokeRect(cx-r*.72,cy-r*.9,r*1.44,r*1.8); line(ctx,cx-r*.48,cy-r*.45,cx+r*.48,cy-r*.45,ctx.lineWidth,color); line(ctx,cx-r*.48,cy,cx+r*.28,cy,ctx.lineWidth,color); line(ctx,cx-r*.48,cy+r*.45,cx+r*.48,cy+r*.45,ctx.lineWidth,color);
  }else if(type==='stock'){
    ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r,cy-r*.45);ctx.lineTo(cx+r,cy+r*.55);ctx.lineTo(cx,cy+r);ctx.lineTo(cx-r,cy+r*.55);ctx.lineTo(cx-r,cy-r*.45);ctx.closePath();ctx.stroke();line(ctx,cx-r,cy-r*.45,cx,cy+.05*r,ctx.lineWidth,color);line(ctx,cx+r,cy-r*.45,cx,cy+.05*r,ctx.lineWidth,color);line(ctx,cx,cy+.05*r,cx,cy+r,ctx.lineWidth,color);
  }else if(type==='customers'){
    ctx.beginPath();ctx.arc(cx,cy-r*.42,r*.34,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(cx,cy+r*.55,r*.62,Math.PI,Math.PI*2);ctx.stroke();
  }else if(type==='suppliers'){
    ctx.strokeRect(cx-r,cy-r*.35,r*1.25,r*.75);ctx.strokeRect(cx+r*.25,cy-r*.12,r*.58,r*.52);ctx.beginPath();ctx.arc(cx-r*.52,cy+r*.55,r*.19,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(cx+r*.5,cy+r*.55,r*.19,0,Math.PI*2);ctx.stroke();
  }else if(type==='expense'){
    ctx.strokeRect(cx-r,cy-r*.62,r*2,r*1.24);ctx.beginPath();ctx.arc(cx+r*.45,cy,r*.16,0,Math.PI*2);ctx.fill();line(ctx,cx-r*.68,cy-r*.26,cx-r*.05,cy-r*.26,ctx.lineWidth,color);
  }else{
    ctx.beginPath();ctx.arc(cx,cy,r*.9,0,Math.PI*2);ctx.stroke();line(ctx,cx-r*.45,cy,cx+r*.45,cy,ctx.lineWidth,color);line(ctx,cx,cy-r*.45,cx,cy+r*.45,ctx.lineWidth,color);
  }
  ctx.restore();
}

export async function renderExecutiveReportCanvas({title='التقرير اليومي',subtitle='',metrics=[],headers=[],rows=[],settings={}}){
  try{await document.fonts?.ready;}catch(_){}
  settings=documentBrandSettings(settings);
  const w=1600, h=Math.max(1280, 760 + Math.ceil((rows||[]).length/1)*64);
  const {canvas,ctx}=createCanvas(w,h); let y=await drawBrand(ctx,w,settings,title,subtitle,30);
  const cards=(metrics||[]).slice(0,6); const gap=22, margin=48, cols=3, cardW=(w-margin*2-gap*(cols-1))/cols, cardH=142;
  for(let i=0;i<cards.length;i++){
    const m=cards[i]||{}, row=Math.floor(i/cols), col=i%cols, right=w-margin-col*(cardW+gap), left=right-cardW, cy=y+row*(cardH+gap);
    roundedRect(ctx,left,cy,cardW,cardH,18,'#ffffff','#dbe7e2',1.4);
    roundedRect(ctx,left+18,cy+22,74,74,18,'#ecfdf5','#a7f3d0',1);
    drawMetricGlyph(ctx,m.icon||'generic',left+55,cy+59,42,m.tone==='rose'?'#e11d48':m.tone==='blue'?'#2563eb':m.tone==='amber'?'#d97706':'#7C3AED');
    const textRight=right-18, textMax=Math.max(120,cardW-128);
    wrapped(ctx,m.label||'-',textRight,cy+32,textMax,16,800,'right','#64748b',22,2);
    txt(ctx,m.value||'0',textRight,cy+82,27,900,'right',m.tone==='rose'?'#be123c':m.tone==='blue'?'#1d4ed8':m.tone==='amber'?'#b45309':'#6D28D9');
    if(m.sub) wrapped(ctx,m.sub,textRight,cy+113,textMax,13,600,'right','#94a3b8',18,2);
  }
  y+=Math.ceil(Math.max(1,cards.length)/cols)*(cardH+gap)+22;
  roundedRect(ctx,margin,y,w-margin*2,50,12,'#f0fdf4','#bbf7d0');txt(ctx,'ملخص المؤشرات التفصيلية',w-margin-22,y+25,18,900,'right','#166534');txt(ctx,`تم التحديث: ${new Date().toLocaleString('ar-EG')}`,margin+22,y+25,14,700,'left','#64748b');y+=70;
  if((headers||[]).length){y=drawTable(ctx,{x:margin,y,w:w-margin*2,headers,rows:rows||[],fontSize:17,headH:58});}
  y+=34;txt(ctx,`تقرير رسمي من نظام ${settings.storeName||'كاش توب 3'}`,w/2,y,14,700,'center','#94a3b8');
  const finalH=Math.min(canvas.height,Math.ceil(y+70));if(finalH<canvas.height){const out=createCanvas(w,finalH);out.ctx.drawImage(canvas,0,0,w,finalH,0,0,w,finalH);return out.canvas;}return canvas;
}

export async function renderTablePages(args){
  const rows=args.rows||[];const per=args.orientation==='portrait'?(args.headers?.length>7?16:20):(args.headers?.length>9?14:18);const chunks=[];if(!rows.length)chunks.push([]);else for(let i=0;i<rows.length;i+=per)chunks.push(rows.slice(i,i+per));
  const out=[];for(let i=0;i<chunks.length;i++)out.push(await renderTableCanvas({...args,rows:chunks[i],pageNote:`الصفحة ${i+1} من ${chunks.length} • السجلات ${rows.length?i*per+1:0}-${Math.min(rows.length,(i+1)*per)} من ${rows.length}`}));return out;
}

function domCellText(cell){
  const control=cell?.querySelector?.('input,textarea,select');if(control){if(control.tagName==='SELECT')return control.selectedOptions?.[0]?.textContent?.trim()||control.value||'';return control.value||control.getAttribute('value')||'';}
  return normalize(cell?.innerText||cell?.textContent||'');
}
export function extractTableModel(target,options={}){
  const el=resolveExportElement(target);if(!el)return null;const table=el.matches?.('table')?el:el.querySelector?.('table');if(!table)return null;
  const headCells=Array.from(table.querySelectorAll('thead th'));const hidden=[];headCells.forEach((th,i)=>{const s=normalize(th.textContent);if(!s||/إجراء|اجراء|actions?|تالف/i.test(s))hidden.push(i);});
  let headers=headCells.filter((_,i)=>!hidden.includes(i)).map(x=>normalize(x.textContent));if(!headers.length){const first=table.querySelector('tr');headers=Array.from(first?.cells||[]).filter((_,i)=>!hidden.includes(i)).map((_,i)=>`عمود ${i+1}`);}
  const rows=Array.from(table.querySelectorAll('tbody tr')).map(tr=>Array.from(tr.cells||[]).filter((_,i)=>!hidden.includes(i)).map(domCellText)).filter(r=>r.some(Boolean));
  const screen=el.closest?.('[id$="-screen"], [id$="-view-container"]')||el.parentElement;const title=options.title||screen?.querySelector?.('h2,h3')?.textContent?.trim()||document.title||'تقرير';return{title,subtitle:options.subtitle||'',headers,rows,settings:documentBrandSettings(options.settings||{}),orientation:options.orientation||'landscape'};
}

export async function renderElementTableCanvas(target,options={}){const model=extractTableModel(target,options);return model?renderTableCanvas(model):null;}
export async function renderElementTablePages(target,options={}){const model=extractTableModel(target,options);return model?renderTablePages(model):[];}

function drawPair(ctx,label,value,w,y,margin,font=19){txt(ctx,label,w-margin,y,font,700,'right','#64748b');wrapped(ctx,value,margin,y,w-margin*2-150,font,800,'left','#0f172a',font+9,2);return y+42;}
function drawBarcode(ctx,value,x,y,w,h){const g=code128Geometry(String(value||''));const unit=w/g.width;ctx.fillStyle='#000';g.rects.forEach(r=>ctx.fillRect(x+r.x*unit,y,r.width*unit,h));txt(ctx,g.text,x+w/2,y+h+18,14,600,'center','#111');}

export async function renderInvoiceCanvas(invoice,settings={},options={}){
  try{await document.fonts?.ready;}catch(_){}settings={...documentBrandSettings(settings),subtitle:"",invoiceBrand:true};
  const paper=options.paperSize||settings.printerWidth||'80mm';const w=paper==='58mm'?720:paper==='a4'?1240:940;const margin=paper==='58mm'?28:paper==='a4'?62:40;const items=invoice?.items||[];const fs=paper==='a4'?25:28;const headers=['#','الصنف','الوحدة','الكمية','السعر','الإجمالي'];const rows=items.map((it,i)=>[i+1,it.productName||'صنف',it.unitName||'-',num(it.quantity),money(it.unitPrice),money(it.total)]);const probe=document.createElement('canvas').getContext('2d');const cols=tableColumnGeometry(headers,margin,w-margin*2);const est=1350+rows.reduce((sum,row)=>sum+rowHeight(probe,row,cols,fs,56),0);const {canvas,ctx}=createCanvas(w,Math.max(paper==='a4'?1500:1180,est));
  let y=await drawBrand(ctx,w,settings,options.title||(options.kind==='purchase'?'فاتورة مشتريات':invoice?.type==='return'?'فاتورة مرتجع مبيعات':'فاتورة مبيعات'),'',28);
  const party=options.kind==='purchase'?(invoice?.supplierName||'مورد'):(invoice?.customerName||'زبون عام');
  roundedRect(ctx,margin,y,w-margin*2,150,12,'#f8fafc','#e2e8f0');y+=30;txt(ctx,`رقم الفاتورة: #${invoice?.invoiceNumber||'-'}`,w-margin-16,y,20,900,'right');txt(ctx,dateText(invoice?.date),margin+16,y,17,600,'left','#475569');y+=42;txt(ctx,options.kind==='purchase'?`المورد: ${party}`:`العميل: ${party}`,w-margin-16,y,19,800,'right');txt(ctx,options.kind==='purchase'?`المخزن: ${invoice?.warehouseName||'-'}`:`الكاشير: ${invoice?.cashierName||'-'}`,margin+16,y,17,700,'left');y+=63;
  y=drawTable(ctx,{x:margin,y,w:w-margin*2,headers,rows,fontSize:fs,headH:70,plainHeader:true});y+=28;
  const totals=[['المجموع',invoice?.subtotal],...(num(invoice?.discountTotal)>0?[['الخصم',-num(invoice.discountTotal)]]:[]),...(num(invoice?.taxTotal)>0?[['الضريبة',invoice.taxTotal]]:[]),['الصافي المطلوب',invoice?.grandTotal],['المدفوع',invoice?.paidAmount],...(num(invoice?.remainingAmount)>0?[['المتبقي',invoice.remainingAmount]]:[])];
  totals.forEach(([k,v],i)=>{roundedRect(ctx,w-margin-430,y,430,42,8,i===totals.length-3?'#ecfdf5':'#fff','#e2e8f0');txt(ctx,`${k}:`,w-margin-18,y+21,18,i===totals.length-3?900:700,'right','#334155');txt(ctx,`${money(v)} ${settings.currencySymbol||''}`,w-margin-410,y+21,19,900,'left',num(v)<0?'#dc2626':'#0f172a');y+=48;});
  if(invoice?.notes){y+=10;roundedRect(ctx,margin,y,w-margin*2,80,10,'#f8fafc','#e2e8f0');txt(ctx,'ملاحظات:',w-margin-16,y+24,16,800,'right','#64748b');wrapped(ctx,invoice.notes,w-margin-16,y+52,w-margin*2-32,16,600,'right','#334155',23,2);y+=96;}
  if(settings?.receiptShowBarcode!==false){const bw=Math.min(520,w-margin*2-80);drawBarcode(ctx,invoice?.invoiceNumber||'',(w-bw)/2,y+14,bw,58);y+=112;}
  txt(ctx,settings?.receiptFooterMessage||'شكراً لتعاملكم معنا',w/2,y+16,17,700,'center','#475569');y+=40;wrapped(ctx,'برنامج كاش توب المحاسبي جوال 0597603119',margin,y,w-margin*2,20,700,'left','#475569',28,2);y+=38;
  const finalH=Math.min(canvas.height,Math.ceil(y+45));if(finalH<canvas.height){const out=createCanvas(w,finalH);out.ctx.drawImage(canvas,0,0,w,finalH,0,0,w,finalH);return out.canvas;}return canvas;
}

export async function renderVoucherCanvas(voucher,settings={},options={}){
  try{await document.fonts?.ready;}catch(_){}settings=documentBrandSettings(settings);const paper=options.paperSize||settings.printerWidth||'80mm';const w=paper==='58mm'?720:paper==='a4'?1240:940;const margin=paper==='58mm'?34:paper==='a4'?74:46;const {canvas,ctx}=createCanvas(w,paper==='a4'?1380:1050);let y=await drawBrand(ctx,w,settings,voucher?.type==='receipt'?'سند قبض مالي':'سند صرف مالي','',30);
  roundedRect(ctx,margin,y,w-margin*2,100,12,voucher?.type==='receipt'?'#ecfdf5':'#fffbeb',voucher?.type==='receipt'?'#a7f3d0':'#fde68a');txt(ctx,`رقم السند: #${voucher?.voucherNumber||'-'}`,w/2,y+32,22,900,'center');txt(ctx,dateText(voucher?.date),w/2,y+70,17,600,'center','#64748b');y+=132;
  y=drawPair(ctx,voucher?.type==='receipt'?'استلمنا من:':'صرفنا إلى:',voucher?.partyName||'-',w,y,margin);y=drawPair(ctx,voucher?.type==='receipt'?'في حساب:':'من حساب:',voucher?.sourceType==='account'?(voucher?.accountName||'حساب مالي'):'بدون حساب',w,y,margin);
  roundedRect(ctx,margin,y,w-margin*2,92,12,'#f8fafc','#cbd5e1');txt(ctx,'المبلغ:',w-margin-18,y+46,22,900,'right','#334155');txt(ctx,`${money(voucher?.amount)} ${settings.currencySymbol||''}`,margin+18,y+46,30,900,'left','#6D28D9');y+=118;
  if(voucher?.notes){roundedRect(ctx,margin,y,w-margin*2,112,10,'#fff','#e2e8f0');txt(ctx,'البيان والملاحظات:',w-margin-16,y+26,17,800,'right','#64748b');wrapped(ctx,voucher.notes,w-margin-16,y+58,w-margin*2-32,18,700,'right','#0f172a',28,3);y+=136;}
  line(ctx,margin,y,w-margin,y,1.5,'#cbd5e1');y+=54;txt(ctx,'المستلم',w-margin-80,y,16,700,'center','#64748b');txt(ctx,'أمين الصندوق / الكاشير',margin+120,y,16,700,'center','#64748b');y+=70;line(ctx,w-margin-170,y,w-margin+10,y,1,'#94a3b8');line(ctx,margin+30,y,margin+210,y,1,'#94a3b8');y+=45;txt(ctx,voucher?.userName||'المدير',margin+120,y,14,600,'center','#94a3b8');txt(ctx,`نظام ${settings.storeName||'كاش توب 3'} - سند مالي رسمي`,w/2,y+60,13,600,'center','#94a3b8');const finalH=Math.ceil(y+105);const out=createCanvas(w,finalH);out.ctx.drawImage(canvas,0,0,w,finalH,0,0,w,finalH);return out.canvas;
}

function movementDate(m){const d=new Date(m?.date||m?.data?.date||m?.createdAt||0);return Number.isFinite(d.getTime())?d:new Date(0);}
export function customerMovements(customer,invoices=[],vouchers=[]){const invs=invoices.filter(i=>i.customerId===customer.id).map(i=>({kind:'invoice',date:i.date,data:i}));const vs=vouchers.filter(v=>v.partyType==='customer'&&v.partyId===customer.id).map(v=>({kind:'voucher',date:v.date,data:v}));return [...invs,...vs].sort((a,b)=>movementDate(a)-movementDate(b));}
export function customerMovementRows(customer,invoices=[],vouchers=[]){return customerMovements(customer,invoices,vouchers).map((m,i)=>{const x=m.data;if(m.kind==='invoice')return[i+1,dateText(x.date),x.type==='return'?'مرتجع مبيعات':'فاتورة مبيعات',x.invoiceNumber||'',money(x.grandTotal),money(x.paidAmount),money(x.remainingAmount)];return[i+1,dateText(x.date),x.type==='receipt'?'سند قبض':'سند صرف',x.voucherNumber||'',money(x.amount),'',''];});}

export async function renderCustomerStatementPages(customer,invoices=[],vouchers=[],settings={}){
  await document.fonts?.ready;
  settings=documentBrandSettings(settings);const model=customerStatementModel(customer,invoices,vouchers);
  const pages=[],w=1120,h=1584,x=40,widths=[42,122,132,400,110,110,124],heads=statementHeaders;let canvas,ctx,y,page=0;
  async function newPage(){if(canvas)pages.push(canvas);({canvas,ctx}=createCanvas(w,h));page++;y=await drawBrand(ctx,w,settings,'كشف حساب',`العميل: ${customer.name} • الهاتف: ${customer.phone||'-'}`,24);ctx.fillStyle='#7c3aed';ctx.fillRect(x,y,1040,44);let right=1080;heads.forEach((v,i)=>{txt(ctx,v,right-widths[i]/2,y+22,17,800,'center','#fff');right-=widths[i]});y+=44;txt(ctx,`صفحة ${page}`,w/2,h-28,15,600,'center','#64748b');}
  await newPage();
  for(let ri=0;ri<model.rows.length;ri++){
    const row=model.rows[ri];const ls=row.map((v,i)=>String(typeof v==='number'&&i>=4?money(v):v).split('\n').flatMap(t=>wrap(ctx,t,widths[i]-16,16,600,Infinity)));let offset=0;const count=Math.max(...ls.map(a=>a.length));
    while(offset<count){let capacity=Math.floor((h-70-y-20)/25);if(capacity<2){await newPage();capacity=Math.floor((h-70-y-20)/25);}const take=Math.min(capacity,count-offset),rh=take*25+20;ctx.fillStyle=ri%2?'#f5f0ff':'#fff';ctx.fillRect(x,y,1040,rh);let right=1080;
      ls.forEach((lines,i)=>{lines.slice(offset,offset+take).forEach((v,j)=>txt(ctx,v,i===3?right-8:right-widths[i]/2,y+22+j*25,16,600,i===3?'right':'center'));line(ctx,right,y,right,y+rh,1,'#d8cfe6');right-=widths[i]});line(ctx,x,y,x,y+rh,1,'#d8cfe6');line(ctx,x,y+rh,1080,y+rh,1,'#d8cfe6');y+=rh;offset+=take;if(offset<count)await newPage();
    }
  }
  pages.push(canvas);return pages;
}

export function combineCanvasesVertical(canvases,gap=22,maxHeight=12000){
  if(!canvases?.length)return null;const srcW=Math.max(...canvases.map(c=>c.width));const srcH=canvases.reduce((s,c)=>s+c.height,0)+gap*(canvases.length-1);const scale=srcH>maxHeight?maxHeight/srcH:1;const w=Math.max(1,Math.round(srcW*scale)),h=Math.max(1,Math.round(srcH*scale));const {canvas,ctx}=createCanvas(w,h);let y=0;for(const c of canvases){const dw=Math.round(c.width*scale),dh=Math.round(c.height*scale),x=Math.round((w-dw)/2);ctx.drawImage(c,x,Math.round(y),dw,dh);y+=dh+gap*scale;}return canvas;
}
