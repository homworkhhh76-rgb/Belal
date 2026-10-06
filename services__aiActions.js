const n = (v, fallback=0) => { const x = Number(String(v ?? '').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٫،]/g,'.').replace(/٬/g,'')); return Number.isFinite(x) ? x : fallback; };
const s = (v) => String(v ?? '').trim();
const norm = (v) => s(v).toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/[^A-Za-z0-9\u0600-\u06FF]+/g,' ').replace(/\s+/g,' ').trim();
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

const UNIT_ALIASES = [
  ['حبه',['حبه','حبة','قطعه','قطعة','piece','pcs','pc']],
  ['كرتونه',['كرتونه','كرتونة','كرتون','carton','box','case']],
  ['باكيت',['باكيت','باك','pack','packet']],
  ['مشطاح',['مشطاح','طبلية','طبليه','pallet']],
  ['كيلو',['كيلو','كغ','kg','kilogram']],
  ['غرام',['غرام','جرام','g','gram']],
  ['لتر',['لتر','liter','litre','l']],
  ['مل',['مل','ml','milliliter']],
  ['دزينه',['دزينه','دزينة','dozen']],
  ['كيس',['كيس','bag']],
];
const unitKey = (v) => {
  const q = norm(v);
  for (const [k, arr] of UNIT_ALIASES) if (arr.some(x => norm(x) === q)) return k;
  return q;
};
const fuzzy = (arr, query, fields=['name']) => {
  if (!query) return null;
  const q = norm(query);
  let hit = arr.find(x => fields.some(f => norm(x?.[f]) === q));
  if (hit) return hit;
  hit = arr.find(x => fields.some(f => norm(x?.[f]).includes(q) || q.includes(norm(x?.[f]))));
  return hit || null;
};
const resolveAccount = (app, data={}) => {
  const accounts=(app.accounts||[]).filter(Boolean);
  let acc = data.accountId ? accounts.find(a=>a.id===data.accountId) : null;
  if (!acc && data.accountName) acc=fuzzy(accounts,data.accountName,['name']);
  if (!acc) acc=accounts.find(a=>a.isDefault);
  if (!acc && accounts.length===1) acc=accounts[0];
  if (!acc && accounts.length>1 && data.requireAccount!==false) throw new Error(`حدد الحساب المالي. الحسابات المتاحة: ${accounts.map(a=>a.name).join('، ')}`);
  return acc || null;
};
const resolveWarehouse = (app, data={}) => {
  const list=(app.warehouses||[]).filter(Boolean);
  return (data.warehouseId && list.find(x=>x.id===data.warehouseId)) || fuzzy(list,data.warehouseName,['name','code']) || list.find(x=>x.id===app.settings?.activeWarehouseId) || list.find(x=>x.isDefault) || list[0] || null;
};
const resolveProduct = (app, row={}) => {
  const list=(app.products||[]).filter(p=>p&&!p.deletedAt&&p.status!=='archived');
  return (row.productId && list.find(p=>p.id===row.productId)) || fuzzy(list,row.productName||row.name,['name','shortName','sku','internalCode']);
};
const resolveUnit = (product, row={}) => {
  const units=product?.units||[];
  if (!units.length) return null;
  if (row.unitId) {
    const u=units.find(x=>x.id===row.unitId); if(u)return u;
  }
  const q=unitKey(row.unitName||row.unit);
  if(q){
    const exact=units.find(u=>unitKey(u.name)===q); if(exact)return exact;
  }
  return units.find(u=>u.isDefaultSale) || units.find(u=>u.id===product.baseUnitId) || units[0];
};
const normalizeLine = (app, row={}, mode='sale') => {
  const p=resolveProduct(app,row);
  if(!p) throw new Error(`الصنف غير موجود: ${row.productName||row.name||'صنف غير محدد'}`);
  const u=resolveUnit(p,row);
  if(!u) throw new Error(`لا توجد وحدة صالحة للصنف ${p.name}`);
  const qty=Math.max(0,n(row.quantity,0));
  if(qty<=0) throw new Error(`الكمية غير صحيحة للصنف ${p.name}`);
  const priceRaw = row.unitPrice ?? row.price;
  const unitPrice = priceRaw == null || priceRaw === ''
    ? n(mode==='purchase' ? (u.costPrice ?? p.costPrice) : (u.salePrice ?? p.sellingPrice),0)
    : Math.max(0,n(priceRaw,0));
  const factor=Math.max(0.0000001,n(u.conversionToBase,1));
  return {productId:p.id,productName:p.name,unitId:u.id,unitName:u.name,quantity:qty,unitPrice,conversionFactor:factor,baseQuantity:qty*factor,total:qty*unitPrice,costPriceAtSale:n(p.costPrice,0)*factor,taxRate:n(p.taxRate,0),expiryDate:s(row.expiryDate||p.expiryDate)};
};
const cashName = (name) => ['نقدي','عميل نقدي','cash','walk in','walk-in'].includes(norm(name));

