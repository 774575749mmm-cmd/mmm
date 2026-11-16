/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 3: Row-by-Row Custom Ledgers & Double-Entry Accounting
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  FilePlus,
  BookPlus,
  CheckCircle2,
  SlidersHorizontal,
  Eye,
  Plus,
  Copy,
  X,
  BookOpenCheck,
} from 'lucide-react';
import {
  Account,
  JournalEntry,
  CostCenter,
  Branch,
  Company,
  Invoice,
  PaymentVoucher,
  ExpenseRecord,
  CustomLedgerBook,
  CustomLedgerEntry,
  CustomLedgerRow,
  TreasuryAccount,
  Currency,
  CurrencyCode,
  User,
  TableColumnPref,
  Customer,
  Vendor,
  ExpenseCategory,
  PrintDocumentType,
  PrintTemplateConfig,
  FiscalPeriod,
} from '../../../types/erp';
import { generateNextDocNumber } from '../../../services/storageService';
import { rankSearchResults } from '../../../services/searchHelpers';
import { convertToBase, getEffectiveSarRate } from '../../../services/currencyHelpers';
import { UniversalColumnCustomizer } from '../../common/UniversalColumnCustomizer';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { PrintableDocumentData } from '../../common/PrintModal';
import { AccountingModule } from '../accounting/AccountingModule';

const DEFAULT_LEDGER_COLS: TableColumnPref[] = [
  { key: 'entryNumber', label: 'رقم القيد', visible: true, order: 0, width: 105 },
  { key: 'date', label: 'التاريخ', visible: true, order: 1, width: 95 },
  { key: 'partyName', label: 'الطرف / الحساب', visible: true, order: 2, width: 180 },
  { key: 'statement', label: 'البيان التفصيلي للصف', visible: true, order: 3, width: 220 },
  { key: 'debit', label: 'مدين (وارد)', visible: true, order: 4, width: 105 },
  { key: 'credit', label: 'دائن (منصرف)', visible: true, order: 5, width: 105 },
  { key: 'currency', label: 'العملة', visible: true, order: 6, width: 70 },
  { key: 'treasury', label: 'الصندوق المتأثر', visible: true, order: 7, width: 140 },
];

