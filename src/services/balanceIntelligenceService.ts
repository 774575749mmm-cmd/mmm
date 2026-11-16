/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Party Financial Intelligence, Live Balance Equation & Distinct Last-Price Advisor
 */

import {
  Currency,
  CurrencyCode,
  Customer,
  InventoryItem,
  Invoice,
  PaymentVoucher,
  Vendor,
} from '../types/erp';
import { getEffectiveCurrencyRate } from './currencyHelpers';
import { lookupCustomerItemPriceHistory } from './priceHistoryHelpers';

export interface LiveInvoiceBalancePreview {
  previousBalanceBase: number;
  invoiceTotalBase: number;
  paidAmountBase: number;
  invoiceRemainingBase: number;
  finalBalanceBase: number;
  invoiceTotalNative: number;
  paidAmountNative: number;
  invoiceRemainingNative: number;
  previousBalanceNative: number;
  finalBalanceNative: number;
  creditLimitBase: number;
  creditAvailableBase: number;
  creditUtilizationPct: number;
  exceedsCreditLimit: boolean;
}

/**
 * Computes exact live balance preview verifying:
 *   invoiceTotal - paidAmount = invoiceRemaining
 *   previousBalance + invoiceRemaining = finalBalance
 * Note: Returns (مرتجع) invert direction so balances reduce cleanly.
 */
export function computeLiveInvoiceBalancePreview(params: {
  invoiceType: Invoice['type'];
  previousBalanceBase: number;
  invoiceTotalNative: number;
  paidAmountNative: number;
  currency: CurrencyCode;
  currencies: Currency[];
  creditLimitBase?: number;
}): LiveInvoiceBalancePreview {
  const rate = getEffectiveCurrencyRate(params.currencies, params.currency) || 1;
  const invTotalNative = Math.max(0, Math.round((Number(params.invoiceTotalNative) || 0) * 100) / 100);
  const paidNative = Math.max(0, Math.min(invTotalNative, Math.round((Number(params.paidAmountNative) || 0) * 100) / 100));
  const remNative = Math.round((invTotalNative - paidNative) * 100) / 100;

  const isReturn = params.invoiceType === 'مرتجع_مبيعات' || params.invoiceType === 'مرتجع_مشتريات';
  const sign = isReturn ? -1 : 1;

  const invoiceTotalBase = Math.round(invTotalNative * rate * 100) / 100;
  const paidAmountBase = Math.round(paidNative * rate * 100) / 100;
  const invoiceRemainingBase = Math.round((invoiceTotalBase - paidAmountBase) * 100) / 100;
  const previousBalanceBase = Math.round((Number(params.previousBalanceBase) || 0) * 100) / 100;
  const finalBalanceBase = Math.round((previousBalanceBase + sign * invoiceRemainingBase) * 100) / 100;

  const previousBalanceNative = Math.round((previousBalanceBase / rate) * 100) / 100;
  const finalBalanceNative = Math.round((finalBalanceBase / rate) * 100) / 100;

  const creditLimitBase = Math.max(0, Number(params.creditLimitBase) || 0);
  const creditAvailableBase = creditLimitBase > 0 ? Math.max(0, Math.round((creditLimitBase - finalBalanceBase) * 100) / 100) : Infinity;
  const creditUtilizationPct = creditLimitBase > 0 ? Math.round((finalBalanceBase / creditLimitBase) * 1000) / 10 : 0;
  const exceedsCreditLimit = creditLimitBase > 0 && params.invoiceType === 'مبيعات' && finalBalanceBase > creditLimitBase;

  return {
    previousBalanceBase,
    invoiceTotalBase,
    paidAmountBase,
    invoiceRemainingBase,
    finalBalanceBase,
    invoiceTotalNative: invTotalNative,
    paidAmountNative: paidNative,
    invoiceRemainingNative: remNative,
    previousBalanceNative,
    finalBalanceNative,
    creditLimitBase,
    creditAvailableBase: Number.isFinite(creditAvailableBase) ? creditAvailableBase : 0,
    creditUtilizationPct,
    exceedsCreditLimit,
  };
}

export interface PartyIntelligenceSummary {
  partyType: 'customer' | 'vendor';
  partyId: string;
  currentBalanceBase: number;
  creditLimit: number;
  creditAvailable: number;
  unpaidInvoicesCount: number;
  overdueAmount: number;
  lastPaymentDate?: string;
  lastPaymentAmount?: number;
  lastInvoiceDate?: string;
}

