/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - HR & Payroll Module
 */

import React, { useState, useMemo } from 'react';
import {
  UserCheck,
  Plus,
  DollarSign,
  X,
  FileDown,
  FileSpreadsheet,
} from 'lucide-react';
import {
  Employee,
  PayrollRun,
  TreasuryAccount,
  Branch,
  Company,
  TableColumnPref,
} from '../../../types/erp';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { generateNextDocNumber } from '../../../services/storageService';
import { downloadReportAsPDF, exportToExcel } from '../../../services/exportService';

interface HrPayrollModuleProps {
  employees: Employee[];
  payrollRuns: PayrollRun[];
  treasuryAccounts: TreasuryAccount[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  canPostEntries?: boolean;
  savedColumnPrefs?: Record<string, TableColumnPref[]>;
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onSaveEmployee: (employee: Employee) => void;
  onDisbursePayroll: (payroll: PayrollRun) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const HrPayrollModule: React.FC<HrPayrollModuleProps> = ({
  employees,
  payrollRuns,
  treasuryAccounts,
  currentBranch,
  company,
  currencySymbol,
  canPostEntries = true,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onSaveEmployee,
  onDisbursePayroll,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'employees' | 'payroll'>('employees');

  // New Employee Modal
  const [isEmployeeModalOpen, setIsEmployeeModalOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('الشؤون المالية');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [basicSalary, setBasicSalary] = useState(300000);
  const [housingAllowance, setHousingAllowance] = useState(60000);
  const [transportAllowance, setTransportAllowance] = useState(40000);

  // New Payroll Run Modal
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [payrollMonth, setPayrollMonth] = useState('2026-03');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState(treasuryAccounts[0]?.id || '');

  const handleSaveEmployeeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim()) {
      onNotify?.('error', 'يرجى إدخال اسم الموظف.');
      return;
    }

    const code = generateNextDocNumber(
      'EMP-',
      employees.map((x) => x.code),
      3
    );

    const newEmp: Employee = {
      id: `emp-${Date.now()}`,
      code,
      nameAr: nameAr.trim(),
      jobTitle: jobTitle.trim(),
      department,
      phone: phone.trim(),
      nationalId: nationalId.trim(),
      hireDate: new Date().toISOString().split('T')[0],
      basicSalary: Number(basicSalary) || 0,
      housingAllowance: Number(housingAllowance) || 0,
      transportAllowance: Number(transportAllowance) || 0,
      otherAllowances: 0,
      status: 'active',
      currentLoanBalance: 0,
    };

    onSaveEmployee(newEmp);
    onNotify?.('success', `تم تسجيل الموظف "${newEmp.nameAr}" بكود (${code}) بنجاح.`);
    setIsEmployeeModalOpen(false);
    setNameAr('');
    setJobTitle('');
    setPhone('');
    setNationalId('');
  };

  const handleDisbursePayrollSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPostEntries) {
      onNotify?.('error', 'صلاحياتك الحالية لا تسمح باعتماد وصرف مسيرات الرواتب.');
      return;
    }

    const activeEmployees = employees.filter((emp) => emp.status === 'active');
    if (activeEmployees.length === 0) {
      onNotify?.('error', 'لا يوجد موظفون نشطون لصرف مسير الرواتب.');
      return;
    }

    const items = activeEmployees.map((emp) => {
      const allowances = emp.housingAllowance + emp.transportAllowance + emp.otherAllowances;
      const gross = emp.basicSalary + allowances;
      const taxSocial = Math.round(gross * 0.05);
      const loanDed = Math.min(emp.currentLoanBalance, 25000);
      const net = gross - taxSocial - loanDed;

      return {
        employeeId: emp.id,
        employeeName: emp.nameAr,
        basicSalary: emp.basicSalary,
        totalAllowances: allowances,
        grossSalary: gross,
        loanDeduction: loanDed,
        taxOrSocialDeductions: taxSocial,
        otherDeductions: 0,
        netSalary: net,
      };
    });

    const totalGross = items.reduce((s, i) => s + i.grossSalary, 0);
    const totalDeductions = items.reduce((s, i) => s + i.taxOrSocialDeductions + i.loanDeduction, 0);
    const totalNet = items.reduce((s, i) => s + i.netSalary, 0);

    const payrollNumber = generateNextDocNumber(
      `PAY-${payrollMonth}-`,
      payrollRuns.map((p) => p.payrollNumber),
      2
    );

    const newPayroll: PayrollRun = {
      id: `pr-${Date.now()}`,
      payrollNumber,
      month: payrollMonth,
      branchId: currentBranch.id,
      disbursementTreasuryId: selectedTreasuryId,
      items,
      totalGross,
      totalDeductions,
      totalNet,
      status: 'disbursed',
      disbursedDate: new Date().toISOString().split('T')[0],
      createdBy: 'المدير المالي',
    };

    onDisbursePayroll(newPayroll);
    setIsPayrollModalOpen(false);
    onNotify?.(
      'success',
      `تم اعتماد وصرف مسير رواتب شهر ${payrollMonth} (${payrollNumber}) بمبلغ صافي (${totalNet.toLocaleString()} ${currencySymbol}) وترحيل قيده المحاسبي.`
    );
  };

