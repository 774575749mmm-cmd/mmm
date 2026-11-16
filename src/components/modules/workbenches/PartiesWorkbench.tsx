/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 5: Customers, Vendors, Zones & Multi-Currency Balances
 */

import React, { useState, useMemo } from 'react';
import {
  Users,
  Building2,
  MapPin,
  UserPlus,
  SlidersHorizontal,
  Eye,
  FileText,
  Edit3,
  MessageCircle,
  Tag,
} from 'lucide-react';
import {
  Customer,
  Vendor,
  RegionalArea,
  Currency,
  CurrencyCode,
  Company,
  Branch,
  TableColumnPref,
  PrintDocumentType,
  PrintTemplateConfig,
} from '../../../types/erp';
import { rankSearchResults } from '../../../services/searchHelpers';
import { getEffectiveCurrencyRate, getEffectiveSarRate } from '../../../services/currencyHelpers';
import { UniversalColumnCustomizer } from '../../common/UniversalColumnCustomizer';
import { UniversalPreviewModal, UniversalPreviewPayload } from '../../common/UniversalPreviewModal';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';

const DEFAULT_PARTY_COLS: TableColumnPref[] = [
  { key: 'code', label: 'الكود', visible: true, order: 0, width: 90 },
  { key: 'nameAr', label: 'الاسم', visible: true, order: 1, width: 210 },
  { key: 'zone', label: 'المنطقة / العنوان', visible: true, order: 2, width: 140 },
  { key: 'phone', label: 'الهاتف / واتساب', visible: true, order: 3, width: 120 },
  { key: 'category', label: 'التصنيف', visible: true, order: 4, width: 100 },
  { key: 'currency', label: 'العملة', visible: true, order: 5, width: 75 },
  { key: 'balance', label: 'الرصيد القائم (بالعملة والمعادل)', visible: true, order: 6, width: 165 },
];

