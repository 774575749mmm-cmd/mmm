/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Data Models & Types
 */

export type CurrencyCode = 'YER' | 'USD' | 'SAR' | (string & {});

export interface Currency {
  code: CurrencyCode;
  nameAr: string;
  symbol: string;
  exchangeRate: number; // Against base currency (YER)
  isBase: boolean;
  decimalPlaces: number;
}

export type CountryPackCode = 'YE' | 'SA' | 'AE' | 'KW' | 'QA' | 'BH' | 'OM';

export interface Company {
  id: string;
  nameAr: string;
  nameEn: string;
  commercialRecord: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  logoUrl?: string;
  bannerBase64?: string;
  useFullBanner?: boolean;
  invoiceFooterNote?: string;
  baseCurrency: CurrencyCode;
  countryCode?: CountryPackCode;
  isActive?: boolean;
  fiscalYearStart?: string;
  valuationPolicy?: 'FIFO' | 'WEIGHTED_AVERAGE' | 'PER_ITEM';
  subscriptionPlan?: 'standard' | 'enterprise';
  createdAt?: string;
}

export interface Branch {
  id: string;
  companyId: string;
  code: string;
  nameAr: string;
  phone: string;
  address: string;
  managerName: string;
  isMain: boolean;
  status: 'active' | 'inactive';
}

export interface Warehouse {
  id: string;
  companyId?: string;
  branchId: string;
  code: string;
  nameAr: string;
  location: string;
  keeperName: string;
  status: 'active' | 'inactive';
}

// Regional Hierarchy: الدولة -> المحافظة -> المديرية -> المنطقة -> الحي
export interface RegionalArea {
  id: string;
  country: string;
  governorate: string; // المحافظة
  district: string;    // المديرية
  area: string;        // المنطقة
  neighborhood?: string; // الحي أو الشارع
  code: string;
}

export interface Customer {
  id: string;
  companyId?: string;
  branchId: string;
  code: string;
  nameAr: string;
  commercialName?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  taxNumber?: string;
  commercialRecord?: string;
  // Regional linking
  regionalAreaId: string;
  addressDetails: string;
  category: 'تجاري' | 'جملة' | 'تجزئة' | 'VIP' | 'حكومي';
  creditLimit: number;
  paymentTermDays: number;
  salesRepId?: string;
  salesRepName?: string;
  openingBalance: number; // positive = debit (مدين لنا), negative = credit (دائن له)
  currentBalance: number;
  currency?: CurrencyCode;
  linkedAccountId?: string;
  linkedAccountCode?: string;
  status: 'active' | 'inactive' | 'blocked';
  notes?: string;
  createdAt: string;
}

export interface Vendor {
  id: string;
  companyId?: string;
  branchId: string;
  code: string;
  nameAr: string;
  commercialName?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  taxNumber?: string;
  address: string;
  category: 'مورد رئيسي' | 'محلي' | 'خارجي' | 'خدمات';
  openingBalance: number; // positive = credit (دائن علينا), negative = debit
  currentBalance: number;
  currency?: CurrencyCode;
  linkedAccountId?: string;
  linkedAccountCode?: string;
  paymentTermDays: number;
  status: 'active' | 'inactive';
  notes?: string;
  createdAt: string;
}

export interface UnitOfMeasure {
  id: string;
  nameAr: string;
  symbolAr: string;
  isBase: boolean;
  factorToBase: number; // e.g. Box = 24 Pieces -> factor = 24
}

export interface InventoryItem {
  id: string;
  companyId?: string;
  code: string;
  barcode: string;
  nameAr: string;
  nameEn?: string;
  category: string;
  departmentName?: string;
  baseUnit: string; // e.g. 'حبة'
  secondaryUnit?: string; // e.g. 'كرتون'
  unitConversionFactor?: number; // secondary to base, e.g. 12
  purchasePrice: number;
  salePrice: number;
  wholesalePrice: number;
  minSalePrice: number;
  minQuantityAlert: number;
  maxQuantity: number;
  valuationMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
  taxRate: number; // e.g. 0.05 or 0.15 or 0
  trackBatches?: boolean;
  hasExpiry?: boolean;
  status: 'active' | 'inactive';
  description?: string;
  createdAt: string;
}

export interface StorageLocation {
  id: string;
  companyId?: string;
  warehouseId: string;
  code: string;
  zone: string;
  aisle?: string;
  shelf?: string;
  bin?: string;
  description?: string;
  isActive: boolean;
}

