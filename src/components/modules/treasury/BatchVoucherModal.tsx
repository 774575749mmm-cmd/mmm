/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Batch Voucher Entry Modal (نظام إدخال السندات الجماعي)
 */

import React, { useState, useRef } from 'react';
import {
  X,
  Plus,
  Trash2,
  Copy,
  Layers,
  Save,
  AlertCircle,
} from 'lucide-react';
import {
  TreasuryAccount,
  Customer,
  Vendor,
  Branch,
  Currency,
  CurrencyCode,
  BatchVoucherRow,
  PaymentVoucher,
} from '../../../types/erp';
import { generateNextDocNumber } from '../../../services/storageService';

interface BatchRowState extends BatchVoucherRow {
  exchangeRate: number;
}

interface BatchVoucherModalProps {
  isOpen: boolean;
  onClose: () => void;
  treasuryAccounts: TreasuryAccount[];
  customers: Customer[];
  vendors: Vendor[];
  currencies?: Currency[];
  existingVoucherNumbers?: string[];
  paymentMethods?: string[];
  currentBranch: Branch;
  currencySymbol: string;
  onBatchSubmit: (vouchers: PaymentVoucher[]) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, isBase: true, decimalPlaces: 2 },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 140, isBase: false, decimalPlaces: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 530, isBase: false, decimalPlaces: 2 },
];

