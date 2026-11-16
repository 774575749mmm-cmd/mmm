/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Historical Customer-Item Pricing Engine
 * Looks up previous sales/purchase prices for any Customer + Inventory Item combination.
 */

import { Currency, CurrencyCode, Customer, InventoryItem, Invoice } from '../types/erp';
import { convertFromBase, getEffectiveCurrencyRate } from './currencyHelpers';
import { normalizeArabicSearch, rankSearchResults } from './searchHelpers';

export interface PriceHistoryEntry {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  createdAt: string;
  invoiceType: Invoice['type'];
  paymentType: Invoice['paymentType'];
  status: Invoice['status'];
  entityId: string;
  entityCode: string;
  entityName: string;
  entityPhone: string;
  itemId: string;
  itemCode: string;
  itemBarcode: string;
  itemName: string;
  unit: string;
  quantity: number;
  bonusQuantity: number;
  unitPrice: number;
  discountPercentage: number;
  netUnitPrice: number;
  lineTotal: number;
  currency: CurrencyCode;
  exchangeRate: number;
  baseUnitPrice: number;
  baseNetUnitPrice: number;
}

export interface PriceLookupQuery {
  customerId?: string;
  customerQuery?: string;
  itemId?: string;
  itemQuery?: string;
  docScope?: 'sales' | 'all_sales_returns' | 'purchases';
}