export interface InventoryBatch {
  id: string;
  companyId?: string;
  itemId: string;
  warehouseId: string;
  batchNumber: string;
  manufactureDate?: string;
  expiryDate?: string;
  quantityRemaining: number;
  unitCost: number;
  storageLocationId?: string;
  receivedDate: string;
  sourceDocId?: string;
}

export interface StockCostLayer {
  id: string;
  companyId?: string;
  itemId: string;
  warehouseId: string;
  batchNumber?: string;
  expiryDate?: string;
  receivedDate: string;
  sourceDocType: string;
  sourceDocId: string;
  sourceDocNumber: string;
  originalQuantity: number;
  remainingQuantity: number;
  unitCost: number;
}

export interface ItemWarehouseStock {
  companyId?: string;
  itemId: string;
  warehouseId: string;
  quantityOnHand: number;
  reservedQuantity?: number;
  averageCost: number;
  storageLocationId?: string;
}

export interface StockMovement {
  id: string;
  companyId?: string;
  itemId: string;
  warehouseId: string;
  documentType: 'فاتورة_مبيعات' | 'فاتورة_مشتريات' | 'مرتجع_مبيعات' | 'مرتجع_مشتريات' | 'تحويل_مخزني_صرف' | 'تحويل_مخزني_استلام' | 'تسوية_زيادة' | 'تسوية_عجز' | 'رصيد_افتتاحي';
  documentNumber: string;
  documentId: string;
  movementDate: string;
  quantityChange: number; // positive or negative
  unitCost: number;
  totalCost: number;
  runningBalance: number;
  batchNumber?: string;
  expiryDate?: string;
  notes?: string;
  performedBy: string;
}

export type TransferStatus = 
  | 'draft' 
  | 'pending_approval' 
  | 'dispatched' 
  | 'in_transit' 
  | 'received' 
  | 'completed' 
  | 'cancelled';

export interface InventoryTransferItem {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
}

export interface InventoryTransfer {
  id: string;
  companyId?: string;
  transferNumber: string;
  date: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: InventoryTransferItem[];
  status: TransferStatus;
  notes?: string;
  performedBy: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  receivedAt?: string;
  receivedBy?: string;
}

export interface StocktakingItem {
  itemId: string;
  itemName: string;
  barcode?: string;
  category?: string;
  unit: string;
  warehouseId?: string;
  warehouseName?: string;
  bookQuantity: number;
  physicalQuantity: number;
  difference: number; // physical - book
  unitCost: number;
  totalDifferenceValue: number;
  notes?: string;
}

export type StocktakingScope = 'single_item' | 'category' | 'warehouse' | 'multi_warehouse';
export type StocktakingStatus = 'draft' | 'counting' | 'review' | 'approved' | 'cancelled';

export interface PhysicalStocktaking {
  id: string;
  companyId?: string;
  stocktakeNumber: string;
  warehouseId: string;
  warehouseIds?: string[];
  scope: StocktakingScope;
  targetCategory?: string;
  targetItemId?: string;
  date: string;
  items: StocktakingItem[];
  status: StocktakingStatus;
  notes?: string;
  conductedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  adjustmentJournalEntryId?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Warehouse Documents
export type WarehouseDocType =
  | 'إذن_توريد'
  | 'إذن_صرف'
  | 'إذن_استلام'
  | 'إذن_تحويل'
  | 'طلب_مناقلة'
  | 'إذن_مرتجع_مخزني'
  | 'إذن_تسوية_زيادة'
  | 'إذن_تسوية_عجز'
  | 'محضر_جرد'
  | 'محضر_تلف';

export interface WarehouseDocItem {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  notes?: string;
}

export interface WarehouseDocument {
  id: string;
  companyId?: string;
  documentNumber: string;
  type: WarehouseDocType;
  date: string;
  warehouseId: string;
  destWarehouseId?: string;
  beneficiaryOrSupplier: string;
  referenceNumber?: string;
  reason?: string;
  items: WarehouseDocItem[];
  totalQuantity: number;
  totalCost: number;
  status: 'draft' | 'posted' | 'cancelled';
  performedBy: string;
  approvedBy?: string;
  notes?: string;
  createdAt: string;
}

// Batch Voucher Row
export interface BatchVoucherRow {
  rowId: string;
  type: 'قبض' | 'صرف';
  entityType: 'عميل' | 'مورد' | 'موظف' | 'مصروف' | 'إيراد' | 'أخرى';
  entityId?: string;
  entityName: string;
  statement: string;
  treasuryAccountId: string;
  amount: number;
  currency: CurrencyCode;
  date: string;
  paymentMethod: 'نقداً' | 'شيك' | 'تحويل_بنكي' | 'دفع_إلكتروني';
  checkOrTransferRef?: string;
  linkedInvoiceIds?: string[];
  allocationNotes?: string;
}

// Scheduled Dispatch & Daily Management Models
export interface DispatchLogEntry {
  id: string;
  companyId?: string;
  timestamp: string;
  recipientType: 'customer' | 'management' | 'vendor';
  recipientName: string;
  recipientPhone: string;
  channel: 'whatsapp' | 'email' | 'direct_download';
  reportType: 'daily_management' | 'customer_eod_statement' | 'invoice_immediate' | 'daily_sales';
  status: 'sent' | 'pending' | 'failed';
  details: string;
  errorMessage?: string;
  retryCount: number;
}

// Accounting
export type AccountCategory = 'أصول' | 'خصوم' | 'حقوق_ملكية' | 'إيرادات' | 'مصروفات';
export type AccountNature = 'debit' | 'credit';

export interface Account {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  category: AccountCategory;
  nature: AccountNature;
  currency?: CurrencyCode;
  parentCode?: string;
  level: number;
  isLeaf: boolean; // Only leaf accounts can accept journal entries
  isActive?: boolean;
  currentBalance: number;
  importedDebit?: number;
  importedCredit?: number;
  isSystemAccount?: boolean;
}

export interface CostCenter {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  status: 'active' | 'inactive';
}

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  currency: CurrencyCode;
  exchangeRate: number;
  costCenterId?: string;
  costCenterName?: string;
  projectId?: string;
  projectName?: string;
  memo: string;
}

