/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 6: Comprehensive Management Report (with Show/Hide & Selective Rows),
 * Dual-Currency SAR/YER Statement, Daily & Multi-Day Customer Movement Report + Individual/Bulk WhatsApp Dispatch,
 * 22-Report Hub, 22-KPI Daily Report, Unified Docs & Scheduled Dispatch
 */

import React, { useState, useMemo, useEffect, useDeferredValue } from 'react';
import {
  FileBarChart,
  Eye,
  MessageCircle,
  UserCheck,
  TrendingUp,
  Files,
  BellRing,
  Send,
  CalendarDays,
  CheckSquare,
  Square,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  X,
  Plus,
  Loader2,
  Users,
  Search,
  RefreshCw,
  Sparkles,
  LayoutTemplate,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { AppLanguage, t } from '../../../services/i18n';
import {
  Branch,
  CurrencyCode,
  Customer,
  DispatchLogEntry,
  PrintDocumentType,
  PrintTemplateConfig,
  SavedReportDesign,
  SystemSettings,
  TableColumnPref,
  TaskAlert,
  User,
  Vendor,
} from '../../../types/erp';
import {
  generateCustomerStatement,
  generateVendorStatement,
  StatementRow,
} from '../../../services/accountingEngine';
import { buildWhatsAppLink, validateWhatsAppPhone } from '../../../services/exportService';
import { normalizeArabicSearch, rankSearchResults } from '../../../services/searchHelpers';
import {
  convertToBase,
  getEffectiveCurrencyRate,
  getEffectiveSarRate,
} from '../../../services/currencyHelpers';
import { PrintableDocumentData } from '../../common/PrintModal';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import { SearchableSelect, SearchableSelectOption } from '../../common/SearchableSelect';
import { ReportsHubModule } from '../reports/ReportsHubModule';
import { ReportsAnalyticsPanel } from '../reports/ReportsAnalyticsPanel';
import { SmartSolutionsPanel } from '../smart/SmartSolutionsPanel';
import { VisualReportDesigner } from '../reports/VisualReportDesigner';
import { DailyManagementReportModule } from '../dailyReport/DailyManagementReportModule';
import { UnifiedDocumentsModule } from '../documents/UnifiedDocumentsModule';
import { TasksAlertsModule } from '../tasks/TasksAlertsModule';
import { ScheduledDispatchModule } from '../dispatch/ScheduledDispatchModule';

export type ReportsSubTabId =
  | 'v20_comp'
  | 'statement'
  | 'daily_customers'
  | 'hub_22'
  | 'daily_22'
  | 'unified_docs'
  | 'tasks_dispatch'
  | 'visual_designer'
  | 'smart_ai';

interface ReportsWorkbenchProps {
  db: ERPDatabase;
  currentBranch: Branch;
  currentUser?: User;
  currencySymbol: string;
  lang?: AppLanguage;
  isActive?: boolean;
  initialSubTab?: ReportsSubTabId;
  preselectedStatementParty?: { type: 'customer' | 'vendor'; id: string } | null;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefsMap: Record<string, TableColumnPref[]>;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveCustomer?: (customer: Customer) => void;
  onSaveVendor?: (vendor: Vendor) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNavigateToRecord: (moduleName: string, recordId?: string) => void;
  onAddTask: (task: TaskAlert) => void;
  onToggleTaskComplete: (taskId: string) => void;
  onUpdateSettings: (s: SystemSettings) => void;
  onAddDispatchLog: (log: DispatchLogEntry) => void;
  onRetryDispatch: (logId: string) => void;
  onSaveReportDesigns?: (designs: SavedReportDesign[]) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type SectionKey =
  | 'receipts'
  | 'payments'
  | 'expenses'
  | 'cashSales'
  | 'creditSales'
  | 'customBooks'
  | 'treasuries';

interface BulkDispatchItem {
  customerId: string;
  customerName: string;
  phone: string;
  message: string;
  closingBalanceLabel?: string;
  selected: boolean;
  status: 'pending' | 'sent' | 'failed';
  error?: string;
}

function findNextSelectedPendingIdx(items: BulkDispatchItem[], currentIndex: number): number {
  for (let i = currentIndex + 1; i < items.length; i++) {
    if (items[i].selected && items[i].status !== 'sent') return i;
  }
  for (let i = 0; i <= currentIndex && i < items.length; i++) {
    if (items[i].selected && items[i].status !== 'sent') return i;
  }
  const firstSelected = items.findIndex((x) => x.selected);
  return firstSelected >= 0 ? firstSelected : 0;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fmtNum(n: number): string {
  return round2(n).toLocaleString();
}

function getDatePart(d: string | undefined): string {
  return String(d || '').trim().slice(0, 10);
}

export const ReportsWorkbench: React.FC<ReportsWorkbenchProps> = ({
  db,
  currentBranch,
  currentUser,
  currencySymbol,
  lang = 'ar',
  isActive = true,
  initialSubTab = 'v20_comp',
  preselectedStatementParty,
  printTemplates,
  savedColumnPrefsMap,
  onSaveColumnPrefs,
  onSaveCustomer,
  onSaveVendor,
  onOpenPrintModal,
  onNavigateToRecord,
  onAddTask,
  onToggleTaskComplete,
  onUpdateSettings,
  onAddDispatchLog,
  onRetryDispatch,
  onSaveReportDesigns,
  onNotify,
}) => {
  const isEn = lang === 'en';
  const [subTab, setSubTab] = useState<ReportsSubTabId>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // SAR Rate from settings / currency table + editable display rate
  const sarSystemRate = useMemo(() => getEffectiveSarRate(db.currencies), [db.currencies]);

  const [displaySarRate, setDisplaySarRate] = useState<number>(() => sarSystemRate);
  useEffect(() => {
    setDisplaySarRate(sarSystemRate);
  }, [sarSystemRate]);
  const safeSarRate = displaySarRate > 0 ? displaySarRate : 1;
  const toSar = (yerVal: number, rate = safeSarRate) => (rate > 0 ? round2(yerVal / rate) : round2(yerVal));

  // ==================== 1. Comprehensive Report State ====================
  const [compMode, setCompMode] = useState<'DETAILED' | 'SUMMARY'>('DETAILED');
  const [dateFilter, setDateFilter] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [showAllDates, setShowAllDates] = useState<boolean>(true);
  const [compCurrencyFilter, setCompCurrencyFilter] = useState<string>('ALL');
  const [compSearch, setCompSearch] = useState<string>('');
  const deferredCompSearch = useDeferredValue(compSearch);
  const [compRowLimit, setCompRowLimit] = useState<number>(100);
  const [visibleSections, setVisibleSections] = useState<Record<SectionKey, boolean>>({
    receipts: true,
    payments: true,
    expenses: true,
    cashSales: true,
    creditSales: true,
    customBooks: true,
    treasuries: true,
  });
  const [excludedRowKeys, setExcludedRowKeys] = useState<Set<string>>(() => new Set());
  const [hideUncheckedRows, setHideUncheckedRows] = useState<boolean>(false);

  // ==================== 2. Statement State ====================
  const [stmtPartyType, setStmtPartyType] = useState<'customer' | 'vendor'>(
    preselectedStatementParty?.type || 'customer'
  );
  const [stmtPartyId, setStmtPartyId] = useState<string>(
    preselectedStatementParty?.id || db.customers[0]?.id || ''
  );
  const [stmtCurrencyView, setStmtCurrencyView] = useState<'AUTO' | 'DUAL_SAR_YER' | 'YER_ONLY'>('AUTO');
  const [stmtStartDate, setStmtStartDate] = useState<string>('');
  const [stmtEndDate, setStmtEndDate] = useState<string>('');

  // Inline Edit Party Modal on Statement Tab
  const [editingStmtParty, setEditingStmtParty] = useState<{
    kind: 'customer' | 'vendor';
    id: string;
    nameAr: string;
    phone: string;
    currency: CurrencyCode;
  } | null>(null);

  // ==================== 3. Daily / Multi-Day Customer Report State ====================
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [dailyDateMode, setDailyDateMode] = useState<'multi' | 'range'>('multi');
  const [selectedDates, setSelectedDates] = useState<string[]>(() => [new Date().toISOString().slice(0, 10)]);
  const [addDateInput, setAddDateInput] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rangeFrom, setRangeFrom] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rangeTo, setRangeTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dailySearch, setDailySearch] = useState<string>('');
  const deferredDailySearch = useDeferredValue(dailySearch);
  const [dailyCurrencyFilter, setDailyCurrencyFilter] = useState<string>('ALL');
  const [dailyOnlyActive, setDailyOnlyActive] = useState<boolean>(true);
  const [dailyOnlyWhatsapp, setDailyOnlyWhatsapp] = useState<boolean>(false);
  const [selectedDailyCustIds, setSelectedDailyCustIds] = useState<Set<string>>(() => new Set());
  const [expandedDailyCustId, setExpandedDailyCustId] = useState<string | null>(null);
  const [bulkModalItems, setBulkModalItems] = useState<BulkDispatchItem[] | null>(null);
  const [bulkQueueCursor, setBulkQueueCursor] = useState<number>(0);
  const [bulkSendingApi, setBulkSendingApi] = useState<boolean>(false);
  const [copiedAllBulk, setCopiedAllBulk] = useState<boolean>(false);

  // Preview & Individual WhatsApp Modals
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);
  const [waPayload, setWaPayload] = useState<{
    phone?: string;
    recipientName?: string;
    text: string;
    previewPayload?: UniversalPreviewPayload;
    logReportType?: DispatchLogEntry['reportType'];
  } | null>(null);

  useEffect(() => {
    if (preselectedStatementParty) {
      setStmtPartyType(preselectedStatementParty.type);
      setStmtPartyId(preselectedStatementParty.id);
      setSubTab('statement');
    }
  }, [preselectedStatementParty]);

  // ==================== 1. V20 Comprehensive Report Data + Row Filtering ====================
  const compRawData = useMemo(() => {
    if (!isActive || subTab !== 'v20_comp') {
      return {
        receipts: [] as typeof db.paymentVouchers,
        payments: [] as typeof db.paymentVouchers,
        expenses: [] as NonNullable<typeof db.expenseRecords>,
        cashSales: [] as typeof db.invoices,
        creditSales: [] as typeof db.invoices,
        customBooksSections: [] as {
          book: NonNullable<typeof db.customBooks>[number];
          flat: (NonNullable<typeof db.customBookEntries>[number]['rows'][number] & {
            date: string;
            entryNumber: string;
            treasuryName?: string;
            rowKey: string;
          })[];
        }[],
        treasuries: [] as typeof db.treasuryAccounts,
      };
    }
    const matchDate = (d: string) => showAllDates || (d && d.startsWith(dateFilter));
    const matchCurr = (c?: string) => compCurrencyFilter === 'ALL' || (c || 'YER') === compCurrencyFilter;
    const normQ = normalizeArabicSearch(deferredCompSearch);
    const matchSearch = (...fields: (string | number | undefined)[]) =>
      !normQ || normalizeArabicSearch(fields.filter(Boolean).join(' ')).includes(normQ);

    const receipts = db.paymentVouchers.filter(
      (v) =>
        v.type === 'قبض' &&
        v.status === 'posted' &&
        matchDate(v.date) &&
        matchCurr(v.currency) &&
        matchSearch(v.voucherNumber, v.entityName, v.treasuryAccountName, v.statement)
    );
    const payments = db.paymentVouchers.filter(
      (v) =>
        v.type === 'صرف' &&
        v.status === 'posted' &&
        matchDate(v.date) &&
        matchCurr(v.currency) &&
        matchSearch(v.voucherNumber, v.entityName, v.treasuryAccountName, v.statement)
    );
    const expenses = (db.expenseRecords || []).filter(
      (e) =>
        matchDate(e.date) &&
        matchCurr(e.currency) &&
        matchSearch(e.expenseNumber, e.categoryName, e.beneficiary, e.treasuryAccountName, e.statement)
    );
    const cashSales = db.invoices.filter(
      (i) =>
        i.type === 'مبيعات' &&
        i.status !== 'cancelled' &&
        i.status !== 'draft' &&
        i.paymentType === 'نقدي' &&
        matchDate(i.date) &&
        matchCurr(i.currency) &&
        matchSearch(i.invoiceNumber, i.entityName, i.notes)
    );
    const creditSales = db.invoices.filter(
      (i) =>
        i.type === 'مبيعات' &&
        i.status !== 'cancelled' &&
        i.status !== 'draft' &&
        i.paymentType !== 'نقدي' &&
        matchDate(i.date) &&
        matchCurr(i.currency) &&
        matchSearch(i.invoiceNumber, i.entityName, i.notes)
    );

    const customBooksSections = (db.customBooks || []).map((book) => {
      const entries = (db.customBookEntries || []).filter(
        (e) => e.bookId === book.id && matchDate(e.date)
      );
      const flat = entries
        .flatMap((e, entryIdx) =>
          e.rows.map((r, rowIdx) => ({
            ...r,
            date: e.date,
            entryNumber: e.entryNumber,
            treasuryName: e.treasuryAccountName,
            rowKey: `custom:${book.id}:${e.id || entryIdx}:${rowIdx}`,
          }))
        )
        .filter((r) => matchCurr(r.currency) && matchSearch(r.entryNumber, r.partyName, r.statement, r.treasuryName));
      return { book, flat };
    });

    const treasuries = db.treasuryAccounts.filter(
      (t) => matchCurr(t.currency) && matchSearch(t.code, t.nameAr, t.type, t.currency)
    );

    return {
      receipts,
      payments,
      expenses,
      cashSales,
      creditSales,
      customBooksSections,
      treasuries,
    };
  }, [isActive, subTab, db, showAllDates, dateFilter, compCurrencyFilter, deferredCompSearch]);

  const toggleRowKey = (key: string) => {
    setExcludedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setSectionRowsSelected = (keys: string[], select: boolean) => {
    setExcludedRowKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => {
        if (select) next.delete(k);
        else next.add(k);
      });
      return next;
    });
  };

  const toggleSectionVisibility = (sec: SectionKey) => {
    setVisibleSections((prev) => ({ ...prev, [sec]: !prev[sec] }));
  };

  // Active (selected & visible) calculations for Comprehensive Report
  const compActiveData = useMemo(() => {
    const receipts = visibleSections.receipts
      ? compRawData.receipts.filter((v) => !excludedRowKeys.has(`receipt:${v.id}`))
      : [];
    const payments = visibleSections.payments
      ? compRawData.payments.filter((v) => !excludedRowKeys.has(`payment:${v.id}`))
      : [];
    const expenses = visibleSections.expenses
      ? compRawData.expenses.filter((ex) => !excludedRowKeys.has(`expense:${ex.id}`))
      : [];
    const cashSales = visibleSections.cashSales
      ? compRawData.cashSales.filter((inv) => !excludedRowKeys.has(`cash:${inv.id}`))
      : [];
    const creditSales = visibleSections.creditSales
      ? compRawData.creditSales.filter((inv) => !excludedRowKeys.has(`credit:${inv.id}`))
      : [];
    const treasuries = visibleSections.treasuries
      ? compRawData.treasuries.filter((t) => !excludedRowKeys.has(`treasury:${t.id}`))
      : [];
    const customBooksSections = visibleSections.customBooks
      ? compRawData.customBooksSections.map((sec) => {
          const activeFlat = sec.flat.filter((fr) => !excludedRowKeys.has(fr.rowKey));
          const debitSum = activeFlat.reduce((s, r) => s + (r.debit || 0), 0);
          const creditSum = activeFlat.reduce((s, r) => s + (r.credit || 0), 0);
          const debitBaseSum = activeFlat.reduce(
            (s, r) => s + convertToBase(r.debit || 0, r.currency || 'YER', db.currencies),
            0
          );
          const creditBaseSum = activeFlat.reduce(
            (s, r) => s + convertToBase(r.credit || 0, r.currency || 'YER', db.currencies),
            0
          );
          const currSet = new Set(activeFlat.map((r) => r.currency || 'YER'));
          const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
          return {
            ...sec,
            activeFlat,
            debitSum,
            creditSum,
            debitBaseSum,
            creditBaseSum,
            singleCurr,
          };
        })
      : [];

    const totalReceipts = receipts.reduce(
      (s, v) => s + (v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate)),
      0
    );
    const totalPayments = payments.reduce(
      (s, v) => s + (v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate)),
      0
    );
    const totalExpenses = expenses.reduce(
      (s, e) => s + convertToBase(e.total || e.amount || 0, e.currency, db.currencies),
      0
    );
    const totalCashSales = cashSales.reduce(
      (s, i) => s + convertToBase(i.grandTotal, i.currency, db.currencies, i.exchangeRate),
      0
    );
    const totalCreditSales = creditSales.reduce(
      (s, i) => s + convertToBase(i.grandTotal, i.currency, db.currencies, i.exchangeRate),
      0
    );
    const totalPaidOnCredit = creditSales.reduce(
      (s, i) => s + convertToBase(i.paidAmount || 0, i.currency, db.currencies, i.exchangeRate),
      0
    );
    const netCashPosition = treasuries.reduce((s, t) => {
      const rate = getEffectiveCurrencyRate(db.currencies, t.currency);
      return s + t.balance * rate;
    }, 0);
    const netCashSurplus = round2(totalReceipts + totalCashSales - totalPayments - totalExpenses);

    // Native SAR amounts where currency === 'SAR'
    const nativeSarReceipts = receipts.filter((v) => v.currency === 'SAR').reduce((s, v) => s + v.amount, 0);
    const nativeSarPayments = payments.filter((v) => v.currency === 'SAR').reduce((s, v) => s + v.amount, 0);
    const nativeSarCashSales = cashSales.filter((i) => i.currency === 'SAR').reduce((s, i) => s + i.grandTotal, 0);
    const nativeSarCreditSales = creditSales.filter((i) => i.currency === 'SAR').reduce((s, i) => s + i.grandTotal, 0);
    const nativeSarTreasuries = treasuries.filter((t) => t.currency === 'SAR').reduce((s, t) => s + t.balance, 0);

    const totalRawRows =
      compRawData.receipts.length +
      compRawData.payments.length +
      compRawData.expenses.length +
      compRawData.cashSales.length +
      compRawData.creditSales.length +
      compRawData.treasuries.length +
      compRawData.customBooksSections.reduce((s, b) => s + b.flat.length, 0);

    const activeRowCount =
      receipts.length +
      payments.length +
      expenses.length +
      cashSales.length +
      creditSales.length +
      treasuries.length +
      customBooksSections.reduce((s, b) => s + b.activeFlat.length, 0);

    return {
      receipts,
      payments,
      expenses,
      cashSales,
      creditSales,
      treasuries,
      customBooksSections,
      totalReceipts,
      totalPayments,
      totalExpenses,
      totalCashSales,
      totalCreditSales,
      totalPaidOnCredit,
      netCashPosition,
      netCashSurplus,
      nativeSarReceipts,
      nativeSarPayments,
      nativeSarCashSales,
      nativeSarCreditSales,
      nativeSarTreasuries,
      totalRawRows,
      activeRowCount,
    };
  }, [compRawData, visibleSections, excludedRowKeys, db.currencies]);

  const buildCompPreview = (): UniversalPreviewPayload => {
    const periodLabel = showAllDates ? 'جميع التواريخ المتاحة' : `بتاريخ ${dateFilter}`;
    const currLabel =
      compCurrencyFilter === 'ALL'
        ? `كل العملات (سعر التحويل المعتمد: 1 SAR = ${safeSarRate} YER)`
        : `تصفية العملة: ${compCurrencyFilter} (1 SAR = ${safeSarRate} YER)`;

    const summaryRows: (string | number)[][] = [];
    if (visibleSections.receipts) {
      summaryRows.push([
        'سندات القبض والتحصيل',
        compActiveData.receipts.length,
        fmtNum(toSar(compActiveData.totalReceipts)),
        `× ${safeSarRate}`,
        fmtNum(compActiveData.totalReceipts),
      ]);
    }
    if (visibleSections.payments) {
      summaryRows.push([
        'سندات الصرف والمدفوعات',
        compActiveData.payments.length,
        fmtNum(toSar(compActiveData.totalPayments)),
        `× ${safeSarRate}`,
        fmtNum(compActiveData.totalPayments),
      ]);
    }
    if (visibleSections.expenses && compActiveData.expenses.length > 0) {
      summaryRows.push([
        'المصروفات التشغيلية المباشرة',
        compActiveData.expenses.length,
        fmtNum(toSar(compActiveData.totalExpenses)),
        `× ${safeSarRate}`,
        fmtNum(compActiveData.totalExpenses),
      ]);
    }
    if (visibleSections.cashSales) {
      summaryRows.push([
        'فواتير المبيعات النقدية',
        compActiveData.cashSales.length,
        fmtNum(toSar(compActiveData.totalCashSales)),
        `× ${safeSarRate}`,
        fmtNum(compActiveData.totalCashSales),
      ]);
    }
    if (visibleSections.creditSales) {
      summaryRows.push([
        'فواتير المبيعات الآجلة والجزئية',
        compActiveData.creditSales.length,
        fmtNum(toSar(compActiveData.totalCreditSales)),
        `× ${safeSarRate}`,
        fmtNum(compActiveData.totalCreditSales),
      ]);
    }

    const summaryTables: UniversalPreviewPayload['tables'] = [
      {
        title: 'ملخص الأقسام الظاهرة والمحددة (بالسعودي + نسبة التحويل + اليمني)',
        headers: ['البند التشغيلي', 'عدد العمليات', 'المعادل بالسعودي (SAR)', 'سعر التحويل', 'الإجمالي باليمني (YER)'],
        rows: summaryRows,
      },
    ];

    if (visibleSections.treasuries && compActiveData.treasuries.length > 0) {
      let sumTreasSar = 0;
      const treasRows = compActiveData.treasuries.map((t) => {
        const rate = getEffectiveCurrencyRate(db.currencies, t.currency);
        const yerVal = t.balance * rate;
        const sarVal = t.currency === 'SAR' ? t.balance : toSar(yerVal);
        sumTreasSar += sarVal;
        return [
          t.nameAr,
          t.type,
          t.currency,
          `${t.balance.toLocaleString()} ${t.currency}`,
          fmtNum(sarVal),
          fmtNum(yerVal),
        ];
      });
      summaryTables.push({
        title: 'أرصدة السيولة في الصناديق وشركات الصرافة',
        headers: ['الخزينة / الصراف', 'النوع', 'العملة', 'الرصيد بالعملة', 'المعادل (SAR)', 'المعادل (YER)'],
        rows: treasRows,
        totals: [
          'إجمالي السيولة',
          `${compActiveData.treasuries.length} حساب`,
          '',
          '',
          `${fmtNum(sumTreasSar)} ر.س`,
          `${fmtNum(compActiveData.netCashPosition)} ر.ي`,
        ],
      });
    }

    const detailTables: UniversalPreviewPayload['tables'] = [];
    if (compMode === 'DETAILED') {
      if (visibleSections.receipts && compActiveData.receipts.length > 0) {
        const currSet = new Set(compActiveData.receipts.map((v) => v.currency || 'YER'));
        const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
        let sumNative = 0;
        let sumSar = 0;
        let sumYer = 0;
        const rows = compActiveData.receipts.map((v) => {
          const baseYer = v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate);
          const sarVal = v.currency === 'SAR' ? v.amount : toSar(baseYer);
          sumNative += v.amount;
          sumSar += sarVal;
          sumYer += baseYer;
          return [
            v.voucherNumber,
            v.date,
            v.entityName,
            v.treasuryAccountName,
            `${v.amount.toLocaleString()} ${v.currency}`,
            `×${v.exchangeRate}`,
            fmtNum(sarVal),
            fmtNum(baseYer),
            v.statement,
          ];
        });
        detailTables.push({
          title: `1. تفاصيل سندات القبض المحددة (${compActiveData.receipts.length})`,
          headers: [
            'رقم السند',
            'التاريخ',
            'الطرف',
            'الخزينة',
            'المبلغ بالعملة',
            'الصرف',
            'المعادل (SAR)',
            'المعادل (YER)',
            'البيان',
          ],
          rows,
          totals: [
            'الإجمالي',
            `${compActiveData.receipts.length} سند`,
            '',
            '',
            singleCurr ? `${fmtNum(sumNative)} ${singleCurr}` : 'متعدد العملات',
            '',
            `${fmtNum(sumSar)} ر.س`,
            `${fmtNum(sumYer)} ر.ي`,
            '',
          ],
        });
      }

      if (visibleSections.payments && compActiveData.payments.length > 0) {
        const currSet = new Set(compActiveData.payments.map((v) => v.currency || 'YER'));
        const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
        let sumNative = 0;
        let sumSar = 0;
        let sumYer = 0;
        const rows = compActiveData.payments.map((v) => {
          const baseYer = v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate);
          const sarVal = v.currency === 'SAR' ? v.amount : toSar(baseYer);
          sumNative += v.amount;
          sumSar += sarVal;
          sumYer += baseYer;
          return [
            v.voucherNumber,
            v.date,
            v.entityName,
            v.treasuryAccountName,
            `${v.amount.toLocaleString()} ${v.currency}`,
            `×${v.exchangeRate}`,
            fmtNum(sarVal),
            fmtNum(baseYer),
            v.statement,
          ];
        });
        detailTables.push({
          title: `2. تفاصيل سندات الصرف المحددة (${compActiveData.payments.length})`,
          headers: [
            'رقم السند',
            'التاريخ',
            'الطرف / البند',
            'الخزينة',
            'المبلغ بالعملة',
            'الصرف',
            'المعادل (SAR)',
            'المعادل (YER)',
            'البيان',
          ],
          rows,
          totals: [
            'الإجمالي',
            `${compActiveData.payments.length} سند`,
            '',
            '',
            singleCurr ? `${fmtNum(sumNative)} ${singleCurr}` : 'متعدد العملات',
            '',
            `${fmtNum(sumSar)} ر.س`,
            `${fmtNum(sumYer)} ر.ي`,
            '',
          ],
        });
      }

      if (visibleSections.expenses && compActiveData.expenses.length > 0) {
        const currSet = new Set(compActiveData.expenses.map((ex) => ex.currency || 'YER'));
        const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
        let sumNative = 0;
        let sumSar = 0;
        let sumYer = 0;
        const rows = compActiveData.expenses.map((ex) => {
          const nat = ex.total || ex.amount || 0;
          const baseExp = convertToBase(nat, ex.currency, db.currencies);
          const sarExp = ex.currency === 'SAR' ? nat : toSar(baseExp);
          sumNative += nat;
          sumSar += sarExp;
          sumYer += baseExp;
          return [
            ex.expenseNumber,
            ex.date,
            ex.categoryName,
            ex.beneficiary,
            ex.treasuryAccountName,
            `${nat.toLocaleString()} ${ex.currency}`,
            fmtNum(sarExp),
            fmtNum(baseExp),
            ex.statement,
          ];
        });
        detailTables.push({
          title: `3. تفاصيل المصروفات المسجلة المحددة (${compActiveData.expenses.length})`,
          headers: [
            'الرقم',
            'التاريخ',
            'بند المصروف',
            'المستفيد',
            'الخزينة',
            'الإجمالي بالعملة',
            'المعادل (SAR)',
            'المعادل (YER)',
            'البيان',
          ],
          rows,
          totals: [
            'الإجمالي',
            `${compActiveData.expenses.length} مصروف`,
            '',
            '',
            '',
            singleCurr ? `${fmtNum(sumNative)} ${singleCurr}` : 'متعدد العملات',
            `${fmtNum(sumSar)} ر.س`,
            `${fmtNum(sumYer)} ر.ي`,
            '',
          ],
        });
      }

      if (visibleSections.cashSales && compActiveData.cashSales.length > 0) {
        const currSet = new Set(compActiveData.cashSales.map((inv) => inv.currency || 'YER'));
        const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
        let sumNative = 0;
        let sumSar = 0;
        let sumYer = 0;
        const rows = compActiveData.cashSales.map((inv) => {
          const base = convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate);
          const sarVal = inv.currency === 'SAR' ? inv.grandTotal : toSar(base);
          sumNative += inv.grandTotal;
          sumSar += sarVal;
          sumYer += base;
          return [
            inv.invoiceNumber,
            inv.date,
            inv.entityName,
            `${inv.grandTotal.toLocaleString()} ${inv.currency}`,
            inv.currency,
            fmtNum(sarVal),
            fmtNum(base),
          ];
        });
        detailTables.push({
          title: `4. تفاصيل فواتير المبيعات النقدية (${compActiveData.cashSales.length})`,
          headers: [
            'رقم الفاتورة',
            'التاريخ',
            'العميل',
            'الصافي بالعملة',
            'العملة',
            'المعادل (SAR)',
            'المعادل (YER)',
          ],
          rows,
          totals: [
            'الإجمالي',
            `${compActiveData.cashSales.length} فاتورة`,
            '',
            singleCurr ? `${fmtNum(sumNative)} ${singleCurr}` : 'متعدد العملات',
            '',
            `${fmtNum(sumSar)} ر.س`,
            `${fmtNum(sumYer)} ر.ي`,
          ],
        });
      }

      if (visibleSections.creditSales && compActiveData.creditSales.length > 0) {
        const currSet = new Set(compActiveData.creditSales.map((inv) => inv.currency || 'YER'));
        const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
        let sumNetNat = 0;
        let sumPaidNat = 0;
        let sumRemNat = 0;
        let sumSar = 0;
        let sumYer = 0;
        const rows = compActiveData.creditSales.map((inv) => {
          const base = convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate);
          const sarVal = inv.currency === 'SAR' ? inv.grandTotal : toSar(base);
          sumNetNat += inv.grandTotal;
          sumPaidNat += inv.paidAmount || 0;
          sumRemNat += inv.remainingAmount || 0;
          sumSar += sarVal;
          sumYer += base;
          return [
            inv.invoiceNumber,
            inv.date,
            inv.entityName,
            `${inv.grandTotal.toLocaleString()} ${inv.currency}`,
            `${(inv.paidAmount || 0).toLocaleString()} ${inv.currency}`,
            `${(inv.remainingAmount || 0).toLocaleString()} ${inv.currency}`,
            fmtNum(sarVal),
            fmtNum(base),
          ];
        });
        detailTables.push({
          title: `5. تفاصيل المبيعات الآجلة والجزئية (${compActiveData.creditSales.length})`,
          headers: [
            'رقم الفاتورة',
            'التاريخ',
            'العميل',
            'الصافي بالعملة',
            'المدفوع بالعملة',
            'المتبقي بالعملة',
            'المعادل (SAR)',
            'المعادل (YER)',
          ],
          rows,
          totals: [
            'الإجمالي',
            `${compActiveData.creditSales.length} فاتورة`,
            '',
            singleCurr ? `${fmtNum(sumNetNat)} ${singleCurr}` : 'متعدد العملات',
            singleCurr ? `${fmtNum(sumPaidNat)} ${singleCurr}` : 'متعدد العملات',
            singleCurr ? `${fmtNum(sumRemNat)} ${singleCurr}` : 'متعدد العملات',
            `${fmtNum(sumSar)} ر.س`,
            `${fmtNum(sumYer)} ر.ي`,
          ],
        });
      }

      if (visibleSections.customBooks) {
        compActiveData.customBooksSections
          .filter((sec) => sec.activeFlat.length > 0)
          .forEach((sec) => {
            detailTables.push({
              title: `دفتر: ${sec.book.nameAr} (${sec.activeFlat.length} حركة)`,
              headers: [
                'رقم القيد',
                'التاريخ',
                'الطرف / البند',
                'البيان',
                'مدين',
                'دائن',
                'العملة',
                'مدين (YER)',
                'دائن (YER)',
              ],
              rows: sec.activeFlat.map((fr) => [
                fr.entryNumber,
                fr.date,
                fr.partyName || '-',
                fr.statement || '-',
                (fr.debit || 0).toLocaleString(),
                (fr.credit || 0).toLocaleString(),
                fr.currency || 'YER',
                fmtNum(convertToBase(fr.debit || 0, fr.currency || 'YER', db.currencies)),
                fmtNum(convertToBase(fr.credit || 0, fr.currency || 'YER', db.currencies)),
              ]),
              totals: [
                'الإجمالي',
                `${sec.activeFlat.length} حركة`,
                '',
                '',
                sec.singleCurr ? `${fmtNum(sec.debitSum)} ${sec.singleCurr}` : 'متعدد',
                sec.singleCurr ? `${fmtNum(sec.creditSum)} ${sec.singleCurr}` : 'متعدد',
                '',
                `${fmtNum(sec.debitBaseSum)} ر.ي`,
                `${fmtNum(sec.creditBaseSum)} ر.ي`,
              ],
            });
          });
      }
    }

    const whatsappLines = [
      `*${db.company.nameAr}*`,
      `التقرير المالي الشامل (${periodLabel})`,
      `نسبة التحويل المعتمدة: 1 ر.س = ${safeSarRate} ر.ي`,
      visibleSections.receipts
        ? `- سندات القبض (${compActiveData.receipts.length}): ${fmtNum(toSar(compActiveData.totalReceipts))} ر.س (${fmtNum(compActiveData.totalReceipts)} ر.ي)`
        : null,
      visibleSections.payments
        ? `- سندات الصرف (${compActiveData.payments.length}): ${fmtNum(toSar(compActiveData.totalPayments))} ر.س (${fmtNum(compActiveData.totalPayments)} ر.ي)`
        : null,
      visibleSections.expenses && compActiveData.expenses.length > 0
        ? `- المصروفات (${compActiveData.expenses.length}): ${fmtNum(toSar(compActiveData.totalExpenses))} ر.س (${fmtNum(compActiveData.totalExpenses)} ر.ي)`
        : null,
      visibleSections.cashSales
        ? `- المبيعات النقدية (${compActiveData.cashSales.length}): ${fmtNum(toSar(compActiveData.totalCashSales))} ر.س (${fmtNum(compActiveData.totalCashSales)} ر.ي)`
        : null,
      visibleSections.creditSales
        ? `- المبيعات الآجلة (${compActiveData.creditSales.length}): ${fmtNum(toSar(compActiveData.totalCreditSales))} ر.س (${fmtNum(compActiveData.totalCreditSales)} ر.ي)`
        : null,
      visibleSections.treasuries
        ? `- إجمالي السيولة القائمة: ${fmtNum(toSar(compActiveData.netCashPosition))} ر.س (${fmtNum(compActiveData.netCashPosition)} ر.ي)`
        : null,
    ].filter(Boolean);

    return {
      title: `التقرير المالي والإداري الشامل (${compMode === 'DETAILED' ? 'تفصيلي' : 'مختصر'})`,
      subtitle: currLabel,
      periodText: `${periodLabel} — الحركات المحددة: ${compActiveData.activeRowCount} من ${compActiveData.totalRawRows}`,
      summaryCards: [
        ...(visibleSections.receipts
          ? [
              {
                label: `سندات القبض (${compActiveData.receipts.length})`,
                value: `اليمني: ${fmtNum(compActiveData.totalReceipts)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.totalReceipts))} ر.س (×${safeSarRate})`,
                tone: 'green' as const,
              },
            ]
          : []),
        ...(visibleSections.payments
          ? [
              {
                label: `سندات الصرف (${compActiveData.payments.length})`,
                value: `اليمني: ${fmtNum(compActiveData.totalPayments)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.totalPayments))} ر.س (×${safeSarRate})`,
                tone: 'red' as const,
              },
            ]
          : []),
        ...(visibleSections.expenses && compActiveData.expenses.length > 0
          ? [
              {
                label: `المصروفات (${compActiveData.expenses.length})`,
                value: `اليمني: ${fmtNum(compActiveData.totalExpenses)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.totalExpenses))} ر.س (×${safeSarRate})`,
                tone: 'red' as const,
              },
            ]
          : []),
        ...(visibleSections.cashSales
          ? [
              {
                label: `المبيعات النقدية (${compActiveData.cashSales.length})`,
                value: `اليمني: ${fmtNum(compActiveData.totalCashSales)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.totalCashSales))} ر.س (×${safeSarRate})`,
                tone: 'gold' as const,
              },
            ]
          : []),
        ...(visibleSections.creditSales
          ? [
              {
                label: `المبيعات الآجلة (${compActiveData.creditSales.length})`,
                value: `اليمني: ${fmtNum(compActiveData.totalCreditSales)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.totalCreditSales))} ر.س (×${safeSarRate})`,
                tone: 'blue' as const,
              },
            ]
          : []),
        ...(visibleSections.treasuries
          ? [
              {
                label: `السيولة القائمة (×${safeSarRate})`,
                value: `اليمني: ${fmtNum(compActiveData.netCashPosition)} ر.ي`,
                subValue: `السعودي: ${fmtNum(toSar(compActiveData.netCashPosition))} ر.س`,
                tone: 'gold' as const,
              },
            ]
          : []),
      ],
      tables: [...summaryTables, ...detailTables],
      whatsappText: whatsappLines.join('\n'),
      defaultPhone: db.settings.notificationPhone || db.company.phone,
    };
  };

  // ==================== 2. Statement Computations (with Saudi Dual Currency + Conversion Rate) ====================
  const stmtOptions = useMemo<SearchableSelectOption[]>(() => {
    if (!isActive || subTab !== 'statement') return [];
    if (stmtPartyType === 'customer') {
      return db.customers.map((c) => {
        const isSar = c.currency === 'SAR';
        const badge = isSar
          ? `${fmtNum(toSar(c.currentBalance))} ر.س (${fmtNum(c.currentBalance)} ر.ي)`
          : `${c.currentBalance.toLocaleString()} ${c.currency || 'YER'}`;
        return {
          id: c.id,
          code: c.code,
          name: c.nameAr,
          sublabel: `${c.currency || 'YER'} · ${c.phone || c.addressDetails || 'عميل'}`,
          badge,
          phone: c.whatsapp || c.phone,
        };
      });
    }
    return db.vendors.map((v) => {
      const isSar = v.currency === 'SAR';
      const badge = isSar
        ? `${fmtNum(toSar(v.currentBalance))} ر.س (${fmtNum(v.currentBalance)} ر.ي)`
        : `${v.currentBalance.toLocaleString()} ${v.currency || 'YER'}`;
      return {
        id: v.id,
        code: v.code,
        name: v.nameAr,
        sublabel: `${v.currency || 'YER'} · ${v.phone || v.address || 'مورد'}`,
        badge,
        phone: v.whatsapp || v.phone,
      };
    });
  }, [isActive, subTab, stmtPartyType, db.customers, db.vendors, safeSarRate]);

  interface DualStatementRow extends StatementRow {
    rowRate: number;
    sarDebit: number;
    sarCredit: number;
    sarBalance: number;
  }

  const statementResult = useMemo(() => {
    if (!isActive || subTab !== 'statement') {
      return {
        partyName: '',
        phone: '',
        partyCurrency: 'YER' as CurrencyCode,
        isSaudiAccount: false,
        showDualSar: false,
        rows: [] as DualStatementRow[],
        totalDebitYer: 0,
        totalCreditYer: 0,
        closingYer: 0,
        totalDebitSar: 0,
        totalCreditSar: 0,
        closingSar: 0,
      };
    }
    let partyName = '';
    let phone = '';
    let partyCurrency: CurrencyCode = 'YER';
    let rawRows: StatementRow[] = [];

    const dateFilterObj =
      stmtStartDate || stmtEndDate
        ? { startDate: stmtStartDate || undefined, endDate: stmtEndDate || undefined }
        : undefined;

    if (stmtPartyType === 'customer') {
      const cust = db.customers.find((c) => c.id === stmtPartyId) || db.customers[0];
      if (cust) {
        partyName = cust.nameAr;
        phone = cust.whatsapp || cust.phone;
        partyCurrency = cust.currency || 'YER';
        rawRows = generateCustomerStatement(
          cust.id,
          cust,
          db.invoices,
          db.paymentVouchers,
          db.journalEntries,
          dateFilterObj
        );
      }
    } else {
      const vend = db.vendors.find((v) => v.id === stmtPartyId) || db.vendors[0];
      if (vend) {
        partyName = vend.nameAr;
        phone = vend.whatsapp || vend.phone;
        partyCurrency = vend.currency || 'YER';
        rawRows = generateVendorStatement(
          vend.id,
          vend,
          db.invoices,
          db.paymentVouchers,
          db.journalEntries,
          dateFilterObj
        );
      }
    }

    const hasSarTx = rawRows.some((r) => r.txCurrency === 'SAR');
    const isSaudiAccount = partyCurrency === 'SAR' || hasSarTx;

    const showDualSar =
      stmtCurrencyView === 'DUAL_SAR_YER' ||
      (stmtCurrencyView === 'AUTO' && isSaudiAccount);

    // Compute exact SAR running columns alongside YER ledger columns
    let runningSar = 0;
    const dualRows: DualStatementRow[] = rawRows.map((r, idx) => {
      const rowRate =
        r.txCurrency === 'SAR' && r.exchangeRate && r.exchangeRate > 0
          ? r.exchangeRate
          : safeSarRate;
      const sarDebit =
        r.txCurrency === 'SAR' && typeof r.txDebit === 'number'
          ? round2(r.txDebit)
          : toSar(r.debit, rowRate);
      const sarCredit =
        r.txCurrency === 'SAR' && typeof r.txCredit === 'number'
          ? round2(r.txCredit)
          : toSar(r.credit, rowRate);

      if (idx === 0 && (r.documentType === 'رصيد_افتتاحي' || r.documentType === 'رصيد_سابق')) {
        runningSar = toSar(r.balance, rowRate);
      } else {
        runningSar =
          stmtPartyType === 'customer'
            ? round2(runningSar + sarDebit - sarCredit)
            : round2(runningSar + sarCredit - sarDebit);
      }

      return {
        ...r,
        rowRate,
        sarDebit,
        sarCredit,
        sarBalance: runningSar,
      };
    });

    const totalDebitYer = dualRows.reduce((s, r) => s + r.debit, 0);
    const totalCreditYer = dualRows.reduce((s, r) => s + r.credit, 0);
    const closingYer = dualRows[dualRows.length - 1]?.balance || 0;

    const totalDebitSar = dualRows.reduce((s, r) => s + r.sarDebit, 0);
    const totalCreditSar = dualRows.reduce((s, r) => s + r.sarCredit, 0);
    const closingSar = dualRows[dualRows.length - 1]?.sarBalance || toSar(closingYer);

    return {
      partyName,
      phone,
      partyCurrency,
      isSaudiAccount,
      showDualSar,
      rows: dualRows,
      totalDebitYer,
      totalCreditYer,
      closingYer,
      totalDebitSar,
      totalCreditSar,
      closingSar,
    };
  }, [isActive, subTab, stmtPartyType, stmtPartyId, db.customers, db.vendors, db.invoices, db.paymentVouchers, db.journalEntries, stmtCurrencyView, stmtStartDate, stmtEndDate, safeSarRate]);

  const buildStatementPreview = (): UniversalPreviewPayload => {
    const dual = statementResult.showDualSar;
    const rows = dual
      ? statementResult.rows.map((r) => [
          r.date,
          r.documentType,
          r.documentNumber,
          r.statement,
          r.sarDebit > 0 ? fmtNum(r.sarDebit) : '-',
          r.sarCredit > 0 ? fmtNum(r.sarCredit) : '-',
          fmtNum(r.sarBalance),
          `×${r.rowRate}`,
          r.debit > 0 ? fmtNum(r.debit) : '-',
          r.credit > 0 ? fmtNum(r.credit) : '-',
          fmtNum(r.balance),
        ])
      : statementResult.rows.map((r) => [
          r.date,
          r.documentType,
          r.documentNumber,
          r.statement,
          r.debit > 0 ? fmtNum(r.debit) : '-',
          r.credit > 0 ? fmtNum(r.credit) : '-',
          fmtNum(r.balance),
        ]);

    const headers = dual
      ? [
          'التاريخ',
          'المستند',
          'الرقم',
          'البيان',
          'مدين (ر.س)',
          'دائن (ر.س)',
          'الرصيد (ر.س)',
          'التحويل',
          'مدين (ر.ي)',
          'دائن (ر.ي)',
          'الرصيد (ر.ي)',
        ]
      : ['التاريخ', 'نوع المستند', 'الرقم', 'البيان', 'مدين', 'دائن', 'الرصيد التراكمي'];

    const totals = dual
      ? [
          'الإجمالي',
          `${statementResult.rows.length} حركة`,
          '',
          `عملة الحساب: ${statementResult.partyCurrency}`,
          `${fmtNum(statementResult.totalDebitSar)} ر.س`,
          `${fmtNum(statementResult.totalCreditSar)} ر.س`,
          `${fmtNum(statementResult.closingSar)} ر.س`,
          `×${safeSarRate}`,
          `${fmtNum(statementResult.totalDebitYer)} ر.ي`,
          `${fmtNum(statementResult.totalCreditYer)} ر.ي`,
          `${fmtNum(statementResult.closingYer)} ر.ي`,
        ]
      : [
          'الإجمالي',
          `${statementResult.rows.length} حركة`,
          '',
          '',
          fmtNum(statementResult.totalDebitYer),
          fmtNum(statementResult.totalCreditYer),
          fmtNum(statementResult.closingYer),
        ];

    const waText = dual
      ? `${db.company.nameAr}\nكشف حساب ${stmtPartyType === 'customer' ? 'العميل' : 'المورد'}: ${statementResult.partyName}\nعملة الحساب: سعودي (SAR) · نسبة التحويل: 1 ر.س = ${safeSarRate} ر.ي\n- إجمالي المدين: ${fmtNum(statementResult.totalDebitSar)} ر.س (${fmtNum(statementResult.totalDebitYer)} ر.ي)\n- إجمالي الدائن: ${fmtNum(statementResult.totalCreditSar)} ر.س (${fmtNum(statementResult.totalCreditYer)} ر.ي)\n*الرصيد الختامي:* ${fmtNum(statementResult.closingSar)} ر.س | المعادل باليمني: ${fmtNum(statementResult.closingYer)} ر.ي`
      : `${db.company.nameAr}\nكشف حساب ${statementResult.partyName}\nالرصيد الختامي: ${fmtNum(statementResult.closingYer)} YER`;

    const periodBadge =
      stmtStartDate || stmtEndDate
        ? `الفترة: ${stmtStartDate || 'البداية'} إلى ${stmtEndDate || 'الآن'}`
        : 'كافة الفترات';

    return {
      title: `كشف حساب تفصيلي: ${statementResult.partyName}`,
      docType: 'statement',
      periodText: periodBadge,
      subtitle: dual
        ? `حساب ${statementResult.partyCurrency === 'SAR' ? 'سعودي (SAR)' : statementResult.partyCurrency} — عرض مزدوج بالريال السعودي واليمني (1 SAR = ${safeSarRate} YER)`
        : 'كشف حساب بالريال اليمني (YER)',
      summaryCards: dual
        ? [
            {
              label: 'الرصيد بالسعودي (SAR)',
              value: `${fmtNum(statementResult.closingSar)} ر.س`,
              subValue: `نسبة التحويل: 1 ر.س = ${safeSarRate} ر.ي`,
              tone: 'gold',
            },
            {
              label: 'إجمالي الحركة (SAR)',
              value: `مدين: ${fmtNum(statementResult.totalDebitSar)} ر.س`,
              subValue: `دائن: ${fmtNum(statementResult.totalCreditSar)} ر.س`,
              tone: 'blue',
            },
            {
              label: 'المعادل باليمني (YER)',
              value: `${fmtNum(statementResult.closingYer)} ر.ي`,
              subValue: `مدين: ${fmtNum(statementResult.totalDebitYer)} ر.ي`,
              tone: 'green',
            },
          ]
        : [
            { label: 'إجمالي مدين', value: `${fmtNum(statementResult.totalDebitYer)} ر.ي`, tone: 'green' },
            { label: 'إجمالي دائن', value: `${fmtNum(statementResult.totalCreditYer)} ر.ي`, tone: 'red' },
            { label: 'الرصيد الختامي', value: `${fmtNum(statementResult.closingYer)} ر.ي`, tone: 'gold' },
          ],
      tables: [{ headers, rows, totals }],
      whatsappText: waText,
      defaultPhone: statementResult.phone,
    };
  };

  // ==================== 3. Daily / Multi-Day Customer Movement Report ====================
  const availableTransactionDates = useMemo(() => {
    const set = new Set<string>();
    db.invoices.forEach((i) => i.status !== 'cancelled' && i.date && set.add(getDatePart(i.date)));
    db.paymentVouchers.forEach((v) => v.status === 'posted' && v.date && set.add(getDatePart(v.date)));
    db.journalEntries.forEach((j) => j.status === 'posted' && j.date && set.add(getDatePart(j.date)));
    return Array.from(set).filter(Boolean).sort((a, b) => b.localeCompare(a)).slice(0, 14);
  }, [db.invoices, db.paymentVouchers, db.journalEntries]);

  const activePeriodLabel = useMemo(() => {
    if (dailyDateMode === 'range') {
      return rangeFrom === rangeTo ? `يوم ${rangeFrom}` : `من ${rangeFrom} إلى ${rangeTo}`;
    }
    const sorted = [...selectedDates].sort();
    if (sorted.length === 0) return 'لم يتم تحديد تاريخ';
    if (sorted.length === 1) return `يوم ${sorted[0]}`;
    return `الأيام: ${sorted.join('، ')}`;
  }, [dailyDateMode, selectedDates, rangeFrom, rangeTo]);

  interface DailyCustomerRecord {
    customer: Customer;
    isSaudi: boolean;
    priorBalanceYer: number;
    priorBalanceSar: number;
    periodRows: DualStatementRow[];
    periodDebitYer: number;
    periodCreditYer: number;
    periodDebitSar: number;
    periodCreditSar: number;
    closingBalanceYer: number;
    closingBalanceSar: number;
  }

  const dailyCustomerRecords = useMemo<DailyCustomerRecord[]>(() => {
    // Performance anti-freeze guard: only compute the full matrix when this tab & subTab are visible
    if (!isActive || subTab !== 'daily_customers') return [];

    const sortedDates = [...selectedDates].sort();
    const earliestDate =
      dailyDateMode === 'range'
        ? rangeFrom || '0000-00-00'
        : sortedDates[0] || todayStr;
    const latestDate =
      dailyDateMode === 'range'
        ? rangeTo || '9999-12-31'
        : sortedDates[sortedDates.length - 1] || todayStr;
    const selectedSet = new Set(sortedDates);

    const isDateSelected = (d: string) => {
      const part = getDatePart(d);
      if (!part) return false;
      if (dailyDateMode === 'range') {
        return (!rangeFrom || part >= rangeFrom) && (!rangeTo || part <= rangeTo);
      }
      return selectedSet.has(part);
    };

    // O(N) Pre-indexing by entityId / linkedAccountId instead of O(C * (I + V + J)) nested scans
    const invoicesByEntity = new Map<string, typeof db.invoices>();
    for (const inv of db.invoices) {
      if (inv.status === 'cancelled') continue;
      const arr = invoicesByEntity.get(inv.entityId);
      if (arr) arr.push(inv);
      else invoicesByEntity.set(inv.entityId, [inv]);
    }
    const vouchersByEntity = new Map<string, typeof db.paymentVouchers>();
    for (const v of db.paymentVouchers) {
      if (v.status !== 'posted' || !v.entityId) continue;
      const arr = vouchersByEntity.get(v.entityId);
      if (arr) arr.push(v);
      else vouchersByEntity.set(v.entityId, [v]);
    }
    const jeByAccountOrRef = new Map<string, typeof db.journalEntries>();
    const addJeKey = (key: string | undefined, je: (typeof db.journalEntries)[number]) => {
      if (!key) return;
      const arr = jeByAccountOrRef.get(key);
      if (arr) {
        if (arr[arr.length - 1] !== je) arr.push(je);
      } else {
        jeByAccountOrRef.set(key, [je]);
      }
    };
    for (const je of db.journalEntries) {
      if (je.status !== 'posted') continue;
      if (je.referenceId) addJeKey(`ref:${je.referenceId}`, je);
      for (const ln of je.lines) {
        if (ln.accountId) addJeKey(`accId:${ln.accountId}`, je);
        if (ln.accountCode) addJeKey(`accCode:${ln.accountCode}`, je);
      }
    }

    const records: DailyCustomerRecord[] = db.customers.map((cust) => {
      const custInvoices = invoicesByEntity.get(cust.id) || [];
      const custVouchers = vouchersByEntity.get(cust.id) || [];
      const custJes = Array.from(
        new Set([
          ...(jeByAccountOrRef.get(`ref:${cust.id}`) || []),
          ...(cust.linkedAccountId ? jeByAccountOrRef.get(`accId:${cust.linkedAccountId}`) || [] : []),
          ...(cust.linkedAccountCode ? jeByAccountOrRef.get(`accCode:${cust.linkedAccountCode}`) || [] : []),
        ])
      );

      const rawRows = generateCustomerStatement(
        cust.id,
        cust,
        custInvoices,
        custVouchers,
        custJes
      );

      let runningSar = 0;
      const dualRows: DualStatementRow[] = rawRows.map((r, idx) => {
        const rowRate =
          r.txCurrency === 'SAR' && r.exchangeRate && r.exchangeRate > 0
            ? r.exchangeRate
            : safeSarRate;
        const sarDebit =
          r.txCurrency === 'SAR' && typeof r.txDebit === 'number'
            ? round2(r.txDebit)
            : toSar(r.debit, rowRate);
        const sarCredit =
          r.txCurrency === 'SAR' && typeof r.txCredit === 'number'
            ? round2(r.txCredit)
            : toSar(r.credit, rowRate);

        if (idx === 0 && (r.documentType === 'رصيد_افتتاحي' || r.documentType === 'رصيد_سابق')) {
          runningSar = toSar(r.balance, rowRate);
        } else {
          runningSar = round2(runningSar + sarDebit - sarCredit);
        }
        return { ...r, rowRate, sarDebit, sarCredit, sarBalance: runningSar };
      });

      const hasSarTx = dualRows.some((r) => r.txCurrency === 'SAR');
      const isSaudi = (cust.currency || 'YER') === 'SAR' || hasSarTx;

      // Prior balance: last row strictly before earliestDate (always excluding synthetic non-period movements after latestDate)
      const rowsBeforeStart = dualRows.filter(
        (r) => r.documentType === 'رصيد_افتتاحي' || getDatePart(r.date) < earliestDate
      );
      const lastBefore = rowsBeforeStart[rowsBeforeStart.length - 1];
      const priorBalanceYer = lastBefore ? lastBefore.balance : cust.openingBalance;
      const priorBalanceSar = lastBefore ? lastBefore.sarBalance : toSar(cust.openingBalance);

      // Selected period rows (exclude synthetic opening balance row unless createdAt matches explicitly — opening row shouldn't count as daily movement)
      const periodRows = dualRows.filter(
        (r) => r.documentType !== 'رصيد_افتتاحي' && isDateSelected(r.date)
      );

      const periodDebitYer = periodRows.reduce((s, r) => s + r.debit, 0);
      const periodCreditYer = periodRows.reduce((s, r) => s + r.credit, 0);
      const periodDebitSar = periodRows.reduce((s, r) => s + r.sarDebit, 0);
      const periodCreditSar = periodRows.reduce((s, r) => s + r.sarCredit, 0);

      // Closing balance up through latestDate (or prior + net movement if custom multi-dates)
      const rowsUpToEnd = dualRows.filter(
        (r) => r.documentType === 'رصيد_افتتاحي' || getDatePart(r.date) <= latestDate
      );
      const lastInWindow = periodRows[periodRows.length - 1] || rowsUpToEnd[rowsUpToEnd.length - 1];
      const closingBalanceYer = lastInWindow ? lastInWindow.balance : priorBalanceYer;
      const closingBalanceSar = lastInWindow ? lastInWindow.sarBalance : priorBalanceSar;

      return {
        customer: cust,
        isSaudi,
        priorBalanceYer,
        priorBalanceSar,
        periodRows,
        periodDebitYer,
        periodCreditYer,
        periodDebitSar,
        periodCreditSar,
        closingBalanceYer,
        closingBalanceSar,
      };
    });

    // Apply filters
    let filtered = records.filter((rec) => {
      if (dailyOnlyActive && rec.periodRows.length === 0) return false;
      if (dailyCurrencyFilter !== 'ALL' && (rec.customer.currency || 'YER') !== dailyCurrencyFilter) return false;
      if (dailyOnlyWhatsapp) {
        const ph = rec.customer.whatsapp || rec.customer.phone || '';
        if (!validateWhatsAppPhone(ph).valid) return false;
      }
      return true;
    });

    if (deferredDailySearch.trim()) {
      const matchedIds = new Set(
        rankSearchResults(
          filtered.map((r) => r.customer),
          deferredDailySearch,
          (c) => ({
            code: c.code,
            id: c.id,
            name: c.nameAr,
            phone: c.whatsapp || c.phone,
            alt: c.addressDetails,
          })
        ).map((c) => c.id)
      );
      filtered = filtered.filter((r) => matchedIds.has(r.customer.id));
    }

    // Sort active movers first, then by absolute closing balance desc
    filtered.sort((a, b) => {
      if (b.periodRows.length !== a.periodRows.length) {
        return b.periodRows.length - a.periodRows.length;
      }
      return Math.abs(b.closingBalanceYer) - Math.abs(a.closingBalanceYer);
    });

    return filtered;
  }, [
    isActive,
    subTab,
    db.customers,
    db.invoices,
    db.paymentVouchers,
    db.journalEntries,
    dailyDateMode,
    selectedDates,
    rangeFrom,
    rangeTo,
    todayStr,
    dailyOnlyActive,
    dailyCurrencyFilter,
    dailyOnlyWhatsapp,
    deferredDailySearch,
    safeSarRate,
  ]);

  const buildCustomerDailyMessage = (rec: DailyCustomerRecord): string => {
    const lines: string[] = [
      `*${db.company.nameAr}*`,
      `العميل الكريم: *${rec.customer.nameAr}*`,
      `بيان حركة ${activePeriodLabel}:`,
    ];

    if (rec.isSaudi) {
      lines.push(`العملة: سعودي (SAR) · سعر التحويل: 1 ر.س = ${safeSarRate} ر.ي`);
      lines.push(`- الرصيد السابق: ${fmtNum(rec.priorBalanceSar)} ر.س (${fmtNum(rec.priorBalanceYer)} ر.ي)`);
      if (rec.periodRows.length === 0) {
        lines.push(`- لا توجد حركات خلال الفترة المحددة.`);
      } else {
        lines.push(`- تفاصيل الحركات (${rec.periodRows.length}):`);
        rec.periodRows.slice(0, 12).forEach((r) => {
          const mv =
            r.sarDebit > 0
              ? `عليه ${fmtNum(r.sarDebit)} ر.س`
              : `له ${fmtNum(r.sarCredit)} ر.س`;
          lines.push(`  • ${r.date} | ${r.documentType} (${r.documentNumber}): ${mv} — ${r.statement}`);
        });
        if (rec.periodRows.length > 12) {
          lines.push(`  ... وعدد ${rec.periodRows.length - 12} حركات أخرى.`);
        }
        lines.push(
          `- إجمالي الحركة: مدين ${fmtNum(rec.periodDebitSar)} ر.س | دائن ${fmtNum(rec.periodCreditSar)} ر.س`
        );
      }
      lines.push(
        `*الرصيد الحالي:* ${fmtNum(rec.closingBalanceSar)} ر.س (المعادل: ${fmtNum(rec.closingBalanceYer)} ر.ي)`
      );
    } else {
      lines.push(`- الرصيد السابق: ${fmtNum(rec.priorBalanceYer)} ر.ي`);
      if (rec.periodRows.length === 0) {
        lines.push(`- لا توجد حركات خلال الفترة المحددة.`);
      } else {
        lines.push(`- تفاصيل الحركات (${rec.periodRows.length}):`);
        rec.periodRows.slice(0, 12).forEach((r) => {
          const mv =
            r.debit > 0
              ? `عليه ${fmtNum(r.debit)} ر.ي`
              : `له ${fmtNum(r.credit)} ر.ي`;
          lines.push(`  • ${r.date} | ${r.documentType} (${r.documentNumber}): ${mv} — ${r.statement}`);
        });
        if (rec.periodRows.length > 12) {
          lines.push(`  ... وعدد ${rec.periodRows.length - 12} حركات أخرى.`);
        }
        lines.push(
          `- إجمالي الحركة: مدين ${fmtNum(rec.periodDebitYer)} ر.ي | دائن ${fmtNum(rec.periodCreditYer)} ر.ي`
        );
      }
      lines.push(`*الرصيد الحالي:* ${fmtNum(rec.closingBalanceYer)} ر.ي`);
    }

    lines.push(`نشكركم لتعاملكم معنا.`);
    return lines.join('\n');
  };

  const buildCustomerDailyPayload = (rec: DailyCustomerRecord): UniversalPreviewPayload => {
    const dual = rec.isSaudi;
    const headers = dual
      ? ['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين (ر.س)', 'دائن (ر.س)', 'الرصيد (ر.س)', 'المعادل (ر.ي)']
      : ['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين (ر.ي)', 'دائن (ر.ي)', 'الرصيد (ر.ي)'];

    const rows =
      rec.periodRows.length > 0
        ? rec.periodRows.map((r) =>
            dual
              ? [
                  r.date,
                  r.documentType,
                  r.documentNumber,
                  r.statement,
                  r.sarDebit > 0 ? fmtNum(r.sarDebit) : '-',
                  r.sarCredit > 0 ? fmtNum(r.sarCredit) : '-',
                  fmtNum(r.sarBalance),
                  fmtNum(r.balance),
                ]
              : [
                  r.date,
                  r.documentType,
                  r.documentNumber,
                  r.statement,
                  r.debit > 0 ? fmtNum(r.debit) : '-',
                  r.credit > 0 ? fmtNum(r.credit) : '-',
                  fmtNum(r.balance),
                ]
          )
        : [
            dual
              ? ['-', 'لا توجد حركة', '-', 'رصيد سابق مستمر', '-', '-', fmtNum(rec.closingBalanceSar), fmtNum(rec.closingBalanceYer)]
              : ['-', 'لا توجد حركة', '-', 'رصيد سابق مستمر', '-', '-', fmtNum(rec.closingBalanceYer)],
          ];

    return {
      title: `إشعار حركة عميل: ${rec.customer.nameAr}`,
      subtitle: dual
        ? `${activePeriodLabel} · عملة الحساب: SAR (1 ر.س = ${safeSarRate} ر.ي)`
        : activePeriodLabel,
      summaryCards: dual
        ? [
            {
              label: 'الرصيد السابق',
              value: `السعودي: ${fmtNum(rec.priorBalanceSar)} ر.س`,
              subValue: `اليمني: ${fmtNum(rec.priorBalanceYer)} ر.ي`,
              tone: 'blue',
            },
            {
              label: 'حركة الفترة (SAR)',
              value: `مدين: ${fmtNum(rec.periodDebitSar)} ر.س`,
              subValue: `دائن: ${fmtNum(rec.periodCreditSar)} ر.س`,
              tone: 'green',
            },
            {
              label: 'الرصيد الختامي (SAR)',
              value: `${fmtNum(rec.closingBalanceSar)} ر.س`,
              tone: 'gold',
            },
            {
              label: `المعادل باليمني (×${safeSarRate})`,
              value: `${fmtNum(rec.closingBalanceYer)} ر.ي`,
              tone: 'gold',
            },
          ]
        : [
            { label: 'الرصيد السابق', value: `${fmtNum(rec.priorBalanceYer)} ر.ي`, tone: 'blue' },
            { label: 'مدين الفترة', value: `${fmtNum(rec.periodDebitYer)} ر.ي`, tone: 'green' },
            { label: 'دائن الفترة', value: `${fmtNum(rec.periodCreditYer)} ر.ي`, tone: 'red' },
            { label: 'الرصيد الختامي', value: `${fmtNum(rec.closingBalanceYer)} ر.ي`, tone: 'gold' },
          ],
      tables: [
        {
          title: `تفاصيل حركات ${activePeriodLabel} (${rec.periodRows.length})`,
          headers,
          rows,
          totals: dual
            ? [
                'الإجمالي',
                `${rec.periodRows.length} حركة`,
                '',
                '',
                `${fmtNum(rec.periodDebitSar)} ر.س`,
                `${fmtNum(rec.periodCreditSar)} ر.س`,
                `${fmtNum(rec.closingBalanceSar)} ر.س`,
                `${fmtNum(rec.closingBalanceYer)} ر.ي`,
              ]
            : [
                'الإجمالي',
                `${rec.periodRows.length} حركة`,
                '',
                '',
                `${fmtNum(rec.periodDebitYer)} ر.ي`,
                `${fmtNum(rec.periodCreditYer)} ر.ي`,
                `${fmtNum(rec.closingBalanceYer)} ر.ي`,
              ],
        },
      ],
      whatsappText: buildCustomerDailyMessage(rec),
      defaultPhone: rec.customer.whatsapp || rec.customer.phone,
    };
  };

  const buildCombinedDailyPreview = (): UniversalPreviewPayload => {
    const chosen =
      selectedDailyCustIds.size > 0
        ? dailyCustomerRecords.filter((r) => selectedDailyCustIds.has(r.customer.id))
        : dailyCustomerRecords;

    const totDebitYer = chosen.reduce((s, r) => s + r.periodDebitYer, 0);
    const totCreditYer = chosen.reduce((s, r) => s + r.periodCreditYer, 0);
    const totClosingYer = chosen.reduce((s, r) => s + r.closingBalanceYer, 0);
    const totClosingSar = chosen.reduce((s, r) => s + r.closingBalanceSar, 0);

    return {
      title: `تقرير حركة العملاء (${activePeriodLabel})`,
      subtitle: `عدد العملاء: ${chosen.length} · سعر تحويل السعودي: 1 SAR = ${safeSarRate} YER`,
      summaryCards: [
        { label: 'العملاء المشمولون', value: `${chosen.length} عميل`, tone: 'blue' },
        {
          label: 'إجمالي مدين الفترة',
          value: `اليمني: ${fmtNum(totDebitYer)} ر.ي`,
          subValue: `السعودي: ${fmtNum(toSar(totDebitYer))} ر.س (×${safeSarRate})`,
          tone: 'green',
        },
        {
          label: 'إجمالي دائن الفترة',
          value: `اليمني: ${fmtNum(totCreditYer)} ر.ي`,
          subValue: `السعودي: ${fmtNum(toSar(totCreditYer))} ر.س (×${safeSarRate})`,
          tone: 'red',
        },
        {
          label: 'صافي الأرصدة الختامية',
          value: `اليمني: ${fmtNum(totClosingYer)} ر.ي`,
          subValue: `السعودي: ${fmtNum(totClosingSar)} ر.س`,
          tone: 'gold',
        },
      ],
      tables: [
        {
          title: 'ملخص حركة العملاء وأرصدتهم',
          headers: [
            'العميل',
            'العملة',
            'الحركات',
            'الرصيد السابق',
            'مدين الفترة',
            'دائن الفترة',
            'الرصيد الختامي (SAR)',
            'الرصيد الختامي (YER)',
          ],
          rows: chosen.map((r) => [
            r.customer.nameAr,
            r.customer.currency || 'YER',
            r.periodRows.length,
            r.isSaudi ? `${fmtNum(r.priorBalanceSar)} ر.س` : `${fmtNum(r.priorBalanceYer)} ر.ي`,
            r.isSaudi ? `${fmtNum(r.periodDebitSar)} ر.س` : `${fmtNum(r.periodDebitYer)} ر.ي`,
            r.isSaudi ? `${fmtNum(r.periodCreditSar)} ر.س` : `${fmtNum(r.periodCreditYer)} ر.ي`,
            fmtNum(r.closingBalanceSar),
            fmtNum(r.closingBalanceYer),
          ]),
          totals: [
            'الإجمالي',
            `${chosen.length} عميل`,
            chosen.reduce((s, r) => s + r.periodRows.length, 0),
            '',
            `${fmtNum(totDebitYer)} ر.ي (معادل)`,
            `${fmtNum(totCreditYer)} ر.ي (معادل)`,
            `${fmtNum(totClosingSar)} ر.س`,
            `${fmtNum(totClosingYer)} ر.ي`,
          ],
        },
      ],
      whatsappText: `${db.company.nameAr}\nملخص حركة العملاء (${activePeriodLabel})\n- العملاء: ${chosen.length}\n- مدين الفترة: ${fmtNum(toSar(totDebitYer))} ر.س (${fmtNum(totDebitYer)} ر.ي)\n- دائن الفترة: ${fmtNum(toSar(totCreditYer))} ر.س (${fmtNum(totCreditYer)} ر.ي)\n- صافي الأرصدة: ${fmtNum(totClosingSar)} ر.س (${fmtNum(totClosingYer)} ر.ي)`,
      defaultPhone: db.settings.notificationPhone || db.company.phone,
    };
  };

  const openBulkDispatchModal = () => {
    const targets =
      selectedDailyCustIds.size > 0
        ? dailyCustomerRecords.filter((r) => selectedDailyCustIds.has(r.customer.id))
        : dailyCustomerRecords;
    if (targets.length === 0) {
      onNotify('error', 'حدد عميلاً واحداً على الأقل للإرسال الجماعي.');
      return;
    }
    const items: BulkDispatchItem[] = targets.map((rec) => ({
      customerId: rec.customer.id,
      customerName: rec.customer.nameAr,
      phone: rec.customer.whatsapp || rec.customer.phone || '',
      message: buildCustomerDailyMessage(rec),
      closingBalanceLabel: rec.isSaudi
        ? `${fmtNum(rec.closingBalanceSar)} ر.س (${fmtNum(rec.closingBalanceYer)} ر.ي)`
        : `${fmtNum(rec.closingBalanceYer)} ر.ي`,
      selected: true,
      status: 'pending',
    }));
    const firstValidIdx = items.findIndex((x) => validateWhatsAppPhone(x.phone).valid);
    setBulkModalItems(items);
    setBulkQueueCursor(firstValidIdx >= 0 ? firstValidIdx : 0);
    setCopiedAllBulk(false);
  };

  const logCustomerDispatch = (
    name: string,
    phone: string,
    status: 'sent' | 'failed',
    details: string,
    reportType: DispatchLogEntry['reportType'] = 'customer_eod_statement',
    errorMessage?: string
  ) => {
    onAddDispatchLog({
      id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      recipientType: 'customer',
      recipientName: name,
      recipientPhone: phone,
      channel: 'whatsapp',
      reportType,
      status,
      details,
      errorMessage,
      retryCount: 0,
    });
  };

  const markBulkItemSentAndAdvance = (idx: number, normalizedPhone: string, notePrefix: string) => {
    setBulkModalItems((prev) => {
      if (!prev) return null;
      const updated = prev.map((x, i) => (i === idx ? { ...x, status: 'sent' as const, error: undefined } : x));
      setBulkQueueCursor(findNextSelectedPendingIdx(updated, idx));
      return updated;
    });
    const target = bulkModalItems?.[idx];
    if (target) {
      logCustomerDispatch(
        target.customerName,
        normalizedPhone,
        'sent',
        `${notePrefix} (${activePeriodLabel})`
      );
    }
  };

  const handleBulkCloudApiSend = async () => {
    if (!bulkModalItems || bulkModalItems.length === 0) return;
    const selectedPendingCount = bulkModalItems.filter((x) => x.selected && x.status !== 'sent').length;
    if (selectedPendingCount === 0) {
      onNotify('info', 'حدد عميلاً واحداً غير مرسل على الأقل للإرسال.');
      return;
    }
    const { enableWhatsAppAPI, whatsappApiEndpoint, whatsappApiToken } = db.settings;
    if (!enableWhatsAppAPI || !whatsappApiEndpoint || !whatsappApiToken) {
      onNotify('error', 'بوابة WhatsApp API غير مفعّلة في الإعدادات. استخدم الإرسال التسلسلي المباشر واحداً تلو الآخر أدناه.');
      return;
    }

    setBulkSendingApi(true);
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < bulkModalItems.length; i++) {
      const item = bulkModalItems[i];
      if (!item.selected || item.status === 'sent') continue;
      setBulkQueueCursor(i);

      const check = validateWhatsAppPhone(item.phone);
      if (!check.valid) {
        failedCount++;
        setBulkModalItems((prev) =>
          prev
            ? prev.map((x, idx) =>
                idx === i ? { ...x, status: 'failed', error: check.error || 'رقم غير صالح' } : x
              )
            : null
        );
        logCustomerDispatch(
          item.customerName,
          item.phone,
          'failed',
          `إرسال جماعي (${activePeriodLabel})`,
          'customer_eod_statement',
          check.error
        );
        continue;
      }

      try {
        const res = await fetch(whatsappApiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${whatsappApiToken}`,
          },
          body: JSON.stringify({
            to: check.normalized,
            phone: check.normalized,
            message: item.message,
            type: 'text',
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        sentCount++;
        setBulkModalItems((prev) =>
          prev ? prev.map((x, idx) => (idx === i ? { ...x, status: 'sent', error: undefined } : x)) : null
        );
        logCustomerDispatch(
          item.customerName,
          check.normalized,
          'sent',
          `إرسال جماعي تلقائي (${activePeriodLabel})`
        );
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : 'فشل الاتصال بالبوابة';
        setBulkModalItems((prev) =>
          prev ? prev.map((x, idx) => (idx === i ? { ...x, status: 'failed', error: msg } : x)) : null
        );
        logCustomerDispatch(
          item.customerName,
          check.normalized,
          'failed',
          `إرسال جماعي تلقائي (${activePeriodLabel})`,
          'customer_eod_statement',
          msg
        );
      }
    }

    setBulkSendingApi(false);
    onNotify(
      sentCount > 0 ? 'success' : 'error',
      `انتهى الإرسال الجماعي للمحددين: نجح ${sentCount} · فشل ${failedCount}.`
    );
  };

  const hasCloudApiReady = Boolean(
    db.settings.enableWhatsAppAPI && db.settings.whatsappApiEndpoint && db.settings.whatsappApiToken
  );

  // ==================== JSX ====================
  return (
    <div className="space-y-3" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Sub-navigation Strip */}
      <div className="v20-card-alt px-3 py-2 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setSubTab('v20_comp')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'v20_comp' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <FileBarChart className="w-3.5 h-3.5" />
          <span>{t('repTabComp', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('statement')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'statement' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>{t('repTabStmt', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('daily_customers')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'daily_customers' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{t('repTabDailyCust', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('hub_22')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'hub_22' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>{t('repTabHub22', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('daily_22')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'daily_22' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>{t('repTabDaily22', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('unified_docs')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'unified_docs' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Files className="w-3.5 h-3.5" />
          <span>{t('repTabDocs', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('tasks_dispatch')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'tasks_dispatch' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <BellRing className="w-3.5 h-3.5" />
          <span>{t('repTabTasks', lang)}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('visual_designer')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'visual_designer'
              ? 'bg-[var(--gold)] text-[#03060A]'
              : 'bg-[#08121E] border border-[var(--gold)]/70 text-[var(--gold)]'
          }`}
        >
          <LayoutTemplate className="w-3.5 h-3.5" />
          <span>{isEn ? 'Visual Report Designer' : 'مصمم التقارير المرئي'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('smart_ai')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
            subTab === 'smart_ai'
              ? 'bg-[var(--gold)] text-[#03060A]'
              : 'bg-[#0D1E32] border border-[var(--gold)]/60 text-[var(--gold)]'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t('repTabSmartAi', lang)}</span>
        </button>
      </div>

      {/* ==================== 1. V20 Comprehensive Management Report ==================== */}
      {subTab === 'v20_comp' && (
        <div className="space-y-3">
          <div className="v20-doc-toolbar">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setCompMode('DETAILED')}
                className={`px-3 py-1.5 rounded text-xs font-black cursor-pointer ${
                  compMode === 'DETAILED' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
                }`}
              >
                {t('detailedReport', lang)}
              </button>
              <button
                type="button"
                onClick={() => setCompMode('SUMMARY')}
                className={`px-3 py-1.5 rounded text-xs font-black cursor-pointer ${
                  compMode === 'SUMMARY' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
                }`}
              >
                {t('summaryReport', lang)}
              </button>
              <input
                type="date"
                value={dateFilter}
                disabled={showAllDates}
                onChange={(e) => setDateFilter(e.target.value)}
                className="v20-input px-2.5 py-1.5 text-xs tabular-nums disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowAllDates(!showAllDates)}
                className={`px-3 py-1.5 rounded text-xs font-extrabold border cursor-pointer ${
                  showAllDates
                    ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                    : 'bg-[#08121E] border-[var(--border-strong)] text-slate-300'
                }`}
              >
                {showAllDates ? `✓ ${t('showAllDates', lang)}` : t('showAllDates', lang)}
              </button>

              {/* Currency Filter & Conversion Rate */}
              <select
                value={compCurrencyFilter}
                onChange={(e) => setCompCurrencyFilter(e.target.value)}
                className="v20-input px-2.5 py-1.5 text-xs font-bold cursor-pointer"
                title={isEn ? 'Filter movements by currency' : 'تصفية حركات التقرير حسب العملة'}
              >
                <option value="ALL">{t('allCurrencies', lang)}</option>
                {db.currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.nameAr}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 bg-[#08121E] border border-[var(--border-strong)] rounded px-2 py-1 text-[11px]">
                <span className="text-[var(--gold)] font-bold">1 SAR =</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={displaySarRate}
                  onChange={(e) => setDisplaySarRate(Math.max(0.01, Number(e.target.value) || 1))}
                  className="w-16 bg-transparent text-white font-black text-center tabular-nums focus:outline-none"
                />
                <span className="text-slate-400">YER</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setPreviewPayload(buildCompPreview())}
                className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{t('previewPdf', lang)}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = buildCompPreview();
                  setWaPayload({
                    phone: p.defaultPhone,
                    recipientName: isEn ? 'Executive Management' : 'الإدارة العامة',
                    text: p.whatsappText,
                    previewPayload: p,
                    logReportType: 'daily_management',
                  });
                }}
                className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0B2B17] border border-[#25D366] text-[#25D366] flex items-center gap-1 cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>{t('sendDirectorWa', lang)}</span>
              </button>
            </div>
          </div>

          {/* Visibility & Selective Row Control Strip */}
          <div className="v20-card-alt px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-black text-[var(--gold)] ml-1">إظهار / إخفاء الأقسام:</span>
              {(
                [
                  ['receipts', `القبض (${compRawData.receipts.length})`],
                  ['payments', `الصرف (${compRawData.payments.length})`],
                  ['expenses', `المصروفات (${compRawData.expenses.length})`],
                  ['cashSales', `المبيعات النقدية (${compRawData.cashSales.length})`],
                  ['creditSales', `المبيعات الآجلة (${compRawData.creditSales.length})`],
                  ['customBooks', 'الدفاتر المخصصة'],
                  ['treasuries', `الصناديق (${compRawData.treasuries.length})`],
                ] as [SectionKey, string][]
              ).map(([secKey, label]) => (
                <button
                  key={secKey}
                  type="button"
                  onClick={() => toggleSectionVisibility(secKey)}
                  className={`px-2 py-1 rounded text-[11px] font-bold border flex items-center gap-1 cursor-pointer ${
                    visibleSections[secKey]
                      ? 'bg-[#0D2E1D]/70 border-emerald-500/60 text-emerald-200'
                      : 'bg-[#08121E] border-slate-700 text-slate-400 line-through opacity-75'
                  }`}
                >
                  {visibleSections[secKey] ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-300 font-bold">
                المحدد في التقرير: <span className="text-[var(--gold)]">{compActiveData.activeRowCount}</span> /{' '}
                {compActiveData.totalRawRows}
              </span>
              <button
                type="button"
                onClick={() => setHideUncheckedRows(!hideUncheckedRows)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                  hideUncheckedRows
                    ? 'bg-amber-950/60 border-amber-500 text-amber-200'
                    : 'bg-[#08121E] border-[var(--border-strong)] text-slate-300'
                }`}
              >
                {hideUncheckedRows ? '✓ إظهار الحركات المخفية' : 'إخفاء غير المحدد'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExcludedRowKeys(new Set());
                  setVisibleSections({
                    receipts: true,
                    payments: true,
                    expenses: true,
                    cashSales: true,
                    creditSales: true,
                    customBooks: true,
                    treasuries: true,
                  });
                }}
                className="px-2.5 py-1 rounded text-[11px] font-bold bg-[#08121E] border border-[var(--border-strong)] text-emerald-300 cursor-pointer"
              >
                إظهار وتحديد الكل
              </button>
              <button
                type="button"
                onClick={() => {
                  const allKeys: string[] = [
                    ...compRawData.receipts.map((v) => `receipt:${v.id}`),
                    ...compRawData.payments.map((v) => `payment:${v.id}`),
                    ...compRawData.expenses.map((ex) => `expense:${ex.id}`),
                    ...compRawData.cashSales.map((inv) => `cash:${inv.id}`),
                    ...compRawData.creditSales.map((inv) => `credit:${inv.id}`),
                    ...compRawData.treasuries.map((t) => `treasury:${t.id}`),
                    ...compRawData.customBooksSections.flatMap((s) => s.flat.map((f) => f.rowKey)),
                  ];
                  setExcludedRowKeys(new Set(allKeys));
                }}
                className="px-2.5 py-1 rounded text-[11px] font-bold bg-[#08121E] border border-[var(--border-strong)] text-rose-300 cursor-pointer"
              >
                إلغاء تحديد الكل
              </button>
            </div>
          </div>

          {/* Grand Totals Summary Grid (Dual SAR + Conversion Rate + YER) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {visibleSections.receipts && (
              <div className="v20-card p-3">
                <div className="text-[11px] text-[var(--text-secondary)]">سندات القبض ({compActiveData.receipts.length})</div>
                <div className="text-sm font-black text-emerald-300 tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.totalReceipts))} ر.س
                </div>
                <div className="text-[11px] text-slate-300 tabular-nums">
                  {fmtNum(compActiveData.totalReceipts)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
            {visibleSections.payments && (
              <div className="v20-card p-3">
                <div className="text-[11px] text-[var(--text-secondary)]">سندات الصرف ({compActiveData.payments.length})</div>
                <div className="text-sm font-black text-rose-400 tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.totalPayments))} ر.س
                </div>
                <div className="text-[11px] text-slate-300 tabular-nums">
                  {fmtNum(compActiveData.totalPayments)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
            {visibleSections.expenses && (
              <div className="v20-card p-3">
                <div className="text-[11px] text-[var(--text-secondary)]">المصروفات ({compActiveData.expenses.length})</div>
                <div className="text-sm font-black text-amber-300 tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.totalExpenses))} ر.س
                </div>
                <div className="text-[11px] text-slate-300 tabular-nums">
                  {fmtNum(compActiveData.totalExpenses)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
            {visibleSections.cashSales && (
              <div className="v20-card p-3">
                <div className="text-[11px] text-[var(--text-secondary)]">المبيعات النقدية ({compActiveData.cashSales.length})</div>
                <div className="text-sm font-black text-[var(--gold)] tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.totalCashSales))} ر.س
                </div>
                <div className="text-[11px] text-slate-300 tabular-nums">
                  {fmtNum(compActiveData.totalCashSales)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
            {visibleSections.creditSales && (
              <div className="v20-card p-3">
                <div className="text-[11px] text-[var(--text-secondary)]">المبيعات الآجلة ({compActiveData.creditSales.length})</div>
                <div className="text-sm font-black text-sky-300 tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.totalCreditSales))} ر.س
                </div>
                <div className="text-[11px] text-slate-300 tabular-nums">
                  {fmtNum(compActiveData.totalCreditSales)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
            {visibleSections.treasuries && (
              <div className="v20-card p-3 border-[var(--gold)]">
                <div className="text-[11px] text-[var(--gold)] font-bold">إجمالي السيولة القائمة</div>
                <div className="text-sm font-black text-[var(--gold)] tabular-nums mt-1">
                  {fmtNum(toSar(compActiveData.netCashPosition))} ر.س
                </div>
                <div className="text-[11px] text-slate-200 tabular-nums">
                  {fmtNum(compActiveData.netCashPosition)} ر.ي <span className="text-[10px] text-slate-400">(×{safeSarRate})</span>
                </div>
              </div>
            )}
          </div>

          <div className="v20-card-alt px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="relative flex-1 min-w-[230px] max-w-md">
              <Search className="w-3.5 h-3.5 text-[var(--gold)] absolute right-2.5 top-2 pointer-events-none" />
              <input
                type="text"
                value={compSearch}
                onChange={(e) => setCompSearch(e.target.value)}
                placeholder={
                  isEn
                    ? 'Quick search across details (number, party, statement)...'
                    : 'بحث سريع داخل تفاصيل التقرير (رقم سند/فاتورة، عميل، بيان، خزينة)...'
                }
                className="w-full v20-input pr-8 pl-7 py-1 text-xs"
              />
              {compSearch && (
                <button
                  type="button"
                  onClick={() => setCompSearch('')}
                  className="absolute left-2 top-1.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="text-[11px] font-bold flex flex-wrap items-center gap-2 tabular-nums">
              <span className="text-slate-400">{isEn ? 'Net Cash Flow Surplus:' : 'صافي الفائض النقدي التشغيلي:'}</span>
              <span className={`inline-flex flex-wrap items-center gap-2 font-black ${compActiveData.netCashSurplus >= 0 ? 'text-emerald-300' : 'text-rose-400'}`}>
                <bdi dir="auto">{fmtNum(compActiveData.netCashSurplus)} ر.ي</bdi>
                <span className="text-slate-500">·</span>
                <bdi dir="auto" className="text-amber-300">{fmtNum(toSar(compActiveData.netCashSurplus))} ر.س</bdi>
              </span>
            </div>
          </div>

          {/* Executive BI Ratios, SVG Performance & Multi-Currency Analytics */}
          <ReportsAnalyticsPanel
            db={db}
            lang={lang}
            sarRate={safeSarRate}
            onSelectCustomerStatement={(cid) => {
              setStmtPartyType('customer');
              setStmtPartyId(cid);
              setSubTab('statement');
            }}
          />

          {compMode === 'DETAILED' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Section 1: Receipts */}
              {visibleSections.receipts && (
                <div className="v20-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                    <h4 className="font-black text-xs text-emerald-300">
                      1. تفاصيل سندات القبض ({compActiveData.receipts.length} / {compRawData.receipts.length})
                    </h4>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.receipts.map((v) => `receipt:${v.id}`), true)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.receipts.map((v) => `receipt:${v.id}`), false)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-right text-xs border-collapse">
                      <thead className="bg-[#0B192C] text-[var(--gold)]">
                        <tr>
                          <th className="p-1.5 w-7 text-center">✓</th>
                          <th className="p-1.5">الرقم</th>
                          <th className="p-1.5">الطرف</th>
                          <th className="p-1.5">المبلغ</th>
                          <th className="p-1.5">المعادل (YER)</th>
                          <th className="p-1.5">التاريخ</th>
                          <th className="p-1.5 w-8 text-center">فتح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compRawData.receipts.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-slate-400 text-[11px]">
                              لا توجد سندات قبض مطابقة للفلاتر الحالية.
                            </td>
                          </tr>
                        ) : (
                          compRawData.receipts.slice(0, compRowLimit).map((v) => {
                            const key = `receipt:${v.id}`;
                            const checked = !excludedRowKeys.has(key);
                            if (hideUncheckedRows && !checked) return null;
                            const baseV = v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate);
                            return (
                              <tr
                                key={v.id}
                                onClick={() => toggleRowKey(key)}
                                className={`border-b border-[#1B2E44] cursor-pointer ${
                                  checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                }`}
                              >
                                <td className="p-1.5 text-center">
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                  )}
                                </td>
                                <td className="p-1.5 font-mono text-[var(--gold)]">{v.voucherNumber}</td>
                                <td className="p-1.5 font-bold">{v.entityName}</td>
                                <td className="p-1.5 font-black text-emerald-300 tabular-nums">
                                  {v.amount.toLocaleString()} {v.currency}
                                </td>
                                <td className="p-1.5 tabular-nums text-slate-300">{fmtNum(baseV)}</td>
                                <td className="p-1.5 tabular-nums">{v.date}</td>
                                <td className="p-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => onNavigateToRecord('treasury', v.id)}
                                    title="فتح السند"
                                    className="p-1 rounded bg-[#08121E] text-cyan-300 hover:text-[var(--gold)] cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {compRawData.receipts.length > compRowLimit && (
                      <div className="p-2 text-center border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setCompRowLimit((n) => n + 100)}
                          className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          عرض المزيد (+100) — المعروض {compRowLimit} من {compRawData.receipts.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 2: Payments */}
              {visibleSections.payments && (
                <div className="v20-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                    <h4 className="font-black text-xs text-rose-400">
                      2. تفاصيل سندات الصرف ({compActiveData.payments.length} / {compRawData.payments.length})
                    </h4>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.payments.map((v) => `payment:${v.id}`), true)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.payments.map((v) => `payment:${v.id}`), false)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-right text-xs border-collapse">
                      <thead className="bg-[#0B192C] text-[var(--gold)]">
                        <tr>
                          <th className="p-1.5 w-7 text-center">✓</th>
                          <th className="p-1.5">الرقم</th>
                          <th className="p-1.5">الطرف</th>
                          <th className="p-1.5">المبلغ</th>
                          <th className="p-1.5">المعادل (YER)</th>
                          <th className="p-1.5">التاريخ</th>
                          <th className="p-1.5 w-8 text-center">فتح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compRawData.payments.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="p-4 text-center text-slate-400 text-[11px]">
                              لا توجد سندات صرف مطابقة للفلاتر الحالية.
                            </td>
                          </tr>
                        ) : (
                          compRawData.payments.slice(0, compRowLimit).map((v) => {
                            const key = `payment:${v.id}`;
                            const checked = !excludedRowKeys.has(key);
                            if (hideUncheckedRows && !checked) return null;
                            const baseV = v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate);
                            return (
                              <tr
                                key={v.id}
                                onClick={() => toggleRowKey(key)}
                                className={`border-b border-[#1B2E44] cursor-pointer ${
                                  checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                }`}
                              >
                                <td className="p-1.5 text-center">
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                  )}
                                </td>
                                <td className="p-1.5 font-mono text-[var(--gold)]">{v.voucherNumber}</td>
                                <td className="p-1.5 font-bold">{v.entityName}</td>
                                <td className="p-1.5 font-black text-rose-400 tabular-nums">
                                  {v.amount.toLocaleString()} {v.currency}
                                </td>
                                <td className="p-1.5 tabular-nums text-slate-300">{fmtNum(baseV)}</td>
                                <td className="p-1.5 tabular-nums">{v.date}</td>
                                <td className="p-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => onNavigateToRecord('treasury', v.id)}
                                    title="فتح السند"
                                    className="p-1 rounded bg-[#08121E] text-cyan-300 hover:text-[var(--gold)] cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {compRawData.payments.length > compRowLimit && (
                      <div className="p-2 text-center border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setCompRowLimit((n) => n + 100)}
                          className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          عرض المزيد (+100) — المعروض {compRowLimit} من {compRawData.payments.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 3: Cash Sales */}
              {visibleSections.cashSales && (
                <div className="v20-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                    <h4 className="font-black text-xs text-[var(--gold)]">
                      3. فواتير المبيعات النقدية ({compActiveData.cashSales.length} / {compRawData.cashSales.length})
                    </h4>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.cashSales.map((i) => `cash:${i.id}`), true)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.cashSales.map((i) => `cash:${i.id}`), false)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-right text-xs border-collapse">
                      <thead className="bg-[#0B192C] text-[var(--gold)]">
                        <tr>
                          <th className="p-1.5 w-7 text-center">✓</th>
                          <th className="p-1.5">رقم الفاتورة</th>
                          <th className="p-1.5">العميل</th>
                          <th className="p-1.5">الصافي</th>
                          <th className="p-1.5">التاريخ</th>
                          <th className="p-1.5 w-8 text-center">فتح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compRawData.cashSales.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-slate-400 text-[11px]">
                              لا توجد فواتير مبيعات نقدية مطابقة.
                            </td>
                          </tr>
                        ) : (
                          compRawData.cashSales.slice(0, compRowLimit).map((inv) => {
                            const key = `cash:${inv.id}`;
                            const checked = !excludedRowKeys.has(key);
                            if (hideUncheckedRows && !checked) return null;
                            return (
                              <tr
                                key={inv.id}
                                onClick={() => toggleRowKey(key)}
                                className={`border-b border-[#1B2E44] cursor-pointer ${
                                  checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                }`}
                              >
                                <td className="p-1.5 text-center">
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                  )}
                                </td>
                                <td className="p-1.5 font-mono text-[var(--gold)]">{inv.invoiceNumber}</td>
                                <td className="p-1.5 font-bold">{inv.entityName}</td>
                                <td className="p-1.5 font-black text-emerald-300 tabular-nums">
                                  {inv.grandTotal.toLocaleString()} {inv.currency}
                                </td>
                                <td className="p-1.5 tabular-nums">{inv.date}</td>
                                <td className="p-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => onNavigateToRecord('sales', inv.id)}
                                    title="فتح الفاتورة"
                                    className="p-1 rounded bg-[#08121E] text-cyan-300 hover:text-[var(--gold)] cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {compRawData.cashSales.length > compRowLimit && (
                      <div className="p-2 text-center border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setCompRowLimit((n) => n + 100)}
                          className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          عرض المزيد (+100) — المعروض {compRowLimit} من {compRawData.cashSales.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 4: Credit & Partial Sales */}
              {visibleSections.creditSales && (
                <div className="v20-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                    <h4 className="font-black text-xs text-sky-300">
                      4. فواتير المبيعات الآجلة والجزئية ({compActiveData.creditSales.length} / {compRawData.creditSales.length})
                    </h4>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.creditSales.map((i) => `credit:${i.id}`), true)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.creditSales.map((i) => `credit:${i.id}`), false)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-right text-xs border-collapse">
                      <thead className="bg-[#0B192C] text-[var(--gold)]">
                        <tr>
                          <th className="p-1.5 w-7 text-center">✓</th>
                          <th className="p-1.5">رقم الفاتورة</th>
                          <th className="p-1.5">العميل</th>
                          <th className="p-1.5">الصافي</th>
                          <th className="p-1.5">المتبقي</th>
                          <th className="p-1.5 w-8 text-center">فتح</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compRawData.creditSales.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-slate-400 text-[11px]">
                              لا توجد فواتير مبيعات آجلة مطابقة.
                            </td>
                          </tr>
                        ) : (
                          compRawData.creditSales.slice(0, compRowLimit).map((inv) => {
                            const key = `credit:${inv.id}`;
                            const checked = !excludedRowKeys.has(key);
                            if (hideUncheckedRows && !checked) return null;
                            return (
                              <tr
                                key={inv.id}
                                onClick={() => toggleRowKey(key)}
                                className={`border-b border-[#1B2E44] cursor-pointer ${
                                  checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                }`}
                              >
                                <td className="p-1.5 text-center">
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                  )}
                                </td>
                                <td className="p-1.5 font-mono text-[var(--gold)]">{inv.invoiceNumber}</td>
                                <td className="p-1.5 font-bold">{inv.entityName}</td>
                                <td className="p-1.5 font-bold tabular-nums">
                                  {inv.grandTotal.toLocaleString()} {inv.currency}
                                </td>
                                <td className="p-1.5 font-black text-rose-400 tabular-nums">
                                  {inv.remainingAmount.toLocaleString()} {inv.currency}
                                </td>
                                <td className="p-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => onNavigateToRecord('sales', inv.id)}
                                    title="فتح الفاتورة"
                                    className="p-1 rounded bg-[#08121E] text-cyan-300 hover:text-[var(--gold)] cursor-pointer"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {compRawData.creditSales.length > compRowLimit && (
                      <div className="p-2 text-center border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setCompRowLimit((n) => n + 100)}
                          className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          عرض المزيد (+100) — المعروض {compRowLimit} من {compRawData.creditSales.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 5: Expenses */}
              {visibleSections.expenses && (
                <div className="v20-card p-3 space-y-2 lg:col-span-2">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                    <h4 className="font-black text-xs text-amber-300 flex flex-wrap items-center gap-2">
                      <span>5. تفاصيل المصروفات التشغيلية المباشرة ({compActiveData.expenses.length} / {compRawData.expenses.length}) — الإجمالي:</span>
                      <bdi dir="auto" className="text-white">{fmtNum(compActiveData.totalExpenses)} ر.ي</bdi>
                      <span className="text-slate-400">·</span>
                      <bdi dir="auto" className="text-emerald-300">{fmtNum(toSar(compActiveData.totalExpenses))} ر.س</bdi>
                    </h4>
                    <div className="flex items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.expenses.map((e) => `expense:${e.id}`), true)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setSectionRowsSelected(compRawData.expenses.map((e) => `expense:${e.id}`), false)}
                        className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    <table className="w-full text-right text-xs border-collapse">
                      <thead className="bg-[#0B192C] text-[var(--gold)]">
                        <tr>
                          <th className="p-1.5 w-7 text-center">✓</th>
                          <th className="p-1.5">الرقم</th>
                          <th className="p-1.5">بند المصروف</th>
                          <th className="p-1.5">المستفيد</th>
                          <th className="p-1.5">المبلغ</th>
                          <th className="p-1.5">المعادل (YER)</th>
                          <th className="p-1.5">البيان</th>
                          <th className="p-1.5">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compRawData.expenses.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-4 text-center text-slate-400 text-[11px]">
                              لا توجد مصروفات تشغيلية مطابقة.
                            </td>
                          </tr>
                        ) : (
                          compRawData.expenses.slice(0, compRowLimit).map((ex) => {
                            const key = `expense:${ex.id}`;
                            const checked = !excludedRowKeys.has(key);
                            if (hideUncheckedRows && !checked) return null;
                            const baseExp = convertToBase(ex.total || ex.amount || 0, ex.currency, db.currencies);
                            return (
                              <tr
                                key={ex.id}
                                onClick={() => toggleRowKey(key)}
                                className={`border-b border-[#1B2E44] cursor-pointer ${
                                  checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                }`}
                              >
                                <td className="p-1.5 text-center">
                                  {checked ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                  )}
                                </td>
                                <td className="p-1.5 font-mono text-[var(--gold)]">{ex.expenseNumber}</td>
                                <td className="p-1.5 font-bold">{ex.categoryName}</td>
                                <td className="p-1.5">{ex.beneficiary}</td>
                                <td className="p-1.5 font-black text-rose-300 tabular-nums">
                                  {(ex.total || ex.amount).toLocaleString()} {ex.currency}
                                </td>
                                <td className="p-1.5 tabular-nums text-slate-300">{fmtNum(baseExp)}</td>
                                <td className="p-1.5 text-slate-300">{ex.statement}</td>
                                <td className="p-1.5 tabular-nums">{ex.date}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    {compRawData.expenses.length > compRowLimit && (
                      <div className="p-2 text-center border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => setCompRowLimit((n) => n + 100)}
                          className="px-3 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 text-[11px] font-bold cursor-pointer"
                        >
                          عرض المزيد (+100) — المعروض {compRowLimit} من {compRawData.expenses.length}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Section 6: Custom Books */}
              {visibleSections.customBooks &&
                compRawData.customBooksSections
                  .filter((s) => s.flat.length > 0)
                  .map((sec) => {
                    const activeSec = compActiveData.customBooksSections.find((a) => a.book.id === sec.book.id);
                    return (
                      <div key={sec.book.id} className="v20-card p-3 space-y-2 lg:col-span-2">
                        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-1.5">
                          <h4 className="font-black text-xs text-[var(--gold)] flex flex-wrap items-center gap-2">
                            <span>
                              دفتر: {sec.book.nameAr} ({activeSec?.activeFlat.length || 0} / {sec.flat.length} حركة)
                            </span>
                            {activeSec?.singleCurr ? (
                              <>
                                <span>· مدين: <bdi dir="auto">{fmtNum(activeSec.debitSum)} {activeSec.singleCurr}</bdi></span>
                                <span>· دائن: <bdi dir="auto">{fmtNum(activeSec.creditSum)} {activeSec.singleCurr}</bdi></span>
                              </>
                            ) : (
                              <>
                                <span>· مدين (معادل): <bdi dir="auto">{fmtNum(activeSec?.debitBaseSum || 0)} ر.ي</bdi></span>
                                <span>· دائن (معادل): <bdi dir="auto">{fmtNum(activeSec?.creditBaseSum || 0)} ر.ي</bdi></span>
                              </>
                            )}
                          </h4>
                          <div className="flex items-center gap-1 text-[10px]">
                            <button
                              type="button"
                              onClick={() => setSectionRowsSelected(sec.flat.map((f) => f.rowKey), true)}
                              className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                            >
                              تحديد الكل
                            </button>
                            <button
                              type="button"
                              onClick={() => setSectionRowsSelected(sec.flat.map((f) => f.rowKey), false)}
                              className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full text-right text-xs border-collapse">
                            <thead className="bg-[#0B192C] text-[var(--gold)]">
                              <tr>
                                <th className="p-1.5 w-7 text-center">✓</th>
                                <th className="p-1.5">القيد</th>
                                <th className="p-1.5">التاريخ</th>
                                <th className="p-1.5">الطرف / البند</th>
                                <th className="p-1.5">البيان</th>
                                <th className="p-1.5">مدين</th>
                                <th className="p-1.5">دائن</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sec.flat.map((fr) => {
                                const checked = !excludedRowKeys.has(fr.rowKey);
                                if (hideUncheckedRows && !checked) return null;
                                return (
                                  <tr
                                    key={fr.rowKey}
                                    onClick={() => toggleRowKey(fr.rowKey)}
                                    className={`border-b border-[#1B2E44] cursor-pointer ${
                                      checked ? 'hover:bg-amber-500/10' : 'opacity-45 bg-slate-900/40'
                                    }`}
                                  >
                                    <td className="p-1.5 text-center">
                                      {checked ? (
                                        <CheckSquare className="w-3.5 h-3.5 text-emerald-400 inline" />
                                      ) : (
                                        <Square className="w-3.5 h-3.5 text-slate-500 inline" />
                                      )}
                                    </td>
                                    <td className="p-1.5 font-mono text-[var(--gold)]">{fr.entryNumber}</td>
                                    <td className="p-1.5 tabular-nums">{fr.date}</td>
                                    <td className="p-1.5 font-bold">{fr.partyName || '-'}</td>
                                    <td className="p-1.5">{fr.statement || '-'}</td>
                                    <td className="p-1.5 font-black text-emerald-300 tabular-nums">
                                      {(fr.debit || 0).toLocaleString()}
                                    </td>
                                    <td className="p-1.5 font-black text-rose-300 tabular-nums">
                                      {(fr.credit || 0).toLocaleString()}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
            </div>
          )}

          {/* Cash Boxes Liquidity */}
          {visibleSections.treasuries && (
            <div className="v20-card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-xs text-[var(--gold)]">
                  ملخص السيولة في الصناديق وشركات الصرافة ({compActiveData.treasuries.length} / {compRawData.treasuries.length})
                </h4>
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setSectionRowsSelected(compRawData.treasuries.map((t) => `treasury:${t.id}`), true)}
                    className="px-1.5 py-0.5 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 cursor-pointer"
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => setSectionRowsSelected(compRawData.treasuries.map((t) => `treasury:${t.id}`), false)}
                    className="px-1.5 py-0.5 rounded bg-[#08121E] border border-slate-700 text-slate-300 cursor-pointer"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {compRawData.treasuries.length === 0 ? (
                  <div className="col-span-full py-4 text-center text-xs text-slate-400">
                    لا توجد صناديق أو حسابات صرافة مطابقة.
                  </div>
                ) : (
                  compRawData.treasuries.map((t) => {
                    const key = `treasury:${t.id}`;
                    const checked = !excludedRowKeys.has(key);
                    if (hideUncheckedRows && !checked) return null;
                    const rate = getEffectiveCurrencyRate(db.currencies, t.currency);
                    const yerVal = t.balance * rate;
                    return (
                      <div
                        key={t.id}
                        onClick={() => toggleRowKey(key)}
                        className={`v20-card-alt p-2.5 text-xs flex justify-between items-center cursor-pointer border ${
                          checked ? 'border-[var(--border-strong)]' : 'border-slate-800 opacity-45'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {checked ? (
                            <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          )}
                          <div>
                            <div className="font-bold text-white">{t.nameAr}</div>
                            <div className="text-[10px] text-slate-400">{t.type}</div>
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="font-black text-[var(--gold)] tabular-nums">
                            {t.balance.toLocaleString()} {t.currency}
                          </div>
                          {t.currency !== 'YER' && (
                            <div className="text-[10px] text-slate-300 tabular-nums">
                              {fmtNum(yerVal)} ر.ي (×{rate})
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 2. Party Detailed Ledger Statement (Dual SAR / YER + Rate) ==================== */}
      {subTab === 'statement' && (
        <div className="v20-card p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-[260px]">
              <select
                value={stmtPartyType}
                onChange={(e) => {
                  const t = e.target.value as 'customer' | 'vendor';
                  setStmtPartyType(t);
                  setStmtPartyId(t === 'customer' ? db.customers[0]?.id || '' : db.vendors[0]?.id || '');
                }}
                className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <option value="customer">كشف حساب عميل</option>
                <option value="vendor">كشف حساب مورد</option>
              </select>

              <div className="w-72 sm:w-80">
                <SearchableSelect
                  options={stmtOptions}
                  value={stmtPartyId}
                  onChange={(opt) => opt && setStmtPartyId(opt.id)}
                  placeholder="ابحث بالاسم أو الكود أو الهاتف..."
                  searchPlaceholder="اكتب حرفين على الأقل أو الرقم للبحث..."
                  onEditSelected={
                    (stmtPartyType === 'customer' ? onSaveCustomer : onSaveVendor)
                      ? () => {
                          if (stmtPartyType === 'customer') {
                            const c = db.customers.find((x) => x.id === stmtPartyId);
                            if (c)
                              setEditingStmtParty({
                                kind: 'customer',
                                id: c.id,
                                nameAr: c.nameAr,
                                phone: c.whatsapp || c.phone || '',
                                currency: c.currency || 'YER',
                              });
                          } else {
                            const v = db.vendors.find((x) => x.id === stmtPartyId);
                            if (v)
                              setEditingStmtParty({
                                kind: 'vendor',
                                id: v.id,
                                nameAr: v.nameAr,
                                phone: v.whatsapp || v.phone || '',
                                currency: v.currency || 'YER',
                              });
                          }
                        }
                      : undefined
                  }
                  editTitle="تعديل بيانات الطرف وعملة الحساب"
                />
              </div>

              <select
                value={stmtCurrencyView}
                onChange={(e) => setStmtCurrencyView(e.target.value as 'AUTO' | 'DUAL_SAR_YER' | 'YER_ONLY')}
                className="v20-input px-2.5 py-1.5 text-xs font-bold cursor-pointer"
              >
                <option value="AUTO">تلقائي حسب عملة الحساب</option>
                <option value="DUAL_SAR_YER">عرض مزدوج (سعودي + يمني)</option>
                <option value="YER_ONLY">ريال يمني فقط (YER)</option>
              </select>

              <div className="flex items-center gap-1 bg-[#08121E] border border-[var(--border-strong)] rounded px-2 py-1 text-[11px]">
                <span className="text-[var(--gold)] font-bold">نسبة التحويل: 1 ر.س =</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={displaySarRate}
                  onChange={(e) => setDisplaySarRate(Math.max(0.01, Number(e.target.value) || 1))}
                  className="w-16 bg-transparent text-white font-black text-center tabular-nums focus:outline-none"
                />
                <span className="text-slate-400">ر.ي</span>
              </div>

              <div className="flex items-center gap-1.5 bg-[#08121E] border border-[var(--border-strong)] rounded px-2 py-1 text-[11px]">
                <CalendarDays className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-300 font-bold">من:</span>
                <input
                  type="date"
                  value={stmtStartDate}
                  onChange={(e) => setStmtStartDate(e.target.value)}
                  className="bg-transparent text-white font-mono text-[11px] focus:outline-none"
                  title="تصفية بتاريخ سابق (يرحّل ما قبله كرصيد سابق)"
                />
                <span className="text-slate-300 font-bold">إلى:</span>
                <input
                  type="date"
                  value={stmtEndDate}
                  onChange={(e) => setStmtEndDate(e.target.value)}
                  className="bg-transparent text-white font-mono text-[11px] focus:outline-none"
                />
                {(stmtStartDate || stmtEndDate) && (
                  <button
                    type="button"
                    onClick={() => {
                      setStmtStartDate('');
                      setStmtEndDate('');
                    }}
                    className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                    title="عرض كافة الفترات"
                  >
                    مسح
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setPreviewPayload(buildStatementPreview())}
                className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>معاينة / طباعة / PDF</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = buildStatementPreview();
                  setWaPayload({
                    phone: p.defaultPhone,
                    recipientName: statementResult.partyName,
                    text: p.whatsappText,
                    previewPayload: p,
                    logReportType: 'customer_eod_statement',
                  });
                }}
                className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0B2B17] border border-[#25D366] text-[#25D366] flex items-center gap-1 cursor-pointer"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>إرسال واتساب (صورة/PDF)</span>
              </button>
            </div>
          </div>

          {/* Statement Dual-Currency Summary Strip */}
          {statementResult.showDualSar ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="v20-card-alt p-2.5 border-amber-500/40">
                <div className="text-[11px] text-amber-300 font-bold">الرصيد الختامي بالسعودي (SAR)</div>
                <div className="text-base font-black text-[var(--gold)] tabular-nums mt-0.5">
                  {fmtNum(statementResult.closingSar)} ر.س
                </div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  مدين: {fmtNum(statementResult.totalDebitSar)} · دائن: {fmtNum(statementResult.totalCreditSar)}
                </div>
              </div>
              <div className="v20-card-alt p-2.5 border-sky-500/30">
                <div className="text-[11px] text-sky-300 font-bold">نسبة التحويل المعتمدة</div>
                <div className="text-base font-black text-white tabular-nums mt-0.5">
                  1 ر.س = {safeSarRate} ر.ي
                </div>
                <div className="text-[10px] text-slate-400">
                  تصنيف الحساب: {statementResult.partyCurrency === 'SAR' ? 'حساب سعودي' : statementResult.partyCurrency}
                </div>
              </div>
              <div className="v20-card-alt p-2.5 border-emerald-500/30">
                <div className="text-[11px] text-emerald-300 font-bold">الإجمالي المعادل باليمني (YER)</div>
                <div className="text-base font-black text-emerald-300 tabular-nums mt-0.5">
                  {fmtNum(statementResult.closingYer)} ر.ي
                </div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  مدين: {fmtNum(statementResult.totalDebitYer)} · دائن: {fmtNum(statementResult.totalCreditYer)}
                </div>
              </div>
              <div className="v20-card-alt p-2.5">
                <div className="text-[11px] text-slate-400 font-bold">العميل / المورد</div>
                <div className="text-sm font-black text-white mt-0.5 truncate">{statementResult.partyName}</div>
                <div className="text-[10px] text-slate-400">{statementResult.rows.length} حركة مسجلة</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              <div className="v20-card-alt p-2.5">
                <div className="text-[11px] text-slate-400">إجمالي مدين (YER)</div>
                <div className="text-sm font-black text-emerald-300 tabular-nums">{fmtNum(statementResult.totalDebitYer)} ر.ي</div>
              </div>
              <div className="v20-card-alt p-2.5">
                <div className="text-[11px] text-slate-400">إجمالي دائن (YER)</div>
                <div className="text-sm font-black text-rose-300 tabular-nums">{fmtNum(statementResult.totalCreditYer)} ر.ي</div>
              </div>
              <div className="v20-card-alt p-2.5">
                <div className="text-[11px] text-[var(--gold)]">الرصيد الختامي (YER)</div>
                <div className="text-sm font-black text-[var(--gold)] tabular-nums">{fmtNum(statementResult.closingYer)} ر.ي</div>
              </div>
            </div>
          )}

          <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                <tr>
                  <th className="p-2 border-l border-[#1B2E44]">التاريخ</th>
                  <th className="p-2 border-l border-[#1B2E44]">المستند</th>
                  <th className="p-2 border-l border-[#1B2E44]">الرقم</th>
                  <th className="p-2 border-l border-[#1B2E44]">البيان</th>
                  {statementResult.showDualSar && (
                    <>
                      <th className="p-2 border-l border-[#1B2E44] text-center text-amber-300">مدين (ر.س)</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center text-amber-300">دائن (ر.س)</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center text-amber-300">الرصيد (ر.س)</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center text-sky-300">التحويل</th>
                    </>
                  )}
                  <th className="p-2 border-l border-[#1B2E44] text-center">مدين (ر.ي)</th>
                  <th className="p-2 border-l border-[#1B2E44] text-center">دائن (ر.ي)</th>
                  <th className="p-2 text-center">الرصيد (ر.ي)</th>
                </tr>
              </thead>
              <tbody>
                {statementResult.rows.map((r, i) => (
                  <tr key={i} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                    <td className="p-2 tabular-nums border-l border-[#1B2E44]">{r.date}</td>
                    <td className="p-2 font-bold border-l border-[#1B2E44]">{r.documentType}</td>
                    <td className="p-2 font-mono text-[var(--gold)] border-l border-[#1B2E44]">{r.documentNumber}</td>
                    <td className="p-2 border-l border-[#1B2E44]">{r.statement}</td>
                    {statementResult.showDualSar && (
                      <>
                        <td className="p-2 text-center font-bold text-amber-200 tabular-nums border-l border-[#1B2E44]">
                          {r.sarDebit > 0 ? fmtNum(r.sarDebit) : '-'}
                        </td>
                        <td className="p-2 text-center font-bold text-rose-200 tabular-nums border-l border-[#1B2E44]">
                          {r.sarCredit > 0 ? fmtNum(r.sarCredit) : '-'}
                        </td>
                        <td className="p-2 text-center font-black text-amber-300 tabular-nums border-l border-[#1B2E44]">
                          {fmtNum(r.sarBalance)} ر.س
                        </td>
                        <td className="p-2 text-center text-[11px] text-sky-300 tabular-nums border-l border-[#1B2E44]">
                          ×{r.rowRate}
                        </td>
                      </>
                    )}
                    <td className="p-2 text-center font-bold text-emerald-300 tabular-nums border-l border-[#1B2E44]">
                      {r.debit > 0 ? fmtNum(r.debit) : '-'}
                    </td>
                    <td className="p-2 text-center font-bold text-rose-300 tabular-nums border-l border-[#1B2E44]">
                      {r.credit > 0 ? fmtNum(r.credit) : '-'}
                    </td>
                    <td className="p-2 text-center font-black text-[var(--gold)] tabular-nums">
                      {fmtNum(r.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {statementResult.rows.length > 0 && (
                <tfoot className="bg-[#0B192C] font-black border-t-2 border-[var(--gold)]">
                  <tr>
                    <td colSpan={4} className="p-2 border-l border-[#1B2E44] text-[var(--gold)]">
                      الإجمالي والرصيد الختامي ({statementResult.rows.length} حركة)
                    </td>
                    {statementResult.showDualSar && (
                      <>
                        <td className="p-2 text-center text-amber-300 tabular-nums border-l border-[#1B2E44]">
                          {fmtNum(statementResult.totalDebitSar)} ر.س
                        </td>
                        <td className="p-2 text-center text-rose-300 tabular-nums border-l border-[#1B2E44]">
                          {fmtNum(statementResult.totalCreditSar)} ر.س
                        </td>
                        <td className="p-2 text-center text-[var(--gold)] tabular-nums border-l border-[#1B2E44]">
                          {fmtNum(statementResult.closingSar)} ر.س
                        </td>
                        <td className="p-2 text-center text-sky-300 tabular-nums border-l border-[#1B2E44]">
                          ×{safeSarRate}
                        </td>
                      </>
                    )}
                    <td className="p-2 text-center text-emerald-300 tabular-nums border-l border-[#1B2E44]">
                      {fmtNum(statementResult.totalDebitYer)} ر.ي
                    </td>
                    <td className="p-2 text-center text-rose-300 tabular-nums border-l border-[#1B2E44]">
                      {fmtNum(statementResult.totalCreditYer)} ر.ي
                    </td>
                    <td className="p-2 text-center text-[var(--gold)] tabular-nums">
                      {fmtNum(statementResult.closingYer)} ر.ي
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ==================== 3. Daily / Multi-Day Customer Movement Report & Bulk Dispatch ==================== */}
      {subTab === 'daily_customers' && (
        <div className="space-y-3">
          {/* Date Selection & Filters Toolbar */}
          <div className="v20-card p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[var(--gold)]" />
                <span className="font-black text-sm text-[var(--gold)]">
                  تقرير حركة العملاء اليومية / متعددة الأيام وإرسال الواتساب (فردي وجماعي)
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPreviewPayload(buildCombinedDailyPreview())}
                  className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>معاينة / طباعة / PDF المجمع</span>
                </button>
                <button
                  type="button"
                  onClick={openBulkDispatchModal}
                  className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0B2B17] border border-[#25D366] text-[#25D366] flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    إرسال جماعي عبر واتساب ({selectedDailyCustIds.size > 0 ? selectedDailyCustIds.size : dailyCustomerRecords.length})
                  </span>
                </button>
              </div>
            </div>

            {/* Multi-Day vs Range Selector */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="flex items-center rounded overflow-hidden border border-[var(--border-strong)]">
                <button
                  type="button"
                  onClick={() => setDailyDateMode('multi')}
                  className={`px-3 py-1.5 font-black cursor-pointer ${
                    dailyDateMode === 'multi' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] text-white'
                  }`}
                >
                  تحديد يوم أو عدة أيام
                </button>
                <button
                  type="button"
                  onClick={() => setDailyDateMode('range')}
                  className={`px-3 py-1.5 font-black cursor-pointer ${
                    dailyDateMode === 'range' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] text-white'
                  }`}
                >
                  نطاق من تاريخ إلى تاريخ
                </button>
              </div>

              {dailyDateMode === 'multi' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="date"
                    value={addDateInput}
                    onChange={(e) => setAddDateInput(e.target.value)}
                    className="v20-input px-2.5 py-1 text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!addDateInput) return;
                      setSelectedDates((prev) =>
                        prev.includes(addDateInput) ? prev : [...prev, addDateInput].sort()
                      );
                    }}
                    className="px-2.5 py-1.5 rounded bg-[var(--gold)] text-[#03060A] font-black flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة يوم</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedDates([todayStr])}
                    className="px-2.5 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-emerald-300 font-bold cursor-pointer"
                  >
                    اليوم فقط
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      const yest = d.toISOString().slice(0, 10);
                      setSelectedDates([yest]);
                    }}
                    className="px-2.5 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 font-bold cursor-pointer"
                  >
                    أمس فقط
                  </button>
                  {availableTransactionDates.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDates(availableTransactionDates.slice(0, 3))}
                      className="px-2.5 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-amber-300 font-bold cursor-pointer"
                    >
                      آخر 3 أيام نشطة
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-bold">من:</span>
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="v20-input px-2.5 py-1 text-xs tabular-nums"
                  />
                  <span className="text-slate-400 font-bold">إلى:</span>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="v20-input px-2.5 py-1 text-xs tabular-nums"
                  />
                </div>
              )}

              <div className="flex items-center gap-1 bg-[#08121E] border border-[var(--border-strong)] rounded px-2 py-1 text-[11px] mr-auto">
                <span className="text-[var(--gold)] font-bold">1 ر.س =</span>
                <input
                  type="number"
                  min={1}
                  step="any"
                  value={displaySarRate}
                  onChange={(e) => setDisplaySarRate(Math.max(0.01, Number(e.target.value) || 1))}
                  className="w-16 bg-transparent text-white font-black text-center tabular-nums focus:outline-none"
                />
                <span className="text-slate-400">ر.ي</span>
              </div>
            </div>

            {/* Selected Multi-Day Pills & Recent Active Dates Quick-Toggle */}
            {dailyDateMode === 'multi' && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-slate-400 font-bold">الأيام المحددة ({selectedDates.length}):</span>
                {selectedDates.map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setSelectedDates((prev) => prev.filter((x) => x !== dt))}
                    className="px-2 py-0.5 rounded bg-[var(--gold)]/20 border border-[var(--gold)] text-[var(--gold)] font-black flex items-center gap-1 cursor-pointer tabular-nums"
                    title="اضغط لإزالة هذا اليوم"
                  >
                    <span>{dt}</span>
                    <X className="w-3 h-3" />
                  </button>
                ))}
                {availableTransactionDates.length > 0 && (
                  <>
                    <span className="text-slate-500 mr-2">أيام بها حركات:</span>
                    {availableTransactionDates.slice(0, 7).map((dt) => {
                      const active = selectedDates.includes(dt);
                      return (
                        <button
                          key={dt}
                          type="button"
                          onClick={() =>
                            setSelectedDates((prev) =>
                              prev.includes(dt) ? prev.filter((x) => x !== dt) : [...prev, dt].sort()
                            )
                          }
                          className={`px-2 py-0.5 rounded border tabular-nums cursor-pointer ${
                            active
                              ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300 font-bold'
                              : 'bg-[#08121E] border-slate-700 text-slate-300 hover:border-[var(--gold)]'
                          }`}
                        >
                          {active ? '✓ ' : '+ '}
                          {dt}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}

            {/* Search & Filters + Selection Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative flex-1 min-w-[210px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-[var(--gold)] absolute right-2.5 top-2" />
                  <input
                    type="text"
                    value={dailySearch}
                    onChange={(e) => setDailySearch(e.target.value)}
                    placeholder="بحث عن عميل بالاسم أو الرقم أو الهاتف..."
                    className="w-full v20-input pr-8 pl-2.5 py-1 text-xs"
                  />
                </div>
                <select
                  value={dailyCurrencyFilter}
                  onChange={(e) => setDailyCurrencyFilter(e.target.value)}
                  className="v20-input px-2.5 py-1 text-xs font-bold cursor-pointer"
                >
                  <option value="ALL">كل العملات</option>
                  {db.currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.nameAr}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setDailyOnlyActive(!dailyOnlyActive)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    dailyOnlyActive
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                      : 'bg-[#08121E] border-[var(--border-strong)] text-slate-300'
                  }`}
                >
                  {dailyOnlyActive ? '✓ ذوو الحركة فقط' : 'كل العملاء'}
                </button>
                <button
                  type="button"
                  onClick={() => setDailyOnlyWhatsapp(!dailyOnlyWhatsapp)}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold border cursor-pointer ${
                    dailyOnlyWhatsapp
                      ? 'bg-[#0B2B17] border-[#25D366] text-[#25D366]'
                      : 'bg-[#08121E] border-[var(--border-strong)] text-slate-300'
                  }`}
                >
                  {dailyOnlyWhatsapp ? '✓ لديهم واتساب صالح فقط' : 'كل الأرقام'}
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedDailyCustIds(new Set(dailyCustomerRecords.map((r) => r.customer.id)))}
                  className="px-2 py-1 rounded bg-[#08121E] border border-emerald-500/40 text-emerald-300 font-bold cursor-pointer"
                >
                  تحديد الكل ({dailyCustomerRecords.length})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedDailyCustIds(
                      new Set(
                        dailyCustomerRecords
                          .filter((r) => validateWhatsAppPhone(r.customer.whatsapp || r.customer.phone || '').valid)
                          .map((r) => r.customer.id)
                      )
                    )
                  }
                  className="px-2 py-1 rounded bg-[#08121E] border border-[#25D366]/40 text-[#25D366] font-bold cursor-pointer"
                >
                  تحديد من لديه واتساب
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDailyCustIds(new Set())}
                  className="px-2 py-1 rounded bg-[#08121E] border border-slate-700 text-slate-300 font-bold cursor-pointer"
                >
                  إلغاء التحديد
                </button>
              </div>
            </div>
          </div>

          {/* Customer Daily Movements Table */}
          <div className="v20-card p-3">
            {dailyCustomerRecords.length === 0 ? (
              <div className="py-10 text-center space-y-2 text-xs text-slate-400">
                <div>لا توجد حركات عملاء مطابقة في ({activePeriodLabel}).</div>
                {dailyOnlyActive && (
                  <button
                    type="button"
                    onClick={() => setDailyOnlyActive(false)}
                    className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] font-bold cursor-pointer"
                  >
                    عرض جميع العملاء (بما فيهم دون حركة اليوم)
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
                <table className="w-full text-right text-xs border-collapse">
                  <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                    <tr>
                      <th className="p-2 w-8 text-center">✓</th>
                      <th className="p-2 border-l border-[#1B2E44]">العميل / العملة</th>
                      <th className="p-2 border-l border-[#1B2E44]">الهاتف / واتساب</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الحركات</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الرصيد السابق</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">مدين الفترة</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">دائن الفترة</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الرصيد الحالي</th>
                      <th className="p-2 text-center">إرسال / إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyCustomerRecords.map((rec) => {
                      const c = rec.customer;
                      const isSel = selectedDailyCustIds.has(c.id);
                      const isExpanded = expandedDailyCustId === c.id;
                      const phoneStr = c.whatsapp || c.phone || '';
                      const phoneValid = validateWhatsAppPhone(phoneStr).valid;

                      return (
                        <React.Fragment key={c.id}>
                          <tr
                            className={`border-b border-[#1B2E44] ${
                              isSel ? 'bg-amber-500/10' : 'hover:bg-slate-900/50'
                            }`}
                          >
                            <td className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedDailyCustIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(c.id)) next.delete(c.id);
                                    else next.add(c.id);
                                    return next;
                                  })
                                }
                                className="cursor-pointer"
                              >
                                {isSel ? (
                                  <CheckSquare className="w-4 h-4 text-emerald-400 inline" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-500 inline" />
                                )}
                              </button>
                            </td>
                            <td className="p-2 border-l border-[#1B2E44]">
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <span>{c.nameAr}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                    rec.isSaudi
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {c.currency || 'YER'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">{c.code}</div>
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] tabular-nums">
                              <span className={phoneValid ? 'text-emerald-300 font-bold' : 'text-rose-400'}>
                                {phoneStr || 'غير مسجل'}
                              </span>
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] text-center">
                              <button
                                type="button"
                                onClick={() => setExpandedDailyCustId(isExpanded ? null : c.id)}
                                className="px-2 py-0.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-[var(--gold)] font-black inline-flex items-center gap-1 cursor-pointer"
                              >
                                <span>{rec.periodRows.length} حركة</span>
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] text-center tabular-nums">
                              {rec.isSaudi ? (
                                <div>
                                  <div className="font-bold text-amber-200">{fmtNum(rec.priorBalanceSar)} ر.س</div>
                                  <div className="text-[10px] text-slate-400">{fmtNum(rec.priorBalanceYer)} ر.ي</div>
                                </div>
                              ) : (
                                <span className="font-bold text-slate-200">{fmtNum(rec.priorBalanceYer)} ر.ي</span>
                              )}
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] text-center tabular-nums">
                              {rec.periodDebitYer > 0 ? (
                                rec.isSaudi ? (
                                  <div>
                                    <div className="font-black text-emerald-300">{fmtNum(rec.periodDebitSar)} ر.س</div>
                                    <div className="text-[10px] text-slate-400">{fmtNum(rec.periodDebitYer)} ر.ي</div>
                                  </div>
                                ) : (
                                  <span className="font-black text-emerald-300">{fmtNum(rec.periodDebitYer)} ر.ي</span>
                                )
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] text-center tabular-nums">
                              {rec.periodCreditYer > 0 ? (
                                rec.isSaudi ? (
                                  <div>
                                    <div className="font-black text-rose-300">{fmtNum(rec.periodCreditSar)} ر.س</div>
                                    <div className="text-[10px] text-slate-400">{fmtNum(rec.periodCreditYer)} ر.ي</div>
                                  </div>
                                ) : (
                                  <span className="font-black text-rose-300">{fmtNum(rec.periodCreditYer)} ر.ي</span>
                                )
                              ) : (
                                <span className="text-slate-500">-</span>
                              )}
                            </td>
                            <td className="p-2 border-l border-[#1B2E44] text-center tabular-nums">
                              {rec.isSaudi ? (
                                <div>
                                  <div className="font-black text-[var(--gold)]">{fmtNum(rec.closingBalanceSar)} ر.س</div>
                                  <div className="text-[10px] text-emerald-300">
                                    {fmtNum(rec.closingBalanceYer)} ر.ي (×{safeSarRate})
                                  </div>
                                </div>
                              ) : (
                                <span className="font-black text-[var(--gold)]">{fmtNum(rec.closingBalanceYer)} ر.ي</span>
                              )}
                            </td>
                            <td className="p-2 text-center">
                              <div className="flex items-center justify-center gap-1 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const p = buildCustomerDailyPayload(rec);
                                    setWaPayload({
                                      phone: p.defaultPhone,
                                      recipientName: c.nameAr,
                                      text: p.whatsappText,
                                      previewPayload: p,
                                      logReportType: 'customer_eod_statement',
                                    });
                                  }}
                                  className="px-2 py-1 rounded bg-[#0B2B17] border border-[#25D366] text-[#25D366] font-black text-[11px] flex items-center gap-1 cursor-pointer"
                                  title="إرسال رسالة حركة الفترة عبر واتساب (صورة / PDF / نص)"
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  <span>واتساب</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPreviewPayload(buildCustomerDailyPayload(rec))}
                                  className="px-2 py-1 rounded bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                  title="معاينة / طباعة / PDF"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>PDF</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStmtPartyType('customer');
                                    setStmtPartyId(c.id);
                                    setSubTab('statement');
                                  }}
                                  className="px-2 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 font-bold text-[11px] cursor-pointer"
                                >
                                  كشف كامل
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expanded Daily Rows Drawer */}
                          {isExpanded && (
                            <tr className="bg-[#081523]">
                              <td colSpan={9} className="p-2.5 border-b border-[var(--gold)]/40">
                                <div className="text-[11px] font-black text-[var(--gold)] mb-1.5">
                                  تفاصيل حركات ({c.nameAr}) خلال {activePeriodLabel}:
                                </div>
                                {rec.periodRows.length === 0 ? (
                                  <div className="text-slate-400 text-[11px]">لا توجد حركات مسجلة في هذه التواريخ.</div>
                                ) : (
                                  <table className="w-full text-right text-[11px] border-collapse border border-[#1B2E44]">
                                    <thead className="bg-[#0B192C] text-slate-300">
                                      <tr>
                                        <th className="p-1.5 border-l border-[#1B2E44]">التاريخ</th>
                                        <th className="p-1.5 border-l border-[#1B2E44]">نوع المستند</th>
                                        <th className="p-1.5 border-l border-[#1B2E44]">الرقم</th>
                                        <th className="p-1.5 border-l border-[#1B2E44]">البيان</th>
                                        <th className="p-1.5 border-l border-[#1B2E44] text-center">مدين</th>
                                        <th className="p-1.5 border-l border-[#1B2E44] text-center">دائن</th>
                                        <th className="p-1.5 text-center">الرصيد</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rec.periodRows.map((pr, idx) => (
                                        <tr key={idx} className="border-t border-[#1B2E44]">
                                          <td className="p-1.5 tabular-nums border-l border-[#1B2E44]">{pr.date}</td>
                                          <td className="p-1.5 font-bold border-l border-[#1B2E44]">{pr.documentType}</td>
                                          <td className="p-1.5 font-mono text-[var(--gold)] border-l border-[#1B2E44]">{pr.documentNumber}</td>
                                          <td className="p-1.5 border-l border-[#1B2E44]">{pr.statement}</td>
                                          <td className="p-1.5 text-center tabular-nums text-emerald-300 border-l border-[#1B2E44]">
                                            {rec.isSaudi && pr.sarDebit > 0
                                              ? `${fmtNum(pr.sarDebit)} ر.س (${fmtNum(pr.debit)} ر.ي)`
                                              : pr.debit > 0
                                                ? `${fmtNum(pr.debit)} ر.ي`
                                                : '-'}
                                          </td>
                                          <td className="p-1.5 text-center tabular-nums text-rose-300 border-l border-[#1B2E44]">
                                            {rec.isSaudi && pr.sarCredit > 0
                                              ? `${fmtNum(pr.sarCredit)} ر.س (${fmtNum(pr.credit)} ر.ي)`
                                              : pr.credit > 0
                                                ? `${fmtNum(pr.credit)} ر.ي`
                                                : '-'}
                                          </td>
                                          <td className="p-1.5 text-center tabular-nums font-black text-[var(--gold)]">
                                            {rec.isSaudi ? (
                                              <div className="leading-tight">
                                                <div><bdi dir="auto">{fmtNum(pr.sarBalance)} ر.س</bdi></div>
                                                <div className="text-[10px] text-slate-300 font-normal"><bdi dir="auto">{fmtNum(pr.balance)} ر.ي</bdi></div>
                                              </div>
                                            ) : (
                                              <bdi dir="auto">{fmtNum(pr.balance)} ر.ي</bdi>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'hub_22' && (
        <ReportsHubModule
          db={db}
          currencySymbol={currencySymbol}
          lang={lang}
          onOpenPrintModal={onOpenPrintModal}
          savedColumnPrefs={savedColumnPrefsMap}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onNavigateToRecord={onNavigateToRecord}
          onNotify={onNotify}
        />
      )}

      {subTab === 'daily_22' && (
        <DailyManagementReportModule
          db={db}
          onOpenDocument={(_t, id) => onNavigateToRecord('unified_docs', id)}
          onNavigateToRecord={onNavigateToRecord}
          onNotify={onNotify}
        />
      )}

      {subTab === 'unified_docs' && (
        <UnifiedDocumentsModule
          db={db}
          onOpenPrintModal={onOpenPrintModal}
          savedColumnPrefs={savedColumnPrefsMap['unified-documents']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onNavigateToRecord={onNavigateToRecord}
          onNotify={onNotify}
        />
      )}

      {subTab === 'tasks_dispatch' && (
        <div className="space-y-4">
          <TasksAlertsModule
            taskAlerts={db.taskAlerts}
            customers={db.customers}
            vendors={db.vendors}
            currencySymbol={currencySymbol}
            companyName={db.company.nameAr}
            whatsappTemplates={db.settings.whatsappTemplates}
            onAddTask={onAddTask}
            onToggleTaskComplete={onToggleTaskComplete}
            onNavigateToRecord={onNavigateToRecord}
            onNotify={onNotify}
          />
          <div className="border-t-2 border-[var(--border-strong)] pt-4">
            <div className="flex items-center gap-2 text-sm font-black text-[var(--gold)] mb-3">
              <Send className="w-4 h-4" />
              <span>مركز الإرسال والتقارير المجدولة (Scheduled Dispatch)</span>
            </div>
            <ScheduledDispatchModule
              db={db}
              onUpdateSettings={onUpdateSettings}
              onAddDispatchLog={onAddDispatchLog}
              onRetryDispatch={onRetryDispatch}
              savedColumnPrefs={savedColumnPrefsMap['dispatch-logs']}
              onSaveColumnPrefs={onSaveColumnPrefs}
              onNotify={onNotify}
            />
          </div>
        </div>
      )}

      {subTab === 'visual_designer' && (
        <VisualReportDesigner
          db={db}
          currentUser={currentUser || db.users[0]}
          onSaveReportDesigns={(designs) => {
            if (onSaveReportDesigns) onSaveReportDesigns(designs);
          }}
          onOpenPrintModal={onOpenPrintModal}
          onNotify={onNotify}
        />
      )}

      {subTab === 'smart_ai' && (
        <SmartSolutionsPanel
          db={db}
          lang={lang}
          onNavigateToRecord={onNavigateToRecord}
          onNotify={onNotify}
        />
      )}

      {/* Bulk WhatsApp Dispatch Modal for Customers (with Select All & Sequential One-by-One Queue) */}
      {bulkModalItems && (() => {
        const selectedItems = bulkModalItems.filter((x) => x.selected);
        const allSelected = bulkModalItems.length > 0 && selectedItems.length === bulkModalItems.length;
        const selectedSentCount = selectedItems.filter((x) => x.status === 'sent').length;
        const selectedPendingCount = selectedItems.filter((x) => x.status !== 'sent').length;

        const safeCursor =
          bulkQueueCursor >= 0 && bulkQueueCursor < bulkModalItems.length && bulkModalItems[bulkQueueCursor].selected
            ? bulkQueueCursor
            : Math.max(0, bulkModalItems.findIndex((x) => x.selected && x.status !== 'sent'));
        const activeItem = bulkModalItems[safeCursor] || null;
        const activePhoneCheck = activeItem ? validateWhatsAppPhone(activeItem.phone) : { valid: false, normalized: '' };
        const activeWaUrl =
          activeItem && activePhoneCheck.valid
            ? buildWhatsAppLink(activePhoneCheck.normalized, activeItem.message)
            : '';

        const stepToSiblingSelected = (dir: 1 | -1) => {
          const selectedIndices = bulkModalItems
            .map((x, i) => (x.selected ? i : -1))
            .filter((i) => i >= 0);
          if (selectedIndices.length === 0) return;
          const pos = selectedIndices.indexOf(safeCursor);
          const nextPos = pos < 0 ? 0 : (pos + dir + selectedIndices.length) % selectedIndices.length;
          setBulkQueueCursor(selectedIndices[nextPos]);
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
            <div className="bg-[var(--bg-card)] border-2 border-[#25D366] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden text-xs">
              {/* Modal Header */}
              <div className="px-4 py-3 bg-[#08121E] border-b border-[var(--border-strong)] flex items-center justify-between gap-2">
                <div>
                  <h3 className="font-black text-sm text-[#25D366] flex items-center gap-2">
                    <MessageCircle className="w-4 h-4" />
                    <span>
                      إرسال رسائل حركة العملاء ({activePeriodLabel}) — المحدد: {selectedItems.length} من {bulkModalItems.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    حدد العملاء (أو اضغط تحديد الكل)، ثم أرسلهم واحداً تلو الآخر عبر شريط الإرسال التسلسلي أدناه أو عبر القائمة المباشرة.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkModalItems(null)}
                  className="p-1.5 rounded bg-rose-950/50 border border-rose-500/40 text-rose-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Selection & Actions Toolbar */}
              <div className="px-4 py-2 bg-[#0B192C] border-b border-[var(--border-strong)] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const nextSel = !allSelected;
                      setBulkModalItems((prev) =>
                        prev ? prev.map((x) => ({ ...x, selected: nextSel })) : null
                      );
                      if (nextSel) setBulkQueueCursor(0);
                    }}
                    className={`px-3 py-1.5 rounded font-black flex items-center gap-1.5 cursor-pointer border ${
                      allSelected
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-[var(--gold)] border-[var(--gold)] text-[#03060A]'
                    }`}
                  >
                    {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    <span>{allSelected ? `إلغاء تحديد الكل (${bulkModalItems.length})` : `تحديد الكل (${bulkModalItems.length})`}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setBulkModalItems((prev) =>
                        prev
                          ? prev.map((x) => ({
                              ...x,
                              selected: x.status !== 'sent' && validateWhatsAppPhone(x.phone).valid,
                            }))
                          : null
                      );
                      const idx = bulkModalItems.findIndex(
                        (x) => x.status !== 'sent' && validateWhatsAppPhone(x.phone).valid
                      );
                      if (idx >= 0) setBulkQueueCursor(idx);
                    }}
                    className="px-2.5 py-1.5 rounded bg-[#08121E] border border-[#25D366]/50 text-[#25D366] font-bold cursor-pointer"
                  >
                    تحديد غير المرسل الصالح
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const targets = selectedItems.length > 0 ? selectedItems : bulkModalItems;
                      const allText = targets
                        .map((it) => `=== ${it.customerName} (${it.phone || 'بدون رقم'}) ===\n${it.message}`)
                        .join('\n\n--------------------------------\n\n');
                      navigator.clipboard?.writeText(allText);
                      setCopiedAllBulk(true);
                      setTimeout(() => setCopiedAllBulk(false), 2500);
                      onNotify('success', `تم نسخ رسائل (${targets.length}) عميل.`);
                    }}
                    className="px-2.5 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white font-bold flex items-center gap-1 cursor-pointer"
                  >
                    {copiedAllBulk ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedAllBulk ? 'تم النسخ' : `نسخ المحددين (${selectedItems.length})`}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewPayload(buildCombinedDailyPreview())}
                    className="px-2.5 py-1.5 rounded bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>PDF مجمع</span>
                  </button>
                </div>

                {hasCloudApiReady && (
                  <button
                    type="button"
                    disabled={bulkSendingApi || selectedPendingCount === 0}
                    onClick={() => void handleBulkCloudApiSend()}
                    className="px-3.5 py-1.5 rounded bg-[#25D366] text-[#03060A] font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {bulkSendingApi ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>
                      {bulkSendingApi
                        ? 'جاري الإرسال الآلي...'
                        : `إرسال آلي للمحددين (${selectedPendingCount})`}
                    </span>
                  </button>
                )}
              </div>

              {/* Sequential One-by-One Queue Dispatcher Card */}
              <div className="px-4 py-2.5 bg-[#07131E] border-b border-[var(--gold)]/40">
                {selectedItems.length === 0 ? (
                  <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/40 text-amber-200 font-bold text-center">
                    اختر عميلاً واحداً على الأقل أو اضغط "تحديد الكل" لتفعيل الإرسال المتسلسل واحداً تلو الآخر.
                  </div>
                ) : selectedPendingCount === 0 ? (
                  <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/60 text-emerald-300 font-black flex items-center justify-between gap-2">
                    <span>✓ تم إرسال رسائل جميع العملاء المحددين ({selectedItems.length} عميل) بنجاح!</span>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkModalItems((prev) =>
                          prev ? prev.map((x) => (x.selected ? { ...x, status: 'pending' } : x)) : null
                        )
                      }
                      className="px-2.5 py-1 rounded bg-[#08121E] border border-emerald-400/60 text-emerald-200 text-[11px] font-bold cursor-pointer"
                    >
                      إعادة تهيئة للإرسال مرة أخرى
                    </button>
                  </div>
                ) : activeItem ? (
                  <div className="p-3 rounded-lg bg-[#0B1E2F] border border-[var(--gold)]/70 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded bg-[var(--gold)] text-[#03060A] font-black text-[11px] tabular-nums">
                          الدور الحالي: {selectedSentCount + 1} من {selectedItems.length}
                        </span>
                        <span className="font-black text-white text-sm">{activeItem.customerName}</span>
                        {activeItem.closingBalanceLabel && (
                          <span className="text-[11px] font-bold text-amber-300 tabular-nums">
                            · الرصيد: {activeItem.closingBalanceLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => stepToSiblingSelected(-1)}
                          className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-300 hover:border-[var(--gold)] font-bold cursor-pointer"
                        >
                          السابق
                        </button>
                        <button
                          type="button"
                          onClick={() => stepToSiblingSelected(1)}
                          className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-300 hover:border-[var(--gold)] font-bold cursor-pointer"
                        >
                          تخطي للتالي
                        </button>
                        {activePhoneCheck.valid ? (
                          <a
                            href={activeWaUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              markBulkItemSentAndAdvance(
                                safeCursor,
                                activePhoneCheck.normalized,
                                'إرسال متسلسل من حركة العملاء'
                              )
                            }
                            className="px-3.5 py-1.5 rounded bg-[#25D366] text-[#03060A] font-black flex items-center gap-1.5 no-underline cursor-pointer shadow"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>
                              {selectedPendingCount > 1
                                ? `إرسال عبر واتساب والانتقال للتالي (${selectedPendingCount - 1} متبقي)`
                                : 'إرسال العميل الأخير عبر واتساب'}
                            </span>
                          </a>
                        ) : (
                          <span className="px-2.5 py-1 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 text-[11px] font-bold">
                            عدّل رقم الهاتف أدناه للإرسال
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#25D366] transition-all duration-300"
                        style={{
                          width: `${selectedItems.length > 0 ? Math.round((selectedSentCount / selectedItems.length) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Scrollable Customer Cards List */}
              <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
                {bulkModalItems.map((item, idx) => {
                  const phoneCheck = validateWhatsAppPhone(item.phone);
                  const waUrl = phoneCheck.valid ? buildWhatsAppLink(phoneCheck.normalized, item.message) : '';
                  const isCurrentInQueue = activeItem?.customerId === item.customerId && item.selected;

                  return (
                    <div
                      key={item.customerId}
                      className={`p-3 rounded-lg border space-y-2 transition ${
                        isCurrentInQueue
                          ? 'bg-[#0C1D2E] border-[var(--gold)] ring-1 ring-[var(--gold)]'
                          : item.status === 'sent'
                            ? 'bg-emerald-950/20 border-emerald-500/50'
                            : item.status === 'failed'
                              ? 'bg-rose-950/20 border-rose-500/50'
                              : item.selected
                                ? 'bg-[#08121E] border-[var(--border-strong)]'
                                : 'bg-[#060C14] border-slate-800 opacity-60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setBulkModalItems((prev) =>
                                prev
                                  ? prev.map((x, i) => (i === idx ? { ...x, selected: !x.selected } : x))
                                  : null
                              )
                            }
                            className="cursor-pointer p-0.5"
                            title={item.selected ? 'إلغاء تحديد هذا العميل' : 'تحديد هذا العميل للإرسال'}
                          >
                            {item.selected ? (
                              <CheckSquare className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-500" />
                            )}
                          </button>

                          <span className="font-black text-white">
                            {idx + 1}. {item.customerName}
                          </span>
                          {isCurrentInQueue && (
                            <span className="px-2 py-0.5 rounded bg-[var(--gold)]/20 border border-[var(--gold)]/60 text-[var(--gold)] text-[10px] font-black">
                              الدور الحالي
                            </span>
                          )}
                          {item.status === 'sent' && (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-black">
                              ✓ تم الإرسال
                            </span>
                          )}
                          {item.status === 'failed' && (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-black">
                              فشل: {item.error || 'خطأ'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <input
                            type="text"
                            value={item.phone}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBulkModalItems((prev) =>
                                prev ? prev.map((x, i) => (i === idx ? { ...x, phone: val } : x)) : null
                              );
                            }}
                            placeholder="رقم الواتساب (967...)"
                            className="v20-input px-2.5 py-1 text-xs w-40 tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setBulkModalItems((prev) =>
                                prev ? prev.map((x, i) => (i === idx ? { ...x, selected: true } : x)) : null
                              );
                              setBulkQueueCursor(idx);
                            }}
                            className="px-2 py-1 rounded bg-[#0B192C] border border-slate-700 text-amber-300 font-bold cursor-pointer"
                            title="تعيين هذا العميل كالدور الحالي في الإرسال المتسلسل"
                          >
                            تركيز هنا
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(item.message);
                              onNotify('success', `تم نسخ رسالة ${item.customerName}`);
                            }}
                            className="px-2.5 py-1 rounded bg-[#0B192C] border border-[var(--border-strong)] text-slate-200 font-bold cursor-pointer flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>نسخ</span>
                          </button>
                          {phoneCheck.valid ? (
                            <a
                              href={waUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                markBulkItemSentAndAdvance(
                                  idx,
                                  phoneCheck.normalized,
                                  'إرسال يدوي من قائمة الحركة اليومية'
                                )
                              }
                              className="px-3 py-1 rounded bg-[#25D366] text-[#03060A] font-black flex items-center gap-1 no-underline cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>إرسال عبر واتساب</span>
                            </a>
                          ) : (
                            <span className="px-2.5 py-1 rounded bg-rose-950/50 border border-rose-500/40 text-rose-300 text-[10px]">
                              أدخل رقم واتساب صحيح
                            </span>
                          )}
                        </div>
                      </div>

                      <textarea
                        rows={3}
                        value={item.message}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBulkModalItems((prev) =>
                            prev ? prev.map((x, i) => (i === idx ? { ...x, message: val } : x)) : null
                          );
                        }}
                        className="w-full v20-input p-2 text-[11px] leading-relaxed"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 bg-[#08121E] border-t border-[var(--border-strong)] flex items-center justify-between">
                <div className="text-[11px] text-slate-300 flex items-center gap-3 flex-wrap">
                  <span>
                    المحددين: <span className="text-[var(--gold)] font-black">{selectedItems.length}</span> من{' '}
                    <span className="font-bold">{bulkModalItems.length}</span>
                  </span>
                  <span>
                    تم إرسال: <span className="text-emerald-300 font-black">{selectedSentCount}</span> · متبقي:{' '}
                    <span className="text-amber-300 font-black">{selectedPendingCount}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setBulkModalItems(null)}
                  className="px-4 py-1.5 rounded bg-[#0B192C] border border-[var(--border-strong)] text-white font-bold cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Inline Party Edit Modal on Statement Tab */}
      {editingStmtParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-3 text-xs">
            <h3 className="font-black text-sm text-[var(--gold)]">
              تعديل بيانات {editingStmtParty.kind === 'customer' ? 'العميل' : 'المورد'}
            </h3>
            <input
              type="text"
              value={editingStmtParty.nameAr}
              onChange={(e) => setEditingStmtParty({ ...editingStmtParty, nameAr: e.target.value })}
              placeholder="الاسم *"
              className="w-full v20-input px-3 py-2"
            />
            <input
              type="text"
              value={editingStmtParty.phone}
              onChange={(e) => setEditingStmtParty({ ...editingStmtParty, phone: e.target.value })}
              placeholder="رقم الهاتف / واتساب"
              className="w-full v20-input px-3 py-2"
            />
            <div>
              <label className="block text-[11px] text-[var(--gold)] font-bold mb-1">عملة الحساب الافتراضية</label>
              <select
                value={editingStmtParty.currency}
                onChange={(e) =>
                  setEditingStmtParty({ ...editingStmtParty, currency: e.target.value as CurrencyCode })
                }
                className="w-full v20-input px-3 py-2 cursor-pointer"
              >
                {db.currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameAr} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingStmtParty(null)}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editingStmtParty.nameAr.trim()) {
                    onNotify('error', 'أدخل الاسم.');
                    return;
                  }
                  if (editingStmtParty.kind === 'customer' && onSaveCustomer) {
                    const orig = db.customers.find((x) => x.id === editingStmtParty.id);
                    if (orig) {
                      onSaveCustomer({
                        ...orig,
                        nameAr: editingStmtParty.nameAr.trim(),
                        phone: editingStmtParty.phone.trim(),
                        whatsapp: editingStmtParty.phone.trim(),
                        currency: editingStmtParty.currency,
                      });
                    }
                  } else if (editingStmtParty.kind === 'vendor' && onSaveVendor) {
                    const orig = db.vendors.find((x) => x.id === editingStmtParty.id);
                    if (orig) {
                      onSaveVendor({
                        ...orig,
                        nameAr: editingStmtParty.nameAr.trim(),
                        phone: editingStmtParty.phone.trim(),
                        whatsapp: editingStmtParty.phone.trim(),
                        currency: editingStmtParty.currency,
                      });
                    }
                  }
                  setEditingStmtParty(null);
                  onNotify('success', 'تم تحديث البيانات بنجاح.');
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                حفظ التعديل
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalPreviewModal
        isOpen={Boolean(previewPayload)}
        payload={previewPayload}
        company={db.company}
        branch={currentBranch}
        printTemplates={printTemplates || db.settings.printTemplates}
        lang={lang}
        onClose={() => setPreviewPayload(null)}
        onNotify={onNotify}
      />

      <WhatsAppShareModal
        isOpen={Boolean(waPayload)}
        title="إرسال التقرير المالي عبر واتساب"
        recipientName={waPayload?.recipientName}
        defaultPhone={waPayload?.phone}
        defaultMessage={waPayload?.text || ''}
        previewPayload={waPayload?.previewPayload}
        company={db.company}
        branch={currentBranch}
        onDispatched={(info) => {
          logCustomerDispatch(
            waPayload?.recipientName || 'مستلم',
            info.phone,
            'sent',
            waPayload?.previewPayload?.title || 'مشاركة تقرير واتساب',
            waPayload?.logReportType || 'customer_eod_statement'
          );
        }}
        onClose={() => setWaPayload(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
