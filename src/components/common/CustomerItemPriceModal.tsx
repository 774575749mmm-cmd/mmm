/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Instant Customer + Item Historical Sales Price Lookup Modal
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Tag,
  X,
  TrendingUp,
  History,
  ExternalLink,
  CheckCircle2,
  RotateCcw,
  Users,
  Search,
} from 'lucide-react';
import { Currency, CurrencyCode, Customer, InventoryItem, Invoice } from '../../types/erp';
import { lookupCustomerItemPriceHistory } from '../../services/priceHistoryHelpers';
import { convertFromBase, getEffectiveCurrencyRate } from '../../services/currencyHelpers';
import { normalizeArabicSearch } from '../../services/searchHelpers';
import { SearchableSelect, SearchableSelectOption } from './SearchableSelect';
import type { AppLanguage } from '../../services/i18n';

interface CustomerItemPriceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoices: Invoice[];
  customers: Customer[];
  inventoryItems: InventoryItem[];
  currencies: Currency[];
  initialCustomerId?: string;
  initialItemId?: string;
  targetCurrency?: CurrencyCode;
  targetExchangeRate?: number;
  lang?: AppLanguage;
  onApplyPrice?: (itemId: string, priceInTargetCurrency: number, sourceInfo: string) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}

function fmt2(n: number): string {
  return (Math.round((Number(n) || 0) * 100) / 100).toLocaleString();
}

