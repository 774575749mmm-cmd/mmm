/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - MetricCard Component
 */

import React from 'react';
import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  currency?: string;
  icon: LucideIcon;
  change?: {
    value: string;
    isPositive: boolean;
  };
  subtitle?: string;
  color?: 'amber' | 'emerald' | 'rose' | 'sky' | 'indigo';
  onClick?: () => void;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  currency,
  icon: Icon,
  change,
  subtitle,
  color = 'amber',
  onClick,
}) => {
  const colorMap = {
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    sky: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    indigo: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  };

  return (
    <div
      onClick={onClick}
      className={`bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all text-slate-100 flex flex-col justify-between ${
        onClick ? 'cursor-pointer hover:bg-slate-800/40 group' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-xs font-semibold text-slate-400 leading-snug">{title}</span>
        <div className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${colorMap[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-black tracking-tight text-white tabular-nums font-mono">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </span>
          {currency && (
            <span className="text-xs font-semibold text-slate-400">{currency}</span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          {change && (
            <div className={`flex items-center gap-1 font-semibold ${change.isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
              {change.isPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
              <span className="tabular-nums font-mono">{change.value}</span>
            </div>
          )}
          {subtitle && (
            <span className="text-slate-400 text-[11px] truncate">{subtitle}</span>
          )}
          {onClick && (
            <span className="text-[11px] text-amber-400/80 group-hover:text-amber-300 transition-colors font-medium mr-auto">
              عرض التفاصيل ←
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