export type JournalEntryKind =
  | 'normal'
  | 'opening'
  | 'adjusting'
  | 'closing'
  | 'reversal'
  | 'revaluation';

export interface JournalEntry {
  id: string;
  companyId?: string;
  entryNumber: string;
  date: string;
  branchId: string;
  referenceType:
    | 'دليل_يدوي'
    | 'فاتورة_مبيعات'
    | 'فاتورة_مشتريات'
    | 'سند_قبض'
    | 'سند_صرف'
    | 'تحويل_نقدية'
    | 'رواتب'
    | 'إهلاك'
    | 'تسوية_مخزنية'
    | 'مرتجع'
    | 'إقفال_سنوي'
    | 'إعادة_تقييم_عملة'
    | 'استبعاد_أصل'
    | 'إشعار_دائن_مدين';
  referenceNumber: string;
  referenceId?: string;
  entryType?: JournalEntryKind;
  fiscalPeriodId?: string;
  idempotencyKey?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  description: string;
  lines: JournalEntryLine[];
  totalDebit: number;
  totalCredit: number;
  status: 'posted' | 'reversed';
  reversedEntryId?: string;
  createdBy: string;
  createdAt: string;
}

// Invoices (Sales & Purchases)
export interface InvoiceItem {
  id: string;
  itemId: string;
  itemName: string;
  itemBarcode: string;
  unit: string;
  quantity: number;
  bonusQuantity?: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  subtotal: number;
  taxPercentage: number;
  taxAmount: number;
  total: number;
  unitCost: number; // for COGS calculation in sales
  batchNumber?: string;
  expiryDate?: string;
  storageLocationId?: string;
  notes?: string;
}

