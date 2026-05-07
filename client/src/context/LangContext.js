import React, { createContext, useContext, useState, useEffect } from 'react';

const LANG_KEY = 'doctracking_lang';

const T = {
  en: {
    appName:    'Document Tracking System',
    orgName:    'General Administration of Sunni Endowments',
    signIn:     'Sign In',
    signOut:    'Sign Out',
    signingIn:  'Signing in…',
    username:   'Username',
    password:   'Password',
    usernamePH: 'Username or user@domain.com',
    welcome:    'Welcome',
    dept:       'Department',
    adminPanel: 'Admin Panel',
    loading:    'Loading…',
    na:         'N/A',
    departments:'Departments',
    newRecord:  'New Record',
    submit:     'Submit',
    reset:      'Reset',
    required:   'Required',
    save:       'Save',
    cancel:     'Cancel',
    edit:       'Edit',
    del:        'Delete',
    add:        'Add',
    confirmDel: 'Are you sure? This cannot be undone.',
    selectDept: 'Select a department from the sidebar to begin.',
    submitted:  'Record submitted successfully.',
    deptFields: 'Departments & Fields',
    roleMaps:   'Role Mappings',
    config:     'Config',
    addDept:    '+ Add Department',
    deptLabel:  'Department label',
    adGroup:    'AD Group CN',
    fields:     'fields',
    addField:   '+ Add Field',
    fieldKey:   'Field key',
    fieldLabel: 'Display label',
    fieldType:  'Type',
    fieldReq:   'Required',
    optionsPH:  'Option1, Option2, Option3',
    actions:    'Actions',
    optPH:      'Options / Placeholder',
    exportJSON: '⬇ Export JSON',
    previewCfg: 'Preview config',
    importCfg:  '⬆ Import & Apply',
    importPH:   '{"departments": [...], "roleGroupMap": {...}}',
    importNote: 'Paste JSON to import (replaces everything):',
    cfgNote:    'All settings are stored in server/config/departments.json.',
    ldapNote:   'AD group name (CN, lowercase) mapped to a role. Changes apply on next login.',
    roleMap:    'LDAP Group → Role Mappings',
    newGroup:   'new_group_cn',
    roles: {
      SUPER_ADMIN: 'Super Admin',
      ADMIN:       'Admin',
      MANAGER:     'Manager',
      STAFF:       'Staff',
      READONLY:    'Read Only',
    },
    groupLabels: {
      customer_service:       'Customer Service',
      accounts_dept:          'Accounts',
      banks_dept:             'Banks & Social',
      asset_development_dept: 'Asset Development',
    },
  },
  ar: {
    appName:    'نظام تتبع الوثائق',
    orgName:    'الإدارة العامة للأوقاف السنية',
    signIn:     'تسجيل الدخول',
    signOut:    'خروج',
    signingIn:  'جاري الدخول…',
    username:   'اسم المستخدم',
    password:   'كلمة المرور',
    usernamePH: 'اسم المستخدم أو البريد الإلكتروني',
    welcome:    'مرحباً',
    dept:       'القسم',
    adminPanel: 'لوحة الإدارة',
    loading:    'جاري التحميل…',
    na:         'غير محدد',
    departments:'الأقسام',
    newRecord:  'سجل جديد',
    submit:     'إرسال',
    reset:      'إعادة تعيين',
    required:   'مطلوب',
    save:       'حفظ',
    cancel:     'إلغاء',
    edit:       'تعديل',
    del:        'حذف',
    add:        'إضافة',
    confirmDel: 'هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.',
    selectDept: 'اختر قسماً من القائمة الجانبية للبدء.',
    submitted:  'تم إرسال السجل بنجاح.',
    deptFields: 'الأقسام والحقول',
    roleMaps:   'تعيين الصلاحيات',
    config:     'الإعدادات',
    addDept:    '+ إضافة قسم',
    deptLabel:  'اسم القسم',
    adGroup:    'مجموعة AD',
    fields:     'حقل',
    addField:   '+ إضافة حقل',
    fieldKey:   'مفتاح الحقل',
    fieldLabel: 'التسمية',
    fieldType:  'النوع',
    fieldReq:   'مطلوب',
    optionsPH:  'خيار1، خيار2، خيار3',
    actions:    'الإجراءات',
    optPH:      'الخيارات / النص التوضيحي',
    exportJSON: '⬇ تصدير JSON',
    previewCfg: 'معاينة الإعدادات',
    importCfg:  '⬆ استيراد وتطبيق',
    importPH:   '{"departments": [...], "roleGroupMap": {...}}',
    importNote: 'الصق JSON للاستيراد (يستبدل كل شيء):',
    cfgNote:    'جميع الإعدادات محفوظة في server/config/departments.json.',
    ldapNote:   'اسم مجموعة AD (CN، أحرف صغيرة) مرتبط بدور. التغييرات تُطبَّق عند تسجيل الدخول التالي.',
    roleMap:    'مجموعات LDAP ← الأدوار',
    newGroup:   'اسم_المجموعة',
    roles: {
      SUPER_ADMIN: 'مدير النظام',
      ADMIN:       'مشرف',
      MANAGER:     'مدير',
      STAFF:       'موظف',
      READONLY:    'قراءة فقط',
    },
    groupLabels: {
      customer_service:       'خدمة العملاء',
      accounts_dept:          'قسم الحسابات',
      banks_dept:             'قسم المصارف',
      asset_development_dept: 'تنمية الأصول الوقفية',
    },
  },
};

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem(LANG_KEY) || 'ar');

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const toggle = () => setLang(l => (l === 'ar' ? 'en' : 'ar'));
  const isRTL  = lang === 'ar';
  const t      = T[lang];

  return (
    <LangContext.Provider value={{ lang, t, toggle, isRTL }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be inside <LangProvider>');
  return ctx;
}
