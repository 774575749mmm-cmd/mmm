/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Tab 7: Unified COA, HR Payroll, Expenses, Fixed Assets & Directories
 * Full enterprise CRUD: Ranked search by code & name, inline/modal editors, duplicate guards & status toggles.
 */

import React, { useState, useMemo } from 'react';
import {
  GitBranch,
  UserCheck,
  Receipt,
  Landmark,
  FolderTree,
  Plus,
  Search,
  Edit3,
  X,
  Check,
  Power,
  MapPin,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import {
  Account,
  AccountCategory,
  CostCenter,
  Employee,
  PayrollRun,
  ExpenseCategory,
  ExpenseRecord,
  FixedAsset,
  TreasuryAccount,
  Warehouse,
  DepartmentItem,
  RegionalArea,
  Currency,
  CurrencyCode,
  Company,
  Branch,
  User,
  TableColumnPref,
  Invoice,
} from '../../../types/erp';
import { HrPayrollModule } from '../hr/HrPayrollModule';
import { ExpensesModule } from '../expenses/ExpensesModule';
import { FixedAssetsModule } from '../assets/FixedAssetsModule';
import { rankSearchResults } from '../../../services/searchHelpers';

interface UnifiedOperationsWorkbenchProps {
  chartOfAccounts: Account[];
  costCenters: CostCenter[];
  employees: Employee[];
  payrollRuns: PayrollRun[];
  expenseCategories: ExpenseCategory[];
  expenseRecords: ExpenseRecord[];
  fixedAssets: FixedAsset[];
  treasuryAccounts: TreasuryAccount[];
  warehouses: Warehouse[];
  departments: DepartmentItem[];
  regionalAreas: RegionalArea[];
  currencies: Currency[];
  company: Company;
  currentBranch: Branch;
  currentUser: User;
  currencySymbol: string;
  initialSubTab?: 'coa' | 'hr' | 'expenses' | 'assets' | 'directories';
  savedColumnPrefsMap: Record<string, TableColumnPref[]>;
  focusedRecordId?: string;
  onSaveColumnPrefs: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveAccount: (acc: Account) => void;
  onSaveEmployee: (emp: Employee) => void;
  onDisbursePayroll: (payroll: PayrollRun) => void;
  onPostExpense: (exp: ExpenseRecord) => void;
  onSaveAsset: (asset: FixedAsset) => void;
  onRunDepreciation: (totalDepr: number) => void;
  onDisposeAsset?: (
    assetId: string,
    saleProceeds: number,
    treasuryId: string,
    disposalDate: string,
    notes?: string
  ) => void;
  invoices?: Invoice[];
  onSaveTreasuryAccount: (tr: TreasuryAccount) => void;
  onSaveWarehouse: (wh: Warehouse) => void;
  onSaveDepartment: (dept: DepartmentItem) => void;
  onSaveZone: (zone: RegionalArea) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const UnifiedOperationsWorkbench: React.FC<UnifiedOperationsWorkbenchProps> = ({
  chartOfAccounts,
  costCenters,
  employees,
  payrollRuns,
  expenseCategories,
  expenseRecords,
  fixedAssets,
  treasuryAccounts,
  warehouses,
  departments,
  regionalAreas,
  currencies,
  company,
  currentBranch,
  currentUser,
  currencySymbol,
  initialSubTab = 'coa',
  savedColumnPrefsMap,
  focusedRecordId,
  onSaveColumnPrefs,
  onSaveAccount,
  onSaveEmployee,
  onDisbursePayroll,
  onPostExpense,
  onSaveAsset,
  onRunDepreciation,
  onDisposeAsset,
  invoices = [],
  onSaveTreasuryAccount,
  onSaveWarehouse,
  onSaveDepartment,
  onSaveZone,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState(initialSubTab);
  const [coaClassFilter, setCoaClassFilter] = useState<string>('ALL');
  const [coaSearch, setCoaSearch] = useState('');
  const [coaCurrencyFilter, setCoaCurrencyFilter] = useState<string>('ALL');

  // Add / Edit Account Modal
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccName, setNewAccName] = useState('');
  const [newAccCat, setNewAccCat] = useState<AccountCategory>('أصول');
  const [newAccCurr, setNewAccCurr] = useState<CurrencyCode>('YER');
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  // Directories quick forms & search
  const [dirSearch, setDirSearch] = useState('');
  const [newTrName, setNewTrName] = useState('');
  const [newTrType, setNewTrType] = useState<TreasuryAccount['type']>('صندوق');
  const [newTrCur, setNewTrCur] = useState<CurrencyCode>('YER');
  const [editingTreasury, setEditingTreasury] = useState<TreasuryAccount | null>(null);

  const [newDeptName, setNewDeptName] = useState('');
  const [editingDept, setEditingDept] = useState<DepartmentItem | null>(null);

  const [newWhName, setNewWhName] = useState('');
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);

  const [newZoneArea, setNewZoneArea] = useState('');
  const [editingZone, setEditingZone] = useState<RegionalArea | null>(null);

  const filteredCoa = useMemo(() => {
    const byFilters = chartOfAccounts
      .filter((a) => coaClassFilter === 'ALL' || a.code.startsWith(coaClassFilter))
      .filter((a) => coaCurrencyFilter === 'ALL' || (a.currency || 'YER') === coaCurrencyFilter);
    const searched = coaSearch.trim()
      ? rankSearchResults(
          byFilters,
          coaSearch,
          (a) => ({
            code: a.code,
            id: a.id,
            name: `${a.nameAr} ${a.category} ${a.currency || ''}`,
          }),
          Math.max(byFilters.length, 300)
        )
      : [...byFilters].sort((a, b) => a.code.localeCompare(b.code));
    return searched;
  }, [chartOfAccounts, coaClassFilter, coaCurrencyFilter, coaSearch]);

  const filteredTreasuries = useMemo(() => {
    if (!dirSearch.trim()) return treasuryAccounts;
    return rankSearchResults(
      treasuryAccounts,
      dirSearch,
      (t) => ({ code: t.code, id: t.id, name: `${t.nameAr} ${t.type} ${t.currency}` }),
      Math.max(treasuryAccounts.length, 100)
    );
  }, [treasuryAccounts, dirSearch]);

  const filteredWarehouses = useMemo(() => {
    if (!dirSearch.trim()) return warehouses;
    return rankSearchResults(
      warehouses,
      dirSearch,
      (w) => ({ code: w.code, id: w.id, name: `${w.nameAr} ${w.location} ${w.keeperName}` }),
      Math.max(warehouses.length, 100)
    );
  }, [warehouses, dirSearch]);

  const filteredZones = useMemo(() => {
    if (!dirSearch.trim()) return regionalAreas;
    return rankSearchResults(
      regionalAreas,
      dirSearch,
      (z) => ({ code: z.code, id: z.id, name: `${z.governorate} ${z.district} ${z.area}` }),
      Math.max(regionalAreas.length, 100)
    );
  }, [regionalAreas, dirSearch]);

  const handleSaveNewAccount = () => {
    const cleanCode = newAccCode.trim();
    const cleanName = newAccName.trim();
    if (!cleanCode || !cleanName) {
      onNotify('error', 'أدخل رمز الحساب واسمه.');
      return;
    }
    if (chartOfAccounts.some((a) => a.code === cleanCode)) {
      onNotify('error', `رمز الحساب "${cleanCode}" مستخدم مسبقاً في شجرة الحسابات.`);
      return;
    }
    onSaveAccount({
      id: `acc-${Date.now()}`,
      code: cleanCode,
      nameAr: cleanName,
      category: newAccCat,
      nature: newAccCat === 'أصول' || newAccCat === 'مصروفات' ? 'debit' : 'credit',
      level: 3,
      isLeaf: true,
      currency: newAccCurr,
      currentBalance: 0,
    });
    setNewAccCode('');
    setNewAccName('');
    onNotify('success', 'تم إضافة الحساب إلى الدليل الموحد.');
  };

  const handleSaveEditedAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    const cleanCode = editingAccount.code.trim();
    const cleanName = editingAccount.nameAr.trim();
    if (!cleanCode || !cleanName) {
      onNotify('error', 'أدخل رمز الحساب واسمه.');
      return;
    }
    if (chartOfAccounts.some((a) => a.id !== editingAccount.id && a.code === cleanCode)) {
      onNotify('error', `الرمز "${cleanCode}" مسجل لحساب آخر.`);
      return;
    }
    onSaveAccount({
      ...editingAccount,
      code: cleanCode,
      nameAr: cleanName,
    });
    setEditingAccount(null);
    onNotify('success', `تم تحديث بيانات الحساب "${cleanName}".`);
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div className="v20-card-alt px-3 py-2 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setSubTab('coa')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'coa' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>1. شجرة الحسابات الموحدة ({chartOfAccounts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('hr')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'hr' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>2. الموارد البشرية وكشف الرواتب ({employees.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('expenses')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'expenses' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" />
          <span>3. المصروفات ومراكز التكلفة ({expenseRecords.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('assets')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'assets' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <Landmark className="w-3.5 h-3.5" />
          <span>4. الأصول الثابتة والإهلاك ({fixedAssets.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('directories')}
          className={`px-3 py-1.5 rounded-md text-xs font-black flex items-center gap-1.5 cursor-pointer ${
            subTab === 'directories' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#08121E] border border-[var(--border-strong)] text-white'
          }`}
        >
          <FolderTree className="w-3.5 h-3.5" />
          <span>5. أدلة الصناديق والصرافين والمخازن والأقسام</span>
        </button>
      </div>

      {subTab === 'coa' && (
        <div className="v20-card p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { k: 'ALL', l: 'الكل' },
                { k: '1', l: '1 - الأصول' },
                { k: '2', l: '2 - الخصوم' },
                { k: '3', l: '3 - حقوق الملكية' },
                { k: '4', l: '4 - الإيرادات' },
                { k: '5', l: '5 - المصروفات' },
              ].map((c) => (
                <button
                  key={c.k}
                  type="button"
                  onClick={() => setCoaClassFilter(c.k)}
                  className={`px-2.5 py-1 rounded text-xs font-black cursor-pointer ${
                    coaClassFilter === c.k
                      ? 'bg-[var(--gold)] text-[#03060A]'
                      : 'bg-[#08121E] border border-[var(--border-strong)] text-slate-300'
                  }`}
                >
                  {c.l}
                </button>
              ))}
            </div>

            {/* Instant Search + Currency Filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={coaSearch}
                  onChange={(e) => setCoaSearch(e.target.value)}
                  placeholder="بحث برمز أو اسم الحساب..."
                  className="v20-input pr-8 pl-2.5 py-1 text-xs w-48"
                />
              </div>
              <select
                value={coaCurrencyFilter}
                onChange={(e) => setCoaCurrencyFilter(e.target.value)}
                className="v20-input px-2 py-1 text-xs cursor-pointer"
              >
                <option value="ALL">كل العملات</option>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.nameAr})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Add Account Strip */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-black text-[var(--gold)] ml-1">إضافة حساب سريع:</span>
            <input
              type="text"
              value={newAccCode}
              onChange={(e) => setNewAccCode(e.target.value)}
              placeholder="رمز الحساب (مثال 5350)"
              className="v20-input px-2.5 py-1 text-xs w-36 font-mono"
            />
            <input
              type="text"
              value={newAccName}
              onChange={(e) => setNewAccName(e.target.value)}
              placeholder="اسم الحساب *"
              className="v20-input px-2.5 py-1 text-xs flex-1 min-w-[160px]"
            />
            <select
              value={newAccCat}
              onChange={(e) => setNewAccCat(e.target.value as AccountCategory)}
              className="v20-input px-2 py-1 text-xs cursor-pointer"
            >
              <option value="أصول">أصول</option>
              <option value="خصوم">خصوم</option>
              <option value="حقوق_ملكية">حقوق ملكية</option>
              <option value="إيرادات">إيرادات</option>
              <option value="مصروفات">مصروفات</option>
            </select>
            <select
              value={newAccCurr}
              onChange={(e) => setNewAccCurr(e.target.value as CurrencyCode)}
              className="v20-input px-2 py-1 text-xs cursor-pointer"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSaveNewAccount}
              className="px-3 py-1 rounded v20-btn-gold text-xs flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة حساب</span>
            </button>
          </div>

          <div className="overflow-x-auto border border-[var(--border-strong)] rounded-lg bg-[#060D15]">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] text-[var(--gold)] border-b-2 border-[var(--gold)]">
                <tr>
                  <th className="p-2 border-l border-[#1B2E44]">الكود</th>
                  <th className="p-2 border-l border-[#1B2E44]">اسم الحساب</th>
                  <th className="p-2 border-l border-[#1B2E44]">التصنيف</th>
                  <th className="p-2 border-l border-[#1B2E44]">العملة</th>
                  <th className="p-2 border-l border-[#1B2E44]">الطبيعة</th>
                  <th className="p-2 border-l border-[#1B2E44] text-center">المستوى والحالة</th>
                  <th className="p-2 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoa.map((acc) => {
                  const isAccActive = acc.isActive !== false;
                  return (
                  <tr key={acc.id} className={`border-b border-[#1B2E44] hover:bg-amber-500/10 ${!isAccActive ? 'opacity-60' : ''}`}>
                    <td className="p-2 font-mono font-bold text-[var(--gold)] border-l border-[#1B2E44] tabular-nums">
                      {acc.code}
                    </td>
                    <td className={`p-2 border-l border-[#1B2E44] ${acc.isLeaf ? 'text-white font-bold' : 'text-sky-300 font-black'}`}>
                      {acc.nameAr}
                    </td>
                    <td className="p-2 border-l border-[#1B2E44]">{acc.category.replace(/_/g, ' ')}</td>
                    <td className="p-2 border-l border-[#1B2E44] font-mono text-amber-300">{acc.currency || 'YER'}</td>
                    <td className="p-2 border-l border-[#1B2E44]">{acc.nature === 'debit' ? 'مدين' : 'دائن'}</td>
                    <td className="p-2 border-l border-[#1B2E44] text-center">
                      <span>{acc.isLeaf ? 'حساب فرعي' : 'حساب رئيسي'}</span>
                      <span className={`mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${isAccActive ? 'bg-emerald-950/60 text-emerald-300' : 'bg-rose-950/60 text-rose-300'}`}>
                        {isAccActive ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingAccount({ ...acc })}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] text-[11px] font-bold cursor-pointer"
                          title="تعديل بيانات الحساب"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onSaveAccount({ ...acc, isActive: !isAccActive });
                            onNotify('info', !isAccActive ? `تم تفعيل الحساب "${acc.nameAr}"` : `تم تعطيل الحساب "${acc.nameAr}" لمنع الترحيل عليه.`);
                          }}
                          className={`p-1 rounded border cursor-pointer ${
                            isAccActive
                              ? 'bg-emerald-950/50 border-emerald-600/50 text-emerald-300'
                              : 'bg-rose-950/50 border-rose-600/50 text-rose-300'
                          }`}
                          title={isAccActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                        >
                          <Power className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {filteredCoa.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      لا توجد حسابات مطابقة لعبارة البحث أو التصفية الحالية.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'hr' && (
        <div className="space-y-3">
          {invoices.length > 0 && (() => {
            const repMap = new Map<string, { name: string; count: number; totalSales: number; totalPaid: number }>();
            invoices
              .filter((inv) => inv.status !== 'cancelled' && (inv.type === 'مبيعات' || inv.type === 'مرتجع_مبيعات') && (inv.salesRepId || inv.salesRepName))
              .forEach((inv) => {
                const key = inv.salesRepId || inv.salesRepName || 'unassigned';
                const emp = employees.find((e) => e.id === inv.salesRepId);
                const cur = repMap.get(key) || {
                  name: emp?.nameAr || inv.salesRepName || key,
                  count: 0,
                  totalSales: 0,
                  totalPaid: 0,
                };
                const sign = inv.type === 'مرتجع_مبيعات' ? -1 : 1;
                const rate = inv.exchangeRate || 1;
                cur.count += 1;
                cur.totalSales += sign * inv.grandTotal * rate;
                cur.totalPaid += sign * inv.paidAmount * rate;
                repMap.set(key, cur);
              });
            const repRows = Array.from(repMap.entries());
            if (repRows.length === 0) return null;
            return (
              <div className="v20-card p-3 space-y-2 text-xs">
                <h4 className="font-black text-sm text-[var(--gold)]">تقييم أداء ومبيعات وتحصيلات المناديب</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {repRows.map(([k, r]) => (
                    <div key={k} className="v20-card-alt p-2.5 flex justify-between items-center">
                      <div>
                        <div className="font-bold text-white">{r.name}</div>
                        <div className="text-[11px] text-slate-400">فواتير: {r.count} · محصل: {r.totalPaid.toLocaleString()} {currencySymbol}</div>
                      </div>
                      <div className="text-left">
                        <div className="font-black text-[var(--gold)] tabular-nums">{r.totalSales.toLocaleString()} {currencySymbol}</div>
                        <div className="text-[10px] text-emerald-300">عمولة مقترحة 2%: {(Math.round(r.totalPaid * 0.02)).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <HrPayrollModule
            employees={employees}
            payrollRuns={payrollRuns}
            treasuryAccounts={treasuryAccounts}
            currentBranch={currentBranch}
            company={company}
            currencySymbol={currencySymbol}
            canPostEntries={currentUser.canPostEntries}
            savedColumnPrefs={savedColumnPrefsMap}
            onSaveColumnPrefs={onSaveColumnPrefs}
            onSaveEmployee={onSaveEmployee}
            onDisbursePayroll={onDisbursePayroll}
            onNotify={onNotify}
          />
        </div>
      )}

      {subTab === 'expenses' && (
        <ExpensesModule
          expenses={expenseRecords}
          categories={expenseCategories}
          costCenters={costCenters}
          treasuryAccounts={treasuryAccounts}
          currencies={currencies}
          currentBranch={currentBranch}
          company={company}
          currencySymbol={currencySymbol}
          canPostEntries={currentUser.canPostEntries}
          savedColumnPrefs={savedColumnPrefsMap['expenses-records']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          focusedRecordId={focusedRecordId}
          onPostExpense={onPostExpense}
          onNotify={onNotify}
        />
      )}

      {subTab === 'assets' && (
        <FixedAssetsModule
          fixedAssets={fixedAssets}
          treasuryAccounts={treasuryAccounts}
          currentBranch={currentBranch}
          company={company}
          currencySymbol={currencySymbol}
          canPostEntries={currentUser.canPostEntries}
          savedColumnPrefs={savedColumnPrefsMap['fixed-assets']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          onSaveAsset={(a) => {
            onSaveAsset(a);
            onNotify('success', `تم حفظ الأصل الثابت "${a.nameAr}".`);
          }}
          onRunDepreciation={onRunDepreciation}
          onDisposeAsset={onDisposeAsset}
          onNotify={onNotify}
        />
      )}

      {subTab === 'directories' && (
        <div className="space-y-3 text-xs">
          {/* Shared Directories Search */}
          <div className="v20-card-alt px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="font-black text-[var(--gold)]">البحث والتعديل المباشر في الأدلة التشغيلية</div>
            <div className="relative w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                placeholder="بحث بالاسم أو الرمز في الصناديق والمخازن والمناطق..."
                className="w-full v20-input pr-8 pl-2.5 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Treasuries & Exchanges */}
            <div className="v20-card p-3 space-y-2.5">
              <h4 className="font-black text-sm text-[var(--gold)] border-b border-[var(--border-strong)] pb-1.5">
                دليل الصناديق وشركات الصرافة والمحافظ ({filteredTreasuries.length})
              </h4>
              <div className="flex gap-1.5 flex-wrap">
                <input
                  type="text"
                  value={newTrName}
                  onChange={(e) => setNewTrName(e.target.value)}
                  placeholder="اسم الصندوق / الصراف..."
                  className="flex-1 v20-input px-2.5 py-1.5"
                />
                <select
                  value={newTrType}
                  onChange={(e) => setNewTrType(e.target.value as TreasuryAccount['type'])}
                  className="v20-input px-2 py-1.5"
                >
                  <option value="صندوق">صندوق نقدي</option>
                  <option value="بنك">بنك / شركة صرافة</option>
                  <option value="محفظة">محفظة إلكترونية</option>
                </select>
                <select
                  value={newTrCur}
                  onChange={(e) => setNewTrCur(e.target.value as CurrencyCode)}
                  className="v20-input px-2 py-1.5"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!newTrName.trim()) {
                      onNotify('error', 'أدخل اسم الصندوق أو الصراف.');
                      return;
                    }
                    const glAcc = chartOfAccounts.find((a) => a.code === '1111') || chartOfAccounts[0];
                    onSaveTreasuryAccount({
                      id: `tr-${Date.now()}`,
                      code: `TR-${treasuryAccounts.length + 1}`,
                      nameAr: newTrName.trim(),
                      type: newTrType,
                      categoryGroup: newTrType === 'صندوق' ? 'CASH_BOX' : 'EXCHANGE',
                      currency: newTrCur,
                      branchId: currentBranch.id,
                      generalLedgerAccountId: glAcc?.id || 'acc-1111',
                      balance: 0,
                      status: 'active',
                    });
                    setNewTrName('');
                    onNotify('success', 'تم إضافة الحساب المالي للخزينة.');
                  }}
                  className="px-3 py-1.5 rounded v20-btn-gold cursor-pointer"
                >
                  إضافة
                </button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {filteredTreasuries.map((t) => (
                  <div key={t.id} className="v20-card-alt px-3 py-2 flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-amber-300">{t.code}</span>
                        <span className={t.status === 'inactive' ? 'line-through text-slate-500' : ''}>{t.nameAr}</span>
                        <span className="text-slate-400">({t.type})</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-black text-[var(--gold)] tabular-nums">
                        {t.balance.toLocaleString()} {t.currency}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingTreasury({ ...t })}
                        className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] cursor-pointer"
                        title="تعديل الخزينة"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextStatus = t.status === 'active' ? 'inactive' : 'active';
                          onSaveTreasuryAccount({ ...t, status: nextStatus });
                          onNotify('info', nextStatus === 'active' ? `تم تفعيل ${t.nameAr}` : `تم إيقاف ${t.nameAr}`);
                        }}
                        className={`p-1 rounded border cursor-pointer ${
                          t.status === 'active'
                            ? 'bg-emerald-950/50 border-emerald-600/50 text-emerald-300'
                            : 'bg-rose-950/50 border-rose-600/50 text-rose-300'
                        }`}
                        title={t.status === 'active' ? 'إيقاف الحساب' : 'تفعيل الحساب'}
                      >
                        <Power className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Departments, Warehouses & Zones */}
            <div className="space-y-3">
              {/* Departments */}
              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-[var(--gold)]">دليل الأقسام والفئات ({departments.length})</h4>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    placeholder="اسم القسم..."
                    className="flex-1 v20-input px-2.5 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newDeptName.trim()) return;
                      onSaveDepartment({ id: `dept-${Date.now()}`, nameAr: newDeptName.trim() });
                      setNewDeptName('');
                      onNotify('success', 'تم إضافة القسم.');
                    }}
                    className="px-3 py-1.5 rounded v20-btn-gold cursor-pointer"
                  >
                    إضافة قسم
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {departments.map((d) =>
                    editingDept?.id === d.id ? (
                      <div key={d.id} className="flex items-center gap-1 bg-[#08121E] border border-[var(--gold)] rounded px-1.5 py-0.5">
                        <input
                          type="text"
                          value={editingDept.nameAr}
                          onChange={(e) => setEditingDept({ ...editingDept, nameAr: e.target.value })}
                          className="bg-transparent text-white text-xs w-28 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (editingDept.nameAr.trim()) {
                              onSaveDepartment({ ...editingDept, nameAr: editingDept.nameAr.trim() });
                              onNotify('success', 'تم تحديث اسم القسم.');
                            }
                            setEditingDept(null);
                          }}
                          className="text-emerald-400 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setEditingDept({ ...d })}
                        className="px-2.5 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] font-bold flex items-center gap-1.5 cursor-pointer"
                        title="اضغط للتعديل"
                      >
                        <span>{d.nameAr}</span>
                        <Edit3 className="w-2.5 h-2.5 text-slate-400" />
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Warehouses */}
              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-[var(--gold)] flex items-center gap-1.5">
                  <WarehouseIcon className="w-4 h-4" />
                  <span>دليل المخازن والمستودعات ({filteredWarehouses.length})</span>
                </h4>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newWhName}
                    onChange={(e) => setNewWhName(e.target.value)}
                    placeholder="مستودع جديد..."
                    className="flex-1 v20-input px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newWhName.trim()) return;
                      onSaveWarehouse({
                        id: `wh-${Date.now()}`,
                        branchId: currentBranch.id,
                        code: `WH-${warehouses.length + 1}`,
                        nameAr: newWhName.trim(),
                        location: currentBranch.address,
                        keeperName: currentUser.fullName,
                        status: 'active',
                      });
                      setNewWhName('');
                      onNotify('success', 'تم إضافة المستودع.');
                    }}
                    className="px-3 py-1 rounded v20-btn-gold cursor-pointer"
                  >
                    + إضافة
                  </button>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {filteredWarehouses.map((w) => (
                    <div key={w.id} className="v20-card-alt px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] text-amber-300 ml-1.5">{w.code}</span>
                        <span className="font-bold text-white">{w.nameAr}</span>
                        <span className="text-[11px] text-slate-400 mr-2">· {w.keeperName}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingWarehouse({ ...w })}
                        className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Zones */}
              <div className="v20-card p-3 space-y-2">
                <h4 className="font-black text-sm text-[var(--gold)] flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  <span>دليل المناطق الجغرافية ({filteredZones.length})</span>
                </h4>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newZoneArea}
                    onChange={(e) => setNewZoneArea(e.target.value)}
                    placeholder="منطقة جغرافية جديدة..."
                    className="flex-1 v20-input px-2 py-1.5"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newZoneArea.trim()) return;
                      onSaveZone({
                        id: `reg-${Date.now()}`,
                        country: 'اليمن',
                        governorate: 'صنعاء',
                        district: newZoneArea.trim(),
                        area: newZoneArea.trim(),
                        code: `ZN-${regionalAreas.length + 1}`,
                      });
                      setNewZoneArea('');
                      onNotify('success', 'تم إضافة المنطقة.');
                    }}
                    className="px-3 py-1 rounded v20-btn-gold cursor-pointer"
                  >
                    + إضافة
                  </button>
                </div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {filteredZones.map((z) => (
                    <div key={z.id} className="v20-card-alt px-2.5 py-1.5 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] text-amber-300 ml-1.5">{z.code}</span>
                        <span className="font-bold text-white">{z.governorate} - {z.area}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingZone({ ...z })}
                        className="p-1 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form onSubmit={handleSaveEditedAccount} className="v20-card w-full max-w-md p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
              <h3 className="font-black text-sm text-[var(--gold)]">تعديل بيانات الحساب المحاسبي</h3>
              <button type="button" onClick={() => setEditingAccount(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-slate-300 font-bold mb-1">رمز الحساب *</label>
                <input
                  type="text"
                  required
                  value={editingAccount.code}
                  onChange={(e) => setEditingAccount({ ...editingAccount, code: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">العملة</label>
                <select
                  value={editingAccount.currency || 'YER'}
                  onChange={(e) => setEditingAccount({ ...editingAccount, currency: e.target.value as CurrencyCode })}
                  className="w-full v20-input px-2 py-1.5 cursor-pointer"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.nameAr})
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-slate-300 font-bold mb-1">اسم الحساب *</label>
                <input
                  type="text"
                  required
                  value={editingAccount.nameAr}
                  onChange={(e) => setEditingAccount({ ...editingAccount, nameAr: e.target.value })}
                  className="w-full v20-input px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">التصنيف</label>
                <select
                  value={editingAccount.category}
                  onChange={(e) => setEditingAccount({ ...editingAccount, category: e.target.value as AccountCategory })}
                  className="w-full v20-input px-2 py-1.5 cursor-pointer"
                >
                  <option value="أصول">أصول</option>
                  <option value="خصوم">خصوم</option>
                  <option value="حقوق_ملكية">حقوق ملكية</option>
                  <option value="إيرادات">إيرادات</option>
                  <option value="مصروفات">مصروفات</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">الطبيعة</label>
                <select
                  value={editingAccount.nature}
                  onChange={(e) => setEditingAccount({ ...editingAccount, nature: e.target.value as 'debit' | 'credit' })}
                  className="w-full v20-input px-2 py-1.5 cursor-pointer"
                >
                  <option value="debit">مدين (Debit)</option>
                  <option value="credit">دائن (Credit)</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editingAccount.isLeaf}
                onChange={(e) => setEditingAccount({ ...editingAccount, isLeaf: e.target.checked })}
                className="w-4 h-4 accent-amber-400"
              />
              <span>حساب فرعي يقبل الترحيل (Leaf Account)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-strong)]">
              <button type="button" onClick={() => setEditingAccount(null)} className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] cursor-pointer">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer">
                حفظ التعديلات
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Treasury Modal */}
      {editingTreasury && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingTreasury.nameAr.trim()) return;
              onSaveTreasuryAccount({ ...editingTreasury, nameAr: editingTreasury.nameAr.trim() });
              setEditingTreasury(null);
              onNotify('success', 'تم تحديث بيانات الخزينة.');
            }}
            className="v20-card w-full max-w-sm p-4 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
              <h3 className="font-black text-sm text-[var(--gold)]">تعديل الصندوق / الحساب</h3>
              <button type="button" onClick={() => setEditingTreasury(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">الاسم *</label>
              <input
                type="text"
                required
                value={editingTreasury.nameAr}
                onChange={(e) => setEditingTreasury({ ...editingTreasury, nameAr: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-300 font-bold mb-1">النوع</label>
                <select
                  value={editingTreasury.type}
                  onChange={(e) => setEditingTreasury({ ...editingTreasury, type: e.target.value as TreasuryAccount['type'] })}
                  className="w-full v20-input px-2 py-1.5"
                >
                  <option value="صندوق">صندوق</option>
                  <option value="بنك">بنك / صرافة</option>
                  <option value="محفظة">محفظة</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-300 font-bold mb-1">العملة</label>
                <select
                  value={editingTreasury.currency}
                  onChange={(e) => setEditingTreasury({ ...editingTreasury, currency: e.target.value as CurrencyCode })}
                  className="w-full v20-input px-2 py-1.5"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-strong)]">
              <button type="button" onClick={() => setEditingTreasury(null)} className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] cursor-pointer">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Warehouse Modal */}
      {editingWarehouse && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingWarehouse.nameAr.trim()) return;
              onSaveWarehouse({ ...editingWarehouse, nameAr: editingWarehouse.nameAr.trim() });
              setEditingWarehouse(null);
              onNotify('success', 'تم تحديث بيانات المستودع.');
            }}
            className="v20-card w-full max-w-sm p-4 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
              <h3 className="font-black text-sm text-[var(--gold)]">تعديل بيانات المستودع</h3>
              <button type="button" onClick={() => setEditingWarehouse(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">اسم المستودع *</label>
              <input
                type="text"
                required
                value={editingWarehouse.nameAr}
                onChange={(e) => setEditingWarehouse({ ...editingWarehouse, nameAr: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">أمين المستودع</label>
              <input
                type="text"
                value={editingWarehouse.keeperName}
                onChange={(e) => setEditingWarehouse({ ...editingWarehouse, keeperName: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">الموقع</label>
              <input
                type="text"
                value={editingWarehouse.location}
                onChange={(e) => setEditingWarehouse({ ...editingWarehouse, location: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-strong)]">
              <button type="button" onClick={() => setEditingWarehouse(null)} className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] cursor-pointer">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Regional Zone Modal */}
      {editingZone && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingZone.area.trim()) return;
              onSaveZone({ ...editingZone, area: editingZone.area.trim() });
              setEditingZone(null);
              onNotify('success', 'تم تحديث المنطقة الجغرافية.');
            }}
            className="v20-card w-full max-w-sm p-4 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-2">
              <h3 className="font-black text-sm text-[var(--gold)]">تعديل المنطقة الجغرافية</h3>
              <button type="button" onClick={() => setEditingZone(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">المحافظة</label>
              <input
                type="text"
                value={editingZone.governorate}
                onChange={(e) => setEditingZone({ ...editingZone, governorate: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">المديرية</label>
              <input
                type="text"
                value={editingZone.district}
                onChange={(e) => setEditingZone({ ...editingZone, district: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-bold mb-1">اسم المنطقة *</label>
              <input
                type="text"
                required
                value={editingZone.area}
                onChange={(e) => setEditingZone({ ...editingZone, area: e.target.value })}
                className="w-full v20-input px-2.5 py-1.5"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-strong)]">
              <button type="button" onClick={() => setEditingZone(null)} className="px-3 py-1.5 rounded bg-[#08121E] border border-[var(--border-strong)] cursor-pointer">
                إلغاء
              </button>
              <button type="submit" className="px-4 py-1.5 rounded v20-btn-gold cursor-pointer">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
