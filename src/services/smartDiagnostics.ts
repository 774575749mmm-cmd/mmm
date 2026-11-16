/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Deterministic Health Diagnostics & AI Snapshot Builder
 */

import { ERPDatabase } from './storageService';
import { convertToBase, getEffectiveCurrencyRate, getEffectiveSarRate } from './currencyHelpers';
import { AppLanguage } from './i18n';
import type { CurrencyCode } from '../types/erp';

export type DiagnosticSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ErpDiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  category: 'accounting' | 'inventory' | 'receivables' | 'liquidity' | 'currency' | 'operations';
  title: string;
  detail: string;
  metricValue?: string;
  recommendedAction: string;
  moduleTarget: string;
  recordId?: string;
}

export interface ErpAnalyticsSnapshot {
  companyName: string;
  sarRate: number;
  usdRate: number;
  revenueBase: number;
  purchasesBase: number;
  expensesBase: number;
  grossMarginPct: number;
  collectionRatePct: number;
  totalLiquidityBase: number;
  liquidityByCurrency: { currency: string; nativeTotal: number; baseYer: number }[];
  totalReceivablesBase: number;
  totalPayablesBase: number;
  overdueReceivablesCount: number;
  negativeStockCount: number;
  lowStockCount: number;
  zeroCostItemsCount: number;
  unbalancedEntriesCount: number;
  activeCustomersCount: number;
  activeInvoicesCount: number;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function buildErpAnalyticsSnapshot(db: ERPDatabase): ErpAnalyticsSnapshot {
  const sarRate = getEffectiveSarRate(db.currencies);
  const usdRate = getEffectiveCurrencyRate(db.currencies, 'USD');

  const activeInvoices = db.invoices.filter((i) => i.status !== 'cancelled');
  const salesInvoices = activeInvoices.filter((i) => i.type === 'مبيعات');
  const salesReturns = activeInvoices.filter((i) => i.type === 'مرتجع_مبيعات');
  const purchaseInvoices = activeInvoices.filter((i) => i.type === 'مشتريات');
  const purchaseReturns = activeInvoices.filter((i) => i.type === 'مرتجع_مشتريات');

  const toBase = (amt: number, rate?: number, code?: CurrencyCode) => {
    return convertToBase(amt, code, db.currencies, rate);
  };

  const grossSales = salesInvoices.reduce((s, i) => s + toBase(i.grandTotal, i.exchangeRate, i.currency), 0);
  const totalSalesRet = salesReturns.reduce((s, i) => s + toBase(i.grandTotal, i.exchangeRate, i.currency), 0);
  const revenueBase = Math.max(0, grossSales - totalSalesRet);

  const grossPurchases = purchaseInvoices.reduce((s, i) => s + toBase(i.grandTotal, i.exchangeRate, i.currency), 0);
  const totalPurRet = purchaseReturns.reduce((s, i) => s + toBase(i.grandTotal, i.exchangeRate, i.currency), 0);
  const purchasesBase = Math.max(0, grossPurchases - totalPurRet);

  const expensesBase = db.expenseRecords.reduce(
    (s, ex) => s + toBase(ex.total, undefined, ex.currency),
    0
  );

  const cogsApprox = salesInvoices.reduce(
    (s, inv) =>
      s +
      inv.items.reduce((ls, l) => ls + (Number(l.unitCost) || 0) * (Number(l.quantity) || 0), 0) *
        (inv.exchangeRate || getEffectiveCurrencyRate(db.currencies, inv.currency)),
    0
  );
  const grossMarginPct = revenueBase > 0 ? round2(((revenueBase - cogsApprox) / revenueBase) * 100) : 0;

  const salesPaid = salesInvoices.reduce((s, i) => s + toBase(i.paidAmount, i.exchangeRate, i.currency), 0);
  const voucherReceipts = db.paymentVouchers
    .filter((v) => v.status === 'posted' && v.type === 'قبض' && v.entityType === 'عميل')
    .reduce((s, v) => s + (v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate)), 0);
  const collectionRatePct =
    revenueBase > 0 ? Math.min(100, round2(((salesPaid + voucherReceipts) / revenueBase) * 100)) : 100;

  const currBuckets = new Map<string, { nativeTotal: number; baseYer: number }>();
  db.treasuryAccounts
    .filter((t) => t.status === 'active')
    .forEach((t) => {
      const code = t.currency || 'YER';
      const rate = getEffectiveCurrencyRate(db.currencies, code);
      const prev = currBuckets.get(code) || { nativeTotal: 0, baseYer: 0 };
      currBuckets.set(code, {
        nativeTotal: round2(prev.nativeTotal + t.balance),
        baseYer: round2(prev.baseYer + t.balance * rate),
      });
    });

