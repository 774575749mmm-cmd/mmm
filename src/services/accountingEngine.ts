/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Double-Entry Accounting Engine
 */

import {
  Account,
  JournalEntry,
  JournalEntryLine,
  Invoice,
  PaymentVoucher,
  ExpenseRecord,
  PayrollRun,
  FixedAsset,
  Customer,
  Vendor,
  PhysicalStocktaking,
  CurrencyCode,
  ItemWarehouseStock,
  FiscalPeriod,
  Currency,
  TreasuryAccount,
  SystemSettings,
  FxRevaluationRecord,
} from '../types/erp';
import { generateNextDocNumber } from './storageService';

export interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
}

export interface CashFlowStatementResult {
  operatingInflows: { label: string; amount: number }[];
  operatingOutflows: { label: string; amount: number }[];
  netOperatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashChange: number;
  openingCashBalance: number;
  closingCashBalance: number;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  category: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  endingDebit: number;
  endingCredit: number;
}

export interface IncomeStatementResult {
  revenues: { accountCode: string; accountName: string; amount: number }[];
  totalRevenue: number;
  cogs: { accountCode: string; accountName: string; amount: number }[];
  totalCogs: number;
  grossProfit: number;
  expenses: { accountCode: string; accountName: string; amount: number }[];
  totalExpenses: number;
  netIncome: number;
}

export interface BalanceSheetResult {
  assets: { accountCode: string; accountName: string; balance: number }[];
  totalAssets: number;
  liabilities: { accountCode: string; accountName: string; balance: number }[];
  totalLiabilities: number;
  equity: { accountCode: string; accountName: string; balance: number }[];
  totalEquity: number;
  netProfitCarried: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  variance: number;
}

export interface StatementRow {
  date: string;
  documentType: string;
  documentNumber: string;
  statement: string;
  debit: number;
  credit: number;
  balance: number;
  txCurrency?: CurrencyCode;
  exchangeRate?: number;
  txDebit?: number;
  txCredit?: number;
}

/**
 * Validates that debit and credit amounts strictly match
 */
export function validateJournalEntry(lines: JournalEntryLine[]): { isValid: boolean; error?: string; totalDebit: number; totalCredit: number } {
  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    return {
      isValid: false,
      error: `القيد المحاسبي غير متوازن! إجمالي المدين (${totalDebit.toLocaleString()}) لا يساوي إجمالي الدائن (${totalCredit.toLocaleString()}). الفارق: ${diff.toLocaleString()}`,
      totalDebit,
      totalCredit,
    };
  }

  if (lines.length < 2) {
    return {
      isValid: false,
      error: 'يجب أن يحتوي القيد المحاسبي على طرفين على الأقل (مدين ودائن).',
      totalDebit,
      totalCredit,
    };
  }

  return { isValid: true, totalDebit, totalCredit };
}

/**
 * Validates balanced debit/credit AND ensures every line posts strictly to an active leaf COA account.
 */
export function validateJournalEntryWithAccounts(
  lines: JournalEntryLine[],
  accounts: Account[]
): { isValid: boolean; error?: string; totalDebit: number; totalCredit: number } {
  const baseCheck = validateJournalEntry(lines);
  if (!baseCheck.isValid) return baseCheck;

  for (const line of lines) {
    const acc = accounts.find((a) => a.id === line.accountId || a.code === line.accountCode);
    if (!acc) {
      return {
        isValid: false,
        error: `الحساب المحاسبي (${line.accountCode} - ${line.accountName}) غير موجود في دليل الحسابات.`,
        totalDebit: baseCheck.totalDebit,
        totalCredit: baseCheck.totalCredit,
      };
    }
    if (!acc.isLeaf) {
      return {
        isValid: false,
        error: `الحساب (${acc.code} - ${acc.nameAr}) حساب رئيسي غير طرفي! يُسمح بالترحيل للحسابات الفرعية الطرفية فقط.`,
        totalDebit: baseCheck.totalDebit,
        totalCredit: baseCheck.totalCredit,
      };
    }
    if (acc.isActive === false) {
      return {
        isValid: false,
        error: `الحساب (${acc.code} - ${acc.nameAr}) موقوف إدارياً ولا يمكن الترحيل عليه.`,
        totalDebit: baseCheck.totalDebit,
        totalCredit: baseCheck.totalCredit,
      };
    }
  }
  return baseCheck;
}

/**
 * Verifies whether a transaction date belongs to an open fiscal period (if closed-period lock is enabled).
 */
export function isDateInOpenFiscalPeriod(
  dateStr: string,
  fiscalPeriods: FiscalPeriod[] | undefined,
  companyId: string | undefined,
  settings: SystemSettings,
  bypassClosingLock = false
): { allowed: boolean; fiscalPeriodId?: string; error?: string } {
  if (bypassClosingLock) return { allowed: true };
  if (settings.operationalControl?.enforceClosedFiscalPeriodBlock === false) {
    return { allowed: true };
  }
  const cleanDate = String(dateStr || '').slice(0, 10);
  if (!cleanDate) return { allowed: true };

  if (settings.fiscalYearStatus === 'closed' && cleanDate.startsWith(settings.fiscalYear)) {
    return {
      allowed: false,
      error: `السنة المالية (${settings.fiscalYear}) مقفلة محاسبياً ولا يُسمح بترحيل أو إلغاء أي قيود ضمنها إلا بعد إعادة فتح الفترة بصلاحية مخولة.`,
    };
  }

  const companyPeriods = (fiscalPeriods || []).filter(
    (fp) => !companyId || fp.companyId === companyId
  );
  if (companyPeriods.length === 0) return { allowed: true };

  const matchingPeriod = companyPeriods.find(
    (fp) => cleanDate >= fp.startDate && cleanDate <= fp.endDate
  );
  if (matchingPeriod) {
    if (matchingPeriod.status === 'closed' || matchingPeriod.status === 'locked') {
      return {
        allowed: false,
        fiscalPeriodId: matchingPeriod.id,
        error: `الفترة المحاسبية (${matchingPeriod.periodName}) مغلقة أو مقفلة، ولا يمكن تنفيذ حركات مالية بتاريخ (${cleanDate}).`,
      };
    }
    return { allowed: true, fiscalPeriodId: matchingPeriod.id };
  }

  return { allowed: true };
}

export function resolveAccount(
  accounts: Account[],
  preferredCodes: string[],
  category: Account['category'],
  keywords: string[] = []
): Account {
  for (const code of preferredCodes) {
    const exact = accounts.find((a) => a.code === code && a.isLeaf) || accounts.find((a) => a.code === code);
    if (exact) return exact;
  }
  const leaves = accounts.filter((a) => a.isLeaf);
  for (const kw of keywords) {
    const byKw = leaves.find((a) => a.nameAr.includes(kw));
    if (byKw) return byKw;
  }
  const byCat = leaves.find((a) => a.category === category);
  if (byCat) return byCat;
  return (
    leaves[0] ||
    accounts[0] || {
      id: 'acc-fallback',
      code: '0',
      nameAr: 'حساب افتراضي',
      category,
      nature: category === 'أصول' || category === 'مصروفات' ? 'debit' : 'credit',
      level: 1,
      isLeaf: true,
      currentBalance: 0,
    }
  );
}

/**
 * Creates automated balanced Journal Entry for a Sales Invoice
 */
