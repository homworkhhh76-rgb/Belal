import {t} from './services__i18n.js?v=7.9.4.136-localization';
import React, { useState } from 'react';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Pagination, usePagination } from './components__common__Pagination.js?v=7.9.4.136-localization';
import { GENERAL_PAGE_PERMISSIONS, RESTAURANT_PAGE_PERMISSIONS, normalizeEmployeePermissions } from './utils__permissions.js?v=7.9.4.136-localization';
import { isTrialAccount } from './trial__config.js?v=7.9.4.136-localization';
import {
  Users, UserPlus, ShieldCheck, Trash2, Edit2, UserCheck, Download,
  UtensilsCrossed, ChefHat, LayoutGrid, Scale, X
} from 'lucide-react';

const h = React.createElement;

const defaultPermissions = {
  // صلاحيات العمليات داخل الصفحات
  canDiscount: true,
  canEditPrice: false,
  canDeleteInvoice: false,
  canDeleteProducts: false,
  canManagePurchases: false,
  canManageVouchers: false,
  canManageInventory: false,
  canViewReports: false,

  // صلاحيات دخول الصفحات — مغلقة افتراضياً حتى يتم اختيارها صراحة.
  ...Object.fromEntries(GENERAL_PAGE_PERMISSIONS.map(([key]) => [key, false])),
  ...Object.fromEntries(RESTAURANT_PAGE_PERMISSIONS.map(([key]) => [key, false])),
};

const allPermissions = Object.fromEntries(Object.keys(defaultPermissions).map(k => [k, true]));
const restaurantPermissionLabels = Object.fromEntries(RESTAURANT_PAGE_PERMISSIONS.map(([key,,label]) => [key,label]));

const presetForRole = role => {
  if (role === 'admin') return { roleName: 'مدير عام', permissions: { ...allPermissions } };
  if (role === 'waiter') return {
    roleName: 'جرسون',
    permissions: { ...defaultPermissions, canDiscount:false, canAccessRestaurantTables:true, canAccessRestaurantWaiter:true }
  };
  if (role === 'kitchen') return {
    roleName: 'موظف مطبخ',
    permissions: { ...defaultPermissions, canDiscount:false, canAccessRestaurantKitchen:true }
  };
  if (role === 'accountant') return {
    roleName: 'محاسب',
    permissions: {
      ...defaultPermissions,
      canManagePurchases:true, canManageVouchers:true, canViewReports:true,
      canAccessDashboard:true, canAccessSales:true, canAccessPurchases:true, canAccessVouchers:true,
      canAccessCustomers:true, canAccessSuppliers:true, canAccessAccounts:true, canAccessExpenses:true, canAccessReports:true
    }
  };
  if (role === 'inventory_mgr') return {
    roleName: 'مسؤول مخزون',
    permissions: {
      ...defaultPermissions, canDiscount:false, canManagePurchases:true, canManageInventory:true,
      canAccessProducts:true, canAccessCategories:true, canAccessInventory:true, canAccessPurchases:true, canAccessBarcodes:true
    }
  };
  if (role === 'cashier') return {
    roleName: 'كاشير',
    permissions: { ...defaultPermissions, canAccessCashier:true, canAccessSales:true, canAccessCustomers:true }
  };
  if (role === 'custom') return { roleName:'مخصص', permissions:{ ...defaultPermissions, canDiscount:false } };
  return null;
};