export function computePartyIntelligenceSummary(
  partyType: 'customer' | 'vendor',
  party: Customer | Vendor,
  invoices: Invoice[],
  vouchers: PaymentVoucher[]
): PartyIntelligenceSummary {
  const today = new Date().toISOString().split('T')[0];
  const targetInvType = partyType === 'customer' ? 'مبيعات' : 'مشتريات';
  const targetVoucherType = partyType === 'customer' ? 'قبض' : 'صرف';

  const partyInvoices = invoices.filter(
    (inv) => inv.entityId === party.id && inv.type === targetInvType && inv.status !== 'cancelled'
  );
  const unpaidInvoices = partyInvoices.filter((inv) => (inv.remainingAmount || 0) > 0.01);
  const overdueInvoices = unpaidInvoices.filter((inv) => inv.dueDate && inv.dueDate < today);
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + (inv.remainingAmount || 0) * (inv.exchangeRate || 1),
    0
  );

  const partyVouchers = vouchers
    .filter((v) => v.entityId === party.id && v.type === targetVoucherType && v.status === 'posted')
    .sort((a, b) => b.date.localeCompare(a.date));

  const latestInv = [...partyInvoices].sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestVch = partyVouchers[0];

  const creditLimit = 'creditLimit' in party ? party.creditLimit || 0 : 0;
  const creditAvailable = creditLimit > 0 ? Math.max(0, creditLimit - party.currentBalance) : 0;

  return {
    partyType,
    partyId: party.id,
    currentBalanceBase: party.currentBalance,
    creditLimit,
    creditAvailable,
    unpaidInvoicesCount: unpaidInvoices.length,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    lastPaymentDate: latestVch?.date,
    lastPaymentAmount: latestVch ? latestVch.baseAmount || latestVch.amount : undefined,
    lastInvoiceDate: latestInv?.date,
  };
}

export interface DistinctItemPriceAdvisor {
  hasCustomerSpecificHistory: boolean;
  customerLastSalePriceBase?: number;
  customerLastSaleDate?: string;
  customerLastInvoiceNumber?: string;
  customerNoticeAr: string;
  generalLastSalePriceBase?: number;
  generalLastSaleCustomerName?: string;
  generalLastSaleDate?: string;
  lastPurchaseCostBase: number;
  catalogSalePriceBase: number;
  minSalePriceBase: number;
}

/**
 * Strictly separates Customer-Specific Last Sale Price from General Last Sale Price & Purchase Cost
 * so the seller is never misled when a customer has no prior purchase history for an item.
 */
export function getDistinctItemPriceAdvisor(params: {
  itemId: string;
  customerId?: string;
  invoices: Invoice[];
  customers: Customer[];
  inventoryItems: InventoryItem[];
  currencies: Currency[];
}): DistinctItemPriceAdvisor {
  const item = params.inventoryItems.find((i) => i.id === params.itemId);
  const res = lookupCustomerItemPriceHistory(
    params.invoices,
    params.customers,
    params.inventoryItems,
    params.currencies,
    {
      customerId: params.customerId,
      itemId: params.itemId,
      docScope: 'sales',
    }
  );

  const customerMatch = params.customerId ? res.lastEntry : null;
  const generalMatch =
    res.otherCustomersRecent && res.otherCustomersRecent.length > 0
      ? res.otherCustomersRecent[0]
      : null;

  // Also check last purchase price from posted purchase invoices
  const purchaseMatches = params.invoices
    .filter(
      (inv) =>
        inv.type === 'مشتريات' &&
        inv.status !== 'cancelled' &&
        inv.items.some((li) => li.itemId === params.itemId)
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  let lastPurchaseCostBase = item?.purchasePrice || 0;
  if (purchaseMatches.length > 0) {
    const pInv = purchaseMatches[0];
    const li = pInv.items.find((x) => x.itemId === params.itemId);
    if (li) {
      lastPurchaseCostBase = Math.round(li.unitPrice * (pInv.exchangeRate || 1) * 100) / 100;
    }
  }

  return {
    hasCustomerSpecificHistory: Boolean(customerMatch),
    customerLastSalePriceBase: customerMatch?.baseNetUnitPrice,
    customerLastSaleDate: customerMatch?.date,
    customerLastInvoiceNumber: customerMatch?.invoiceNumber,
    customerNoticeAr: customerMatch
      ? `آخر بيع لنفس العميل: ${customerMatch.baseNetUnitPrice.toLocaleString()} (${customerMatch.date})`
      : 'لا توجد مبيعات سابقة لهذا العميل لهذا الصنف',
    generalLastSalePriceBase: generalMatch?.baseNetUnitPrice ?? customerMatch?.baseNetUnitPrice,
    generalLastSaleCustomerName: generalMatch?.entityName ?? customerMatch?.entityName,
    generalLastSaleDate: generalMatch?.date ?? customerMatch?.date,
    lastPurchaseCostBase,
    catalogSalePriceBase: item?.salePrice || 0,
    minSalePriceBase: item?.minSalePrice || 0,
  };
}