  const liquidityByCurrency = Array.from(currBuckets.entries()).map(([currency, v]) => ({
    currency,
    nativeTotal: v.nativeTotal,
    baseYer: v.baseYer,
  }));
  const totalLiquidityBase = liquidityByCurrency.reduce((s, x) => s + x.baseYer, 0);

  const totalReceivablesBase = db.customers.reduce((s, c) => s + Math.max(0, c.currentBalance || 0), 0);
  const totalPayablesBase = db.vendors.reduce((s, v) => s + Math.max(0, v.currentBalance || 0), 0);

  const todayMs = Date.now();
  const overdueReceivablesCount = salesInvoices.filter((inv) => {
    if (inv.remainingAmount <= 0 || !inv.dueDate) return false;
    const dueMs = Date.parse(inv.dueDate);
    return Number.isFinite(dueMs) && (todayMs - dueMs) / 86400000 > 30;
  }).length;

  const itemQtyMap = new Map<string, number>();
  db.warehouseStock.forEach((ws) => {
    itemQtyMap.set(ws.itemId, (itemQtyMap.get(ws.itemId) || 0) + (Number(ws.quantityOnHand) || 0));
  });

  let negativeStockCount = 0;
  let lowStockCount = 0;
  let zeroCostItemsCount = 0;
  db.inventoryItems.forEach((item) => {
    const qty = itemQtyMap.get(item.id) || 0;
    if (qty < 0) negativeStockCount++;
    else if (qty <= (item.minQuantityAlert || 0) && (item.minQuantityAlert || 0) > 0) lowStockCount++;
    if ((item.purchasePrice || 0) <= 0 && item.status === 'active') zeroCostItemsCount++;
  });

  const unbalancedEntriesCount = db.journalEntries.filter((je) => {
    if (je.status === 'reversed') return false;
    const d = je.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const c = je.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return Math.abs(d - c) > 0.05;
  }).length;

  return {
    companyName: db.company.nameAr,
    sarRate,
    usdRate,
    revenueBase: round2(revenueBase),
    purchasesBase: round2(purchasesBase),
    expensesBase: round2(expensesBase),
    grossMarginPct,
    collectionRatePct,
    totalLiquidityBase: round2(totalLiquidityBase),
    liquidityByCurrency,
    totalReceivablesBase: round2(totalReceivablesBase),
    totalPayablesBase: round2(totalPayablesBase),
    overdueReceivablesCount,
    negativeStockCount,
    lowStockCount,
    zeroCostItemsCount,
    unbalancedEntriesCount,
    activeCustomersCount: db.customers.length,
    activeInvoicesCount: activeInvoices.length,
  };
}

