/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - General Ledger, Statements, Cash Flow & Custom Ledgers Module
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  BookOpenCheck,
  Plus,
  Search,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  FileDown,
  FileSpreadsheet,
  Printer,
  RotateCcw,
  BookMarked,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
} from 'lucide-react';
import {
  Account,
  JournalEntry,
  JournalEntryLine,
  CostCenter,
  Branch,
  Company,
  Invoice,
  PaymentVoucher,
  ExpenseRecord,
  CustomLedgerBook,
  CustomLedgerEntry,
  CustomLedgerRow,
  Currency,
  CurrencyCode,
  FiscalPeriod,
} from '../../../types/erp';
import {
  validateJournalEntry,
  generateTrialBalance,
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  calculateAccountLedger,
  calculateHistoricalStatementsAsOf,
} from '../../../services/accountingEngine';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  getEffectiveCurrencyRate,
  getEffectiveSarRate,
  hasSaudiHint,
} from '../../../services/currencyHelpers';
import { downloadReportAsPDF, exportToExcel, exportToCSV } from '../../../services/exportService';
import { PrintableDocumentData } from '../../common/PrintModal';
import { ConfirmModal } from '../../common/ConfirmModal';

interface AccountingModuleProps {
  chartOfAccounts: Account[];
  journalEntries: JournalEntry[];
  costCenters: CostCenter[];
  invoices?: Invoice[];
  paymentVouchers?: PaymentVoucher[];
  expenseRecords?: ExpenseRecord[];
  customBooks?: CustomLedgerBook[];
  customBookEntries?: CustomLedgerEntry[];
  fiscalPeriods?: FiscalPeriod[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  currencies?: Currency[];
  canPostEntries: boolean;
  focusedRecordId?: string;
  onPostManualEntry: (entry: JournalEntry) => void;
  onReverseJournalEntry?: (entryId: string, reason: string) => void;
  onSaveCustomBook?: (book: CustomLedgerBook) => void;
  onSaveCustomBookEntry?: (entry: CustomLedgerEntry) => void;
  onOpenPrintModal?: (doc: PrintableDocumentData) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type AccountingTab =
  | 'entries'
  | 'coa'
  | 'ledger'
  | 'trial_balance'
  | 'income_statement'
  | 'balance_sheet'
  | 'cash_flow'
  | 'custom_books';

export const AccountingModule: React.FC<AccountingModuleProps> = ({
  chartOfAccounts,
  journalEntries,
  costCenters,
  invoices = [],
  paymentVouchers = [],
  expenseRecords = [],
  customBooks = [],
  customBookEntries = [],
  fiscalPeriods = [],
  currentBranch,
  company,
  currencySymbol,
  currencies = [],
  canPostEntries,
  focusedRecordId,
  onPostManualEntry,
  onReverseJournalEntry,
  onSaveCustomBook,
  onSaveCustomBookEntry,
  onOpenPrintModal,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<AccountingTab>('entries');
  const [searchTerm, setSearchTerm] = useState('');
  const [coaCurrencyFilter, setCoaCurrencyFilter] = useState<'ALL' | 'SAR' | 'YER' | 'USD'>('ALL');
  const [showDualLedger, setShowDualLedger] = useState<boolean>(true);
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [asOfEnabled, setAsOfEnabled] = useState(false);
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Manual Entry Modal
  const [isNewEntryModalOpen, setIsNewEntryModalOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryDescription, setEntryDescription] = useState('');
  const [entryRefNum, setEntryRefNum] = useState('');
  const [formError, setFormError] = useState('');

  // Reversal Confirm Modal
  const [reverseTarget, setReverseTarget] = useState<JournalEntry | null>(null);
  const [reverseReason, setReverseReason] = useState('تصحيح قيد محاسبي');

  const leafAccounts = useMemo(
    () => chartOfAccounts.filter((a) => a.isLeaf && a.isActive !== false),
    [chartOfAccounts]
  );
  const sarRate = useMemo(() => getEffectiveSarRate(currencies), [currencies]);
  const getAccCurrency = (acc?: Account): CurrencyCode =>
    acc?.currency || (hasSaudiHint(acc?.nameAr) ? 'SAR' : 'YER');
  const accByIdMap = useMemo(() => new Map(chartOfAccounts.map((a) => [a.id, a])), [chartOfAccounts]);
  const filteredCoa = useMemo(
    () =>
      chartOfAccounts.filter(
        (a) => coaCurrencyFilter === 'ALL' || getAccCurrency(a) === coaCurrencyFilter
      ),
    [chartOfAccounts, coaCurrencyFilter]
  );

  const [lines, setLines] = useState<JournalEntryLine[]>([
    {
      id: 'l-1',
      accountId: leafAccounts[0]?.id || '',
      accountCode: leafAccounts[0]?.code || '',
      accountName: leafAccounts[0]?.nameAr || '',
      debit: 0,
      credit: 0,
      currency: 'YER',
      exchangeRate: 1,
      memo: '',
    },
    {
      id: 'l-2',
      accountId: leafAccounts[1]?.id || '',
      accountCode: leafAccounts[1]?.code || '',
      accountName: leafAccounts[1]?.nameAr || '',
      debit: 0,
      credit: 0,
      currency: 'YER',
      exchangeRate: 1,
      memo: '',
    },
  ]);

  const [selectedLedgerAccountId, setSelectedLedgerAccountId] = useState(leafAccounts[0]?.id || '');

  // Custom Ledgers (الدفاتر المخصصة) State
  const [activeBookId, setActiveBookId] = useState(customBooks[0]?.id || '');
  const [isNewBookModalOpen, setIsNewBookModalOpen] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookDesc, setNewBookDesc] = useState('');
  const [isNewCustomEntryOpen, setIsNewCustomEntryOpen] = useState(false);
  const [customEntryDate, setCustomEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [customEntryNotes, setCustomEntryNotes] = useState('');
  const [viewingCustomEntry, setViewingCustomEntry] = useState<CustomLedgerEntry | null>(null);
  const customGridRef = useRef<HTMLTableSectionElement | null>(null);
  const [customRows, setCustomRows] = useState<CustomLedgerRow[]>([
    {
      id: 'cr-1',
      partyName: '',
      statement: '',
      debit: 0,
      credit: 0,
      currency: 'YER',
    },
  ]);

  useEffect(() => {
    if (!activeBookId && customBooks.length > 0) {
      setActiveBookId(customBooks[0].id);
    }
  }, [customBooks, activeBookId]);

  useEffect(() => {
    if (!focusedRecordId) return;
    const matchJe = journalEntries.find((je) => je.id === focusedRecordId || je.entryNumber === focusedRecordId);
    if (matchJe) {
      setActiveTab('entries');
      setSearchTerm(matchJe.entryNumber);
      return;
    }
    const matchAcc = chartOfAccounts.find((a) => a.id === focusedRecordId || a.code === focusedRecordId);
    if (matchAcc && matchAcc.isLeaf) {
      setActiveTab('ledger');
      setSelectedLedgerAccountId(matchAcc.id);
    }
  }, [focusedRecordId, journalEntries, chartOfAccounts]);

  const dateRange = useMemo(() => ({ startDate, endDate }), [startDate, endDate]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        accountId: leafAccounts[0]?.id || '',
        accountCode: leafAccounts[0]?.code || '',
        accountName: leafAccounts[0]?.nameAr || '',
        debit: 0,
        credit: 0,
        currency: 'YER',
        exchangeRate: 1,
        memo: '',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 2) {
      setFormError('يجب أن يحتوي القيد على طرفين على الأقل.');
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleUpdateLine = (index: number, field: keyof JournalEntryLine, val: string | number) => {
    setFormError('');
    setLines((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };
      if (field === 'accountId') {
        const acc = chartOfAccounts.find((a) => a.id === val);
        if (acc) {
          item.accountId = acc.id;
          item.accountCode = acc.code;
          item.accountName = acc.nameAr;
        }
      } else if (field === 'costCenterId') {
        const cc = costCenters.find((c) => c.id === val);
        item.costCenterId = val ? String(val) : undefined;
        item.costCenterName = cc?.nameAr;
      } else {
        (item as Record<string, unknown>)[field] = val;
      }
      updated[index] = item;
      return updated;
    });
  };

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  const isBalanced = diff < 0.01 && lines.length >= 2 && totalDebit > 0;

  const handleSaveEntrySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!canPostEntries) {
      const msg = 'عذراً، دورك الحالي لا يمتلك صلاحية ترحيل القيود اليومية.';
      setFormError(msg);
      onNotify?.('error', msg);
      return;
    }

    const check = validateJournalEntry(lines);
    if (!check.isValid) {
      setFormError(check.error || 'القيد غير متوازن');
      return;
    }

    const year = new Date().getFullYear();
    const entryNumber = generateNextDocNumber(
      `JV-${year}-`,
      journalEntries.map((j) => j.entryNumber),
      4
    );

    const newEntry: JournalEntry = {
      id: `je-manual-${Date.now()}`,
      entryNumber,
      date: entryDate,
      branchId: currentBranch.id,
      referenceType: 'دليل_يدوي',
      referenceNumber: entryRefNum.trim() || `MAN-${entryNumber}`,
      description: entryDescription.trim() || 'قيد تسوية يومية يدوي',
      lines: lines.map((l) => ({
        ...l,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      })),
      totalDebit: check.totalDebit,
      totalCredit: check.totalCredit,
      status: 'posted',
      createdBy: 'محاسب عام',
      createdAt: new Date().toISOString(),
    };

    onPostManualEntry(newEntry);
    onNotify?.('success', `تم ترحيل القيد المحاسبي رقم ${entryNumber} بنجاح.`);
    setIsNewEntryModalOpen(false);
    setEntryDescription('');
    setEntryRefNum('');
  };

  const historicalSnapshot = useMemo(
    () =>
      asOfEnabled
        ? calculateHistoricalStatementsAsOf(chartOfAccounts, journalEntries, asOfDate)
        : null,
    [asOfEnabled, chartOfAccounts, journalEntries, asOfDate]
  );
  const trialBalanceRows = useMemo(
    () => historicalSnapshot?.trialBalance ?? generateTrialBalance(chartOfAccounts, journalEntries, dateRange),
    [historicalSnapshot, chartOfAccounts, journalEntries, dateRange]
  );
  const incomeStatement = useMemo(
    () => historicalSnapshot?.incomeStatement ?? generateIncomeStatement(chartOfAccounts, journalEntries, dateRange),
    [historicalSnapshot, chartOfAccounts, journalEntries, dateRange]
  );
  const balanceSheet = useMemo(
    () => historicalSnapshot?.balanceSheet ?? generateBalanceSheet(chartOfAccounts, journalEntries, dateRange),
    [historicalSnapshot, chartOfAccounts, journalEntries, dateRange]
  );
  const cashFlow = useMemo(
    () => generateCashFlowStatement(chartOfAccounts, invoices, paymentVouchers, expenseRecords, dateRange),
    [chartOfAccounts, invoices, paymentVouchers, expenseRecords, dateRange]
  );
  const activeLedgerRows = useMemo(
    () => calculateAccountLedger(selectedLedgerAccountId, journalEntries, chartOfAccounts, dateRange),
    [selectedLedgerAccountId, journalEntries, chartOfAccounts, dateRange]
  );

  const filteredJournalEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return journalEntries.filter((je) => {
      if (startDate && je.date < startDate) return false;
      if (endDate && je.date > endDate) return false;
      if (!q) return true;
      return (
        je.entryNumber.toLowerCase().includes(q) ||
        je.description.toLowerCase().includes(q) ||
        je.referenceNumber.toLowerCase().includes(q)
      );
    });
  }, [journalEntries, searchTerm, startDate, endDate]);

  // Custom Ledgers Logic
  const activeBook = customBooks.find((b) => b.id === activeBookId) || customBooks[0];
  const activeBookEntries = useMemo(
    () => customBookEntries.filter((e) => e.bookId === (activeBook?.id || '')),
    [customBookEntries, activeBook]
  );
  const viewingCustomIdx = viewingCustomEntry
    ? activeBookEntries.findIndex((e) => e.id === viewingCustomEntry.id)
    : -1;

  const handleSaveBook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBookName.trim() || !onSaveCustomBook) return;
    const code = generateNextDocNumber('BK-', customBooks.map((b) => b.code), 2);
    const created: CustomLedgerBook = {
      id: `book-${Date.now()}`,
      code,
      nameAr: newBookName.trim(),
      description: newBookDesc.trim() || undefined,
      createdAt: new Date().toISOString().split('T')[0],
    };
    onSaveCustomBook(created);
    setActiveBookId(created.id);
    onNotify?.('success', `تم إنشاء الدفتر المخصص "${created.nameAr}".`);
    setNewBookName('');
    setNewBookDesc('');
    setIsNewBookModalOpen(false);
  };

  const handleCustomGridKeyDown = (e: React.KeyboardEvent<HTMLElement>, rowIdx: number, colIdx: number) => {
    if (!customGridRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const targetRow = e.key === 'ArrowDown' ? rowIdx + 1 : rowIdx - 1;
      const el = customGridRef.current.querySelector<HTMLElement>(`[data-cgrid-row="${targetRow}"][data-cgrid-col="${colIdx}"]`);
      if (el) {
        e.preventDefault();
        el.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nextCol = customGridRef.current.querySelector<HTMLElement>(`[data-cgrid-row="${rowIdx}"][data-cgrid-col="${colIdx + 1}"]`);
      if (nextCol) {
        nextCol.focus();
      } else {
        setCustomRows((prev) => [
          ...prev,
          { id: `cr-${Date.now()}`, partyName: '', statement: '', debit: 0, credit: 0, currency: 'YER' },
        ]);
      }
    }
  };

  const handleSaveCustomEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBook || !onSaveCustomBookEntry) return;
    const validRows = customRows.filter((r) => r.statement.trim() && (Number(r.debit) > 0 || Number(r.credit) > 0));
    if (validRows.length === 0) {
      onNotify?.('error', 'يرجى إدخال سطر واحد على الأقل ببيان ومبلغ صحيح.');
      return;
    }
    const entryNumber = generateNextDocNumber(
      `${activeBook.code}-`,
      activeBookEntries.map((x) => x.entryNumber),
      4
    );
    const totalD = validRows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
    const totalC = validRows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
    const created: CustomLedgerEntry = {
      id: `cle-${Date.now()}`,
      bookId: activeBook.id,
      entryNumber,
      date: customEntryDate,
      rows: validRows,
      totalDebit: totalD,
      totalCredit: totalC,
      notes: customEntryNotes.trim() || undefined,
      createdBy: 'المحاسب المالي',
      createdAt: new Date().toISOString(),
    };
    onSaveCustomBookEntry(created);
    onNotify?.('success', `تم حفظ القيد الدفتري رقم ${entryNumber} في ${activeBook.nameAr}.`);
    setIsNewCustomEntryOpen(false);
    setCustomEntryNotes('');
    setCustomRows([{ id: `cr-${Date.now()}`, partyName: '', statement: '', debit: 0, credit: 0, currency: 'YER' }]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpenCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">المحاسبة المزدوجة العامة والدفاتر المخصصة</h2>
          </div>
          <p className="text-xs text-slate-400">
            دليل الحسابات، القيود المتوازنة، ميزان المراجعة، الدخل، المركز المالي، التدفقات النقدية، والدفاتر المساعدة
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFormError('');
              setIsNewEntryModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء قيد يومية يدوي</span>
          </button>
        </div>
      </div>

      {/* Tabs + Global Date Range Filter */}
      <div className="bg-slate-900/90 border border-slate-800 p-3 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {(
            [
              { id: 'entries', label: `قيود اليومية (${journalEntries.length})` },
              { id: 'coa', label: 'دليل الحسابات' },
              { id: 'ledger', label: 'دفتر الأستاذ العام' },
              { id: 'trial_balance', label: 'ميزان المراجعة' },
              { id: 'income_statement', label: 'قائمة الدخل' },
              { id: 'balance_sheet', label: 'الميزانية العمومية' },
              { id: 'cash_flow', label: 'التدفقات النقدية' },
              { id: 'custom_books', label: `الدفاتر المخصصة (${customBooks.length})` },
            ] as { id: AccountingTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-950/60 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 bg-slate-950 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-amber-300 cursor-pointer font-bold">
            <input
              type="checkbox"
              checked={asOfEnabled}
              onChange={(e) => setAsOfEnabled(e.target.checked)}
              className="accent-amber-500"
            />
            <span>عرض تاريخي كما في (As-Of Date):</span>
          </label>
          {asOfEnabled ? (
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="bg-slate-950 border border-amber-500 rounded-lg px-2.5 py-1.5 text-amber-300 font-mono"
            />
          ) : (
            <>
              <span className="text-slate-400">من:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono"
              />
              <span className="text-slate-400">إلى:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 font-mono"
              />
            </>
          )}
          {fiscalPeriods.length > 0 && (
            <span className="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-[11px] text-slate-300">
              فترات مفتوحة: {fiscalPeriods.filter((f) => f.status === 'open').length} / {fiscalPeriods.length}
            </span>
          )}
        </div>
      </div>

      {/* TAB 1: JOURNAL ENTRIES */}
      {activeTab === 'entries' && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative w-full max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
              <input
                type="text"
                placeholder="بحث برقم القيد، البيان، المرجع..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pr-9 pl-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-mono">
                إجمالي القيود: <strong className="text-white">{filteredJournalEntries.length}</strong>
              </span>
              <button
                type="button"
                onClick={() =>
                  void downloadReportAsPDF({
                    title: 'سجل قيود اليومية العامة',
                    periodText: `${startDate} إلى ${endDate}`,
                    company,
                    branch: currentBranch,
                    tables: [
                      {
                        headers: ['رقم القيد', 'التاريخ', 'نوع المرجع', 'البيان', 'مدين', 'دائن', 'الحالة'],
                        rows: filteredJournalEntries.map((je) => [
                          je.entryNumber,
                          je.date,
                          je.referenceType.replace(/_/g, ' '),
                          je.description,
                          je.totalDebit,
                          je.totalCredit,
                          je.status === 'posted' ? 'مرحل' : 'معكوس',
                        ]),
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg font-semibold cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToExcel({
                    fileName: `قيود_اليومية_${endDate}`,
                    sheets: [
                      {
                        name: 'قيود اليومية',
                        data: [
                          ['رقم القيد', 'التاريخ', 'المرجع', 'البيان', 'إجمالي المدين', 'إجمالي الدائن', 'الحالة'],
                          ...filteredJournalEntries.map((je) => [
                            je.entryNumber,
                            je.date,
                            je.referenceNumber,
                            je.description,
                            je.totalDebit,
                            je.totalCredit,
                            je.status,
                          ]),
                        ],
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {filteredJournalEntries.map((entry) => (
              <div key={entry.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-950/70 p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono font-black text-amber-400 text-sm">{entry.entryNumber}</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono text-slate-300">{entry.date}</span>
                    <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-semibold">
                      {entry.referenceType.replace(/_/g, ' ')} ({entry.referenceNumber})
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-slate-400 text-[11px]">بواسطة: {entry.createdBy}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        entry.status === 'posted'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800/40'
                          : 'bg-rose-950 text-rose-400 border-rose-800/40'
                      }`}
                    >
                      {entry.status === 'posted' ? 'مرحل ومعتمد' : 'تم عكسه'}
                    </span>
                    {canPostEntries && entry.status === 'posted' && onReverseJournalEntry && (
                      <button
                        type="button"
                        onClick={() => {
                          setReverseReason('تصحيح وإلغاء أثر القيد المحاسبي');
                          setReverseTarget(entry);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/70 hover:bg-rose-900 text-rose-300 border border-rose-700/50 rounded-lg text-[11px] font-bold cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>عكس القيد</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="p-3 text-xs text-slate-300 bg-slate-900/60 font-semibold border-b border-slate-800/50">
                  {entry.description}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-950/40 text-slate-400 font-semibold border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-4">رقم الحساب</th>
                        <th className="py-2 px-4">اسم الحساب</th>
                        <th className="py-2 px-4">البيان</th>
                        <th className="py-2 px-4 text-left">مدين ({currencySymbol})</th>
                        <th className="py-2 px-4 text-left">دائن ({currencySymbol})</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 font-mono">
                      {entry.lines.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-800/30">
                          <td className="py-2 px-4 font-bold text-amber-400">{l.accountCode}</td>
                          <td className="py-2 px-4 font-sans text-slate-200">{l.accountName}</td>
                          <td className="py-2 px-4 font-sans text-slate-400">{l.memo || '-'}</td>
                          <td className="py-2 px-4 text-left font-bold text-slate-100 tabular-nums">
                            {l.debit > 0 ? l.debit.toLocaleString() : '-'}
                          </td>
                          <td className="py-2 px-4 text-left font-bold text-slate-100 tabular-nums">
                            {l.credit > 0 ? l.credit.toLocaleString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-950/80 font-mono font-black border-t border-slate-800 text-xs">
                      <tr>
                        <td colSpan={3} className="py-2 px-4 text-left font-sans text-slate-400">
                          إجمالي طرفي القيد:
                        </td>
                        <td className="py-2 px-4 text-left text-amber-400 tabular-nums">{entry.totalDebit.toLocaleString()}</td>
                        <td className="py-2 px-4 text-left text-amber-400 tabular-nums">{entry.totalCredit.toLocaleString()}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: CHART OF ACCOUNTS */}
      {activeTab === 'coa' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-sm text-white">دليل الحسابات الموحد (Chart of Accounts)</h3>
              <p className="text-xs text-slate-400">
                1 الأصول · 2 الخصوم · 3 حقوق الملكية · 4 الإيرادات · 5 المصروفات · سعر صرف SAR = {sarRate} YER
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={coaCurrencyFilter}
                onChange={(e) => setCoaCurrencyFilter(e.target.value as 'ALL' | 'SAR' | 'YER' | 'USD')}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 cursor-pointer"
              >
                <option value="ALL">جميع العملات ({chartOfAccounts.length})</option>
                <option value="SAR">الحسابات السعودية (SAR)</option>
                <option value="YER">الحسابات اليمنية (YER)</option>
                <option value="USD">حسابات الدولار (USD)</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  void downloadReportAsPDF({
                    title: 'دليل الحسابات المحاسبي الموحد',
                    periodText: `سعر صرف التحويل المعتمد: 1 SAR = ${sarRate} YER`,
                    company,
                    branch: currentBranch,
                    tables: [
                      {
                        headers: ['الكود', 'اسم الحساب', 'التصنيف', 'العملة', 'الرصيد بالعملة', 'المعادل (YER)'],
                        rows: filteredCoa.map((a) => {
                          const curr = getAccCurrency(a);
                          const rate = getEffectiveCurrencyRate(currencies, curr);
                          const nativeBal = curr !== 'YER' ? Math.round((a.currentBalance / rate) * 100) / 100 : a.currentBalance;
                          return [
                            a.code,
                            a.nameAr,
                            a.category,
                            curr,
                            curr !== 'YER' ? `${nativeBal.toLocaleString()} ${curr}` : `${a.currentBalance.toLocaleString()} YER`,
                            a.currentBalance,
                          ];
                        }),
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>تصدير PDF</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-bold">
                <tr>
                  <th className="py-3 px-4">رقم الحساب</th>
                  <th className="py-3 px-4">اسم الحساب</th>
                  <th className="py-3 px-4">التصنيف</th>
                  <th className="py-3 px-4 text-center">العملة</th>
                  <th className="py-3 px-4 text-center">الطبيعة</th>
                  <th className="py-3 px-4 text-left">الرصيد (بالعملة والمعادل)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredCoa.map((acc) => {
                  const accCurr = getAccCurrency(acc);
                  const rate = getEffectiveCurrencyRate(currencies, accCurr);
                  const nativeBal = accCurr !== 'YER' ? Math.round((acc.currentBalance / rate) * 100) / 100 : acc.currentBalance;
                  return (
                    <tr
                      key={acc.id}
                      onClick={() => {
                        if (acc.isLeaf) {
                          setSelectedLedgerAccountId(acc.id);
                          setActiveTab('ledger');
                        }
                      }}
                      className={`hover:bg-slate-800/40 ${acc.isLeaf ? 'cursor-pointer' : 'bg-slate-950/40 font-bold'}`}
                    >
                      <td className="py-2.5 px-4 text-amber-400 font-black">{acc.code}</td>
                      <td className="py-2.5 px-4 font-sans text-slate-100">
                        <span style={{ paddingRight: `${(acc.level - 1) * 18}px` }}>
                          {acc.level > 1 && '↳ '}
                          {acc.nameAr}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-400">{acc.category}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-black ${
                            accCurr === 'SAR'
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50'
                              : accCurr === 'USD'
                              ? 'bg-sky-950/80 text-sky-300 border border-sky-500/50'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {accCurr}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center font-sans">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                            acc.nature === 'debit' ? 'bg-sky-950 text-sky-400' : 'bg-emerald-950 text-emerald-400'
                          }`}
                        >
                          {acc.nature === 'debit' ? 'مدين' : 'دائن'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-left font-bold text-slate-200 tabular-nums">
                        {accCurr !== 'YER' ? (
                          <div className="leading-tight">
                            <div className="text-emerald-300 font-black">
                              {nativeBal.toLocaleString()} {accCurr === 'SAR' ? 'ر.س' : accCurr}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {acc.currentBalance.toLocaleString()} ر.ي (×{rate})
                            </div>
                          </div>
                        ) : (
                          <span>{acc.currentBalance.toLocaleString()} ر.ي</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: GENERAL LEDGER */}
      {activeTab === 'ledger' && (() => {
        const selectedLedgerAcc = accByIdMap.get(selectedLedgerAccountId);
        const ledgerCurr = getAccCurrency(selectedLedgerAcc);
        const isForeignLedger = ledgerCurr !== 'YER';
        const effectiveRate = getEffectiveCurrencyRate(currencies, isForeignLedger ? ledgerCurr : 'SAR');
        const foreignLabel = ledgerCurr === 'USD' ? 'USD' : 'ر.س';
        const totalDrYer = activeLedgerRows.reduce((s, r) => s + r.debit, 0);
        const totalCrYer = activeLedgerRows.reduce((s, r) => s + r.credit, 0);
        const closingYer = activeLedgerRows.length > 0 ? activeLedgerRows[activeLedgerRows.length - 1].balance : 0;
        const closingNative = Math.round((closingYer / effectiveRate) * 100) / 100;
        const showDualCols = isForeignLedger || showDualLedger;

        return (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <span>دفتر الأستاذ العام (General Ledger)</span>
                  {isForeignLedger && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-500/60">
                      حساب بعملة {ledgerCurr} (×{effectiveRate})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-400">حركات الحساب خلال الفترة ({startDate} ← {endDate})</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={showDualCols}
                    onChange={(e) => setShowDualLedger(e.target.checked)}
                    disabled={isForeignLedger}
                    className="accent-emerald-500"
                  />
                  <span>عرض {isForeignLedger ? foreignLabel : 'السعودي (ر.س)'} + اليمني</span>
                </label>
                <select
                  value={selectedLedgerAccountId}
                  onChange={(e) => setSelectedLedgerAccountId(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 focus:border-amber-500"
                >
                  {leafAccounts.map((a) => {
                    const c = getAccCurrency(a);
                    return (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.nameAr}{c !== 'YER' ? ` [${c}]` : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void downloadReportAsPDF({
                      title: `دفتر الأستاذ العام: ${selectedLedgerAcc?.nameAr || ''} (${ledgerCurr})`,
                      periodText: `${startDate} إلى ${endDate} · التحويل: 1 ${isForeignLedger ? ledgerCurr : 'SAR'} = ${effectiveRate} YER`,
                      company,
                      branch: currentBranch,
                      tables: [
                        {
                          headers: showDualCols
                            ? ['التاريخ', 'الرقم', 'البيان', `مدين (${foreignLabel})`, `دائن (${foreignLabel})`, `الرصيد (${foreignLabel})`, 'التحويل', 'مدين (ر.ي)', 'دائن (ر.ي)', 'الرصيد (ر.ي)']
                            : ['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين', 'دائن', 'الرصيد'],
                          rows: activeLedgerRows.map((r) => {
                            const rowRate = r.exchangeRate && r.exchangeRate > 1 ? r.exchangeRate : effectiveRate;
                            const nDr = r.txDebit ?? Math.round((r.debit / rowRate) * 100) / 100;
                            const nCr = r.txCredit ?? Math.round((r.credit / rowRate) * 100) / 100;
                            const nBal = Math.round((r.balance / rowRate) * 100) / 100;
                            return showDualCols
                              ? [r.date, r.documentNumber, r.statement, nDr, nCr, nBal, rowRate, r.debit, r.credit, r.balance]
                              : [r.date, r.documentType, r.documentNumber, r.statement, r.debit, r.credit, r.balance];
                          }),
                        },
                      ],
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    exportToExcel({
                      fileName: `أستاذ_${selectedLedgerAcc?.code || 'account'}_${endDate}`,
                      sheets: [
                        {
                          name: 'حركات الحساب',
                          data: [
                            showDualCols
                              ? ['التاريخ', 'الرقم', 'البيان', `مدين (${foreignLabel})`, `دائن (${foreignLabel})`, `الرصيد (${foreignLabel})`, 'التحويل', 'مدين (ر.ي)', 'دائن (ر.ي)', 'الرصيد (ر.ي)']
                              : ['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين', 'دائن', 'الرصيد'],
                            ...activeLedgerRows.map((r) => {
                              const rowRate = r.exchangeRate && r.exchangeRate > 1 ? r.exchangeRate : effectiveRate;
                              const nDr = r.txDebit ?? Math.round((r.debit / rowRate) * 100) / 100;
                              const nCr = r.txCredit ?? Math.round((r.credit / rowRate) * 100) / 100;
                              const nBal = Math.round((r.balance / rowRate) * 100) / 100;
                              return showDualCols
                                ? [r.date, r.documentNumber, r.statement, nDr, nCr, nBal, rowRate, r.debit, r.credit, r.balance]
                                : [r.date, r.documentType, r.documentNumber, r.statement, r.debit, r.credit, r.balance];
                            }),
                          ],
                        },
                      ],
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            {activeLedgerRows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs tabular-nums">
                <div className="bg-slate-950/70 border border-emerald-500/40 rounded-xl p-3 flex justify-between items-center">
                  <span className="text-slate-400">الرصيد الختامي ({foreignLabel}):</span>
                  <span className="font-black text-emerald-300 text-sm">
                    {closingNative.toLocaleString()} {foreignLabel}
                  </span>
                </div>
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex justify-between items-center">
                  <span className="text-slate-400">سعر التحويل المعتمد:</span>
                  <span className="font-black text-sky-300">1 {isForeignLedger ? ledgerCurr : 'SAR'} = {effectiveRate} YER</span>
                </div>
                <div className="bg-slate-950/70 border border-amber-500/40 rounded-xl p-3 flex justify-between items-center">
                  <span className="text-slate-400">الرصيد المعادل باليمني (ر.ي):</span>
                  <span className="font-black text-amber-300 text-sm">{closingYer.toLocaleString()} ر.ي</span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-bold">
                  <tr>
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">المستند / المرجع</th>
                    <th className="py-3 px-3">البيان</th>
                    {showDualCols && (
                      <>
                        <th className="py-3 px-3 text-left text-emerald-300">مدين ({foreignLabel})</th>
                        <th className="py-3 px-3 text-left text-emerald-300">دائن ({foreignLabel})</th>
                        <th className="py-3 px-3 text-left text-emerald-300">الرصيد ({foreignLabel})</th>
                        <th className="py-3 px-3 text-center">الصرف</th>
                      </>
                    )}
                    <th className="py-3 px-3 text-left">مدين (ر.ي)</th>
                    <th className="py-3 px-3 text-left">دائن (ر.ي)</th>
                    <th className="py-3 px-3 text-left">الرصيد (ر.ي)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {activeLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={showDualCols ? 10 : 7} className="py-8 text-center text-slate-500 font-sans">
                        لا توجد حركات مسجلة لهذا الحساب خلال الفترة المحددة
                      </td>
                    </tr>
                  ) : (
                    activeLedgerRows.map((r, idx) => {
                      const rowRate = r.exchangeRate && r.exchangeRate > 1 ? r.exchangeRate : effectiveRate;
                      const nDr = r.txDebit ?? (r.debit > 0 ? Math.round((r.debit / rowRate) * 100) / 100 : 0);
                      const nCr = r.txCredit ?? (r.credit > 0 ? Math.round((r.credit / rowRate) * 100) / 100 : 0);
                      const nBal = Math.round((r.balance / rowRate) * 100) / 100;
                      return (
                        <tr key={idx} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-slate-400">{r.date}</td>
                          <td className="py-2.5 px-3">
                            <span className="font-sans text-slate-300 font-semibold">{r.documentType}</span>
                            <span className="text-amber-400 font-bold mr-1.5">{r.documentNumber}</span>
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-300">{r.statement}</td>
                          {showDualCols && (
                            <>
                              <td className="py-2.5 px-3 text-left text-emerald-300 tabular-nums">
                                {nDr > 0 ? nDr.toLocaleString() : '-'}
                              </td>
                              <td className="py-2.5 px-3 text-left text-emerald-300 tabular-nums">
                                {nCr > 0 ? nCr.toLocaleString() : '-'}
                              </td>
                              <td className="py-2.5 px-3 text-left font-black text-emerald-300 tabular-nums">
                                {nBal.toLocaleString()} {foreignLabel}
                              </td>
                              <td className="py-2.5 px-3 text-center text-slate-400 tabular-nums">×{rowRate}</td>
                            </>
                          )}
                          <td className="py-2.5 px-3 text-left text-slate-200 tabular-nums">{r.debit > 0 ? r.debit.toLocaleString() : '-'}</td>
                          <td className="py-2.5 px-3 text-left text-emerald-400 tabular-nums">{r.credit > 0 ? r.credit.toLocaleString() : '-'}</td>
                          <td className="py-2.5 px-3 text-left font-black text-amber-300 tabular-nums">{r.balance.toLocaleString()}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {activeLedgerRows.length > 0 && (
                  <tfoot className="bg-slate-950/90 font-mono font-black border-t-2 border-slate-700 text-xs">
                    <tr>
                      <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-300 text-left">الإجماليات:</td>
                      {showDualCols && (
                        <>
                          <td className="py-2.5 px-3 text-left text-emerald-300 tabular-nums">
                            {(Math.round((totalDrYer / effectiveRate) * 100) / 100).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-left text-emerald-300 tabular-nums">
                            {(Math.round((totalCrYer / effectiveRate) * 100) / 100).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-left text-emerald-300 tabular-nums">
                            {closingNative.toLocaleString()} {foreignLabel}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-400">×{effectiveRate}</td>
                        </>
                      )}
                      <td className="py-2.5 px-3 text-left text-amber-300 tabular-nums">{totalDrYer.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-left text-amber-300 tabular-nums">{totalCrYer.toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-left text-amber-300 tabular-nums">{closingYer.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        );
      })()}

      {/* TAB 4: TRIAL BALANCE */}
      {activeTab === 'trial_balance' && (() => {
        const tbPerDr = trialBalanceRows.reduce((s, r) => s + r.periodDebit, 0);
        const tbPerCr = trialBalanceRows.reduce((s, r) => s + r.periodCredit, 0);
        const tbEndDr = trialBalanceRows.reduce((s, r) => s + r.endingDebit, 0);
        const tbEndCr = trialBalanceRows.reduce((s, r) => s + r.endingCredit, 0);
        return (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <Scale className="w-4 h-4 text-amber-400" />
                  ميزان المراجعة بالأرصدة والمجاميع (Trial Balance)
                </h3>
                <p className="text-xs text-slate-400">للفترة من {startDate} إلى {endDate} · سعر صرف SAR = {sarRate} YER</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    void downloadReportAsPDF({
                      title: 'ميزان المراجعة بالأرصدة والمجاميع',
                      periodText: `${startDate} إلى ${endDate} · سعر الصرف: 1 SAR = ${sarRate} YER`,
                      company,
                      branch: currentBranch,
                      tables: [
                        {
                          headers: ['رقم الحساب', 'اسم الحساب', 'العملة', 'مجموع مدين (ر.ي)', 'مجموع دائن (ر.ي)', 'رصيد مدين', 'رصيد دائن'],
                          rows: trialBalanceRows.map((r) => {
                            const acc = accByIdMap.get(r.accountId);
                            const curr = getAccCurrency(acc);
                            const rate = getEffectiveCurrencyRate(currencies, curr);
                            const fmtCell = (val: number) =>
                              val > 0 && curr !== 'YER'
                                ? `${(Math.round((val / rate) * 100) / 100).toLocaleString()} ${curr} (${val.toLocaleString()} YER)`
                                : val;
                            return [r.accountCode, r.accountName, curr, r.periodDebit, r.periodCredit, fmtCell(r.endingDebit), fmtCell(r.endingCredit)];
                          }),
                          totals: ['الإجمالي', '', 'YER / SAR', tbPerDr, tbPerCr, tbEndDr, tbEndCr],
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportToExcel({
                      fileName: `ميزان_المراجعة_${endDate}`,
                      sheets: [
                        {
                          name: 'ميزان المراجعة',
                          data: [
                            ['رقم الحساب', 'اسم الحساب', 'العملة', 'مجموع مدين', 'مجموع دائن', 'رصيد مدين (YER)', 'رصيد دائن (YER)'],
                            ...trialBalanceRows.map((r) => {
                              const curr = getAccCurrency(accByIdMap.get(r.accountId));
                              return [r.accountCode, r.accountName, curr, r.periodDebit, r.periodCredit, r.endingDebit, r.endingCredit];
                            }),
                          ],
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Excel</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-bold">
                  <tr>
                    <th className="py-3 px-4">رقم الحساب</th>
                    <th className="py-3 px-4">اسم الحساب</th>
                    <th className="py-3 px-4 text-left">مجموع مدين</th>
                    <th className="py-3 px-4 text-left">مجموع دائن</th>
                    <th className="py-3 px-4 text-left">رصيد مدين</th>
                    <th className="py-3 px-4 text-left">رصيد دائن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {trialBalanceRows.map((row) => {
                    const accCurr = getAccCurrency(accByIdMap.get(row.accountId));
                    const accRate = getEffectiveCurrencyRate(currencies, accCurr);
                    const isForeign = accCurr !== 'YER';
                    const currTag = accCurr === 'SAR' ? 'ر.س' : accCurr;
                    return (
                      <tr key={row.accountId} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-bold text-amber-400">{row.accountCode}</td>
                        <td className="py-2.5 px-4 font-sans text-slate-200 font-semibold">
                          <span>{row.accountName}</span>
                          {isForeign && (
                            <span className="mr-2 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-500/50">
                              {accCurr}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-left text-slate-300 tabular-nums">{row.periodDebit > 0 ? row.periodDebit.toLocaleString() : '-'}</td>
                        <td className="py-2.5 px-4 text-left text-slate-300 tabular-nums">{row.periodCredit > 0 ? row.periodCredit.toLocaleString() : '-'}</td>
                        <td className="py-2.5 px-4 text-left font-bold text-sky-400 tabular-nums">
                          {row.endingDebit > 0 ? (
                            isForeign ? (
                              <div className="leading-tight">
                                <div className="text-emerald-300">
                                  {(Math.round((row.endingDebit / accRate) * 100) / 100).toLocaleString()} {currTag}
                                </div>
                                <div className="text-[10px] text-slate-400">{row.endingDebit.toLocaleString()} ر.ي</div>
                              </div>
                            ) : (
                              row.endingDebit.toLocaleString()
                            )
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-left font-bold text-emerald-400 tabular-nums">
                          {row.endingCredit > 0 ? (
                            isForeign ? (
                              <div className="leading-tight">
                                <div className="text-emerald-300">
                                  {(Math.round((row.endingCredit / accRate) * 100) / 100).toLocaleString()} {currTag}
                                </div>
                                <div className="text-[10px] text-slate-400">{row.endingCredit.toLocaleString()} ر.ي</div>
                              </div>
                            ) : (
                              row.endingCredit.toLocaleString()
                            )
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-950 font-mono font-black border-t-2 border-slate-700 text-xs">
                  <tr>
                    <td colSpan={2} className="py-2.5 px-4 font-sans text-slate-300 text-left">المجموع العام (بالعملة الأساسية YER):</td>
                    <td className="py-2.5 px-4 text-left text-slate-100 tabular-nums">{tbPerDr.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-left text-slate-100 tabular-nums">{tbPerCr.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-left text-amber-400 tabular-nums">{tbEndDr.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-left text-amber-400 tabular-nums">{tbEndCr.toLocaleString()}</td>
                  </tr>
                  <tr className="border-t border-slate-800 bg-emerald-950/20">
                    <td colSpan={2} className="py-2 px-4 font-sans text-emerald-300 text-left">
                      المجموع المعادل بالريال السعودي (SAR × {sarRate}):
                    </td>
                    <td className="py-2 px-4 text-left text-emerald-300 tabular-nums">
                      {(Math.round((tbPerDr / sarRate) * 100) / 100).toLocaleString()} ر.س
                    </td>
                    <td className="py-2 px-4 text-left text-emerald-300 tabular-nums">
                      {(Math.round((tbPerCr / sarRate) * 100) / 100).toLocaleString()} ر.س
                    </td>
                    <td className="py-2 px-4 text-left text-emerald-300 tabular-nums">
                      {(Math.round((tbEndDr / sarRate) * 100) / 100).toLocaleString()} ر.س
                    </td>
                    <td className="py-2 px-4 text-left text-emerald-300 tabular-nums">
                      {(Math.round((tbEndCr / sarRate) * 100) / 100).toLocaleString()} ر.س
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })()}

      {/* TAB 5: INCOME STATEMENT */}
      {activeTab === 'income_statement' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-3xl mx-auto space-y-6 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white">قائمة الدخل والأرباح والخسائر</h3>
              <p className="text-slate-400">للفترة من {startDate} إلى {endDate}</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void downloadReportAsPDF({
                  title: 'قائمة الدخل والأرباح والخسائر',
                  periodText: `${startDate} إلى ${endDate}`,
                  company,
                  branch: currentBranch,
                  tables: [
                    {
                      title: 'الإيرادات والتكاليف والمصروفات',
                      headers: ['البند', 'الكود', 'القيمة'],
                      rows: [
                        ...incomeStatement.revenues.map((r) => [r.accountName, r.accountCode, r.amount]),
                        ...incomeStatement.cogs.map((c) => [`تكلفة: ${c.accountName}`, c.accountCode, -c.amount]),
                        ...incomeStatement.expenses.map((e) => [`مصروف: ${e.accountName}`, e.accountCode, -e.amount]),
                      ],
                      totals: ['صافي الدخل (الربح / الخسارة)', '', incomeStatement.netIncome],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>تصدير PDF</span>
            </button>
          </div>

          <div className="space-y-4 font-mono tabular-nums">
            <div>
              <span className="font-sans font-bold text-amber-400 text-sm block mb-2">1. الإيرادات التشغيلية:</span>
              <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2">
                {incomeStatement.revenues.map((rev) => (
                  <div key={rev.accountCode} className="flex justify-between text-slate-200">
                    <span className="font-sans">{rev.accountName} ({rev.accountCode})</span>
                    <span>{rev.amount.toLocaleString()} {currencySymbol}</span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-emerald-400">
                  <span className="font-sans">إجمالي الإيرادات:</span>
                  <span>{incomeStatement.totalRevenue.toLocaleString()} {currencySymbol}</span>
                </div>
              </div>
            </div>

            <div>
              <span className="font-sans font-bold text-rose-400 text-sm block mb-2">2. تكلفة المبيعات (COGS):</span>
              <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2">
                {incomeStatement.cogs.map((c) => (
                  <div key={c.accountCode} className="flex justify-between text-slate-300">
                    <span className="font-sans">{c.accountName}</span>
                    <span>{c.amount.toLocaleString()} {currencySymbol}</span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-rose-400">
                  <span className="font-sans">إجمالي تكلفة المبيعات:</span>
                  <span>-{incomeStatement.totalCogs.toLocaleString()} {currencySymbol}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700 flex justify-between text-sm font-bold text-white">
              <span className="font-sans">مجمل الربح:</span>
              <span className="text-amber-300">{incomeStatement.grossProfit.toLocaleString()} {currencySymbol}</span>
            </div>

            <div>
              <span className="font-sans font-bold text-slate-300 text-sm block mb-2">3. المصروفات التشغيلية والإدارية:</span>
              <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2">
                {incomeStatement.expenses.map((exp) => (
                  <div key={exp.accountCode} className="flex justify-between text-slate-300">
                    <span className="font-sans">{exp.accountName}</span>
                    <span>{exp.amount.toLocaleString()} {currencySymbol}</span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-rose-400">
                  <span className="font-sans">إجمالي المصروفات:</span>
                  <span>-{incomeStatement.totalExpenses.toLocaleString()} {currencySymbol}</span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/60 p-4 rounded-xl border-2 border-amber-500/40 flex justify-between text-base font-black">
              <span className="font-sans text-white">صافي الربح / الخسارة:</span>
              <span className={incomeStatement.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {incomeStatement.netIncome.toLocaleString()} {currencySymbol}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: BALANCE SHEET */}
      {activeTab === 'balance_sheet' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-4xl mx-auto space-y-6 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white">الميزانية العمومية (قائمة المركز المالي)</h3>
              <p className="text-slate-400">كما هي في {endDate} · الأصول = الخصوم + حقوق الملكية</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void downloadReportAsPDF({
                  title: 'الميزانية العمومية (المركز المالي)',
                  periodText: `حتى تاريخ ${endDate}`,
                  company,
                  branch: currentBranch,
                  tables: [
                    {
                      title: 'الأصول',
                      headers: ['الحساب', 'الكود', 'الرصيد'],
                      rows: balanceSheet.assets.map((a) => [a.accountName, a.accountCode, a.balance]),
                      totals: ['إجمالي الأصول', '', balanceSheet.totalAssets],
                    },
                    {
                      title: 'الخصوم وحقوق الملكية',
                      headers: ['الحساب', 'الكود', 'الرصيد'],
                      rows: [
                        ...balanceSheet.liabilities.map((l) => [l.accountName, l.accountCode, l.balance]),
                        ...balanceSheet.equity.map((e) => [e.accountName, e.accountCode, e.balance]),
                        ['أرباح الفترة الحالية', '-', balanceSheet.netProfitCarried],
                      ],
                      totals: ['إجمالي الخصوم وحقوق الملكية', '', balanceSheet.totalLiabilitiesAndEquity],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>تصدير PDF</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono tabular-nums">
            <div className="space-y-3">
              <h4 className="font-sans font-black text-sm text-sky-400 border-b border-slate-800 pb-2">الأصول (الموجودات)</h4>
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
                {balanceSheet.assets.map((a) => (
                  <div key={a.accountCode} className="flex justify-between text-slate-200">
                    <span className="font-sans">{a.accountName}</span>
                    <span>{a.balance.toLocaleString()} {currencySymbol}</span>
                  </div>
                ))}
                <div className="border-t border-slate-800 pt-3 flex justify-between text-sm font-black text-sky-400">
                  <span className="font-sans">إجمالي الأصول:</span>
                  <span>{balanceSheet.totalAssets.toLocaleString()} {currencySymbol}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="font-sans font-black text-sm text-rose-400 border-b border-slate-800 pb-2">الخصوم (الالتزامات)</h4>
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2 mt-2">
                  {balanceSheet.liabilities.map((l) => (
                    <div key={l.accountCode} className="flex justify-between text-slate-200">
                      <span className="font-sans">{l.accountName}</span>
                      <span>{l.balance.toLocaleString()} {currencySymbol}</span>
                    </div>
                  ))}
                  <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-rose-400">
                    <span className="font-sans">إجمالي الخصوم:</span>
                    <span>{balanceSheet.totalLiabilities.toLocaleString()} {currencySymbol}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-sans font-black text-sm text-amber-400 border-b border-slate-800 pb-2">حقوق الملكية</h4>
                <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2 mt-2">
                  {balanceSheet.equity.map((e) => (
                    <div key={e.accountCode} className="flex justify-between text-slate-200">
                      <span className="font-sans">{e.accountName}</span>
                      <span>{e.balance.toLocaleString()} {currencySymbol}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span className="font-sans">أرباح الفترة الحالية:</span>
                    <span>{balanceSheet.netProfitCarried.toLocaleString()} {currencySymbol}</span>
                  </div>
                  <div className="border-t border-slate-800 pt-2 flex justify-between font-bold text-amber-400">
                    <span className="font-sans">إجمالي حقوق الملكية:</span>
                    <span>{balanceSheet.totalEquity.toLocaleString()} {currencySymbol}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex justify-between text-sm font-black text-white">
                <span className="font-sans">إجمالي الخصوم وحقوق الملكية:</span>
                <span className="text-amber-300">{balanceSheet.totalLiabilitiesAndEquity.toLocaleString()} {currencySymbol}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: CASH FLOW STATEMENT */}
      {activeTab === 'cash_flow' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-3xl mx-auto space-y-6 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-amber-400" />
                قائمة التدفقات النقدية (Cash Flow Statement)
              </h3>
              <p className="text-slate-400">تحليل التدفقات النقدية الداخلة والخارجة من {startDate} إلى {endDate}</p>
            </div>
            <button
              type="button"
              onClick={() =>
                void downloadReportAsPDF({
                  title: 'قائمة التدفقات النقدية',
                  periodText: `${startDate} إلى ${endDate}`,
                  company,
                  branch: currentBranch,
                  tables: [
                    {
                      headers: ['البند النقدي', 'التدفق', `القيمة (${currencySymbol})`],
                      rows: [
                        ...cashFlow.operatingInflows.map((i) => [i.label, 'تدفق داخل (+)', i.amount]),
                        ...cashFlow.operatingOutflows.map((o) => [o.label, 'تدفق خارج (-)', -o.amount]),
                        ['الرصيد النقدي في بداية الفترة', 'افتتاحي', cashFlow.openingCashBalance],
                        ['الرصيد النقدي في نهاية الفترة', 'ختامي', cashFlow.closingCashBalance],
                      ],
                      totals: ['صافي التغير النقدي', '', cashFlow.netCashChange],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>تصدير PDF</span>
            </button>
          </div>

          <div className="space-y-4 font-mono tabular-nums">
            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="font-sans font-bold text-emerald-400 mb-2">التدفقات النقدية التشغيلية الداخلة:</div>
              {cashFlow.operatingInflows.map((i, idx) => (
                <div key={idx} className="flex justify-between text-slate-200">
                  <span className="font-sans">{i.label}</span>
                  <span className="text-emerald-400">+{i.amount.toLocaleString()} {currencySymbol}</span>
                </div>
              ))}
            </div>

            <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="font-sans font-bold text-rose-400 mb-2">التدفقات النقدية التشغيلية الخارجة:</div>
              {cashFlow.operatingOutflows.map((o, idx) => (
                <div key={idx} className="flex justify-between text-slate-200">
                  <span className="font-sans">{o.label}</span>
                  <span className="text-rose-400">-{o.amount.toLocaleString()} {currencySymbol}</span>
                </div>
              ))}
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-amber-500/40 space-y-2">
              <div className="flex justify-between text-slate-300">
                <span className="font-sans">صافي التدفق النقدي من الأنشطة التشغيلية:</span>
                <strong className={cashFlow.netOperatingCashFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {cashFlow.netOperatingCashFlow.toLocaleString()} {currencySymbol}
                </strong>
              </div>
              <div className="flex justify-between text-slate-400">
                <span className="font-sans">الرصيد النقدي في بداية الفترة:</span>
                <span>{cashFlow.openingCashBalance.toLocaleString()} {currencySymbol}</span>
              </div>
              <div className="flex justify-between text-sm font-black text-amber-400 border-t border-slate-800 pt-2">
                <span className="font-sans">الرصيد النقدي الفعلي الحالي:</span>
                <span>{cashFlow.closingCashBalance.toLocaleString()} {currencySymbol}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: CUSTOM LEDGERS (الدفاتر المخصصة) */}
      {activeTab === 'custom_books' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BookMarked className="w-5 h-5 text-amber-400 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-white">الدفاتر المحاسبية المخصصة (Custom Books)</h3>
                <p className="text-xs text-slate-400">دفاتر مساعدة متعددة السطور لتسجيل العهد، التسويات الجانبية، والسجلات الخاصة</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={activeBook?.id || ''}
                onChange={(e) => setActiveBookId(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-amber-300 font-bold"
              >
                {customBooks.map((b) => (
                  <option key={b.id} value={b.id}>{b.code} - {b.nameAr}</option>
                ))}
              </select>
              {onSaveCustomBook && (
                <button
                  type="button"
                  onClick={() => setIsNewBookModalOpen(true)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg border border-slate-700 cursor-pointer"
                >
                  + دفتر جديد
                </button>
              )}
              {onSaveCustomBookEntry && activeBook && (
                <button
                  type="button"
                  onClick={() => setIsNewCustomEntryOpen(true)}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  + قيد دفتري جديد
                </button>
              )}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            {activeBookEntries.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                لا توجد قيود مسجلة في دفتر "{activeBook?.nameAr || ''}" حتى الآن.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="py-2.5 px-3">رقم السجل</th>
                      <th className="py-2.5 px-3">التاريخ</th>
                      <th className="py-2.5 px-3 text-center">عدد السطور</th>
                      <th className="py-2.5 px-3 text-left">إجمالي المدين</th>
                      <th className="py-2.5 px-3 text-left">إجمالي الدائن</th>
                      <th className="py-2.5 px-3">ملاحظات</th>
                      <th className="py-2.5 px-3 text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {activeBookEntries.map((ce) => (
                      <tr key={ce.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-mono font-bold text-amber-400">{ce.entryNumber}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-400">{ce.date}</td>
                        <td className="py-2.5 px-3 text-center font-mono">{ce.rows.length}</td>
                        <td className="py-2.5 px-3 text-left font-mono text-sky-400 tabular-nums">{ce.totalDebit.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-left font-mono text-emerald-400 tabular-nums">{ce.totalCredit.toLocaleString()}</td>
                        <td className="py-2.5 px-3 text-slate-300">{ce.notes || '-'}</td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => setViewingCustomEntry(ce)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded font-bold cursor-pointer"
                          >
                            عرض
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* NEW MANUAL JOURNAL ENTRY MODAL */}
      {isNewEntryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">إنشاء قيد يومية عام يدوي</h3>
              <button
                type="button"
                onClick={() => setIsNewEntryModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEntrySubmit} className="p-6 space-y-5 text-xs">
              {formError && (
                <div className="p-3 bg-rose-950/70 border border-rose-700/50 text-rose-300 rounded-lg font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تاريخ القيد *</label>
                  <input
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم المرجع</label>
                  <input
                    type="text"
                    value={entryRefNum}
                    onChange={(e) => setEntryRefNum(e.target.value)}
                    placeholder="مثال: REF-9901"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">شرح القيد *</label>
                  <input
                    type="text"
                    required
                    value={entryDescription}
                    onChange={(e) => setEntryDescription(e.target.value)}
                    placeholder="بيان العملية المحاسبية..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">الحساب *</th>
                      <th className="py-2.5 px-3">مركز التكلفة</th>
                      <th className="py-2.5 px-3">البيان</th>
                      <th className="py-2.5 px-3 text-left">مدين</th>
                      <th className="py-2.5 px-3 text-left">دائن</th>
                      <th className="py-2.5 px-3 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {lines.map((line, idx) => (
                      <tr key={line.id}>
                        <td className="py-2 px-3">
                          <select
                            value={line.accountId}
                            onChange={(e) => handleUpdateLine(idx, 'accountId', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-100"
                          >
                            {leafAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.code} - {a.nameAr}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <select
                            value={line.costCenterId || ''}
                            onChange={(e) => handleUpdateLine(idx, 'costCenterId', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-300"
                          >
                            <option value="">بدون</option>
                            {costCenters.map((cc) => (
                              <option key={cc.id} value={cc.id}>{cc.nameAr}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={line.memo}
                            onChange={(e) => handleUpdateLine(idx, 'memo', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-100"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min={0}
                            value={line.debit || ''}
                            onChange={(e) => handleUpdateLine(idx, 'debit', Number(e.target.value))}
                            className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-100 font-mono text-left"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number"
                            min={0}
                            value={line.credit || ''}
                            onChange={(e) => handleUpdateLine(idx, 'credit', Number(e.target.value))}
                            className="w-28 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-100 font-mono text-left"
                          />
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(line.id)}
                            className="text-slate-500 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap justify-between items-center gap-3">
                <button
                  type="button"
                  onClick={handleAddLine}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg cursor-pointer"
                >
                  + إضافة طرف قيد
                </button>

                <div className="flex flex-wrap items-center gap-4 font-mono text-xs">
                  <div>
                    <span className="text-slate-400 font-sans ml-1">إجمالي المدين:</span>
                    <strong className="text-white">{totalDebit.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans ml-1">إجمالي الدائن:</span>
                    <strong className="text-white">{totalCredit.toLocaleString()}</strong>
                  </div>
                  <div className="border-r border-slate-700 pr-4">
                    {isBalanced ? (
                      <span className="text-emerald-400 font-bold font-sans flex items-center gap-1">
                        <ShieldCheck className="w-4 h-4" /> متوازن ومؤهل للترحيل
                      </span>
                    ) : (
                      <span className="text-rose-400 font-bold font-sans flex items-center gap-1">
                        <ShieldAlert className="w-4 h-4" /> غير متوازن! الفارق: {diff.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewEntryModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  ترحيل القيد المزدوج
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE CUSTOM BOOK MODAL */}
      {isNewBookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl text-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">إنشاء دفتر مخصص جديد</h3>
              <button type="button" onClick={() => setIsNewBookModalOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveBook} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">اسم الدفتر *</label>
                <input
                  type="text"
                  required
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  placeholder="مثال: دفتر العهد الميدانية أو سجل المصاريف اليومية"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">الوصف</label>
                <textarea
                  rows={2}
                  value={newBookDesc}
                  onChange={(e) => setNewBookDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button type="button" onClick={() => setIsNewBookModalOpen(false)} className="px-4 py-2 bg-slate-800 rounded-lg text-slate-300 font-semibold">
                  إلغاء
                </button>
                <button type="submit" className="px-4 py-2 bg-amber-500 hover:bg-amber-400 rounded-lg text-slate-950 font-bold">
                  إنشاء الدفتر
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW CUSTOM BOOK MULTI-ROW ENTRY MODAL */}
      {isNewCustomEntryOpen && activeBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl text-slate-100">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">إدخال سجل في دفتر: {activeBook.nameAr}</h3>
              <button type="button" onClick={() => setIsNewCustomEntryOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveCustomEntry} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={customEntryDate}
                    onChange={(e) => setCustomEntryDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">ملاحظات عامة</label>
                  <input
                    type="text"
                    value={customEntryNotes}
                    onChange={(e) => setCustomEntryNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">الطرف / الجهة</th>
                      <th className="py-2 px-3">البيان *</th>
                      <th className="py-2 px-3 text-left">مدين</th>
                      <th className="py-2 px-3 text-left">دائن</th>
                      <th className="py-2 px-3">العملة</th>
                      <th className="py-2 px-3 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody ref={customGridRef} className="divide-y divide-slate-800">
                    {customRows.map((r, idx) => (
                      <tr key={r.id}>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={r.partyName}
                            data-cgrid-row={idx}
                            data-cgrid-col={0}
                            onKeyDown={(e) => handleCustomGridKeyDown(e, idx, 0)}
                            onChange={(e) =>
                              setCustomRows((prev) => prev.map((x, i) => (i === idx ? { ...x, partyName: e.target.value } : x)))
                            }
                            placeholder="اسم الطرف"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={r.statement}
                            data-cgrid-row={idx}
                            data-cgrid-col={1}
                            onKeyDown={(e) => handleCustomGridKeyDown(e, idx, 1)}
                            onChange={(e) =>
                              setCustomRows((prev) => prev.map((x, i) => (i === idx ? { ...x, statement: e.target.value } : x)))
                            }
                            placeholder="البيان..."
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            min={0}
                            value={r.debit || ''}
                            data-cgrid-row={idx}
                            data-cgrid-col={2}
                            onKeyDown={(e) => handleCustomGridKeyDown(e, idx, 2)}
                            onChange={(e) =>
                              setCustomRows((prev) => prev.map((x, i) => (i === idx ? { ...x, debit: Number(e.target.value) } : x)))
                            }
                            className="w-24 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-left text-white"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            min={0}
                            value={r.credit || ''}
                            data-cgrid-row={idx}
                            data-cgrid-col={3}
                            onKeyDown={(e) => handleCustomGridKeyDown(e, idx, 3)}
                            onChange={(e) =>
                              setCustomRows((prev) => prev.map((x, i) => (i === idx ? { ...x, credit: Number(e.target.value) } : x)))
                            }
                            className="w-24 bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-left text-white"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={r.currency}
                            onChange={(e) =>
                              setCustomRows((prev) => prev.map((x, i) => (i === idx ? { ...x, currency: e.target.value as CurrencyCode } : x)))
                            }
                            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-amber-300"
                          >
                            <option value="YER">YER</option>
                            <option value="SAR">SAR</option>
                            <option value="USD">USD</option>
                          </select>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            disabled={customRows.length <= 1}
                            onClick={() => setCustomRows((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-slate-500 hover:text-rose-400 disabled:opacity-40 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() =>
                    setCustomRows((prev) => [
                      ...prev,
                      { id: `cr-${Date.now()}`, partyName: '', statement: '', debit: 0, credit: 0, currency: 'YER' },
                    ])
                  }
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-semibold cursor-pointer"
                >
                  + إضافة سطر
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsNewCustomEntryOpen(false)} className="px-4 py-2 bg-slate-800 rounded-lg text-slate-300 font-semibold">
                    إلغاء
                  </button>
                  <button type="submit" className="px-5 py-2 bg-amber-500 hover:bg-amber-400 rounded-lg text-slate-950 font-bold">
                    حفظ القيد الدفتري
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW CUSTOM BOOK ENTRY MODAL WITH PREV / NEXT */}
      {viewingCustomEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl text-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-sm text-white">تفاصيل القيد الدفتري: {viewingCustomEntry.entryNumber}</h3>
                <p className="text-xs text-slate-400">التاريخ: {viewingCustomEntry.date}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={viewingCustomIdx <= 0}
                  onClick={() => viewingCustomIdx > 0 && setViewingCustomEntry(activeBookEntries[viewingCustomIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={viewingCustomIdx < 0 || viewingCustomIdx >= activeBookEntries.length - 1}
                  onClick={() =>
                    viewingCustomIdx >= 0 &&
                    viewingCustomIdx < activeBookEntries.length - 1 &&
                    setViewingCustomEntry(activeBookEntries[viewingCustomIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void downloadReportAsPDF({
                      title: `${activeBook?.nameAr || 'دفتر مخصص'} - ${viewingCustomEntry.entryNumber}`,
                      company,
                      branch: currentBranch,
                      tables: [
                        {
                          headers: ['الطرف', 'البيان', 'مدين', 'دائن', 'العملة'],
                          rows: viewingCustomEntry.rows.map((r) => [r.partyName || '-', r.statement, r.debit, r.credit, r.currency]),
                          totals: ['الإجمالي', '', viewingCustomEntry.totalDebit, viewingCustomEntry.totalCredit, ''],
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingCustomEntry(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 overflow-x-auto text-xs">
              <table className="w-full text-right">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">الطرف</th>
                    <th className="py-2 px-3">البيان</th>
                    <th className="py-2 px-3 text-left">مدين</th>
                    <th className="py-2 px-3 text-left">دائن</th>
                    <th className="py-2 px-3">العملة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {viewingCustomEntry.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 px-3 text-slate-200">{r.partyName || '-'}</td>
                      <td className="py-2 px-3 text-slate-300">{r.statement}</td>
                      <td className="py-2 px-3 text-left font-mono text-sky-400">{r.debit.toLocaleString()}</td>
                      <td className="py-2 px-3 text-left font-mono text-emerald-400">{r.credit.toLocaleString()}</td>
                      <td className="py-2 px-3 font-mono text-amber-300">{r.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* REVERSE JOURNAL ENTRY CONFIRMATION */}
      <ConfirmModal
        isOpen={Boolean(reverseTarget)}
        title="تأكيد عكس القيد المحاسبي"
        message={
          reverseTarget
            ? `سيتم إنشاء قيد عكسي مقابل للقيد رقم ${reverseTarget.entryNumber} بمبلغ ${reverseTarget.totalDebit.toLocaleString()} ${currencySymbol} لتصفير أثره المالي مع حفظ السجل التاريخي.`
            : ''
        }
        confirmLabel="تأكيد إنشاء القيد العكسي"
        variant="danger"
        onCancel={() => setReverseTarget(null)}
        onConfirm={() => {
          if (reverseTarget && onReverseJournalEntry) {
            onReverseJournalEntry(reverseTarget.id, reverseReason);
            onNotify?.('info', `تم عكس القيد رقم ${reverseTarget.entryNumber} بقيد عكسي جديد.`);
          }
          setReverseTarget(null);
        }}
      />
    </div>
  );
};
