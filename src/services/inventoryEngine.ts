/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Inventory & Warehouse Engine
 */

import {
  ItemWarehouseStock,
  StockMovement,
  InventoryTransfer,
  PhysicalStocktaking,
  StockCostLayer,
  InventoryItem,
  InventoryBatch,
} from '../types/erp';

export interface WarehouseItemStockSummary {
  warehouseId: string;
  warehouseName: string;
  quantityOnHand: number;
  averageCost: number;
  totalValuation: number;
}

/**
 * Returns quantity on hand for an item in a specific warehouse
 */
export function getItemStockInWarehouse(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string
): number {
  const stock = stocks.find((s) => s.itemId === itemId && s.warehouseId === warehouseId);
  return stock ? stock.quantityOnHand : 0;
}

/**
 * Checks whether an item quantity can be fulfilled based on warehouse stock and settings
 */
export function canFulfillStock(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string,
  requiredQty: number,
  allowNegativeStock: boolean
): { canFulfill: boolean; currentQty: number; message?: string } {
  const currentQty = getItemStockInWarehouse(stocks, itemId, warehouseId);
  if (allowNegativeStock) {
    return { canFulfill: true, currentQty };
  }
  if (currentQty >= requiredQty) {
    return { canFulfill: true, currentQty };
  }
  return {
    canFulfill: false,
    currentQty,
    message: `الكمية المطلوبة (${requiredQty}) غير متوفرة في المستودع المختار! الرصيد المتاح حالياً هو (${currentQty}). سياسة النظام تمنع البيع بالسالب.`,
  };
}

/**
 * Updates stock levels in warehouse
 */
export function updateWarehouseStock(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string,
  quantityDelta: number,
  unitCost: number
): ItemWarehouseStock[] {
  const safeDelta = Number.isFinite(quantityDelta) ? quantityDelta : 0;
  const safeUnitCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0;
  const index = stocks.findIndex((s) => s.itemId === itemId && s.warehouseId === warehouseId);
  if (index >= 0) {
    const existing = stocks[index];
    const currentQty = Number.isFinite(existing.quantityOnHand) ? existing.quantityOnHand : 0;
    const currentAvgCost = Number.isFinite(existing.averageCost) && existing.averageCost >= 0 ? existing.averageCost : 0;
    const newQty = currentQty + safeDelta;

    let newCost = currentAvgCost;
    if (safeDelta > 0 && safeUnitCost > 0) {
      if (currentQty <= 0 || newQty <= 0) {
        // Recovering from zero or negative stock: reset average cost cleanly to incoming unit cost
        newCost = Math.round(safeUnitCost * 100) / 100;
      } else {
        const currentValuation = currentQty * currentAvgCost;
        const addedValuation = safeDelta * safeUnitCost;
        newCost = Math.round(((currentValuation + addedValuation) / newQty) * 100) / 100;
      }
    }

    const updated = [...stocks];
    updated[index] = {
      ...existing,
      quantityOnHand: newQty,
      averageCost: newCost,
    };
    return updated;
  }
  return [
    ...stocks,
    {
      itemId,
      warehouseId,
      quantityOnHand: safeDelta,
      averageCost: safeUnitCost,
    },
  ];
}

/**
 * Executes a warehouse-to-warehouse stock transfer with strict conservation of quantity and idempotency guards.
 */