interface PartiesWorkbenchProps {
  customers: Customer[];
  vendors: Vendor[];
  regionalAreas: RegionalArea[];
  currencies: Currency[];
  company: Company;
  branch: Branch;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  savedColumnPrefsMap: Record<string, TableColumnPref[]>;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveCustomer: (customer: Customer) => void;
  onSaveVendor: (vendor: Vendor) => void;
  onSaveZone: (zone: RegionalArea) => void;
  onOpenStatement: (type: 'customer' | 'vendor', id: string) => void;
  onOpenPriceLookup?: (customerId: string) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const PartiesWorkbench: React.FC<PartiesWorkbenchProps> = ({
  customers,
  vendors,
  regionalAreas,
  currencies,
  company,
  branch,
  printTemplates,
  savedColumnPrefsMap,
  onSaveColumnPrefs,
  onSaveCustomer,
  onSaveVendor,
  onSaveZone,
  onOpenStatement,
  onOpenPriceLookup,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'customers' | 'vendors' | 'zones'>('customers');
  const [searchQ, setSearchQ] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');

  const [editCust, setEditCust] = useState<Customer | null>(null);
  const [editVend, setEditVend] = useState<Vendor | null>(null);
  const [newZoneGov, setNewZoneGov] = useState('صنعاء');
  const [newZoneArea, setNewZoneArea] = useState('');

  const [isColCustOpen, setIsColCustOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<UniversalPreviewPayload | null>(null);
  const [waPayload, setWaPayload] = useState<{
    phone?: string;
    text: string;
    previewPayload?: UniversalPreviewPayload;
  } | null>(null);

  const columns = useMemo(() => {
    const raw = savedColumnPrefsMap['v20-parties-grid'];
    const base = raw && raw.length > 0 ? raw : DEFAULT_PARTY_COLS;
    return [...base].sort((a, b) => a.order - b.order);
  }, [savedColumnPrefsMap]);

  const getRate = (code?: CurrencyCode) => getEffectiveCurrencyRate(currencies, code);
  const sarRate = getEffectiveSarRate(currencies);

  const getZoneLabel = (zoneId: string) => {
    const z = regionalAreas.find((r) => r.id === zoneId);
    return z ? `${z.governorate} - ${z.area}` : 'عام';
  };

  const filteredCustomers = useMemo(() => {
    const byZone = customers
      .filter((c) => zoneFilter === 'all' || c.regionalAreaId === zoneFilter)
      .filter((c) => currencyFilter === 'ALL' || (c.currency || 'YER') === currencyFilter);
    return searchQ.trim()
      ? rankSearchResults(
          byZone,
          searchQ,
          (c) => ({
            code: c.code,
            id: c.id,
            name: c.nameAr,
            phone: `${c.phone} ${c.whatsapp || ''}`,
          }),
          500
        )
      : byZone;
  }, [customers, zoneFilter, currencyFilter, searchQ]);

  const filteredVendors = useMemo(() => {
    const byCurr = vendors.filter(
      (v) => currencyFilter === 'ALL' || (v.currency || 'YER') === currencyFilter
    );
    return searchQ.trim()
      ? rankSearchResults(
          byCurr,
          searchQ,
          (v) => ({
            code: v.code,
            id: v.id,
            name: v.nameAr,
            phone: `${v.phone} ${v.whatsapp || ''}`,
          }),
          500
        )
      : byCurr;
  }, [vendors, currencyFilter, searchQ]);

  const totalCustBal = filteredCustomers.reduce((s, c) => s + c.currentBalance, 0);
  const totalVendBal = filteredVendors.reduce((s, v) => s + v.currentBalance, 0);
  const activeSarParties = (subTab === 'customers' ? filteredCustomers : filteredVendors).filter(
    (p) => (p.currency || 'YER') === 'SAR'
  );
  const totalSarPartiesYer = activeSarParties.reduce((s, p) => s + p.currentBalance, 0);
  const totalSarPartiesSar = Math.round((totalSarPartiesYer / sarRate) * 100) / 100;

  const buildPreview = (): UniversalPreviewPayload => {
    const isCust = subTab === 'customers';
    const vis = columns.filter((c) => c.visible);
    const totalYer = isCust ? totalCustBal : totalVendBal;
    const totalSarAll = Math.round((totalYer / sarRate) * 100) / 100;
    const formatPartyBal = (balYer: number, curr?: CurrencyCode) => {
      const code = curr || 'YER';
      if (code === 'YER') return `${balYer.toLocaleString()} ر.ي`;
      const rate = getRate(code);
      const foreign = Math.round((balYer / rate) * 100) / 100;
      return `${foreign.toLocaleString()} ${code === 'SAR' ? 'ر.س' : code} (${balYer.toLocaleString()} ر.ي)`;
    };
    return {
      title: isCust ? 'كشف أرصدة العملاء والمناطق' : 'كشف أرصدة الموردين',
      periodText: `سعر التحويل المعتمد: 1 SAR = ${sarRate.toLocaleString()} YER`,
      summaryCards: [
        ...(activeSarParties.length > 0
          ? [
              {
                label: `الحسابات السعودية (${activeSarParties.length})`,
                value: `${totalSarPartiesSar.toLocaleString()} ر.س`,
                subValue: `المعادل: ${totalSarPartiesYer.toLocaleString()} ر.ي`,
                tone: 'green' as const,
              },
            ]
          : []),
        {
          label: 'الإجمالي الكلي للعملاء/الموردين',
          value: `اليمني: ${totalYer.toLocaleString()} ر.ي`,
          subValue: `السعودي: ${totalSarAll.toLocaleString()} ر.س (×${sarRate})`,
          tone: 'gold' as const,
        },
      ],
      tables: [
        {
          headers: vis.map((c) => c.label),
          rows: isCust
            ? filteredCustomers.map((c) =>
                vis.map((col) => {
                  if (col.key === 'code') return c.code;
                  if (col.key === 'nameAr') return c.nameAr;
                  if (col.key === 'zone') return getZoneLabel(c.regionalAreaId);
                  if (col.key === 'phone') return c.whatsapp || c.phone;
                  if (col.key === 'category') return c.category;
                  if (col.key === 'currency') return c.currency || 'YER';
                  return formatPartyBal(c.currentBalance, c.currency);
                })
              )
            : filteredVendors.map((v) =>
                vis.map((col) => {
                  if (col.key === 'code') return v.code;
                  if (col.key === 'nameAr') return v.nameAr;
                  if (col.key === 'zone') return v.address;
                  if (col.key === 'phone') return v.whatsapp || v.phone;
                  if (col.key === 'category') return v.category;
                  if (col.key === 'currency') return v.currency || 'YER';
                  return formatPartyBal(v.currentBalance, v.currency);
                })
              ),
          totals: vis.map((col, idx) => {
            if (idx === 0) return 'الإجمالي';
            if (col.key === 'balance') {
              return `اليمني: ${totalYer.toLocaleString()} ر.ي | السعودي: ${totalSarAll.toLocaleString()} ر.س`;
            }
            return '';
          }),
        },
      ],
      whatsappText: `${company.nameAr}\n${isCust ? 'إجمالي ذمم العملاء' : 'إجمالي مستحقات الموردين'}:\n- بالسعودي: ${totalSarAll.toLocaleString()} SAR\n- سعر التحويل: ${sarRate}\n- باليمني: ${totalYer.toLocaleString()} YER`,
    };
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div className="v20-card-alt px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setSubTab('customers')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'customers' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>العملاء ({customers.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('vendors')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'vendors' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>الموردون ({vendors.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('zones')}
            className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
              subTab === 'zones' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>دليل المناطق الجغرافية ({regionalAreas.length})</span>
          </button>
        </div>

        {subTab !== 'zones' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                if (subTab === 'customers') {
                  setEditCust({
                    id: `cust-${Date.now()}`,
                    branchId: branch.id,
                    code: `C-${customers.length + 101}`,
                    nameAr: '',
                    phone: '',
                    regionalAreaId: regionalAreas[0]?.id || 'reg-01',
                    addressDetails: '',
                    category: 'تجاري',
                    creditLimit: 2000000,
                    paymentTermDays: 30,
                    openingBalance: 0,
                    currentBalance: 0,
                    currency: 'YER',
                    status: 'active',
                    createdAt: new Date().toISOString().split('T')[0],
                  });
                } else {
                  setEditVend({
                    id: `vnd-${Date.now()}`,
                    branchId: branch.id,
                    code: `V-${vendors.length + 101}`,
                    nameAr: '',
                    phone: '',
                    address: 'صنعاء',
                    category: 'مورد رئيسي',
                    openingBalance: 0,
                    currentBalance: 0,
                    paymentTermDays: 30,
                    status: 'active',
                    createdAt: new Date().toISOString().split('T')[0],
                  });
                }
              }}
              className="px-3 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] flex items-center gap-1 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{subTab === 'customers' ? '+ عميل جديد' : '+ مورد جديد'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsColCustOpen(true)}
              className="px-2.5 py-1.5 rounded-md text-xs font-extrabold bg-[#08121E] border border-[var(--border-strong)] text-white flex items-center gap-1 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>أعمدة الجدول</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewPayload(buildPreview())}
              className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#0D2E1D] border border-[var(--success)] text-[var(--success)] flex items-center gap-1 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>معاينة / طباعة / PDF</span>
            </button>
          </div>
        )}
      </div>

      {subTab !== 'zones' ? (
        <div className="v20-card p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="بحث بالاسم أو الكود أو الهاتف..."
                className="v20-input px-3 py-1.5 text-xs w-60"
              />
              {subTab === 'customers' && (
                <select
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                  className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
                >
                  <option value="all">جميع المناطق الجغرافية</option>
                  {regionalAreas.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.governorate} - {z.area}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                className="v20-input px-2.5 py-1.5 text-xs cursor-pointer"
              >
                <option value="ALL">جميع العملات</option>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.nameAr}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-black tabular-nums">
              {activeSarParties.length > 0 && (
                <span className="px-2.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/70 text-emerald-300">
                  الحسابات السعودية ({activeSarParties.length}): {totalSarPartiesSar.toLocaleString()} ر.س
                  {' · '}
                  معادل يمني: {totalSarPartiesYer.toLocaleString()} ر.ي (×{sarRate})
                </span>
              )}
              {currencyFilter !== 'SAR' && (() => {
                const totalYer = subTab === 'customers' ? totalCustBal : totalVendBal;
                const totalSar = Math.round((totalYer / sarRate) * 100) / 100;
                return (
                  <span className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--gold)]/60 text-[var(--gold)]">
                    {subTab === 'customers' ? 'إجمالي ذمم العملاء' : 'إجمالي مستحقات الموردين'}:{' '}
                    {totalYer.toLocaleString()} ر.ي · ({totalSar.toLocaleString()} ر.س × {sarRate})
                  </span>
                );
              })()}
            </div>
          </div>

          <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
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
                  <th className="p-2.5 text-center">إجراءات سريعة</th>
                </tr>
              </thead>
              <tbody>
                {(subTab === 'customers' ? filteredCustomers : filteredVendors).map((item) => {
                  const isCust = subTab === 'customers';
                  const cust = item as Customer;
                  const vend = item as Vendor;
                  const bal = isCust ? cust.currentBalance : vend.currentBalance;
                  const phone = (isCust ? cust.whatsapp || cust.phone : vend.whatsapp || vend.phone) || '';

                  return (
                    <tr key={item.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                      {columns
                        .filter((c) => c.visible)
                        .map((c) => {
                          if (c.key === 'code')
                            return (
                              <td key={c.key} className="p-2 font-mono text-slate-300 border-l border-[#1B2E44]">
                                {item.code}
                              </td>
                            );
                          if (c.key === 'nameAr')
                            return (
                              <td key={c.key} className="p-2 font-bold text-white border-l border-[#1B2E44]">
                                {item.nameAr}
                              </td>
                            );
                          if (c.key === 'zone')
                            return (
                              <td key={c.key} className="p-2 text-[var(--text-secondary)] border-l border-[#1B2E44]">
                                {isCust ? getZoneLabel(cust.regionalAreaId) : vend.address}
                              </td>
                            );
                          if (c.key === 'phone')
                            return (
                              <td key={c.key} className="p-2 font-mono border-l border-[#1B2E44]">
                                {phone}
                              </td>
                            );
                          if (c.key === 'category')
                            return (
                              <td key={c.key} className="p-2 border-l border-[#1B2E44]">
                                {item.category}
                              </td>
                            );
                          if (c.key === 'currency') {
                            const curr = (isCust ? cust.currency : vend.currency) || 'YER';
                            return (
                              <td key={c.key} className="p-2 text-center border-l border-[#1B2E44]">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                    curr === 'SAR'
                                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/50'
                                      : curr === 'USD'
                                      ? 'bg-sky-950/80 text-sky-300 border border-sky-500/50'
                                      : 'bg-slate-800 text-slate-200'
                                  }`}
                                >
                                  {curr}
                                </span>
                              </td>
                            );
                          }
                          const curr = (isCust ? cust.currency : vend.currency) || 'YER';
                          const rate = getRate(curr);
                          const foreignBal = Math.round((bal / rate) * 100) / 100;
                          return (
                            <td
                              key={c.key}
                              className={`p-2 text-center font-black tabular-nums border-l border-[#1B2E44] ${
                                bal > 0 ? 'text-[var(--gold)]' : 'text-emerald-300'
                              }`}
                            >
                              {curr !== 'YER' ? (
                                <div className="leading-tight">
                                  <div className="text-emerald-300">
                                    {foreignBal.toLocaleString()} {curr === 'SAR' ? 'ر.س' : curr}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {bal.toLocaleString()} ر.ي (×{rate})
                                  </div>
                                </div>
                              ) : (
                                <span>{bal.toLocaleString()} ر.ي</span>
                              )}
                            </td>
                          );
                        })}
                      <td className="p-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => onOpenStatement(isCust ? 'customer' : 'vendor', item.id)}
                            className="px-2 py-1 rounded bg-[#08121E] border border-[var(--info)] text-[var(--info)] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>كشف حساب</span>
                          </button>
                          {isCust && onOpenPriceLookup && (
                            <button
                              type="button"
                              onClick={() => onOpenPriceLookup(item.id)}
                              title="استعلام عن أسعار الأصناف المباعة لهذا العميل سابقاً"
                              className="px-2 py-1 rounded bg-[#08121E] border border-amber-500/60 text-amber-300 font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Tag className="w-3 h-3" />
                              <span>أسعاره</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const partyLabel = isCust ? 'عميل' : 'مورد';
                              const curr = (isCust ? cust.currency : vend.currency) || 'YER';
                              const rate = getRate(curr);
                              const foreignBal = Math.round((bal / rate) * 100) / 100;
                              const isForeign = curr !== 'YER';
                              const miniPayload: UniversalPreviewPayload = {
                                title: `إشعار رصيد ${partyLabel}: ${item.nameAr}`,
                                periodText: isForeign
                                  ? `تاريخ الإصدار: ${new Date().toISOString().split('T')[0]} · سعر التحويل: 1 ${curr} = ${rate} YER`
                                  : `تاريخ الإصدار: ${new Date().toISOString().split('T')[0]}`,
                                metadata: {
                                  الاسم: item.nameAr,
                                  الكود: item.code,
                                  الهاتف: phone || '-',
                                  العملة: curr,
                                },
                                tables: [
                                  {
                                    headers: isForeign
                                      ? ['البيان', `الرصيد (${curr})`, 'نسبة التحويل', 'المعادل (YER)']
                                      : ['البيان', 'التصنيف', 'الرصيد القائم (YER)'],
                                    rows: isForeign
                                      ? [[item.nameAr, `${foreignBal.toLocaleString()} ${curr}`, rate, `${bal.toLocaleString()} YER`]]
                                      : [[item.nameAr, item.category, bal.toLocaleString()]],
                                    totals: isForeign
                                      ? ['الإجمالي المستحق', `${foreignBal.toLocaleString()} ${curr}`, `× ${rate}`, `${bal.toLocaleString()} YER`]
                                      : ['الإجمالي المستحق', '', `${bal.toLocaleString()} YER`],
                                  },
                                ],
                                whatsappText: isForeign
                                  ? `${company.nameAr}\nمرحباً ${item.nameAr}\nالرصيد القائم بالسعودي/العملة (${curr}): ${foreignBal.toLocaleString()} ${curr}\nنسبة التحويل: ${rate}\nالمعادل باليمني: ${bal.toLocaleString()} YER`
                                  : `${company.nameAr}\nمرحباً ${item.nameAr}\nالرصيد القائم حالياً: ${bal.toLocaleString()} YER`,
                              };
                              setWaPayload({
                                phone,
                                text: miniPayload.whatsappText || '',
                                previewPayload: miniPayload,
                              });
                            }}
                            className="p-1 rounded bg-[#0B2B17] border border-[#25D366] text-[#25D366] cursor-pointer"
                            title="إرسال واتساب (صورة / PDF)"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => (isCust ? setEditCust(cust) : setEditVend(vend))}
                            className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-sky-300 cursor-pointer"
                            title="تعديل"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="v20-card p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={newZoneGov}
              onChange={(e) => setNewZoneGov(e.target.value)}
              placeholder="المحافظة (صنعاء / عدن / تعز...)"
              className="v20-input px-3 py-1.5 text-xs w-44"
            />
            <input
              type="text"
              value={newZoneArea}
              onChange={(e) => setNewZoneArea(e.target.value)}
              placeholder="اسم المنطقة أو الخط *"
              className="v20-input px-3 py-1.5 text-xs w-60"
            />
            <button
              type="button"
              onClick={() => {
                if (!newZoneArea.trim()) {
                  onNotify('error', 'أدخل اسم المنطقة.');
                  return;
                }
                onSaveZone({
                  id: `reg-${Date.now()}`,
                  country: 'اليمن',
                  governorate: newZoneGov.trim() || 'صنعاء',
                  district: newZoneArea.trim(),
                  area: newZoneArea.trim(),
                  code: `ZN-${regionalAreas.length + 1}`,
                });
                setNewZoneArea('');
                onNotify('success', 'تمت إضافة المنطقة الجغرافية.');
              }}
              className="px-4 py-1.5 rounded v20-btn-gold text-xs cursor-pointer"
            >
              + إضافة منطقة
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {regionalAreas.map((z) => (
              <div key={z.id} className="v20-card-alt p-2.5 text-xs flex justify-between items-center">
                <div>
                  <div className="font-black text-[var(--gold)]">{z.governorate}</div>
                  <div className="text-white font-bold">{z.area}</div>
                </div>
                <span className="font-mono text-[11px] text-slate-400">{z.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Customer Edit Modal */}
      {editCust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-2.5 text-xs">
            <h3 className="font-black text-sm text-[var(--gold)]">بيانات العميل</h3>
            <input
              type="text"
              value={editCust.nameAr}
              onChange={(e) => setEditCust({ ...editCust, nameAr: e.target.value })}
              placeholder="اسم العميل *"
              className="w-full v20-input px-2.5 py-1.5"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={editCust.phone}
                onChange={(e) => setEditCust({ ...editCust, phone: e.target.value, whatsapp: e.target.value })}
                placeholder="الهاتف / واتساب"
                className="w-full v20-input px-2.5 py-1.5"
              />
              <select
                value={editCust.regionalAreaId}
                onChange={(e) => setEditCust({ ...editCust, regionalAreaId: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              >
                {regionalAreas.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.governorate} - {z.area}
                  </option>
                ))}
              </select>
              <select
                value={editCust.currency || 'YER'}
                onChange={(e) => setEditCust({ ...editCust, currency: e.target.value as CurrencyCode })}
                className="w-full v20-input px-2.5 py-1.5"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={editCust.creditLimit}
                onChange={(e) => setEditCust({ ...editCust, creditLimit: parseFloat(e.target.value) || 0 })}
                placeholder="الحد الائتماني"
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditCust(null)}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editCust.nameAr.trim()) {
                    onNotify('error', 'أدخل اسم العميل.');
                    return;
                  }
                  onSaveCustomer(editCust);
                  setEditCust(null);
                  onNotify('success', `تم حفظ بيانات العميل "${editCust.nameAr}".`);
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vendor Edit Modal */}
      {editVend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" dir="rtl">
          <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl w-full max-w-md p-4 space-y-2.5 text-xs">
            <h3 className="font-black text-sm text-[var(--gold)]">بيانات المورد</h3>
            <input
              type="text"
              value={editVend.nameAr}
              onChange={(e) => setEditVend({ ...editVend, nameAr: e.target.value })}
              placeholder="اسم المورد *"
              className="w-full v20-input px-2.5 py-1.5"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={editVend.phone}
                onChange={(e) => setEditVend({ ...editVend, phone: e.target.value, whatsapp: e.target.value })}
                placeholder="الهاتف / واتساب"
                className="w-full v20-input px-2.5 py-1.5"
              />
              <input
                type="text"
                value={editVend.address}
                onChange={(e) => setEditVend({ ...editVend, address: e.target.value })}
                placeholder="العنوان"
                className="w-full v20-input px-2.5 py-1.5"
              />
              <select
                value={editVend.currency || 'YER'}
                onChange={(e) => setEditVend({ ...editVend, currency: e.target.value as CurrencyCode })}
                className="w-full v20-input px-2.5 py-1.5 col-span-2"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    عملة الحساب: {c.nameAr} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditVend(null)}
                className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editVend.nameAr.trim()) {
                    onNotify('error', 'أدخل اسم المورد.');
                    return;
                  }
                  onSaveVendor(editVend);
                  setEditVend(null);
                  onNotify('success', `تم حفظ بيانات المورد "${editVend.nameAr}".`);
                }}
                className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer"
              >
                حفظ
              </button>
            </div>
          </div>
        </div>
      )}

      <UniversalColumnCustomizer
        isOpen={isColCustOpen}
        title="تخصيص أعمدة دليل العملاء والموردين"
        columns={columns}
        onChange={(updated) => onSaveColumnPrefs('v20-parties-grid', updated)}
        onReset={() => onSaveColumnPrefs('v20-parties-grid', DEFAULT_PARTY_COLS)}
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

      <WhatsAppShareModal
        isOpen={Boolean(waPayload)}
        title="إرسال إشعار رصيد عبر واتساب"
        defaultPhone={waPayload?.phone}
        defaultMessage={waPayload?.text || ''}
        previewPayload={waPayload?.previewPayload}
        company={company}
        branch={branch}
        onClose={() => setWaPayload(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
