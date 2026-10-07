(() => {
  'use strict';

  const STORAGE_KEY = 'shahd_property_accounting_v1';
  const CURRENCIES = ['ILS', 'USD', 'JOD', 'GOLD'];
  const CURRENCY_META = {
    ILS: { label: 'شيكل', symbol: '₪', precision: 2 },
    USD: { label: 'دولار', symbol: '$', precision: 2 },
    JOD: { label: 'دينار', symbol: 'د.أ', precision: 3 },
    GOLD: { label: 'ذهب', symbol: 'غ', precision: 3 }
  };
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  const defaults = {
    version: 1,
    buildings: [],
    tenants: [],
    projects: [],
    movements: [],
    debts: [],
    debtPayments: [],
    settings: {
      companyName: 'شركة شهد',
      companySubtitle: 'للتجارة العامة والمقاولات',
      defaultExecutor: 'بلال',
      receiptPrefix: 'SH',
      whatsappCountryCode: '970',
      rentDueDay: 1,
      theme: 'light'
    }
  };

  let state = cloneDefaults();
  let companyUsers = [];
  let usersLoadedAt = 0;
  let usersLoading = false;
  let activeView = 'dashboard';
  let activeDebtTab = 'receivable';
  let activeTenantTab = 'active';
  let activeProjectId = '';
  let activeProjectTab = 'movements';
  let deferredInstallPrompt = null;

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];

  const PERMISSIONS = window.SHAHD_PERMISSIONS || {groups:[],viewForRoute:{}};
  function can(permission) { return window.ShahdCloud?.hasPermission ? window.ShahdCloud.hasPermission(permission) : true; }
  function requirePermission(permission, message='لا تملك صلاحية تنفيذ هذه العملية.') {
    if (can(permission)) return true;
    toast(message,'error'); return false;
  }
  function withPermission(permission, fn) { return (...args) => { if (requirePermission(permission)) return fn(...args); }; }

  function cloneDefaults() { return JSON.parse(JSON.stringify(defaults)); }
  function uid(prefix = 'id') {
    if (crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return cloneDefaults();
      const parsed = JSON.parse(raw);
      return {
        ...cloneDefaults(),
        ...parsed,
        buildings: Array.isArray(parsed.buildings) ? parsed.buildings : [],
        tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        movements: Array.isArray(parsed.movements) ? parsed.movements : [],
        debts: Array.isArray(parsed.debts) ? parsed.debts.map(d => ({...d, direction: ['receivable','payable'].includes(d.direction) ? d.direction : 'receivable'})) : [],
        debtPayments: Array.isArray(parsed.debtPayments) ? parsed.debtPayments : [],
        settings: { ...defaults.settings, ...(parsed.settings || {}) }
      };
    } catch (e) {
      console.error(e);
      return cloneDefaults();
    }
  }
  function saveState(render = true) {
    window.ShahdCloud?.persistState?.(state);
    applyTheme();
    if (render) renderAll();
  }
  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme || 'light';
    const themeColor = state.settings.theme === 'dark' ? '#141f2f' : '#0b4d8f';
    $('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  }

  function today() { return new Date().toISOString().slice(0, 10); }
  function currentMonth() { return new Date().toISOString().slice(0, 7); }
  function monthToIndex(ym) {
    if (!/^\d{4}-\d{2}$/.test(ym || '')) return null;
    const [y,m] = ym.split('-').map(Number);
    return y * 12 + (m - 1);
  }
  function indexToMonth(index) {
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    return `${y}-${String(m).padStart(2,'0')}`;
  }
  function addMonths(ym, n) {
    const idx = monthToIndex(ym);
    return idx === null ? '' : indexToMonth(idx + n);
  }
  function monthRange(start, count) {
    const n = Math.max(1, Number(count) || 1);
    return Array.from({length:n}, (_,i) => addMonths(start, i));
  }
  function monthLabel(ym) {
    if (!ym) return '—';
    const [y,m] = ym.split('-').map(Number);
    return `${MONTHS_AR[m-1] || m} ${y}`;
  }
  function dateLabel(d) {
    if (!d) return '—';
    const [y,m,day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  function toUnits(value, currency) {
    const p = CURRENCY_META[currency]?.precision ?? 2;
    let s = String(value ?? '0').trim().replace(/,/g,'');
    if (!s) return 0n;
    let sign = 1n;
    if (s.startsWith('-')) { sign = -1n; s = s.slice(1); }
    if (!/^\d*(\.\d*)?$/.test(s)) return 0n;
    let [whole='0', frac=''] = s.split('.');
    whole = whole || '0';
    const baseFrac = (frac + '0'.repeat(p)).slice(0,p);
    let units = BigInt(whole || '0') * (10n ** BigInt(p)) + BigInt(baseFrac || '0');
    if (frac.length > p && Number(frac[p] || 0) >= 5) units += 1n;
    return units * sign;
  }
  function unitsToDecimal(units, currency, trim = false) {
    const p = CURRENCY_META[currency]?.precision ?? 2;
    const factor = 10n ** BigInt(p);
    let n = BigInt(units || 0);
    const neg = n < 0n;
    if (neg) n = -n;
    const whole = n / factor;
    let frac = String(n % factor).padStart(p,'0');
    if (trim) frac = frac.replace(/0+$/,'');
    const out = p && frac ? `${whole}.${frac}` : String(whole);
    return `${neg ? '-' : ''}${out}`;
  }
  function normalizeAmount(value, currency) { return unitsToDecimal(toUnits(value, currency), currency, false); }
  function formatMoney(valueOrUnits, currency, isUnits = false) {
    const meta = CURRENCY_META[currency];
    const units = isUnits ? BigInt(valueOrUnits || 0) : toUnits(valueOrUnits || '0', currency);
    const p = meta.precision;
    const raw = unitsToDecimal(units, currency, false);
    const n = Number(raw);
    const formatted = Number.isFinite(n)
      ? n.toLocaleString('en-US',{minimumFractionDigits:p,maximumFractionDigits:p})
      : raw;
    return `${formatted} ${meta.symbol}`;
  }
  function sumUnits(items, selector, currency) {
    return items.reduce((sum, item) => sum + toUnits(selector(item) || '0', currency), 0n);
  }
  function emptyAmounts() {
    return Object.fromEntries(CURRENCIES.map(c => [c,{in:normalizeAmount('0',c),out:normalizeAmount('0',c)}]));
  }
  function movementTotal(movements, currency, direction) {
    return sumUnits(movements, m => m.amounts?.[currency]?.[direction] || '0', currency);
  }
  function balanceForMovements(movements, currency) {
    return movementTotal(movements,currency,'in') - movementTotal(movements,currency,'out');
  }

  function buildingById(id) { return state.buildings.find(x => x.id === id); }
  function tenantById(id) { return state.tenants.find(x => x.id === id); }
  function projectById(id) { return state.projects.find(x => x.id === id); }
  function debtById(id) { return state.debts.find(x => x.id === id); }
  function currentExecutor() { const session=window.ShahdCloud?.getSession?.()||{}; return String(session.displayName||session.username||state.settings.defaultExecutor||'').trim(); }
  function isTenantActive(t) { return (t?.status||'active') === 'active'; }
  function tenantExitDebt(t) { return t?.exitDebtId ? debtById(t.exitDebtId) : state.debts.find(d=>d.source==='tenant_exit'&&d.tenantId===t?.id); }
  function tenantArchiveState(t) { if(isTenantActive(t)) return 'active'; const d=tenantExitDebt(t); return d && debtRemainingUnits(d)>0n ? 'former_debt' : 'former_clear'; }
  function paymentMethodLabel(value){ return value==='bank'?'بنكي':'نقدي'; }
  function financialMetaFields(existing={}) {
    const methodOptions=[{value:'cash',label:'نقدي'},{value:'bank',label:'بنكي / محفظة'}];
    return `${selectField('paymentMethod','طريقة الدفع',methodOptions,existing.paymentMethod||'cash')}${field('referenceNo','رقم المرجع الوارد / الصادر',existing.referenceNo||'')}${field('bankWallet','اسم البنك / المحفظة',existing.bankWallet||'')}`;
  }

  function toast(message, type = 'success', title = '') {
    const root = $('#toastRoot');
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    const labels = {success:'تم بنجاح',error:'تنبيه',info:'معلومة'};
    item.innerHTML = `<div class="toast-icon">${type==='success'?'✓':type==='error'?'!':'i'}</div><div><strong>${escapeHtml(title || labels[type] || '')}</strong><span>${escapeHtml(message)}</span></div><button type="button" aria-label="إغلاق">×</button>`;
    root.appendChild(item);
    const close = () => { if(!item.isConnected)return; item.classList.add('toast-out'); setTimeout(()=>item.remove(),190); };
    $('button',item).addEventListener('click',close);
    setTimeout(close, 4200);
  }

  function showModal({title, subtitle='', icon='i-plus', body='', size='', submitText='حفظ', onSubmit=null, hideSubmit=false, extraFooter=''}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal ${size==='lg'?'modal-lg':''}" role="dialog" aria-modal="true"><div class="modal-head"><div class="modal-title"><div class="title-icon"><svg class="icon"><use href="#${icon}"/></svg></div><div><h3>${escapeHtml(title)}</h3>${subtitle?`<p>${escapeHtml(subtitle)}</p>`:''}</div></div><button class="icon-btn" id="modalClose" type="button"><svg class="icon"><use href="#i-close"/></svg></button></div><form id="modalForm"><div class="modal-body">${body}</div><div class="modal-foot">${hideSubmit?'':`<button class="btn btn-primary" type="submit">${escapeHtml(submitText)}</button>`}<button class="btn btn-ghost" type="button" id="modalCancel">إلغاء</button>${extraFooter}</div></form></div></div>`;
    const backdrop = $('#modalBackdrop');
    let closing = false;
    const close = () => {
      if (closing || !backdrop?.isConnected) return;
      closing = true;
      backdrop.classList.add('is-closing');
      const modal = $('.modal', backdrop);
      if (modal) modal.classList.add('is-closing');
      window.setTimeout(() => { if (root.contains(backdrop)) root.innerHTML = ''; }, 190);
    };
    $('#modalClose').addEventListener('click', close);
    $('#modalCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    const form = $('#modalForm');
    if (onSubmit) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        const result = onSubmit(new FormData(form), form, close);
        if (result === true) close();
      });
    } else form.addEventListener('submit', e => e.preventDefault());
    setTimeout(() => $('input,select,textarea', form)?.focus(), 40);
    return { form, close };
  }

  function confirmAction({title='تأكيد العملية', message, confirmText='تأكيد', danger=true, onConfirm}) {
    const { form, close } = showModal({
      title, icon: danger ? 'i-trash' : 'i-check', submitText: confirmText,
      body:`<div class="confirm-box"><div class="confirm-icon"><svg class="icon" style="width:30px;height:30px"><use href="#${danger?'i-trash':'i-check'}"/></svg></div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p></div>`,
      onSubmit:()=>{ onConfirm(); close(); return false; }
    });
    if (!danger) $('button[type="submit"]',form)?.classList.add('btn-primary');
  }

  function field(name,label,value='',type='text',attrs='') {
    return `<label class="field"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
  }
  function fullField(name,label,value='',type='text',attrs='') {
    return `<label class="field full"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
  }
  function selectField(name,label,options,value='',extraClass='') {
    return `<label class="field ${extraClass}"><span>${label}</span><select class="select" name="${name}">${options.map(o=>`<option value="${escapeHtml(o.value)}" ${String(o.value)===String(value)?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
  }
  function textareaField(name,label,value='',extraClass='full') {
    return `<label class="field ${extraClass} textarea-field"><span>${label}</span><textarea class="textarea" name="${name}">${escapeHtml(value)}</textarea></label>`;
  }

  function navigate(view) {
    const viewPermission = PERMISSIONS.viewForRoute?.[view];
    if (view!=='settings' && viewPermission && !can(viewPermission)) { toast('هذه الصفحة غير متاحة لصلاحيات حسابك.','error'); return; }
    activeView = view;
    document.body.dataset.view = view==='project-details'?'projects':view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    const navView=view==='project-details'?'projects':view;
    $$('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === navView));
    $$('.mobile-bottom-item').forEach(b => b.classList.toggle('active', b.dataset.mobileView === navView));
    const meta = {
      dashboard:['لوحة التحكم','نظرة سريعة على العقارات والحسابات'],
      projects:['مشاريعي','إدارة مالية مستقلة لكل مشروع: صادر، وارد، ديون لنا وديون علينا'],
      'project-details':['إدارة المشروع','حسابات المشروع وحركاته وديونه بشكل مستقل'],
      buildings:['العقارات','إدارة العمارات والشقق والمستأجرين'],
      tenants:['المستأجرون','العقود والإيجارات الشهرية وبيانات المستأجرين'],
      movements:['الحركة اليومية','الوارد والمصروف ودفعات المستأجرين'],
      arrears:['متأخرات المستأجرين','حساب الأشهر المستحقة والمتبقي بدقة'],
      debts:['الديون والسداد','ديون لنا، ديون علينا، والحسابات التي تم سدادها وإنهاؤها'],
      reports:['التقارير','ملخصات مالية حسب كل عملة بدون خلط'],
      users:['المستخدمون والصلاحيات','إدارة حسابات الموظفين وتحديد الصلاحيات الدقيقة'],
      settings:['الإعدادات','هوية الشركة والتثبيت والنسخ الاحتياطي']
    };
    $('#pageTitle').textContent = meta[view]?.[0] || '';
    $('#pageSubtitle').textContent = meta[view]?.[1] || '';
    if(view==='project-details'){const p=projectById(activeProjectId);if(p){$('#pageTitle').textContent=p.name;$('#pageSubtitle').textContent='إدارة مالية مستقلة للمشروع';}}
    closeSidebar();
    renderAll();
    const mainScroller=$('.main');
    if(mainScroller) mainScroller.scrollTop=0;
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function openSidebar(){ $('#sidebar').classList.add('open'); $('#sidebarOverlay').classList.add('show'); }
  function closeSidebar(){ $('#sidebar').classList.remove('open'); $('#sidebarOverlay').classList.remove('show'); }

  function renderAll() {
    applyTheme();
    populateGlobalFilters();
    renderDashboard();
    renderProjects();
    renderProjectDetails();
    renderBuildings();
    renderTenants();
    renderMovements();
    renderArrears();
    renderDebts();
    renderReports();
    renderUsers();
    renderSettings();
    updateNotificationBadge();
    applyPermissionUI();
  }

  function populateGlobalFilters() {
    const opts = state.buildings.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    ['tenantBuildingFilter','arrearsBuildingFilter'].forEach(id => {
      const el = $(`#${id}`); if (!el) return;
      const current = el.value;
      el.innerHTML = `<option value="">كل العقارات</option>${opts}`;
      if ([...el.options].some(o=>o.value===current)) el.value = current;
    });
    const projectOpts=state.projects.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    const projectFilter=$('#movementProjectFilter');
    if(projectFilter){const current=projectFilter.value;projectFilter.innerHTML=`<option value="">كل المشاريع</option><option value="__none">بدون مشروع</option>${projectOpts}`;if([...projectFilter.options].some(o=>o.value===current))projectFilter.value=current;}
  }

  function projectStatusMeta(status) {
    return ({active:{label:'نشط',cls:'badge-green'},paused:{label:'متوقف مؤقتاً',cls:'badge-amber'},completed:{label:'مكتمل',cls:'badge-blue'}})[status] || {label:'نشط',cls:'badge-green'};
  }

  function projectMovements(projectId) { return state.movements.filter(m=>m.projectId===projectId); }
  function projectDebts(projectId) { return state.debts.filter(d=>d.projectId===projectId); }

  function projectSummaryRows(values, tone='') {
    return CURRENCIES.map(c=>`<div class="project-total-row"><span>${CURRENCY_META[c].label}</span><strong class="${tone}">${formatMoney(values[c]||0n,c,true)}</strong></div>`).join('');
  }

  function renderProjects() {
    const search=($('#projectSearch')?.value||'').trim().toLowerCase();
    const list=state.projects.filter(p=>!search||[p.name,p.client,p.location,p.notes].some(v=>String(v||'').toLowerCase().includes(search))).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));

    // These totals intentionally use ALL project records, not the visible search result.
    const projectMoves=state.movements.filter(m=>m.projectId);
    const projectDebtsOpen=state.debts.filter(d=>d.projectId&&d.status!=='closed');
    const totalsIn=Object.fromEntries(CURRENCIES.map(c=>[c,movementTotal(projectMoves,c,'in')]));
    const totalsOut=Object.fromEntries(CURRENCIES.map(c=>[c,movementTotal(projectMoves,c,'out')]));
    const totalsReceivable=Object.fromEntries(CURRENCIES.map(c=>[c,projectDebtsOpen.filter(d=>(d.direction||'receivable')==='receivable'&&d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n)]));
    const totalsPayable=Object.fromEntries(CURRENCIES.map(c=>[c,projectDebtsOpen.filter(d=>d.direction==='payable'&&d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n)]));

    if($('#projectsTotalIn')) $('#projectsTotalIn').innerHTML=projectSummaryRows(totalsIn,'money-in');
    if($('#projectsTotalOut')) $('#projectsTotalOut').innerHTML=projectSummaryRows(totalsOut,'money-out');
    if($('#projectsTotalReceivable')) $('#projectsTotalReceivable').innerHTML=projectSummaryRows(totalsReceivable,'money-in');
    if($('#projectsTotalPayable')) $('#projectsTotalPayable').innerHTML=projectSummaryRows(totalsPayable,'money-out');

    if(!$('#projectsCards'))return;
    $('#projectsCards').innerHTML=list.length?list.map(p=>{
      const moves=projectMovements(p.id),debts=projectDebts(p.id),openR=debts.filter(d=>d.status!=='closed'&&(d.direction||'receivable')==='receivable').length,openP=debts.filter(d=>d.status!=='closed'&&d.direction==='payable').length,status=projectStatusMeta(p.status);
      return `<article class="entity-card project-card"><div class="entity-head"><div class="entity-icon"><svg class="icon"><use href="#i-project"/></svg></div><span class="badge ${status.cls}">${status.label}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.client?`العميل: ${p.client}`:'بدون اسم عميل')}${p.location?` • ${escapeHtml(p.location)}`:''}</p><div class="entity-meta"><div class="meta-chip"><small>الحركات</small><strong>${moves.length}</strong></div><div class="meta-chip"><small>ديون لنا / علينا</small><strong>${openR} / ${openP}</strong></div><div class="meta-chip"><small>تاريخ البداية</small><strong>${dateLabel(p.startDate)||'—'}</strong></div><div class="meta-chip"><small>المرحلة</small><strong>${status.label}</strong></div></div><div class="card-actions"><button class="btn btn-primary btn-sm" data-open-project="${p.id}">إدارة المشروع</button><button class="btn btn-ghost btn-sm btn-icon" data-edit-project="${p.id}" title="تعديل"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" data-delete-project="${p.id}" title="حذف"><svg class="icon"><use href="#i-trash"/></svg></button></div></article>`;
    }).join(''):`<div class="empty empty-wide">لا توجد مشاريع بعد. أضف أول مشروع ليصبح له حساب مستقل للصادر والوارد والديون.</div>`;
  }

  function openProjectDetails(id) {
    if(!projectById(id)){toast('المشروع غير موجود.','error');return;}
    activeProjectId=id;activeProjectTab='movements';navigate('project-details');
  }

  function projectDebtTableMarkup(list,isClosed=false) {
    if(!list.length)return `<div class="empty">لا توجد سجلات في هذا القسم للمشروع.</div>`;
    return `<table><thead><tr><th>النوع</th><th>الاسم / الجهة</th><th>المبلغ الأصلي</th><th>المدفوع / المحصّل</th><th>المتبقي</th><th>${isClosed?'تاريخ الإنهاء':'تاريخ الدين'}</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${list.map(d=>{const direction=d.direction||'receivable',paid=debtPaidUnits(d),rem=debtRemainingUnits(d),op=direction==='receivable'?'تحصيل':'سداد';return `<tr><td><span class="badge ${direction==='receivable'?'badge-green':'badge-red'}">${direction==='receivable'?'دين لنا':'دين علينا'}</span></td><td><strong>${escapeHtml(d.name)}</strong></td><td>${formatMoney(d.amount,d.currency)}</td><td class="${direction==='receivable'?'money-in':'money-out'}">${formatMoney(paid,d.currency,true)}</td><td class="${rem>0n?'money-out':'money-in'}">${formatMoney(rem,d.currency,true)}</td><td>${dateLabel(isClosed?d.completedDate:d.date)}</td><td>${escapeHtml(d.notes||'—')}</td><td><div class="actions debt-row-actions"><button class="btn btn-report btn-sm" data-debt-report="${d.id}"><svg class="icon"><use href="#i-chart"/></svg><span>تقرير تفصيلي</span></button>${d.status!=='closed'?`<button class="btn btn-primary btn-sm" data-debt-payment="${d.id}">${op}</button>`:''}${paid>0n?`<button class="btn btn-ghost btn-sm" data-debt-history="${d.id}">السجل</button>`:''}<button class="btn btn-ghost btn-sm btn-icon" data-edit-debt="${d.id}" title="تعديل"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" data-delete-debt="${d.id}" title="حذف"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`}).join('')}</tbody></table>`;
  }

  function renderProjectDetails() {
    const root=$('#projectDetailContent'); if(!root)return;
    const p=projectById(activeProjectId);
    if(!p){if(activeView==='project-details'){root.innerHTML='<div class="empty">اختر مشروعاً من شاشة «مشاريعي».</div>';}return;}
    const moves=projectMovements(p.id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
    const debts=projectDebts(p.id), status=projectStatusMeta(p.status);
    $('#projectHeader').innerHTML=`<div class="project-header-card"><div><div class="project-title-row"><div class="project-icon"><svg class="icon"><use href="#i-project"/></svg></div><div><span class="badge ${status.cls}">${status.label}</span><h2>${escapeHtml(p.name)}</h2></div></div><p>${escapeHtml([p.client&&`العميل: ${p.client}`,p.location&&`الموقع: ${p.location}`].filter(Boolean).join(' • ')||'حساب مشروع مستقل')}</p></div><div class="project-dates"><span>البداية <strong>${dateLabel(p.startDate)}</strong></span><span>النهاية <strong>${p.endDate?dateLabel(p.endDate):'غير محددة'}</strong></span></div></div>`;
    $('#projectCurrencySummary').innerHTML=CURRENCIES.map(c=>{const i=movementTotal(moves,c,'in'),o=movementTotal(moves,c,'out'),r=debts.filter(d=>d.status!=='closed'&&(d.direction||'receivable')==='receivable'&&d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n),pay=debts.filter(d=>d.status!=='closed'&&d.direction==='payable'&&d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n);return `<article class="project-money-card"><div class="project-money-title"><strong>${CURRENCY_META[c].label}</strong><span>${CURRENCY_META[c].symbol}</span></div><div class="project-money-row"><span>وارد</span><strong class="money-in">${formatMoney(i,c,true)}</strong></div><div class="project-money-row"><span>صادر</span><strong class="money-out">${formatMoney(o,c,true)}</strong></div><div class="project-money-row project-balance"><span>الصافي</span><strong>${formatMoney(i-o,c,true)}</strong></div><div class="project-debt-mini"><span>لنا: <b class="money-in">${formatMoney(r,c,true)}</b></span><span>علينا: <b class="money-out">${formatMoney(pay,c,true)}</b></span></div></article>`}).join('');
    $$('#projectTabs .tab').forEach(t=>t.classList.toggle('active',t.dataset.projectTab===activeProjectTab));
    if(activeProjectTab==='movements')root.innerHTML=moves.length?movementsTableMarkup(moves):'<div class="empty">لا توجد حركات صادر أو وارد لهذا المشروع بعد.</div>';
    else {const isClosed=activeProjectTab==='closed';const list=debts.filter(d=>isClosed?d.status==='closed':d.status!=='closed'&&(d.direction||'receivable')===activeProjectTab).sort((a,b)=>(b.date||'').localeCompare(a.date||''));root.innerHTML=projectDebtTableMarkup(list,isClosed);}
  }

  function openProjectModal(id=null) {
    const p=id?projectById(id):null;
    const statuses=[{value:'active',label:'نشط'},{value:'paused',label:'متوقف مؤقتاً'},{value:'completed',label:'مكتمل'}];
    const body=`<div class="form-grid">${fullField('name','اسم المشروع',p?.name||'','text','required')}${field('client','اسم العميل / الجهة',p?.client||'')}${field('location','الموقع',p?.location||'')}${field('startDate','تاريخ البداية',p?.startDate||today(),'date')}${field('endDate','تاريخ النهاية',p?.endDate||'','date')}${selectField('status','حالة المشروع',statuses,p?.status||'active')}${textareaField('notes','ملاحظات المشروع',p?.notes||'')}</div><div class="form-note">كل مشروع يملك دفتره المستقل: صادر، وارد، ديون لنا، ديون علينا، وقائمة ما تم سداده وإنهاؤه. العملات تبقى منفصلة بدون خلط.</div>`;
    showModal({title:p?'تعديل المشروع':'إضافة مشروع جديد',subtitle:'سيتم إنشاء حساب مستقل للمشروع',icon:'i-project',body,onSubmit:(fd)=>{const name=String(fd.get('name')||'').trim();if(!name){toast('أدخل اسم المشروع.','error');return false;}const rec={id:p?.id||uid('p'),name,client:String(fd.get('client')||'').trim(),location:String(fd.get('location')||'').trim(),startDate:fd.get('startDate')||'',endDate:fd.get('endDate')||'',status:fd.get('status')||'active',notes:String(fd.get('notes')||'').trim(),createdAt:p?.createdAt||new Date().toISOString()};if(p)Object.assign(p,rec);else state.projects.push(rec);activeProjectId=rec.id;saveState();toast(p?'تم تحديث المشروع.':'تم إنشاء المشروع وحسابه المستقل.');if(!p)setTimeout(()=>openProjectDetails(rec.id),30);return true;}});
  }

  function deleteProject(id) {
    const p=projectById(id);if(!p)return;const moves=projectMovements(id),debts=projectDebts(id);
    if(moves.length||debts.length){toast(`لا يمكن حذف المشروع لأن لديه ${moves.length} حركة و${debts.length} دين. يمكنك تغيير حالته إلى «مكتمل» للحفاظ على السجل.`, 'error');return;}
    confirmAction({title:'حذف المشروع',message:`سيتم حذف مشروع «${p.name}» نهائياً.`,onConfirm:()=>{state.projects=state.projects.filter(x=>x.id!==id);if(activeProjectId===id)activeProjectId='';saveState();toast('تم حذف المشروع.');}});
  }

  function getDashboardCutoffMonth() {
    const now = new Date();
    const dueDay = Math.min(28, Math.max(1, Number(state.settings.rentDueDay || 1)));
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return now.getDate() >= dueDay ? ym : addMonths(ym,-1);
  }

  function calculateTenantArrears(tenant, cutoff = currentMonth()) {
    const currency = tenant.rentCurrency || 'ILS';
    const monthly = toUnits(tenant.rentAmount || '0', currency);
    if (!tenant.startMonth || monthly <= 0n) return {currency,monthly,months:[],due:0n,paid:0n,charged:0n};
    const startIdx = monthToIndex(tenant.startMonth);
    let cutoffIdx = monthToIndex(cutoff);
    const duration = Math.max(1, Number(tenant.contractMonths || 12));
    let endIdx = startIdx + duration - 1;
    if(!isTenantActive(tenant) && tenant.endedMonth){
      const endedIdx=monthToIndex(tenant.endedMonth);
      if(endedIdx!==null) endIdx=Math.min(endIdx,endedIdx);
    }
    const lastIdx = Math.min(cutoffIdx ?? endIdx, endIdx);
    if (lastIdx < startIdx) return {currency,monthly,months:[],due:0n,paid:0n,charged:0n,contractEnd:indexToMonth(endIdx)};
    const dueMonths = Array.from({length:lastIdx-startIdx+1},(_,i)=>indexToMonth(startIdx+i));
    const paidMap = Object.fromEntries(dueMonths.map(m=>[m,0n]));
    const rentMovements = state.movements
      .filter(m => m.type==='rent' && m.tenantId===tenant.id)
      .sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.createdAt||'').localeCompare(b.createdAt||''));
    rentMovements.forEach(m => {
      const actual=toUnits(m.amounts?.[currency]?.in || '0', currency);
      const discount=toUnits(m.rentDiscount || '0', currency);
      let remaining = actual + discount;
      const months = Array.isArray(m.rentMonths) && m.rentMonths.length ? m.rentMonths : (m.rentMonth ? [m.rentMonth] : []);
      months.forEach(month => {
        if (remaining <= 0n || paidMap[month] === undefined) return;
        const need = monthly - paidMap[month];
        if (need <= 0n) return;
        const alloc = remaining > need ? need : remaining;
        paidMap[month] += alloc;
        remaining -= alloc;
      });
    });
    const months = dueMonths.map(month => {
      const paid = paidMap[month] || 0n;
      const due = monthly > paid ? monthly - paid : 0n;
      return {month,charge:monthly,paid,due};
    }).filter(x=>x.due>0n);
    const due = months.reduce((sum,x)=>sum+x.due,0n);
    const paid = dueMonths.reduce((sum,m)=>sum+(paidMap[m]||0n),0n);
    const charged = BigInt(dueMonths.length) * monthly;
    return {currency,monthly,months,due,paid,charged,contractEnd:indexToMonth(endIdx)};
  }

  function debtInstallmentStatus(debt, date=today()){
    if(!debt || debt.status==='closed' || !debt.installmentEnabled) return null;
    const c=debt.currency||'ILS', installment=toUnits(debt.installmentAmount||'0',c);
    if(installment<=0n) return null;
    const startMonth=debt.installmentStartMonth || String(debt.date||date).slice(0,7);
    const startIdx=monthToIndex(startMonth), currentIdx=monthToIndex(String(date).slice(0,7));
    if(startIdx===null||currentIdx===null) return null;
    const dueDay=Math.min(28,Math.max(1,Number(debt.installmentDueDay||1)));
    const day=Number(String(date).slice(8,10)||1);
    let dueCount=currentIdx-startIdx+(day>=dueDay?1:0);
    dueCount=Math.max(0,dueCount);
    const total=toUnits(debt.amount,c), paid=debtPaidUnits(debt);
    const expected=installment*BigInt(dueCount)>total?total:installment*BigInt(dueCount);
    const overdue=expected>paid?expected-paid:0n;
    let nextIdx=startIdx+dueCount;
    if(dueCount===0 && currentIdx>startIdx) nextIdx=currentIdx;
    const nextMonth=indexToMonth(nextIdx);
    const nextDate=`${nextMonth}-${String(dueDay).padStart(2,'0')}`;
    const ms=Math.max(0,new Date(`${nextDate}T00:00:00`).getTime()-new Date(`${date}T00:00:00`).getTime());
    const daysUntil=Math.round(ms/86400000);
    return {currency:c,installment,dueDay,startMonth,dueCount,expected,paid,overdue,nextDate,daysUntil,remaining:debtRemainingUnits(debt)};
  }

  function renderDashboard() {
    const cutoff = getDashboardCutoffMonth();
    const activeTenants=state.tenants.filter(isTenantActive);
    const formerTenants=state.tenants.filter(t=>!isTenantActive(t));
    const arrearsRows = activeTenants.map(t => ({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n);
    const openReceivable = state.debts.filter(d=>d.status!=='closed' && (d.direction||'receivable')==='receivable');
    const openPayable = state.debts.filter(d=>d.status!=='closed' && d.direction==='payable');
    const openDebts = [...openReceivable,...openPayable];
    const stats = [
      {label:'المشاريع',value:state.projects.length,note:'مشروع مستقل',icon:'i-project'},
      {label:'العقارات',value:state.buildings.length,note:'عمارة مسجلة',icon:'i-building'},
      {label:'المستأجرون الحاليون',value:activeTenants.length,note:`${formerTenants.length} مستأجر سابق محفوظ بالأرشيف`,icon:'i-users'},
      {label:'حالات المتأخرات',value:arrearsRows.length,note:`حتى ${monthLabel(cutoff)}`,icon:'i-clock'},
      {label:'ديون لنا / علينا',value:`${openReceivable.length} / ${openPayable.length}`,note:'لنا / علينا',icon:'i-debt'}
    ];
    $('#dashboardStats').innerHTML = stats.map(s=>`<div class="stat-card"><div class="stat-top"><div class="stat-label">${s.label}</div><div class="stat-icon"><svg class="icon"><use href="#${s.icon}"/></svg></div></div><div class="stat-value">${typeof s.value==='number'?s.value.toLocaleString('ar'):s.value}</div><div class="stat-note">${s.note}</div></div>`).join('');

    $('#dashboardCurrencySummary').innerHTML = CURRENCIES.map(c => {
      const incoming = movementTotal(state.movements,c,'in'), outgoing = movementTotal(state.movements,c,'out');
      return `<div class="currency-row"><div class="currency-code">${CURRENCY_META[c].label}</div><div class="money-in"><small>وارد</small>${formatMoney(incoming,c,true)}</div><div class="money-out"><small>مصروف</small>${formatMoney(outgoing,c,true)}</div><div class="money-balance"><small>الرصيد</small>${formatMoney(incoming-outgoing,c,true)}</div></div>`;
    }).join('');

    const receivableByCurrency = CURRENCIES.map(c=>({c,total:openReceivable.filter(d=>d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n)})).filter(x=>x.total>0n);
    const payableByCurrency = CURRENCIES.map(c=>({c,total:openPayable.filter(d=>d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n)})).filter(x=>x.total>0n);
    const arrearsByCurrency = CURRENCIES.map(c=>({c,total:arrearsRows.filter(a=>a.currency===c).reduce((s,a)=>s+a.due,0n)})).filter(x=>x.total>0n);
    const alerts = [];
    if (arrearsRows.length) alerts.push({title:`${arrearsRows.length} مستأجر لديهم متأخرات`,text:arrearsByCurrency.map(x=>formatMoney(x.total,x.c,true)).join(' • ') || 'راجع شاشة المتأخرات'});
    if (openReceivable.length) alerts.push({title:`${openReceivable.length} دين لنا قيد التحصيل`,text:receivableByCurrency.map(x=>formatMoney(x.total,x.c,true)).join(' • ') || 'راجع شاشة الديون'});
    if (openPayable.length) alerts.push({title:`${openPayable.length} دين علينا يحتاج سداد`,text:payableByCurrency.map(x=>formatMoney(x.total,x.c,true)).join(' • ') || 'راجع شاشة الديون'});
    const installmentAlerts=state.debts.map(d=>({debt:d,status:debtInstallmentStatus(d)})).filter(x=>x.status&&(x.status.overdue>0n||x.status.daysUntil<=3));
    if(installmentAlerts.length) alerts.push({title:`${installmentAlerts.length} موعد قسط دين يحتاج متابعة`,text:installmentAlerts.slice(0,3).map(x=>`${x.debt.name}: ${x.status.overdue>0n?'متأخر '+formatMoney(x.status.overdue,x.debt.currency,true):'يستحق '+dateLabel(x.status.nextDate)}`).join(' • ')});
    if (!state.buildings.length) alerts.push({title:'ابدأ بإضافة أول عمارة',text:'بعدها أضف المستأجرين وحدد بداية العقد وقيمة الإيجار.'});
    if (!alerts.length) alerts.push({title:'لا توجد تنبيهات حالياً',text:'الحسابات المفتوحة والمتأخرات تحت السيطرة.'});
    $('#dashboardAlerts').innerHTML = alerts.map(a=>`<div class="alert-item"><div class="alert-dot"></div><div><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.text)}</span></div></div>`).join('');

    const recent = [...state.movements].sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,6);
    $('#dashboardRecent').innerHTML = recent.length ? movementsTableMarkup(recent,true) : `<div class="empty">لا توجد حركات مسجلة بعد.</div>`;
  }

  function renderBuildings() {
    const q = ($('#buildingSearch')?.value || '').trim().toLowerCase();
    const list = state.buildings.filter(b => !q || `${b.name} ${b.address}`.toLowerCase().includes(q));
    $('#buildingsCards').innerHTML = list.length ? list.map(b => {
      const tenants = state.tenants.filter(t=>t.buildingId===b.id).length;
      return `<article class="entity-card"><div class="entity-head"><div class="entity-icon"><svg class="icon"><use href="#i-building"/></svg></div><span class="badge badge-blue">${tenants} مستأجر</span></div><h3>${escapeHtml(b.name)}</h3><p>${escapeHtml(b.address || 'بدون عنوان')}</p><div class="entity-meta"><div class="meta-chip"><small>عدد الشقق</small><strong>${Number(b.apartments||0)}</strong></div><div class="meta-chip"><small>الإشغال</small><strong>${tenants} / ${Number(b.apartments||0) || '—'}</strong></div></div><div class="card-actions"><button class="btn btn-report btn-sm" data-building-statement="${b.id}"><svg class="icon"><use href="#i-chart"/></svg>كشف حساب</button><button class="btn btn-ghost btn-sm" data-edit-building="${b.id}"><svg class="icon"><use href="#i-edit"/></svg>تعديل</button><button class="btn btn-danger-soft btn-sm" data-delete-building="${b.id}"><svg class="icon"><use href="#i-trash"/></svg>حذف</button></div></article>`;
    }).join('') : `<div class="panel empty" style="grid-column:1/-1">لا توجد عقارات مطابقة. استخدم زر «إضافة عمارة» للبدء.</div>`;
  }

  function renderTenants() {
    const q = ($('#tenantSearch')?.value || '').trim().toLowerCase();
    const buildingFilter = $('#tenantBuildingFilter')?.value || '';
    const all=state.tenants.filter(t => {
      const b = buildingById(t.buildingId);
      const matchQ = !q || `${t.name} ${t.phone} ${t.idNumber} ${b?.name||''}`.toLowerCase().includes(q);
      const status=tenantArchiveState(t);
      const statusMatch=activeTenantTab==='all'||status===activeTenantTab;
      return matchQ && statusMatch && (!buildingFilter || t.buildingId===buildingFilter);
    });
    const counts={active:0,former_debt:0,former_clear:0};state.tenants.forEach(t=>counts[tenantArchiveState(t)]++);
    $('#tenantSummary').innerHTML=[['الحاليون',counts.active,'money-in'],['سابقون عليهم ديون',counts.former_debt,'money-out'],['قدامى خالص',counts.former_clear,'money-balance']].map(([label,val,cls])=>`<div class="mini-card"><small>${label}</small><strong class="${cls}">${val}</strong></div>`).join('');
    $$('#tenantTabs .tab').forEach(t=>t.classList.toggle('active',t.dataset.tenantTab===activeTenantTab));
    $('#tenantsTable').innerHTML = all.length ? `<table><thead><tr><th>المستأجر</th><th>العقار</th><th>الموقع</th><th>الإيجار الشهري</th><th>العقد</th><th>الحالة</th><th>الملفات</th><th>إجراءات</th></tr></thead><tbody>${all.map(t=>{
      const b=buildingById(t.buildingId), status=tenantArchiveState(t), a=calculateTenantArrears(t,getDashboardCutoffMonth()), exitDebt=tenantExitDebt(t);
      const statusHtml=status==='active'?(a.due>0n?`<span class="badge badge-red">متأخر ${a.months.length} شهر</span>`:`<span class="badge badge-green">حالي - منتظم</span>`):status==='former_debt'?`<span class="badge badge-red">سابق - عليه ${formatMoney(debtRemainingUnits(exitDebt),exitDebt.currency,true)}</span>`:`<span class="badge badge-gray">مستأجر قديم - خالص</span>`;
      const docs=[t.contractAttachment?`<span class="file-status ${t.contractAttachment.pending?'pending':''}">عقد${t.contractAttachment.pending?' • بانتظار الرفع':''}</span>`:'',t.identityAttachment?`<span class="file-status ${t.identityAttachment.pending?'pending':''}">هوية${t.identityAttachment.pending?' • بانتظار الرفع':''}</span>`:''].filter(Boolean).join('<br>')||'<small>لا توجد ملفات</small>';
      return `<tr><td><strong>${escapeHtml(t.name)}</strong><br><small>${escapeHtml(t.phone||'')}</small></td><td>${escapeHtml(b?.name||'—')}</td><td>${escapeHtml([t.floor,t.direction].filter(Boolean).join(' / ')||'—')}</td><td><strong>${formatMoney(t.rentAmount,t.rentCurrency)}</strong></td><td>${monthLabel(t.startMonth)}<br><small>${Number(t.contractMonths||12)} شهر${t.endedDate?` • انتهى ${dateLabel(t.endedDate)}`:''}</small></td><td>${statusHtml}</td><td>${docs}</td><td><div class="actions tenant-actions">${status==='active'?`<button class="btn btn-primary btn-sm" data-pay-tenant="${t.id}">دفعة</button><button class="btn btn-danger-soft btn-sm" data-end-tenant="${t.id}">إنهاء العقد</button>`:''}<button class="btn btn-report btn-sm" data-tenant-statement="${t.id}"><svg class="icon"><use href="#i-chart"/></svg>كشف حساب</button><button class="btn btn-ghost btn-sm" data-tenant-files="${t.id}"><svg class="icon"><use href="#i-file"/></svg>العقد والهوية</button><button class="btn btn-ghost btn-sm btn-icon" title="تعديل" data-edit-tenant="${t.id}"><svg class="icon"><use href="#i-edit"/></svg></button></div></td></tr>`;
    }).join('')}</tbody></table>` : `<div class="empty">لا يوجد مستأجرون ضمن هذا التصنيف.</div>`;
  }

  function movementsTableMarkup(list, compact=false) {
    return `<table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المكان / المستأجر</th>${compact?'<th>القيمة</th>':CURRENCIES.map(c=>`<th>${CURRENCY_META[c].label} وارد</th><th>${CURRENCY_META[c].label} مصروف</th>`).join('')}<th>الدفع / المرجع</th><th>المنفذ</th><th>إجراءات</th></tr></thead><tbody>${list.map(m=>{
      const tenant=tenantById(m.tenantId), building=buildingById(m.buildingId), project=projectById(m.projectId);
      const placeBase = m.type==='rent' ? (tenant?.name||m.account||'مستأجر محذوف') : (building?.name||m.account||'مركزي');
      const place = project ? `${placeBase} — مشروع: ${project.name}` : placeBase;
      let valueCell='';
      if (compact) {
        const vals=[]; CURRENCIES.forEach(c=>{ const i=toUnits(m.amounts?.[c]?.in||0,c),o=toUnits(m.amounts?.[c]?.out||0,c); if(i) vals.push(`<span class="money-in">+${formatMoney(i,c,true)}</span>`); if(o) vals.push(`<span class="money-out">-${formatMoney(o,c,true)}</span>`);});
        valueCell=`<td>${vals.join('<br>')||'—'}</td>`;
      } else valueCell=CURRENCIES.map(c=>`<td class="money-in">${toUnits(m.amounts?.[c]?.in||0,c)>0n?formatMoney(m.amounts[c].in,c):'—'}</td><td class="money-out">${toUnits(m.amounts?.[c]?.out||0,c)>0n?formatMoney(m.amounts[c].out,c):'—'}</td>`).join('');
      const hasIncoming=CURRENCIES.some(c=>toUnits(m.amounts?.[c]?.in||0,c)>0n),hasOutgoing=CURRENCIES.some(c=>toUnits(m.amounts?.[c]?.out||0,c)>0n);
      const typeBadge=m.type==='rent'?'<span class="badge badge-green">دفعة مستأجر</span>':'<span class="badge badge-blue">حركة عامة</span>';
      const paymentMeta=`${paymentMethodLabel(m.paymentMethod)}${m.bankWallet?` • ${escapeHtml(m.bankWallet)}`:''}${m.referenceNo?`<br><small>مرجع: ${escapeHtml(m.referenceNo)}</small>`:''}`;
      return `<tr><td>${dateLabel(m.date)}</td><td>${typeBadge}</td><td><strong>${escapeHtml(m.detail||'—')}</strong>${m.rentMonths?.length?`<br><small>${m.rentMonths.map(monthLabel).join('، ')}</small>`:''}${toUnits(m.rentDiscount||0,tenant?.rentCurrency||'ILS')>0n?`<br><small>خصم: ${formatMoney(m.rentDiscount,tenant?.rentCurrency||'ILS')}</small>`:''}</td><td>${escapeHtml(place)}</td>${valueCell}<td>${paymentMeta}</td><td>${escapeHtml(m.executor||'—')}</td><td><div class="actions">${hasIncoming?`<button class="btn btn-ghost btn-sm receipt-action-btn" title="سند قبض" data-receipt="${m.id}"><svg class="icon"><use href="#i-receipt"/></svg><span>سند قبض</span></button>`:''}${hasOutgoing?`<button class="btn btn-danger-soft btn-sm receipt-action-btn" title="سند صرف" data-payment-voucher="${m.id}"><svg class="icon"><use href="#i-receipt"/></svg><span>سند صرف</span></button>`:''}<button class="btn btn-ghost btn-sm btn-icon" title="تعديل" data-edit-movement="${m.id}"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" title="حذف" data-delete-movement="${m.id}"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function filteredMovements() {
    const from=$('#movementDateFrom')?.value||'', to=$('#movementDateTo')?.value||'', type=$('#movementTypeFilter')?.value||'', projectFilter=$('#movementProjectFilter')?.value||'';
    return state.movements.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to)&&(!type||m.type===type)&&(!projectFilter||(projectFilter==='__none'?!m.projectId:m.projectId===projectFilter))).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  }
  function renderMovements() {
    const list=filteredMovements();
    $('#movementsTotals').innerHTML=CURRENCIES.map(c=>{const i=movementTotal(list,c,'in'),o=movementTotal(list,c,'out');return `<div class="mini-card"><small>${CURRENCY_META[c].label} — صافي</small><strong>${formatMoney(i-o,c,true)}</strong><div style="font-size:10px;margin-top:4px"><span class="money-in">+ ${formatMoney(i,c,true)}</span> <span class="money-out">− ${formatMoney(o,c,true)}</span></div></div>`}).join('');
    $('#movementsTable').innerHTML=list.length?movementsTableMarkup(list):`<div class="empty">لا توجد حركات ضمن الفلتر المحدد.</div>`;
  }

  function renderArrears() {
    const cutoff=$('#arrearsCutoff')?.value||currentMonth();
    if ($('#arrearsCutoff') && !$('#arrearsCutoff').value) $('#arrearsCutoff').value=cutoff;
    const buildingFilter=$('#arrearsBuildingFilter')?.value||'';
    const rows=state.tenants.filter(t=>isTenantActive(t)&&(!buildingFilter||t.buildingId===buildingFilter)).map(t=>({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n);
    $('#arrearsSummary').innerHTML=CURRENCIES.map(c=>{const same=rows.filter(r=>r.currency===c);const total=same.reduce((s,r)=>s+r.due,0n);return `<div class="mini-card"><small>${CURRENCY_META[c].label} متأخر</small><strong>${formatMoney(total,c,true)}</strong><div class="stat-note">${same.length} مستأجر</div></div>`}).join('');
    $('#arrearsTable').innerHTML=rows.length?`<table><thead><tr><th>المستأجر</th><th>العقار</th><th>قيمة الإيجار</th><th>بداية العقد</th><th>نهاية العقد</th><th>الأشهر المطلوبة</th><th>عدد الأشهر</th><th>المستحق</th><th>إجراءات التواصل</th></tr></thead><tbody>${rows.map(r=>{const t=r.tenant,b=buildingById(t.buildingId),hasPhone=!!String(t.phone||'').trim();return `<tr><td><strong>${escapeHtml(t.name)}</strong><br><small>${escapeHtml(t.phone||'بدون رقم')}</small></td><td>${escapeHtml(b?.name||'—')}</td><td>${formatMoney(t.rentAmount,t.rentCurrency)}</td><td>${monthLabel(t.startMonth)}</td><td>${monthLabel(r.contractEnd)}</td><td><div class="month-chips">${r.months.map(x=>`<span class="month-chip">${monthLabel(x.month)} — ${formatMoney(x.due,r.currency,true)}</span>`).join('')}</div></td><td><span class="badge badge-red">${r.months.length} شهر</span></td><td><strong class="money-out">${formatMoney(r.due,r.currency,true)}</strong></td><td><div class="actions arrears-contact-actions"><button class="btn btn-primary btn-sm" data-pay-arrears="${t.id}" data-first-month="${r.months[0]?.month||''}">تسجيل دفعة</button><button class="btn btn-whatsapp btn-sm" data-arrears-whatsapp="${t.id}" ${hasPhone?'':'disabled'}>واتساب</button><button class="btn btn-ghost btn-sm" data-arrears-sms="${t.id}" ${hasPhone?'':'disabled'}>رسالة جوال</button></div></td></tr>`}).join('')}</tbody></table>`:`<div class="empty">لا توجد متأخرات حتى ${monthLabel(cutoff)}.</div>`;
  }

  function tenantArrearsMessage(tenantId) {
    const t=tenantById(tenantId); if(!t)return '';
    const cutoff=$('#arrearsCutoff')?.value||currentMonth();
    const a=calculateTenantArrears(t,cutoff);
    const b=buildingById(t.buildingId);
    const firstDueMonth=a.months[0]?.month||cutoff;
    const dueDay=Math.min(28,Math.max(1,Number(state.settings.rentDueDay||1)));
    const [dueYear,dueMonth]=String(firstDueMonth).split('-');
    const dueDate=(dueYear&&dueMonth)?`${dueYear}/${dueMonth}/${String(dueDay).padStart(2,'0')}`:'—';
    const unitText=String(t.direction||'').trim();
    const buildingText=String(b?.name||'').trim();
    const rentalPlace=unitText&&buildingText?`عن الشقة ${unitText} من عمارة ${buildingText}`:buildingText?`عن الشقة في عمارة ${buildingText}`:unitText?`عن الشقة ${unitText}`:'عن الوحدة المؤجرة';
    const currencyLabel=CURRENCY_META[a.currency]?.label||a.currency||'';
    return `السيد/ة ${t.name} المحترم،
تحية طيبة،
نحيطكم علماً بأنه قد حان موعد سداد الدفعة الإيجارية المستحقة ${rentalPlace} بقيمة ${formatMoney(a.due,a.currency,true)}${currencyLabel?` ${currencyLabel}`:''}، والمستحقة بتاريخ ${dueDate}.
يرجى العمل على تسوية الرصيد في أقرب وقت لتحديث سجلاتكم المالية لدينا.

باحترام،
إدارة شركة شهد للتجارة العامة والمقاولات`;
  }

  function sendArrearsWhatsApp(tenantId) {
    const t=tenantById(tenantId); if(!t)return;
    const number=normalizeWhatsAppNumber(t.phone||'');
    if(!number){toast('لا يوجد رقم جوال محفوظ لهذا المستأجر.','error');return;}
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(tenantArrearsMessage(tenantId))}`,'_blank','noopener');
  }

  function sendArrearsSms(tenantId) {
    const t=tenantById(tenantId); if(!t)return;
    const phone=String(t.phone||'').trim().replace(/[^0-9+]/g,'');
    if(!phone){toast('لا يوجد رقم جوال محفوظ لهذا المستأجر.','error');return;}
    const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';
    window.location.href=`sms:${phone}${separator}body=${encodeURIComponent(tenantArrearsMessage(tenantId))}`;
  }

  async function exportArrearsPdf() {
    if(!requirePermission('reports.export'))return;
    const cutoff=$('#arrearsCutoff')?.value||currentMonth();
    const buildingFilter=$('#arrearsBuildingFilter')?.value||'';
    const rows=state.tenants.filter(t=>isTenantActive(t)&&(!buildingFilter||t.buildingId===buildingFilter)).map(t=>({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n);
    if(!rows.length){toast('لا توجد متأخرات ضمن الفلتر الحالي لتصديرها.','info');return;}
    const button=$('#exportArrearsPdfBtn');if(button)button.disabled=true;
    try{
      try{await document.fonts?.ready}catch(_){ }
      const W=1240,H=1754,M=70;
      const brand='#0b67b2',danger='#bb2d3b',text='#152033',muted='#69778d',line='#dbe4ee',soft='#f4f8fc';
      let logo=null;
      try{logo=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='shahd-logo.jpg';if(img.complete&&img.naturalWidth)resolve(img)})}catch(_){logo=null}
      const totalByCurrency=Object.fromEntries(CURRENCIES.map(c=>[c,rows.filter(r=>r.currency===c).reduce((sum,r)=>sum+r.due,0n)]));
      const buildingName=buildingFilter?(buildingById(buildingFilter)?.name||'العقار المحدد'):'جميع العقارات';
      const pages=[];
      const firstCount=6, nextCount=9;
      let start=0,pageNo=1;
      while(start<rows.length){
        const isFirst=pageNo===1,count=isFirst?firstCount:nextCount,chunk=rows.slice(start,start+count);
        const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);ctx.direction='rtl';ctx.textBaseline='alphabetic';
        const font=(weight,size)=>`${weight} ${size}px Cairo, Arial, sans-serif`;
        const write=(value,x,y,size=28,weight=600,color=text,align='right')=>{ctx.font=font(weight,size);ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(value??''),x,y)};
        const rounded=(x,y,w,h,r,fill,stroke='')=>{ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y)}ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}};
        const wrap=(value,maxWidth,size=22,weight=500,maxLines=2)=>{ctx.font=font(weight,size);const words=String(value||'').split(/\s+/),lines=[];let cur='';for(const word of words){const test=cur?`${cur} ${word}`:word;if(ctx.measureText(test).width<=maxWidth)cur=test;else{if(cur)lines.push(cur);cur=word;if(lines.length>=maxLines-1)break}}if(cur&&lines.length<maxLines)lines.push(cur);return lines};
        let y=M;
        if(logo){const ratio=logo.naturalWidth/logo.naturalHeight,lh=120,lw=Math.min(290,lh*ratio);ctx.drawImage(logo,W-M-lw,y,lw,lh)}
        write('تقرير متأخرات المستأجرين',M,y+52,42,800,brand,'left');
        write(`حتى شهر: ${monthLabel(cutoff)}`,M,y+94,23,600,muted,'left');
        write(`النطاق: ${buildingName}`,M,y+128,21,500,muted,'left');
        y+=165;ctx.strokeStyle=line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(M,y);ctx.lineTo(W-M,y);ctx.stroke();y+=30;
        if(isFirst){
          const gap=16,cw=(W-2*M-gap)/2,ch=104;
          CURRENCIES.forEach((c,i)=>{const col=i%2,row=Math.floor(i/2),x=M+col*(cw+gap),cy=y+row*(ch+gap);rounded(x,cy,cw,ch,18,soft,line);write(`${CURRENCY_META[c].label} - إجمالي المتأخر`,x+cw-22,cy+36,20,700,muted);write(formatMoney(totalByCurrency[c],c,true),x+cw-22,cy+78,28,800,totalByCurrency[c]>0n?danger:brand)});
          y+=2*(ch+gap)+18;
        }
        chunk.forEach((r,i)=>{
          const t=r.tenant,b=buildingById(t.buildingId),rh=142;
          rounded(M,y,W-2*M,rh,18,i%2===0?'#ffffff':soft,line);
          const right=W-M-24;
          write(t.name,right,y+34,25,800,text);
          write(t.phone||'بدون رقم جوال',right,y+67,18,500,muted);
          const loc=[b?.name,t.direction].filter(Boolean).join(' - ')||'بدون تحديد';
          write(loc,right,y+100,19,600,brand);
          write(`المستحق: ${formatMoney(r.due,r.currency,true)}`,M+24,y+38,24,800,danger,'left');
          write(`الإيجار: ${formatMoney(t.rentAmount,t.rentCurrency)}`,M+24,y+72,18,600,muted,'left');
          write(`${r.months.length} شهر متأخر`,M+24,y+103,18,700,danger,'left');
          const monthText=`الأشهر: ${r.months.map(x=>monthLabel(x.month)).join('، ')}`;
          const lines=wrap(monthText,W-2*M-48,16,500,2);lines.forEach((ln,j)=>write(ln,right,y+126+j*20,16,500,muted));
          y+=rh+14;
        });
        write(`تاريخ إصدار التقرير: ${dateLabel(today())}`,W-M,H-45,17,500,muted);
        write(`صفحة ${pageNo}`,M,H-45,17,600,muted,'left');
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));if(!blob)throw new Error('تعذر تجهيز صفحة التقرير.');
        pages.push({blob,width:W,height:H});start+=chunk.length;pageNo++;
      }
      const pdfBlob=await jpegPagesToPdf(pages);
      const fileName=`shahd-arrears-${cutoff}-${today()}.pdf`;
      const file=typeof File!=='undefined'?new File([pdfBlob],fileName,{type:'application/pdf'}):null;
      if(file&&navigator.share&&navigator.canShare?.({files:[file]})){
        try{await navigator.share({title:'تقرير متأخرات المستأجرين',text:`تقرير المتأخرات حتى ${monthLabel(cutoff)}`,files:[file]});toast('تم تجهيز تقرير PDF للمشاركة.');return}catch(err){if(err?.name==='AbortError')return}
      }
      downloadBlob(pdfBlob,fileName);toast('تم إنشاء تقرير المتأخرات PDF.');
    }catch(err){toast(err?.message||'تعذر إنشاء تقرير PDF.','error')}
    finally{if(button)button.disabled=false}
  }

  async function jpegPagesToPdf(pages) {
    const enc=new TextEncoder(),chunks=[];let offset=0;const offsets=[0];
    const push=value=>{const bytes=typeof value==='string'?enc.encode(value):value;chunks.push(bytes);offset+=bytes.length};
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const pageIds=pages.map((_,i)=>3+i*3);
    const objectCount=2+pages.length*3;
    const obj=(id,bodyParts)=>{offsets[id]=offset;push(`${id} 0 obj\n`);for(const part of bodyParts)push(part);push('\nendobj\n')};
    obj(1,[`<< /Type /Catalog /Pages 2 0 R >>`]);
    obj(2,[`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`]);
    for(let i=0;i<pages.length;i++){
      const pageId=3+i*3,imgId=pageId+1,contentId=pageId+2,p=pages[i];
      const jpeg=new Uint8Array(await p.blob.arrayBuffer());
      obj(pageId,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im${i+1} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`]);
      obj(imgId,[`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,jpeg,'\nendstream']);
      const stream=`q\n595.28 0 0 841.89 0 0 cm\n/Im${i+1} Do\nQ\n`,bytes=enc.encode(stream);
      obj(contentId,[`<< /Length ${bytes.length} >>\nstream\n`,bytes,'endstream']);
    }
    const xref=offset;push(`xref\n0 ${objectCount+1}\n0000000000 65535 f \n`);for(let i=1;i<=objectCount;i++)push(`${String(offsets[i]||0).padStart(10,'0')} 00000 n \n`);push(`trailer\n<< /Size ${objectCount+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(chunks,{type:'application/pdf'});
  }

  // v22 compatibility: debt reports use the same internal PDF builder as arrears reports.
  // Keep this alias so older cached handlers cannot fail with an undefined function.
  async function buildPdfFromJpegPages(pages) {
    return jpegPagesToPdf(pages);
  }

  function debtPaidUnits(debt) {
    return state.debtPayments.filter(p=>p.debtId===debt.id && p.currency===debt.currency).reduce((s,p)=>s+toUnits(p.amount,debt.currency),0n);
  }
  function debtRemainingUnits(debt) {
    const total=toUnits(debt.amount,debt.currency), paid=debtPaidUnits(debt); return total>paid?total-paid:0n;
  }
  function renderDebts() {
    const isClosed = activeDebtTab === 'closed';
    const list = state.debts.filter(d => isClosed ? d.status === 'closed' : d.status !== 'closed' && (d.direction || 'receivable') === activeDebtTab).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    $$('#debtTabs .tab').forEach(t=>t.classList.toggle('active',t.dataset.debtTab===activeDebtTab));
    const summaryBase = isClosed ? state.debts.filter(d=>d.status==='closed') : list;
    $('#debtSummary').innerHTML=CURRENCIES.map(c=>{const same=summaryBase.filter(d=>d.currency===c);const total=isClosed?same.reduce((x,d)=>x+toUnits(d.amount,d.currency),0n):same.reduce((x,d)=>x+debtRemainingUnits(d),0n);return `<div class="mini-card"><small>${CURRENCY_META[c].label} ${isClosed?'تم إنهاؤه':'متبقي'}</small><strong>${formatMoney(total,c,true)}</strong><div class="stat-note">${same.length} ${isClosed?'حساب مكتمل':`دين ${activeDebtTab==='receivable'?'لنا':'علينا'}`}</div></div>`}).join('');
    const emptyText=isClosed?'لا توجد ديون تم سدادها وإنهاؤها حتى الآن.':activeDebtTab==='receivable'?'لا توجد ديون لنا مفتوحة.':'لا توجد ديون علينا مفتوحة.';
    $('#debtsTable').innerHTML=list.length?`<table><thead><tr><th>النوع</th><th>المشروع</th><th>الاسم</th><th>الجوال / الهوية</th><th>المبلغ الأصلي</th><th>${isClosed?'تم سداده/تحصيله':'المدفوع/المحصّل'}</th><th>المتبقي</th><th>${isClosed?'تاريخ الإنهاء':'تاريخ الدين'}</th><th>التقسيط / المصدر</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${list.map(d=>{
      const direction=d.direction||'receivable',paid=debtPaidUnits(d),rem=debtRemainingUnits(d),project=projectById(d.projectId),inst=debtInstallmentStatus(d);
      const directionBadge=direction==='receivable'?'<span class="badge badge-green">دين لنا</span>':'<span class="badge badge-red">دين علينا</span>';
      let installment='—';
      if(d.source==='tenant_exit')installment='<span class="badge badge-blue">مرحل من مستأجر سابق</span>';
      if(d.installmentEnabled){const status=inst?.overdue>0n?`<span class="badge badge-red">متأخر ${formatMoney(inst.overdue,inst.currency,true)}</span>`:`<span class="badge badge-green">موعد ${inst?.nextDate?dateLabel(inst.nextDate):'—'}</span>`;installment=`<div class="installment-cell"><strong>${formatMoney(d.installmentAmount,d.currency)} شهرياً</strong><small>يوم ${Number(d.installmentDueDay||1)} من كل شهر</small>${status}</div>`+(d.source==='tenant_exit'?'<br><span class="badge badge-blue">مستأجر سابق</span>':'');}
      return `<tr><td>${directionBadge}</td><td>${project?`<span class="badge badge-blue">${escapeHtml(project.name)}</span>`:'—'}</td><td><strong>${escapeHtml(d.name)}</strong></td><td>${escapeHtml(d.phone||'—')}<br><small>${escapeHtml(d.idNumber||'')}</small></td><td>${formatMoney(d.amount,d.currency)}</td><td class="${direction==='receivable'?'money-in':'money-out'}">${formatMoney(paid,d.currency,true)}</td><td class="${rem>0n?'money-out':'money-in'}">${formatMoney(rem,d.currency,true)}</td><td>${dateLabel(d.status==='closed'?d.completedDate:d.date)}</td><td>${installment}</td><td>${escapeHtml(d.notes||'—')}</td><td><div class="actions debt-row-actions"><button class="btn btn-report btn-sm" data-debt-report="${d.id}"><svg class="icon"><use href="#i-chart"/></svg><span>تقرير تفصيلي</span></button>${d.status!=='closed'?`<button class="btn btn-primary btn-sm" data-debt-payment="${d.id}">${direction==='receivable'?'تحصيل':'سداد'}</button>`:''}${paid>0n?`<button class="btn btn-ghost btn-sm" data-debt-history="${d.id}">السجل</button>`:''}<button class="btn btn-ghost btn-sm btn-icon" data-edit-debt="${d.id}" title="تعديل"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" data-delete-debt="${d.id}" title="حذف"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`;
    }).join('')}</tbody></table>`:`<div class="empty">${emptyText}</div>`;
  }

  function reportMovements() {
    const from=$('#reportFrom')?.value||'', to=$('#reportTo')?.value||'';
    return state.movements.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to));
  }
  function renderReports() {
    const list=reportMovements();
    const cutoff=$('#arrearsCutoff')?.value||currentMonth();
    const arrears=state.tenants.filter(isTenantActive).map(t=>calculateTenantArrears(t,cutoff));
    const openDebts=state.debts.filter(d=>d.status!=='closed');
    const receivableDebts=openDebts.filter(d=>(d.direction||'receivable')==='receivable');
    const payableDebts=openDebts.filter(d=>d.direction==='payable');
    const allIncomingCount=list.filter(m=>CURRENCIES.some(c=>toUnits(m.amounts?.[c]?.in||0,c)>0n)).length;
    const allOutgoingCount=list.filter(m=>CURRENCIES.some(c=>toUnits(m.amounts?.[c]?.out||0,c)>0n)).length;
    $('#reportCards').innerHTML=[
      ['الحركات ضمن الفترة',list.length,'i-swap'],['عمليات وارد',allIncomingCount,'i-receipt'],['ديون لنا',receivableDebts.length,'i-debt'],['ديون علينا',payableDebts.length,'i-debt']
    ].map(([l,v,i])=>`<div class="stat-card"><div class="stat-top"><div class="stat-label">${l}</div><div class="stat-icon"><svg class="icon"><use href="#${i}"/></svg></div></div><div class="stat-value">${v}</div></div>`).join('');
    $('#reportCurrencies').innerHTML=CURRENCIES.map(c=>{const i=movementTotal(list,c,'in'),o=movementTotal(list,c,'out');return `<div class="currency-row"><div class="currency-code">${CURRENCY_META[c].label}</div><div class="money-in"><small>وارد</small>${formatMoney(i,c,true)}</div><div class="money-out"><small>مصروف</small>${formatMoney(o,c,true)}</div><div class="money-balance"><small>الصافي</small>${formatMoney(i-o,c,true)}</div></div>`}).join('');
    const arrearsText=CURRENCIES.map(c=>{const total=arrears.filter(a=>a.currency===c).reduce((s,a)=>s+a.due,0n);return `<div class="report-line"><span>متأخرات ${CURRENCY_META[c].label}</span><strong>${formatMoney(total,c,true)}</strong></div>`}).join('');
    const receivableText=CURRENCIES.map(c=>{const total=receivableDebts.filter(d=>d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n);return `<div class="report-line"><span>ديون لنا — ${CURRENCY_META[c].label}</span><strong class="money-in">${formatMoney(total,c,true)}</strong></div>`}).join('');
    const payableText=CURRENCIES.map(c=>{const total=payableDebts.filter(d=>d.currency===c).reduce((s,d)=>s+debtRemainingUnits(d),0n);return `<div class="report-line"><span>ديون علينا — ${CURRENCY_META[c].label}</span><strong class="money-out">${formatMoney(total,c,true)}</strong></div>`}).join('');
    $('#reportRent').innerHTML=arrearsText+receivableText+payableText;
  }

  function renderSettings() {
    const session=window.ShahdCloud?.getSession?.()||{};
    if($('#settingsSessionUser')) $('#settingsSessionUser').textContent=session.displayName||session.username||'—';
    if($('#settingsSessionCompany')) $('#settingsSessionCompany').textContent=session.companyName||'—';
    const f=$('#settingsForm'); if(!f) return;
    ['companyName','companySubtitle','defaultExecutor','receiptPrefix','whatsappCountryCode','rentDueDay','theme'].forEach(k=>{if(f.elements[k]) f.elements[k].value=state.settings[k]??'';});
  }

  function openBuildingModal(id=null) {
    const existing=id?buildingById(id):null;
    const body=`<div class="form-grid">${fullField('name','اسم العمارة',existing?.name||'','text','required')}${fullField('address','العنوان',existing?.address||'')}${field('apartments','عدد الشقق',existing?.apartments||'','number','min="0" step="1" required')}${field('notes','ملاحظات قصيرة',existing?.notes||'')}</div>`;
    showModal({title:existing?'تعديل بيانات العمارة':'إضافة عمارة جديدة',subtitle:'اسم العمارة، العنوان وعدد الشقق',icon:'i-building',body,onSubmit:(fd)=>{
      const name=String(fd.get('name')||'').trim(); if(!name){toast('أدخل اسم العمارة','error');return false;}
      const record={id:existing?.id||uid('b'),name,address:String(fd.get('address')||'').trim(),apartments:Math.max(0,Number(fd.get('apartments')||0)),notes:String(fd.get('notes')||'').trim(),createdAt:existing?.createdAt||new Date().toISOString()};
      if(existing) Object.assign(existing,record); else state.buildings.push(record);
      saveState(); toast(existing?'تم تحديث بيانات العمارة.':'تمت إضافة العمارة بنجاح.'); return true;
    }});
  }

  function openTenantModal(id=null) {
    if(!state.buildings.length){toast('أضف عمارة أولاً قبل تسجيل المستأجر.','error');navigate('buildings');return;}
    const t=id?tenantById(id):null;
    const buildingOptions=state.buildings.map(b=>({value:b.id,label:b.name}));
    const currencyOptions=CURRENCIES.map(c=>({value:c,label:CURRENCY_META[c].label}));
    const body=`<div class="form-grid">${fullField('name','اسم المستأجر',t?.name||'','text','required')}${field('idNumber','رقم الهوية',t?.idNumber||'')}${field('phone','رقم الجوال',t?.phone||'','tel')}${selectField('buildingId','اسم العمارة',buildingOptions,t?.buildingId||state.buildings[0].id)}${field('floor','الطابق',t?.floor||'')}${field('direction','الاتجاه / رقم الشقة',t?.direction||'')}${field('rentAmount','قيمة الإيجار الشهري',t?.rentAmount||'','number','min="0" step="0.001" required')}${selectField('rentCurrency','عملة الإيجار',currencyOptions,t?.rentCurrency||'ILS')}${field('startMonth','تاريخ بداية الإيجار',t?.startMonth||currentMonth(),'month','required')}${field('contractMonths','مدة العقد بالأشهر',t?.contractMonths||12,'number','min="1" max="120" step="1" required')}${textareaField('notes','ملاحظات',t?.notes||'')}</div><div class="form-note">مثال: عقد يبدأ في مارس لمدة 12 شهراً، وإذا كانت الدفعات مسجلة حتى يونيو والحساب حتى أغسطس، سيظهر يوليو وأغسطس كمتأخرين تلقائياً.</div>`;
    showModal({title:t?'تعديل المستأجر':'إضافة مستأجر',subtitle:'العقد والإيجار الشهري هما أساس حساب المتأخرات',icon:'i-users',body,onSubmit:(fd)=>{
      const currency=fd.get('rentCurrency'); const rent=normalizeAmount(fd.get('rentAmount'),currency);
      if(toUnits(rent,currency)<=0n){toast('قيمة الإيجار يجب أن تكون أكبر من صفر.','error');return false;}
      const rec={id:t?.id||uid('t'),name:String(fd.get('name')||'').trim(),idNumber:String(fd.get('idNumber')||'').trim(),phone:String(fd.get('phone')||'').trim(),buildingId:fd.get('buildingId'),floor:String(fd.get('floor')||'').trim(),direction:String(fd.get('direction')||'').trim(),rentAmount:rent,rentCurrency:currency,startMonth:fd.get('startMonth'),contractMonths:Math.max(1,Number(fd.get('contractMonths')||12)),notes:String(fd.get('notes')||'').trim(),createdAt:t?.createdAt||new Date().toISOString()};
      if(!rec.name||!rec.startMonth){toast('أكمل الحقول الأساسية.','error');return false;}
      if(t) Object.assign(t,rec); else state.tenants.push(rec);
      saveState(); toast(t?'تم تحديث المستأجر.':'تمت إضافة المستأجر وحفظ عقده.'); return true;
    }});
  }

  function openTenantFilesModal(tenantId){
    const t=tenantById(tenantId);if(!t)return;
    const attachmentRow=(label,meta,kind)=>`<div class="attachment-row"><div><small>${label}</small><strong>${meta?.name?escapeHtml(meta.name):'غير مضاف'}</strong>${meta?.pending?'<span class="badge badge-amber">بانتظار الإنترنت</span>':meta?.telegramFileId?'<span class="badge badge-green">محفوظ على Telegram</span>':''}</div>${meta?`<button class="btn btn-ghost btn-sm" type="button" data-open-tenant-attachment="${t.id}" data-attachment-kind="${kind}">عرض</button>`:''}</div>`;
    const body=`<div class="attachment-list">${attachmentRow('عقد الإيجار',t.contractAttachment,'contract')}${attachmentRow('صورة الهوية',t.identityAttachment,'identity')}</div><div class="form-grid tenant-files-form">${fullField('contractFile','إضافة / استبدال عقد الإيجار','','file','accept="image/*,.pdf,application/pdf"')}${fullField('identityFile','إضافة / استبدال صورة الهوية','','file','accept="image/*"')}</div><div class="form-note">الملفات نفسها لا تُحفظ في Turso. عند توفر الإنترنت تُرفع إلى نفس بوت الصور المستخدم في كاش توب، ويُحفظ في بيانات شهد معرف Telegram فقط. بدون إنترنت تُحفظ مؤقتاً داخل IndexedDB ثم تُرفع تلقائياً.</div>`;
    const {form,close}=showModal({title:'عقد الإيجار وصورة الهوية',subtitle:t.name,icon:'i-file',body,size:'lg',submitText:'حفظ الملفات',onSubmit:(fd,formEl)=>{(async()=>{
      const contract=formEl.elements.contractFile?.files?.[0],identity=formEl.elements.identityFile?.files?.[0];
      if(!contract&&!identity){toast('اختر عقد الإيجار أو صورة الهوية أولاً.','error');return;}
      const submit=formEl.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
      try{
        if(contract)t.contractAttachment=await window.ShahdMedia.saveFile('tenant',t.id,'contract',contract,t.contractAttachment);
        if(identity)t.identityAttachment=await window.ShahdMedia.saveFile('tenant',t.id,'identity',identity,t.identityAttachment);
        t.updatedAt=new Date().toISOString();saveState();close();toast((t.contractAttachment?.pending||t.identityAttachment?.pending)?'تم حفظ الملفات محلياً وستُرفع إلى Telegram تلقائياً عند عودة الإنترنت.':'تم حفظ الملفات على Telegram وربطها بالمستأجر.');
      }catch(err){toast(err?.message||'تعذر حفظ الملف.','error');if(submit)submit.disabled=false;}
    })();return false;}});
  }

  function endTenantContract(tenantId){
    const t=tenantById(tenantId);if(!t||!isTenantActive(t))return;
    const defaultMonth=currentMonth(),preview=calculateTenantArrears(t,defaultMonth);
    const body=`<div class="tenant-exit-card"><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(buildingById(t.buildingId)?.name||'')}</span><p>المتبقي المحسوب حتى ${monthLabel(defaultMonth)}: <b class="money-out">${formatMoney(preview.due,preview.currency,true)}</b></p></div><div class="form-grid">${field('endedDate','تاريخ الخروج',today(),'date','required')}${field('endedMonth','احتساب الإيجار حتى شهر',defaultMonth,'month','required')}${textareaField('exitNotes','ملاحظات إنهاء العقد','')}</div><div class="form-note">إذا بقي مبلغ على المستأجر سيُنشأ تلقائياً في «ديون لنا» ويظل مرتبطاً بالمستأجر والعقار. إذا كان الرصيد صفراً سينتقل إلى «المستأجرين القدامى - خالص».</div>`;
    showModal({title:'إنهاء عقد المستأجر',subtitle:'أرشفة العقد مع ترحيل المتبقي للديون',icon:'i-check',body,submitText:'إنهاء العقد',onSubmit:(fd)=>{
      const endedDate=fd.get('endedDate')||today(),endedMonth=fd.get('endedMonth')||String(endedDate).slice(0,7),arrears=calculateTenantArrears(t,endedMonth);
      t.status='former';t.endedDate=endedDate;t.endedMonth=endedMonth;t.exitNotes=String(fd.get('exitNotes')||'').trim();t.updatedAt=new Date().toISOString();
      if(arrears.due>0n){
        let d=tenantExitDebt(t);
        const debtData={direction:'receivable',projectId:'',tenantId:t.id,buildingId:t.buildingId,source:'tenant_exit',name:t.name,phone:t.phone||'',idNumber:t.idNumber||'',date:endedDate,amount:unitsToDecimal(arrears.due,arrears.currency,false),currency:arrears.currency,notes:`متبقي إيجار عند انتهاء العقد${t.exitNotes?` — ${t.exitNotes}`:''}`,status:'open',completedDate:'',installmentEnabled:false,createdAt:d?.createdAt||new Date().toISOString()};
        if(d)Object.assign(d,debtData);else{d={id:uid('d'),...debtData};state.debts.push(d);}t.exitDebtId=d.id;activeTenantTab='former_debt';
        saveState();toast(`تم إنهاء العقد وترحيل ${formatMoney(arrears.due,arrears.currency,true)} إلى «ديون لنا».`);
      }else{t.exitDebtId='';activeTenantTab='former_clear';saveState();toast('تم إنهاء العقد ونقل المستأجر إلى «المستأجرين القدامى - خالص».');}
      return true;
    }});
  }

  function entityStatementMovements(kind,id,from='',to=''){
    return state.movements.filter(m=>{
      const d=m.debtId?debtById(m.debtId):null;
      const linked=kind==='tenant'?(m.tenantId===id||d?.tenantId===id):(m.buildingId===id||d?.buildingId===id);
      return linked&&(!from||m.date>=from)&&(!to||m.date<=to);
    }).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.createdAt||'').localeCompare(b.createdAt||''));
  }

  function statementMarkup(kind,id,from='',to=''){
    const list=entityStatementMovements(kind,id,from,to);
    const totals=CURRENCIES.map(c=>({c,in:movementTotal(list,c,'in'),out:movementTotal(list,c,'out')}));
    const cards=totals.map(x=>`<div class="mini-card"><small>${CURRENCY_META[x.c].label}</small><strong class="money-balance">${formatMoney(x.in-x.out,x.c,true)}</strong><div class="statement-mini"><span class="money-in">وارد ${formatMoney(x.in,x.c,true)}</span><span class="money-out">مصروف ${formatMoney(x.out,x.c,true)}</span></div></div>`).join('');
    const rows=list.map(m=>{const ins=CURRENCIES.map(c=>toUnits(m.amounts?.[c]?.in||0,c)>0n?formatMoney(m.amounts[c].in,c):'').filter(Boolean).join(' + ')||'—',outs=CURRENCIES.map(c=>toUnits(m.amounts?.[c]?.out||0,c)>0n?formatMoney(m.amounts[c].out,c):'').filter(Boolean).join(' + ')||'—';return `<tr><td>${dateLabel(m.date)}</td><td>${m.type==='rent'?'إيجار':'حركة مالية'}</td><td>${escapeHtml(m.detail||'—')}</td><td class="money-in">${ins}</td><td class="money-out">${outs}</td><td>${paymentMethodLabel(m.paymentMethod)}${m.bankWallet?`<br><small>${escapeHtml(m.bankWallet)}</small>`:''}</td><td>${escapeHtml(m.referenceNo||'—')}</td><td>${escapeHtml(m.executor||'—')}</td></tr>`}).join('');
    return `<div class="mini-stats statement-totals">${cards}</div><div class="table-wrap"><table style="min-width:980px"><thead><tr><th>التاريخ</th><th>النوع</th><th>التفاصيل</th><th>الوارد</th><th>المصروف</th><th>طريقة الدفع</th><th>المرجع</th><th>المنفذ</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="empty">لا توجد حركات ضمن الفترة المحددة.</td></tr>'}</tbody></table></div>`;
  }

  function openEntityStatement(kind,id){
    const entity=kind==='tenant'?tenantById(id):buildingById(id);if(!entity)return;
    const firstDate=entityStatementMovements(kind,id).map(m=>m.date).filter(Boolean).sort()[0]||`${new Date().getFullYear()}-01-01`;
    const body=`<div class="statement-filter form-grid">${field('statementFrom','من تاريخ',firstDate,'date')}${field('statementTo','إلى تاريخ',today(),'date')}</div><div id="entityStatementContent"></div>`;
    const {form}=showModal({title:`كشف حساب ${kind==='tenant'?'المستأجر':'العقار'}`,subtitle:entity.name,icon:'i-chart',body,size:'lg',hideSubmit:true,extraFooter:'<button class="btn btn-primary" type="button" id="statementPdfBtn"><svg class="icon"><use href="#i-download"/></svg>PDF بالشعار</button>'});
    const from=form.elements.statementFrom,to=form.elements.statementTo,render=()=>{$('#entityStatementContent',form).innerHTML=statementMarkup(kind,id,from.value,to.value)};from.addEventListener('change',render);to.addEventListener('change',render);render();
    $('#statementPdfBtn',form)?.addEventListener('click',()=>exportEntityStatementPdf(kind,id,from.value,to.value));
  }

  async function exportEntityStatementPdf(kind,id,from='',to=''){
    if(!requirePermission('reports.export'))return;
    const entity=kind==='tenant'?tenantById(id):buildingById(id);if(!entity)return;
    const list=entityStatementMovements(kind,id,from,to);try{await document.fonts?.ready}catch(_){}
    try{
      const W=1240,H=1754,M=62,brand='#0b4d8f',text='#172033',muted='#6b778c',line='#dfe6ef',soft='#f4f7fb',green='#0f9d71',danger='#d9394b';let logo=null;try{logo=await loadImage('shahd-logo.jpg')}catch(_){}
      const perPage=13,pages=Math.max(1,Math.ceil(list.length/perPage)),blobs=[];
      const totals=Object.fromEntries(CURRENCIES.map(c=>[c,{in:movementTotal(list,c,'in'),out:movementTotal(list,c,'out')}]))
      for(let pi=0;pi<pages;pi++){
        const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle=brand;ctx.fillRect(0,0,W,20);
        if(logo){const maxW=300,maxH=125,r=Math.min(maxW/logo.width,maxH/logo.height);ctx.drawImage(logo,W-M-logo.width*r,44,logo.width*r,logo.height*r)}
        ctx.fillStyle=text;ctx.font='800 40px Cairo, Arial';ctx.fillText(`كشف حساب ${kind==='tenant'?'مستأجر':'عقار'}`,W-M,220);ctx.fillStyle=muted;ctx.font='600 23px Cairo, Arial';ctx.fillText(entity.name,W-M,260);ctx.font='500 18px Cairo, Arial';ctx.fillText(`الفترة: ${from?dateLabel(from):'البداية'} إلى ${to?dateLabel(to):'اليوم'}`,W-M,294);
        let y=335;CURRENCIES.forEach((c,i)=>{const x=M+(i%2)*540,yy=y+Math.floor(i/2)*78;ctx.fillStyle=soft;roundRect(ctx,x,yy,520,62,12,true,false);ctx.fillStyle=muted;ctx.font='600 16px Cairo, Arial';ctx.textAlign='left';ctx.fillText(CURRENCY_META[c].label,x+18,yy+25);ctx.fillStyle=green;ctx.fillText(`وارد ${formatMoney(totals[c].in,c,true)}`,x+170,yy+25);ctx.fillStyle=danger;ctx.fillText(`مصروف ${formatMoney(totals[c].out,c,true)}`,x+340,yy+25);ctx.textAlign='right'});y+=175;
        ctx.fillStyle=brand;roundRect(ctx,M,y,W-2*M,54,10,true,false);ctx.fillStyle='#fff';ctx.font='700 16px Cairo, Arial';const cols=[['التاريخ',W-M-20],['التفاصيل',W-M-155],['الوارد',W-M-520],['المصروف',W-M-710],['الدفع/المرجع',W-M-890],['المنفذ',W-M-1080]];cols.forEach(([v,x])=>ctx.fillText(v,x,y+34));y+=66;
        const slice=list.slice(pi*perPage,(pi+1)*perPage);if(!slice.length){ctx.fillStyle=muted;ctx.font='500 20px Cairo, Arial';ctx.fillText('لا توجد حركات ضمن الفترة المحددة.',W-M,y+40)}
        slice.forEach((m,idx)=>{const rh=78;ctx.fillStyle=idx%2?soft:'#fff';ctx.fillRect(M,y-7,W-2*M,rh);ctx.fillStyle=text;ctx.font='500 15px Cairo, Arial';ctx.fillText(dateLabel(m.date),W-M-20,y+24);ctx.fillText(String(m.detail||'—').slice(0,34),W-M-155,y+24);const ins=CURRENCIES.map(c=>toUnits(m.amounts?.[c]?.in||0,c)>0n?formatMoney(m.amounts[c].in,c):'').filter(Boolean).join(' + ')||'—',outs=CURRENCIES.map(c=>toUnits(m.amounts?.[c]?.out||0,c)>0n?formatMoney(m.amounts[c].out,c):'').filter(Boolean).join(' + ')||'—';ctx.fillStyle=green;ctx.fillText(ins,W-M-520,y+24);ctx.fillStyle=danger;ctx.fillText(outs,W-M-710,y+24);ctx.fillStyle=text;ctx.fillText(`${paymentMethodLabel(m.paymentMethod)}${m.referenceNo?` / ${m.referenceNo}`:''}`.slice(0,25),W-M-890,y+24);ctx.fillText(String(m.executor||'—').slice(0,18),W-M-1080,y+24);y+=rh});
        ctx.fillStyle=muted;ctx.font='500 15px Cairo, Arial';ctx.fillText(`${state.settings.companyName} • صفحة ${pi+1} من ${pages}`,W-M,H-42);const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.92));if(blob)blobs.push({blob,width:W,height:H});
      }
      const pdf=await jpegPagesToPdf(blobs),safe=String(entity.name).replace(/[\\/:*?"<>|]+/g,'-').slice(0,40);downloadBlob(pdf,`statement-${safe}-${from||'all'}-${to||today()}.pdf`);toast('تم إنشاء كشف الحساب PDF مع شعار الشركة.');
    }catch(err){toast(err?.message||'تعذر إنشاء كشف الحساب.','error')}
  }

  function moneyInputs(existingAmounts=null) {
    const amounts=existingAmounts||emptyAmounts();
    return `<div class="money-grid">${CURRENCIES.map(c=>`<div class="money-box" data-currency-box="${c}"><h4>مبالغ ${CURRENCY_META[c].label} ${CURRENCY_META[c].symbol}</h4><div class="money-fields"><div class="money-field in"><label>وارد ${CURRENCY_META[c].label}</label><input class="input money-input" name="${c}_in" type="number" min="0" step="${c==='ILS'||c==='USD'?'0.01':'0.001'}" value="${escapeHtml(amounts[c]?.in||'0')}" /></div><div class="money-field out"><label>مصروف ${CURRENCY_META[c].label}</label><input class="input money-input" name="${c}_out" type="number" min="0" step="${c==='ILS'||c==='USD'?'0.01':'0.001'}" value="${escapeHtml(amounts[c]?.out||'0')}" /></div></div></div>`).join('')}</div>`;
  }

  function openMovementModal(id=null, prefill={}) {
    const m=id?state.movements.find(x=>x.id===id):null;
    const type=prefill.type||m?.type||'general';
    const buildingOptions=[{value:'',label:'مركزي / عام'},...state.buildings.map(b=>({value:b.id,label:b.name}))];
    const projectOptions=[{value:'',label:'بدون مشروع / حساب عام'},...state.projects.map(p=>({value:p.id,label:p.name}))];
    const tenantOptions=[{value:'',label:'-- اختر المستأجر --'},...state.tenants.filter(isTenantActive).map(t=>({value:t.id,label:`${t.name} — ${buildingById(t.buildingId)?.name||''}`}))];
    const amounts=m?.amounts||emptyAmounts();
    const rentMonth=prefill.rentMonth||m?.rentMonths?.[0]||m?.rentMonth||currentMonth();
    const rentCount=m?.rentMonths?.length||1;
    const selectedTenant=tenantById(prefill.tenantId||m?.tenantId||'');
    const rentCurrency=selectedTenant?.rentCurrency||'ILS';
    const rentReceived=m?unitsToDecimal(toUnits(m.amounts?.[rentCurrency]?.in||0,rentCurrency),rentCurrency,false):'';
    const flowNote=prefill.flow==='out'?'<div class="form-note voucher-flow-note">سند صرف: أدخل قيمة العملية في خانة «مصروف» للعملة المطلوبة، وسيظهر سند صرف بعد الحفظ.</div>':'';
    const body=`<div class="form-grid"><label class="field full"><span>نوع الحركة المالية</span><select class="select" name="type" id="movementType"><option value="general" ${type==='general'?'selected':''}>حركة يومية عامة (مصروف / وارد)</option><option value="rent" ${type==='rent'?'selected':''}>تحصيل إيجار مستأجر</option></select></label>${field('date','تاريخ الحركة',m?.date||today(),'date','required')}${field('executor','المنفذ',m?.executor||currentExecutor(),'text','readonly')}${financialMetaFields(m||{})}${selectField('projectId','المشروع',projectOptions,prefill.projectId||m?.projectId||'','full')}${selectField('buildingId','المجال / الحساب / العمارة',buildingOptions,m?.buildingId||'','full')}<div class="full" id="rentFields" style="display:none"><div class="money-box rent-payment-box"><div class="form-grid" style="padding:0">${selectField('tenantId','اختر المستأجر',tenantOptions,prefill.tenantId||m?.tenantId||'')}${field('rentMonth','من شهر',rentMonth,'month')}${field('rentCount','عدد الأشهر',rentCount,'number','min="1" max="24" step="1"')}${field('rentExpected','قيمة الإيجار قبل الخصم',m?.rentExpectedAmount||'','number','readonly')}${field('rentDiscount','خصم لمرة واحدة',m?.rentDiscount||'0','number','min="0" step="0.001"')}${field('rentReceived','المبلغ المقبوض فعلياً',rentReceived,'number','min="0" step="0.001" required')}<div class="field full"><span>التسوية</span><div class="form-note">الخصم يخفض المتأخرات لكنه لا يُسجل كأموال واردة. سند القبض يعرض القيمة قبل الخصم والخصم والمبلغ الذي تم استلامه فعلياً.</div></div></div></div></div>${fullField('detail','البيان التوضيحي والتفاصيل',m?.detail||'')}${textareaField('notes','ملاحظات',m?.notes||'')}</div>${flowNote}<div id="generalMoneyFields">${moneyInputs(amounts)}</div>`;
    const {form}=showModal({title:m?'تعديل الحركة المالية':prefill.flow==='out'?'سند صرف جديد':'تسجيل حركة يومية / دفعة مستأجر',subtitle:'نقدي أو بنكي مع مرجع واسم البنك/المحفظة',icon:'i-receipt',body,size:'lg',submitText:m?'حفظ التعديل':prefill.flow==='out'?'حفظ سند الصرف':'حفظ الحركة المالية',onSubmit:(fd,_form,closeModal)=>{
      const movementType=fd.get('type');
      const outAmounts=emptyAmounts();let any=false,tenantId='',rentMonths=[],rentDiscount='0',rentExpectedAmount='';let buildingId=fd.get('buildingId')||'';
      if(movementType==='rent'){
        tenantId=fd.get('tenantId')||'';const tenant=tenantById(tenantId);if(!tenant){toast('اختر المستأجر.','error');return false;}
        const start=fd.get('rentMonth'),count=Math.max(1,Number(fd.get('rentCount')||1));if(!start){toast('حدد الشهر الذي تبدأ منه الدفعة.','error');return false;}
        rentMonths=monthRange(start,count);buildingId=tenant.buildingId;const c=tenant.rentCurrency;
        rentDiscount=normalizeAmount(fd.get('rentDiscount')||0,c);rentExpectedAmount=normalizeAmount(fd.get('rentExpected')||0,c);const received=normalizeAmount(fd.get('rentReceived')||0,c);
        if(toUnits(received,c)<=0n&&toUnits(rentDiscount,c)<=0n){toast('أدخل المبلغ المقبوض أو قيمة الخصم.','error');return false;}
        outAmounts[c].in=received;any=true;
      }else{
        CURRENCIES.forEach(c=>{outAmounts[c].in=normalizeAmount(fd.get(`${c}_in`)||0,c);outAmounts[c].out=normalizeAmount(fd.get(`${c}_out`)||0,c);if(toUnits(outAmounts[c].in,c)>0n||toUnits(outAmounts[c].out,c)>0n)any=true;});
        if(!any){toast('أدخل مبلغاً واحداً على الأقل في الوارد أو المصروف.','error');return false;}
      }
      const paymentMethod=fd.get('paymentMethod')==='bank'?'bank':'cash',referenceNo=String(fd.get('referenceNo')||'').trim(),bankWallet=String(fd.get('bankWallet')||'').trim();
      if(paymentMethod==='bank'&&!bankWallet){toast('أدخل اسم البنك أو المحفظة للعملية البنكية.','error');return false;}
      const rec={id:m?.id||uid('m'),type:movementType,date:fd.get('date')||today(),executor:currentExecutor(),paymentMethod,referenceNo,bankWallet,projectId:fd.get('projectId')||'',buildingId,tenantId,rentMonths,rentDiscount,rentExpectedAmount,detail:String(fd.get('detail')||'').trim() || (movementType==='rent'?'دفعة إيجار':prefill.flow==='out'?'سند صرف':'حركة مالية'),notes:String(fd.get('notes')||'').trim(),amounts:outAmounts,receiptNo:m?.receiptNo||makeReceiptNo(),createdAt:m?.createdAt||new Date().toISOString()};
      if(m)Object.assign(m,rec);else state.movements.push(rec);saveState();toast(m?'تم تعديل الحركة المالية.':'تم حفظ الحركة المالية بنجاح.');
      const hasIncoming=CURRENCIES.some(c=>toUnits(rec.amounts?.[c]?.in||0,c)>0n),hasOutgoing=CURRENCIES.some(c=>toUnits(rec.amounts?.[c]?.out||0,c)>0n);
      if(!m&&movementType==='rent'&&hasIncoming){closeModal();setTimeout(()=>openReceiptActions(rec.id),80);return false;}
      if(!m&&prefill.flow==='out'&&hasOutgoing){closeModal();setTimeout(()=>openPaymentVoucherActions(rec.id),80);return false;}
      return true;
    }});
    const typeEl=$('#movementType',form),rentFields=$('#rentFields',form),generalMoney=$('#generalMoneyFields',form),tenantEl=$('[name="tenantId"]',form),monthEl=$('[name="rentMonth"]',form),countEl=$('[name="rentCount"]',form),buildingEl=$('[name="buildingId"]',form),expectedEl=$('[name="rentExpected"]',form),discountEl=$('[name="rentDiscount"]',form),receivedEl=$('[name="rentReceived"]',form);
    const toggleRent=()=>{const isRent=typeEl.value==='rent';rentFields.style.display=isRent?'block':'none';generalMoney.style.display=isRent?'none':'block';if(isRent&&!tenantOptions.slice(1).length)toast('لا يوجد مستأجرون حاليون بعد.','info');};
    const autoRent=()=>{if(typeEl.value!=='rent')return;const tenant=tenantById(tenantEl.value);if(!tenant)return;buildingEl.value=tenant.buildingId||'';const count=Math.max(1,Number(countEl.value||1)),total=toUnits(tenant.rentAmount,tenant.rentCurrency)*BigInt(count);expectedEl.value=unitsToDecimal(total,tenant.rentCurrency,false);const discount=toUnits(discountEl.value||0,tenant.rentCurrency),actual=total>discount?total-discount:0n;receivedEl.value=unitsToDecimal(actual,tenant.rentCurrency,false);receivedEl.step=CURRENCY_META[tenant.rentCurrency].precision===2?'0.01':'0.001';discountEl.step=receivedEl.step;};
    typeEl.addEventListener('change',()=>{toggleRent();if(typeEl.value==='rent')autoRent();});tenantEl?.addEventListener('change',autoRent);countEl?.addEventListener('input',autoRent);discountEl?.addEventListener('input',autoRent);monthEl?.addEventListener('change',()=>{});toggleRent();
    if(!m&&type==='rent')setTimeout(autoRent,20);
    if(!m&&prefill.flow==='out')setTimeout(()=>{CURRENCIES.forEach(c=>{const i=$(`[name="${c}_in"]`,form);if(i)i.value=normalizeAmount('0',c);});},0);
  }

  function makeReceiptNo(){return `${state.settings.receiptPrefix||'SH'}-${today().replaceAll('-','')}-${String(state.movements.length+1).padStart(4,'0')}`;}

  function openDebtModal(id=null, prefill={}) {
    const d=id?debtById(id):null;
    const currencyOptions=CURRENCIES.map(c=>({value:c,label:CURRENCY_META[c].label}));
    const projectOptions=[{value:'',label:'بدون مشروع / حساب عام'},...state.projects.map(p=>({value:p.id,label:p.name}))];
    const directionOptions=[{value:'receivable',label:'دين لنا — مبلغ مطلوب لنا من شخص / جهة'},{value:'payable',label:'دين علينا — مبلغ مستحق علينا لشخص / جهة'}];
    const planOptions=[{value:'none',label:'بدون تقسيط شهري'},{value:'monthly',label:'تقسيط شهري مع تنبيه استحقاق'}];
    const body=`<div class="form-grid">${selectField('direction','نوع الدين',directionOptions,prefill.direction||d?.direction||'receivable','full')}${selectField('projectId','المشروع',projectOptions,prefill.projectId||d?.projectId||'','full')}${fullField('name','اسم الشخص / الجهة',d?.name||'','text','required')}${field('phone','رقم الجوال',d?.phone||'','tel')}${field('idNumber','رقم الهوية / المرجع',d?.idNumber||'')}${field('date','تاريخ تسجيل الدين',d?.date||today(),'date','required')}${field('amount','المبلغ الأصلي',d?.amount||'','number','min="0" step="0.001" required')}${selectField('currency','العملة',currencyOptions,d?.currency||'ILS')}${selectField('installmentPlan','طريقة السداد',planOptions,d?.installmentEnabled?'monthly':'none','full')}<div class="full" id="installmentFields"><div class="form-grid installment-box">${field('installmentAmount','قيمة القسط الشهري',d?.installmentAmount||'','number','min="0" step="0.001"')}${field('installmentDueDay','يوم الاستحقاق من كل شهر',d?.installmentDueDay||1,'number','min="1" max="28" step="1"')}${field('installmentStartMonth','بداية التقسيط',d?.installmentStartMonth||String(d?.date||today()).slice(0,7),'month')}</div></div>${textareaField('notes','ملاحظات',d?.notes||'')}</div><div class="form-note">عند اختيار التقسيط الشهري سيظهر تنبيه تلقائي عند حلول موعد القسط أو تأخره، ويُحسب حسب إجمالي التحصيلات/الدفعات المسجلة على الدين.</div>`;
    const {form}=showModal({title:d?'تعديل الدين':'إضافة دين جديد',subtitle:'ديون لنا وعلينا مع إمكانية التقسيط والتنبيهات',icon:'i-debt',body,onSubmit:(fd)=>{
      const c=fd.get('currency'),direction=fd.get('direction')==='payable'?'payable':'receivable',projectId=fd.get('projectId')||'',amount=normalizeAmount(fd.get('amount'),c);
      if(toUnits(amount,c)<=0n){toast('المبلغ يجب أن يكون أكبر من صفر.','error');return false;}
      if(!String(fd.get('name')||'').trim()){toast('أدخل اسم الشخص أو الجهة.','error');return false;}
      if(d&&c!==d.currency&&debtPaidUnits(d)>0n){toast('لا يمكن تغيير عملة دين عليه دفعات مسجلة.','error');return false;}
      if(d&&direction!==(d.direction||'receivable')&&debtPaidUnits(d)>0n){toast('لا يمكن تغيير نوع الدين بعد تسجيل تحصيل أو سداد عليه.','error');return false;}
      if(d&&projectId!==(d.projectId||'')&&debtPaidUnits(d)>0n){toast('لا يمكن نقل الدين إلى مشروع آخر بعد تسجيل تحصيل أو سداد عليه.','error');return false;}
      const installmentEnabled=fd.get('installmentPlan')==='monthly';let installmentAmount='',installmentDueDay=1,installmentStartMonth='';
      if(installmentEnabled){installmentAmount=normalizeAmount(fd.get('installmentAmount')||0,c);installmentDueDay=Math.min(28,Math.max(1,Number(fd.get('installmentDueDay')||1)));installmentStartMonth=fd.get('installmentStartMonth')||String(fd.get('date')||today()).slice(0,7);if(toUnits(installmentAmount,c)<=0n){toast('أدخل قيمة القسط الشهري.','error');return false;}}
      const rec={id:d?.id||uid('d'),direction,projectId,tenantId:d?.tenantId||'',buildingId:d?.buildingId||'',source:d?.source||'',name:String(fd.get('name')||'').trim(),phone:String(fd.get('phone')||'').trim(),idNumber:String(fd.get('idNumber')||'').trim(),date:fd.get('date')||today(),amount,currency:c,installmentEnabled,installmentAmount,installmentDueDay,installmentStartMonth,notes:String(fd.get('notes')||'').trim(),status:d?.status||'open',completedDate:d?.completedDate||'',createdAt:d?.createdAt||new Date().toISOString()};
      if(d)Object.assign(d,rec);else state.debts.push(rec);activeDebtTab=d?.status==='closed'?'closed':direction;if(projectId&&projectId===activeProjectId&&activeView==='project-details')activeProjectTab=d?.status==='closed'?'closed':direction;saveState();toast(d?'تم تحديث الدين.':direction==='receivable'?'تم تسجيل دين لنا بنجاح.':'تم تسجيل دين علينا بنجاح.');return true;
    }});
    const plan=form.elements.installmentPlan,fields=$('#installmentFields',form);const toggle=()=>{fields.style.display=plan.value==='monthly'?'block':'none'};plan.addEventListener('change',toggle);toggle();
  }

  function openDebtPaymentModal(debtId) {
    const d=debtById(debtId); if(!d)return;
    const rem=debtRemainingUnits(d),c=d.currency,direction=d.direction||'receivable',isReceivable=direction==='receivable',operation=isReceivable?'تحصيل':'سداد';
    const body=`<div class="debt-payment-head"><div><small>الحساب</small><strong>${escapeHtml(d.name)}</strong></div><div><small>المبلغ المتبقي</small><strong class="${isReceivable?'money-in':'money-out'}">${formatMoney(rem,c,true)}</strong></div></div><div class="form-grid">${field('amount',`قيمة ${operation}`,unitsToDecimal(rem,c,false),'number',`min="0" step="${CURRENCY_META[c].precision===2?'0.01':'0.001'}" required`)}${field('date',`تاريخ ${operation}`,today(),'date','required')}${field('executor','المنفذ',currentExecutor(),'text','readonly')}${financialMetaFields({})}${textareaField('notes','ملاحظات','')}</div><div class="form-note">سيتم تسجيل ${isReceivable?'وارد':'مصروف'} تلقائياً في الحركة اليومية، مع طريقة الدفع ورقم المرجع واسم البنك/المحفظة.${isReceivable?' وبعد الحفظ سيظهر سند قبض جاهز.':' وبعد الحفظ سيظهر سند صرف جاهز.'}</div>`;
    showModal({title:`تسجيل ${operation} دين`,subtitle:`${isReceivable?'دين لنا':'دين علينا'} — العملة: ${CURRENCY_META[c].label}`,icon:'i-check',body,submitText:`حفظ ${operation}`,onSubmit:(fd,form,close)=>{
      const amount=normalizeAmount(fd.get('amount'),c),u=toUnits(amount,c);if(u<=0n){toast(`أدخل قيمة ${operation} صحيحة.`,'error');return false;}if(u>rem){toast(`قيمة ${operation} أكبر من المبلغ المتبقي.`,'error');return false;}
      const date=fd.get('date')||today(),executor=currentExecutor(),notes=String(fd.get('notes')||'').trim(),paymentMethod=fd.get('paymentMethod')==='bank'?'bank':'cash',referenceNo=String(fd.get('referenceNo')||'').trim(),bankWallet=String(fd.get('bankWallet')||'').trim();if(paymentMethod==='bank'&&!bankWallet){toast('أدخل اسم البنك أو المحفظة.','error');return false;}
      const paymentId=uid('dp'),amounts=emptyAmounts();amounts[c][isReceivable?'in':'out']=amount;const movementId=uid('m');
      const movement={id:movementId,type:'general',date,executor,paymentMethod,referenceNo,bankWallet,projectId:d.projectId||'',buildingId:d.buildingId||'',tenantId:d.tenantId||'',account:d.name,detail:`${operation} دين ${isReceivable?'من':'إلى'} ${d.name}`,notes:notes||`مرتبط بالدين ${d.name}`,amounts,receiptNo:makeReceiptNo(),debtId:d.id,debtPaymentId:paymentId,createdAt:new Date().toISOString()};
      state.movements.push(movement);state.debtPayments.push({id:paymentId,debtId:d.id,movementId,amount,currency:c,date,executor,paymentMethod,referenceNo,bankWallet,notes,receiptNo:movement.receiptNo||'',createdAt:new Date().toISOString()});
      const after=rem-u;if(after===0n){d.status='closed';d.completedDate=date;if(d.projectId===activeProjectId&&activeView==='project-details')activeProjectTab='closed';toast(`تم ${operation} الدين بالكامل ونقله إلى «تم السداد والانتهاء».`);}else{if(d.projectId===activeProjectId&&activeView==='project-details')activeProjectTab=direction;toast(`تم تسجيل ${operation}. المتبقي ${formatMoney(after,c,true)}.`);}saveState();close();setTimeout(()=>isReceivable?openReceiptActions(movementId):openPaymentVoucherActions(movementId),90);return false;
    }});
  }

  function openDebtHistoryModal(debtId) {
    const d=debtById(debtId); if(!d)return;
    const direction=d.direction||'receivable', operation=direction==='receivable'?'تحصيل':'سداد';
    const payments=state.debtPayments.filter(p=>p.debtId===d.id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
    const body=payments.length?`<div class="table-wrap"><table style="min-width:760px"><thead><tr><th>التاريخ</th><th>العملية</th><th>القيمة</th><th>المنفذ</th><th>ملاحظات</th><th>إجراء</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${dateLabel(p.date)}</td><td><span class="badge ${direction==='receivable'?'badge-green':'badge-red'}">${operation}</span></td><td><strong>${formatMoney(p.amount,p.currency)}</strong></td><td>${escapeHtml(p.executor||'—')}</td><td>${escapeHtml(p.notes||'—')}</td><td><div class="actions">${direction==='receivable'&&p.movementId?`<button class="btn btn-primary btn-sm" data-debt-payment-receipt="${p.id}"><svg class="icon"><use href="#i-receipt"/></svg>سند قبض</button>`:''}<button class="btn btn-danger-soft btn-sm" data-delete-debt-payment="${p.id}">حذف العملية</button></div></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">لا توجد عمليات ${operation} مسجلة على هذا الدين.</div>`;
    showModal({title:`سجل ${operation} الدين`,subtitle:`${d.name} — المتبقي ${formatMoney(debtRemainingUnits(d),d.currency,true)}`,icon:'i-debt',body,size:'lg',hideSubmit:true});
  }

  function debtReportText(debtId) {
    const d=debtById(debtId); if(!d)return '';
    const direction=d.direction||'receivable', paid=debtPaidUnits(d), remaining=debtRemainingUnits(d);
    const payments=state.debtPayments.filter(p=>p.debtId===d.id).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.createdAt||'').localeCompare(b.createdAt||''));
    const project=projectById(d.projectId);
    const lines=[
      `كشف حساب تفصيلي — ${direction==='receivable'?'دين لنا':'دين علينا'}`,
      `الاسم / الجهة: ${d.name}`,
      d.phone?`رقم الجوال: ${d.phone}`:'',
      d.idNumber?`الهوية / المرجع: ${d.idNumber}`:'',
      project?`المشروع: ${project.name}`:'',
      `تاريخ تسجيل الدين: ${dateLabel(d.date)}`,
      `المبلغ الأصلي: ${formatMoney(d.amount,d.currency)}`,
      `إجمالي ${direction==='receivable'?'التحصيلات':'الدفعات'}: ${formatMoney(paid,d.currency,true)}`,
      `المتبقي: ${formatMoney(remaining,d.currency,true)}`,
      `الحالة: ${d.status==='closed'?'تم السداد والانتهاء':'مفتوح'}`,
      '',
      `سجل ${direction==='receivable'?'التحصيلات':'الدفعات'}:`
    ].filter(x=>x!==null&&x!==undefined);
    if(payments.length) payments.forEach((p,i)=>lines.push(`${i+1}) ${dateLabel(p.date)} — ${formatMoney(p.amount,p.currency)} — ${p.executor||'بدون منفذ'}${p.notes?` — ${p.notes}`:''}`));
    else lines.push('لا توجد دفعات مسجلة حتى الآن.');
    if(d.notes){lines.push('',`ملاحظات الدين: ${d.notes}`);}
    lines.push('','إدارة شركة شهد للتجارة العامة والمقاولات');
    return lines.join('\n');
  }

  function sendDebtReportWhatsApp(debtId) {
    const d=debtById(debtId); if(!d)return;
    const number=normalizeWhatsAppNumber(d.phone||'');
    if(!number){toast('لا يوجد رقم جوال محفوظ لهذا الحساب.','error');return;}
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(debtReportText(debtId))}`,'_blank','noopener');
  }

  function sendDebtReportSms(debtId) {
    const d=debtById(debtId); if(!d)return;
    const phone=String(d.phone||'').trim().replace(/[^0-9+]/g,'');
    if(!phone){toast('لا يوجد رقم جوال محفوظ لهذا الحساب.','error');return;}
    const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';
    window.location.href=`sms:${phone}${separator}body=${encodeURIComponent(debtReportText(debtId))}`;
  }

  function openDebtDetailedReport(debtId) {
    const d=debtById(debtId); if(!d)return;
    const direction=d.direction||'receivable', paid=debtPaidUnits(d), rem=debtRemainingUnits(d), total=toUnits(d.amount,d.currency);
    const payments=state.debtPayments.filter(p=>p.debtId===d.id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
    const project=projectById(d.projectId);
    const pct=total>0n?Math.min(100,Math.round(Number(paid*10000n/total)/100)):0;
    const body=`<div class="debt-report-hero"><div><span class="badge ${direction==='receivable'?'badge-green':'badge-red'}">${direction==='receivable'?'دين لنا':'دين علينا'}</span><h3>${escapeHtml(d.name)}</h3><p>${escapeHtml([d.phone,d.idNumber].filter(Boolean).join(' • ')||'بدون بيانات اتصال')}</p></div><div class="debt-report-status"><small>الحالة</small><strong>${d.status==='closed'?'تم السداد والانتهاء':'مفتوح'}</strong></div></div>
    <div class="debt-report-stats"><div><small>المبلغ الأصلي</small><strong>${formatMoney(total,d.currency,true)}</strong></div><div><small>إجمالي ${direction==='receivable'?'التحصيلات':'الدفعات'}</small><strong class="${direction==='receivable'?'money-in':'money-out'}">${formatMoney(paid,d.currency,true)}</strong></div><div><small>المتبقي</small><strong class="${rem>0n?'money-out':'money-in'}">${formatMoney(rem,d.currency,true)}</strong></div><div><small>نسبة التسوية</small><strong>${pct}%</strong></div></div>
    <div class="debt-progress"><span style="width:${pct}%"></span></div>
    <div class="debt-report-meta"><div><small>تاريخ الدين</small><strong>${dateLabel(d.date)}</strong></div><div><small>المشروع</small><strong>${escapeHtml(project?.name||'حساب عام')}</strong></div><div><small>العملة</small><strong>${CURRENCY_META[d.currency]?.label||d.currency}</strong></div><div><small>تاريخ الإنهاء</small><strong>${d.completedDate?dateLabel(d.completedDate):'—'}</strong></div></div>
    ${d.notes?`<div class="debt-report-notes"><small>ملاحظات</small><p>${escapeHtml(d.notes)}</p></div>`:''}
    <div class="debt-report-section-title"><h4>سجل ${direction==='receivable'?'التحصيلات':'الدفعات'}</h4><span>${payments.length} عملية</span></div>
    ${payments.length?`<div class="debt-report-timeline">${payments.map((p,i)=>`<div class="debt-report-payment"><div class="debt-report-index">${payments.length-i}</div><div class="debt-report-payment-main"><strong>${formatMoney(p.amount,p.currency)}</strong><span>${dateLabel(p.date)} • ${escapeHtml(p.executor||'بدون منفذ')}</span>${p.notes?`<small>${escapeHtml(p.notes)}</small>`:''}</div>${direction==='receivable'&&p.movementId?`<button class="btn btn-primary btn-sm" type="button" data-debt-payment-receipt="${p.id}"><svg class="icon"><use href="#i-receipt"/></svg>سند قبض</button>`:''}</div>`).join('')}</div>`:`<div class="empty">لا توجد دفعات مسجلة على هذا الدين حتى الآن.</div>`}`;
    const {form}=showModal({title:'التقرير التفصيلي للدين',subtitle:`كشف حساب كامل محفوظ من السجل المالي`,icon:'i-chart',body,size:'lg',hideSubmit:true,extraFooter:`<button class="btn btn-primary" type="button" id="debtReportPdfBtn"><svg class="icon"><use href="#i-download"/></svg>PDF</button><button class="btn btn-whatsapp" type="button" id="debtReportWhatsappBtn">واتساب</button><button class="btn btn-ghost" type="button" id="debtReportSmsBtn">رسالة جوال</button>`});
    $('#debtReportPdfBtn',form)?.addEventListener('click',()=>exportDebtDetailedPdf(debtId));
    $('#debtReportWhatsappBtn',form)?.addEventListener('click',()=>sendDebtReportWhatsApp(debtId));
    $('#debtReportSmsBtn',form)?.addEventListener('click',()=>sendDebtReportSms(debtId));
  }

  async function exportDebtDetailedPdf(debtId) {
    const d=debtById(debtId); if(!d)return;
    const direction=d.direction||'receivable', payments=state.debtPayments.filter(p=>p.debtId===d.id).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.createdAt||'').localeCompare(b.createdAt||''));
    const paid=debtPaidUnits(d),rem=debtRemainingUnits(d),total=toUnits(d.amount,d.currency),project=projectById(d.projectId);
    try{
      try{await document.fonts?.ready}catch(_){ }
      const W=1240,H=1754,M=70,brand='#0b67b2',green='#0f9d71',danger='#bb2d3b',text='#152033',muted='#69778d',line='#dbe4ee',soft='#f4f8fc';
      let logo=null;try{logo=await loadImage('shahd-logo.jpg')}catch(_){logo=null}
      const perPage=11,pagesCount=Math.max(1,Math.ceil(payments.length/perPage)),pageBlobs=[];
      for(let pageIndex=0;pageIndex<pagesCount;pageIndex++){
        const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.direction='rtl';ctx.textAlign='right';
        ctx.fillStyle=brand;ctx.fillRect(0,0,W,22);
        if(logo){const maxW=330,maxH=150,ratio=Math.min(maxW/logo.width,maxH/logo.height);const w=logo.width*ratio,h=logo.height*ratio;ctx.drawImage(logo,W-M-w,48,w,h)}
        ctx.fillStyle=text;ctx.font='800 42px Cairo, Tahoma, Arial';ctx.fillText('كشف حساب دين تفصيلي',W-M,245);ctx.fillStyle=muted;ctx.font='500 21px Cairo, Tahoma, Arial';ctx.fillText(`${direction==='receivable'?'دين لنا':'دين علينا'} • تاريخ الإصدار ${dateLabel(today())}`,W-M,285);
        ctx.strokeStyle=line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(M,315);ctx.lineTo(W-M,315);ctx.stroke();
        const cardY=350,cardW=(W-2*M-45)/4,vals=[['المبلغ الأصلي',formatMoney(total,d.currency,true),text],['إجمالي '+(direction==='receivable'?'التحصيلات':'الدفعات'),formatMoney(paid,d.currency,true),direction==='receivable'?green:danger],['المتبقي',formatMoney(rem,d.currency,true),rem>0n?danger:green],['عدد العمليات',String(payments.length),brand]];
        vals.forEach((v,i)=>{const x=W-M-(i+1)*cardW-i*15;ctx.fillStyle=soft;roundRect(ctx,x,cardY,cardW,125,18,true,false);ctx.fillStyle=muted;ctx.font='600 17px Cairo, Tahoma, Arial';ctx.fillText(v[0],x+cardW-20,cardY+38);ctx.fillStyle=v[2];ctx.font='800 25px Cairo, Tahoma, Arial';ctx.fillText(v[1],x+cardW-20,cardY+83)});
        const infoY=520;ctx.fillStyle=text;ctx.font='800 29px Cairo, Tahoma, Arial';ctx.fillText(d.name,W-M,infoY);ctx.fillStyle=muted;ctx.font='500 18px Cairo, Tahoma, Arial';
        const info=[d.phone&&`الجوال: ${d.phone}`,d.idNumber&&`الهوية/المرجع: ${d.idNumber}`,project&&`المشروع: ${project.name}`,`تاريخ الدين: ${dateLabel(d.date)}`,`الحالة: ${d.status==='closed'?'تم السداد والانتهاء':'مفتوح'}`].filter(Boolean);let iy=infoY+38;info.forEach(v=>{ctx.fillText(v,W-M,iy);iy+=30});
        const tableY=700;ctx.fillStyle=brand;roundRect(ctx,M,tableY,W-2*M,58,14,true,false);ctx.fillStyle='#fff';ctx.font='700 18px Cairo, Tahoma, Arial';ctx.fillText('ملاحظات',W-M-40,tableY+37);ctx.fillText('المنفذ',W-M-390,tableY+37);ctx.fillText('المبلغ',W-M-650,tableY+37);ctx.fillText('التاريخ',W-M-890,tableY+37);
        const slice=payments.slice(pageIndex*perPage,(pageIndex+1)*perPage);let y=tableY+76;ctx.font='500 17px Cairo, Tahoma, Arial';
        if(!slice.length){ctx.fillStyle=muted;ctx.fillText('لا توجد دفعات مسجلة حتى الآن.',W-M,y+25)}
        slice.forEach((pmt,idx)=>{ctx.fillStyle=idx%2===0?'#ffffff':soft;ctx.fillRect(M,y-10,W-2*M,70);ctx.fillStyle=text;ctx.fillText(String(pmt.notes||'—').slice(0,34),W-M-40,y+28);ctx.fillText(String(pmt.executor||'—').slice(0,18),W-M-390,y+28);ctx.font='700 18px Cairo, Tahoma, Arial';ctx.fillText(formatMoney(pmt.amount,pmt.currency),W-M-650,y+28);ctx.font='500 17px Cairo, Tahoma, Arial';ctx.fillText(dateLabel(pmt.date),W-M-890,y+28);y+=70});
        if(d.notes&&pageIndex===pagesCount-1){ctx.fillStyle=soft;roundRect(ctx,M,1490,W-2*M,105,14,true,false);ctx.fillStyle=muted;ctx.font='600 16px Cairo, Tahoma, Arial';ctx.fillText('ملاحظات الدين',W-M-20,1525);ctx.fillStyle=text;ctx.font='500 17px Cairo, Tahoma, Arial';wrapText(ctx,d.notes,W-M-20,1560,W-2*M-40,25)}
        ctx.fillStyle=muted;ctx.font='500 15px Cairo, Tahoma, Arial';ctx.fillText(`صفحة ${pageIndex+1} من ${pagesCount} • ${state.settings.companyName}`,W-M,H-48);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));if(!blob)throw new Error('تعذر تجهيز التقرير.');pageBlobs.push({blob,width:W,height:H});
      }
      const pdfBlob=await jpegPagesToPdf(pageBlobs),safeName=String(d.name||'debt').replace(/[\\/:*?"<>|]+/g,'-').slice(0,40),fileName=`debt-report-${safeName}-${today()}.pdf`;
      const file=new File([pdfBlob],fileName,{type:'application/pdf'});
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){try{await navigator.share({title:'كشف حساب دين تفصيلي',text:`كشف حساب ${d.name}`,files:[file]});toast('تم تجهيز التقرير للمشاركة.');return}catch(err){if(err?.name==='AbortError')return}}
      downloadBlob(pdfBlob,fileName);toast('تم إنشاء التقرير التفصيلي PDF.');
    }catch(err){toast(err?.message||'تعذر إنشاء تقرير الدين.','error')}
  }

  function deleteDebtPayment(paymentId) {
    const p=state.debtPayments.find(x=>x.id===paymentId); if(!p)return;
    const d=debtById(p.debtId); if(!d)return;
    const direction=d.direction||'receivable', operation=direction==='receivable'?'التحصيل':'السداد';
    confirmAction({title:`حذف عملية ${operation}`,message:`سيتم حذف العملية بقيمة ${formatMoney(p.amount,p.currency)} وإزالة الحركة اليومية المرتبطة بها ثم إعادة احتساب المتبقي.`,confirmText:'حذف العملية',onConfirm:()=>{
      state.debtPayments=state.debtPayments.filter(x=>x.id!==paymentId);
      state.movements=state.movements.filter(m=>m.id!==p.movementId && m.debtPaymentId!==paymentId);
      const remaining=debtRemainingUnits(d);
      if(remaining>0n){d.status='open';d.completedDate='';activeDebtTab=direction;}
      saveState();toast(`تم حذف عملية ${operation} وإعادة احتساب الدين.`);
    }});
  }

  async function buildVoucherJpg(movementId,flow='in') {
    const m=state.movements.find(x=>x.id===movementId);if(!m)return null;
    const isIn=flow!=='out',title=isIn?'سند قبض':'سند صرف';
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1700;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=isIn?'#0b4d8f':'#b83245';ctx.fillRect(0,0,canvas.width,26);
    let logo=null;try{logo=await loadImage('shahd-logo.jpg')}catch(_){}if(logo){const maxW=520,maxH=235,r=Math.min(maxW/logo.width,maxH/logo.height);ctx.drawImage(logo,(canvas.width-logo.width*r)/2,55,logo.width*r,logo.height*r)}
    ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#172033';ctx.font='bold 54px Cairo, Tahoma, Arial';ctx.fillText(title,1080,335);ctx.fillStyle='#6b778c';ctx.font='26px Cairo, Tahoma, Arial';ctx.fillText(`${state.settings.companyName} — ${state.settings.companySubtitle}`,1080,382);ctx.strokeStyle='#dfe6ef';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(120,425);ctx.lineTo(1080,425);ctx.stroke();
    const tenant=tenantById(m.tenantId),building=buildingById(m.buildingId),project=projectById(m.projectId),debt=debtById(m.debtId),accountName=building?.name||project?.name||m.account||debt?.name||'مركزي',party=tenant?.name||debt?.name||m.account||building?.name||project?.name||'—';
    const rows=[['رقم السند',m.receiptNo||m.id],['التاريخ',dateLabel(m.date)],[isIn?'استلمنا من':'صُرف إلى',party],['العقار / الحساب',accountName],['البيان',m.detail||'—'],['طريقة الدفع',paymentMethodLabel(m.paymentMethod)],['رقم المرجع',m.referenceNo||'—'],['البنك / المحفظة',m.bankWallet||'—']];
    if(m.rentMonths?.length)rows.push(['عن شهر',m.rentMonths.map(monthLabel).join('، ')]);
    if(m.type==='rent'&&tenant){if(toUnits(m.rentExpectedAmount||0,tenant.rentCurrency)>0n)rows.push(['القيمة قبل الخصم',formatMoney(m.rentExpectedAmount,tenant.rentCurrency)]);if(toUnits(m.rentDiscount||0,tenant.rentCurrency)>0n)rows.push(['خصم لمرة واحدة',formatMoney(m.rentDiscount,tenant.rentCurrency)]);}
    rows.push(['المنفذ',m.executor||'—']);let y=480;ctx.font='bold 24px Cairo, Tahoma, Arial';rows.forEach(([label,value])=>{ctx.fillStyle='#6b778c';ctx.fillText(label,1080,y);ctx.fillStyle='#172033';ctx.font='bold 26px Cairo, Tahoma, Arial';wrapText(ctx,String(value),760,y,720,36);ctx.font='bold 24px Cairo, Tahoma, Arial';y+=64;});
    y+=16;ctx.fillStyle='#f4f7fb';roundRect(ctx,120,y,960,230,22,true,false);ctx.fillStyle=isIn?'#0b4d8f':'#b83245';ctx.font='bold 31px Cairo, Tahoma, Arial';ctx.fillText(isIn?'المبلغ المقبوض فعلياً':'المبلغ المصروف',1030,y+52);let my=y+105;CURRENCIES.forEach(c=>{const u=toUnits(m.amounts?.[c]?.[isIn?'in':'out']||0,c);if(u>0n){ctx.fillStyle=isIn?'#0f9d71':'#d9394b';ctx.font='bold 37px Cairo, Tahoma, Arial';ctx.fillText(`${CURRENCY_META[c].label}: ${formatMoney(u,c,true)}`,1030,my);my+=48;}});
    ctx.fillStyle='#6b778c';ctx.font='22px Cairo, Tahoma, Arial';ctx.fillText(`تم إنشاء هذا ${title} إلكترونياً من نظام شركة شهد.`,1080,1600);ctx.fillStyle=isIn?'#0b4d8f':'#b83245';ctx.fillRect(120,1640,960,4);const blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',.94));return{blob,fileName:`${isIn?'receipt':'payment-voucher'}-${m.receiptNo||m.id}.jpg`,movement:m,tenant,building,project,debt,flow:isIn?'in':'out'};
  }

  async function buildReceiptJpg(movementId){return buildVoucherJpg(movementId,'in')}
  async function exportVoucherJpg(movementId,flow='in'){const v=await buildVoucherJpg(movementId,flow);if(!v)return;downloadBlob(v.blob,v.fileName);toast(`تم تنزيل ${flow==='out'?'سند الصرف':'سند القبض'} بصيغة JPG.`)}
  async function exportReceiptJpg(movementId){return exportVoucherJpg(movementId,'in')}

  function voucherText(movementId,flow='in'){
    const m=state.movements.find(x=>x.id===movementId);if(!m)return '';const isIn=flow!=='out',tenant=tenantById(m.tenantId),building=buildingById(m.buildingId),project=projectById(m.projectId),debt=debtById(m.debtId),amounts=CURRENCIES.map(c=>{const u=toUnits(m.amounts?.[c]?.[isIn?'in':'out']||0,c);return u>0n?formatMoney(u,c,true):''}).filter(Boolean).join(' + '),months=m.rentMonths?.length?m.rentMonths.map(monthLabel).join('، '):'',extra=[];
    if(m.type==='rent'&&tenant){if(toUnits(m.rentExpectedAmount||0,tenant.rentCurrency)>0n)extra.push(`القيمة قبل الخصم: ${formatMoney(m.rentExpectedAmount,tenant.rentCurrency)}`);if(toUnits(m.rentDiscount||0,tenant.rentCurrency)>0n)extra.push(`الخصم: ${formatMoney(m.rentDiscount,tenant.rentCurrency)}`)}
    return `${isIn?'سند قبض':'سند صرف'} رقم ${m.receiptNo||m.id}\nالتاريخ: ${dateLabel(m.date)}\n${isIn?'استلمنا من':'صُرف إلى'}: ${tenant?.name||debt?.name||m.account||'—'}\nالحساب: ${building?.name||project?.name||debt?.name||m.account||'مركزي'}\n${isIn?'المبلغ المقبوض فعلياً':'المبلغ المصروف'}: ${amounts||'—'}${months?`\nعن شهر: ${months}`:''}${extra.length?`\n${extra.join('\n')}`:''}\nطريقة الدفع: ${paymentMethodLabel(m.paymentMethod)}${m.bankWallet?` — ${m.bankWallet}`:''}${m.referenceNo?`\nرقم المرجع: ${m.referenceNo}`:''}\nالمنفذ: ${m.executor||'—'}\n${state.settings.companyName}`;
  }
  function receiptText(movementId){return voucherText(movementId,'in')}

  function normalizeWhatsAppNumber(phone){let p=String(phone||'').trim().replace(/[^0-9+]/g,'');if(p.startsWith('+'))return p.slice(1);if(p.startsWith('00'))return p.slice(2);const cc=String(state.settings.whatsappCountryCode||'970').replace(/\D/g,'');if(p.startsWith('0'))return cc+p.slice(1);return p;}

  async function copyVoucherImage(blob){
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')return false;
    try{const bmp=await createImageBitmap(blob),canvas=document.createElement('canvas');canvas.width=bmp.width;canvas.height=bmp.height;canvas.getContext('2d').drawImage(bmp,0,0);const png=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!png)return false;await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);return true}catch(_){return false}
  }

  async function sendVoucherWhatsApp(movementId,flow='in'){
    const m=state.movements.find(x=>x.id===movementId);if(!m)return;const tenant=tenantById(m.tenantId),debt=debtById(m.debtId),number=normalizeWhatsAppNumber(tenant?.phone||debt?.phone||'');if(!number){toast('لا يوجد رقم واتساب محفوظ لهذا الحساب. أضف رقم الجوال أولاً.','error');return;}
    const popup=window.open('about:blank','_blank');try{const voucher=await buildVoucherJpg(movementId,flow);if(!voucher)throw new Error('تعذر تجهيز السند.');const tgUpload=window.ShahdMedia?.uploadTransient?.(voucher.blob,voucher.fileName);if(tgUpload?.catch)tgUpload.catch(()=>{});const copied=await copyVoucherImage(voucher.blob);const url=`https://wa.me/${number}?text=${encodeURIComponent(voucherText(movementId,flow))}`;if(popup)popup.location.href=url;else window.location.href=url;toast(copied?'تم فتح واتساب مباشرة على الرقم المحفوظ ونسخ صورة السند للحافظة؛ الصقها داخل المحادثة.':'تم فتح واتساب مباشرة على الرقم المحفوظ. إذا لم يدعم الجهاز لصق الصورة تلقائياً استخدم زر مشاركة الصورة.','info')}catch(e){if(popup)popup.close();toast(e?.message||'تعذر تجهيز السند.','error')}
  }
  async function sendReceiptWhatsApp(movementId){return sendVoucherWhatsApp(movementId,'in')}

  function sendVoucherSms(movementId,flow='in'){const m=state.movements.find(x=>x.id===movementId);if(!m)return;const tenant=tenantById(m.tenantId),debt=debtById(m.debtId),phone=String(tenant?.phone||debt?.phone||'').trim().replace(/[^0-9+]/g,'');if(!phone){toast('لا يوجد رقم جوال محفوظ لهذا الحساب.','error');return;}const separator=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'&':'?';window.location.href=`sms:${phone}${separator}body=${encodeURIComponent(voucherText(movementId,flow))}`}
  function sendReceiptSms(movementId){return sendVoucherSms(movementId,'in')}

  async function shareVoucherJpg(movementId,flow='in'){const v=await buildVoucherJpg(movementId,flow);if(!v)return;const file=new File([v.blob],v.fileName,{type:'image/jpeg'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){try{await navigator.share({title:flow==='out'?'سند صرف':'سند قبض',text:voucherText(movementId,flow),files:[file]});return}catch(e){if(e?.name==='AbortError')return}}downloadBlob(v.blob,v.fileName);toast('المشاركة المباشرة غير مدعومة هنا؛ تم تنزيل صورة السند.','info')}
  async function shareReceiptJpg(movementId){return shareVoucherJpg(movementId,'in')}

  function openVoucherActions(movementId,flow='in'){
    const m=state.movements.find(x=>x.id===movementId);if(!m)return;const isIn=flow!=='out',tenant=tenantById(m.tenantId),debt=debtById(m.debtId),contact=tenant||debt,amounts=CURRENCIES.map(c=>{const u=toUnits(m.amounts?.[c]?.[isIn?'in':'out']||0,c);return u>0n?formatMoney(u,c,true):''}).filter(Boolean).join(' + '),title=isIn?'سند القبض جاهز':'سند الصرف جاهز';
    const discountInfo=m.type==='rent'&&tenant&&toUnits(m.rentDiscount||0,tenant.rentCurrency)>0n?`<div><small>الخصم</small><strong>${formatMoney(m.rentDiscount,tenant.rentCurrency)}</strong></div>`:'';
    const {form}=showModal({title,subtitle:contact?`${contact.name}${contact.phone?` — ${contact.phone}`:''}`:'يمكن تنزيل السند أو مشاركته',icon:'i-receipt',hideSubmit:true,body:`<div class="receipt-ready-card"><div><small>رقم السند</small><strong>${escapeHtml(m.receiptNo||m.id)}</strong></div><div><small>${isIn?'المبلغ المقبوض':'المبلغ المصروف'}</small><strong class="${isIn?'money-in':'money-out'}">${escapeHtml(amounts||'—')}</strong></div>${discountInfo}<div><small>التاريخ</small><strong>${dateLabel(m.date)}</strong></div><div><small>طريقة الدفع</small><strong>${paymentMethodLabel(m.paymentMethod)}${m.bankWallet?` — ${escapeHtml(m.bankWallet)}`:''}</strong></div><div><small>المرجع</small><strong>${escapeHtml(m.referenceNo||'—')}</strong></div></div><div class="form-note receipt-note">زر واتساب يفتح المحادثة مباشرة على رقم المستأجر/صاحب الدين المحفوظ حتى لو لم يكن مسجلاً في جهات اتصال الهاتف، ويحاول نسخ صورة السند للحافظة للصقها فوراً.</div>`,extraFooter:`<button class="btn btn-primary" type="button" id="voucherDownloadBtn"><svg class="icon"><use href="#i-download"/></svg>JPG</button><button class="btn btn-primary" type="button" id="voucherShareBtn"><svg class="icon"><use href="#i-share"/></svg>مشاركة الصورة</button>${isIn?'<button class="btn btn-whatsapp" type="button" id="voucherWhatsappBtn">واتساب مباشر</button><button class="btn btn-ghost" type="button" id="voucherSmsBtn">رسالة جوال</button>':''}`});
    $('#voucherDownloadBtn',form)?.addEventListener('click',()=>exportVoucherJpg(movementId,flow));$('#voucherShareBtn',form)?.addEventListener('click',()=>shareVoucherJpg(movementId,flow));$('#voucherWhatsappBtn',form)?.addEventListener('click',()=>sendVoucherWhatsApp(movementId,flow));$('#voucherSmsBtn',form)?.addEventListener('click',()=>sendVoucherSms(movementId,flow));
  }
  function openReceiptActions(movementId){return openVoucherActions(movementId,'in')}
  function openPaymentVoucherActions(movementId){return openVoucherActions(movementId,'out')}

  function loadImage(src){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src=src;});}
  function roundRect(ctx,x,y,w,h,r,fill,stroke){if(w<2*r)r=w/2;if(h<2*r)r=h/2;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();}
  function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=text.split(' ');let line='';let yy=y;for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,yy);line=word;yy+=lineHeight;}else line=test;}ctx.fillText(line,x,yy);return yy;}

  function exportCsv() {
    const list=reportMovements();
    const headers=['التاريخ','النوع','البيان','المكان/المستأجر',...CURRENCIES.flatMap(c=>[`${CURRENCY_META[c].label} وارد`,`${CURRENCY_META[c].label} مصروف`]),'طريقة الدفع','البنك/المحفظة','رقم المرجع','المنفذ','خصم الإيجار','ملاحظات'];
    const rows=list.map(m=>{const t=tenantById(m.tenantId),b=buildingById(m.buildingId);return [m.date,m.type==='rent'?'دفعة مستأجر':'حركة عامة',m.detail||'',t?.name||b?.name||'مركزي',...CURRENCIES.flatMap(c=>[m.amounts?.[c]?.in||'0',m.amounts?.[c]?.out||'0']),paymentMethodLabel(m.paymentMethod),m.bankWallet||'',m.referenceNo||'',m.executor||'',m.rentDiscount||'0',m.notes||''];});
    const csv='\ufeff'+[headers,...rows].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`shahd-report-${today()}.csv`);toast('تم تصدير التقرير بصيغة CSV.');
  }
  function downloadBlob(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);}
  function exportBackup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});downloadBlob(blob,`shahd-backup-${today()}.json`);toast('تم تصدير النسخة الاحتياطية.');}
  function restoreBackup(file){
    const r=new FileReader();
    r.onload=async()=>{
      try{
        const data=JSON.parse(r.result);
        if(!data||!Array.isArray(data.buildings)||!Array.isArray(data.tenants))throw new Error('INVALID_BACKUP');
        state={...cloneDefaults(),...data,projects:Array.isArray(data.projects)?data.projects:[],movements:Array.isArray(data.movements)?data.movements:[],debts:Array.isArray(data.debts)?data.debts.map(d=>({...d,direction:['receivable','payable'].includes(d.direction)?d.direction:'receivable'})):[],debtPayments:Array.isArray(data.debtPayments)?data.debtPayments:[],settings:{...defaults.settings,...(data.settings||{})}};
        applyTheme();renderAll();
        const result=window.ShahdCloud?.importBackupState
          ? await window.ShahdCloud.importBackupState(state)
          : (await window.ShahdCloud?.persistState?.(state), await window.ShahdCloud?.syncNow?.({manual:true}));
        if(result?.loggedOut)return;
        if(result?.offline)toast('تم استيراد النسخة محلياً، وستتم مزامنتها تلقائياً فور عودة الإنترنت.','info');
        else if(result?.failed)toast(`تم استيراد النسخة ورفعها إلى قاعدة البيانات، مع بقاء ${result.failed} عملية في طابور المزامنة.`,'info');
        else toast('تم استيراد النسخة الاحتياطية ومزامنتها فوراً مع قاعدة البيانات.');
      }catch(e){
        console.error(e);
        if(String(e?.message||'')==='INVALID_BACKUP')toast('ملف النسخة الاحتياطية غير صالح.','error');
        else toast(e?.message||'تم الاستيراد محلياً لكن تعذرت المزامنة مع قاعدة البيانات.','error');
      }
    };
    r.onerror=()=>toast('تعذر قراءة ملف النسخة الاحتياطية.','error');
    r.readAsText(file);
  }

  function loadDemoData() {
    const b1={id:'b_demo_1',name:'عمارة المركز',address:'الفرع الرئيسي',apartments:8,notes:'',createdAt:new Date().toISOString()};
    const b2={id:'b_demo_2',name:'عمارة السوق',address:'المنطقة التجارية',apartments:5,notes:'',createdAt:new Date().toISOString()};
    const t1={id:'t_demo_1',name:'مستأجر تجريبي',idNumber:'900000000',phone:'0590000000',buildingId:b1.id,floor:'2',direction:'شقة 4',rentAmount:'500.00',rentCurrency:'ILS',startMonth:'2026-03',contractMonths:12,notes:'',createdAt:new Date().toISOString()};
    const amounts=emptyAmounts();amounts.ILS.in='2000.00';
    const m1={id:'m_demo_1',type:'rent',date:'2026-06-01',executor:'بلال',buildingId:b1.id,tenantId:t1.id,rentMonths:['2026-03','2026-04','2026-05','2026-06'],detail:'دفعة إيجار من مارس حتى يونيو',notes:'',amounts,receiptNo:'SH-20260601-0001',createdAt:new Date().toISOString()};
    const p1={id:'p_demo_1',name:'مشروع تجريبي',client:'عميل المشروع',location:'الموقع الرئيسي',startDate:'2026-08-01',endDate:'',status:'active',notes:'',createdAt:new Date().toISOString()};
    const pmAmounts=emptyAmounts();pmAmounts.ILS.in='8000.00';pmAmounts.ILS.out='2500.00';
    const pm={id:'m_demo_project',type:'general',date:'2026-08-03',executor:'بلال',projectId:p1.id,buildingId:'',tenantId:'',account:p1.name,detail:'دفعة واستحقاق مواد للمشروع',notes:'حركة تجريبية',amounts:pmAmounts,receiptNo:'SH-20260803-0002',createdAt:new Date().toISOString()};
    state={...cloneDefaults(),projects:[p1],buildings:[b1,b2],tenants:[t1],movements:[m1,pm],debts:[{id:'d_demo_1',direction:'payable',projectId:p1.id,name:'مورد مواد بناء',phone:'',idNumber:'',date:'2026-08-01',amount:'1200.00',currency:'USD',notes:'مبلغ مستحق للمورد',status:'open',completedDate:'',createdAt:new Date().toISOString()},{id:'d_demo_2',direction:'receivable',projectId:p1.id,name:'عميل تجريبي',phone:'0591111111',idNumber:'',date:'2026-08-02',amount:'3500.00',currency:'ILS',notes:'مبلغ مطلوب تحصيله',status:'open',completedDate:'',createdAt:new Date().toISOString()}],debtPayments:[],settings:{...state.settings}};
    saveState();toast('تم تحميل بيانات تجريبية. افتح المتأخرات حتى أغسطس 2026 لترى شهرين مستحقين.','info');
  }

  function deleteBuilding(id){const tenants=state.tenants.filter(t=>t.buildingId===id);if(tenants.length){toast('لا يمكن حذف العمارة قبل نقل أو حذف المستأجرين المرتبطين بها.','error');return;}confirmAction({message:'سيتم حذف العمارة نهائياً. هل تريد المتابعة؟',onConfirm:()=>{state.buildings=state.buildings.filter(b=>b.id!==id);state.movements.forEach(m=>{if(m.buildingId===id)m.buildingId='';});saveState();toast('تم حذف العمارة.');}});}
  function deleteTenant(id){const linked=state.movements.filter(m=>m.tenantId===id).length;confirmAction({message:`سيتم حذف المستأجر${linked?` مع بقاء ${linked} حركة مالية كأرشيف` : ''}. هل تريد المتابعة؟`,onConfirm:()=>{state.tenants=state.tenants.filter(t=>t.id!==id);saveState();toast('تم حذف المستأجر.');}});}
  function deleteMovement(id){confirmAction({message:'حذف الحركة سيؤثر على الرصيد والمتأخرات إن كانت دفعة إيجار.',onConfirm:()=>{state.movements=state.movements.filter(m=>m.id!==id);saveState();toast('تم حذف الحركة وإعادة احتساب الأرصدة.');}});}
  function deleteDebt(id){const linkedPayments=state.debtPayments.filter(p=>p.debtId===id);const movementIds=new Set(linkedPayments.map(p=>p.movementId).filter(Boolean));confirmAction({message:`سيتم حذف الدين${linkedPayments.length?` و${linkedPayments.length} عملية سداد/تحصيل مرتبطة به`:''} مع الحركات اليومية المرتبطة تلقائياً.`,onConfirm:()=>{state.debts=state.debts.filter(d=>d.id!==id);state.debtPayments=state.debtPayments.filter(p=>p.debtId!==id);state.movements=state.movements.filter(m=>m.debtId!==id&&!movementIds.has(m.id));saveState();toast('تم حذف الدين والحركات المرتبطة به.');}});}

  function permissionCheckboxes(selected={}) {
    return `<div class="permission-groups">${(PERMISSIONS.groups||[]).map(group=>`<section class="permission-group"><h4>${escapeHtml(group.label)}</h4><div class="permission-list">${group.permissions.map(([key,label])=>`<label class="permission-check"><input type="checkbox" name="perm" value="${escapeHtml(key)}" ${selected?.[key]===true?'checked':''}><span>${escapeHtml(label)}</span></label>`).join('')}</div></section>`).join('')}</div>`;
  }

  async function loadUsers(force=false) {
    if (!can('users.view') || usersLoading || (!force && usersLoadedAt && Date.now()-usersLoadedAt<30000)) return;
    usersLoading=true;
    try {
      const result=await window.ShahdCloud.listUsers();
      companyUsers=Array.isArray(result?.users)?result.users:[];usersLoadedAt=Date.now();renderUsers();applyPermissionUI();
    } catch(err) { toast(err?.message||'تعذر تحميل المستخدمين.','error'); }
    finally { usersLoading=false; }
  }

  function renderUsers() {
    const root=$('#usersTable'), summary=$('#usersSummary'); if(!root||!summary)return;
    if(!can('users.view')){root.innerHTML='<div class="empty">هذه الصفحة غير متاحة لهذا الحساب.</div>';summary.innerHTML='';return;}
    const session=window.ShahdCloud.getSession?.()||{};
    const active=companyUsers.filter(u=>u.active).length, employees=companyUsers.filter(u=>u.role!=='manager').length;
    summary.innerHTML=[['المستخدمون',companyUsers.length],['النشطون',active],['الموظفون',employees],['الحد الأقصى',session.maxUsers||'—']].map(([l,v])=>`<div class="mini-card"><small>${l}</small><strong>${typeof v==='number'?v.toLocaleString('ar'):v}</strong></div>`).join('');
    if(!companyUsers.length){root.innerHTML=usersLoading?'<div class="empty">جاري التحميل...</div>':'<div class="empty">لا توجد بيانات مستخدمين بعد.</div>';if(activeView==='users'&&!usersLoading)setTimeout(()=>loadUsers(),0);return;}
    root.innerHTML=`<table><thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>الصلاحيات</th><th>إجراءات</th></tr></thead><tbody>${companyUsers.map(u=>{const permCount=u.role==='manager'?'الكل':Object.values(u.permissions||{}).filter(Boolean).length;return `<tr><td><strong>${escapeHtml(u.display_name||u.displayName||u.username)}</strong><br><small>${escapeHtml(u.username)}</small></td><td><span class="badge ${u.role==='manager'?'badge-blue':'badge-gray'}">${u.role==='manager'?'مدير':'موظف'}</span></td><td><span class="user-status ${u.active?'money-in':'money-out'}">${u.active?'نشط':'موقوف'}</span></td><td>${u.role==='manager'?'جميع الصلاحيات':`${permCount} صلاحية`}</td><td><div class="actions">${u.role!=='manager'?`<button class="btn btn-ghost btn-sm" data-edit-user="${u.id}">تعديل وصلاحيات</button><button class="btn ${u.active?'btn-danger-soft':'btn-primary'} btn-sm" data-toggle-user="${u.id}" data-user-active="${u.active?'1':'0'}">${u.active?'إيقاف':'تفعيل'}</button>`:'<span class="badge badge-blue">حساب المدير</span>'}</div></td></tr>`}).join('')}</tbody></table>`;
    if(activeView==='users'&&!usersLoadedAt&&!usersLoading)setTimeout(()=>loadUsers(),0);
  }

  function openUserModal(id=null) {
    const user=id?companyUsers.find(u=>u.id===id):null;
    if(user && !requirePermission('users.edit'))return;if(!user && !requirePermission('users.create'))return;
    const selected=user?.permissions||{'dashboard.view':true};
    const body=`<div class="form-grid">${fullField('displayName','اسم الموظف',user?.display_name||user?.displayName||'','text','required')}${field('username','اسم المستخدم',user?.username||'','text','required autocomplete="off"')}${fullField('password',user?'كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)':'كلمة المرور', '', 'password', `${user?'':'required '}minlength="6" autocomplete="new-password"`)}</div><div style="padding:0 20px 18px"><div class="form-note" style="margin-bottom:12px">حدد الصلاحيات بدقة. المستخدم لن يرى الصفحات أو الأزرار غير المسموحة له.</div>${permissionCheckboxes(selected)}</div>`;
    const {form,close}=showModal({title:user?'تعديل المستخدم والصلاحيات':'إضافة مستخدم',subtitle:'الصلاحيات تطبق على صفحات وأزرار وحساب الموظف',icon:'i-user-shield',size:'lg',body,submitText:user?'حفظ التعديلات':'إنشاء المستخدم',onSubmit:(fd,formEl)=>{(async()=>{const permissions={};formEl.querySelectorAll('input[name="perm"]:checked').forEach(el=>permissions[el.value]=true);['projects','buildings','tenants','movements','debts','reports','users','settings'].forEach(m=>{if(Object.keys(permissions).some(k=>k.startsWith(`${m}.`)&&k!==`${m}.view`&&permissions[k]))permissions[`${m}.view`]=true;});if(permissions['arrears.view']){permissions['tenants.view']=true;permissions['movements.view']=true;}if(permissions['arrears.collect']){permissions['arrears.view']=true;permissions['tenants.view']=true;permissions['movements.view']=true;permissions['movements.create']=true;}if(permissions['arrears.contact'])permissions['arrears.view']=true;if(permissions['debts.pay']){permissions['debts.view']=true;permissions['movements.create']=true;}if(permissions['movements.receipt'])permissions['movements.view']=true;if(permissions['sync.manual'])permissions['sync.view']=true;const payload={id:user?.id||'',displayName:String(fd.get('displayName')||'').trim(),username:String(fd.get('username')||'').trim(),password:String(fd.get('password')||''),permissions};if(!payload.displayName||!payload.username){toast('أدخل اسم الموظف واسم المستخدم.','error');return;}try{await window.ShahdCloud.saveUser(payload);toast(user?'تم تحديث المستخدم وإبطال جلسته القديمة.':'تم إنشاء المستخدم.');close();usersLoadedAt=0;await loadUsers(true);}catch(err){toast(err?.message||'تعذر حفظ المستخدم.','error');}})();return false;}});
  }

  async function toggleCompanyUser(id,active) {
    if(!requirePermission('users.disable'))return;
    try{await window.ShahdCloud.toggleUser(id,!active);toast(active?'تم إيقاف المستخدم.':'تم تفعيل المستخدم.');usersLoadedAt=0;await loadUsers(true);}catch(err){toast(err?.message||'تعذر تحديث المستخدم.','error');}
  }

  function applyPermissionUI() {
    const visibility=[
      ['#quickMovementBtn,#addMovementBtn,#quickPaymentVoucherBtn,#addPaymentVoucherBtn','movements.create'],['#heroTenantBtn,#addTenantBtn','tenants.create'],['#heroDebtBtn,#addDebtBtn','debts.create'],
      ['#addProjectBtn','projects.create'],['#addBuildingBtn','buildings.create'],['#syncButton','sync.view'],['#projectEditBtn','projects.edit'],['#projectAddMovementBtn','movements.create'],
      ['#projectAddReceivableBtn,#projectAddPayableBtn','debts.create'],['#exportCsvBtn,#exportArrearsPdfBtn','reports.export'],['#addUserBtn','users.create'],
      ['[data-edit-project]','projects.edit'],['[data-delete-project]','projects.delete'],['[data-edit-building]','buildings.edit'],['[data-delete-building]','buildings.delete'],
      ['[data-edit-tenant]','tenants.edit'],['[data-delete-tenant]','tenants.delete'],['[data-end-tenant]','tenants.end'],['[data-tenant-files],[data-open-tenant-attachment]','tenants.files'],['[data-tenant-statement],[data-building-statement]','reports.view'],['[data-pay-tenant],[data-pay-arrears]','arrears.collect'],
      ['[data-arrears-whatsapp],[data-arrears-sms]','arrears.contact'],['[data-edit-movement]','movements.edit'],['[data-delete-movement]','movements.delete'],['[data-receipt],[data-payment-voucher]','movements.receipt'],
      ['[data-debt-report]','debts.view'],['[data-edit-debt]','debts.edit'],['[data-delete-debt]','debts.delete'],['[data-debt-payment]','debts.pay'],['[data-edit-user]','users.edit'],['[data-toggle-user]','users.disable']
    ];
    $$('.nav-link[data-view]').forEach(el=>{const perm=PERMISSIONS.viewForRoute?.[el.dataset.view];el.hidden=el.dataset.view==='settings'?false:Boolean(perm&&!can(perm));});
    $$('.mobile-bottom-item[data-mobile-view]').forEach(el=>{const perm=PERMISSIONS.viewForRoute?.[el.dataset.mobileView];el.hidden=Boolean(perm&&!can(perm));});
    const mobileNav=$('#mobileBottomNav');if(mobileNav){const visible=$$('.mobile-bottom-item[data-mobile-view]').filter(el=>!el.hidden).length;mobileNav.style.setProperty('--mobile-nav-count',String(Math.max(1,visible)));}
    $$('.settings-protected').forEach(el=>el.hidden=!can('settings.view'));
    visibility.forEach(([selector,perm])=>$$(selector).forEach(el=>el.hidden=!can(perm)));
    if($('#notificationButton')) $('#notificationButton').hidden=!(can('arrears.view')||can('debts.view'));
    const settingsForm=$('#settingsForm');if(settingsForm){const editable=can('settings.edit');$$('input,select,textarea,button[type="submit"]',settingsForm).forEach(el=>el.disabled=!editable);}
    ['#backupBtn','#restoreInput'].forEach(selector=>$$(selector).forEach(el=>{const host=el.closest('label')||el;host.hidden=!can('settings.backup');}));
  }

  function guardPermissionClick(e) {
    const guards=[['[data-edit-project]','projects.edit'],['[data-delete-project]','projects.delete'],['[data-edit-building]','buildings.edit'],['[data-delete-building]','buildings.delete'],['[data-edit-tenant]','tenants.edit'],['[data-delete-tenant]','tenants.delete'],['[data-end-tenant]','tenants.end'],['[data-tenant-files],[data-open-tenant-attachment]','tenants.files'],['[data-tenant-statement],[data-building-statement]','reports.view'],['[data-pay-tenant],[data-pay-arrears]','arrears.collect'],['[data-arrears-whatsapp],[data-arrears-sms]','arrears.contact'],['[data-edit-movement]','movements.edit'],['[data-delete-movement]','movements.delete'],['[data-receipt],[data-payment-voucher]','movements.receipt'],['[data-edit-debt]','debts.edit'],['[data-delete-debt]','debts.delete'],['[data-debt-payment]','debts.pay'],['[data-edit-user]','users.edit'],['[data-toggle-user]','users.disable']];
    for(const [selector,perm] of guards){if(e.target.closest(selector)&&!can(perm)){e.preventDefault();e.stopImmediatePropagation();toast('لا تملك صلاحية تنفيذ هذه العملية.','error');return false;}}
    return true;
  }

  function currentArrearsNotifications(){
    if(!can('arrears.view')) return [];
    const cutoff=currentMonth();
    return state.tenants.filter(isTenantActive).map(t=>({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n).sort((a,b)=>Number(b.months?.length||0)-Number(a.months?.length||0));
  }
  function currentDebtInstallmentNotifications(){
    if(!can('debts.view'))return [];
    return state.debts.map(debt=>({debt,status:debtInstallmentStatus(debt)})).filter(x=>x.status&&(x.status.overdue>0n||x.status.daysUntil<=3)).sort((a,b)=>Number(b.status.overdue>0n)-Number(a.status.overdue>0n)||a.status.daysUntil-b.status.daysUntil);
  }

  function updateNotificationBadge(){
    const btn=$('#notificationButton'),badge=$('#notificationBadge');if(!btn||!badge)return;
    if(!(can('arrears.view')||can('debts.view'))){btn.hidden=true;badge.hidden=true;return;}
    btn.hidden=false;const a=currentArrearsNotifications(),d=currentDebtInstallmentNotifications(),count=a.length+d.length;
    badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;btn.classList.toggle('has-alerts',count>0);
    btn.title=count?`${a.length} متأخرات مستأجرين • ${d.length} مواعيد أقساط`:'لا توجد تنبيهات مستحقة حالياً';
  }

  function openNotificationsModal(){
    if(!(can('arrears.view')||can('debts.view'))){toast('لا تملك صلاحية عرض التنبيهات.','error');return;}
    const arrears=currentArrearsNotifications(),installments=currentDebtInstallmentNotifications();
    const arrearsHtml=arrears.length?`<div class="notification-section"><h4>متأخرات المستأجرين <span>${arrears.length}</span></h4><div class="notification-list">${arrears.slice(0,20).map(r=>{const t=r.tenant,b=buildingById(t.buildingId);return `<div class="notification-item"><div class="notification-item-main"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(b?.name||'بدون عمارة')}<br>${r.months.length} شهر متأخر</small></div><div class="notification-amount">${formatMoney(r.due,r.currency,true)}</div></div>`}).join('')}</div></div>`:'';
    const debtHtml=installments.length?`<div class="notification-section"><h4>أقساط الديون <span>${installments.length}</span></h4><div class="notification-list">${installments.slice(0,20).map(({debt,status})=>`<div class="notification-item"><div class="notification-item-main"><strong>${escapeHtml(debt.name)}</strong><small>${debt.direction==='payable'?'دين علينا':'دين لنا'} • القسط ${formatMoney(status.installment,status.currency,true)} • يوم ${status.dueDay} شهرياً<br>${status.overdue>0n?`متأخر الآن: ${formatMoney(status.overdue,status.currency,true)}`:`الاستحقاق القادم: ${dateLabel(status.nextDate)}`}</small></div><div class="notification-amount">${status.overdue>0n?'متأخر':`خلال ${status.daysUntil} يوم`}</div></div>`).join('')}</div></div>`:'';
    const body=arrearsHtml+debtHtml||'<div class="empty">لا توجد متأخرات أو أقساط مستحقة حالياً.</div>';
    const actions=`${arrears.length&&can('arrears.view')?'<button class="btn btn-primary" type="button" id="openArrearsFromAlerts">المتأخرات</button>':''}${installments.length&&can('debts.view')?'<button class="btn btn-ghost" type="button" id="openDebtsFromAlerts">الديون</button>':''}`;
    const {close}=showModal({title:'التنبيهات المالية',subtitle:`${arrears.length} متأخرات • ${installments.length} أقساط تحتاج متابعة`,icon:'i-bell',size:'lg',body,hideSubmit:true,extraFooter:actions});
    $('#openArrearsFromAlerts')?.addEventListener('click',()=>{close();setTimeout(()=>navigate('arrears'),190);});
    $('#openDebtsFromAlerts')?.addEventListener('click',()=>{close();setTimeout(()=>navigate('debts'),190);});
  }

  function formatBytes(bytes){const n=Number(bytes||0);if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;if(n<1073741824)return `${(n/1048576).toFixed(1)} MB`;return `${(n/1073741824).toFixed(2)} GB`;}
  async function openSyncModal(){
    if(!requirePermission('sync.view'))return;
    const [queue,storage]=await Promise.all([window.ShahdCloud.queueItems(),window.ShahdCloud.storageStats()]);const pct=storage.quota?Math.min(100,(storage.usage/storage.quota)*100):0;
    const body=`<div class="mini-stats"><div class="mini-card"><small>في الطابور</small><strong>${queue.length}</strong></div><div class="mini-card"><small>المستخدم محلياً</small><strong>${formatBytes(storage.usage)}</strong></div><div class="mini-card"><small>المساحة المتاحة</small><strong>${formatBytes(storage.quota)}</strong></div><div class="mini-card"><small>تخزين دائم</small><strong>${storage.persisted?'نعم':'حسب الجهاز'}</strong></div></div><div class="storage-meter"><span style="width:${pct.toFixed(1)}%"></span></div><div class="form-note" style="margin:10px 0 12px">كل عملية في الطابور مستقلة. إذا تعطلت عملية، تستمر المزامنة في باقي العمليات ولا يتم حذف العملية المتعثرة.</div><div class="sync-queue-list">${queue.length?queue.map(q=>`<div class="sync-queue-item"><div><strong>${escapeHtml(q.entityType)} • ${escapeHtml(q.action)}</strong><small>${q.attempts?`${q.attempts} محاولة`: 'بانتظار الرفع'}</small></div>${q.lastError?`<small class="queue-error">${escapeHtml(q.lastError)}</small>`:''}</div>`).join(''):'<div class="empty">الطابور فارغ — كل التعديلات متزامنة.</div>'}</div>`;
    const {close}=showModal({title:'المزامنة والطابور',subtitle:navigator.onLine===false?'الجهاز حالياً بدون إنترنت':'المزامنة اقتصادية وتقرأ التغييرات فقط',icon:'i-sync',size:'lg',body,hideSubmit:true,extraFooter:can('sync.manual')?'<button class="btn btn-primary" type="button" id="modalSyncNow"><svg class="icon"><use href="#i-sync"/></svg>مزامنة الآن</button>':''});
    $('#modalSyncNow')?.addEventListener('click',async()=>{const b=$('#modalSyncNow');b.disabled=true;try{const r=await window.ShahdCloud.syncNow({manual:true});toast(r?.failed?'تمت المزامنة مع بقاء بعض العمليات المتعثرة.':'تمت المزامنة.');close();setTimeout(openSyncModal,220);}catch(err){toast(err?.message||'تعذر المزامنة.','error');}finally{if(b)b.disabled=false;}});
  }

  function updateSyncStatus(detail={}){
    const btn=$('#syncButton'),badge=$('#syncBadge');if(!btn||!badge)return;const count=Number(detail.count||0);badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;btn.classList.toggle('syncing',detail.syncing===true);btn.classList.toggle('offline',detail.online===false);btn.classList.toggle('error',Boolean(detail.lastSyncError||detail.error));btn.title=detail.online===false?`بدون إنترنت • ${count} عملية في الطابور`:(detail.syncing?'جاري المزامنة...':`${count} عملية في الطابور`);
  }

  function installPwa() {
    if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(choice=>{if(choice.outcome==='accepted')toast('تم قبول تثبيت التطبيق.');deferredInstallPrompt=null;});return;}
    showModal({title:'تثبيت تطبيق شهد',icon:'i-download',hideSubmit:true,body:`<div class="form-note" style="font-size:13px"><strong>إذا لم يظهر زر التثبيت تلقائياً:</strong><br>• Android / Chrome: افتح قائمة المتصفح ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».<br>• iPhone / Safari: اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية».<br><br>يجب تشغيل الملفات عبر HTTPS أو localhost حتى تعمل خصائص PWA والتثبيت بشكل كامل.</div>`});
  }

  function bindEvents() {
    $('#menuBtn').addEventListener('click',openSidebar);$('#sidebarClose').addEventListener('click',closeSidebar);$('#sidebarOverlay').addEventListener('click',closeSidebar);
    $('#navList').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)navigate(b.dataset.view);});
    document.addEventListener('click',e=>{
      if(!guardPermissionClick(e))return;
      const go=e.target.closest('[data-go]');if(go)navigate(go.dataset.go);
      const op=e.target.closest('[data-open-project]');if(op)openProjectDetails(op.dataset.openProject);
      const ep=e.target.closest('[data-edit-project]');if(ep)openProjectModal(ep.dataset.editProject);
      const xp=e.target.closest('[data-delete-project]');if(xp)deleteProject(xp.dataset.deleteProject);
      const eb=e.target.closest('[data-edit-building]');if(eb)openBuildingModal(eb.dataset.editBuilding);
      const db=e.target.closest('[data-delete-building]');if(db)deleteBuilding(db.dataset.deleteBuilding);
      const et=e.target.closest('[data-edit-tenant]');if(et)openTenantModal(et.dataset.editTenant);
      const endt=e.target.closest('[data-end-tenant]');if(endt)endTenantContract(endt.dataset.endTenant);
      const tf=e.target.closest('[data-tenant-files]');if(tf)openTenantFilesModal(tf.dataset.tenantFiles);
      const ta=e.target.closest('[data-open-tenant-attachment]');if(ta){const t=tenantById(ta.dataset.openTenantAttachment),meta=ta.dataset.attachmentKind==='contract'?t?.contractAttachment:t?.identityAttachment;if(meta)window.ShahdMedia?.openAttachment?.(meta);}
      const ts=e.target.closest('[data-tenant-statement]');if(ts)openEntityStatement('tenant',ts.dataset.tenantStatement);
      const bs=e.target.closest('[data-building-statement]');if(bs)openEntityStatement('building',bs.dataset.buildingStatement);
      const dt=e.target.closest('[data-delete-tenant]');if(dt)deleteTenant(dt.dataset.deleteTenant);
      const pt=e.target.closest('[data-pay-tenant]');if(pt)openMovementModal(null,{type:'rent',tenantId:pt.dataset.payTenant});
      const pa=e.target.closest('[data-pay-arrears]');if(pa)openMovementModal(null,{type:'rent',tenantId:pa.dataset.payArrears,rentMonth:pa.dataset.firstMonth});
      const aw=e.target.closest('[data-arrears-whatsapp]');if(aw)sendArrearsWhatsApp(aw.dataset.arrearsWhatsapp);
      const as=e.target.closest('[data-arrears-sms]');if(as)sendArrearsSms(as.dataset.arrearsSms);
      const em=e.target.closest('[data-edit-movement]');if(em){const m=state.movements.find(x=>x.id===em.dataset.editMovement);if(m?.debtPaymentId)toast('هذه الحركة مرتبطة بدين. عدّل الدين أو سجّل العملية من شاشة الديون.','info');else openMovementModal(em.dataset.editMovement);}
      const dm=e.target.closest('[data-delete-movement]');if(dm){const m=state.movements.find(x=>x.id===dm.dataset.deleteMovement);if(m?.debtPaymentId)toast('هذه الحركة مرتبطة بسداد/تحصيل دين ولا تُحذف منفردة للحفاظ على دقة الحسابات.','error');else deleteMovement(dm.dataset.deleteMovement);}
      const rc=e.target.closest('[data-receipt]');if(rc)openReceiptActions(rc.dataset.receipt);
      const pv=e.target.closest('[data-payment-voucher]');if(pv)openPaymentVoucherActions(pv.dataset.paymentVoucher);
      const ed=e.target.closest('[data-edit-debt]');if(ed)openDebtModal(ed.dataset.editDebt);
      const dd=e.target.closest('[data-delete-debt]');if(dd)deleteDebt(dd.dataset.deleteDebt);
      const dr=e.target.closest('[data-debt-report]');if(dr)openDebtDetailedReport(dr.dataset.debtReport);
      const dp=e.target.closest('[data-debt-payment]');if(dp)openDebtPaymentModal(dp.dataset.debtPayment);
      const dh=e.target.closest('[data-debt-history]');if(dh)openDebtHistoryModal(dh.dataset.debtHistory);
      const dpr=e.target.closest('[data-debt-payment-receipt]');if(dpr){const pay=state.debtPayments.find(x=>x.id===dpr.dataset.debtPaymentReceipt);if(pay?.movementId)openReceiptActions(pay.movementId);}
      const ddp=e.target.closest('[data-delete-debt-payment]');if(ddp)deleteDebtPayment(ddp.dataset.deleteDebtPayment);
      const eu=e.target.closest('[data-edit-user]');if(eu)openUserModal(eu.dataset.editUser);
      const tu=e.target.closest('[data-toggle-user]');if(tu)toggleCompanyUser(tu.dataset.toggleUser,tu.dataset.userActive==='1');
    });
    $('#quickMovementBtn').addEventListener('click',withPermission('movements.create',()=>openMovementModal()));$('#addMovementBtn').addEventListener('click',withPermission('movements.create',()=>openMovementModal()));$('#quickPaymentVoucherBtn').addEventListener('click',withPermission('movements.create',()=>openMovementModal(null,{flow:'out'})));$('#addPaymentVoucherBtn').addEventListener('click',withPermission('movements.create',()=>openMovementModal(null,{flow:'out'})));
    $('#heroTenantBtn').addEventListener('click',withPermission('tenants.create',()=>openTenantModal()));$('#heroDebtBtn').addEventListener('click',withPermission('debts.create',()=>openDebtModal()));
    $('#addProjectBtn').addEventListener('click',withPermission('projects.create',()=>openProjectModal()));$('#projectSearch').addEventListener('input',renderProjects);
    $('#projectEditBtn').addEventListener('click',withPermission('projects.edit',()=>{if(activeProjectId)openProjectModal(activeProjectId);}));$('#projectAddMovementBtn').addEventListener('click',withPermission('movements.create',()=>{if(activeProjectId)openMovementModal(null,{projectId:activeProjectId});}));$('#projectAddReceivableBtn').addEventListener('click',withPermission('debts.create',()=>{if(activeProjectId)openDebtModal(null,{projectId:activeProjectId,direction:'receivable'});}));$('#projectAddPayableBtn').addEventListener('click',withPermission('debts.create',()=>{if(activeProjectId)openDebtModal(null,{projectId:activeProjectId,direction:'payable'});}));
    $('#projectTabs').addEventListener('click',e=>{const t=e.target.closest('[data-project-tab]');if(t){activeProjectTab=t.dataset.projectTab;renderProjectDetails();}});
    $('#addBuildingBtn').addEventListener('click',withPermission('buildings.create',()=>openBuildingModal()));$('#addTenantBtn').addEventListener('click',withPermission('tenants.create',()=>openTenantModal()));$('#addDebtBtn').addEventListener('click',withPermission('debts.create',()=>openDebtModal()));
    $('#buildingSearch').addEventListener('input',renderBuildings);$('#tenantSearch').addEventListener('input',renderTenants);$('#tenantBuildingFilter').addEventListener('change',renderTenants);$('#tenantTabs').addEventListener('click',e=>{const t=e.target.closest('[data-tenant-tab]');if(t){activeTenantTab=t.dataset.tenantTab;renderTenants();}});
    ['movementDateFrom','movementDateTo','movementTypeFilter','movementProjectFilter'].forEach(id=>$(`#${id}`).addEventListener('change',renderMovements));
    $('#arrearsCutoff').value=currentMonth();$('#arrearsCutoff').addEventListener('change',()=>{renderArrears();renderReports();});$('#arrearsBuildingFilter').addEventListener('change',renderArrears);$('#refreshArrearsBtn').addEventListener('click',renderArrears);$('#exportArrearsPdfBtn').addEventListener('click',withPermission('reports.export',exportArrearsPdf));
    $('#debtTabs').addEventListener('click',e=>{const t=e.target.closest('[data-debt-tab]');if(t){activeDebtTab=t.dataset.debtTab;renderDebts();}});
    $('#reportFrom').addEventListener('change',renderReports);$('#reportTo').addEventListener('change',renderReports);$('#exportCsvBtn').addEventListener('click',withPermission('reports.export',exportCsv));
    $('#settingsForm').addEventListener('submit',e=>{e.preventDefault();if(!requirePermission('settings.edit'))return;const fd=new FormData(e.currentTarget);state.settings.companyName=String(fd.get('companyName')||'').trim()||'شركة شهد';state.settings.companySubtitle=String(fd.get('companySubtitle')||'').trim();state.settings.defaultExecutor=String(fd.get('defaultExecutor')||'').trim();state.settings.receiptPrefix=String(fd.get('receiptPrefix')||'SH').trim().toUpperCase();state.settings.whatsappCountryCode=String(fd.get('whatsappCountryCode')||'970').replace(/\D/g,'')||'970';state.settings.rentDueDay=Math.min(28,Math.max(1,Number(fd.get('rentDueDay')||1)));state.settings.theme=fd.get('theme')||'light';saveState();toast('تم حفظ الإعدادات.');});
    $('#installPwaBtn').addEventListener('click',installPwa);$('#backupBtn').addEventListener('click',withPermission('settings.backup',exportBackup));$('#restoreInput').addEventListener('change',e=>{if(!requirePermission('settings.backup')){e.target.value='';return;}if(e.target.files[0])restoreBackup(e.target.files[0]);e.target.value='';});
    $('#addUserBtn').addEventListener('click',withPermission('users.create',()=>openUserModal()));
    $('#syncButton').addEventListener('click',openSyncModal);
    $('#notificationButton').addEventListener('click',openNotificationsModal);
    $('#settingsLogoutBtn').addEventListener('click',()=>confirmAction({title:'تسجيل الخروج',message:'هل تريد تسجيل الخروج من الحساب على هذا الجهاز؟',confirmText:'تسجيل الخروج',onConfirm:()=>window.ShahdCloud.forceLogout('تم تسجيل الخروج.')}));
    window.addEventListener('shahd:sync-status',e=>updateSyncStatus(e.detail||{}));
    window.ShahdCloud.queueCount().then(count=>updateSyncStatus({count,online:navigator.onLine!==false}));
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('تم تثبيت التطبيق على الجهاز.');});
    window.addEventListener('shahd:media-uploaded',e=>{const d=e.detail||{};if(d.ownerType!=='tenant'||!d.ownerId)return;const t=tenantById(d.ownerId);if(!t)return;if(d.kind==='contract')t.contractAttachment=d.meta;if(d.kind==='identity')t.identityAttachment=d.meta;saveState();renderTenants();});
    window.addEventListener('online',()=>window.ShahdMedia?.syncPending?.());
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){const closeBtn=$('#modalClose');if(closeBtn)closeBtn.click();else closeSidebar();}});
  }

  function initPwa() {
    if(!('serviceWorker' in navigator))return;
    const register=()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update().catch(()=>{})).catch(err=>console.warn('SW',err));
    if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',register,{once:true});else register();
    navigator.storage?.persist?.().catch(()=>{});
  }

  async function boot() {
    applyTheme();
    initPwa();
    const cloud = await window.ShahdCloud.start(cloneDefaults);
    state = { ...cloneDefaults(), ...(cloud?.state || {}) };
    state.settings = { ...defaults.settings, ...(state.settings || {}) };
    if(!can(PERMISSIONS.viewForRoute?.dashboard)){const first=Object.entries(PERMISSIONS.viewForRoute||{}).find(([view,perm])=>view!=='project-details'&&can(perm));if(first)activeView=first[0];}
    bindEvents(); navigate(activeView);
    window.addEventListener('shahd:state-remote', e => {
      if (!e.detail?.state) return;
      state = { ...cloneDefaults(), ...e.detail.state, settings:{...defaults.settings,...(e.detail.state.settings||{})} };
      renderAll();
    });
    window.addEventListener('shahd:session-ready', e => {
      if (!e.detail?.state) return;
      state = { ...cloneDefaults(), ...e.detail.state, settings:{...defaults.settings,...(e.detail.state.settings||{})} };
      const routePerm=PERMISSIONS.viewForRoute?.[activeView];
      if(routePerm&&!can(routePerm)){const first=Object.entries(PERMISSIONS.viewForRoute||{}).find(([view,perm])=>view!=='project-details'&&can(perm));activeView=first?.[0]||'dashboard';}
      navigate(activeView);
    });
    window.addEventListener('shahd:logout', () => { $('#modalRoot').innerHTML=''; closeSidebar(); });
  }
  boot().catch(err => { console.error(err); const box=$('#loginStatus'); if(box){box.textContent=err?.message||'تعذر تشغيل النظام.';box.className='login-status error show';} });
})();
