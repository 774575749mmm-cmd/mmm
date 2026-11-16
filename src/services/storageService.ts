/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Storage, Migration, Validation & Numbering Service
 */

import {
  Company,
  Branch,
  Warehouse,
  Currency,
  RegionalArea,
  Customer,
  Vendor,
  UnitOfMeasure,
  InventoryItem,
  ItemWarehouseStock,
  StockMovement,
  InventoryTransfer,
  PhysicalStocktaking,
  WarehouseDocument,
  DispatchLogEntry,
  Account,
  CostCenter,
  JournalEntry,
  Invoice,
  TreasuryAccount,
  PaymentVoucher,
  TreasuryTransfer,
  ExpenseCategory,
  ExpenseRecord,
  Employee,
  PayrollRun,
  FixedAsset,
  User,
  AuditLogEntry,
  TaskAlert,
  SystemSettings,
  CustomLedgerBook,
  CustomLedgerEntry,
  DocumentBook,
  DepartmentItem,
  TabVisibilityConfig,
  PrintDocumentType,
  PrintTemplateConfig,
  FiscalPeriod,
  StockCostLayer,
  InventoryBatch,
  StorageLocation,
  CommercialOrder,
  BankReconciliationSession,
  PosShift,
  HeldPosCart,
  ApprovalWorkflowRule,
  ApprovalRequest,
  OperationalControlConfig,
  SavedReportDesign,
  SavedTableView,
  FxRevaluationRecord,
  BackupSnapshotMeta,
  BackupScheduleConfig,
  DataImportLog,
} from '../types/erp';

import {
  initialCompany,
  initialCurrencies,
  initialBranches,
  initialWarehouses,
  initialRegionalAreas,
  initialCustomers,
  initialVendors,
  initialInventoryItems,
  initialWarehouseStock,
  initialChartOfAccounts,
  initialCostCenters,
  initialTreasuryAccounts,
  initialJournalEntries,
  initialInvoices,
  initialPaymentVouchers,
  initialStockMovements,
  initialExpenseCategories,
  initialExpenseRecords,
  initialEmployees,
  initialPayrollRuns,
  initialFixedAssets,
  initialUsers,
  initialTaskAlerts,
  initialSystemSettings,
} from '../data/initialData';
import { reconcileSaudiCurrenciesInDb } from './currencyHelpers';

export const CURRENT_SCHEMA_VERSION = '3.0.0';

export function getDefaultOperationalControl(): OperationalControlConfig {
  return {
    enabledModules: {
      sales: true,
      purchases: true,
      vouchers: true,
      accounting: true,
      inventory: true,
      parties: true,
      reports: true,
      hrPayroll: true,
      fixedAssets: true,
      pos: true,
      distribution: true,
      aiAdvisor: true,
    },
    enforceCreditLimitBlock: false,
    enforceClosedFiscalPeriodBlock: true,
    enableApprovalWorkflows: false,
    enableFxRevaluation: true,
    productionSecurityMode: false,
    disabledReportIds: [],
    disabledPaymentMethods: [],
    disabledCurrencies: [],
    screenFieldRules: {
      sales_invoice: [
        { fieldKey: 'taxNumber', labelAr: 'الرقم الضريبي للعميل', visible: true, required: false },
        { fieldKey: 'salesRep', labelAr: 'مندوب المبيعات', visible: true, required: false },
        { fieldKey: 'dueDate', labelAr: 'تاريخ الاستحقاق', visible: true, required: false },
        { fieldKey: 'notes', labelAr: 'الملاحظات والشروط', visible: true, required: false },
      ],
      purchase_invoice: [
        { fieldKey: 'dueDate', labelAr: 'تاريخ الاستحقاق', visible: true, required: false },
        { fieldKey: 'notes', labelAr: 'الملاحظات والشروط', visible: true, required: false },
      ],
      voucher: [
        { fieldKey: 'costCenterId', labelAr: 'مركز التكلفة', visible: true, required: false },
        { fieldKey: 'checkNumber', labelAr: 'رقم الشيك / الحوالة', visible: true, required: false },
      ],
    },
    customDocumentStatuses: [
      { id: 'draft', labelAr: 'مسودة', colorHex: '#94a3b8', isActive: true },
      { id: 'posted', labelAr: 'مرحل', colorHex: '#10b981', isActive: true, isDefault: true },
      { id: 'partial', labelAr: 'مدفوع جزئياً', colorHex: '#f59e0b', isActive: true },
      { id: 'paid', labelAr: 'مدفوع بالكامل', colorHex: '#3b82f6', isActive: true },
      { id: 'cancelled', labelAr: 'ملغي', colorHex: '#ef4444', isActive: true },
    ],
    shortcuts: [
      { id: 'sc-1', keys: 'Alt+1', actionLabelAr: 'لوحة القيادة التنفيذية', targetTabId: 'dashboard', enabled: true },
      { id: 'sc-2', keys: 'Alt+2', actionLabelAr: 'فواتير المبيعات والمشتريات', targetTabId: 'sales', enabled: true },
      { id: 'sc-3', keys: 'Alt+3', actionLabelAr: 'السندات والخزينة', targetTabId: 'vouchers', enabled: true },
      { id: 'sc-4', keys: 'Alt+4', actionLabelAr: 'القيود والشجرة المحاسبية', targetTabId: 'accounting', enabled: true },
      { id: 'sc-5', keys: 'Alt+5', actionLabelAr: 'الأصناف والمستودعات', targetTabId: 'inventory', enabled: true },
      { id: 'sc-6', keys: 'Alt+7', actionLabelAr: 'التقارير ومصمم التقارير المرئي', targetTabId: 'reports', enabled: true },
    ],
    subTabOrder: {},
    hiddenSubTabs: [],
  };
}

export const defaultApprovalRules: ApprovalWorkflowRule[] = [
  {
    id: 'apr-rule-inv',
    companyId: 'comp-01',
    actionType: 'invoice_post',
    nameAr: 'اعتماد الفواتير ذات المبالغ الكبيرة',
    enabled: false,
    minAmountThreshold: 1000000,
    requiredLevels: 1,
    approverRolesLevel1: ['المدير المالي', 'مالك المؤسسة', 'مدير النظام'],
  },
  {
    id: 'apr-rule-vch',
    companyId: 'comp-01',
    actionType: 'voucher_post',
    nameAr: 'اعتماد سندات الصرف والقبض فوق الحد',
    enabled: false,
    minAmountThreshold: 500000,
    requiredLevels: 1,
    approverRolesLevel1: ['المدير المالي', 'مالك المؤسسة'],
  },
  {
    id: 'apr-rule-je',
    companyId: 'comp-01',
    actionType: 'manual_journal_post',
    nameAr: 'اعتماد القيود اليدوية ذات المستوى الثاني',
    enabled: false,
    minAmountThreshold: 1000000,
    requiredLevels: 2,
    approverRolesLevel1: ['المدير المالي'],
    approverRolesLevel2: ['مالك المؤسسة', 'مدير النظام'],
  },
];

export const defaultSavedReportDesigns: SavedReportDesign[] = [
  {
    id: 'rep-design-sales-exec',
    companyId: 'comp-01',
    nameAr: 'تقرير تحليل الفواتير الشامل (نموذج افتراضي)',
    description: 'قالب مصمم مرئياً قابل للتخصيص والسحب والإفلات لمتابعة الفواتير والمدفوعات والمتبقي',
    dataSource: 'invoices',
    rowHeightPx: 38,
    cellPaddingPx: 8,
    paperOrientation: 'landscape',
    splitWideTableOnPrint: true,
    isDefaultTemplate: true,
    createdBy: 'النظام',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sortRules: [{ field: 'date', direction: 'desc' }],
    filters: [],
    columns: [
      { id: 'c1', field: 'invoiceNumber', label: 'رقم الفاتورة', visible: true, order: 0, widthPx: 120, pin: 'right', align: 'right', wrapText: false, fontSizePx: 12, fontWeight: 'bold', showSubtotal: false, showGrandTotal: false, sortable: true, searchable: true, format: 'text' },
      { id: 'c2', field: 'type', label: 'النوع', visible: true, order: 1, widthPx: 95, pin: 'none', align: 'center', wrapText: false, fontSizePx: 12, fontWeight: 'normal', showSubtotal: false, showGrandTotal: false, sortable: true, searchable: true, format: 'text' },
      { id: 'c3', field: 'date', label: 'التاريخ', visible: true, order: 2, widthPx: 105, pin: 'none', align: 'center', wrapText: false, fontSizePx: 12, fontWeight: 'normal', showSubtotal: false, showGrandTotal: false, sortable: true, searchable: true, format: 'date' },
      { id: 'c4', field: 'entityName', label: 'العميل / المورد', visible: true, order: 3, widthPx: 200, pin: 'none', align: 'right', wrapText: true, fontSizePx: 12, fontWeight: 'bold', showSubtotal: false, showGrandTotal: false, sortable: true, searchable: true, format: 'text' },
      { id: 'c5', field: 'currency', label: 'العملة', visible: true, order: 4, widthPx: 75, pin: 'none', align: 'center', wrapText: false, fontSizePx: 12, fontWeight: 'normal', showSubtotal: false, showGrandTotal: false, sortable: true, searchable: true, format: 'text' },
      { id: 'c6', field: 'grandTotal', label: 'الإجمالي', visible: true, order: 5, widthPx: 125, pin: 'none', align: 'left', wrapText: false, fontSizePx: 12, fontWeight: 'bold', showSubtotal: true, showGrandTotal: true, sortable: true, searchable: false, format: 'currency' },
      { id: 'c7', field: 'paidAmount', label: 'المدفوع', visible: true, order: 6, widthPx: 120, pin: 'none', align: 'left', wrapText: false, fontSizePx: 12, fontWeight: 'normal', showSubtotal: true, showGrandTotal: true, sortable: true, searchable: false, format: 'currency' },
      { id: 'c8', field: 'remainingAmount', label: 'المتبقي', visible: true, order: 7, widthPx: 120, pin: 'left', align: 'left', wrapText: false, fontSizePx: 12, fontWeight: 'bold', textColor: '#f59e0b', showSubtotal: true, showGrandTotal: true, sortable: true, searchable: false, format: 'currency' },
    ],
  },
];