  const employeeColumns: ErpTableColumn<Employee>[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'كود الموظف',
        sortable: true,
        sortValue: (e) => e.code,
        searchValue: (e) => e.code,
        render: (e) => <span className="font-mono font-bold text-amber-400">{e.code}</span>,
      },
      {
        key: 'nameAr',
        label: 'اسم الموظف',
        sortable: true,
        sortValue: (e) => e.nameAr,
        searchValue: (e) => e.nameAr,
        render: (e) => <span className="font-semibold text-slate-100">{e.nameAr}</span>,
      },
      {
        key: 'jobTitle',
        label: 'المسمى الوظيفي',
        sortable: true,
        sortValue: (e) => e.jobTitle,
        searchValue: (e) => e.jobTitle,
        render: (e) => <span className="text-slate-300">{e.jobTitle}</span>,
      },
      {
        key: 'department',
        label: 'القسم / الإدارة',
        sortable: true,
        sortValue: (e) => e.department,
        searchValue: (e) => e.department,
        render: (e) => <span className="text-slate-400">{e.department}</span>,
      },
      {
        key: 'phone',
        label: 'الهاتف',
        searchValue: (e) => e.phone,
        render: (e) => <span className="font-mono text-slate-300">{e.phone || '-'}</span>,
      },
      {
        key: 'basicSalary',
        label: 'الأساسي',
        align: 'left',
        sortable: true,
        sortValue: (e) => e.basicSalary,
        render: (e) => <span className="font-mono text-slate-300">{e.basicSalary.toLocaleString()}</span>,
      },
      {
        key: 'allowances',
        label: 'البدلات',
        align: 'left',
        sortable: true,
        sortValue: (e) => e.housingAllowance + e.transportAllowance + e.otherAllowances,
        render: (e) => (
          <span className="font-mono text-slate-400">
            {(e.housingAllowance + e.transportAllowance + e.otherAllowances).toLocaleString()}
          </span>
        ),
      },
      {
        key: 'gross',
        label: `إجمالي الراتب (${currencySymbol})`,
        align: 'left',
        sortable: true,
        sortValue: (e) => e.basicSalary + e.housingAllowance + e.transportAllowance + e.otherAllowances,
        render: (e) => (
          <span className="font-mono font-bold text-amber-400">
            {(e.basicSalary + e.housingAllowance + e.transportAllowance + e.otherAllowances).toLocaleString()}
          </span>
        ),
        footerRender: (rows) => (
          <span className="font-mono font-black text-amber-300">
            {rows
              .reduce((s, e) => s + e.basicSalary + e.housingAllowance + e.transportAllowance + e.otherAllowances, 0)
              .toLocaleString()}{' '}
            {currencySymbol}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        render: (e) => (
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              e.status === 'active'
                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            {e.status === 'active' ? 'على رأس العمل' : e.status === 'on_leave' ? 'إجازة' : 'منتهي الخدمة'}
          </span>
        ),
      },
    ],
    [currencySymbol]
  );

  const payrollColumns: ErpTableColumn<PayrollRun>[] = useMemo(
    () => [
      {
        key: 'payrollNumber',
        label: 'رقم المسير',
        sortable: true,
        sortValue: (p) => p.payrollNumber,
        searchValue: (p) => p.payrollNumber,
        render: (p) => <span className="font-mono font-bold text-amber-400">{p.payrollNumber}</span>,
      },
      {
        key: 'month',
        label: 'شهر الاستحقاق',
        sortable: true,
        sortValue: (p) => p.month,
        render: (p) => <span className="font-mono font-semibold text-slate-200">{p.month}</span>,
      },
      {
        key: 'disbursedDate',
        label: 'تاريخ الصرف',
        sortable: true,
        sortValue: (p) => p.disbursedDate || '',
        render: (p) => <span className="font-mono text-slate-400">{p.disbursedDate || '-'}</span>,
      },
      {
        key: 'count',
        label: 'عدد الموظفين',
        align: 'center',
        render: (p) => <span className="font-mono text-slate-200">{p.items.length}</span>,
      },
      {
        key: 'totalGross',
        label: 'إجمالي الرواتب',
        align: 'left',
        sortable: true,
        sortValue: (p) => p.totalGross,
        render: (p) => <span className="font-mono text-slate-300">{p.totalGross.toLocaleString()}</span>,
      },
      {
        key: 'totalDeductions',
        label: 'الاستقطاعات',
        align: 'left',
        sortable: true,
        sortValue: (p) => p.totalDeductions,
        render: (p) => <span className="font-mono text-rose-400">{p.totalDeductions.toLocaleString()}</span>,
      },
      {
        key: 'totalNet',
        label: `صافي المنصرف (${currencySymbol})`,
        align: 'left',
        sortable: true,
        sortValue: (p) => p.totalNet,
        render: (p) => (
          <span className="font-mono font-black text-emerald-400">{p.totalNet.toLocaleString()}</span>
        ),
        footerRender: (rows) => (
          <span className="font-mono font-black text-emerald-300">
            {rows.reduce((s, r) => s + r.totalNet, 0).toLocaleString()} {currencySymbol}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        render: () => (
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded text-[10px] font-bold">
            تم الصرف وترحيل القيد
          </span>
        ),
      },
    ],
    [currencySymbol]
  );

  const handleExportPdf = async () => {
    if (activeTab === 'employees') {
      await downloadReportAsPDF({
        title: 'دليل الموظفين وكشف الرواتب الأساسية',
        company,
        branch: currentBranch,
        tables: [
          {
            title: 'بيانات الموظفين',
            headers: ['الكود', 'الاسم', 'المسمى', 'القسم', 'الأساسي', 'البدلات', 'الإجمالي'],
            rows: employees.map((e) => {
              const al = e.housingAllowance + e.transportAllowance + e.otherAllowances;
              return [e.code, e.nameAr, e.jobTitle, e.department, e.basicSalary.toLocaleString(), al.toLocaleString(), (e.basicSalary + al).toLocaleString()];
            }),
          },
        ],
        fileName: `الموظفين_${new Date().toISOString().split('T')[0]}`,
      });
    } else {
      await downloadReportAsPDF({
        title: 'سجل مسيرات الرواتب المعتمدة',
        company,
        branch: currentBranch,
        tables: [
          {
            title: 'مسيرات الرواتب',
            headers: ['رقم المسير', 'الشهر', 'تاريخ الصرف', 'الموظفين', 'الإجمالي', 'الاستقطاعات', 'الصافي'],
            rows: payrollRuns.map((p) => [
              p.payrollNumber,
              p.month,
              p.disbursedDate || '-',
              p.items.length,
              p.totalGross.toLocaleString(),
              p.totalDeductions.toLocaleString(),
              p.totalNet.toLocaleString(),
            ]),
          },
        ],
        fileName: `مسيرات_الرواتب_${new Date().toISOString().split('T')[0]}`,
      });
    }
    onNotify?.('success', 'تم تصدير كشف الموارد البشرية بصيغة PDF بنجاح.');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">الموارد البشرية والرواتب والأجور</h2>
          </div>
          <p className="text-xs text-slate-400">
            ملفات الموظفين، مسيرات الرواتب الشهرية، الاستقطاعات والبدلات، وصرف المستحقات مع القيود المحاسبية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('employees')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'employees'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              دليل الموظفين ({employees.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payroll')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'payroll'
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              مسيرات الرواتب ({payrollRuns.length})
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>PDF</span>
          </button>

          <button
            type="button"
            onClick={() => {
              exportToExcel({
                fileName: activeTab === 'employees' ? 'دليل_الموظفين' : 'مسيرات_الرواتب',
                sheets: [
                  activeTab === 'employees'
                    ? {
                        name: 'الموظفين',
                        data: [
                          ['الكود', 'الاسم', 'المسمى', 'القسم', 'الهاتف', 'الأساسي', 'البدلات', 'الإجمالي'],
                          ...employees.map((e) => {
                            const al = e.housingAllowance + e.transportAllowance + e.otherAllowances;
                            return [e.code, e.nameAr, e.jobTitle, e.department, e.phone, e.basicSalary, al, e.basicSalary + al];
                          }),
                        ],
                      }
                    : {
                        name: 'الرواتب',
                        data: [
                          ['رقم المسير', 'الشهر', 'تاريخ الصرف', 'عدد الموظفين', 'الإجمالي', 'الاستقطاعات', 'الصافي'],
                          ...payrollRuns.map((p) => [p.payrollNumber, p.month, p.disbursedDate || '-', p.items.length, p.totalGross, p.totalDeductions, p.totalNet]),
                        ],
                      },
                ],
              });
              onNotify?.('success', 'تم تصدير ملف Excel بنجاح.');
            }}
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>

          {activeTab === 'employees' ? (
            <button
              type="button"
              onClick={() => setIsEmployeeModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة موظف جديد</span>
            </button>
          ) : (
            canPostEntries && (
              <button
                type="button"
                onClick={() => setIsPayrollModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
              >
                <DollarSign className="w-4 h-4" />
                <span>إعداد وصرف مسير الرواتب</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* TAB 1: EMPLOYEES */}
      {activeTab === 'employees' && (
        <ErpDataTable<Employee>
          tableId="hr-employees"
          title="دليل الموظفين"
          data={employees}
          columns={employeeColumns}
          getRowId={(e) => e.id}
          searchPlaceholder="بحث باسم الموظف، الكود، المسمى الوظيفي، القسم..."
          savedColumnPrefs={savedColumnPrefs?.['hr-employees']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          defaultSortKey="code"
          defaultSortDir="asc"
        />
      )}

      {/* TAB 2: PAYROLL RUNS */}
      {activeTab === 'payroll' && (
        <ErpDataTable<PayrollRun>
          tableId="hr-payrolls"
          title="سجل مسيرات الرواتب المعتمدة"
          data={payrollRuns}
          columns={payrollColumns}
          getRowId={(p) => p.id}
          searchPlaceholder="بحث برقم المسير أو الشهر..."
          savedColumnPrefs={savedColumnPrefs?.['hr-payrolls']}
          onSaveColumnPrefs={onSaveColumnPrefs}
          defaultSortKey="month"
          defaultSortDir="desc"
        />
      )}

      {/* MODAL: ADD EMPLOYEE */}
      {isEmployeeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">إضافة موظف جديد</h3>
              <button
                type="button"
                onClick={() => setIsEmployeeModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeeSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">اسم الموظف الرباعي *</label>
                  <input
                    type="text"
                    required
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    placeholder="مثال: عبد العزيز محمد الشامي"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">المسمى الوظيفي *</label>
                  <input
                    type="text"
                    required
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="مثال: محاسب تكاليف"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">القسم / الإدارة</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="الشؤون المالية">الشؤون المالية</option>
                    <option value="المبيعات والتسويق">المبيعات والتسويق</option>
                    <option value="المخازن واللوجستيات">المخازن واللوجستيات</option>
                    <option value="الإدارة العليا">الإدارة العليا</option>
                    <option value="تقنية المعلومات">تقنية المعلومات</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم الهاتف</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="967771234567"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الرقم الوطني / البطاقة</label>
                  <input
                    type="text"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الراتب الأساسي ({currencySymbol}) *</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">بدل سكن ({currencySymbol})</label>
                  <input
                    type="number"
                    min={0}
                    value={housingAllowance}
                    onChange={(e) => setHousingAllowance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">بدل مواصلات ({currencySymbol})</label>
                  <input
                    type="number"
                    min={0}
                    value={transportAllowance}
                    onChange={(e) => setTransportAllowance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsEmployeeModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg transition-colors cursor-pointer"
                >
                  حفظ بيانات الموظف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DISBURSE PAYROLL */}
      {isPayrollModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">إعداد وصرف مسير الرواتب</h3>
              <button
                type="button"
                onClick={() => setIsPayrollModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleDisbursePayrollSubmit} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">شهر الاستحقاق *</label>
                <input
                  type="month"
                  required
                  value={payrollMonth}
                  onChange={(e) => setPayrollMonth(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">الصندوق / الحساب البنكي للصرف *</label>
                <select
                  value={selectedTreasuryId}
                  onChange={(e) => setSelectedTreasuryId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                >
                  {treasuryAccounts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameAr} ({t.balance.toLocaleString()} {t.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1.5">
                <span className="font-bold text-slate-300 block">الملخص التقديري للمسير:</span>
                <p className="text-slate-400">
                  عدد الموظفين النشطين: <strong className="text-white font-mono">{employees.filter((e) => e.status === 'active').length} موظف</strong>
                </p>
                <p className="text-slate-400">سيتم إنشاء قيد استحقاق وصرف تلقائي بحساب الرواتب (5210) وخصم الصافي من الصندوق المختار.</p>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsPayrollModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors cursor-pointer"
                >
                  اعتماد وصرف الرواتب الآن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