const exactByName = (arr, name) => (arr||[]).find(x=>norm(x?.name)===norm(name));
const safeText = (v, fallback='-') => s(v) || fallback;
const EMP_DEFAULT_PERMS = {canDiscount:true,canEditPrice:false,canDeleteInvoice:false,canDeleteProducts:false,canManagePurchases:false,canManageVouchers:true,canManageInventory:false,canViewReports:false,canAccessSettings:false,canAccessRestaurantTables:false,canAccessRestaurantWaiter:false,canAccessRestaurantKitchen:false,canAccessRestaurantOrders:false,canAccessRestaurantWaste:false};
const rolePreset = role => {
  const r=String(role||'cashier');
  if(r==='admin')return {roleName:'مدير عام',permissions:Object.fromEntries(Object.keys(EMP_DEFAULT_PERMS).map(k=>[k,true]))};
  if(r==='waiter')return {roleName:'جرسون',permissions:{...EMP_DEFAULT_PERMS,canManageVouchers:false,canDiscount:false,canAccessRestaurantTables:true,canAccessRestaurantWaiter:true}};
  if(r==='kitchen')return {roleName:'موظف مطبخ',permissions:{...EMP_DEFAULT_PERMS,canManageVouchers:false,canDiscount:false,canAccessRestaurantKitchen:true}};
  if(r==='accountant')return {roleName:'محاسب',permissions:{...EMP_DEFAULT_PERMS,canManagePurchases:true,canManageVouchers:true,canViewReports:true}};
  if(r==='inventory_mgr')return {roleName:'مسؤول مخزون',permissions:{...EMP_DEFAULT_PERMS,canDiscount:false,canManageVouchers:false,canManagePurchases:true,canManageInventory:true}};
  return {roleName:r==='cashier'?'كاشير':'موظف',permissions:{...EMP_DEFAULT_PERMS}};
};
const csvCell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
const downloadText=(content,fileName,mime='text/plain;charset=utf-8')=>{
  if(typeof document==='undefined')return false;
  const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); return true;
};
const toCsv=(rows)=>{
  const list=Array.isArray(rows)?rows:[]; if(!list.length)return 'لا توجد بيانات';
  const keys=[...new Set(list.flatMap(r=>Object.keys(r||{})))];
  return '\ufeff'+[keys.map(csvCell).join(','),...list.map(r=>keys.map(k=>csvCell(typeof r?.[k]==='object'?JSON.stringify(r[k]):r?.[k])).join(','))].join('\n');
};
const findRestaurantItem=(list,data={},fields=['name'])=> (data.id&&(list||[]).find(x=>x.id===data.id)) || fuzzy(list||[],data.name||data.tableNumber||data.orderNumber||data.customerName,fields);