export const EmployeesView = () => {
  const { employees, activeEmployee, setActiveEmployee, saveEmployee, deleteEmployee, showToast } = useApp();
  const employeeCreationLocked = isTrialAccount();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('cashier');
  const [roleName, setRoleName] = useState('كاشير');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [permissions, setPermissions] = useState(() => ({ ...presetForRole('cashier').permissions }));

  const openAdd = () => {
    setEditingEmployee(null);
    setName(''); setPhone(''); setRole('cashier'); setRoleName('كاشير'); setPin(''); setActive(true);
    setPermissions({ ...presetForRole('cashier').permissions });
    setIsModalOpen(true);
  };
  const openEdit = emp => {
    setEditingEmployee(emp);
    setName(emp.name || ''); setPhone(emp.phone || ''); setRole(emp.role || 'custom'); setRoleName(emp.roleName || 'موظف'); setPin(emp.pin || ''); setActive(emp.active !== false);
    setPermissions({ ...defaultPermissions, ...normalizeEmployeePermissions(emp.permissions || {}, emp.role || 'custom') });
    setIsModalOpen(true);
  };
  const changeRole = selectedRole => {
    setRole(selectedRole);
    const preset = presetForRole(selectedRole);
    if (preset) {
      setRoleName(preset.roleName);
      setPermissions(preset.permissions);
    } else if (selectedRole === 'custom') {
      setRoleName('مخصص');
    }
  };
  const submit = async e => {
    e.preventDefault();
    if (!name.trim()) return showToast('يرجى كتابة اسم الموظف', 'error');
    await saveEmployee({
      id: editingEmployee?.id || `emp-${Date.now()}`,
      name: name.trim(),
      phone: phone.trim() || undefined,
      role,
      roleName: roleName.trim() || 'موظف',
      pin: pin.trim() || undefined,
      permissions: normalizeEmployeePermissions({ ...defaultPermissions, ...permissions }, role),
      active,
      authVersion: editingEmployee?.authVersion,
      createdAt: editingEmployee?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsModalOpen(false);
  };
  const switchEmployee = emp => {
    setActiveEmployee(emp);
    showToast(`تم تسجيل الدخول بحساب: ${emp.name} (${emp.roleName})`, 'success');
  };
  const removeEmployee = async emp => {
    if (!window.confirm(`حذف الموظف ${emp.name}؟`)) return;
    await deleteEmployee(emp.id);
  };
  const downloadLoginFile = async emp => {
    try {
      if (!emp.active) throw new Error('فعّل حساب الموظف أولاً.');
      let current = emp;
      if (!current.authVersion) {
        current = { ...current, authVersion: `AUTH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: new Date().toISOString() };
        await saveEmployee(current);
      }
      window.OscarCloudSync?.requestSync?.(10);
      const syncResult = await window.OscarCloudSync?.syncNow?.({ force: true });
      if (syncResult?.error || window.OscarCloudSync?.pendingCount?.()) throw new Error('لم تكتمل مزامنة الموظف بعد. أعد المحاولة بعد الاتصال.');
      await window.OscarActivation?.prepareVerifiedRoleFile?.('employee', current, `${current.name}-دخول.mzauth`);
      showToast(`تم تنزيل ملف دخول مستقل للموظف ${current.name}`, 'success');
    } catch (err) {
      showToast(String(err?.message || err), 'error');
    }
  };

  const togglePermission = key => setPermissions(p => ({ ...p, [key]: !p[key] }));
  const permissionRow = (key, label, tone = 'emerald', icon = null) => h('label', {
    key,
    className: 'flex items-center gap-2 p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer'
  },
    h('input', { type: 'checkbox', checked: !!permissions[key], onChange: () => togglePermission(key), className: 'rounded accent-violet-600' }),
    icon ? h(icon, { className: `w-4 h-4 text-${tone}-600 shrink-0` }) : null,
    h('span', { className: 'text-slate-700 font-bold text-[11px]' }, label)
  );

  const actionPermissions = [
    ['canDiscount', 'منح خصم في السلة'],
    ['canEditPrice', 'تعديل سعر البيع'],
    ['canDeleteInvoice', 'حذف وإلغاء الفواتير'],
    ['canDeleteProducts', 'حذف الأصناف'],
    ['canManageVouchers', 'تنفيذ سندات القبض والصرف'],
    ['canManagePurchases', 'تنفيذ عمليات المشتريات'],
    ['canManageInventory', 'تنفيذ الجرد وتحويلات المخزون'],
    ['canViewReports', 'عرض بيانات التقارير داخل الصفحات المسموحة'],
  ];
  const pagePermissions = GENERAL_PAGE_PERMISSIONS;
  const employeesPager = usePagination(employees || [], 50, 'employees');

  return h('div', { id: 'employees-view-container', className: 'p-3 sm:p-5 space-y-4 max-w-7xl mx-auto select-none min-h-[calc(100vh-4rem)] text-right', dir: 'rtl' },
    h('div', { className: 'flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm' },
      h('div', null,
        h('div', { className: 'flex items-center gap-2' },
          h('div', { className: 'p-2 rounded-xl bg-violet-50 text-violet-600' }, h(Users, { className: 'w-5 h-5' })),
          h('h1', { className: 'text-lg font-black text-slate-900' }, 'إدارة الموظفين والصلاحيات')
        ),
        h('p', { className: 'text-xs text-slate-500 mt-1' }, 'حدد الصفحات التي يستطيع الموظف دخولها وصلاحيات العمليات داخل كل صفحة.')
      ),
      !employeeCreationLocked && h('button', { onClick: openAdd, className: 'flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black shadow-sm' }, h(UserPlus, { className: 'w-4 h-4' }), t("إضافة موظف جديد"))
    ),

    activeEmployee && h('div', { className: 'p-3.5 rounded-2xl bg-violet-50 border border-violet-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3' },
      h('div', { className: 'flex items-center gap-3' },
        h('div', { className: 'w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center' }, h(UserCheck, { className: 'w-5 h-5' })),
        h('div', null, h('div', { className: 'text-[10px] text-violet-700 font-black' }, t("المستخدم النشط")), h('div', { className: 'font-black text-slate-900 text-sm' }, activeEmployee.name), h('div', { className: 'text-[10px] text-slate-500' }, activeEmployee.roleName))
      )
    ),

    h('div', { className: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3' },
      employeesPager.pageItems.map(emp => {
        const perms = { ...defaultPermissions, ...(emp.permissions || {}) };
        const allowedPages = [
          ...GENERAL_PAGE_PERMISSIONS.filter(([key]) => perms[key]).map(([, , label]) => label),
          ...RESTAURANT_PAGE_PERMISSIONS.filter(([key]) => perms[key]).map(([, , label]) => label),
        ];
        const isCurrent = activeEmployee?.id === emp.id;
        return h('div', { key: emp.id, className: `rounded-2xl border bg-white p-4 shadow-sm ${isCurrent ? 'border-violet-400 ring-1 ring-violet-100' : 'border-slate-200'}` },
          h('div', { className: 'flex items-start justify-between gap-3' },
            h('div', { className: 'min-w-0' },
              h('div', { className: 'font-black text-sm text-slate-900 truncate' }, emp.name),
              h('div', { className: 'text-[10px] text-slate-500 mt-0.5' }, `${emp.roleName || t("موظف")}${emp.phone ? ' • ' + emp.phone : ''}`)
            ),
            h('span', { className: `shrink-0 px-2 py-1 rounded-lg text-[10px] font-black ${emp.active === false ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700'}` }, emp.active === false ? t("موقوف") : t("نشط"))
          ),
          h('div', { className: 'mt-3 min-h-10 flex flex-wrap gap-1' },
            allowedPages.length
              ? allowedPages.slice(0, 6).map(label => h('span', { key: label, className: 'px-2 py-1 rounded-lg bg-violet-50 border border-violet-100 text-violet-800 text-[9px] font-black' }, label))
              : h('span', { className: 'text-[10px] text-slate-400' }, 'لا توجد صفحات مسموحة'),
            allowedPages.length > 6 ? h('span', { className: 'px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[9px] font-black' }, `+${allowedPages.length - 6}`) : null
          ),
          h('div', { className: 'mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5' },
            h('button', { onClick: () => switchEmployee(emp), className: `px-2.5 py-1.5 rounded-lg text-[10px] font-black ${isCurrent ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'}` }, isCurrent ? t("الحساب الحالي") : 'تبديل للحساب'),
            h('button', { onClick: () => openEdit(emp), className: 'p-1.5 rounded-lg border border-slate-200 text-slate-600', title: t("تعديل") }, h(Edit2, { className: 'w-4 h-4' })),
            h('button', { onClick: () => downloadLoginFile(emp), className: 'p-1.5 rounded-lg border border-blue-200 text-blue-600', title: 'تنزيل ملف الدخول' }, h(Download, { className: 'w-4 h-4' })),
            h('button', { onClick: () => removeEmployee(emp), className: 'p-1.5 rounded-lg border border-rose-200 text-rose-600', title: t("حذف") }, h(Trash2, { className: 'w-4 h-4' }))
          )
        );
      })
    ),
    h(Pagination, { pager: employeesPager }),

    isModalOpen && h('div', { className: 'oscar-employee-modal-overlay fixed z-[120] bg-black/55 flex justify-center' },
      h('div', { className: 'oscar-employee-modal-panel w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col' },
        h('div', { className: 'p-4 border-b border-slate-100 flex items-center justify-between shrink-0' },
          h('div', { className: 'flex items-center gap-2' }, h(ShieldCheck, { className: 'w-5 h-5 text-violet-600' }), h('div', null, h('div', { className: 'font-black text-slate-900 text-sm' }, editingEmployee ? 'تعديل الموظف والصلاحيات' : t("إضافة موظف جديد")), h('div', { className: 'text-[10px] text-slate-500' }, 'حدد صلاحية كل صفحة من صفحات المطعم بشكل مستقل'))),
          h('button', { type: 'button', onClick: () => setIsModalOpen(false), className: 'w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500' }, h(X, { className: 'w-4 h-4' }))
        ),
        h('form', { onSubmit: submit, className: 'flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4' },
          h('div', { className: 'oscar-mobile-form-grid grid grid-cols-2 gap-2.5 sm:gap-3' },
            h('div', null, h('label', { className: 'block text-[11px] font-black text-slate-700 mb-1' }, 'اسم الموظف *'), h('input', { required: true, value: name, onChange: e => setName(e.target.value), className: 'w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-violet-500' })),
            h('div', null, h('label', { className: 'block text-[11px] font-black text-slate-700 mb-1' }, t("رقم الهاتف")), h('input', { value: phone, onChange: e => setPhone(e.target.value), className: 'w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-violet-500' })),
            h('div', null, h('label', { className: 'block text-[11px] font-black text-slate-700 mb-1' }, 'الدور / القالب الجاهز'), h('select', { value: role, onChange: e => changeRole(e.target.value), className: 'w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold outline-none' },
              h('option', { value: 'cashier' }, 'كاشير'),
              h('option', { value: 'waiter' }, 'جرسون'),
              h('option', { value: 'kitchen' }, 'موظف مطبخ'),
              h('option', { value: 'admin' }, 'مدير عام — كل الصلاحيات'),
              h('option', { value: 'accountant' }, t("محاسب")),
              h('option', { value: 'inventory_mgr' }, t("مسؤول مخزون")),
              h('option', { value: 'custom' }, t("مخصص"))
            )),
            h('div', null, h('label', { className: 'block text-[11px] font-black text-slate-700 mb-1' }, 'PIN'), h('input', { type: 'password', maxLength: 6, value: pin, onChange: e => setPin(e.target.value), className: 'w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-center outline-none' })),
            h('div', { className: 'min-w-0' }, h('label', { className: 'block text-[11px] font-black text-slate-700 mb-1' }, t("المسمى الوظيفي")), h('input', { value: roleName, onChange: e => setRoleName(e.target.value), className: 'w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none' }))
          ),

          h('section', { className: 'p-3 rounded-2xl border border-violet-200 bg-violet-50/40' },
            h('div', { className: 'font-black text-xs text-violet-900' }, 'صلاحيات دخول الصفحات'),
            h('div', { className: 'text-[10px] text-violet-700 mt-0.5 mb-2' }, 'أي صفحة غير محددة لن تظهر للموظف ولن يستطيع فتحها حتى لو حاول الوصول إليها مباشرة.'),
            h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }, pagePermissions.map(([key,,label]) => permissionRow(key, label)))
          ),

          h('section', { className: 'p-3 rounded-2xl border border-slate-200 bg-slate-50' },
            h('div', { className: 'font-black text-xs text-slate-900 mb-2' }, 'صلاحيات العمليات داخل الصفحات'),
            h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }, actionPermissions.map(([key, label]) => permissionRow(key, label)))
          ),

          h('section', { className: 'p-3 rounded-2xl border border-amber-200 bg-amber-50/50' },
            h('div', { className: 'font-black text-xs text-amber-900' }, 'صلاحيات المطعم والكافيه — كل صفحة مستقلة'),
            h('div', { className: 'text-[10px] text-amber-700 mt-0.5 mb-2' }, 'الصفحة التي لا تفعّلها لن تظهر للموظف ولن يستطيع فتحها.'),
            h('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-2' },
              permissionRow('canAccessRestaurantTables', 'الطاولات والصالات', 'amber', LayoutGrid),
              permissionRow('canAccessRestaurantWaiter', 'واجهة الجرسون', 'amber', UtensilsCrossed),
              permissionRow('canAccessRestaurantKitchen', 'شاشة المطبخ KDS', 'amber', ChefHat),
              permissionRow('canAccessRestaurantWaste', 'الوصفات والهالك', 'amber', Scale)
            )
          ),

          h('label', { className: 'flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer' },
            h('input', { type: 'checkbox', checked: active, onChange: e => setActive(e.target.checked), className: 'accent-violet-600' }),
            h('span', { className: 'text-xs font-black text-slate-700' }, 'حساب الموظف نشط ويمكنه تسجيل الدخول')
          ),

          h('div', { className: 'sticky bottom-0 -mx-4 -mb-4 px-4 py-3 bg-white border-t border-slate-100 flex items-center justify-end gap-2' },
            h('button', { type: 'button', onClick: () => setIsModalOpen(false), className: 'px-4 py-2 rounded-xl border border-slate-200 text-xs font-black text-slate-600' }, t("إلغاء")),
            h('button', { type: 'submit', className: 'px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black shadow-sm' }, 'حفظ الموظف والصلاحيات')
          )
        )
      )
    )
  );
};