export const defaultUnitsOfMeasure: UnitOfMeasure[] = [
  { id: 'uom-01', nameAr: 'حبة', symbolAr: 'حبة', isBase: true, factorToBase: 1 },
  { id: 'uom-02', nameAr: 'كرتون', symbolAr: 'كرتون', isBase: false, factorToBase: 12 },
  { id: 'uom-03', nameAr: 'شدة', symbolAr: 'شدة', isBase: false, factorToBase: 6 },
  { id: 'uom-04', nameAr: 'كيلوجرام', symbolAr: 'كجم', isBase: true, factorToBase: 1 },
  { id: 'uom-05', nameAr: 'متر', symbolAr: 'م', isBase: true, factorToBase: 1 },
];

export const defaultCustomBooks: CustomLedgerBook[] = [
  {
    id: 'book-01',
    code: 'BK-01',
    nameAr: 'دفتر العهد والسلف والمصروفات النثرية',
    description: 'سجل مساعد لمتابعة العهد اليومية والتسويات الإدارية الميدانية',
    createdAt: '2026-01-01',
  },
];

export function getDefaultTypography(docType: PrintDocumentType = 'invoice'): NonNullable<PrintTemplateConfig['typography']> {
  const isDense = docType === 'report' || docType === 'statement';
  return {
    unit: 'pt',
    companyName: isDense ? 13 : 14,
    documentTitle: isDense ? 11.5 : 12.5,
    sectionHeadings: isDense ? 10 : 10.5,
    companyDetails: isDense ? 8 : 8.5,
    partyMetadata: isDense ? 8.5 : 9,
    tableHeaders: isDense ? 8.5 : 9,
    tableCells: isDense ? 8.2 : 8.8,
    numericValues: isDense ? 8.4 : 9,
    priceValues: isDense ? 8.5 : 9.2,
    totalsAndSummary: isDense ? 9.2 : 9.8,
    finalAmounts: isDense ? 10.2 : 11,
    notes: isDense ? 8.2 : 8.8,
    signatures: 8,
    footer: 7.8,
    pageNumbers: 7.8,
    colors: {},
    weights: {
      companyName: 'bold',
      documentTitle: 'bold',
      sectionHeadings: 'bold',
      companyDetails: 'normal',
      partyMetadata: 'normal',
      tableHeaders: 'bold',
      tableCells: 'normal',
      numericValues: 'normal',
      priceValues: 'bold',
      totalsAndSummary: 'bold',
      finalAmounts: 'bold',
      notes: 'normal',
      signatures: 'bold',
      footer: 'normal',
      pageNumbers: 'bold',
    },
  };
}

export function getDefaultPagination(docType: PrintDocumentType = 'invoice'): NonNullable<PrintTemplateConfig['pagination']> {
  return {
    minimumRowsBeforeTableBreak: docType === 'voucher' ? 2 : 4,
    keepHeadingWithTable: true,
    preventRowSplit: true,
    allowMultipleTablesPerPage: true,
    keepShortTableTogetherMaxRows: 5,
    tableSpacingMm: 5,
    headingSpacingBeforeMm: 2.5,
    headingSpacingAfterMm: 1.5,
  };
}

export const defaultPrintTemplates: Record<PrintDocumentType, PrintTemplateConfig> = {
  invoice: {
    id: 'tpl-invoice',
    nameAr: 'قالب الفواتير الرسمي',
    docType: 'invoice',
    paperSize: 'A4',
    customWidthMm: 210,
    customHeightMm: 297,
    orientation: 'portrait',
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 12,
    marginLeftMm: 10,
    showLogo: true,
    logoSizePx: 64,
    logoPosition: 'right',
    useCustomBanner: true,
    showHeader: true,
    showCompanyDetails: true,
    showFooter: true,
    footerText: 'شكراً لتعاملكم معنا - مستند فاتورة معتمد إلكترونياً',
    fontFamily: 'Cairo',
    fontSizePt: 10,
    typography: getDefaultTypography('invoice'),
    pagination: getDefaultPagination('invoice'),
    primaryColor: '#0f172a',
    accentColor: '#d97706',
    tableHeaderBg: '#0f172a',
    tableHeaderText: '#fbbf24',
    borderColor: '#cbd5e1',
    borderWidthPx: 1,
    repeatHeaderOnPages: false,
    repeatTableHeader: true,
    hiddenColumns: [],
    showPageNumbers: true,
    showSignatures: true,
    showStamp: true,
    signatureLabels: ['المحرر / البائع', 'المحاسب المسؤول', 'استلام العميل'],
  },
  voucher: {
    id: 'tpl-voucher',
    nameAr: 'قالب السندات المالية',
    docType: 'voucher',
    paperSize: 'A4',
    customWidthMm: 210,
    customHeightMm: 297,
    orientation: 'portrait',
    marginTopMm: 12,
    marginRightMm: 12,
    marginBottomMm: 12,
    marginLeftMm: 12,
    showLogo: true,
    logoSizePx: 64,
    logoPosition: 'right',
    useCustomBanner: true,
    showHeader: true,
    showCompanyDetails: true,
    showFooter: true,
    footerText: 'سند مالي رسمي صادر عن إدارة الخزينة والحسابات',
    fontFamily: 'Cairo',
    fontSizePt: 10,
    typography: getDefaultTypography('voucher'),
    pagination: getDefaultPagination('voucher'),
    primaryColor: '#0f172a',
    accentColor: '#d97706',
    tableHeaderBg: '#1e293b',
    tableHeaderText: '#fbbf24',
    borderColor: '#cbd5e1',
    borderWidthPx: 1,
    repeatHeaderOnPages: false,
    repeatTableHeader: true,
    hiddenColumns: [],
    showPageNumbers: true,
    showSignatures: true,
    showStamp: true,
    signatureLabels: ['أمين الصندوق', 'المراجعة والتدقيق', 'المستلم / المفوض'],
  },
  statement: {
    id: 'tpl-statement',
    nameAr: 'قالب كشوف الحسابات',
    docType: 'statement',
    paperSize: 'A4',
    customWidthMm: 210,
    customHeightMm: 297,
    orientation: 'auto',
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 12,
    marginLeftMm: 10,
    showLogo: true,
    logoSizePx: 56,
    logoPosition: 'right',
    useCustomBanner: true,
    showHeader: true,
    showCompanyDetails: true,
    showFooter: true,
    footerText: 'يرجى مطابقة الرصيد خلال 7 أيام من تاريخ استلام الكشف',
    fontFamily: 'Cairo',
    fontSizePt: 9.5,
    typography: getDefaultTypography('statement'),
    pagination: getDefaultPagination('statement'),
    primaryColor: '#0f172a',
    accentColor: '#d97706',
    tableHeaderBg: '#0f172a',
    tableHeaderText: '#ffffff',
    borderColor: '#cbd5e1',
    borderWidthPx: 1,
    repeatHeaderOnPages: false,
    repeatTableHeader: true,
    hiddenColumns: [],
    showPageNumbers: true,
    showSignatures: true,
    showStamp: false,
    signatureLabels: ['إعداد / المحاسب', 'رئيس الحسابات', 'مصادقة الطرف'],
  },
  report: {
    id: 'tpl-report',
    nameAr: 'قالب التقارير الإدارية والمحاسبية',
    docType: 'report',
    paperSize: 'A4',
    customWidthMm: 210,
    customHeightMm: 297,
    orientation: 'auto',
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 12,
    marginLeftMm: 10,
    showLogo: true,
    logoSizePx: 56,
    logoPosition: 'right',
    useCustomBanner: true,
    showHeader: true,
    showCompanyDetails: true,
    showFooter: true,
    footerText: 'ALMANSOOR SMART FINANCE ERP - تقرير مالي معتمد',
    fontFamily: 'Cairo',
    fontSizePt: 9.5,
    typography: getDefaultTypography('report'),
    pagination: getDefaultPagination('report'),
    primaryColor: '#0f172a',
    accentColor: '#d97706',
    tableHeaderBg: '#0f172a',
    tableHeaderText: '#fbbf24',
    borderColor: '#cbd5e1',
    borderWidthPx: 1,
    repeatHeaderOnPages: false,
    repeatTableHeader: true,
    hiddenColumns: [],
    showPageNumbers: true,
    showSignatures: true,
    showStamp: false,
    signatureLabels: ['إعداد / المحاسب', 'المراجعة والتدقيق', 'اعتماد الإدارة العامة'],
  },
};

export function mergePrintTemplates(
  saved?: Partial<Record<PrintDocumentType, Partial<PrintTemplateConfig>>>
): Record<PrintDocumentType, PrintTemplateConfig> {
  const mergeOne = (dt: PrintDocumentType): PrintTemplateConfig => {
    const base = defaultPrintTemplates[dt];
    const s = saved?.[dt];
    const defTypo = base.typography || getDefaultTypography(dt);
    const savedTypo = s?.typography;
    const legacyNum = savedTypo?.numericValues;
    const legacyTot = savedTypo?.totalsAndSummary;
    const legacySig = savedTypo?.signaturesAndFooter;
    return {
      ...base,
      ...(s || {}),
      typography: {
        ...defTypo,
        ...(savedTypo || {}),
        priceValues: savedTypo?.priceValues ?? legacyNum ?? defTypo.priceValues,
        finalAmounts: savedTypo?.finalAmounts ?? legacyTot ?? defTypo.finalAmounts,
        signatures: savedTypo?.signatures ?? legacySig ?? defTypo.signatures,
        footer: savedTypo?.footer ?? legacySig ?? defTypo.footer,
        colors: { ...(defTypo.colors || {}), ...(savedTypo?.colors || {}) },
        weights: { ...(defTypo.weights || {}), ...(savedTypo?.weights || {}) },
      },
      pagination: {
        ...(base.pagination || getDefaultPagination(dt)),
        ...(s?.pagination || {}),
      },
      hiddenColumns: s?.hiddenColumns || base.hiddenColumns,
    };
  };
  return {
    invoice: mergeOne('invoice'),
    voucher: mergeOne('voucher'),
    statement: mergeOne('statement'),
    report: mergeOne('report'),
  };
}