export function executeInventoryTransfer(
  stocks: ItemWarehouseStock[],
  transfer: InventoryTransfer,
  userFullName: string
): { success: boolean; newStocks: ItemWarehouseStock[]; movements: StockMovement[]; error?: string } {
  if (transfer.status === 'completed' || transfer.status === 'cancelled') {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'هذا التحويل منفذ أو ملغى مسبقاً ولا يمكن إعادة تنفيذه.',
    };
  }

  if (transfer.fromWarehouseId === transfer.toWarehouseId) {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'لا يمكن التحويل لنفس المستودع المصدر!',
    };
  }

  if (!transfer.items || transfer.items.length === 0) {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'يجب تحديد صنف واحد على الأقل للتحويل المخزني.',
    };
  }

  // 1. Check validity & availability
  for (const item of transfer.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return {
        success: false,
        newStocks: stocks,
        movements: [],
        error: `كمية الصنف "${item.itemName}" غير صالحة للتحويل (${item.quantity}).`,
      };
    }
    const available = getItemStockInWarehouse(stocks, item.itemId, transfer.fromWarehouseId);
    if (available < item.quantity) {
      return {
        success: false,
        newStocks: stocks,
        movements: [],
        error: `الرصيد المتاح من الصنف "${item.itemName}" في مستودع المصدر (${available}) أقل من كمية التحويل المطلوبة (${item.quantity}).`,
      };
    }
  }

  // 2. Perform transfer
  let currentStocks = [...stocks];
  const movements: StockMovement[] = [];
  const ts = Date.now();

  transfer.items.forEach((item, idx) => {
    currentStocks = updateWarehouseStock(
      currentStocks,
      item.itemId,
      transfer.fromWarehouseId,
      -item.quantity,
      item.unitCost
    );
    movements.push({
      id: `sm-tr-out-${ts}-${idx}-${item.itemId}`,
      itemId: item.itemId,
      warehouseId: transfer.fromWarehouseId,
      documentType: 'تحويل_مخزني_صرف',
      documentNumber: transfer.transferNumber,
      documentId: transfer.id,
      movementDate: transfer.date,
      quantityChange: -item.quantity,
      unitCost: item.unitCost,
      totalCost: item.quantity * item.unitCost,
      runningBalance: getItemStockInWarehouse(currentStocks, item.itemId, transfer.fromWarehouseId),
      notes: `تحويل صادر إلى مستودع ${transfer.toWarehouseId}`,
      performedBy: userFullName,
    });

    currentStocks = updateWarehouseStock(
      currentStocks,
      item.itemId,
      transfer.toWarehouseId,
      item.quantity,
      item.unitCost
    );
    movements.push({
      id: `sm-tr-in-${ts}-${idx}-${item.itemId}`,
      itemId: item.itemId,
      warehouseId: transfer.toWarehouseId,
      documentType: 'تحويل_مخزني_استلام',
      documentNumber: transfer.transferNumber,
      documentId: transfer.id,
      movementDate: transfer.date,
      quantityChange: item.quantity,
      unitCost: item.unitCost,
      totalCost: item.quantity * item.unitCost,
      runningBalance: getItemStockInWarehouse(currentStocks, item.itemId, transfer.toWarehouseId),
      notes: `استلام تحويل وارد من مستودع ${transfer.fromWarehouseId}`,
      performedBy: userFullName,
    });
  });

  return {
    success: true,
    newStocks: currentStocks,
    movements,
  };
}

/**
 * Reverses a completed warehouse-to-warehouse transfer back into source warehouse.
 */
export function reverseInventoryTransfer(
  stocks: ItemWarehouseStock[],
  transfer: InventoryTransfer,
  userFullName: string
): { success: boolean; newStocks: ItemWarehouseStock[]; movements: StockMovement[]; error?: string } {
  if (transfer.status !== 'completed') {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'يمكن عكس التحويلات المكتملة فقط.',
    };
  }

  for (const item of transfer.items) {
    const destAvailable = getItemStockInWarehouse(stocks, item.itemId, transfer.toWarehouseId);
    if (destAvailable < item.quantity) {
      return {
        success: false,
        newStocks: stocks,
        movements: [],
        error: `لا يمكن عكس التحويل لأن الكمية المتوفرة حالياً في المستودع المستلم من "${item.itemName}" هي (${destAvailable}) وأقل من الكمية المحولة (${item.quantity}).`,
      };
    }
  }

  let currentStocks = [...stocks];
  const movements: StockMovement[] = [];
  const ts = Date.now();
  const revDate = new Date().toISOString().split('T')[0];

  transfer.items.forEach((item, idx) => {
    currentStocks = updateWarehouseStock(
      currentStocks,
      item.itemId,
      transfer.toWarehouseId,
      -item.quantity,
      item.unitCost
    );
    movements.push({
      id: `sm-tr-rev-out-${ts}-${idx}-${item.itemId}`,
      itemId: item.itemId,
      warehouseId: transfer.toWarehouseId,
      documentType: 'تحويل_مخزني_صرف',
      documentNumber: `${transfer.transferNumber}-REV`,
      documentId: transfer.id,
      movementDate: revDate,
      quantityChange: -item.quantity,
      unitCost: item.unitCost,
      totalCost: item.quantity * item.unitCost,
      runningBalance: getItemStockInWarehouse(currentStocks, item.itemId, transfer.toWarehouseId),
      notes: `عكس وإلغاء تحويل مخزني ${transfer.transferNumber}`,
      performedBy: userFullName,
    });

    currentStocks = updateWarehouseStock(
      currentStocks,
      item.itemId,
      transfer.fromWarehouseId,
      item.quantity,
      item.unitCost
    );
    movements.push({
      id: `sm-tr-rev-in-${ts}-${idx}-${item.itemId}`,
      itemId: item.itemId,
      warehouseId: transfer.fromWarehouseId,
      documentType: 'تحويل_مخزني_استلام',
      documentNumber: `${transfer.transferNumber}-REV`,
      documentId: transfer.id,
      movementDate: revDate,
      quantityChange: item.quantity,
      unitCost: item.unitCost,
      totalCost: item.quantity * item.unitCost,
      runningBalance: getItemStockInWarehouse(currentStocks, item.itemId, transfer.fromWarehouseId),
      notes: `استرجاع مخزون من عكس التحويل ${transfer.transferNumber}`,
      performedBy: userFullName,
    });
  });

  return {
    success: true,
    newStocks: currentStocks,
    movements,
  };
}

