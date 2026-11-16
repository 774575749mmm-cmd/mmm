/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Comprehensive Daily Management Report Module (22 KPIs + Drill-Down)
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Calendar,
  Building,
  TrendingUp,
  DollarSign,
  Download,
  Share2,
  Users,
  Package,
  AlertTriangle,
  CheckCircle2,
  Send,
  Coins,
  ShieldCheck,
  ExternalLink,
  Printer,
  ArrowRight,
  Search,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { PaymentVoucher, ExpenseRecord, Account } from '../../../types/erp';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import {
  exportToExcel,
  downloadReportAsPDF,
  printReportPreview,
  formatCurrencyValue,
} from '../../../services/exportService';
import {
  convertToBase,
  convertFromBase,
  getEffectiveCurrencyRate,
  getCurrencySymbol,
} from '../../../services/currencyHelpers';
import { rankSearchResults } from '../../../services/searchHelpers';

interface DailyManagementReportModuleProps {
  db: ERPDatabase;
  onOpenDocument?: (docType: string, docId: string) => void;
  onNavigateToRecord?: (module: string, recordId?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const DailyManagementReportModule: React.FC<DailyManagementReportModuleProps> = ({
  db,
  onOpenDocument,
  onNavigateToRecord,
  onNotify,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('all');
  const [displayCurrency, setDisplayCurrency] = useState<string>('YER');
  const [tabSearch, setTabSearch] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'kpis' | 'customers' | 'vendors' | 'inventory' | 'summary'>('kpis');
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);

  const dispSym = getCurrencySymbol(db.currencies, displayCurrency);
  const toDisp = (baseVal: number) => convertFromBase(baseVal, displayCurrency, db.currencies);

  const isMatchDate = (dateStr: string) => Boolean(dateStr && dateStr.startsWith(selectedDate));

  const todayCustomerInvoices = useMemo(
    () =>
      db.invoices.filter(
        (inv) =>
          inv.type === 'مبيعات' &&
          isMatchDate(inv.date) &&
          inv.status !== 'cancelled' &&
          (selectedBranchId === 'all' || inv.branchId === selectedBranchId)
      ),
    [db.invoices, selectedDate, selectedBranchId]
  );

  const todayCustomerReturns = useMemo(
    () =>
      db.invoices.filter(
        (inv) =>
          inv.type === 'مرتجع_مبيعات' &&
          isMatchDate(inv.date) &&
          inv.status !== 'cancelled' &&
          (selectedBranchId === 'all' || inv.branchId === selectedBranchId)
      ),
    [db.invoices, selectedDate, selectedBranchId]
  );

  const todayCustomerReceipts = useMemo(
    () =>
      db.paymentVouchers.filter(
        (v: PaymentVoucher) =>
          v.type === 'قبض' &&
          isMatchDate(v.date) &&
          v.status === 'posted' &&
          (selectedBranchId === 'all' || v.branchId === selectedBranchId)
      ),
    [db.paymentVouchers, selectedDate, selectedBranchId]
  );

  const affectedCustomers = useMemo(() => {
    const ids = new Set<string>();
    todayCustomerInvoices.forEach((i) => i.entityId && ids.add(i.entityId));
    todayCustomerReturns.forEach((i) => i.entityId && ids.add(i.entityId));
    todayCustomerReceipts.forEach((v) => v.entityId && ids.add(v.entityId));
    return db.customers.filter((c) => ids.has(c.id));
  }, [todayCustomerInvoices, todayCustomerReturns, todayCustomerReceipts, db.customers]);

  const todayVendorInvoices = useMemo(
    () =>
      db.invoices.filter(
        (inv) =>
          inv.type === 'مشتريات' &&
          isMatchDate(inv.date) &&
          inv.status !== 'cancelled' &&
          (selectedBranchId === 'all' || inv.branchId === selectedBranchId)
      ),
    [db.invoices, selectedDate, selectedBranchId]
  );

  const todayVendorReturns = useMemo(
    () =>
      db.invoices.filter(
        (inv) =>
          inv.type === 'مرتجع_مشتريات' &&
          isMatchDate(inv.date) &&
          inv.status !== 'cancelled' &&
          (selectedBranchId === 'all' || inv.branchId === selectedBranchId)
      ),
    [db.invoices, selectedDate, selectedBranchId]
  );

  const todayVendorPayments = useMemo(
    () =>
      db.paymentVouchers.filter(
        (v: PaymentVoucher) =>
          v.type === 'صرف' &&
          isMatchDate(v.date) &&
          v.status === 'posted' &&
          (selectedBranchId === 'all' || v.branchId === selectedBranchId)
      ),
    [db.paymentVouchers, selectedDate, selectedBranchId]
  );

  const kpiData = useMemo(() => {
    const toBase = (amt: number, curr?: string, explicitRate?: number) =>
      convertToBase(amt || 0, curr || 'YER', db.currencies, explicitRate);
    const grossSalesCash = todayCustomerInvoices
      .filter((i) => i.paymentType === 'نقدي')
      .reduce((s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate), 0);
    const grossSalesCredit = todayCustomerInvoices
      .filter((i) => i.paymentType !== 'نقدي')
      .reduce((s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate), 0);
    const grossSalesTotal = grossSalesCash + grossSalesCredit;
    const salesReturnsTotal = todayCustomerReturns.reduce(
      (s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate),
      0
    );
    const netSalesDaily = grossSalesTotal - salesReturnsTotal;

    const grossPurchasesCash = todayVendorInvoices
      .filter((i) => i.paymentType === 'نقدي')
      .reduce((s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate), 0);
    const grossPurchasesCredit = todayVendorInvoices
      .filter((i) => i.paymentType !== 'نقدي')
      .reduce((s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate), 0);
    const grossPurchasesTotal = grossPurchasesCash + grossPurchasesCredit;
    const purchasesReturnsTotal = todayVendorReturns.reduce(
      (s, i) => s + toBase(i.grandTotal, i.currency, i.exchangeRate),
      0
    );
    const netPurchasesDaily = grossPurchasesTotal - purchasesReturnsTotal;

    const totalReceiptsDaily = todayCustomerReceipts.reduce(
      (s, v) => s + (v.baseAmount || toBase(v.amount, v.currency, v.exchangeRate)),
      0
    );
    const totalDisbursementsDaily = todayVendorPayments.reduce(
      (s, v) => s + (v.baseAmount || toBase(v.amount, v.currency, v.exchangeRate)),
      0
    );
    const netCashFlowDaily = totalReceiptsDaily - totalDisbursementsDaily;

    const todayExpenses = db.expenseRecords.filter(
      (e: ExpenseRecord) =>
        isMatchDate(e.date) && (selectedBranchId === 'all' || e.branchId === selectedBranchId)
    );
    const totalExpensesDaily = todayExpenses.reduce(
      (s, e) => s + toBase(e.total || e.amount || 0, e.currency),
      0
    );

    const treasuryAccounts = db.chartOfAccounts.filter((a: Account) => a.code.startsWith('111'));
    const bankAccounts = db.chartOfAccounts.filter((a: Account) => a.code.startsWith('112') || a.code.startsWith('113'));
    const totalTreasuriesBalance = treasuryAccounts.reduce((s, a) => s + (a.currentBalance || 0), 0);
    const totalBanksBalance = bankAccounts.reduce((s, a) => s + (a.currentBalance || 0), 0);
    const totalLiquidAssets = totalTreasuriesBalance + totalBanksBalance;

    const usdRate = getEffectiveCurrencyRate(db.currencies, 'USD');
    const sarRate = getEffectiveCurrencyRate(db.currencies, 'SAR');

    const totalCustomerDebts = db.customers.reduce((s, c) => s + Math.max(0, c.currentBalance || 0), 0);
    const totalVendorPayables = db.vendors.reduce((s, v) => s + Math.max(0, v.currentBalance || 0), 0);
    const netCreditPosition = totalCustomerDebts - totalVendorPayables;

    let cogsToday = 0;
    todayCustomerInvoices.forEach((inv) => {
      const invRate = getEffectiveCurrencyRate(db.currencies, inv.currency, inv.exchangeRate);
      inv.items.forEach((line) => {
        const itemDef = db.inventoryItems.find((it) => it.id === line.itemId);
        const cost = itemDef ? itemDef.purchasePrice : line.unitPrice * invRate * 0.75;
        cogsToday += cost * line.quantity;
      });
    });
    const grossProfitDaily = netSalesDaily - cogsToday;

    return {
      grossSalesTotal,
      grossSalesCash,
      grossSalesCredit,
      salesReturnsTotal,
      netSalesDaily,
      grossPurchasesTotal,
      grossPurchasesCash,
      grossPurchasesCredit,
      purchasesReturnsTotal,
      netPurchasesDaily,
      totalReceiptsDaily,
      totalDisbursementsDaily,
      netCashFlowDaily,
      totalExpensesDaily,
      totalTreasuriesBalance,
      totalBanksBalance,
      totalLiquidAssets,
      yerLiquid: totalLiquidAssets,
      usdEstimate: totalLiquidAssets / usdRate,
      sarEstimate: totalLiquidAssets / sarRate,
      usdRate,
      sarRate,
      totalCustomerDebts,
      totalVendorPayables,
      netCreditPosition,
      cogsToday,
      grossProfitDaily,
    };
  }, [
    todayCustomerInvoices,
    todayCustomerReturns,
    todayCustomerReceipts,
    todayVendorInvoices,
    todayVendorReturns,
    todayVendorPayments,
    db.expenseRecords,
    db.chartOfAccounts,
    db.customers,
    db.vendors,
    db.inventoryItems,
    db.currencies,
    selectedBranchId,
    selectedDate,
  ]);

  const todayStockMovements = useMemo(
    () => db.stockMovements.filter((m) => isMatchDate(m.movementDate)),
    [db.stockMovements, selectedDate]
  );

  const totalStockValuation = useMemo(
    () =>
      db.inventoryItems.reduce((acc, item) => {
        const stockTotal = db.warehouseStock
          .filter((ws) => ws.itemId === item.id)
          .reduce((sum, ws) => sum + ws.quantityOnHand, 0);
        return acc + stockTotal * item.purchasePrice;
      }, 0),
    [db.inventoryItems, db.warehouseStock]
  );

  const highestSaleInvoice = useMemo(
    () =>
      todayCustomerInvoices.length
        ? [...todayCustomerInvoices].sort(
            (a, b) =>
              convertToBase(b.grandTotal, b.currency, db.currencies, b.exchangeRate) -
              convertToBase(a.grandTotal, a.currency, db.currencies, a.exchangeRate)
          )[0]
        : null,
    [todayCustomerInvoices, db.currencies]
  );

  const highestReceipt = useMemo(
    () =>
      todayCustomerReceipts.length
        ? [...todayCustomerReceipts].sort(
            (a, b) =>
              (b.baseAmount || convertToBase(b.amount, b.currency, db.currencies, b.exchangeRate)) -
              (a.baseAmount || convertToBase(a.amount, a.currency, db.currencies, a.exchangeRate))
          )[0]
        : null,
    [todayCustomerReceipts, db.currencies]
  );

  const filteredTodayCustomerInvoices = useMemo(() => {
    if (!tabSearch.trim()) return todayCustomerInvoices;
    return rankSearchResults(
      todayCustomerInvoices,
      tabSearch,
      (i) => ({ code: i.invoiceNumber, id: i.id, name: `${i.entityName} ${i.paymentType} ${i.currency}` }),
      Math.max(todayCustomerInvoices.length, 100)
    );
  }, [todayCustomerInvoices, tabSearch]);

  const filteredAffectedCustomers = useMemo(() => {
    if (!tabSearch.trim()) return affectedCustomers;
    return rankSearchResults(
      affectedCustomers,
      tabSearch,
      (c) => ({ code: c.code, id: c.id, name: c.nameAr, phone: c.phone }),
      Math.max(affectedCustomers.length, 100)
    );
  }, [affectedCustomers, tabSearch]);

  const filteredTodayVendorInvoices = useMemo(() => {
    if (!tabSearch.trim()) return todayVendorInvoices;
    return rankSearchResults(
      todayVendorInvoices,
      tabSearch,
      (i) => ({ code: i.invoiceNumber, id: i.id, name: `${i.entityName} ${i.currency}` }),
      Math.max(todayVendorInvoices.length, 100)
    );
  }, [todayVendorInvoices, tabSearch]);

  const filteredTodayVendorPayments = useMemo(() => {
    if (!tabSearch.trim()) return todayVendorPayments;
    return rankSearchResults(
      todayVendorPayments,
      tabSearch,
      (v) => ({ code: v.voucherNumber, id: v.id, name: `${v.entityName} ${v.statement || ''}` }),
      Math.max(todayVendorPayments.length, 100)
    );
  }, [todayVendorPayments, tabSearch]);

  const filteredTodayStockMovements = useMemo(() => {
    if (!tabSearch.trim()) return todayStockMovements;
    return rankSearchResults(
      todayStockMovements,
      tabSearch,
      (m) => {
        const item = db.inventoryItems.find((i) => i.id === m.itemId);
        return { code: `${m.documentNumber} ${item?.code || ''}`, barcode: item?.barcode, id: m.id, name: `${item?.nameAr || m.itemId} ${m.documentType}` };
      },
      Math.max(todayStockMovements.length, 100)
    );
  }, [todayStockMovements, tabSearch, db.inventoryItems]);

  const lowStockAlerts = useMemo(
    () =>
      db.inventoryItems.filter((item) => {
        const qty = db.warehouseStock
          .filter((ws) => ws.itemId === item.id)
          .reduce((sum, ws) => sum + ws.quantityOnHand, 0);
        return qty <= item.minQuantityAlert;
      }),
    [db.inventoryItems, db.warehouseStock]
  );

  const overdueCustomers = useMemo(
    () => db.customers.filter((c) => c.currentBalance > c.creditLimit),
    [db.customers]
  );

  const generateWhatsAppSummary = () => {
    const branchName =
      selectedBranchId === 'all'
        ? 'جميع الفروع'
        : db.branches.find((b) => b.id === selectedBranchId)?.nameAr || '';
    return [
      `📊 *تقرير الإدارة اليومي الشامل - ${db.company.nameAr}*`,
      `📅 *التاريخ:* ${selectedDate}`,
      `🏢 *الفرع:* ${branchName}`,
      `---------------------------------------`,
      `💰 *صافي المبيعات:* ${kpiData.netSalesDaily.toLocaleString()} ر.ي (نقدي: ${kpiData.grossSalesCash.toLocaleString()} | آجل: ${kpiData.grossSalesCredit.toLocaleString()})`,
      `🛒 *صافي المشتريات:* ${kpiData.netPurchasesDaily.toLocaleString()} ر.ي`,
      `💵 *المقبوضات اليومية:* ${kpiData.totalReceiptsDaily.toLocaleString()} ر.ي`,
      `💳 *المدفوعات اليومية:* ${kpiData.totalDisbursementsDaily.toLocaleString()} ر.ي`,
      `📈 *صافي التدفق النقدي:* ${kpiData.netCashFlowDaily.toLocaleString()} ر.ي`,
      `🏦 *إجمالي السيولة الجاهزة:* ${kpiData.totalLiquidAssets.toLocaleString()} ر.ي`,
      `👥 *إجمالي ديون العملاء:* ${kpiData.totalCustomerDebts.toLocaleString()} ر.ي`,
      `🏭 *إجمالي التزامات الموردين:* ${kpiData.totalVendorPayables.toLocaleString()} ر.ي`,
      `✨ *مجمل الربح التقديري:* ${kpiData.grossProfitDaily.toLocaleString()} ر.ي`,
      `📦 *قيمة المخزون الكلي:* ${totalStockValuation.toLocaleString()} ر.ي`,
    ].join('\n');
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(generateWhatsAppSummary());
      setCopiedSuccess(true);
      onNotify?.('success', 'تم نسخ ملخص التقرير اليومي إلى الحافظة.');
      setTimeout(() => setCopiedSuccess(false), 2500);
    } catch {
      onNotify?.('error', 'تعذر النسخ التلقائي للحافظة.');
    }
  };

  const kpiRowsForExport = [
    ['1', 'إجمالي المبيعات الإجمالية', toDisp(kpiData.grossSalesTotal), 'مبيعات'],
    ['2', 'المبيعات النقدية المحصلة', toDisp(kpiData.grossSalesCash), 'مبيعات'],
    ['3', 'المبيعات الآجلة', toDisp(kpiData.grossSalesCredit), 'مبيعات'],
    ['4', 'مردودات المبيعات', toDisp(kpiData.salesReturnsTotal), 'مبيعات'],
    ['5', 'صافي المبيعات اليومية', toDisp(kpiData.netSalesDaily), 'صافي أداء'],
    ['6', 'إجمالي المشتريات الإجمالية', toDisp(kpiData.grossPurchasesTotal), 'مشتريات'],
    ['7', 'المشتريات النقدية', toDisp(kpiData.grossPurchasesCash), 'مشتريات'],
    ['8', 'المشتريات الآجلة', toDisp(kpiData.grossPurchasesCredit), 'مشتريات'],
    ['9', 'مردودات المشتريات', toDisp(kpiData.purchasesReturnsTotal), 'مشتريات'],
    ['10', 'صافي المشتريات اليومية', toDisp(kpiData.netPurchasesDaily), 'صافي أداء'],
    ['11', 'إجمالي المقبوضات', toDisp(kpiData.totalReceiptsDaily), 'سيولة'],
    ['12', 'إجمالي المدفوعات', toDisp(kpiData.totalDisbursementsDaily), 'سيولة'],
    ['13', 'صافي التدفق النقدي', toDisp(kpiData.netCashFlowDaily), 'تدفق نقدي'],
    ['14', 'المصروفات التشغيلية', toDisp(kpiData.totalExpensesDaily), 'مصروفات'],
    ['15', 'أرصدة الخزائن النقدية', toDisp(kpiData.totalTreasuriesBalance), 'سيولة'],
    ['16', 'أرصدة البنوك والمصارف', toDisp(kpiData.totalBanksBalance), 'سيولة'],
    ['17', 'إجمالي السيولة الجاهزة', toDisp(kpiData.totalLiquidAssets), 'سيولة كلية'],
    ['18', 'إجمالي ديون العملاء', toDisp(kpiData.totalCustomerDebts), 'ذمم مدينة'],
    ['19', 'إجمالي التزامات الموردين', toDisp(kpiData.totalVendorPayables), 'ذمم دائنة'],
    ['20', 'صافي المركز الائتماني', toDisp(kpiData.netCreditPosition), 'ائتمان'],
    ['21', 'تكلفة البضاعة المباعة (COGS)', toDisp(kpiData.cogsToday), 'تكاليف'],
    ['22', 'مجمل الربح التقديري', toDisp(kpiData.grossProfitDaily), 'أرباح'],
  ];

  const handleExportExcel = () => {
    exportToExcel({
      fileName: `التقرير_الإداري_اليومي_${selectedDate}`,
      sheets: [
        {
          name: 'المؤشرات 22',
          data: [
            ['التقرير الإداري اليومي الشامل'],
            [`التاريخ: ${selectedDate}`],
            [`عملة العرض: ${displayCurrency} (${dispSym})`],
            [],
            ['#', 'المؤشر', `القيمة (${dispSym})`, 'التصنيف'],
            ...kpiRowsForExport,
          ],
        },
        {
          name: 'فواتير اليوم',
          data: [
            ['رقم الفاتورة', 'العميل', 'السداد', 'العملة', 'الإجمالي بالعملة', 'المدفوع بالعملة', 'المتبقي بالعملة'],
            ...todayCustomerInvoices.map((i) => [
              i.invoiceNumber,
              i.entityName,
              i.paymentType,
              i.currency || 'YER',
              i.grandTotal,
              i.paidAmount,
              i.remainingAmount,
            ]),
          ],
        },
      ],
    });
    onNotify?.('success', 'تم تصدير التقرير الإداري اليومي إلى Excel.');
  };

  const buildPdfPayload = () => {
    const branchName =
      selectedBranchId === 'all'
        ? 'كافة الفروع'
        : db.branches.find((b) => b.id === selectedBranchId)?.nameAr || '';
    return {
      title: 'التقرير الإداري والمالي اليومي الشامل (22 مؤشراً)',
      subtitle: `أداء المبيعات والسيولة والمخزون والذمم ليوم ${selectedDate} — العملة: ${displayCurrency} (${dispSym})`,
      periodText: selectedDate,
      reportCode: `EOD-${selectedDate.replace(/-/g, '')}`,
      company: db.company,
      branch:
        selectedBranchId !== 'all'
          ? db.branches.find((b) => b.id === selectedBranchId)
          : db.branches[0],
      preparedBy: 'الإدارة المالية',
      metadata: {
        'التاريخ': selectedDate,
        'الفرع': branchName,
        'صافي المبيعات': `${toDisp(kpiData.netSalesDaily).toLocaleString()} ${dispSym}`,
        'صافي التدفق النقدي': `${toDisp(kpiData.netCashFlowDaily).toLocaleString()} ${dispSym}`,
        'إجمالي السيولة': `${toDisp(kpiData.totalLiquidAssets).toLocaleString()} ${dispSym}`,
        'مجمل الربح': `${toDisp(kpiData.grossProfitDaily).toLocaleString()} ${dispSym}`,
      },
      tables: [
        {
          title: `المؤشرات التنفيذية الـ 22 (${dispSym})`,
          headers: ['#', 'المؤشر المالي', `القيمة (${dispSym})`, 'التصنيف'],
          rows: kpiRowsForExport.map((r) => [r[0], r[1], `${Number(r[2]).toLocaleString()} ${dispSym}`, r[3]]),
        },
      ],
    };
  };

  const handleExportPDF = async () => {
    await downloadReportAsPDF(buildPdfPayload());
    onNotify?.('success', 'تم تصدير التقرير الإداري اليومي بصيغة PDF بنجاح.');
  };

  const drillTo = (module: string, id?: string) => {
    if (onNavigateToRecord) {
      onNavigateToRecord(module, id);
    } else if (onOpenDocument && id) {
      onOpenDocument(module, id);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <FileText className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-lg font-black text-white">التقرير الإداري والمالي اليومي الشامل</h2>
              <p className="text-xs text-slate-400">
                متابعة فورية لـ 22 مؤشراً مالياً وتشغيلياً مع إمكانية النقر للانتقال إلى السجل المصدر
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onNavigateToRecord && (
              <button
                type="button"
                onClick={() => onNavigateToRecord('reports')}
                className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>مركز التقارير</span>
              </button>
            )}

            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-white text-xs font-mono font-bold focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
              <Building className="w-4 h-4 text-amber-400" />
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="bg-transparent text-white text-xs font-bold focus:outline-none cursor-pointer"
              >
                <option value="all" className="bg-slate-900">جميع الفروع</option>
                {db.branches.map((b) => (
                  <option key={b.id} value={b.id} className="bg-slate-900">{b.nameAr}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 bg-slate-950 border border-amber-500/40 px-3 py-1.5 rounded-xl" title="تغيير عملة عرض جميع المؤشرات">
              <Coins className="w-4 h-4 text-amber-400" />
              <select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value)}
                className="bg-transparent text-amber-300 text-xs font-black focus:outline-none cursor-pointer"
              >
                {db.currencies.map((c) => (
                  <option key={c.code} value={c.code} className="bg-slate-900 text-white">
                    عرض بـ {c.code} ({c.symbol})
                  </option>
                ))}
              </select>
            </div>

            <button type="button" onClick={handleExportPDF} className="flex items-center gap-1 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            <button type="button" onClick={handleExportExcel} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button type="button" onClick={() => printReportPreview(buildPdfPayload())} className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer">
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
            <button type="button" onClick={() => setWaModalOpen(true)} className="flex items-center gap-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl cursor-pointer">
              <Send className="w-3.5 h-3.5" />
              <span>واتساب</span>
            </button>
            <button type="button" onClick={handleCopySummary} className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer">
              {copiedSuccess ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{copiedSuccess ? 'تم النسخ' : 'نسخ'}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs + Quick Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            {[
              { id: 'kpis', label: 'المؤشرات الـ 22 والسيولة', icon: <Coins className="w-4 h-4" /> },
              { id: 'customers', label: `حركة العملاء (${todayCustomerInvoices.length + todayCustomerReceipts.length})`, icon: <Users className="w-4 h-4" /> },
              { id: 'vendors', label: `حركة الموردين (${todayVendorInvoices.length + todayVendorPayments.length})`, icon: <Building className="w-4 h-4" /> },
              { id: 'inventory', label: `حركة المخزون (${todayStockMovements.length})`, icon: <Package className="w-4 h-4" /> },
              { id: 'summary', label: 'الملخص التنفيذي والتنبيهات', icon: <ShieldCheck className="w-4 h-4" /> },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {(activeTab === 'customers' || activeTab === 'vendors' || activeTab === 'inventory') && (
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={tabSearch}
                onChange={(e) => setTabSearch(e.target.value)}
                placeholder="بحث برقم المستند أو الاسم..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-8 pl-3 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* SECTION 1: 22 KPIs */}
      {activeTab === 'kpis' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button type="button" onClick={() => drillTo('sales')} className="text-right bg-slate-900 hover:border-emerald-500/50 border border-slate-800 rounded-2xl p-4 transition-colors cursor-pointer">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>صافي المبيعات اليومية</span>
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-xl font-black text-white font-mono tabular-nums">{toDisp(kpiData.netSalesDaily).toLocaleString()} {dispSym}</div>
              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>نقدي: {toDisp(kpiData.grossSalesCash).toLocaleString()}</span>
                <span>آجل: {toDisp(kpiData.grossSalesCredit).toLocaleString()}</span>
              </div>
            </button>

            <button type="button" onClick={() => drillTo('treasury')} className="text-right bg-slate-900 hover:border-amber-500/50 border border-slate-800 rounded-2xl p-4 transition-colors cursor-pointer">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>صافي التدفق النقدي اليومي</span>
                <DollarSign className="w-4 h-4 text-amber-400" />
              </div>
              <div className={`text-xl font-black font-mono tabular-nums ${kpiData.netCashFlowDaily >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {toDisp(kpiData.netCashFlowDaily).toLocaleString()} {dispSym}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>قبض: {toDisp(kpiData.totalReceiptsDaily).toLocaleString()}</span>
                <span>صرف: {toDisp(kpiData.totalDisbursementsDaily).toLocaleString()}</span>
              </div>
            </button>

            <button type="button" onClick={() => drillTo('treasury')} className="text-right bg-slate-900 hover:border-cyan-500/50 border border-slate-800 rounded-2xl p-4 transition-colors cursor-pointer">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>إجمالي السيولة الجاهزة</span>
                <Coins className="w-4 h-4 text-cyan-400" />
              </div>
              <div className="text-xl font-black text-cyan-400 font-mono tabular-nums">{toDisp(kpiData.totalLiquidAssets).toLocaleString()} {dispSym}</div>
              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>صناديق: {toDisp(kpiData.totalTreasuriesBalance).toLocaleString()}</span>
                <span>بنوك: {toDisp(kpiData.totalBanksBalance).toLocaleString()}</span>
              </div>
            </button>

            <button type="button" onClick={() => drillTo('accounting')} className="text-right bg-slate-900 hover:border-teal-500/50 border border-slate-800 rounded-2xl p-4 transition-colors cursor-pointer">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>مجمل الربح التقديري اليومي</span>
                <TrendingUp className="w-4 h-4 text-teal-400" />
              </div>
              <div className="text-xl font-black text-teal-400 font-mono tabular-nums">{toDisp(kpiData.grossProfitDaily).toLocaleString()} {dispSym}</div>
              <div className="text-[11px] text-slate-400 mt-1">تكلفة المبيعات: {toDisp(kpiData.cogsToday).toLocaleString()} {dispSym}</div>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">جدول المؤشرات المالية والتشغيلية الـ 22</h3>
              <span className="text-xs text-amber-300 font-bold">معبّر عنه بعملة العرض: {displayCurrency} ({dispSym})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-800 p-4 gap-4 text-xs">
              <div className="space-y-2.5 md:pl-4">
                <h4 className="font-black text-amber-400 border-b border-slate-800 pb-2">1. المبيعات والإيرادات (1 - 5)</h4>
                <div className="flex justify-between"><span>1. إجمالي المبيعات:</span><span className="font-mono font-bold text-white tabular-nums">{toDisp(kpiData.grossSalesTotal).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>2. المبيعات النقدية:</span><span className="font-mono text-emerald-400 tabular-nums">{toDisp(kpiData.grossSalesCash).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>3. المبيعات الآجلة:</span><span className="font-mono text-amber-300 tabular-nums">{toDisp(kpiData.grossSalesCredit).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>4. مردودات المبيعات:</span><span className="font-mono text-rose-400 tabular-nums">-{toDisp(kpiData.salesReturnsTotal).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between bg-slate-800/50 p-2 rounded-lg font-bold text-emerald-300"><span>5. صافي المبيعات:</span><span className="font-mono tabular-nums">{toDisp(kpiData.netSalesDaily).toLocaleString()} {dispSym}</span></div>
              </div>

              <div className="space-y-2.5 md:px-4">
                <h4 className="font-black text-cyan-400 border-b border-slate-800 pb-2">2. المشتريات والتكلفة والربح (6-10، 21-22)</h4>
                <div className="flex justify-between"><span>6. إجمالي المشتريات:</span><span className="font-mono font-bold text-white tabular-nums">{toDisp(kpiData.grossPurchasesTotal).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>7. المشتريات النقدية:</span><span className="font-mono tabular-nums">{toDisp(kpiData.grossPurchasesCash).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>8. المشتريات الآجلة:</span><span className="font-mono text-amber-300 tabular-nums">{toDisp(kpiData.grossPurchasesCredit).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>9. مردودات المشتريات:</span><span className="font-mono text-emerald-400 tabular-nums">{toDisp(kpiData.purchasesReturnsTotal).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>10. صافي المشتريات:</span><span className="font-mono text-cyan-300 tabular-nums">{toDisp(kpiData.netPurchasesDaily).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>21. تكلفة البضاعة المباعة:</span><span className="font-mono text-rose-300 tabular-nums">{toDisp(kpiData.cogsToday).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between bg-slate-800/50 p-2 rounded-lg font-bold text-teal-300"><span>22. مجمل الربح التقديري:</span><span className="font-mono tabular-nums">{toDisp(kpiData.grossProfitDaily).toLocaleString()} {dispSym}</span></div>
              </div>

              <div className="space-y-2.5 md:pr-4">
                <h4 className="font-black text-emerald-400 border-b border-slate-800 pb-2">3. السيولة والمركز الائتماني (11 - 20)</h4>
                <div className="flex justify-between"><span>11. المقبوضات:</span><span className="font-mono text-emerald-400 tabular-nums">+{toDisp(kpiData.totalReceiptsDaily).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>12. المدفوعات:</span><span className="font-mono text-rose-400 tabular-nums">-{toDisp(kpiData.totalDisbursementsDaily).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>13. صافي التدفق:</span><span className="font-mono font-bold text-white tabular-nums">{toDisp(kpiData.netCashFlowDaily).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>14. المصروفات اليومية:</span><span className="font-mono text-rose-300 tabular-nums">{toDisp(kpiData.totalExpensesDaily).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>15. أرصدة الصناديق:</span><span className="font-mono tabular-nums">{toDisp(kpiData.totalTreasuriesBalance).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>16. أرصدة البنوك:</span><span className="font-mono tabular-nums">{toDisp(kpiData.totalBanksBalance).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>17. إجمالي السيولة:</span><span className="font-mono font-bold text-cyan-400 tabular-nums">{toDisp(kpiData.totalLiquidAssets).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>18. ديون العملاء:</span><span className="font-mono text-amber-400 tabular-nums">{toDisp(kpiData.totalCustomerDebts).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between"><span>19. مستحقات الموردين:</span><span className="font-mono text-rose-400 tabular-nums">{toDisp(kpiData.totalVendorPayables).toLocaleString()} {dispSym}</span></div>
                <div className="flex justify-between bg-slate-800/50 p-2 rounded-lg font-bold text-emerald-300"><span>20. صافي المركز الائتماني:</span><span className="font-mono tabular-nums">{toDisp(kpiData.netCreditPosition).toLocaleString()} {dispSym}</span></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <span className="text-xs text-slate-400 block mb-1">السيولة بالريال اليمني (YER)</span>
              <span className="text-lg font-black text-white font-mono">{kpiData.yerLiquid.toLocaleString()}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <span className="text-xs text-slate-400 block mb-1">المعادل بالدولار (سعر {kpiData.usdRate})</span>
              <span className="text-lg font-black text-emerald-400 font-mono">${Math.round(kpiData.usdEstimate).toLocaleString()}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 text-center">
              <span className="text-xs text-slate-400 block mb-1">المعادل بالريال السعودي (سعر {kpiData.sarRate})</span>
              <span className="text-lg font-black text-amber-400 font-mono">{Math.round(kpiData.sarEstimate).toLocaleString()} ر.س</span>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: CUSTOMERS */}
      {activeTab === 'customers' && (
        <div className="space-y-5">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">فواتير ومردودات العملاء اليومية</h3>
              <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">صافي المبيعات: {toDisp(kpiData.netSalesDaily).toLocaleString()} {dispSym}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-3 px-4">رقم الفاتورة</th>
                    <th className="py-3 px-4">العميل</th>
                    <th className="py-3 px-4">السداد</th>
                    <th className="py-3 px-4 text-left">الإجمالي</th>
                    <th className="py-3 px-4 text-left">المتبقي</th>
                    <th className="py-3 px-4 text-center">فتح</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {filteredTodayCustomerInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-bold text-amber-400">{inv.invoiceNumber}</td>
                      <td className="py-2.5 px-4 font-sans text-white">{inv.entityName}</td>
                      <td className="py-2.5 px-4 font-sans">{inv.paymentType}</td>
                      <td className="py-2.5 px-4 text-left font-bold text-white tabular-nums">
                        {inv.grandTotal.toLocaleString()} {getCurrencySymbol(db.currencies, inv.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-left text-rose-400 tabular-nums">
                        {inv.remainingAmount.toLocaleString()} {getCurrencySymbol(db.currencies, inv.currency)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button type="button" onClick={() => drillTo('sales', inv.id)} className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 rounded text-[11px] font-bold cursor-pointer">
                          <ExternalLink className="w-3 h-3" />
                          <span>عرض</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredTodayCustomerInvoices.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-500 font-sans">لا توجد فواتير مبيعات مطابقة في هذا التاريخ</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white mb-3">العملاء المتأثرون بحركة اليوم</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredAffectedCustomers.map((cust) => {
                const custCurr = cust.currency || 'YER';
                const custSym = getCurrencySymbol(db.currencies, custCurr);
                const custRate = getEffectiveCurrencyRate(db.currencies, custCurr);
                const nativeBal = custCurr !== 'YER' ? Math.round((cust.currentBalance / custRate) * 100) / 100 : cust.currentBalance;
                return (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => drillTo('customers', cust.id)}
                    className="text-right bg-slate-950 hover:border-amber-500/50 border border-slate-800 rounded-xl p-3 flex justify-between items-center transition-colors cursor-pointer"
                  >
                    <div>
                      <span className="text-xs font-bold text-white block">{cust.nameAr}</span>
                      <span className="text-[11px] text-slate-400">{cust.phone}</span>
                    </div>
                    {custCurr !== 'YER' ? (
                      <div className="text-left font-mono leading-tight tabular-nums">
                        <div className={`text-xs font-black ${nativeBal > 0 ? 'text-emerald-300' : 'text-emerald-400'}`}>
                          {nativeBal.toLocaleString()} {custSym}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {cust.currentBalance.toLocaleString()} ر.ي
                        </div>
                      </div>
                    ) : (
                      <span className={`font-mono text-xs font-black tabular-nums ${cust.currentBalance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {cust.currentBalance.toLocaleString()} ر.ي
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredAffectedCustomers.length === 0 && <p className="text-xs text-slate-500">لا يوجد عملاء مطابقون بهذا التاريخ.</p>}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: VENDORS */}
      {activeTab === 'vendors' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
            <h3 className="text-sm font-bold text-white">فواتير المشتريات ومدفوعات الموردين اليومية</h3>
            <span className="text-xs font-mono font-bold text-cyan-400 tabular-nums">صافي المشتريات: {toDisp(kpiData.netPurchasesDaily).toLocaleString()} {dispSym}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-3 px-4">رقم المستند</th>
                  <th className="py-3 px-4">النوع</th>
                  <th className="py-3 px-4">المورد</th>
                  <th className="py-3 px-4 text-left">المبلغ</th>
                  <th className="py-3 px-4 text-center">فتح</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {filteredTodayVendorInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-bold text-cyan-400">{inv.invoiceNumber}</td>
                    <td className="py-2.5 px-4 font-sans">فاتورة مشتريات</td>
                    <td className="py-2.5 px-4 font-sans text-white">{inv.entityName}</td>
                    <td className="py-2.5 px-4 text-left font-bold text-white tabular-nums">
                      {inv.grandTotal.toLocaleString()} {getCurrencySymbol(db.currencies, inv.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button type="button" onClick={() => drillTo('purchases', inv.id)} className="px-2.5 py-1 bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-cyan-400 rounded text-[11px] font-bold cursor-pointer">عرض</button>
                    </td>
                  </tr>
                ))}
                {filteredTodayVendorPayments.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-bold text-rose-400">{v.voucherNumber}</td>
                    <td className="py-2.5 px-4 font-sans">سند صرف</td>
                    <td className="py-2.5 px-4 font-sans text-white">{v.entityName}</td>
                    <td className="py-2.5 px-4 text-left font-bold text-rose-400 tabular-nums">
                      {v.amount.toLocaleString()} {getCurrencySymbol(db.currencies, v.currency)}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <button type="button" onClick={() => drillTo('treasury', v.id)} className="px-2.5 py-1 bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 rounded text-[11px] font-bold cursor-pointer">عرض</button>
                    </td>
                  </tr>
                ))}
                {filteredTodayVendorInvoices.length === 0 && filteredTodayVendorPayments.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-500 font-sans">لا توجد حركات موردين مطابقة في هذا التاريخ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 4: INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
            <h3 className="text-sm font-bold text-white">حركات المخزون المنفذة اليوم</h3>
            <span className="text-xs font-mono text-emerald-400 tabular-nums">قيمة المخزون الكلي: {toDisp(totalStockValuation).toLocaleString()} {dispSym}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-3 px-4">نوع المستند</th>
                  <th className="py-3 px-4">الرقم</th>
                  <th className="py-3 px-4">الصنف</th>
                  <th className="py-3 px-4 text-center">الكمية</th>
                  <th className="py-3 px-4 text-left">القيمة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {filteredTodayStockMovements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-800/40 cursor-pointer" onClick={() => drillTo('inventory', m.itemId)}>
                    <td className="py-2.5 px-4 font-sans text-slate-300">{m.documentType}</td>
                    <td className="py-2.5 px-4 text-amber-400">{m.documentNumber}</td>
                    <td className="py-2.5 px-4 font-sans text-white">{db.inventoryItems.find((i) => i.id === m.itemId)?.nameAr || m.itemId}</td>
                    <td className={`py-2.5 px-4 text-center font-bold tabular-nums ${m.quantityChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                    </td>
                    <td className="py-2.5 px-4 text-left text-white tabular-nums">{m.totalCost.toLocaleString()}</td>
                  </tr>
                ))}
                {filteredTodayStockMovements.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-500 font-sans">لا توجد حركات مخزنية مطابقة في هذا التاريخ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 5: EXECUTIVE SUMMARY */}
      {activeTab === 'summary' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              أبرز عمليات اليوم
            </h3>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400 block mb-1">أكبر فاتورة مبيعات:</span>
              {highestSaleInvoice ? (
                <button type="button" onClick={() => drillTo('sales', highestSaleInvoice.id)} className="w-full flex justify-between items-center text-right hover:text-amber-300 cursor-pointer">
                  <span className="font-bold text-white">{highestSaleInvoice.entityName} ({highestSaleInvoice.invoiceNumber})</span>
                  <span className="font-mono font-bold text-emerald-400 tabular-nums">
                    <bdi dir="auto">{highestSaleInvoice.grandTotal.toLocaleString()} {getCurrencySymbol(db.currencies, highestSaleInvoice.currency)}</bdi>
                    {highestSaleInvoice.currency !== 'YER' && (
                      <bdi dir="auto" className="text-[11px] text-slate-300 mr-1.5">
                        ({convertToBase(highestSaleInvoice.grandTotal, highestSaleInvoice.currency, db.currencies, highestSaleInvoice.exchangeRate).toLocaleString()} ر.ي)
                      </bdi>
                    )}
                  </span>
                </button>
              ) : (
                <span className="text-slate-500">لا توجد مبيعات في هذا التاريخ</span>
              )}
            </div>
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs">
              <span className="text-slate-400 block mb-1">أكبر سند قبض:</span>
              {highestReceipt ? (
                <button type="button" onClick={() => drillTo('treasury', highestReceipt.id)} className="w-full flex justify-between items-center text-right hover:text-amber-300 cursor-pointer">
                  <span className="font-bold text-white">{highestReceipt.entityName} ({highestReceipt.voucherNumber})</span>
                  <span className="font-mono font-bold text-emerald-400 tabular-nums">
                    <bdi dir="auto">{highestReceipt.amount.toLocaleString()} {getCurrencySymbol(db.currencies, highestReceipt.currency)}</bdi>
                    {highestReceipt.currency !== 'YER' && (
                      <bdi dir="auto" className="text-[11px] text-slate-300 mr-1.5">
                        ({(highestReceipt.baseAmount || convertToBase(highestReceipt.amount, highestReceipt.currency, db.currencies, highestReceipt.exchangeRate)).toLocaleString()} ر.ي)
                      </bdi>
                    )}
                  </span>
                </button>
              ) : (
                <span className="text-slate-500">لا توجد سندات قبض في هذا التاريخ</span>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              التنبيهات الرقابية
            </h3>
            <button type="button" onClick={() => drillTo('customers')} className="w-full text-right bg-rose-950/20 border border-rose-900/30 p-3 rounded-xl text-xs">
              <div className="flex justify-between font-bold text-rose-300 mb-1">
                <span>عملاء متجاوزون للحد الائتماني</span>
                <span className="font-mono">{overdueCustomers.length}</span>
              </div>
              <p className="text-[11px] text-slate-400">{overdueCustomers.slice(0, 3).map((c) => c.nameAr).join('، ') || 'لا يوجد'}</p>
            </button>
            <button type="button" onClick={() => drillTo('inventory')} className="w-full text-right bg-amber-950/20 border border-amber-900/30 p-3 rounded-xl text-xs">
              <div className="flex justify-between font-bold text-amber-300 mb-1">
                <span>أصناف تحت الحد الأدنى للطلب</span>
                <span className="font-mono">{lowStockAlerts.length}</span>
              </div>
              <p className="text-[11px] text-slate-400">{lowStockAlerts.slice(0, 3).map((i) => i.nameAr).join('، ') || 'لا يوجد'}</p>
            </button>
          </div>
        </div>
      )}

      <WhatsAppShareModal
        isOpen={waModalOpen}
        onClose={() => setWaModalOpen(false)}
        title="إرسال التقرير الإداري اليومي عبر واتساب"
        recipientName="الإدارة العليا"
        defaultPhone={db.settings.notificationPhone || db.company.phone || ''}
        defaultTemplateKey="dailySummary"
        templates={db.settings.whatsappTemplates}
        defaultMessage={generateWhatsAppSummary()}
        onDispatched={() => onNotify?.('success', 'تم تجهيز التقرير اليومي للإرسال عبر واتساب.')}
      />
    </div>
  );
};