export function createSalesInvoiceJournalEntry(
  invoice: Invoice,
  accounts: Account[],
  userFullName: string,
  existingEntryNumbers: string[] = [],
  warehouseStock?: ItemWarehouseStock[],
  exactTotalCogs?: number
): JournalEntry {
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const lines: JournalEntryLine[] = [];
  const rate = invoice.exchangeRate && invoice.exchangeRate > 0 ? invoice.exchangeRate : 1;
  const isReturn = invoice.type === 'مرتجع_مبيعات';

  // Account references (supports both Almansoor demo COA and Qright COA)
  const accCash =
    accounts.find((a) => a.id === invoice.treasuryAccountId) ||
    resolveAccount(accounts, ['1111', '131'], 'أصول', ['الصندوق']);
  const accReceivable = resolveAccount(accounts, ['114', '121001', '121'], 'أصول', ['الزبائن', 'العملاء']);
  const accSalesRevenue = resolveAccount(
    accounts,
    isReturn ? ['4115', '4110', '41'] : ['4110', '41'],
    'إيرادات',
    isReturn ? ['مرتجع', 'المبيعات'] : ['المبيعات']
  );
  const accVat = resolveAccount(accounts, ['2120', '801', '802'], 'خصوم', ['ضريبة']);
  const accCogs = accounts.find((a) => a.code === '5110' || a.code === '31');
  const accInventory = accounts.find((a) => a.code === '115' || a.code === '124');

  const grandTotalBase = round2(invoice.grandTotal * rate);
  const vatBase = round2((invoice.taxTotal || 0) * rate);
  const netSalesBase = vatBase > 0 ? round2(grandTotalBase - vatBase) : grandTotalBase;
  const paidBase = round2((invoice.paidAmount || 0) * rate);
  const remainingBase = round2(grandTotalBase - paidBase);
  const ts = Date.now();

  if (!isReturn) {
    // 1. Debit: Cash or Customer Receivable
    if (invoice.paymentType === 'نقدي') {
      lines.push({
        id: `jl-${ts}-1`,
        accountId: accCash.id,
        accountCode: accCash.code,
        accountName: accCash.nameAr,
        debit: grandTotalBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `سداد نقدي لفاتورة مبيعات رقم ${invoice.invoiceNumber}`,
      });
    } else if (invoice.paymentType === 'آجل') {
      lines.push({
        id: `jl-${ts}-1`,
        accountId: accReceivable.id,
        accountCode: accReceivable.code,
        accountName: `${accReceivable.nameAr} - ${invoice.entityName}`,
        debit: grandTotalBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `استحقاق فاتورة مبيعات آجلة رقم ${invoice.invoiceNumber} - العميل: ${invoice.entityName}`,
      });
    } else {
      if (paidBase > 0) {
        lines.push({
          id: `jl-${ts}-1`,
          accountId: accCash.id,
          accountCode: accCash.code,
          accountName: accCash.nameAr,
          debit: paidBase,
          credit: 0,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `دفعة نقدية لفاتورة مبيعات رقم ${invoice.invoiceNumber}`,
        });
      }
      if (remainingBase > 0) {
        lines.push({
          id: `jl-${ts}-2`,
          accountId: accReceivable.id,
          accountCode: accReceivable.code,
          accountName: `${accReceivable.nameAr} - ${invoice.entityName}`,
          debit: remainingBase,
          credit: 0,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `المتبقي الآجل لفاتورة مبيعات رقم ${invoice.invoiceNumber}`,
        });
      }
    }

    // 2. Credit: Sales Revenue
    lines.push({
      id: `jl-${ts}-3`,
      accountId: accSalesRevenue.id,
      accountCode: accSalesRevenue.code,
      accountName: accSalesRevenue.nameAr,
      debit: 0,
      credit: netSalesBase,
      currency: invoice.currency,
      exchangeRate: rate,
      memo: `إيراد مبيعات فاتورة ${invoice.invoiceNumber}`,
    });

    // 3. Credit: Tax (if applicable)
    if (vatBase > 0 && accVat) {
      lines.push({
        id: `jl-${ts}-4`,
        accountId: accVat.id,
        accountCode: accVat.code,
        accountName: accVat.nameAr,
        debit: 0,
        credit: vatBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `ضريبة القيمة المضافة المستحقة لفاتورة ${invoice.invoiceNumber}`,
      });
    }
  } else {
    // Sales Return: Debit Sales Revenue/Return + VAT, Credit Cash or Customer Receivable
    lines.push({
      id: `jl-${ts}-1`,
      accountId: accSalesRevenue.id,
      accountCode: accSalesRevenue.code,
      accountName: accSalesRevenue.nameAr,
      debit: netSalesBase,
      credit: 0,
      currency: invoice.currency,
      exchangeRate: rate,
      memo: `مرتجع مبيعات فاتورة ${invoice.invoiceNumber}`,
    });

    if (vatBase > 0 && accVat) {
      lines.push({
        id: `jl-${ts}-2`,
        accountId: accVat.id,
        accountCode: accVat.code,
        accountName: accVat.nameAr,
        debit: vatBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `عكس ضريبة القيمة المضافة لمرتجع المبيعات ${invoice.invoiceNumber}`,
      });
    }

    if (invoice.paymentType === 'نقدي') {
      lines.push({
        id: `jl-${ts}-3`,
        accountId: accCash.id,
        accountCode: accCash.code,
        accountName: accCash.nameAr,
        debit: 0,
        credit: grandTotalBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `رد نقدي لمرتجع مبيعات رقم ${invoice.invoiceNumber}`,
      });
    } else if (invoice.paymentType === 'آجل') {
      lines.push({
        id: `jl-${ts}-3`,
        accountId: accReceivable.id,
        accountCode: accReceivable.code,
        accountName: `${accReceivable.nameAr} - ${invoice.entityName}`,
        debit: 0,
        credit: grandTotalBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `تخفيض مديونية العميل بموجب مرتجع مبيعات ${invoice.invoiceNumber} - ${invoice.entityName}`,
      });
    } else {
      if (paidBase > 0) {
        lines.push({
          id: `jl-${ts}-3`,
          accountId: accCash.id,
          accountCode: accCash.code,
          accountName: accCash.nameAr,
          debit: 0,
          credit: paidBase,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `رد دفعة نقدية لمرتجع مبيعات ${invoice.invoiceNumber}`,
        });
      }
      if (remainingBase > 0) {
        lines.push({
          id: `jl-${ts}-4`,
          accountId: accReceivable.id,
          accountCode: accReceivable.code,
          accountName: `${accReceivable.nameAr} - ${invoice.entityName}`,
          debit: 0,
          credit: remainingBase,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `تخفيض الآجل لمرتجع مبيعات ${invoice.invoiceNumber}`,
        });
      }
    }
  }

  // 4. Inventory & COGS side (prefer exact FIFO consumed totalCost when provided)
  const fallbackCost = round2(
    invoice.items.reduce((sum, it) => {
      const ws = warehouseStock?.find(
        (w) => w.itemId === it.itemId && w.warehouseId === invoice.warehouseId
      );
      const effectiveCost = ws && ws.averageCost > 0 ? ws.averageCost : it.unitCost;
      return sum + effectiveCost * (it.quantity + (it.bonusQuantity || 0));
    }, 0)
  );
  const totalCost =
    exactTotalCogs !== undefined && Number.isFinite(exactTotalCogs)
      ? round2(exactTotalCogs)
      : fallbackCost;

  if (totalCost > 0 && accCogs && accInventory) {
    if (!isReturn) {
      lines.push({
        id: `jl-${ts}-5`,
        accountId: accCogs.id,
        accountCode: accCogs.code,
        accountName: accCogs.nameAr,
        debit: totalCost,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `تكلفة البضاعة المباعة لفاتورة ${invoice.invoiceNumber}`,
      });
      lines.push({
        id: `jl-${ts}-6`,
        accountId: accInventory.id,
        accountCode: accInventory.code,
        accountName: accInventory.nameAr,
        debit: 0,
        credit: totalCost,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `صرف مخزون بضاعة مباعة لفاتورة ${invoice.invoiceNumber}`,
      });
    } else {
      lines.push({
        id: `jl-${ts}-5`,
        accountId: accInventory.id,
        accountCode: accInventory.code,
        accountName: accInventory.nameAr,
        debit: totalCost,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `إعادة مخزون مرتجع مبيعات رقم ${invoice.invoiceNumber}`,
      });
      lines.push({
        id: `jl-${ts}-6`,
        accountId: accCogs.id,
        accountCode: accCogs.code,
        accountName: accCogs.nameAr,
        debit: 0,
        credit: totalCost,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `عكس تكلفة البضاعة لمرتجع مبيعات رقم ${invoice.invoiceNumber}`,
      });
    }
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));

  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  return {
    id: `je-auto-${ts}-${Math.floor(Math.random() * 1000)}`,
    entryNumber,
    date: invoice.date,
    branchId: invoice.branchId,
    referenceType: isReturn ? 'مرتجع' : 'فاتورة_مبيعات',
    referenceNumber: invoice.invoiceNumber,
    referenceId: invoice.id,
    description: isReturn
      ? `قيد آلي لمرتجع مبيعات ${invoice.invoiceNumber} - العميل: ${invoice.entityName}`
      : `قيد آلي لفاتورة مبيعات ${invoice.invoiceNumber} - العميل: ${invoice.entityName}`,
    lines,
    totalDebit,
    totalCredit,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates automated balanced Journal Entry for a Purchase Invoice or Purchase Return (separates Recoverable Input VAT 1165)
 */
export function createPurchaseInvoiceJournalEntry(
  invoice: Invoice,
  accounts: Account[],
  userFullName: string,
  existingEntryNumbers: string[] = [],
  exactInventoryCost?: number
): JournalEntry {
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const lines: JournalEntryLine[] = [];
  const rate = invoice.exchangeRate && invoice.exchangeRate > 0 ? invoice.exchangeRate : 1;
  const isReturn = invoice.type === 'مرتجع_مشتريات';
  const ts = Date.now();

  const accCash =
    accounts.find((a) => a.id === invoice.treasuryAccountId) ||
    resolveAccount(accounts, ['1111', '131'], 'أصول', ['الصندوق']);
  const accPayable = resolveAccount(accounts, ['2110', '221001', '221'], 'خصوم', ['المورد']);
  const accInventory = resolveAccount(accounts, ['115', '124', '31'], 'أصول', ['المخزون', 'المشتريات']);
  const accInputVat =
    accounts.find((a) => a.code === '1165' && a.isLeaf) ||
    accounts.find((a) => a.isLeaf && a.nameAr.includes('ضريبة') && a.nameAr.includes('مدخلات'));
  const accCogsVariance = accounts.find((a) => a.code === '5110' || a.code === '5390');

  const grandTotalBase = round2(invoice.grandTotal * rate);
  const vatBase = round2((invoice.taxTotal || 0) * rate);
  const netPurchaseBase = vatBase > 0 && accInputVat ? round2(grandTotalBase - vatBase) : grandTotalBase;
  const paidBase = round2((invoice.paidAmount || 0) * rate);
  const remainingBase = round2(grandTotalBase - paidBase);

  if (!isReturn) {
    // 1. Debit Inventory (Net Cost) + Recoverable Input VAT (1165)
    lines.push({
      id: `jl-${ts}-p1`,
      accountId: accInventory.id,
      accountCode: accInventory.code,
      accountName: accInventory.nameAr,
      debit: netPurchaseBase,
      credit: 0,
      currency: invoice.currency,
      exchangeRate: rate,
      memo: `إضافة مخزون مشتريات بموجب فاتورة ${invoice.invoiceNumber}`,
    });

    if (vatBase > 0 && accInputVat) {
      lines.push({
        id: `jl-${ts}-p1v`,
        accountId: accInputVat.id,
        accountCode: accInputVat.code,
        accountName: accInputVat.nameAr,
        debit: vatBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `ضريبة القيمة المضافة مدخلات قابلة للاسترداد - فاتورة ${invoice.invoiceNumber}`,
      });
    }

    // 2. Credit Vendor or Cash
    if (invoice.paymentType === 'نقدي') {
      lines.push({
        id: `jl-${ts}-p2`,
        accountId: accCash.id,
        accountCode: accCash.code,
        accountName: accCash.nameAr,
        debit: 0,
        credit: grandTotalBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `سداد نقدي لفاتورة مشتريات ${invoice.invoiceNumber}`,
      });
    } else if (invoice.paymentType === 'آجل') {
      lines.push({
        id: `jl-${ts}-p2`,
        accountId: accPayable.id,
        accountCode: accPayable.code,
        accountName: `${accPayable.nameAr} - ${invoice.entityName}`,
        debit: 0,
        credit: grandTotalBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `استحقاق فاتورة مشتريات آجلة ${invoice.invoiceNumber} - المورد: ${invoice.entityName}`,
      });
    } else {
      if (paidBase > 0) {
        lines.push({
          id: `jl-${ts}-p2`,
          accountId: accCash.id,
          accountCode: accCash.code,
          accountName: accCash.nameAr,
          debit: 0,
          credit: paidBase,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `دفعة نقدية لفاتورة مشتريات ${invoice.invoiceNumber}`,
        });
      }
      if (remainingBase > 0) {
        lines.push({
          id: `jl-${ts}-p3`,
          accountId: accPayable.id,
          accountCode: accPayable.code,
          accountName: `${accPayable.nameAr} - ${invoice.entityName}`,
          debit: 0,
          credit: remainingBase,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `المتبقي الآجل لفاتورة مشتريات ${invoice.invoiceNumber}`,
        });
      }
    }
  } else {
    // Purchase Return: Debit Cash or Payable, Credit Inventory + Credit Input VAT (1165)
    if (invoice.paymentType === 'نقدي') {
      lines.push({
        id: `jl-${ts}-pr1`,
        accountId: accCash.id,
        accountCode: accCash.code,
        accountName: accCash.nameAr,
        debit: grandTotalBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `استرداد نقدي لمرتجع مشتريات ${invoice.invoiceNumber}`,
      });
    } else if (invoice.paymentType === 'آجل') {
      lines.push({
        id: `jl-${ts}-pr1`,
        accountId: accPayable.id,
        accountCode: accPayable.code,
        accountName: `${accPayable.nameAr} - ${invoice.entityName}`,
        debit: grandTotalBase,
        credit: 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `تخفيض رصيد المورد بموجب مرتجع مشتريات ${invoice.invoiceNumber} - ${invoice.entityName}`,
      });
    } else {
      if (paidBase > 0) {
        lines.push({
          id: `jl-${ts}-pr1`,
          accountId: accCash.id,
          accountCode: accCash.code,
          accountName: accCash.nameAr,
          debit: paidBase,
          credit: 0,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `استرداد دفعة نقدية لمرتجع مشتريات ${invoice.invoiceNumber}`,
        });
      }
      if (remainingBase > 0) {
        lines.push({
          id: `jl-${ts}-pr2`,
          accountId: accPayable.id,
          accountCode: accPayable.code,
          accountName: `${accPayable.nameAr} - ${invoice.entityName}`,
          debit: remainingBase,
          credit: 0,
          currency: invoice.currency,
          exchangeRate: rate,
          memo: `تخفيض الآجل للمورد بمرتجع مشتريات ${invoice.invoiceNumber}`,
        });
      }
    }

    const invCreditAmount =
      exactInventoryCost !== undefined && Number.isFinite(exactInventoryCost) && accCogsVariance
        ? round2(exactInventoryCost)
        : netPurchaseBase;

    lines.push({
      id: `jl-${ts}-pr3`,
      accountId: accInventory.id,
      accountCode: accInventory.code,
      accountName: accInventory.nameAr,
      debit: 0,
      credit: invCreditAmount,
      currency: invoice.currency,
      exchangeRate: rate,
      memo: `إخراج مخزون مرتجع مشتريات ${invoice.invoiceNumber}`,
    });

    if (vatBase > 0 && accInputVat) {
      lines.push({
        id: `jl-${ts}-pr4`,
        accountId: accInputVat.id,
        accountCode: accInputVat.code,
        accountName: accInputVat.nameAr,
        debit: 0,
        credit: vatBase,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `عكس ضريبة مدخلات مرتجع مشتريات ${invoice.invoiceNumber}`,
      });
    }

    const costVariance = round2(netPurchaseBase - invCreditAmount);
    if (Math.abs(costVariance) > 0.01 && accCogsVariance) {
      lines.push({
        id: `jl-${ts}-pr5`,
        accountId: accCogsVariance.id,
        accountCode: accCogsVariance.code,
        accountName: accCogsVariance.nameAr,
        debit: costVariance < 0 ? Math.abs(costVariance) : 0,
        credit: costVariance > 0 ? costVariance : 0,
        currency: invoice.currency,
        exchangeRate: rate,
        memo: `فروق تسوية تكلفة مرتجع مشتريات ${invoice.invoiceNumber}`,
      });
    }
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));

  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  return {
    id: `je-auto-${ts}-${Math.floor(Math.random() * 1000)}`,
    entryNumber,
    date: invoice.date,
    branchId: invoice.branchId,
    referenceType: isReturn ? 'مرتجع' : 'فاتورة_مشتريات',
    referenceNumber: invoice.invoiceNumber,
    referenceId: invoice.id,
    description: isReturn
      ? `قيد آلي لمرتجع مشتريات ${invoice.invoiceNumber} - المورد: ${invoice.entityName}`
      : `قيد آلي لفاتورة مشتريات ${invoice.invoiceNumber} - المورد: ${invoice.entityName}`,
    lines,
    totalDebit,
    totalCredit,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates automated balanced Journal Entry for a Receipt or Payment Voucher
 */
export function createVoucherJournalEntry(
  voucher: PaymentVoucher,
  accounts: Account[],
  userFullName: string,
  existingEntryNumbers: string[] = []
): JournalEntry {
  const lines: JournalEntryLine[] = [];
  
  // Treasury account (Cash/Bank)
  const accTreasury =
    accounts.find((a) => a.id === voucher.treasuryAccountId) ||
    resolveAccount(accounts, ['1111', '131'], 'أصول', ['الصندوق']);

  // Entity account
  let accEntity: Account;
  const directMappedAcc = voucher.entityId
    ? accounts.find((a) => a.id === voucher.entityId || a.code === voucher.entityId)
    : undefined;
  if (voucher.entityType === 'عميل') {
    accEntity = resolveAccount(accounts, ['114', '121001', '121'], 'أصول', ['الزبائن', 'العملاء']);
  } else if (voucher.entityType === 'مورد') {
    accEntity = resolveAccount(accounts, ['2110', '221001', '221'], 'خصوم', ['المورد']);
  } else if (voucher.entityType === 'موظف') {
    accEntity = directMappedAcc || resolveAccount(accounts, ['2130', '5210', '516', '501'], 'مصروفات', ['رواتب', 'الموظفين']);
  } else {
    accEntity = directMappedAcc || resolveAccount(accounts, ['5340', '510', '4120', '601'], 'مصروفات', ['مصاريف متفرقة', 'إيرادات']);
  }

  const baseAmount = voucher.amount * voucher.exchangeRate;

  if (voucher.type === 'قبض') {
    // Receipt: Debit Treasury, Credit Customer / Entity
    lines.push({
      id: `jl-v-${Date.now()}-1`,
      accountId: accTreasury.id,
      accountCode: accTreasury.code,
      accountName: accTreasury.nameAr,
      debit: baseAmount,
      credit: 0,
      currency: voucher.currency,
      exchangeRate: voucher.exchangeRate,
      memo: `سند قبض رقم ${voucher.voucherNumber} - من: ${voucher.entityName}`,
    });
    lines.push({
      id: `jl-v-${Date.now()}-2`,
      accountId: accEntity.id,
      accountCode: accEntity.code,
      accountName: `${accEntity.nameAr} - ${voucher.entityName}`,
      debit: 0,
      credit: baseAmount,
      currency: voucher.currency,
      exchangeRate: voucher.exchangeRate,
      memo: voucher.statement || `تحصيل بموجب سند قبض رقم ${voucher.voucherNumber}`,
    });
  } else {
    // Disbursement: Debit Vendor / Entity, Credit Treasury
    lines.push({
      id: `jl-v-${Date.now()}-1`,
      accountId: accEntity.id,
      accountCode: accEntity.code,
      accountName: `${accEntity.nameAr} - ${voucher.entityName}`,
      debit: baseAmount,
      credit: 0,
      currency: voucher.currency,
      exchangeRate: voucher.exchangeRate,
      memo: voucher.statement || `صرف بموجب سند صرف رقم ${voucher.voucherNumber}`,
    });
    lines.push({
      id: `jl-v-${Date.now()}-2`,
      accountId: accTreasury.id,
      accountCode: accTreasury.code,
      accountName: accTreasury.nameAr,
      debit: 0,
      credit: baseAmount,
      currency: voucher.currency,
      exchangeRate: voucher.exchangeRate,
      memo: `سند صرف رقم ${voucher.voucherNumber} - إلى: ${voucher.entityName}`,
    });
  }

  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  return {
    id: `je-auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    entryNumber,
    date: voucher.date,
    branchId: voucher.branchId,
    referenceType: voucher.type === 'قبض' ? 'سند_قبض' : 'سند_صرف',
    referenceNumber: voucher.voucherNumber,
    referenceId: voucher.id,
    description: `قيد آلي لـ ${voucher.type === 'قبض' ? 'سند قبض' : 'سند صرف'} ${voucher.voucherNumber} (${voucher.statement})`,
    lines,
    totalDebit: baseAmount,
    totalCredit: baseAmount,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates automated balanced Journal Entry for an Expense Record
 */
export function createExpenseJournalEntry(
  expense: ExpenseRecord,
  accounts: Account[],
  userFullName: string,
  existingEntryNumbers: string[] = [],
  exchangeRate: number = 1
): JournalEntry {
  const lines: JournalEntryLine[] = [];
  const rate = Number.isFinite(exchangeRate) && exchangeRate > 0 ? exchangeRate : 1;
  const baseTotal = Math.round(expense.total * rate * 100) / 100;
  const accTreasury =
    accounts.find((a) => a.id === expense.treasuryAccountId) ||
    resolveAccount(accounts, ['1111', '131'], 'أصول', ['الصندوق']);

  // Find mapped expense account in COA or fallback cleanly
  const accExpense =
    accounts.find((a) => a.id === expense.categoryId || a.nameAr.includes(expense.categoryName)) ||
    resolveAccount(accounts, ['5340', '510'], 'مصروفات', ['مصاريف']);

  lines.push({
    id: `jl-exp-${Date.now()}-1`,
    accountId: accExpense.id,
    accountCode: accExpense.code,
    accountName: accExpense.nameAr,
    debit: baseTotal,
    credit: 0,
    currency: expense.currency,
    exchangeRate: rate,
    costCenterId: expense.costCenterId,
    costCenterName: expense.costCenterName,
    memo: `مصروف: ${expense.statement} - المستفيد: ${expense.beneficiary}`,
  });

  lines.push({
    id: `jl-exp-${Date.now()}-2`,
    accountId: accTreasury.id,
    accountCode: accTreasury.code,
    accountName: accTreasury.nameAr,
    debit: 0,
    credit: baseTotal,
    currency: expense.currency,
    exchangeRate: rate,
    memo: `سداد مصروف رقم ${expense.expenseNumber} من ${accTreasury.nameAr}`,
  });

  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  return {
    id: `je-auto-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    entryNumber,
    date: expense.date,
    branchId: expense.branchId,
    referenceType: 'دليل_يدوي',
    referenceNumber: expense.expenseNumber,
    referenceId: expense.id,
    description: `قيد إثبات مصروف: ${expense.statement} - ${expense.categoryName}`,
    lines,
    totalDebit: baseTotal,
    totalCredit: baseTotal,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates a strictly balanced Journal Entry when approving a Physical Stocktaking session
 */
export function createStocktakingJournalEntry(
  stocktake: PhysicalStocktaking,
  accounts: Account[],
  surplusAccountCode: string = '4190',
  shortageAccountCode: string = '5390',
  userFullName: string,
  existingEntryNumbers: string[] = [],
  baseCurrency: CurrencyCode = 'YER'
): JournalEntry | null {
  let totalSurplusValue = 0;
  let totalShortageValue = 0;

  for (const item of stocktake.items) {
    const diff = Number(item.physicalQuantity) - Number(item.bookQuantity);
    const val = Math.abs(diff) * (Number(item.unitCost) || 0);
    if (diff > 0 && val > 0) {
      totalSurplusValue += val;
    } else if (diff < 0 && val > 0) {
      totalShortageValue += val;
    }
  }

  if (totalSurplusValue === 0 && totalShortageValue === 0) {
    return null;
  }

  const accInventory = resolveAccount(accounts, ['115', '124'], 'أصول', ['المخزون']);
  const accSurplus = resolveAccount(
    accounts,
    [surplusAccountCode, '4190', '4120'],
    'إيرادات',
    ['فائض', 'فروقات الجرد']
  );
  const accShortage = resolveAccount(
    accounts,
    [shortageAccountCode, '5390', '5340'],
    'مصروفات',
    ['عجز', 'فروقات الجرد']
  );

  const lines: JournalEntryLine[] = [];
  const ts = Date.now();
  const baseCur = baseCurrency || 'YER';

  if (totalSurplusValue > 0) {
    lines.push({
      id: `jl-st-${ts}-1`,
      accountId: accInventory.id,
      accountCode: accInventory.code,
      accountName: accInventory.nameAr,
      debit: totalSurplusValue,
      credit: 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `إثبات زيادة مخزنية لجلسة الجرد ${stocktake.stocktakeNumber}`,
    });
    lines.push({
      id: `jl-st-${ts}-2`,
      accountId: accSurplus.id,
      accountCode: accSurplus.code,
      accountName: accSurplus.nameAr,
      debit: 0,
      credit: totalSurplusValue,
      currency: baseCur,
      exchangeRate: 1,
      memo: `فائض جرد مخزني (${stocktake.stocktakeNumber})`,
    });
  }

  if (totalShortageValue > 0) {
    lines.push({
      id: `jl-st-${ts}-3`,
      accountId: accShortage.id,
      accountCode: accShortage.code,
      accountName: accShortage.nameAr,
      debit: totalShortageValue,
      credit: 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `عجز وخسائر جرد مخزني (${stocktake.stocktakeNumber})`,
    });
    lines.push({
      id: `jl-st-${ts}-4`,
      accountId: accInventory.id,
      accountCode: accInventory.code,
      accountName: accInventory.nameAr,
      debit: 0,
      credit: totalShortageValue,
      currency: baseCur,
      exchangeRate: 1,
      memo: `تخفيض المخزون بالعجز المثبت في الجرد ${stocktake.stocktakeNumber}`,
    });
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  return {
    id: `je-st-${ts}`,
    entryNumber,
    date: stocktake.date,
    branchId: 'br-01',
    referenceType: 'تسوية_مخزنية',
    referenceNumber: stocktake.stocktakeNumber,
    referenceId: stocktake.id,
    description: `قيد تسوية فروقات الجرد الفعلي رقم ${stocktake.stocktakeNumber}`,
    lines,
    totalDebit,
    totalCredit,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Creates an equal & opposite reversal Journal Entry for any posted Journal Entry
 */
export function createReversalJournalEntry(
  original: JournalEntry,
  reason: string,
  userFullName: string,
  existingEntryNumbers: string[] = []
): JournalEntry {
  const ts = Date.now();
  const prefix = `JV-${new Date().getFullYear()}-`;
  const entryNumber = generateNextDocNumber(prefix, existingEntryNumbers, 4);

  const reversedLines: JournalEntryLine[] = original.lines.map((ln, idx) => ({
    ...ln,
    id: `jl-rev-${ts}-${idx + 1}`,
    debit: ln.credit,
    credit: ln.debit,
    memo: `عكس: ${ln.memo || original.description} (${reason})`,
  }));

  const totalDebit = reversedLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = reversedLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  return {
    id: `je-rev-${ts}`,
    entryNumber,
    date: new Date().toISOString().split('T')[0],
    branchId: original.branchId,
    referenceType: original.referenceType,
    referenceNumber: original.entryNumber,
    referenceId: original.id,
    description: `قيد عكسي للقيد رقم ${original.entryNumber} - السبب: ${reason}`,
    lines: reversedLines,
    totalDebit,
    totalCredit,
    status: 'posted',
    reversedEntryId: original.id,
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Calculates General Ledger statement for an account with optional date range filtering
 */
export function calculateAccountLedger(
  accountId: string,
  journalEntries: JournalEntry[],
  accounts: Account[],
  dateRange?: DateRangeFilter
): StatementRow[] {
  const rows: StatementRow[] = [];
  const targetAccount = accounts.find(a => a.id === accountId);
  const isDebitNature = targetAccount?.nature !== 'credit';

  let runningBalance = 0;

  // Include opening imported balance if present
  const openingNet = isDebitNature
    ? (Number(targetAccount?.importedDebit) || 0) - (Number(targetAccount?.importedCredit) || 0)
    : (Number(targetAccount?.importedCredit) || 0) - (Number(targetAccount?.importedDebit) || 0);

  if (openingNet !== 0) {
    runningBalance = openingNet;
    rows.push({
      date: dateRange?.startDate || '2026-01-01',
      documentType: 'رصيد_افتتاحي',
      documentNumber: 'OP-BAL',
      statement: 'الرصيد الافتتاحي للحساب',
      debit: Number(targetAccount?.importedDebit) || 0,
      credit: Number(targetAccount?.importedCredit) || 0,
      balance: runningBalance,
    });
  }

  const sortedEntries = [...journalEntries]
    .filter(je => je.status === 'posted')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const entry of sortedEntries) {
    if (dateRange?.endDate && entry.date > dateRange.endDate) continue;
    const matchingLines = entry.lines.filter(l => l.accountId === accountId);
    for (const line of matchingLines) {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;

      if (isDebitNature) {
        runningBalance += (debit - credit);
      } else {
        runningBalance += (credit - debit);
      }

      if (dateRange?.startDate && entry.date < dateRange.startDate) {
        continue;
      }

      const baseCurr = 'YER';
      const memoMatch = String(line.memo || entry.description || '').match(
        /\[(?:العملة الأصلية:\s*)?([A-Z]{3})\s*[×x*]\s*([\d.]+)\]/i
      );
      const txCurrency =
        (line.currency && line.currency !== baseCurr ? line.currency : undefined) ||
        (memoMatch ? (memoMatch[1].toUpperCase() as CurrencyCode) : undefined) ||
        (targetAccount?.currency && targetAccount.currency !== baseCurr ? targetAccount.currency : baseCurr);
      const rawMemoRate = memoMatch ? parseFloat(memoMatch[2]) || 1 : 1;
      const effRate =
        line.currency && line.exchangeRate && line.exchangeRate !== 1
          ? line.exchangeRate
          : rawMemoRate !== 1
            ? rawMemoRate
            : 1;

      rows.push({
        date: entry.date,
        documentType: entry.referenceType,
        documentNumber: entry.referenceNumber,
        statement: line.memo || entry.description,
        debit,
        credit,
        balance: runningBalance,
        txCurrency,
        exchangeRate: effRate,
        txDebit: effRate > 1 ? Math.round((debit / effRate) * 100) / 100 : debit,
        txCredit: effRate > 1 ? Math.round((credit / effRate) * 100) / 100 : credit,
      });
    }
  }

  return rows;
}

/**
 * Generates Full Trial Balance (ميزان المراجعة)
 */
export function generateTrialBalance(
  accounts: Account[],
  journalEntries: JournalEntry[],
  dateRange?: DateRangeFilter
): TrialBalanceRow[] {
  const activeEntries = journalEntries.filter((je) => je.status === 'posted');

  const openingFromEntries = new Map<string, { debit: number; credit: number }>();
  const entryTotalsByAccId = new Map<string, { debit: number; credit: number }>();

  for (const entry of activeEntries) {
    if (dateRange?.endDate && entry.date > dateRange.endDate) continue;

    if (dateRange?.startDate && entry.date < dateRange.startDate) {
      for (const line of entry.lines) {
        const prev = openingFromEntries.get(line.accountId) || { debit: 0, credit: 0 };
        prev.debit += Number(line.debit) || 0;
        prev.credit += Number(line.credit) || 0;
        openingFromEntries.set(line.accountId, prev);
      }
      continue;
    }

    for (const line of entry.lines) {
      const prev = entryTotalsByAccId.get(line.accountId) || { debit: 0, credit: 0 };
      prev.debit += Number(line.debit) || 0;
      prev.credit += Number(line.credit) || 0;
      entryTotalsByAccId.set(line.accountId, prev);
    }
  }

  return accounts
    .filter((a) => a.isLeaf)
    .map((acc) => {
      const preEnt = openingFromEntries.get(acc.id) || { debit: 0, credit: 0 };
      const openingDebit = (Number(acc.importedDebit) || 0) + preEnt.debit;
      const openingCredit = (Number(acc.importedCredit) || 0) + preEnt.credit;
      const fromEntries = entryTotalsByAccId.get(acc.id) || { debit: 0, credit: 0 };

      const periodDebit = openingDebit + fromEntries.debit;
      const periodCredit = openingCredit + fromEntries.credit;

      let endingDebit = 0;
      let endingCredit = 0;

      if (acc.nature === 'debit') {
        const net = periodDebit - periodCredit;
        if (net >= 0) {
          endingDebit = net;
        } else {
          endingCredit = Math.abs(net);
        }
      } else {
        const net = periodCredit - periodDebit;
        if (net >= 0) {
          endingCredit = net;
        } else {
          endingDebit = Math.abs(net);
        }
      }

      return {
        accountId: acc.id,
        accountCode: acc.code,
        accountName: acc.nameAr,
        category: acc.category,
        openingDebit,
        openingCredit,
        periodDebit,
        periodCredit,
        endingDebit,
        endingCredit,
      };
    })
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * Generates Income Statement (قائمة الدخل)
 */
export function generateIncomeStatement(
  accounts: Account[],
  journalEntries: JournalEntry[],
  dateRange?: DateRangeFilter
): IncomeStatementResult {
  const tb = generateTrialBalance(accounts, journalEntries, dateRange);

  const revenues: { accountCode: string; accountName: string; amount: number }[] = [];
  const cogs: { accountCode: string; accountName: string; amount: number }[] = [];
  const expenses: { accountCode: string; accountName: string; amount: number }[] = [];

  for (const row of tb) {
    if (row.category === 'إيرادات') {
      const amount = row.endingCredit - row.endingDebit;
      if (Math.abs(amount) > 0.01) {
        revenues.push({ accountCode: row.accountCode, accountName: row.accountName, amount });
      }
    } else if (row.category === 'مصروفات') {
      const amount = row.endingDebit - row.endingCredit;
      if (Math.abs(amount) > 0.01) {
        if (row.accountCode === '5110' || row.accountCode.startsWith('3')) {
          cogs.push({ accountCode: row.accountCode, accountName: row.accountName, amount });
        } else {
          expenses.push({ accountCode: row.accountCode, accountName: row.accountName, amount });
        }
      }
    }
  }

  const totalRevenue = revenues.reduce((s, r) => s + r.amount, 0);
  const totalCogs = cogs.reduce((s, c) => s + c.amount, 0);
  const grossProfit = totalRevenue - totalCogs;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netIncome = grossProfit - totalExpenses;

  return {
    revenues,
    totalRevenue,
    cogs,
    totalCogs,
    grossProfit,
    expenses,
    totalExpenses,
    netIncome,
  };
}

/**
 * Generates Balance Sheet (الميزانية العمومية)
 */
export function generateBalanceSheet(
  accounts: Account[],
  journalEntries: JournalEntry[],
  dateRange?: DateRangeFilter
): BalanceSheetResult {
  const tb = generateTrialBalance(accounts, journalEntries, dateRange);
  const incomeStmt = generateIncomeStatement(accounts, journalEntries, dateRange);

  const assets: { accountCode: string; accountName: string; balance: number }[] = [];
  const liabilities: { accountCode: string; accountName: string; balance: number }[] = [];
  const equity: { accountCode: string; accountName: string; balance: number }[] = [];

  for (const row of tb) {
    if (row.category === 'أصول') {
      const balance = row.endingDebit - row.endingCredit;
      assets.push({ accountCode: row.accountCode, accountName: row.accountName, balance });
    } else if (row.category === 'خصوم') {
      const balance = row.endingCredit - row.endingDebit;
      liabilities.push({ accountCode: row.accountCode, accountName: row.accountName, balance });
    } else if (row.category === 'حقوق_ملكية') {
      const balance = row.endingCredit - row.endingDebit;
      equity.push({ accountCode: row.accountCode, accountName: row.accountName, balance });
    }
  }

  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.balance, 0);
  const totalEquityBase = equity.reduce((s, e) => s + e.balance, 0);

  const netProfitCarried = incomeStmt.netIncome;
  const totalEquity = totalEquityBase + netProfitCarried;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const variance = Math.abs(totalAssets - totalLiabilitiesAndEquity);
  const isBalanced = variance < 1;

  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    totalEquity,
    netProfitCarried,
    totalLiabilitiesAndEquity,
    isBalanced,
    variance,
  };
}

/**
 * Generates Cash Flow Statement (قائمة التدفقات النقدية) from operational documents & COA cash accounts
 */
export function generateCashFlowStatement(
  accounts: Account[],
  invoices: Invoice[],
  vouchers: PaymentVoucher[],
  expenses: ExpenseRecord[],
  dateRange?: DateRangeFilter,
  baseCurrency: CurrencyCode = 'YER'
): CashFlowStatementResult {
  const inRange = (d: string) => {
    if (dateRange?.startDate && d < dateRange.startDate) return false;
    if (dateRange?.endDate && d > dateRange.endDate) return false;
    return true;
  };

  const baseCode = (baseCurrency || 'YER').toUpperCase();
  const resolveDocFxRate = (curr: string | undefined, rate: number | undefined): number => {
    const code = (curr || baseCode).toUpperCase();
    if (code === baseCode) return 1;
    if (rate && rate > 0 && rate !== 1) {
      if (baseCode === 'YER' && rate < 1) return Math.round((1 / rate) * 100) / 100;
      return rate;
    }
    if (baseCode === 'YER' && code === 'SAR') return 142;
    if (baseCode === 'YER' && code === 'USD') return 535;
    return rate || 1;
  };

  const cashSales = invoices
    .filter((i) => i.type === 'مبيعات' && i.status !== 'cancelled' && inRange(i.date))
    .reduce((s, i) => s + (i.paidAmount || 0) * resolveDocFxRate(i.currency, i.exchangeRate), 0);

  const receiptsFromCustomers = vouchers
    .filter((v) => v.type === 'قبض' && v.status === 'posted' && inRange(v.date))
    .reduce((s, v) => s + (v.baseAmount || v.amount * resolveDocFxRate(v.currency, v.exchangeRate)), 0);

  const cashPurchases = invoices
    .filter((i) => i.type === 'مشتريات' && i.status !== 'cancelled' && inRange(i.date))
    .reduce((s, i) => s + (i.paidAmount || 0) * resolveDocFxRate(i.currency, i.exchangeRate), 0);

  const paymentsOut = vouchers
    .filter((v) => v.type === 'صرف' && v.status === 'posted' && inRange(v.date))
    .reduce((s, v) => s + (v.baseAmount || v.amount * v.exchangeRate), 0);

  const operatingExpensesOut = expenses
    .filter((e) => inRange(e.date))
    .reduce((s, e) => s + (e.total || 0), 0);

  const operatingInflows = [
    { label: 'تحصيلات المبيعات النقدية والدفعات الفورية', amount: cashSales },
    { label: 'متحصلات سندات القبض (عملاء وإيرادات)', amount: receiptsFromCustomers },
  ];

  const operatingOutflows = [
    { label: 'مدفوعات المشتريات النقدية', amount: cashPurchases },
    { label: 'مدفوعات سندات الصرف (موردين والتزامات)', amount: paymentsOut },
    { label: 'المصروفات التشغيلية والإدارية المسددة', amount: operatingExpensesOut },
  ];

  const totalIn = operatingInflows.reduce((s, r) => s + r.amount, 0);
  const totalOut = operatingOutflows.reduce((s, r) => s + r.amount, 0);
  const netOperatingCashFlow = totalIn - totalOut;
  const investingCashFlow = 0;
  const financingCashFlow = 0;
  const netCashChange = netOperatingCashFlow + investingCashFlow + financingCashFlow;

  const closingCashBalance = accounts
    .filter((a) => a.isLeaf && (a.code.startsWith('111') || a.code.startsWith('112') || a.code.startsWith('113')))
    .reduce((s, a) => s + (Number(a.currentBalance) || 0), 0);

  const openingCashBalance = closingCashBalance - netCashChange;

  return {
    operatingInflows,
    operatingOutflows,
    netOperatingCashFlow,
    investingCashFlow,
    financingCashFlow,
    netCashChange,
    openingCashBalance,
    closingCashBalance,
  };
}

/**
 * Generates Detailed Statement of Account for a Customer
 */
export function generateCustomerStatement(
  customerId: string,
  customer: Customer,
  invoices: Invoice[],
  vouchers: PaymentVoucher[],
  journalEntries: JournalEntry[] = [],
  dateRange?: DateRangeFilter
): StatementRow[] {
  const rows: StatementRow[] = [];
  let runningBalance = customer.openingBalance;
  const startDate = dateRange?.startDate?.trim() || '';
  const endDate = dateRange?.endDate?.trim() || '';

  // Collect customer invoices & returns & vouchers
  const customerSalesInvoices = invoices.filter(
    (inv) => inv.entityId === customerId && inv.type === 'مبيعات' && inv.status !== 'cancelled'
  );
  const customerReturns = invoices.filter(
    (inv) => inv.entityId === customerId && inv.type === 'مرتجع_مبيعات' && inv.status !== 'cancelled'
  );
  const customerPurchaseInvoices = invoices.filter(
    (inv) => inv.entityId === customerId && inv.type === 'مشتريات' && inv.status !== 'cancelled'
  );
  const customerPurchaseReturns = invoices.filter(
    (inv) => inv.entityId === customerId && inv.type === 'مرتجع_مشتريات' && inv.status !== 'cancelled'
  );
  const customerVouchers = vouchers.filter(
    (v) => v.entityId === customerId && v.status === 'posted'
  );

  // Track already-covered journalEntryIds so we never double-count bills/vouchers
  const coveredJournalIds = new Set<string>();
  customerSalesInvoices.forEach((i) => i.journalEntryId && coveredJournalIds.add(i.journalEntryId));
  customerReturns.forEach((i) => i.journalEntryId && coveredJournalIds.add(i.journalEntryId));
  customerPurchaseInvoices.forEach((i) => i.journalEntryId && coveredJournalIds.add(i.journalEntryId));
  customerPurchaseReturns.forEach((i) => i.journalEntryId && coveredJournalIds.add(i.journalEntryId));
  customerVouchers.forEach((v) => v.journalEntryId && coveredJournalIds.add(v.journalEntryId));

  const extractTaggedCurrency = (
    text: string | undefined,
    fallbackCurr: CurrencyCode | undefined,
    fallbackRate: number | undefined
  ): { curr: CurrencyCode; rate: number } => {
    if (fallbackCurr && fallbackRate && fallbackRate !== 1) {
      return { curr: fallbackCurr, rate: fallbackRate };
    }
    const m = String(text || '').match(/\[(?:العملة الأصلية:\s*)?([A-Z]{3})\s*[×x*]\s*([\d.]+)\]/i);
    if (m) {
      const code = m[1].toUpperCase() as CurrencyCode;
      const rawRate = parseFloat(m[2]) || 1;
      const normRate = rawRate > 0 && rawRate < 1 && code === 'SAR' ? Math.round((1 / rawRate) * 100) / 100 : rawRate;
      if (normRate > 0) return { curr: code, rate: normRate };
    }
    return { curr: fallbackCurr || 'YER', rate: fallbackRate || 1 };
  };

  const allEvents: {
    date: string;
    type: string;
    number: string;
    statement: string;
    debit: number;
    credit: number;
    txCurrency?: CurrencyCode;
    exchangeRate?: number;
    txDebit?: number;
    txCredit?: number;
  }[] = [];

  for (const inv of customerSalesInvoices) {
    const rate = inv.exchangeRate || 1;
    const totalBase = Math.round(inv.grandTotal * rate * 100) / 100;
    const paidBase =
      inv.paymentType === 'نقدي' ? totalBase : Math.round((inv.paidAmount || 0) * rate * 100) / 100;
    const tagged = extractTaggedCurrency(inv.notes, inv.currency, rate);
    allEvents.push({
      date: inv.date,
      type: 'فاتورة مبيعات',
      number: inv.invoiceNumber,
      statement: inv.notes || `فاتورة مبيعات ${inv.paymentType}`,
      debit: totalBase,
      credit: paidBase,
      txCurrency: tagged.curr,
      exchangeRate: tagged.rate,
      txDebit: inv.currency === tagged.curr && rate === tagged.rate ? inv.grandTotal : Math.round((totalBase / tagged.rate) * 100) / 100,
      txCredit: inv.currency === tagged.curr && rate === tagged.rate ? (inv.paymentType === 'نقدي' ? inv.grandTotal : inv.paidAmount || 0) : Math.round((paidBase / tagged.rate) * 100) / 100,
    });
  }

  for (const ret of customerReturns) {
    const rate = ret.exchangeRate || 1;
    const totalBase = Math.round(ret.grandTotal * rate * 100) / 100;
    const tagged = extractTaggedCurrency(ret.notes, ret.currency, rate);
    allEvents.push({
      date: ret.date,
      type: 'مرتجع مبيعات',
      number: ret.invoiceNumber,
      statement: ret.notes || `مرتجع مبيعات بموجب الإشعار الدائن`,
      debit: 0,
      credit: totalBase,
      txCurrency: tagged.curr,
      exchangeRate: tagged.rate,
      txDebit: 0,
      txCredit: ret.currency === tagged.curr && rate === tagged.rate ? ret.grandTotal : Math.round((totalBase / tagged.rate) * 100) / 100,
    });
  }

  for (const pinv of customerPurchaseInvoices) {
    const rate = pinv.exchangeRate || 1;
    const totalBase = Math.round(pinv.grandTotal * rate * 100) / 100;
    const paidBase =
      pinv.paymentType === 'نقدي' ? totalBase : Math.round((pinv.paidAmount || 0) * rate * 100) / 100;
    const tagged = extractTaggedCurrency(pinv.notes, pinv.currency, rate);
    allEvents.push({
      date: pinv.date,
      type: 'فاتورة مشتريات',
      number: pinv.invoiceNumber,
      statement: pinv.notes || `فاتورة مشتريات ${pinv.paymentType}`,
      debit: paidBase,
      credit: totalBase,
      txCurrency: tagged.curr,
      exchangeRate: tagged.rate,
      txDebit: Math.round((paidBase / tagged.rate) * 100) / 100,
      txCredit: Math.round((totalBase / tagged.rate) * 100) / 100,
    });
  }

  for (const pret of customerPurchaseReturns) {
    const rate = pret.exchangeRate || 1;
    const totalBase = Math.round(pret.grandTotal * rate * 100) / 100;
    const tagged = extractTaggedCurrency(pret.notes, pret.currency, rate);
    allEvents.push({
      date: pret.date,
      type: 'مرتجع مشتريات',
      number: pret.invoiceNumber,
      statement: pret.notes || `مرتجع مشتريات`,
      debit: totalBase,
      credit: 0,
      txCurrency: tagged.curr,
      exchangeRate: tagged.rate,
      txDebit: Math.round((totalBase / tagged.rate) * 100) / 100,
      txCredit: 0,
    });
  }

  for (const v of customerVouchers) {
    const baseAmt = v.amount * v.exchangeRate;
    const tagged = extractTaggedCurrency(v.statement, v.currency, v.exchangeRate);
    const origAmt = v.currency === tagged.curr && v.exchangeRate === tagged.rate ? v.amount : Math.round((baseAmt / tagged.rate) * 100) / 100;
    if (v.type === 'قبض') {
      allEvents.push({
        date: v.date,
        type: 'سند قبض',
        number: v.voucherNumber,
        statement: v.statement || 'سند قبض نقدي/بنكي',
        debit: 0,
        credit: baseAmt,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: 0,
        txCredit: origAmt,
      });
    } else if (v.type === 'صرف') {
      allEvents.push({
        date: v.date,
        type: 'سند صرف',
        number: v.voucherNumber,
        statement: v.statement || 'سند صرف / دفعة على حساب العميل',
        debit: baseAmt,
        credit: 0,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: origAmt,
        txCredit: 0,
      });
    }
  }

  // Standalone journal entries touching customer's linked account (or referencing customerId)
  if (journalEntries.length > 0) {
    for (const je of journalEntries) {
      if (je.status !== 'posted') continue;
      if (coveredJournalIds.has(je.id)) continue;

      const matchingLines = je.lines.filter(
        (ln) =>
          (customer.linkedAccountId && ln.accountId === customer.linkedAccountId) ||
          (customer.linkedAccountCode && ln.accountCode === customer.linkedAccountCode) ||
          je.referenceId === customerId
      );

      for (const ln of matchingLines) {
        const rate = ln.exchangeRate || 1;
        const debitVal = Math.round((ln.debit || 0) * 100) / 100;
        const creditVal = Math.round((ln.credit || 0) * 100) / 100;
        if (debitVal === 0 && creditVal === 0) continue;
        const tagged = extractTaggedCurrency(ln.memo, ln.currency, rate);
        allEvents.push({
          date: je.date,
          type: je.referenceType === 'دليل_يدوي' ? 'قيد يومية' : je.referenceType.replace(/_/g, ' '),
          number: je.entryNumber,
          statement: ln.memo || je.description || 'حركة قيد محاسبي',
          debit: debitVal,
          credit: creditVal,
          txCurrency: tagged.curr,
          exchangeRate: tagged.rate,
          txDebit: Math.round((debitVal / tagged.rate) * 100) / 100,
          txCredit: Math.round((creditVal / tagged.rate) * 100) / 100,
        });
      }
    }
  }

  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let priorDebitSum = customer.openingBalance > 0 ? customer.openingBalance : 0;
  let priorCreditSum = customer.openingBalance < 0 ? Math.abs(customer.openingBalance) : 0;

  for (const ev of allEvents) {
    const evDatePart = String(ev.date || '').trim().slice(0, 10);
    if (startDate && evDatePart < startDate) {
      runningBalance += ev.debit - ev.credit;
      priorDebitSum += ev.debit;
      priorCreditSum += ev.credit;
      continue;
    }
    if (endDate && evDatePart > endDate) {
      continue;
    }
    if (rows.length === 0) {
      rows.push({
        date: startDate || customer.createdAt || '2026-01-01',
        documentType: startDate ? 'رصيد_سابق' : 'رصيد_افتتاحي',
        documentNumber: startDate ? 'BF-BAL' : 'OP-BAL',
        statement: startDate ? `رصيد سابق حتى تاريخ ${startDate}` : 'الرصيد الافتتاحي للعميل',
        debit: startDate ? (runningBalance > 0 ? runningBalance : 0) : priorDebitSum,
        credit: startDate ? (runningBalance < 0 ? Math.abs(runningBalance) : 0) : priorCreditSum,
        balance: runningBalance,
      });
    }
    runningBalance += ev.debit - ev.credit;
    rows.push({
      date: ev.date,
      documentType: ev.type,
      documentNumber: ev.number,
      statement: ev.statement,
      debit: ev.debit,
      credit: ev.credit,
      balance: runningBalance,
      txCurrency: ev.txCurrency,
      exchangeRate: ev.exchangeRate,
      txDebit: ev.txDebit,
      txCredit: ev.txCredit,
    });
  }

  if (rows.length === 0) {
    rows.push({
      date: startDate || customer.createdAt || '2026-01-01',
      documentType: startDate ? 'رصيد_سابق' : 'رصيد_افتتاحي',
      documentNumber: startDate ? 'BF-BAL' : 'OP-BAL',
      statement: startDate ? `رصيد سابق حتى تاريخ ${startDate}` : 'الرصيد الافتتاحي للعميل',
      debit: runningBalance > 0 ? runningBalance : 0,
      credit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
      balance: runningBalance,
    });
  }

  return rows;
}

/**
 * Generates Detailed Statement of Account for a Vendor (credit-nature: positive = payable to vendor)
 */
export function generateVendorStatement(
  vendorId: string,
  vendor: Vendor,
  invoices: Invoice[],
  vouchers: PaymentVoucher[],
  journalEntries: JournalEntry[] = [],
  dateRange?: DateRangeFilter
): StatementRow[] {
  const rows: StatementRow[] = [];
  let runningBalance = vendor.openingBalance;
  const startDate = dateRange?.startDate?.trim() || '';
  const endDate = dateRange?.endDate?.trim() || '';

  const vendInvoices = invoices.filter(
    (inv) => inv.entityId === vendorId && inv.status !== 'cancelled'
  );
  const vendVouchers = vouchers.filter(
    (v) => v.entityId === vendorId && v.status === 'posted'
  );

  const coveredJournalIds = new Set<string>();
  vendInvoices.forEach((i) => i.journalEntryId && coveredJournalIds.add(i.journalEntryId));
  vendVouchers.forEach((v) => v.journalEntryId && coveredJournalIds.add(v.journalEntryId));

  const extractVendorTaggedCurrency = (
    text: string | undefined,
    fallbackCurr: CurrencyCode | undefined,
    fallbackRate: number | undefined
  ): { curr: CurrencyCode; rate: number } => {
    if (fallbackCurr && fallbackRate && fallbackRate !== 1) {
      return { curr: fallbackCurr, rate: fallbackRate };
    }
    const m = String(text || '').match(/\[(?:العملة الأصلية:\s*)?([A-Z]{3})\s*[×x*]\s*([\d.]+)\]/i);
    if (m) {
      const code = m[1].toUpperCase() as CurrencyCode;
      const rawRate = parseFloat(m[2]) || 1;
      const normRate = rawRate > 0 && rawRate < 1 && code === 'SAR' ? Math.round((1 / rawRate) * 100) / 100 : rawRate;
      if (normRate > 0) return { curr: code, rate: normRate };
    }
    return { curr: fallbackCurr || 'YER', rate: fallbackRate || 1 };
  };

  const allEvents: {
    date: string;
    type: string;
    number: string;
    statement: string;
    debit: number;
    credit: number;
    txCurrency?: CurrencyCode;
    exchangeRate?: number;
    txDebit?: number;
    txCredit?: number;
  }[] = [];

  for (const inv of vendInvoices) {
    const rate = inv.exchangeRate || 1;
    const totalBase = Math.round(inv.grandTotal * rate * 100) / 100;
    const paidBase =
      inv.paymentType === 'نقدي' ? totalBase : Math.round((inv.paidAmount || 0) * rate * 100) / 100;
    const tagged = extractVendorTaggedCurrency(inv.notes, inv.currency, rate);
    const txTotal = inv.currency === tagged.curr && rate === tagged.rate ? inv.grandTotal : Math.round((totalBase / tagged.rate) * 100) / 100;
    const txPaid = inv.currency === tagged.curr && rate === tagged.rate ? (inv.paymentType === 'نقدي' ? inv.grandTotal : inv.paidAmount || 0) : Math.round((paidBase / tagged.rate) * 100) / 100;
    if (inv.type === 'مشتريات') {
      allEvents.push({
        date: inv.date,
        type: 'فاتورة مشتريات',
        number: inv.invoiceNumber,
        statement: inv.notes || `فاتورة مشتريات ${inv.paymentType}`,
        debit: paidBase,
        credit: totalBase,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: txPaid,
        txCredit: txTotal,
      });
    } else if (inv.type === 'مرتجع_مشتريات') {
      allEvents.push({
        date: inv.date,
        type: 'مرتجع مشتريات',
        number: inv.invoiceNumber,
        statement: inv.notes || 'مرتجع مشتريات',
        debit: totalBase,
        credit: 0,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: txTotal,
        txCredit: 0,
      });
    } else if (inv.type === 'مبيعات') {
      allEvents.push({
        date: inv.date,
        type: 'فاتورة مبيعات',
        number: inv.invoiceNumber,
        statement: inv.notes || `فاتورة مبيعات`,
        debit: totalBase,
        credit: paidBase,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: txTotal,
        txCredit: txPaid,
      });
    } else if (inv.type === 'مرتجع_مبيعات') {
      allEvents.push({
        date: inv.date,
        type: 'مرتجع مبيعات',
        number: inv.invoiceNumber,
        statement: inv.notes || 'مرتجع مبيعات',
        debit: 0,
        credit: totalBase,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: 0,
        txCredit: txTotal,
      });
    }
  }

  for (const v of vendVouchers) {
    const baseAmt = v.amount * v.exchangeRate;
    const tagged = extractVendorTaggedCurrency(v.statement, v.currency, v.exchangeRate);
    const origAmt = v.currency === tagged.curr && v.exchangeRate === tagged.rate ? v.amount : Math.round((baseAmt / tagged.rate) * 100) / 100;
    if (v.type === 'صرف') {
      allEvents.push({
        date: v.date,
        type: 'سند صرف',
        number: v.voucherNumber,
        statement: v.statement || 'سند صرف / سداد للمورد',
        debit: baseAmt,
        credit: 0,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: origAmt,
        txCredit: 0,
      });
    } else {
      allEvents.push({
        date: v.date,
        type: 'سند قبض',
        number: v.voucherNumber,
        statement: v.statement || 'سند قبض من المورد',
        debit: 0,
        credit: baseAmt,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: 0,
        txCredit: origAmt,
      });
    }
  }

  for (const je of journalEntries) {
    if (je.status !== 'posted' || coveredJournalIds.has(je.id)) continue;
    const matchingLines = je.lines.filter(
      (ln) =>
        (vendor.linkedAccountId && ln.accountId === vendor.linkedAccountId) ||
        (vendor.linkedAccountCode && ln.accountCode === vendor.linkedAccountCode) ||
        je.referenceId === vendorId
    );
    for (const ln of matchingLines) {
      const rate = ln.exchangeRate || 1;
      const debitVal = Math.round((ln.debit || 0) * 100) / 100;
      const creditVal = Math.round((ln.credit || 0) * 100) / 100;
      if (debitVal === 0 && creditVal === 0) continue;
      const tagged = extractVendorTaggedCurrency(ln.memo, ln.currency, rate);
      allEvents.push({
        date: je.date,
        type: je.referenceType === 'دليل_يدوي' ? 'قيد يومية' : je.referenceType.replace(/_/g, ' '),
        number: je.entryNumber,
        statement: ln.memo || je.description || 'حركة قيد محاسبي',
        debit: debitVal,
        credit: creditVal,
        txCurrency: tagged.curr,
        exchangeRate: tagged.rate,
        txDebit: Math.round((debitVal / tagged.rate) * 100) / 100,
        txCredit: Math.round((creditVal / tagged.rate) * 100) / 100,
      });
    }
  }

  allEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let priorDebitSum = vendor.openingBalance < 0 ? Math.abs(vendor.openingBalance) : 0;
  let priorCreditSum = vendor.openingBalance > 0 ? vendor.openingBalance : 0;

  for (const ev of allEvents) {
    const evDatePart = String(ev.date || '').trim().slice(0, 10);
    if (startDate && evDatePart < startDate) {
      runningBalance += ev.credit - ev.debit;
      priorDebitSum += ev.debit;
      priorCreditSum += ev.credit;
      continue;
    }
    if (endDate && evDatePart > endDate) {
      continue;
    }
    if (rows.length === 0) {
      rows.push({
        date: startDate || vendor.createdAt || '2026-01-01',
        documentType: startDate ? 'رصيد_سابق' : 'رصيد_افتتاحي',
        documentNumber: startDate ? 'BF-BAL' : 'OP-BAL',
        statement: startDate ? `رصيد سابق حتى تاريخ ${startDate}` : 'الرصيد الافتتاحي للمورد',
        debit: startDate ? (runningBalance < 0 ? Math.abs(runningBalance) : 0) : priorDebitSum,
        credit: startDate ? (runningBalance > 0 ? runningBalance : 0) : priorCreditSum,
        balance: runningBalance,
      });
    }
    runningBalance += ev.credit - ev.debit;
    rows.push({
      date: ev.date,
      documentType: ev.type,
      documentNumber: ev.number,
      statement: ev.statement,
      debit: ev.debit,
      credit: ev.credit,
      balance: runningBalance,
      txCurrency: ev.txCurrency,
      exchangeRate: ev.exchangeRate,
      txDebit: ev.txDebit,
      txCredit: ev.txCredit,
    });
  }

  if (rows.length === 0) {
    rows.push({
      date: startDate || vendor.createdAt || '2026-01-01',
      documentType: startDate ? 'رصيد_سابق' : 'رصيد_افتتاحي',
      documentNumber: startDate ? 'BF-BAL' : 'OP-BAL',
      statement: startDate ? `رصيد سابق حتى تاريخ ${startDate}` : 'الرصيد الافتتاحي للمورد',
      debit: runningBalance < 0 ? Math.abs(runningBalance) : 0,
      credit: runningBalance > 0 ? runningBalance : 0,
      balance: runningBalance,
    });
  }

  return rows;
}

/**
 * Fixed Asset Sale / Disposal Journal Entry (removes gross cost & accumulated depreciation, records cash proceeds and Gain/Loss).
 */
export function createAssetDisposalJournalEntry(
  asset: FixedAsset,
  saleProceeds: number,
  treasuryId: string,
  disposalDate: string,
  accounts: Account[],
  treasuryAccounts: TreasuryAccount[],
  userFullName: string,
  existingEntryNumbers: string[] = [],
  baseCurrency: CurrencyCode = 'YER'
): JournalEntry {
  const ts = Date.now();
  const baseCur = baseCurrency || 'YER';
  const treasury = treasuryAccounts.find((t) => t.id === treasuryId);
  const accCash =
    accounts.find((a) => a.id === treasury?.generalLedgerAccountId) ||
    resolveAccount(accounts, ['1111', '1121'], 'أصول', ['الصندوق', 'البنك']);
  const accAsset =
    accounts.find((a) => a.id === asset.assetAccountId) ||
    resolveAccount(accounts, ['1210', '1220'], 'أصول', ['أصول']);
  const accAccumDep =
    accounts.find((a) => a.id === asset.accumulatedDepreciationAccountId) ||
    resolveAccount(accounts, ['1290', '123'], 'أصول', ['مجمع الإهلاك']);
  const accGain = resolveAccount(accounts, ['4190', '41'], 'إيرادات', ['أرباح', 'إيرادات أخرى']);
  const accLoss = resolveAccount(accounts, ['5390', '5340'], 'مصروفات', ['خسائر', 'مصروفات']);

  const bookValue = Math.max(0, asset.purchaseCost - asset.totalAccumulatedDepreciation);
  const gainOrLoss = Math.round((saleProceeds - bookValue) * 100) / 100;

  const lines: JournalEntryLine[] = [];
  if (saleProceeds > 0) {
    lines.push({
      id: `jl-disp-${ts}-1`,
      accountId: accCash.id,
      accountCode: accCash.code,
      accountName: accCash.nameAr,
      debit: saleProceeds,
      credit: 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `متحصلات بيع/استبعاد الأصل الثابت (${asset.nameAr})`,
    });
  }
  if (asset.totalAccumulatedDepreciation > 0) {
    lines.push({
      id: `jl-disp-${ts}-2`,
      accountId: accAccumDep.id,
      accountCode: accAccumDep.code,
      accountName: accAccumDep.nameAr,
      debit: asset.totalAccumulatedDepreciation,
      credit: 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `إقفال مجمع إهلاك الأصل (${asset.code})`,
    });
  }
  if (gainOrLoss < 0) {
    lines.push({
      id: `jl-disp-${ts}-3`,
      accountId: accLoss.id,
      accountCode: accLoss.code,
      accountName: accLoss.nameAr,
      debit: Math.abs(gainOrLoss),
      credit: 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `خسائر استبعاد/بيع الأصل (${asset.nameAr})`,
    });
  }

  lines.push({
    id: `jl-disp-${ts}-4`,
    accountId: accAsset.id,
    accountCode: accAsset.code,
    accountName: accAsset.nameAr,
    debit: 0,
    credit: asset.purchaseCost,
    currency: baseCur,
    exchangeRate: 1,
    memo: `استبعاد التكلفة الدفترية للأصل (${asset.code} - ${asset.nameAr})`,
  });

  if (gainOrLoss > 0) {
    lines.push({
      id: `jl-disp-${ts}-5`,
      accountId: accGain.id,
      accountCode: accGain.code,
      accountName: accGain.nameAr,
      debit: 0,
      credit: gainOrLoss,
      currency: baseCur,
      exchangeRate: 1,
      memo: `أرباح رأسمالية من بيع الأصل (${asset.nameAr})`,
    });
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  return {
    id: `je-disp-${ts}`,
    companyId: asset.companyId,
    entryNumber: generateNextDocNumber('JE-', existingEntryNumbers, 4),
    date: disposalDate,
    branchId: 'br-01',
    referenceType: 'استبعاد_أصل',
    referenceNumber: asset.code,
    referenceId: asset.id,
    entryType: 'normal',
    description: `قيد استبعاد/بيع أصل ثابت (${asset.code} - ${asset.nameAr}) بسعر ${saleProceeds.toLocaleString()}`,
    lines,
    totalDebit,
    totalCredit,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Year-End Closing Journal Entry: closes all Revenue & Expense balances into Retained Earnings (3200 / 3100).
 */
export function createYearEndClosingEntry(
  accounts: Account[],
  journalEntries: JournalEntry[],
  fiscalYear: string,
  closingDate: string,
  companyId: string | undefined,
  userFullName: string,
  existingEntryNumbers: string[] = [],
  baseCurrency: CurrencyCode = 'YER'
): {
  success: boolean;
  entry?: JournalEntry;
  netProfitClosed: number;
  error?: string;
} {
  const startDate = `${fiscalYear}-01-01`;
  const endDate = closingDate || `${fiscalYear}-12-31`;
  const tb = generateTrialBalance(accounts, journalEntries, { startDate, endDate });

  const ts = Date.now();
  const baseCur = baseCurrency || 'YER';
  const lines: JournalEntryLine[] = [];
  let totalRevClosed = 0;
  let totalExpClosed = 0;

  for (const row of tb) {
    if (row.category === 'إيرادات') {
      const creditBal = row.endingCredit - row.endingDebit;
      if (Math.abs(creditBal) > 0.01) {
        totalRevClosed += creditBal;
        lines.push({
          id: `jl-cls-${ts}-${row.accountId}`,
          accountId: row.accountId,
          accountCode: row.accountCode,
          accountName: row.accountName,
          debit: creditBal > 0 ? creditBal : 0,
          credit: creditBal < 0 ? Math.abs(creditBal) : 0,
          currency: baseCur,
          exchangeRate: 1,
          memo: `إقفال حساب إيراد السنة المالية ${fiscalYear}`,
        });
      }
    } else if (row.category === 'مصروفات') {
      const debitBal = row.endingDebit - row.endingCredit;
      if (Math.abs(debitBal) > 0.01) {
        totalExpClosed += debitBal;
        lines.push({
          id: `jl-cls-${ts}-${row.accountId}`,
          accountId: row.accountId,
          accountCode: row.accountCode,
          accountName: row.accountName,
          debit: debitBal < 0 ? Math.abs(debitBal) : 0,
          credit: debitBal > 0 ? debitBal : 0,
          currency: baseCur,
          exchangeRate: 1,
          memo: `إقفال حساب مصروف السنة المالية ${fiscalYear}`,
        });
      }
    }
  }

  if (lines.length === 0) {
    return {
      success: false,
      netProfitClosed: 0,
      error: `لا توجد أرصدة إيرادات أو مصروفات مفتوحة في السنة (${fiscalYear}) تحتاج إلى إقفال.`,
    };
  }

  const netProfitClosed = Math.round((totalRevClosed - totalExpClosed) * 100) / 100;
  const retainedAcc = resolveAccount(accounts, ['3200', '3100'], 'حقوق_ملكية', ['أرباح مبقاة', 'أرباح محتجزة', 'رأس المال']);

  if (Math.abs(netProfitClosed) > 0.01) {
    lines.push({
      id: `jl-cls-${ts}-ret`,
      accountId: retainedAcc.id,
      accountCode: retainedAcc.code,
      accountName: retainedAcc.nameAr,
      debit: netProfitClosed < 0 ? Math.abs(netProfitClosed) : 0,
      credit: netProfitClosed > 0 ? netProfitClosed : 0,
      currency: baseCur,
      exchangeRate: 1,
      memo: `ترحيل صافي ${netProfitClosed >= 0 ? 'ربح' : 'خسارة'} السنة المالية ${fiscalYear} إلى الأرباح المبقاة`,
    });
  }

  const totalDebit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;

  return {
    success: true,
    netProfitClosed,
    entry: {
      id: `je-close-${fiscalYear}-${ts}`,
      companyId,
      entryNumber: generateNextDocNumber('JE-', existingEntryNumbers, 4),
      date: endDate,
      branchId: 'br-01',
      referenceType: 'إقفال_سنوي',
      referenceNumber: `CLS-${fiscalYear}`,
      entryType: 'closing',
      description: `قيد الإقفال السنوي لحسابات النتيجة والترحيل للأرباح المبقاة للسنة ${fiscalYear}`,
      lines,
      totalDebit,
      totalCredit,
      status: 'posted',
      createdBy: userFullName,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Multi-Currency FX Revaluation Engine: computes unrealized revaluation difference for non-base treasuries
 * and posts balanced FX gain (4180) / FX loss (5380) journal entry.
 */
export function generateFxRevaluationJournalEntry(
  treasuryAccounts: TreasuryAccount[],
  currencies: Currency[],
  journalEntries: JournalEntry[],
  accounts: Account[],
  date: string,
  companyId: string | undefined,
  userFullName: string,
  existingEntryNumbers: string[] = [],
  companyBaseCurrency?: CurrencyCode
): {
  success: boolean;
  record?: FxRevaluationRecord;
  entry?: JournalEntry;
  error?: string;
} {
  const baseCurrency = companyBaseCurrency || currencies.find((c) => c.isBase)?.code || 'YER';
  const fxGainAcc = resolveAccount(accounts, ['4180', '4190'], 'إيرادات', ['إعادة تقييم', 'فروق']);
  const fxLossAcc = resolveAccount(accounts, ['5380', '5390'], 'مصروفات', ['إعادة تقييم', 'فروق']);

  const ts = Date.now();
  const revLines: FxRevaluationRecord['lines'] = [];
  const jeLines: JournalEntryLine[] = [];

  for (const tr of treasuryAccounts) {
    if (companyId && tr.companyId && tr.companyId !== companyId) continue;
    if (tr.currency === baseCurrency) continue;
    const curRate = currencies.find((c) => c.code === tr.currency)?.exchangeRate || 1;
    const glAcc = accounts.find((a) => a.id === tr.generalLedgerAccountId);
    if (!glAcc) continue;

    // Historical book base balance in GL for this treasury GL account (lines are stored in base currency)
    let bookBaseBalance = 0;
    for (const je of journalEntries) {
      if (je.status !== 'posted' || je.date > date) continue;
      if (companyId && je.companyId && je.companyId !== companyId) continue;
      for (const ln of je.lines) {
        if (ln.accountId === glAcc.id || ln.accountCode === glAcc.code) {
          bookBaseBalance += (Number(ln.debit) || 0) - (Number(ln.credit) || 0);
        }
      }
    }

    const revaluedBaseBalance = Math.round(tr.balance * curRate * 100) / 100;
    const diffBase = Math.round((revaluedBaseBalance - bookBaseBalance) * 100) / 100;
    if (Math.abs(diffBase) < 1) continue;

    revLines.push({
      accountName: tr.nameAr,
      currency: tr.currency,
      foreignBalance: tr.balance,
      bookBaseBalance: Math.round(bookBaseBalance * 100) / 100,
      revaluedBaseBalance,
      diffBase,
    });

    jeLines.push({
      id: `jl-fx-${ts}-${tr.id}-gl`,
      accountId: glAcc.id,
      accountCode: glAcc.code,
      accountName: glAcc.nameAr,
      debit: diffBase > 0 ? diffBase : 0,
      credit: diffBase < 0 ? Math.abs(diffBase) : 0,
      currency: baseCurrency,
      exchangeRate: 1,
      memo: `تعديل تقييم رصيد (${tr.nameAr}) بسعر صرف ${curRate}`,
    });

    if (diffBase > 0) {
      jeLines.push({
        id: `jl-fx-${ts}-${tr.id}-gain`,
        accountId: fxGainAcc.id,
        accountCode: fxGainAcc.code,
        accountName: fxGainAcc.nameAr,
        debit: 0,
        credit: diffBase,
        currency: baseCurrency,
        exchangeRate: 1,
        memo: `أرباح إعادة تقييم عملة (${tr.currency}) - ${tr.nameAr}`,
      });
    } else {
      jeLines.push({
        id: `jl-fx-${ts}-${tr.id}-loss`,
        accountId: fxLossAcc.id,
        accountCode: fxLossAcc.code,
        accountName: fxLossAcc.nameAr,
        debit: Math.abs(diffBase),
        credit: 0,
        currency: baseCurrency,
        exchangeRate: 1,
        memo: `خسائر إعادة تقييم عملة (${tr.currency}) - ${tr.nameAr}`,
      });
    }
  }

  if (jeLines.length === 0) {
    return {
      success: false,
      error: 'لا توجد فروق إعادة تقييم جوهرية في حسابات العملات الأجنبية بهذا التاريخ.',
    };
  }

  const totalDebit = Math.round(jeLines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(jeLines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  const totalGainLossBase = revLines.reduce((s, l) => s + l.diffBase, 0);
  const revNum = `FXR-${String(ts).slice(-6)}`;

  const entry: JournalEntry = {
    id: `je-fx-${ts}`,
    companyId,
    entryNumber: generateNextDocNumber('JE-', existingEntryNumbers, 4),
    date,
    branchId: 'br-01',
    referenceType: 'إعادة_تقييم_عملة',
    referenceNumber: revNum,
    entryType: 'revaluation',
    description: `قيد إعادة تقييم العملات الأجنبية بتاريخ ${date}`,
    lines: jeLines,
    totalDebit,
    totalCredit,
    status: 'posted',
    createdBy: userFullName,
    createdAt: new Date().toISOString(),
  };

  return {
    success: true,
    entry,
    record: {
      id: `fxrec-${ts}`,
      companyId,
      revaluationNumber: revNum,
      date,
      totalGainLossBase: Math.round(totalGainLossBase * 100) / 100,
      lines: revLines,
      journalEntryId: entry.id,
      performedBy: userFullName,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Historical "As-Of Date" Snapshot Calculator across Trial Balance, Income Statement, and Balance Sheet.
 */
export function calculateHistoricalStatementsAsOf(
  accounts: Account[],
  journalEntries: JournalEntry[],
  asOfDate: string
): {
  trialBalance: TrialBalanceRow[];
  incomeStatement: IncomeStatementResult;
  balanceSheet: BalanceSheetResult;
} {
  const trialBalance = generateTrialBalance(accounts, journalEntries, { endDate: asOfDate });
  const incomeStatement = generateIncomeStatement(accounts, journalEntries, { endDate: asOfDate });
  const balanceSheet = generateBalanceSheet(accounts, journalEntries, { endDate: asOfDate });
  return { trialBalance, incomeStatement, balanceSheet };
}
