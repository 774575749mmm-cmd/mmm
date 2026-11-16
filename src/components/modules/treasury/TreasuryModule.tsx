/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Treasury, Cash, Banks & Multi-Currency Transfers Module
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Wallet,
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRightLeft,
  Printer,
  Eye,
  X,
  Layers,
  FileDown,
  FileSpreadsheet,
  MessageCircle,
  Ban,
  ChevronRight,
  ChevronLeft,
  Edit3,
} from 'lucide-react';
import {
  TreasuryAccount,
  TreasuryTransfer,
  PaymentVoucher,
  Customer,
  Vendor,
  Branch,
  Company,
  Currency,
  CurrencyCode,
  Account,
  WhatsAppTemplates,
  TableColumnPref,
} from '../../../types/erp';
import { PrintableDocumentData } from '../../common/PrintModal';
import { BatchVoucherModal } from './BatchVoucherModal';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import { ConfirmModal } from '../../common/ConfirmModal';
import {
  downloadVoucherPDF,
  downloadReportAsPDF,
  exportToExcel,
  exportToCSV,
} from '../../../services/exportService';
import { generateNextDocNumber } from '../../../services/storageService';

interface TreasuryModuleProps {
  treasuryAccounts: TreasuryAccount[];
  treasuryTransfers?: TreasuryTransfer[];
  paymentVouchers: PaymentVoucher[];
  customers: Customer[];
  vendors: Vendor[];
  currencies?: Currency[];
  chartOfAccounts?: Account[];
  paymentMethods?: string[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  canPostEntries?: boolean;
  whatsappTemplates?: WhatsAppTemplates;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  focusedRecordId?: string;
  onPostVoucher: (voucher: PaymentVoucher) => void;
  onBatchPostVouchers?: (vouchers: PaymentVoucher[]) => void;
  onCancelVoucher?: (voucherId: string) => void;
  onSaveTreasuryAccount?: (account: TreasuryAccount) => void;
  onTreasuryTransfer?: (transfer: TreasuryTransfer) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, isBase: true, decimalPlaces: 2 },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 140, isBase: false, decimalPlaces: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 530, isBase: false, decimalPlaces: 2 },
];

