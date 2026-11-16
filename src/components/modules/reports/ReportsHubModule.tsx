/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Comprehensive Reports Hub (22+ Interactive Financial & Operational Reports)
 */

import React, { useState, useMemo } from 'react';
import {
  FileBarChart,
  Calendar,
  Download,
  Printer,
  MessageCircle,
  TrendingUp,
  ShoppingCart,
  ArrowDownLeft,
  ArrowUpRight,
  Receipt,
  Coins,
  Users,
  Building,
  Clock,
  Wallet,
  Landmark,
  Package,
  ArrowRightLeft,
  ClipboardCheck,
  Scale,
  FileSpreadsheet,
  MapPin,
  BookOpen,
  ExternalLink,
  RotateCcw,
  FileText,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { TableColumnPref } from '../../../types/erp';
import { PrintableDocumentData } from '../../common/PrintModal';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { SearchableSelect, SearchableSelectOption } from '../../common/SearchableSelect';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import {
  exportToExcel,
  exportToCSV,
  downloadReportAsPDF,
  printReportPreview,
} from '../../../services/exportService';
import {
  generateTrialBalance,
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  calculateAccountLedger,
} from '../../../services/accountingEngine';
import {
  convertFromBase,
  convertToBase,
  getCurrencySymbol,
  getEffectiveCurrencyRate,
  getEffectiveSarRate,
  hasSaudiHint,
} from '../../../services/currencyHelpers';

export type ReportType =
  | 'sales_summary'
  | 'purchases_summary'
  | 'receipt_vouchers'
  | 'payment_vouchers'
  | 'expenses_by_center'
  | 'other_revenues'
  | 'customer_balances'
  | 'vendor_balances'
  | 'receivables_aging'
  | 'payables_aging'
  | 'cash_boxes'
  | 'banks_wallets'
  | 'inventory_valuation'
  | 'stock_movements'
  | 'warehouse_transfers_docs'
  | 'stocktaking_variances'
  | 'income_statement'
  | 'balance_sheet'
  | 'cash_flow'
  | 'general_ledger'
  | 'trial_balance'
  | 'regional_performance';

interface ReportDefinition {
  id: ReportType;
  group: 'تجاري ومالي' | 'ذمم وخزينة' | 'مخزون وجرد' | 'قوائم ختامية';
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

const REPORT_CATALOG: ReportDefinition[] = [
  { id: 'sales_summary', group: 'تجاري ومالي', title: 'ملخص المبيعات التفصيلي', subtitle: 'فواتير ومردودات المبيعات', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'purchases_summary', group: 'تجاري ومالي', title: 'ملخص المشتريات والتوريدات', subtitle: 'فواتير الشراء والمرتجعات', icon: <ShoppingCart className="w-4 h-4" /> },
  { id: 'receipt_vouchers', group: 'تجاري ومالي', title: 'كشف سندات القبض والتحصيل', subtitle: 'المتحصلات النقدية والبنكية', icon: <ArrowDownLeft className="w-4 h-4" /> },
  { id: 'payment_vouchers', group: 'تجاري ومالي', title: 'كشف سندات الصرف والمدفوعات', subtitle: 'المبالغ المنصرفة للغير', icon: <ArrowUpRight className="w-4 h-4" /> },
  { id: 'expenses_by_center', group: 'تجاري ومالي', title: 'المصروفات حسب الفئة والمركز', subtitle: 'تحليل النفقات التشغيلية', icon: <Receipt className="w-4 h-4" /> },
  { id: 'other_revenues', group: 'تجاري ومالي', title: 'الإيرادات التشغيلية والأخرى', subtitle: 'تفاصيل حسابات الإيرادات', icon: <Coins className="w-4 h-4" /> },

  { id: 'customer_balances', group: 'ذمم وخزينة', title: 'ملخص وحركة العملاء', subtitle: 'أرصدة وحدود العملاء', icon: <Users className="w-4 h-4" /> },
  { id: 'vendor_balances', group: 'ذمم وخزينة', title: 'ملخص وحركة الموردين', subtitle: 'التزامات ومشتريات الموردين', icon: <Building className="w-4 h-4" /> },
  { id: 'receivables_aging', group: 'ذمم وخزينة', title: 'أعمار ديون العملاء', subtitle: 'تحليل فترات الاستحقاق', icon: <Clock className="w-4 h-4" /> },
  { id: 'payables_aging', group: 'ذمم وخزينة', title: 'أعمار التزامات الموردين', subtitle: 'تحليل الدائنين حسب العمر', icon: <Clock className="w-4 h-4" /> },
  { id: 'cash_boxes', group: 'ذمم وخزينة', title: 'ملخص الصناديق النقدية', subtitle: 'أرصدة وحركة الخزائن', icon: <Wallet className="w-4 h-4" /> },
  { id: 'banks_wallets', group: 'ذمم وخزينة', title: 'ملخص البنوك والمحافظ', subtitle: 'الحسابات المصرفية والإلكترونية', icon: <Landmark className="w-4 h-4" /> },

  { id: 'inventory_valuation', group: 'مخزون وجرد', title: 'تقييم وجرد المخزون الحالي', subtitle: 'الكميات والتكلفة حسب المستودع', icon: <Package className="w-4 h-4" /> },
  { id: 'stock_movements', group: 'مخزون وجرد', title: 'حركة الأصناف التفصيلية', subtitle: 'كارت الصنف والوارد والمنصرف', icon: <FileText className="w-4 h-4" /> },
  { id: 'warehouse_transfers_docs', group: 'مخزون وجرد', title: 'التحويلات والمستندات المخزنية', subtitle: 'مناقلات وأذون المستودعات', icon: <ArrowRightLeft className="w-4 h-4" /> },
  { id: 'stocktaking_variances', group: 'مخزون وجرد', title: 'محاضر وفروقات الجرد الفعلي', subtitle: 'الزيادات والعجز وقيمها', icon: <ClipboardCheck className="w-4 h-4" /> },

  { id: 'income_statement', group: 'قوائم ختامية', title: 'قائمة الدخل والأرباح والخسائر', subtitle: 'الإيرادات والتكاليف وصافي الربح', icon: <FileBarChart className="w-4 h-4" /> },
  { id: 'balance_sheet', group: 'قوائم ختامية', title: 'الميزانية العمومية', subtitle: 'الأصول والخصوم وحقوق الملكية', icon: <Scale className="w-4 h-4" /> },
  { id: 'cash_flow', group: 'قوائم ختامية', title: 'قائمة التدفقات النقدية', subtitle: 'التدفقات الداخلة والخارجة', icon: <Coins className="w-4 h-4" /> },
  { id: 'general_ledger', group: 'قوائم ختامية', title: 'دفتر الأستاذ العام لحساب', subtitle: 'كشف حركة تفصيلي لأي حساب', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'trial_balance', group: 'قوائم ختامية', title: 'ميزان المراجعة التفصيلي', subtitle: 'الأرصدة الافتتاحية والحركة والختامي', icon: <FileSpreadsheet className="w-4 h-4" /> },
  { id: 'regional_performance', group: 'قوائم ختامية', title: 'تحليل الأداء الإقليمي والمناطق', subtitle: 'توزيع المبيعات والذمم جغرافياً', icon: <MapPin className="w-4 h-4" /> },
];

const REPORT_EN_TITLES: Record<ReportType, { title: string; subtitle: string; group: string }> = {
  sales_summary: { group: 'Commercial & Financial', title: 'Detailed Sales Summary', subtitle: 'Sales & return invoices' },
  purchases_summary: { group: 'Commercial & Financial', title: 'Purchases & Supply Summary', subtitle: 'Purchase bills & returns' },
  receipt_vouchers: { group: 'Commercial & Financial', title: 'Receipt Vouchers Statement', subtitle: 'Cash & bank collections' },
  payment_vouchers: { group: 'Commercial & Financial', title: 'Payment Vouchers Statement', subtitle: 'Disbursements to parties' },
  expenses_by_center: { group: 'Commercial & Financial', title: 'Expenses by Category & Center', subtitle: 'Operating expense analysis' },
  other_revenues: { group: 'Commercial & Financial', title: 'Operating & Other Revenues', subtitle: 'Revenue account details' },
  customer_balances: { group: 'Receivables & Treasury', title: 'Customer Balances & Activity', subtitle: 'Balances & credit limits' },
  vendor_balances: { group: 'Receivables & Treasury', title: 'Vendor Balances & Activity', subtitle: 'Payables & purchases' },
  receivables_aging: { group: 'Receivables & Treasury', title: 'Customer Receivables Aging', subtitle: 'Overdue aging buckets' },
  payables_aging: { group: 'Receivables & Treasury', title: 'Vendor Payables Aging', subtitle: 'Payables age analysis' },
  cash_boxes: { group: 'Receivables & Treasury', title: 'Cash Treasuries Summary', subtitle: 'Cash boxes & movement' },
  banks_wallets: { group: 'Receivables & Treasury', title: 'Banks & Wallets Summary', subtitle: 'Bank & e-wallet accounts' },
  inventory_valuation: { group: 'Inventory & Stocktaking', title: 'Current Inventory Valuation', subtitle: 'Qty & cost by warehouse' },
  stock_movements: { group: 'Inventory & Stocktaking', title: 'Detailed Item Stock Card', subtitle: 'Inflow & outflow movements' },
  warehouse_transfers_docs: { group: 'Inventory & Stocktaking', title: 'Warehouse Transfers & Docs', subtitle: 'Stock transfers & vouchers' },
  stocktaking_variances: { group: 'Inventory & Stocktaking', title: 'Physical Stocktaking Variances', subtitle: 'Surplus & shortage values' },
  income_statement: { group: 'Financial Statements', title: 'Income Statement (P&L)', subtitle: 'Revenue, COGS & net profit' },
  balance_sheet: { group: 'Financial Statements', title: 'Balance Sheet', subtitle: 'Assets, liabilities & equity' },
  cash_flow: { group: 'Financial Statements', title: 'Cash Flow Statement', subtitle: 'Operating, investing & financing' },
  general_ledger: { group: 'Financial Statements', title: 'Account General Ledger', subtitle: 'Detailed account movement' },
  trial_balance: { group: 'Financial Statements', title: 'Detailed Trial Balance', subtitle: 'Opening, period & closing' },
  regional_performance: { group: 'Financial Statements', title: 'Regional & Area Performance', subtitle: 'Sales & debt by geography' },
};

const GROUP_MAP_EN: Record<string, string> = {
  'الكل': 'All',
  'تجاري ومالي': 'Commercial & Financial',
  'ذمم وخزينة': 'Receivables & Treasury',
  'مخزون وجرد': 'Inventory & Stocktaking',
  'قوائم ختامية': 'Financial Statements',
};

interface ReportsHubModuleProps {
  db: ERPDatabase;
  currencySymbol: string;
  lang?: 'ar' | 'en';
  onOpenPrintModal?: (doc: PrintableDocumentData) => void;
  savedColumnPrefs?: Record<string, TableColumnPref[]>;
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNavigateToRecord?: (module: string, recordId?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface ReportRow {
  id: string;
  drillModule?: string;
  drillId?: string;
  [key: string]: any;
}

export const ReportsHubModule: React.FC<ReportsHubModuleProps> = ({
  db,
  currencySymbol,
  lang = 'ar',
  savedColumnPrefs,
  onSaveColumnPrefs,
  onNavigateToRecord,
  onNotify,
}) => {
  const isEn = lang === 'en';
  const [selectedReport, setSelectedReport] = useState<ReportType>('sales_summary');
  const [activeGroup, setActiveGroup] = useState<string>('الكل');
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [sourceCurrencyFilter, setSourceCurrencyFilter] = useState<string>('ALL');
  const [displayCurrency, setDisplayCurrency] = useState<string>('YER');
  const [ledgerAccountId, setLedgerAccountId] = useState<string>(
    () => db.chartOfAccounts.find((a) => a.isLeaf)?.id || ''
  );
  const [waModalOpen, setWaModalOpen] = useState(false);

  const dispSymbol = displayCurrency === 'YER' ? currencySymbol : getCurrencySymbol(db.currencies, displayCurrency);
  const convDisp = (baseAmt: number) => convertFromBase(baseAmt, displayCurrency, db.currencies);

  const accountSelectOptions = useMemo<SearchableSelectOption[]>(
    () =>
      db.chartOfAccounts
        .filter((a) => a.isLeaf)
        .map((a) => ({
          id: a.id,
          code: a.code,
          name: `${a.code} - ${a.nameAr}`,
          sublabel: `${a.category.replace(/_/g, ' ')} · ${a.currency || 'YER'}`,
        })),
    [db.chartOfAccounts]
  );

  const partySelectOptions = useMemo<SearchableSelectOption[]>(
    () => [
      ...db.customers.map((c) => ({
        id: c.id,
        code: c.code,
        phone: c.phone,
        name: c.nameAr,
        sublabel: `${isEn ? 'Customer' : 'عميل'} · ${c.currency || 'YER'}`,
      })),
      ...db.vendors.map((v) => ({
        id: v.id,
        code: v.code,
        phone: v.phone,
        name: v.nameAr,
        sublabel: `${isEn ? 'Vendor' : 'مورد'} · ${v.currency || 'YER'}`,
      })),
    ],
    [db.customers, db.vendors, isEn]
  );

  const inDateRange = (dateStr?: string) => {
    if (!dateStr) return true;
    const d = dateStr.slice(0, 10);
    if (startDate && d < startDate) return false;
    if (endDate && d > endDate) return false;
    return true;
  };

  const resetFilters = () => {
    setStartDate('2026-01-01');
    setEndDate(new Date().toISOString().split('T')[0]);
    setWarehouseFilter('all');
    setEntityFilter('all');
    setSourceCurrencyFilter('ALL');
    setDisplayCurrency('YER');
  };

  const currentReportDef = useMemo(
    () => REPORT_CATALOG.find((r) => r.id === selectedReport) || REPORT_CATALOG[0],
    [selectedReport]
  );

  // Build rows + columns + KPIs dynamically for all 22 reports
  const activeDataset = useMemo<{
    columns: ErpTableColumn<ReportRow>[];
    rows: ReportRow[];
    kpis: { label: string; value: string; subValue?: string; tone?: 'emerald' | 'rose' | 'amber' | 'cyan' }[];
    exportHeaders: string[];
    exportRows: (string | number)[][];
  }>(() => {
    const refEndDate = endDate || new Date().toISOString().split('T')[0];
    const daysBetween = (d1: string, d2: string) => {
      const t1 = new Date(d1.slice(0, 10)).getTime();
      const t2 = new Date(d2.slice(0, 10)).getTime();
      if (Number.isNaN(t1) || Number.isNaN(t2)) return 0;
      return Math.max(0, Math.floor((t2 - t1) / 86400000));
    };

    switch (selectedReport) {
      case 'sales_summary': {
        const list = db.invoices
          .filter(
            (i) =>
              (i.type === 'مبيعات' || i.type === 'مرتجع_مبيعات') &&
              i.status !== 'cancelled' &&
              inDateRange(i.date) &&
              (warehouseFilter === 'all' || i.warehouseId === warehouseFilter) &&
              (entityFilter === 'all' || i.entityId === entityFilter) &&
              (sourceCurrencyFilter === 'ALL' || (i.currency || 'YER') === sourceCurrencyFilter)
          )
          .map((i) => {
            const sign = i.type === 'مرتجع_مبيعات' ? -1 : 1;
            const curr = i.currency || 'YER';
            const sym = getCurrencySymbol(db.currencies, curr);
            const rate = getEffectiveCurrencyRate(db.currencies, curr, i.exchangeRate);
            return {
              id: i.id,
              drillModule: 'sales',
              drillId: i.id,
              invoiceNumber: i.invoiceNumber,
              type: i.type === 'مرتجع_مبيعات' ? 'مرتجع مبيعات' : 'فاتورة مبيعات',
              date: i.date,
              entityName: i.entityName,
              warehouseName: db.warehouses.find((w) => w.id === i.warehouseId)?.nameAr || '-',
              paymentType: i.paymentType,
              currency: curr,
              sym,
              rate,
              nativeTotal: Math.round(i.grandTotal * sign * 100) / 100,
              nativePaid: Math.round((i.paidAmount || 0) * sign * 100) / 100,
              nativeRemaining: Math.round((i.remainingAmount || 0) * sign * 100) / 100,
              totalBase: convDisp(Math.round(i.grandTotal * rate * sign * 100) / 100),
              paidBase: convDisp(Math.round((i.paidAmount || 0) * rate * sign * 100) / 100),
              remainingBase: convDisp(Math.round((i.remainingAmount || 0) * rate * sign * 100) / 100),
            };
          });
        const totalNet = list.reduce((s, r) => s + r.totalBase, 0);
        const totalPaid = list.reduce((s, r) => s + r.paidBase, 0);
        const totalRem = list.reduce((s, r) => s + r.remainingBase, 0);
        const sarRows = list.filter((r) => r.currency === 'SAR');
        const allSar = list.length > 0 && sarRows.length === list.length;
        const sarNet = Math.round(sarRows.reduce((s, r) => s + r.nativeTotal, 0) * 100) / 100;
        const sarPaid = Math.round(sarRows.reduce((s, r) => s + r.nativePaid, 0) * 100) / 100;
        const sarRem = Math.round(sarRows.reduce((s, r) => s + r.nativeRemaining, 0) * 100) / 100;

        return {
          rows: list,
          kpis: allSar && displayCurrency !== 'SAR'
            ? [
                { label: isEn ? 'Invoice Count (SAR)' : `عدد الفواتير (${sarRows.length} سعودي)`, value: String(list.length), tone: 'amber' },
                {
                  label: isEn ? 'Net Sales (SAR)' : 'صافي المبيعات (ر.س)',
                  value: `${sarNet.toLocaleString()} ر.س`,
                  subValue: `${isEn ? 'Eq:' : 'المعادل:'} ${totalNet.toLocaleString()} ${dispSymbol}`,
                  tone: 'emerald',
                },
                {
                  label: isEn ? 'Collected (SAR)' : 'المحصل فعلياً (ر.س)',
                  value: `${sarPaid.toLocaleString()} ر.س`,
                  subValue: `${isEn ? 'Eq:' : 'المعادل:'} ${totalPaid.toLocaleString()} ${dispSymbol}`,
                  tone: 'cyan',
                },
                {
                  label: isEn ? 'Remaining (SAR)' : 'الذمم المتبقية (ر.س)',
                  value: `${sarRem.toLocaleString()} ر.س`,
                  subValue: `${isEn ? 'Eq:' : 'المعادل:'} ${totalRem.toLocaleString()} ${dispSymbol}`,
                  tone: 'rose',
                },
              ]
            : [
                {
                  label: isEn ? 'Invoice Count' : 'عدد الفواتير',
                  value: String(list.length),
                  subValue: sarRows.length > 0 ? (isEn ? `${sarRows.length} SAR` : `منها ${sarRows.length} فاتورة سعودي`) : undefined,
                  tone: 'amber',
                },
                {
                  label: `${isEn ? 'Net Sales' : 'صافي المبيعات'} (${dispSymbol})`,
                  value: `${totalNet.toLocaleString()} ${dispSymbol}`,
                  subValue: sarRows.length > 0 && displayCurrency !== 'SAR' ? `فواتير السعودي: ${sarNet.toLocaleString()} ر.س` : undefined,
                  tone: 'emerald',
                },
                {
                  label: `${isEn ? 'Collected' : 'المحصل فعلياً'} (${dispSymbol})`,
                  value: `${totalPaid.toLocaleString()} ${dispSymbol}`,
                  subValue: sarRows.length > 0 && displayCurrency !== 'SAR' ? `تحصيل السعودي: ${sarPaid.toLocaleString()} ر.س` : undefined,
                  tone: 'cyan',
                },
                {
                  label: `${isEn ? 'Remaining Receivables' : 'الذمم المتبقية'} (${dispSymbol})`,
                  value: `${totalRem.toLocaleString()} ${dispSymbol}`,
                  subValue: sarRows.length > 0 && displayCurrency !== 'SAR' ? `ذمم السعودي: ${sarRem.toLocaleString()} ر.س` : undefined,
                  tone: 'rose',
                },
              ],
          columns: [
            { key: 'invoiceNumber', label: isEn ? 'Doc #' : 'رقم المستند', sortValue: (r) => r.invoiceNumber, render: (r) => <span className="font-mono font-bold text-amber-400">{r.invoiceNumber}</span> },
            { key: 'type', label: isEn ? 'Type' : 'النوع', render: (r) => <span className={r.type.includes('مرتجع') ? 'text-rose-400 font-bold' : 'text-slate-200'}>{r.type}</span> },
            { key: 'date', label: isEn ? 'Date' : 'التاريخ', sortValue: (r) => r.date, render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'entityName', label: isEn ? 'Customer' : 'العميل', render: (r) => <span className="font-semibold text-white">{r.entityName}</span> },
            { key: 'warehouseName', label: isEn ? 'Warehouse' : 'المستودع', render: (r) => r.warehouseName },
            { key: 'paymentType', label: isEn ? 'Payment' : 'السداد', align: 'center', render: (r) => r.paymentType },
            {
              key: 'currency',
              label: isEn ? 'Curr' : 'العملة',
              align: 'center',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-black font-mono ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>
                  {r.currency}
                </span>
              ),
            },
            {
              key: 'totalBase',
              label: isEn ? `Total (${dispSymbol} / Orig)` : `الإجمالي (بالعملة والمعادل)`,
              align: 'left',
              sortValue: (r) => r.totalBase,
              render: (r) =>
                r.currency !== displayCurrency ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="font-black text-emerald-300">
                      <bdi dir="auto">{r.nativeTotal.toLocaleString()} {r.sym}</bdi>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      <bdi dir="auto">{r.totalBase.toLocaleString()} {dispSymbol} (×{r.rate})</bdi>
                    </div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-white tabular-nums">
                    <bdi dir="auto">{r.nativeTotal.toLocaleString()} {r.sym}</bdi>
                  </span>
                ),
              footerRender: () =>
                sarRows.length > 0 && displayCurrency !== 'SAR' ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="text-emerald-300 font-black">
                      <bdi dir="auto">فواتير سعودي: {sarNet.toLocaleString()} ر.س</bdi>
                    </div>
                    <div className="text-[11px] text-amber-300">
                      <bdi dir="auto">الإجمالي المعادل: {totalNet.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <bdi dir="auto">{`${totalNet.toLocaleString()} ${dispSymbol}`}</bdi>
                ),
            },
            {
              key: 'remainingBase',
              label: isEn ? 'Remaining' : 'المتبقي',
              align: 'left',
              sortValue: (r) => r.remainingBase,
              render: (r) =>
                r.currency !== displayCurrency ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className={`font-black ${r.nativeRemaining > 0 ? 'text-rose-300' : 'text-emerald-400'}`}>
                      <bdi dir="auto">{r.nativeRemaining.toLocaleString()} {r.sym}</bdi>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      <bdi dir="auto">{r.remainingBase.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-rose-400 tabular-nums">
                    <bdi dir="auto">{r.nativeRemaining.toLocaleString()} {r.sym}</bdi>
                  </span>
                ),
              footerRender: () =>
                sarRows.length > 0 && displayCurrency !== 'SAR' ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="text-emerald-300 font-black">
                      <bdi dir="auto">متبقي سعودي: {sarRem.toLocaleString()} ر.س</bdi>
                    </div>
                    <div className="text-[11px] text-amber-300">
                      <bdi dir="auto">الإجمالي المعادل: {totalRem.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <bdi dir="auto">{`${totalRem.toLocaleString()} ${dispSymbol}`}</bdi>
                ),
            },
          ],
          exportHeaders: ['رقم الفاتورة', 'النوع', 'التاريخ', 'العميل', 'المستودع', 'العملة', 'الإجمالي بالعملة', 'المتبقي بالعملة', `الإجمالي (${displayCurrency})`, `المتبقي (${displayCurrency})`],
          exportRows: list.map((r) => [r.invoiceNumber, r.type, r.date, r.entityName, r.warehouseName, r.currency, r.nativeTotal, r.nativeRemaining, r.totalBase, r.remainingBase]),
        };
      }

      case 'purchases_summary': {
        const list = db.invoices
          .filter(
            (i) =>
              (i.type === 'مشتريات' || i.type === 'مرتجع_مشتريات') &&
              i.status !== 'cancelled' &&
              inDateRange(i.date) &&
              (warehouseFilter === 'all' || i.warehouseId === warehouseFilter) &&
              (entityFilter === 'all' || i.entityId === entityFilter) &&
              (sourceCurrencyFilter === 'ALL' || (i.currency || 'YER') === sourceCurrencyFilter)
          )
          .map((i) => {
            const sign = i.type === 'مرتجع_مشتريات' ? -1 : 1;
            const curr = i.currency || 'YER';
            const sym = getCurrencySymbol(db.currencies, curr);
            const rate = getEffectiveCurrencyRate(db.currencies, curr, i.exchangeRate);
            return {
              id: i.id,
              drillModule: 'purchases',
              drillId: i.id,
              invoiceNumber: i.invoiceNumber,
              type: i.type === 'مرتجع_مشتريات' ? 'مرتجع مشتريات' : 'فاتورة مشتريات',
              date: i.date,
              entityName: i.entityName,
              warehouseName: db.warehouses.find((w) => w.id === i.warehouseId)?.nameAr || '-',
              paymentType: i.paymentType,
              currency: curr,
              sym,
              rate,
              nativeTotal: Math.round(i.grandTotal * sign * 100) / 100,
              nativePaid: Math.round((i.paidAmount || 0) * sign * 100) / 100,
              nativeRemaining: Math.round((i.remainingAmount || 0) * sign * 100) / 100,
              totalBase: convDisp(Math.round(i.grandTotal * rate * sign * 100) / 100),
              paidBase: convDisp(Math.round((i.paidAmount || 0) * rate * sign * 100) / 100),
              remainingBase: convDisp(Math.round((i.remainingAmount || 0) * rate * sign * 100) / 100),
            };
          });
        const totalNet = list.reduce((s, r) => s + r.totalBase, 0);
        const totalRem = list.reduce((s, r) => s + r.remainingBase, 0);
        const sarRows = list.filter((r) => r.currency === 'SAR');
        const sarNet = Math.round(sarRows.reduce((s, r) => s + r.nativeTotal, 0) * 100) / 100;
        const sarRem = Math.round(sarRows.reduce((s, r) => s + r.nativeRemaining, 0) * 100) / 100;
        return {
          rows: list,
          kpis: [
            {
              label: isEn ? 'Purchase Bills' : 'عدد فواتير الشراء',
              value: String(list.length),
              subValue: sarRows.length > 0 ? (isEn ? `${sarRows.length} SAR` : `منها ${sarRows.length} فاتورة سعودي`) : undefined,
              tone: 'amber',
            },
            {
              label: `${isEn ? 'Net Purchases' : 'صافي المشتريات'} (${dispSymbol})`,
              value: `${totalNet.toLocaleString()} ${dispSymbol}`,
              subValue: sarRows.length > 0 && displayCurrency !== 'SAR' ? `فواتير السعودي: ${sarNet.toLocaleString()} ر.س` : undefined,
              tone: 'cyan',
            },
            {
              label: `${isEn ? 'Remaining Credit' : 'الآجل المتبقي'} (${dispSymbol})`,
              value: `${totalRem.toLocaleString()} ${dispSymbol}`,
              subValue: sarRows.length > 0 && displayCurrency !== 'SAR' ? `متبقي السعودي: ${sarRem.toLocaleString()} ر.س` : undefined,
              tone: 'rose',
            },
          ],
          columns: [
            { key: 'invoiceNumber', label: isEn ? 'Doc #' : 'رقم المستند', render: (r) => <span className="font-mono font-bold text-cyan-400">{r.invoiceNumber}</span> },
            { key: 'type', label: isEn ? 'Type' : 'النوع', render: (r) => r.type },
            { key: 'date', label: isEn ? 'Date' : 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'entityName', label: isEn ? 'Vendor' : 'المورد', render: (r) => <span className="font-semibold text-white">{r.entityName}</span> },
            { key: 'warehouseName', label: isEn ? 'Warehouse' : 'المستودع', render: (r) => r.warehouseName },
            { key: 'paymentType', label: isEn ? 'Payment' : 'السداد', align: 'center', render: (r) => r.paymentType },
            {
              key: 'currency',
              label: isEn ? 'Curr' : 'العملة',
              align: 'center',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-black font-mono ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>
                  {r.currency}
                </span>
              ),
            },
            {
              key: 'totalBase',
              label: isEn ? `Total (${dispSymbol} / Orig)` : `الإجمالي (بالعملة والمعادل)`,
              align: 'left',
              sortValue: (r) => r.totalBase,
              render: (r) =>
                r.currency !== displayCurrency ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="font-black text-emerald-300">
                      <bdi dir="auto">{r.nativeTotal.toLocaleString()} {r.sym}</bdi>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      <bdi dir="auto">{r.totalBase.toLocaleString()} {dispSymbol} (×{r.rate})</bdi>
                    </div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-white tabular-nums">
                    <bdi dir="auto">{r.nativeTotal.toLocaleString()} {r.sym}</bdi>
                  </span>
                ),
              footerRender: () =>
                sarRows.length > 0 && displayCurrency !== 'SAR' ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="text-emerald-300 font-black">
                      <bdi dir="auto">فواتير سعودي: {sarNet.toLocaleString()} ر.س</bdi>
                    </div>
                    <div className="text-[11px] text-amber-300">
                      <bdi dir="auto">الإجمالي المعادل: {totalNet.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <bdi dir="auto">{`${totalNet.toLocaleString()} ${dispSymbol}`}</bdi>
                ),
            },
            {
              key: 'remainingBase',
              label: isEn ? 'Remaining' : 'المتبقي',
              align: 'left',
              sortValue: (r) => r.remainingBase,
              render: (r) =>
                r.currency !== displayCurrency ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="font-black text-amber-300">
                      <bdi dir="auto">{r.nativeRemaining.toLocaleString()} {r.sym}</bdi>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      <bdi dir="auto">{r.remainingBase.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-amber-400 tabular-nums">
                    <bdi dir="auto">{r.nativeRemaining.toLocaleString()} {r.sym}</bdi>
                  </span>
                ),
              footerRender: () =>
                sarRows.length > 0 && displayCurrency !== 'SAR' ? (
                  <div className="leading-tight font-mono tabular-nums">
                    <div className="text-emerald-300 font-black">
                      <bdi dir="auto">متبقي سعودي: {sarRem.toLocaleString()} ر.س</bdi>
                    </div>
                    <div className="text-[11px] text-amber-300">
                      <bdi dir="auto">الإجمالي المعادل: {totalRem.toLocaleString()} {dispSymbol}</bdi>
                    </div>
                  </div>
                ) : (
                  <bdi dir="auto">{`${totalRem.toLocaleString()} ${dispSymbol}`}</bdi>
                ),
            },
          ],
          exportHeaders: ['رقم الفاتورة', 'النوع', 'التاريخ', 'المورد', 'المستودع', 'العملة', 'الإجمالي بالعملة', 'المتبقي بالعملة', `الإجمالي (${displayCurrency})`, `المتبقي (${displayCurrency})`],
          exportRows: list.map((r) => [r.invoiceNumber, r.type, r.date, r.entityName, r.warehouseName, r.currency, r.nativeTotal, r.nativeRemaining, r.totalBase, r.remainingBase]),
        };
      }

      case 'receipt_vouchers':
      case 'payment_vouchers': {
        const vType = selectedReport === 'receipt_vouchers' ? 'قبض' : 'صرف';
        const list = db.paymentVouchers
          .filter(
            (v) =>
              v.type === vType &&
              v.status !== 'cancelled' &&
              inDateRange(v.date) &&
              (entityFilter === 'all' || v.entityId === entityFilter) &&
              (sourceCurrencyFilter === 'ALL' || (v.currency || 'YER') === sourceCurrencyFilter)
          )
          .map((v) => ({
            id: v.id,
            drillModule: 'treasury',
            drillId: v.id,
            voucherNumber: v.voucherNumber,
            date: v.date,
            entityName: v.entityName,
            entityType: v.entityType,
            treasury: v.treasuryAccountName,
            method: v.paymentMethod,
            statement: v.statement,
            amount: v.amount,
            currency: v.currency,
            baseAmount: convDisp(v.baseAmount || convertToBase(v.amount, v.currency, db.currencies, v.exchangeRate)),
          }));
        const sumBase = list.reduce((s, r) => s + r.baseAmount, 0);
        return {
          rows: list,
          kpis: [
            { label: `عدد السندات (${vType})`, value: String(list.length), tone: 'amber' },
            { label: `الإجمالي المعادل (${dispSymbol})`, value: sumBase.toLocaleString(), tone: vType === 'قبض' ? 'emerald' : 'rose' },
          ],
          columns: [
            { key: 'voucherNumber', label: 'رقم السند', render: (r) => <span className="font-mono font-bold text-amber-400">{r.voucherNumber}</span> },
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'entityName', label: 'الطرف', render: (r) => <span className="font-semibold text-white">{r.entityName}</span> },
            { key: 'treasury', label: 'الصندوق / البنك', render: (r) => r.treasury },
            { key: 'currency', label: 'العملة', align: 'center', render: (r) => <span className="font-mono text-amber-300">{r.amount.toLocaleString()} {r.currency}</span> },
            { key: 'statement', label: 'البيان', render: (r) => <span className="text-slate-300">{r.statement}</span> },
            { key: 'baseAmount', label: `المبلغ (${dispSymbol})`, align: 'left', sortValue: (r) => r.baseAmount, render: (r) => <span className={`font-mono font-bold tabular-nums ${vType === 'قبض' ? 'text-emerald-400' : 'text-rose-400'}`}>{r.baseAmount.toLocaleString()}</span>, footerRender: () => sumBase.toLocaleString() },
          ],
          exportHeaders: ['رقم السند', 'التاريخ', 'الطرف', 'الخزينة', 'الطريقة', 'البيان', 'المبلغ بالعملة', 'العملة', `المعادل (${displayCurrency})`],
          exportRows: list.map((r) => [r.voucherNumber, r.date, r.entityName, r.treasury, r.method, r.statement, r.amount, r.currency, r.baseAmount]),
        };
      }

      case 'expenses_by_center': {
        const list = db.expenseRecords
          .filter((e) => inDateRange(e.date) && (sourceCurrencyFilter === 'ALL' || (e.currency || 'YER') === sourceCurrencyFilter))
          .map((e) => {
            const baseVal = convertToBase(e.total || e.amount || 0, e.currency, db.currencies);
            return {
              id: e.id,
              drillModule: 'expenses',
              drillId: e.id,
              expenseNumber: e.expenseNumber,
              date: e.date,
              categoryName: e.categoryName,
              costCenter: e.costCenterName || 'المركز الرئيسي',
              beneficiary: e.beneficiary,
              statement: e.statement,
              currency: e.currency || 'YER',
              nativeTotal: e.total || e.amount || 0,
              total: convDisp(baseVal),
            };
          });
        const sumTotal = list.reduce((s, r) => s + r.total, 0);
        return {
          rows: list,
          kpis: [
            { label: isEn ? 'Expense Vouchers' : 'عدد سندات المصروف', value: String(list.length), tone: 'amber' },
            { label: `${isEn ? 'Total Expenses' : 'إجمالي المصروفات'} (${dispSymbol})`, value: sumTotal.toLocaleString(), tone: 'rose' },
          ],
          columns: [
            { key: 'expenseNumber', label: isEn ? 'Number' : 'الرقم', render: (r) => <span className="font-mono font-bold text-rose-400">{r.expenseNumber}</span> },
            { key: 'date', label: isEn ? 'Date' : 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'categoryName', label: isEn ? 'Category' : 'بند المصروف', render: (r) => <span className="font-semibold text-white">{r.categoryName}</span> },
            { key: 'costCenter', label: isEn ? 'Cost Center' : 'مركز التكلفة', render: (r) => r.costCenter },
            { key: 'beneficiary', label: isEn ? 'Beneficiary' : 'المستفيد', render: (r) => r.beneficiary },
            { key: 'currency', label: isEn ? 'Original' : 'بالعملة', render: (r) => <span className="font-mono text-amber-300">{r.nativeTotal.toLocaleString()} {r.currency}</span> },
            { key: 'total', label: `${isEn ? 'Converted' : 'الإجمالي'} (${dispSymbol})`, align: 'left', sortValue: (r) => r.total, render: (r) => <span className="font-mono font-bold text-rose-400 tabular-nums">{r.total.toLocaleString()}</span>, footerRender: () => sumTotal.toLocaleString() },
          ],
          exportHeaders: ['رقم المصروف', 'التاريخ', 'الفئة', 'مركز التكلفة', 'المستفيد', 'العملة', 'المبلغ الأصلي', `الإجمالي (${displayCurrency})`],
          exportRows: list.map((r) => [r.expenseNumber, r.date, r.categoryName, r.costCenter, r.beneficiary, r.currency, r.nativeTotal, r.total]),
        };
      }

      case 'other_revenues': {
        const revAccounts = db.chartOfAccounts.filter((a) => a.category === 'إيرادات' && a.isLeaf);
        const list: ReportRow[] = [];
        db.journalEntries
          .filter((je) => je.status === 'posted' && inDateRange(je.date))
          .forEach((je) => {
            je.lines.forEach((ln, idx) => {
              if (revAccounts.some((ra) => ra.id === ln.accountId) || ln.accountCode.startsWith('4')) {
                const lineRate = getEffectiveCurrencyRate(db.currencies, ln.currency, ln.exchangeRate);
                const net = (ln.credit - ln.debit) * lineRate;
                if (Math.abs(net) > 0) {
                  list.push({
                    id: `${je.id}-${idx}`,
                    drillModule: 'accounting',
                    drillId: je.id,
                    entryNumber: je.entryNumber,
                    date: je.date,
                    accountCode: ln.accountCode,
                    accountName: ln.accountName,
                    memo: ln.memo || je.description,
                    amount: convDisp(Math.round(net * 100) / 100),
                  });
                }
              }
            });
          });
        const sumRev = list.reduce((s, r) => s + r.amount, 0);
        return {
          rows: list,
          kpis: [
            { label: 'عدد حركات الإيرادات', value: String(list.length), tone: 'amber' },
            { label: `صافي الإيرادات المسجلة (${currencySymbol})`, value: sumRev.toLocaleString(), tone: 'emerald' },
          ],
          columns: [
            { key: 'entryNumber', label: 'رقم القيد', render: (r) => <span className="font-mono text-amber-400">{r.entryNumber}</span> },
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'accountCode', label: 'رمز الحساب', render: (r) => <span className="font-mono">{r.accountCode}</span> },
            { key: 'accountName', label: 'حساب الإيراد', render: (r) => <span className="font-semibold text-white">{r.accountName}</span> },
            { key: 'memo', label: 'البيان', render: (r) => r.memo },
            { key: 'amount', label: `صافي الإيراد (${currencySymbol})`, align: 'left', sortValue: (r) => r.amount, render: (r) => <span className="font-mono font-bold text-emerald-400">{r.amount.toLocaleString()}</span>, footerRender: () => sumRev.toLocaleString() },
          ],
          exportHeaders: ['رقم القيد', 'التاريخ', 'رمز الحساب', 'اسم الحساب', 'البيان', 'الصافي'],
          exportRows: list.map((r) => [r.entryNumber, r.date, r.accountCode, r.accountName, r.memo, r.amount]),
        };
      }

      case 'customer_balances': {
        const sarRate = getEffectiveSarRate(db.currencies);
        const list = db.customers
          .filter((c) => entityFilter === 'all' || c.id === entityFilter)
          .map((c) => {
            const area = db.regionalAreas.find((a) => a.id === c.regionalAreaId);
            const curr = c.currency || 'YER';
            const rate = getEffectiveCurrencyRate(db.currencies, curr);
            const nativeBalance = curr !== 'YER' ? Math.round((c.currentBalance / rate) * 100) / 100 : c.currentBalance;
            return {
              id: c.id,
              drillModule: 'customers',
              drillId: c.id,
              code: c.code,
              nameAr: c.nameAr,
              phone: c.phone,
              region: area ? `${area.governorate} - ${area.area}` : '-',
              category: c.category,
              currency: curr,
              rate,
              nativeBalance,
              creditLimit: c.creditLimit,
              currentBalance: c.currentBalance,
            };
          });
        const totalBal = list.reduce((s, r) => s + r.currentBalance, 0);
        const sarRows = list.filter((r) => r.currency === 'SAR');
        const totalSarYer = sarRows.reduce((s, r) => s + r.currentBalance, 0);
        const totalSarNative = Math.round((totalSarYer / sarRate) * 100) / 100;
        const totalAllSar = Math.round((totalBal / sarRate) * 100) / 100;
        return {
          rows: list,
          kpis: [
            { label: 'عدد العملاء', value: String(list.length), tone: 'amber' },
            { label: `العملاء السعوديون (${sarRows.length})`, value: `${totalSarNative.toLocaleString()} ر.س`, tone: 'emerald' },
            { label: `الإجمالي بالسعودي (×${sarRate})`, value: `${totalAllSar.toLocaleString()} ر.س`, tone: 'cyan' },
            { label: `إجمالي أرصدة العملاء (${currencySymbol})`, value: `${totalBal.toLocaleString()} ر.ي`, tone: 'rose' },
          ],
          columns: [
            { key: 'code', label: 'الكود', render: (r) => <span className="font-mono font-bold text-amber-400">{r.code}</span> },
            { key: 'nameAr', label: 'اسم العميل', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'phone', label: 'الهاتف', render: (r) => <span className="font-mono">{r.phone}</span> },
            { key: 'region', label: 'المنطقة', render: (r) => r.region },
            {
              key: 'currency',
              label: 'العملة',
              align: 'center',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>
                  {r.currency}
                </span>
              ),
            },
            {
              key: 'currentBalance',
              label: 'الرصيد (بالعملة والمعادل)',
              align: 'left',
              sortValue: (r) => r.currentBalance,
              render: (r) =>
                r.currency !== 'YER' ? (
                  <div className="leading-tight font-mono">
                    <div className="font-black text-emerald-300">
                      {r.nativeBalance.toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {r.currentBalance.toLocaleString()} ر.ي (×{r.rate})
                    </div>
                  </div>
                ) : (
                  <span className={`font-mono font-bold ${r.currentBalance > r.creditLimit ? 'text-rose-400' : 'text-amber-300'}`}>
                    {r.currentBalance.toLocaleString()} ر.ي
                  </span>
                ),
              footerRender: () => (
                <div className="leading-tight font-mono tabular-nums">
                  <div className="text-amber-300 font-black">
                    <bdi dir="auto">اليمني: {totalBal.toLocaleString()} ر.ي</bdi>
                  </div>
                  <div className="text-[11px] text-emerald-300">
                    <bdi dir="auto">السعودي (×{sarRate}): {totalAllSar.toLocaleString()} ر.س</bdi>
                  </div>
                </div>
              ),
            },
          ],
          exportHeaders: ['كود العميل', 'اسم العميل', 'الهاتف', 'المنطقة', 'العملة', 'الرصيد بالعملة', 'سعر التحويل', 'الرصيد المعادل (YER)'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.phone, r.region, r.currency, r.nativeBalance, r.rate, r.currentBalance]),
        };
      }

      case 'vendor_balances': {
        const sarRate = getEffectiveSarRate(db.currencies);
        const list = db.vendors
          .filter((v) => entityFilter === 'all' || v.id === entityFilter)
          .map((v) => {
            const curr = v.currency || 'YER';
            const rate = getEffectiveCurrencyRate(db.currencies, curr);
            const nativeBalance = curr !== 'YER' ? Math.round((v.currentBalance / rate) * 100) / 100 : v.currentBalance;
            return {
              id: v.id,
              drillModule: 'vendors',
              drillId: v.id,
              code: v.code,
              nameAr: v.nameAr,
              phone: v.phone,
              category: v.category,
              currency: curr,
              rate,
              nativeBalance,
              paymentTermDays: v.paymentTermDays,
              currentBalance: v.currentBalance,
            };
          });
        const totalBal = list.reduce((s, r) => s + r.currentBalance, 0);
        const sarRows = list.filter((r) => r.currency === 'SAR');
        const totalSarNative = Math.round((sarRows.reduce((s, r) => s + r.currentBalance, 0) / sarRate) * 100) / 100;
        const totalAllSar = Math.round((totalBal / sarRate) * 100) / 100;
        return {
          rows: list,
          kpis: [
            { label: 'عدد الموردين', value: String(list.length), tone: 'amber' },
            { label: `الموردون السعوديون (${sarRows.length})`, value: `${totalSarNative.toLocaleString()} ر.س`, tone: 'emerald' },
            { label: `الإجمالي بالسعودي (×${sarRate})`, value: `${totalAllSar.toLocaleString()} ر.س`, tone: 'cyan' },
            { label: `إجمالي مستحقات الموردين (${currencySymbol})`, value: `${totalBal.toLocaleString()} ر.ي`, tone: 'rose' },
          ],
          columns: [
            { key: 'code', label: 'الكود', render: (r) => <span className="font-mono font-bold text-cyan-400">{r.code}</span> },
            { key: 'nameAr', label: 'اسم المورد', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'phone', label: 'الهاتف', render: (r) => <span className="font-mono">{r.phone}</span> },
            { key: 'category', label: 'التصنيف', render: (r) => r.category },
            {
              key: 'currency',
              label: 'العملة',
              align: 'center',
              render: (r) => (
                <span className={`px-2 py-0.5 rounded text-[10px] font-black ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>
                  {r.currency}
                </span>
              ),
            },
            {
              key: 'currentBalance',
              label: 'الرصيد المستحق (بالعملة والمعادل)',
              align: 'left',
              sortValue: (r) => r.currentBalance,
              render: (r) =>
                r.currency !== 'YER' ? (
                  <div className="leading-tight font-mono">
                    <div className="font-black text-emerald-300">
                      {r.nativeBalance.toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {r.currentBalance.toLocaleString()} ر.ي (×{r.rate})
                    </div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-amber-400">{r.currentBalance.toLocaleString()} ر.ي</span>
                ),
              footerRender: () => (
                <div className="leading-tight font-mono tabular-nums">
                  <div className="text-amber-300 font-black">
                    <bdi dir="auto">اليمني: {totalBal.toLocaleString()} ر.ي</bdi>
                  </div>
                  <div className="text-[11px] text-emerald-300">
                    <bdi dir="auto">السعودي (×{sarRate}): {totalAllSar.toLocaleString()} ر.س</bdi>
                  </div>
                </div>
              ),
            },
          ],
          exportHeaders: ['كود المورد', 'اسم المورد', 'الهاتف', 'التصنيف', 'العملة', 'الرصيد بالعملة', 'سعر التحويل', 'الرصيد المعادل (YER)'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.phone, r.category, r.currency, r.nativeBalance, r.rate, r.currentBalance]),
        };
      }

      case 'receivables_aging': {
        const list = db.customers
          .filter((c) => c.currentBalance > 0 && (entityFilter === 'all' || c.id === entityFilter))
          .map((c) => {
            const unpaid = db.invoices.filter(
              (i) => i.entityId === c.id && i.type === 'مبيعات' && i.status !== 'cancelled' && i.remainingAmount > 0 && i.date <= refEndDate
            );
            let b0_30 = 0;
            let b31_60 = 0;
            let b61_90 = 0;
            let b90plus = 0;
            unpaid.forEach((inv) => {
              const rem = convertToBase(inv.remainingAmount || 0, inv.currency, db.currencies, inv.exchangeRate);
              const age = daysBetween(inv.dueDate || inv.date, refEndDate);
              if (age <= 30) b0_30 += rem;
              else if (age <= 60) b31_60 += rem;
              else if (age <= 90) b61_90 += rem;
              else b90plus += rem;
            });
            const allocated = b0_30 + b31_60 + b61_90 + b90plus;
            if (c.currentBalance > allocated) {
              b0_30 += c.currentBalance - allocated;
            }
            const curr = c.currency || 'YER';
            const rate = getEffectiveCurrencyRate(db.currencies, curr);
            const nativeTotal = curr !== 'YER' ? Math.round((c.currentBalance / rate) * 100) / 100 : c.currentBalance;
            return {
              id: c.id,
              drillModule: 'customers',
              drillId: c.id,
              code: c.code,
              nameAr: c.nameAr,
              currency: curr,
              nativeTotal,
              b0_30: Math.round(b0_30),
              b31_60: Math.round(b31_60),
              b61_90: Math.round(b61_90),
              b90plus: Math.round(b90plus),
              total: c.currentBalance,
            };
          });
        const totalAll = list.reduce((s, r) => s + r.total, 0);
        const totalOver90 = list.reduce((s, r) => s + r.b90plus, 0);
        return {
          rows: list,
          kpis: [
            { label: 'عملاء ذوو ذمم قائمة', value: String(list.length), tone: 'amber' },
            { label: `إجمالي الذمم (${currencySymbol})`, value: totalAll.toLocaleString(), tone: 'cyan' },
            { label: `ديون متأخرة (+90 يوم)`, value: totalOver90.toLocaleString(), tone: 'rose' },
          ],
          columns: [
            { key: 'code', label: 'الكود', render: (r) => <span className="font-mono text-amber-400">{r.code}</span> },
            { key: 'nameAr', label: 'العميل', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'currency', label: 'العملة', align: 'center', render: (r) => <span className={`px-2 py-0.5 rounded text-[10px] font-black font-mono ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>{r.currency}</span> },
            { key: 'b0_30', label: '0 - 30 يوم', align: 'left', render: (r) => <span className="font-mono">{r.b0_30.toLocaleString()}</span> },
            { key: 'b31_60', label: '31 - 60 يوم', align: 'left', render: (r) => <span className="font-mono text-amber-300">{r.b31_60.toLocaleString()}</span> },
            { key: 'b61_90', label: '61 - 90 يوم', align: 'left', render: (r) => <span className="font-mono text-orange-400">{r.b61_90.toLocaleString()}</span> },
            { key: 'b90plus', label: '+90 يوم', align: 'left', render: (r) => <span className="font-mono font-bold text-rose-400">{r.b90plus.toLocaleString()}</span>, footerRender: () => totalOver90.toLocaleString() },
            {
              key: 'total',
              label: 'الرصيد الكلي',
              align: 'left',
              sortValue: (r) => r.total,
              render: (r) =>
                r.currency !== 'YER' ? (
                  <div className="leading-tight font-mono">
                    <div className="font-black text-emerald-300">
                      {r.nativeTotal.toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                    </div>
                    <div className="text-[10px] text-slate-400">{r.total.toLocaleString()} ر.ي</div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-white">{r.total.toLocaleString()} ر.ي</span>
                ),
              footerRender: () => `${totalAll.toLocaleString()} ر.ي`,
            },
          ],
          exportHeaders: ['كود العميل', 'العميل', 'العملة', 'الرصيد بالعملة', '0-30 يوم', '31-60 يوم', '61-90 يوم', '+90 يوم', 'الإجمالي (YER)'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.currency, r.nativeTotal, r.b0_30, r.b31_60, r.b61_90, r.b90plus, r.total]),
        };
      }

      case 'payables_aging': {
        const list = db.vendors
          .filter((v) => v.currentBalance > 0 && (entityFilter === 'all' || v.id === entityFilter))
          .map((v) => {
            const unpaid = db.invoices.filter(
              (i) => i.entityId === v.id && i.type === 'مشتريات' && i.status !== 'cancelled' && i.remainingAmount > 0 && i.date <= refEndDate
            );
            let b0_30 = 0;
            let b31_60 = 0;
            let b61_90 = 0;
            let b90plus = 0;
            unpaid.forEach((inv) => {
              const rem = convertToBase(inv.remainingAmount || 0, inv.currency, db.currencies, inv.exchangeRate);
              const age = daysBetween(inv.dueDate || inv.date, refEndDate);
              if (age <= 30) b0_30 += rem;
              else if (age <= 60) b31_60 += rem;
              else if (age <= 90) b61_90 += rem;
              else b90plus += rem;
            });
            const allocated = b0_30 + b31_60 + b61_90 + b90plus;
            if (v.currentBalance > allocated) {
              b0_30 += v.currentBalance - allocated;
            }
            const curr = v.currency || 'YER';
            const rate = getEffectiveCurrencyRate(db.currencies, curr);
            const nativeTotal = curr !== 'YER' ? Math.round((v.currentBalance / rate) * 100) / 100 : v.currentBalance;
            return {
              id: v.id,
              drillModule: 'vendors',
              drillId: v.id,
              code: v.code,
              nameAr: v.nameAr,
              currency: curr,
              nativeTotal,
              b0_30: Math.round(b0_30),
              b31_60: Math.round(b31_60),
              b61_90: Math.round(b61_90),
              b90plus: Math.round(b90plus),
              total: v.currentBalance,
            };
          });
        const totalAll = list.reduce((s, r) => s + r.total, 0);
        return {
          rows: list,
          kpis: [
            { label: 'موردون ذوو مستحقات', value: String(list.length), tone: 'amber' },
            { label: `إجمالي الالتزامات (${currencySymbol})`, value: totalAll.toLocaleString(), tone: 'rose' },
          ],
          columns: [
            { key: 'code', label: 'الكود', render: (r) => <span className="font-mono text-cyan-400">{r.code}</span> },
            { key: 'nameAr', label: 'المورد', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'currency', label: 'العملة', align: 'center', render: (r) => <span className={`px-2 py-0.5 rounded text-[10px] font-black font-mono ${r.currency === 'SAR' ? 'bg-emerald-950 text-emerald-300 border border-emerald-600/50' : 'bg-slate-800 text-slate-300'}`}>{r.currency}</span> },
            { key: 'b0_30', label: '0 - 30 يوم', align: 'left', render: (r) => <span className="font-mono">{r.b0_30.toLocaleString()}</span> },
            { key: 'b31_60', label: '31 - 60 يوم', align: 'left', render: (r) => <span className="font-mono text-amber-300">{r.b31_60.toLocaleString()}</span> },
            { key: 'b61_90', label: '61 - 90 يوم', align: 'left', render: (r) => <span className="font-mono text-orange-400">{r.b61_90.toLocaleString()}</span> },
            { key: 'b90plus', label: '+90 يوم', align: 'left', render: (r) => <span className="font-mono font-bold text-rose-400">{r.b90plus.toLocaleString()}</span> },
            {
              key: 'total',
              label: 'الرصيد الكلي',
              align: 'left',
              render: (r) =>
                r.currency !== 'YER' ? (
                  <div className="leading-tight font-mono">
                    <div className="font-black text-emerald-300">
                      {r.nativeTotal.toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                    </div>
                    <div className="text-[10px] text-slate-400">{r.total.toLocaleString()} ر.ي</div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-white">{r.total.toLocaleString()} ر.ي</span>
                ),
              footerRender: () => `${totalAll.toLocaleString()} ر.ي`,
            },
          ],
          exportHeaders: ['كود المورد', 'المورد', 'العملة', 'الرصيد بالعملة', '0-30 يوم', '31-60 يوم', '61-90 يوم', '+90 يوم', 'الإجمالي (YER)'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.currency, r.nativeTotal, r.b0_30, r.b31_60, r.b61_90, r.b90plus, r.total]),
        };
      }

      case 'cash_boxes':
      case 'banks_wallets': {
        const isCash = selectedReport === 'cash_boxes';
        const list = db.treasuryAccounts
          .filter((t) => (isCash ? t.type === 'صندوق' : t.type === 'بنك' || t.type === 'محفظة'))
          .map((t) => {
            const rate = getEffectiveCurrencyRate(db.currencies, t.currency);
            return {
              id: t.id,
              drillModule: 'treasury',
              drillId: t.id,
              code: t.code,
              nameAr: t.nameAr,
              type: t.type,
              currency: t.currency,
              accountNumber: t.accountNumber || '-',
              balance: t.balance,
              baseEquivalent: Math.round(t.balance * rate * 100) / 100,
              status: t.status === 'active' ? 'نشط' : 'موقف',
            };
          });
        const sumEq = list.reduce((s, r) => s + r.baseEquivalent, 0);
        return {
          rows: list,
          kpis: [
            { label: isCash ? 'عدد الصناديق' : 'عدد البنوك والمحافظ', value: String(list.length), tone: 'amber' },
            { label: `إجمالي السيولة المعادلة (${currencySymbol})`, value: sumEq.toLocaleString(), tone: 'emerald' },
          ],
          columns: [
            { key: 'code', label: 'الرمز', render: (r) => <span className="font-mono text-amber-400">{r.code}</span> },
            { key: 'nameAr', label: 'اسم الحساب', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'type', label: 'النوع', render: (r) => r.type },
            { key: 'accountNumber', label: 'رقم الحساب', render: (r) => <span className="font-mono text-slate-400">{r.accountNumber}</span> },
            { key: 'currency', label: 'العملة', align: 'center', render: (r) => <span className="font-mono">{r.currency}</span> },
            { key: 'balance', label: 'الرصيد بالعملة', align: 'left', render: (r) => <span className="font-mono font-bold text-white">{r.balance.toLocaleString()}</span> },
            { key: 'baseEquivalent', label: `المعادل (${currencySymbol})`, align: 'left', render: (r) => <span className="font-mono font-bold text-emerald-400">{r.baseEquivalent.toLocaleString()}</span>, footerRender: () => sumEq.toLocaleString() },
          ],
          exportHeaders: ['الرمز', 'الاسم', 'النوع', 'رقم الحساب', 'العملة', 'الرصيد', 'المعادل الأساسي'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.type, r.accountNumber, r.currency, r.balance, r.baseEquivalent]),
        };
      }

      case 'inventory_valuation': {
        const list = db.inventoryItems.map((it) => {
          const matchingStocks = db.warehouseStock.filter(
            (ws) => ws.itemId === it.id && (warehouseFilter === 'all' || ws.warehouseId === warehouseFilter)
          );
          const qty = matchingStocks.reduce((s, ws) => s + ws.quantityOnHand, 0);
          const valuation = Math.round(
            matchingStocks.reduce(
              (s, ws) => s + ws.quantityOnHand * (ws.averageCost > 0 ? ws.averageCost : it.purchasePrice),
              0
            ) * 100
          ) / 100;
          const unitCost = qty > 0 ? Math.round((valuation / qty) * 100) / 100 : it.purchasePrice;
          return {
            id: it.id,
            drillModule: 'inventory',
            drillId: it.id,
            code: it.code,
            nameAr: it.nameAr,
            category: it.category,
            unit: it.baseUnit,
            qty,
            purchasePrice: unitCost,
            salePrice: it.salePrice,
            valuation,
          };
        });
        const totalQty = list.reduce((s, r) => s + r.qty, 0);
        const totalVal = list.reduce((s, r) => s + r.valuation, 0);
        return {
          rows: list,
          kpis: [
            { label: 'عدد الأصناف', value: String(list.length), tone: 'amber' },
            { label: 'إجمالي الكميات', value: totalQty.toLocaleString(), tone: 'cyan' },
            { label: `إجمالي تقييم المخزون (${currencySymbol})`, value: totalVal.toLocaleString(), tone: 'emerald' },
          ],
          columns: [
            { key: 'code', label: 'الكود', render: (r) => <span className="font-mono text-amber-400">{r.code}</span> },
            { key: 'nameAr', label: 'اسم الصنف', render: (r) => <span className="font-semibold text-white">{r.nameAr}</span> },
            { key: 'category', label: 'التصنيف', render: (r) => r.category },
            { key: 'unit', label: 'الوحدة', align: 'center', render: (r) => r.unit },
            { key: 'qty', label: 'الكمية', align: 'center', sortValue: (r) => r.qty, render: (r) => <span className="font-mono font-bold text-white">{r.qty}</span>, footerRender: () => totalQty.toLocaleString() },
            { key: 'purchasePrice', label: 'التكلفة', align: 'left', render: (r) => <span className="font-mono">{r.purchasePrice.toLocaleString()}</span> },
            { key: 'valuation', label: `القيمة (${currencySymbol})`, align: 'left', sortValue: (r) => r.valuation, render: (r) => <span className="font-mono font-bold text-emerald-400">{r.valuation.toLocaleString()}</span>, footerRender: () => totalVal.toLocaleString() },
          ],
          exportHeaders: ['كود الصنف', 'اسم الصنف', 'التصنيف', 'الوحدة', 'الكمية', 'سعر التكلفة', 'القيمة الإجمالية'],
          exportRows: list.map((r) => [r.code, r.nameAr, r.category, r.unit, r.qty, r.purchasePrice, r.valuation]),
        };
      }

      case 'stock_movements': {
        const list = db.stockMovements
          .filter(
            (m) =>
              inDateRange(m.movementDate) &&
              (warehouseFilter === 'all' || m.warehouseId === warehouseFilter)
          )
          .map((m) => {
            const item = db.inventoryItems.find((it) => it.id === m.itemId);
            const wh = db.warehouses.find((w) => w.id === m.warehouseId);
            return {
              id: m.id,
              drillModule: 'inventory',
              drillId: m.itemId,
              date: m.movementDate,
              documentNumber: m.documentNumber,
              documentType: m.documentType.replace(/_/g, ' '),
              itemName: item?.nameAr || m.itemId,
              warehouseName: wh?.nameAr || '-',
              quantityChange: m.quantityChange,
              totalCost: m.totalCost,
            };
          });
        const totalCost = list.reduce((s, r) => s + r.totalCost, 0);
        return {
          rows: list,
          kpis: [
            { label: 'عدد الحركات', value: String(list.length), tone: 'amber' },
            { label: `إجمالي تكلفة الحركات (${currencySymbol})`, value: totalCost.toLocaleString(), tone: 'cyan' },
          ],
          columns: [
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date.slice(0, 10)}</span> },
            { key: 'documentNumber', label: 'رقم المستند', render: (r) => <span className="font-mono text-amber-400">{r.documentNumber}</span> },
            { key: 'documentType', label: 'نوع الحركة', render: (r) => r.documentType },
            { key: 'itemName', label: 'الصنف', render: (r) => <span className="font-semibold text-white">{r.itemName}</span> },
            { key: 'warehouseName', label: 'المستودع', render: (r) => r.warehouseName },
            { key: 'quantityChange', label: 'التغير', align: 'center', render: (r) => <span className={`font-mono font-bold ${r.quantityChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.quantityChange > 0 ? `+${r.quantityChange}` : r.quantityChange}</span> },
            { key: 'totalCost', label: 'القيمة', align: 'left', render: (r) => <span className="font-mono">{r.totalCost.toLocaleString()}</span>, footerRender: () => totalCost.toLocaleString() },
          ],
          exportHeaders: ['التاريخ', 'رقم المستند', 'نوع الحركة', 'الصنف', 'المستودع', 'الكمية', 'التكلفة الإجمالية'],
          exportRows: list.map((r) => [r.date, r.documentNumber, r.documentType, r.itemName, r.warehouseName, r.quantityChange, r.totalCost]),
        };
      }

      case 'warehouse_transfers_docs': {
        const rows: ReportRow[] = [];
        db.inventoryTransfers
          .filter(
            (t) =>
              inDateRange(t.date) &&
              (warehouseFilter === 'all' || t.fromWarehouseId === warehouseFilter || t.toWarehouseId === warehouseFilter)
          )
          .forEach((t) => {
            const fromWh = db.warehouses.find((w) => w.id === t.fromWarehouseId)?.nameAr || '-';
            const toWh = db.warehouses.find((w) => w.id === t.toWarehouseId)?.nameAr || '-';
            const cost = t.items.reduce((s, it) => s + it.unitCost * it.quantity, 0);
            rows.push({
              id: t.id,
              drillModule: 'inventory',
              drillId: t.id,
              docNumber: t.transferNumber,
              docType: 'تحويل بين المستودعات',
              date: t.date,
              details: `${fromWh} -> ${toWh}`,
              itemsCount: t.items.length,
              totalCost: cost,
              status: t.status,
            });
          });
        (db.warehouseDocuments || [])
          .filter((d) => inDateRange(d.date) && (warehouseFilter === 'all' || d.warehouseId === warehouseFilter))
          .forEach((d) => {
            rows.push({
              id: d.id,
              drillModule: 'inventory',
              drillId: d.id,
              docNumber: d.documentNumber,
              docType: d.type.replace(/_/g, ' '),
              date: d.date,
              details: d.beneficiaryOrSupplier || d.reason || '-',
              itemsCount: d.items.length,
              totalCost: d.totalCost,
              status: d.status,
            });
          });
        return {
          rows,
          kpis: [
            { label: 'عدد التحويلات والأذون', value: String(rows.length), tone: 'amber' },
            { label: `إجمالي القيمة (${currencySymbol})`, value: rows.reduce((s, r) => s + r.totalCost, 0).toLocaleString(), tone: 'cyan' },
          ],
          columns: [
            { key: 'docNumber', label: 'رقم المستند', render: (r) => <span className="font-mono text-amber-400">{r.docNumber}</span> },
            { key: 'docType', label: 'النوع', render: (r) => <span className="font-semibold text-white">{r.docType}</span> },
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'details', label: 'المسار / الجهة', render: (r) => r.details },
            { key: 'itemsCount', label: 'الأصناف', align: 'center', render: (r) => <span className="font-mono">{r.itemsCount}</span> },
            { key: 'totalCost', label: 'القيمة', align: 'left', render: (r) => <span className="font-mono font-bold">{r.totalCost.toLocaleString()}</span> },
            { key: 'status', label: 'الحالة', align: 'center', render: (r) => r.status },
          ],
          exportHeaders: ['رقم المستند', 'النوع', 'التاريخ', 'المسار / الجهة', 'عدد الأصناف', 'القيمة', 'الحالة'],
          exportRows: rows.map((r) => [r.docNumber, r.docType, r.date, r.details, r.itemsCount, r.totalCost, r.status]),
        };
      }

      case 'stocktaking_variances': {
        const rows: ReportRow[] = [];
        db.stocktakings
          .filter(
            (st) =>
              inDateRange(st.date) &&
              (warehouseFilter === 'all' || st.warehouseId === warehouseFilter || st.warehouseIds?.includes(warehouseFilter))
          )
          .forEach((st) => {
            st.items.forEach((it, idx) => {
              rows.push({
                id: `${st.id}-${idx}`,
                drillModule: 'inventory',
                drillId: st.id,
                stocktakeNumber: st.stocktakeNumber,
                date: st.date,
                warehouseName: it.warehouseName || db.warehouses.find((w) => w.id === (it.warehouseId || st.warehouseId))?.nameAr || '-',
                itemName: it.itemName,
                bookQuantity: it.bookQuantity,
                physicalQuantity: it.physicalQuantity,
                difference: it.difference,
                diffValue: it.totalDifferenceValue,
                status: st.status,
              });
            });
          });
        const totalVar = rows.reduce((s, r) => s + r.diffValue, 0);
        return {
          rows,
          kpis: [
            { label: 'بنود الجرد المسجلة', value: String(rows.length), tone: 'amber' },
            { label: `صافي قيمة الفروقات (${currencySymbol})`, value: totalVar.toLocaleString(), tone: totalVar >= 0 ? 'emerald' : 'rose' },
          ],
          columns: [
            { key: 'stocktakeNumber', label: 'رقم المحضر', render: (r) => <span className="font-mono text-amber-400">{r.stocktakeNumber}</span> },
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'warehouseName', label: 'المستودع', render: (r) => r.warehouseName },
            { key: 'itemName', label: 'الصنف', render: (r) => <span className="font-semibold text-white">{r.itemName}</span> },
            { key: 'bookQuantity', label: 'الرصيد الدفتري', align: 'center', render: (r) => <span className="font-mono">{r.bookQuantity}</span> },
            { key: 'physicalQuantity', label: 'الجرد الفعلي', align: 'center', render: (r) => <span className="font-mono">{r.physicalQuantity}</span> },
            { key: 'difference', label: 'الفرق', align: 'center', render: (r) => <span className={`font-mono font-bold ${r.difference > 0 ? 'text-emerald-400' : r.difference < 0 ? 'text-rose-400' : 'text-slate-400'}`}>{r.difference > 0 ? `+${r.difference}` : r.difference}</span> },
            { key: 'diffValue', label: 'قيمة الفرق', align: 'left', render: (r) => <span className="font-mono font-bold">{r.diffValue.toLocaleString()}</span>, footerRender: () => totalVar.toLocaleString() },
          ],
          exportHeaders: ['رقم المحضر', 'التاريخ', 'المستودع', 'الصنف', 'الدفتري', 'الفعلي', 'الفرق', 'قيمة الفرق', 'الحالة'],
          exportRows: rows.map((r) => [r.stocktakeNumber, r.date, r.warehouseName, r.itemName, r.bookQuantity, r.physicalQuantity, r.difference, r.diffValue, r.status]),
        };
      }

      case 'income_statement': {
        const isRes = generateIncomeStatement(db.chartOfAccounts, db.journalEntries, { startDate, endDate });
        const rows: ReportRow[] = [
          ...isRes.revenues.map((r, i) => ({ id: `rev-${i}`, section: 'الإيرادات', code: r.accountCode, name: r.accountName, amount: r.amount })),
          ...isRes.cogs.map((c, i) => ({ id: `cogs-${i}`, section: 'تكلفة المبيعات', code: c.accountCode, name: c.accountName, amount: -c.amount })),
          ...isRes.expenses.map((e, i) => ({ id: `exp-${i}`, section: 'المصروفات التشغيلية', code: e.accountCode, name: e.accountName, amount: -e.amount })),
          { id: 'net-income', section: 'النتيجة النهائية', code: '-', name: 'صافي الربح / (الخسارة) للفترة', amount: isRes.netIncome },
        ];
        return {
          rows,
          kpis: [
            { label: 'إجمالي الإيرادات', value: isRes.totalRevenue.toLocaleString(), tone: 'emerald' },
            { label: 'تكلفة المبيعات', value: isRes.totalCogs.toLocaleString(), tone: 'amber' },
            { label: 'المصروفات التشغيلية', value: isRes.totalExpenses.toLocaleString(), tone: 'rose' },
            { label: `صافي الربح (${currencySymbol})`, value: isRes.netIncome.toLocaleString(), tone: isRes.netIncome >= 0 ? 'emerald' : 'rose' },
          ],
          columns: [
            { key: 'section', label: 'البند الرئيسي', render: (r) => <span className="font-bold text-amber-300">{r.section}</span> },
            { key: 'code', label: 'رمز الحساب', render: (r) => <span className="font-mono text-slate-400">{r.code}</span> },
            { key: 'name', label: 'اسم الحساب / البيان', render: (r) => <span className="font-semibold text-white">{r.name}</span> },
            { key: 'amount', label: `المبلغ (${currencySymbol})`, align: 'left', render: (r) => <span className={`font-mono font-bold ${r.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.amount.toLocaleString()}</span> },
          ],
          exportHeaders: ['البند الرئيسي', 'رمز الحساب', 'اسم الحساب', 'المبلغ'],
          exportRows: rows.map((r) => [r.section, r.code, r.name, r.amount]),
        };
      }

      case 'balance_sheet': {
        const bsRes = generateBalanceSheet(db.chartOfAccounts, db.journalEntries, { startDate, endDate });
        const rows: ReportRow[] = [
          ...bsRes.assets.map((a, i) => ({ id: `ast-${i}`, group: 'الأصول', code: a.accountCode, name: a.accountName, balance: a.balance })),
          ...bsRes.liabilities.map((l, i) => ({ id: `lib-${i}`, group: 'الخصوم والالتزامات', code: l.accountCode, name: l.accountName, balance: l.balance })),
          ...bsRes.equity.map((e, i) => ({ id: `eq-${i}`, group: 'حقوق الملكية', code: e.accountCode, name: e.accountName, balance: e.balance })),
          { id: 'net-profit', group: 'حقوق الملكية', code: '-', name: 'صافي ربح / (خسارة) الفترة المرحل', balance: bsRes.netProfitCarried },
        ];
        return {
          rows,
          kpis: [
            { label: 'إجمالي الأصول', value: bsRes.totalAssets.toLocaleString(), tone: 'cyan' },
            { label: 'إجمالي الخصوم', value: bsRes.totalLiabilities.toLocaleString(), tone: 'rose' },
            { label: 'إجمالي حقوق الملكية', value: bsRes.totalEquity.toLocaleString(), tone: 'emerald' },
            { label: 'حالة التوازن', value: bsRes.isBalanced ? 'متوازنة 100%' : `فرق ${bsRes.variance.toFixed(2)}`, tone: bsRes.isBalanced ? 'emerald' : 'rose' },
          ],
          columns: [
            { key: 'group', label: 'التصنيف', render: (r) => <span className="font-bold text-amber-300">{r.group}</span> },
            { key: 'code', label: 'رمز الحساب', render: (r) => <span className="font-mono text-slate-400">{r.code}</span> },
            { key: 'name', label: 'الحساب', render: (r) => <span className="font-semibold text-white">{r.name}</span> },
            { key: 'balance', label: `الرصيد (${currencySymbol})`, align: 'left', render: (r) => <span className="font-mono font-bold text-white">{r.balance.toLocaleString()}</span> },
          ],
          exportHeaders: ['التصنيف', 'رمز الحساب', 'اسم الحساب', 'الرصيد'],
          exportRows: rows.map((r) => [r.group, r.code, r.name, r.balance]),
        };
      }

      case 'cash_flow': {
        const cf = generateCashFlowStatement(db.chartOfAccounts, db.invoices, db.paymentVouchers, db.expenseRecords, { startDate, endDate }, db.company.baseCurrency);
        const rows: ReportRow[] = [
          ...cf.operatingInflows.map((r, i) => ({ id: `in-${i}`, category: 'تدفقات داخلة (+)', label: r.label, amount: r.amount })),
          ...cf.operatingOutflows.map((r, i) => ({ id: `out-${i}`, category: 'تدفقات خارجة (-)', label: r.label, amount: -r.amount })),
          { id: 'net-op', category: 'الملخص', label: 'صافي التدفق النقدي التشغيلي للفترة', amount: cf.netOperatingCashFlow },
          { id: 'open-cash', category: 'الأرصدة النقدية', label: 'رصيد النقدية أول الفترة', amount: cf.openingCashBalance },
          { id: 'close-cash', category: 'الأرصدة النقدية', label: 'رصيد النقدية آخر الفترة', amount: cf.closingCashBalance },
        ];
        return {
          rows,
          kpis: [
            { label: 'صافي التدفق التشغيلي', value: cf.netOperatingCashFlow.toLocaleString(), tone: cf.netOperatingCashFlow >= 0 ? 'emerald' : 'rose' },
            { label: 'النقدية أول الفترة', value: cf.openingCashBalance.toLocaleString(), tone: 'amber' },
            { label: 'النقدية آخر الفترة', value: cf.closingCashBalance.toLocaleString(), tone: 'cyan' },
          ],
          columns: [
            { key: 'category', label: 'التبويب', render: (r) => <span className="font-bold text-amber-300">{r.category}</span> },
            { key: 'label', label: 'البيان', render: (r) => <span className="font-semibold text-white">{r.label}</span> },
            { key: 'amount', label: `القيمة (${currencySymbol})`, align: 'left', render: (r) => <span className={`font-mono font-bold ${r.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.amount.toLocaleString()}</span> },
          ],
          exportHeaders: ['التبويب', 'البيان', 'القيمة'],
          exportRows: rows.map((r) => [r.category, r.label, r.amount]),
        };
      }

      case 'general_ledger': {
        const targetAcc = db.chartOfAccounts.find((a) => a.id === ledgerAccountId);
        const accCurr = targetAcc?.currency || (hasSaudiHint(targetAcc?.nameAr) ? 'SAR' : 'YER');
        const rate = getEffectiveCurrencyRate(db.currencies, accCurr === 'YER' ? 'SAR' : accCurr);
        const isForeign = accCurr !== 'YER';
        const foreignTag = accCurr === 'USD' ? 'USD' : 'ر.س';
        const stRows = ledgerAccountId
          ? calculateAccountLedger(ledgerAccountId, db.journalEntries, db.chartOfAccounts, { startDate, endDate })
          : [];
        const rows: ReportRow[] = stRows.map((r, i) => ({
          id: `gl-${i}`,
          date: r.date,
          documentNumber: r.documentNumber,
          documentType: r.documentType,
          statement: r.statement,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
          nativeDebit: r.txDebit ?? (r.debit > 0 ? Math.round((r.debit / rate) * 100) / 100 : 0),
          nativeCredit: r.txCredit ?? (r.credit > 0 ? Math.round((r.credit / rate) * 100) / 100 : 0),
          nativeBalance: Math.round((r.balance / rate) * 100) / 100,
        }));
        const sumDr = rows.reduce((s, r) => s + r.debit, 0);
        const sumCr = rows.reduce((s, r) => s + r.credit, 0);
        const closing = rows.length > 0 ? rows[rows.length - 1].balance : 0;
        const closingNative = Math.round((closing / rate) * 100) / 100;
        return {
          rows,
          kpis: [
            { label: 'عملة الحساب', value: isForeign ? `${accCurr} (×${rate})` : 'YER', tone: 'amber' },
            { label: 'إجمالي المدين', value: isForeign ? `${(Math.round((sumDr / rate) * 100) / 100).toLocaleString()} ${foreignTag}` : sumDr.toLocaleString(), tone: 'emerald' },
            { label: 'إجمالي الدائن', value: isForeign ? `${(Math.round((sumCr / rate) * 100) / 100).toLocaleString()} ${foreignTag}` : sumCr.toLocaleString(), tone: 'cyan' },
            {
              label: isForeign ? `الرصيد (${foreignTag})` : `الرصيد الختامي (${currencySymbol})`,
              value: isForeign ? `${closingNative.toLocaleString()} ${foreignTag}` : `${closing.toLocaleString()} ر.ي`,
              subValue: isForeign ? `المعادل: ${closing.toLocaleString()} ر.ي` : undefined,
              tone: 'cyan',
            },
          ],
          columns: [
            { key: 'date', label: 'التاريخ', render: (r) => <span className="font-mono text-slate-400">{r.date}</span> },
            { key: 'documentNumber', label: 'المرجع', render: (r) => <span className="font-mono text-amber-400">{r.documentNumber}</span> },
            { key: 'documentType', label: 'النوع', render: (r) => r.documentType },
            { key: 'statement', label: 'البيان', render: (r) => <span className="text-white">{r.statement}</span> },
            {
              key: 'debit',
              label: isForeign ? `مدين (${foreignTag} / ر.ي)` : 'مدين',
              align: 'left',
              render: (r) =>
                r.debit > 0 ? (
                  isForeign ? (
                    <div className="font-mono leading-tight">
                      <div className="text-emerald-300 font-bold">{r.nativeDebit.toLocaleString()} {foreignTag}</div>
                      <div className="text-[10px] text-slate-400">{r.debit.toLocaleString()} ر.ي</div>
                    </div>
                  ) : (
                    <span className="font-mono text-emerald-400">{r.debit.toLocaleString()}</span>
                  )
                ) : (
                  '-'
                ),
              footerRender: () => sumDr.toLocaleString(),
            },
            {
              key: 'credit',
              label: isForeign ? `دائن (${foreignTag} / ر.ي)` : 'دائن',
              align: 'left',
              render: (r) =>
                r.credit > 0 ? (
                  isForeign ? (
                    <div className="font-mono leading-tight">
                      <div className="text-emerald-300 font-bold">{r.nativeCredit.toLocaleString()} {foreignTag}</div>
                      <div className="text-[10px] text-slate-400">{r.credit.toLocaleString()} ر.ي</div>
                    </div>
                  ) : (
                    <span className="font-mono text-amber-400">{r.credit.toLocaleString()}</span>
                  )
                ) : (
                  '-'
                ),
              footerRender: () => sumCr.toLocaleString(),
            },
            {
              key: 'balance',
              label: isForeign ? `الرصيد (${foreignTag} / ر.ي)` : 'الرصيد التراكمي',
              align: 'left',
              render: (r) =>
                isForeign ? (
                  <div className="font-mono leading-tight">
                    <div className="font-black text-emerald-300">{r.nativeBalance.toLocaleString()} {foreignTag}</div>
                    <div className="text-[10px] text-slate-400">{r.balance.toLocaleString()} ر.ي</div>
                  </div>
                ) : (
                  <span className="font-mono font-bold text-white">{r.balance.toLocaleString()}</span>
                ),
            },
          ],
          exportHeaders: isForeign
            ? ['التاريخ', 'المرجع', 'النوع', 'البيان', `مدين (${foreignTag})`, `دائن (${foreignTag})`, `الرصيد (${foreignTag})`, 'مدين (ر.ي)', 'دائن (ر.ي)', 'الرصيد (ر.ي)']
            : ['التاريخ', 'المرجع', 'النوع', 'البيان', 'مدين', 'دائن', 'الرصيد'],
          exportRows: rows.map((r) =>
            isForeign
              ? [r.date, r.documentNumber, r.documentType, r.statement, r.nativeDebit, r.nativeCredit, r.nativeBalance, r.debit, r.credit, r.balance]
              : [r.date, r.documentNumber, r.documentType, r.statement, r.debit, r.credit, r.balance]
          ),
        };
      }

      case 'trial_balance': {
        const sarRate = getEffectiveSarRate(db.currencies);
        const accMap = new Map(db.chartOfAccounts.map((a) => [a.id, a]));
        const tb = generateTrialBalance(db.chartOfAccounts, db.journalEntries, { startDate, endDate });
        const rows: ReportRow[] = tb.map((r) => {
          const acc = accMap.get(r.accountId);
          const curr = acc?.currency || (hasSaudiHint(r.accountName) ? 'SAR' : 'YER');
          const rate = getEffectiveCurrencyRate(db.currencies, curr);
          return {
            id: r.accountId,
            drillModule: 'accounting',
            drillId: r.accountId,
            accountCode: r.accountCode,
            accountName: r.accountName,
            category: r.category,
            currency: curr,
            rate,
            periodDebit: r.periodDebit,
            periodCredit: r.periodCredit,
            endingDebit: r.endingDebit,
            endingCredit: r.endingCredit,
          };
        });
        const sumEndDr = rows.reduce((s, r) => s + r.endingDebit, 0);
        const sumEndCr = rows.reduce((s, r) => s + r.endingCredit, 0);
        const sumEndDrSar = Math.round((sumEndDr / sarRate) * 100) / 100;
        return {
          rows,
          kpis: [
            { label: 'عدد الحسابات', value: String(rows.length), tone: 'amber' },
            { label: `معادل الميزان بالسعودي (×${sarRate})`, value: `${sumEndDrSar.toLocaleString()} ر.س`, tone: 'cyan' },
            { label: 'مجموع الأرصدة المدينة (ر.ي)', value: sumEndDr.toLocaleString(), tone: 'emerald' },
            { label: 'مجموع الأرصدة الدائنة (ر.ي)', value: sumEndCr.toLocaleString(), tone: 'emerald' },
          ],
          columns: [
            { key: 'accountCode', label: 'الرمز', render: (r) => <span className="font-mono text-amber-400">{r.accountCode}</span> },
            {
              key: 'accountName',
              label: 'اسم الحساب',
              render: (r) => (
                <span className="font-semibold text-white">
                  {r.accountName}
                  {r.currency !== 'YER' && (
                    <span className="mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-950 text-emerald-300 border border-emerald-600/50">
                      {r.currency}
                    </span>
                  )}
                </span>
              ),
            },
            { key: 'category', label: 'الفئة', render: (r) => r.category },
            { key: 'periodDebit', label: 'مجموع مدين', align: 'left', render: (r) => <span className="font-mono text-slate-300">{r.periodDebit.toLocaleString()}</span> },
            { key: 'periodCredit', label: 'مجموع دائن', align: 'left', render: (r) => <span className="font-mono text-slate-300">{r.periodCredit.toLocaleString()}</span> },
            {
              key: 'endingDebit',
              label: 'رصيد مدين',
              align: 'left',
              render: (r) =>
                r.endingDebit > 0 ? (
                  r.currency !== 'YER' ? (
                    <div className="font-mono leading-tight">
                      <div className="font-black text-emerald-300">
                        {(Math.round((r.endingDebit / r.rate) * 100) / 100).toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                      </div>
                      <div className="text-[10px] text-slate-400">{r.endingDebit.toLocaleString()} ر.ي</div>
                    </div>
                  ) : (
                    <span className="font-mono font-bold text-emerald-400">{r.endingDebit.toLocaleString()}</span>
                  )
                ) : (
                  '-'
                ),
              footerRender: () => (
                <div className="leading-tight font-mono tabular-nums">
                  <div className="text-emerald-300 font-black">
                    <bdi dir="auto">{sumEndDr.toLocaleString()} ر.ي</bdi>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    <bdi dir="auto">{sumEndDrSar.toLocaleString()} ر.س</bdi>
                  </div>
                </div>
              ),
            },
            {
              key: 'endingCredit',
              label: 'رصيد دائن',
              align: 'left',
              render: (r) =>
                r.endingCredit > 0 ? (
                  r.currency !== 'YER' ? (
                    <div className="font-mono leading-tight">
                      <div className="font-black text-emerald-300">
                        {(Math.round((r.endingCredit / r.rate) * 100) / 100).toLocaleString()} {r.currency === 'SAR' ? 'ر.س' : r.currency}
                      </div>
                      <div className="text-[10px] text-slate-400">{r.endingCredit.toLocaleString()} ر.ي</div>
                    </div>
                  ) : (
                    <span className="font-mono font-bold text-amber-400">{r.endingCredit.toLocaleString()}</span>
                  )
                ) : (
                  '-'
                ),
              footerRender: () => sumEndCr.toLocaleString(),
            },
          ],
          exportHeaders: ['رمز الحساب', 'اسم الحساب', 'العملة', 'مجموع مدين', 'مجموع دائن', 'رصيد مدين', 'رصيد دائن'],
          exportRows: rows.map((r) => [r.accountCode, r.accountName, r.currency, r.periodDebit, r.periodCredit, r.endingDebit, r.endingCredit]),
        };
      }

      case 'regional_performance': {
        const list = db.regionalAreas.map((area) => {
          const areaCustomers = db.customers.filter((c) => c.regionalAreaId === area.id);
          const cIds = new Set(areaCustomers.map((c) => c.id));
          const sales = db.invoices
            .filter((i) => i.type === 'مبيعات' && i.status !== 'cancelled' && cIds.has(i.entityId) && inDateRange(i.date))
            .reduce((s, i) => s + convertToBase(i.grandTotal, i.currency, db.currencies, i.exchangeRate), 0);
          const totalBalance = areaCustomers.reduce((s, c) => s + c.currentBalance, 0);
          return {
            id: area.id,
            drillModule: 'customers',
            drillId: areaCustomers[0]?.id,
            code: area.code,
            governorate: area.governorate,
            district: area.district,
            area: area.area,
            customerCount: areaCustomers.length,
            sales: Math.round(sales),
            totalBalance: Math.round(totalBalance),
          };
        });
        const sumSales = list.reduce((s, r) => s + r.sales, 0);
        const sumBal = list.reduce((s, r) => s + r.totalBalance, 0);
        return {
          rows: list,
          kpis: [
            { label: 'المناطق الجغرافية', value: String(list.length), tone: 'amber' },
            { label: `مبيعات المناطق (${currencySymbol})`, value: sumSales.toLocaleString(), tone: 'emerald' },
            { label: `ذمم المناطق (${currencySymbol})`, value: sumBal.toLocaleString(), tone: 'rose' },
          ],
          columns: [
            { key: 'code', label: 'الرمز', render: (r) => <span className="font-mono text-amber-400">{r.code}</span> },
            { key: 'governorate', label: 'المحافظة', render: (r) => <span className="font-semibold text-white">{r.governorate}</span> },
            { key: 'district', label: 'المديرية', render: (r) => r.district },
            { key: 'area', label: 'المنطقة', render: (r) => r.area },
            { key: 'customerCount', label: 'العملاء', align: 'center', render: (r) => <span className="font-mono">{r.customerCount}</span> },
            { key: 'sales', label: `المبيعات (${currencySymbol})`, align: 'left', sortValue: (r) => r.sales, render: (r) => <span className="font-mono font-bold text-emerald-400">{r.sales.toLocaleString()}</span>, footerRender: () => sumSales.toLocaleString() },
            { key: 'totalBalance', label: 'الذمم القائمة', align: 'left', sortValue: (r) => r.totalBalance, render: (r) => <span className="font-mono font-bold text-rose-400">{r.totalBalance.toLocaleString()}</span>, footerRender: () => sumBal.toLocaleString() },
          ],
          exportHeaders: ['الكود', 'المحافظة', 'المديرية', 'المنطقة', 'عدد العملاء', 'إجمالي المبيعات', 'إجمالي الذمم'],
          exportRows: list.map((r) => [r.code, r.governorate, r.district, r.area, r.customerCount, r.sales, r.totalBalance]),
        };
      }
    }
  }, [selectedReport, db, startDate, endDate, warehouseFilter, entityFilter, sourceCurrencyFilter, displayCurrency, dispSymbol, ledgerAccountId, currencySymbol, isEn]);

  const tableColumns = useMemo<ErpTableColumn<ReportRow>[]>(() => {
    const base = [...activeDataset.columns];
    if (onNavigateToRecord && activeDataset.rows.some((r) => r.drillModule)) {
      base.push({
        key: '_drill',
        label: isEn ? 'Open' : 'انتقال',
        sortable: false,
        align: 'center',
        render: (r) =>
          r.drillModule ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onNavigateToRecord(r.drillModule!, r.drillId);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-amber-400 text-[11px] font-bold transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
              <span>{isEn ? 'Open' : 'فتح'}</span>
            </button>
          ) : (
            <span className="text-slate-600">-</span>
          ),
      });
    }
    return base;
  }, [activeDataset, onNavigateToRecord, isEn]);

  const handleExportPDF = async () => {
    try {
      const repTitle = isEn ? REPORT_EN_TITLES[currentReportDef.id].title : currentReportDef.title;
      const repSub = isEn ? REPORT_EN_TITLES[currentReportDef.id].subtitle : currentReportDef.subtitle;
      await downloadReportAsPDF({
        title: repTitle,
        subtitle: repSub,
        periodText: isEn ? `From ${startDate} to ${endDate}` : `من ${startDate} إلى ${endDate}`,
        company: db.company,
        branch: db.branches[0],
        lang,
        metadata: Object.fromEntries(
          activeDataset.kpis.map((k) => [k.label, k.subValue ? `${k.value} (${k.subValue})` : k.value])
        ),
        tables: [
          {
            title: repTitle,
            headers: activeDataset.exportHeaders,
            rows: activeDataset.exportRows,
          },
        ],
        fileName: `${currentReportDef.id}_${endDate}`,
      });
      onNotify?.('success', isEn ? `Exported "${repTitle}" as PDF.` : `تم تصدير تقرير (${currentReportDef.title}) بصيغة PDF بنجاح.`);
    } catch {
      onNotify?.('error', 'تعذر إنشاء ملف PDF، يرجى التحقق من البيانات والمحاولة مجدداً.');
    }
  };

  const handleExportExcel = () => {
    exportToExcel({
      fileName: `${currentReportDef.id}_${endDate}`,
      sheets: [
        {
          name: currentReportDef.title.slice(0, 28),
          data: [
            [currentReportDef.title],
            [`الفترة: من ${startDate} إلى ${endDate}`],
            [],
            activeDataset.exportHeaders,
            ...activeDataset.exportRows,
          ],
        },
      ],
    });
    onNotify?.('success', 'تم تصدير التقرير إلى ملف Excel بنجاح.');
  };

  const handleExportCSV = () => {
    exportToCSV(`${currentReportDef.id}_${endDate}`, activeDataset.exportHeaders, activeDataset.exportRows);
    onNotify?.('success', 'تم تصدير التقرير بصيغة CSV.');
  };

  const handlePrint = () => {
    const repTitle = isEn ? REPORT_EN_TITLES[currentReportDef.id].title : currentReportDef.title;
    const repSub = isEn ? REPORT_EN_TITLES[currentReportDef.id].subtitle : currentReportDef.subtitle;
    printReportPreview({
      title: repTitle,
      subtitle: repSub,
      periodText: isEn ? `From ${startDate} to ${endDate}` : `من ${startDate} إلى ${endDate}`,
      company: db.company,
      branch: db.branches[0],
      lang,
      metadata: Object.fromEntries(
        activeDataset.kpis.map((k) => [k.label, k.subValue ? `${k.value} (${k.subValue})` : k.value])
      ),
      tables: [{ headers: activeDataset.exportHeaders, rows: activeDataset.exportRows }],
    });
  };

  const filteredCatalog = useMemo(
    () => (activeGroup === 'الكل' ? REPORT_CATALOG : REPORT_CATALOG.filter((r) => r.group === activeGroup)),
    [activeGroup]
  );

  const waDefaultMessage = useMemo(() => {
    const kpiText = activeDataset.kpis
      .map((k) => `- ${k.label}: ${k.value}${k.subValue ? ` (${k.subValue})` : ''}`)
      .join('\n');
    return `*${currentReportDef.title}*\n${db.company.nameAr}\nالفترة: من ${startDate} إلى ${endDate}\n${kpiText}\nعدد السجلات: ${activeDataset.rows.length}`;
  }, [activeDataset, currentReportDef, db.company.nameAr, startDate, endDate]);

  return (
    <div className="space-y-5" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <FileBarChart className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-black text-white">
              {isEn ? 'Financial & Analytical Reports Hub (22 Reports)' : 'مركز التقارير التحليلية والمالية الشاملة (22 تقريراً)'}
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            {isEn
              ? 'Live reports linked to actual transactions with date/warehouse filters, source drill-down, and binary PDF export.'
              : 'تقارير حيّة مرتبطة بالسجلات الفعلية مع التصفية الزمنية والمخزنية والانتقال المباشر للمستند المصدر وتصدير PDF حقيقي'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigateToRecord && (
            <button
              type="button"
              onClick={() => onNavigateToRecord('daily_report')}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs rounded-xl transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{isEn ? 'Daily Management Report (22 KPIs)' : 'التقرير الإداري اليومي (22 مؤشراً)'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors"
          >
            <span>CSV</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isEn ? 'Print' : 'طباعة'}</span>
          </button>
          <button
            type="button"
            onClick={() => setWaModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>{isEn ? 'WhatsApp' : 'واتساب'}</span>
          </button>
        </div>
      </div>

      {/* Category Group Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {['الكل', 'تجاري ومالي', 'ذمم وخزينة', 'مخزون وجرد', 'قوائم ختامية'].map((grp) => (
          <button
            key={grp}
            type="button"
            onClick={() => setActiveGroup(grp)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
              activeGroup === grp
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            {isEn ? GROUP_MAP_EN[grp] || grp : grp}
          </button>
        ))}
      </div>

      {/* Report Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {filteredCatalog.map((rep) => {
          const active = selectedReport === rep.id;
          const localizedTitle = isEn ? REPORT_EN_TITLES[rep.id].title : rep.title;
          const localizedSub = isEn ? REPORT_EN_TITLES[rep.id].subtitle : rep.subtitle;
          return (
            <button
              key={rep.id}
              type="button"
              onClick={() => setSelectedReport(rep.id)}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${isEn ? 'text-left' : 'text-right'} ${
                active
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 shadow-md'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
              }`}
            >
              <div className={`mb-1.5 ${active ? 'text-amber-400' : 'text-slate-400'}`}>{rep.icon}</div>
              <div className="text-xs font-bold text-white leading-snug">{localizedTitle}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{localizedSub}</div>
            </button>
          );
        })}
      </div>

      {/* Dynamic Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end">
        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'From Date' : 'من تاريخ'}</label>
          <div className="relative">
            <Calendar className={`w-3.5 h-3.5 text-slate-500 absolute ${isEn ? 'left-3' : 'right-3'} top-2.5 pointer-events-none`} />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isEn ? 'pl-8 pr-3' : 'pr-8 pl-3'} py-2 text-xs text-white font-mono focus:border-amber-500 focus:outline-none`}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'To Date' : 'إلى تاريخ'}</label>
          <div className="relative">
            <Calendar className={`w-3.5 h-3.5 text-slate-500 absolute ${isEn ? 'left-3' : 'right-3'} top-2.5 pointer-events-none`} />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`w-full bg-slate-950 border border-slate-800 rounded-xl ${isEn ? 'pl-8 pr-3' : 'pr-8 pl-3'} py-2 text-xs text-white font-mono focus:border-amber-500 focus:outline-none`}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'Warehouse' : 'المستودع'}</label>
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none cursor-pointer"
          >
            <option value="all">{isEn ? 'All Warehouses' : 'كافة المستودعات'}</option>
            {db.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nameAr}
              </option>
            ))}
          </select>
        </div>

        {selectedReport === 'general_ledger' ? (
          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'GL Account' : 'الحساب المحاسبي'}</label>
            <SearchableSelect
              options={accountSelectOptions}
              value={ledgerAccountId}
              onChange={(opt) => opt && setLedgerAccountId(opt.id)}
              placeholder={isEn ? 'Search code or account...' : 'ابحث برمز أو اسم الحساب...'}
              searchPlaceholder={isEn ? 'Type code/name...' : 'أدخل رمز أو اسم الحساب...'}
              lang={lang}
            />
          </div>
        ) : (
          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'Party (Cust/Vend)' : 'الطرف (عميل / مورد)'}</label>
            <SearchableSelect
              options={partySelectOptions}
              value={entityFilter === 'all' ? '' : entityFilter}
              onChange={(opt) => setEntityFilter(opt ? opt.id : 'all')}
              allowClear
              clearLabel={isEn ? 'All Parties' : 'كافة الأطراف'}
              placeholder={isEn ? 'All Parties (Search...)' : 'كافة الأطراف (ابحث بالكود/الاسم)'}
              searchPlaceholder={isEn ? 'Type code, phone or name...' : 'ابحث بالكود أو الهاتف أو الاسم...'}
              lang={lang}
            />
          </div>
        )}

        <div>
          <label className="text-[11px] font-bold text-slate-400 block mb-1">{isEn ? 'Tx Currency' : 'عملة الحركة'}</label>
          <select
            value={sourceCurrencyFilter}
            onChange={(e) => setSourceCurrencyFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none cursor-pointer"
          >
            <option value="ALL">{isEn ? 'All Currencies' : 'كل العملات'}</option>
            {db.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.nameAr})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-bold text-amber-300 block mb-1">{isEn ? 'Display In' : 'عرض الإجماليات بـ'}</label>
          <select
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value)}
            className="w-full bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-xs text-amber-300 font-bold focus:border-amber-500 focus:outline-none cursor-pointer"
          >
            {db.currencies.map((c) => (
              <option key={c.code} value={c.code} className="text-white">
                {c.code} ({c.symbol})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={resetFilters}
          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{isEn ? 'Reset' : 'إعادة ضبط'}</span>
        </button>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {activeDataset.kpis.map((kpi, idx) => {
          const colorCls =
            kpi.tone === 'emerald'
              ? 'text-emerald-400'
              : kpi.tone === 'rose'
              ? 'text-rose-400'
              : kpi.tone === 'cyan'
              ? 'text-cyan-400'
              : 'text-amber-400';
          return (
            <div key={idx} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-400 mb-1">{kpi.label}</div>
              <div className={`text-lg font-black font-mono tabular-nums ${colorCls}`}>
                <bdi dir="auto">{kpi.value}</bdi>
              </div>
              {kpi.subValue && (
                <div className="text-[11px] font-bold text-slate-300 font-mono tabular-nums mt-0.5">
                  <bdi dir="auto">{kpi.subValue}</bdi>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Interactive Report Table */}
      <ErpDataTable
        tableId={`report-${selectedReport}`}
        title={isEn ? REPORT_EN_TITLES[currentReportDef.id].title : currentReportDef.title}
        data={activeDataset.rows}
        columns={tableColumns}
        getRowId={(r) => r.id}
        lang={lang}
        searchPlaceholder={
          isEn
            ? `Instant search inside ${REPORT_EN_TITLES[currentReportDef.id].title}...`
            : `بحث فوري داخل ${currentReportDef.title}...`
        }
        savedColumnPrefs={savedColumnPrefs?.[`report-${selectedReport}`]}
        onSaveColumnPrefs={onSaveColumnPrefs}
        onRowClick={
          onNavigateToRecord
            ? (row) => {
                if (row.drillModule) {
                  onNavigateToRecord(row.drillModule, row.drillId);
                }
              }
            : undefined
        }
      />

      <WhatsAppShareModal
        isOpen={waModalOpen}
        onClose={() => setWaModalOpen(false)}
        title={`مشاركة: ${currentReportDef.title}`}
        recipientName="الإدارة / المستلم"
        defaultPhone={db.settings.notificationPhone || db.company.phone || ''}
        defaultTemplateKey="dailySummary"
        templates={db.settings.whatsappTemplates}
        defaultMessage={waDefaultMessage}
        onDispatched={() => onNotify?.('success', 'تم تجهيز وفتح رسالة التقرير في واتساب.')}
      />
    </div>
  );
};
