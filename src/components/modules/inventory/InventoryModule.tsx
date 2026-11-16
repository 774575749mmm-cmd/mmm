/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Inventory & Warehousing Module
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Package,
  Plus,
  ArrowRightLeft,
  History,
  Edit,
  Eye,
  X,
  Trash2,
  RotateCcw,
  Download,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import {
  InventoryItem,
  Warehouse,
  ItemWarehouseStock,
  StockMovement,
  InventoryTransfer,
  InventoryTransferItem,
  WarehouseDocument,
  PhysicalStocktaking,
  UnitOfMeasure,
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
import { StocktakingManager } from './StocktakingManager';
import { WarehouseDocsManager } from './WarehouseDocsManager';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { ConfirmModal } from '../../common/ConfirmModal';

interface InventoryModuleProps {
  items: InventoryItem[];
  warehouses: Warehouse[];
  warehouseStock: ItemWarehouseStock[];
  stockMovements: StockMovement[];
  inventoryTransfers?: InventoryTransfer[];
  stocktakings?: PhysicalStocktaking[];
  currencySymbol: string;
  onSaveItem: (item: InventoryItem) => void;
  onExecuteTransfer: (transfer: InventoryTransfer) => void;
  onReverseTransfer?: (transfer: InventoryTransfer) => void;
  onAdjustStock: (itemId: string, warehouseId: string, diff: number, reason: string) => void;
  warehouseDocuments?: WarehouseDocument[];
  onSaveWarehouseDoc?: (doc: WarehouseDocument) => void;
  onSaveStocktaking?: (stocktake: PhysicalStocktaking) => void;
  onApproveStocktaking?: (stocktake: PhysicalStocktaking) => void;
  canAdjustInventory?: boolean;
  unitsOfMeasure?: UnitOfMeasure[];
  company?: Company;
  branch?: Branch;
  savedColumnPrefs?: Record<string, TableColumnPref[]>;
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
  focusedRecordId?: string;
}

export const InventoryModule: React.FC<InventoryModuleProps> = ({
  items,
  warehouses,
  warehouseStock,
  stockMovements,
  inventoryTransfers = [],
  stocktakings = [],
  currencySymbol,
  onSaveItem,
  onExecuteTransfer,
  onReverseTransfer,
  warehouseDocuments = [],
  onSaveWarehouseDoc = () => {},
  onSaveStocktaking = () => {},
  onApproveStocktaking = () => {},
  canAdjustInventory = true,
  unitsOfMeasure = [],
  company,
  branch,
  savedColumnPrefs = {},
  onSaveColumnPrefs,
  onNotify,
  focusedRecordId,
}) => {
  const [activeTab, setActiveTab] = useState<'items' | 'transfers' | 'stocktaking' | 'warehouse_docs' | 'card'>('items');
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'detailed' | 'grouped'>('detailed');

  // New / Edit Item Modal
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [formNameAr, setFormNameAr] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formCategory, setFormCategory] = useState('أجهزة ومعدات');
  const [formBaseUnit, setFormBaseUnit] = useState('حبة');
  const [formPurchasePrice, setFormPurchasePrice] = useState(0);
  const [formSalePrice, setFormSalePrice] = useState(0);
  const [formMinAlert, setFormMinAlert] = useState(5);

  // Multi-item Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferFromWH, setTransferFromWH] = useState(warehouses[0]?.id || '');
  const [transferToWH, setTransferToWH] = useState(warehouses[1]?.id || warehouses[0]?.id || '');
  const [transferLines, setTransferLines] = useState<{ itemId: string; quantity: number }[]>([
    { itemId: items[0]?.id || '', quantity: 1 },
  ]);
  const [transferNotes, setTransferNotes] = useState('');
  const [inspectTransfer, setInspectTransfer] = useState<InventoryTransfer | null>(null);
  const [reverseTarget, setReverseTarget] = useState<InventoryTransfer | null>(null);
  const [transferStatusFilter, setTransferStatusFilter] = useState<string>('all');

  // Item Card State
  const [selectedCardItemId, setSelectedCardItemId] = useState(items[0]?.id || '');
  const [cardWarehouseFilter, setCardWarehouseFilter] = useState('all');

  useEffect(() => {
    if (focusedRecordId) {
      if (items.some((i) => i.id === focusedRecordId)) {
        setSelectedCardItemId(focusedRecordId);
        setActiveTab('card');
      } else if (inventoryTransfers.some((t) => t.id === focusedRecordId)) {
        const tr = inventoryTransfers.find((t) => t.id === focusedRecordId);
        setActiveTab('transfers');
        if (tr) setInspectTransfer(tr);
      }
    }
  }, [focusedRecordId, items, inventoryTransfers]);

  const categoriesList = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => {
      if (it.category && it.category.trim()) set.add(it.category.trim());
    });
    return Array.from(set);
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => selectedCategoryFilter === 'all' || it.category === selectedCategoryFilter);
  }, [items, selectedCategoryFilter]);

  const groupedByCategory = useMemo(() => {
    const map = new Map<
      string,
      {
        category: string;
        itemCount: number;
        totalQty: number;
        totalValueCost: number;
        totalValueSale: number;
        lowStockCount: number;
      }
    >();
    filteredItems.forEach((it) => {
      const cat = it.category?.trim() || 'غير مصنف';
      const qty =
        selectedWarehouseFilter === 'all'
          ? warehouses.reduce((s, wh) => s + getItemStockInWarehouse(warehouseStock, it.id, wh.id), 0)
          : getItemStockInWarehouse(warehouseStock, it.id, selectedWarehouseFilter);
      const curr = map.get(cat) || {
        category: cat,
        itemCount: 0,
        totalQty: 0,
        totalValueCost: 0,
        totalValueSale: 0,
        lowStockCount: 0,
      };
      curr.itemCount += 1;
      curr.totalQty += qty;
      curr.totalValueCost += qty * it.purchasePrice;
      curr.totalValueSale += qty * it.salePrice;
      if (qty <= it.minQuantityAlert) curr.lowStockCount += 1;
      map.set(cat, curr);
    });
    return Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty);
  }, [filteredItems, warehouses, warehouseStock, selectedWarehouseFilter]);

  const inventorySummary = useMemo(() => {
    let totalPieces = 0;
    let totalCostVal = 0;
    let totalSaleVal = 0;
    filteredItems.forEach((it) => {
      const qty =
        selectedWarehouseFilter === 'all'
          ? warehouses.reduce((s, wh) => s + getItemStockInWarehouse(warehouseStock, it.id, wh.id), 0)
          : getItemStockInWarehouse(warehouseStock, it.id, selectedWarehouseFilter);
      totalPieces += qty;
      totalCostVal += qty * it.purchasePrice;
      totalSaleVal += qty * it.salePrice;
    });
    return {
      totalPieces,
      totalDozens: totalPieces / 12,
      totalKorja: totalPieces / 20,
      totalCostVal,
      totalSaleVal,
    };
  }, [filteredItems, warehouses, warehouseStock, selectedWarehouseFilter]);

  const openNewItemModal = () => {
    setEditingItemId(null);
    setFormNameAr('');
    setFormBarcode('');
    setFormCategory(categoriesList[0] || 'أجهزة ومعدات');
    setFormBaseUnit(unitsOfMeasure[0]?.nameAr || 'حبة');
    setFormPurchasePrice(0);
    setFormSalePrice(0);
    setFormMinAlert(5);
    setIsItemModalOpen(true);
  };

  const openEditItemModal = (item: InventoryItem) => {
    setEditingItemId(item.id);
    setFormNameAr(item.nameAr);
    setFormBarcode(item.barcode);
    setFormCategory(item.category);
    setFormBaseUnit(item.baseUnit);
    setFormPurchasePrice(item.purchasePrice);
    setFormSalePrice(item.salePrice);
    setFormMinAlert(item.minQuantityAlert);
    setIsItemModalOpen(true);
  };

  const handleSaveItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNameAr.trim()) return;

    const existing = editingItemId ? items.find((i) => i.id === editingItemId) : undefined;
    const itemToSave: InventoryItem = existing
      ? {
          ...existing,
          barcode: formBarcode || existing.barcode,
          nameAr: formNameAr.trim(),
          category: formCategory.trim() || 'غير مصنف',
          baseUnit: formBaseUnit.trim() || 'حبة',
          purchasePrice: Number(formPurchasePrice) || 0,
          salePrice: Number(formSalePrice) || 0,
          wholesalePrice: Math.round((Number(formSalePrice) || 0) * 0.9),
          minSalePrice: Math.round((Number(formSalePrice) || 0) * 0.85),
          minQuantityAlert: Number(formMinAlert) || 0,
        }
      : {
          id: `it-${Date.now()}`,
          code: generateNextDocNumber(
            'IT-',
            items.map((i) => i.code),
            3
          ),
          barcode: formBarcode || `${Math.floor(629000000000 + Math.random() * 99999999)}`,
          nameAr: formNameAr.trim(),
          category: formCategory.trim() || 'غير مصنف',
          baseUnit: formBaseUnit.trim() || 'حبة',
          purchasePrice: Number(formPurchasePrice) || 0,
          salePrice: Number(formSalePrice) || 0,
          wholesalePrice: Math.round((Number(formSalePrice) || 0) * 0.9),
          minSalePrice: Math.round((Number(formSalePrice) || 0) * 0.85),
          minQuantityAlert: Number(formMinAlert) || 5,
          maxQuantity: 500,
          valuationMethod: 'WEIGHTED_AVERAGE',
          taxRate: 0.05,
          status: 'active',
          createdAt: new Date().toISOString().split('T')[0],
        };

    onSaveItem(itemToSave);
    setIsItemModalOpen(false);
    setEditingItemId(null);
    onNotify?.('success', existing ? `تم تحديث بيانات الصنف ${itemToSave.nameAr}.` : `تم تعريف الصنف الجديد ${itemToSave.nameAr}.`);
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustInventory) {
      onNotify?.('error', 'ليست لديك صلاحية تنفيذ التحويلات المخزنية.');
      return;
    }
    if (transferFromWH === transferToWH) {
      onNotify?.('error', 'لا يمكن التحويل لنفس المستودع المصدر!');
      return;
    }

    const aggregated = new Map<string, number>();
    for (const line of transferLines) {
      if (!line.itemId || line.quantity <= 0) {
        onNotify?.('error', 'تأكد من تحديد الصنف وإدخال كمية موجبة أكبر من صفر لكل صف.');
        return;
      }
      aggregated.set(line.itemId, (aggregated.get(line.itemId) || 0) + Number(line.quantity));
    }

    const builtItems: InventoryTransferItem[] = [];
    for (const [itemId, totalQty] of aggregated.entries()) {
      const it = items.find((i) => i.id === itemId);
      if (!it) continue;
      const avail = getItemStockInWarehouse(warehouseStock, itemId, transferFromWH);
      if (avail < totalQty) {
        onNotify?.(
          'error',
          `الرصيد المتاح للصنف "${it.nameAr}" في المستودع المصدر هو (${avail}) وأقل من المطلوب (${totalQty}).`
        );
        return;
      }
      builtItems.push({
        itemId: it.id,
        itemName: it.nameAr,
        unit: it.baseUnit,
        quantity: totalQty,
        unitCost: it.purchasePrice,
      });
    }

    if (builtItems.length === 0) return;

    const transferNumber = generateNextDocNumber(
      `TR-${new Date().getFullYear()}-`,
      inventoryTransfers.map((t) => t.transferNumber),
      4
    );

    const transferObj: InventoryTransfer = {
      id: `tr-${Date.now()}`,
      transferNumber,
      date: new Date().toISOString().split('T')[0],
      fromWarehouseId: transferFromWH,
      toWarehouseId: transferToWH,
      items: builtItems,
      status: 'pending_approval',
      notes: transferNotes,
      performedBy: 'مسؤول المخزون',
    };

    onExecuteTransfer(transferObj);
    setIsTransferModalOpen(false);
    setTransferNotes('');
    setTransferLines([{ itemId: items[0]?.id || '', quantity: 1 }]);
  };

  const filteredTransfers = useMemo(() => {
    const list =
      transferStatusFilter === 'all'
        ? inventoryTransfers
        : inventoryTransfers.filter((t) => t.status === transferStatusFilter);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [inventoryTransfers, transferStatusFilter]);

  const activeItemMovements = useMemo(() => {
    return stockMovements
      .filter(
        (sm) =>
          sm.itemId === selectedCardItemId &&
          (cardWarehouseFilter === 'all' || sm.warehouseId === cardWarehouseFilter)
      )
      .sort((a, b) => new Date(b.movementDate).getTime() - new Date(a.movementDate).getTime());
  }, [stockMovements, selectedCardItemId, cardWarehouseFilter]);

  // Columns for Items table
  const visibleWarehouses = useMemo(
    () => warehouses.filter((w) => selectedWarehouseFilter === 'all' || w.id === selectedWarehouseFilter),
    [warehouses, selectedWarehouseFilter]
  );

  const itemColumns: ErpTableColumn<InventoryItem>[] = useMemo(() => {
    const baseCols: ErpTableColumn<InventoryItem>[] = [
      {
        key: 'code',
        label: 'كود الصنف',
        sortable: true,
        render: (it) => <span className="font-mono font-bold text-amber-400">{it.code}</span>,
      },
      {
        key: 'nameAr',
        label: 'اسم الصنف والباركود',
        sortable: true,
        searchValue: (it) => `${it.nameAr} ${it.barcode} ${it.code} ${it.category}`,
        render: (it) => (
          <div>
            <strong className="text-slate-100 block">{it.nameAr}</strong>
            <span className="text-[11px] text-slate-400 font-mono">باركود: {it.barcode}</span>
          </div>
        ),
      },
      {
        key: 'category',
        label: 'التصنيف',
        sortable: true,
        render: (it) => <span className="text-slate-300">{it.category}</span>,
      },
      {
        key: 'baseUnit',
        label: 'الوحدة',
        align: 'center',
        render: (it) => <span className="text-slate-400">{it.baseUnit}</span>,
      },
      {
        key: 'purchasePrice',
        label: 'سعر الشراء',
        align: 'left',
        sortable: true,
        render: (it) => <span className="font-mono text-slate-300">{it.purchasePrice.toLocaleString()}</span>,
      },
      {
        key: 'salePrice',
        label: `سعر البيع (${currencySymbol})`,
        align: 'left',
        sortable: true,
        render: (it) => <span className="font-mono font-bold text-amber-300">{it.salePrice.toLocaleString()}</span>,
      },
    ];

    for (const wh of visibleWarehouses) {
      baseCols.push({
        key: `wh_${wh.id}`,
        label: wh.nameAr,
        align: 'center',
        sortable: true,
        sortValue: (it) => getItemStockInWarehouse(warehouseStock, it.id, wh.id),
        render: (it) => (
          <span className="font-mono font-bold text-slate-200">
            {getItemStockInWarehouse(warehouseStock, it.id, wh.id)}
          </span>
        ),
        footerRender: (rows) =>
          rows
            .reduce((s, it) => s + getItemStockInWarehouse(warehouseStock, it.id, wh.id), 0)
            .toLocaleString(),
      });
    }

    baseCols.push(
      {
        key: 'totalQty',
        label: 'إجمالي الرصيد',
        align: 'center',
        sortable: true,
        sortValue: (it) =>
          visibleWarehouses.reduce((sum, wh) => sum + getItemStockInWarehouse(warehouseStock, it.id, wh.id), 0),
        render: (it) => {
          const total = visibleWarehouses.reduce(
            (sum, wh) => sum + getItemStockInWarehouse(warehouseStock, it.id, wh.id),
            0
          );
          return <span className="font-mono font-black text-white">{total}</span>;
        },
        footerRender: (rows) =>
          rows
            .reduce(
              (acc, it) =>
                acc + visibleWarehouses.reduce((s, w) => s + getItemStockInWarehouse(warehouseStock, it.id, w.id), 0),
              0
            )
            .toLocaleString(),
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        render: (it) => {
          const total = visibleWarehouses.reduce(
            (sum, wh) => sum + getItemStockInWarehouse(warehouseStock, it.id, wh.id),
            0
          );
          return total <= it.minQuantityAlert ? (
            <span className="bg-rose-950 text-rose-400 border border-rose-800/40 px-2 py-0.5 rounded text-[10px] font-bold">
              تحت الحد ({it.minQuantityAlert})
            </span>
          ) : (
            <span className="bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded text-[10px] font-semibold">
              متوفر
            </span>
          );
        },
      },
      {
        key: 'actions',
        label: 'إجراء',
        align: 'center',
        sortable: false,
        render: (it) => (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => openEditItemModal(it)}
              title="تعديل بيانات الصنف"
              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedCardItemId(it.id);
                setActiveTab('card');
              }}
              title="بطاقة حركة الصنف"
              className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
        ),
      }
    );

    return baseCols;
  }, [visibleWarehouses, warehouseStock, currencySymbol]);

  const transferColumns: ErpTableColumn<InventoryTransfer>[] = [
    {
      key: 'transferNumber',
      label: 'رقم التحويل',
      sortable: true,
      render: (tr) => <span className="font-mono font-bold text-amber-400">{tr.transferNumber}</span>,
    },
    {
      key: 'date',
      label: 'التاريخ',
      sortable: true,
      render: (tr) => <span className="font-mono text-slate-400">{tr.date}</span>,
    },
    {
      key: 'fromWarehouseId',
      label: 'من المستودع',
      sortable: true,
      render: (tr) => (
        <span className="text-slate-200">{warehouses.find((w) => w.id === tr.fromWarehouseId)?.nameAr || '-'}</span>
      ),
    },
    {
      key: 'toWarehouseId',
      label: 'إلى المستودع',
      sortable: true,
      render: (tr) => (
        <span className="text-slate-200">{warehouses.find((w) => w.id === tr.toWarehouseId)?.nameAr || '-'}</span>
      ),
    },
    {
      key: 'items',
      label: 'الأصناف والكميات',
      render: (tr) => (
        <span className="text-slate-300">
          {tr.items.length} صنف (إجمالي {tr.items.reduce((s, i) => s + i.quantity, 0)} وحدة)
        </span>
      ),
    },
    {
      key: 'totalValue',
      label: 'قيمة التكلفة',
      align: 'left',
      sortable: true,
      sortValue: (tr) => tr.items.reduce((s, i) => s + i.quantity * i.unitCost, 0),
      render: (tr) => (
        <span className="font-mono font-bold text-emerald-400">
          {tr.items.reduce((s, i) => s + i.quantity * i.unitCost, 0).toLocaleString()} {currencySymbol}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'الحالة',
      align: 'center',
      render: (tr) => (
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
            tr.status === 'completed'
              ? 'bg-emerald-500/20 text-emerald-400'
              : tr.status === 'cancelled'
              ? 'bg-rose-500/20 text-rose-400'
              : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {tr.status === 'completed' ? 'مكتمل' : tr.status === 'cancelled' ? 'معكوس / ملغى' : tr.status}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'إجراءات',
      align: 'center',
      sortable: false,
      render: (tr) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setInspectTransfer(tr)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
            title="معاينة التحويل"
          >
            <Eye className="w-4 h-4" />
          </button>
          {tr.status === 'completed' && canAdjustInventory && onReverseTransfer && (
            <button
              type="button"
              onClick={() => setReverseTarget(tr)}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded"
              title="عكس وإلغاء التحويل"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const movementColumns: ErpTableColumn<StockMovement>[] = [
    { key: 'movementDate', label: 'التاريخ', sortable: true, render: (sm) => <span className="font-mono text-slate-400">{sm.movementDate}</span> },
    { key: 'documentType', label: 'نوع المستند', sortable: true, render: (sm) => <span className="font-semibold text-slate-200">{sm.documentType.replace(/_/g, ' ')}</span> },
    { key: 'documentNumber', label: 'رقم المستند', sortable: true, render: (sm) => <span className="font-mono font-bold text-amber-400">{sm.documentNumber}</span> },
    { key: 'warehouseId', label: 'المستودع', sortable: true, render: (sm) => <span className="text-slate-300">{warehouses.find((w) => w.id === sm.warehouseId)?.nameAr || '-'}</span> },
    {
      key: 'quantityChange',
      label: 'الكمية (+/-)',
      align: 'center',
      sortable: true,
      render: (sm) => (
        <span className={`font-mono font-bold ${sm.quantityChange > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {sm.quantityChange > 0 ? `+${sm.quantityChange}` : sm.quantityChange}
        </span>
      ),
    },
    { key: 'unitCost', label: 'تكلفة الوحدة', align: 'left', sortable: true, render: (sm) => <span className="font-mono text-slate-300">{sm.unitCost.toLocaleString()}</span> },
    { key: 'totalCost', label: 'القيمة', align: 'left', sortable: true, render: (sm) => <span className="font-mono font-bold text-slate-200">{sm.totalCost.toLocaleString()}</span> },
    { key: 'runningBalance', label: 'الرصيد بعد الحركة', align: 'center', sortable: true, render: (sm) => <span className="font-mono font-black text-amber-300">{sm.runningBalance}</span> },
    { key: 'notes', label: 'الملاحظات والمسؤول', render: (sm) => <span className="text-slate-400 text-xs">{sm.performedBy} {sm.notes ? `· ${sm.notes}` : ''}</span> },
  ];

  const handleExportInventoryPDF = () => {
    void downloadReportAsPDF({
      title: 'تقرير أرصدة وتقييم المخزون',
      subtitle: selectedWarehouseFilter === 'all' ? 'جميع المستودعات' : warehouses.find((w) => w.id === selectedWarehouseFilter)?.nameAr,
      periodText: new Date().toISOString().split('T')[0],
      company,
      branch,
      fileName: `أرصدة_المخزون_${new Date().toISOString().split('T')[0]}`,
      tables: [
        {
          title: 'أرصدة الأصناف الحالية',
          headers: ['الكود', 'اسم الصنف', 'التصنيف', 'الشراء', 'البيع', 'الكمية الكلية', 'قيمة التكلفة'],
          rows: filteredItems.map((it) => {
            const qty = visibleWarehouses.reduce((s, w) => s + getItemStockInWarehouse(warehouseStock, it.id, w.id), 0);
            return [
              it.code,
              it.nameAr,
              it.category,
              it.purchasePrice.toLocaleString(),
              it.salePrice.toLocaleString(),
              String(qty),
              `${(qty * it.purchasePrice).toLocaleString()} ${currencySymbol}`,
            ];
          }),
          totals: [
            '',
            'الإجمالي',
            `${filteredItems.length} صنف`,
            '',
            '',
            String(inventorySummary.totalPieces),
            `${Math.round(inventorySummary.totalCostVal).toLocaleString()} ${currencySymbol}`,
          ],
        },
      ],
    });
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Package className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة المخزون والمستودعات والتحويلات</h2>
          </div>
          <p className="text-xs text-slate-400">
            أرصدة المستودعات الآنية، التحويلات متعددة الأصناف وعكسها، بطاقة الصنف، والجرد الفعلي المحفوظ
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex flex-wrap items-center gap-1 text-xs">
            {[
              { id: 'items', label: 'الأصناف والأرصدة' },
              { id: 'transfers', label: `التحويل المخزني (${inventoryTransfers.length})` },
              { id: 'card', label: 'بطاقة حركة الصنف' },
              { id: 'stocktaking', label: `الجرد والتسويات (${stocktakings.length})` },
              { id: 'warehouse_docs', label: `أذون المخزون (${warehouseDocuments.length})` },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id as typeof activeTab)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeTab === t.id ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={openNewItemModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>تعريف صنف جديد</span>
          </button>
        </div>
      </div>

      {/* TAB 1: ITEMS & WAREHOUSE BALANCES */}
      {activeTab === 'items' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <span className="text-slate-400 block text-[11px]">إجمالي القطع / الحبات</span>
              <strong className="text-base font-mono font-black text-white">{inventorySummary.totalPieces.toLocaleString()}</strong>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <span className="text-slate-400 block text-[11px]">المعادل بالدرزن (÷ 12)</span>
              <strong className="text-base font-mono font-black text-amber-400">{inventorySummary.totalDozens.toFixed(2)} درزن</strong>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <span className="text-slate-400 block text-[11px]">المعادل بالكورجة (÷ 20)</span>
              <strong className="text-base font-mono font-black text-sky-400">{inventorySummary.totalKorja.toFixed(2)} كورجة</strong>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <span className="text-slate-400 block text-[11px]">تقييم المخزون (بالتكلفة)</span>
              <strong className="text-base font-mono font-black text-emerald-400">
                {Math.round(inventorySummary.totalCostVal).toLocaleString()} {currencySymbol}
              </strong>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/80 border border-slate-800 p-3 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
              >
                <option value="all">جميع الأقسام ({categoriesList.length})</option>
                {categoriesList.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                value={selectedWarehouseFilter}
                onChange={(e) => setSelectedWarehouseFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
              >
                <option value="all">كل المستودعات ({warehouses.length})</option>
                {warehouses.map((wh) => (
                  <option key={wh.id} value={wh.id}>
                    {wh.nameAr}
                  </option>
                ))}
              </select>

              <div className="bg-slate-950 p-0.5 rounded-lg border border-slate-800 flex items-center text-[11px]">
                <button
                  type="button"
                  onClick={() => setViewMode('detailed')}
                  className={`px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                    viewMode === 'detailed' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  تفصيلي بالأصناف
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grouped')}
                  className={`px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                    viewMode === 'grouped' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  تجميع حسب القسم
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportInventoryPDF}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToExcel({
                    fileName: 'أرصدة_المخزون',
                    sheets: [
                      {
                        name: 'الأصناف',
                        data: [
                          ['الكود', 'الباركود', 'الصنف', 'القسم', 'الشراء', 'البيع', 'إجمالي الكمية'],
                          ...filteredItems.map((it) => [
                            it.code,
                            it.barcode,
                            it.nameAr,
                            it.category,
                            it.purchasePrice,
                            it.salePrice,
                            visibleWarehouses.reduce((s, w) => s + getItemStockInWarehouse(warehouseStock, it.id, w.id), 0),
                          ]),
                        ],
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          {viewMode === 'grouped' ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="py-3 px-4">القسم / التصنيف</th>
                      <th className="py-3 px-4 text-center">عدد الأصناف</th>
                      <th className="py-3 px-4 text-center">الرصيد (بالحبة)</th>
                      <th className="py-3 px-4 text-center">بالدرزن (÷12)</th>
                      <th className="py-3 px-4 text-center">بالكورجة (÷20)</th>
                      <th className="py-3 px-4 text-left">قيمة التكلفة ({currencySymbol})</th>
                      <th className="py-3 px-4 text-left">القيمة البيعية ({currencySymbol})</th>
                      <th className="py-3 px-4 text-center">تحت الحد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {groupedByCategory.map((grp) => (
                      <tr
                        key={grp.category}
                        onClick={() => {
                          setSelectedCategoryFilter(grp.category);
                          setViewMode('detailed');
                        }}
                        className="hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="py-3 px-4 font-sans font-bold text-amber-300">{grp.category}</td>
                        <td className="py-3 px-4 text-center text-slate-200">{grp.itemCount}</td>
                        <td className="py-3 px-4 text-center font-black text-white">{grp.totalQty.toLocaleString()}</td>
                        <td className="py-3 px-4 text-center font-bold text-amber-400">{(grp.totalQty / 12).toFixed(2)}</td>
                        <td className="py-3 px-4 text-center font-bold text-sky-400">{(grp.totalQty / 20).toFixed(2)}</td>
                        <td className="py-3 px-4 text-left text-emerald-400 font-bold">{Math.round(grp.totalValueCost).toLocaleString()}</td>
                        <td className="py-3 px-4 text-left text-slate-300">{Math.round(grp.totalValueSale).toLocaleString()}</td>
                        <td className="py-3 px-4 text-center font-sans">
                          {grp.lowStockCount > 0 ? (
                            <span className="bg-rose-950 text-rose-400 px-2 py-0.5 rounded text-[10px] font-bold">
                              {grp.lowStockCount} نواقص
                            </span>
                          ) : (
                            <span className="text-emerald-400 text-[11px]">ممتاز</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <ErpDataTable
              tableId="inventory_items"
              title="جدول الأصناف وأرصدة المستودعات"
              data={filteredItems}
              columns={itemColumns}
              getRowId={(r) => r.id}
              searchPlaceholder="بحث باسم الصنف، الباركود، الكود أو التصنيف..."
              savedColumnPrefs={savedColumnPrefs['inventory_items']}
              onSaveColumnPrefs={onSaveColumnPrefs}
            />
          )}
        </div>
      )}

      {/* TAB 2: INTER-WAREHOUSE TRANSFERS + FULL HISTORY */}
      {activeTab === 'transfers' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-white">التحويل المخزني بين المستودعات والفروع</h3>
              <p className="text-xs text-slate-400">
                إنشاء تحويل متعدد الأصناف مع التحقق اللحظي من الكميات وتوثيق سجل الحركات وإمكانية عكس التحويل
              </p>
            </div>
            <button
              type="button"
              disabled={!canAdjustInventory}
              onClick={() => setIsTransferModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-xl shadow-sm cursor-pointer"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>إجراء تحويل مخزني جديد</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {warehouses.map((wh) => {
              const whItemsCount = items.filter((it) => getItemStockInWarehouse(warehouseStock, it.id, wh.id) > 0).length;
              const whValuation = items.reduce((sum, it) => sum + getItemStockInWarehouse(warehouseStock, it.id, wh.id) * it.purchasePrice, 0);

              return (
                <div key={wh.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-white">{wh.nameAr}</span>
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">{wh.code}</span>
                  </div>
                  <div className="text-xs text-slate-400 space-y-1">
                    <p>الموقع: {wh.location}</p>
                    <p>أمين المستودع: {wh.keeperName}</p>
                    <p>
                      الأصناف المتوفرة: <strong className="text-slate-200">{whItemsCount} صنف</strong>
                    </p>
                    <p className="border-t border-slate-800 pt-1 font-mono text-emerald-400">
                      قيمة المخزون: {whValuation.toLocaleString()} {currencySymbol}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <ErpDataTable
            tableId="inventory_transfers"
            title="سجل التحويلات المخزنية"
            data={filteredTransfers}
            columns={transferColumns}
            getRowId={(r) => r.id}
            searchPlaceholder="ابحث برقم التحويل أو الملاحظات..."
            savedColumnPrefs={savedColumnPrefs['inventory_transfers']}
            onSaveColumnPrefs={onSaveColumnPrefs}
            onRowClick={(tr) => setInspectTransfer(tr)}
            filtersSlot={
              <select
                value={transferStatusFilter}
                onChange={(e) => setTransferStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200"
              >
                <option value="all">كل التحويلات ({inventoryTransfers.length})</option>
                <option value="completed">مكتملة</option>
                <option value="cancelled">معكوسة / ملغاة</option>
              </select>
            }
          />
        </div>
      )}

      {/* TAB 3: ITEM MOVEMENT CARD */}
      {activeTab === 'card' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <History className="w-4 h-4 text-amber-400" />
                بطاقة حركة الصنف التفصيلية (سجل التدقيق المخزني)
              </h3>
              <p className="text-xs text-slate-400">
                تتبع جميع حركات الوارد والمنصرف والمرتجع والتحويل والتسوية مع الرصيد التراكمي
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={selectedCardItemId}
                onChange={(e) => setSelectedCardItemId(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 focus:border-amber-500"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.nameAr} ({it.code})
                  </option>
                ))}
              </select>
              <select
                value={cardWarehouseFilter}
                onChange={(e) => setCardWarehouseFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100"
              >
                <option value="all">كل المستودعات</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.nameAr}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  const targetItem = items.find((i) => i.id === selectedCardItemId);
                  exportToCSV(
                    `حركة_${targetItem?.code || 'item'}`,
                    ['التاريخ', 'نوع المستند', 'رقم المستند', 'المستودع', 'التغير', 'التكلفة', 'الإجمالي', 'الرصيد التراكمي', 'ملاحظات'],
                    activeItemMovements.map((m) => [
                      m.movementDate,
                      m.documentType,
                      m.documentNumber,
                      warehouses.find((w) => w.id === m.warehouseId)?.nameAr || '-',
                      m.quantityChange,
                      m.unitCost,
                      m.totalCost,
                      m.runningBalance,
                      m.notes || '',
                    ])
                  );
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 font-bold"
              >
                CSV
              </button>
            </div>
          </div>

          <ErpDataTable
            tableId="item_movements_card"
            title="حركات الصنف المختار"
            data={activeItemMovements}
            columns={movementColumns}
            getRowId={(r) => r.id}
            searchPlaceholder="ابحث برقم المستند أو الملاحظات..."
            savedColumnPrefs={savedColumnPrefs['item_movements_card']}
            onSaveColumnPrefs={onSaveColumnPrefs}
          />
        </div>
      )}

      {/* TAB 4: STOCKTAKING */}
      {activeTab === 'stocktaking' && (
        <StocktakingManager
          items={items}
          warehouses={warehouses}
          warehouseStock={warehouseStock}
          currencySymbol={currencySymbol}
          stocktakings={stocktakings}
          onSaveStocktaking={onSaveStocktaking}
          onApproveStocktaking={onApproveStocktaking}
          canAdjustInventory={canAdjustInventory}
          company={company}
          branch={branch}
          savedColumnPrefs={savedColumnPrefs['stocktaking_sessions']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onNotify={onNotify}
        />
      )}

      {/* TAB 5: WAREHOUSE DOCS */}
      {activeTab === 'warehouse_docs' && (
        <WarehouseDocsManager
          documents={warehouseDocuments}
          items={items}
          warehouses={warehouses}
          currencySymbol={currencySymbol}
          onSaveDocument={onSaveWarehouseDoc}
          company={company}
          branch={branch}
          savedColumnPrefs={savedColumnPrefs['warehouse_docs']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onNotify={onNotify}
        />
      )}

      {/* MODAL: MULTI-ITEM INTER-WAREHOUSE TRANSFER */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">تحويل مخزني جديد (متعدد الأصناف)</h3>
              <button type="button" onClick={() => setIsTransferModalOpen(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">من مستودع (المصدر) *</label>
                  <select
                    value={transferFromWH}
                    onChange={(e) => setTransferFromWH(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">إلى مستودع (الوجهة) *</label>
                  <select
                    value={transferToWH}
                    onChange={(e) => setTransferToWH(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">الأصناف المحولة</span>
                  <button
                    type="button"
                    onClick={() => setTransferLines((prev) => [...prev, { itemId: items[0]?.id || '', quantity: 1 }])}
                    className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-bold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة صنف آخر</span>
                  </button>
                </div>

                {transferLines.map((ln, idx) => {
                  const avail = getItemStockInWarehouse(warehouseStock, ln.itemId, transferFromWH);
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                      <div className="col-span-7">
                        <select
                          value={ln.itemId}
                          onChange={(e) =>
                            setTransferLines((prev) => prev.map((r, i) => (i === idx ? { ...r, itemId: e.target.value } : r)))
                          }
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100"
                        >
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.nameAr} (المتاح: {getItemStockInWarehouse(warehouseStock, it.id, transferFromWH)})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          min={1}
                          value={ln.quantity}
                          onChange={(e) =>
                            setTransferLines((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, quantity: Number(e.target.value) } : r))
                            )
                          }
                          className={`w-full bg-slate-900 border rounded-lg px-2 py-1.5 text-center font-mono font-bold ${
                            ln.quantity > avail ? 'border-rose-500 text-rose-300' : 'border-slate-800 text-white'
                          }`}
                        />
                      </div>
                      <div className="col-span-2 text-center flex items-center justify-center gap-1">
                        <span className="text-[10px] font-mono text-slate-400">متاح:{avail}</span>
                        {transferLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setTransferLines((prev) => prev.filter((_, i) => i !== idx))}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">ملاحظات التحويل</label>
                <textarea
                  rows={2}
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="سبب التحويل أو رقم إذن النقل..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg"
                >
                  تنفيذ التحويل الفوري
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Transfer Modal */}
      {inspectTransfer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white font-mono">{inspectTransfer.transferNumber}</h3>
                <p className="text-slate-400">التاريخ: {inspectTransfer.date}</p>
              </div>
              <button type="button" onClick={() => setInspectTransfer(null)} className="p-1.5 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
              <div>
                <span className="text-slate-500 block">من المستودع:</span>
                <strong className="text-white">{warehouses.find((w) => w.id === inspectTransfer.fromWarehouseId)?.nameAr}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">إلى المستودع:</span>
                <strong className="text-white">{warehouses.find((w) => w.id === inspectTransfer.toWarehouseId)?.nameAr}</strong>
              </div>
            </div>

            <table className="w-full text-right text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-950 text-slate-400">
                <tr>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3 text-center">الوحدة</th>
                  <th className="py-2 px-3 text-center">الكمية</th>
                  <th className="py-2 px-3 text-left">تكلفة الوحدة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {inspectTransfer.items.map((it) => (
                  <tr key={it.itemId}>
                    <td className="py-2 px-3 font-sans text-white">{it.itemName}</td>
                    <td className="py-2 px-3 text-center font-sans text-slate-400">{it.unit}</td>
                    <td className="py-2 px-3 text-center font-bold text-amber-300">{it.quantity}</td>
                    <td className="py-2 px-3 text-left text-slate-300">{it.unitCost.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void downloadReportAsPDF({
                      title: `سند تحويل مخزني #${inspectTransfer.transferNumber}`,
                      periodText: inspectTransfer.date,
                      company,
                      branch,
                      fileName: `تحويل_${inspectTransfer.transferNumber}`,
                      metadata: {
                        'من المستودع': warehouses.find((w) => w.id === inspectTransfer.fromWarehouseId)?.nameAr || '-',
                        'إلى المستودع': warehouses.find((w) => w.id === inspectTransfer.toWarehouseId)?.nameAr || '-',
                        'الحالة': inspectTransfer.status === 'completed' ? 'مكتمل' : 'ملغى',
                      },
                      tables: [
                        {
                          headers: ['الصنف', 'الوحدة', 'الكمية', 'التكلفة'],
                          rows: inspectTransfer.items.map((it) => [it.itemName, it.unit, String(it.quantity), it.unitCost.toLocaleString()]),
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-3 py-2 bg-amber-500 text-slate-950 font-bold rounded-lg"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    printReportPreview({
                      title: `سند تحويل مخزني #${inspectTransfer.transferNumber}`,
                      periodText: inspectTransfer.date,
                      company,
                      branch,
                      tables: [
                        {
                          headers: ['الصنف', 'الوحدة', 'الكمية', 'التكلفة'],
                          rows: inspectTransfer.items.map((it) => [it.itemName, it.unit, String(it.quantity), it.unitCost.toLocaleString()]),
                        },
                      ],
                    })
                  }
                  className="flex items-center gap-1 px-3 py-2 bg-slate-800 text-slate-200 font-bold rounded-lg"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
              </div>
              <button type="button" onClick={() => setInspectTransfer(null)} className="px-4 py-2 bg-slate-800 text-white rounded-lg">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT ITEM */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">{editingItemId ? 'تعديل بيانات الصنف' : 'تعريف صنف جديد'}</h3>
              <button type="button" onClick={() => setIsItemModalOpen(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItemSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">اسم الصنف التجاري *</label>
                <input
                  type="text"
                  required
                  value={formNameAr}
                  onChange={(e) => setFormNameAr(e.target.value)}
                  placeholder="مثال: شاشة سامسونج 27 بوصة"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الباركود الدولي</label>
                  <input
                    type="text"
                    value={formBarcode}
                    onChange={(e) => setFormBarcode(e.target.value)}
                    placeholder="629104000..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">التصنيف</label>
                  <input
                    type="text"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الوحدة الأساسية</label>
                  <input
                    list="uom-suggestions"
                    value={formBaseUnit}
                    onChange={(e) => setFormBaseUnit(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                  <datalist id="uom-suggestions">
                    {unitsOfMeasure.map((u) => (
                      <option key={u.id} value={u.nameAr} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">حد إعادة الطلب</label>
                  <input
                    type="number"
                    min={0}
                    value={formMinAlert}
                    onChange={(e) => setFormMinAlert(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">سعر الشراء الافتراضي ({currencySymbol})</label>
                  <input
                    type="number"
                    value={formPurchasePrice}
                    onChange={(e) => setFormPurchasePrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">سعر البيع الافتراضي ({currencySymbol})</label>
                  <input
                    type="number"
                    value={formSalePrice}
                    onChange={(e) => setFormSalePrice(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button type="button" onClick={() => setIsItemModalOpen(false)} className="px-4 py-2 bg-slate-800 text-slate-300 font-semibold rounded-lg">
                  إلغاء
                </button>
                <button type="submit" className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg">
                  حفظ الصنف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(reverseTarget)}
        title="تأكيد عكس وإلغاء التحويل المخزني"
        message={`هل تريد عكس التحويل رقم ${reverseTarget?.transferNumber || ''} وإرجاع كافة الكميات إلى مستودع المصدر؟`}
        confirmLabel="نعم، عكس التحويل"
        variant="danger"
        onCancel={() => setReverseTarget(null)}
        onConfirm={() => {
          if (reverseTarget && onReverseTransfer) {
            onReverseTransfer(reverseTarget);
          }
          setReverseTarget(null);
        }}
      />
    </div>
  );
};