/**
 * Applies physical stocktaking adjustments across single or multi-warehouse scopes with exact running balances.
 */
export function applyStocktakingAdjustments(
  stocks: ItemWarehouseStock[],
  stocktake: PhysicalStocktaking,
  userFullName: string
): { success: boolean; newStocks: ItemWarehouseStock[]; movements: StockMovement[]; error?: string } {
  if (stocktake.status === 'approved') {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'تم اعتماد محضر الجرد مسبقاً ولا يمكن ترحيله مرة أخرى.',
    };
  }
  if (stocktake.status === 'cancelled') {
    return {
      success: false,
      newStocks: stocks,
      movements: [],
      error: 'محضر الجرد ملغى ولا يمكن اعتماده.',
    };
  }

  let currentStocks = [...stocks];
  const movements: StockMovement[] = [];
  const ts = Date.now();

  stocktake.items.forEach((item, idx) => {
    const targetWarehouseId = item.warehouseId || stocktake.warehouseId;
    if (!targetWarehouseId) return;

    const currentQty = getItemStockInWarehouse(currentStocks, item.itemId, targetWarehouseId);
    const delta = Number(item.physicalQuantity) - currentQty;
    if (delta === 0) return;

    currentStocks = updateWarehouseStock(
      currentStocks,
      item.itemId,
      targetWarehouseId,
      delta,
      item.unitCost
    );

    const newBalance = getItemStockInWarehouse(currentStocks, item.itemId, targetWarehouseId);
    movements.push({
      id: `sm-st-${ts}-${idx}-${item.itemId}-${targetWarehouseId}`,
      itemId: item.itemId,
      warehouseId: targetWarehouseId,
      documentType: delta > 0 ? 'تسوية_زيادة' : 'تسوية_عجز',
      documentNumber: stocktake.stocktakeNumber,
      documentId: stocktake.id,
      movementDate: stocktake.date,
      quantityChange: delta,
      unitCost: item.unitCost,
      totalCost: Math.abs(delta) * (item.unitCost || 0),
      runningBalance: newBalance,
      notes: `تسوية جرد فعلي (${item.warehouseName || targetWarehouseId}): الدفتري ${currentQty} -> الفعلي ${item.physicalQuantity}`,
      performedBy: userFullName,
    });
  });

  return {
    success: true,
    newStocks: currentStocks,
    movements,
  };
}

/**
 * Returns truly sellable stock (Quantity On Hand minus Reserved Quantity)
 */
export function getSellableStockInWarehouse(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string
): number {
  const stock = stocks.find((s) => s.itemId === itemId && s.warehouseId === warehouseId);
  if (!stock) return 0;
  return Math.max(0, (stock.quantityOnHand || 0) - (stock.reservedQuantity || 0));
}

