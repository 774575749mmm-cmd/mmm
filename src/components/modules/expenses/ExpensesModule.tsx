/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Expenses & Cost Centers Module
 * Multi-currency aware: supports native expense currency selection, live FX preview, and base-currency aggregation.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Receipt,
  Plus,
  X,
  FileDown,
  FileSpreadsheet,
  Filter,
} from 'lucide-react';
import {
  ExpenseRecord,
  ExpenseCategory,
  CostCenter,
  TreasuryAccount,
  Branch,
  Company,
  Currency,
  CurrencyCode,
  TableColumnPref,
} from '../../../types/erp';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  downloadReportAsPDF,
  exportToExcel,
  exportToCSV,
} from '../../../services/exportService';
import {
  convertToBase,
  getEffectiveCurrencyRate,
  getCurrencySymbol,
} from '../../../services/currencyHelpers';

interface ExpensesModuleProps {
  expenses: ExpenseRecord[];
  categories: ExpenseCategory[];
  costCenters: CostCenter[];
  treasuryAccounts: TreasuryAccount[];
  currencies?: Currency[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  canPostEntries?: boolean;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  focusedRecordId?: string;
  onPostExpense: (expense: ExpenseRecord) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, isBase: true, decimalPlaces: 0 },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 142, isBase: false, decimalPlaces: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 535, isBase: false, decimalPlaces: 2 },
];

