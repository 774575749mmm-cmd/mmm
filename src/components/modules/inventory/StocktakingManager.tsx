/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Advanced Multi-Level Persistent Stocktaking Manager
 * يدعم 4 مستويات جرد ودورة حياة كاملة مع الحفظ التلقائي والترحيل المحاسبي الآلي للفروقات
 */

import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Plus,
  Layers,
  X,
  Printer,
  Download,
  ShieldCheck,
  FileSpreadsheet,
  Search,
  Ban,
  CheckCircle2,
} from 'lucide-react';
import {
  InventoryItem,
  Warehouse,
  ItemWarehouseStock,
  PhysicalStocktaking,
  StocktakingItem,
  StocktakingScope,
  StocktakingStatus,
  Company,
  Branch,
  TableColumnPref,
} from '../../../types/erp';
import { getItemStockInWarehouse } from '../../../services/inventoryEngine';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  exportToExcel,
  exportToCSV,
  downloadReportAsPDF,
  printReportPreview,
} from '../../../services/exportService';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { ConfirmModal } from '../../common/ConfirmModal';

interface StocktakingManagerProps {
  items: InventoryItem[];
  warehouses: Warehouse[];
  warehouseStock: ItemWarehouseStock[];
  currencySymbol: string;
  stocktakings: PhysicalStocktaking[];
  onSaveStocktaking: (stocktake: PhysicalStocktaking) => void;
  onApproveStocktaking: (stocktake: PhysicalStocktaking) => void;
  canAdjustInventory?: boolean;
  company?: Company;
  branch?: Branch;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const StocktakingManager: React.FC<StocktakingManagerProps> = ({
  items,
  warehouses,
  warehouseStock,
  currencySymbol,
  stocktakings,
  onSaveStocktaking,
  onApproveStocktaking,
  canAdjustInventory = true,
  company,
  branch,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onNotify,
}) => {
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [scope, setScope] = useState<StocktakingScope>('warehouse');
  const [targetWarehouseId, setTargetWarehouseId] = useState(warehouses[0]?.id || '');
  const [selectedMultiWhIds, setSelectedMultiWhIds] = useState<string[]>(
    warehouses.slice(0, 2).map((w) => w.id)
  );
  const [targetCategory, setTargetCategory] = useState(items[0]?.category || '');
  const [targetItemId, setTargetItemId] = useState(items[0]?.id || '');
  const [sessionNotes, setSessionNotes] = useState('جرد دوري فعلي للبضائع');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [itemFilterQuery, setItemFilterQuery] = useState('');
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);

