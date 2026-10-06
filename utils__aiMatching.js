const normalizeArabic = (value='') => String(value || '')
  .toLowerCase()
  .replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
  .replace(/[ًٌٍَُِّْـ]/g,'')
  .replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  .replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[^a-z0-9\u0600-\u06ff]+/g,' ')
  .trim().replace(/\s+/g,' ');

const unitGroups = [
  ['حبه','حبة','قطعه','قطعة','pcs','pc','piece','pieces','unit','وحده','وحدة'],
  ['كرتون','كرتونه','كرتونة','carton','cartons','box','boxes','case'],
  ['باكيت','باك','بكيت','pack','packs','packet','package'],
  ['مشطاح','طبلية','طبليه','pallet','pallets'],
  ['كيلو','كيلوغرام','كغ','kg','kgs','kilogram'],
  ['غرام','جرام','غم','جم','g','gram','grams'],
  ['لتر','liter','litre','l'],
  ['مل','مليلتر','ميلي','ml','milliliter'],
  ['دزينة','درزن','dozen'],
  ['ربطه','ربطة','bundle'],
  ['كيس','sack','bag'],
  ['علبه','علبة','can','tin','jar'],
  ['شده','شدة','tray'],
];

const canonicalUnit = (name='') => {
  const n = normalizeArabic(name);
  for (let i=0;i<unitGroups.length;i++) if (unitGroups[i].some(x => n === normalizeArabic(x) || n.includes(normalizeArabic(x)))) return i;
  return n;
};

const tokenize = s => new Set(normalizeArabic(s).split(' ').filter(Boolean));
const tokenScore = (a,b) => {
  const A=tokenize(a), B=tokenize(b); if (!A.size || !B.size) return 0;
  let inter=0; A.forEach(x=>{if(B.has(x)) inter++;});
  return (2*inter)/(A.size+B.size);
};

const editDistance = (a,b) => {
  a=normalizeArabic(a); b=normalizeArabic(b);
  const dp=Array(b.length+1).fill(0).map((_,i)=>i);
  for(let i=1;i<=a.length;i++){
    let prev=dp[0]; dp[0]=i;
    for(let j=1;j<=b.length;j++){
      const tmp=dp[j];
      dp[j]=Math.min(dp[j]+1,dp[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));
      prev=tmp;
    }
  }
  return dp[b.length];
};
const stringScore = (a,b) => {
  const A=normalizeArabic(a), B=normalizeArabic(b); if(!A||!B) return 0;
  if(A===B) return 1;
  if(A.includes(B)||B.includes(A)) return 0.88;
  const max=Math.max(A.length,B.length)||1;
  return Math.max(tokenScore(A,B),1-(editDistance(A,B)/max));
};

export const findBestSupplier = (name, suppliers=[]) => {
  if(!name) return null;
  let best=null;
  suppliers.forEach(s=>{const score=stringScore(name,s?.name||'');if(!best||score>best.score)best={supplier:s,score};});
  return best && best.score>=0.58 ? best : null;
};

export const findBestProduct = (name, products=[], barcode='') => {
  const wantedBarcode=String(barcode||'').replace(/\s+/g,'').trim();
  if(!name && !wantedBarcode) return null;
  let best=null;
  products.forEach(p=>{
    const unitBarcodes=(p?.units||[]).flatMap(u=>[...(Array.isArray(u?.barcodes)?u.barcodes:[]),u?.barcode]).filter(Boolean).map(x=>String(x).replace(/\s+/g,''));
    const directBarcode=wantedBarcode && unitBarcodes.includes(wantedBarcode);
    const candidates=[p?.name,p?.sku,p?.internalCode,...(p?.aliases||[])].filter(Boolean);
    const textScore=name ? Math.max(0,...candidates.map(c=>stringScore(name,c))) : 0;
    const score=directBarcode ? 1 : textScore;
    if(!best||score>best.score)best={product:p,score};
  });
  return best && best.score>=0.52 ? best : null;
};

export const findBestUnit = (name, product) => {
  const units=Array.isArray(product?.units)?product.units:[];
  if(!units.length) return null;
  const target=canonicalUnit(name);
  let best=null;
  units.forEach(u=>{
    const can=canonicalUnit(u?.name||'');
    let score = can===target ? 1 : stringScore(name,u?.name||'');
    if(!best||score>best.score)best={unit:u,score};
  });
  return best && best.score>=0.5 ? best : {unit:units[0],score:0.25};
};

export const normalizeUnitMeaning = canonicalUnit;
export const similarityScore = stringScore;
