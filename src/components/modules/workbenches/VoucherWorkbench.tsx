/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 2: Multi-Row Multi-Currency Vouchers & Treasury Transfers Workbench
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Search,
  FilePlus,
  CheckCircle2,
  Trash2,
  BookOpen,
  SlidersHorizontal,
  Eye,
  MessageCircle,
  Plus,
  Copy,
  X,
  Printer,
  FileDown,
  Landmark,
  Link2,
} from 'lucide-react';
import {
  PaymentVoucher,
  TreasuryAccount,
  TreasuryTransfer,
  Customer,
  Vendor,
  Currency,
  CurrencyCode,
  Branch,
  Company,
  User,
  DocumentBook,
  TableColumnPref,
  WhatsAppTemplates,
  Account,
  ExpenseCategory,
  PrintDocumentType,
  PrintTemplateConfig,
  Invoice,
  BankReconciliationSession,
  BankStatementRow,
} from '../../../types/erp';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  downloadBatchReportAsPDF,
  printBatchDocuments,
  renderWhatsAppTemplate,
  ReportPDFOptions,
} from '../../../services/exportService';
import { rankSearchResults } from '../../../services/searchHelpers';
import { getEffectiveCurrencyRate } from '../../../services/currencyHelpers';
import { UniversalColumnCustomizer } from '../../common/UniversalColumnCustomizer';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { DocumentBooksModal } from '../../common/DocumentBooksModal';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import { ConfirmModal } from '../../common/ConfirmModal';

type BondKind = 'RECEIPT' | 'PAYMENT' | 'TREASURY_TRANSFER';

interface BondGridRow {
  rowKey: string;
  entityType: PaymentVoucher['entityType'];
  entityId: string;
  entityName: string;
  rowCurrency: CurrencyCode;
  rowRate: number;
  amount: number;
  note: string;
  linkedInvoiceIds?: string[];
}

const DEFAULT_BOND_COLS: TableColumnPref[] = [
  { key: 'party', label: 'الطرف / الحساب / الخزينة المستلمة', visible: true, order: 0, width: 230 },
  { key: 'currency', label: 'عملة الصف', visible: true, order: 1, width: 85 },
  { key: 'rate', label: 'سعر الصرف', visible: true, order: 2, width: 85 },
  { key: 'amount', label: 'المبلغ', visible: true, order: 3, width: 115 },
  { key: 'baseEquiv', label: 'المعادل (YER)', visible: true, order: 4, width: 120 },
  { key: 'note', label: 'البيان التفصيلي', visible: true, order: 5, width: 220 },
  { key: 'prevBal', label: 'الرصيد السابق', visible: true, order: 6, width: 110 },
  { key: 'newBal', label: 'الرصيد الجديد', visible: true, order: 7, width: 110 },
];

