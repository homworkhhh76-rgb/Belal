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

  let state = loadState();
  let activeView = 'dashboard';
  let activeDebtTab = 'receivable';
  let activeProjectId = '';
  let activeProjectTab = 'movements';
  let deferredInstallPrompt = null;

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];

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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    return `<label class="field ${extraClass}"><span>${label}</span><textarea class="textarea" name="${name}">${escapeHtml(value)}</textarea></label>`;
  }

  function navigate(view) {
    activeView = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === view));
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
      settings:['الإعدادات','هوية الشركة والتثبيت والنسخ الاحتياطي']
    };
    $('#pageTitle').textContent = meta[view]?.[0] || '';
    $('#pageSubtitle').textContent = meta[view]?.[1] || '';
    if(view==='project-details'){const p=projectById(activeProjectId);if(p){$('#pageTitle').textContent=p.name;$('#pageSubtitle').textContent='إدارة مالية مستقلة للمشروع';}}
    closeSidebar();
    renderAll();
    const mainScroller=$('.main');
    if(mainScroller && mainScroller.scrollHeight>mainScroller.clientHeight){
      mainScroller.scrollTo({top:0,behavior:'smooth'});
    } else {
      window.scrollTo({top:0,behavior:'smooth'});
    }
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
    renderSettings();
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
    return `<table><thead><tr><th>النوع</th><th>الاسم / الجهة</th><th>المبلغ الأصلي</th><th>المدفوع / المحصّل</th><th>المتبقي</th><th>${isClosed?'تاريخ الإنهاء':'تاريخ الدين'}</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${list.map(d=>{const direction=d.direction||'receivable',paid=debtPaidUnits(d),rem=debtRemainingUnits(d),op=direction==='receivable'?'تحصيل':'سداد';return `<tr><td><span class="badge ${direction==='receivable'?'badge-green':'badge-red'}">${direction==='receivable'?'دين لنا':'دين علينا'}</span></td><td><strong>${escapeHtml(d.name)}</strong></td><td>${formatMoney(d.amount,d.currency)}</td><td class="${direction==='receivable'?'money-in':'money-out'}">${formatMoney(paid,d.currency,true)}</td><td class="${rem>0n?'money-out':'money-in'}">${formatMoney(rem,d.currency,true)}</td><td>${dateLabel(isClosed?d.completedDate:d.date)}</td><td>${escapeHtml(d.notes||'—')}</td><td><div class="actions">${d.status!=='closed'?`<button class="btn btn-primary btn-sm" data-debt-payment="${d.id}">${op}</button>`:''}${paid>0n?`<button class="btn btn-ghost btn-sm" data-debt-history="${d.id}">السجل</button>`:''}<button class="btn btn-ghost btn-sm btn-icon" data-edit-debt="${d.id}" title="تعديل"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" data-delete-debt="${d.id}" title="حذف"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`}).join('')}</tbody></table>`;
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
    const cutoffIdx = monthToIndex(cutoff);
    const duration = Math.max(1, Number(tenant.contractMonths || 12));
    const endIdx = startIdx + duration - 1;
    const lastIdx = Math.min(cutoffIdx ?? endIdx, endIdx);
    if (lastIdx < startIdx) return {currency,monthly,months:[],due:0n,paid:0n,charged:0n};
    const dueMonths = Array.from({length:lastIdx-startIdx+1},(_,i)=>indexToMonth(startIdx+i));
    const paidMap = Object.fromEntries(dueMonths.map(m=>[m,0n]));
    const rentMovements = state.movements
      .filter(m => m.type==='rent' && m.tenantId===tenant.id)
      .sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.createdAt||'').localeCompare(b.createdAt||''));
    rentMovements.forEach(m => {
      let remaining = toUnits(m.amounts?.[currency]?.in || '0', currency);
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
    const due = months.reduce((s,x)=>s+x.due,0n);
    const paid = dueMonths.reduce((s,m)=>s+(paidMap[m]||0n),0n);
    const charged = BigInt(dueMonths.length) * monthly;
    return {currency,monthly,months,due,paid,charged,contractEnd:indexToMonth(endIdx)};
  }

  function renderDashboard() {
    const cutoff = getDashboardCutoffMonth();
    const arrearsRows = state.tenants.map(t => ({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n);
    const openReceivable = state.debts.filter(d=>d.status!=='closed' && (d.direction||'receivable')==='receivable');
    const openPayable = state.debts.filter(d=>d.status!=='closed' && d.direction==='payable');
    const openDebts = [...openReceivable,...openPayable];
    const stats = [
      {label:'المشاريع',value:state.projects.length,note:'مشروع مستقل',icon:'i-project'},
      {label:'العقارات',value:state.buildings.length,note:'عمارة مسجلة',icon:'i-building'},
      {label:'المستأجرون',value:state.tenants.length,note:'عقد إيجار',icon:'i-users'},
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
      return `<article class="entity-card"><div class="entity-head"><div class="entity-icon"><svg class="icon"><use href="#i-building"/></svg></div><span class="badge badge-blue">${tenants} مستأجر</span></div><h3>${escapeHtml(b.name)}</h3><p>${escapeHtml(b.address || 'بدون عنوان')}</p><div class="entity-meta"><div class="meta-chip"><small>عدد الشقق</small><strong>${Number(b.apartments||0)}</strong></div><div class="meta-chip"><small>الإشغال</small><strong>${tenants} / ${Number(b.apartments||0) || '—'}</strong></div></div><div class="card-actions"><button class="btn btn-ghost btn-sm" data-edit-building="${b.id}"><svg class="icon"><use href="#i-edit"/></svg>تعديل</button><button class="btn btn-danger-soft btn-sm" data-delete-building="${b.id}"><svg class="icon"><use href="#i-trash"/></svg>حذف</button></div></article>`;
    }).join('') : `<div class="panel empty" style="grid-column:1/-1">لا توجد عقارات مطابقة. استخدم زر «إضافة عمارة» للبدء.</div>`;
  }

  function renderTenants() {
    const q = ($('#tenantSearch')?.value || '').trim().toLowerCase();
    const buildingFilter = $('#tenantBuildingFilter')?.value || '';
    const list = state.tenants.filter(t => {
      const b = buildingById(t.buildingId);
      const matchQ = !q || `${t.name} ${t.phone} ${t.idNumber} ${b?.name||''}`.toLowerCase().includes(q);
      return matchQ && (!buildingFilter || t.buildingId===buildingFilter);
    });
    $('#tenantsTable').innerHTML = list.length ? `<table><thead><tr><th>المستأجر</th><th>العقار</th><th>الموقع</th><th>الإيجار الشهري</th><th>بداية العقد</th><th>مدة العقد</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${list.map(t=>{
      const b=buildingById(t.buildingId); const a=calculateTenantArrears(t,getDashboardCutoffMonth());
      return `<tr><td><strong>${escapeHtml(t.name)}</strong><br><small>${escapeHtml(t.phone||'')}</small></td><td>${escapeHtml(b?.name||'—')}</td><td>${escapeHtml([t.floor,t.direction].filter(Boolean).join(' / ')||'—')}</td><td><strong>${formatMoney(t.rentAmount,t.rentCurrency)}</strong></td><td>${monthLabel(t.startMonth)}</td><td>${Number(t.contractMonths||12)} شهر</td><td>${a.due>0n?`<span class="badge badge-red">متأخر ${a.months.length} شهر</span>`:`<span class="badge badge-green">منتظم</span>`}</td><td><div class="actions"><button class="btn btn-ghost btn-sm btn-icon" title="دفعة" data-pay-tenant="${t.id}"><svg class="icon"><use href="#i-receipt"/></svg></button><button class="btn btn-ghost btn-sm btn-icon" title="تعديل" data-edit-tenant="${t.id}"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" title="حذف" data-delete-tenant="${t.id}"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`;
    }).join('')}</tbody></table>` : `<div class="empty">لا يوجد مستأجرون مطابقون.</div>`;
  }

  function movementsTableMarkup(list, compact=false) {
    return `<table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المكان / المستأجر</th>${compact?'<th>القيمة</th>':CURRENCIES.map(c=>`<th>${CURRENCY_META[c].label} وارد</th><th>${CURRENCY_META[c].label} مصروف</th>`).join('')}<th>إجراءات</th></tr></thead><tbody>${list.map(m=>{
      const tenant=tenantById(m.tenantId), building=buildingById(m.buildingId);
      const project=projectById(m.projectId);
      const placeBase = m.type==='rent' ? (tenant?.name||'مستأجر محذوف') : (building?.name||m.account||'مركزي');
      const place = project ? `${placeBase} — مشروع: ${project.name}` : placeBase;
      let valueCell='';
      if (compact) {
        const vals=[]; CURRENCIES.forEach(c=>{ const i=toUnits(m.amounts?.[c]?.in||0,c),o=toUnits(m.amounts?.[c]?.out||0,c); if(i) vals.push(`<span class="money-in">+${formatMoney(i,c,true)}</span>`); if(o) vals.push(`<span class="money-out">-${formatMoney(o,c,true)}</span>`);});
        valueCell=`<td>${vals.join('<br>')||'—'}</td>`;
      } else {
        valueCell=CURRENCIES.map(c=>`<td class="money-in">${toUnits(m.amounts?.[c]?.in||0,c)>0n?formatMoney(m.amounts[c].in,c):'—'}</td><td class="money-out">${toUnits(m.amounts?.[c]?.out||0,c)>0n?formatMoney(m.amounts[c].out,c):'—'}</td>`).join('');
      }
      const hasIncoming=CURRENCIES.some(c=>toUnits(m.amounts?.[c]?.in||0,c)>0n);
      return `<tr><td>${dateLabel(m.date)}</td><td>${m.type==='rent'?'<span class="badge badge-green">دفعة مستأجر</span>':'<span class="badge badge-blue">حركة عامة</span>'}</td><td><strong>${escapeHtml(m.detail||'—')}</strong>${m.rentMonths?.length?`<br><small>${m.rentMonths.map(monthLabel).join('، ')}</small>`:''}</td><td>${escapeHtml(place)}</td>${valueCell}<td><div class="actions">${hasIncoming?`<button class="btn btn-ghost btn-sm receipt-action-btn" title="سند قبض" data-receipt="${m.id}"><svg class="icon"><use href="#i-receipt"/></svg><span>سند قبض</span></button>`:''}<button class="btn btn-ghost btn-sm btn-icon" title="تعديل" data-edit-movement="${m.id}"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" title="حذف" data-delete-movement="${m.id}"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`;
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
    const rows=state.tenants.filter(t=>!buildingFilter||t.buildingId===buildingFilter).map(t=>({tenant:t,...calculateTenantArrears(t,cutoff)})).filter(x=>x.due>0n);
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

  function debtPaidUnits(debt) {
    return state.debtPayments.filter(p=>p.debtId===debt.id && p.currency===debt.currency).reduce((s,p)=>s+toUnits(p.amount,debt.currency),0n);
  }
  function debtRemainingUnits(debt) {
    const total=toUnits(debt.amount,debt.currency), paid=debtPaidUnits(debt); return total>paid?total-paid:0n;
  }
  function renderDebts() {
    const isClosed = activeDebtTab === 'closed';
    const list = state.debts.filter(d => {
      if (isClosed) return d.status === 'closed';
      return d.status !== 'closed' && (d.direction || 'receivable') === activeDebtTab;
    }).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    $$('#debtTabs .tab').forEach(t=>t.classList.toggle('active',t.dataset.debtTab===activeDebtTab));

    const summaryBase = isClosed ? state.debts.filter(d=>d.status==='closed') : list;
    $('#debtSummary').innerHTML=CURRENCIES.map(c=>{
      const same=summaryBase.filter(d=>d.currency===c);
      const total=isClosed
        ? same.reduce((s,d)=>s+toUnits(d.amount,d.currency),0n)
        : same.reduce((s,d)=>s+debtRemainingUnits(d),0n);
      const label=isClosed ? `${CURRENCY_META[c].label} تم إنهاؤه` : `${CURRENCY_META[c].label} متبقي`;
      const note=isClosed ? `${same.length} حساب مكتمل` : `${same.length} دين ${activeDebtTab==='receivable'?'لنا':'علينا'}`;
      return `<div class="mini-card"><small>${label}</small><strong>${formatMoney(total,c,true)}</strong><div class="stat-note">${note}</div></div>`;
    }).join('');

    const emptyText = isClosed ? 'لا توجد ديون تم سدادها وإنهاؤها حتى الآن.' : activeDebtTab==='receivable' ? 'لا توجد ديون لنا مفتوحة.' : 'لا توجد ديون علينا مفتوحة.';
    $('#debtsTable').innerHTML=list.length?`<table><thead><tr><th>النوع</th><th>المشروع</th><th>الاسم</th><th>الجوال / الهوية</th><th>المبلغ الأصلي</th><th>${isClosed?'تم سداده/تحصيله':'المدفوع/المحصّل'}</th><th>المتبقي</th><th>${isClosed?'تاريخ الإنهاء':'تاريخ الدين'}</th><th>ملاحظات</th><th>إجراءات</th></tr></thead><tbody>${list.map(d=>{
      const direction=d.direction||'receivable', paid=debtPaidUnits(d), rem=debtRemainingUnits(d);
      const directionBadge=direction==='receivable'?'<span class="badge badge-green">دين لنا</span>':'<span class="badge badge-red">دين علينا</span>';
      const actionLabel=direction==='receivable'?'تحصيل':'سداد';
      const project=projectById(d.projectId);
      return `<tr><td>${directionBadge}</td><td>${project?`<span class="badge badge-blue">${escapeHtml(project.name)}</span>`:'—'}</td><td><strong>${escapeHtml(d.name)}</strong></td><td>${escapeHtml(d.phone||'—')}<br><small>${escapeHtml(d.idNumber||'')}</small></td><td>${formatMoney(d.amount,d.currency)}</td><td class="${direction==='receivable'?'money-in':'money-out'}">${formatMoney(paid,d.currency,true)}</td><td class="${rem>0n?'money-out':'money-in'}">${formatMoney(rem,d.currency,true)}</td><td>${dateLabel(d.status==='closed'?d.completedDate:d.date)}</td><td>${escapeHtml(d.notes||'—')}</td><td><div class="actions">${d.status!=='closed'?`<button class="btn btn-primary btn-sm" data-debt-payment="${d.id}">${actionLabel}</button>`:''}${paid>0n?`<button class="btn btn-ghost btn-sm" data-debt-history="${d.id}">السجل</button>`:''}<button class="btn btn-ghost btn-sm btn-icon" data-edit-debt="${d.id}" title="تعديل"><svg class="icon"><use href="#i-edit"/></svg></button><button class="btn btn-danger-soft btn-sm btn-icon" data-delete-debt="${d.id}" title="حذف"><svg class="icon"><use href="#i-trash"/></svg></button></div></td></tr>`;
    }).join('')}</tbody></table>`:`<div class="empty">${emptyText}</div>`;
  }

  function reportMovements() {
    const from=$('#reportFrom')?.value||'', to=$('#reportTo')?.value||'';
    return state.movements.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to));
  }
  function renderReports() {
    const list=reportMovements();
    const cutoff=$('#arrearsCutoff')?.value||currentMonth();
    const arrears=state.tenants.map(t=>calculateTenantArrears(t,cutoff));
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

  function moneyInputs(existingAmounts=null) {
    const amounts=existingAmounts||emptyAmounts();
    return `<div class="money-grid">${CURRENCIES.map(c=>`<div class="money-box" data-currency-box="${c}"><h4>مبالغ ${CURRENCY_META[c].label} ${CURRENCY_META[c].symbol}</h4><div class="money-fields"><div class="money-field in"><label>وارد ${CURRENCY_META[c].label}</label><input class="input money-input" name="${c}_in" type="number" min="0" step="${c==='ILS'||c==='USD'?'0.01':'0.001'}" value="${escapeHtml(amounts[c]?.in||'0')}" /></div><div class="money-field out"><label>مصروف ${CURRENCY_META[c].label}</label><input class="input money-input" name="${c}_out" type="number" min="0" step="${c==='ILS'||c==='USD'?'0.01':'0.001'}" value="${escapeHtml(amounts[c]?.out||'0')}" /></div></div></div>`).join('')}</div>`;
  }

  function openMovementModal(id=null, prefill={}) {
    const m=id?state.movements.find(x=>x.id===id):null;
    const type=prefill.type||m?.type||'general';
    const buildingOptions=[{value:'',label:'مركزي / عام'},...state.buildings.map(b=>({value:b.id,label:b.name}))];
    const projectOptions=[{value:'',label:'بدون مشروع / حساب عام'},...state.projects.map(p=>({value:p.id,label:p.name}))];
    const tenantOptions=[{value:'',label:'-- اختر المستأجر --'},...state.tenants.map(t=>({value:t.id,label:`${t.name} — ${buildingById(t.buildingId)?.name||''}`}))];
    const amounts=m?.amounts||emptyAmounts();
    const rentMonth=prefill.rentMonth||m?.rentMonths?.[0]||m?.rentMonth||currentMonth();
    const rentCount=m?.rentMonths?.length||1;
    const body=`<div class="form-grid"><label class="field full"><span>نوع الحركة المالية</span><select class="select" name="type" id="movementType"><option value="general" ${type==='general'?'selected':''}>حركة يومية عامة (مصروف / وارد)</option><option value="rent" ${type==='rent'?'selected':''}>تحصيل إيجار مستأجر (ربط تلقائي بجدول الإيجارات)</option></select></label>${field('date','تاريخ الحركة',m?.date||today(),'date','required')}${field('executor','المنفذ',m?.executor||state.settings.defaultExecutor||'')}${selectField('projectId','المشروع',projectOptions,prefill.projectId||m?.projectId||'','full')}${selectField('buildingId','المجال / الحساب / العمارة',buildingOptions,m?.buildingId||'','full')}<div class="full" id="rentFields" style="display:none"><div class="money-box" style="background:var(--primary-soft)"><div class="form-grid" style="padding:0">${selectField('tenantId','اختر المستأجر',tenantOptions,prefill.tenantId||m?.tenantId||'')}${field('rentMonth','من شهر',rentMonth,'month')}${field('rentCount','عدد الأشهر',rentCount,'number','min="1" max="24" step="1"')}<div class="field"><span>الربط</span><div class="form-note">سيتم ربط المبلغ بالأشهر بالتسلسل لحساب المتأخرات.</div></div></div></div></div>${fullField('detail','البيان التوضيحي والتفاصيل',m?.detail||'')}${textareaField('notes','ملاحظات',m?.notes||'')}</div>${moneyInputs(amounts)}`;
    const {form}=showModal({title:m?'تعديل الحركة المالية':'تسجيل حركة يومية / دفعة مستأجر',subtitle:'يدعم شيكل، دولار، دينار وذهب كوحدات مستقلة',icon:'i-receipt',body,size:'lg',submitText:m?'حفظ التعديل':'حفظ الحركة المالية',onSubmit:(fd,_form,closeModal)=>{
      const movementType=fd.get('type');
      const outAmounts=emptyAmounts(); let any=false;
      CURRENCIES.forEach(c=>{outAmounts[c].in=normalizeAmount(fd.get(`${c}_in`)||0,c);outAmounts[c].out=normalizeAmount(fd.get(`${c}_out`)||0,c);if(toUnits(outAmounts[c].in,c)>0n||toUnits(outAmounts[c].out,c)>0n)any=true;});
      if(!any){toast('أدخل مبلغاً واحداً على الأقل في الوارد أو المصروف.','error');return false;}
      let tenantId='',rentMonths=[]; let buildingId=fd.get('buildingId')||'';
      if(movementType==='rent'){
        tenantId=fd.get('tenantId')||''; const tenant=tenantById(tenantId); if(!tenant){toast('اختر المستأجر.','error');return false;}
        const start=fd.get('rentMonth'); const count=Math.max(1,Number(fd.get('rentCount')||1)); if(!start){toast('حدد الشهر الذي تبدأ منه الدفعة.','error');return false;}
        rentMonths=monthRange(start,count); buildingId=tenant.buildingId;
        const rentCurrency=tenant.rentCurrency; if(toUnits(outAmounts[rentCurrency].in,rentCurrency)<=0n){toast(`دفعة الإيجار يجب أن تحتوي وارداً بعملة العقد: ${CURRENCY_META[rentCurrency].label}.`,'error');return false;}
      }
      const rec={id:m?.id||uid('m'),type:movementType,date:fd.get('date')||today(),executor:String(fd.get('executor')||'').trim(),projectId:fd.get('projectId')||'',buildingId,tenantId,rentMonths,detail:String(fd.get('detail')||'').trim() || (movementType==='rent'?'دفعة إيجار':'حركة مالية'),notes:String(fd.get('notes')||'').trim(),amounts:outAmounts,receiptNo:m?.receiptNo||makeReceiptNo(),createdAt:m?.createdAt||new Date().toISOString()};
      if(m) Object.assign(m,rec); else state.movements.push(rec);
      saveState();
      toast(m?'تم تعديل الحركة المالية.':'تم حفظ الحركة المالية بنجاح.');
      const hasIncoming=CURRENCIES.some(c=>toUnits(rec.amounts?.[c]?.in||0,c)>0n);
      if(!m && movementType==='rent' && hasIncoming){
        closeModal();
        setTimeout(()=>openReceiptActions(rec.id),80);
        return false;
      }
      return true;
    }});
    const typeEl=$('#movementType',form), rentFields=$('#rentFields',form), tenantEl=$('[name="tenantId"]',form), monthEl=$('[name="rentMonth"]',form), countEl=$('[name="rentCount"]',form), buildingEl=$('[name="buildingId"]',form);
    const toggleRent=()=>{const isRent=typeEl.value==='rent';rentFields.style.display=isRent?'block':'none';if(isRent&&!state.tenants.length)toast('لا يوجد مستأجرون بعد. أضف مستأجراً أولاً.','info');};
    const autoRent=()=>{if(typeEl.value!=='rent')return;const tenant=tenantById(tenantEl.value);if(!tenant)return;buildingEl.value=tenant.buildingId||'';const count=Math.max(1,Number(countEl.value||1));const total=toUnits(tenant.rentAmount,tenant.rentCurrency)*BigInt(count);CURRENCIES.forEach(c=>{const input=$(`[name="${c}_in"]`,form);if(input) input.value=c===tenant.rentCurrency?unitsToDecimal(total,c,false):normalizeAmount('0',c);});};
    typeEl.addEventListener('change',()=>{toggleRent();autoRent();}); tenantEl?.addEventListener('change',autoRent); countEl?.addEventListener('input',autoRent); monthEl?.addEventListener('change',()=>{}); toggleRent();
    if(!m && type==='rent') setTimeout(autoRent,20);
  }

  function makeReceiptNo(){return `${state.settings.receiptPrefix||'SH'}-${today().replaceAll('-','')}-${String(state.movements.length+1).padStart(4,'0')}`;}

  function openDebtModal(id=null, prefill={}) {
    const d=id?debtById(id):null;
    const currencyOptions=CURRENCIES.map(c=>({value:c,label:CURRENCY_META[c].label}));
    const projectOptions=[{value:'',label:'بدون مشروع / حساب عام'},...state.projects.map(p=>({value:p.id,label:p.name}))];
    const directionOptions=[
      {value:'receivable',label:'دين لنا — مبلغ مطلوب لنا من شخص / جهة'},
      {value:'payable',label:'دين علينا — مبلغ مستحق علينا لشخص / جهة'}
    ];
    const body=`<div class="form-grid">${selectField('direction','نوع الدين',directionOptions,prefill.direction||d?.direction||'receivable','full')}${selectField('projectId','المشروع',projectOptions,prefill.projectId||d?.projectId||'','full')}${fullField('name','اسم الشخص / الجهة',d?.name||'','text','required')}${field('phone','رقم الجوال',d?.phone||'','tel')}${field('idNumber','رقم الهوية / المرجع',d?.idNumber||'')}${field('date','تاريخ تسجيل الدين',d?.date||today(),'date','required')}${field('amount','المبلغ الأصلي',d?.amount||'','number','min="0" step="0.001" required')}${selectField('currency','العملة',currencyOptions,d?.currency||'ILS')}${textareaField('notes','ملاحظات',d?.notes||'')}</div><div class="form-note">«ديون لنا» هي المبالغ التي نريد تحصيلها من الآخرين. «ديون علينا» هي المبالغ المطلوب منا سدادها. عند كل تحصيل أو سداد تُسجّل حركة مالية تلقائياً في الحركة اليومية.</div>`;
    showModal({title:d?'تعديل الدين':'إضافة دين جديد',subtitle:'اختر بوضوح هل الدين لنا أم علينا',icon:'i-debt',body,onSubmit:(fd)=>{
      const c=fd.get('currency'), direction=fd.get('direction')==='payable'?'payable':'receivable', projectId=fd.get('projectId')||'', amount=normalizeAmount(fd.get('amount'),c);
      if(toUnits(amount,c)<=0n){toast('المبلغ يجب أن يكون أكبر من صفر.','error');return false;}
      if(!String(fd.get('name')||'').trim()){toast('أدخل اسم الشخص أو الجهة.','error');return false;}
      if(d&&c!==d.currency&&debtPaidUnits(d)>0n){toast('لا يمكن تغيير عملة دين عليه دفعات مسجلة.','error');return false;}
      if(d&&direction!==(d.direction||'receivable')&&debtPaidUnits(d)>0n){toast('لا يمكن تغيير نوع الدين بعد تسجيل تحصيل أو سداد عليه.','error');return false;}
      if(d&&projectId!==(d.projectId||'')&&debtPaidUnits(d)>0n){toast('لا يمكن نقل الدين إلى مشروع آخر بعد تسجيل تحصيل أو سداد عليه.','error');return false;}
      const rec={id:d?.id||uid('d'),direction,projectId,name:String(fd.get('name')||'').trim(),phone:String(fd.get('phone')||'').trim(),idNumber:String(fd.get('idNumber')||'').trim(),date:fd.get('date')||today(),amount,currency:c,notes:String(fd.get('notes')||'').trim(),status:d?.status||'open',completedDate:d?.completedDate||'',createdAt:d?.createdAt||new Date().toISOString()};
      if(d)Object.assign(d,rec);else state.debts.push(rec);
      activeDebtTab=d?.status==='closed'?'closed':direction;
      if(projectId&&projectId===activeProjectId&&activeView==='project-details') activeProjectTab=d?.status==='closed'?'closed':direction;
      saveState();toast(d?'تم تحديث الدين.':direction==='receivable'?'تم تسجيل دين لنا بنجاح.':'تم تسجيل دين علينا بنجاح.');return true;
    }});
  }

  function openDebtPaymentModal(debtId) {
    const d=debtById(debtId); if(!d)return;
    const rem=debtRemainingUnits(d), c=d.currency, direction=d.direction||'receivable';
    const isReceivable=direction==='receivable';
    const operation=isReceivable?'تحصيل':'سداد';
    const body=`<div class="form-grid"><div class="field full"><span>الحساب</span><div class="form-note"><strong>${escapeHtml(d.name)}</strong> — ${isReceivable?'لنا عنده':'علينا له'} — المتبقي ${formatMoney(rem,c,true)}</div></div>${field('amount',`قيمة ${operation}`,unitsToDecimal(rem,c,false),'number',`min="0" step="${CURRENCY_META[c].precision===2?'0.01':'0.001'}" required`)}${field('date',`تاريخ ${operation}`,today(),'date','required')}${field('executor','المنفذ',state.settings.defaultExecutor||'')}${textareaField('notes','ملاحظات','')}</div><div class="form-note">سيتم تسجيل ${isReceivable?'وارد':'مصروف'} تلقائياً بقيمة العملية في الحركة اليومية وبنفس العملة.</div>`;
    showModal({title:`تسجيل ${operation} دين`,subtitle:`${isReceivable?'دين لنا':'دين علينا'} — العملة: ${CURRENCY_META[c].label}`,icon:'i-check',body,submitText:`حفظ ${operation}`,onSubmit:(fd)=>{
      const amount=normalizeAmount(fd.get('amount'),c),u=toUnits(amount,c);
      if(u<=0n){toast(`أدخل قيمة ${operation} صحيحة.`,'error');return false;}
      if(u>rem){toast(`قيمة ${operation} أكبر من المبلغ المتبقي.`,'error');return false;}
      const date=fd.get('date')||today(), executor=String(fd.get('executor')||'').trim(), notes=String(fd.get('notes')||'').trim();
      const paymentId=uid('dp');
      const amounts=emptyAmounts();
      amounts[c][isReceivable?'in':'out']=amount;
      const movementId=uid('m');
      const movement={id:movementId,type:'general',date,executor,projectId:d.projectId||'',buildingId:'',tenantId:'',account:d.name,detail:`${operation} دين ${isReceivable?'من':'إلى'} ${d.name}`,notes:notes||`مرتبط بالدين ${d.name}`,amounts,receiptNo:isReceivable?makeReceiptNo():'',debtId:d.id,debtPaymentId:paymentId,createdAt:new Date().toISOString()};
      state.movements.push(movement);
      state.debtPayments.push({id:paymentId,debtId:d.id,movementId,amount,currency:c,date,executor,notes,createdAt:new Date().toISOString()});
      const after=rem-u;
      if(after===0n){d.status='closed';d.completedDate=date;if(d.projectId===activeProjectId&&activeView==='project-details')activeProjectTab='closed';toast(`تم ${operation} الدين بالكامل ونقله إلى «تم السداد والانتهاء».`);}else {if(d.projectId===activeProjectId&&activeView==='project-details')activeProjectTab=direction;toast(`تم تسجيل ${operation}. المتبقي ${formatMoney(after,c,true)}.`);}
      saveState();return true;
    }});
  }


  function openDebtHistoryModal(debtId) {
    const d=debtById(debtId); if(!d)return;
    const direction=d.direction||'receivable', operation=direction==='receivable'?'تحصيل':'سداد';
    const payments=state.debtPayments.filter(p=>p.debtId===d.id).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.createdAt||'').localeCompare(a.createdAt||''));
    const body=payments.length?`<div class="table-wrap"><table style="min-width:620px"><thead><tr><th>التاريخ</th><th>العملية</th><th>القيمة</th><th>المنفذ</th><th>ملاحظات</th><th>إجراء</th></tr></thead><tbody>${payments.map(p=>`<tr><td>${dateLabel(p.date)}</td><td><span class="badge ${direction==='receivable'?'badge-green':'badge-red'}">${operation}</span></td><td><strong>${formatMoney(p.amount,p.currency)}</strong></td><td>${escapeHtml(p.executor||'—')}</td><td>${escapeHtml(p.notes||'—')}</td><td><button class="btn btn-danger-soft btn-sm" data-delete-debt-payment="${p.id}">حذف العملية</button></td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">لا توجد عمليات ${operation} مسجلة على هذا الدين.</div>`;
    showModal({title:`سجل ${operation} الدين`,subtitle:`${d.name} — المتبقي ${formatMoney(debtRemainingUnits(d),d.currency,true)}`,icon:'i-debt',body,size:'lg',hideSubmit:true});
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

  async function buildReceiptJpg(movementId) {
    const m=state.movements.find(x=>x.id===movementId); if(!m)return null;
    const canvas=document.createElement('canvas'); canvas.width=1200;canvas.height=1500;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0b4d8f';ctx.fillRect(0,0,canvas.width,26);
    let logo=null; try{logo=await loadImage('shahd-logo.jpg');}catch(e){}
    if(logo){const maxW=540,maxH=270,ratio=Math.min(maxW/logo.width,maxH/logo.height);const w=logo.width*ratio,h=logo.height*ratio;ctx.drawImage(logo,(canvas.width-w)/2,60,w,h);}
    ctx.direction='rtl';ctx.textAlign='right';ctx.fillStyle='#172033';ctx.font='bold 54px Cairo, Tahoma, Arial';ctx.fillText('سند قبض',1080,365);
    ctx.fillStyle='#6b778c';ctx.font='26px Cairo, Tahoma, Arial';ctx.fillText(`${state.settings.companyName} — ${state.settings.companySubtitle}`,1080,415);
    ctx.strokeStyle='#dfe6ef';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(120,455);ctx.lineTo(1080,455);ctx.stroke();
    const tenant=tenantById(m.tenantId),building=buildingById(m.buildingId),project=projectById(m.projectId);
    const accountName=building?.name||project?.name||m.account||'مركزي';
    const rows=[['رقم السند',m.receiptNo||m.id],['التاريخ',dateLabel(m.date)],['استلمنا من',tenant?.name||m.account||building?.name||project?.name||'—'],['العقار / الحساب',accountName],['البيان',m.detail||'—'],['عن شهر',m.rentMonths?.length?m.rentMonths.map(monthLabel).join('، '):'—'],['المنفذ',m.executor||'—']];
    let y=525; ctx.font='bold 27px Cairo, Tahoma, Arial';
    rows.forEach(([label,value])=>{ctx.fillStyle='#6b778c';ctx.fillText(label,1080,y);ctx.fillStyle='#172033';ctx.font='bold 29px Cairo, Tahoma, Arial';wrapText(ctx,String(value),760,y,720,42);ctx.font='bold 27px Cairo, Tahoma, Arial';y+=88;});
    y+=10;ctx.fillStyle='#f4f7fb';roundRect(ctx,120,y,960,250,22,true,false);ctx.fillStyle='#0b4d8f';ctx.font='bold 31px Cairo, Tahoma, Arial';ctx.fillText('المبلغ المقبوض',1030,y+55);
    let my=y+108;CURRENCIES.forEach(c=>{const u=toUnits(m.amounts?.[c]?.in||0,c);if(u>0n){ctx.fillStyle='#0f9d71';ctx.font='bold 38px Cairo, Tahoma, Arial';ctx.fillText(`${CURRENCY_META[c].label}: ${formatMoney(u,c,true)}`,1030,my);my+=50;}});
    ctx.fillStyle='#6b778c';ctx.font='23px Cairo, Tahoma, Arial';ctx.fillText('تم إنشاء هذا السند إلكترونياً من نظام شركة شهد لإدارة العقارات والحسابات.',1080,1370);
    ctx.fillStyle='#0b4d8f';ctx.fillRect(120,1415,960,4);
    const blob=await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.94));
    return {blob,fileName:`receipt-${m.receiptNo||m.id}.jpg`,movement:m,tenant,building,project};
  }

  async function exportReceiptJpg(movementId) {
    const receipt=await buildReceiptJpg(movementId); if(!receipt)return;
    downloadBlob(receipt.blob,receipt.fileName);
    toast('تم تنزيل سند القبض بصيغة JPG.');
  }

  function receiptText(movementId) {
    const m=state.movements.find(x=>x.id===movementId); if(!m)return '';
    const tenant=tenantById(m.tenantId),building=buildingById(m.buildingId),project=projectById(m.projectId);
    const amounts=CURRENCIES.map(c=>{const u=toUnits(m.amounts?.[c]?.in||0,c);return u>0n?formatMoney(u,c,true):'';}).filter(Boolean).join(' + ');
    const months=m.rentMonths?.length?m.rentMonths.map(monthLabel).join('، '):'';
    return `سند قبض رقم ${m.receiptNo||m.id}
التاريخ: ${dateLabel(m.date)}
استلمنا من: ${tenant?.name||m.account||'—'}
الحساب: ${building?.name||project?.name||m.account||'مركزي'}
المبلغ: ${amounts||'—'}${months?`
عن شهر: ${months}`:''}
${state.settings.companyName}`;
  }

  function normalizeWhatsAppNumber(phone) {
    let p=String(phone||'').trim().replace(/[^0-9+]/g,'');
    if(p.startsWith('+')) return p.slice(1);
    if(p.startsWith('00')) return p.slice(2);
    const cc=String(state.settings.whatsappCountryCode||'970').replace(/\D/g,'');
    if(p.startsWith('0')) return cc+p.slice(1);
    return p;
  }

  async function sendReceiptWhatsApp(movementId) {
    const m=state.movements.find(x=>x.id===movementId); if(!m)return;
    const tenant=tenantById(m.tenantId);
    const number=normalizeWhatsAppNumber(tenant?.phone||'');
    if(!number){toast('لا يوجد رقم واتساب محفوظ للمستأجر. أضف رقم الجوال أولاً.','error');return;}
    // افتح نافذة فوراً للحفاظ على صلاحية فتح واتساب بعد تجهيز الصورة.
    const popup=window.open('about:blank','_blank');
    try{
      const receipt=await buildReceiptJpg(movementId);
      if(receipt){
        downloadBlob(receipt.blob,receipt.fileName);
      }
      const url=`https://wa.me/${number}?text=${encodeURIComponent(receiptText(movementId))}`;
      if(popup) popup.location.href=url; else window.location.href=url;
      toast('تم تجهيز صورة السند وفتح واتساب المستأجر. أرفق صورة السند التي تم تنزيلها.','info');
    }catch(e){
      if(popup) popup.close();
      toast('تعذر تجهيز سند القبض.','error');
    }
  }

  async function shareReceiptJpg(movementId) {
    const receipt=await buildReceiptJpg(movementId); if(!receipt)return;
    const file=new File([receipt.blob],receipt.fileName,{type:'image/jpeg'});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      try{
        await navigator.share({title:'سند قبض',text:receiptText(movementId),files:[file]});
        toast('تم فتح المشاركة. اختر واتساب أو التطبيق المطلوب.');
        return;
      }catch(e){if(e?.name==='AbortError')return;}
    }
    downloadBlob(receipt.blob,receipt.fileName);
    toast('المشاركة المباشرة غير مدعومة هنا؛ تم تنزيل صورة السند JPG.','info');
  }

  function openReceiptActions(movementId) {
    const m=state.movements.find(x=>x.id===movementId); if(!m)return;
    const tenant=tenantById(m.tenantId);
    const amounts=CURRENCIES.map(c=>{const u=toUnits(m.amounts?.[c]?.in||0,c);return u>0n?formatMoney(u,c,true):'';}).filter(Boolean).join(' + ');
    const {form}=showModal({
      title:'سند القبض جاهز',
      subtitle:tenant?`${tenant.name}${tenant.phone?` — ${tenant.phone}`:''}`:'يمكن تنزيل السند أو مشاركته',
      icon:'i-receipt',hideSubmit:true,
      body:`<div class="receipt-ready-card"><div><small>رقم السند</small><strong>${escapeHtml(m.receiptNo||m.id)}</strong></div><div><small>المبلغ المقبوض</small><strong class="money-in">${escapeHtml(amounts||'—')}</strong></div><div><small>التاريخ</small><strong>${dateLabel(m.date)}</strong></div></div><div class="form-note receipt-note">زر «واتساب المستأجر» يجهّز صورة JPG للسند ثم يفتح محادثة رقم المستأجر مباشرة مع نص السند. بسبب حماية واتساب والمتصفح، إرفاق الصورة نفسها داخل المحادثة يحتاج منك اختيار ملف السند بعد فتح واتساب. زر «مشاركة الصورة» يرسل ملف JPG عبر قائمة المشاركة في الهاتف.</div>`,
      extraFooter:`<button class="btn btn-primary" type="button" id="receiptDownloadBtn"><svg class="icon"><use href="#i-download"/></svg>JPG</button><button class="btn btn-primary" type="button" id="receiptShareBtn"><svg class="icon"><use href="#i-share"/></svg>مشاركة الصورة</button><button class="btn btn-whatsapp" type="button" id="receiptWhatsappBtn">واتساب المستأجر</button>`
    });
    $('#receiptDownloadBtn',form)?.addEventListener('click',()=>exportReceiptJpg(movementId));
    $('#receiptShareBtn',form)?.addEventListener('click',()=>shareReceiptJpg(movementId));
    $('#receiptWhatsappBtn',form)?.addEventListener('click',()=>sendReceiptWhatsApp(movementId));
  }

  function loadImage(src){return new Promise((res,rej)=>{const img=new Image();img.onload=()=>res(img);img.onerror=rej;img.src=src;});}
  function roundRect(ctx,x,y,w,h,r,fill,stroke){if(w<2*r)r=w/2;if(h<2*r)r=h/2;ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();}
  function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=text.split(' ');let line='';let yy=y;for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,yy);line=word;yy+=lineHeight;}else line=test;}ctx.fillText(line,x,yy);return yy;}

  function exportCsv() {
    const list=reportMovements();
    const headers=['التاريخ','النوع','البيان','المكان/المستأجر',...CURRENCIES.flatMap(c=>[`${CURRENCY_META[c].label} وارد`,`${CURRENCY_META[c].label} مصروف`]),'ملاحظات'];
    const rows=list.map(m=>{const t=tenantById(m.tenantId),b=buildingById(m.buildingId);return [m.date,m.type==='rent'?'دفعة مستأجر':'حركة عامة',m.detail||'',t?.name||b?.name||'مركزي',...CURRENCIES.flatMap(c=>[m.amounts?.[c]?.in||'0',m.amounts?.[c]?.out||'0']),m.notes||''];});
    const csv='\ufeff'+[headers,...rows].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');
    downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`shahd-report-${today()}.csv`);toast('تم تصدير التقرير بصيغة CSV.');
  }
  function downloadBlob(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1200);}
  function exportBackup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});downloadBlob(blob,`shahd-backup-${today()}.json`);toast('تم تصدير النسخة الاحتياطية.');}
  function restoreBackup(file){const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);if(!data||!Array.isArray(data.buildings)||!Array.isArray(data.tenants)){throw new Error('bad');}state={...cloneDefaults(),...data,projects:Array.isArray(data.projects)?data.projects:[],debts:Array.isArray(data.debts)?data.debts.map(d=>({...d,direction:['receivable','payable'].includes(d.direction)?d.direction:'receivable'})):[],settings:{...defaults.settings,...(data.settings||{})}};saveState();toast('تم استيراد النسخة الاحتياطية بنجاح.');}catch(e){toast('ملف النسخة الاحتياطية غير صالح.','error');}};r.readAsText(file);}

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

  function installPwa() {
    if(deferredInstallPrompt){deferredInstallPrompt.prompt();deferredInstallPrompt.userChoice.then(choice=>{if(choice.outcome==='accepted')toast('تم قبول تثبيت التطبيق.');deferredInstallPrompt=null;});return;}
    showModal({title:'تثبيت تطبيق شهد',icon:'i-download',hideSubmit:true,body:`<div class="form-note" style="font-size:13px"><strong>إذا لم يظهر زر التثبيت تلقائياً:</strong><br>• Android / Chrome: افتح قائمة المتصفح ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».<br>• iPhone / Safari: اضغط مشاركة ثم «إضافة إلى الشاشة الرئيسية».<br><br>يجب تشغيل الملفات عبر HTTPS أو localhost حتى تعمل خصائص PWA والتثبيت بشكل كامل.</div>`});
  }

  function bindEvents() {
    $('#menuBtn').addEventListener('click',openSidebar);$('#sidebarClose').addEventListener('click',closeSidebar);$('#sidebarOverlay').addEventListener('click',closeSidebar);
    $('#navList').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(b)navigate(b.dataset.view);});
    document.addEventListener('click',e=>{
      const go=e.target.closest('[data-go]');if(go)navigate(go.dataset.go);
      const op=e.target.closest('[data-open-project]');if(op)openProjectDetails(op.dataset.openProject);
      const ep=e.target.closest('[data-edit-project]');if(ep)openProjectModal(ep.dataset.editProject);
      const xp=e.target.closest('[data-delete-project]');if(xp)deleteProject(xp.dataset.deleteProject);
      const eb=e.target.closest('[data-edit-building]');if(eb)openBuildingModal(eb.dataset.editBuilding);
      const db=e.target.closest('[data-delete-building]');if(db)deleteBuilding(db.dataset.deleteBuilding);
      const et=e.target.closest('[data-edit-tenant]');if(et)openTenantModal(et.dataset.editTenant);
      const dt=e.target.closest('[data-delete-tenant]');if(dt)deleteTenant(dt.dataset.deleteTenant);
      const pt=e.target.closest('[data-pay-tenant]');if(pt)openMovementModal(null,{type:'rent',tenantId:pt.dataset.payTenant});
      const pa=e.target.closest('[data-pay-arrears]');if(pa)openMovementModal(null,{type:'rent',tenantId:pa.dataset.payArrears,rentMonth:pa.dataset.firstMonth});
      const aw=e.target.closest('[data-arrears-whatsapp]');if(aw)sendArrearsWhatsApp(aw.dataset.arrearsWhatsapp);
      const as=e.target.closest('[data-arrears-sms]');if(as)sendArrearsSms(as.dataset.arrearsSms);
      const em=e.target.closest('[data-edit-movement]');if(em){const m=state.movements.find(x=>x.id===em.dataset.editMovement);if(m?.debtPaymentId)toast('هذه الحركة مرتبطة بدين. عدّل الدين أو سجّل العملية من شاشة الديون.','info');else openMovementModal(em.dataset.editMovement);}
      const dm=e.target.closest('[data-delete-movement]');if(dm){const m=state.movements.find(x=>x.id===dm.dataset.deleteMovement);if(m?.debtPaymentId)toast('هذه الحركة مرتبطة بسداد/تحصيل دين ولا تُحذف منفردة للحفاظ على دقة الحسابات.','error');else deleteMovement(dm.dataset.deleteMovement);}
      const rc=e.target.closest('[data-receipt]');if(rc)openReceiptActions(rc.dataset.receipt);
      const ed=e.target.closest('[data-edit-debt]');if(ed)openDebtModal(ed.dataset.editDebt);
      const dd=e.target.closest('[data-delete-debt]');if(dd)deleteDebt(dd.dataset.deleteDebt);
      const dp=e.target.closest('[data-debt-payment]');if(dp)openDebtPaymentModal(dp.dataset.debtPayment);
      const dh=e.target.closest('[data-debt-history]');if(dh)openDebtHistoryModal(dh.dataset.debtHistory);
      const ddp=e.target.closest('[data-delete-debt-payment]');if(ddp)deleteDebtPayment(ddp.dataset.deleteDebtPayment);
    });
    $('#quickMovementBtn').addEventListener('click',()=>openMovementModal());$('#addMovementBtn').addEventListener('click',()=>openMovementModal());
    $('#heroTenantBtn').addEventListener('click',()=>openTenantModal());$('#heroDebtBtn').addEventListener('click',()=>openDebtModal());
    $('#addProjectBtn').addEventListener('click',()=>openProjectModal());$('#projectSearch').addEventListener('input',renderProjects);
    $('#projectEditBtn').addEventListener('click',()=>{if(activeProjectId)openProjectModal(activeProjectId);});$('#projectAddMovementBtn').addEventListener('click',()=>{if(activeProjectId)openMovementModal(null,{projectId:activeProjectId});});$('#projectAddReceivableBtn').addEventListener('click',()=>{if(activeProjectId)openDebtModal(null,{projectId:activeProjectId,direction:'receivable'});});$('#projectAddPayableBtn').addEventListener('click',()=>{if(activeProjectId)openDebtModal(null,{projectId:activeProjectId,direction:'payable'});});
    $('#projectTabs').addEventListener('click',e=>{const t=e.target.closest('[data-project-tab]');if(t){activeProjectTab=t.dataset.projectTab;renderProjectDetails();}});
    $('#addBuildingBtn').addEventListener('click',()=>openBuildingModal());$('#addTenantBtn').addEventListener('click',()=>openTenantModal());$('#addDebtBtn').addEventListener('click',()=>openDebtModal());
    $('#buildingSearch').addEventListener('input',renderBuildings);$('#tenantSearch').addEventListener('input',renderTenants);$('#tenantBuildingFilter').addEventListener('change',renderTenants);
    ['movementDateFrom','movementDateTo','movementTypeFilter','movementProjectFilter'].forEach(id=>$(`#${id}`).addEventListener('change',renderMovements));
    $('#arrearsCutoff').value=currentMonth();$('#arrearsCutoff').addEventListener('change',()=>{renderArrears();renderReports();});$('#arrearsBuildingFilter').addEventListener('change',renderArrears);$('#refreshArrearsBtn').addEventListener('click',renderArrears);
    $('#debtTabs').addEventListener('click',e=>{const t=e.target.closest('[data-debt-tab]');if(t){activeDebtTab=t.dataset.debtTab;renderDebts();}});
    $('#reportFrom').addEventListener('change',renderReports);$('#reportTo').addEventListener('change',renderReports);$('#exportCsvBtn').addEventListener('click',exportCsv);
    $('#settingsForm').addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(e.currentTarget);state.settings.companyName=String(fd.get('companyName')||'').trim()||'شركة شهد';state.settings.companySubtitle=String(fd.get('companySubtitle')||'').trim();state.settings.defaultExecutor=String(fd.get('defaultExecutor')||'').trim();state.settings.receiptPrefix=String(fd.get('receiptPrefix')||'SH').trim().toUpperCase();state.settings.whatsappCountryCode=String(fd.get('whatsappCountryCode')||'970').replace(/\D/g,'')||'970';state.settings.rentDueDay=Math.min(28,Math.max(1,Number(fd.get('rentDueDay')||1)));state.settings.theme=fd.get('theme')||'light';saveState();toast('تم حفظ الإعدادات.');});
    $('#installPwaBtn').addEventListener('click',installPwa);$('#backupBtn').addEventListener('click',exportBackup);$('#restoreInput').addEventListener('change',e=>{if(e.target.files[0])restoreBackup(e.target.files[0]);e.target.value='';});
    $('#loadDemoBtn').addEventListener('click',()=>confirmAction({title:'تحميل بيانات تجريبية',message:'سيتم استبدال البيانات الحالية ببيانات تجريبية توضح المتأخرات والديون.',confirmText:'تحميل البيانات',danger:false,onConfirm:loadDemoData}));
    $('#clearDataBtn').addEventListener('click',()=>confirmAction({title:'مسح جميع البيانات',message:'هذا الإجراء يحذف جميع المشاريع والعقارات والمستأجرين والحركات والديون من هذا المتصفح.',confirmText:'مسح نهائي',onConfirm:()=>{state=cloneDefaults();saveState();toast('تم مسح البيانات.','info');}}));
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('تم تثبيت التطبيق على الجهاز.');});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){const closeBtn=$('#modalClose');if(closeBtn)closeBtn.click();else closeSidebar();}});
  }

  function initPwa() {
    if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('SW',err)));}
  }

  applyTheme();bindEvents();renderAll();initPwa();
})();