export interface Invoice {
  id: string;
  companyId?: string;
  invoiceNumber: string;
  type: 'مبيعات' | 'مشتريات' | 'مرتجع_مبيعات' | 'مرتجع_مشتريات';
  paymentType: 'نقدي' | 'آجل' | 'جزئي';
  date: string;
  dueDate?: string;
  branchId: string;
  warehouseId: string;
  entityId: string; // customerId or vendorId
  entityName: string;
  currency: CurrencyCode;
  exchangeRate: number;
  items: InvoiceItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  paidAmount: number;
  remainingAmount: number;
  previousBalanceSnapshot?: number;
  newBalanceSnapshot?: number;
  paymentMethod?: 'صندوق' | 'بنك' | 'محفظة' | 'متعدد';
  treasuryAccountId?: string;
  status: 'draft' | 'posted' | 'paid' | 'partial' | 'cancelled';
  bookId?: string;
  journalEntryId?: string;
  sourceOrderId?: string;
  idempotencyKey?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  salesRepId?: string;
  salesRepName?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

// Treasury: Cash, Bank, Wallet
export type TreasuryType = 'صندوق' | 'بنك' | 'محفظة';

export interface TreasuryAccount {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  type: TreasuryType;
  categoryGroup?: 'CASH_BOX' | 'EXCHANGE';
  currency: CurrencyCode;
  accountNumber?: string;
  branchId: string;
  generalLedgerAccountId: string; // linked to COA
  balance: number;
  status: 'active' | 'inactive';
}

export interface PaymentVoucher {
  id: string;
  companyId?: string;
  voucherNumber: string;
  batchId?: string;
  bookId?: string;
  type: 'قبض' | 'صرف'; // Receipt (قبض) or Disbursement (صرف)
  isAdvancePayment?: boolean;
  date: string;
  branchId: string;
  treasuryAccountId: string;
  treasuryAccountName: string;
  entityType: 'عميل' | 'مورد' | 'موظف' | 'مصروف' | 'إيراد' | 'أخرى';
  entityId?: string;
  entityName: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRate: number;
  baseAmount: number; // amount * exchangeRate
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
  linkedInvoiceIds?: string[];
  linkedAllocations?: Array<{
    invoiceId: string;
    invoiceNumber?: string;
    settledAmountNative: number;
    settledAmountBase: number;
  }>;
  costCenterId?: string;
  paymentMethod: 'نقداً' | 'شيك' | 'تحويل_بنكي' | 'دفع_إلكتروني';
  checkNumber?: string;
  transferReference?: string;
  statement: string; // البيان
  journalEntryId?: string;
  idempotencyKey?: string;
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  status: 'posted' | 'cancelled';
  receivedOrPaidBy: string;
  createdBy: string;
  createdAt: string;
}

export interface TreasuryTransfer {
  id: string;
  companyId?: string;
  transferNumber: string;
  date: string;
  fromTreasuryId: string;
  toTreasuryId: string;
  amount: number;
  currency: CurrencyCode;
  feeAmount: number;
  notes?: string;
  journalEntryId?: string;
  idempotencyKey?: string;
  createdBy: string;
}

// Expenses
export interface ExpenseCategory {
  id: string;
  companyId?: string;
  nameAr: string;
  ledgerAccountId: string; // linked to 5x expenses in COA
}

export interface ExpenseRecord {
  id: string;
  companyId?: string;
  expenseNumber: string;
  date: string;
  branchId: string;
  categoryId: string;
  categoryName: string;
  treasuryAccountId: string;
  treasuryAccountName: string;
  costCenterId?: string;
  costCenterName?: string;
  amount: number;
  currency: CurrencyCode;
  taxAmount: number;
  total: number;
  beneficiary: string;
  statement: string;
  journalEntryId?: string;
  createdBy: string;
}

// HR & Payroll
export interface Employee {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  jobTitle: string;
  department: string;
  phone: string;
  nationalId: string;
  hireDate: string;
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowances: number;
  bankAccountNumber?: string;
  status: 'active' | 'on_leave' | 'terminated';
  currentLoanBalance: number;
}

export interface PayrollRunItem {
  employeeId: string;
  employeeName: string;
  basicSalary: number;
  totalAllowances: number;
  grossSalary: number;
  loanDeduction: number;
  taxOrSocialDeductions: number;
  otherDeductions: number;
  netSalary: number;
}

export interface PayrollRun {
  id: string;
  companyId?: string;
  payrollNumber: string;
  month: string; // e.g. '2026-03'
  branchId: string;
  disbursementTreasuryId: string;
  items: PayrollRunItem[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  status: 'draft' | 'approved' | 'disbursed';
  disbursedDate?: string;
  journalEntryId?: string;
  createdBy: string;
}

// Fixed Assets
export interface FixedAsset {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  category: 'مباني' | 'أجهزة_إلكترونية' | 'سيارات_ونقليات' | 'أثاث_ومفروشات' | 'معدات';
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number; // القيمة التخريدية
  usefulLifeMonths: number; // العمر الإنتاجي بالأشهر
  depreciationMethod: 'STRAIGHT_LINE';
  assetAccountId: string; // in COA (12x)
  accumulatedDepreciationAccountId: string; // in COA (123)
  depreciationExpenseAccountId: string; // in COA (55)
  currentBookValue: number;
  totalAccumulatedDepreciation: number;
  disposalDate?: string;
  disposalProceeds?: number;
  disposalJournalEntryId?: string;
  status: 'active' | 'disposed' | 'maintenance';
}

// Security, RBAC & Audit
export type UserRoleType = 
  | 'مالك المؤسسة' 
  | 'مدير النظام' 
  | 'المدير المالي' 
  | 'محاسب' 
  | 'أمين الصندوق' 
  | 'مسؤول المخزون' 
  | 'مسؤول المبيعات' 
  | 'مسؤول المشتريات'
  | 'مستخدم محدود';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'post'
  | 'approve'
  | 'export'
  | 'print'
  | 'manageSettings'
  | 'viewCosts';

export type GranularPermissionMatrix = Record<string, Partial<Record<PermissionAction, boolean>>>;

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRoleType;
  branchId: string;
  allowedCompanyIds?: string[];
  email: string;
  active: boolean;
  passwordHash?: string;
  passwordSalt?: string;
  mustChangePassword?: boolean;
  canViewReports: boolean;
  canPostEntries: boolean;
  canAdjustInventory: boolean;
  canViewCostsAndProfits: boolean;
  canManageSettings: boolean;
  canEditInvoices?: boolean;
  canDeleteInvoices?: boolean;
  canEditVouchers?: boolean;
  canDeleteVouchers?: boolean;
  canEditExchangeRates?: boolean;
  permissionMatrix?: GranularPermissionMatrix;
}

export interface AuditLogEntry {
  id: string;
  companyId?: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: 'إنشاء' | 'تعديل' | 'ترحيل' | 'إلغاء' | 'حذف' | 'تسجيل_دخول' | 'تصدير' | 'طباعة' | 'إعادة_ضبط' | 'موافقة' | 'رفض' | 'إقفال';
  module: 'المبيعات' | 'المشتريات' | 'المخزون' | 'العملاء' | 'الموردين' | 'المحاسبة' | 'الخزينة' | 'المصروفات' | 'الرواتب' | 'الأصول' | 'الإعدادات' | 'النظام';
  details: string;
  entityId?: string;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  reason?: string;
  ipAddress?: string;
}

export interface TaskAlert {
  id: string;
  companyId?: string;
  title: string;
  type: 'مديونية_متأخرة' | 'مخزون_منخفض' | 'فاتورة_مستحقة' | 'مهمة_عمل' | 'إشعار_نظام';
  severity: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: string;
  assignedTo?: string;
  isRead: boolean;
  isCompleted: boolean;
  linkModule?: string;
  linkId?: string;
  createdAt: string;
}

export interface WhatsAppTemplates {
  invoice: string;
  voucher: string;
  statement: string;
  overdueReminder: string;
  paymentConfirmation: string;
  dailySummary: string;
}

export interface TableColumnPref {
  key: string;
  label: string;
  visible: boolean;
  order: number;
  width?: number;
  pin?: 'none' | 'right' | 'left';
  align?: 'right' | 'center' | 'left';
}

export interface TabVisibilityConfig {
  id: string;
  label: string;
  visible: boolean;
  order?: number;
}

export interface UIPreferences {
  fontSize: number; // 11 - 22
  accentPreset: 'amber' | 'gold_classic' | 'bronze_gold';
  goldColor?: string;
  cardColor?: string;
  hiddenModules: string[];
  tabsConfig?: TabVisibilityConfig[];
  tableColumnPrefs: Record<string, TableColumnPref[]>;
}

// Phase 2 Operational Control Center, Fiscal, Commercial, POS, Reporting, Compliance & Integrity Types
export interface CountryCompliancePack {
  code: CountryPackCode;
  nameAr: string;
  nameEn: string;
  baseCurrency: CurrencyCode;
  currencyNameAr: string;
  currencySymbol: string;
  defaultExchangeRates: Array<{ code: CurrencyCode; nameAr: string; symbol: string; exchangeRate: number; decimalPlaces: number }>;
  defaultTaxRate: number;
  enableTaxByDefault: boolean;
  taxLabelAr: string;
  calendarType: 'gregorian' | 'hijri_gregorian';
  dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY';
  mandatoryInvoiceFields: string[];
  requiresTaxQrMetadata: boolean;
  defaultCoaPreset: Array<{ code: string; nameAr: string; category: AccountCategory; nature: AccountNature; parentCode?: string; level: number; isLeaf: boolean }>;
  complianceNoticeAr: string;
}

export interface FiscalPeriod {
  id: string;
  companyId: string;
  fiscalYear: string;
  periodName: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed' | 'locked';
  closedAt?: string;
  closedBy?: string;
  closingJournalEntryId?: string;
}

export type CommercialOrderType =
  | 'عرض_سعر'
  | 'أمر_بيع'
  | 'طلب_شراء'
  | 'أمر_شراء'
  | 'استلام_بضاعة'
  | 'إشعار_دائن'
  | 'إشعار_مدين';

export interface CommercialOrder {
  id: string;
  companyId?: string;
  orderNumber: string;
  orderType: CommercialOrderType;
  date: string;
  validUntil?: string;
  branchId: string;
  warehouseId: string;
  entityId: string;
  entityName: string;
  currency: CurrencyCode;
  exchangeRate: number;
  items: InvoiceItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  status: 'draft' | 'approved' | 'converted' | 'posted' | 'cancelled';
  convertedInvoiceId?: string;
  convertedInvoiceNumber?: string;
  journalEntryId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface BankStatementRow {
  id: string;
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  matchedVoucherId?: string;
}

export interface BankReconciliationSession {
  id: string;
  companyId?: string;
  treasuryAccountId: string;
  treasuryAccountName: string;
  statementDate: string;
  statementClosingBalance: number;
  bookClosingBalance: number;
  reconciledDifference: number;
  matchedIds: string[];
  statementRows: BankStatementRow[];
  status: 'draft' | 'reconciled';
  performedBy: string;
  createdAt: string;
}

export interface PosShift {
  id: string;
  companyId?: string;
  shiftNumber: string;
  cashierUserId: string;
  cashierName: string;
  treasuryAccountId: string;
  warehouseId: string;
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  expectedCash: number;
  actualCountedCash?: number;
  cashVariance?: number;
  salesCount: number;
  totalSalesAmount: number;
  status: 'open' | 'closed';
  notes?: string;
}

export interface HeldPosCart {
  id: string;
  companyId?: string;
  label: string;
  customerId: string;
  customerName: string;
  currency: CurrencyCode;
  items: InvoiceItem[];
  discountPct: number;
  savedAt: string;
  savedBy: string;
}

export type ApprovalActionType =
  | 'invoice_post'
  | 'voucher_post'
  | 'manual_journal_post'
  | 'stock_adjustment'
  | 'asset_disposal'
  | 'period_reopen';

export interface ApprovalWorkflowRule {
  id: string;
  companyId?: string;
  actionType: ApprovalActionType;
  nameAr: string;
  enabled: boolean;
  minAmountThreshold: number;
  requiredLevels: 1 | 2;
  approverRolesLevel1: UserRoleType[];
  approverRolesLevel2?: UserRoleType[];
}

export interface ApprovalRequest {
  id: string;
  companyId?: string;
  requestNumber: string;
  actionType: ApprovalActionType;
  entityLabel: string;
  documentNumber: string;
  amount: number;
  currency: CurrencyCode;
  requestedByUserId: string;
  requestedByName: string;
  requestedAt: string;
  currentLevel: 1 | 2;
  requiredLevels: 1 | 2;
  status: 'pending' | 'approved' | 'rejected';
  payloadJson: string;
  history: Array<{
    level: number;
    decision: 'approved' | 'rejected';
    byUserId: string;
    byUserName: string;
    at: string;
    notes?: string;
  }>;
}

export interface ScreenFieldRule {
  fieldKey: string;
  labelAr: string;
  visible: boolean;
  required: boolean;
}

export interface DocumentStatusConfig {
  id: string;
  labelAr: string;
  colorHex: string;
  isActive: boolean;
  isDefault?: boolean;
}

export interface ShortcutRule {
  id: string;
  keys: string;
  actionLabelAr: string;
  targetTabId: string;
  enabled: boolean;
}

export interface OperationalControlConfig {
  enabledModules: {
    sales: boolean;
    purchases: boolean;
    vouchers: boolean;
    accounting: boolean;
    inventory: boolean;
    parties: boolean;
    reports: boolean;
    hrPayroll: boolean;
    fixedAssets: boolean;
    pos: boolean;
    distribution: boolean;
    aiAdvisor: boolean;
  };
  enforceCreditLimitBlock: boolean;
  enforceClosedFiscalPeriodBlock: boolean;
  enableApprovalWorkflows: boolean;
  enableFxRevaluation: boolean;
  productionSecurityMode: boolean;
  disabledReportIds: string[];
  disabledPaymentMethods: string[];
  disabledCurrencies: string[];
  screenFieldRules: Record<string, ScreenFieldRule[]>;
  customDocumentStatuses: DocumentStatusConfig[];
  shortcuts: ShortcutRule[];
  subTabOrder?: Record<string, string[]>;
  hiddenSubTabs?: string[];
}

export type ReportDataSourceKey =
  | 'invoices'
  | 'journalEntries'
  | 'customers'
  | 'vendors'
  | 'inventory'
  | 'treasury'
  | 'expenses'
  | 'vouchers'
  | 'fixedAssets';

export interface SavedReportColumnDef {
  id: string;
  field: string;
  label: string;
  visible: boolean;
  order: number;
  widthPx: number;
  pin: 'none' | 'right' | 'left';
  align: 'right' | 'center' | 'left';
  wrapText: boolean;
  fontSizePx: number;
  fontWeight: 'normal' | 'bold';
  textColor?: string;
  bgColor?: string;
  borderStyle?: 'solid' | 'dashed' | 'none';
  showSubtotal: boolean;
  showGrandTotal: boolean;
  sortable: boolean;
  searchable: boolean;
  isCalculated?: boolean;
  formulaExpr?: string;
  format?: 'text' | 'number' | 'currency' | 'date';
}

export interface SavedReportFilterRule {
  id: string;
  field: string;
  operator: 'contains' | 'equals' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}

export interface SavedReportDesign {
  id: string;
  companyId?: string;
  nameAr: string;
  description?: string;
  dataSource: ReportDataSourceKey;
  columns: SavedReportColumnDef[];
  filters: SavedReportFilterRule[];
  groupByField?: string;
  sortRules: Array<{ field: string; direction: 'asc' | 'desc' }>;
  rowHeightPx: number;
  cellPaddingPx: number;
  paperOrientation: 'portrait' | 'landscape' | 'auto';
  splitWideTableOnPrint: boolean;
  allowedRoles?: UserRoleType[];
  isDefaultTemplate?: boolean;
  createdBy: string;
  updatedAt: string;
}

export interface SavedTableView {
  id: string;
  tableId: string;
  nameAr: string;
  columns: TableColumnPref[];
  createdBy: string;
  isDefault?: boolean;
}

export interface FxRevaluationRecord {
  id: string;
  companyId?: string;
  revaluationNumber: string;
  date: string;
  totalGainLossBase: number;
  lines: Array<{
    accountName: string;
    currency: CurrencyCode;
    foreignBalance: number;
    bookBaseBalance: number;
    revaluedBaseBalance: number;
    diffBase: number;
  }>;
  journalEntryId?: string;
  performedBy: string;
  createdAt: string;
}

export interface BackupSnapshotMeta {
  id: string;
  createdAt: string;
  type: 'full' | 'incremental' | 'encrypted';
  schemaVersion: string;
  recordCount: number;
  sizeBytes: number;
  verifiedRestoreOk?: boolean;
  notes?: string;
}

export interface BackupScheduleConfig {
  enabled: boolean;
  frequencyHours: number;
  encryptByDefault: boolean;
  lastBackupAt?: string;
}

export interface DataImportLog {
  id: string;
  timestamp: string;
  entityType: 'accounts' | 'customers' | 'vendors' | 'items';
  fileName: string;
  totalRows: number;
  importedRows: number;
  skippedDuplicates: number;
  errorsCount: number;
  status: 'completed' | 'rolled_back';
  performedBy: string;
}

export interface FinancialIntegrityIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category:
    | 'unbalanced_journal'
    | 'non_leaf_account'
    | 'unlinked_document'
    | 'duplicate_document'
    | 'subledger_mismatch'
    | 'stock_mismatch'
    | 'negative_stock'
    | 'closed_period_violation';
  titleAr: string;
  descriptionAr: string;
  entityType?: string;
  entityId?: string;
  varianceAmount?: number;
  suggestedResolutionAr: string;
}

export interface DocumentBook {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  category: 'sales' | 'purchases' | 'warehouse' | 'vouchers' | 'ledgers';
  prefix: string;
  nextSequence: number;
  padLength: number;
  isActive: boolean;
  isDefault?: boolean;
  description?: string;
}

export interface DepartmentItem {
  id: string;
  companyId?: string;
  nameAr: string;
}

export interface CustomLedgerRow {
  id: string;
  partyName: string;
  statement: string;
  debit: number;
  credit: number;
  currency: CurrencyCode;
  notes?: string;
}

export interface CustomLedgerEntry {
  id: string;
  companyId?: string;
  bookId: string;
  entryNumber: string;
  date: string;
  treasuryAccountId?: string;
  treasuryAccountName?: string;
  direction?: 'IN' | 'OUT';
  rows: CustomLedgerRow[];
  totalDebit: number;
  totalCredit: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface CustomLedgerBook {
  id: string;
  companyId?: string;
  code: string;
  nameAr: string;
  description?: string;
  createdAt: string;
}

export type PrintDocumentType = 'invoice' | 'voucher' | 'statement' | 'report';
export type PrintPaperSize = 'A4' | 'A3' | 'LETTER' | 'CUSTOM';
export type PrintOrientation = 'portrait' | 'landscape' | 'auto';
export type TypographyUnit = 'pt' | 'px';

export type TypographyElementKey =
  | 'companyName'
  | 'documentTitle'
  | 'sectionHeadings'
  | 'companyDetails'
  | 'partyMetadata'
  | 'tableHeaders'
  | 'tableCells'
  | 'numericValues'
  | 'priceValues'
  | 'totalsAndSummary'
  | 'finalAmounts'
  | 'notes'
  | 'signatures'
  | 'footer'
  | 'pageNumbers';

export interface PrintTypographyConfig {
  unit: TypographyUnit;
  companyName: number;
  documentTitle: number;
  sectionHeadings: number;
  companyDetails: number;
  partyMetadata: number;
  tableHeaders: number;
  tableCells: number;
  numericValues: number;
  priceValues: number;
  totalsAndSummary: number;
  finalAmounts: number;
  notes: number;
  signatures: number;
  footer: number;
  pageNumbers: number;
  signaturesAndFooter?: number; // legacy migration fallback
  colors?: Partial<Record<TypographyElementKey, string>>;
  weights?: Partial<Record<TypographyElementKey, 'normal' | 'bold'>>;
}

export interface IntelligentPaginationConfig {
  minimumRowsBeforeTableBreak: number;
  keepHeadingWithTable: boolean;
  preventRowSplit: boolean;
  allowMultipleTablesPerPage: boolean;
  keepShortTableTogetherMaxRows: number;
  tableSpacingMm: number;
  headingSpacingBeforeMm: number;
  headingSpacingAfterMm: number;
}

export interface PrintTemplateConfig {
  id: string;
  nameAr: string;
  docType: PrintDocumentType;
  paperSize: PrintPaperSize;
  customWidthMm?: number;
  customHeightMm?: number;
  orientation: PrintOrientation;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  showLogo: boolean;
  logoSizePx: number;
  logoPosition: 'right' | 'center' | 'left';
  useCustomBanner: boolean;
  showHeader: boolean;
  showCompanyDetails: boolean;
  showFooter: boolean;
  footerText?: string;
  fontFamily?: 'Cairo' | 'Tajawal' | 'DejaVu';
  fontSizePt: number;
  typography?: PrintTypographyConfig;
  pagination?: IntelligentPaginationConfig;
  primaryColor: string;
  accentColor: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  borderColor: string;
  borderWidthPx: number;
  repeatHeaderOnPages?: boolean;
  repeatTableHeader: boolean;
  hiddenColumns?: string[];
  showPageNumbers: boolean;
  showSignatures: boolean;
  showStamp: boolean;
  signatureLabels: [string, string, string];
}

export interface SystemSettings {
  allowNegativeStock: boolean;
  enforceBalancedJournalEntries: boolean;
  defaultTaxRate: number; // e.g. 0.05
  enableTax: boolean;
  autoPostInvoices: boolean;
  autoDownloadInvoices: boolean; // التنزيل التلقائي للفواتير بعد الإصدار
  scheduledDispatchHour: string; // وقت الإرسال المجدول اليومي (e.g. "18:00")
  enableWhatsAppAPI: boolean;
  whatsappApiEndpoint?: string;
  whatsappPhoneNumberId?: string;
  whatsappApiToken?: string;
  notificationPhone?: string;
  whatsappTemplates?: WhatsAppTemplates;
  stocktakeSurplusAccountCode?: string;
  stocktakeShortageAccountCode?: string;
  paymentMethods?: string[];
  invoicePrefix: string;
  purchasePrefix: string;
  paymentVoucherPrefix: string;
  receiptVoucherPrefix: string;
  journalPrefix: string;
  fiscalYear: string;
  fiscalYearStatus: 'open' | 'closed';
  companyPhone: string;
  companyAddress: string;
  companyTaxNumber: string;
  companyCommercialRecord: string;
  language?: 'ar' | 'en';
  uiPreferences?: UIPreferences;
  operationalControl?: OperationalControlConfig;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  companyPrintTemplates?: Record<string, Partial<Record<PrintDocumentType, PrintTemplateConfig>>>;
}