const createEmptyBondRow = (defaultCur: CurrencyCode, defaultRate: number): BondGridRow => ({
  rowKey: `brow-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  entityType: 'عميل',
  entityId: '',
  entityName: '',
  rowCurrency: defaultCur,
  rowRate: defaultRate,
  amount: 0,
  note: '',
});

interface VoucherWorkbenchProps {
  vouchers: PaymentVoucher[];
  treasuryAccounts: TreasuryAccount[];
  treasuryTransfers: TreasuryTransfer[];
  customers: Customer[];
  vendors: Vendor[];
  invoices?: Invoice[];
  bankReconciliations?: BankReconciliationSession[];
  expenseCategories?: ExpenseCategory[];
  chartOfAccounts?: Account[];
  currencies: Currency[];
  documentBooks: DocumentBook[];
  currentBranch: Branch;
  currentCurrency: Currency;
  currentUser: User;
  company: Company;
  paymentMethods?: string[];
  whatsappTemplates?: WhatsAppTemplates;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefs?: TableColumnPref[];
  focusedRecordId?: string;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onBatchPostVouchers: (vouchers: PaymentVoucher[], opts?: { idempotencyKey?: string }) => boolean | void;
  onCancelVoucher: (voucherId: string) => void;
  onTreasuryTransfer: (transfer: TreasuryTransfer) => void;
  onSaveBankReconciliation?: (rec: BankReconciliationSession) => void;
  onSaveDocumentBook: (book: DocumentBook) => void;
  onToggleDocumentBook: (bookId: string) => void;
  onSetDefaultDocumentBook: (bookId: string) => void;
  onConsumeBookSequence: (bookId: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const VoucherWorkbench: React.FC<VoucherWorkbenchProps> = ({
  vouchers,
  treasuryAccounts,
  customers,
  vendors,
  invoices = [],
  bankReconciliations = [],
  expenseCategories = [],
  chartOfAccounts = [],
  currencies,
  documentBooks,
  currentBranch,
  currentCurrency,
  currentUser,
  company,
  paymentMethods = ['نقداً', 'شيك', 'تحويل_بنكي', 'دفع_إلكتروني'],
  whatsappTemplates,
  printTemplates,
  savedColumnPrefs,
  focusedRecordId,
  onSaveColumnPrefs,
  onBatchPostVouchers,
  onCancelVoucher,
  onTreasuryTransfer,
  onSaveBankReconciliation,
  onSaveDocumentBook,
  onToggleDocumentBook,
  onSetDefaultDocumentBook,
  onConsumeBookSequence,
  onNotify,
}) => {
  const canDeleteVoucher = currentUser.canDeleteVouchers ?? currentUser.canManageSettings;
  const canEditRates = currentUser.canEditExchangeRates ?? currentUser.canManageSettings;

  // Group vouchers by batchId so multi-row batches open together on Prev/Next navigation
  const voucherBatches = useMemo(() => {
    const groups: { batchKey: string; primary: PaymentVoucher; items: PaymentVoucher[] }[] = [];
    const map = new Map<string, PaymentVoucher[]>();
    const sorted = [...vouchers].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const v of sorted) {
      const key = v.batchId || v.id;
      const list = map.get(key) || [];
      list.push(v);
      map.set(key, list);
    }
    map.forEach((items, key) => {
      groups.push({ batchKey: key, primary: items[0], items });
    });
    return groups;
  }, [vouchers]);

  const [viewingIdx, setViewingIdx] = useState<number>(-1);
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState<string>(
    () => `idem-vch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );
  const postingLockRef = React.useRef(false);
  const [bondKind, setBondKind] = useState<BondKind>('RECEIPT');
  const [selectedBookId, setSelectedBookId] = useState<string>('');
  const [bondNumber, setBondNumber] = useState<string>('');
  const [bondDate, setBondDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [treasuryId, setTreasuryId] = useState<string>(treasuryAccounts[0]?.id || '');
  const [payMethod, setPayMethod] = useState<PaymentVoucher['paymentMethod']>('نقداً');
  const [generalNote, setGeneralNote] = useState<string>('');
  const [transferFee, setTransferFee] = useState<number>(0);

  const [rows, setRows] = useState<BondGridRow[]>(() => [
    createEmptyBondRow(currentCurrency.code || 'YER', currentCurrency.exchangeRate || 1),
    createEmptyBondRow(currentCurrency.code || 'YER', currentCurrency.exchangeRate || 1),
  ]);

  const [acRowIdx, setAcRowIdx] = useState<number | null>(null);
  const [acHighlightIdx, setAcHighlightIdx] = useState<number>(0);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [isBooksOpen, setIsBooksOpen] = useState(false);
  const [isColCustOpen, setIsColCustOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);
  const [waPayload, setWaPayload] = useState<{
    phone?: string;
    text: string;
    previewPayload?: UniversalPreviewPayload;
  } | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // Invoice Linking Modal per row
  const [allocRowIdx, setAllocRowIdx] = useState<number | null>(null);

  // Bank Reconciliation Modal
  const [isBankRecOpen, setIsBankRecOpen] = useState(false);
  const bankTreasuries = useMemo(() => {
    const banks = treasuryAccounts.filter(
      (t) => t.type === 'بنك' || t.type === 'محفظة' || t.categoryGroup === 'EXCHANGE'
    );
    return banks.length > 0 ? banks : treasuryAccounts;
  }, [treasuryAccounts]);
  const [recTreasuryId, setRecTreasuryId] = useState<string>(() => bankTreasuries[0]?.id || treasuryAccounts[0]?.id || '');
  const [recStatementDate, setRecStatementDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [recStatementBalance, setRecStatementBalance] = useState<number>(0);
  const [recMatchedVoucherIds, setRecMatchedVoucherIds] = useState<string[]>([]);
  const [recRows, setRecRows] = useState<BankStatementRow[]>([]);
  const [newBankRow, setNewBankRow] = useState({ date: new Date().toISOString().split('T')[0], reference: '', description: '', debit: 0, credit: 0 });
  const [bulkStatementPaste, setBulkStatementPaste] = useState('');

  const cellRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({});
  const regCell = (rIdx: number, col: string) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    cellRefs.current[`${rIdx}:${col}`] = el;
  };

  const columns = useMemo(() => {
    const base = savedColumnPrefs && savedColumnPrefs.length > 0 ? savedColumnPrefs : DEFAULT_BOND_COLS;
    return [...base].sort((a, b) => a.order - b.order);
  }, [savedColumnPrefs]);

  const availableBooks = useMemo(
    () => documentBooks.filter((b) => b.isActive && b.category === 'vouchers'),
    [documentBooks]
  );

  useEffect(() => {
    if (viewingIdx >= 0) return;
    const def = availableBooks.find((b) => b.isDefault) || availableBooks[0];
    if (def && !selectedBookId) setSelectedBookId(def.id);
  }, [availableBooks, selectedBookId, viewingIdx]);

  useEffect(() => {
    if (viewingIdx >= 0) return;
    const book = documentBooks.find((b) => b.id === selectedBookId);
    const prefix =
      book?.prefix || (bondKind === 'RECEIPT' ? 'REC-' : bondKind === 'PAYMENT' ? 'PAY-' : 'TRF-');
    const pad = book?.padLength || 4;
    const nums = vouchers.map((v) => v.voucherNumber);
    const computed = generateNextDocNumber(prefix, nums, pad);
    if (book && book.nextSequence) {
      const seqStr = `${prefix}${String(book.nextSequence).padStart(pad, '0')}`;
      if (!nums.includes(seqStr)) {
        const compNum = parseInt(computed.replace(prefix, ''), 10) || 0;
        setBondNumber(book.nextSequence >= compNum ? seqStr : computed);
        return;
      }
    }
    setBondNumber(computed);
  }, [selectedBookId, bondKind, vouchers, documentBooks, viewingIdx]);

  // Unified selectable targets (Customers, Vendors, Expense Categories, COA Expense/Revenue Accounts, or Treasuries for transfer)
  const partyOptions = useMemo(() => {
    if (bondKind === 'TREASURY_TRANSFER') {
      return treasuryAccounts
        .filter((t) => t.id !== treasuryId && t.status === 'active')
        .map((t) => ({
          entityType: 'أخرى' as const,
          id: t.id,
          code: t.code,
          name: t.nameAr,
          displayName: t.nameAr,
          balance: t.balance,
          currency: t.currency,
          phone: '',
        }));
    }
    const list: {
      entityType: PaymentVoucher['entityType'];
      id: string;
      code?: string;
      name: string;
      displayName: string;
      balance: number;
      currency: CurrencyCode;
      phone: string;
    }[] = [];
    customers.forEach((c) =>
      list.push({
        entityType: 'عميل',
        id: c.id,
        code: c.code,
        name: `${c.nameAr} (عميل)`,
        displayName: c.nameAr,
        balance: c.currentBalance,
        currency: c.currency || 'YER',
        phone: c.whatsapp || c.phone,
      })
    );
    vendors.forEach((v) =>
      list.push({
        entityType: 'مورد',
        id: v.id,
        code: v.code,
        name: `${v.nameAr} (مورد)`,
        displayName: v.nameAr,
        balance: v.currentBalance,
        currency: v.currency || 'YER',
        phone: v.whatsapp || v.phone,
      })
    );

    const seenAccIds = new Set<string>();
    expenseCategories.forEach((cat) => {
      if (cat.ledgerAccountId) seenAccIds.add(cat.ledgerAccountId);
      list.push({
        entityType: 'مصروف',
        id: cat.ledgerAccountId || cat.id,
        code: 'EXP',
        name: `${cat.nameAr} (بند مصروف)`,
        displayName: cat.nameAr,
        balance: 0,
        currency: currentCurrency.code || 'YER',
        phone: '',
      });
    });

    chartOfAccounts
      .filter((a) => a.isLeaf && (a.category === 'مصروفات' || a.category === 'إيرادات'))
      .forEach((a) => {
        if (seenAccIds.has(a.id)) return;
        list.push({
          entityType: a.category === 'مصروفات' ? 'مصروف' : 'إيراد',
          id: a.id,
          code: a.code,
          name: `${a.nameAr} (حساب #${a.code})`,
          displayName: a.nameAr,
          balance: a.currentBalance || 0,
          currency: a.currency || 'YER',
          phone: '',
        });
      });

    return list;
  }, [bondKind, treasuryAccounts, treasuryId, customers, vendors, expenseCategories, chartOfAccounts, currentCurrency.code]);

  const loadBatch = (idx: number) => {
    const g = voucherBatches[idx];
    if (!g) return;
    setViewingIdx(idx);
    const p = g.primary;
    setBondKind(p.type === 'قبض' ? 'RECEIPT' : 'PAYMENT');
    setSelectedBookId(p.bookId || '');
    setBondNumber(p.voucherNumber);
    setBondDate(p.date);
    setTreasuryId(p.treasuryAccountId);
    setPayMethod(p.paymentMethod);
    setGeneralNote(p.statement || '');
    setRows(
      g.items.map((v) => ({
        rowKey: v.id,
        entityType: v.entityType,
        entityId: v.entityId || '',
        entityName: v.entityName,
        rowCurrency: v.currency,
        rowRate: v.exchangeRate,
        amount: v.amount,
        note: v.statement,
        linkedInvoiceIds: v.linkedInvoiceIds || (v.linkedInvoiceId ? [v.linkedInvoiceId] : undefined),
      }))
    );
  };

  useEffect(() => {
    if (!focusedRecordId) return;
    const idx = voucherBatches.findIndex((b) => b.items.some((i) => i.id === focusedRecordId));
    if (idx >= 0) loadBatch(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRecordId]);

  const resetToNew = () => {
    setViewingIdx(-1);
    setDraftIdempotencyKey(`idem-vch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    setBondDate(new Date().toISOString().split('T')[0]);
    setGeneralNote('');
    setTransferFee(0);
    setRows([
      createEmptyBondRow(currentCurrency.code || 'YER', currentCurrency.exchangeRate || 1),
      createEmptyBondRow(currentCurrency.code || 'YER', currentCurrency.exchangeRate || 1),
    ]);
  };

  const currentBatch = viewingIdx >= 0 ? voucherBatches[viewingIdx] : null;
  const isViewMode = Boolean(currentBatch);

  const getAcMatches = (q: string) =>
    rankSearchResults(
      partyOptions,
      q,
      (o) => ({ code: o.code, id: o.id, name: o.name, phone: o.phone }),
      25
    );

  const applyPartyToRow = (rIdx: number, opt: (typeof partyOptions)[0]) => {
    const rate = getEffectiveCurrencyRate(currencies, opt.currency);
    setRows((prev) =>
      prev.map((r, i) =>
        i === rIdx
          ? {
              ...r,
              entityType: opt.entityType,
              entityId: opt.id,
              entityName: opt.displayName || opt.name.replace(/ \((عميل|مورد|بند مصروف|حساب #[^)]+)\)$/, ''),
              rowCurrency: opt.currency,
              rowRate: rate,
            }
          : r
      )
    );
    setAcRowIdx(null);
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

  const addRowAndFocus = (col: string = 'party') => {
    const nextIdx = rows.length;
    setRows((prev) => [
      ...prev,
      createEmptyBondRow(currentCurrency.code || 'YER', currentCurrency.exchangeRate || 1),
    ]);
    focusCell(nextIdx, col);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rIdx: number, col: string) => {
    if (acRowIdx === rIdx && col === 'party') {
      const matches = getAcMatches(rows[rIdx]?.entityName || '');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.min(matches.length - 1, p + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcHighlightIdx((p) => Math.max(0, p - 1));
        return;
      }
      if (e.key === 'Enter' && matches[acHighlightIdx]) {
        e.preventDefault();
        applyPartyToRow(rIdx, matches[acHighlightIdx]);
        focusCell(rIdx, 'amount');
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rIdx + 1 < rows.length) focusCell(rIdx + 1, col);
      else addRowAndFocus(col);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rIdx > 0) focusCell(rIdx - 1, col);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (col === 'party') focusCell(rIdx, 'amount');
      else if (col === 'amount') focusCell(rIdx, 'note');
      else if (col === 'note') {
        if (rIdx + 1 < rows.length) focusCell(rIdx + 1, 'party');
        else addRowAndFocus('party');
      }
    }
  };

  const totalBaseAmount = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.amount) || 0) * (Number(r.rowRate) || 1), 0),
    [rows]
  );

  const computeRowBalances = (r: BondGridRow) => {
    const match = partyOptions.find((p) => p.id === r.entityId);
    const nativeCurrency: CurrencyCode =
      match?.currency && match.currency !== 'YER'
        ? match.currency
        : r.rowCurrency !== 'YER'
        ? r.rowCurrency
        : 'YER';
    const nativeRate = getEffectiveCurrencyRate(currencies, nativeCurrency);
    const baseAmt = (Number(r.amount) || 0) * (Number(r.rowRate) || 1);

    if (bondKind === 'TREASURY_TRANSFER') {
      const prevNative = match?.balance ?? 0;
      const prevBal = Math.round(prevNative * nativeRate * 100) / 100;
      const deltaNative = nativeRate > 0 ? Math.round((baseAmt / nativeRate) * 100) / 100 : Number(r.amount) || 0;
      const newNative = Math.round((prevNative + deltaNative) * 100) / 100;
      const newBal = Math.round(newNative * nativeRate * 100) / 100;
      return { prevBal, baseAmt, newBal, nativeCurrency, nativeRate, prevNative, newNative };
    }

    const prevBal = match?.balance ?? 0;
    let delta = 0;
    if (r.entityType === 'عميل') {
      delta = bondKind === 'RECEIPT' ? -baseAmt : baseAmt;
    } else if (r.entityType === 'مورد') {
      delta = bondKind === 'PAYMENT' ? -baseAmt : baseAmt;
    }
    const newBal = prevBal + delta;
    const prevNative = Math.round((prevBal / nativeRate) * 100) / 100;
    const newNative = Math.round((newBal / nativeRate) * 100) / 100;
    return { prevBal, baseAmt, newBal, nativeCurrency, nativeRate, prevNative, newNative };
  };

  const handleSaveBatch = () => {
    if (postingLockRef.current) return;
    if (!currentUser.canPostEntries) {
      onNotify('error', 'ليس لديك صلاحية ترحيل السندات.');
      return;
    }
    postingLockRef.current = true;
    try {
    const valid = rows.filter((r) => (r.entityName.trim() || r.entityId) && r.amount > 0);
    if (valid.length === 0) {
      onNotify('error', 'أدخل صفاً واحداً على الأقل بطرف ومبلغ أكبر من صفر.');
      return;
    }

    const tr = treasuryAccounts.find((t) => t.id === treasuryId);
    if (!tr) {
      onNotify('error', 'اختر صندوقاً أو بنكاً صالحاً.');
      return;
    }

    if (bondKind === 'TREASURY_TRANSFER') {
      for (const r of valid) {
        if (!r.entityId || r.entityId === tr.id) {
          onNotify('error', 'يجب اختيار خزينة مستلمة مختلفة عن الخزينة المرسلة.');
          return;
        }
        onTreasuryTransfer({
          id: `ttr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          transferNumber: bondNumber,
          date: bondDate,
          fromTreasuryId: tr.id,
          toTreasuryId: r.entityId,
          amount: r.amount,
          currency: r.rowCurrency,
          feeAmount: transferFee,
          notes: r.note || generalNote || `مناقلة مالية من ${tr.nameAr} إلى ${r.entityName}`,
          createdBy: currentUser.fullName,
        });
      }
      if (selectedBookId) onConsumeBookSequence(selectedBookId);
      onNotify('success', `تم تنفيذ التحويل المالي بين الخزائن بنجاح.`);
      resetToNew();
      return;
    }

    const batchId = `batch-${Date.now()}`;
    const voucherList: PaymentVoucher[] = valid.map((r, idx) => ({
      id: `vch-${Date.now()}-${idx}`,
      voucherNumber: idx === 0 ? bondNumber : `${bondNumber}-${idx + 1}`,
      batchId,
      bookId: selectedBookId || undefined,
      type: bondKind === 'RECEIPT' ? 'قبض' : 'صرف',
      date: bondDate,
      branchId: currentBranch.id,
      treasuryAccountId: tr.id,
      treasuryAccountName: tr.nameAr,
      entityType: r.entityType,
      entityId: r.entityId || undefined,
      entityName: r.entityName,
      amount: r.amount,
      currency: r.rowCurrency,
      exchangeRate: r.rowRate,
      baseAmount: r.amount * r.rowRate,
      linkedInvoiceId: r.linkedInvoiceIds?.[0],
      linkedInvoiceIds: r.linkedInvoiceIds,
      paymentMethod: payMethod,
      statement: r.note || generalNote || `سند ${bondKind === 'RECEIPT' ? 'قبض' : 'صرف'} رقم ${bondNumber}`,
      status: 'posted',
      idempotencyKey: draftIdempotencyKey,
      receivedOrPaidBy: currentUser.fullName,
      createdBy: currentUser.fullName,
      createdAt: new Date().toISOString(),
    }));

    const postedOk = onBatchPostVouchers(voucherList, { idempotencyKey: draftIdempotencyKey });
    if (postedOk === false) return;
    if (selectedBookId) onConsumeBookSequence(selectedBookId);
    onNotify('success', `تم ترحيل السند الجماعي (${voucherList.length} صفوف) وتحديث الصناديق والذمم والقيود.`);
    resetToNew();
    } finally {
      postingLockRef.current = false;
    }
  };

  const buildPreviewPayload = (): UniversalPreviewPayload => {
    const trName = treasuryAccounts.find((t) => t.id === treasuryId)?.nameAr || '';
    const valid = rows.filter((r) => r.entityName.trim() && r.amount > 0);
    const kindAr =
      bondKind === 'RECEIPT' ? 'سند قبض متعدد الصفوف' : bondKind === 'PAYMENT' ? 'سند صرف متعدد الصفوف' : 'مناقلة مالية بين الخزائن';

    const firstRow = valid[0];
    const firstPhone = partyOptions.find((p) => p.id === firstRow?.entityId)?.phone;
    const singleVoucherObj: PaymentVoucher | undefined =
      valid.length === 1 && bondKind !== 'TREASURY_TRANSFER'
        ? {
            id: currentBatch?.primary.id || 'prev',
            voucherNumber: bondNumber,
            type: bondKind === 'RECEIPT' ? 'قبض' : 'صرف',
            date: bondDate,
            branchId: currentBranch.id,
            treasuryAccountId: treasuryId,
            treasuryAccountName: trName,
            entityType: firstRow.entityType,
            entityId: firstRow.entityId,
            entityName: firstRow.entityName,
            amount: firstRow.amount,
            currency: firstRow.rowCurrency,
            exchangeRate: firstRow.rowRate,
            baseAmount: firstRow.amount * firstRow.rowRate,
            paymentMethod: payMethod,
            statement: firstRow.note || generalNote || kindAr,
            status: 'posted',
            receivedOrPaidBy: currentUser.fullName,
            createdBy: currentUser.fullName,
            createdAt: new Date().toISOString(),
          }
        : undefined;

    const waMsg = whatsappTemplates?.voucher && singleVoucherObj
      ? renderWhatsAppTemplate(whatsappTemplates.voucher, {
          customerName: singleVoucherObj.entityName,
          voucherNumber: bondNumber,
          voucherType: singleVoucherObj.type === 'قبض' ? 'سند قبض' : 'سند صرف',
          date: bondDate,
          amount: `${singleVoucherObj.amount.toLocaleString()} ${singleVoucherObj.currency}`,
          statement: singleVoucherObj.statement,
          companyName: company.nameAr,
        })
      : `${company.nameAr}\n${kindAr} رقم: ${bondNumber}\nالتاريخ: ${bondDate}\nالخزينة: ${trName}\nالإجمالي بالأساس: ${totalBaseAmount.toLocaleString()} YER`;

    return {
      title: `${kindAr} رقم ${bondNumber}`,
      periodText: `التاريخ: ${bondDate}`,
      docType: 'voucher',
      metadata: {
        الصندوق_الرئيسي: trName,
        وسيلة_الدفع: payMethod,
        المحرر: currentUser.fullName,
      },
      tables: [
        {
          headers: ['#', 'الطرف / الخزينة', 'العملة', 'سعر الصرف', 'المبلغ', 'المعادل (YER)', 'البيان'],
          rows: valid.map((r, i) => [
            i + 1,
            r.entityName,
            r.rowCurrency,
            r.rowRate,
            r.amount.toLocaleString(),
            (r.amount * r.rowRate).toLocaleString(),
            r.note || generalNote,
          ]),
          totals: ['-', 'الإجمالي بالعملة الأساسية', '', '', '', `${totalBaseAmount.toLocaleString()} YER`, ''],
        },
      ],
      notes: generalNote,
      whatsappText: waMsg,
      defaultPhone: firstPhone,
      voucherObj: singleVoucherObj,
      bluetoothLines: [
        company.nameAr,
        `${kindAr}: ${bondNumber}`,
        `Date: ${bondDate}`,
        `Treasury: ${trName}`,
        ...valid.map((r) => `${r.entityName}: ${r.amount} ${r.rowCurrency}`),
        `TOTAL YER: ${totalBaseAmount}`,
      ],
    };
  };

  return (
    <div className="space-y-3" dir="rtl">
      {/* Toolbar */}
      <div className="v20-doc-toolbar">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            disabled={voucherBatches.length === 0 || viewingIdx === 0}
            onClick={() => {
              const nextIdx = viewingIdx === -1 ? voucherBatches.length - 1 : Math.max(0, viewingIdx - 1);
              loadBatch(nextIdx);
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span>السند السابق</span>
          </button>

          <button
            type="button"
            disabled={viewingIdx === -1}
            onClick={() => {
              if (viewingIdx + 1 < voucherBatches.length) loadBatch(viewingIdx + 1);
              else resetToNew();
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)] disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          >
            <span>السند التالي</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setIsSearchOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--info)] text-[var(--info)] hover:bg-[var(--info)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>بحث في السندات ({vouchers.length})</span>
          </button>

          <button
            type="button"
            onClick={resetToNew}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] flex items-center gap-1 cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
            <span>+ سند جديد (صفوف)</span>
          </button>

          {currentBatch && (
            <span className="px-2.5 py-1 rounded text-xs font-black bg-sky-950/60 border border-sky-500 text-sky-300">
              عرض السند {viewingIdx + 1} من {voucherBatches.length} · {currentBatch.primary.status === 'cancelled' ? 'ملغى' : 'مرحّل'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setIsBankRecOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-sky-500/70 text-sky-300 hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>التسوية البنكية ({bankReconciliations.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBooksOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>دفاتر السندات</span>
          </button>

          <button
            type="button"
            onClick={() => setIsColCustOpen(true)}
            className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white flex items-center gap-1 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>تخصيص الأعمدة</span>
          </button>

          <button
            type="button"
            onClick={() => setPreviewPayload(buildPreviewPayload())}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>معاينة / طباعة / PDF</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const p = buildPreviewPayload();
              setWaPayload({ phone: p.defaultPhone, text: p.whatsappText, previewPayload: p });
            }}
            className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0B2B17] border border-[#25D366] text-[#25D366] flex items-center gap-1 cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>واتساب (صورة / PDF)</span>
          </button>

          {currentBatch && currentBatch.primary.status !== 'cancelled' && canDeleteVoucher && (
            <button
              type="button"
              onClick={() => setConfirmCancelOpen(true)}
              className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] flex items-center gap-1 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>إلغاء وعكس</span>
            </button>
          )}
        </div>
      </div>

      {/* Voucher Header Controls */}
      <div className="v20-card p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
        <div className="lg:col-span-2">
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">نوع العملية</label>
          <select
            disabled={isViewMode}
            value={bondKind}
            onChange={(e) => setBondKind(e.target.value as BondKind)}
            className="w-full v20-input px-2.5 py-1.5 text-xs cursor-pointer"
          >
            <option value="RECEIPT">سند قبض (متعدد الصفوف والعملات)</option>
            <option value="PAYMENT">سند صرف (متعدد الصفوف والعملات)</option>
            <option value="TREASURY_TRANSFER">مناقلة مالية بين الصناديق وشركات الصرافة</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">دفتر السندات</label>
          <select
            disabled={isViewMode}
            value={selectedBookId}
            onChange={(e) => setSelectedBookId(e.target.value)}
            className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
          >
            {availableBooks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nameAr}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">رقم السند</label>
          <input
            type="text"
            disabled={isViewMode}
            value={bondNumber}
            onChange={(e) => setBondNumber(e.target.value)}
            className="w-full v20-input px-2 py-1.5 text-xs font-mono text-center text-[var(--gold)]"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">التاريخ</label>
          <input
            type="date"
            disabled={isViewMode}
            value={bondDate}
            onChange={(e) => setBondDate(e.target.value)}
            className="w-full v20-input px-2 py-1.5 text-xs tabular-nums"
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
            {bondKind === 'TREASURY_TRANSFER' ? 'من صندوق / صراف' : 'الخزينة الرئيسية'}
          </label>
          <select
            disabled={isViewMode}
            value={treasuryId}
            onChange={(e) => setTreasuryId(e.target.value)}
            className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
          >
            {treasuryAccounts.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameAr} ({t.currency})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">
            {bondKind === 'TREASURY_TRANSFER' ? 'رسوم التحويل' : 'طريقة الدفع'}
          </label>
          {bondKind === 'TREASURY_TRANSFER' ? (
            <input
              type="number"
              min={0}
              disabled={isViewMode}
              value={transferFee}
              onChange={(e) => setTransferFee(parseFloat(e.target.value) || 0)}
              className="w-full v20-input px-2 py-1.5 text-xs text-center tabular-nums"
            />
          ) : (
            <select
              disabled={isViewMode}
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentVoucher['paymentMethod'])}
              className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
            >
              {paymentMethods.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Multi-Row Spreadsheet Grid */}
      <div className="erp-grid-wrap">
        <table className="erp-grid">
          <thead>
            <tr>
              <th style={{ width: '36px' }}>#</th>
              {columns
                .filter((c) => c.visible)
                .map((col) => (
                  <th key={col.key} style={{ width: col.width ? `${col.width}px` : undefined }}>
                    {col.label}
                  </th>
                ))}
              <th style={{ width: '80px' }}>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rIdx) => {
              const { prevBal, baseAmt, newBal, nativeCurrency, nativeRate, prevNative, newNative } = computeRowBalances(r);
              const matches = acRowIdx === rIdx ? getAcMatches(r.entityName) : [];

              return (
                <tr key={r.rowKey}>
                  <td className="text-center font-bold text-slate-400 tabular-nums">{rIdx + 1}</td>

                  {columns
                    .filter((c) => c.visible)
                    .map((col) => {
                      if (col.key === 'party') {
                        return (
                          <td key={col.key} className="relative">
                            <input
                              ref={regCell(rIdx, 'party')}
                              type="text"
                              disabled={isViewMode}
                              value={r.entityName}
                              onFocus={() => {
                                setAcRowIdx(rIdx);
                                setAcHighlightIdx(0);
                              }}
                              onChange={(e) => {
                                setAcRowIdx(rIdx);
                                setAcHighlightIdx(0);
                                const val = e.target.value;
                                setRows((prev) =>
                                  prev.map((x, i) => (i === rIdx ? { ...x, entityName: val, entityId: '' } : x))
                                );
                              }}
                              onBlur={() => setTimeout(() => setAcRowIdx((cur) => (cur === rIdx ? null : cur)), 180)}
                              onKeyDown={(e) => handleKeyDown(e, rIdx, 'party')}
                              placeholder="ابحث أو اختر الطرف..."
                              className="cell-input font-bold"
                            />
                            {acRowIdx === rIdx && matches.length > 0 && (
                              <div className="grid-autocomplete-menu top-full right-0 w-72">
                                {matches.map((opt, mIdx) => (
                                  <button
                                    key={`${opt.entityType}-${opt.id}`}
                                    type="button"
                                    onMouseDown={() => {
                                      applyPartyToRow(rIdx, opt);
                                      focusCell(rIdx, 'amount');
                                    }}
                                    className={`w-full text-right px-2.5 py-1.5 text-xs font-bold flex justify-between border-b border-slate-800 cursor-pointer ${
                                      mIdx === acHighlightIdx
                                        ? 'bg-[var(--gold)] text-[#03060A]'
                                        : 'text-white hover:bg-slate-800'
                                    }`}
                                  >
                                    <span>{opt.name}</span>
                                    <span className="text-[10px] opacity-90 tabular-nums">
                                      {opt.currency !== 'YER'
                                        ? bondKind === 'TREASURY_TRANSFER'
                                          ? `${opt.balance.toLocaleString()} ${opt.currency === 'SAR' ? 'ر.س' : opt.currency}`
                                          : `${(Math.round((opt.balance / getEffectiveCurrencyRate(currencies, opt.currency)) * 100) / 100).toLocaleString()} ${opt.currency === 'SAR' ? 'ر.س' : opt.currency} (${opt.balance.toLocaleString()} ر.ي)`
                                        : `${opt.balance.toLocaleString()} ر.ي`}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      }

                      if (col.key === 'currency') {
                        return (
                          <td key={col.key}>
                            <select
                              ref={regCell(rIdx, 'currency')}
                              disabled={isViewMode}
                              value={r.rowCurrency}
                              onChange={(e) => {
                                const code = e.target.value as CurrencyCode;
                                const nextRate = getEffectiveCurrencyRate(currencies, code);
                                setRows((prev) =>
                                  prev.map((x, i) =>
                                    i === rIdx
                                      ? { ...x, rowCurrency: code, rowRate: nextRate }
                                      : x
                                  )
                                );
                              }}
                              className="cell-input text-center cursor-pointer"
                            >
                              {currencies.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {c.code}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      }

                      if (col.key === 'rate') {
                        return (
                          <td key={col.key}>
                            <input
                              ref={regCell(rIdx, 'rate')}
                              type="number"
                              step="0.01"
                              disabled={isViewMode || !canEditRates}
                              value={r.rowRate}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((x, i) =>
                                    i === rIdx ? { ...x, rowRate: parseFloat(e.target.value) || 1 } : x
                                  )
                                )
                              }
                              className="cell-input text-center tabular-nums"
                            />
                          </td>
                        );
                      }

                      if (col.key === 'amount') {
                        return (
                          <td key={col.key}>
                            <input
                              ref={regCell(rIdx, 'amount')}
                              type="number"
                              min={0}
                              step="any"
                              disabled={isViewMode}
                              value={r.amount}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((x, i) =>
                                    i === rIdx ? { ...x, amount: parseFloat(e.target.value) || 0 } : x
                                  )
                                )
                              }
                              onKeyDown={(e) => handleKeyDown(e, rIdx, 'amount')}
                              className="cell-input text-center font-black text-emerald-300 tabular-nums"
                            />
                          </td>
                        );
                      }

                      if (col.key === 'baseEquiv') {
                        return (
                          <td key={col.key} className="px-2 text-center font-bold text-[var(--gold)] tabular-nums">
                            {baseAmt.toLocaleString()}
                          </td>
                        );
                      }

                      if (col.key === 'note') {
                        return (
                          <td key={col.key}>
                            <input
                              ref={regCell(rIdx, 'note')}
                              type="text"
                              disabled={isViewMode}
                              value={r.note}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((x, i) => (i === rIdx ? { ...x, note: e.target.value } : x))
                                )
                              }
                              onKeyDown={(e) => handleKeyDown(e, rIdx, 'note')}
                              placeholder="بيان السند..."
                              className="cell-input"
                            />
                          </td>
                        );
                      }

                      if (col.key === 'prevBal') {
                        return (
                          <td key={col.key} className="px-2 text-center text-slate-300 tabular-nums">
                            {!r.entityId ? (
                              '-'
                            ) : nativeCurrency !== 'YER' ? (
                              <div className="leading-tight">
                                <div className="text-emerald-300 font-bold">
                                  {prevNative.toLocaleString()} {nativeCurrency === 'SAR' ? 'ر.س' : nativeCurrency}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {prevBal.toLocaleString()} ر.ي (×{nativeRate})
                                </div>
                              </div>
                            ) : (
                              `${prevBal.toLocaleString()} ر.ي`
                            )}
                          </td>
                        );
                      }

                      return (
                        <td key={col.key} className="px-2 text-center font-black text-sky-300 tabular-nums">
                          {!r.entityId ? (
                            '-'
                          ) : nativeCurrency !== 'YER' ? (
                            <div className="leading-tight">
                              <div className="text-emerald-300">
                                {newNative.toLocaleString()} {nativeCurrency === 'SAR' ? 'ر.س' : nativeCurrency}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {newBal.toLocaleString()} ر.ي
                              </div>
                            </div>
                          ) : (
                            `${newBal.toLocaleString()} ر.ي`
                          )}
                        </td>
                      );
                    })}

                  <td className="px-1">
                    <div className="flex items-center justify-center gap-1">
                      {(r.entityType === 'عميل' || r.entityType === 'مورد') && r.entityId && invoices.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setAllocRowIdx(rIdx)}
                          title="ربط بفواتير العميل/المورد المفتوحة"
                          className={`p-1 rounded border cursor-pointer relative ${
                            r.linkedInvoiceIds && r.linkedInvoiceIds.length > 0
                              ? 'bg-emerald-950/70 border-emerald-500 text-emerald-300'
                              : 'bg-[#08121E] border-[var(--border-strong)] text-amber-300'
                          }`}
                        >
                          <Link2 className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isViewMode}
                        onClick={() =>
                          setRows((prev) => {
                            const copy = [...prev];
                            copy.splice(rIdx + 1, 0, {
                              ...r,
                              rowKey: `brow-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                            });
                            return copy;
                          })
                        }
                        title="تكرار الصف"
                        className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 disabled:opacity-40 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={isViewMode || rows.length <= 1}
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== rIdx))}
                        title="حذف الصف"
                        className="p-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] disabled:opacity-40 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom Summary & Post Bar */}
      <div className="v20-card p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {!isViewMode && (
            <button
              type="button"
              onClick={() => addRowAndFocus('party')}
              className="px-3 py-1.5 rounded-lg text-xs font-black bg-[#08121E] border-2 border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ إضافة صف سند</span>
            </button>
          )}
          <input
            type="text"
            disabled={isViewMode}
            value={generalNote}
            onChange={(e) => setGeneralNote(e.target.value)}
            placeholder="ملاحظة عامة للسند..."
            className="w-64 v20-input px-3 py-1.5 text-xs"
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {(() => {
            const activeTr = treasuryAccounts.find((t) => t.id === treasuryId);
            if (!activeTr) return null;
            const trRate = getEffectiveCurrencyRate(currencies, activeTr.currency);
            const deltaInTr = trRate > 0 ? Math.round((totalBaseAmount / trRate) * 100) / 100 : totalBaseAmount;
            const afterTrBal =
              bondKind === 'RECEIPT'
                ? activeTr.balance + deltaInTr
                : activeTr.balance - deltaInTr - (bondKind === 'TREASURY_TRANSFER' ? transferFee : 0);
            return (
              <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-[11px] flex items-center gap-3">
                <div>
                  <span className="text-slate-400">رصيد الخزينة قبل: </span>
                  <strong className="text-white tabular-nums">
                    {activeTr.balance.toLocaleString()} {activeTr.currency}
                  </strong>
                </div>
                <span className="text-slate-600">|</span>
                <div>
                  <span className="text-slate-400">بعد السند: </span>
                  <strong className="text-emerald-300 tabular-nums">
                    {Math.round(afterTrBal * 100) / 100} {activeTr.currency}
                  </strong>
                </div>
              </div>
            );
          })()}

          <div className="text-left">
            <span className="text-xs text-[var(--text-secondary)] block">إجمالي السند بالأساس (YER):</span>
            <span className="text-lg font-black text-[var(--gold)] tabular-nums">
              {totalBaseAmount.toLocaleString()} YER
            </span>
          </div>

          {!isViewMode && (
            <button
              type="button"
              onClick={handleSaveBatch}
              className="px-5 py-2.5 rounded-lg text-sm v20-btn-gold flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>ترحيل وحفظ السند</span>
            </button>
          )}
        </div>
      </div>

      {/* Vouchers Search Modal */}
      {isSearchOpen && (() => {
        const filteredVouchers = rankSearchResults(
          vouchers,
          searchText,
          (v) => ({ code: v.voucherNumber, id: v.id, name: `${v.entityName} ${v.statement}` }),
          300
        );
        const buildBatchVoucherDocs = (): ReportPDFOptions[] =>
          filteredVouchers
            .filter((v) => v.status !== 'cancelled')
            .slice(0, 80)
            .map((v) => ({
              docType: 'voucher',
              printTemplates,
              title: v.type === 'قبض' ? `سند قبض مالي #${v.voucherNumber}` : `سند صرف مالي #${v.voucherNumber}`,
              subtitle: `${v.entityType}: ${v.entityName}`,
              reportCode: v.voucherNumber,
              periodText: v.date,
              company,
              branch: currentBranch,
              preparedBy: v.createdBy || currentUser.fullName,
              notes: v.statement,
              metadata: {
                'رقم السند': v.voucherNumber,
                'نوع السند': v.type === 'قبض' ? 'سند قبض' : 'سند صرف',
                'التاريخ': v.date,
                'الطرف / الحساب': `${v.entityType} - ${v.entityName}`,
                'الخزينة / البنك': v.treasuryAccountName,
                'طريقة الدفع': v.paymentMethod.replace(/_/g, ' '),
                'العملة وسعر الصرف': `${v.currency} (${v.exchangeRate})`,
              },
              tables: [
                {
                  title: 'بيانات القيمة المالية للسند',
                  headers: ['رقم السند', 'البيان', 'المبلغ بالعملة', 'المعادل بالأساس (YER)', 'المرجع'],
                  rows: [
                    [
                      v.voucherNumber,
                      v.statement || '-',
                      `${v.amount.toLocaleString()} ${v.currency}`,
                      `${v.baseAmount.toLocaleString()} YER`,
                      v.linkedInvoiceNumber || v.checkNumber || v.transferReference || '-',
                    ],
                  ],
                },
              ],
            }));
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-[3px] border-[var(--gold)] rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-[#071019] border-b-2 border-[var(--gold)] flex flex-wrap justify-between items-center gap-2">
              <span className="font-black text-[var(--gold)] text-sm">
                البحث في سندات القبض والصرف ({filteredVouchers.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const docs = buildBatchVoucherDocs();
                    if (docs.length === 0) {
                      onNotify('error', 'لا توجد سندات معتمدة للطباعة الجماعية.');
                      return;
                    }
                    printBatchDocuments(docs);
                    onNotify('info', `تم تجهيز طباعة دفعة مكونة من ${docs.length} سند.`);
                  }}
                  className="px-2.5 py-1 rounded bg-[var(--gold)] text-[#03060A] text-xs font-black flex items-center gap-1 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة دفعة السندات</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const docs = buildBatchVoucherDocs();
                    if (docs.length === 0) {
                      onNotify('error', 'لا توجد سندات معتمدة للتصدير.');
                      return;
                    }
                    void downloadBatchReportAsPDF(docs, `دفعة_السندات_${new Date().toISOString().slice(0, 10)}`);
                    onNotify('success', `تم إنشاء ملف PDF موحد لـ ${docs.length} سند.`);
                  }}
                  className="px-2.5 py-1 rounded bg-[var(--info)] text-[#03060A] text-xs font-black flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>دفعة PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className="px-2.5 py-1 rounded bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] text-xs font-bold cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
            <div className="p-3 border-b border-[var(--border-strong)]">
              <input
                type="text"
                autoFocus
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="ابحث برقم السند أو اسم العميل/المورد أو البيان..."
                className="w-full v20-input px-3 py-2 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                  <tr>
                    <th className="p-2">رقم السند</th>
                    <th className="p-2">النوع</th>
                    <th className="p-2">التاريخ</th>
                    <th className="p-2">الطرف</th>
                    <th className="p-2 text-center">المبلغ</th>
                    <th className="p-2">البيان</th>
                    <th className="p-2 text-center">عرض</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVouchers.map((v) => {
                      const bIdx = voucherBatches.findIndex((b) => b.items.some((x) => x.id === v.id));
                      return (
                        <tr key={v.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                          <td className="p-2 font-mono font-bold text-[var(--gold)]">{v.voucherNumber}</td>
                          <td className="p-2 font-bold">{v.type === 'قبض' ? 'سند قبض' : 'سند صرف'}</td>
                          <td className="p-2 tabular-nums">{v.date}</td>
                          <td className="p-2 font-bold">{v.entityName}</td>
                          <td className="p-2 text-center font-black tabular-nums">
                            {v.amount.toLocaleString()} {v.currency}
                          </td>
                          <td className="p-2 truncate max-w-[180px]">{v.statement}</td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                if (bIdx >= 0) loadBatch(bIdx);
                                setIsSearchOpen(false);
                              }}
                              className="px-2.5 py-1 rounded bg-[var(--gold)] text-[#03060A] font-black cursor-pointer"
                            >
                              عرض
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      <DocumentBooksModal
        isOpen={isBooksOpen}
        books={documentBooks}
        filterCategory="vouchers"
        onSaveBook={onSaveDocumentBook}
        onToggleBookActive={onToggleDocumentBook}
        onSetDefaultBook={onSetDefaultDocumentBook}
        onClose={() => setIsBooksOpen(false)}
        onNotify={onNotify}
      />

      <UniversalColumnCustomizer
        isOpen={isColCustOpen}
        title="تخصيص أعمدة جدول السندات"
        columns={columns}
        onChange={(updated) => onSaveColumnPrefs('v20-bond-grid', updated)}
        onReset={() => onSaveColumnPrefs('v20-bond-grid', DEFAULT_BOND_COLS)}
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

      <WhatsAppShareModal
        isOpen={Boolean(waPayload)}
        title={`مشاركة السند ${bondNumber} عبر واتساب`}
        defaultPhone={waPayload?.phone}
        defaultMessage={waPayload?.text || ''}
        previewPayload={waPayload?.previewPayload}
        company={company}
        branch={currentBranch}
        onClose={() => setWaPayload(null)}
        onNotify={onNotify}
      />

      <ConfirmModal
        isOpen={confirmCancelOpen}
        title="إلغاء وعكس السند"
        variant="danger"
        message="سيتم إلغاء جميع صفوف هذا السند وعكس أثرها من الصندوق والذمم والقيد المحاسبي. هل تريد التأكيد؟"
        confirmLabel="نعم، إلغاء وعكس"
        onConfirm={() => {
          if (currentBatch) {
            currentBatch.items.forEach((v) => {
              if (v.status !== 'cancelled') onCancelVoucher(v.id);
            });
          }
          setConfirmCancelOpen(false);
          resetToNew();
        }}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      {/* Invoice Allocation Modal */}
      {allocRowIdx !== null && rows[allocRowIdx] && (() => {
        const targetRow = rows[allocRowIdx];
        const openInvoices = invoices.filter(
          (inv) =>
            inv.entityId === targetRow.entityId &&
            inv.status !== 'cancelled' &&
            inv.remainingAmount > 0
        );
        const selectedIds = new Set(targetRow.linkedInvoiceIds || []);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
            <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
                <h3 className="font-black text-sm text-[var(--gold)] flex items-center gap-1.5">
                  <Link2 className="w-4 h-4" />
                  <span>ربط السند بفواتير: {targetRow.entityName}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setAllocRowIdx(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {openInvoices.length === 0 ? (
                <div className="p-6 text-center text-slate-400">
                  لا توجد فواتير مفتوحة برصيد متبقٍ لهذا الطرف حالياً.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-[var(--border-strong)] rounded-lg">
                  <table className="w-full text-right border-collapse">
                    <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                      <tr>
                        <th className="p-2 text-center">اختيار</th>
                        <th className="p-2">رقم الفاتورة</th>
                        <th className="p-2">التاريخ</th>
                        <th className="p-2">الإجمالي</th>
                        <th className="p-2">المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openInvoices.map((inv) => {
                        const checked = selectedIds.has(inv.id);
                        return (
                          <tr key={inv.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isViewMode}
                                onChange={(e) => {
                                  const next = new Set(selectedIds);
                                  if (e.target.checked) next.add(inv.id);
                                  else next.delete(inv.id);
                                  const arr = Array.from(next);
                                  setRows((prev) =>
                                    prev.map((x, idx) =>
                                      idx === allocRowIdx ? { ...x, linkedInvoiceIds: arr } : x
                                    )
                                  );
                                }}
                                className="accent-[var(--gold)] cursor-pointer"
                              />
                            </td>
                            <td className="p-2 font-mono font-bold text-[var(--gold)]">{inv.invoiceNumber}</td>
                            <td className="p-2 tabular-nums">{inv.date}</td>
                            <td className="p-2 tabular-nums">{inv.grandTotal.toLocaleString()} {inv.currency}</td>
                            <td className="p-2 font-black text-rose-300 tabular-nums">
                              {inv.remainingAmount.toLocaleString()} {inv.currency}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border-strong)]">
                <span className="text-slate-400">
                  عدد الفواتير المرتبطة: <strong className="text-emerald-300">{selectedIds.size}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setAllocRowIdx(null)}
                  className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
                >
                  تأكيد وإغلاق
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bank Reconciliation Modal */}
      {isBankRecOpen && (() => {
        const activeBankTr = treasuryAccounts.find((t) => t.id === recTreasuryId) || bankTreasuries[0];
        const bookBal = activeBankTr?.balance || 0;
        const bankVouchers = vouchers.filter(
          (v) => v.status === 'posted' && (!activeBankTr || v.treasuryAccountId === activeBankTr.id)
        );
        const matchedVouchersSum = bankVouchers
          .filter((v) => recMatchedVoucherIds.includes(v.id))
          .reduce((s, v) => s + (v.type === 'قبض' ? v.amount : -v.amount), 0);
        const unmatchedVouchers = bankVouchers.filter((v) => !recMatchedVoucherIds.includes(v.id));
        const rowsNet = recRows.reduce((s, r) => s + (Number(r.credit) || 0) - (Number(r.debit) || 0), 0);
        const effectiveStatementBal = recStatementBalance || rowsNet;
        const diff = Math.round((bookBal - effectiveStatementBal) * 100) / 100;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
            <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden text-xs">
              <div className="px-4 py-3 bg-[#071019] border-b border-[var(--gold)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-[var(--gold)]" />
                  <h3 className="font-black text-sm text-[var(--gold)]">
                    التسوية البنكية ومطابقة كشف الحساب المصرفي
                  </h3>
                </div>
                <button type="button" onClick={() => setIsBankRecOpen(false)} className="text-slate-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-[#060D15] p-3 rounded-lg border border-[var(--border-strong)]">
                  <div>
                    <label className="block text-slate-400 mb-1 font-bold">الحساب البنكي / الصراف</label>
                    <select
                      value={recTreasuryId}
                      onChange={(e) => {
                        setRecTreasuryId(e.target.value);
                        setRecMatchedVoucherIds([]);
                      }}
                      className="w-full v20-input px-2.5 py-1.5"
                    >
                      {bankTreasuries.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nameAr} ({t.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-bold">تاريخ الكشف</label>
                    <input
                      type="date"
                      value={recStatementDate}
                      onChange={(e) => setRecStatementDate(e.target.value)}
                      className="w-full v20-input px-2.5 py-1.5 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1 font-bold">رصيد كشف البنك الختامي</label>
                    <input
                      type="number"
                      step="any"
                      value={recStatementBalance}
                      onChange={(e) => setRecStatementBalance(parseFloat(e.target.value) || 0)}
                      className="w-full v20-input px-2.5 py-1.5 font-mono text-amber-300"
                    />
                  </div>
                  <div className="flex flex-col justify-center bg-[#08121E] px-3 py-1.5 rounded border border-[#1B2E44]">
                    <span className="text-slate-400">الرصيد الدفتري: <strong className="text-white tabular-nums">{bookBal.toLocaleString()} {activeBankTr?.currency || ''}</strong></span>
                    <span className={Math.abs(diff) < 0.01 ? 'text-emerald-300 font-black' : 'text-rose-300 font-black'}>
                      فارق التسوية: {diff.toLocaleString()} {activeBankTr?.currency || ''}
                    </span>
                  </div>
                </div>

                {/* Add / Paste Bank Statement Lines */}
                <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2">
                  <div className="font-black text-[var(--gold)]">بنود كشف الحساب البنكي ({recRows.length})</div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                    <input
                      type="date"
                      value={newBankRow.date}
                      onChange={(e) => setNewBankRow({ ...newBankRow, date: e.target.value })}
                      className="v20-input px-2 py-1"
                    />
                    <input
                      type="text"
                      value={newBankRow.reference}
                      onChange={(e) => setNewBankRow({ ...newBankRow, reference: e.target.value })}
                      placeholder="المرجع"
                      className="v20-input px-2 py-1"
                    />
                    <input
                      type="text"
                      value={newBankRow.description}
                      onChange={(e) => setNewBankRow({ ...newBankRow, description: e.target.value })}
                      placeholder="البيان المصرفي"
                      className="v20-input px-2 py-1"
                    />
                    <input
                      type="number"
                      placeholder="منصرف (مدين)"
                      value={newBankRow.debit || ''}
                      onChange={(e) => setNewBankRow({ ...newBankRow, debit: parseFloat(e.target.value) || 0 })}
                      className="v20-input px-2 py-1"
                    />
                    <input
                      type="number"
                      placeholder="إيداع (دائن)"
                      value={newBankRow.credit || ''}
                      onChange={(e) => setNewBankRow({ ...newBankRow, credit: parseFloat(e.target.value) || 0 })}
                      className="v20-input px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newBankRow.description.trim() && newBankRow.debit === 0 && newBankRow.credit === 0) return;
                        setRecRows((prev) => [
                          ...prev,
                          { id: `bs-${Date.now()}`, ...newBankRow },
                        ]);
                        setNewBankRow({ date: recStatementDate, reference: '', description: '', debit: 0, credit: 0 });
                      }}
                      className="v20-btn-gold rounded px-2 py-1 font-black cursor-pointer"
                    >
                      + إضافة بند
                    </button>
                  </div>

                  <div className="flex gap-2 items-center pt-1">
                    <input
                      type="text"
                      value={bulkStatementPaste}
                      onChange={(e) => setBulkStatementPaste(e.target.value)}
                      placeholder="لصق سريع: تاريخ,مرجع,بيان,مدين,دائن (سطر أو فاصلة منقوطة)"
                      className="flex-1 v20-input px-2.5 py-1"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const lines = bulkStatementPaste.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
                        const parsed: BankStatementRow[] = lines.map((ln, idx) => {
                          const parts = ln.split(',').map((p) => p.trim());
                          return {
                            id: `bs-p-${Date.now()}-${idx}`,
                            date: parts[0] || recStatementDate,
                            reference: parts[1] || `REF-${idx + 1}`,
                            description: parts[2] || 'حركة كشف بنكي',
                            debit: parseFloat(parts[3] || '0') || 0,
                            credit: parseFloat(parts[4] || '0') || 0,
                          };
                        });
                        if (parsed.length > 0) {
                          setRecRows((prev) => [...prev, ...parsed]);
                          setBulkStatementPaste('');
                        }
                      }}
                      className="px-3 py-1 rounded bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] font-bold cursor-pointer"
                    >
                      استيراد البنود
                    </button>
                  </div>
                </div>

                {/* Matching Posted Bank Vouchers */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="border border-[var(--border-strong)] rounded-lg overflow-hidden">
                    <div className="bg-[#0B192C] px-3 py-2 font-black text-[var(--gold)] flex justify-between">
                      <span>السندات المرحلة على الحساب ({bankVouchers.length})</span>
                      <span className="text-emerald-300">المطابقة: {recMatchedVoucherIds.length} (صافي {matchedVouchersSum.toLocaleString()})</span>
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      <table className="w-full text-right border-collapse">
                        <tbody>
                          {bankVouchers.map((v) => {
                            const matched = recMatchedVoucherIds.includes(v.id);
                            return (
                              <tr key={v.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                                <td className="p-2 text-center w-8">
                                  <input
                                    type="checkbox"
                                    checked={matched}
                                    onChange={(e) => {
                                      setRecMatchedVoucherIds((prev) =>
                                        e.target.checked ? [...prev, v.id] : prev.filter((id) => id !== v.id)
                                      );
                                    }}
                                    className="accent-[var(--gold)] cursor-pointer"
                                  />
                                </td>
                                <td className="p-2 font-mono text-[var(--gold)]">{v.voucherNumber}</td>
                                <td className="p-2">{v.entityName}</td>
                                <td className={`p-2 font-bold tabular-nums ${v.type === 'قبض' ? 'text-emerald-300' : 'text-rose-300'}`}>
                                  {v.type === 'قبض' ? '+' : '-'}{v.amount.toLocaleString()} {v.currency}
                                </td>
                              </tr>
                            );
                          })}
                          {bankVouchers.length === 0 && (
                            <tr>
                              <td colSpan={4} className="p-4 text-center text-slate-400">لا توجد سندات مسجلة على هذا الحساب المصرفي.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="border border-[var(--border-strong)] rounded-lg overflow-hidden">
                    <div className="bg-[#0B192C] px-3 py-2 font-black text-sky-300">
                      سجل جلسات التسوية البنكية المحفوظة ({bankReconciliations.length})
                    </div>
                    <div className="max-h-56 overflow-y-auto p-2 space-y-1.5">
                      {bankReconciliations.map((rec) => (
                        <div key={rec.id} className="bg-[#060D15] border border-[#1B2E44] rounded p-2 flex justify-between items-center">
                          <div>
                            <div className="font-bold text-white">{rec.treasuryAccountName}</div>
                            <div className="text-[11px] text-slate-400">
                              {rec.statementDate} · كشف: {rec.statementClosingBalance.toLocaleString()} · دفتري: {rec.bookClosingBalance.toLocaleString()}
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded font-bold ${rec.status === 'reconciled' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>
                            فارق {rec.reconciledDifference.toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {bankReconciliations.length === 0 && (
                        <div className="p-4 text-center text-slate-400">
                          السندات غير المطابقة حالياً: {unmatchedVouchers.length} · احفظ أول جلسة تسوية بنكية أدناه.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 bg-[#071019] border-t border-[var(--border-strong)] flex justify-between items-center">
                <span className="text-slate-400">
                  سندات غير مطابقة: <strong className="text-amber-300">{unmatchedVouchers.length}</strong>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsBankRecOpen(false)}
                    className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
                  >
                    إغلاق
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeBankTr) return;
                      const session: BankReconciliationSession = {
                        id: `brec-${Date.now()}`,
                        companyId: company.id,
                        treasuryAccountId: activeBankTr.id,
                        treasuryAccountName: activeBankTr.nameAr,
                        statementDate: recStatementDate,
                        statementClosingBalance: effectiveStatementBal,
                        bookClosingBalance: bookBal,
                        reconciledDifference: diff,
                        matchedIds: recMatchedVoucherIds,
                        statementRows: recRows,
                        status: Math.abs(diff) < 0.01 ? 'reconciled' : 'draft',
                        performedBy: currentUser.fullName,
                        createdAt: new Date().toISOString(),
                      };
                      onSaveBankReconciliation?.(session);
                      onNotify('success', `تم حفظ جلسة التسوية البنكية لحساب ${activeBankTr.nameAr} (الفارق: ${diff.toLocaleString()}).`);
                    }}
                    className="px-4 py-1.5 rounded v20-btn-gold font-black cursor-pointer"
                  >
                    حفظ جلسة التسوية البنكية
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
