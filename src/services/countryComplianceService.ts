/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Independent Country Compliance Packs (Yemen Primary + Expandable GCC)
 */

import {
  CountryCompliancePack,
  CountryPackCode,
  Company,
  Currency,
  SystemSettings,
} from '../types/erp';

export const COUNTRY_COMPLIANCE_PACKS: Record<CountryPackCode, CountryCompliancePack> = {
  YE: {
    code: 'YE',
    nameAr: 'الجمهورية اليمنية (حزمة الامتثال الافتراضية)',
    nameEn: 'Republic of Yemen',
    baseCurrency: 'YER',
    currencyNameAr: 'ريال يمني',
    currencySymbol: 'ر.ي',
    defaultExchangeRates: [
      { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, decimalPlaces: 2 },
      { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 142, decimalPlaces: 2 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 535, decimalPlaces: 2 },
    ],
    defaultTaxRate: 0.05,
    enableTaxByDefault: true,
    taxLabelAr: 'ضريبة المبيعات العامة (5%)',
    calendarType: 'gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'invoiceNumber', 'date', 'entityName', 'currency'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [
      { code: '2130', nameAr: 'ضريبة المبيعات المستحقة (اليمن)', category: 'خصوم', nature: 'credit', parentCode: '21', level: 3, isLeaf: true },
      { code: '4180', nameAr: 'فروق إعادة تقييم العملات الأجنبية (أرباح)', category: 'إيرادات', nature: 'credit', parentCode: '41', level: 3, isLeaf: true },
      { code: '5380', nameAr: 'فروق إعادة تقييم العملات الأجنبية (خسائر)', category: 'مصروفات', nature: 'debit', parentCode: '53', level: 3, isLeaf: true },
    ],
    complianceNoticeAr:
      'تم تجهيز حزمة الامتثال اليمنية (YER / ضريبة مبيعات 5% افتراضية / تعدد عملات SAR-USD). يتطلب اعتماد اللوائح الضريبية الفعلية لكل نشاط تجاري مراجعة قانونية ومحاسبية محلية.',
  },
  SA: {
    code: 'SA',
    nameAr: 'المملكة العربية السعودية (قالب VAT 15%)',
    nameEn: 'Saudi Arabia',
    baseCurrency: 'SAR',
    currencyNameAr: 'ريال سعودي',
    currencySymbol: 'ر.س',
    defaultExchangeRates: [
      { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 1, decimalPlaces: 2 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 3.75, decimalPlaces: 2 },
      { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 0.007, decimalPlaces: 4 },
    ],
    defaultTaxRate: 0.15,
    enableTaxByDefault: true,
    taxLabelAr: 'ضريبة القيمة المضافة (15%)',
    calendarType: 'hijri_gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'companyTaxNumber', 'invoiceNumber', 'date', 'entityName', 'taxTotal'],
    requiresTaxQrMetadata: true,
    defaultCoaPreset: [
      { code: '2130', nameAr: 'ضريبة القيمة المضافة - مخرجات (15%)', category: 'خصوم', nature: 'credit', parentCode: '21', level: 3, isLeaf: true },
      { code: '1165', nameAr: 'ضريبة القيمة المضافة - مدخلات قابلة للاسترداد', category: 'أصول', nature: 'debit', parentCode: '11', level: 3, isLeaf: true },
    ],
    complianceNoticeAr:
      'حزمة جاهزة لهيكلة ضريبة القيمة المضافة (15%) والبيانات الإلزامية للفاتورة الضريبية. التكامل الرسمي مع بوابة هيئة الزكاة والضريبة والجمارك (ZATCA Phase 2 API) يتطلب ربطاً خارجياً وشهادة تشفير معتمدة ومراجعة قانونية محلية.',
  },
  AE: {
    code: 'AE',
    nameAr: 'الإمارات العربية المتحدة (VAT 5%)',
    nameEn: 'United Arab Emirates',
    baseCurrency: 'AED',
    currencyNameAr: 'درهم إماراتي',
    currencySymbol: 'د.إ',
    defaultExchangeRates: [
      { code: 'AED', nameAr: 'درهم إماراتي', symbol: 'د.إ', exchangeRate: 1, decimalPlaces: 2 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 3.6725, decimalPlaces: 2 },
      { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 0.98, decimalPlaces: 2 },
    ],
    defaultTaxRate: 0.05,
    enableTaxByDefault: true,
    taxLabelAr: 'ضريبة القيمة المضافة (5%)',
    calendarType: 'gregorian',
    dateFormat: 'DD/MM/YYYY',
    mandatoryInvoiceFields: ['companyName', 'companyTaxNumber', 'invoiceNumber', 'date', 'taxTotal'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [
      { code: '2130', nameAr: 'ضريبة القيمة المضافة المستحقة (UAE 5%)', category: 'خصوم', nature: 'credit', parentCode: '21', level: 3, isLeaf: true },
    ],
    complianceNoticeAr:
      'حزمة الإمارات (AED + ضريبة 5% قياسية). تحتاج تقارير الإقرار الضريبي FTA للربط والمراجعة القانونية من مكتب تدقيق محلي.',
  },
  KW: {
    code: 'KW',
    nameAr: 'دولة الكويت',
    nameEn: 'Kuwait',
    baseCurrency: 'KWD',
    currencyNameAr: 'دينار كويتي',
    currencySymbol: 'د.ك',
    defaultExchangeRates: [
      { code: 'KWD', nameAr: 'دينار كويتي', symbol: 'د.ك', exchangeRate: 1, decimalPlaces: 3 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 0.307, decimalPlaces: 3 },
      { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 0.082, decimalPlaces: 3 },
    ],
    defaultTaxRate: 0,
    enableTaxByDefault: false,
    taxLabelAr: 'معفى / 0%',
    calendarType: 'gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'invoiceNumber', 'date', 'entityName'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [],
    complianceNoticeAr: 'حزمة الكويت (KWD - 3 خانات عشرية). يتطلب الامتثال التجاري المحلي مراجعة المحاسب القانوني.',
  },
  QA: {
    code: 'QA',
    nameAr: 'دولة قطر',
    nameEn: 'Qatar',
    baseCurrency: 'QAR',
    currencyNameAr: 'ريال قطري',
    currencySymbol: 'ر.ق',
    defaultExchangeRates: [
      { code: 'QAR', nameAr: 'ريال قطري', symbol: 'ر.ق', exchangeRate: 1, decimalPlaces: 2 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 3.64, decimalPlaces: 2 },
    ],
    defaultTaxRate: 0,
    enableTaxByDefault: false,
    taxLabelAr: 'معفى / 0%',
    calendarType: 'gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'invoiceNumber', 'date', 'entityName'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [],
    complianceNoticeAr: 'حزمة قطر (QAR). تخضع اللوائح الضريبية الانتقائية لمراجعة قانونية محلية.',
  },
  BH: {
    code: 'BH',
    nameAr: 'مملكة البحرين (VAT 10%)',
    nameEn: 'Bahrain',
    baseCurrency: 'BHD',
    currencyNameAr: 'دينار بحريني',
    currencySymbol: 'د.ب',
    defaultExchangeRates: [
      { code: 'BHD', nameAr: 'دينار بحريني', symbol: 'د.ب', exchangeRate: 1, decimalPlaces: 3 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 0.377, decimalPlaces: 3 },
    ],
    defaultTaxRate: 0.1,
    enableTaxByDefault: true,
    taxLabelAr: 'ضريبة القيمة المضافة (10%)',
    calendarType: 'gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'companyTaxNumber', 'invoiceNumber', 'date', 'taxTotal'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [],
    complianceNoticeAr: 'حزمة البحرين (BHD - 3 خانات عشرية وضريبة 10%). يلزم التحقق القانوني قبل التقديم الرسمي للإقرارات.',
  },
  OM: {
    code: 'OM',
    nameAr: 'سلطنة عُمان (VAT 5%)',
    nameEn: 'Oman',
    baseCurrency: 'OMR',
    currencyNameAr: 'ريال عماني',
    currencySymbol: 'ر.ع',
    defaultExchangeRates: [
      { code: 'OMR', nameAr: 'ريال عماني', symbol: 'ر.ع', exchangeRate: 1, decimalPlaces: 3 },
      { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 0.385, decimalPlaces: 3 },
    ],
    defaultTaxRate: 0.05,
    enableTaxByDefault: true,
    taxLabelAr: 'ضريبة القيمة المضافة (5%)',
    calendarType: 'gregorian',
    dateFormat: 'YYYY-MM-DD',
    mandatoryInvoiceFields: ['companyName', 'companyTaxNumber', 'invoiceNumber', 'date', 'taxTotal'],
    requiresTaxQrMetadata: false,
    defaultCoaPreset: [],
    complianceNoticeAr: 'حزمة سلطنة عمان (OMR - 3 خانات عشرية وضريبة 5%). تخضع المتطلبات الرسمية لمراجعة قانونية محلية.',
  },
};