export function resolveCompanyPrintTemplates(
  settings: SystemSettings | undefined,
  companyId?: string
): Record<PrintDocumentType, PrintTemplateConfig> {
  if (companyId && settings?.companyPrintTemplates?.[companyId]) {
    return mergePrintTemplates(settings.companyPrintTemplates[companyId]);
  }
  return mergePrintTemplates(settings?.printTemplates);
}

export const defaultTabsConfig: TabVisibilityConfig[] = [
  { id: 'tab-pos', label: '1. الفواتير والمخزن', visible: true },
  { id: 'tab-bonds', label: '2. السندات والمناقلات', visible: true },
  { id: 'tab-ledgers', label: '3. الدفاتر اليومية والمحاسبة', visible: true },
  { id: 'tab-inventory', label: '4. الجرد والحركة والمستودعات', visible: true },
  { id: 'tab-cust', label: '5. العملاء والموردون والعملات', visible: true },
  { id: 'tab-reports', label: '6. التقرير الشامل والتقارير', visible: true },
  { id: 'tab-unified-coa', label: '7. النظام الموحد والموارد البشرية', visible: true },
  { id: 'tab-admin', label: '8. التخصيص والصلاحيات والدفاتر', visible: true },
];

export const defaultDocumentBooks: DocumentBook[] = [
  {
    id: 'dbook-sal-main',
    code: 'DB-SAL-01',
    nameAr: 'دفتر فواتير المبيعات الرئيسي',
    category: 'sales',
    prefix: 'SAL-',
    nextSequence: 1001,
    padLength: 4,
    isActive: true,
    isDefault: true,
    description: 'الدفتر الأساسي لإصدار فواتير ومرتجعات المبيعات النقدية والآجلة',
  },
  {
    id: 'dbook-sal-whl',
    code: 'DB-SAL-02',
    nameAr: 'دفتر مبيعات الجملة والوكلاء',
    category: 'sales',
    prefix: 'WHL-',
    nextSequence: 2001,
    padLength: 4,
    isActive: true,
    isDefault: false,
    description: 'دفتر مخصص لمبيعات كبار العملاء والمناديب',
  },
  {
    id: 'dbook-pur-main',
    code: 'DB-PUR-01',
    nameAr: 'دفتر فواتير المشتريات والتوريد',
    category: 'purchases',
    prefix: 'PUR-',
    nextSequence: 1001,
    padLength: 4,
    isActive: true,
    isDefault: true,
    description: 'دفتر فواتير المشتريات ومرتجعات الموردين',
  },
  {
    id: 'dbook-wh-main',
    code: 'DB-WH-01',
    nameAr: 'دفتر الأذون والمناقلات المخزنية',
    category: 'warehouse',
    prefix: 'WHS-',
    nextSequence: 1001,
    padLength: 4,
    isActive: true,
    isDefault: true,
    description: 'دفتر أوامر الصرف والتوريد والمناقلات بين المستودعات',
  },
  {
    id: 'dbook-rec-main',
    code: 'DB-REC-01',
    nameAr: 'دفتر سندات القبض المعتمد',
    category: 'vouchers',
    prefix: 'REC-',
    nextSequence: 501,
    padLength: 4,
    isActive: true,
    isDefault: true,
    description: 'دفتر سندات القبض والتحصيلات اليومية',
  },
  {
    id: 'dbook-pay-main',
    code: 'DB-PAY-01',
    nameAr: 'دفتر سندات الصرف والمناقلات المالية',
    category: 'vouchers',
    prefix: 'PAY-',
    nextSequence: 501,
    padLength: 4,
    isActive: true,
    isDefault: false,
    description: 'دفتر سندات الصرف للموردين والمصاريف والتحويلات النقدية',
  },
];

export interface ERPDatabase {
  schemaVersion?: string;
  company: Company;
  companies?: Company[];
  activeCompanyId?: string;
  currencies: Currency[];
  branches: Branch[];
  warehouses: Warehouse[];
  regionalAreas: RegionalArea[];
  departments?: DepartmentItem[];
  customers: Customer[];
  vendors: Vendor[];
  unitsOfMeasure?: UnitOfMeasure[];
  inventoryItems: InventoryItem[];
  warehouseStock: ItemWarehouseStock[];
  stockCostLayers?: StockCostLayer[];
  inventoryBatches?: InventoryBatch[];
  storageLocations?: StorageLocation[];
  stockMovements: StockMovement[];
  inventoryTransfers: InventoryTransfer[];
  stocktakings: PhysicalStocktaking[];
  warehouseDocuments: WarehouseDocument[];
  documentBooks?: DocumentBook[];
  chartOfAccounts: Account[];
  costCenters: CostCenter[];
  journalEntries: JournalEntry[];
  fiscalPeriods?: FiscalPeriod[];
  invoices: Invoice[];
  commercialOrders?: CommercialOrder[];
  treasuryAccounts: TreasuryAccount[];
  paymentVouchers: PaymentVoucher[];
  treasuryTransfers: TreasuryTransfer[];
  bankReconciliations?: BankReconciliationSession[];
  posShifts?: PosShift[];
  heldPosCarts?: HeldPosCart[];
  expenseCategories: ExpenseCategory[];
  expenseRecords: ExpenseRecord[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  fixedAssets: FixedAsset[];
  customBooks?: CustomLedgerBook[];
  customBookEntries?: CustomLedgerEntry[];
  approvalRules?: ApprovalWorkflowRule[];
  approvalRequests?: ApprovalRequest[];
  fxRevaluations?: FxRevaluationRecord[];
  savedReportDesigns?: SavedReportDesign[];
  savedTableViews?: SavedTableView[];
  backupHistory?: BackupSnapshotMeta[];
  backupSchedule?: BackupScheduleConfig;
  dataImportLogs?: DataImportLog[];
  processedIdempotencyKeys?: string[];
  revision?: number;
  users: User[];
  auditLogs: AuditLogEntry[];
  taskAlerts: TaskAlert[];
  dispatchLogs: DispatchLogEntry[];
  settings: SystemSettings;
}

const STORAGE_KEY = 'almansoor_erp_database_v1';
const SETTINGS_CACHE_KEY = 'almansoor_erp_settings_cache_v1';
const IDB_NAME = 'AlmansoorSmartFinanceERP';
const IDB_STORE = 'database';

/**
 * Generates sequential, collision-free document numbers given a prefix and existing document numbers.
 */
export function generateNextDocNumber(
  prefix: string,
  existingNumbers: string[],
  padLength: number = 4
): string {
  let maxSeq = 0;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactRegex = new RegExp(`^${escaped}(\\d+)$`);

  for (const num of existingNumbers) {
    if (!num) continue;
    const match = exactRegex.exec(num.trim());
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
      continue;
    }
    if (num.startsWith(prefix)) {
      const tailMatch = /(\d+)$/.exec(num);
      if (tailMatch) {
        const parsed = parseInt(tailMatch[1], 10);
        if (!Number.isNaN(parsed) && parsed > maxSeq) {
          maxSeq = parsed;
        }
      }
    }
  }

  let candidateSeq = maxSeq + 1;
  const existingSet = new Set(existingNumbers.map((n) => (n || '').trim()));
  let candidate = `${prefix}${String(candidateSeq).padStart(padLength, '0')}`;
  while (existingSet.has(candidate)) {
    candidateSeq += 1;
    candidate = `${prefix}${String(candidateSeq).padStart(padLength, '0')}`;
  }
  return candidate;
}

function stampCompanyId<T extends object>(
  items: T[] | undefined,
  fallbackCompanyId: string
): (T & { companyId: string })[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const existing = (item as { companyId?: string }).companyId;
    return existing && String(existing).trim()
      ? { ...item, companyId: String(existing) }
      : { ...item, companyId: fallbackCompanyId };
  });
}

/**
 * Ensures critical COA accounts and newly introduced collections/settings exist when migrating older databases or backups.
 */