export function reserveWarehouseStock(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string,
  qtyToReserve: number
): ItemWarehouseStock[] {
  if (qtyToReserve <= 0) return stocks;
  return stocks.map((s) =>
    s.itemId === itemId && s.warehouseId === warehouseId
      ? { ...s, reservedQuantity: (s.reservedQuantity || 0) + qtyToReserve }
      : s
  );
}

export function releaseReservedWarehouseStock(
  stocks: ItemWarehouseStock[],
  itemId: string,
  warehouseId: string,
  qtyToRelease: number
): ItemWarehouseStock[] {
  if (qtyToRelease <= 0) return stocks;
  return stocks.map((s) =>
    s.itemId === itemId && s.warehouseId === warehouseId
      ? { ...s, reservedQuantity: Math.max(0, (s.reservedQuantity || 0) - qtyToRelease) }
      : s
  );
}

/**
 * Adds an inbound FIFO cost layer (Purchase, Opening, Return, Surplus)
 */
export function addFifoCostLayer(
  layers: StockCostLayer[],
  params: {
    companyId?: string;
    itemId: string;
    warehouseId: string;
    quantity: number;
    unitCost: number;
    receivedDate: string;
    sourceDocType: string;
    sourceDocId: string;
    sourceDocNumber: string;
    batchNumber?: string;
    expiryDate?: string;
  }
): StockCostLayer[] {
  if (params.quantity <= 0) return layers;
  const newLayer: StockCostLayer = {
    id: `fifo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    companyId: params.companyId,
    itemId: params.itemId,
    warehouseId: params.warehouseId,
    batchNumber: params.batchNumber,
    expiryDate: params.expiryDate,
    receivedDate: params.receivedDate,
    sourceDocType: params.sourceDocType,
    sourceDocId: params.sourceDocId,
    sourceDocNumber: params.sourceDocNumber,
    originalQuantity: params.quantity,
    remainingQuantity: params.quantity,
    unitCost: Math.max(0, Number(params.unitCost) || 0),
  };
  return [...layers, newLayer];
}

/**
 * Consumes FIFO cost layers oldest-first for outbound quantity and computes exact FIFO COGS.
 */
export function consumeFifoCostLayers(
  layers: StockCostLayer[],
  itemId: string,
  warehouseId: string,
  qtyToConsume: number,
  fallbackUnitCost: number,
  companyId?: string
): {
  nextLayers: StockCostLayer[];
  totalCogsBase: number;
  weightedOutUnitCost: number;
  consumedBreakdown: Array<{ layerId: string; qty: number; unitCost: number }>;
} {
  if (qtyToConsume <= 0) {
    return { nextLayers: layers, totalCogsBase: 0, weightedOutUnitCost: fallbackUnitCost, consumedBreakdown: [] };
  }

  // Sort eligible layers chronologically oldest-first (FIFO), scoped to companyId when provided
  const sortedIds = layers
    .filter(
      (l) =>
        (!companyId || !l.companyId || l.companyId === companyId) &&
        l.itemId === itemId &&
        l.warehouseId === warehouseId &&
        l.remainingQuantity > 0
    )
    .sort((a, b) => a.receivedDate.localeCompare(b.receivedDate))
    .map((l) => l.id);

  let remainingNeeded = qtyToConsume;
  let totalCost = 0;
  const consumedBreakdown: Array<{ layerId: string; qty: number; unitCost: number }> = [];
  const layerMap = new Map(layers.map((l) => [l.id, { ...l }]));

  for (const id of sortedIds) {
    if (remainingNeeded <= 0) break;
    const layer = layerMap.get(id);
    if (!layer || layer.remainingQuantity <= 0) continue;

    const takeQty = Math.min(layer.remainingQuantity, remainingNeeded);
    layer.remainingQuantity = Math.round((layer.remainingQuantity - takeQty) * 10000) / 10000;
    remainingNeeded = Math.round((remainingNeeded - takeQty) * 10000) / 10000;
    totalCost += takeQty * layer.unitCost;
    consumedBreakdown.push({ layerId: layer.id, qty: takeQty, unitCost: layer.unitCost });
  }

  // If stock went negative or no layers existed, value remainder at fallbackUnitCost
  if (remainingNeeded > 0) {
    totalCost += remainingNeeded * Math.max(0, fallbackUnitCost);
  }

  const nextLayers = layers.map((l) => layerMap.get(l.id) || l);
  const totalCogsBase = Math.round(totalCost * 100) / 100;
  const weightedOutUnitCost = Math.round((totalCogsBase / qtyToConsume) * 100) / 100;

  return {
    nextLayers,
    totalCogsBase,
    weightedOutUnitCost,
    consumedBreakdown,
  };
}

/**
 * Updates batch/lot tracking balances cleanly
 */
export function applyBatchMovement(
  batches: InventoryBatch[],
  params: {
    companyId?: string;
    itemId: string;
    warehouseId: string;
    batchNumber: string;
    expiryDate?: string;
    quantityDelta: number;
    unitCost: number;
    date: string;
    sourceDocId?: string;
    storageLocationId?: string;
  }
): InventoryBatch[] {
  if (!params.batchNumber) return batches;
  const idx = batches.findIndex(
    (b) =>
      b.itemId === params.itemId &&
      b.warehouseId === params.warehouseId &&
      b.batchNumber === params.batchNumber
  );
  if (idx >= 0) {
    const updated = [...batches];
    updated[idx] = {
      ...updated[idx],
      quantityRemaining: Math.max(0, updated[idx].quantityRemaining + params.quantityDelta),
      expiryDate: params.expiryDate || updated[idx].expiryDate,
    };
    return updated;
  }
  if (params.quantityDelta <= 0) return batches;
  return [
    ...batches,
    {
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      companyId: params.companyId,
      itemId: params.itemId,
      warehouseId: params.warehouseId,
      batchNumber: params.batchNumber,
      expiryDate: params.expiryDate,
      quantityRemaining: params.quantityDelta,
      unitCost: params.unitCost,
      storageLocationId: params.storageLocationId,
      receivedDate: params.date,
      sourceDocId: params.sourceDocId,
    },
  ];
}

/**
 * Evaluates total stock valuation comparing Weighted Average vs active FIFO layers.
 */
export function calculateInventoryValuationComparison(
  items: InventoryItem[],
  stocks: ItemWarehouseStock[],
  fifoLayers: StockCostLayer[],
  companyId?: string,
  valuationPolicy?: 'FIFO' | 'WEIGHTED_AVERAGE' | 'PER_ITEM'
): Array<{
  itemId: string;
  itemCode: string;
  itemName: string;
  valuationMethod: 'FIFO' | 'WEIGHTED_AVERAGE';
  totalQty: number;
  weightedAvgValue: number;
  fifoLayerValue: number;
  activeValuation: number;
}> {
  const scopedItems = companyId ? items.filter((it) => !it.companyId || it.companyId === companyId) : items;
  const scopedStocks = companyId ? stocks.filter((s) => !s.companyId || s.companyId === companyId) : stocks;
  const scopedLayers = companyId ? fifoLayers.filter((l) => !l.companyId || l.companyId === companyId) : fifoLayers;

  return scopedItems.map((item) => {
    const itemStocks = scopedStocks.filter((s) => s.itemId === item.id);
    const totalQty = itemStocks.reduce((sum, s) => sum + (s.quantityOnHand || 0), 0);
    const weightedAvgValue =
      totalQty <= 0
        ? 0
        : Math.round(
            itemStocks.reduce((sum, s) => sum + (s.quantityOnHand || 0) * (s.averageCost || 0), 0) * 100
          ) / 100;
    const itemLayers = scopedLayers.filter((l) => l.itemId === item.id && l.remainingQuantity > 0);
    const fifoLayerValue =
      totalQty <= 0
        ? 0
        : itemLayers.length > 0
        ? Math.round(itemLayers.reduce((sum, l) => sum + l.remainingQuantity * l.unitCost, 0) * 100) / 100
        : weightedAvgValue;

    const effectiveMethod: 'FIFO' | 'WEIGHTED_AVERAGE' =
      valuationPolicy === 'FIFO'
        ? 'FIFO'
        : valuationPolicy === 'WEIGHTED_AVERAGE'
        ? 'WEIGHTED_AVERAGE'
        : item.valuationMethod;

    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.nameAr,
      valuationMethod: effectiveMethod,
      totalQty,
      weightedAvgValue,
      fifoLayerValue,
      activeValuation: effectiveMethod === 'FIFO' ? fifoLayerValue : weightedAvgValue,
    };
  });
}