export function getCountryPack(code?: CountryPackCode): CountryCompliancePack {
  return COUNTRY_COMPLIANCE_PACKS[code || 'YE'] || COUNTRY_COMPLIANCE_PACKS.YE;
}

export function applyCountryPackToCompanyAndSettings(
  packCode: CountryPackCode,
  company: Company,
  settings: SystemSettings,
  existingCurrencies: Currency[]
): { company: Company; settings: SystemSettings; currencies: Currency[] } {
  const pack = getCountryPack(packCode);

  const mergedCurrencies: Currency[] = pack.defaultExchangeRates.map((def) => ({
    code: def.code,
    nameAr: def.nameAr,
    symbol: def.symbol,
    exchangeRate: def.exchangeRate,
    isBase: def.code === pack.baseCurrency,
    decimalPlaces: def.decimalPlaces,
  }));

  // Preserve any custom non-conflicting currencies
  for (const cur of existingCurrencies) {
    if (!mergedCurrencies.some((c) => c.code === cur.code)) {
      mergedCurrencies.push({ ...cur, isBase: false });
    }
  }

  return {
    company: {
      ...company,
      countryCode: pack.code,
      baseCurrency: pack.baseCurrency,
    },
    settings: {
      ...settings,
      defaultTaxRate: pack.defaultTaxRate,
      enableTax: pack.enableTaxByDefault,
    },
    currencies: mergedCurrencies,
  };
}