  const activeSession = useMemo(
    () => stocktakings.find((s) => s.id === activeSessionId) || null,
    [stocktakings, activeSessionId]
  );

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter(Boolean))),
    [items]
  );

  const filteredSessions = useMemo(() => {
    if (statusFilter === 'all') return stocktakings;
    return stocktakings.filter((s) => s.status === statusFilter);
  }, [stocktakings, statusFilter]);

  const toggleMultiWarehouse = (whId: string) => {
    setSelectedMultiWhIds((prev) =>
      prev.includes(whId) ? prev.filter((id) => id !== whId) : [...prev, whId]
    );
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustInventory) {
      onNotify?.('error', 'ليست لديك صلاحية إنشاء أو تعديل جلسات الجرد المخزني.');
      return;
    }

    const whList =
      scope === 'multi_warehouse'
        ? warehouses.filter((w) => selectedMultiWhIds.includes(w.id))
        : warehouses.filter((w) => w.id === targetWarehouseId);

    if (whList.length === 0) {
      onNotify?.('error', 'يرجى اختيار مستودع واحد على الأقل للجرد.');
      return;
    }

    let selectedItems: InventoryItem[] = [];
    if (scope === 'single_item') {
      const it = items.find((i) => i.id === targetItemId);
      if (it) selectedItems = [it];
    } else if (scope === 'category') {
      selectedItems = items.filter((i) => i.category === targetCategory);
    } else {
      selectedItems = [...items];
    }

    if (selectedItems.length === 0) {
      onNotify?.('error', 'لا توجد أصناف مطابقة لنطاق الجرد المختار.');
      return;
    }

    const stockItems: StocktakingItem[] = [];
    for (const wh of whList) {
      for (const it of selectedItems) {
        const bookQty = getItemStockInWarehouse(warehouseStock, it.id, wh.id);
        stockItems.push({
          itemId: it.id,
          itemName: it.nameAr,
          barcode: it.barcode,
          category: it.category,
          unit: it.baseUnit,
          warehouseId: wh.id,
          warehouseName: wh.nameAr,
          bookQuantity: bookQty,
          physicalQuantity: bookQty,
          difference: 0,
          unitCost: it.purchasePrice,
          totalDifferenceValue: 0,
          notes: '',
        });
      }
    }

    const prefix = `ST-${new Date().getFullYear()}-`;
    const stocktakeNumber = generateNextDocNumber(
      prefix,
      stocktakings.map((s) => s.stocktakeNumber),
      4
    );

    const nowIso = new Date().toISOString();
    const newStocktake: PhysicalStocktaking = {
      id: `st-${Date.now()}`,
      stocktakeNumber,
      warehouseId: whList[0].id,
      warehouseIds: whList.map((w) => w.id),
      scope,
      targetCategory: scope === 'category' ? targetCategory : undefined,
      targetItemId: scope === 'single_item' ? targetItemId : undefined,
      date: nowIso.split('T')[0],
      items: stockItems,
      status: 'counting',
      notes: sessionNotes,
      conductedBy: 'أمين المستودع ولجنة الجرد',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    onSaveStocktaking(newStocktake);
    setActiveSessionId(newStocktake.id);
    setIsNewModalOpen(false);
    onNotify?.('success', `تم إنشاء جلسة الجرد ${stocktakeNumber} وحفظها بنجاح.`);
  };

  const handleUpdatePhysicalCount = (
    itemId: string,
    whId: string | undefined,
    val: number,
    notes?: string
  ) => {
    if (!activeSession || activeSession.status === 'approved' || activeSession.status === 'cancelled') {
      return;
    }

    const updatedItems = activeSession.items.map((it) => {
      const sameRow = it.itemId === itemId && (it.warehouseId || activeSession.warehouseId) === (whId || activeSession.warehouseId);
      if (!sameRow) return it;
      const physical = Math.max(0, Number(val) || 0);
      const diff = physical - it.bookQuantity;
      const totalDiffVal = diff * it.unitCost;
      return {
        ...it,
        physicalQuantity: physical,
        difference: diff,
        totalDifferenceValue: totalDiffVal,
        notes: notes !== undefined ? notes : it.notes,
      };
    });

    onSaveStocktaking({
      ...activeSession,
      items: updatedItems,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAdvanceStatus = (newStatus: StocktakingStatus) => {
    if (!activeSession) return;
    if (activeSession.status === 'approved' || activeSession.status === 'cancelled') return;

    if (newStatus === 'approved') {
      if (!canAdjustInventory) {
        onNotify?.('error', 'ليست لديك صلاحية اعتماد وترحيل تسويات الجرد المخزني.');
        return;
      }
      onApproveStocktaking(activeSession);
      return;
    }

    onSaveStocktaking({
      ...activeSession,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    });
    onNotify?.(
      'info',
      newStatus === 'review'
        ? 'تم إغلاق مرحلة العد ونقل المحضر إلى المراجعة والاعتماد.'
        : newStatus === 'cancelled'
        ? 'تم إلغاء جلسة الجرد.'
        : 'تم تحديث حالة الجرد.'
    );
  };

  const buildSessionPdfOptions = (session: PhysicalStocktaking) => {
    const wh = warehouses.find((w) => w.id === session.warehouseId);
    return {
      title: `محضر الجرد الفعلي #${session.stocktakeNumber}`,
      subtitle:
        session.scope === 'multi_warehouse'
          ? 'جرد متعدد المستودعات'
          : `المستودع: ${wh?.nameAr || '-'}`,
      reportCode: session.stocktakeNumber,
      periodText: session.date,
      company,
      branch,
      preparedBy: session.conductedBy,
      notes: session.notes,
      fileName: `محضر_جرد_${session.stocktakeNumber}`,
      metadata: {
        'رقم المحضر': session.stocktakeNumber,
        'التاريخ': session.date,
        'المستودع': session.warehouseIds && session.warehouseIds.length > 1
          ? session.warehouseIds.map((id) => warehouses.find((w) => w.id === id)?.nameAr).filter(Boolean).join('، ')
          : wh?.nameAr || '-',
        'الحالة':
          session.status === 'approved'
            ? 'معتمد ومرحل'
            : session.status === 'review'
            ? 'قيد المراجعة'
            : session.status === 'cancelled'
            ? 'ملغى'
            : 'قيد العد الفعلي',
        'القيد المحاسبي': session.adjustmentJournalEntryId || 'لا يوجد فرق / غير مرحل',
      },
      tables: [
        {
          title: 'تفاصيل مطابقة الجرد الفعلي',
          headers: ['#', 'الصنف', 'المستودع', 'الدفتري', 'الفعلي', 'الفارق', 'التكلفة', 'قيمة الفارق'],
          rows: session.items.map((it, idx) => [
            String(idx + 1),
            it.itemName,
            it.warehouseName || wh?.nameAr || '-',
            String(it.bookQuantity),
            String(it.physicalQuantity),
            it.difference > 0 ? `+${it.difference}` : String(it.difference),
            it.unitCost.toLocaleString(),
            `${it.totalDifferenceValue.toLocaleString()} ${currencySymbol}`,
          ]),
          totals: [
            '',
            'الإجمالي',
            `${session.items.length} بند`,
            String(session.items.reduce((s, i) => s + i.bookQuantity, 0)),
            String(session.items.reduce((s, i) => s + i.physicalQuantity, 0)),
            String(session.items.reduce((s, i) => s + i.difference, 0)),
            '',
            `${session.items.reduce((s, i) => s + i.totalDifferenceValue, 0).toLocaleString()} ${currencySymbol}`,
          ],
        },
      ],
    };
  };

  const handleExportSessionExcel = (session: PhysicalStocktaking) => {
    const wh = warehouses.find((w) => w.id === session.warehouseId);
    const data = [
      ['محضر الجرد المخزني الرسمي'],
      [`رقم الجرد: ${session.stocktakeNumber}`, `المستودع: ${wh?.nameAr || '-'}`, `التاريخ: ${session.date}`, `الحالة: ${session.status}`],
      [''],
      ['باركود', 'اسم الصنف', 'المستودع', 'الوحدة', 'الرصيد الدفتري', 'العد الفعلي', 'الفارق (+/-)', 'تكلفة الوحدة', 'قيمة الفارق الإجمالية', 'الملاحظات'],
      ...session.items.map((it) => [
        it.barcode || '-',
        it.itemName,
        it.warehouseName || wh?.nameAr || '-',
        it.unit,
        it.bookQuantity,
        it.physicalQuantity,
        it.difference,
        it.unitCost,
        it.totalDifferenceValue,
        it.notes || '',
      ]),
    ];

    exportToExcel({
      fileName: `محضر_جرد_${session.stocktakeNumber}`,
      sheets: [{ name: 'الجرد الفعلي', data, columnWidths: [16, 28, 20, 10, 14, 14, 14, 14, 18, 24] }],
    });
  };

  const handleExportSessionCSV = (session: PhysicalStocktaking) => {
    const wh = warehouses.find((w) => w.id === session.warehouseId);
    exportToCSV(
      `محضر_جرد_${session.stocktakeNumber}`,
      ['باركود', 'اسم الصنف', 'المستودع', 'الوحدة', 'الدفتري', 'الفعلي', 'الفارق', 'تكلفة الوحدة', 'قيمة الفارق', 'ملاحظات'],
      session.items.map((it) => [
        it.barcode || '-',
        it.itemName,
        it.warehouseName || wh?.nameAr || '-',
        it.unit,
        it.bookQuantity,
        it.physicalQuantity,
        it.difference,
        it.unitCost,
        it.totalDifferenceValue,
        it.notes || '',
      ])
    );
  };

  const handleCountingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      const next = document.querySelector<HTMLInputElement>(`input[data-count-idx="${rowIndex + 1}"]`);
      next?.focus();
      next?.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = document.querySelector<HTMLInputElement>(`input[data-count-idx="${rowIndex - 1}"]`);
      prev?.focus();
      prev?.select();
    }
  };

  const visibleActiveItems = useMemo(() => {
    if (!activeSession) return [];
    const q = itemFilterQuery.trim().toLowerCase();
    if (!q) return activeSession.items;
    return activeSession.items.filter(
      (it) =>
        it.itemName.toLowerCase().includes(q) ||
        (it.barcode || '').includes(q) ||
        (it.warehouseName || '').toLowerCase().includes(q)
    );
  }, [activeSession, itemFilterQuery]);

  const columns: ErpTableColumn<PhysicalStocktaking>[] = [
    {
      key: 'stocktakeNumber',
      label: 'رقم الجلسة',
      sortable: true,
      render: (st) => <span className="font-mono font-bold text-amber-400">{st.stocktakeNumber}</span>,
    },
    {
      key: 'warehouseId',
      label: 'المستودع',
      sortable: true,
      sortValue: (st) => warehouses.find((w) => w.id === st.warehouseId)?.nameAr || '',
      searchValue: (st) =>
        (st.warehouseIds || [st.warehouseId])
          .map((id) => warehouses.find((w) => w.id === id)?.nameAr || '')
          .join(' '),
      render: (st) => {
        if (st.scope === 'multi_warehouse' && st.warehouseIds && st.warehouseIds.length > 1) {
          return (
            <span className="text-slate-100 font-semibold">
              {st.warehouseIds
                .map((id) => warehouses.find((w) => w.id === id)?.nameAr)
                .filter(Boolean)
                .join(' + ')}
            </span>
          );
        }
        return <span className="text-white font-semibold">{warehouses.find((w) => w.id === st.warehouseId)?.nameAr || '-'}</span>;
      },
    },
    {
      key: 'scope',
      label: 'المستوى والنطاق',
      render: (st) => (
        <span className="text-slate-300">
          {st.scope === 'single_item'
            ? 'جرد صنف محدد'
            : st.scope === 'category'
            ? `تصنيف (${st.targetCategory})`
            : st.scope === 'warehouse'
            ? 'مستودع كامل'
            : 'متعدد المستودعات'}
        </span>
      ),
    },
    {
      key: 'date',
      label: 'التاريخ',
      sortable: true,
      render: (st) => <span className="font-mono text-slate-400">{st.date}</span>,
    },
    {
      key: 'itemsCount',
      label: 'البنود',
      align: 'center',
      sortable: true,
      sortValue: (st) => st.items.length,
      render: (st) => <span className="font-mono font-bold">{st.items.length}</span>,
    },
    {
      key: 'variance',
      label: 'إجمالي الفروقات',
      align: 'center',
      sortable: true,
      sortValue: (st) => st.items.reduce((s, it) => s + it.totalDifferenceValue, 0),
      render: (st) => {
        const diffCount = st.items.filter((it) => it.difference !== 0).length;
        const totalDiffVal = st.items.reduce((s, it) => s + it.totalDifferenceValue, 0);
        return (
          <span
            className={`font-mono font-bold ${
              totalDiffVal === 0 ? 'text-emerald-400' : totalDiffVal > 0 ? 'text-cyan-400' : 'text-rose-400'
            }`}
          >
            {diffCount === 0 ? 'مطابق تماماً' : `${diffCount} بند (${totalDiffVal.toLocaleString()} ${currencySymbol})`}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'الحالة',
      align: 'center',
      sortable: true,
      render: (st) => (
        <div className="flex flex-col items-center gap-0.5">
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
              st.status === 'approved'
                ? 'bg-emerald-500/20 text-emerald-400'
                : st.status === 'review'
                ? 'bg-amber-500/20 text-amber-400'
                : st.status === 'cancelled'
                ? 'bg-rose-500/20 text-rose-400'
                : 'bg-blue-500/20 text-blue-400'
            }`}
          >
            {st.status === 'approved'
              ? 'معتمد ومرحل'
              : st.status === 'review'
              ? 'قيد المراجعة'
              : st.status === 'cancelled'
              ? 'ملغى'
              : 'قيد العد'}
          </span>
          {st.adjustmentJournalEntryId && (
            <span className="text-[10px] font-mono text-emerald-300">قيد: {st.adjustmentJournalEntryId}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: 'إجراءات',
      align: 'center',
      sortable: false,
      render: (st) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setActiveSessionId(st.id)}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-lg text-[11px]"
          >
            {st.status === 'approved' || st.status === 'cancelled' ? 'عرض' : 'متابعة العد'}
          </button>
          <button
            type="button"
            onClick={() => void downloadReportAsPDF(buildSessionPdfOptions(st))}
            className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded"
            title="تنزيل PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleExportSessionExcel(st)}
            className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded"
            title="تصدير Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
            <ClipboardList className="w-5 h-5" />
          </span>
          <div>
            <h3 className="text-base font-black text-white">الجرد المخزني الشامل متعدد المستويات</h3>
            <p className="text-xs text-slate-400">
              جلسات جرد محفوظة بالكامل (صنف / تصنيف / مستودع / متعدد المستودعات) مع قيد تسوية محاسبي آلي متوازن
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!canAdjustInventory}
          onClick={() => setIsNewModalOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 font-black text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>بدء جلسة جرد مخزني جديدة</span>
        </button>
      </div>

      {/* Persistent Register */}
      <ErpDataTable
        tableId="stocktaking_sessions"
        title="سجل جلسات الجرد المخزني"
        data={filteredSessions}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="ابحث برقم الجلسة، المستودع، أو الملاحظات..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        onRowClick={(st) => setActiveSessionId(st.id)}
        filtersSlot={
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">كل الحالات ({stocktakings.length})</option>
            <option value="counting">قيد العد</option>
            <option value="review">قيد المراجعة</option>
            <option value="approved">معتمد ومرحل</option>
            <option value="cancelled">ملغى</option>
          </select>
        }
      />

      {/* Active Counting & Inspection Grid */}
      {activeSession && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-black text-white font-mono">{activeSession.stocktakeNumber}</span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-bold ${
                    activeSession.status === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : activeSession.status === 'cancelled'
                      ? 'bg-rose-500/20 text-rose-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {activeSession.status === 'approved'
                    ? 'معتمد ومرحل آلياً'
                    : activeSession.status === 'review'
                    ? 'في مرحلة المراجعة'
                    : activeSession.status === 'cancelled'
                    ? 'ملغى'
                    : 'قيد العد الفعلي'}
                </span>
                {activeSession.adjustmentJournalEntryId && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-emerald-300 text-[11px] font-mono">
                    مرجع القيد: {activeSession.adjustmentJournalEntryId}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                التاريخ: {activeSession.date} &bull; المسئول: {activeSession.conductedBy} &bull; استخدم الأسهم ↑ ↓ و Enter للتنقل السريع بين كميات العد
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeSession.status === 'counting' && canAdjustInventory && (
                <>
                  <button
                    type="button"
                    onClick={() => handleAdvanceStatus('review')}
                    className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    إنهاء العد والانتقال للمراجعة
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAdvanceStatus('cancelled')}
                    className="flex items-center gap-1 px-3 py-2 bg-rose-950/70 hover:bg-rose-900 text-rose-300 font-bold text-xs rounded-xl border border-rose-800/50 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>إلغاء</span>
                  </button>
                </>
              )}

              {activeSession.status === 'review' && canAdjustInventory && (
                <>
                  <button
                    type="button"
                    onClick={() => handleAdvanceStatus('counting')}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer"
                  >
                    العودة للعد
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmApproveOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>اعتماد وترحيل التسويات</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => void downloadReportAsPDF(buildSessionPdfOptions(activeSession))}
                className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() => printReportPreview(buildSessionPdfOptions(activeSession))}
                className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportSessionExcel(activeSession)}
                className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportSessionCSV(activeSession)}
                className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => setActiveSessionId(null)}
                className="p-2 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                title="إغلاق تفاصيل الجلسة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search inside counting rows */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={itemFilterQuery}
                onChange={(e) => setItemFilterQuery(e.target.value)}
                placeholder="تصفية أصناف الجرد بالاسم أو المستودع..."
                className="w-full pr-9 pl-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-400">
                بنود بفارق:{' '}
                <strong className="text-amber-400">
                  {activeSession.items.filter((i) => i.difference !== 0).length}
                </strong>
              </span>
              <span className="text-slate-400">
                صافي الفارق المالي:{' '}
                <strong className="text-white">
                  {activeSession.items.reduce((s, i) => s + i.totalDifferenceValue, 0).toLocaleString()} {currencySymbol}
                </strong>
              </span>
            </div>
          </div>

          {/* Interactive Counting Table */}
          <div className="overflow-x-auto max-h-[460px] border border-slate-800 rounded-xl">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-bold sticky top-0 z-10">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">اسم الصنف والباركود</th>
                  <th className="py-2.5 px-3">المستودع</th>
                  <th className="py-2.5 px-3 text-center">الوحدة</th>
                  <th className="py-2.5 px-3 text-center">الرصيد الدفتري</th>
                  <th className="py-2.5 px-3 text-center w-32">العد الفعلي</th>
                  <th className="py-2.5 px-3 text-center">الفارق</th>
                  <th className="py-2.5 px-3 text-left">تكلفة الوحدة</th>
                  <th className="py-2.5 px-3 text-left">قيمة الفارق</th>
                  <th className="py-2.5 px-3 w-44">ملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {visibleActiveItems.map((it, idx) => {
                  const whName =
                    it.warehouseName || warehouses.find((w) => w.id === (it.warehouseId || activeSession.warehouseId))?.nameAr || '-';
                  const isLocked = activeSession.status === 'approved' || activeSession.status === 'cancelled';

                  return (
                    <tr key={`${it.itemId}-${it.warehouseId || activeSession.warehouseId}`} className="hover:bg-slate-800/40">
                      <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-3 font-sans">
                        <strong className="text-white block">{it.itemName}</strong>
                        <span className="text-[10px] text-slate-400 font-mono">{it.barcode || '-'}</span>
                      </td>
                      <td className="py-2 px-3 font-sans text-amber-300/90 font-semibold">{whName}</td>
                      <td className="py-2 px-3 text-center font-sans text-slate-400">{it.unit}</td>
                      <td className="py-2 px-3 text-center font-bold text-slate-200">{it.bookQuantity}</td>
                      <td className="py-2 px-3 text-center">
                        {isLocked ? (
                          <span className="font-bold text-white text-sm">{it.physicalQuantity}</span>
                        ) : (
                          <input
                            type="number"
                            min={0}
                            data-count-idx={idx}
                            onKeyDown={(e) => handleCountingKeyDown(e, idx)}
                            value={it.physicalQuantity}
                            onChange={(e) =>
                              handleUpdatePhysicalCount(it.itemId, it.warehouseId, Number(e.target.value))
                            }
                            className="w-24 bg-slate-950 border border-slate-700 rounded-lg py-1 px-2 text-center font-bold text-white text-xs focus:border-amber-500 focus:outline-none"
                          />
                        )}
                      </td>
                      <td className="py-2 px-3 text-center font-bold">
                        <span
                          className={
                            it.difference === 0
                              ? 'text-slate-500'
                              : it.difference > 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {it.difference > 0 ? `+${it.difference}` : it.difference}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-left text-slate-400">{it.unitCost.toLocaleString()}</td>
                      <td className="py-2 px-3 text-left font-bold">
                        <span
                          className={
                            it.totalDifferenceValue === 0
                              ? 'text-slate-500'
                              : it.totalDifferenceValue > 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }
                        >
                          {it.totalDifferenceValue.toLocaleString()} {currencySymbol}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-sans">
                        {isLocked ? (
                          <span className="text-slate-400 text-[11px]">{it.notes || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={it.notes || ''}
                            onChange={(e) =>
                              handleUpdatePhysicalCount(it.itemId, it.warehouseId, it.physicalQuantity, e.target.value)
                            }
                            placeholder="سبب العجز أو الزيادة..."
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg py-1 px-2 text-slate-200 text-[11px] focus:outline-none"
                          />
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

      {/* New Session Creation Modal */}
      {isNewModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto no-print">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                بدء جلسة جرد مخزني جديدة
              </h3>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="p-5 space-y-4 text-xs">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">نطاق ومستوى الجرد *</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as StocktakingScope)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-amber-400 font-bold focus:border-amber-500 focus:outline-none cursor-pointer"
                >
                  <option value="warehouse">جرد مستودع كامل (جميع الأصناف)</option>
                  <option value="category">جرد مجموعة أو تصنيف محدد</option>
                  <option value="single_item">جرد صنف محدد فردي</option>
                  <option value="multi_warehouse">جرد متعدد المستودعات (مستودعات مختارة معاً)</option>
                </select>
              </div>

              {scope === 'multi_warehouse' ? (
                <div>
                  <label className="text-slate-300 font-semibold block mb-1.5">اختر المستودعات المشمولة بالجرد *</label>
                  <div className="space-y-2 bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-44 overflow-y-auto">
                    {warehouses.map((w) => {
                      const checked = selectedMultiWhIds.includes(w.id);
                      return (
                        <label key={w.id} className="flex items-center gap-2.5 cursor-pointer text-slate-200">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMultiWarehouse(w.id)}
                            className="w-4 h-4 accent-amber-500 rounded"
                          />
                          <CheckCircle2 className={`w-3.5 h-3.5 ${checked ? 'text-amber-400' : 'text-slate-600'}`} />
                          <span>{w.nameAr}</span>
                          <span className="text-[10px] font-mono text-slate-500">({w.code})</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">المستودع المستهدف *</label>
                  <select
                    value={targetWarehouseId}
                    onChange={(e) => setTargetWarehouseId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-amber-500 focus:outline-none cursor-pointer"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameAr} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {scope === 'category' && (
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">التصنيف المستهدف *</label>
                  <select
                    value={targetCategory}
                    onChange={(e) => setTargetCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none cursor-pointer"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {scope === 'single_item' && (
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">الصنف المستهدف *</label>
                  <select
                    value={targetItemId}
                    onChange={(e) => setTargetItemId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none cursor-pointer"
                  >
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nameAr} ({it.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-slate-300 font-semibold block mb-1">البيان والملاحظات</label>
                <input
                  type="text"
                  value={sessionNotes}
                  onChange={(e) => setSessionNotes(e.target.value)}
                  placeholder="جرد دوري شهري / تسوية سنوية..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl shadow-lg cursor-pointer"
                >
                  إنشاء وبدء جدول العد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmApproveOpen}
        title="تأكيد اعتماد وترحيل محضر الجرد"
        message={`هل أنت متأكد من اعتماد جلسة الجرد ${activeSession?.stocktakeNumber || ''}؟ سيتم تعديل أرصدة المستودعات الآنية، وتوثيق حركات التسوية، وإنشاء قيد محاسبي آلي متوازن بالفروقات في دليل الحسابات، وإغلاق الجلسة نهائياً.`}
        confirmLabel="اعتماد وترحيل الآن"
        variant="warning"
        onCancel={() => setConfirmApproveOpen(false)}
        onConfirm={() => {
          setConfirmApproveOpen(false);
          handleAdvanceStatus('approved');
        }}
      />
    </div>
  );
};
