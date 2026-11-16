/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Global Instant Quick-Jump Search Modal (Ctrl+K)
 * Searches across Customers, Vendors, Inventory Items, Invoices, Vouchers, and COA Accounts by number/code or name.
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  X,
  Users,
  Building2,
  Package,
  FileText,
  Receipt,
  GitBranch,
  ArrowUpRight,
} from 'lucide-react';
import { ERPDatabase } from '../../services/storageService';
import { rankSearchResults } from '../../services/searchHelpers';
import { convertToBase, getCurrencySymbol, getEffectiveCurrencyRate } from '../../services/currencyHelpers';
import type { AppLanguage } from '../../services/i18n';

export type SearchResultCategory = 'ALL' | 'item' | 'customer' | 'vendor' | 'invoice' | 'voucher' | 'account';

interface GlobalSearchResultItem {
  id: string;
  kind: Exclude<SearchResultCategory, 'ALL'>;
  code: string;
  barcode?: string;
  title: string;
  subtitle: string;
  badge?: string;
  phone?: string;
  targetModule: string;
  recordId: string;
}

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  db: ERPDatabase;
  lang?: AppLanguage;
  onNavigate: (module: string, recordId?: string) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  db,
  lang = 'ar',
  onNavigate,
}) => {
  const isEn = lang === 'en';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchResultCategory>('ALL');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setHighlightIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  const allEntries = useMemo<GlobalSearchResultItem[]>(() => {
    const list: GlobalSearchResultItem[] = [];

    db.inventoryItems.forEach((it) => {
      list.push({
        id: `item:${it.id}`,
        kind: 'item',
        code: it.code,
        barcode: it.barcode,
        title: it.nameAr,
        subtitle: `${isEn ? 'Item' : 'صنف مخزني'} · ${it.category} · ${isEn ? 'Code' : 'رقم'}: ${it.code}${it.barcode ? ` · ${it.barcode}` : ''}`,
        badge: `${it.salePrice.toLocaleString()} YER`,
        targetModule: 'inventory',
        recordId: it.id,
      });
    });

    db.customers.forEach((c) => {
      const curr = c.currency || 'YER';
      const rate = getEffectiveCurrencyRate(db.currencies, curr);
      const nativeBal = curr !== 'YER' ? Math.round((c.currentBalance / rate) * 100) / 100 : c.currentBalance;
      list.push({
        id: `customer:${c.id}`,
        kind: 'customer',
        code: c.code,
        title: c.nameAr,
        subtitle: `${isEn ? 'Customer' : 'عميل'} · ${c.phone || '-'} · ${c.category}`,
        badge: `${nativeBal.toLocaleString()} ${curr}`,
        phone: `${c.phone || ''} ${c.whatsapp || ''}`,
        targetModule: 'customers',
        recordId: c.id,
      });
    });

    db.vendors.forEach((v) => {
      const curr = v.currency || 'YER';
      const rate = getEffectiveCurrencyRate(db.currencies, curr);
      const nativeBal = curr !== 'YER' ? Math.round((v.currentBalance / rate) * 100) / 100 : v.currentBalance;
      list.push({
        id: `vendor:${v.id}`,
        kind: 'vendor',
        code: v.code,
        title: v.nameAr,
        subtitle: `${isEn ? 'Vendor' : 'مورد'} · ${v.phone || '-'} · ${v.category}`,
        badge: `${nativeBal.toLocaleString()} ${curr}`,
        phone: `${v.phone || ''} ${v.whatsapp || ''}`,
        targetModule: 'vendors',
        recordId: v.id,
      });
    });

    db.invoices.forEach((inv) => {
      const curr = inv.currency || 'YER';
      const sym = getCurrencySymbol(db.currencies, curr);
      const baseEq = curr !== 'YER' ? convertToBase(inv.grandTotal, curr, db.currencies, inv.exchangeRate) : inv.grandTotal;
      list.push({
        id: `invoice:${inv.id}`,
        kind: 'invoice',
        code: inv.invoiceNumber,
        title: `${inv.invoiceNumber} — ${inv.entityName}`,
        subtitle: `${inv.type.replace(/_/g, ' ')} · ${inv.date} · ${inv.paymentType} · ${curr}${curr !== 'YER' ? ` (${baseEq.toLocaleString()} ر.ي)` : ''}`,
        badge: `${inv.grandTotal.toLocaleString()} ${sym}`,
        targetModule: inv.type === 'مشتريات' || inv.type === 'مرتجع_مشتريات' ? 'purchases' : 'sales',
        recordId: inv.id,
      });
    });

    db.paymentVouchers.forEach((v) => {
      list.push({
        id: `voucher:${v.id}`,
        kind: 'voucher',
        code: v.voucherNumber,
        title: `${v.voucherNumber} — ${v.entityName}`,
        subtitle: `${v.type === 'قبض' ? (isEn ? 'Receipt' : 'سند قبض') : (isEn ? 'Payment' : 'سند صرف')} · ${v.date} · ${v.statement}`,
        badge: `${v.amount.toLocaleString()} ${v.currency}`,
        targetModule: 'treasury',
        recordId: v.id,
      });
    });

    db.chartOfAccounts.forEach((acc) => {
      list.push({
        id: `account:${acc.id}`,
        kind: 'account',
        code: acc.code,
        title: acc.nameAr,
        subtitle: `${isEn ? 'Account' : 'حساب محاسبي'} #${acc.code} · ${acc.category.replace(/_/g, ' ')}`,
        badge: acc.currency || 'YER',
        targetModule: 'accounting',
        recordId: acc.id,
      });
    });

    return list;
  }, [db, isEn]);

  const results = useMemo(() => {
    const pool = category === 'ALL' ? allEntries : allEntries.filter((e) => e.kind === category);
    return rankSearchResults(
      pool,
      query,
      (e) => ({
        code: e.code,
        barcode: e.barcode,
        id: e.recordId,
        name: e.title,
        alt: e.subtitle,
        phone: e.phone,
      }),
      35
    );
  }, [allEntries, category, query]);

  if (!isOpen) return null;

  const selectEntry = (entry: GlobalSearchResultItem) => {
    onNavigate(entry.targetModule, entry.recordId);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((p) => Math.min(Math.max(0, results.length - 1), p + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((p) => Math.max(0, p - 1));
    } else if (e.key === 'Enter' && results[highlightIdx]) {
      e.preventDefault();
      selectEntry(results[highlightIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const getKindIcon = (kind: GlobalSearchResultItem['kind']) => {
    if (kind === 'item') return <Package className="w-4 h-4 text-amber-400" />;
    if (kind === 'customer') return <Users className="w-4 h-4 text-emerald-400" />;
    if (kind === 'vendor') return <Building2 className="w-4 h-4 text-cyan-400" />;
    if (kind === 'invoice') return <FileText className="w-4 h-4 text-sky-400" />;
    if (kind === 'voucher') return <Receipt className="w-4 h-4 text-emerald-300" />;
    return <GitBranch className="w-4 h-4 text-amber-300" />;
  };

  const cats: { id: SearchResultCategory; label: string }[] = [
    { id: 'ALL', label: isEn ? 'All' : 'الكل' },
    { id: 'item', label: isEn ? 'Items' : 'الأصناف' },
    { id: 'customer', label: isEn ? 'Customers' : 'العملاء' },
    { id: 'vendor', label: isEn ? 'Vendors' : 'الموردين' },
    { id: 'invoice', label: isEn ? 'Invoices' : 'الفواتير' },
    { id: 'voucher', label: isEn ? 'Vouchers' : 'السندات' },
    { id: 'account', label: isEn ? 'Accounts' : 'الحسابات' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-start justify-center pt-12 sm:pt-16 p-4"
      dir={isEn ? 'ltr' : 'rtl'}
      onClick={onClose}
    >
      <div
        className="bg-[#0A1523] border-2 border-[var(--gold)] rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="px-4 py-3 bg-[#060E18] border-b border-slate-800 flex items-center gap-3">
          <Search className="w-5 h-5 text-[var(--gold)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              isEn
                ? 'Quick search by number, code, barcode, phone, or name (items, customers, invoices, COA)...'
                : 'بحث شامل بالرقم أو الكود أو الباركود أو الاسم (مادة #1، عميل، مورد، فاتورة، سند، حساب)...'
            }
            className="flex-1 bg-transparent text-white text-sm font-bold placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-slate-400 hover:text-white cursor-pointer"
              aria-label={isEn ? 'Clear' : 'مسح'}
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
          >
            Esc
          </button>
        </div>

        {/* Category Filter Tabs */}
        <div className="px-4 py-2 bg-[#071019] border-b border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setCategory(c.id);
                setHighlightIdx(0);
              }}
              className={`px-2.5 py-1 rounded font-bold shrink-0 cursor-pointer ${
                category === c.id
                  ? 'bg-[var(--gold)] text-[#03060A]'
                  : 'bg-slate-900 border border-slate-700 text-slate-300 hover:border-amber-500/50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Ranked Results */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {results.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 font-bold">
              {isEn ? `No matches found for "${query}"` : `لا توجد نتائج مطابقة للبحث "${query}"`}
            </div>
          ) : (
            results.map((item, idx) => {
              const active = idx === highlightIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectEntry(item)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                    isEn ? 'text-left' : 'text-right'
                  } ${active ? 'bg-amber-500/15' : 'hover:bg-slate-900/70'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800 shrink-0">
                      {getKindIcon(item.kind)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-black px-1.5 py-0.5 rounded bg-slate-800 text-[var(--gold)] shrink-0">
                          {item.code}
                        </span>
                        <span className="text-xs sm:text-sm font-black text-white truncate">{item.title}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">{item.subtitle}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.badge && (
                      <span className="font-mono text-xs font-black text-emerald-300 tabular-nums">
                        {item.badge}
                      </span>
                    )}
                    <ArrowUpRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 bg-[#060E18] border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
          <span>
            {isEn
              ? `${results.length} matching records`
              : `عرض ${results.length} سجل مطابق`}
          </span>
          <span>
            {isEn
              ? '↑ ↓ Navigate · Enter to open · Esc to close'
              : 'استخدم ↑ ↓ للتنقل · Enter للفتح المباشر · Esc للإغلاق'}
          </span>
        </div>
      </div>
    </div>
  );
};
