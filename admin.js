(() => {
  'use strict';
  const T=window.SHAHD_TURSO, PERMS=window.SHAHD_PERMISSIONS||{};
  const SESSION_KEY='shahd_admin_direct_v17';
  const ADMIN_SALT='shahd-admin-v14-static';
  const ADMIN_HASH='6e8e47c2d67f7ab172b6f4349448e062f4a9b107c966a3fff1a2a7a1aca4fa2b';
  let unlocked=sessionStorage.getItem(SESSION_KEY)==='1',companies=[];
  const $=q=>document.querySelector(q);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const now=()=>Date.now();
  const normalizeKey=v=>String(v||'').trim().toUpperCase().replace(/\s+/g,'-');
  const compactKey=v=>normalizeKey(v).replace(/[^A-Z0-9]/g,'');
  const normalizeUser=v=>String(v||'').trim().toLowerCase();
  function fmt(ms){if(!ms)return'—';try{return new Intl.DateTimeFormat('ar-PS',{dateStyle:'medium',timeStyle:'short'}).format(new Date(Number(ms)))}catch(_){return new Date(Number(ms)).toLocaleString()}}
  function toast(message,type='success'){const root=$('#toastRoot'),e=document.createElement('div');e.className=`toast ${type}`;e.innerHTML=`<div class="toast-icon">${type==='error'?'!':'✓'}</div><div><strong>${type==='error'?'تنبيه':'تم'}</strong><span>${esc(message)}</span></div>`;root.append(e);setTimeout(()=>e.remove(),4200)}
  function status(m){const e=$('#adminLoginStatus');e.textContent=m||'';e.classList.toggle('show',!!m)}
  function durationMs(base,q,u){const d=new Date(Number(base||now())),n=Math.max(1,Number(q||1));if(u==='hour')d.setHours(d.getHours()+n);else if(u==='day')d.setDate(d.getDate()+n);else if(u==='year')d.setFullYear(d.getFullYear()+n);else d.setMonth(d.getMonth()+n);return d.getTime()}
  function generateKey(){const part=()=>Math.random().toString(36).slice(2,6).toUpperCase();return `SHD-${part()}-${part()}`}
  function allManagerPermissions(){return JSON.stringify(PERMS.managerPermissions||{})}
  async function ensure(){await T.ensureSchema()}

  async function load(){
    await ensure();
    companies=await T.query(`SELECT c.id,c.company_key,c.name,c.status,c.expires_at,c.max_users,c.auth_version,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM shahd_users u WHERE u.company_id=c.id AND u.active=1) AS active_users,
      (SELECT username FROM shahd_users u WHERE u.company_id=c.id AND u.role='manager' ORDER BY u.created_at ASC LIMIT 1) AS manager_username,
      (SELECT display_name FROM shahd_users u WHERE u.company_id=c.id AND u.role='manager' ORDER BY u.created_at ASC LIMIT 1) AS manager_name
      FROM shahd_companies c ORDER BY c.created_at DESC`);
    render();
  }

  function render(){
    const active=companies.filter(c=>c.status==='active'&&Number(c.expires_at)>now()).length;
    const expired=companies.filter(c=>Number(c.expires_at)<=now()).length;
    const stopped=companies.filter(c=>c.status!=='active').length;
    const users=companies.reduce((s,c)=>s+Number(c.active_users||0),0);
    $('#adminStats').innerHTML=[['الشركات',companies.length],['نشطة',active],['موقوفة/منتهية',stopped+expired],['مستخدمون نشطون',users]].map(([l,v])=>`<div class="admin-stat"><small>${l}</small><strong>${Number(v).toLocaleString('ar')}</strong></div>`).join('');
    $('#companiesList').innerHTML=companies.length?companies.map(c=>{
      const expired=Number(c.expires_at)<=now(),statusText=expired?'منتهي':c.status==='active'?'نشط':'موقوف',statusClass=expired?'badge-red':c.status==='active'?'badge-green':'badge-amber';
      return `<article class="company-admin-card"><div class="company-admin-head"><div><h3>${esc(c.name)}</h3><span class="company-key">${esc(c.company_key)}</span><div class="manager-login-line">اسم مستخدم المدير: <strong>${esc(c.manager_username||'admin')}</strong></div></div><span class="badge ${statusClass}">${statusText}</span></div><div class="company-admin-meta"><div><small>الانتهاء</small><strong>${fmt(c.expires_at)}</strong></div><div><small>المستخدمون</small><strong>${Number(c.active_users||0)} / ${Number(c.max_users||0)}</strong></div><div><small>تاريخ الإنشاء</small><strong>${fmt(c.created_at)}</strong></div><div><small>المعرف</small><strong>${esc(String(c.id).slice(-8))}</strong></div></div><div class="company-admin-actions"><button class="btn btn-primary btn-sm" data-extend="${c.id}">تمديد</button><button class="btn ${c.status==='active'?'btn-danger-soft':'btn-primary'} btn-sm" data-toggle="${c.id}">${c.status==='active'?'إيقاف':'تشغيل'}</button><button class="btn btn-ghost btn-sm" data-edit="${c.id}">تعديل</button><button class="btn btn-ghost btn-sm" data-reset-password="${c.id}">كلمة مرور المدير</button><button class="btn btn-ghost btn-sm" data-copy="${esc(c.company_key)}">نسخ المفتاح</button><button class="btn btn-danger-soft btn-sm" data-delete-company="${c.id}">حذف المفتاح</button></div></article>`;
    }).join(''):'<div class="empty">لا توجد شركات بعد.</div>';
  }

  function showApp(){$('#adminLogin').hidden=true;$('#adminApp').hidden=false;load().catch(e=>toast(`تعذر الاتصال بقاعدة البيانات: ${e.message||e}`,'error'))}
  function modal(html){$('#adminModalRoot').innerHTML=`<div class="admin-modal-backdrop"><div class="admin-modal">${html}</div></div>`;const close=()=>$('#adminModalRoot').innerHTML='';$('.admin-modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('admin-modal-backdrop'))close()});return close}

  function showCreatedCredentials({name,key,username}){
    const close=modal(`<h3>تم إنشاء الشركة بنجاح</h3><div class="created-login-box"><div><small>الشركة</small><strong>${esc(name)}</strong></div><div><small>مفتاح الشركة</small><strong dir="ltr">${esc(key)}</strong></div><div><small>اسم مستخدم المدير</small><strong dir="ltr">${esc(username)}</strong></div><p>استخدم هذه البيانات في صفحة تسجيل الدخول مع كلمة المرور التي أدخلتها الآن.</p></div><div class="admin-modal-actions"><button class="btn btn-primary" type="button" id="createdDone">تم</button></div>`);
    $('#createdDone').onclick=close;
  }

  function extendCompany(id){const c=companies.find(x=>x.id===id);if(!c)return;const close=modal(`<h3>تمديد مفتاح ${esc(c.name)}</h3><form id="extendForm"><div class="duration-grid"><label class="field"><span>الكمية</span><input class="input" name="durationQuantity" type="number" min="1" value="1" required></label><label class="field"><span>الوحدة</span><select class="select" name="durationUnit"><option value="hour">ساعة</option><option value="day">يوم</option><option value="month" selected>شهر</option><option value="year">سنة</option></select></label></div><div class="admin-modal-actions"><button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button><button class="btn btn-primary" type="submit">تمديد وتشغيل</button></div></form>`);$('#modalCancel').onclick=close;$('#extendForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),base=Math.max(now(),Number(c.expires_at||0)),exp=durationMs(base,Number(f.get('durationQuantity')),f.get('durationUnit'));try{await T.execute(`UPDATE shahd_companies SET expires_at=?,status='active',auth_version=auth_version+1,updated_at=? WHERE id=?`,[exp,now(),id]);close();toast('تم تمديد المفتاح وتشغيله.');await load()}catch(x){toast(x.message||x,'error')}}}

  function editCompany(id){
    const c=companies.find(x=>x.id===id);if(!c)return;
    const close=modal(`<h3>تعديل الشركة</h3><form id="editCompanyForm"><label class="field"><span>اسم الشركة</span><input class="input" name="name" value="${esc(c.name)}" required></label><label class="field" style="margin-top:10px"><span>اسم مستخدم المدير</span><input class="input" name="managerUsername" value="${esc(c.manager_username||'admin')}" required></label><label class="field" style="margin-top:10px"><span>الحد الأقصى للمستخدمين</span><input class="input" name="maxUsers" type="number" min="1" max="500" value="${Number(c.max_users||10)}"></label><div class="admin-modal-actions"><button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button><button class="btn btn-primary" type="submit">حفظ</button></div></form>`);
    $('#modalCancel').onclick=close;
    $('#editCompanyForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),name=String(f.get('name')||'').trim(),username=normalizeUser(f.get('managerUsername')),maxUsers=Math.max(1,Number(f.get('maxUsers')||1));if(!name||!username){toast('أدخل اسم الشركة واسم مستخدم المدير.','error');return}try{
      const manager=(await T.query(`SELECT id FROM shahd_users WHERE company_id=? AND role='manager' ORDER BY created_at ASC LIMIT 1`,[id]))[0];if(!manager)throw new Error('لا يوجد حساب مدير لهذه الشركة.');
      const duplicate=await T.query(`SELECT id FROM shahd_users WHERE company_id=? AND LOWER(username)=? AND id<>? LIMIT 1`,[id,username,manager.id]);if(duplicate.length)throw new Error('اسم المستخدم مستخدم مسبقاً داخل الشركة.');
      const res=await T.pipelineRaw([{sql:`UPDATE shahd_companies SET name=?,max_users=?,auth_version=auth_version+1,updated_at=? WHERE id=?`,args:[name,maxUsers,now(),id]},{sql:`UPDATE shahd_users SET username=?,auth_version=auth_version+1,updated_at=? WHERE id=? AND company_id=?`,args:[username,now(),manager.id,id]}],45000);const failed=res.find(x=>!x.ok);if(failed)throw new Error(failed.error||'تعذر تحديث الشركة.');close();toast('تم تحديث الشركة واسم مستخدم المدير.');await load()
    }catch(x){toast(x.message||x,'error')}};
  }

  async function toggleCompany(id){const c=companies.find(x=>x.id===id);if(!c)return;const next=c.status==='active'?'stopped':'active';await T.execute(`UPDATE shahd_companies SET status=?,auth_version=auth_version+1,updated_at=? WHERE id=?`,[next,now(),id]);toast(next==='active'?'تم تشغيل المفتاح.':'تم إيقاف المفتاح، وستغلق الجلسات عند التحقق التالي.',next==='active'?'success':'warning');await load()}

  function resetManagerPassword(id){
    const c=companies.find(x=>x.id===id);if(!c)return;
    const close=modal(`<h3>تعيين كلمة مرور مدير ${esc(c.name)}</h3><form id="resetManagerPasswordForm"><label class="field"><span>كلمة المرور الجديدة</span><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></label><label class="field" style="margin-top:10px"><span>تأكيد كلمة المرور</span><input class="input" name="confirm" type="password" minlength="6" autocomplete="new-password" required></label><div class="admin-modal-actions"><button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button><button class="btn btn-primary" type="submit">حفظ كلمة المرور</button></div></form>`);
    $('#modalCancel').onclick=close;
    $('#resetManagerPasswordForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),password=String(f.get('password')||''),confirm=String(f.get('confirm')||'');if(password.length<6){toast('كلمة المرور يجب أن تكون 6 أحرف على الأقل.','error');return}if(password!==confirm){toast('تأكيد كلمة المرور غير مطابق.','error');return}try{const managers=await T.query(`SELECT id,username FROM shahd_users WHERE company_id=? AND role='manager' ORDER BY created_at ASC LIMIT 1`,[id]);if(!managers.length)throw new Error('لا يوجد مستخدم مدير لهذه الشركة.');const salt=T.salt(),hash=await T.hashPassword(password,salt);await T.execute(`UPDATE shahd_users SET password_hash=?,password_salt=?,active=1,auth_version=auth_version+1,updated_at=? WHERE id=? AND company_id=?`,[hash,salt,now(),managers[0].id,id]);close();toast(`تم تحديث كلمة مرور المدير (${managers[0].username}).`);await load()}catch(x){toast(x.message||x,'error')}};
  }

  function deleteCompany(id){
    const c=companies.find(x=>x.id===id);if(!c)return;
    const close=modal(`<h3>حذف مفتاح الشركة نهائياً</h3><p style="font-size:11px;line-height:1.9;color:var(--muted)">سيتم حذف مفتاح <strong>${esc(c.company_key)}</strong> ومستخدمي الشركة وبيانات المزامنة السحابية الخاصة بها. لا يمكن التراجع عن العملية.</p><form id="deleteCompanyForm"><label class="field"><span>اكتب مفتاح الشركة للتأكيد</span><input class="input" name="confirmKey" autocomplete="off" required placeholder="${esc(c.company_key)}"></label><div class="admin-modal-actions"><button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button><button class="btn btn-danger-soft" type="submit">حذف المفتاح نهائياً</button></div></form>`);
    $('#modalCancel').onclick=close;
    $('#deleteCompanyForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form),confirmKey=normalizeKey(f.get('confirmKey'));if(compactKey(confirmKey)!==compactKey(c.company_key)){toast('مفتاح التأكيد غير مطابق.','error');return}try{
      // Order matters: dependent rows first, then users, then the company.
      const res=await T.pipelineRaw([{sql:`DELETE FROM shahd_events WHERE company_id=?`,args:[id]},{sql:`DELETE FROM shahd_users WHERE company_id=?`,args:[id]},{sql:`DELETE FROM shahd_companies WHERE id=?`,args:[id]}],60000);const failed=res.find(x=>!x.ok);if(failed)throw new Error(failed.error||'تعذر حذف الشركة.');try{await T.execute(`DELETE FROM shahd_records WHERE company_id=?`,[id])}catch(_){ }
      companies=companies.filter(x=>x.id!==id);render();close();toast('تم حذف المفتاح والشركة نهائياً.');load().catch(()=>{});
    }catch(x){toast(x.message||x,'error')}};
  }

  $('#adminLoginForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,key=String(new FormData(form).get('adminKey')||'');try{const hash=await T.hashPassword(key,ADMIN_SALT);if(hash!==ADMIN_HASH)throw new Error('مفتاح الأدمن الرئيسي غير صحيح.');await ensure();unlocked=true;sessionStorage.setItem(SESSION_KEY,'1');status('');showApp()}catch(x){status(x.message||'تعذر الدخول.')}});

  $('#companyForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget, f=new FormData(form), btn=form.querySelector('button[type="submit"]');
    btn.disabled=true;
    try{
      await ensure();
      const name=String(f.get('name')||'').trim(),key=normalizeKey(f.get('companyKey')||generateKey()),managerUsername=normalizeUser(f.get('managerUsername')||'admin'),managerName=String(f.get('managerName')||'مدير الشركة').trim(),password=String(f.get('managerPassword')||'');
      if(!name||!key||!managerUsername||password.length<6)throw new Error('أكمل بيانات الشركة والمدير، وكلمة المرور 6 أحرف على الأقل.');
      const exists=await T.query(`SELECT id FROM shahd_companies WHERE UPPER(TRIM(company_key))=? OR REPLACE(REPLACE(REPLACE(UPPER(TRIM(company_key)),'-',''),' ',''),'_','')=? LIMIT 1`,[key,compactKey(key)]);if(exists.length)throw new Error('مفتاح الشركة مستخدم مسبقاً. اختر مفتاحاً آخر.');
      const id=T.uuid('cmp'),uid=T.uuid('usr'),salt=T.salt(),hash=await T.hashPassword(password,salt),created=now(),expires=durationMs(created,Number(f.get('durationQuantity')||1),f.get('durationUnit')||'month'),maxUsers=Math.max(1,Number(f.get('maxUsers')||10));
      const res=await T.pipelineRaw([{sql:`INSERT INTO shahd_companies(id,company_key,name,status,expires_at,max_users,auth_version,created_at,updated_at) VALUES(?,?,?,'active',?,?,1,?,?)`,args:[id,key,name,expires,maxUsers,created,created]},{sql:`INSERT INTO shahd_users(id,company_id,username,display_name,password_hash,password_salt,role,permissions_json,active,auth_version,created_at,updated_at) VALUES(?,?,?,?,?,?,'manager',?,1,1,?,?)`,args:[uid,id,managerUsername,managerName,hash,salt,allManagerPermissions(),created,created]}],45000);
      const failed=res.find(x=>!x.ok);if(failed){try{await T.pipelineRaw([{sql:`DELETE FROM shahd_users WHERE id=?`,args:[uid]},{sql:`DELETE FROM shahd_companies WHERE id=?`,args:[id]}],20000)}catch(_){ }throw new Error(failed.error||'تعذر إنشاء الشركة.')}
      // Read-back verification prevents a false success toast and gives the new
      // company to the list immediately without a manual refresh.
      const check=await T.query(`SELECT c.id,c.company_key,c.name,c.status,c.expires_at,c.max_users,c.auth_version,c.created_at,c.updated_at,u.username AS manager_username,u.display_name AS manager_name,1 AS active_users FROM shahd_companies c JOIN shahd_users u ON u.company_id=c.id AND u.id=? WHERE c.id=? LIMIT 1`,[uid,id]);
      if(!check.length)throw new Error('تمت الكتابة لكن تعذر التحقق من الشركة. أعد المحاولة.');
      companies=[check[0],...companies.filter(x=>x.id!==id)];render();
      toast(`تم إنشاء الشركة والمفتاح: ${key}`);
      showCreatedCredentials({name,key,username:managerUsername});
      form.reset();form.durationQuantity.value=1;form.durationUnit.value='month';form.maxUsers.value=10;form.managerName.value='مدير الشركة';form.managerUsername.value='admin';
      setTimeout(()=>load().catch(()=>{}),350);
    }catch(x){toast(x.message||x,'error')}finally{btn.disabled=false}
  });

  $('#companiesList').addEventListener('click',async e=>{const x=e.target.closest('[data-extend],[data-toggle],[data-edit],[data-reset-password],[data-copy],[data-delete-company]');if(!x)return;if(x.dataset.extend)return extendCompany(x.dataset.extend);if(x.dataset.edit)return editCompany(x.dataset.edit);if(x.dataset.resetPassword)return resetManagerPassword(x.dataset.resetPassword);if(x.dataset.deleteCompany)return deleteCompany(x.dataset.deleteCompany);if(x.dataset.copy){try{await navigator.clipboard?.writeText(x.dataset.copy)}catch(_){const i=document.createElement('input');i.value=x.dataset.copy;document.body.append(i);i.select();document.execCommand('copy');i.remove()}toast('تم نسخ المفتاح.');return}if(x.dataset.toggle){try{await toggleCompany(x.dataset.toggle)}catch(err){toast(err.message||err,'error')}}});
  $('#adminRefresh').onclick=()=>load().catch(e=>toast(e.message||e,'error'));
  $('#adminLogout').onclick=()=>{sessionStorage.removeItem(SESSION_KEY);location.reload()};
  if(unlocked)showApp();
})();