export function migrateDatabase(raw: Partial<ERPDatabase>): ERPDatabase {
  const defaultDb = getInitialDatabase();
  const inferredPrimaryId = raw.company?.id || defaultDb.company.id;

  const existingAccounts = Array.isArray(raw.chartOfAccounts) && raw.chartOfAccounts.length > 0
    ? [...raw.chartOfAccounts]
    : [...defaultDb.chartOfAccounts];

  const requiredCoaIds = ['acc-1165', 'acc-4180', 'acc-4190', 'acc-5340', 'acc-5380', 'acc-5390'];
  for (const reqId of requiredCoaIds) {
    const defAcc = defaultDb.chartOfAccounts.find((a) => a.id === reqId);
    if (defAcc && !existingAccounts.some((a) => (a.id === defAcc.id || a.code === defAcc.code) && (!a.companyId || a.companyId === inferredPrimaryId))) {
      existingAccounts.push({ ...defAcc, companyId: defAcc.companyId || inferredPrimaryId });
    }
  }
  const companyIdsInDb = Array.isArray(raw.companies) && raw.companies.length > 0
    ? raw.companies.map((c) => c.id)
    : [inferredPrimaryId];
  for (const cid of companyIdsInDb) {
    const ensureList: Array<{ baseId: string; code: string; nameAr: string; category: Account['category']; nature: Account['nature']; parentCode: string; level: number }> = [
      { baseId: 'acc-1165', code: '1165', nameAr: 'ضريبة القيمة المضافة - مدخلات قابلة للاسترداد', category: 'أصول', nature: 'debit', parentCode: '11', level: 3 },
      { baseId: 'acc-4180', code: '4180', nameAr: 'فروق إعادة تقييم العملات الأجنبية (أرباح)', category: 'إيرادات', nature: 'credit', parentCode: '41', level: 3 },
      { baseId: 'acc-5380', code: '5380', nameAr: 'فروق إعادة تقييم العملات الأجنبية (خسائر)', category: 'مصروفات', nature: 'debit', parentCode: '53', level: 3 },
    ];
    for (const item of ensureList) {
      const hasAcc = existingAccounts.some(
        (a) => a.code === item.code && (a.companyId === cid || (!a.companyId && cid === inferredPrimaryId))
      );
      if (!hasAcc) {
        existingAccounts.push({
          id: cid === inferredPrimaryId ? item.baseId : `${item.baseId}-${cid}`,
          companyId: cid,
          code: item.code,
          nameAr: item.nameAr,
          category: item.category,
          nature: item.nature,
          parentCode: item.parentCode,
          level: item.level,
          isLeaf: true,
          isActive: true,
          currentBalance: 0,
          isSystemAccount: true,
        });
      }
    }
  }

  const rawSettings = (raw.settings || {}) as Partial<SystemSettings>;
  const defaultOpControl = getDefaultOperationalControl();
  const rawOp = (rawSettings.operationalControl || {}) as Partial<OperationalControlConfig>;
  const mergedOperationalControl: OperationalControlConfig = {
    ...defaultOpControl,
    ...rawOp,
    enabledModules: {
      ...defaultOpControl.enabledModules,
      ...(rawOp.enabledModules || {}),
    },
    screenFieldRules: {
      ...defaultOpControl.screenFieldRules,
      ...(rawOp.screenFieldRules || {}),
    },
    customDocumentStatuses:
      Array.isArray(rawOp.customDocumentStatuses) && rawOp.customDocumentStatuses.length > 0
        ? rawOp.customDocumentStatuses
        : defaultOpControl.customDocumentStatuses,
    shortcuts:
      Array.isArray(rawOp.shortcuts) && rawOp.shortcuts.length > 0
        ? rawOp.shortcuts
        : defaultOpControl.shortcuts,
  };

  const mergedSettings: SystemSettings = {
    ...defaultDb.settings,
    ...rawSettings,
    language: rawSettings.language === 'en' ? 'en' : 'ar',
    whatsappTemplates: {
      ...defaultDb.settings.whatsappTemplates!,
      ...(rawSettings.whatsappTemplates || {}),
    },
    paymentMethods:
      Array.isArray(rawSettings.paymentMethods) && rawSettings.paymentMethods.length > 0
        ? rawSettings.paymentMethods
        : defaultDb.settings.paymentMethods,
    uiPreferences: {
      ...defaultDb.settings.uiPreferences!,
      ...(rawSettings.uiPreferences || {}),
      goldColor: rawSettings.uiPreferences?.goldColor || '#F5C748',
      cardColor: rawSettings.uiPreferences?.cardColor || '#101E2E',
      tabsConfig:
        Array.isArray(rawSettings.uiPreferences?.tabsConfig) && rawSettings.uiPreferences.tabsConfig.length > 0
          ? rawSettings.uiPreferences.tabsConfig
          : defaultTabsConfig,
      hiddenModules: Array.isArray(rawSettings.uiPreferences?.hiddenModules)
        ? rawSettings.uiPreferences.hiddenModules
        : defaultDb.settings.uiPreferences!.hiddenModules,
      tableColumnPrefs:
        rawSettings.uiPreferences?.tableColumnPrefs && typeof rawSettings.uiPreferences.tableColumnPrefs === 'object'
          ? rawSettings.uiPreferences.tableColumnPrefs
          : {},
    },
    operationalControl: mergedOperationalControl,
    printTemplates: mergePrintTemplates(rawSettings.printTemplates),
    companyPrintTemplates: (() => {
      const compId = raw.company?.id || defaultDb.company.id;
      const map: Record<string, Record<PrintDocumentType, PrintTemplateConfig>> = {};
      if (rawSettings.companyPrintTemplates && typeof rawSettings.companyPrintTemplates === 'object') {
        for (const [cid, tpls] of Object.entries(rawSettings.companyPrintTemplates)) {
          map[cid] = mergePrintTemplates(tpls);
        }
      }
      if (!map[compId]) {
        map[compId] = mergePrintTemplates(rawSettings.printTemplates);
      }
      return map;
    })(),
  };

  const primaryCompany: Company = {
    ...(raw.company || defaultDb.company),
    countryCode: raw.company?.countryCode || 'YE',
    isActive: raw.company?.isActive !== false,
    valuationPolicy: raw.company?.valuationPolicy || 'PER_ITEM',
  };
  const companies: Company[] =
    Array.isArray(raw.companies) && raw.companies.length > 0
      ? raw.companies.map((c) => ({ ...c, countryCode: c.countryCode || 'YE', isActive: c.isActive !== false }))
      : [primaryCompany];
  const activeCompanyId = raw.activeCompanyId || primaryCompany.id;

  const fiscalYear = mergedSettings.fiscalYear || '2026';
  const defaultPeriod: FiscalPeriod = {
    id: `fp-${activeCompanyId}-${fiscalYear}`,
    companyId: activeCompanyId,
    fiscalYear,
    periodName: `السنة المالية ${fiscalYear}`,
    startDate: `${fiscalYear}-01-01`,
    endDate: `${fiscalYear}-12-31`,
    status: mergedSettings.fiscalYearStatus === 'closed' ? 'closed' : 'open',
  };

  const resolvedStock = Array.isArray(raw.warehouseStock) ? raw.warehouseStock : defaultDb.warehouseStock;
  const resolvedLayers: StockCostLayer[] =
    Array.isArray(raw.stockCostLayers) && raw.stockCostLayers.length > 0
      ? raw.stockCostLayers
      : resolvedStock
          .filter((ws) => ws.quantityOnHand > 0)
          .map((ws, idx) => ({
            id: `layer-init-${idx + 1}-${ws.itemId}-${ws.warehouseId}`,
            companyId: ws.companyId || activeCompanyId,
            itemId: ws.itemId,
            warehouseId: ws.warehouseId,
            receivedDate: `${fiscalYear}-01-01`,
            sourceDocType: 'رصيد_افتتاحي',
            sourceDocId: `init-${ws.itemId}-${ws.warehouseId}`,
            sourceDocNumber: 'OPEN-STOCK',
            originalQuantity: ws.quantityOnHand,
            remainingQuantity: ws.quantityOnHand,
            unitCost: ws.averageCost,
          }));

  const primaryCompanyId = primaryCompany.id;
  const resolvedUsersRaw = Array.isArray(raw.users) && raw.users.length > 0 ? raw.users : defaultDb.users;
  const resolvedUsers = resolvedUsersRaw.map((u) =>
    u.allowedCompanyIds === undefined
      ? { ...u, allowedCompanyIds: [primaryCompanyId] }
      : u
  );

  return reconcileSaudiCurrenciesInDb({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    company: primaryCompany,
    companies,
    activeCompanyId,
    currencies: Array.isArray(raw.currencies) && raw.currencies.length > 0 ? raw.currencies : defaultDb.currencies,
    branches: stampCompanyId(Array.isArray(raw.branches) && raw.branches.length > 0 ? raw.branches : defaultDb.branches, primaryCompanyId),
    warehouses: stampCompanyId(Array.isArray(raw.warehouses) && raw.warehouses.length > 0 ? raw.warehouses : defaultDb.warehouses, primaryCompanyId),
    regionalAreas: Array.isArray(raw.regionalAreas) ? raw.regionalAreas : defaultDb.regionalAreas,
    departments: stampCompanyId(Array.isArray(raw.departments) && raw.departments.length > 0 ? raw.departments : defaultDb.departments, primaryCompanyId),
    customers: stampCompanyId(Array.isArray(raw.customers) ? raw.customers : defaultDb.customers, primaryCompanyId),
    vendors: stampCompanyId(Array.isArray(raw.vendors) ? raw.vendors : defaultDb.vendors, primaryCompanyId),
    unitsOfMeasure:
      Array.isArray(raw.unitsOfMeasure) && raw.unitsOfMeasure.length > 0
        ? raw.unitsOfMeasure
        : defaultUnitsOfMeasure,
    inventoryItems: stampCompanyId(Array.isArray(raw.inventoryItems) ? raw.inventoryItems : defaultDb.inventoryItems, primaryCompanyId),
    warehouseStock: stampCompanyId(resolvedStock, primaryCompanyId),
    stockCostLayers: stampCompanyId(resolvedLayers, primaryCompanyId),
    inventoryBatches: stampCompanyId(Array.isArray(raw.inventoryBatches) ? raw.inventoryBatches : [], primaryCompanyId),
    storageLocations: stampCompanyId(Array.isArray(raw.storageLocations) ? raw.storageLocations : [], primaryCompanyId),
    stockMovements: stampCompanyId(Array.isArray(raw.stockMovements) ? raw.stockMovements : defaultDb.stockMovements, primaryCompanyId),
    inventoryTransfers: stampCompanyId(Array.isArray(raw.inventoryTransfers) ? raw.inventoryTransfers : [], primaryCompanyId),
    stocktakings: stampCompanyId(Array.isArray(raw.stocktakings) ? raw.stocktakings : [], primaryCompanyId),
    warehouseDocuments: stampCompanyId(
      Array.isArray(raw.warehouseDocuments) ? raw.warehouseDocuments : defaultDb.warehouseDocuments,
      primaryCompanyId
    ),
    documentBooks: stampCompanyId(
      Array.isArray(raw.documentBooks) && raw.documentBooks.length > 0
        ? raw.documentBooks
        : defaultDocumentBooks,
      primaryCompanyId
    ),
    chartOfAccounts: stampCompanyId(existingAccounts.map((a) => ({ ...a, isActive: a.isActive !== false })), primaryCompanyId),
    costCenters: stampCompanyId(Array.isArray(raw.costCenters) ? raw.costCenters : defaultDb.costCenters, primaryCompanyId),
    journalEntries: stampCompanyId(Array.isArray(raw.journalEntries) ? raw.journalEntries : defaultDb.journalEntries, primaryCompanyId),
    fiscalPeriods: stampCompanyId(
      Array.isArray(raw.fiscalPeriods) && raw.fiscalPeriods.length > 0
        ? raw.fiscalPeriods
        : [defaultPeriod],
      primaryCompanyId
    ),
    invoices: stampCompanyId(Array.isArray(raw.invoices) ? raw.invoices : defaultDb.invoices, primaryCompanyId),
    commercialOrders: stampCompanyId(Array.isArray(raw.commercialOrders) ? raw.commercialOrders : [], primaryCompanyId),
    treasuryAccounts: stampCompanyId(Array.isArray(raw.treasuryAccounts) ? raw.treasuryAccounts : defaultDb.treasuryAccounts, primaryCompanyId),
    paymentVouchers: stampCompanyId(Array.isArray(raw.paymentVouchers) ? raw.paymentVouchers : defaultDb.paymentVouchers, primaryCompanyId),
    treasuryTransfers: stampCompanyId(Array.isArray(raw.treasuryTransfers) ? raw.treasuryTransfers : [], primaryCompanyId),
    bankReconciliations: stampCompanyId(Array.isArray(raw.bankReconciliations) ? raw.bankReconciliations : [], primaryCompanyId),
    posShifts: stampCompanyId(Array.isArray(raw.posShifts) ? raw.posShifts : [], primaryCompanyId),
    heldPosCarts: stampCompanyId(Array.isArray(raw.heldPosCarts) ? raw.heldPosCarts : [], primaryCompanyId),
    expenseCategories: stampCompanyId(Array.isArray(raw.expenseCategories) ? raw.expenseCategories : defaultDb.expenseCategories, primaryCompanyId),
    expenseRecords: stampCompanyId(Array.isArray(raw.expenseRecords) ? raw.expenseRecords : defaultDb.expenseRecords, primaryCompanyId),
    employees: stampCompanyId(Array.isArray(raw.employees) ? raw.employees : defaultDb.employees, primaryCompanyId),
    payrollRuns: stampCompanyId(Array.isArray(raw.payrollRuns) ? raw.payrollRuns : defaultDb.payrollRuns, primaryCompanyId),
    fixedAssets: stampCompanyId(Array.isArray(raw.fixedAssets) ? raw.fixedAssets : defaultDb.fixedAssets, primaryCompanyId),
    customBooks: stampCompanyId(
      Array.isArray(raw.customBooks) && raw.customBooks.length > 0 ? raw.customBooks : defaultCustomBooks,
      primaryCompanyId
    ),
    customBookEntries: stampCompanyId(Array.isArray(raw.customBookEntries) ? raw.customBookEntries : [], primaryCompanyId),
    approvalRules: stampCompanyId(
      Array.isArray(raw.approvalRules) && raw.approvalRules.length > 0
        ? raw.approvalRules
        : defaultApprovalRules,
      primaryCompanyId
    ),
    approvalRequests: stampCompanyId(Array.isArray(raw.approvalRequests) ? raw.approvalRequests : [], primaryCompanyId),
    fxRevaluations: stampCompanyId(Array.isArray(raw.fxRevaluations) ? raw.fxRevaluations : [], primaryCompanyId),
    savedReportDesigns: stampCompanyId(
      Array.isArray(raw.savedReportDesigns) && raw.savedReportDesigns.length > 0
        ? raw.savedReportDesigns
        : defaultSavedReportDesigns,
      primaryCompanyId
    ),
    savedTableViews: Array.isArray(raw.savedTableViews) ? raw.savedTableViews : [],
    backupHistory: Array.isArray(raw.backupHistory) ? raw.backupHistory : [],
    backupSchedule: raw.backupSchedule || { enabled: false, frequencyHours: 24, encryptByDefault: false },
    dataImportLogs: Array.isArray(raw.dataImportLogs) ? raw.dataImportLogs : [],
    processedIdempotencyKeys: Array.isArray(raw.processedIdempotencyKeys) ? raw.processedIdempotencyKeys : [],
    revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision) && raw.revision >= 1 ? raw.revision : 1,
    users: resolvedUsers,
    auditLogs: stampCompanyId(Array.isArray(raw.auditLogs) ? raw.auditLogs : defaultDb.auditLogs, primaryCompanyId),
    taskAlerts: stampCompanyId(Array.isArray(raw.taskAlerts) ? raw.taskAlerts : defaultDb.taskAlerts, primaryCompanyId),
    dispatchLogs: stampCompanyId(Array.isArray(raw.dispatchLogs) ? raw.dispatchLogs : defaultDb.dispatchLogs, primaryCompanyId),
    settings: mergedSettings,
  });
}

