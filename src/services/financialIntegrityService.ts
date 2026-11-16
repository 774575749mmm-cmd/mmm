/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Financial Integrity & Reconciliation Center
 * Detects unbalanced entries, non-leaf/inactive postings, duplicates, unlinked docs, GL-vs-subledger variances,
 * and stock-vs-movement mismatches WITHOUT mutating accounting data silently.
 */

import { ERPDatabase } from './storageService';
import { FinancialIntegrityIssue } from '../types/erp';
import { isDateInOpenFiscalPeriod } from './accountingEngine';
import { calculateInventoryValuationComparison } from './inventoryEngine';

export interface FinancialIntegrityScanReport {
  scannedAt: string;
  healthScore: number;
  criticalCount: number;
  warningCount: number;
  issues: FinancialIntegrityIssue[];
  summaryMetrics: {
    glReceivablesControlBalance: number;
    customersSubledgerSum: number;
    receivablesVariance: number;
    glPayablesControlBalance: number;
    vendorsSubledgerSum: number;
    payablesVariance: number;
    glInventoryControlBalance: number;
    warehouseValuationSum: number;
    inventoryVariance: number;
  };
}

export function runFinancialIntegrityScan(db: ERPDatabase): FinancialIntegrityScanReport {
  const issues: FinancialIntegrityIssue[] = [];
  const activeCompanyId = db.activeCompanyId || db.company.id;

  const accounts = db.chartOfAccounts.filter((a) => !a.companyId || a.companyId === activeCompanyId);
  const postedJEs = db.journalEntries.filter(
    (je) => je.status === 'posted' && (!je.companyId || je.companyId === activeCompanyId)
  );
  const invoices = db.invoices.filter((i) => !i.companyId || i.companyId === activeCompanyId);
  const vouchers = db.paymentVouchers.filter((v) => !v.companyId || v.companyId === activeCompanyId);
  const customers = db.customers.filter((c) => !c.companyId || c.companyId === activeCompanyId);
  const vendors = db.vendors.filter((v) => !v.companyId || v.companyId === activeCompanyId);

  // 1. Check Unbalanced Journal Entries & Non-Leaf / Inactive Account Postings
  const jeNumberCounts = new Map<string, number>();
  for (const je of postedJEs) {
    jeNumberCounts.set(je.entryNumber, (jeNumberCounts.get(je.entryNumber) || 0) + 1);
    const debitSum = je.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const creditSum = je.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    const diff = Math.abs(debitSum - creditSum);
    if (diff > 0.05) {
      issues.push({
        id: `int-unbal-${je.id}`,
        severity: 'critical',
        category: 'unbalanced_journal',
        titleAr: `قيد محاسبي غير متوازن (${je.entryNumber})`,
        descriptionAr: `القيد بتاريخ ${je.date} يحتوي على فارق بين المدين (${debitSum.toLocaleString()}) والدائن (${creditSum.toLocaleString()}) بمقدار ${diff.toLocaleString()}.`,
        entityType: 'journal_entry',
        entityId: je.id,
        varianceAmount: Math.round(diff * 100) / 100,
        suggestedResolutionAr: 'اعكس القيد وأعد إصداره بقيم متوازنة، أو عدّل السطور في قيد تسوية صريح.',
      });
    }

    for (const line of je.lines) {
      const acc = accounts.find((a) => a.id === line.accountId || a.code === line.accountCode);
      if (acc && !acc.isLeaf) {
        issues.push({
          id: `int-nonleaf-${je.id}-${line.id}`,
          severity: 'warning',
          category: 'non_leaf_account',
          titleAr: `ترحيل على حساب رئيسي غير طرفي (${acc.code})`,
          descriptionAr: `القيد (${je.entryNumber}) مرحل على الحساب الرئيسي "${acc.nameAr}" الذي يفترض أن يكون تجميعياً فقط.`,
          entityType: 'journal_entry',
          entityId: je.id,
          suggestedResolutionAr: 'اعكس القيد وأعد الترحيل على أحد الحسابات الفرعية الطرفية التابعة لهذا الحساب.',
        });
      }
      if (acc && acc.isActive === false) {
        issues.push({
          id: `int-inactive-${je.id}-${line.id}`,
          severity: 'warning',
          category: 'non_leaf_account',
          titleAr: `ترحيل على حساب موقوف (${acc.code})`,
          descriptionAr: `القيد (${je.entryNumber}) يستخدم الحساب الموقوف "${acc.nameAr}".`,
          entityType: 'journal_entry',
          entityId: je.id,
          suggestedResolutionAr: 'راجع حالة الحساب في شجرة الحسابات أو اعكس القيد.',
        });
      }
    }

    // Closed period scan
    const periodCheck = isDateInOpenFiscalPeriod(
      je.date,
      db.fiscalPeriods,
      activeCompanyId,
      {
        ...db.settings,
        operationalControl: {
          ...db.settings.operationalControl!,
          enforceClosedFiscalPeriodBlock: true,
        },
      },
      je.entryType === 'closing'
    );
    if (!periodCheck.allowed) {
      issues.push({
        id: `int-closed-${je.id}`,
        severity: 'warning',
        category: 'closed_period_violation',
        titleAr: `حركة ضمن فترة مالية مغلقة (${je.entryNumber})`,
        descriptionAr: `القيد بتاريخ ${je.date} يقع ضمن فترة مالية مقفلة.`,
        entityType: 'journal_entry',
        entityId: je.id,
        suggestedResolutionAr: 'تحقق من تواريخ الإقفال أو صلاحية إعادة الفتح.',
      });
    }
  }

  for (const [docNum, count] of jeNumberCounts.entries()) {
    if (count > 1) {
      issues.push({
        id: `int-dup-je-${docNum}`,
        severity: 'critical',
        category: 'duplicate_document',
        titleAr: `تكرار رقم قيد محاسبي (${docNum})`,
        descriptionAr: `يوجد ${count} قيود مرحلة بنفس الرقم (${docNum}).`,
        entityType: 'journal_entry',
        suggestedResolutionAr: 'راجع القيود المكررة واعكس الزائد منها يدوياً.',
      });
    }
  }

  // 2. Unlinked Posted Invoices & Duplicate Invoice Numbers
  const invNumCounts = new Map<string, number>();
  const jeIds = new Set(db.journalEntries.map((j) => j.id));
  for (const inv of invoices) {
    if (inv.status === 'cancelled') continue;
    invNumCounts.set(inv.invoiceNumber, (invNumCounts.get(inv.invoiceNumber) || 0) + 1);
    if (inv.status !== 'draft' && (!inv.journalEntryId || !jeIds.has(inv.journalEntryId))) {
      issues.push({
        id: `int-unlinked-inv-${inv.id}`,
        severity: 'warning',
        category: 'unlinked_document',
        titleAr: `فاتورة مرحلة بدون قيد محاسبي مرتبط (${inv.invoiceNumber})`,
        descriptionAr: `الفاتورة بمبلغ ${inv.grandTotal.toLocaleString()} حالتها (${inv.status}) ولا تشير إلى قيد موجود.`,
        entityType: 'invoice',
        entityId: inv.id,
        varianceAmount: inv.grandTotal,
        suggestedResolutionAr: 'راجع أستاذ المبيعات وأنشئ قيد تسوية يدوياً أو أعد ترحيل الفاتورة.',
      });
    }
  }
  for (const [invNum, cnt] of invNumCounts.entries()) {
    if (cnt > 1) {
      issues.push({
        id: `int-dup-inv-${invNum}`,
        severity: 'critical',
        category: 'duplicate_document',
        titleAr: `تكرار رقم فاتورة (${invNum})`,
        descriptionAr: `تكرر رقم الفاتورة (${invNum}) عدد ${cnt} مرات في السجل.`,
        entityType: 'invoice',
        suggestedResolutionAr: 'تحقق من المستند المكرر وألغِ الفاتورة الزائدة.',
      });
    }
  }

  for (const v of vouchers) {
    if (v.status === 'posted' && (!v.journalEntryId || !jeIds.has(v.journalEntryId))) {
      issues.push({
        id: `int-unlinked-vch-${v.id}`,
        severity: 'warning',
        category: 'unlinked_document',
        titleAr: `سند مالي مرحل بدون قيد مرتبط (${v.voucherNumber})`,
        descriptionAr: `السند (${v.type}) بمبلغ ${v.amount.toLocaleString()} لا يرتبط بقيد في اليومية.`,
        entityType: 'voucher',
        entityId: v.id,
        varianceAmount: v.baseAmount || v.amount,
        suggestedResolutionAr: 'أنشئ قيد تسوية للسند أو تحقق من سجل الإلغاءات.',
      });
    }
  }

  // 3. GL Control Accounts vs Subledgers (Receivables, Payables, Inventory)
  const computeAccountGlBalance = (accCodes: string[]): number => {
    const targetAccs = accounts.filter((a) => accCodes.includes(a.code));
    if (targetAccs.length === 0) return 0;
    const targetIds = new Set(targetAccs.map((a) => a.id));
    let net = 0;
    for (const acc of targetAccs) {
      if ((acc.importedDebit || 0) > 0 || (acc.importedCredit || 0) > 0) {
        net += (acc.importedDebit || 0) - (acc.importedCredit || 0);
      }
    }
    for (const je of postedJEs) {
      for (const ln of je.lines) {
        if (targetIds.has(ln.accountId) || accCodes.includes(ln.accountCode)) {
          // JournalEntryLine debit & credit are recorded in base currency
          net += (Number(ln.debit) || 0) - (Number(ln.credit) || 0);
        }
      }
    }
    return Math.round(net * 100) / 100;
  };

  const glReceivablesControlBalance = computeAccountGlBalance(['114', '121001', '121']);
  const customersSubledgerSum = Math.round(
    customers.reduce((s, c) => s + (Number(c.currentBalance) || 0), 0) * 100
  ) / 100;
  const receivablesVariance = Math.round((glReceivablesControlBalance - customersSubledgerSum) * 100) / 100;
  if (Math.abs(receivablesVariance) > 5) {
    issues.push({
      id: 'int-subledger-ar',
      severity: 'info',
      category: 'subledger_mismatch',
      titleAr: 'فارق بين حساب مراقبة العملاء (GL) ومجموع أرصدة العملاء',
      descriptionAr: `رصيد الأستاذ العام (${glReceivablesControlBalance.toLocaleString()}) مقابل مجموع أرصدة بطاقات العملاء (${customersSubledgerSum.toLocaleString()}) بفارق ${receivablesVariance.toLocaleString()}.`,
      entityType: 'customers_subledger',
      varianceAmount: receivablesVariance,
      suggestedResolutionAr: 'ينتج غالباً عن الأرصدة الافتتاحية المباشرة لبطاقات العملاء دون قيد افتتاحي موازٍ. راجع كشف المطابقة الافتتاحي.',
    });
  }

  const glPayablesControlBalance = Math.abs(computeAccountGlBalance(['2110', '221']));
  const vendorsSubledgerSum = Math.round(
    vendors.reduce((s, v) => s + (Number(v.currentBalance) || 0), 0) * 100
  ) / 100;
  const payablesVariance = Math.round((glPayablesControlBalance - vendorsSubledgerSum) * 100) / 100;
  if (Math.abs(payablesVariance) > 5) {
    issues.push({
      id: 'int-subledger-ap',
      severity: 'info',
      category: 'subledger_mismatch',
      titleAr: 'فارق بين حساب مراقبة الموردين (GL) ومجموع أرصدة الموردين',
      descriptionAr: `رصيد الأستاذ العام (${glPayablesControlBalance.toLocaleString()}) مقابل مجموع أرصدة بطاقات الموردين (${vendorsSubledgerSum.toLocaleString()}) بفارق ${payablesVariance.toLocaleString()}.`,
      entityType: 'vendors_subledger',
      varianceAmount: payablesVariance,
      suggestedResolutionAr: 'راجع الأرصدة الافتتاحية للموردين أو القيود اليدوية المباشرة على حساب 2110.',
    });
  }

  const glInventoryControlBalance = computeAccountGlBalance(['115', '124']);
  const companyStocks = db.warehouseStock.filter((ws) => !ws.companyId || ws.companyId === activeCompanyId);
  const companyItems = db.inventoryItems.filter((it) => !it.companyId || it.companyId === activeCompanyId);
  const companyLayers = (db.stockCostLayers || []).filter((l) => !l.companyId || l.companyId === activeCompanyId);
  const valuationRows = calculateInventoryValuationComparison(
    companyItems,
    companyStocks,
    companyLayers,
    activeCompanyId,
    db.company.valuationPolicy
  );
  const itemIdSet = new Set(companyItems.map((i) => i.id));
  const orphanStockValue = companyStocks
    .filter((ws) => !itemIdSet.has(ws.itemId))
    .reduce((s, ws) => s + (ws.quantityOnHand || 0) * (ws.averageCost || 0), 0);
  const warehouseValuationSum = Math.round(
    (valuationRows.reduce((s, r) => s + r.activeValuation, 0) + orphanStockValue) * 100
  ) / 100;
  const inventoryVariance = Math.round((glInventoryControlBalance - warehouseValuationSum) * 100) / 100;
  if (Math.abs(inventoryVariance) > 5) {
    issues.push({
      id: 'int-subledger-inv',
      severity: 'info',
      category: 'subledger_mismatch',
      titleAr: 'فارق بين حساب مراقبة المخزون (115) وتقييم المستودعات الفعلي',
      descriptionAr: `رصيد حساب المخزون بالأستاذ العام (${glInventoryControlBalance.toLocaleString()}) مقابل التقييم المخزني (${warehouseValuationSum.toLocaleString()}) بفارق ${inventoryVariance.toLocaleString()}.`,
      entityType: 'warehouse_stock',
      varianceAmount: inventoryVariance,
      suggestedResolutionAr: 'تحقق من أرصدة أول المدة للمخزون أو ترحيل فواتير/تسويات دون قيد مرتبط.',
    });
  }

  // 4. Negative Stock Scan (Strictly Scoped to Active Company)
  for (const ws of companyStocks) {
    if (ws.quantityOnHand < 0) {
      const item = companyItems.find((i) => i.id === ws.itemId);
      issues.push({
        id: `int-negstock-${ws.itemId}-${ws.warehouseId}`,
        severity: 'warning',
        category: 'negative_stock',
        titleAr: `رصيد مخزون بالسالب: ${item?.nameAr || ws.itemId}`,
        descriptionAr: `الكمية الفعلية المسجلة بالمستودع (${ws.warehouseId}) هي (${ws.quantityOnHand}).`,
        entityType: 'warehouse_stock',
        entityId: ws.itemId,
        varianceAmount: ws.quantityOnHand,
        suggestedResolutionAr: 'قم بإجراء تسوية جرد فعلي أو ترحيل فاتورة شراء معلقة لتغطية العجز.',
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const healthScore = Math.max(0, 100 - criticalCount * 15 - warningCount * 5);

  return {
    scannedAt: new Date().toISOString(),
    healthScore,
    criticalCount,
    warningCount,
    issues,
    summaryMetrics: {
      glReceivablesControlBalance,
      customersSubledgerSum,
      receivablesVariance,
      glPayablesControlBalance,
      vendorsSubledgerSum,
      payablesVariance,
      glInventoryControlBalance,
      warehouseValuationSum,
      inventoryVariance,
    },
  };
}
