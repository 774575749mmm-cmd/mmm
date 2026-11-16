/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Bilingual Localization Engine (Arabic RTL / English LTR)
 */

export type AppLanguage = 'ar' | 'en';

export const V20_TAB_LABELS: Record<string, { ar: string; en: string }> = {
  'tab-pos': { ar: '1. الفواتير والمخزن', en: '1. Invoices & POS' },
  'tab-bonds': { ar: '2. السندات والمناقلات', en: '2. Vouchers & Transfers' },
  'tab-ledgers': { ar: '3. الدفاتر اليومية والمحاسبة', en: '3. Journals & Ledgers' },
  'tab-inventory': { ar: '4. الجرد والحركة والمستودعات', en: '4. Inventory & Warehouses' },
  'tab-cust': { ar: '5. العملاء والموردون والعملات', en: '5. Parties & Currencies' },
  'tab-reports': { ar: '6. التقرير الشامل والتقارير', en: '6. Executive Reports & BI' },
  'tab-unified-coa': { ar: '7. النظام الموحد والموارد البشرية', en: '7. Unified COA & HR' },
  'tab-admin': { ar: '8. التخصيص والصلاحيات والدفاتر', en: '8. Settings & RBAC' },
};

export function getTabLabel(tabId: string, customLabel: string, lang: AppLanguage): string {
  if (lang === 'en') {
    return V20_TAB_LABELS[tabId]?.en || customLabel;
  }
  return customLabel || V20_TAB_LABELS[tabId]?.ar || tabId;
}

export function syncDocumentLanguage(lang: AppLanguage): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'en' ? 'ltr' : 'rtl';
}

export const TEXT = {
  ar: {
    totalLiquidity: 'إجمالي السيولة',
    alertsAndDispatch: 'التنبيهات والمجدول',
    help: 'مساعدة',
    resetDemo: 'إعادة ضبط المصنع التجريبية',
    smartAiBtn: 'الحلول الذكية',
    globalSearchBtn: 'بحث سريع',
    globalSearchTooltip: 'بحث شامل في النظام بالرقم أو الاسم (Ctrl+K)',
    priceLookupBtn: 'سعر عميل لصنف',
    priceLookupTooltip: 'معرفة بكم بعت مادة معينة لعميل محدد سابقاً',
    langSwitchTooltip: 'التبديل إلى الإنجليزية (English LTR)',
    langBadge: 'EN',
    resetConfirmTitle: 'إعادة ضبط قاعدة البيانات التجريبية',
    resetConfirmMsg:
      'هل أنت متأكد من رغبتك في إعادة ضبط النظام إلى البيانات التجريبية الأولية؟ سيتم مسح أي فواتير أو قيود أو حركات جديدة غير محفوظة في نسخة احتياطية.',
    resetConfirmBtn: 'تأكيد إعادة الضبط',
    // ReportsWorkbench subtabs & actions
    repTabComp: '1. التقرير الشامل للإدارة (V20)',
    repTabStmt: '2. كشف حساب عميل / مورد',
    repTabDailyCust: '3. حركة العملاء اليومية والإرسال',
    repTabHub22: '4. مركز التقارير (22 تقريراً)',
    repTabDaily22: '5. التقرير اليومي (22 مؤشر)',
    repTabDocs: '6. مركز المستندات الموحد',
    repTabTasks: '7. التنبيهات والمجدول والواتساب',
    repTabSmartAi: '8. مستشار الحلول الذكية (AI)',
    detailedReport: 'تقرير تفصيلي كامل',
    summaryReport: 'ملخص مالي مقتضب',
    showAllDates: 'عرض كل التواريخ',
    allCurrencies: 'كل العملات',
    previewPdf: 'معاينة / طباعة / PDF',
    sendDirectorWa: 'إرسال للمدير واتساب (صورة/PDF)',
    languageLabel: 'لغة واجهة النظام (Language / Direction)',
    arabicOption: 'العربية — RTL (اليمين لليسار)',
    englishOption: 'English — LTR (Left-to-Right)',
  },
  en: {
    totalLiquidity: 'Total Liquidity',
    alertsAndDispatch: 'Alerts & Scheduler',
    help: 'Help',
    resetDemo: 'Reset Demo Database',
    smartAiBtn: 'Smart AI',
    globalSearchBtn: 'Quick Find',
    globalSearchTooltip: 'Global quick-jump search by number or name (Ctrl+K)',
    priceLookupBtn: 'Price Check',
    priceLookupTooltip: 'Check past sales prices of an item for any customer',
    langSwitchTooltip: 'Switch to Arabic (العربية RTL)',
    langBadge: 'عربي',
    resetConfirmTitle: 'Reset Demo Database',
    resetConfirmMsg:
      'Are you sure you want to reset the ERP database back to the initial demo state? Any unsaved invoices, vouchers, or journal entries will be cleared.',
    resetConfirmBtn: 'Confirm Reset',
    // ReportsWorkbench subtabs & actions
    repTabComp: '1. Executive Comprehensive Report',
    repTabStmt: '2. Party Account Statement',
    repTabDailyCust: '3. Daily Customer Movement & Dispatch',
    repTabHub22: '4. Financial Reports Hub (22 Reports)',
    repTabDaily22: '5. Daily Management Report (22 KPIs)',
    repTabDocs: '6. Unified Documents Archive',
    repTabTasks: '7. Alerts, Scheduler & WhatsApp',
    repTabSmartAi: '8. Smart AI Solutions Advisor',
    detailedReport: 'Full Detailed Report',
    summaryReport: 'Executive Summary',
    showAllDates: 'All Dates',
    allCurrencies: 'All Currencies',
    previewPdf: 'Preview / Print / PDF',
    sendDirectorWa: 'Send via WhatsApp (Img/PDF)',
    languageLabel: 'Interface Language & Layout Direction',
    arabicOption: 'العربية — RTL (Right-to-Left)',
    englishOption: 'English — LTR (Left-to-Right)',
  },
} as const;

export type TranslationKey = keyof typeof TEXT.ar;

export function t(key: TranslationKey, lang: AppLanguage): string {
  return TEXT[lang][key] || TEXT.ar[key];
}