/**
 * Strict backup validator before restoring any JSON file. Never mutates existing database on failure.
 */
export function validateDatabaseObject(parsed: unknown): {
  valid: boolean;
  db?: ERPDatabase;
  error?: string;
  stats?: {
    accounts: number;
    invoices: number;
    vouchers: number;
    customers: number;
    vendors: number;
    items: number;
    journalEntries: number;
    stocktakings: number;
  };
} {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'بنية ملف النسخة الاحتياطية لا تطابق كائن قاعدة البيانات.' };
  }

  const obj = parsed as Partial<ERPDatabase>;

  if (!obj.company || typeof obj.company !== 'object' || !obj.company.nameAr) {
    return { valid: false, error: 'بيانات المؤسسة (company) مفقودة أو غير مكتملة.' };
  }

  const requiredArrays: (keyof ERPDatabase)[] = [
    'chartOfAccounts',
    'invoices',
    'customers',
    'vendors',
    'inventoryItems',
    'treasuryAccounts',
    'journalEntries',
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(obj[key])) {
      return { valid: false, error: `الجدول الأساسي (${String(key)}) مفقود أو تالف في النسخة الاحتياطية.` };
    }
  }

  if ((obj.chartOfAccounts?.length || 0) === 0) {
    return { valid: false, error: 'شجرة الحسابات فارغة ولا يمكن اعتماد نسخة بدون دليل حسابات.' };
  }

  // Referential & numeric sanity checks
  const hasInvalidTreasury = obj.treasuryAccounts?.some(
    (t) => !t.id || !t.nameAr || !Number.isFinite(Number(t.balance))
  );
  if (hasInvalidTreasury) {
    return { valid: false, error: 'توجد حسابات خزينة بأرصدة رقمية غير صالحة.' };
  }

  const hasInvalidInvoices = obj.invoices?.some(
    (inv) => !inv.id || !inv.invoiceNumber || !Number.isFinite(Number(inv.grandTotal))
  );
  if (hasInvalidInvoices) {
    return { valid: false, error: 'توجد فواتير مفقودة المعرف أو بقيم رقمية غير صالحة.' };
  }

  const migrated = migrateDatabase(obj);

  return {
    valid: true,
    db: migrated,
    stats: {
      accounts: migrated.chartOfAccounts.length,
      invoices: migrated.invoices.length,
      vouchers: migrated.paymentVouchers.length,
      customers: migrated.customers.length,
      vendors: migrated.vendors.length,
      items: migrated.inventoryItems.length,
      journalEntries: migrated.journalEntries.length,
      stocktakings: migrated.stocktakings.length,
    },
  };
}

export function validateBackupPayload(rawText: string): {
  valid: boolean;
  db?: ERPDatabase;
  error?: string;
  stats?: {
    accounts: number;
    invoices: number;
    vouchers: number;
    customers: number;
    vendors: number;
    items: number;
    journalEntries: number;
    stocktakings: number;
  };
} {
  if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 2) {
    return { valid: false, error: 'ملف النسخة الاحتياطية فارغ أو غير مقروء.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { valid: false, error: 'صيغة JSON غير صالحة في ملف النسخة الاحتياطية.' };
  }

  return validateDatabaseObject(parsed);
}

let cachedIDBPromise: Promise<IDBDatabase> | null = null;

function openIDB(): Promise<IDBDatabase> {
  if (cachedIDBPromise) return cachedIDBPromise;
  cachedIDBPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      cachedIDBPromise = null;
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => {
      const idb = req.result;
      idb.onversionchange = () => {
        idb.close();
        cachedIDBPromise = null;
      };
      idb.onclose = () => {
        cachedIDBPromise = null;
      };
      resolve(idb);
    };
    req.onerror = () => {
      cachedIDBPromise = null;
      reject(req.error);
    };
  });
  return cachedIDBPromise;
}

export interface PersistenceResult {
  ok: boolean;
  backend: 'idb' | 'localStorage' | 'both' | 'none';
  verified: boolean;
  error?: string;
}

export interface StorageTestHooks {
  forceFailWrite?: boolean;
  failureMessage?: string;
}

let activeStorageTestHook: StorageTestHooks | null = null;

export function setStorageTestHook(hook: StorageTestHooks | null): void {
  activeStorageTestHook = hook;
}

export async function saveDatabaseToIDBVerified(data: ERPDatabase): Promise<{ ok: boolean; error?: string }> {
  try {
    if (activeStorageTestHook?.forceFailWrite) {
      return {
        ok: false,
        error: activeStorageTestHook.failureMessage || 'فشل الحفظ المحاكى في قاعدة البيانات المحلية.',
      };
    }
    const idb = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });

    // Verify commit via read-only transaction read-back
    const verifiedRecord = await new Promise<ERPDatabase | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
      req.onsuccess = () => resolve((req.result as ERPDatabase) || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read-back verification error'));
    });

    if (!verifiedRecord || !verifiedRecord.company?.id) {
      return { ok: false, error: 'تعذر التحقق من تثبيت البيانات في IndexedDB بعد الكتابة.' };
    }
    return { ok: true };
  } catch (err) {
    cachedIDBPromise = null;
    const msg = err instanceof Error ? err.message : String(err || 'IndexedDB unavailable');
    return { ok: false, error: msg };
  }
}

