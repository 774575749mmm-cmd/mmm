/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 4: Inventory Detailed/Grouped (Pieces/Dozen/Korja), In/Out Log, 4-Scope Stocktaking & Warehouse Docs
 */

import React, { useState, useMemo } from 'react';
import {
  PackagePlus,
  SlidersHorizontal,
  Eye,
  Edit3,
  ClipboardCheck,
  ArrowRightLeft,
  History,
  Layers,
} from 'lucide-react';
import {
  InventoryItem,
  Warehouse,
  ItemWarehouseStock,
  StockMovement,
  InventoryTransfer,
  PhysicalStocktaking,
  WarehouseDocument,
  UnitOfMeasure,
  DepartmentItem,
  Company,
  Branch,
  User,
  TableColumnPref,
  PrintDocumentType,
  PrintTemplateConfig,
  StockCostLayer,
  InventoryBatch,
  StorageLocation,
} from '../../../types/erp';
import {
  getItemStockInWarehouse,
  getSellableStockInWarehouse,
  calculateInventoryValuationComparison,
} from '../../../services/inventoryEngine';
import { rankSearchResults } from '../../../services/searchHelpers';
import { UniversalColumnCustomizer } from '../../common/UniversalColumnCustomizer';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { StocktakingManager } from '../inventory/StocktakingManager';
import { InventoryModule } from '../inventory/InventoryModule';

const DEFAULT_INV_REP_COLS: TableColumnPref[] = [
  { key: 'code', label: 'رقم الصنف', visible: true, order: 0, width: 85 },
  { key: 'barcode', label: 'الباركود', visible: true, order: 1, width: 100 },
  { key: 'nameAr', label: 'الصنف', visible: true, order: 2, width: 200 },
  { key: 'category', label: 'القسم', visible: true, order: 3, width: 110 },
  { key: 'pieces', label: 'الرصيد (حبة)', visible: true, order: 4, width: 100 },
  { key: 'dozen', label: 'درزن (÷12)', visible: true, order: 5, width: 95 },
  { key: 'korja', label: 'كورجة (÷20)', visible: true, order: 6, width: 95 },
  { key: 'cost', label: 'التكلفة', visible: true, order: 7, width: 95 },
  { key: 'salePrice', label: 'سعر البيع', visible: true, order: 8, width: 95 },
  { key: 'valuation', label: 'قيمة الجرد', visible: true, order: 9, width: 115 },
];

interface InventoryWorkbenchProps {
  items: InventoryItem[];
  warehouses: Warehouse[];
  warehouseStock: ItemWarehouseStock[];
  stockMovements: StockMovement[];
  inventoryTransfers: InventoryTransfer[];
  stocktakings: PhysicalStocktaking[];
  warehouseDocuments: WarehouseDocument[];
  departments: DepartmentItem[];
  unitsOfMeasure: UnitOfMeasure[];
  company: Company;
  branch: Branch;
  currentUser: User;
  currencySymbol: string;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefsMap: Record<string, TableColumnPref[]>;
  focusedRecordId?: string;
  stockCostLayers?: StockCostLayer[];
  inventoryBatches?: InventoryBatch[];
  storageLocations?: StorageLocation[];
  onSaveBatch?: (batch: InventoryBatch) => void;
  onSaveLocation?: (loc: StorageLocation) => void;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveItem: (item: InventoryItem) => void;
  onExecuteTransfer: (transfer: InventoryTransfer) => void;
  onReverseTransfer: (transfer: InventoryTransfer) => void;
  onAdjustStock: (itemId: string, warehouseId: string, diff: number, reason: string) => void;
  onSaveWarehouseDoc: (doc: WarehouseDocument) => void;
  onSaveStocktaking: (stocktake: PhysicalStocktaking) => void;
  onApproveStocktaking: (stocktake: PhysicalStocktaking) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const InventoryWorkbench: React.FC<InventoryWorkbenchProps> = ({
  items,
  warehouses,
  warehouseStock,
  stockMovements,
  inventoryTransfers,
  stocktakings,
  warehouseDocuments,
  departments,
  unitsOfMeasure,
  company,
  branch,
  currentUser,
  currencySymbol,
  printTemplates,
  savedColumnPrefsMap,
  focusedRecordId,
  stockCostLayers = [],
  inventoryBatches = [],
  storageLocations = [],
  onSaveBatch,
  onSaveLocation,
  onSaveColumnPrefs,
  onSaveItem,
  onExecuteTransfer,
  onReverseTransfer,
  onAdjustStock,
  onSaveWarehouseDoc,
  onSaveStocktaking,
  onApproveStocktaking,
  onNotify,
}) => {
  const canViewCost = currentUser.canViewCostsAndProfits;

  const [subTab, setSubTab] = useState<'v20_report' | 'v20_log' | 'stocktaking' | 'full_module' | 'fifo_batches'>('v20_report');
  const [newBatchForm, setNewBatchForm] = useState({
    itemId: items[0]?.id || '',
    warehouseId: warehouses[0]?.id || '',
    batchNumber: '',
    expiryDate: '',
    quantityRemaining: 0,
    unitCost: 0,
  });
  const [newLocForm, setNewLocForm] = useState({
    warehouseId: warehouses[0]?.id || '',
    code: '',
    zone: '',
    aisle: '',
    shelf: '',
    bin: '',
  });
  const [viewMode, setViewMode] = useState<'DETAILED' | 'GROUPED'>('DETAILED');
  const [whFilter, setWhFilter] = useState<string>('all');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [searchQ, setSearchQ] = useState<string>('');

  // In/Out Chronological Log Filters
  const [logDirection, setLogDirection] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');

  // Item Modal
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);

