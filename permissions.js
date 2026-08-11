(() => {
  'use strict';
  const groups = [
    { id:'dashboard', label:'الرئيسية', permissions:[
      ['dashboard.view','عرض لوحة التحكم']
    ]},
    { id:'projects', label:'المشاريع', permissions:[
      ['projects.view','عرض المشاريع'],['projects.create','إضافة مشروع'],['projects.edit','تعديل مشروع'],['projects.delete','حذف مشروع']
    ]},
    { id:'buildings', label:'العقارات', permissions:[
      ['buildings.view','عرض العقارات'],['buildings.create','إضافة عمارة'],['buildings.edit','تعديل عمارة'],['buildings.delete','حذف عمارة']
    ]},
    { id:'tenants', label:'المستأجرون', permissions:[
      ['tenants.view','عرض المستأجرين'],['tenants.create','إضافة مستأجر'],['tenants.edit','تعديل مستأجر'],['tenants.delete','حذف مستأجر']
    ]},
    { id:'movements', label:'الحركة اليومية', permissions:[
      ['movements.view','عرض الحركات'],['movements.create','إضافة حركة / دفعة'],['movements.edit','تعديل حركة'],['movements.delete','حذف حركة'],['movements.receipt','إنشاء ومشاركة سند قبض']
    ]},
    { id:'arrears', label:'المتأخرات', permissions:[
      ['arrears.view','عرض المتأخرات'],['arrears.collect','تسجيل دفعة من المتأخرات'],['arrears.contact','إرسال واتساب / SMS للمستأجر']
    ]},
    { id:'debts', label:'الديون', permissions:[
      ['debts.view','عرض الديون'],['debts.create','إضافة دين'],['debts.edit','تعديل دين'],['debts.delete','حذف دين'],['debts.pay','تسجيل تحصيل / سداد']
    ]},
    { id:'reports', label:'التقارير', permissions:[
      ['reports.view','عرض التقارير'],['reports.export','تصدير التقارير']
    ]},
    { id:'users', label:'المستخدمون والصلاحيات', permissions:[
      ['users.view','عرض المستخدمين'],['users.create','إضافة مستخدم'],['users.edit','تعديل مستخدم وصلاحياته'],['users.disable','إيقاف / تفعيل مستخدم']
    ]},
    { id:'settings', label:'الإعدادات', permissions:[
      ['settings.view','عرض الإعدادات'],['settings.edit','تعديل إعدادات الشركة'],['settings.backup','نسخ احتياطي واستعادة']
    ]},
    { id:'sync', label:'المزامنة', permissions:[
      ['sync.view','عرض حالة وطابور المزامنة'],['sync.manual','تشغيل المزامنة يدوياً']
    ]}
  ];
  const all = groups.flatMap(g => g.permissions.map(([key]) => key));
  const managerPermissions = Object.fromEntries(all.map(k => [k,true]));
  const viewForRoute = {
    dashboard:'dashboard.view',projects:'projects.view','project-details':'projects.view',buildings:'buildings.view',tenants:'tenants.view',movements:'movements.view',arrears:'arrears.view',debts:'debts.view',reports:'reports.view',users:'users.view',settings:'settings.view'
  };
  const entityPermissions = {
    projects:{create:'projects.create',edit:'projects.edit',delete:'projects.delete'},
    buildings:{create:'buildings.create',edit:'buildings.edit',delete:'buildings.delete'},
    tenants:{create:'tenants.create',edit:'tenants.edit',delete:'tenants.delete'},
    movements:{create:'movements.create',edit:'movements.edit',delete:'movements.delete'},
    debts:{create:'debts.create',edit:'debts.edit',delete:'debts.delete'},
    debtPayments:{create:'debts.pay',edit:'debts.pay',delete:'debts.pay'},
    settings:{create:'settings.edit',edit:'settings.edit',delete:'settings.edit'}
  };
  window.SHAHD_PERMISSIONS = Object.freeze({ groups, all, managerPermissions, viewForRoute, entityPermissions });
})();