export async function saveDatabaseToIDB(data: ERPDatabase): Promise<void> {
  const res = await saveDatabaseToIDBVerified(data);
  if (!res.ok) {
    console.warn('IndexedDB save failed:', res.error);
  }
}

export async function loadDatabaseFromIDB(): Promise<ERPDatabase | null> {
  try {
    const idb = await openIDB();
    const result = await new Promise<ERPDatabase | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
      req.onsuccess = () => resolve((req.result as ERPDatabase) || null);
      req.onerror = () => reject(req.error);
    });
    if (!result || !result.company) return null;
    return migrateDatabase(result);
  } catch (err) {
    cachedIDBPromise = null;
    console.warn('IndexedDB load skipped:', err);
    return null;
  }
}

export async function clearDatabaseIDB(): Promise<void> {
  try {
    const idb = await openIDB();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(STORAGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    cachedIDBPromise = null;
  }
}

export function getInitialDatabase(): ERPDatabase {
  const seedCid = initialCompany.id;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 1,
    company: { ...initialCompany, countryCode: 'YE', isActive: true, valuationPolicy: 'PER_ITEM' },
    companies: [{ ...initialCompany, countryCode: 'YE', isActive: true, valuationPolicy: 'PER_ITEM' }],
    activeCompanyId: seedCid,
    currencies: initialCurrencies,
    branches: stampCompanyId(initialBranches, seedCid),
    warehouses: stampCompanyId(initialWarehouses, seedCid),
    regionalAreas: initialRegionalAreas,
    departments: stampCompanyId(
      Array.from(new Set(initialInventoryItems.map((i) => i.category).filter(Boolean))).map((name, idx) => ({
        id: `dep-${idx + 1}`,
        nameAr: name,
      })),
      seedCid
    ),
    customers: stampCompanyId(initialCustomers, seedCid),
    vendors: stampCompanyId(initialVendors, seedCid),
    unitsOfMeasure: defaultUnitsOfMeasure,
    inventoryItems: stampCompanyId(initialInventoryItems, seedCid),
    warehouseStock: stampCompanyId(initialWarehouseStock, seedCid),
    stockCostLayers: initialWarehouseStock
      .filter((ws) => ws.quantityOnHand > 0)
      .map((ws, idx) => ({
        id: `layer-seed-${idx + 1}`,
        companyId: seedCid,
        itemId: ws.itemId,
        warehouseId: ws.warehouseId,
        receivedDate: '2026-01-01',
        sourceDocType: 'رصيد_افتتاحي',
        sourceDocId: `init-${ws.itemId}-${ws.warehouseId}`,
        sourceDocNumber: 'OPEN-STOCK',
        originalQuantity: ws.quantityOnHand,
        remainingQuantity: ws.quantityOnHand,
        unitCost: ws.averageCost,
      })),
    inventoryBatches: [],
    storageLocations: [
      { id: 'loc-01', companyId: seedCid, warehouseId: 'wh-01', code: 'A1-01', zone: 'المنطقة الرئيسية', aisle: 'ممر 1', shelf: 'رف أ', bin: 'خانة 1', isActive: true },
    ],
    stockMovements: stampCompanyId(initialStockMovements, seedCid),
    inventoryTransfers: [],
    stocktakings: [],
    documentBooks: stampCompanyId(defaultDocumentBooks, seedCid),
    warehouseDocuments: stampCompanyId([
      {
        id: 'wdoc-01',
        documentNumber: 'GRN-2026-0001',
        type: 'إذن_توريد',
        date: '2026-01-20',
        warehouseId: 'wh-01',
        beneficiaryOrSupplier: 'شركة الشروق لاستيراد التقنية والإلكترونيات',
        referenceNumber: 'PUR-2026-001',
        reason: 'استلام وتوريد شحنة لابتوبات جديدة',
        items: [
          {
            id: 'wdi-01',
            itemId: 'item-01',
            itemName: 'لابتوب ديل للأعمال Dell Latitude Pro Core-i7',
            unit: 'حبة',
            quantity: 10,
            unitCost: 380000,
            totalCost: 3800000,
            notes: 'تم الفحص الفني والمطابقة بالمستودع المركزي',
          },
        ],
        totalQuantity: 10,
        totalCost: 3800000,
        status: 'posted',
        performedBy: 'فهد العبسي (أمين المستودع)',
        approvedBy: 'م. سامي النهاري',
        notes: 'تم الفحص المخزني ومطابقة الباركود والأرقام التسلسلية',
        createdAt: '2026-01-20T10:00:00Z',
      },
      {
        id: 'wdoc-02',
        documentNumber: 'GIN-2026-0001',
        type: 'إذن_صرف',
        date: '2026-02-10',
        warehouseId: 'wh-01',
        beneficiaryOrSupplier: 'شركة المجد للتجارة العامة والاستيراد',
        referenceNumber: 'INV-2026-001',
        reason: 'صرف بضاعة فاتورة مبيعات',
        items: [
          {
            id: 'wdi-02',
            itemId: 'item-01',
            itemName: 'لابتوب ديل للأعمال Dell Latitude Pro',
            unit: 'حبة',
            quantity: 3,
            unitCost: 380000,
            totalCost: 1140000,
          },
          {
            id: 'wdi-03',
            itemId: 'item-02',
            itemName: 'طابعة إبسون نقطية حرارية للفواتير Epson TM-T88VI',
            unit: 'حبة',
            quantity: 6,
            unitCost: 85000,
            totalCost: 510000,
          },
        ],
        totalQuantity: 9,
        totalCost: 1650000,
        status: 'posted',
        performedBy: 'فهد العبسي (أمين المستودع)',
        approvedBy: 'عصام الشرعبي',
        notes: 'تم تسليم الأجهزة للمندوب بحالة ممتازة',
        createdAt: '2026-02-10T14:30:00Z',
      },
    ], seedCid),
    chartOfAccounts: stampCompanyId(initialChartOfAccounts.map((a) => ({ ...a, isActive: a.isActive !== false })), seedCid),
    costCenters: stampCompanyId(initialCostCenters, seedCid),
    journalEntries: stampCompanyId(initialJournalEntries, seedCid),
    fiscalPeriods: [
      {
        id: `fp-${seedCid}-2026`,
        companyId: seedCid,
        fiscalYear: '2026',
        periodName: 'السنة المالية 2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: 'open',
      },
    ],
    invoices: stampCompanyId(initialInvoices, seedCid),
    commercialOrders: [],
    treasuryAccounts: stampCompanyId(initialTreasuryAccounts, seedCid),
    paymentVouchers: stampCompanyId(initialPaymentVouchers, seedCid),
    treasuryTransfers: [],
    bankReconciliations: [],
    posShifts: [],
    heldPosCarts: [],
    expenseCategories: stampCompanyId(initialExpenseCategories, seedCid),
    expenseRecords: stampCompanyId(initialExpenseRecords, seedCid),
    employees: stampCompanyId(initialEmployees, seedCid),
    payrollRuns: stampCompanyId(initialPayrollRuns, seedCid),
    fixedAssets: stampCompanyId(initialFixedAssets, seedCid),
    customBooks: stampCompanyId(defaultCustomBooks, seedCid),
    customBookEntries: [],
    approvalRules: stampCompanyId(defaultApprovalRules, seedCid),
    approvalRequests: [],
    fxRevaluations: [],
    savedReportDesigns: stampCompanyId(defaultSavedReportDesigns, seedCid),
    savedTableViews: [],
    backupHistory: [],
    backupSchedule: { enabled: false, frequencyHours: 24, encryptByDefault: false },
    dataImportLogs: [],
    processedIdempotencyKeys: [],
    users: initialUsers,
    auditLogs: [
      {
        id: 'log-01',
        companyId: seedCid,
        timestamp: new Date().toISOString(),
        userId: 'usr-01',
        userName: 'عبد الرحمن المنصور (المالك)',
        action: 'تسجيل_دخول',
        module: 'المحاسبة',
        details: 'بدء تشغيل النظام والتحقق من سلامة الأرصدة الافتتاحية والمخزون',
      },
    ],
    taskAlerts: stampCompanyId(initialTaskAlerts, seedCid),
    dispatchLogs: [
      {
        id: 'disp-01',
        companyId: seedCid,
        timestamp: new Date().toISOString(),
        recipientType: 'management',
        recipientName: 'عبد الرحمن المنصور (المدير العام)',
        recipientPhone: '+967 770001111',
        channel: 'whatsapp',
        reportType: 'daily_management',
        status: 'sent',
        details: 'إرسال التقرير الإداري اليومي الشامل للإدارة العليا',
        retryCount: 0,
      },
    ],
    settings: {
      ...initialSystemSettings,
      language: initialSystemSettings.language || 'ar',
      uiPreferences: {
        ...initialSystemSettings.uiPreferences,
        fontSize: initialSystemSettings.uiPreferences?.fontSize ?? 14,
        accentPreset: initialSystemSettings.uiPreferences?.accentPreset ?? 'gold_classic',
        goldColor: initialSystemSettings.uiPreferences?.goldColor || '#F5C748',
        cardColor: initialSystemSettings.uiPreferences?.cardColor || '#101E2E',
        tabsConfig:
          Array.isArray(initialSystemSettings.uiPreferences?.tabsConfig) &&
          initialSystemSettings.uiPreferences.tabsConfig.length > 0
            ? initialSystemSettings.uiPreferences.tabsConfig
            : defaultTabsConfig,
        hiddenModules: Array.isArray(initialSystemSettings.uiPreferences?.hiddenModules)
          ? initialSystemSettings.uiPreferences.hiddenModules
          : [],
        tableColumnPrefs:
          initialSystemSettings.uiPreferences?.tableColumnPrefs || {},
      },
      operationalControl: getDefaultOperationalControl(),
      printTemplates: mergePrintTemplates(initialSystemSettings.printTemplates),
    },
  };
}