export const BatchVoucherModal: React.FC<BatchVoucherModalProps> = ({
  isOpen,
  onClose,
  treasuryAccounts,
  customers,
  vendors,
  currencies = DEFAULT_CURRENCIES,
  existingVoucherNumbers = [],
  paymentMethods = ['نقداً', 'شيك', 'تحويل_بنكي', 'دفع_إلكتروني'],
  currentBranch,
  currencySymbol,
  onBatchSubmit,
  onNotify,
}) => {
  const defaultDate = new Date().toISOString().split('T')[0];
  const gridBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getRateForCurrency = (code: CurrencyCode): number => {
    const c = currencies.find((x) => x.code === code);
    return c ? c.exchangeRate : 1;
  };

  const createInitialRow = (overrideType: 'قبض' | 'صرف' = 'قبض'): BatchRowState => {
    const defaultTreasury = treasuryAccounts[0];
    const curr: CurrencyCode = defaultTreasury?.currency || 'YER';
    return {
      rowId: `bvr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: overrideType,
      entityType: overrideType === 'قبض' ? 'عميل' : 'مورد',
      entityId: overrideType === 'قبض' ? customers[0]?.id || '' : vendors[0]?.id || '',
      entityName:
        overrideType === 'قبض'
          ? customers[0]?.nameAr || 'عميل نقدي'
          : vendors[0]?.nameAr || 'مورد رئيسي',
      statement: overrideType === 'قبض' ? 'دفعة نقدية مسددة تحت الحساب' : 'دفعة نقدية مسددة للمورد',
      treasuryAccountId: defaultTreasury?.id || '',
      amount: overrideType === 'قبض' ? 50000 : 40000,
      currency: curr,
      exchangeRate: getRateForCurrency(curr),
      date: defaultDate,
      paymentMethod: (paymentMethods[0] as PaymentVoucher['paymentMethod']) || 'نقداً',
      checkOrTransferRef: '',
    };
  };

  const [rows, setRows] = useState<BatchRowState[]>([
    createInitialRow('قبض'),
    createInitialRow('صرف'),
  ]);

  if (!isOpen) return null;

  const handleAddRow = () => {
    setFormError('');
    setRows((prev) => [...prev, createInitialRow('قبض')]);
  };

  const handleRemoveRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDuplicateRow = (index: number) => {
    const rowToCopy = rows[index];
    const newRow: BatchRowState = {
      ...rowToCopy,
      rowId: `bvr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    setRows((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, newRow);
      return next;
    });
  };

  const handleRowChange = <K extends keyof BatchRowState>(
    index: number,
    field: K,
    value: BatchRowState[K]
  ) => {
    setFormError('');
    setRows((prev) => {
      const updated = [...prev];
      const row = { ...updated[index], [field]: value };

      if (field === 'entityType') {
        if (value === 'عميل') {
          row.entityId = customers[0]?.id || '';
          row.entityName = customers[0]?.nameAr || '';
          if (row.type === 'قبض') row.statement = 'دفعة نقدية مسددة من العميل';
        } else if (value === 'مورد') {
          row.entityId = vendors[0]?.id || '';
          row.entityName = vendors[0]?.nameAr || '';
          if (row.type === 'صرف') row.statement = 'دفعة نقدية مسددة للمورد';
        } else {
          row.entityId = undefined;
          row.entityName = value === 'موظف' ? 'سلفة / مستحق موظف' : 'مصروفات تشغيلية / طرف آخر';
        }
      }

      if (field === 'entityId') {
        if (row.entityType === 'عميل') {
          row.entityName = customers.find((c) => c.id === value)?.nameAr || '';
        } else if (row.entityType === 'مورد') {
          row.entityName = vendors.find((v) => v.id === value)?.nameAr || '';
        }
      }

      if (field === 'treasuryAccountId') {
        const tr = treasuryAccounts.find((t) => t.id === value);
        if (tr) {
          row.currency = tr.currency;
          row.exchangeRate = getRateForCurrency(tr.currency);
        }
      }

      if (field === 'currency') {
        row.exchangeRate = getRateForCurrency(value as CurrencyCode);
      }

      updated[index] = row;
      return updated;
    });
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLElement>, rowIdx: number, colIdx: number) => {
    if (!gridBodyRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const targetRow = e.key === 'ArrowDown' ? rowIdx + 1 : rowIdx - 1;
      const targetEl = gridBodyRef.current.querySelector<HTMLElement>(
        `[data-bgrid-row="${targetRow}"][data-bgrid-col="${colIdx}"]`
      );
      if (targetEl) {
        e.preventDefault();
        targetEl.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nextColEl = gridBodyRef.current.querySelector<HTMLElement>(
        `[data-bgrid-row="${rowIdx}"][data-bgrid-col="${colIdx + 1}"]`
      );
      if (nextColEl) {
        nextColEl.focus();
      } else {
        const nextRowEl = gridBodyRef.current.querySelector<HTMLElement>(
          `[data-bgrid-row="${rowIdx + 1}"][data-bgrid-col="0"]`
        );
        if (nextRowEl) {
          nextRowEl.focus();
        } else {
          handleAddRow();
        }
      }
    }
  };

  // Real-time totals in Base Currency (YER)
  const totalReceiptsBase = rows
    .filter((r) => r.type === 'قبض')
    .reduce((sum, r) => sum + (Number(r.amount) || 0) * (Number(r.exchangeRate) || 1), 0);

  const totalDisbursementsBase = rows
    .filter((r) => r.type === 'صرف')
    .reduce((sum, r) => sum + (Number(r.amount) || 0) * (Number(r.exchangeRate) || 1), 0);

  const netCashChangeBase = totalReceiptsBase - totalDisbursementsBase;

  const handleSubmitAll = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const invalidRowIdx = rows.findIndex(
      (r) =>
        !r.amount ||
        Number(r.amount) <= 0 ||
        !r.exchangeRate ||
        Number(r.exchangeRate) <= 0 ||
        !r.statement.trim() ||
        !r.treasuryAccountId
    );
    if (invalidRowIdx !== -1) {
      const msg = `يرجى مراجعة السطر رقم ${invalidRowIdx + 1}: تأكد من الخزينة، المبلغ (> 0)، سعر الصرف (> 0)، والبيان.`;
      setFormError(msg);
      onNotify?.('error', msg);
      return;
    }

    setIsSubmitting(true);
    try {
      const year = new Date().getFullYear();
      const runningNumbers = [...existingVoucherNumbers];

      const vouchersToPost: PaymentVoucher[] = rows.map((r, idx) => {
        const prefix = r.type === 'قبض' ? `RV-${year}-` : `PV-${year}-`;
        const nextNum = generateNextDocNumber(prefix, runningNumbers, 4);
        runningNumbers.push(nextNum);

        const treasury = treasuryAccounts.find((t) => t.id === r.treasuryAccountId) || treasuryAccounts[0];
        const amt = Number(r.amount);
        const rate = Number(r.exchangeRate) || 1;
        const baseAmount = Math.round(amt * rate * 100) / 100;

        return {
          id: `v-batch-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          voucherNumber: nextNum,
          type: r.type,
          date: r.date || defaultDate,
          branchId: currentBranch.id,
          treasuryAccountId: r.treasuryAccountId || treasury?.id || '',
          treasuryAccountName: treasury?.nameAr || 'الخزينة الرئيسية',
          entityType: r.entityType,
          entityId: r.entityId,
          entityName: r.entityName || (r.type === 'قبض' ? 'عميل نقدي' : 'مورد عام'),
          amount: amt,
          currency: r.currency || 'YER',
          exchangeRate: rate,
          baseAmount,
          paymentMethod: r.paymentMethod,
          statement: r.statement.trim(),
          checkNumber: r.checkOrTransferRef?.trim() || undefined,
          status: 'posted',
          receivedOrPaidBy: 'أمين الصندوق (إدخال جماعي)',
          createdBy: 'المحاسب المالي',
          createdAt: new Date().toISOString(),
        };
      });

      onBatchSubmit(vouchersToPost);
      onNotify?.('success', `تم ترحيل ${vouchersToPost.length} سنداً جماعياً بنجاح مع القيود المحاسبية.`);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto no-print">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-7xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
              <Layers className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-black text-white">إدخال السندات الجماعي (Batch Voucher Entry)</h2>
              <p className="text-xs text-slate-400">
                دعم تعدد العملات وسعر الصرف لكل سطر · تنقل بالأسهم ↑↓ و Enter · ترقيم تسلسلي وترحيل ذري مزدوج
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-time Summary Bar */}
        <div className="px-5 py-3 bg-slate-950/60 border-b border-slate-800/80 grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">عدد السندات:</span>
            <span className="font-mono font-bold text-white text-sm tabular-nums">{rows.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">إجمالي المقبوضات (بالعملة الأساسية):</span>
            <span className="font-mono font-black text-emerald-400 text-sm tabular-nums">
              +{totalReceiptsBase.toLocaleString()} {currencySymbol}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">إجمالي المدفوعات (بالعملة الأساسية):</span>
            <span className="font-mono font-black text-rose-400 text-sm tabular-nums">
              -{totalDisbursementsBase.toLocaleString()} {currencySymbol}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">صافي الأثر النقدي الأساسي:</span>
            <span
              className={`font-mono font-black text-sm tabular-nums ${
                netCashChangeBase >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {netCashChangeBase >= 0 ? `+${netCashChangeBase.toLocaleString()}` : netCashChangeBase.toLocaleString()}{' '}
              {currencySymbol}
            </span>
          </div>
        </div>

        {formError && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-rose-950/70 border border-rose-700/60 text-rose-200 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Interactive Grid Table */}
        <form onSubmit={handleSubmitAll} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto p-4">
            <table className="w-full text-right text-xs border-collapse min-w-[1120px]">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-2 w-8 text-center">#</th>
                  <th className="py-2.5 px-2 w-24">النوع</th>
                  <th className="py-2.5 px-2 w-24">نوع الطرف</th>
                  <th className="py-2.5 px-2 w-44">الطرف / الحساب</th>
                  <th className="py-2.5 px-2 w-48">البيان والشرح</th>
                  <th className="py-2.5 px-2 w-36">الخزينة / الحساب</th>
                  <th className="py-2.5 px-2 w-28">طريقة السداد</th>
                  <th className="py-2.5 px-2 w-28 text-left">المبلغ</th>
                  <th className="py-2.5 px-2 w-20">العملة</th>
                  <th className="py-2.5 px-2 w-20 text-left">الصرف</th>
                  <th className="py-2.5 px-2 w-28 text-left">المقابل الأساسي</th>
                  <th className="py-2.5 px-2 w-28">التاريخ</th>
                  <th className="py-2.5 px-2 w-16 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody ref={gridBodyRef} className="divide-y divide-slate-800 font-sans">
                {rows.map((row, idx) => {
                  const basePreview = Math.round((Number(row.amount) || 0) * (Number(row.exchangeRate) || 1) * 100) / 100;
                  return (
                    <tr key={row.rowId} className="hover:bg-slate-800/40">
                      <td className="py-2 px-2 text-center text-slate-500 font-mono">{idx + 1}</td>

                      <td className="py-2 px-2">
                        <select
                          value={row.type}
                          data-bgrid-row={idx}
                          data-bgrid-col={0}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 0)}
                          onChange={(e) => handleRowChange(idx, 'type', e.target.value as 'قبض' | 'صرف')}
                          className={`w-full py-1.5 px-2 rounded-lg font-bold text-xs focus:outline-none cursor-pointer border ${
                            row.type === 'قبض'
                              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                              : 'bg-rose-950/40 border-rose-800/60 text-rose-400'
                          }`}
                        >
                          <option value="قبض" className="bg-slate-900 text-emerald-400">سند قبض</option>
                          <option value="صرف" className="bg-slate-900 text-rose-400">سند صرف</option>
                        </select>
                      </td>

                      <td className="py-2 px-2">
                        <select
                          value={row.entityType}
                          data-bgrid-row={idx}
                          data-bgrid-col={1}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 1)}
                          onChange={(e) => handleRowChange(idx, 'entityType', e.target.value as BatchVoucherRow['entityType'])}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                          <option value="عميل">عميل</option>
                          <option value="مورد">مورد</option>
                          <option value="موظف">موظف</option>
                          <option value="مصروف">مصروف</option>
                          <option value="إيراد">إيراد</option>
                          <option value="أخرى">طرف آخر</option>
                        </select>
                      </td>

                      <td className="py-2 px-2">
                        {row.entityType === 'عميل' ? (
                          <div className="space-y-1">
                            <select
                              value={row.entityId || ''}
                              data-bgrid-row={idx}
                              data-bgrid-col={2}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 2)}
                              onChange={(e) => handleRowChange(idx, 'entityId', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-white font-bold text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                            >
                              {customers.map((c) => (
                                <option key={c.id} value={c.id}>{c.nameAr} ({c.code})</option>
                              ))}
                            </select>
                            {(() => {
                              const c = customers.find((x) => x.id === row.entityId);
                              if (!c) return null;
                              const nextBal = row.type === 'قبض' ? c.currentBalance - basePreview : c.currentBalance + basePreview;
                              return (
                                <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-1 tabular-nums">
                                  <span>سابق: {c.currentBalance.toLocaleString()}</span>
                                  <span className={nextBal < 0 ? 'text-emerald-400' : 'text-amber-300'}>
                                    جديد: {nextBal.toLocaleString()}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        ) : row.entityType === 'مورد' ? (
                          <div className="space-y-1">
                            <select
                              value={row.entityId || ''}
                              data-bgrid-row={idx}
                              data-bgrid-col={2}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 2)}
                              onChange={(e) => handleRowChange(idx, 'entityId', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-white font-bold text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                            >
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>{v.nameAr} ({v.code})</option>
                              ))}
                            </select>
                            {(() => {
                              const v = vendors.find((x) => x.id === row.entityId);
                              if (!v) return null;
                              const nextBal = row.type === 'صرف' ? v.currentBalance - basePreview : v.currentBalance + basePreview;
                              return (
                                <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-1 tabular-nums">
                                  <span>سابق: {v.currentBalance.toLocaleString()}</span>
                                  <span className="text-amber-300">جديد: {nextBal.toLocaleString()}</span>
                                </div>
                              );
                            })()}
                          </div>
                        ) : (
                          <input
                            type="text"
                            data-bgrid-row={idx}
                            data-bgrid-col={2}
                            onKeyDown={(e) => handleGridKeyDown(e, idx, 2)}
                            value={row.entityName}
                            onChange={(e) => handleRowChange(idx, 'entityName', e.target.value)}
                            placeholder="اسم الطرف أو الحساب"
                            className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-white text-xs focus:border-amber-500 focus:outline-none"
                          />
                        )}
                      </td>

                      <td className="py-2 px-2">
                        <input
                          type="text"
                          data-bgrid-row={idx}
                          data-bgrid-col={3}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 3)}
                          value={row.statement}
                          onChange={(e) => handleRowChange(idx, 'statement', e.target.value)}
                          placeholder="بيان السند بالتفصيل..."
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
                        />
                      </td>

                      <td className="py-2 px-2">
                        <select
                          value={row.treasuryAccountId}
                          data-bgrid-row={idx}
                          data-bgrid-col={4}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 4)}
                          onChange={(e) => handleRowChange(idx, 'treasuryAccountId', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-slate-300 text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                          {treasuryAccounts.map((t) => (
                            <option key={t.id} value={t.id}>{t.nameAr} ({t.currency})</option>
                          ))}
                        </select>
                      </td>

                      <td className="py-2 px-2">
                        <select
                          value={row.paymentMethod}
                          data-bgrid-row={idx}
                          data-bgrid-col={5}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 5)}
                          onChange={(e) => handleRowChange(idx, 'paymentMethod', e.target.value as PaymentVoucher['paymentMethod'])}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-slate-300 text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                          {paymentMethods.map((pm) => (
                            <option key={pm} value={pm}>{pm.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      </td>

                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          data-bgrid-row={idx}
                          data-bgrid-col={6}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 6)}
                          value={row.amount}
                          onChange={(e) => handleRowChange(idx, 'amount', Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-2 rounded-lg text-left font-mono font-bold text-white text-xs focus:border-amber-500 focus:outline-none tabular-nums"
                        />
                      </td>

                      <td className="py-2 px-2">
                        <select
                          value={row.currency}
                          data-bgrid-row={idx}
                          data-bgrid-col={7}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 7)}
                          onChange={(e) => handleRowChange(idx, 'currency', e.target.value as CurrencyCode)}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-1.5 rounded-lg text-amber-300 font-mono font-bold text-xs focus:border-amber-500 focus:outline-none cursor-pointer"
                        >
                          {currencies.map((c) => (
                            <option key={c.code} value={c.code}>{c.code}</option>
                          ))}
                        </select>
                      </td>

                      <td className="py-2 px-2">
                        <input
                          type="number"
                          min="0.0001"
                          step="any"
                          data-bgrid-row={idx}
                          data-bgrid-col={8}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 8)}
                          value={row.exchangeRate}
                          onChange={(e) => handleRowChange(idx, 'exchangeRate', Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-1.5 rounded-lg text-left font-mono text-slate-200 text-xs focus:border-amber-500 focus:outline-none tabular-nums"
                        />
                      </td>

                      <td className="py-2 px-2 text-left font-mono font-bold text-amber-400 tabular-nums whitespace-nowrap">
                        {basePreview.toLocaleString()} {currencySymbol}
                      </td>

                      <td className="py-2 px-2">
                        <input
                          type="date"
                          data-bgrid-row={idx}
                          data-bgrid-col={9}
                          onKeyDown={(e) => handleGridKeyDown(e, idx, 9)}
                          value={row.date}
                          onChange={(e) => handleRowChange(idx, 'date', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 py-1.5 px-1.5 rounded-lg text-slate-300 font-mono text-[11px] focus:outline-none cursor-pointer"
                        />
                      </td>

                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDuplicateRow(idx)}
                            title="تكرار السطر"
                            className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(idx)}
                            disabled={rows.length <= 1}
                            title="حذف السطر"
                            className={`p-1 rounded transition-colors cursor-pointer ${
                              rows.length <= 1
                                ? 'text-slate-600 cursor-not-allowed'
                                : 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer Actions */}
          <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAddRow}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span>إضافة سطر سند جديد</span>
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center gap-1.5 px-5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl shadow-lg transition-colors cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>ترحيل وحفظ السندات جماعياً ({rows.length})</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
