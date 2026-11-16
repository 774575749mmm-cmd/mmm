/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Fixed Assets & Depreciation Module
 */

import React, { useState, useMemo } from 'react';
import {
  Landmark,
  Plus,
  Calculator,
  X,
  FileDown,
  FileSpreadsheet,
} from 'lucide-react';
import {
  FixedAsset,
  Branch,
  Company,
  TableColumnPref,
  TreasuryAccount,
} from '../../../types/erp';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { generateNextDocNumber } from '../../../services/storageService';
import { downloadReportAsPDF, exportToExcel } from '../../../services/exportService';

interface FixedAssetsModuleProps {
  fixedAssets: FixedAsset[];
  treasuryAccounts?: TreasuryAccount[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  canPostEntries?: boolean;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveAsset: (asset: FixedAsset) => void;
  onRunDepreciation: (totalDepreciation: number) => void;
  onDisposeAsset?: (
    assetId: string,
    saleProceeds: number,
    treasuryId: string,
    disposalDate: string,
    notes?: string
  ) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const FixedAssetsModule: React.FC<FixedAssetsModuleProps> = ({
  fixedAssets,
  treasuryAccounts = [],
  currentBranch,
  company,
  currencySymbol,
  canPostEntries = true,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onSaveAsset,
  onRunDepreciation,
  onDisposeAsset,
  onNotify,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isNewAssetModalOpen, setIsNewAssetModalOpen] = useState(false);

  // Asset Disposal Modal State
  const [disposalTarget, setDisposalTarget] = useState<FixedAsset | null>(null);
  const [disposalProceeds, setDisposalProceeds] = useState(0);
  const [disposalTreasuryId, setDisposalTreasuryId] = useState(treasuryAccounts[0]?.id || '');
  const [disposalDate, setDisposalDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [disposalNotes, setDisposalNotes] = useState('');

  // Form State
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState<FixedAsset['category']>('أجهزة_إلكترونية');
  const [purchaseCost, setPurchaseCost] = useState(1500000);
  const [salvageValue, setSalvageValue] = useState(150000);
  const [usefulLifeMonths, setUsefulLifeMonths] = useState(36);

  const handleSaveAssetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) {
      onNotify?.('error', 'يرجى إدخال اسم الأصل الثابت.');
      return;
    }

    const cost = Number(purchaseCost) || 0;
    const code = generateNextDocNumber(
      'AST-',
      fixedAssets.map((a) => a.code),
      3
    );

    const newAsset: FixedAsset = {
      id: `ast-${Date.now()}`,
      code,
      nameAr: nameAr.trim(),
      category,
      purchaseDate: new Date().toISOString().split('T')[0],
      purchaseCost: cost,
      salvageValue: Number(salvageValue) || 0,
      usefulLifeMonths: Number(usefulLifeMonths) || 36,
      depreciationMethod: 'STRAIGHT_LINE',
      assetAccountId: 'acc-1210',
      accumulatedDepreciationAccountId: 'acc-1290',
      depreciationExpenseAccountId: 'acc-5410',
      currentBookValue: cost,
      totalAccumulatedDepreciation: 0,
      status: 'active',
    };

    onSaveAsset(newAsset);
    onNotify?.('success', `تم تسجيل الأصل الثابت "${newAsset.nameAr}" بكود (${code}) بنجاح.`);
    setIsNewAssetModalOpen(false);
    setNameAr('');
  };

  const handleRunMonthlyDepreciation = () => {
    if (!canPostEntries) {
      onNotify?.('error', 'صلاحياتك الحالية لا تسمح بترحيل قيود الإهلاك.');
      return;
    }

    let totalMonthDepr = 0;
    for (const a of fixedAssets) {
      if (a.status === 'active' && a.currentBookValue > a.salvageValue) {
        const depreciable = Math.max(0, a.purchaseCost - a.salvageValue);
        const monthlyAmount = Math.min(
          a.currentBookValue - a.salvageValue,
          Math.round(depreciable / (a.usefulLifeMonths || 48))
        );
        totalMonthDepr += Math.max(0, monthlyAmount);
      }
    }

    if (totalMonthDepr <= 0) {
      onNotify?.('info', 'جميع الأصول مستهلكة بالكامل أو بلغت قيمتها التخريدية.');
      return;
    }

    onRunDepreciation(totalMonthDepr);
    onNotify?.(
      'success',
      `تم احتساب وترحيل إهلاك الشهر الحالي بمبلغ (${totalMonthDepr.toLocaleString()} ${currencySymbol}) وتحديث القيمة الدفترية.`
    );
  };

  const filteredAssets = useMemo(() => {
    return fixedAssets.filter((a) => categoryFilter === 'all' || a.category === categoryFilter);
  }, [fixedAssets, categoryFilter]);

  const totalCost = fixedAssets.reduce((s, a) => s + a.purchaseCost, 0);
  const totalAccDepr = fixedAssets.reduce((s, a) => s + a.totalAccumulatedDepreciation, 0);
  const totalBookVal = fixedAssets.reduce((s, a) => s + a.currentBookValue, 0);

  const columns: ErpTableColumn<FixedAsset>[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'كود الأصل',
        sortable: true,
        sortValue: (a) => a.code,
        searchValue: (a) => a.code,
        render: (a) => <span className="font-mono font-bold text-amber-400">{a.code}</span>,
      },
      {
        key: 'nameAr',
        label: 'اسم الأصل الثابت',
        sortable: true,
        sortValue: (a) => a.nameAr,
        searchValue: (a) => a.nameAr,
        render: (a) => <span className="font-semibold text-slate-100">{a.nameAr}</span>,
      },
      {
        key: 'category',
        label: 'التصنيف',
        sortable: true,
        sortValue: (a) => a.category,
        render: (a) => <span className="text-slate-300">{a.category.replace(/_/g, ' ')}</span>,
      },
      {
        key: 'purchaseDate',
        label: 'تاريخ الشراء',
        sortable: true,
        sortValue: (a) => a.purchaseDate,
        render: (a) => <span className="font-mono text-slate-400">{a.purchaseDate}</span>,
      },
      {
        key: 'usefulLifeMonths',
        label: 'العمر (شهر)',
        align: 'center',
        sortable: true,
        sortValue: (a) => a.usefulLifeMonths,
        render: (a) => <span className="font-mono text-slate-300">{a.usefulLifeMonths}</span>,
      },
      {
        key: 'purchaseCost',
        label: 'تكلفة الشراء',
        align: 'left',
        sortable: true,
        sortValue: (a) => a.purchaseCost,
        render: (a) => <span className="font-mono text-slate-200">{a.purchaseCost.toLocaleString()}</span>,
        footerRender: (rows) => (
          <span className="font-mono font-bold text-slate-200">
            {rows.reduce((s, r) => s + r.purchaseCost, 0).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'totalAccumulatedDepreciation',
        label: 'مجمع الإهلاك',
        align: 'left',
        sortable: true,
        sortValue: (a) => a.totalAccumulatedDepreciation,
        render: (a) => (
          <span className="font-mono text-rose-400">{a.totalAccumulatedDepreciation.toLocaleString()}</span>
        ),
        footerRender: (rows) => (
          <span className="font-mono font-bold text-rose-300">
            {rows.reduce((s, r) => s + r.totalAccumulatedDepreciation, 0).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'currentBookValue',
        label: `صافي القيمة الدفترية (${currencySymbol})`,
        align: 'left',
        sortable: true,
        sortValue: (a) => a.currentBookValue,
        render: (a) => <span className="font-mono font-bold text-emerald-400">{a.currentBookValue.toLocaleString()}</span>,
        footerRender: (rows) => (
          <span className="font-mono font-black text-emerald-300">
            {rows.reduce((s, r) => s + r.currentBookValue, 0).toLocaleString()} {currencySymbol}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        render: (a) => (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              a.status === 'active'
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/40'
                : a.status === 'maintenance'
                ? 'bg-amber-950 text-amber-400 border-amber-800/40'
                : 'bg-rose-950 text-rose-400 border-rose-800/40'
            }`}
          >
            {a.status === 'active' ? 'نشط ويعمل' : a.status === 'maintenance' ? 'صيانة' : 'مستبعد'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'إجراء',
        align: 'center',
        render: (a) =>
          a.status === 'active' && canPostEntries && onDisposeAsset ? (
            <button
              type="button"
              onClick={() => {
                setDisposalTarget(a);
                setDisposalProceeds(a.currentBookValue);
                setDisposalTreasuryId(treasuryAccounts[0]?.id || '');
                setDisposalNotes('');
              }}
              className="px-2 py-1 rounded bg-rose-950/70 hover:bg-rose-900 border border-rose-700/60 text-rose-300 text-[10px] font-bold cursor-pointer"
            >
              استبعاد / بيع
            </button>
          ) : (
            <span className="text-slate-500 text-[10px]">-</span>
          ),
      },
    ],
    [currencySymbol, canPostEntries, onDisposeAsset, treasuryAccounts]
  );

  const handleExportPdf = async () => {
    await downloadReportAsPDF({
      title: 'سجل الأصول الثابتة ومجمع الإهلاك',
      company,
      branch: currentBranch,
      tables: [
        {
          title: 'كشف الأصول الثابتة',
          headers: ['الكود', 'الأصل', 'التصنيف', 'تاريخ الشراء', 'التكلفة', 'مجمع الإهلاك', 'القيمة الدفترية'],
          rows: filteredAssets.map((a) => [
            a.code,
            a.nameAr,
            a.category.replace(/_/g, ' '),
            a.purchaseDate,
            a.purchaseCost.toLocaleString(),
            a.totalAccumulatedDepreciation.toLocaleString(),
            a.currentBookValue.toLocaleString(),
          ]),
          totals: [
            'الإجمالي',
            '',
            '',
            '',
            totalCost.toLocaleString(),
            totalAccDepr.toLocaleString(),
            `${totalBookVal.toLocaleString()} ${currencySymbol}`,
          ],
        },
      ],
      fileName: `الأصول_الثابتة_${new Date().toISOString().split('T')[0]}`,
    });
    onNotify?.('success', 'تم تصدير سجل الأصول بصيغة PDF بنجاح.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Landmark className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة الأصول الثابتة والإهلاك</h2>
          </div>
          <p className="text-xs text-slate-400">
            سجل الأصول، العمر الإنتاجي، القسط الثابت، وإثبات قيود الإهلاك الدورية آلياً
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={() => {
              exportToExcel({
                fileName: `الأصول_الثابتة_${new Date().toISOString().split('T')[0]}`,
                sheets: [
                  {
                    name: 'الأصول الثابتة',
                    data: [
                      ['الكود', 'اسم الأصل', 'التصنيف', 'تاريخ الشراء', 'العمر (شهر)', 'التكلفة', 'مجمع الإهلاك', 'القيمة الدفترية'],
                      ...filteredAssets.map((a) => [
                        a.code,
                        a.nameAr,
                        a.category.replace(/_/g, ' '),
                        a.purchaseDate,
                        a.usefulLifeMonths,
                        a.purchaseCost,
                        a.totalAccumulatedDepreciation,
                        a.currentBookValue,
                      ]),
                    ],
                  },
                ],
              });
              onNotify?.('success', 'تم تصدير كشف الأصول الثابتة إلى Excel بنجاح.');
            }}
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>
          {canPostEntries && (
            <>
              <button
                type="button"
                onClick={handleRunMonthlyDepreciation}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-amber-500/30 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Calculator className="w-4 h-4" />
                <span>احتساب وترحيل إهلاك الشهر</span>
              </button>
              <button
                type="button"
                onClick={() => setIsNewAssetModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>تسجيل أصل ثابت</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Asset Valuation Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 block mb-1">إجمالي تكلفة الشراء التاريخية</span>
          <span className="text-xl font-mono font-black text-slate-100">
            {totalCost.toLocaleString()} {currencySymbol}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 block mb-1">إجمالي مجمع الإهلاك المتراكم</span>
          <span className="text-xl font-mono font-black text-rose-400">
            {totalAccDepr.toLocaleString()} {currencySymbol}
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 block mb-1">صافي القيمة الدفترية الحالية</span>
          <span className="text-xl font-mono font-black text-emerald-400">
            {totalBookVal.toLocaleString()} {currencySymbol}
          </span>
        </div>
      </div>

      {/* Table */}
      <ErpDataTable<FixedAsset>
        tableId="fixed-assets"
        title="سجل الأصول الثابتة"
        data={filteredAssets}
        columns={columns}
        getRowId={(a) => a.id}
        searchPlaceholder="بحث بكود الأصل أو اسم الأصل..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        defaultSortKey="code"
        defaultSortDir="asc"
        filtersSlot={
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 cursor-pointer"
          >
            <option value="all">جميع التصنيفات</option>
            <option value="أجهزة_إلكترونية">أجهزة إلكترونية وتقنية</option>
            <option value="أثاث_ومفروشات">أثاث ومفروشات مكتبية</option>
            <option value="سيارات_ونقليات">سيارات ووسائل نقل</option>
            <option value="مباني">مباني وعقارات</option>
            <option value="معدات">معدات وآلات</option>
          </select>
        }
      />

      {/* MODAL: ADD ASSET */}
      {isNewAssetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">تسجيل أصل ثابت جديد</h3>
              <button
                type="button"
                onClick={() => setIsNewAssetModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAssetSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">اسم الأصل *</label>
                <input
                  type="text"
                  required
                  value={nameAr}
                  onChange={(e) => setNameAr(e.target.value)}
                  placeholder="مثال: سيارة نقل تويوتا هايلوكس"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تصنيف الأصل</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as FixedAsset['category'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="أجهزة_إلكترونية">أجهزة إلكترونية وتقنية</option>
                    <option value="أثاث_ومفروشات">أثاث ومفروشات مكتبية</option>
                    <option value="سيارات_ونقليات">سيارات ووسائل نقل</option>
                    <option value="مباني">مباني وعقارات</option>
                    <option value="معدات">معدات وآلات</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العمر الإنتاجي (بالأشهر)</label>
                  <input
                    type="number"
                    min={1}
                    value={usefulLifeMonths}
                    onChange={(e) => setUsefulLifeMonths(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تكلفة الشراء ({currencySymbol}) *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={purchaseCost}
                    onChange={(e) => setPurchaseCost(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">القيمة التخريدية المتوقعة</label>
                  <input
                    type="number"
                    min={0}
                    value={salvageValue}
                    onChange={(e) => setSalvageValue(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNewAssetModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  حفظ وتسجيل الأصل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DISPOSE / SELL ASSET */}
      {disposalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-rose-700/60 rounded-2xl w-full max-w-md shadow-2xl text-slate-100">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-sm text-rose-300">
                استبعاد أو بيع أصل ثابت: {disposalTarget.nameAr}
              </h3>
              <button type="button" onClick={() => setDisposalTarget(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                <div>التكلفة التاريخية: <strong className="font-mono">{disposalTarget.purchaseCost.toLocaleString()} {currencySymbol}</strong></div>
                <div>مجمع الإهلاك: <strong className="font-mono text-rose-300">{disposalTarget.totalAccumulatedDepreciation.toLocaleString()} {currencySymbol}</strong></div>
                <div>صافي القيمة الدفترية: <strong className="font-mono text-emerald-300">{disposalTarget.currentBookValue.toLocaleString()} {currencySymbol}</strong></div>
                <div>الربح / الخسارة الرأسمالية المتوقعة: <strong className={`font-mono ${disposalProceeds - disposalTarget.currentBookValue >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {(disposalProceeds - disposalTarget.currentBookValue).toLocaleString()} {currencySymbol}
                </strong></div>
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">عائد البيع ({currencySymbol})</label>
                <input
                  type="number"
                  min={0}
                  value={disposalProceeds}
                  onChange={(e) => setDisposalProceeds(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              {disposalProceeds > 0 && treasuryAccounts.length > 0 && (
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الخزينة / البنك المستلم</label>
                  <select
                    value={disposalTreasuryId}
                    onChange={(e) => setDisposalTreasuryId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  >
                    {treasuryAccounts.map((t) => (
                      <option key={t.id} value={t.id}>{t.nameAr} ({t.currency})</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">تاريخ الاستبعاد</label>
                <input
                  type="date"
                  value={disposalDate}
                  onChange={(e) => setDisposalDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-semibold mb-1">ملاحظات / سبب الاستبعاد</label>
                <input
                  type="text"
                  value={disposalNotes}
                  onChange={(e) => setDisposalNotes(e.target.value)}
                  placeholder="مثال: بيع أصل مستعمل أو تخريد..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDisposalTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDisposeAsset?.(
                      disposalTarget.id,
                      disposalProceeds,
                      disposalTreasuryId || treasuryAccounts[0]?.id || '',
                      disposalDate,
                      disposalNotes
                    );
                    setDisposalTarget(null);
                  }}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg cursor-pointer"
                >
                  تأكيد وترحيل الاستبعاد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