function tryWriteSettingsCache(settings: SystemSettings): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const payload = JSON.stringify(settings);
    localStorage.setItem(SETTINGS_CACHE_KEY, payload);
    return localStorage.getItem(SETTINGS_CACHE_KEY) === payload;
  } catch {
    return false;
  }
}

function tryReadSettingsCache(): Partial<SystemSettings> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<SystemSettings>;
  } catch {
    return null;
  }
}

export function loadDatabase(): ERPDatabase {
  try {
    if (typeof localStorage === 'undefined') {
      return getInitialDatabase();
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    const cachedSettings = tryReadSettingsCache();
    if (!raw) {
      const initial = getInitialDatabase();
      if (cachedSettings) {
        return migrateDatabase({
          ...initial,
          settings: { ...initial.settings, ...cachedSettings },
        });
      }
      saveDatabase(initial);
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<ERPDatabase>;
    if (cachedSettings) {
      parsed.settings = { ...(parsed.settings || {}), ...cachedSettings } as SystemSettings;
    }
    return migrateDatabase(parsed);
  } catch (err) {
    console.error('Failed to load database from LocalStorage, falling back to initial data:', err);
    return getInitialDatabase();
  }
}

function shouldSkipFullLocalStorageWrite(data: ERPDatabase): boolean {
  // Heuristic check before running giant JSON.stringify on main thread
  const approxRecords =
    (data.invoices?.length || 0) +
    (data.journalEntries?.length || 0) +
    (data.stockMovements?.length || 0) +
    (data.auditLogs?.length || 0);
  const bannerLen =
    (data.company?.bannerBase64?.length || 0) + (data.company?.logoUrl?.length || 0);
  return approxRecords > 800 || bannerLen > 250_000;
}

export function saveDatabase(data: ERPDatabase): void {
  void saveDatabaseToIDB(data);
  tryWriteSettingsCache(data.settings);
  if (typeof localStorage === 'undefined') return;
  if (shouldSkipFullLocalStorageWrite(data)) return;
  try {
    const serialized = JSON.stringify(data);
    if (serialized.length <= 2_500_000) {
      localStorage.setItem(STORAGE_KEY, serialized);
    }
  } catch (err) {
    console.warn('LocalStorage write skipped, persisted in IndexedDB instead.', err);
  }
}

export async function saveDatabaseVerified(
  data: ERPDatabase,
  hooks?: StorageTestHooks
): Promise<PersistenceResult> {
  if (hooks?.forceFailWrite || activeStorageTestHook?.forceFailWrite) {
    return {
      ok: false,
      backend: 'none',
      verified: false,
      error:
        hooks?.failureMessage ||
        activeStorageTestHook?.failureMessage ||
        'تعذر حفظ التغييرات: وحدة التخزين غير قابلة للكتابة أو محجوزة.',
    };
  }

  let idbOk = false;
  let idbError: string | undefined;

  if (typeof indexedDB !== 'undefined') {
    const idbRes = await saveDatabaseToIDBVerified(data);
    idbOk = idbRes.ok;
    idbError = idbRes.error;
  }

  let lsOk = false;
  let lsError: string | undefined;
  if (typeof localStorage !== 'undefined') {
    try {
      const settingsOk = tryWriteSettingsCache(data.settings);
      if (!shouldSkipFullLocalStorageWrite(data)) {
        const serialized = JSON.stringify(data);
        localStorage.setItem(STORAGE_KEY, serialized);
        lsOk = settingsOk && localStorage.getItem(STORAGE_KEY) !== null;
      } else {
        lsOk = settingsOk;
      }
    } catch (err) {
      lsError = err instanceof Error ? err.message : 'LocalStorage quota exceeded';
      lsOk = tryWriteSettingsCache(data.settings);
    }
  }

  if (idbOk && lsOk) {
    return { ok: true, backend: 'both', verified: true };
  }
  if (idbOk) {
    return { ok: true, backend: 'idb', verified: true };
  }
  if (lsOk) {
    return { ok: true, backend: 'localStorage', verified: true };
  }

  return {
    ok: false,
    backend: 'none',
    verified: false,
    error: idbError || lsError || 'تعذر حفظ البيانات في أي وحدة تخزين محلية.',
  };
}

/**
 * Same-browser Concurrency & Optimistic Revision Control:
 * Note: navigator.locks + BroadcastChannel protect concurrent tabs/windows in the same browser profile.
 * True multi-user/multi-device distributed concurrency requires a central PostgreSQL backend (Stage P2 plan).
 */
const SYNC_CHANNEL_NAME = 'almansoor_erp_sync_channel_v1';
const DB_WRITE_LOCK_NAME = 'almansoor_erp_db_write_lock_v1';
const CURRENT_TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}`;
let inProcessWriteQueue: Promise<unknown> = Promise.resolve();

async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    return navigator.locks.request(DB_WRITE_LOCK_NAME, async () => fn());
  }
  const next = inProcessWriteQueue.then(fn, fn);
  inProcessWriteQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function commitRevisionCheck(
  storedRevision: number | undefined,
  nextDb: ERPDatabase,
  expectedRevision?: number
): { ok: true; nextDb: ERPDatabase } | { ok: false; conflict: true; serverRevision: number; error: string } {
  const baseStoredRev = storedRevision ?? 0;
  if (expectedRevision !== undefined && baseStoredRev > expectedRevision) {
    return {
      ok: false,
      conflict: true,
      serverRevision: baseStoredRev,
      error: `تعارض تزامن البيانات: تم حفظ نسخة أحدث (${baseStoredRev}) من تبويب آخر قبل إتمام عملية التحديث الحالية (${expectedRevision}).`,
    };
  }
  const nextRevision = Math.max(baseStoredRev, nextDb.revision ?? 0) + 1;
  return {
    ok: true,
    nextDb: {
      ...nextDb,
      revision: nextRevision,
    },
  };
}

function broadcastDbSync(revision: number, sourceTabId = CURRENT_TAB_ID): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
    ch.postMessage({ type: 'db_updated', revision, sourceTabId, timestamp: Date.now() });
    ch.close();
  } catch {
    // ignore environments restricting BroadcastChannel
  }
}

export function subscribeDatabaseSync(
  onRemoteSync: (payload: { revision: number; sourceTabId: string; latestDb: ERPDatabase }) => void
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(SYNC_CHANNEL_NAME);
    ch.onmessage = async (ev: MessageEvent<{ type?: string; revision?: number; sourceTabId?: string }>) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'db_updated' || msg.sourceTabId === CURRENT_TAB_ID) return;
      const latestIdb = typeof indexedDB !== 'undefined' ? await loadDatabaseFromIDB() : null;
      const latestDb = latestIdb || loadDatabase();
      onRemoteSync({
        revision: msg.revision || latestDb.revision || 1,
        sourceTabId: msg.sourceTabId || '',
        latestDb,
      });
    };
  } catch {
    return () => {};
  }
  return () => {
    try {
      ch?.close();
    } catch {
      // ignore
    }
  };
}

export async function saveDatabaseAtomicWithLock(
  nextDb: ERPDatabase,
  options?: { expectedRevision?: number; sourceTabId?: string }
): Promise<{
  ok: boolean;
  savedDb?: ERPDatabase;
  conflict?: boolean;
  serverRevision?: number;
  error?: string;
}> {
  return withWriteLock(async () => {
    let storedRevision: number | undefined;
    if (typeof indexedDB !== 'undefined') {
      const idbLatest = await loadDatabaseFromIDB();
      if (idbLatest?.revision !== undefined) {
        storedRevision = idbLatest.revision;
      }
    }
    if (storedRevision === undefined && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<ERPDatabase>;
          if (typeof parsed.revision === 'number') {
            storedRevision = parsed.revision;
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    const revCheck = commitRevisionCheck(storedRevision, nextDb, options?.expectedRevision);
    if (!revCheck.ok) {
      return revCheck;
    }

    const writeRes = await saveDatabaseVerified(revCheck.nextDb);
    if (!writeRes.ok) {
      return { ok: false, error: writeRes.error || 'تعذر تثبيت قاعدة البيانات.' };
    }
    broadcastDbSync(revCheck.nextDb.revision || 1, options?.sourceTabId || CURRENT_TAB_ID);
    return { ok: true, savedDb: revCheck.nextDb };
  });
}

let pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSavePayload: ERPDatabase | null = null;

export function saveDatabaseDebounced(data: ERPDatabase, delayMs = 450): void {
  pendingSavePayload = data;
  if (pendingSaveTimer !== null) {
    clearTimeout(pendingSaveTimer);
  }
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    if (pendingSavePayload) {
      const payload = pendingSavePayload;
      pendingSavePayload = null;
      saveDatabase(payload);
    }
  }, delayMs);
}

export function flushPendingDatabaseSave(): void {
  if (pendingSaveTimer !== null) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (pendingSavePayload) {
    const payload = pendingSavePayload;
    pendingSavePayload = null;
    saveDatabase(payload);
  }
}

export function resetToDemoDatabase(): ERPDatabase {
  const initial = getInitialDatabase();
  void clearDatabaseIDB();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(SETTINGS_CACHE_KEY);
    } catch {
      // ignore
    }
  }
  saveDatabase(initial);
  return initial;
}

export function exportDatabaseBackup(db: ERPDatabase): void {
  const payload: ERPDatabase = {
    ...db,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
  const jsonStr = JSON.stringify(payload);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().split('T')[0];
  a.download = `almansoor-erp-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Multi-tenant active company switcher preserving shared catalog/isolation cleanly.
 */
export function switchActiveCompanyInDb(
  db: ERPDatabase,
  targetCompanyId: string
): ERPDatabase {
  const companies = db.companies || [db.company];
  const target = companies.find((c) => c.id === targetCompanyId);
  if (!target) return db;

  const updatedCompanies = companies.map((c) =>
    c.id === db.company.id ? { ...db.company, isActive: true } : c
  );

  return {
    ...db,
    company: target,
    companies: updatedCompanies,
    activeCompanyId: target.id,
  };
}

/**
 * Pure read-projection isolating all operational, financial, and reporting records strictly to one companyId.
 * Zero records belonging to any other company leak into queries, reports, dashboards, or global search.
 */
export function scopeDatabaseToCompany(
  db: ERPDatabase,
  companyId?: string
): ERPDatabase {
  const targetId = companyId || db.activeCompanyId || db.company.id;
  const companies = db.companies || [db.company];
  const resolvedCompany =
    companies.find((c) => c.id === targetId) || db.company;
  const filterByCompany = <T extends { companyId?: string }>(items?: T[]): T[] =>
    (items || []).filter((item) => item.companyId === targetId);

  const companyAccounts = filterByCompany(db.chartOfAccounts);
  const isolatedAccounts =
    companyAccounts.length > 0
      ? companyAccounts
      : (db.chartOfAccounts || [])
          .filter((a) => a.isSystemAccount || a.companyId === db.company.id)
          .slice(0, initialChartOfAccounts.length)
          .map((a) => ({
            ...a,
            companyId: targetId,
            currentBalance: 0,
            importedDebit: 0,
            importedCredit: 0,
          }));

  return {
    ...db,
    company: resolvedCompany,
    activeCompanyId: targetId,
    branches: filterByCompany(db.branches),
    warehouses: filterByCompany(db.warehouses),
    departments: filterByCompany(db.departments),
    customers: filterByCompany(db.customers),
    vendors: filterByCompany(db.vendors),
    inventoryItems: filterByCompany(db.inventoryItems),
    warehouseStock: filterByCompany(db.warehouseStock),
    stockCostLayers: filterByCompany(db.stockCostLayers),
    inventoryBatches: filterByCompany(db.inventoryBatches),
    storageLocations: filterByCompany(db.storageLocations),
    stockMovements: filterByCompany(db.stockMovements),
    inventoryTransfers: filterByCompany(db.inventoryTransfers),
    stocktakings: filterByCompany(db.stocktakings),
    warehouseDocuments: filterByCompany(db.warehouseDocuments),
    documentBooks: filterByCompany(db.documentBooks),
    chartOfAccounts: isolatedAccounts,
    costCenters: filterByCompany(db.costCenters),
    journalEntries: filterByCompany(db.journalEntries),
    fiscalPeriods: filterByCompany(db.fiscalPeriods),
    invoices: filterByCompany(db.invoices),
    commercialOrders: filterByCompany(db.commercialOrders),
    treasuryAccounts: filterByCompany(db.treasuryAccounts),
    paymentVouchers: filterByCompany(db.paymentVouchers),
    treasuryTransfers: filterByCompany(db.treasuryTransfers),
    bankReconciliations: filterByCompany(db.bankReconciliations),
    posShifts: filterByCompany(db.posShifts),
    heldPosCarts: filterByCompany(db.heldPosCarts),
    expenseCategories: filterByCompany(db.expenseCategories),
    expenseRecords: filterByCompany(db.expenseRecords),
    employees: filterByCompany(db.employees),
    payrollRuns: filterByCompany(db.payrollRuns),
    fixedAssets: filterByCompany(db.fixedAssets),
    customBooks: filterByCompany(db.customBooks),
    customBookEntries: filterByCompany(db.customBookEntries),
    approvalRules: filterByCompany(db.approvalRules),
    approvalRequests: filterByCompany(db.approvalRequests),
    fxRevaluations: filterByCompany(db.fxRevaluations),
    savedReportDesigns: filterByCompany(db.savedReportDesigns),
    auditLogs: filterByCompany(db.auditLogs),
    taskAlerts: filterByCompany(db.taskAlerts),
    dispatchLogs: filterByCompany(db.dispatchLogs),
  };
}

/**
 * Multi-tenant projection across ALL companies explicitly authorized for the given user.
 * Fails closed: empty/missing allowedCompanyIds or inactive users receive zero tenant records.
 * Used for backup export, audit logs, and user management views to prevent cross-company leakage.
 */
export function filterDatabaseForUserTenants(
  db: ERPDatabase,
  user: User | null | undefined
): ERPDatabase {
  const allowedIds =
    user && user.active && Array.isArray(user.allowedCompanyIds)
      ? user.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
      : [];
  const allowedSet = new Set(allowedIds);
  const filterAllowed = <T extends { companyId?: string }>(items?: T[]): T[] =>
    allowedSet.size === 0
      ? []
      : (items || []).filter((item) => Boolean(item.companyId && allowedSet.has(item.companyId)));

  const allCompanies = db.companies && db.companies.length > 0 ? db.companies : [db.company];
  const authorizedCompanies = allCompanies.filter((c) => allowedSet.has(c.id));
  const resolvedActiveCompany =
    authorizedCompanies.find((c) => c.id === (db.activeCompanyId || db.company.id)) ||
    authorizedCompanies[0] || {
      ...db.company,
      id: '__UNAUTHORIZED__',
      nameAr: 'غير مصرح بالوصول',
      nameEn: 'Unauthorized',
    };

  const filteredUsers =
    allowedSet.size === 0
      ? []
      : (db.users || []).filter(
          (u) =>
            Array.isArray(u.allowedCompanyIds) &&
            u.allowedCompanyIds.some((cid) => allowedSet.has(String(cid).trim()))
        );

  return {
    ...db,
    company: resolvedActiveCompany,
    companies: authorizedCompanies,
    activeCompanyId: resolvedActiveCompany.id,
    branches: filterAllowed(db.branches),
    warehouses: filterAllowed(db.warehouses),
    departments: filterAllowed(db.departments),
    customers: filterAllowed(db.customers),
    vendors: filterAllowed(db.vendors),
    inventoryItems: filterAllowed(db.inventoryItems),
    warehouseStock: filterAllowed(db.warehouseStock),
    stockCostLayers: filterAllowed(db.stockCostLayers),
    inventoryBatches: filterAllowed(db.inventoryBatches),
    storageLocations: filterAllowed(db.storageLocations),
    stockMovements: filterAllowed(db.stockMovements),
    inventoryTransfers: filterAllowed(db.inventoryTransfers),
    stocktakings: filterAllowed(db.stocktakings),
    warehouseDocuments: filterAllowed(db.warehouseDocuments),
    documentBooks: filterAllowed(db.documentBooks),
    chartOfAccounts: filterAllowed(db.chartOfAccounts),
    costCenters: filterAllowed(db.costCenters),
    journalEntries: filterAllowed(db.journalEntries),
    fiscalPeriods: filterAllowed(db.fiscalPeriods),
    invoices: filterAllowed(db.invoices),
    commercialOrders: filterAllowed(db.commercialOrders),
    treasuryAccounts: filterAllowed(db.treasuryAccounts),
    paymentVouchers: filterAllowed(db.paymentVouchers),
    treasuryTransfers: filterAllowed(db.treasuryTransfers),
    bankReconciliations: filterAllowed(db.bankReconciliations),
    posShifts: filterAllowed(db.posShifts),
    heldPosCarts: filterAllowed(db.heldPosCarts),
    expenseCategories: filterAllowed(db.expenseCategories),
    expenseRecords: filterAllowed(db.expenseRecords),
    employees: filterAllowed(db.employees),
    payrollRuns: filterAllowed(db.payrollRuns),
    fixedAssets: filterAllowed(db.fixedAssets),
    customBooks: filterAllowed(db.customBooks),
    customBookEntries: filterAllowed(db.customBookEntries),
    approvalRules: filterAllowed(db.approvalRules),
    approvalRequests: filterAllowed(db.approvalRequests),
    fxRevaluations: filterAllowed(db.fxRevaluations),
    savedReportDesigns: filterAllowed(db.savedReportDesigns),
    users: filteredUsers,
    auditLogs: filterAllowed(db.auditLogs),
    taskAlerts: filterAllowed(db.taskAlerts),
    dispatchLogs: filterAllowed(db.dispatchLogs),
  };
}

/**
 * WebCrypto AES-GCM Backup Encryption & Decryption (.json.enc)
 */
async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    let chunk = '';
    for (let j = 0; j < slice.length; j++) {
      chunk += String.fromCharCode(slice[j]);
    }
    parts.push(chunk);
  }
  return btoa(parts.join(''));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function encryptBackupPayload(db: ERPDatabase, passphrase: string): Promise<string> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('كلمة مرور التشفير يجب أن تكون 4 أحرف على الأقل.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...db, schemaVersion: CURRENT_SCHEMA_VERSION }));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return JSON.stringify({
    encryptedFormat: 'ALMANSOOR_ERP_AES256_GCM_V1',
    createdAt: new Date().toISOString(),
    salt: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(new Uint8Array(cipherBuffer)),
  });
}

export async function decryptBackupPayload(rawText: string, passphrase: string): Promise<string> {
  if (!passphrase) {
    throw new Error('يجب إدخال كلمة مرور فك التشفير.');
  }
  const envelope = JSON.parse(rawText) as {
    encryptedFormat?: string;
    salt?: string;
    iv?: string;
    ciphertext?: string;
  };
  if (envelope.encryptedFormat !== 'ALMANSOOR_ERP_AES256_GCM_V1' || !envelope.salt || !envelope.iv || !envelope.ciphertext) {
    throw new Error('ملف النسخة الاحتياطية لا يطابق صيغة التشفير المعتمدة.');
  }
  const salt = base64ToUint8(envelope.salt);
  const iv = base64ToUint8(envelope.iv);
  const cipher = base64ToUint8(envelope.ciphertext);
  const key = await deriveAesKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    cipher as BufferSource
  );
  return new TextDecoder().decode(decrypted);
}