export interface PriceLookupResult {
  matches: PriceHistoryEntry[];
  lastEntry: PriceHistoryEntry | null;
  lastCurrency: CurrencyCode;
  minNativeUnitPrice: number;
  maxNativeUnitPrice: number;
  avgNativeUnitPrice: number;
  minBaseUnitPrice: number;
  maxBaseUnitPrice: number;
  avgBaseUnitPrice: number;
  totalQtySold: number;
  otherCustomersRecent: PriceHistoryEntry[];
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function lookupCustomerItemPriceHistory(
  invoices: Invoice[],
  customers: Customer[],
  inventoryItems: InventoryItem[],
  currencies: Currency[],
  query: PriceLookupQuery
): PriceLookupResult {
  const customerById = new Map<string, Customer>(customers.map((c) => [c.id, c]));
  const itemById = new Map<string, InventoryItem>(inventoryItems.map((i) => [i.id, i]));

  // Match allowed invoice types
  const scope = query.docScope || 'sales';
  const isAllowedType = (type: Invoice['type']) => {
    if (scope === 'sales') return type === 'مبيعات';
    if (scope === 'all_sales_returns') return type === 'مبيعات' || type === 'مرتجع_مبيعات';
    return type === 'مشتريات' || type === 'مرتجع_مشتريات';
  };

  // Resolve matching IDs from free-text queries using the unified ranked Arabic/numeric search engine
  const matchedCustomerIds = query.customerQuery?.trim()
    ? new Set(
        rankSearchResults(
          customers,
          query.customerQuery,
          (c) => ({
            code: c.code,
            id: c.id,
            name: c.nameAr,
            phone: `${c.phone || ''} ${c.whatsapp || ''}`,
            alt: c.addressDetails,
          }),
          300
        ).map((c) => c.id)
      )
    : null;

  const matchedItemIds = query.itemQuery?.trim()
    ? new Set(
        rankSearchResults(
          inventoryItems,
          query.itemQuery,
          (it) => ({
            code: it.code,
            barcode: it.barcode,
            id: it.id,
            name: it.nameAr,
            alt: `${it.nameEn || ''} ${it.category || ''}`,
          }),
          300
        ).map((it) => it.id)
      )
    : null;

  const normCustQ = normalizeArabicSearch(query.customerQuery || '');
  const normItemQ = normalizeArabicSearch(query.itemQuery || '');

  const allEntries: PriceHistoryEntry[] = [];
  const otherCustomerEntries: PriceHistoryEntry[] = [];

  // Sort invoices newest first
  const sortedInvoices = [...invoices].sort((a, b) => {
    const dCmp = (b.date || '').localeCompare(a.date || '');
    if (dCmp !== 0) return dCmp;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  for (const inv of sortedInvoices) {
    if (inv.status === 'cancelled' || !isAllowedType(inv.type)) continue;

    const cust = customerById.get(inv.entityId);
    const rate = getEffectiveCurrencyRate(currencies, inv.currency, inv.exchangeRate);

    const custMatchedById = !query.customerId || inv.entityId === query.customerId;
    const custMatchedByQuery =
      !normCustQ ||
      (matchedCustomerIds && matchedCustomerIds.has(inv.entityId)) ||
      normalizeArabicSearch(inv.entityName).includes(normCustQ) ||
      normalizeArabicSearch(inv.invoiceNumber).includes(normCustQ);

    const customerMatches = custMatchedById && custMatchedByQuery;

    for (const line of inv.items) {
      const catItem = itemById.get(line.itemId);
      const itemMatchedById = !query.itemId || line.itemId === query.itemId;
      const itemMatchedByQuery =
        !normItemQ ||
        (matchedItemIds && matchedItemIds.has(line.itemId)) ||
        normalizeArabicSearch(line.itemName).includes(normItemQ) ||
        normalizeArabicSearch(line.itemBarcode || '').includes(normItemQ) ||
        normalizeArabicSearch(catItem?.code || '').includes(normItemQ);

      if (!itemMatchedById || !itemMatchedByQuery) continue;

      const qty = Math.max(0, Number(line.quantity) || 0);
      const rawUnit = Number(line.unitPrice) || 0;
      const lineTotal = Number(line.total) || qty * rawUnit;
      const netUnit = qty > 0 ? round2(lineTotal / qty) : rawUnit;

      const entry: PriceHistoryEntry = {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        date: inv.date,
        createdAt: inv.createdAt,
        invoiceType: inv.type,
        paymentType: inv.paymentType,
        status: inv.status,
        entityId: inv.entityId,
        entityCode: cust?.code || '-',
        entityName: inv.entityName,
        entityPhone: cust?.whatsapp || cust?.phone || '',
        itemId: line.itemId,
        itemCode: catItem?.code || '-',
        itemBarcode: line.itemBarcode || catItem?.barcode || '',
        itemName: line.itemName,
        unit: line.unit || catItem?.baseUnit || 'حبة',
        quantity: qty,
        bonusQuantity: line.bonusQuantity || 0,
        unitPrice: rawUnit,
        discountPercentage: line.discountPercentage || 0,
        netUnitPrice: netUnit,
        lineTotal,
        currency: inv.currency || 'YER',
        exchangeRate: rate,
        baseUnitPrice: round2(rawUnit * rate),
        baseNetUnitPrice: round2(netUnit * rate),
      };

      if (customerMatches) {
        allEntries.push(entry);
      } else if ((query.itemId || normItemQ) && otherCustomerEntries.length < 8) {
        otherCustomerEntries.push(entry);
      }
    }
  }

  const lastEntry = allEntries[0] || null;
  const lastCurrency: CurrencyCode = lastEntry?.currency || 'YER';

  if (allEntries.length === 0) {
    return {
      matches: [],
      lastEntry: null,
      lastCurrency: 'YER',
      minNativeUnitPrice: 0,
      maxNativeUnitPrice: 0,
      avgNativeUnitPrice: 0,
      minBaseUnitPrice: 0,
      maxBaseUnitPrice: 0,
      avgBaseUnitPrice: 0,
      totalQtySold: 0,
      otherCustomersRecent: otherCustomerEntries,
    };
  }

  let minBase = Infinity;
  let maxBase = -Infinity;
  let sumBase = 0;
  let totalQty = 0;

  for (const m of allEntries) {
    if (m.baseUnitPrice < minBase) minBase = m.baseUnitPrice;
    if (m.baseUnitPrice > maxBase) maxBase = m.baseUnitPrice;
    sumBase += m.baseUnitPrice;
    totalQty += m.quantity;
  }

  const avgBase = sumBase / allEntries.length;

  return {
    matches: allEntries,
    lastEntry,
    lastCurrency,
    minBaseUnitPrice: round2(minBase),
    maxBaseUnitPrice: round2(maxBase),
    avgBaseUnitPrice: round2(avgBase),
    minNativeUnitPrice: round2(convertFromBase(minBase, lastCurrency, currencies)),
    maxNativeUnitPrice: round2(convertFromBase(maxBase, lastCurrency, currencies)),
    avgNativeUnitPrice: round2(convertFromBase(avgBase, lastCurrency, currencies)),
    totalQtySold: round2(totalQty),
    otherCustomersRecent: otherCustomerEntries,
  };
}

/**
 * Fast lookup used inline inside InvoiceWorkbench rows to fetch the last price sold/purchased
 * for a given party + item, converted into the active invoice currency.
 */
export function getLastPartyItemPrice(
  invoices: Invoice[],
  partyId: string,
  itemId: string,
  targetCurrency: CurrencyCode,
  targetExchangeRate: number,
  currencies: Currency[],
  isPurchase: boolean
): {
  priceInTargetCurrency: number;
  originalPrice: number;
  originalCurrency: CurrencyCode;
  date: string;
  invoiceNumber: string;
  quantity: number;
} | null {
  if (!partyId || !itemId) return null;

  const allowedTypes: Invoice['type'][] = isPurchase ? ['مشتريات'] : ['مبيعات'];
  const sorted = [...invoices]
    .filter((inv) => inv.status !== 'cancelled' && inv.entityId === partyId && allowedTypes.includes(inv.type))
    .sort((a, b) => {
      const dCmp = (b.date || '').localeCompare(a.date || '');
      if (dCmp !== 0) return dCmp;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

  for (const inv of sorted) {
    const line = inv.items.find((it) => it.itemId === itemId);
    if (!line) continue;
    const srcRate = getEffectiveCurrencyRate(currencies, inv.currency, inv.exchangeRate);
    const basePrice = (Number(line.unitPrice) || 0) * srcRate;
    const safeTargetRate = targetExchangeRate > 0 ? targetExchangeRate : getEffectiveCurrencyRate(currencies, targetCurrency);
    const converted = inv.currency === targetCurrency
      ? round2(line.unitPrice)
      : round2(basePrice / safeTargetRate);

    return {
      priceInTargetCurrency: converted,
      originalPrice: round2(line.unitPrice),
      originalCurrency: inv.currency || 'YER',
      date: inv.date,
      invoiceNumber: inv.invoiceNumber,
      quantity: line.quantity,
    };
  }

  return null;
}

export interface GeneralItemPriceSnapshot {
  baseUnitPrice: number;
  originalPrice: number;
  originalCurrency: CurrencyCode;
  date: string;
  partyId: string;
  partyName: string;
  invoiceNumber: string;
  quantity: number;
  bonusQuantity: number;
}

export interface ItemPriceIntelligence {
  lastPurchase: GeneralItemPriceSnapshot | null;
  lastSaleGeneral: GeneralItemPriceSnapshot | null;
  partyLastPrices: Map<string, GeneralItemPriceSnapshot>; // key: `${partyId}:${'P' | 'S'}`
}

/**
 * Builds an O(N) single-pass index of historical purchase costs, general last sale prices,
 * and per-party last prices so spreadsheet invoice grids can perform O(1) lookups per row.
 */
export function buildItemPriceIntelligenceIndex(
  invoices: Invoice[],
  currencies: Currency[]
): Map<string, ItemPriceIntelligence> {
  const sorted = [...invoices]
    .filter((inv) => inv.status !== 'cancelled')
    .sort((a, b) => {
      const dCmp = (b.date || '').localeCompare(a.date || '');
      if (dCmp !== 0) return dCmp;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

  const index = new Map<string, ItemPriceIntelligence>();

  const ensureEntry = (itemId: string): ItemPriceIntelligence => {
    let rec = index.get(itemId);
    if (!rec) {
      rec = {
        lastPurchase: null,
        lastSaleGeneral: null,
        partyLastPrices: new Map(),
      };
      index.set(itemId, rec);
    }
    return rec;
  };

  for (const inv of sorted) {
    const isPurchase = inv.type === 'مشتريات';
    const isSale = inv.type === 'مبيعات';
    if (!isPurchase && !isSale) continue;

    const rate = getEffectiveCurrencyRate(currencies, inv.currency, inv.exchangeRate);

    for (const line of inv.items) {
      if (!line.itemId) continue;
      const rec = ensureEntry(line.itemId);
      const qty = Math.max(0, Number(line.quantity) || 0);
      const bonus = Math.max(0, Number(line.bonusQuantity) || 0);
      // For purchases, compute actual net purchased cost per received unit (distinct from weighted avg)
      const totalReceived = qty + bonus;
      const rawPurchaseUnit =
        isPurchase && totalReceived > 0 && line.subtotal > 0
          ? round2(line.subtotal / totalReceived)
          : round2(line.unitPrice);

      const effectiveOriginalPrice = isPurchase ? rawPurchaseUnit : round2(line.unitPrice);
      const snap: GeneralItemPriceSnapshot = {
        baseUnitPrice: round2(effectiveOriginalPrice * rate),
        originalPrice: effectiveOriginalPrice,
        originalCurrency: inv.currency || 'YER',
        date: inv.date,
        partyId: inv.entityId,
        partyName: inv.entityName,
        invoiceNumber: inv.invoiceNumber,
        quantity: qty,
        bonusQuantity: bonus,
      };

      if (isPurchase && !rec.lastPurchase) {
        rec.lastPurchase = snap;
      }
      if (isSale && !rec.lastSaleGeneral) {
        rec.lastSaleGeneral = snap;
      }

      const partyKey = `${inv.entityId}:${isPurchase ? 'P' : 'S'}`;
      if (inv.entityId && !rec.partyLastPrices.has(partyKey)) {
        rec.partyLastPrices.set(partyKey, snap);
      }
    }
  }

  return index;
}

export function convertBasePriceToTargetCurrency(
  baseUnitPrice: number,
  originalPrice: number,
  originalCurrency: CurrencyCode,
  targetCurrency: CurrencyCode,
  targetExchangeRate: number,
  currencies: Currency[]
): number {
  if (originalCurrency === targetCurrency) return round2(originalPrice);
  const safeRate =
    targetExchangeRate > 0 ? targetExchangeRate : getEffectiveCurrencyRate(currencies, targetCurrency);
  return safeRate > 0 ? round2(baseUnitPrice / safeRate) : round2(baseUnitPrice);
}