export function runErpDiagnostics(db: ERPDatabase, lang: AppLanguage = 'ar'): ErpDiagnosticFinding[] {
  const snap = buildErpAnalyticsSnapshot(db);
  const findings: ErpDiagnosticFinding[] = [];
  const isEn = lang === 'en';

  // 1. Unbalanced journal entries
  if (snap.unbalancedEntriesCount > 0) {
    findings.push({
      id: 'diag-unbalanced-je',
      severity: 'critical',
      category: 'accounting',
      title: isEn
        ? `${snap.unbalancedEntriesCount} Unbalanced Journal Entries Detected`
        : `رصد ${snap.unbalancedEntriesCount} قيد محاسبي غير متوازن`,
      detail: isEn
        ? 'Total debits do not equal total credits in posted journal entries, risking Trial Balance variance.'
        : 'إجمالي المدين لا يطابق إجمالي الدائن في بعض القيود المرحلة مما يسبب فارقاً في ميزان المراجعة.',
      metricValue: `${snap.unbalancedEntriesCount}`,
      recommendedAction: isEn
        ? 'Open Journals & Ledgers to inspect and issue reversing/correcting entries.'
        : 'انتقل إلى شاشة الدفاتر اليومية والمحاسبة لمراجعة القيود غير المتوازنة ومعالجتها بقيد عكسي.',
      moduleTarget: 'accounting',
    });
  }

  // 2. Negative treasury balances
  const negativeTreasuries = db.treasuryAccounts.filter((t) => t.status === 'active' && t.balance < 0);
  if (negativeTreasuries.length > 0) {
    const first = negativeTreasuries[0];
    findings.push({
      id: 'diag-negative-treasury',
      severity: 'critical',
      category: 'liquidity',
      title: isEn
        ? `${negativeTreasuries.length} Cash/Bank Treasury Overdrawn`
        : `عجز أو رصيد سالب في ${negativeTreasuries.length} صندوق/حساب بنكي`,
      detail: isEn
        ? `Account "${first.nameAr}" shows balance ${first.balance.toLocaleString()} ${first.currency}.`
        : `الحساب "${first.nameAr}" يظهر رصيداً سالباً قدره ${first.balance.toLocaleString()} ${first.currency}.`,
      metricValue: `${first.balance.toLocaleString()} ${first.currency}`,
      recommendedAction: isEn
        ? 'Fund the treasury via an internal transfer or check unposted receipt vouchers.'
        : 'قم بتغذية الصندوق بمناقلة مالية أو مراجعة سندات الصرف المرحلة بالخطأ.',
      moduleTarget: 'treasury',
      recordId: first.id,
    });
  }

  // 3. Negative warehouse stock
  if (snap.negativeStockCount > 0) {
    const negRow = db.warehouseStock.find((w) => w.quantityOnHand < 0);
    findings.push({
      id: 'diag-negative-stock',
      severity: 'high',
      category: 'inventory',
      title: isEn
        ? `${snap.negativeStockCount} Inventory Items Have Negative Stock`
        : `وجود ${snap.negativeStockCount} صنف بأرصدة مخزنية سالبة`,
      detail: isEn
        ? 'Negative stock skews weighted-average COGS and gross profit accuracy.'
        : 'البيع بالسالب يؤثر على دقة متوسط التكلفة المرجح وهامش الربح في قائمة الدخل.',
      metricValue: `${snap.negativeStockCount}`,
      recommendedAction: isEn
        ? 'Post missing purchase invoices or perform a physical stocktaking adjustment.'
        : 'سجل فواتير المشتريات المعلقة أو أنفذ محضر جرد فعلي لتصحيح الكميات.',
      moduleTarget: 'inventory',
      recordId: negRow?.itemId,
    });
  }

  // 4. Customer credit limit breaches
  const overLimitCustomers = db.customers.filter(
    (c) => (c.creditLimit || 0) > 0 && c.currentBalance > (c.creditLimit || 0)
  );
  if (overLimitCustomers.length > 0) {
    const top = overLimitCustomers.sort((a, b) => b.currentBalance - a.currentBalance)[0];
    findings.push({
      id: 'diag-credit-breach',
      severity: 'high',
      category: 'receivables',
      title: isEn
        ? `${overLimitCustomers.length} Customers Exceeded Credit Limit`
        : `تجاوز حد الائتمان لدى ${overLimitCustomers.length} عملاء`,
      detail: isEn
        ? `Highest exposure: ${top.nameAr} (${top.currentBalance.toLocaleString()} vs limit ${(top.creditLimit || 0).toLocaleString()}).`
        : `أعلى تجاوز: "${top.nameAr}" برصيد ${top.currentBalance.toLocaleString()} مقابل حد ائتماني ${(top.creditLimit || 0).toLocaleString()}.`,
      metricValue: `${overLimitCustomers.length}`,
      recommendedAction: isEn
        ? 'Send WhatsApp payment reminders from Reports & suspend new credit sales.'
        : 'أرسل إشعار مطالبة فوري عبر واتساب وأوقف البيع الآجل حتى السداد الجزئي.',
      moduleTarget: 'customers',
      recordId: top.id,
    });
  }

  // 5. Overdue invoices (> 30 days)
  if (snap.overdueReceivablesCount > 0) {
    findings.push({
      id: 'diag-overdue-invoices',
      severity: 'high',
      category: 'receivables',
      title: isEn
        ? `${snap.overdueReceivablesCount} Overdue Sales Invoices (> 30 Days)`
        : `${snap.overdueReceivablesCount} فاتورة مبيعات متأخرة السداد (+30 يوماً)`,
      detail: isEn
        ? `Total receivables portfolio stands at ${snap.totalReceivablesBase.toLocaleString()} YER with ${snap.collectionRatePct}% collection rate.`
        : `إجمالي ذمم العملاء يبلغ ${snap.totalReceivablesBase.toLocaleString()} ر.ي بنسبة تحصيل ${snap.collectionRatePct}%.`,
      metricValue: `${snap.overdueReceivablesCount}`,
      recommendedAction: isEn
        ? 'Review Receivables Aging report and send batch WhatsApp daily statements.'
        : 'افتح تقرير أعمار الديون وأرسل كشوفات المطالبة الجماعية للعملاء.',
      moduleTarget: 'reports',
    });
  }

  // 6. Low stock reorder alert
  if (snap.lowStockCount > 0) {
    findings.push({
      id: 'diag-low-stock',
      severity: 'medium',
      category: 'inventory',
      title: isEn
        ? `${snap.lowStockCount} Items Below Reorder Threshold`
        : `${snap.lowStockCount} صنف وصل إلى حد إعادة الطلب`,
      detail: isEn
        ? 'Stock levels hit or dropped below configured minimum threshold; potential stockout risk.'
        : 'رصيد بعض الأصناف النشطة انخفض دون الحد الأدنى المحدد، مما يهدد بتوقف المبيعات.',
      metricValue: `${snap.lowStockCount}`,
      recommendedAction: isEn
        ? 'Issue replenishment purchase orders for low-stock SKUs.'
        : 'راجع كشف المخزون وأصدر فواتير شراء لتعزيز الأرصدة الحرجة.',
      moduleTarget: 'inventory',
    });
  }

  // 7. Zero-cost inventory items
  if (snap.zeroCostItemsCount > 0) {
    findings.push({
      id: 'diag-zero-cost',
      severity: 'medium',
      category: 'inventory',
      title: isEn
        ? `${snap.zeroCostItemsCount} Active Items Have Zero Purchase Cost`
        : `${snap.zeroCostItemsCount} صنف بتكلفة شراء صفرية`,
      detail: isEn
        ? 'Items priced at 0 cost inflate reported gross margins artificially.'
        : 'الأصناف التي تكلفتها صفر تظهر أرباحاً مضخمة غير دقيقة عند البيع.',
      metricValue: `${snap.zeroCostItemsCount}`,
      recommendedAction: isEn
        ? 'Update unit purchase price in the Inventory catalog.'
        : 'حدث سعر الشراء المرجعي لتلك الأصناف في بطاقة الصنف بالمستودع.',
      moduleTarget: 'inventory',
    });
  }

  // 8. Operating expense ratio vs revenue
  if (snap.revenueBase > 0 && snap.expensesBase > snap.revenueBase * 0.45) {
    const ratio = round2((snap.expensesBase / snap.revenueBase) * 100);
    findings.push({
      id: 'diag-expense-ratio',
      severity: 'medium',
      category: 'operations',
      title: isEn
        ? `High Operating Expense Ratio (${ratio}%)`
        : `ارتفاع نسبة المصروفات التشغيلية (${ratio}% من الإيرادات)`,
      detail: isEn
        ? `Expenses (${snap.expensesBase.toLocaleString()} YER) exceed 45% of net sales.`
        : `المصروفات (${snap.expensesBase.toLocaleString()} ر.ي) تتجاوز 45% من صافي المبيعات.`,
      metricValue: `${ratio}%`,
      recommendedAction: isEn
        ? 'Audit expenses by cost center and set departmental ceilings.'
        : 'حلل المصروفات حسب مراكز التكلفة وحدد سقوفاً للإنفاق الإداري.',
      moduleTarget: 'expenses',
    });
  }

  // 9. Multi-currency SAR exposure check
  const sarLiquidity = snap.liquidityByCurrency.find((c) => c.currency === 'SAR');
  if (sarLiquidity && snap.sarRate > 1) {
    const sharePct =
      snap.totalLiquidityBase > 0 ? round2((sarLiquidity.baseYer / snap.totalLiquidityBase) * 100) : 0;
    findings.push({
      id: 'diag-sar-exposure',
      severity: 'low',
      category: 'currency',
      title: isEn
        ? `SAR Liquidity Weight: ${sharePct}% (1 SAR = ${snap.sarRate} YER)`
        : `الرصيد السعودي يشكّل ${sharePct}% من السيولة (1 ر.س = ${snap.sarRate} ر.ي)`,
      detail: isEn
        ? `Holdings in SAR equal ${sarLiquidity.nativeTotal.toLocaleString()} SAR (${sarLiquidity.baseYer.toLocaleString()} YER).`
        : `السيولة المتوفرة بالريال السعودي: ${sarLiquidity.nativeTotal.toLocaleString()} ر.س، معادل ${sarLiquidity.baseYer.toLocaleString()} ر.ي.`,
      metricValue: `${sarLiquidity.nativeTotal.toLocaleString()} SAR`,
      recommendedAction: isEn
        ? 'Verify SAR & USD exchange rates periodically in Settings > Currencies.'
        : 'تأكد دورياً من مطابقة سعر صرف الريال السعودي والدولار مع سعر السوق الفعلي.',
      moduleTarget: 'settings',
    });
  }

  return findings;
}