export const CustomerItemPriceModal: React.FC<CustomerItemPriceModalProps> = ({
  isOpen,
  onClose,
  invoices,
  customers,
  inventoryItems,
  currencies,
  initialCustomerId = '',
  initialItemId = '',
  targetCurrency,
  targetExchangeRate,
  lang = 'ar',
  onApplyPrice,
  onOpenInvoice,
}) => {
  const isEn = lang === 'en';
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(initialCustomerId);
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItemId);
  const [combinedQuery, setCombinedQuery] = useState<string>('');
  const [docScope, setDocScope] = useState<'sales' | 'all_sales_returns' | 'purchases'>('sales');

  useEffect(() => {
    if (isOpen) {
      setSelectedCustomerId(initialCustomerId || '');
      setSelectedItemId(initialItemId || '');
      setCombinedQuery('');
      setDocScope('sales');
    }
  }, [isOpen, initialCustomerId, initialItemId]);

  const customerOptions = useMemo<SearchableSelectOption[]>(
    () =>
      customers.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.nameAr,
        sublabel: `${c.phone || c.whatsapp || '-'} · ${c.currency || 'YER'}`,
        phone: `${c.phone || ''} ${c.whatsapp || ''}`,
      })),
    [customers]
  );

  const itemOptions = useMemo<SearchableSelectOption[]>(
    () =>
      inventoryItems.map((it) => ({
        id: it.id,
        code: it.code,
        name: it.nameAr,
        sublabel: `${it.barcode ? `${it.barcode} · ` : ''}${it.category} · ${fmt2(it.salePrice)} YER`,
        badge: `${fmt2(it.salePrice)}`,
      })),
    [inventoryItems]
  );

  const lookupResult = useMemo(() => {
    return lookupCustomerItemPriceHistory(invoices, customers, inventoryItems, currencies, {
      customerId: selectedCustomerId || undefined,
      itemId: selectedItemId || undefined,
      docScope,
    });
  }, [invoices, customers, inventoryItems, currencies, selectedCustomerId, selectedItemId, docScope]);

  // Additional smart phrase filter: supports typing e.g. "أحمد معاوز" or "1 بن محفوظ" in one box!
  const displayMatches = useMemo(() => {
    const q = combinedQuery.trim();
    if (!q) return lookupResult.matches;
    const tokens = normalizeArabicSearch(q).split(' ').filter(Boolean);
    return lookupResult.matches.filter((m) => {
      const hay = normalizeArabicSearch(
        `${m.entityName} ${m.entityCode} ${m.entityPhone} ${m.itemName} ${m.itemCode} ${m.itemBarcode} ${m.invoiceNumber} ${m.unit}`
      );
      return tokens.every((tk) => hay.includes(tk));
    });
  }, [lookupResult.matches, combinedQuery]);

  const effectiveLast = displayMatches[0] || null;
  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const selectedItem = inventoryItems.find((i) => i.id === selectedItemId);

  if (!isOpen) return null;

  const activeTargetCurrency: CurrencyCode = targetCurrency || effectiveLast?.currency || 'YER';
  const activeTargetRate =
    targetExchangeRate && targetExchangeRate > 0
      ? targetExchangeRate
      : getEffectiveCurrencyRate(currencies, activeTargetCurrency);

  const convertedLastPrice = effectiveLast
    ? effectiveLast.currency === activeTargetCurrency
      ? effectiveLast.unitPrice
      : Math.round((effectiveLast.baseUnitPrice / activeTargetRate) * 100) / 100
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85" dir={isEn ? 'ltr' : 'rtl'}>
      <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden text-xs shadow-2xl">
        {/* Header */}
        <div className="px-4 py-3 bg-[#08121E] border-b border-[var(--border-strong)] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--gold)]/15 border border-[var(--gold)]/60 flex items-center justify-center text-[var(--gold)]">
              <Tag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm text-[var(--gold)]">
                {isEn
                  ? 'Customer-Item Historical Price Lookup'
                  : 'الاستعلام الفوري عن أسعار بيع مادة لعميل سابقاً'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isEn
                  ? 'Pick a customer and/or item by number, code or name to view exact previous selling prices.'
                  : 'اختر العميل والمادة بالرقم أو الباركود أو الاسم (أو اكتب في البحث الموحد) لمعرفة بكم بعتها له سابقاً فوراً.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded bg-rose-950/50 border border-rose-500/40 text-rose-300 hover:bg-rose-500/20 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Selectors */}
        <div className="p-3 bg-[#0B192C] border-b border-[var(--border-strong)] space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
            <div className="md:col-span-4">
              <label className="block text-[11px] font-bold text-[var(--gold)] mb-1">
                {isEn ? '1. Customer (Name / Code / Phone)' : '1. العميل (بحث بالاسم أو الكود أو الهاتف)'}
              </label>
              <SearchableSelect
                options={customerOptions}
                value={selectedCustomerId}
                onChange={(opt) => setSelectedCustomerId(opt ? opt.id : '')}
                allowClear
                clearLabel={isEn ? 'All Customers' : 'كل العملاء'}
                placeholder={isEn ? 'All Customers (click to search)...' : 'كل العملاء (اضغط للبحث عن عميل)...'}
                searchPlaceholder={isEn ? 'Type name, code, or phone...' : 'اكتب اسم العميل أو رقمه أو هاتفه...'}
                lang={lang}
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-[11px] font-bold text-[var(--gold)] mb-1">
                {isEn ? '2. Item / Material (Number / Barcode / Name)' : '2. المادة / الصنف (بحث بالرقم أو الباركود أو الاسم)'}
              </label>
              <SearchableSelect
                options={itemOptions}
                value={selectedItemId}
                onChange={(opt) => setSelectedItemId(opt ? opt.id : '')}
                allowClear
                clearLabel={isEn ? 'All Items' : 'كل الأصناف'}
                placeholder={isEn ? 'All Items (click to search)...' : 'كل الأصناف (اضغط للبحث برقم أو اسم المادة)...'}
                searchPlaceholder={isEn ? 'Type item number, barcode or name...' : 'اكتب رقم الصنف (مثلاً 1) أو اسمه...'}
                lang={lang}
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-[11px] font-bold text-slate-300 mb-1">
                {isEn ? '3. Document Scope' : '3. نطاق الفواتير'}
              </label>
              <select
                value={docScope}
                onChange={(e) => setDocScope(e.target.value as typeof docScope)}
                className="w-full v20-input px-2.5 py-1.5 text-xs font-bold cursor-pointer"
              >
                <option value="sales">{isEn ? 'Sales Invoices Only' : 'فواتير المبيعات فقط'}</option>
                <option value="all_sales_returns">{isEn ? 'Sales + Sales Returns' : 'المبيعات + مرتجعات المبيعات'}</option>
                <option value="purchases">{isEn ? 'Purchase Invoices' : 'فواتير المشتريات (تكلفة الشراء)'}</option>
              </select>
            </div>

            <div className="md:col-span-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setSelectedCustomerId('');
                  setSelectedItemId('');
                  setCombinedQuery('');
                }}
                title={isEn ? 'Reset filters' : 'إعادة ضبط البحث'}
                className="w-full px-2.5 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-300 hover:border-[var(--gold)] hover:text-white font-bold flex items-center justify-center gap-1 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Combined Single-Box Free Search */}
          <div className="relative">
            <Search className={`w-3.5 h-3.5 text-[var(--gold)] absolute ${isEn ? 'left-3' : 'right-3'} top-2`} />
            <input
              type="text"
              value={combinedQuery}
              onChange={(e) => setCombinedQuery(e.target.value)}
              placeholder={
                isEn
                  ? 'Quick multi-word filter: e.g. type item name + customer name together...'
                  : 'أو اكتب هنا مباشرةً كلمات من اسم/رقم المادة واسم العميل معاً (مثال: معاوز بن محفوظ أو 1 أحمد)...'
              }
              className={`w-full v20-input ${isEn ? 'pl-9 pr-3' : 'pr-9 pl-3'} py-1.5 text-xs`}
            />
          </div>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {/* Answer Highlight Card */}
          {effectiveLast ? (
            <div className="p-3.5 rounded-xl bg-gradient-to-l from-amber-500/15 via-[#0B192C] to-emerald-950/30 border border-[var(--gold)]/70 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-300">
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>
                    {isEn
                      ? `Latest Selling Price${selectedCustomer ? ` for ${selectedCustomer.nameAr}` : ''}${selectedItem ? ` — ${selectedItem.nameAr}` : ''}`
                      : `آخر سعر ${docScope === 'purchases' ? 'شراء' : 'بيع'} مسجل (${effectiveLast.entityName} — ${effectiveLast.itemName})`}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <span className="text-2xl font-black text-white tabular-nums">
                    {fmt2(effectiveLast.unitPrice)} <span className="text-sm text-[var(--gold)]">{effectiveLast.currency}</span>
                  </span>
                  {effectiveLast.currency !== 'YER' && (
                    <span className="text-xs font-bold text-slate-300 tabular-nums">
                      ({isEn ? 'Base Eq.' : 'المعادل:'} {fmt2(effectiveLast.baseUnitPrice)} YER)
                    </span>
                  )}
                  {effectiveLast.discountPercentage > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold">
                      {isEn ? 'Net after disc' : 'الصافي بعد خصم'} {effectiveLast.discountPercentage}%: {fmt2(effectiveLast.netUnitPrice)} {effectiveLast.currency}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-300 flex flex-wrap items-center gap-3">
                  <span>التاريخ: <strong className="text-white tabular-nums">{effectiveLast.date}</strong></span>
                  <span>الفاتورة: <strong className="font-mono text-[var(--gold)]">{effectiveLast.invoiceNumber}</strong></span>
                  <span>الكمية: <strong className="text-white tabular-nums">{effectiveLast.quantity} {effectiveLast.unit}</strong></span>
                  {selectedItem && (
                    <span>
                      السعر الحالي بالدليل:{' '}
                      <strong className="text-sky-300 tabular-nums">
                        {fmt2(convertFromBase(selectedItem.salePrice, effectiveLast.currency, currencies))} {effectiveLast.currency}
                      </strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {onApplyPrice && (
                  <button
                    type="button"
                    onClick={() => {
                      onApplyPrice(
                        effectiveLast.itemId,
                        convertedLastPrice,
                        `${effectiveLast.entityName} (${effectiveLast.date} #${effectiveLast.invoiceNumber})`
                      );
                      onClose();
                    }}
                    className="px-3.5 py-2 rounded-lg v20-btn-gold font-black flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {isEn
                        ? `Apply (${fmt2(convertedLastPrice)} ${activeTargetCurrency})`
                        : `اعتماد السعر (${fmt2(convertedLastPrice)} ${activeTargetCurrency})`}
                    </span>
                  </button>
                )}
                {onOpenInvoice && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenInvoice(effectiveLast.invoiceId);
                      onClose();
                    }}
                    className="px-3 py-2 rounded-lg bg-[#08121E] border border-sky-500/50 text-sky-300 hover:border-[var(--gold)] font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Open Invoice' : 'فتح الفاتورة'}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#08121E] border border-slate-700 text-center space-y-1.5">
              <div className="font-black text-amber-300 text-sm">
                {isEn
                  ? 'No matching historical invoices found for this filter.'
                  : 'لم يتم بيع هذه المادة لهذا العميل مسبقاً (أو لا توجد فواتير مطابقة للبحث).'}
              </div>
              {selectedItem && (
                <div className="text-xs text-slate-300">
                  سعر الدليل الرسمي للصنف (<strong className="text-white">{selectedItem.nameAr}</strong>):{' '}
                  <strong className="text-[var(--gold)] tabular-nums">{fmt2(selectedItem.salePrice)} YER</strong>
                  {selectedCustomer && selectedCustomer.currency !== 'YER' && (
                    <span className="text-emerald-300">
                      {' '}· ({fmt2(convertFromBase(selectedItem.salePrice, selectedCustomer.currency, currencies))} {selectedCustomer.currency})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Statistical Summary Strip */}
          {displayMatches.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-2.5 rounded-lg bg-[#08121E] border border-[var(--border-strong)]">
                <div className="text-[10px] text-slate-400">{isEn ? 'Matched Lines' : 'عدد الحركات المطابقة'}</div>
                <div className="text-sm font-black text-white tabular-nums">{displayMatches.length} حركة</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#08121E] border border-[var(--border-strong)]">
                <div className="text-[10px] text-slate-400">{isEn ? 'Total Qty Sold' : 'إجمالي الكمية'}</div>
                <div className="text-sm font-black text-sky-300 tabular-nums">
                  {fmt2(displayMatches.reduce((s, m) => s + m.quantity, 0))}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#08121E] border border-[var(--border-strong)]">
                <div className="text-[10px] text-slate-400">{isEn ? 'Lowest Unit Price' : 'أدنى سعر بيع'}</div>
                <div className="text-sm font-black text-emerald-300 tabular-nums">
                  {fmt2(Math.min(...displayMatches.map((m) => m.baseUnitPrice)))} YER
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#08121E] border border-[var(--border-strong)]">
                <div className="text-[10px] text-slate-400">{isEn ? 'Highest Unit Price' : 'أعلى سعر بيع'}</div>
                <div className="text-sm font-black text-[var(--gold)] tabular-nums">
                  {fmt2(Math.max(...displayMatches.map((m) => m.baseUnitPrice)))} YER
                </div>
              </div>
            </div>
          )}

          {/* Full Historical Table */}
          {displayMatches.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-black text-[var(--gold)]">
                <History className="w-3.5 h-3.5" />
                <span>{isEn ? 'Chronological Sales History' : 'سجل الأسعار التاريخي (الأحدث أولاً)'}</span>
              </div>
              <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
                <table className="w-full text-right text-xs border-collapse">
                  <thead className="bg-[#0B192C] text-[var(--gold)] border-b border-[var(--gold)]">
                    <tr>
                      <th className="p-2 border-l border-[#1B2E44]">التاريخ</th>
                      <th className="p-2 border-l border-[#1B2E44]">رقم الفاتورة</th>
                      <th className="p-2 border-l border-[#1B2E44]">العميل</th>
                      <th className="p-2 border-l border-[#1B2E44]">الصنف / الكود</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الوحدة</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الكمية</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">السعر</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الخصم</th>
                      <th className="p-2 border-l border-[#1B2E44] text-center">الصافي / وحدة</th>
                      <th className="p-2 text-center">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayMatches.slice(0, 100).map((m, idx) => (
                      <tr
                        key={`${m.invoiceId}-${m.itemId}-${idx}`}
                        className={`border-b border-[#1B2E44] ${
                          idx === 0 ? 'bg-amber-500/10' : 'hover:bg-slate-900/50'
                        }`}
                      >
                        <td className="p-2 tabular-nums border-l border-[#1B2E44]">{m.date}</td>
                        <td className="p-2 font-mono text-[var(--gold)] border-l border-[#1B2E44]">
                          {onOpenInvoice ? (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenInvoice(m.invoiceId);
                                onClose();
                              }}
                              className="hover:underline inline-flex items-center gap-1 cursor-pointer"
                            >
                              <span>{m.invoiceNumber}</span>
                              <ExternalLink className="w-3 h-3 opacity-70" />
                            </button>
                          ) : (
                            m.invoiceNumber
                          )}
                        </td>
                        <td className="p-2 font-bold text-white border-l border-[#1B2E44]">{m.entityName}</td>
                        <td className="p-2 border-l border-[#1B2E44]">
                          <span className="font-mono text-[10px] text-amber-300 ml-1">#{m.itemCode}</span>
                          <span className="font-bold text-slate-200">{m.itemName}</span>
                        </td>
                        <td className="p-2 text-center border-l border-[#1B2E44]">{m.unit}</td>
                        <td className="p-2 text-center tabular-nums border-l border-[#1B2E44]">
                          {m.quantity}
                          {m.bonusQuantity > 0 && (
                            <span className="text-[10px] text-emerald-300"> (+{m.bonusQuantity})</span>
                          )}
                        </td>
                        <td className="p-2 text-center font-black text-[var(--gold)] tabular-nums border-l border-[#1B2E44]">
                          {fmt2(m.unitPrice)} {m.currency}
                        </td>
                        <td className="p-2 text-center tabular-nums text-slate-300 border-l border-[#1B2E44]">
                          {m.discountPercentage > 0 ? `${m.discountPercentage}%` : '-'}
                        </td>
                        <td className="p-2 text-center font-bold text-emerald-300 tabular-nums border-l border-[#1B2E44]">
                          {fmt2(m.netUnitPrice)} {m.currency}
                          {m.currency !== 'YER' && (
                            <div className="text-[10px] text-slate-400">{fmt2(m.baseNetUnitPrice)} YER</div>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {onApplyPrice ? (
                            <button
                              type="button"
                              onClick={() => {
                                const conv =
                                  m.currency === activeTargetCurrency
                                    ? m.unitPrice
                                    : Math.round((m.baseUnitPrice / activeTargetRate) * 100) / 100;
                                onApplyPrice(m.itemId, conv, `${m.entityName} (${m.date} #${m.invoiceNumber})`);
                                onClose();
                              }}
                              className="px-2 py-1 rounded bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] font-black cursor-pointer"
                            >
                              اعتماد
                            </button>
                          ) : (
                            <span className="text-slate-500 text-[10px]">{m.paymentType}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Comparison: Recent prices of this item to OTHER customers */}
          {lookupResult.otherCustomersRecent.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--border-strong)]">
              <div className="flex items-center gap-1.5 text-xs font-black text-sky-300">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {isEn
                    ? 'Recent prices of this item sold to other customers (for reference)'
                    : 'للمقارنة: أحدث أسعار بيع هذا الصنف لعملاء آخرين'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {lookupResult.otherCustomersRecent.slice(0, 4).map((o, idx) => (
                  <div
                    key={`${o.invoiceId}-${idx}`}
                    className="p-2.5 rounded-lg bg-[#08121E] border border-slate-700/80 space-y-0.5"
                  >
                    <div className="font-bold text-white truncate">{o.entityName}</div>
                    <div className="text-sm font-black text-sky-300 tabular-nums">
                      {fmt2(o.unitPrice)} {o.currency}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span>{o.date}</span>
                      <span className="font-mono">{o.invoiceNumber}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#08121E] border-t border-[var(--border-strong)] flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            {isEn
              ? `Showing up to 100 matching sales lines out of ${displayMatches.length} found.`
              : `يعرض حتى 100 سطر مطابق (إجمالي المطابق: ${displayMatches.length}).`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#0B192C] border border-[var(--border-strong)] text-white font-bold cursor-pointer"
          >
            {isEn ? 'Close' : 'إغلاق'}
          </button>
        </div>
      </div>
    </div>
  );
};
