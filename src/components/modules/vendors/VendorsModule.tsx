/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Vendors Management Module
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Building,
  Plus,
  MessageCircle,
  Eye,
  Printer,
  Edit,
  X,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  Vendor,
  Invoice,
  PaymentVoucher,
  Branch,
  JournalEntry,
  Company,
  WhatsAppTemplates,
  TableColumnPref,
} from '../../../types/erp';
import { generateVendorStatement, StatementRow } from '../../../services/accountingEngine';
import { PrintableDocumentData } from '../../common/PrintModal';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import {
  downloadReportAsPDF,
  exportToExcel,
  exportToCSV,
} from '../../../services/exportService';
import { generateNextDocNumber } from '../../../services/storageService';

interface VendorsModuleProps {
  vendors: Vendor[];
  invoices: Invoice[];
  paymentVouchers: PaymentVoucher[];
  journalEntries?: JournalEntry[];
  currentBranch: Branch;
  company?: Company;
  currencySymbol: string;
  whatsappTemplates?: WhatsAppTemplates;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  focusedRecordId?: string;
  onSaveVendor: (vendor: Vendor) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const VendorsModule: React.FC<VendorsModuleProps> = ({
  vendors,
  invoices,
  paymentVouchers,
  journalEntries = [],
  currentBranch,
  company,
  currencySymbol,
  whatsappTemplates,
  savedColumnPrefs,
  onSaveColumnPrefs,
  focusedRecordId,
  onSaveVendor,
  onOpenPrintModal,
  onNotify,
}) => {
  const [filterCategory, setFilterCategory] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [viewingVendor, setViewingVendor] = useState<Vendor | null>(null);
  const [waVendor, setWaVendor] = useState<Vendor | null>(null);
  const [formError, setFormError] = useState('');

  // Form State
  const [formNameAr, setFormNameAr] = useState('');
  const [formCommercialName, setFormCommercialName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formWhatsapp, setFormWhatsapp] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formCategory, setFormCategory] = useState<Vendor['category']>('مورد رئيسي');
  const [formOpeningBalance, setFormOpeningBalance] = useState(0);
  const [formPaymentTermDays, setFormPaymentTermDays] = useState(30);
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (!focusedRecordId) return;
    const match = vendors.find((v) => v.id === focusedRecordId || v.code === focusedRecordId);
    if (match) setViewingVendor(match);
  }, [focusedRecordId, vendors]);

  const openNewVendorModal = () => {
    setFormError('');
    setEditingVendor(null);
    setFormNameAr('');
    setFormCommercialName('');
    setFormPhone('');
    setFormWhatsapp('');
    setFormAddress('');
    setFormCategory('مورد رئيسي');
    setFormOpeningBalance(0);
    setFormPaymentTermDays(30);
    setFormNotes('');
    setIsModalOpen(true);
  };

  const openEditVendorModal = (v: Vendor) => {
    setFormError('');
    setEditingVendor(v);
    setFormNameAr(v.nameAr);
    setFormCommercialName(v.commercialName || '');
    setFormPhone(v.phone);
    setFormWhatsapp(v.whatsapp || v.phone);
    setFormAddress(v.address);
    setFormCategory(v.category);
    setFormOpeningBalance(v.openingBalance);
    setFormPaymentTermDays(v.paymentTermDays);
    setFormNotes(v.notes || '');
    setIsModalOpen(true);
  };

  const handleSaveVendorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formNameAr.trim() || !formPhone.trim()) {
      setFormError('يرجى كتابة اسم المورد ورقم الهاتف.');
      return;
    }

    const nextCode = editingVendor
      ? editingVendor.code
      : generateNextDocNumber(
          'VEND-',
          vendors.map((v) => v.code),
          4
        );

    const newVendor: Vendor = {
      id: editingVendor ? editingVendor.id : `vend-${Date.now()}`,
      branchId: currentBranch.id,
      code: nextCode,
      nameAr: formNameAr.trim(),
      commercialName: formCommercialName.trim() || undefined,
      phone: formPhone.trim(),
      whatsapp: formWhatsapp.trim() || formPhone.trim(),
      address: formAddress.trim(),
      category: formCategory,
      openingBalance: Number(formOpeningBalance) || 0,
      currentBalance: editingVendor ? editingVendor.currentBalance : Number(formOpeningBalance) || 0,
      paymentTermDays: Number(formPaymentTermDays) || 30,
      status: 'active',
      notes: formNotes.trim() || undefined,
      createdAt: editingVendor ? editingVendor.createdAt : new Date().toISOString().split('T')[0],
    };

    onSaveVendor(newVendor);
    onNotify?.('success', editingVendor ? `تم تحديث بيانات المورد ${newVendor.nameAr}.` : `تم تسجيل المورد الجديد ${newVendor.nameAr} (${newVendor.code}).`);
    setIsModalOpen(false);
  };

  const filteredVendors = useMemo(
    () => vendors.filter((v) => filterCategory === 'all' || v.category === filterCategory),
    [vendors, filterCategory]
  );

  const activeStatement: StatementRow[] = useMemo(() => {
    if (!viewingVendor) return [];
    return generateVendorStatement(viewingVendor.id, viewingVendor, invoices, paymentVouchers, journalEntries);
  }, [viewingVendor, invoices, paymentVouchers, journalEntries]);

  const handlePrintStatement = (v: Vendor) => {
    const stmt = generateVendorStatement(v.id, v, invoices, paymentVouchers, journalEntries);
    const docData: PrintableDocumentData = {
      title: 'كشف حساب مورد معتمد',
      documentNumber: `STMT-${v.code}`,
      date: new Date().toISOString().split('T')[0],
      entityName: v.nameAr,
      entityPhone: v.phone,
      entityAddress: v.address,
      currencySymbol,
      items: stmt.map((row, idx) => ({
        index: idx + 1,
        description: `${row.date} | ${row.documentType} (${row.documentNumber}) - ${row.statement}`,
        unit: row.credit >= row.debit ? 'دائن' : 'مدين',
        quantity: 1,
        unitPrice: Math.abs(row.credit - row.debit),
        total: row.balance,
      })),
      totals: {
        subtotal: v.openingBalance,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: v.currentBalance,
        remainingAmount: v.currentBalance,
      },
      notes: `فترة السداد المتفق عليها: ${v.paymentTermDays} يوماً · إجمالي الحركات: ${stmt.length}`,
      amountInWords: `صافي المستحق للمورد: ${v.currentBalance.toLocaleString()} ${currencySymbol} فقط لا غير.`,
    };
    onOpenPrintModal(docData);
  };

  const handleDownloadStatementPDF = async (v: Vendor) => {
    const stmt = generateVendorStatement(v.id, v, invoices, paymentVouchers, journalEntries);
    await downloadReportAsPDF({
      title: `كشف حساب مورد - ${v.nameAr}`,
      subtitle: `كود المورد: ${v.code} · هاتف: ${v.phone}`,
      company,
      branch: currentBranch,
      metadata: {
        المورد: v.nameAr,
        التصنيف: v.category,
        'الرصيد الافتتاحي': `${v.openingBalance.toLocaleString()} ${currencySymbol}`,
        'المستحق الحالي': `${v.currentBalance.toLocaleString()} ${currencySymbol}`,
      },
      tables: [
        {
          headers: ['التاريخ', 'المستند', 'الرقم', 'البيان', 'مدين (-)', 'دائن (+)', 'الرصيد التراكمي'],
          rows: stmt.map((r) => [r.date, r.documentType, r.documentNumber, r.statement, r.debit, r.credit, r.balance]),
          totals: [
            'الإجمالي',
            '',
            '',
            '',
            stmt.reduce((s, r) => s + r.debit, 0),
            stmt.reduce((s, r) => s + r.credit, 0),
            v.currentBalance,
          ],
        },
      ],
      fileName: `كشف_حساب_مورد_${v.code}`,
    });
  };

  const viewingIdx = viewingVendor ? filteredVendors.findIndex((v) => v.id === viewingVendor.id) : -1;

  const columns: ErpTableColumn<Vendor>[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'كود المورد',
        sortValue: (v) => v.code,
        render: (v) => <span className="font-mono font-bold text-amber-400">{v.code}</span>,
      },
      {
        key: 'nameAr',
        label: 'اسم المورد / الشركة',
        sortValue: (v) => v.nameAr,
        searchValue: (v) => `${v.nameAr} ${v.commercialName || ''} ${v.address || ''}`,
        render: (v) => (
          <div>
            <strong className="text-slate-100 block">{v.nameAr}</strong>
            {v.commercialName && <span className="text-[11px] text-slate-400 block">{v.commercialName}</span>}
          </div>
        ),
      },
      {
        key: 'phone',
        label: 'الهاتف / واتساب',
        sortValue: (v) => v.phone,
        render: (v) => (
          <div className="flex items-center gap-1.5 font-mono text-slate-300">
            <span>{v.phone}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setWaVendor(v);
              }}
              title="مراسلة عبر واتساب"
              className="text-emerald-400 hover:text-emerald-300 p-1 rounded hover:bg-emerald-950/40 cursor-pointer"
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        ),
      },
      {
        key: 'address',
        label: 'العنوان',
        sortValue: (v) => v.address,
        render: (v) => <span className="text-slate-400">{v.address || '—'}</span>,
      },
      {
        key: 'category',
        label: 'التصنيف',
        align: 'center',
        sortValue: (v) => v.category,
        render: (v) => (
          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px] font-semibold border border-slate-700">
            {v.category}
          </span>
        ),
      },
      {
        key: 'currentBalance',
        label: `المستحق للمورد (${currencySymbol})`,
        align: 'left',
        sortValue: (v) => v.currentBalance,
        render: (v) => (
          <span className="font-mono font-bold text-amber-400 tabular-nums">
            {v.currentBalance.toLocaleString()}
          </span>
        ),
        footerRender: (rows) =>
          `${rows.reduce((s, r) => s + r.currentBalance, 0).toLocaleString()} ${currencySymbol}`,
      },
      {
        key: 'actions',
        label: 'الإجراءات',
        align: 'center',
        sortable: false,
        render: (v) => (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setViewingVendor(v)}
              title="كشف حساب المورد"
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadStatementPDF(v)}
              title="تنزيل كشف الحساب PDF"
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePrintStatement(v)}
              title="طباعة كشف الحساب"
              className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => openEditVendorModal(v)}
              title="تعديل بيانات المورد"
              className="p-1.5 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Edit className="w-4 h-4" />
            </button>
          </div>
        ),
      },
    ],
    [currencySymbol]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة الموردين والشركات الموردة</h2>
          </div>
          <p className="text-xs text-slate-400">
            تتبع أرصدة الموردين، فواتير المشتريات، وسندات الصرف والذمم الدائنة وكشوف الحساب PDF وواتساب
          </p>
        </div>

        <button
          type="button"
          onClick={openNewVendorModal}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مورد جديد</span>
        </button>
      </div>

      {/* Vendors Data Table */}
      <ErpDataTable<Vendor>
        tableId="vendors-list"
        title="دليل الموردين"
        data={filteredVendors}
        columns={columns}
        getRowId={(v) => v.id}
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        searchPlaceholder="بحث باسم المورد، الكود، الهاتف..."
        selectable
        defaultSortKey="currentBalance"
        defaultSortDir="desc"
        onRowClick={(v) => setViewingVendor(v)}
        filtersSlot={
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="all">جميع التصنيفات</option>
            <option value="مورد رئيسي">مورد رئيسي</option>
            <option value="محلي">محلي</option>
            <option value="خارجي">خارجي</option>
            <option value="خدمات">خدمات</option>
          </select>
        }
        actionsSlot={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                void downloadReportAsPDF({
                  title: 'تقرير أرصدة ومستحقات الموردين',
                  company,
                  branch: currentBranch,
                  tables: [
                    {
                      headers: ['الكود', 'اسم المورد', 'الهاتف', 'التصنيف', 'المستحق للمورد'],
                      rows: filteredVendors.map((v) => [v.code, v.nameAr, v.phone, v.category, v.currentBalance]),
                      totals: [
                        'الإجمالي',
                        `${filteredVendors.length} مورد`,
                        '',
                        '',
                        filteredVendors.reduce((s, v) => s + v.currentBalance, 0),
                      ],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportToExcel({
                  fileName: `قائمة_الموردين_${new Date().toISOString().slice(0, 10)}`,
                  sheets: [
                    {
                      name: 'الموردين',
                      data: [
                        ['الكود', 'اسم المورد', 'الهاتف', 'العنوان', 'التصنيف', 'المستحق'],
                        ...filteredVendors.map((v) => [v.code, v.nameAr, v.phone, v.address, v.category, v.currentBalance]),
                      ],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportToCSV(
                  `قائمة_الموردين_${new Date().toISOString().slice(0, 10)}`,
                  ['الكود', 'اسم المورد', 'الهاتف', 'التصنيف', 'المستحق'],
                  filteredVendors.map((v) => [v.code, v.nameAr, v.phone, v.category, v.currentBalance])
                )
              }
              className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              CSV
            </button>
          </div>
        }
        bulkActionsSlot={(selected) => (
          <button
            type="button"
            onClick={() =>
              exportToExcel({
                fileName: `موردين_محددين_${new Date().toISOString().slice(0, 10)}`,
                sheets: [
                  {
                    name: 'الموردين',
                    data: [
                      ['الكود', 'الاسم', 'الهاتف', 'المستحق'],
                      ...selected.map((v) => [v.code, v.nameAr, v.phone, v.currentBalance]),
                    ],
                  },
                ],
              })
            }
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
          >
            Excel ({selected.length})
          </button>
        )}
      />

      {/* VIEW VENDOR STATEMENT MODAL WITH PREV / NEXT */}
      {viewingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">كشف حساب المورد: {viewingVendor.nameAr}</h3>
                  <p className="text-xs text-slate-400">
                    كود: <span className="font-mono text-amber-400">{viewingVendor.code}</span> · هاتف:{' '}
                    <span className="font-mono">{viewingVendor.phone}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={viewingIdx <= 0}
                  onClick={() => viewingIdx > 0 && setViewingVendor(filteredVendors[viewingIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={viewingIdx < 0 || viewingIdx >= filteredVendors.length - 1}
                  onClick={() =>
                    viewingIdx >= 0 &&
                    viewingIdx < filteredVendors.length - 1 &&
                    setViewingVendor(filteredVendors[viewingIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadStatementPDF(viewingVendor)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintStatement(viewingVendor)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWaVendor(viewingVendor)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>واتساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingVendor(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/70 border-b border-slate-800 text-xs">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">الرصيد الافتتاحي:</span>
                <span className="text-base font-bold font-mono text-slate-200 tabular-nums">
                  {viewingVendor.openingBalance.toLocaleString()} {currencySymbol}
                </span>
              </div>
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">صافي المستحق للمورد الحالي:</span>
                <span className="text-base font-black font-mono text-amber-400 tabular-nums">
                  {viewingVendor.currentBalance.toLocaleString()} {currencySymbol}
                </span>
              </div>
            </div>

            <div className="p-5 overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">التاريخ</th>
                    <th className="py-2.5 px-3">نوع المستند</th>
                    <th className="py-2.5 px-3">رقم المستند</th>
                    <th className="py-2.5 px-3">البيان</th>
                    <th className="py-2.5 px-3 text-left">مدين (-)</th>
                    <th className="py-2.5 px-3 text-left">دائن (+)</th>
                    <th className="py-2.5 px-3 text-left">الرصيد التراكمي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {activeStatement.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 text-slate-400">{row.date}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-300 font-medium">{row.documentType}</td>
                      <td className="py-2.5 px-3 text-amber-400 font-bold">{row.documentNumber}</td>
                      <td className="py-2.5 px-3 font-sans text-slate-300">{row.statement}</td>
                      <td className="py-2.5 px-3 text-left text-emerald-400 tabular-nums">
                        {row.debit > 0 ? row.debit.toLocaleString() : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-left text-slate-200 tabular-nums">
                        {row.credit > 0 ? row.credit.toLocaleString() : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-left font-bold text-amber-300 tabular-nums">
                        {row.balance.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT VENDOR MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">
                {editingVendor ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveVendorSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-950/70 border border-rose-700/50 text-rose-300 rounded-lg font-semibold">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">اسم المورد الرسمي *</label>
                  <input
                    type="text"
                    required
                    value={formNameAr}
                    onChange={(e) => setFormNameAr(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الاسم التجاري</label>
                  <input
                    type="text"
                    value={formCommercialName}
                    onChange={(e) => setFormCommercialName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم الهاتف *</label>
                  <input
                    type="text"
                    required
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">رقم الواتساب</label>
                  <input
                    type="text"
                    value={formWhatsapp}
                    onChange={(e) => setFormWhatsapp(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تصنيف المورد</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as Vendor['category'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value="مورد رئيسي">مورد رئيسي</option>
                    <option value="محلي">محلي</option>
                    <option value="خارجي">خارجي</option>
                    <option value="خدمات">خدمات</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العنوان</label>
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الرصيد الافتتاحي (دائن علينا)</label>
                  <input
                    type="number"
                    value={formOpeningBalance}
                    onChange={(e) => setFormOpeningBalance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">فترة السداد (أيام)</label>
                  <input
                    type="number"
                    value={formPaymentTermDays}
                    onChange={(e) => setFormPaymentTermDays(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">ملاحظات إضافية</label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  حفظ بيانات المورد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Share Modal */}
      {waVendor && (
        <WhatsAppShareModal
          isOpen={Boolean(waVendor)}
          onClose={() => setWaVendor(null)}
          title={`مشاركة كشف حساب المورد: ${waVendor.nameAr}`}
          recipientName={waVendor.nameAr}
          defaultPhone={waVendor.whatsapp || waVendor.phone}
          defaultTemplateKey="statement"
          templates={whatsappTemplates}
          templateVars={{
            companyName: company?.nameAr || 'المنصور للأنظمة الذكية',
            customerName: waVendor.nameAr,
            date: new Date().toISOString().split('T')[0],
            balance: waVendor.currentBalance.toLocaleString(),
            currency: currencySymbol,
          }}
        />
      )}
    </div>
  );
};
