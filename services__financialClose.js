export const fiscalStores=['invoices','purchases','vouchers','expenses','stock_movements','transfers','audit_logs','partner_statements','shifts','held_invoices','waste_records','restaurant_orders'];
export const fiscalMasters=['customers','suppliers','accounts','products','stock','warehouses','categories'];
const n=x=>Number.isFinite(Number(x))?Number(x):0;
export function buildFinancialClose({settings,data,name,startDate,closedName,user={},stamp=new Date().toISOString()}){
 const years=settings.financialYears||[];const oldId=settings.activeFinancialYearId||years.find(y=>y.status==='open')?.id||'fy-initial';const legacyId=years[0]?.id||oldId;const old=years.find(y=>y.id===oldId)||{id:oldId,name:'المجموعة السابقة'};
 if(old.status==='closed')throw Error('هذه المجموعة مؤرشفة بالفعل');
 const closeName=String(closedName||old.name||'').trim();if(!closeName)throw Error('اكتب اسم المجموعة المالية');
 const date=new Date(`${startDate}T00:00:00`);if(!Number.isFinite(date.getTime())||(old.startDate&&date<new Date(old.startDate)))throw Error('تاريخ بداية المجموعة غير صحيح');
 if((data.held_invoices||[]).some(x=>!x.deletedAt&&(x.financialYearId||legacyId)===oldId))throw Error('أكمل أو ألغِ الفواتير المعلقة قبل إغلاق المجموعة');
 if((data.shifts||[]).some(x=>!x.deletedAt&&x.status==='open'))throw Error('أغلق الوردية وسجّل النقد الفعلي قبل إغلاق المجموعة');
 if((data.restaurant_orders||[]).some(x=>!x.deletedAt&&(x.financialYearId||legacyId)===oldId&&!['paid','completed','cancelled','closed'].includes(x.status)))throw Error('أكمل طلبات المطعم المفتوحة قبل إغلاق المجموعة');
 const id='fy-'+stamp.replace(/\D/g,'');const newYear={id,name:String(name||`المجموعة ${startDate}`).trim(),startDate:date.toISOString(),status:'open',createdAt:stamp};const ops=[];const put=(storeName,value)=>ops.push({storeName,type:'put',value});
 for(const store of fiscalStores)for(const row of data[store]||[])if((row.financialYearId||legacyId)===oldId)put(store,{...row,financialYearId:oldId,financialYearArchivedAt:stamp});
 const masters=Object.fromEntries(fiscalMasters.map(s=>[s,(data[s]||[]).filter(x=>!x.deletedAt)]));
 put('audit_logs',{id:'fiscal-close-'+oldId,type:'fiscal_closing_snapshot',date:stamp,financialYearId:oldId,financialYearArchivedAt:stamp,referenceNumber:closeName,description:'لقطة أرصدة إغلاق المجموعة',masters,userId:user.id,userName:user.name});
 for(const [store,partnerType] of [['customers','customer'],['suppliers','supplier']])for(const row of masters[store]){
  const balance=n(row.balance);put('partner_statements',{id:`stmt-fy-open-${id}-${partnerType}-${row.id}`,date:newYear.startDate,financialYearId:id,type:'fiscal_opening',partnerType,partnerId:row.id,partnerName:row.name,referenceType:'FISCAL_OPENING',referenceId:id,referenceNumber:newYear.name,description:`رصيد افتتاحي من ${closeName}`,debit:partnerType==='customer'?Math.max(0,balance):Math.max(0,-balance),credit:partnerType==='customer'?Math.max(0,-balance):Math.max(0,balance),runningBalance:balance});
 }
 for(const row of masters.stock){const product=masters.products.find(p=>p.id===row.productId);put('stock_movements',{id:`mov-fy-open-${id}-${row.productId}-${row.warehouseId}`,date:newYear.startDate,financialYearId:id,productId:row.productId,productName:product?.name||'',warehouseId:row.warehouseId,warehouseName:masters.warehouses.find(w=>w.id===row.warehouseId)?.name||'',type:'opening_balance',baseQuantityChange:n(row.baseQuantity),newBaseBalance:n(row.baseQuantity),unitName:product?.baseUnitName||'',conversionFactor:1,quantityInUnit:n(row.baseQuantity),referenceId:id,referenceType:'FISCAL_OPENING'});}
 put('audit_logs',{id:'fiscal-open-'+id,type:'financial_year_opened',date:stamp,financialYearId:id,previousFinancialYearId:oldId,referenceNumber:newYear.name,description:`قيد افتتاحي من ${closeName}`,accountBalances:masters.accounts.map(a=>({id:a.id,name:a.name,balance:n(a.balance)})),masters,userId:user.id,userName:user.name});
 const closed={...old,name:closeName,status:'closed',endDate:stamp,archivedAt:stamp};const nextSettings={...settings,key:'store_config',financialYears:[...(years.length?years.map(y=>y.id===oldId?closed:y):[closed]),newYear],activeFinancialYearId:id,financialYearInitializedV48:true,settingsUpdatedAt:stamp};put('settings',nextSettings);
 return {operations:ops,newYear,nextSettings};
}
