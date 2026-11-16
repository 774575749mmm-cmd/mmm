/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Application Header
 */

import React from 'react';
import {
  Building2,
  Coins,
  Shield,
  Bell,
  HelpCircle,
  RotateCcw,
  PlusCircle,
  Menu,
} from 'lucide-react';
import { Branch, Currency, User } from '../../types/erp';

interface HeaderProps {
  currentBranch: Branch;
  branches: Branch[];
  onSelectBranch: (branch: Branch) => void;
  currentCurrency: Currency;
  currencies: Currency[];
  onSelectCurrency: (currency: Currency) => void;
  currentUser: User;
  users: User[];
  onSwitchUser: (user: User) => void;
  onOpenQuickNewModal: () => void;
  onOpenHelp: () => void;
  onResetData: () => void;
  unreadAlertsCount: number;
  onOpenAlerts: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentBranch,
  branches,
  onSelectBranch,
  currentCurrency,
  currencies,
  onSelectCurrency,
  currentUser,
  users,
  onSwitchUser,
  onOpenQuickNewModal,
  onOpenHelp,
  onResetData,
  unreadAlertsCount,
  onOpenAlerts,
  onToggleSidebar,
}) => {
  return (
    <header className="h-16 bg-slate-900 border-b border-slate-800 px-3 md:px-6 flex items-center justify-between gap-3 sticky top-0 z-30 select-none no-print">
      {/* Zone 1: Brand & Toggle */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg lg:hidden transition-colors cursor-pointer"
          aria-label="القائمة الجانبية"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center font-black text-slate-950 text-base shadow-md shadow-amber-500/10">
            م
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-100 tracking-tight text-sm sm:text-base whitespace-nowrap">
                ALMANSOOR ERP
              </span>
              <span className="text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded whitespace-nowrap hidden sm:inline-block">
                المنصور الذكي
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Zone 2: Contextual Selectors (Branch, Currency, Role) */}
      <div className="hidden md:flex items-center gap-2.5 text-xs">
        {/* Branch Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300">
          <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-slate-500 text-[11px]">الفرع:</span>
          <select
            value={currentBranch.id}
            onChange={(e) => {
              const b = branches.find((item) => item.id === e.target.value);
              if (b) onSelectBranch(b);
            }}
            aria-label="اختر الفرع"
            className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium text-xs pr-1"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id} className="bg-slate-900 text-slate-200">
                {b.nameAr}
              </option>
            ))}
          </select>
        </div>

        {/* Currency Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300">
          <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-slate-500 text-[11px]">العملة:</span>
          <select
            value={currentCurrency.code}
            onChange={(e) => {
              const c = currencies.find((item) => item.code === e.target.value);
              if (c) onSelectCurrency(c);
            }}
            aria-label="اختر العملة"
            className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium text-xs pr-1"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code} className="bg-slate-900 text-slate-200">
                {c.nameAr} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        {/* Authenticated User Switch / Logout Trigger (requires password auth) */}
        <button
          type="button"
          onClick={() => onSwitchUser(currentUser)}
          aria-label="تبديل المستخدم أو تسجيل الخروج"
          title="تبديل المستخدم (يتطلب كلمة مرور)"
          className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 hover:border-amber-500/60 rounded-lg px-2.5 py-1.5 text-slate-300 cursor-pointer transition-colors"
        >
          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-slate-500 text-[11px]">الدور:</span>
          <span className="text-amber-300 font-semibold text-xs">
            {currentUser.role} - {currentUser.fullName}
          </span>
        </button>
      </div>

      {/* Zone 3: Actions & Notifications */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={onOpenHelp}
          title="الدليل التشغيلي والمحاسبي"
          className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onOpenAlerts}
          title="التنبيهات والمهام"
          className="relative p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
        >
          <Bell className="w-4 h-4" />
          {unreadAlertsCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full" />
          )}
        </button>

        {currentUser.canManageSettings && (
          <button
            type="button"
            onClick={onResetData}
            title="إعادة ضبط البيانات التجريبية"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-950/20 border border-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة ضبط</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenQuickNewModal}
          className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold text-xs rounded-lg shadow-sm transition-all cursor-pointer whitespace-nowrap"
        >
          <PlusCircle className="w-4 h-4" />
          <span>عملية جديدة</span>
        </button>
      </div>
    </header>
  );
};