const createEmptyLedgerRow = (cur: CurrencyCode): CustomLedgerRow => ({
  id: `lrow-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
  partyName: '',
  statement: '',
  debit: 0,
  credit: 0,
  currency: cur,
  notes: '',
});

interface LedgersAccountingWorkbenchProps {
  chartOfAccounts: Account[];
  journalEntries: JournalEntry[];
  costCenters: CostCenter[];
  invoices: Invoice[];
  paymentVouchers: PaymentVoucher[];
  expenseRecords: ExpenseRecord[];
  customBooks: CustomLedgerBook[];
  customBookEntries: CustomLedgerEntry[];
  treasuryAccounts: TreasuryAccount[];
  customers?: Customer[];
  vendors?: Vendor[];
  expenseCategories?: ExpenseCategory[];
  currencies: Currency[];
  fiscalPeriods?: FiscalPeriod[];
  currentBranch: Branch;
  currentCurrency: Currency;
  currentUser: User;
  company: Company;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefs?: TableColumnPref[];
  focusedRecordId?: string;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onPostManualEntry: (entry: JournalEntry) => void;
  onReverseJournalEntry: (entryId: string, reason: string) => void;
  onSaveCustomBook: (book: CustomLedgerBook) => void;
  onSaveCustomBookEntry: (entry: CustomLedgerEntry, options?: { syncVoucher?: boolean }) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const LedgersAccountingWorkbench: React.FC<LedgersAccountingWorkbenchProps> = ({
  chartOfAccounts,
  journalEntries,
  costCenters,
  invoices,
  paymentVouchers,
  expenseRecords,
  customBooks,
  customBookEntries,
  treasuryAccounts,
  customers = [],
  vendors = [],
  expenseCategories = [],
  currencies,
  fiscalPeriods = [],
  currentBranch,
  currentCurrency,
  currentUser,
  company,
  printTemplates,
  savedColumnPrefs,
  focusedRecordId,
  onSaveColumnPrefs,
  onPostManualEntry,
  onReverseJournalEntry,
  onSaveCustomBook,
  onSaveCustomBookEntry,
  onOpenPrintModal,
  onNotify,
}) => {
  const [subMode, setSubMode] = useState<'v20_ledgers' | 'double_entry'>('v20_ledgers');

  const [selectedBookId, setSelectedBookId] = useState<string>(customBooks[0]?.id || '');
  const [viewingIdx, setViewingIdx] = useState<number>(-1);
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [treasuryId, setTreasuryId] = useState<string>(''); // Optional treasury impact
  const [direction, setDirection] = useState<'OUT' | 'IN'>('OUT');
  const [syncVoucher, setSyncVoucher] = useState<boolean>(true);
  const [generalNotes, setGeneralNotes] = useState<string>('');
  const [rows, setRows] = useState<CustomLedgerRow[]>(() => [
    createEmptyLedgerRow(currentCurrency.code || 'YER'),
    createEmptyLedgerRow(currentCurrency.code || 'YER'),
  ]);

  const [acRowIdx, setAcRowIdx] = useState<number | null>(null);
  const [acHighlightIdx, setAcHighlightIdx] = useState<number>(0);

  // Create Book Modal
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [newBookName, setNewBookName] = useState('');
  const [newBookDesc, setNewBookDesc] = useState('');

  const [isColCustOpen, setIsColCustOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);

  const cellRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const regCell = (rIdx: number, col: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    cellRefs.current[`${rIdx}:${col}`] = el;
  };

  const columns = useMemo(() => {
    const base = savedColumnPrefs && savedColumnPrefs.length > 0 ? savedColumnPrefs : DEFAULT_LEDGER_COLS;
    return [...base].sort((a, b) => a.order - b.order);
  }, [savedColumnPrefs]);

  const bookEntries = useMemo(() => {
    return customBookEntries
      .filter((e) => !selectedBookId || e.bookId === selectedBookId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [customBookEntries, selectedBookId]);

  const nextEntryNum = useMemo(() => {
    return generateNextDocNumber(
      'LDG-',
      customBookEntries.map((e) => e.entryNumber),
      4
    );
  }, [customBookEntries]);

  const loadEntry = (idx: number) => {
    const e = bookEntries[idx];
    if (!e) return;
    setViewingIdx(idx);
    setSelectedBookId(e.bookId);
    setEntryDate(e.date);
    setTreasuryId(e.treasuryAccountId || '');
    setDirection(e.direction || 'OUT');
    setGeneralNotes(e.notes || '');
    setRows(e.rows.length > 0 ? e.rows : [createEmptyLedgerRow(currentCurrency.code || 'YER')]);
  };

  const resetForm = () => {
    setViewingIdx(-1);
    setEntryDate(new Date().toISOString().split('T')[0]);
    setGeneralNotes('');
    setRows([
      createEmptyLedgerRow(currentCurrency.code || 'YER'),
      createEmptyLedgerRow(currentCurrency.code || 'YER'),
    ]);
  };

  const focusCell = (rIdx: number, col: string) => {
    setTimeout(() => {
      const el = cellRefs.current[`${rIdx}:${col}`];
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement) el.select();
      }
    }, 10);
  };

  const partyChoices = useMemo(() => {
    const list: { id: string; code?: string; name: string; kindLabel: string }[] = [];
    customers.forEach((c) => list.push({ id: c.id, code: c.code, name: c.nameAr, kindLabel: 'عميل' }));
    vendors.forEach((v) => list.push({ id: v.id, code: v.code, name: v.nameAr, kindLabel: 'مورد' }));
    expenseCategories.forEach((cat) => list.push({ id: cat.id, code: 'EXP', name: cat.nameAr, kindLabel: 'بند مصروف' }));
    chartOfAccounts
      .filter((a) => a.isLeaf)
      .forEach((a) => list.push({ id: a.id, code: a.code, name: a.nameAr, kindLabel: `حساب #${a.code}` }));
    return list;
  }, [customers, vendors, expenseCategories, chartOfAccounts]);

  const getPartyMatches = (q: string) =>
    rankSearchResults(partyChoices, q, (o) => ({ code: o.code, id: o.id, name: `${o.name} ${o.kindLabel}` }), 18);

  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, col: string) => {
    if (acRowIdx === rIdx && col === 'partyName') {
      const matches = getPartyMatches(rows[rIdx]?.partyName || '');
      if (e.key === 'ArrowDown' && matches.length > 0) {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.min(matches.length - 1, p + 1));
        return;
      }
      if (e.key === 'ArrowUp' && matches.length > 0) {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === 'Enter' && matches[acHighlightIdx]) {
        e.preventDefault();
        const chosen = matches[acHighlightIdx];
        setRows((p) => p.map((x, i) => (i === rIdx ? { ...x, partyName: chosen.name } : x)));
        setAcRowIdx(null);
        focusCell(rIdx, 'statement');
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rIdx + 1 < rows.length) focusCell(rIdx + 1, col);
      else {
        const nextIdx = rows.length;
        setRows((p) => [...p, createEmptyLedgerRow(currentCurrency.code || 'YER')]);
        focusCell(nextIdx, col);
      }
    } else if (e.key === 'ArrowUp' && rIdx > 0) {
      e.preventDefault();
      focusCell(rIdx - 1, col);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (col === 'partyName') focusCell(rIdx, 'statement');
      else if (col === 'statement') focusCell(rIdx, 'debit');
      else if (col === 'debit') focusCell(rIdx, 'credit');
      else if (col === 'credit') {
        if (rIdx + 1 < rows.length) focusCell(rIdx + 1, 'partyName');
        else {
          const nextIdx = rows.length;
          setRows((p) => [...p, createEmptyLedgerRow(currentCurrency.code || 'YER')]);
          focusCell(nextIdx, 'partyName');
        }
      }
    }
  };

  const totalDebit = useMemo(() => rows.reduce((s, r) => s + (Number(r.debit) || 0), 0), [rows]);
  const totalCredit = useMemo(() => rows.reduce((s, r) => s + (Number(r.credit) || 0), 0), [rows]);

  const handleSaveEntry = () => {
    if (!selectedBookId) {
      onNotify('error', 'أنشئ دفتراً أو اختر دفتراً أولاً.');
      return;
    }
    const validRows = rows.filter((r) => r.partyName.trim() || r.statement.trim() || r.debit > 0 || r.credit > 0);
    if (validRows.length === 0) {
      onNotify('error', 'أدخل صفاً واحداً على الأقل.');
      return;
    }
    const tr = treasuryAccounts.find((t) => t.id === treasuryId);
    const entry: CustomLedgerEntry = {
      id: viewingIdx >= 0 && bookEntries[viewingIdx] ? bookEntries[viewingIdx].id : `centry-${Date.now()}`,
      bookId: selectedBookId,
      entryNumber: viewingIdx >= 0 && bookEntries[viewingIdx] ? bookEntries[viewingIdx].entryNumber : nextEntryNum,
      date: entryDate,
      treasuryAccountId: tr?.id,
      treasuryAccountName: tr?.nameAr,
      direction,
      rows: validRows,
      totalDebit,
      totalCredit,
      notes: generalNotes || undefined,
      createdBy: currentUser.fullName,
      createdAt: new Date().toISOString(),
    };
    onSaveCustomBookEntry(entry, { syncVoucher: Boolean(tr) && syncVoucher });
    onNotify(
      'success',
      `تم حفظ قيد الدفتر رقم ${entry.entryNumber} (${validRows.length} صفوف)${
        tr && syncVoucher ? ' ومزامنته مع السندات والتقارير اليومية.' : '.'
      }`
    );
    resetForm();
  };

  // Flattened row-by-row ledger log (V20 signature feature)
  const flattenedRows = useMemo(() => {
    const list: {
      entryId: string;
      entryNumber: string;
      date: string;
      partyName: string;
      statement: string;
      debit: number;
      credit: number;
      currency: string;
      treasury: string;
    }[] = [];
    for (const e of [...bookEntries].reverse()) {
      for (const r of e.rows) {
        list.push({
          entryId: e.id,
          entryNumber: e.entryNumber,
          date: e.date,
          partyName: r.partyName || '-',
          statement: r.statement || e.notes || '-',
          debit: r.debit || 0,
          credit: r.credit || 0,
          currency: r.currency || 'YER',
          treasury: e.treasuryAccountName || 'بدون تأثير خزينة',
        });
      }
    }
    return list;
  }, [bookEntries]);

  const currentBookObj = customBooks.find((b) => b.id === selectedBookId);

  const buildPreview = (): UniversalPreviewPayload => {
    const visCols = columns.filter((c) => c.visible);
    const currSet = new Set(flattenedRows.map((x) => x.currency || 'YER'));
    const singleCurr = currSet.size === 1 ? Array.from(currSet)[0] : null;
    const rawDebitSum = flattenedRows.reduce((s, x) => s + x.debit, 0);
    const rawCreditSum = flattenedRows.reduce((s, x) => s + x.credit, 0);
    const baseDebitSum = Math.round(
      flattenedRows.reduce((s, x) => s + convertToBase(x.debit, x.currency || 'YER', currencies), 0) * 100
    ) / 100;
    const baseCreditSum = Math.round(
      flattenedRows.reduce((s, x) => s + convertToBase(x.credit, x.currency || 'YER', currencies), 0) * 100
    ) / 100;
    const sarRate = getEffectiveSarRate(currencies);
    const sarDebitEq = Math.round((baseDebitSum / sarRate) * 100) / 100;
    const sarCreditEq = Math.round((baseCreditSum / sarRate) * 100) / 100;

    return {
      title: `سجل تفصيلي: ${currentBookObj?.nameAr || 'الدفتر المخصص'}`,
      periodText: `عدد الحركات التفصيلية: ${flattenedRows.length} · سعر التحويل: 1 SAR = ${sarRate} YER`,
      summaryCards: [
        {
          label: 'إجمالي المدين (وارد)',
          value: singleCurr
            ? `${rawDebitSum.toLocaleString()} ${singleCurr}`
            : `اليمني: ${baseDebitSum.toLocaleString()} ر.ي`,
          subValue:
            singleCurr && singleCurr !== 'YER'
              ? `المعادل: ${baseDebitSum.toLocaleString()} ر.ي`
              : `السعودي (×${sarRate}): ${sarDebitEq.toLocaleString()} ر.س`,
          tone: 'green',
        },
        {
          label: 'إجمالي الدائن (منصرف)',
          value: singleCurr
            ? `${rawCreditSum.toLocaleString()} ${singleCurr}`
            : `اليمني: ${baseCreditSum.toLocaleString()} ر.ي`,
          subValue:
            singleCurr && singleCurr !== 'YER'
              ? `المعادل: ${baseCreditSum.toLocaleString()} ر.ي`
              : `السعودي (×${sarRate}): ${sarCreditEq.toLocaleString()} ر.س`,
          tone: 'red',
        },
      ],
      tables: [
        {
          headers: visCols.map((c) => c.label),
          rows: flattenedRows.map((fr) =>
            visCols.map((c) => {
              if (c.key === 'entryNumber') return fr.entryNumber;
              if (c.key === 'date') return fr.date;
              if (c.key === 'partyName') return fr.partyName;
              if (c.key === 'statement') return fr.statement;
              if (c.key === 'debit') return fr.debit.toLocaleString();
              if (c.key === 'credit') return fr.credit.toLocaleString();
              if (c.key === 'currency') return fr.currency;
              return fr.treasury;
            })
          ),
          totals: visCols.map((c, idx) => {
            if (idx === 0) return 'الإجمالي';
            if (c.key === 'debit') {
              return singleCurr ? `${rawDebitSum.toLocaleString()} ${singleCurr}` : `${baseDebitSum.toLocaleString()} ر.ي (معادل)`;
            }
            if (c.key === 'credit') {
              return singleCurr ? `${rawCreditSum.toLocaleString()} ${singleCurr}` : `${baseCreditSum.toLocaleString()} ر.ي (معادل)`;
            }
            return '';
          }),
        },
      ],
      whatsappText: `${company.nameAr}\nتقرير ${currentBookObj?.nameAr || 'الدفتر المخصص'}\nإجمالي المدين: ${baseDebitSum.toLocaleString()} ر.ي (${sarDebitEq.toLocaleString()} ر.س)\nإجمالي الدائن: ${baseCreditSum.toLocaleString()} ر.ي (${sarCreditEq.toLocaleString()} ر.س)`,
    };
  };

  return (
    <div className="space-y-3" dir="rtl">
      {/* Sub-mode Toggle Strip */}
      <div className="v20-card-alt px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubMode('v20_ledgers')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-black cursor-pointer ${
              subMode === 'v20_ledgers'
                ? 'bg-[var(--gold)] text-[#03060A]'
                : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            1. الدفاتر اليومية والمخصصة (صف صف تفصيلي)
          </button>
          <button
            type="button"
            onClick={() => setSubMode('double_entry')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subMode === 'double_entry'
                ? 'bg-[var(--gold)] text-[#03060A]'
                : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <BookOpenCheck className="w-3.5 h-3.5" />
            <span>2. القيود المزدوجة، الأستاذ، الميزان والقوائم الختامية</span>
          </button>
        </div>
      </div>

      {subMode === 'double_entry' ? (
        <AccountingModule
          chartOfAccounts={chartOfAccounts}
          journalEntries={journalEntries}
          costCenters={costCenters}
          invoices={invoices}
          paymentVouchers={paymentVouchers}
          expenseRecords={expenseRecords}
          customBooks={customBooks}
          customBookEntries={customBookEntries}
          fiscalPeriods={fiscalPeriods}
          currentBranch={currentBranch}
          company={company}
          currencySymbol={currentCurrency.symbol}
          currencies={currencies}
          canPostEntries={currentUser.canPostEntries}
          focusedRecordId={focusedRecordId}
          onPostManualEntry={onPostManualEntry}
          onReverseJournalEntry={onReverseJournalEntry}
          onSaveCustomBook={onSaveCustomBook}
          onSaveCustomBookEntry={onSaveCustomBookEntry}
          onOpenPrintModal={onOpenPrintModal}
          onNotify={onNotify}
        />
      ) : (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="v20-doc-toolbar">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                disabled={bookEntries.length === 0 || viewingIdx === 0}
                onClick={() => {
                  const n = viewingIdx === -1 ? bookEntries.length - 1 : Math.max(0, viewingIdx - 1);
                  loadEntry(n);
                }}
                className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                <span>القيد السابق</span>
              </button>
              <button
                type="button"
                disabled={viewingIdx === -1}
                onClick={() => {
                  if (viewingIdx + 1 < bookEntries.length) loadEntry(viewingIdx + 1);
                  else resetForm();
                }}
                className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white disabled:opacity-40 flex items-center gap-1 cursor-pointer"
              >
                <span>القيد التالي</span>
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] flex items-center gap-1 cursor-pointer"
              >
                <FilePlus className="w-3.5 h-3.5" />
                <span>+ قيد دفتر جديد</span>
              </button>
              <button
                type="button"
                onClick={() => setIsBookModalOpen(true)}
                className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] flex items-center gap-1 cursor-pointer"
              >
                <BookPlus className="w-3.5 h-3.5" />
                <span>+ إنشاء دفتر جديد</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setIsColCustOpen(true)}
                className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white flex items-center gap-1 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>أعمدة السجل</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewPayload(buildPreview())}
                className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>معاينة / طباعة / PDF</span>
              </button>
            </div>
          </div>

          {/* Header Parameters */}
          <div className="v20-card p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">الدفتر اليومي / المخصص</label>
              <select
                value={selectedBookId}
                onChange={(e) => {
                  setSelectedBookId(e.target.value);
                  setViewingIdx(-1);
                }}
                className="w-full v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                {customBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nameAr} ({b.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">التاريخ</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">تأثير على صندوق (اختياري)</label>
              <select
                value={treasuryId}
                onChange={(e) => setTreasuryId(e.target.value)}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                <option value="">بدون تأثير على الصناديق</option>
                {treasuryAccounts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameAr} ({t.currency})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">اتجاه الحركة بالصندوق</label>
              <select
                value={direction}
                disabled={!treasuryId}
                onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                <option value="OUT">صرف من الصندوق (-)</option>
                <option value="IN">توريد إلى الصندوق (+)</option>
              </select>
            </div>
            {treasuryId && (
              <div className="col-span-2 sm:col-span-5 flex items-center gap-2 pt-1 border-t border-[#1B2E44]">
                <label className="flex items-center gap-2 text-[11px] font-bold text-emerald-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncVoucher}
                    onChange={(e) => setSyncVoucher(e.target.checked)}
                    className="accent-[var(--gold)]"
                  />
                  <span>إصدار سند قبض/صرف وسجل مصروف تلقائياً في التقارير اليومية لكل صف بمبلغ</span>
                </label>
              </div>
            )}
          </div>

          {/* Multi-Row Input Grid */}
          <div className="erp-grid-wrap">
            <table className="erp-grid">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>#</th>
                  <th>الطرف / الجهة / الحساب</th>
                  <th>البيان التفصيلي</th>
                  <th style={{ width: '120px' }}>مدين (+)</th>
                  <th style={{ width: '120px' }}>دائن (-)</th>
                  <th style={{ width: '90px' }}>العملة</th>
                  <th>ملاحظة إضافية</th>
                  <th style={{ width: '80px' }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, rIdx) => (
                  <tr key={r.id}>
                    <td className="text-center text-slate-400 font-bold tabular-nums">{rIdx + 1}</td>
                    <td className="relative">
                      <input
                        ref={regCell(rIdx, 'partyName')}
                        type="text"
                        value={r.partyName}
                        onFocus={() => {
                          setAcRowIdx(rIdx);
                          setAcHighlightIdx(0);
                        }}
                        onChange={(e) => {
                          setAcRowIdx(rIdx);
                          setAcHighlightIdx(0);
                          setRows((p) => p.map((x, i) => (i === rIdx ? { ...x, partyName: e.target.value } : x)));
                        }}
                        onBlur={() => setTimeout(() => setAcRowIdx((cur) => (cur === rIdx ? null : cur)), 180)}
                        onKeyDown={(e) => handleKeyDown(e, rIdx, 'partyName')}
                        placeholder="اكتب للبحث (عميل/مورد/مصروف/حساب)..."
                        className="cell-input font-bold"
                      />
                      {acRowIdx === rIdx && (() => {
                        const matches = getPartyMatches(r.partyName);
                        if (matches.length === 0) return null;
                        return (
                          <div className="grid-autocomplete-menu top-full right-0 w-72">
                            {matches.map((m, mIdx) => (
                              <button
                                key={`${m.kindLabel}-${m.id}`}
                                type="button"
                                onMouseDown={() => {
                                  setRows((p) => p.map((x, i) => (i === rIdx ? { ...x, partyName: m.name } : x)));
                                  setAcRowIdx(null);
                                  focusCell(rIdx, 'statement');
                                }}
                                className={`w-full text-right px-2.5 py-1.5 text-xs font-bold flex justify-between border-b border-slate-800 cursor-pointer ${
                                  mIdx === acHighlightIdx
                                    ? 'bg-[var(--gold)] text-[#03060A]'
                                    : 'text-white hover:bg-slate-800'
                                }`}
                              >
                                <span className="truncate">{m.name}</span>
                                <span className="text-[10px] opacity-80 shrink-0 mr-2">{m.kindLabel}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <input
                        ref={regCell(rIdx, 'statement')}
                        type="text"
                        value={r.statement}
                        onChange={(e) =>
                          setRows((p) => p.map((x, i) => (i === rIdx ? { ...x, statement: e.target.value } : x)))
                        }
                        onKeyDown={(e) => handleKeyDown(e, rIdx, 'statement')}
                        placeholder="الشرح أو البيان..."
                        className="cell-input"
                      />
                    </td>
                    <td>
                      <input
                        ref={regCell(rIdx, 'debit')}
                        type="number"
                        min={0}
                        step="any"
                        value={r.debit}
                        onChange={(e) =>
                          setRows((p) =>
                            p.map((x, i) => (i === rIdx ? { ...x, debit: parseFloat(e.target.value) || 0 } : x))
                          )
                        }
                        onKeyDown={(e) => handleKeyDown(e, rIdx, 'debit')}
                        className="cell-input text-center font-black text-emerald-300 tabular-nums"
                      />
                    </td>
                    <td>
                      <input
                        ref={regCell(rIdx, 'credit')}
                        type="number"
                        min={0}
                        step="any"
                        value={r.credit}
                        onChange={(e) =>
                          setRows((p) =>
                            p.map((x, i) => (i === rIdx ? { ...x, credit: parseFloat(e.target.value) || 0 } : x))
                          )
                        }
                        onKeyDown={(e) => handleKeyDown(e, rIdx, 'credit')}
                        className="cell-input text-center font-black text-rose-300 tabular-nums"
                      />
                    </td>
                    <td>
                      <select
                        value={r.currency}
                        onChange={(e) =>
                          setRows((p) =>
                            p.map((x, i) => (i === rIdx ? { ...x, currency: e.target.value as CurrencyCode } : x))
                          )
                        }
                        className="cell-input text-center cursor-pointer"
                      >
                        {currencies.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={r.notes || ''}
                        onChange={(e) =>
                          setRows((p) => p.map((x, i) => (i === rIdx ? { ...x, notes: e.target.value } : x)))
                        }
                        className="cell-input"
                      />
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setRows((p) => {
                              const copy = [...p];
                              copy.splice(rIdx + 1, 0, {
                                ...r,
                                id: `lrow-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                              });
                              return copy;
                            })
                          }
                          className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={rows.length <= 1}
                          onClick={() => setRows((p) => p.filter((_, i) => i !== rIdx))}
                          className="p-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] disabled:opacity-40 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="v20-card p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRows((p) => [...p, createEmptyLedgerRow(currentCurrency.code || 'YER')])}
                className="px-3 py-1.5 rounded-lg text-xs font-black bg-[#08121E] border-2 border-[var(--gold)] text-[var(--gold)] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ إضافة صف</span>
              </button>
              <input
                type="text"
                value={generalNotes}
                onChange={(e) => setGeneralNotes(e.target.value)}
                placeholder="ملاحظة عامة للقيد..."
                className="w-60 v20-input px-3 py-1.5 text-xs"
              />
            </div>

            <div className="flex items-center gap-4 text-xs">
              <span>
                إجمالي المدين:{' '}
                <strong className="text-emerald-300 font-black tabular-nums">{totalDebit.toLocaleString()}</strong>
              </span>
              <span>
                إجمالي الدائن:{' '}
                <strong className="text-rose-300 font-black tabular-nums">{totalCredit.toLocaleString()}</strong>
              </span>
              <button
                type="button"
                onClick={handleSaveEntry}
                className="px-4 py-2 rounded-lg text-xs v20-btn-gold flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>حفظ وتثبيت في الدفتر</span>
              </button>
            </div>
          </div>

          {/* Row-by-Row Detailed Log Table */}
          <div className="v20-card p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm text-[var(--gold)]">
                السجل التفصيلي صف بصف ({currentBookObj?.nameAr || 'الكل'}) — {flattenedRows.length} حركة
              </h3>
            </div>
            <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                  <tr>
                    {columns
                      .filter((c) => c.visible)
                      .map((c) => (
                        <th key={c.key} className="p-2 border-l border-[#1B2E44]">
                          {c.label}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {flattenedRows.map((fr, idx) => (
                    <tr key={`${fr.entryId}-${idx}`} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      {columns
                        .filter((c) => c.visible)
                        .map((c) => {
                          if (c.key === 'entryNumber')
                            return (
                              <td key={c.key} className="p-2 font-mono font-bold text-[var(--gold)] border-l border-[#1B2E44]">
                                {fr.entryNumber}
                              </td>
                            );
                          if (c.key === 'date')
                            return (
                              <td key={c.key} className="p-2 tabular-nums border-l border-[#1B2E44]">
                                {fr.date}
                              </td>
                            );
                          if (c.key === 'partyName')
                            return (
                              <td key={c.key} className="p-2 font-bold border-l border-[#1B2E44]">
                                {fr.partyName}
                              </td>
                            );
                          if (c.key === 'statement')
                            return (
                              <td key={c.key} className="p-2 border-l border-[#1B2E44]">
                                {fr.statement}
                              </td>
                            );
                          if (c.key === 'debit')
                            return (
                              <td key={c.key} className="p-2 font-black text-emerald-300 tabular-nums border-l border-[#1B2E44]">
                                {fr.debit.toLocaleString()}
                              </td>
                            );
                          if (c.key === 'credit')
                            return (
                              <td key={c.key} className="p-2 font-black text-rose-300 tabular-nums border-l border-[#1B2E44]">
                                {fr.credit.toLocaleString()}
                              </td>
                            );
                          if (c.key === 'currency')
                            return (
                              <td key={c.key} className="p-2 text-center border-l border-[#1B2E44]">
                                {fr.currency}
                              </td>
                            );
                          return (
                            <td key={c.key} className="p-2 text-slate-300 border-l border-[#1B2E44]">
                              {fr.treasury}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* New Custom Book Modal */}
      {isBookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-3 text-xs">
            <h3 className="font-black text-sm text-[var(--gold)]">إنشاء دفتر يومي / مخصص جديد</h3>
            <input
              type="text"
              value={newBookName}
              onChange={(e) => setNewBookName(e.target.value)}
              placeholder="اسم الدفتر (مثال: دفتر العهد الميدانية)"
              className="w-full v20-input px-3 py-2 text-xs"
            />
            <input
              type="text"
              value={newBookDesc}
              onChange={(e) => setNewBookDesc(e.target.value)}
              placeholder="وصف الدفتر (اختياري)"
              className="w-full v20-input px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsBookModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newBookName.trim()) {
                    onNotify('error', 'أدخل اسم الدفتر.');
                    return;
                  }
                  const b: CustomLedgerBook = {
                    id: `cbook-${Date.now()}`,
                    code: `BK-${String(customBooks.length + 1).padStart(2, '0')}`,
                    nameAr: newBookName.trim(),
                    description: newBookDesc.trim() || undefined,
                    createdAt: new Date().toISOString().split('T')[0],
                  };
                  onSaveCustomBook(b);
                  setSelectedBookId(b.id);
                  setNewBookName('');
                  setNewBookDesc('');
                  setIsBookModalOpen(false);
                  onNotify('success', `تم إنشاء الدفتر "${b.nameAr}" بنجاح.`);
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                حفظ الدفتر
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalColumnCustomizer
        isOpen={isColCustOpen}
        title="تخصيص أعمدة سجل الدفاتر المخصصة"
        columns={columns}
        onChange={(updated) => onSaveColumnPrefs('v20-ledger-log', updated)}
        onReset={() => onSaveColumnPrefs('v20-ledger-log', DEFAULT_LEDGER_COLS)}
        onClose={() => setIsColCustOpen(false)}
      />

      <UniversalPreviewModal
        isOpen={Boolean(previewPayload)}
        payload={previewPayload}
        company={company}
        branch={currentBranch}
        printTemplates={printTemplates}
        onClose={() => setPreviewPayload(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