export const ExpensesModule: React.FC<ExpensesModuleProps> = ({
  expenses,
  categories,
  costCenters,
  treasuryAccounts,
  currencies = DEFAULT_CURRENCIES,
  currentBranch,
  company,
  currencySymbol,
  canPostEntries = true,
  savedColumnPrefs,
  onSaveColumnPrefs,
  focusedRecordId,
  onPostExpense,
  onNotify,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [costCenterFilter, setCostCenterFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [inspectedExpense, setInspectedExpense] = useState<ExpenseRecord | null>(null);

  // Form State
  const [selectedCatId, setSelectedCatId] = useState(categories[0]?.id || '');
  const [selectedCostCenterId, setSelectedCostCenterId] = useState(costCenters[0]?.id || '');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState(treasuryAccounts[0]?.id || '');
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode>(
    treasuryAccounts[0]?.currency || 'YER'
  );
  const [beneficiary, setBeneficiary] = useState('');
  const [amount, setAmount] = useState(50000);
  const [statement, setStatement] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (focusedRecordId) {
      const target = expenses.find((e) => e.id === focusedRecordId);
      if (target) setInspectedExpense(target);
    }
  }, [focusedRecordId, expenses]);

  const toBaseAmount = (exp: ExpenseRecord) =>
    convertToBase(exp.total || exp.amount || 0, exp.currency || 'YER', currencies);

  const selectedFxRate = getEffectiveCurrencyRate(currencies, selectedCurrency);
  const previewBaseAmount = Math.round((Number(amount) || 0) * selectedFxRate * 100) / 100;

  const handleTreasuryChange = (trId: string) => {
    setSelectedTreasuryId(trId);
    const tr = treasuryAccounts.find((t) => t.id === trId);
    if (tr?.currency) setSelectedCurrency(tr.currency);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPostEntries) {
      onNotify?.('error', 'صلاحياتك الحالية لا تسمح بترحيل مصروفات مالية.');
      return;
    }
    if (amount <= 0 || !statement.trim()) {
      onNotify?.('error', 'يرجى إدخال المبلغ الصحيح وبيان المصروف.');
      return;
    }

    const cat = categories.find((c) => c.id === selectedCatId);
    const cc = costCenters.find((c) => c.id === selectedCostCenterId);
    const tr = treasuryAccounts.find((t) => t.id === selectedTreasuryId);

    const year = new Date().getFullYear();
    const expenseNumber = generateNextDocNumber(
      `EXP-${year}-`,
      expenses.map((x) => x.expenseNumber),
      4
    );

    const newExpense: ExpenseRecord = {
      id: `exp-${Date.now()}`,
      expenseNumber,
      date: expenseDate,
      branchId: currentBranch.id,
      categoryId: selectedCatId,
      categoryName: cat?.nameAr || 'مصروف عام',
      treasuryAccountId: selectedTreasuryId,
      treasuryAccountName: tr?.nameAr || 'الصندوق الرئيسي',
      costCenterId: selectedCostCenterId,
      costCenterName: cc?.nameAr,
      amount: Number(amount),
      currency: selectedCurrency || tr?.currency || 'YER',
      taxAmount: 0,
      total: Number(amount),
      beneficiary: beneficiary.trim() || 'جهة الصرف',
      statement: statement.trim(),
      createdBy: 'محاسب',
    };

    onPostExpense(newExpense);
    onNotify?.(
      'success',
      `تم صرف المصروف رقم ${expenseNumber} (${Number(amount).toLocaleString()} ${newExpense.currency}) وترحيل قيده المحاسبي.`
    );
    setIsModalOpen(false);
    setStatement('');
    setBeneficiary('');
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      if (categoryFilter !== 'all' && exp.categoryId !== categoryFilter) return false;
      if (costCenterFilter !== 'all' && exp.costCenterId !== costCenterFilter) return false;
      if (currencyFilter !== 'ALL' && (exp.currency || 'YER') !== currencyFilter) return false;
      if (startDate && exp.date < startDate) return false;
      if (endDate && exp.date > endDate) return false;
      return true;
    });
  }, [expenses, categoryFilter, costCenterFilter, currencyFilter, startDate, endDate]);

  const totalExpensesBase = filteredExpenses.reduce((s, e) => s + toBaseAmount(e), 0);

  const columns: ErpTableColumn<ExpenseRecord>[] = useMemo(
    () => [
      {
        key: 'expenseNumber',
        label: 'رقم المصروف',
        sortable: true,
        sortValue: (r) => r.expenseNumber,
        searchValue: (r) => r.expenseNumber,
        render: (r) => <span className="font-mono font-bold text-amber-400">{r.expenseNumber}</span>,
      },
      {
        key: 'date',
        label: 'التاريخ',
        sortable: true,
        sortValue: (r) => r.date,
        render: (r) => <span className="font-mono text-slate-400">{r.date}</span>,
      },
      {
        key: 'categoryName',
        label: 'بند المصروف',
        sortable: true,
        sortValue: (r) => r.categoryName,
        searchValue: (r) => r.categoryName,
        render: (r) => <span className="font-semibold text-slate-200">{r.categoryName}</span>,
      },
      {
        key: 'costCenterName',
        label: 'مركز التكلفة',
        sortable: true,
        sortValue: (r) => r.costCenterName || '',
        searchValue: (r) => r.costCenterName || '',
        render: (r) => <span className="text-slate-300">{r.costCenterName || '-'}</span>,
      },
      {
        key: 'beneficiary',
        label: 'المستفيد',
        sortable: true,
        sortValue: (r) => r.beneficiary,
        searchValue: (r) => r.beneficiary,
        render: (r) => <span className="text-slate-100">{r.beneficiary}</span>,
      },
      {
        key: 'statement',
        label: 'البيان والشرح',
        searchValue: (r) => r.statement,
        render: (r) => <span className="text-slate-400">{r.statement}</span>,
      },
      {
        key: 'treasuryAccountName',
        label: 'حساب الصرف',
        sortable: true,
        sortValue: (r) => r.treasuryAccountName,
        searchValue: (r) => `${r.treasuryAccountName} ${r.currency}`,
        render: (r) => <span className="text-slate-400">{r.treasuryAccountName}</span>,
      },
      {
        key: 'total',
        label: `المبلغ / المعادل (${currencySymbol})`,
        align: 'left',
        sortable: true,
        sortValue: (r) => toBaseAmount(r),
        render: (r) => {
          const base = toBaseAmount(r);
          const sym = getCurrencySymbol(currencies, r.currency);
          return (
            <div className="font-mono leading-tight tabular-nums">
              <div className="font-black text-rose-400">
                {(r.total || r.amount).toLocaleString()} {sym}
              </div>
              {r.currency !== 'YER' && (
                <div className="text-[10px] text-slate-400">
                  {base.toLocaleString()} {currencySymbol}
                </div>
              )}
            </div>
          );
        },
        footerRender: (rows) => (
          <span className="font-mono font-black text-amber-300 tabular-nums">
            {rows.reduce((s, r) => s + toBaseAmount(r), 0).toLocaleString()} {currencySymbol}
          </span>
        ),
      },
    ],
    [currencySymbol, currencies]
  );

  const handleExportPdf = async () => {
    await downloadReportAsPDF({
      title: 'سجل المصروفات التشغيلية ومراكز التكلفة',
      subtitle: `فرع: ${currentBranch.nameAr}`,
      company,
      branch: currentBranch,
      tables: [
        {
          title: 'تفاصيل المصروفات المعتمدة',
          headers: ['رقم المصروف', 'التاريخ', 'البند', 'مركز التكلفة', 'المستفيد', 'حساب الصرف', 'المبلغ', `المعادل (${currencySymbol})`],
          rows: filteredExpenses.map((e) => [
            e.expenseNumber,
            e.date,
            e.categoryName,
            e.costCenterName || '-',
            e.beneficiary,
            e.treasuryAccountName,
            `${e.total.toLocaleString()} ${e.currency}`,
            toBaseAmount(e).toLocaleString(),
          ]),
          totals: ['الإجمالي', '', '', '', '', `${filteredExpenses.length} حركة`, '', `${totalExpensesBase.toLocaleString()} ${currencySymbol}`],
        },
      ],
      fileName: `المصروفات_${new Date().toISOString().split('T')[0]}`,
    });
    onNotify?.('success', 'تم تصدير تقرير المصروفات بصيغة PDF بنجاح.');
  };

  const handleExportExcel = () => {
    exportToExcel({
      fileName: `المصروفات_${new Date().toISOString().split('T')[0]}`,
      sheets: [
        {
          name: 'المصروفات',
          data: [
            ['رقم المصروف', 'التاريخ', 'البند', 'مركز التكلفة', 'المستفيد', 'البيان', 'حساب الصرف', 'المبلغ', 'العملة', 'المعادل الأساسي'],
            ...filteredExpenses.map((e) => [
              e.expenseNumber,
              e.date,
              e.categoryName,
              e.costCenterName || '-',
              e.beneficiary,
              e.statement,
              e.treasuryAccountName,
              e.total,
              e.currency,
              toBaseAmount(e),
            ]),
          ],
        },
      ],
    });
    onNotify?.('success', 'تم تصدير ملف Excel للمصروفات بنجاح.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة المصروفات التشغيلية ومراكز التكلفة</h2>
          </div>
          <p className="text-xs text-slate-400">
            تسجيل مصروفات الفروع متعددة العملات، توزيع التكاليف على المراكز، وإنشاء القيود المحاسبية التلقائية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() =>
              exportToCSV(
                `المصروفات_${new Date().toISOString().split('T')[0]}`,
                ['رقم المصروف', 'التاريخ', 'البند', 'مركز التكلفة', 'المستفيد', 'البيان', 'حساب الصرف', 'المبلغ', 'العملة', 'المعادل الأساسي'],
                filteredExpenses.map((e) => [
                  e.expenseNumber,
                  e.date,
                  e.categoryName,
                  e.costCenterName || '-',
                  e.beneficiary,
                  e.statement,
                  e.treasuryAccountName,
                  e.total,
                  e.currency,
                  toBaseAmount(e),
                ])
              )
            }
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            CSV
          </button>
          {canPostEntries && (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل مصروف جديد</span>
            </button>
          )}
        </div>
      </div>

      {/* Cost Centers & Total Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 block mb-1">إجمالي المصروفات (المعادل الأساسي)</span>
          <span className="text-xl font-mono font-black text-rose-400 tabular-nums">
            {totalExpensesBase.toLocaleString()} {currencySymbol}
          </span>
        </div>

        {costCenters.slice(0, 3).map((cc) => {
          const ccTotal = filteredExpenses
            .filter((e) => e.costCenterId === cc.id)
            .reduce((s, e) => s + toBaseAmount(e), 0);

          return (
            <div key={cc.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <span className="text-xs font-semibold text-slate-400 block mb-1 truncate">{cc.nameAr}</span>
              <span className="text-lg font-mono font-bold text-slate-100 tabular-nums">
                {ccTotal.toLocaleString()} {currencySymbol}
              </span>
            </div>
          );
        })}
      </div>

      {/* Data Table */}
      <ErpDataTable<ExpenseRecord>
        tableId="expenses-records"
        title="سجل المصروفات التشغيلية"
        data={filteredExpenses}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="بحث برقم المصروف، المستفيد، البيان، البند..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        onRowClick={(r) => setInspectedExpense(r)}
        defaultSortKey="date"
        defaultSortDir="desc"
        filtersSlot={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Filter className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 cursor-pointer"
            >
              <option value="all">كل البنود</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.nameAr}</option>
              ))}
            </select>
            <select
              value={costCenterFilter}
              onChange={(e) => setCostCenterFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 cursor-pointer"
            >
              <option value="all">كل مراكز التكلفة</option>
              {costCenters.map((cc) => (
                <option key={cc.id} value={cc.id}>{cc.nameAr}</option>
              ))}
            </select>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 cursor-pointer"
            >
              <option value="ALL">كل العملات</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 font-mono"
              title="من تاريخ"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 font-mono"
              title="إلى تاريخ"
            />
          </div>
        }
      />

      {/* INSPECT MODAL */}
      {inspectedExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden text-xs">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-white">تفاصيل مصروف: {inspectedExpense.expenseNumber}</h3>
              <button
                type="button"
                onClick={() => setInspectedExpense(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-slate-300">
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">التاريخ:</span>
                <strong className="font-mono text-white">{inspectedExpense.date}</strong>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">بند المصروف:</span>
                <strong className="text-amber-300">{inspectedExpense.categoryName}</strong>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">مركز التكلفة:</span>
                <strong>{inspectedExpense.costCenterName || '-'}</strong>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">المستفيد:</span>
                <strong>{inspectedExpense.beneficiary}</strong>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">حساب الصرف:</span>
                <strong>{inspectedExpense.treasuryAccountName}</strong>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-2">
                <span className="text-slate-400">المبلغ بالعملة:</span>
                <strong className="font-mono text-rose-400 text-sm tabular-nums">
                  {inspectedExpense.total.toLocaleString()} {getCurrencySymbol(currencies, inspectedExpense.currency)} ({inspectedExpense.currency})
                </strong>
              </div>
              {inspectedExpense.currency !== 'YER' && (
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-400">المعادل الأساسي:</span>
                  <strong className="font-mono text-amber-300 tabular-nums">
                    {toBaseAmount(inspectedExpense).toLocaleString()} {currencySymbol}
                  </strong>
                </div>
              )}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-500 block mb-1">البيان:</span>
                <p className="text-slate-200">{inspectedExpense.statement}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW EXPENSE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">تسجيل مصروف تشغيلي جديد</h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">بند المصروف *</label>
                  <select
                    value={selectedCatId}
                    onChange={(e) => setSelectedCatId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">مركز التكلفة *</label>
                  <select
                    value={selectedCostCenterId}
                    onChange={(e) => setSelectedCostCenterId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الصندوق / الحساب المصروف منه *</label>
                  <select
                    value={selectedTreasuryId}
                    onChange={(e) => handleTreasuryChange(e.target.value)}
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
                  <label className="block text-slate-300 font-semibold mb-1">تاريخ المصروف *</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">عملة المصروف *</label>
                  <select
                    value={selectedCurrency}
                    onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-amber-300 font-bold focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.nameAr})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    المبلغ ({getCurrencySymbol(currencies, selectedCurrency)}) *
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    required
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-sm focus:outline-none focus:border-amber-500 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">المعادل ({currencySymbol})</label>
                  <div className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-emerald-300 font-mono font-bold text-sm tabular-nums">
                    {previewBaseAmount.toLocaleString()}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">المستفيد / جهة الصرف</label>
                <input
                  type="text"
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                  placeholder="مثال: المؤسسة العامة للاتصالات"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">البيان والشرح *</label>
                <textarea
                  rows={2}
                  required
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  placeholder="وذلك مقابل..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  صرف المصروف وترحيل القيد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