export const TreasuryModule: React.FC<TreasuryModuleProps> = ({
  treasuryAccounts,
  treasuryTransfers = [],
  paymentVouchers,
  customers,
  vendors,
  currencies = DEFAULT_CURRENCIES,
  chartOfAccounts = [],
  paymentMethods = ['نقداً', 'شيك', 'تحويل_بنكي', 'دفع_إلكتروني'],
  currentBranch,
  company,
  currencySymbol,
  canPostEntries = true,
  whatsappTemplates,
  savedColumnPrefs,
  onSaveColumnPrefs,
  focusedRecordId,
  onPostVoucher,
  onBatchPostVouchers,
  onCancelVoucher,
  onSaveTreasuryAccount,
  onTreasuryTransfer,
  onOpenPrintModal,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'vouchers' | 'accounts' | 'transfers'>('vouchers');
  const [filterType, setFilterType] = useState<'all' | 'قبض' | 'صرف'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'posted' | 'cancelled'>('all');

  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [viewingVoucher, setViewingVoucher] = useState<PaymentVoucher | null>(null);
  const [cancelTargetVoucher, setCancelTargetVoucher] = useState<PaymentVoucher | null>(null);
  const [waVoucher, setWaVoucher] = useState<PaymentVoucher | null>(null);

  // Single Voucher Form State
  const [isVoucherModalOpen, setIsVoucherModalOpen] = useState(false);
  const [voucherType, setVoucherType] = useState<'قبض' | 'صرف'>('قبض');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState(treasuryAccounts[0]?.id || '');
  const [entityType, setEntityType] = useState<PaymentVoucher['entityType']>('عميل');
  const [selectedEntityId, setSelectedEntityId] = useState(customers[0]?.id || '');
  const [otherEntityName, setOtherEntityName] = useState('');
  const [amount, setAmount] = useState(100000);
  const [voucherCurrency, setVoucherCurrency] = useState<CurrencyCode>('YER');
  const [exchangeRate, setExchangeRate] = useState<number>(1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentVoucher['paymentMethod']>('نقداً');
  const [checkOrTransferRef, setCheckOrTransferRef] = useState('');
  const [statement, setStatement] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().split('T')[0]);
  const [formError, setFormError] = useState('');

  // Inter-Treasury Transfer Modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [fromTreasuryId, setFromTreasuryId] = useState(treasuryAccounts[0]?.id || '');
  const [toTreasuryId, setToTreasuryId] = useState(treasuryAccounts[1]?.id || treasuryAccounts[0]?.id || '');
  const [transferAmount, setTransferAmount] = useState(50000);
  const [transferFee, setTransferFee] = useState(0);
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0]);
  const [transferNotes, setTransferNotes] = useState('');

  // Treasury Account CRUD Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<TreasuryAccount | null>(null);
  const [accNameAr, setAccNameAr] = useState('');
  const [accCode, setAccCode] = useState('');
  const [accType, setAccType] = useState<TreasuryAccount['type']>('صندوق');
  const [accCurrency, setAccCurrency] = useState<CurrencyCode>('YER');
  const [accNumber, setAccNumber] = useState('');
  const [accGlId, setAccGlId] = useState('');
  const [accOpeningBal, setAccOpeningBal] = useState(0);

  useEffect(() => {
    if (!focusedRecordId) return;
    const matchedVoucher = paymentVouchers.find((v) => v.id === focusedRecordId || v.voucherNumber === focusedRecordId);
    if (matchedVoucher) {
      setActiveTab('vouchers');
      setViewingVoucher(matchedVoucher);
      return;
    }
    const matchedTreasury = treasuryAccounts.find((t) => t.id === focusedRecordId);
    if (matchedTreasury) {
      setActiveTab('accounts');
    }
  }, [focusedRecordId, paymentVouchers, treasuryAccounts]);

  const getRateForCurrency = (code: CurrencyCode): number => {
    return currencies.find((c) => c.code === code)?.exchangeRate ?? 1;
  };

  const openNewVoucherModal = (type: 'قبض' | 'صرف') => {
    setFormError('');
    setVoucherType(type);
    const defaultTr = treasuryAccounts.find((t) => t.status === 'active') || treasuryAccounts[0];
    setSelectedTreasuryId(defaultTr?.id || '');
    const curr = defaultTr?.currency || 'YER';
    setVoucherCurrency(curr);
    setExchangeRate(getRateForCurrency(curr));
    setEntityType(type === 'قبض' ? 'عميل' : 'مورد');
    setSelectedEntityId(type === 'قبض' ? customers[0]?.id || '' : vendors[0]?.id || '');
    setOtherEntityName('');
    setAmount(100000);
    setPaymentMethod((paymentMethods[0] as PaymentVoucher['paymentMethod']) || 'نقداً');
    setCheckOrTransferRef('');
    setStatement(type === 'قبض' ? 'دفعة نقدية تحت الحساب' : 'سداد دفعة للمورد');
    setIsVoucherModalOpen(true);
  };

  const handleVoucherSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (amount <= 0 || exchangeRate <= 0) {
      setFormError('المبلغ وسعر الصرف يجب أن يكونا أكبر من صفر.');
      return;
    }
    if (!selectedTreasuryId) {
      setFormError('يرجى اختيار الخزينة أو الحساب البنكي.');
      return;
    }

    const tr = treasuryAccounts.find((t) => t.id === selectedTreasuryId);
    let entityName = '';
    if (entityType === 'عميل') {
      entityName = customers.find((c) => c.id === selectedEntityId)?.nameAr || 'عميل نقدي';
    } else if (entityType === 'مورد') {
      entityName = vendors.find((v) => v.id === selectedEntityId)?.nameAr || 'مورد عام';
    } else {
      entityName = otherEntityName.trim() || 'طرف خارجي';
    }

    const year = new Date().getFullYear();
    const prefix = voucherType === 'قبض' ? `RV-${year}-` : `PV-${year}-`;
    const voucherNumber = generateNextDocNumber(
      prefix,
      paymentVouchers.map((v) => v.voucherNumber),
      4
    );

    const amt = Number(amount);
    const rate = Number(exchangeRate) || 1;
    const baseAmount = Math.round(amt * rate * 100) / 100;

    const newVoucher: PaymentVoucher = {
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      voucherNumber,
      type: voucherType,
      date: voucherDate,
      branchId: currentBranch.id,
      treasuryAccountId: selectedTreasuryId,
      treasuryAccountName: tr?.nameAr || 'الصندوق الرئيسي',
      entityType,
      entityId: entityType === 'عميل' || entityType === 'مورد' ? selectedEntityId : undefined,
      entityName,
      amount: amt,
      currency: voucherCurrency,
      exchangeRate: rate,
      baseAmount,
      paymentMethod,
      checkNumber: paymentMethod === 'شيك' ? checkOrTransferRef.trim() || undefined : undefined,
      transferReference: paymentMethod !== 'شيك' && checkOrTransferRef.trim() ? checkOrTransferRef.trim() : undefined,
      statement: statement.trim(),
      status: 'posted',
      receivedOrPaidBy: 'أمين الصندوق',
      createdBy: 'أمين الصندوق',
      createdAt: new Date().toISOString(),
    };

    onPostVoucher(newVoucher);
    onNotify?.('success', `تم ترحيل سند ${voucherType} رقم ${voucherNumber} وتحديث القيد والأرصدة.`);
    setIsVoucherModalOpen(false);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromTreasuryId || !toTreasuryId || fromTreasuryId === toTreasuryId) {
      onNotify?.('error', 'يرجى اختيار حسابين مختلفين للتحويل بين الخزائن.');
      return;
    }
    const source = treasuryAccounts.find((t) => t.id === fromTreasuryId);
    if (!source) return;
    if (transferAmount <= 0) {
      onNotify?.('error', 'يجب أن يكون مبلغ التحويل أكبر من صفر.');
      return;
    }
    if (source.balance < transferAmount + transferFee) {
      onNotify?.('error', `الرصيد في ${source.nameAr} غير كافٍ لإتمام التحويل.`);
      return;
    }

    const year = new Date().getFullYear();
    const transferNumber = generateNextDocNumber(
      `TR-${year}-`,
      treasuryTransfers.map((t) => t.transferNumber),
      4
    );

    const newTransfer: TreasuryTransfer = {
      id: `trf-${Date.now()}`,
      transferNumber,
      date: transferDate,
      fromTreasuryId,
      toTreasuryId,
      amount: Number(transferAmount),
      currency: source.currency,
      feeAmount: Number(transferFee) || 0,
      notes: transferNotes.trim() || 'تحويل نقدية داخلي بين الصناديق والبنوك',
      createdBy: 'أمين الصندوق',
    };

    onTreasuryTransfer?.(newTransfer);
    onNotify?.('success', `تم اعتماد التحويل المالي رقم ${transferNumber}.`);
    setIsTransferModalOpen(false);
    setTransferNotes('');
  };

  const openAccountModal = (acc?: TreasuryAccount) => {
    if (acc) {
      setEditingAccount(acc);
      setAccNameAr(acc.nameAr);
      setAccCode(acc.code);
      setAccType(acc.type);
      setAccCurrency(acc.currency);
      setAccNumber(acc.accountNumber || '');
      setAccGlId(acc.generalLedgerAccountId);
      setAccOpeningBal(acc.balance);
    } else {
      setEditingAccount(null);
      setAccNameAr('');
      setAccCode(`TR-${String(treasuryAccounts.length + 1).padStart(2, '0')}`);
      setAccType('صندوق');
      setAccCurrency('YER');
      setAccNumber('');
      const cashGl = chartOfAccounts.find((a) => a.isLeaf && a.code.startsWith('111'))?.id || chartOfAccounts[0]?.id || 'acc-1111';
      setAccGlId(cashGl);
      setAccOpeningBal(0);
    }
    setIsAccountModalOpen(true);
  };

  const handleSaveAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accNameAr.trim() || !accCode.trim()) {
      onNotify?.('error', 'يرجى إدخال اسم وكود الحساب المالي.');
      return;
    }
    const payload: TreasuryAccount = editingAccount
      ? {
          ...editingAccount,
          code: accCode.trim(),
          nameAr: accNameAr.trim(),
          type: accType,
          currency: accCurrency,
          accountNumber: accNumber.trim() || undefined,
          generalLedgerAccountId: accGlId || editingAccount.generalLedgerAccountId,
        }
      : {
          id: `tr-${Date.now()}`,
          code: accCode.trim(),
          nameAr: accNameAr.trim(),
          type: accType,
          currency: accCurrency,
          accountNumber: accNumber.trim() || undefined,
          branchId: currentBranch.id,
          generalLedgerAccountId: accGlId || 'acc-1111',
          balance: Number(accOpeningBal) || 0,
          status: 'active',
        };
    onSaveTreasuryAccount?.(payload);
    onNotify?.('success', editingAccount ? 'تم تحديث بيانات الحساب المالي.' : 'تم إضافة حساب الخزينة الجديد بنجاح.');
    setIsAccountModalOpen(false);
  };

  const handlePrintVoucher = (v: PaymentVoucher) => {
    const isReceipt = v.type === 'قبض';
    const docData: PrintableDocumentData = {
      title: isReceipt ? 'سند قبض رسمي معتمد' : 'سند صرف رسمي معتمد',
      documentNumber: v.voucherNumber,
      date: v.date,
      entityName: v.entityName,
      statement: `${v.statement} · الحساب المالي: ${v.treasuryAccountName} (${v.paymentMethod})`,
      currencySymbol: v.currency || currencySymbol,
      totals: {
        subtotal: v.amount,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: v.amount,
        paidAmount: v.amount,
      },
      notes: isReceipt
        ? 'يعتبر هذا السند لاغياً إذا تم السداد بشيك ولم يتم تحصيله في الحساب البنكي.'
        : 'تم الصرف بموجب إذن صرف معتمد ومستندات مؤيدة.',
      amountInWords: `المبلغ وقدره: ${v.amount.toLocaleString()} ${v.currency || currencySymbol} (المقابل بالعملة الأساسية: ${v.baseAmount.toLocaleString()} ${currencySymbol}).`,
    };
    onOpenPrintModal(docData);
  };

  const filteredVouchers = useMemo(() => {
    return paymentVouchers.filter((v) => {
      const matchType = filterType === 'all' || v.type === filterType;
      const matchStatus = filterStatus === 'all' || v.status === filterStatus;
      return matchType && matchStatus;
    });
  }, [paymentVouchers, filterType, filterStatus]);

  // Compute running before/after balance per treasury account anchored at current treasury balances
  const voucherTreasurySnapshots = useMemo(() => {
    const map = new Map<string, { before: number; after: number; currency: CurrencyCode }>();
    const cursors = new Map<string, number>();
    const accMap = new Map<string, TreasuryAccount>();
    for (const tr of treasuryAccounts) {
      cursors.set(tr.id, tr.balance);
      accMap.set(tr.id, tr);
    }

    const sortedDesc = [...paymentVouchers]
      .filter((v) => v.status === 'posted')
      .sort((a, b) => {
        const dCmp = (b.date || '').localeCompare(a.date || '');
        if (dCmp !== 0) return dCmp;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

    for (const v of sortedDesc) {
      const tr = accMap.get(v.treasuryAccountId);
      if (!tr) continue;
      const afterBal = cursors.get(tr.id) ?? tr.balance;
      const trRate = getRateForCurrency(tr.currency) || 1;
      const amtInTr =
        v.currency === tr.currency
          ? v.amount
          : Math.round(((v.baseAmount || v.amount * v.exchangeRate) / trRate) * 100) / 100;
      const beforeBal =
        v.type === 'قبض'
          ? Math.round((afterBal - amtInTr) * 100) / 100
          : Math.round((afterBal + amtInTr) * 100) / 100;
      map.set(v.id, { before: beforeBal, after: afterBal, currency: tr.currency });
      cursors.set(tr.id, beforeBal);
    }
    return map;
  }, [paymentVouchers, treasuryAccounts, currencies]);

  const viewingIdx = viewingVoucher
    ? filteredVouchers.findIndex((v) => v.id === viewingVoucher.id)
    : -1;

  const voucherColumns: ErpTableColumn<PaymentVoucher>[] = useMemo(
    () => [
      {
        key: 'voucherNumber',
        label: 'رقم السند',
        sortValue: (v) => v.voucherNumber,
        searchValue: (v) => `${v.voucherNumber} ${v.checkNumber || ''} ${v.transferReference || ''}`,
        render: (v) => (
          <div>
            <div className="font-mono font-bold text-amber-400">{v.voucherNumber}</div>
            {(v.checkNumber || v.transferReference) && (
              <div className="text-[10px] text-slate-500 font-mono">
                مرجع: {v.checkNumber || v.transferReference}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'type',
        label: 'النوع',
        align: 'center',
        sortValue: (v) => v.type,
        render: (v) => (
          <span
            className={`text-[11px] px-2 py-0.5 rounded font-bold ${
              v.type === 'قبض'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                : 'bg-rose-950 text-rose-400 border border-rose-800/40'
            }`}
          >
            {v.type}
          </span>
        ),
      },
      {
        key: 'date',
        label: 'التاريخ',
        sortValue: (v) => v.date,
        render: (v) => <span className="font-mono text-slate-400">{v.date}</span>,
      },
      {
        key: 'entityName',
        label: 'الطرف المعني',
        sortValue: (v) => v.entityName,
        searchValue: (v) => `${v.entityName} ${v.entityType}`,
        render: (v) => (
          <div>
            <div className="font-semibold text-slate-100">{v.entityName}</div>
            <div className="text-[10px] text-slate-500">{v.entityType}</div>
          </div>
        ),
      },
      {
        key: 'statement',
        label: 'البيان',
        sortValue: (v) => v.statement,
        render: (v) => <span className="text-slate-300 line-clamp-2 max-w-xs">{v.statement}</span>,
      },
      {
        key: 'treasuryAccountName',
        label: 'الخزينة / الحساب',
        sortValue: (v) => v.treasuryAccountName,
        render: (v) => (
          <div>
            <div className="text-slate-200">{v.treasuryAccountName}</div>
            <div className="text-[10px] text-slate-500">{v.paymentMethod.replace(/_/g, ' ')}</div>
          </div>
        ),
      },
      {
        key: 'amount',
        label: 'المبلغ والعملة',
        align: 'left',
        sortValue: (v) => v.baseAmount,
        render: (v) => (
          <div className="font-mono tabular-nums text-left">
            <div className={`font-black text-sm ${v.type === 'قبض' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {v.amount.toLocaleString()} {v.currency}
            </div>
            {v.currency !== 'YER' && (
              <div className="text-[10px] text-slate-400">
                ≈ {v.baseAmount.toLocaleString()} {currencySymbol}
              </div>
            )}
          </div>
        ),
        footerRender: (rows) => {
          const receipts = rows
            .filter((r) => r.type === 'قبض' && r.status === 'posted')
            .reduce((s, r) => s + r.baseAmount, 0);
          const payments = rows
            .filter((r) => r.type === 'صرف' && r.status === 'posted')
            .reduce((s, r) => s + r.baseAmount, 0);
          return (
            <div className="text-left font-mono text-[11px] space-y-0.5">
              <div className="text-emerald-400">+{receipts.toLocaleString()}</div>
              <div className="text-rose-400">-{payments.toLocaleString()}</div>
            </div>
          );
        },
      },
      {
        key: 'treasuryRunning',
        label: 'رصيد الخزينة (قبل ← بعد)',
        align: 'left',
        sortable: false,
        render: (v) => {
          const snap = voucherTreasurySnapshots.get(v.id);
          if (!snap) return <span className="text-slate-500 text-[11px]">-</span>;
          return (
            <div className="font-mono text-[11px] tabular-nums text-left leading-tight">
              <div className="text-slate-400">قبل: {snap.before.toLocaleString()}</div>
              <div className="font-bold text-amber-300">
                بعد: {snap.after.toLocaleString()} {snap.currency}
              </div>
            </div>
          );
        },
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        sortValue: (v) => v.status,
        render: (v) => (
          <span
            className={`text-[11px] px-2 py-0.5 rounded font-bold ${
              v.status === 'posted'
                ? 'bg-slate-800 text-emerald-300'
                : 'bg-rose-950/70 text-rose-400 line-through'
            }`}
          >
            {v.status === 'posted' ? 'مرحل' : 'ملغى'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'الإجراءات',
        align: 'center',
        sortable: false,
        render: (v) => (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setViewingVoucher(v)}
              title="عرض تفاصيل السند"
              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadVoucherPDF(v, company, currentBranch);
              }}
              title="تنزيل PDF"
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePrintVoucher(v)}
              title="طباعة السند"
              className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWaVoucher(v)}
              title="مشاركة عبر واتساب"
              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            {canPostEntries && v.status === 'posted' && onCancelVoucher && (
              <button
                type="button"
                onClick={() => setCancelTargetVoucher(v)}
                title="إلغاء وعكس السند"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <Ban className="w-4 h-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [currencySymbol, company, currentBranch, canPostEntries, onCancelVoucher]
  );

  const exportVouchersPdf = async (rows: PaymentVoucher[]) => {
    await downloadReportAsPDF({
      title: 'كشف سندات الخزينة والبنوك',
      subtitle: 'سجل سندات القبض والصرف',
      company,
      branch: currentBranch,
      tables: [
        {
          headers: ['رقم السند', 'النوع', 'التاريخ', 'الطرف المعني', 'البيان', 'الخزينة', 'المبلغ', 'العملة'],
          rows: rows.map((r) => [
            r.voucherNumber,
            r.type,
            r.date,
            r.entityName,
            r.statement,
            r.treasuryAccountName,
            r.amount,
            r.currency,
          ]),
        },
      ],
    });
  };

  const getVoucherContactPhone = (v: PaymentVoucher): string => {
    if (v.entityType === 'عميل') {
      const c = customers.find((x) => x.id === v.entityId);
      return c?.whatsapp || c?.phone || '';
    }
    if (v.entityType === 'مورد') {
      const vn = vendors.find((x) => x.id === v.entityId);
      return vn?.whatsapp || vn?.phone || '';
    }
    return '';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة الخزينة والنقدية والبنوك والمحافظ</h2>
          </div>
          <p className="text-xs text-slate-400">
            أرصدة الصناديق والبنوك متعددة العملات، سندات القبض والصرف، التحويلات الداخلية، والإدخال الجماعي
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsBatchModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Layers className="w-4 h-4" />
            <span>إدخال سندات جماعي</span>
          </button>
          <button
            type="button"
            onClick={() => openNewVoucherModal('قبض')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>سند قبض</span>
          </button>
          <button
            type="button"
            onClick={() => openNewVoucherModal('صرف')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>سند صرف</span>
          </button>
          {onTreasuryTransfer && (
            <button
              type="button"
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>تحويل بين الخزائن</span>
            </button>
          )}
        </div>
      </div>

      {/* Treasury Balances Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {treasuryAccounts.map((tr) => (
          <div
            key={tr.id}
            className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300">{tr.nameAr}</span>
              <span className="text-[10px] bg-slate-800 text-amber-400 px-1.5 py-0.5 rounded font-bold">
                {tr.type}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-mono font-black text-white tabular-nums">
                  {tr.balance.toLocaleString()}
                </span>
                <span className="text-xs text-slate-400 font-semibold">{tr.currency}</span>
              </div>
              <span className="text-[10px] font-mono text-slate-500">{tr.code}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('vouchers')}
          className={`px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer ${
            activeTab === 'vouchers'
              ? 'bg-amber-500 text-slate-950'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          سجل سندات القبض والصرف ({paymentVouchers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          className={`px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer ${
            activeTab === 'accounts'
              ? 'bg-amber-500 text-slate-950'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          الصناديق والبنوك والمحافظ ({treasuryAccounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('transfers')}
          className={`px-4 py-2 rounded-lg font-bold transition-colors cursor-pointer ${
            activeTab === 'transfers'
              ? 'bg-amber-500 text-slate-950'
              : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          التحويلات المالية الداخلية ({treasuryTransfers.length})
        </button>
      </div>

      {/* TAB 1: VOUCHERS */}
      {activeTab === 'vouchers' && (
        <ErpDataTable<PaymentVoucher>
          tableId="treasury-vouchers"
          title="سندات الخزينة والبنوك"
          data={filteredVouchers}
          columns={voucherColumns}
          getRowId={(r) => r.id}
          savedColumnPrefs={savedColumnPrefs}
          onSaveColumnPrefs={onSaveColumnPrefs}
          searchPlaceholder="بحث برقم السند، الطرف، البيان، المرجع..."
          selectable
          defaultSortKey="date"
          defaultSortDir="desc"
          onRowClick={(row) => setViewingVoucher(row)}
          filtersSlot={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                {(['all', 'قبض', 'صرف'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                      filterType === t ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t === 'all' ? 'الكل' : t === 'قبض' ? 'القبض' : 'الصرف'}
                  </button>
                ))}
              </div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'posted' | 'cancelled')}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="all">كل الحالات</option>
                <option value="posted">المرحلة فقط</option>
                <option value="cancelled">الملغاة فقط</option>
              </select>
            </div>
          }
          actionsSlot={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void exportVouchersPdf(filteredVouchers)}
                className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToExcel({
                    fileName: `سندات_الخزينة_${new Date().toISOString().slice(0, 10)}`,
                    sheets: [
                      {
                        name: 'السندات',
                        data: [
                          ['رقم السند', 'النوع', 'التاريخ', 'الطرف', 'البيان', 'الخزينة', 'المبلغ', 'العملة', 'سعر الصرف', 'المقابل بالأساسية', 'الحالة'],
                          ...filteredVouchers.map((r) => [
                            r.voucherNumber,
                            r.type,
                            r.date,
                            r.entityName,
                            r.statement,
                            r.treasuryAccountName,
                            r.amount,
                            r.currency,
                            r.exchangeRate,
                            r.baseAmount,
                            r.status,
                          ]),
                        ],
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToCSV(
                    `سندات_الخزينة_${new Date().toISOString().slice(0, 10)}`,
                    ['رقم السند', 'النوع', 'التاريخ', 'الطرف', 'البيان', 'المبلغ', 'العملة'],
                    filteredVouchers.map((r) => [r.voucherNumber, r.type, r.date, r.entityName, r.statement, r.amount, r.currency])
                  )
                }
                className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
              >
                CSV
              </button>
            </div>
          }
          bulkActionsSlot={(selected) => (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void exportVouchersPdf(selected)}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
              >
                تصدير المحدد PDF ({selected.length})
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToExcel({
                    fileName: `سندات_محددة_${new Date().toISOString().slice(0, 10)}`,
                    sheets: [
                      {
                        name: 'السندات المحددة',
                        data: [
                          ['رقم السند', 'النوع', 'التاريخ', 'الطرف', 'المبلغ', 'العملة', 'المقابل الأساسي'],
                          ...selected.map((r) => [r.voucherNumber, r.type, r.date, r.entityName, r.amount, r.currency, r.baseAmount]),
                        ],
                      },
                    ],
                  })
                }
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
              >
                Excel ({selected.length})
              </button>
            </div>
          )}
        />
      )}

      {/* TAB 2: TREASURY ACCOUNTS MANAGEMENT */}
      {activeTab === 'accounts' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">دليل الصناديق والبنوك والمحافظ الإلكترونية</h3>
            {onSaveTreasuryAccount && (
              <button
                type="button"
                onClick={() => openAccountModal()}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة حساب / خزينة</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {treasuryAccounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs font-mono text-amber-400">{acc.code}</div>
                    <div className="text-sm font-bold text-white mt-0.5">{acc.nameAr}</div>
                    {acc.accountNumber && (
                      <div className="text-[11px] font-mono text-slate-400 mt-1">رقم الحساب: {acc.accountNumber}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-semibold">
                      {acc.type}
                    </span>
                    {onSaveTreasuryAccount && (
                      <button
                        type="button"
                        onClick={() => openAccountModal(acc)}
                        className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg cursor-pointer"
                        title="تعديل الحساب"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">الرصيد الحالي:</span>
                  <span className="font-mono font-black text-base text-emerald-400 tabular-nums">
                    {acc.balance.toLocaleString()} {acc.currency}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: INTERNAL TRANSFERS */}
      {activeTab === 'transfers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">سجل التحويلات المالية بين الصناديق والبنوك</h3>
            {onTreasuryTransfer && (
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl cursor-pointer"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>تحويل جديد</span>
              </button>
            )}
          </div>
          {treasuryTransfers.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              لا توجد تحويلات داخلية مسجلة حتى الآن.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="py-2.5 px-3">رقم التحويل</th>
                    <th className="py-2.5 px-3">التاريخ</th>
                    <th className="py-2.5 px-3">من حساب</th>
                    <th className="py-2.5 px-3">إلى حساب</th>
                    <th className="py-2.5 px-3 text-left">المبلغ</th>
                    <th className="py-2.5 px-3 text-left">الرسوم</th>
                    <th className="py-2.5 px-3">البيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {treasuryTransfers.map((trf) => (
                    <tr key={trf.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-400">{trf.transferNumber}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{trf.date}</td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {treasuryAccounts.find((t) => t.id === trf.fromTreasuryId)?.nameAr || trf.fromTreasuryId}
                      </td>
                      <td className="py-2.5 px-3 text-slate-200">
                        {treasuryAccounts.find((t) => t.id === trf.toTreasuryId)?.nameAr || trf.toTreasuryId}
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono font-bold text-emerald-400 tabular-nums">
                        {trf.amount.toLocaleString()} {trf.currency}
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono text-slate-400 tabular-nums">
                        {trf.feeAmount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">{trf.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE SINGLE VOUCHER MODAL */}
      {isVoucherModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">
                {voucherType === 'قبض' ? 'تحرير سند قبض مالي' : 'تحرير سند صرف مالي'}
              </h3>
              <button
                type="button"
                onClick={() => setIsVoucherModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleVoucherSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-700/50 text-rose-300 font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    {voucherType === 'قبض' ? 'الصندوق / البنك المقبوض فيه' : 'الصندوق / البنك المصروف منه'} *
                  </label>
                  <select
                    value={selectedTreasuryId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedTreasuryId(id);
                      const tr = treasuryAccounts.find((t) => t.id === id);
                      if (tr) {
                        setVoucherCurrency(tr.currency);
                        setExchangeRate(getRateForCurrency(tr.currency));
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {treasuryAccounts.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nameAr} ({t.balance.toLocaleString()} {t.currency})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تاريخ السند *</label>
                  <input
                    type="date"
                    required
                    value={voucherDate}
                    onChange={(e) => setVoucherDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">نوع الطرف المعني *</label>
                  <select
                    value={entityType}
                    onChange={(e) => {
                      const t = e.target.value as PaymentVoucher['entityType'];
                      setEntityType(t);
                      if (t === 'عميل') setSelectedEntityId(customers[0]?.id || '');
                      if (t === 'مورد') setSelectedEntityId(vendors[0]?.id || '');
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="عميل">عميل</option>
                    <option value="مورد">مورد</option>
                    <option value="موظف">موظف</option>
                    <option value="مصروف">مصروف</option>
                    <option value="إيراد">إيراد</option>
                    <option value="أخرى">جهة أو شخص آخر</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    {voucherType === 'قبض' ? 'المقبوض منه' : 'المصروف إليه'} *
                  </label>
                  {entityType === 'عميل' ? (
                    <select
                      value={selectedEntityId}
                      onChange={(e) => setSelectedEntityId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameAr} (الرصيد: {c.currentBalance.toLocaleString()})
                        </option>
                      ))}
                    </select>
                  ) : entityType === 'مورد' ? (
                    <select
                      value={selectedEntityId}
                      onChange={(e) => setSelectedEntityId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nameAr} (الرصيد: {v.currentBalance.toLocaleString()})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={otherEntityName}
                      onChange={(e) => setOtherEntityName(e.target.value)}
                      placeholder="اسم المستلم أو الدافع..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">المبلغ *</label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العملة</label>
                  <select
                    value={voucherCurrency}
                    onChange={(e) => {
                      const c = e.target.value as CurrencyCode;
                      setVoucherCurrency(c);
                      setExchangeRate(getRateForCurrency(c));
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-500"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.nameAr} ({c.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">سعر الصرف</label>
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between font-mono">
                <span className="font-sans text-slate-400">المعادل بالعملة الأساسية:</span>
                <strong className="text-amber-400 text-sm">
                  {(Math.round(amount * exchangeRate * 100) / 100).toLocaleString()} {currencySymbol}
                </strong>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">طريقة السداد</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentVoucher['paymentMethod'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {paymentMethods.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم الشيك / الحوالة (اختياري)</label>
                  <input
                    type="text"
                    value={checkOrTransferRef}
                    onChange={(e) => setCheckOrTransferRef(e.target.value)}
                    placeholder="رقم المرجع..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">البيان والشرح المحاسبي *</label>
                <textarea
                  rows={2}
                  required
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="وذلك عن قيمة..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsVoucherModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className={`px-6 py-2 rounded-lg font-bold text-white transition-colors cursor-pointer ${
                    voucherType === 'قبض' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  ترحيل السند والقيد المالي
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW VOUCHER DETAILS MODAL WITH PREV / NEXT */}
      {viewingVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-white">
                  تفاصيل السند: {viewingVoucher.voucherNumber}
                </h3>
                <p className="text-xs text-slate-400">
                  سند {viewingVoucher.type} · التاريخ: {viewingVoucher.date}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={viewingIdx <= 0}
                  onClick={() => viewingIdx > 0 && setViewingVoucher(filteredVouchers[viewingIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={viewingIdx < 0 || viewingIdx >= filteredVouchers.length - 1}
                  onClick={() =>
                    viewingIdx >= 0 &&
                    viewingIdx < filteredVouchers.length - 1 &&
                    setViewingVoucher(filteredVouchers[viewingIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void downloadVoucherPDF(viewingVoucher, company, currentBranch)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintVoucher(viewingVoucher)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWaVoucher(viewingVoucher)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>واتساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingVoucher(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-400 block">الطرف المعني:</span>
                  <strong className="text-white text-sm">{viewingVoucher.entityName} ({viewingVoucher.entityType})</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">الحساب المالي:</span>
                  <strong className="text-amber-300">{viewingVoucher.treasuryAccountName}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">طريقة السداد:</span>
                  <strong className="text-slate-200">{viewingVoucher.paymentMethod.replace(/_/g, ' ')}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">الحالة والقيد المحاسبي:</span>
                  <strong className="font-mono text-emerald-400">
                    {viewingVoucher.status === 'posted' ? 'مرحل' : 'ملغى / معكوس'} · {viewingVoucher.journalEntryId || 'آلي'}
                  </strong>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">البيان المحاسبي:</span>
                <p className="text-slate-100 leading-relaxed">{viewingVoucher.statement}</p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 font-mono">
                <div>
                  <span className="font-sans text-slate-400 block">المبلغ بالعملة:</span>
                  <strong className={`text-lg font-black ${viewingVoucher.type === 'قبض' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {viewingVoucher.amount.toLocaleString()} {viewingVoucher.currency}
                  </strong>
                </div>
                <div>
                  <span className="font-sans text-slate-400 block">المقابل بالعملة الأساسية (سعر الصرف {viewingVoucher.exchangeRate}):</span>
                  <strong className="text-base text-amber-400">
                    {viewingVoucher.baseAmount.toLocaleString()} {currencySymbol}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INTERNAL TREASURY TRANSFER MODAL */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl text-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">تحويل نقدية بين الصناديق والبنوك</h3>
              <button
                type="button"
                onClick={() => setIsTransferModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTransferSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">من حساب (المصدر)</label>
                <select
                  value={fromTreasuryId}
                  onChange={(e) => setFromTreasuryId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                >
                  {treasuryAccounts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr} ({t.balance.toLocaleString()} {t.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">إلى حساب (المستلم)</label>
                <select
                  value={toTreasuryId}
                  onChange={(e) => setToTreasuryId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                >
                  {treasuryAccounts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr} ({t.balance.toLocaleString()} {t.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">المبلغ</label>
                  <input
                    type="number"
                    min={1}
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رسوم تحويل</label>
                  <input
                    type="number"
                    min={0}
                    value={transferFee}
                    onChange={(e) => setTransferFee(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={transferDate}
                    onChange={(e) => setTransferDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 font-mono text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">البيان / الملاحظات</label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="تغذية صندوق / إيداع بنكي..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 rounded-lg text-slate-950 font-bold"
                >
                  تنفيذ التحويل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TREASURY ACCOUNT CRUD MODAL */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl text-slate-100 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">
                {editingAccount ? 'تعديل بيانات حساب الخزينة' : 'إضافة صندوق / حساب بنكي جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAccountSubmit} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">الكود *</label>
                  <input
                    type="text"
                    required
                    value={accCode}
                    onChange={(e) => setAccCode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">النوع</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as TreasuryAccount['type'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="صندوق">صندوق نقدي</option>
                    <option value="بنك">حساب بنكي</option>
                    <option value="محفظة">محفظة إلكترونية</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-slate-300 mb-1">اسم الخزينة / البنك *</label>
                <input
                  type="text"
                  required
                  value={accNameAr}
                  onChange={(e) => setAccNameAr(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">العملة</label>
                  <select
                    value={accCurrency}
                    onChange={(e) => setAccCurrency(e.target.value as CurrencyCode)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-amber-300"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} - {c.nameAr}</option>
                    ))}
                  </select>
                </div>
                {!editingAccount && (
                  <div>
                    <label className="block text-slate-300 mb-1">الرصيد الافتتاحي</label>
                    <input
                      type="number"
                      value={accOpeningBal}
                      onChange={(e) => setAccOpeningBal(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-slate-300 mb-1">رقم الحساب البنكي / المحفظة (اختياري)</label>
                <input
                  type="text"
                  value={accNumber}
                  onChange={(e) => setAccNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-white"
                />
              </div>
              {chartOfAccounts.length > 0 && (
                <div>
                  <label className="block text-slate-300 mb-1">حساب الأستاذ العام المرتبط</label>
                  <select
                    value={accGlId}
                    onChange={(e) => setAccGlId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white"
                  >
                    {chartOfAccounts
                      .filter((a) => a.isLeaf && a.category === 'أصول')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} - {a.nameAr}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 font-semibold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 rounded-lg text-slate-950 font-bold"
                >
                  حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Voucher Modal */}
      <BatchVoucherModal
        isOpen={isBatchModalOpen}
        onClose={() => setIsBatchModalOpen(false)}
        treasuryAccounts={treasuryAccounts}
        customers={customers}
        vendors={vendors}
        currencies={currencies}
        existingVoucherNumbers={paymentVouchers.map((v) => v.voucherNumber)}
        paymentMethods={paymentMethods}
        currentBranch={currentBranch}
        currencySymbol={currencySymbol}
        onNotify={onNotify}
        onBatchSubmit={(vouchers) => {
          if (onBatchPostVouchers) {
            onBatchPostVouchers(vouchers);
          } else {
            vouchers.forEach((v) => onPostVoucher(v));
          }
        }}
      />

      {/* Cancel Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(cancelTargetVoucher)}
        title="تأكيد إلغاء وعكس السند المالي"
        message={
          cancelTargetVoucher
            ? `هل أنت متأكد من إلغاء السند رقم ${cancelTargetVoucher.voucherNumber} بمبلغ ${cancelTargetVoucher.amount.toLocaleString()} ${cancelTargetVoucher.currency}؟ سيتم إنشاء قيد عكسي وإرجاع أرصدة الخزينة والطرف المعني.`
            : ''
        }
        confirmLabel="نعم، إلغاء وعكس السند"
        variant="danger"
        onCancel={() => setCancelTargetVoucher(null)}
        onConfirm={() => {
          if (cancelTargetVoucher && onCancelVoucher) {
            onCancelVoucher(cancelTargetVoucher.id);
            onNotify?.('info', `تم إلغاء وعكس السند رقم ${cancelTargetVoucher.voucherNumber}.`);
          }
          setCancelTargetVoucher(null);
        }}
      />

      {/* WhatsApp Share Modal */}
      {waVoucher && (
        <WhatsAppShareModal
          isOpen={Boolean(waVoucher)}
          onClose={() => setWaVoucher(null)}
          title={`مشاركة سند ${waVoucher.type} رقم ${waVoucher.voucherNumber}`}
          recipientName={waVoucher.entityName}
          defaultPhone={getVoucherContactPhone(waVoucher)}
          defaultTemplateKey="voucher"
          templates={whatsappTemplates}
          templateVars={{
            companyName: company?.nameAr || 'المنصور للأنظمة الذكية',
            voucherType: waVoucher.type,
            voucherNumber: waVoucher.voucherNumber,
            entityName: waVoucher.entityName,
            date: waVoucher.date,
            amount: waVoucher.amount.toLocaleString(),
            currency: waVoucher.currency,
            statement: waVoucher.statement,
          }}
        />
      )}
    </div>
  );
};