const buildProduct = (app, data={}) => {
  const name=s(data.name); if(!name)throw new Error('اسم الصنف مطلوب');
  const srcUnits=Array.isArray(data.units)&&data.units.length?data.units:[{name:'حبة',factor:1}];
  const sorted=[...srcUnits].map((u,i)=>({ ...u, factor:Math.max(1,n(u.factor ?? u.conversionToBase, i===0?1:1)) })).sort((a,b)=>a.factor-b.factor);
  if(sorted[0].factor!==1) sorted.unshift({name:'حبة',factor:1});
  const now=Date.now();
  const units=[];
  for(let i=0;i<sorted.length;i++){
    const src=sorted[i];
    const prev=units[i-1];
    const uid=`u-ai-${now}-${i}`;
    const factor=Math.max(1,n(src.factor, i===0?1:(prev?.conversionToBase||1)));
    const multiplier=i===0?1:Math.max(1,factor/Math.max(1,prev?.conversionToBase||1));
    units.push({id:uid,name:s(src.name)||`وحدة ${i+1}`,childUnitId:i===0?null:prev.id,multiplier,conversionToBase:factor,barcodes:Array.isArray(src.barcodes)?src.barcodes.map(s).filter(Boolean):[],salePrice:Math.max(0,n(src.salePrice, i===0?data.sellingPrice:0)),wholesalePrice:Math.max(0,n(src.wholesalePrice,0)),costPrice:Math.max(0,n(src.costPrice, i===0?data.costPrice:0)),openingQuantity:0,isDefaultSale:i===0});
  }
  const openingRows=[];
  for(const r of (Array.isArray(data.openingStock)?data.openingStock:[])){
    const key=unitKey(r.unitName||r.unit); const u=units.find(x=>unitKey(x.name)===key) || units[0]; const q=Math.max(0,n(r.quantity,0));
    if(q>0) openingRows.push({unitId:u.id,unitName:u.name,quantity:q,conversionToBase:u.conversionToBase||1,baseQuantity:q*(u.conversionToBase||1)});
  }
  const openingBaseQuantity=openingRows.reduce((a,b)=>a+b.baseQuantity,0);
  const category = fuzzy(app.categories||[],data.categoryName,['name']) || (app.categories||[])[0];
  return {id:id('prod-ai'),name,shortName:s(data.shortName),sku:s(data.sku),internalCode:s(data.internalCode)||String((app.products||[]).length+1001),categoryId:category?.id||'',brand:s(data.brand),costPrice:Math.max(0,n(data.costPrice,units[0]?.costPrice||0)),sellingPrice:Math.max(0,n(data.sellingPrice,units[0]?.salePrice||0)),reorderPoint:Math.max(0,n(data.reorderPoint,10)),expiryDate:s(data.expiryDate),taxRate:Math.max(0,n(data.taxRate,0)),status:'active',salesChannel:data.salesChannel||'both',baseUnitId:units[0].id,baseUnitName:units[0].name,units,openingBaseQuantity,openingUnitBreakdown:openingRows,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
};

const executeOne = async (app, action, extra={}) => {
  const type=action?.type; const data=action?.data||{}; const restaurant=extra?.restaurant;
  if(type==='navigate'){ if(data.tab)app.setActiveTab?.(data.tab); return `تم فتح ${data.tab||'الشاشة'}`; }
  if(type==='create_product'){
    const existing=(app.products||[]).filter(x=>!x.deletedAt).find(x=>norm(x.name)===norm(data.name)||(s(data.sku)&&norm(x.sku)===norm(data.sku)));
    if(existing) return `تم تجاوز الصنف ${existing.name} لأنه موجود مسبقاً`;
    const p=buildProduct(app,data); await app.saveProduct?.(p); return `تمت إضافة الصنف ${p.name}`;
  }
  if(type==='update_product'){
    const p=(data.id&&(app.products||[]).find(x=>x.id===data.id))||fuzzy(app.products||[],data.name,['name','sku']); if(!p)throw new Error('الصنف المطلوب تعديله غير موجود');
    const patch=data.patch||{}; await app.saveProduct?.({...p,...patch,id:p.id,updatedAt:new Date().toISOString(),openingBaseQuantity:0,openingUnitBreakdown:[]}); return `تم تعديل الصنف ${p.name}`;
  }
  if(type==='delete_product'){
    const p=(data.id&&(app.products||[]).find(x=>x.id===data.id))||fuzzy(app.products||[],data.name,['name','sku']); if(!p)throw new Error('الصنف غير موجود'); await app.softDeleteProduct?.(p.id); return `تم حذف الصنف ${p.name}`;
  }
  if(type==='create_customer'){
    const name=s(data.name); if(!name)throw new Error('اسم العميل مطلوب');
    const active=(app.customers||[]).filter(x=>!x.deletedAt); const ex=exactByName(active,name) || (s(data.phone)&&s(data.phone)!=='-'?active.find(x=>s(x.phone)===s(data.phone)):null); if(ex)return `العميل ${ex.name} موجود مسبقاً`;
    await app.saveCustomer?.({id:id('cust-ai'),name,phone:safeText(data.phone),address:safeText(data.address),notes:safeText(data.notes),balance:n(data.balance,0),createdAt:new Date().toISOString(),deletedAt:null}); return `تمت إضافة العميل ${name}`;
  }
  if(type==='update_customer'){
    const x=(data.id&&(app.customers||[]).find(c=>c.id===data.id))||fuzzy(app.customers||[],data.name,['name','phone']); if(!x)throw new Error('العميل غير موجود'); await app.saveCustomer?.({...x,...(data.patch||{}),id:x.id}); return `تم تعديل العميل ${x.name}`;
  }
  if(type==='delete_customer'){
    const x=(data.id&&(app.customers||[]).find(c=>c.id===data.id))||fuzzy(app.customers||[],data.name,['name','phone']); if(!x)throw new Error('العميل غير موجود'); await app.deleteCustomer?.(x.id); return `تم حذف العميل ${x.name}`;
  }
  if(type==='create_supplier'){
    const name=s(data.name); if(!name)throw new Error('اسم المورد مطلوب');
    const active=(app.suppliers||[]).filter(x=>!x.deletedAt); const ex=exactByName(active,name) || (s(data.phone)&&s(data.phone)!=='-'?active.find(x=>s(x.phone)===s(data.phone)):null); if(ex)return `المورد ${ex.name} موجود مسبقاً`;
    await app.saveSupplier?.({id:id('supp-ai'),name,phone:safeText(data.phone),address:safeText(data.address),notes:safeText(data.notes),balance:n(data.balance,0),createdAt:new Date().toISOString(),deletedAt:null}); return `تمت إضافة المورد ${name}`;
  }
  if(type==='update_supplier'){
    const x=(data.id&&(app.suppliers||[]).find(c=>c.id===data.id))||fuzzy(app.suppliers||[],data.name,['name','phone']); if(!x)throw new Error('المورد غير موجود'); await app.saveSupplier?.({...x,...(data.patch||{}),id:x.id}); return `تم تعديل المورد ${x.name}`;
  }
  if(type==='delete_supplier'){
    const x=(data.id&&(app.suppliers||[]).find(c=>c.id===data.id))||fuzzy(app.suppliers||[],data.name,['name','phone']); if(!x)throw new Error('المورد غير موجود'); await app.deleteSupplier?.(x.id); return `تم حذف المورد ${x.name}`;
  }
  if(type==='create_purchase'){
    let supp=(data.supplierId&&(app.suppliers||[]).find(x=>x.id===data.supplierId))||fuzzy(app.suppliers||[],data.supplierName,['name','phone']);
    if(!supp&&s(data.supplierName)){supp={id:id('supp-ai'),name:s(data.supplierName),phone:safeText(data.supplierPhone),address:'-',notes:'-',balance:0,createdAt:new Date().toISOString(),deletedAt:null};await app.saveSupplier?.(supp);}
    if(!supp)throw new Error('المورد غير محدد');
    const wh=resolveWarehouse(app,data); if(!wh)throw new Error('لا يوجد مخزن صالح');
    const items=(data.items||[]).map(r=>normalizeLine(app,r,'purchase')); if(!items.length)throw new Error('لا توجد أصناف في فاتورة المشتريات');
    const subtotal=items.reduce((a,b)=>a+b.total,0); const discType=data.discountType||'fixed'; const discVal=Math.max(0,n(data.discountValue,0)); const discount=discType==='percent'?subtotal*Math.min(100,discVal)/100:Math.min(subtotal,discVal); const total=Math.max(0,subtotal-discount);
    const paid=Math.max(0,Math.min(total,n(data.paidAmount,0))); let acc=null; if(paid>0)acc=resolveAccount(app,{...data,requireAccount:true});
    const payments=paid>0?[{method:acc?.type==='cash'?'cash':'account',amount:paid,accountId:acc.id,accountName:acc.name}]:[];
    const res=await app.createPurchaseInvoice?.({supplierId:supp.id,supplierName:supp.name,supplierObject:supp,warehouseId:wh.id,items,paymentType:paid<=0?'debt':paid>=total?'cash':'partial',paidAmount:paid,payments,discountType:discType,discountValue:discVal,discountAmount:discount,notes:s(data.notes)||'أضيفت عبر Cash Top AI',date:data.date||undefined,supplierInvoiceNumber:s(data.supplierInvoiceNumber||data.invoiceNumber)});
    if(!res)throw new Error('تعذر حفظ فاتورة المشتريات'); return `تم حفظ فاتورة المشتريات ${res.invoiceNumber}`;
  }
  if(type==='create_sale'){
    const items=(data.items||[]).map(r=>normalizeLine(app,r,'sale')); if(!items.length)throw new Error('لا توجد أصناف للبيع');
    const subtotal=items.reduce((a,b)=>a+(b.quantity*b.unitPrice),0); const taxTotal=items.reduce((a,b)=>a+(b.quantity*b.unitPrice*n(b.taxRate,0)/100),0); const beforeDiscount=subtotal+taxTotal; const discType=data.discountType||'fixed'; const discVal=Math.max(0,n(data.discountValue,0)); const disc=discType==='percent'?Math.min(beforeDiscount,beforeDiscount*Math.min(100,discVal)/100):Math.min(beforeDiscount,discVal); const calcTotal=Math.max(0,beforeDiscount-disc); const total=app.settings?.scaleModeEnabled?Math.round(calcTotal):calcTotal;
    const requestedName=s(data.customerName); const isCash=!requestedName||cashName(requestedName);
    let customer=null;
    if(!isCash){customer=(data.customerId&&(app.customers||[]).find(x=>x.id===data.customerId))||fuzzy(app.customers||[],requestedName,['name','phone']); if(!customer){customer={id:id('cust-ai'),name:requestedName,phone:safeText(data.customerPhone),address:'-',notes:'-',balance:0,createdAt:new Date().toISOString(),deletedAt:null};await app.saveCustomer?.(customer);}}
    let paid;
    if(data.paidAmount==null||data.paidAmount===''){ if(isCash)paid=total; else throw new Error(`حدد المبلغ المدفوع للعميل ${customer?.name||requestedName}`); } else paid=Math.max(0,Math.min(total,n(data.paidAmount,0)));
    if(isCash&&paid<total)throw new Error('الدفع الجزئي لا يمكن تسجيله على عميل نقدي. اذكر اسم العميل ليُسجل الباقي ديناً.');
    let acc=null; if(paid>0)acc=resolveAccount(app,{...data,requireAccount:true});
    const payments=paid>0?[{method:acc?.type==='cash'?'cash':'account',amount:paid,accountId:acc.id,accountName:acc.name}]:[];
    const res=await app.createSaleInvoice?.({items,customerId:customer?.id,customerObject:customer||undefined,forceCashCustomer:isCash,paymentType:paid>=total?'cash':paid<=0?'debt':'partial',paidAmount:paid,payments,notes:s(data.notes)||'أضيفت عبر Cash Top AI',invoiceDiscountType:data.discountType||'fixed',invoiceDiscountValue:n(data.discountValue,0)});
    if(!res)throw new Error('تعذر حفظ فاتورة المبيعات'); return `تم حفظ فاتورة المبيعات ${res.invoiceNumber}`;
  }
  if(type==='create_sales_return'){
    const sales=(app.invoices||[]).filter(x=>x?.type==='sale'); const original=(data.originalInvoiceId&&sales.find(x=>x.id===data.originalInvoiceId))||fuzzy(sales,data.invoiceNumber,['invoiceNumber']); if(!original)throw new Error('لم أجد فاتورة المبيعات الأصلية للمرتجع');
    const rows=[];
    for(const r of (data.items||[])){
      const p=resolveProduct(app,r); if(!p)throw new Error(`الصنف غير موجود: ${r.productName||r.name}`);
      let orig=(original.items||[]).find(x=>x.productId===p.id && (!r.unitName || unitKey(x.unitName)===unitKey(r.unitName))) || (original.items||[]).find(x=>x.productId===p.id); if(!orig)throw new Error(`الصنف ${p.name} غير موجود في الفاتورة الأصلية`);
      const qty=Math.max(0,n(r.quantity,0)); if(qty<=0||qty>n(orig.quantity,0))throw new Error(`كمية المرتجع للصنف ${p.name} يجب ألا تتجاوز ${orig.quantity} ${orig.unitName}`);
      rows.push({productId:p.id,unitId:orig.unitId,quantity:qty,unitPrice:r.unitPrice==null?n(orig.unitPrice,0):n(r.unitPrice,0)});
    }
    if(!rows.length)throw new Error('حدد أصناف المرتجع وكمياتها');
    let mode=data.refundMode; if(!mode){ mode=(original.customerId&&original.customerName&&!cashName(original.customerName))?'customer_balance':'account'; }
    let acc=null; if(mode!=='customer_balance')acc=resolveAccount(app,{accountId:data.refundAccountId,accountName:data.refundAccountName,requireAccount:true});
    const res=await app.createReturnInvoice?.({originalInvoiceId:original.id,items:rows,refundMode:mode==='customer_balance'?'customer_balance':'account',refundAccountId:acc?.id,notes:s(data.notes)||'مرتجع عبر Cash Top AI'}); if(!res)throw new Error('تعذر تسجيل المرتجع'); return `تم تسجيل المرتجع ${res.invoiceNumber}`;
  }
  if(type==='create_expense'){
    const acc=resolveAccount(app,{...data,requireAccount:true}); const amount=Math.max(0,n(data.amount,0)); if(!amount)throw new Error('مبلغ المصروف غير صحيح'); await app.recordExpense?.({amount,category:s(data.category)||'أخرى',accountId:acc.id,date:data.date||new Date().toISOString(),notes:s(data.notes)}); return `تم تسجيل المصروف ${amount}`;
  }
  if(type==='update_expense'){
    const ex=(data.id&&(app.expenses||[]).find(x=>x.id===data.id))||null; if(!ex)throw new Error('المصروف غير موجود'); const patch=data.patch||{}; const acc=resolveAccount(app,{accountId:patch.accountId||ex.accountId,accountName:patch.accountName||ex.accountName,requireAccount:true}); await app.updateExpense?.({...ex,...patch,amount:patch.amount==null?ex.amount:n(patch.amount),accountId:acc.id,accountName:acc.name}); return 'تم تعديل المصروف';
  }
  if(type==='delete_expense'){
    const ex=(data.id&&(app.expenses||[]).find(x=>x.id===data.id))||null; if(!ex)throw new Error('المصروف غير موجود'); await app.deleteExpense?.(ex.id); return 'تم حذف المصروف';
  }
  if(type==='create_voucher'){
    let party=null; if(data.partyType==='customer')party=(data.partyId&&(app.customers||[]).find(x=>x.id===data.partyId))||fuzzy(app.customers||[],data.partyName,['name','phone']); if(data.partyType==='supplier')party=(data.partyId&&(app.suppliers||[]).find(x=>x.id===data.partyId))||fuzzy(app.suppliers||[],data.partyName,['name','phone']);
    const source=data.sourceType||'account'; let acc=null; if(source==='account')acc=resolveAccount(app,{...data,requireAccount:true}); const amount=Math.max(0,n(data.amount,0)); if(!amount)throw new Error('مبلغ السند غير صحيح');
    const v=await app.createVoucher?.({type:data.type==='payment'?'payment':'receipt',partyType:data.partyType||'other',partyId:party?.id||data.partyId||'',partyName:party?.name||s(data.partyName),amount,date:data.date||new Date().toISOString(),sourceType:source,accountId:acc?.id,notes:s(data.notes)}); if(!v)throw new Error('تعذر حفظ السند'); return `تم حفظ السند رقم ${v.voucherNumber}`;
  }
  if(type==='delete_voucher'){
    const v=(data.id&&(app.vouchers||[]).find(x=>x.id===data.id)) || ((data.voucherNumber!=null)&&(app.vouchers||[]).find(x=>String(x.voucherNumber)===String(data.voucherNumber))); if(!v)throw new Error('السند غير موجود'); await app.deleteVoucher?.(v.id); return `تم حذف السند رقم ${v.voucherNumber||''}`;
  }
  if(type==='customer_payment'){
    const cust=(data.customerId&&(app.customers||[]).find(x=>x.id===data.customerId))||fuzzy(app.customers||[],data.name||data.customerName,['name','phone']); if(!cust)throw new Error('العميل غير موجود');
    const acc=resolveAccount(app,{...data,requireAccount:true}); const amount=Math.max(0,n(data.amount,0)); if(!amount)throw new Error('مبلغ الدفعة غير صحيح'); await app.recordCustomerPayment?.({customerId:cust.id,amount,accountId:acc.id,notes:s(data.notes)||'دفعة عبر Cash Top AI'}); return `تم تسجيل دفعة العميل ${cust.name}`;
  }
  if(type==='supplier_payment'){
    const supp=(data.supplierId&&(app.suppliers||[]).find(x=>x.id===data.supplierId))||fuzzy(app.suppliers||[],data.name||data.supplierName,['name','phone']); if(!supp)throw new Error('المورد غير موجود');
    const acc=resolveAccount(app,{...data,requireAccount:true}); const amount=Math.max(0,n(data.amount,0)); if(!amount)throw new Error('مبلغ الدفعة غير صحيح'); await app.recordSupplierPayment?.({supplierId:supp.id,amount,accountId:acc.id,notes:s(data.notes)||'دفعة عبر Cash Top AI'}); return `تم تسجيل دفعة المورد ${supp.name}`;
  }
  if(type==='create_account'){
    const name=s(data.name); if(!name)throw new Error('اسم الحساب مطلوب'); const ex=(app.accounts||[]).find(x=>norm(x.name)===norm(name)); if(ex)throw new Error(`الحساب ${ex.name} موجود مسبقاً`); await app.saveAccount?.({id:id('acc-ai'),name,type:data.type||'cash',balance:n(data.balance,0),isDefault:!!data.isDefault,createdAt:new Date().toISOString()}); return `تم إنشاء الحساب ${name}`;
  }
  if(type==='update_account'){
    const x=(data.id&&(app.accounts||[]).find(a=>a.id===data.id))||fuzzy(app.accounts||[],data.name,['name']); if(!x)throw new Error('الحساب غير موجود'); await app.saveAccount?.({...x,...(data.patch||{}),id:x.id}); return `تم تعديل الحساب ${x.name}`;
  }
  if(type==='delete_account'){
    const x=(data.id&&(app.accounts||[]).find(a=>a.id===data.id))||fuzzy(app.accounts||[],data.name,['name']); if(!x)throw new Error('الحساب غير موجود'); await app.deleteAccount?.(x.id); return `تم حذف الحساب ${x.name}`;
  }
  if(type==='transfer_account'){
    const list=app.accounts||[]; const from=(data.fromAccountId&&list.find(a=>a.id===data.fromAccountId))||fuzzy(list,data.fromAccountName,['name']); const to=(data.toAccountId&&list.find(a=>a.id===data.toAccountId))||fuzzy(list,data.toAccountName,['name']); if(!from||!to)throw new Error('حدد حساب المصدر وحساب الوجهة'); if(from.id===to.id)throw new Error('حساب المصدر والوجهة يجب أن يكونا مختلفين'); const amount=Math.max(0,n(data.amount,0)); if(!amount)throw new Error('مبلغ التحويل غير صحيح'); await app.transferBetweenAccounts?.(from.id,to.id,amount,s(data.notes)||'تحويل عبر Cash Top AI'); return `تم التحويل من ${from.name} إلى ${to.name}`;
  }
  if(type==='create_category'){
    const name=s(data.name); if(!name)throw new Error('اسم التصنيف مطلوب'); const ex=(app.categories||[]).find(x=>norm(x.name)===norm(name)); if(ex)return `التصنيف ${ex.name} موجود مسبقاً`; await app.saveCategory?.({id:id('cat-ai'),name,createdAt:new Date().toISOString()}); return `تم إنشاء التصنيف ${name}`;
  }
  if(type==='update_category'){
    const x=(data.id&&(app.categories||[]).find(c=>c.id===data.id))||fuzzy(app.categories||[],data.name,['name']); if(!x)throw new Error('التصنيف غير موجود'); await app.saveCategory?.({...x,...(data.patch||{}),id:x.id}); return `تم تعديل التصنيف ${x.name}`;
  }
  if(type==='delete_category'){
    const x=(data.id&&(app.categories||[]).find(c=>c.id===data.id))||fuzzy(app.categories||[],data.name,['name']); if(!x)throw new Error('التصنيف غير موجود'); await app.deleteCategory?.(x.id); return `تم حذف التصنيف ${x.name}`;
  }
  if(type==='create_warehouse'){
    const name=s(data.name); if(!name)throw new Error('اسم المخزن مطلوب'); const ex=(app.warehouses||[]).find(x=>norm(x.name)===norm(name)); if(ex)return `المخزن ${ex.name} موجود مسبقاً`; await app.saveWarehouse?.({id:id('wh-ai'),name,code:s(data.code)||`WH-${Date.now().toString().slice(-4)}`,isDefault:!!data.isDefault,createdAt:new Date().toISOString()}); return `تم إنشاء المخزن ${name}`;
  }
  if(type==='update_warehouse'){
    const x=(data.id&&(app.warehouses||[]).find(w=>w.id===data.id))||fuzzy(app.warehouses||[],data.name,['name','code']); if(!x)throw new Error('المخزن غير موجود'); await app.saveWarehouse?.({...x,...(data.patch||{}),id:x.id}); return `تم تعديل المخزن ${x.name}`;
  }
  if(type==='delete_warehouse'){
    const x=(data.id&&(app.warehouses||[]).find(w=>w.id===data.id))||fuzzy(app.warehouses||[],data.name,['name','code']); if(!x)throw new Error('المخزن غير موجود'); await app.deleteWarehouse?.(x.id); return `تم حذف المخزن ${x.name}`;
  }
  if(type==='delete_invoice'){
    const inv=(data.id&&(app.invoices||[]).find(x=>x.id===data.id))||fuzzy(app.invoices||[],data.invoiceNumber,['invoiceNumber']); if(!inv)throw new Error('الفاتورة غير موجودة'); await app.deleteInvoice?.(inv.id); return `تم حذف الفاتورة ${inv.invoiceNumber}`;
  }
  if(type==='delete_purchase'){
    const inv=(data.id&&(app.purchases||[]).find(x=>x.id===data.id))||fuzzy(app.purchases||[],data.invoiceNumber,['invoiceNumber','supplierInvoiceNumber']); if(!inv)throw new Error('فاتورة المشتريات غير موجودة'); await app.deletePurchase?.(inv.id); return `تم حذف فاتورة المشتريات ${inv.invoiceNumber}`;
  }
  if(type==='adjust_stock'){
    const p=resolveProduct(app,data); if(!p)throw new Error('الصنف غير موجود'); const wh=resolveWarehouse(app,data); if(!wh)throw new Error('المخزن غير موجود'); const u=resolveUnit(p,data); const factor=n(u?.conversionToBase,1); const qty=Math.max(0,n(data.quantity,0)); const current=n(app.getProductStock?.(p.id,wh.id),0); const baseQty=qty*factor; const target=data.mode==='delta'?Math.max(0,current+baseQty):baseQty; await app.adjustStock?.(p.id,wh.id,target,s(data.reason)||'تسوية عبر Cash Top AI'); return `تم تعديل مخزون ${p.name}`;
  }
  if(type==='transfer_stock'){
    const p=resolveProduct(app,data); if(!p)throw new Error('الصنف غير موجود'); const from=(app.warehouses||[]).find(x=>x.id===data.fromWarehouseId)||fuzzy(app.warehouses||[],data.fromWarehouseName,['name']); const to=(app.warehouses||[]).find(x=>x.id===data.toWarehouseId)||fuzzy(app.warehouses||[],data.toWarehouseName,['name']); if(!from||!to)throw new Error('حدد مخزن المصدر والوجهة'); const u=resolveUnit(p,data); await app.transferStock?.(p.id,from.id,to.id,u,Math.max(0,n(data.quantity,0)),s(data.notes)||'تحويل عبر Cash Top AI'); return `تم تحويل ${p.name}`;
  }

  if(type==='restore_product'){ const p=(data.id&&(app.products||[]).find(x=>x.id===data.id))||fuzzy(app.products||[],data.name,['name','sku']); if(!p)throw new Error('الصنف غير موجود'); await app.restoreProduct?.(p.id); return `تم استعادة الصنف ${p.name}`; }
  if(type==='restore_customer'){ const x=(data.id&&(app.customers||[]).find(c=>c.id===data.id))||fuzzy(app.customers||[],data.name,['name','phone']); if(!x)throw new Error('العميل غير موجود'); await app.restoreCustomer?.(x.id); return `تم استعادة العميل ${x.name}`; }
  if(type==='restore_supplier'){ const x=(data.id&&(app.suppliers||[]).find(c=>c.id===data.id))||fuzzy(app.suppliers||[],data.name,['name','phone']); if(!x)throw new Error('المورد غير موجود'); await app.restoreSupplier?.(x.id); return `تم استعادة المورد ${x.name}`; }
  if(type==='restore_expense'){ const x=(data.id&&(app.expenses||[]).find(e=>e.id===data.id)); if(!x)throw new Error('المصروف غير موجود'); await app.restoreExpense?.(x.id); return 'تم استعادة المصروف'; }
  if(type==='update_settings'){
    const patch={...(data.patch||{})};
    for(const bad of ['__proto__','prototype','constructor','apiKey','ai','activation','token']) delete patch[bad];
    if(!Object.keys(patch).length && data.useAttachedImageForLogo) throw new Error('أرفق صورة الشعار');
    if(!Object.keys(patch).length) throw new Error('لا يوجد إعداد مطلوب تغييره');
    await app.updateSettings?.(patch);
    return 'تم تحديث إعدادات النظام';
  }
  if(type==='create_employee'){
    const name=s(data.name); if(!name)throw new Error('اسم الموظف مطلوب'); const ex=exactByName(app.employees||[],name); if(ex)return `الموظف ${ex.name} موجود مسبقاً`;
    const role=data.role||'cashier',preset=rolePreset(role); const employee={id:id('emp-ai'),name,phone:safeText(data.phone),role,roleName:s(data.roleName)||preset.roleName,pin:s(data.pin)||undefined,permissions:{...preset.permissions,...(data.permissions||{})},active:data.active!==false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; await app.saveEmployee?.(employee); return `تمت إضافة الموظف ${name}`;
  }
  if(type==='update_employee'){
    const x=(data.id&&(app.employees||[]).find(e=>e.id===data.id))||fuzzy(app.employees||[],data.name,['name','phone']); if(!x)throw new Error('الموظف غير موجود'); const patch=data.patch||{}; const preset=patch.role?rolePreset(patch.role):null; await app.saveEmployee?.({...x,...patch,...(preset?{roleName:patch.roleName||preset.roleName,permissions:{...preset.permissions,...(patch.permissions||{})}}:{}),id:x.id,updatedAt:new Date().toISOString()}); return `تم تعديل الموظف ${x.name}`;
  }
  if(type==='delete_employee'){ const x=(data.id&&(app.employees||[]).find(e=>e.id===data.id))||fuzzy(app.employees||[],data.name,['name','phone']); if(!x)throw new Error('الموظف غير موجود'); await app.deleteEmployee?.(x.id); return `تم حذف الموظف ${x.name}`; }
  if(type==='open_shift'){ await app.openShift?.(Math.max(0,n(data.openingCash,0))); return 'تم فتح الوردية'; }
  if(type==='close_shift'){ if(!app.activeShift)throw new Error('لا توجد وردية مفتوحة'); await app.closeShift?.(Math.max(0,n(data.actualCash,0)),safeText(data.notes)); return 'تم إغلاق الوردية'; }
  if(type==='sync_now'){ await app.syncPendingQueue?.(); return 'تمت المزامنة'; }
  if(type==='export_data'){
    const ds=String(data.dataset||'').toLowerCase(); let rows=[]; let title=ds||'data';
    if(ds==='sales')rows=(app.invoices||[]).filter(x=>x.type==='sale');
    else if(ds==='purchases')rows=app.purchases||[];
    else if(ds==='products')rows=(app.products||[]).filter(x=>!x.deletedAt);
    else if(ds==='customers')rows=(app.customers||[]).filter(x=>!x.deletedAt);
    else if(ds==='suppliers')rows=(app.suppliers||[]).filter(x=>!x.deletedAt);
    else if(ds==='expenses')rows=(app.expenses||[]).filter(x=>!x.deletedAt);
    else if(ds==='accounts')rows=app.accounts||[];
    else if(ds==='vouchers')rows=app.vouchers||[];
    else if(ds==='inventory')rows=(app.products||[]).filter(x=>!x.deletedAt).map(p=>({id:p.id,name:p.name,stock:n(app.getProductStock?.(p.id,app.settings?.activeWarehouseId),0),unit:p.baseUnitName,costPrice:n(p.costPrice),sellingPrice:n(p.sellingPrice)}));
    else if(ds==='restaurant_orders')rows=restaurant?.orders||[];
    else throw new Error('نوع التصدير غير معروف');
    const fmt=String(data.format||'csv').toLowerCase()==='json'?'json':'csv'; const base=s(data.fileName)||`Oscar_${title}_${new Date().toISOString().slice(0,10)}`;
    if(fmt==='json')downloadText(JSON.stringify(rows,null,2),`${base}.json`,'application/json;charset=utf-8'); else downloadText(toCsv(rows),`${base}.csv`,'text/csv;charset=utf-8');
    return `تم تصدير ${rows.length} سجل`;
  }
  if(type==='create_purchase_order'){
    const rows=(data.items||[]).map(x=>({المورد:s(data.supplierName)||'-',الصنف:s(x.productName)||s(x.name)||'-',الوحدة:s(x.unitName)||'-',الكمية:n(x.quantity,0)})); if(!rows.length)throw new Error('لا توجد أصناف في الأوردر');
    const fmt=String(data.format||'csv').toLowerCase()==='json'?'json':'csv'; const base=`اوردر_شراء_${(s(data.supplierName)||'عام').replace(/[\\/:*?\"<>|]/g,'-')}_${new Date().toISOString().slice(0,10)}`;
    if(fmt==='json')downloadText(JSON.stringify(rows,null,2),`${base}.json`,'application/json;charset=utf-8'); else downloadText(toCsv(rows),`${base}.csv`,'text/csv;charset=utf-8'); return `تم تصدير أوردر شراء ${rows.length} صنف`;
  }
  if(type==='create_restaurant_section'){ if(!restaurant?.addSection)throw new Error('وضع المطعم غير متاح'); await restaurant.addSection({...data,name:s(data.name)||'قسم جديد'}); return `تم إنشاء قسم المطعم ${s(data.name)||'جديد'}`; }
  if(type==='update_restaurant_section'){ const x=findRestaurantItem(restaurant?.sections,data,['name']); if(!x)throw new Error('قسم المطعم غير موجود'); await restaurant.updateSection?.(x.id,data.patch||data); return `تم تعديل قسم ${x.name}`; }
  if(type==='delete_restaurant_section'){ const x=findRestaurantItem(restaurant?.sections,data,['name']); if(!x)throw new Error('قسم المطعم غير موجود'); await restaurant.deleteSection?.(x.id); return `تم حذف قسم ${x.name}`; }
  if(type==='create_restaurant_table'){ if(!restaurant?.addTable)throw new Error('وضع المطعم غير متاح'); await restaurant.addTable({...data,name:s(data.name)||undefined}); return `تم إنشاء الطاولة ${data.tableNumber||data.name||''}`; }
  if(type==='update_restaurant_table'){ const x=(data.id&&(restaurant?.tables||[]).find(t=>t.id===data.id))||(restaurant?.tables||[]).find(t=>String(t.tableNumber)===String(data.tableNumber))||fuzzy(restaurant?.tables||[],data.name,['name']); if(!x)throw new Error('الطاولة غير موجودة'); await restaurant.updateTable?.(x.id,data.patch||data); return `تم تعديل الطاولة ${x.tableNumber||x.name||''}`; }
  if(type==='delete_restaurant_table'){ const x=(data.id&&(restaurant?.tables||[]).find(t=>t.id===data.id))||(restaurant?.tables||[]).find(t=>String(t.tableNumber)===String(data.tableNumber))||fuzzy(restaurant?.tables||[],data.name,['name']); if(!x)throw new Error('الطاولة غير موجودة'); await restaurant.deleteTable?.(x.id); return `تم حذف الطاولة ${x.tableNumber||x.name||''}`; }
  if(type==='create_restaurant_order'){ if(!restaurant?.createOrder)throw new Error('وضع المطعم غير متاح'); const out=await restaurant.createOrder(data); return `تم إنشاء طلب المطعم ${out?.orderNumber||''}`; }
  if(type==='update_restaurant_order'){ const x=(data.id&&(restaurant?.orders||[]).find(o=>o.id===data.id))||(restaurant?.orders||[]).find(o=>String(o.orderNumber)===String(data.orderNumber)); if(!x)throw new Error('طلب المطعم غير موجود'); await restaurant.updateOrder?.(x.id,data.patch||data); return `تم تعديل الطلب ${x.orderNumber||''}`; }
  if(type==='delete_restaurant_order'){ const x=(data.id&&(restaurant?.orders||[]).find(o=>o.id===data.id))||(restaurant?.orders||[]).find(o=>String(o.orderNumber)===String(data.orderNumber)); if(!x)throw new Error('طلب المطعم غير موجود'); await restaurant.deleteRestaurantOrder?.(x.id); return `تم حذف الطلب ${x.orderNumber||''}`; }
  if(type==='set_restaurant_order_status'){ const x=(data.id&&(restaurant?.orders||[]).find(o=>o.id===data.id))||(restaurant?.orders||[]).find(o=>String(o.orderNumber)===String(data.orderNumber)); if(!x)throw new Error('طلب المطعم غير موجود'); await restaurant.updateOrderStatus?.(x.id,data.status); return `تم تحديث حالة الطلب ${x.orderNumber||''}`; }
  if(type==='create_reservation'){ if(!restaurant?.addReservation)throw new Error('الحجوزات غير متاحة'); await restaurant.addReservation({...data,customerName:safeText(data.customerName),customerPhone:safeText(data.customerPhone)}); return `تم إنشاء الحجز ${safeText(data.customerName)}`; }
  if(type==='update_reservation'){ const x=(data.id&&(restaurant?.reservations||[]).find(r=>r.id===data.id))||fuzzy(restaurant?.reservations||[],data.customerName,['customerName']); if(!x)throw new Error('الحجز غير موجود'); await restaurant.updateReservation?.(x.id,data.patch||data); return 'تم تعديل الحجز'; }
  if(type==='delete_reservation'){ const x=(data.id&&(restaurant?.reservations||[]).find(r=>r.id===data.id))||fuzzy(restaurant?.reservations||[],data.customerName,['customerName']); if(!x)throw new Error('الحجز غير موجود'); await restaurant.deleteReservation?.(x.id); return 'تم حذف الحجز'; }
  if(type==='create_kitchen_section'){ if(!restaurant?.addKitchenSection)throw new Error('أقسام المطبخ غير متاحة'); await restaurant.addKitchenSection(data); return `تم إنشاء قسم المطبخ ${s(data.name)||''}`; }
  if(type==='update_kitchen_section'){ const x=findRestaurantItem(restaurant?.kitchenSections,data,['name']); if(!x)throw new Error('قسم المطبخ غير موجود'); await restaurant.updateKitchenSection?.(x.id,data.patch||data); return `تم تعديل قسم المطبخ ${x.name}`; }
  if(type==='delete_kitchen_section'){ const x=findRestaurantItem(restaurant?.kitchenSections,data,['name']); if(!x)throw new Error('قسم المطبخ غير موجود'); await restaurant.deleteKitchenSection?.(x.id); return `تم حذف قسم المطبخ ${x.name}`; }
  if(type==='create_waste_record'){ if(!restaurant?.addWasteRecord)throw new Error('سجل الهالك غير متاح'); await restaurant.addWasteRecord(data); return 'تم تسجيل الهالك'; }
  if(type==='save_recipe'){ if(!restaurant?.saveRecipe)throw new Error('الوصفات غير متاحة'); await restaurant.saveRecipe(data); return 'تم حفظ الوصفة'; }
  if(type==='delete_recipe'){ const x=(data.id&&(restaurant?.recipes||[]).find(r=>r.id===data.id))||fuzzy(restaurant?.recipes||[],data.productName||data.name,['productName','mealProductName']); if(!x)throw new Error('الوصفة غير موجودة'); await restaurant.deleteRecipe?.(x.id); return 'تم حذف الوصفة'; }
  throw new Error(`نوع العملية غير مدعوم بعد: ${type}`);
};

const NON_MUTATION = new Set(['navigate','export_data','create_purchase_order','sync_now']);
export const isMutationAction = (action) => Boolean(action?.type && !NON_MUTATION.has(action.type));

export const executeAIActions = async (app, input, extra={}) => {
  const actions=(Array.isArray(input)?input:[input]).filter(Boolean);
  const results=[];
  for(const a of actions) results.push(await executeOne(app,a,extra));
  return results;
};
