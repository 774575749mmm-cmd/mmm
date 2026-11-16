/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Application Sidebar
 */

import React from 'react';
import {
  LayoutDashboard,
  Users,
  Building,
  ShoppingCart,
  ShoppingBag,
  Package,
  BookOpenCheck,
  Wallet,
  Receipt,
  UserCheck,
  Landmark,
  FileBarChart,
  BellRing,
  Settings,
  ChevronLeft,
  ShieldCheck,
  FileText,
  Clock,
  Layers,
} from 'lucide-react';

export type ERPModuleId =
  | 'dashboard'
  | 'daily_report'
  | 'unified_docs'
  | 'scheduled_dispatch'
  | 'customers'
  | 'vendors'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'accounting'
  | 'treasury'
  | 'expenses'
  | 'hr'
  | 'assets'
  | 'reports'
  | 'tasks'
  | 'settings';

interface SidebarProps {
  activeModule: ERPModuleId;
  onSelectModule: (module: ERPModuleId) => void;
  isOpen: boolean;
  onClose: () => void;
  userRole: string;
  hiddenModules?: string[];
}

interface NavItem {
  id: ERPModuleId;
  labelAr: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  category: 'أساسي' | 'تشغيلي' | 'مالي' | 'إداري';
}

const navItems: NavItem[] = [
  { id: 'dashboard', labelAr: 'لوحة القيادة والمؤشرات', icon: LayoutDashboard, category: 'أساسي' },
  { id: 'daily_report', labelAr: 'التقرير الإداري اليومي الشامل', icon: FileText, category: 'أساسي', badge: '22 مؤشر' },
  { id: 'unified_docs', labelAr: 'مركز المستندات الموحد', icon: Layers, category: 'تشغيلي', badge: 'موحد' },
  { id: 'customers', labelAr: 'العملاء والمناطق', icon: Users, category: 'تشغيلي', badge: 'مناطق' },
  { id: 'sales', labelAr: 'المبيعات وعروض الأسعار', icon: ShoppingCart, category: 'تشغيلي' },
  { id: 'vendors', labelAr: 'إدارة الموردين', icon: Building, category: 'تشغيلي' },
  { id: 'purchases', labelAr: 'المشتريات وأوامر الشراء', icon: ShoppingBag, category: 'تشغيلي' },
  { id: 'inventory', labelAr: 'المخزون والمستودعات', icon: Package, category: 'تشغيلي', badge: 'جرد' },
  { id: 'accounting', labelAr: 'المحاسبة المزدوجة والقيود', icon: BookOpenCheck, category: 'مالي', badge: 'دفاتر' },
  { id: 'treasury', labelAr: 'الصناديق والبنوك والسندات', icon: Wallet, category: 'مالي', badge: 'جماعي' },
  { id: 'expenses', labelAr: 'المصروفات ومراكز التكلفة', icon: Receipt, category: 'مالي' },
  { id: 'scheduled_dispatch', labelAr: 'مركز الإرسال والمجدول', icon: Clock, category: 'إداري' },
  { id: 'hr', labelAr: 'الموارد البشرية والرواتب', icon: UserCheck, category: 'إداري' },
  { id: 'assets', labelAr: 'الأصول الثابتة والإهلاك', icon: Landmark, category: 'إداري' },
  { id: 'reports', labelAr: 'مركز التقارير والتحليلات', icon: FileBarChart, category: 'أساسي', badge: '22' },
  { id: 'tasks', labelAr: 'المهام والتنبيهات والواتساب', icon: BellRing, category: 'أساسي' },
  { id: 'settings', labelAr: 'مركز الإعدادات والتخصيص', icon: Settings, category: 'إداري' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeModule,
  onSelectModule,
  isOpen,
  onClose,
  userRole,
  hiddenModules = [],
}) => {
  const visibleItems = navItems.filter(
    (item) => item.id === 'settings' || item.id === activeModule || !hiddenModules.includes(item.id)
  );

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 lg:hidden no-print"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 right-0 z-40 w-64 bg-slate-900 border-l border-slate-800 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:h-[calc(100vh-4rem)] no-print ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectModule(item.id);
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? 'text-amber-400' : 'text-slate-500'
                    }`}
                  />
                  <span className="truncate">{item.labelAr}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  {item.badge && (
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                        isActive
                          ? 'bg-amber-500/25 text-amber-200'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  {isActive && <ChevronLeft className="w-3.5 h-3.5 text-amber-400" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Current Active Role Footer */}
        <div className="p-3.5 border-t border-slate-800/80 bg-slate-950/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block leading-tight">صلاحيات التشغيل:</span>
              <strong className="text-slate-200 text-xs font-bold">{userRole}</strong>
            </div>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-1.5 py-0.5 rounded">
            مفعل
          </span>
        </div>
      </aside>
    </>
  );
};
