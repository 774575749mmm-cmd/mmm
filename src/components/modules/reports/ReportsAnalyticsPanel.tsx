/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Executive Financial Analytics & Pure SVG BI Visualizations
 */

import React, { useMemo } from 'react';
import { BarChart3, PieChart, Coins, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { buildErpAnalyticsSnapshot } from '../../../services/smartDiagnostics';
import { getEffectiveCurrencyRate } from '../../../services/currencyHelpers';
import { AppLanguage } from '../../../services/i18n';

interface ReportsAnalyticsPanelProps {
  db: ERPDatabase;
  lang: AppLanguage;
  sarRate: number;
  onSelectCustomerStatement?: (customerId: string) => void;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function compactNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${round2(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${round2(n / 1_000)}K`;
  return String(round2(n));
}

export const ReportsAnalyticsPanel: React.FC<ReportsAnalyticsPanelProps> = ({
  db,
  lang,
  sarRate,
  onSelectCustomerStatement,
}) => {
  const isEn = lang === 'en';
  const snap = useMemo(() => buildErpAnalyticsSnapshot(db), [db]);

  const metrics = useMemo(() => {
    const netOperating = snap.revenueBase - snap.expensesBase;
    const quickRatio =
      snap.totalPayablesBase > 0
        ? round2((snap.totalLiquidityBase + snap.totalReceivablesBase) / snap.totalPayablesBase)
        : 9.99;

    const totalItems = Math.max(1, db.inventoryItems.length);
    const healthyItems = Math.max(0, totalItems - snap.negativeStockCount - snap.lowStockCount);
    const inventoryHealthPct = round2((healthyItems / totalItems) * 100);

    // Aging buckets across active receivables
    const todayMs = Date.now();
    let ageCurrent = 0;
    let age31to60 = 0;
    let ageOver60 = 0;

    db.invoices
      .filter((i) => i.type === 'مبيعات' && i.status !== 'cancelled' && i.remainingAmount > 0)
      .forEach((inv) => {
        const rate = inv.exchangeRate || getEffectiveCurrencyRate(db.currencies, inv.currency);
        const amtBase = inv.remainingAmount * rate;
        const refDate = Date.parse(inv.dueDate || inv.date);
        const days = Number.isFinite(refDate) ? Math.max(0, Math.floor((todayMs - refDate) / 86400000)) : 0;
        if (days <= 30) ageCurrent += amtBase;
        else if (days <= 60) age31to60 += amtBase;
        else ageOver60 += amtBase;
      });

    const agingTotal = Math.max(1, ageCurrent + age31to60 + ageOver60);

    const topCustomers = [...db.customers]
      .filter((c) => (c.currentBalance || 0) > 0)
      .sort((a, b) => (b.currentBalance || 0) - (a.currentBalance || 0))
      .slice(0, 5);

    return {
      netOperating,
      quickRatio,
      inventoryHealthPct,
      ageCurrent,
      age31to60,
      ageOver60,
      agingTotal,
      topCustomers,
    };
  }, [db, snap]);

  const barSeries = useMemo(() => {
    const items = [
      {
        label: isEn ? 'Net Sales' : 'صافي المبيعات',
        value: snap.revenueBase,
        color: '#22c55e',
      },
      {
        label: isEn ? 'Purchases' : 'المشتريات',
        value: snap.purchasesBase,
        color: '#38bdf8',
      },
      {
        label: isEn ? 'Expenses' : 'المصروفات',
        value: snap.expensesBase,
        color: '#f43f5e',
      },
      {
        label: isEn ? 'Liquidity' : 'السيولة النقدية',
        value: snap.totalLiquidityBase,
        color: '#f5c748',
      },
      {
        label: isEn ? 'Receivables' : 'ذمم العملاء',
        value: snap.totalReceivablesBase,
        color: '#a78bfa',
      },
    ];
    const maxVal = Math.max(1, ...items.map((x) => x.value));
    return items.map((x) => ({
      ...x,
      pct: Math.max(4, Math.round((x.value / maxVal) * 100)),
    }));
  }, [snap, isEn]);

  const currencySlices = useMemo(() => {
    const total = Math.max(1, snap.totalLiquidityBase);
    const palette: Record<string, string> = {
      YER: '#38bdf8',
      SAR: '#f5c748',
      USD: '#22c55e',
    };
    return snap.liquidityByCurrency.map((item) => ({
      ...item,
      pct: round2((Math.max(0, item.baseYer) / total) * 100),
      color: palette[item.currency] || '#a78bfa',
    }));
  }, [snap]);

  return (
    <div className="space-y-3" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Executive Financial Ratios Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="v20-card p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold">
            <span>{isEn ? 'Gross Profit Margin' : 'هامش الربح الإجمالي'}</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-lg font-black text-emerald-300 tabular-nums mt-1">
            {snap.grossMarginPct}%
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">
            {isEn ? 'Net Operating:' : 'صافي التشغيل:'} {round2(metrics.netOperating / (sarRate || 1)).toLocaleString()}{' '}
            {isEn ? 'SAR eq.' : 'ر.س'}
          </div>
        </div>

        <div className="v20-card p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold">
            <span>{isEn ? 'Receivables Collection' : 'نسبة تحصيل المبيعات'}</span>
            <Coins className="w-3.5 h-3.5 text-[var(--gold)]" />
          </div>
          <div className="text-lg font-black text-[var(--gold)] tabular-nums mt-1">
            {snap.collectionRatePct}%
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">
            {isEn ? 'Overdue Invoices:' : 'فواتير متأخرة:'} {snap.overdueReceivablesCount}
          </div>
        </div>

        <div className="v20-card p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold">
            <span>{isEn ? 'Quick Coverage Ratio' : 'مؤشر تغطية الالتزامات'}</span>
            <PieChart className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-lg font-black text-sky-300 tabular-nums mt-1">
            {metrics.quickRatio}x
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">
            {isEn ? 'Payables:' : 'ذمم الموردين:'} {round2(snap.totalPayablesBase).toLocaleString()} YER
          </div>
        </div>

        <div className="v20-card p-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold">
            <span>{isEn ? 'Inventory Health' : 'كفاءة توفر المخزون'}</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div
            className={`text-lg font-black tabular-nums mt-1 ${
              metrics.inventoryHealthPct >= 80
                ? 'text-emerald-300'
                : metrics.inventoryHealthPct >= 55
                ? 'text-amber-300'
                : 'text-rose-400'
            }`}
          >
            {metrics.inventoryHealthPct}%
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">
            {isEn
              ? `${snap.lowStockCount} low · ${snap.negativeStockCount} negative`
              : `${snap.lowStockCount} منخفض · ${snap.negativeStockCount} سالب`}
          </div>
        </div>
      </div>

      {/* Main SVG BI Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* 1. Comparative Financial Performance SVG Bar Chart */}
        <div className="v20-card p-3.5 lg:col-span-5 space-y-2.5">
          <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
            <h4 className="font-black text-xs text-[var(--gold)] flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />
              <span>{isEn ? 'Financial Position Comparison (YER)' : 'مقارنة الموقف المالي الإجمالي (بالريال اليمني)'}</span>
            </h4>
            <span className="text-[10px] text-slate-400 tabular-nums">1 SAR = {sarRate} YER</span>
          </div>

          <svg viewBox="0 0 420 185" className="w-full h-44 overflow-visible" role="img" aria-label="Financial Comparison Chart">
            {/* Horizontal grid lines */}
            {[30, 70, 110, 145].map((y) => (
              <line
                key={y}
                x1="10"
                y1={y}
                x2="410"
                y2={y}
                stroke="#1b2e44"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            ))}
            {barSeries.map((bar, idx) => {
              const barW = 46;
              const gap = 32;
              const x = 28 + idx * (barW + gap);
              const maxH = 115;
              const h = Math.max(6, Math.round((bar.pct / 100) * maxH));
              const y = 145 - h;
              return (
                <g key={bar.label}>
                  <rect x={x} y={y} width={barW} height={h} rx="4" fill={bar.color} opacity="0.9" />
                  <text
                    x={x + barW / 2}
                    y={y - 6}
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {compactNum(bar.value)}
                  </text>
                  <text
                    x={x + barW / 2}
                    y="165"
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {bar.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* 2. Multi-Currency Liquidity & Receivables Aging Risk */}
        <div className="v20-card p-3.5 lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
            <h4 className="font-black text-xs text-sky-300 flex items-center gap-1.5">
              <Coins className="w-4 h-4" />
              <span>{isEn ? 'Multi-Currency Liquidity Mix' : 'توزيع السيولة حسب العملة'}</span>
            </h4>
            <span className="text-[11px] font-black text-white tabular-nums">
              {compactNum(snap.totalLiquidityBase)} YER
            </span>
          </div>

          <div className="space-y-2 text-[11px]">
            {currencySlices.map((slice) => (
              <div key={slice.currency} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-200">
                    {slice.currency} ({slice.nativeTotal.toLocaleString()})
                  </span>
                  <span className="text-slate-400 tabular-nums">
                    {slice.pct}% · {round2(slice.baseYer).toLocaleString()} YER
                  </span>
                </div>
                <div className="w-full h-2 bg-[#060D15] rounded-full overflow-hidden border border-[#1B2E44]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, Math.max(2, slice.pct))}%`, backgroundColor: slice.color }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Receivables Aging Horizontal Stacked Bar */}
          <div className="pt-2 border-t border-[var(--border-strong)] space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-black text-amber-300">
                {isEn ? 'Receivables Aging Risk' : 'توزيع أعمار ذمم العملاء'}
              </span>
              <span className="text-slate-400 tabular-nums">
                {round2(metrics.ageCurrent + metrics.age31to60 + metrics.ageOver60).toLocaleString()} YER
              </span>
            </div>
            <svg viewBox="0 0 300 16" className="w-full h-4 rounded overflow-hidden">
              {(() => {
                const w1 = Math.round((metrics.ageCurrent / metrics.agingTotal) * 300);
                const w2 = Math.round((metrics.age31to60 / metrics.agingTotal) * 300);
                const w3 = Math.max(0, 300 - w1 - w2);
                return (
                  <>
                    <rect x="0" y="0" width={w1} height="16" fill="#22c55e" />
                    <rect x={w1} y="0" width={w2} height="16" fill="#f59e0b" />
                    <rect x={w1 + w2} y="0" width={w3} height="16" fill="#f43f5e" />
                  </>
                );
              })()}
            </svg>
            <div className="flex items-center justify-between text-[10px] text-slate-400 tabular-nums">
              <span className="text-emerald-300">
                {isEn ? '0-30d:' : 'جاري ≤30ي:'} {compactNum(metrics.ageCurrent)}
              </span>
              <span className="text-amber-300">
                {isEn ? '31-60d:' : '31-60ي:'} {compactNum(metrics.age31to60)}
              </span>
              <span className="text-rose-400">
                {isEn ? '>60d:' : '+60ي:'} {compactNum(metrics.ageOver60)}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Top 5 Customer Exposures */}
        <div className="v20-card p-3.5 lg:col-span-3 space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
            <h4 className="font-black text-xs text-emerald-300 flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span>{isEn ? 'Top Customer Balances' : 'أعلى أرصدة العملاء'}</span>
            </h4>
            <span className="text-[10px] text-slate-400">Top 5</span>
          </div>
          {metrics.topCustomers.length === 0 ? (
            <div className="text-xs text-slate-400 py-6 text-center">
              {isEn ? 'No open customer receivables.' : 'لا توجد ذمم مفتوحة على العملاء.'}
            </div>
          ) : (
            <div className="space-y-1.5 text-[11px]">
              {metrics.topCustomers.map((c) => {
                const isSar = c.currency === 'SAR';
                const nativeVal = isSar ? round2(c.currentBalance / (sarRate || 1)) : round2(c.currentBalance);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelectCustomerStatement?.(c.id)}
                    className="w-full text-start p-2 rounded bg-[#08121E] border border-[#1B2E44] hover:border-[var(--gold)] flex items-center justify-between gap-2 transition cursor-pointer"
                  >
                    <div className="truncate font-bold text-white">{c.nameAr}</div>
                    <div className="shrink-0 text-end tabular-nums">
                      <div className="font-black text-[var(--gold)]">
                        {nativeVal.toLocaleString()} {c.currency || 'YER'}
                      </div>
                      {isSar && (
                        <div className="text-[10px] text-slate-400">
                          {round2(c.currentBalance).toLocaleString()} YER
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