  const [isColCustOpen, setIsColCustOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);

  const columns = useMemo(() => {
    const raw = savedColumnPrefsMap['v20-inventory-report'];
    const base = raw && raw.length > 0 ? raw : DEFAULT_INV_REP_COLS;
    return [...base]
      .sort((a, b) => a.order - b.order)
      .filter((c) => canViewCost || (c.key !== 'cost' && c.key !== 'valuation'));
  }, [savedColumnPrefsMap, canViewCost]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    departments.forEach((d) => d.nameAr && set.add(d.nameAr));
    items.forEach((i) => i.category && set.add(i.category));
    return Array.from(set);
  }, [departments, items]);

  const inventoryRows = useMemo(() => {
    const byCategory = items.filter((it) => catFilter === 'all' || it.category === catFilter);
    const matched = searchQ.trim()
      ? rankSearchResults(
          byCategory,
          searchQ,
          (it) => ({
            code: it.code,
            barcode: it.barcode,
            id: it.id,
            name: `${it.nameAr} ${it.category}`,
          }),
          500
        )
      : byCategory;
    return matched.map((it) => {
      const qty =
        whFilter === 'all'
          ? warehouses.reduce((s, w) => s + getItemStockInWarehouse(warehouseStock, it.id, w.id), 0)
          : getItemStockInWarehouse(warehouseStock, it.id, whFilter);
      return {
        item: it,
        pieces: qty,
        dozen: Number((qty / 12).toFixed(2)),
        korja: Number((qty / 20).toFixed(2)),
        valuation: qty * it.purchasePrice,
      };
    });
  }, [items, whFilter, catFilter, searchQ, warehouses, warehouseStock]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, { category: string; count: number; pieces: number; dozen: number; korja: number; valuation: number }>();
    inventoryRows.forEach((r) => {
      const key = r.item.category || 'أخرى';
      const cur = map.get(key) || { category: key, count: 0, pieces: 0, dozen: 0, korja: 0, valuation: 0 };
      cur.count += 1;
      cur.pieces += r.pieces;
      cur.dozen = Number((cur.pieces / 12).toFixed(2));
      cur.korja = Number((cur.pieces / 20).toFixed(2));
      cur.valuation += r.valuation;
      map.set(key, cur);
    });
    return Array.from(map.values());
  }, [inventoryRows]);

  const totalPieces = inventoryRows.reduce((s, r) => s + r.pieces, 0);
  const totalValuation = inventoryRows.reduce((s, r) => s + r.valuation, 0);

  const filteredMovements = useMemo(() => {
    const dirFiltered = [...stockMovements]
      .reverse()
      .filter((m) => (logDirection === 'ALL' ? true : logDirection === 'IN' ? m.quantityChange > 0 : m.quantityChange < 0));
    if (!logSearch.trim()) return dirFiltered.slice(0, 300);
    return rankSearchResults(
      dirFiltered,
      logSearch,
      (m) => {
        const item = items.find((i) => i.id === m.itemId);
        return {
          code: `${item?.code || ''} ${m.documentNumber}`,
          barcode: item?.barcode,
          id: m.id,
          name: item?.nameAr || m.itemId,
          alt: m.notes || m.documentType,
        };
      },
      300
    );
  }, [stockMovements, logDirection, logSearch, items]);

  const openItemEditor = (item?: InventoryItem) => {
    setEditingItem(
      item || {
        id: `item-${Date.now()}`,
        code: `ITM-${items.length + 101}`,
        barcode: `${Date.now().toString().slice(-6)}`,
        nameAr: '',
        category: categories[0] || 'إلكترونيات',
        baseUnit: 'حبة',
        purchasePrice: 0,
        salePrice: 0,
        wholesalePrice: 0,
        minSalePrice: 0,
        minQuantityAlert: 5,
        maxQuantity: 500,
        valuationMethod: 'WEIGHTED_AVERAGE',
        taxRate: 0,
        status: 'active',
        createdAt: new Date().toISOString().split('T')[0],
      }
    );
    setIsItemModalOpen(true);
  };

  const buildReportPreview = (): UniversalPreviewPayload => {
    if (viewMode === 'GROUPED') {
      return {
        title: 'تقرير جرد المخزون المجمع حسب الأقسام',
        tables: [
          {
            headers: ['القسم', 'عدد الأصناف', 'الرصيد (حبة)', 'درزن (÷12)', 'كورجة (÷20)', ...(canViewCost ? ['قيمة الجرد'] : [])],
            rows: groupedByCategory.map((g) => [
              g.category,
              g.count,
              g.pieces,
              g.dozen,
              g.korja,
              ...(canViewCost ? [g.valuation.toLocaleString()] : []),
            ]),
            totals: [
              'الإجمالي الكلي',
              inventoryRows.length,
              totalPieces,
              (totalPieces / 12).toFixed(2),
              (totalPieces / 20).toFixed(2),
              ...(canViewCost ? [totalValuation.toLocaleString()] : []),
            ],
          },
        ],
        whatsappText: `${company.nameAr}\nتقرير جرد المخزون المجمع\nإجمالي القطع: ${totalPieces} حبة`,
      };
    }

    const visCols = columns.filter((c) => c.visible);
    return {
      title: 'تقرير جرد وأرصدة المخزون التفصيلي',
      tables: [
        {
          headers: visCols.map((c) => c.label),
          rows: inventoryRows.map((r) =>
            visCols.map((c) => {
              if (c.key === 'code') return r.item.code;
              if (c.key === 'barcode') return r.item.barcode;
              if (c.key === 'nameAr') return r.item.nameAr;
              if (c.key === 'category') return r.item.category;
              if (c.key === 'pieces') return r.pieces;
              if (c.key === 'dozen') return r.dozen;
              if (c.key === 'korja') return r.korja;
              if (c.key === 'cost') return r.item.purchasePrice.toLocaleString();
              if (c.key === 'salePrice') return r.item.salePrice.toLocaleString();
              return r.valuation.toLocaleString();
            })
          ),
          totals: visCols.map((c, idx) => {
            if (idx === 0) return `الإجمالي (${inventoryRows.length} صنف)`;
            if (c.key === 'pieces') return totalPieces.toLocaleString();
            if (c.key === 'dozen') return (totalPieces / 12).toFixed(2);
            if (c.key === 'korja') return (totalPieces / 20).toFixed(2);
            if (c.key === 'valuation') return totalValuation.toLocaleString();
            return '';
          }),
        },
      ],
      whatsappText: `${company.nameAr}\nجرد المخزون التفصيلي (${inventoryRows.length} صنف)\nإجمالي القطع: ${totalPieces}`,
    };
  };

  return (
    <div className="space-y-3" dir="rtl">
      {/* Sub-navigation Strip */}
      <div className="v20-card-alt px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setSubTab('v20_report')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'v20_report' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>1. تقرير الجرد والأرصدة (حبة / درزن / كورجة)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('v20_log')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'v20_log' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>2. سجل حركة الداخل والخارج بالتاريخ ({stockMovements.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('stocktaking')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'stocktaking' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>3. الجرد الفعلي المتكامل (4 نطاقات)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('full_module')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'full_module' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>4. التحويلات والأذون الـ 10 وكارت الصنف</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('fifo_batches')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'fifo_batches' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>5. طبقات FIFO والدفعات والمواقع</span>
          </button>
        </div>
      </div>

      {subTab === 'v20_report' && (
        <div className="space-y-3">
          <div className="v20-doc-toolbar">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setViewMode('DETAILED')}
                className={`px-3 py-1.5 rounded text-xs font-black cursor-pointer ${
                  viewMode === 'DETAILED' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
                }`}
              >
                عرض تفصيلي بالأصناف
              </button>
              <button
                type="button"
                onClick={() => setViewMode('GROUPED')}
                className={`px-3 py-1.5 rounded text-xs font-black cursor-pointer ${
                  viewMode === 'GROUPED' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
                }`}
              >
                عرض مجمع حسب الأقسام
              </button>

              <select
                value={whFilter}
                onChange={(e) => setWhFilter(e.target.value)}
                className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <option value="all">كل المستودعات</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </select>

              <select
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
                className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <option value="all">كل الأقسام</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="بحث بالاسم أو الباركود..."
                className="v20-input px-2.5 py-1.5 text-xs w-48"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => openItemEditor()}
                className="px-3 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] flex items-center gap-1 cursor-pointer"
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>+ صنف جديد</span>
              </button>
              <button
                type="button"
                onClick={() => setIsColCustOpen(true)}
                className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white flex items-center gap-1 cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>أعمدة الجرد</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewPayload(buildReportPreview())}
                className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>معاينة / طباعة / PDF</span>
              </button>
            </div>
          </div>

          <div className="v20-card p-3 overflow-x-auto">
            {viewMode === 'GROUPED' ? (
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                  <tr>
                    <th className="p-2.5 border-l border-[#1B2E44]">القسم / التصنيف</th>
                    <th className="p-2.5 border-l border-[#1B2E44] text-center">عدد الأصناف</th>
                    <th className="p-2.5 border-l border-[#1B2E44] text-center">إجمالي حبة</th>
                    <th className="p-2.5 border-l border-[#1B2E44] text-center">درزن (÷12)</th>
                    <th className="p-2.5 border-l border-[#1B2E44] text-center">كورجة (÷20)</th>
                    {canViewCost && <th className="p-2.5 text-center">قيمة الجرد ({currencySymbol})</th>}
                  </tr>
                </thead>
                <tbody>
                  {groupedByCategory.map((g) => (
                    <tr key={g.category} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      <td className="p-2.5 font-black text-white border-l border-[#1B2E44]">{g.category}</td>
                      <td className="p-2.5 text-center tabular-nums border-l border-[#1B2E44]">{g.count}</td>
                      <td className="p-2.5 text-center font-black text-[var(--gold)] tabular-nums border-l border-[#1B2E44]">
                        {g.pieces}
                      </td>
                      <td className="p-2.5 text-center text-sky-300 tabular-nums border-l border-[#1B2E44]">{g.dozen}</td>
                      <td className="p-2.5 text-center text-emerald-300 tabular-nums border-l border-[#1B2E44]">{g.korja}</td>
                      {canViewCost && (
                        <td className="p-2.5 text-center font-black text-amber-300 tabular-nums">
                          {g.valuation.toLocaleString()}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[#071019] border-t-2 border-[var(--gold)] font-black text-[var(--gold)]">
                  <tr>
                    <td className="p-2.5">الإجمالي العام</td>
                    <td className="p-2.5 text-center tabular-nums">{inventoryRows.length}</td>
                    <td className="p-2.5 text-center tabular-nums">{totalPieces}</td>
                    <td className="p-2.5 text-center tabular-nums">{(totalPieces / 12).toFixed(2)}</td>
                    <td className="p-2.5 text-center tabular-nums">{(totalPieces / 20).toFixed(2)}</td>
                    {canViewCost && <td className="p-2.5 text-center tabular-nums">{totalValuation.toLocaleString()}</td>}
                  </tr>
                </tfoot>
              </table>
            ) : (
              <table className="w-full text-right text-xs border-collapse">
                <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                  <tr>
                    {columns
                      .filter((c) => c.visible)
                      .map((c) => (
                        <th key={c.key} className="p-2.5 border-l border-[#1B2E44]">
                          {c.label}
                        </th>
                      ))}
                    <th className="p-2.5 text-center">تعديل</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryRows.map((r) => (
                    <tr key={r.item.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      {columns
                        .filter((c) => c.visible)
                        .map((c) => {
                          if (c.key === 'code')
                            return (
                              <td key={c.key} className="p-2 font-mono font-bold text-[var(--gold)] border-l border-[#1B2E44]">
                                {r.item.code}
                              </td>
                            );
                          if (c.key === 'barcode')
                            return (
                              <td key={c.key} className="p-2 font-mono text-slate-300 border-l border-[#1B2E44]">
                                {r.item.barcode}
                              </td>
                            );
                          if (c.key === 'nameAr')
                            return (
                              <td key={c.key} className="p-2 font-bold text-white border-l border-[#1B2E44]">
                                {r.item.nameAr}
                              </td>
                            );
                          if (c.key === 'category')
                            return (
                              <td key={c.key} className="p-2 text-[var(--text-secondary)] border-l border-[#1B2E44]">
                                {r.item.category}
                              </td>
                            );
                          if (c.key === 'pieces')
                            return (
                              <td
                                key={c.key}
                                className={`p-2 text-center font-black tabular-nums border-l border-[#1B2E44] ${
                                  r.pieces <= r.item.minQuantityAlert ? 'text-rose-400' : 'text-[var(--gold)]'
                                }`}
                              >
                                {r.pieces}
                              </td>
                            );
                          if (c.key === 'dozen')
                            return (
                              <td key={c.key} className="p-2 text-center text-sky-300 tabular-nums border-l border-[#1B2E44]">
                                {r.dozen}
                              </td>
                            );
                          if (c.key === 'korja')
                            return (
                              <td key={c.key} className="p-2 text-center text-emerald-300 tabular-nums border-l border-[#1B2E44]">
                                {r.korja}
                              </td>
                            );
                          if (c.key === 'cost')
                            return (
                              <td key={c.key} className="p-2 text-center tabular-nums border-l border-[#1B2E44]">
                                {r.item.purchasePrice.toLocaleString()}
                              </td>
                            );
                          if (c.key === 'salePrice')
                            return (
                              <td key={c.key} className="p-2 text-center font-bold tabular-nums border-l border-[#1B2E44]">
                                {r.item.salePrice.toLocaleString()}
                              </td>
                            );
                          return (
                            <td key={c.key} className="p-2 text-center font-black text-amber-300 tabular-nums border-l border-[#1B2E44]">
                              {r.valuation.toLocaleString()}
                            </td>
                          );
                        })}
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => openItemEditor(r.item)}
                          className="p-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 hover:border-[var(--gold)] cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {subTab === 'v20_log' && (
        <div className="space-y-3">
          <div className="v20-doc-toolbar">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={logDirection}
                onChange={(e) => setLogDirection(e.target.value as 'ALL' | 'IN' | 'OUT')}
                className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <option value="ALL">جميع الحركات (وارد ومنصرف)</option>
                <option value="IN">الوارد / الداخل للمخزن فقط (+)</option>
                <option value="OUT">المنصرف / الخارج من المخزن فقط (-)</option>
              </select>
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="بحث بالصنف أو رقم المستند..."
                className="v20-input px-2.5 py-1.5 text-xs w-60"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setPreviewPayload({
                  title: 'سجل حركة المخزون (الداخل والخارج بالتاريخ)',
                  tables: [
                    {
                      headers: ['التاريخ', 'المستند', 'النوع', 'الصنف', 'المستودع', 'التغير'],
                      rows: filteredMovements.map((m) => [
                        m.movementDate,
                        m.documentNumber,
                        m.documentType.replace(/_/g, ' '),
                        items.find((i) => i.id === m.itemId)?.nameAr || m.itemId,
                        warehouses.find((w) => w.id === m.warehouseId)?.nameAr || m.warehouseId,
                        m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange,
                      ]),
                    },
                  ],
                  whatsappText: `${company.nameAr}\nتقرير حركة المخزون (${filteredMovements.length} حركة)`,
                })
              }
              className="px-3 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>معاينة / طباعة / PDF</span>
            </button>
          </div>

          <div className="v20-card p-3 overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                <tr>
                  <th className="p-2 border-l border-[#1B2E44]">التاريخ</th>
                  <th className="p-2 border-l border-[#1B2E44]">رقم المستند</th>
                  <th className="p-2 border-l border-[#1B2E44]">نوع الحركة</th>
                  <th className="p-2 border-l border-[#1B2E44]">الصنف</th>
                  <th className="p-2 border-l border-[#1B2E44]">المستودع</th>
                  <th className="p-2 border-l border-[#1B2E44] text-center">الكمية (+/-)</th>
                  <th className="p-2">البيان / المنفذ</th>
                </tr>
              </thead>
              <tbody>
                {filteredMovements.map((m) => (
                  <tr key={m.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                    <td className="p-2 tabular-nums border-l border-[#1B2E44]">{m.movementDate}</td>
                    <td className="p-2 font-mono font-bold text-[var(--gold)] border-l border-[#1B2E44]">{m.documentNumber}</td>
                    <td className="p-2 border-l border-[#1B2E44]">{m.documentType.replace(/_/g, ' ')}</td>
                    <td className="p-2 font-bold border-l border-[#1B2E44]">
                      {items.find((i) => i.id === m.itemId)?.nameAr || m.itemId}
                    </td>
                    <td className="p-2 border-l border-[#1B2E44]">
                      {warehouses.find((w) => w.id === m.warehouseId)?.nameAr || m.warehouseId}
                    </td>
                    <td
                      className={`p-2 text-center font-black tabular-nums border-l border-[#1B2E44] ${
                        m.quantityChange > 0 ? 'text-emerald-300' : 'text-rose-400'
                      }`}
                    >
                      {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                    </td>
                    <td className="p-2 text-slate-300">{m.notes || m.performedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'stocktaking' && (
        <StocktakingManager
          items={items}
          warehouses={warehouses}
          warehouseStock={warehouseStock}
          currencySymbol={currencySymbol}
          stocktakings={stocktakings}
          onSaveStocktaking={onSaveStocktaking}
          onApproveStocktaking={onApproveStocktaking}
          canAdjustInventory={currentUser.canAdjustInventory}
          company={company}
          branch={branch}
          savedColumnPrefs={savedColumnPrefsMap['stocktaking-list']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onNotify={onNotify}
        />
      )}

      {subTab === 'full_module' && (
        <InventoryModule
          items={items}
          warehouses={warehouses}
          warehouseStock={warehouseStock}
          stockMovements={stockMovements}
          inventoryTransfers={inventoryTransfers}
          stocktakings={stocktakings}
          currencySymbol={currencySymbol}
          warehouseDocuments={warehouseDocuments}
          canAdjustInventory={currentUser.canAdjustInventory}
          unitsOfMeasure={unitsOfMeasure}
          company={company}
          branch={branch}
          savedColumnPrefs={savedColumnPrefsMap}
          onSaveColumnPrefs={onSaveColumnPrefs}
          focusedRecordId={focusedRecordId}
          onSaveItem={onSaveItem}
          onExecuteTransfer={onExecuteTransfer}
          onReverseTransfer={onReverseTransfer}
          onAdjustStock={onAdjustStock}
          onSaveWarehouseDoc={onSaveWarehouseDoc}
          onSaveStocktaking={onSaveStocktaking}
          onApproveStocktaking={onApproveStocktaking}
          onNotify={onNotify}
        />
      )}

      {subTab === 'fifo_batches' && (() => {
        const valuationRows = calculateInventoryValuationComparison(items, warehouseStock, stockCostLayers);
        return (
          <div className="space-y-4 text-xs">
            {/* Valuation Comparison (FIFO vs WA) */}
            <div className="v20-card p-3 space-y-2">
              <h3 className="font-black text-sm text-[var(--gold)]">
                مقارنة تقييم المخزون: المتوسط المرجح (WA) مقابل الوارد أولاً صادر أولاً (FIFO)
              </h3>
              <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg">
                <table className="w-full text-right border-collapse">
                  <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                    <tr>
                      <th className="p-2">كود الصنف</th>
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">السياسة</th>
                      <th className="p-2 text-center">الكمية الكلية</th>
                      {canViewCost && <th className="p-2 text-center">قيمة المتوسط المرجح</th>}
                      {canViewCost && <th className="p-2 text-center">قيمة طبقات FIFO</th>}
                      {canViewCost && <th className="p-2 text-center">التقييم المعتمد</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {valuationRows.map((v) => (
                      <tr key={v.itemId} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                        <td className="p-2 font-mono text-[var(--gold)]">{v.itemCode}</td>
                        <td className="p-2 font-bold text-white">{v.itemName}</td>
                        <td className="p-2 text-center">
                          <span className="px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-700/40 font-mono">
                            {v.valuationMethod}
                          </span>
                        </td>
                        <td className="p-2 text-center font-black tabular-nums">{v.totalQty}</td>
                        {canViewCost && <td className="p-2 text-center tabular-nums">{v.weightedAvgValue.toLocaleString()}</td>}
                        {canViewCost && <td className="p-2 text-center tabular-nums text-emerald-300">{v.fifoLayerValue.toLocaleString()}</td>}
                        {canViewCost && <td className="p-2 text-center font-black text-amber-300 tabular-nums">{v.activeValuation.toLocaleString()} {currencySymbol}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Active FIFO Cost Layers & Reserved vs Sellable Stock */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-emerald-300">طبقات التكلفة النشطة FIFO ({stockCostLayers.filter((l) => l.remainingQuantity > 0).length})</h4>
                <div className="max-h-60 overflow-y-auto border border-[var(--border-strong)] rounded-lg">
                  <table className="w-full text-right border-collapse">
                    <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                      <tr>
                        <th className="p-2">التاريخ</th>
                        <th className="p-2">المستند</th>
                        <th className="p-2">الصنف</th>
                        <th className="p-2 text-center">المتبقي / الأصلي</th>
                        {canViewCost && <th className="p-2 text-center">تكلفة الوحدة</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {stockCostLayers.filter((l) => l.remainingQuantity > 0).map((layer) => (
                        <tr key={layer.id} className="border-b border-[#1B2E44]">
                          <td className="p-2 tabular-nums">{layer.receivedDate}</td>
                          <td className="p-2 font-mono text-sky-300">{layer.sourceDocNumber}</td>
                          <td className="p-2 font-bold">{items.find((i) => i.id === layer.itemId)?.nameAr || layer.itemId}</td>
                          <td className="p-2 text-center font-black text-emerald-300 tabular-nums">
                            {layer.remainingQuantity} / {layer.originalQuantity}
                          </td>
                          {canViewCost && <td className="p-2 text-center tabular-nums">{layer.unitCost.toLocaleString()}</td>}
                        </tr>
                      ))}
                      {stockCostLayers.filter((l) => l.remainingQuantity > 0).length === 0 && (
                        <tr><td colSpan={5} className="p-4 text-center text-slate-400">لا توجد طبقات FIFO نشطة مفتوحة حالياً (تنشأ تلقائياً مع فواتير الشراء).</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-sky-300">المخزون القابل للبيع مقابل المحجوز</h4>
                <div className="max-h-60 overflow-y-auto border border-[var(--border-strong)] rounded-lg">
                  <table className="w-full text-right border-collapse">
                    <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                      <tr>
                        <th className="p-2">الصنف</th>
                        <th className="p-2">المستودع</th>
                        <th className="p-2 text-center">الفعلي</th>
                        <th className="p-2 text-center">محجوز</th>
                        <th className="p-2 text-center">متاح للبيع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouseStock.map((ws) => {
                        const sellable = getSellableStockInWarehouse(warehouseStock, ws.itemId, ws.warehouseId);
                        return (
                          <tr key={`${ws.itemId}-${ws.warehouseId}`} className="border-b border-[#1B2E44]">
                            <td className="p-2 font-bold">{items.find((i) => i.id === ws.itemId)?.nameAr || ws.itemId}</td>
                            <td className="p-2 text-slate-300">{warehouses.find((w) => w.id === ws.warehouseId)?.nameAr || ws.warehouseId}</td>
                            <td className="p-2 text-center tabular-nums">{ws.quantityOnHand}</td>
                            <td className="p-2 text-center text-amber-300 tabular-nums">{ws.reservedQuantity || 0}</td>
                            <td className="p-2 text-center font-black text-emerald-300 tabular-nums">{sellable}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Batches/Expiry & Storage Locations (Bins) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-[var(--gold)]">إدارة الدفعات وتواريخ الانتهاء ({inventoryBatches.length})</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  <select
                    value={newBatchForm.itemId}
                    onChange={(e) => setNewBatchForm({ ...newBatchForm, itemId: e.target.value })}
                    className="v20-input px-2 py-1"
                  >
                    {items.map((it) => <option key={it.id} value={it.id}>{it.nameAr}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="رقم التشغيلة / الدفعة *"
                    value={newBatchForm.batchNumber}
                    onChange={(e) => setNewBatchForm({ ...newBatchForm, batchNumber: e.target.value })}
                    className="v20-input px-2 py-1"
                  />
                  <input
                    type="date"
                    title="تاريخ الانتهاء"
                    value={newBatchForm.expiryDate}
                    onChange={(e) => setNewBatchForm({ ...newBatchForm, expiryDate: e.target.value })}
                    className="v20-input px-2 py-1"
                  />
                  <input
                    type="number"
                    placeholder="الكمية"
                    value={newBatchForm.quantityRemaining || ''}
                    onChange={(e) => setNewBatchForm({ ...newBatchForm, quantityRemaining: parseFloat(e.target.value) || 0 })}
                    className="v20-input px-2 py-1"
                  />
                  <input
                    type="number"
                    placeholder="التكلفة"
                    value={newBatchForm.unitCost || ''}
                    onChange={(e) => setNewBatchForm({ ...newBatchForm, unitCost: parseFloat(e.target.value) || 0 })}
                    className="v20-input px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newBatchForm.batchNumber.trim() || !newBatchForm.itemId) {
                        onNotify('error', 'أدخل رقم الدفعة واختر الصنف.');
                        return;
                      }
                      onSaveBatch?.({
                        id: `bat-${Date.now()}`,
                        companyId: company.id,
                        itemId: newBatchForm.itemId,
                        warehouseId: newBatchForm.warehouseId || warehouses[0]?.id || 'wh-01',
                        batchNumber: newBatchForm.batchNumber.trim(),
                        expiryDate: newBatchForm.expiryDate || undefined,
                        quantityRemaining: newBatchForm.quantityRemaining,
                        unitCost: newBatchForm.unitCost,
                        receivedDate: new Date().toISOString().split('T')[0],
                      });
                      setNewBatchForm({ ...newBatchForm, batchNumber: '', quantityRemaining: 0 });
                      onNotify('success', 'تمت إضافة الدفعة بنجاح.');
                    }}
                    className="v20-btn-gold rounded px-2 py-1 font-black cursor-pointer"
                  >
                    + حفظ دفعة
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {inventoryBatches.map((b) => (
                    <div key={b.id} className="v20-card-alt px-2.5 py-1.5 flex justify-between items-center">
                      <div>
                        <span className="font-mono text-[var(--gold)] font-bold ml-2">{b.batchNumber}</span>
                        <span className="font-bold text-white">{items.find((i) => i.id === b.itemId)?.nameAr || b.itemId}</span>
                        {b.expiryDate && <span className="text-rose-300 mr-2">ينتهي: {b.expiryDate}</span>}
                      </div>
                      <span className="font-black text-emerald-300 tabular-nums">{b.quantityRemaining}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-[var(--gold)]">دليل مواقع التخزين والرفوف Bins ({storageLocations.length})</h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  <select
                    value={newLocForm.warehouseId}
                    onChange={(e) => setNewLocForm({ ...newLocForm, warehouseId: e.target.value })}
                    className="v20-input px-2 py-1"
                  >
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="كود الموقع (A1-S2)"
                    value={newLocForm.code}
                    onChange={(e) => setNewLocForm({ ...newLocForm, code: e.target.value })}
                    className="v20-input px-2 py-1 font-mono"
                  />
                  <input
                    type="text"
                    placeholder="المنطقة (Zone)"
                    value={newLocForm.zone}
                    onChange={(e) => setNewLocForm({ ...newLocForm, zone: e.target.value })}
                    className="v20-input px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="الممر (Aisle)"
                    value={newLocForm.aisle}
                    onChange={(e) => setNewLocForm({ ...newLocForm, aisle: e.target.value })}
                    className="v20-input px-2 py-1"
                  />
                  <input
                    type="text"
                    placeholder="الرف/الخانة (Shelf/Bin)"
                    value={newLocForm.bin}
                    onChange={(e) => setNewLocForm({ ...newLocForm, bin: e.target.value })}
                    className="v20-input px-2 py-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newLocForm.code.trim() || !newLocForm.zone.trim()) {
                        onNotify('error', 'أدخل كود الموقع والمنطقة.');
                        return;
                      }
                      onSaveLocation?.({
                        id: `loc-${Date.now()}`,
                        companyId: company.id,
                        warehouseId: newLocForm.warehouseId || warehouses[0]?.id || 'wh-01',
                        code: newLocForm.code.trim(),
                        zone: newLocForm.zone.trim(),
                        aisle: newLocForm.aisle.trim() || undefined,
                        bin: newLocForm.bin.trim() || undefined,
                        isActive: true,
                      });
                      setNewLocForm({ ...newLocForm, code: '', zone: '', aisle: '', bin: '' });
                      onNotify('success', 'تم إضافة موقع التخزين.');
                    }}
                    className="v20-btn-gold rounded px-2 py-1 font-black cursor-pointer"
                  >
                    + حفظ موقع
                  </button>
                </div>
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {storageLocations.map((loc) => (
                    <div key={loc.id} className="v20-card-alt px-2.5 py-1.5 flex justify-between items-center">
                      <div>
                        <span className="font-mono text-[var(--gold)] font-bold ml-2">{loc.code}</span>
                        <span className="font-bold text-white">{warehouses.find((w) => w.id === loc.warehouseId)?.nameAr}</span>
                        <span className="text-slate-400 mr-2">· {loc.zone}{loc.aisle ? ` / ${loc.aisle}` : ''}{loc.bin ? ` / ${loc.bin}` : ''}</span>
                      </div>
                      <span className="text-emerald-300 font-bold">{loc.isActive ? 'نشط' : 'موقوف'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Item Editor Modal */}
      {isItemModalOpen && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-lg p-4 space-y-3 text-xs">
            <h3 className="font-black text-sm text-[var(--gold)]">بطاقة الصنف</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-300">اسم الصنف *</label>
                <input
                  type="text"
                  value={editingItem.nameAr}
                  onChange={(e) => setEditingItem({ ...editingItem, nameAr: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">رقم الصنف / الكود</label>
                <input
                  type="text"
                  value={editingItem.code}
                  onChange={(e) => setEditingItem({ ...editingItem, code: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5 font-mono text-[var(--gold)]"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">الباركود</label>
                <input
                  type="text"
                  value={editingItem.barcode}
                  onChange={(e) => setEditingItem({ ...editingItem, barcode: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">القسم</label>
                <input
                  type="text"
                  value={editingItem.category}
                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">سعر التكلفة</label>
                <input
                  type="number"
                  value={editingItem.purchasePrice}
                  onChange={(e) => setEditingItem({ ...editingItem, purchasePrice: parseFloat(e.target.value) || 0 })}
                  className="w-full v20-input px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">سعر البيع</label>
                <input
                  type="number"
                  value={editingItem.salePrice}
                  onChange={(e) => setEditingItem({ ...editingItem, salePrice: parseFloat(e.target.value) || 0 })}
                  className="w-full v20-input px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">حد التنبيه الأدنى</label>
                <input
                  type="number"
                  value={editingItem.minQuantityAlert}
                  onChange={(e) => setEditingItem({ ...editingItem, minQuantityAlert: parseInt(e.target.value, 10) || 0 })}
                  className="w-full v20-input px-2.5 py-1.5 tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-300">الوحدة الأساسية</label>
                <input
                  type="text"
                  value={editingItem.baseUnit}
                  onChange={(e) => setEditingItem({ ...editingItem, baseUnit: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsItemModalOpen(false)}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editingItem.nameAr.trim()) {
                    onNotify('error', 'أدخل اسم الصنف.');
                    return;
                  }
                  onSaveItem(editingItem);
                  setIsItemModalOpen(false);
                  onNotify('success', `تم حفظ بطاقة الصنف "${editingItem.nameAr}".`);
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                حفظ الصنف
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalColumnCustomizer
        isOpen={isColCustOpen}
        title="تخصيص أعمدة تقرير الجرد"
        columns={columns}
        onChange={(updated) => onSaveColumnPrefs('v20-inventory-report', updated)}
        onReset={() => onSaveColumnPrefs('v20-inventory-report', DEFAULT_INV_REP_COLS)}
        onClose={() => setIsColCustOpen(false)}
      />

      <UniversalPreviewModal
        isOpen={Boolean(previewPayload)}
        payload={previewPayload}
        company={company}
        branch={branch}
        printTemplates={printTemplates}
        onClose={() => setPreviewPayload(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
