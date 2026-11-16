/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Executive Dashboard Module
 */

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Users,
  Building,
  Package,
  AlertCircle,
  FileText,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { MetricCard } from '../../common/MetricCard';
import { ERPModuleId } from '../../layout/Sidebar';
import { generateIncomeStatement, generateBalanceSheet } from '../../../services/accountingEngine';
import { convertToBase, getEffectiveCurrencyRate } from '../../../services/currencyHelpers';

interface DashboardModuleProps {
  db: ERPDatabase;
  onNavigate: (module: ERPModuleId) => void;
  onOpenQuickNew: () => void;
  currencySymbol: string;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  db,
  onNavigate,
  onOpenQuickNew,
  currencySymbol,
}) => {
  // 1. Calculate real operational metrics (net of returns, normalized to base currency)
  const totalSales =
    db.invoices
      .filter((inv) => inv.type === 'مبيعات' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate), 0) -
    db.invoices
      .filter((inv) => inv.type === 'مرتجع_مبيعات' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate), 0);

  const totalPurchases =
    db.invoices
      .filter((inv) => inv.type === 'مشتريات' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate), 0) -
    db.invoices
      .filter((inv) => inv.type === 'مرتجع_مشتريات' && inv.status !== 'cancelled')
      .reduce((sum, inv) => sum + convertToBase(inv.grandTotal, inv.currency, db.currencies, inv.exchangeRate), 0);

  const totalCashAndBanks = db.treasuryAccounts.reduce(
    (sum, tr) => sum + tr.balance * getEffectiveCurrencyRate(db.currencies, tr.currency),
    0
  );
  const totalReceivables = db.customers.reduce((sum, c) => sum + Math.max(0, c.currentBalance), 0);
  const totalPayables = db.vendors.reduce((sum, v) => sum + Math.max(0, v.currentBalance), 0);

  const totalInventoryValuation = db.warehouseStock.reduce(
    (sum, st) => sum + st.quantityOnHand * st.averageCost,
    0
  );

  // Financial Engine outputs
  const incomeStmt = generateIncomeStatement(db.chartOfAccounts, db.journalEntries);
  const balanceSheet = generateBalanceSheet(db.chartOfAccounts, db.journalEntries);

  // Recent Invoices
  const recentInvoices = [...db.invoices]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // Critical Alerts
  const pendingAlerts = db.taskAlerts.filter((a) => !a.isCompleted);

  return (
    <div className="space-y-6">
      {/* Top Banner / Welcome & Status */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-bold text-white tracking-tight">
              لوحة القيادة والمؤشرات المالية والتشغيلية
            </h2>
            <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 px-2 py-0.5 rounded">
              السنة المالية 2026 (مفتوحة)
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {db.company.nameAr || 'المؤسسة'} · نظام المحاسبة المزدوجة المتكامل والرقابة المخزنية الآنية
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-left bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2 text-xs">
            <span className="text-slate-500 block text-[11px]">ميزان العمومية:</span>
            <div className="flex items-center gap-1.5 font-bold">
              {balanceSheet.isBalanced ? (
                <>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">متوازن 100% (أصول = خصوم + ملكية)</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span className="text-rose-400">يوجد فارق: {balanceSheet.variance.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="إجمالي المبيعات المحققة"
          value={totalSales}
          currency={currencySymbol}
          icon={TrendingUp}
          color="emerald"
          subtitle="الفواتير المعتمدة خلال الفترة"
          onClick={() => onNavigate('sales')}
        />

        <MetricCard
          title="صافي الأرباح التشغيلية"
          value={incomeStmt.netIncome}
          currency={currencySymbol}
          icon={DollarSign}
          color={incomeStmt.netIncome >= 0 ? 'amber' : 'rose'}
          subtitle={`مجمل الربح: ${incomeStmt.grossProfit.toLocaleString()} ${currencySymbol}`}
          onClick={() => onNavigate('accounting')}
        />

        <MetricCard
          title="رصيد الخزينة والنقدية والبنوك"
          value={totalCashAndBanks}
          currency={currencySymbol}
          icon={Wallet}
          color="sky"
          subtitle={`${db.treasuryAccounts.length} صناديق وبنوك مسجلة`}
          onClick={() => onNavigate('treasury')}
        />

        <MetricCard
          title="إجمالي الذمم المدينة (العملاء)"
          value={totalReceivables}
          currency={currencySymbol}
          icon={Users}
          color="indigo"
          subtitle={`${db.customers.length} عميل في مختلف المناطق`}
          onClick={() => onNavigate('customers')}
        />

        <MetricCard
          title="إجمالي المشتريات والتوريدات"
          value={totalPurchases}
          currency={currencySymbol}
          icon={TrendingDown}
          color="amber"
          subtitle="فواتير الاستيراد والتوريد"
          onClick={() => onNavigate('purchases')}
        />

        <MetricCard
          title="إجمالي الذمم الدائنة (الموردين)"
          value={totalPayables}
          currency={currencySymbol}
          icon={Building}
          color="rose"
          subtitle="الالتزامات المستحقة للموردين"
          onClick={() => onNavigate('vendors')}
        />

        <MetricCard
          title="القيمة التقديرية للمخزون"
          value={totalInventoryValuation}
          currency={currencySymbol}
          icon={Package}
          color="emerald"
          subtitle={`بمتوسط التكلفة المرجح · ${db.warehouses.length} مستودعات`}
          onClick={() => onNavigate('inventory')}
        />

        <MetricCard
          title="المصروفات التشغيلية المباشرة"
          value={incomeStmt.totalExpenses}
          currency={currencySymbol}
          icon={FileText}
          color="sky"
          subtitle="رواتب وإيجارات ومرافق"
          onClick={() => onNavigate('expenses')}
        />
      </div>

      {/* Middle Grid: Operational Overview & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices Table (2 columns) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm text-slate-100">أحدث فواتير المبيعات والمشتريات</h3>
              </div>
              <button
                onClick={() => onNavigate('sales')}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <span>عرض الكل</span>
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500 font-semibold">
                    <th className="py-2.5 px-3">رقم الفاتورة</th>
                    <th className="py-2.5 px-3">النوع</th>
                    <th className="py-2.5 px-3">الطرف</th>
                    <th className="py-2.5 px-3">التاريخ</th>
                    <th className="py-2.5 px-3 text-left">الإجمالي ({currencySymbol})</th>
                    <th className="py-2.5 px-3 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {recentInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                        {inv.invoiceNumber}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-300">
                        {inv.type === 'مبيعات' ? 'مبيعات' : 'مشتريات'} ({inv.paymentType})
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-200">
                        {inv.entityName}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 text-[11px]">
                        {inv.date}
                      </td>
                      <td className="py-2.5 px-3 text-left font-mono font-bold text-slate-100">
                        {inv.grandTotal.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                            inv.status === 'paid'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                              : inv.status === 'posted'
                              ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                              : 'bg-sky-950 text-sky-400 border border-sky-800/40'
                          }`}
                        >
                          {inv.status === 'paid' ? 'مسدد' : inv.status === 'posted' ? 'مرحل آجل' : 'جزئي'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-4 mt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>جميع الفواتير تسجل آلياً في دفتر اليومية وتؤثر في المخزون وحسابات العملاء والموردين</span>
            <button
              onClick={onOpenQuickNew}
              className="text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
            >
              + إضافة فاتورة جديدة
            </button>
          </div>
        </div>

        {/* Task & Notification Alerts Card (1 column) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <h3 className="font-bold text-sm text-slate-100">التنبيهات والمهام المستحقة</h3>
              </div>
              <button
                onClick={() => onNavigate('tasks')}
                className="text-xs text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
              >
                إدارة المهام ({pendingAlerts.length})
              </button>
            </div>

            <div className="space-y-3">
              {pendingAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-slate-200 leading-snug">{alert.title}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-bold ${
                        alert.severity === 'high'
                          ? 'bg-rose-950 text-rose-400 border border-rose-800/40'
                          : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                      }`}
                    >
                      {alert.severity === 'high' ? 'عاجل' : 'متابعة'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>المسؤول: {alert.assignedTo || 'الإدارة'}</span>
                    {alert.dueDate && <span className="font-mono">الاستحقاق: {alert.dueDate}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <button
              onClick={() => onNavigate('reports')}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Layers className="w-4 h-4 text-amber-400" />
              <span>فتح مركز التقارير والتحليلات الشاملة</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
