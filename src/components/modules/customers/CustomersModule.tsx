/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Customers & Regional Management Module
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  MapPin,
  Plus,
  MessageCircle,
  Printer,
  Eye,
  Edit,
  AlertTriangle,
  X,
  CreditCard,
  FileDown,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  Customer,
  RegionalArea,
  Invoice,
  PaymentVoucher,
  Branch,
  JournalEntry,
  Company,
  WhatsAppTemplates,
  TableColumnPref,
} from '../../../types/erp';
import { generateCustomerStatement, StatementRow } from '../../../services/accountingEngine';
import { PrintableDocumentData } from '../../common/PrintModal';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import {
  downloadReportAsPDF,
  exportToExcel,
  exportToCSV,
} from '../../../services/exportService';
import { generateNextDocNumber } from '../../../services/storageService';
import { convertToBase } from '../../../services/currencyHelpers';

interface CustomersModuleProps {
  customers: Customer[];
  regionalAreas: RegionalArea[];
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
  onSaveCustomer: (customer: Customer) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const CustomersModule: React.FC<CustomersModuleProps> = ({
  customers,
  regionalAreas,
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
  onSaveCustomer,
  onOpenPrintModal,
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'regional_report'>('list');
  const [selectedAreaFilter, setSelectedAreaFilter] = useState('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('all');

  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [waCustomer, setWaCustomer] = useState<Customer | null>(null);
  const [formError, setFormError] = useState('');

  // Form State
  const [formNameAr, setFormNameAr] = useState('');
  const [formCommercialName, setFormCommercialName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formWhatsapp, setFormWhatsapp] = useState('');
  const [formRegionalAreaId, setFormRegionalAreaId] = useState(regionalAreas[0]?.id || '');
  const [formAddressDetails, setFormAddressDetails] = useState('');
  const [formCategory, setFormCategory] = useState<Customer['category']>('تجاري');
  const [formCreditLimit, setFormCreditLimit] = useState(5000000);
  const [formPaymentTermDays, setFormPaymentTermDays] = useState(30);
  const [formOpeningBalance, setFormOpeningBalance] = useState(0);
  const [formSalesRepName, setFormSalesRepName] = useState('');
  const [formNotes, setFormNotes] = useState('');

  useEffect(() => {
    if (!focusedRecordId) return;
    const match = customers.find((c) => c.id === focusedRecordId || c.code === focusedRecordId);
    if (match) {
      setActiveTab('list');
      setViewingCustomer(match);
    }
  }, [focusedRecordId, customers]);

  const openNewCustomerModal = () => {
    setFormError('');
    setEditingCustomer(null);
    setFormNameAr('');
    setFormCommercialName('');
    setFormPhone('');
    setFormWhatsapp('');
    setFormRegionalAreaId(regionalAreas[0]?.id || '');
    setFormAddressDetails('');
    setFormCategory('تجاري');
    setFormCreditLimit(0);
    setFormPaymentTermDays(30);
    setFormOpeningBalance(0);
    setFormSalesRepName('');
    setFormNotes('');
    setIsCustomerModalOpen(true);
  };

  const openEditCustomerModal = (c: Customer) => {
    setFormError('');
    setEditingCustomer(c);
    setFormNameAr(c.nameAr);
    setFormCommercialName(c.commercialName || '');
    setFormPhone(c.phone);
    setFormWhatsapp(c.whatsapp || c.phone);
    setFormRegionalAreaId(c.regionalAreaId);
    setFormAddressDetails(c.addressDetails);
    setFormCategory(c.category);
    setFormCreditLimit(c.creditLimit);
    setFormPaymentTermDays(c.paymentTermDays);
    setFormOpeningBalance(c.openingBalance);
    setFormSalesRepName(c.salesRepName || '');
    setFormNotes(c.notes || '');
    setIsCustomerModalOpen(true);
  };

  const handleSaveCustomerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!formNameAr.trim() || !formPhone.trim()) {
      setFormError('يرجى إدخال اسم العميل ورقم الهاتف.');
      return;
    }

    const nextCode = editingCustomer
      ? editingCustomer.code
      : generateNextDocNumber(
          'CUST-',
          customers.map((c) => c.code),
          4
        );

    const newCustomer: Customer = {
      id: editingCustomer ? editingCustomer.id : `cust-${Date.now()}`,
      branchId: currentBranch.id,
      code: nextCode,
      nameAr: formNameAr.trim(),
      commercialName: formCommercialName.trim() || undefined,
      phone: formPhone.trim(),
      whatsapp: formWhatsapp.trim() || formPhone.trim(),
      regionalAreaId: formRegionalAreaId,
      addressDetails: formAddressDetails.trim(),
      category: formCategory,
      creditLimit: Number(formCreditLimit) || 0,
      paymentTermDays: Number(formPaymentTermDays) || 0,
      openingBalance: Number(formOpeningBalance) || 0,
      currentBalance: editingCustomer ? editingCustomer.currentBalance : Number(formOpeningBalance) || 0,
      salesRepName: formSalesRepName.trim() || undefined,
      status: 'active',
      notes: formNotes.trim() || undefined,
      createdAt: editingCustomer ? editingCustomer.createdAt : new Date().toISOString().split('T')[0],
    };

    onSaveCustomer(newCustomer);
    onNotify?.('success', editingCustomer ? `تم تحديث بيانات العميل ${newCustomer.nameAr}.` : `تم تسجيل العميل الجديد ${newCustomer.nameAr} (${newCustomer.code}).`);
    setIsCustomerModalOpen(false);
  };

  const filteredCustomers = useMemo(() => {
    return customers.filter((c) => {
      const matchArea = selectedAreaFilter === 'all' || c.regionalAreaId === selectedAreaFilter;
      const matchCategory = selectedCategoryFilter === 'all' || c.category === selectedCategoryFilter;
      return matchArea && matchCategory;
    });
  }, [customers, selectedAreaFilter, selectedCategoryFilter]);

  const regionalAnalytics = useMemo(() => {
    return regionalAreas.map((area) => {
      const areaCustomers = customers.filter((c) => c.regionalAreaId === area.id);
      const customerIds = areaCustomers.map((c) => c.id);

      const areaInvoices = invoices.filter(
        (inv) => customerIds.includes(inv.entityId) && inv.type === 'مبيعات' && inv.status !== 'cancelled'
      );
      const totalSales = areaInvoices.reduce(
        (sum, inv) => sum + convertToBase(inv.grandTotal, inv.currency, undefined, inv.exchangeRate),
        0
      );

      const areaVouchers = paymentVouchers.filter(
        (v) => customerIds.includes(v.entityId || '') && v.type === 'قبض' && v.status === 'posted'
      );
      const totalCollected = areaVouchers.reduce((sum, v) => sum + (v.baseAmount || v.amount * v.exchangeRate), 0);

      const totalDebt = areaCustomers.reduce((sum, c) => sum + Math.max(0, c.currentBalance), 0);
      const collectionRate = totalSales > 0 ? Math.round((totalCollected / totalSales) * 100) : 100;

      return {
        area,
        customersCount: areaCustomers.length,
        totalSales,
        totalCollected,
        totalDebt,
        collectionRate,
        customers: areaCustomers,
      };
    });
  }, [regionalAreas, customers, invoices, paymentVouchers]);

  const activeStatement: StatementRow[] = useMemo(() => {
    if (!viewingCustomer) return [];
    return generateCustomerStatement(viewingCustomer.id, viewingCustomer, invoices, paymentVouchers, journalEntries);
  }, [viewingCustomer, invoices, paymentVouchers, journalEntries]);

  const handlePrintStatement = (c: Customer) => {
    const rows = generateCustomerStatement(c.id, c, invoices, paymentVouchers, journalEntries);
    const docData: PrintableDocumentData = {
      title: 'كشف حساب عميل تفصيلي معتمد',
      documentNumber: `STMT-${c.code}`,
      date: new Date().toISOString().split('T')[0],
      entityName: c.nameAr,
      entityPhone: c.phone,
      entityAddress: c.addressDetails,
      currencySymbol,
      items: rows.map((r, i) => ({
        index: i + 1,
        description: `${r.documentType} (${r.documentNumber}) - ${r.statement}`,
        unit: 'عملية',
        quantity: 1,
        unitPrice: r.debit || r.credit,
        total: r.balance,
      })),
      totals: {
        subtotal: rows.reduce((s, r) => s + r.debit, 0),
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: c.currentBalance,
        remainingAmount: c.currentBalance,
      },
      notes: `الحد الائتماني المعتمد: ${c.creditLimit.toLocaleString()} ${currencySymbol} · فترة السداد: ${c.paymentTermDays} يوماً.`,
      amountInWords: `الرصيد المستحق النهائي: ${c.currentBalance.toLocaleString()} ${currencySymbol} فقط لا غير.`,
    };
    onOpenPrintModal(docData);
  };

  const handleDownloadStatementPDF = async (c: Customer) => {
    const rows = generateCustomerStatement(c.id, c, invoices, paymentVouchers, journalEntries);
    await downloadReportAsPDF({
      title: `كشف حساب عميل - ${c.nameAr}`,
      subtitle: `كود العميل: ${c.code} · هاتف: ${c.phone}`,
      company,
      branch: currentBranch,
      metadata: {
        العميل: c.nameAr,
        التصنيف: c.category,
        'الحد الائتماني': `${c.creditLimit.toLocaleString()} ${currencySymbol}`,
        'الرصيد الحالي': `${c.currentBalance.toLocaleString()} ${currencySymbol}`,
      },
      tables: [
        {
          headers: ['التاريخ', 'نوع المستند', 'رقم المستند', 'البيان', 'مدين (+)', 'دائن (-)', 'الرصيد التراكمي'],
          rows: rows.map((r) => [
            r.date,
            r.documentType,
            r.documentNumber,
            r.statement,
            r.debit,
            r.credit,
            r.balance,
          ]),
          totals: [
            'الإجمالي',
            '',
            '',
            '',
            rows.reduce((s, r) => s + r.debit, 0),
            rows.reduce((s, r) => s + r.credit, 0),
            c.currentBalance,
          ],
        },
      ],
      fileName: `كشف_حساب_${c.code}`,
    });
  };

  const viewingIdx = viewingCustomer ? filteredCustomers.findIndex((c) => c.id === viewingCustomer.id) : -1;

  const areaMap = useMemo(() => new Map(regionalAreas.map((a) => [a.id, a])), [regionalAreas]);

  const customerColumns: ErpTableColumn<Customer>[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'كود العميل',
        sortValue: (c) => c.code,
        render: (c) => <span className="font-mono font-bold text-amber-400">{c.code}</span>,
      },
      {
        key: 'nameAr',
        label: 'اسم العميل / التجاري',
        sortValue: (c) => c.nameAr,
        searchValue: (c) => `${c.nameAr} ${c.commercialName || ''} ${c.addressDetails || ''}`,
        render: (c) => (
          <div>
            <strong className="text-slate-100 block">{c.nameAr}</strong>
            {c.commercialName && <span className="text-[11px] text-slate-400 block">{c.commercialName}</span>}
          </div>
        ),
      },
      {
        key: 'regionalAreaId',
        label: 'المنطقة الجغرافية',
        sortValue: (c) => areaMap.get(c.regionalAreaId)?.area || '',
        searchValue: (c) => {
          const area = areaMap.get(c.regionalAreaId);
          return `${area?.governorate || ''} ${area?.district || ''} ${area?.area || ''} ${c.addressDetails || ''}`;
        },
        render: (c) => {
          const area = areaMap.get(c.regionalAreaId);
          const heading = area
            ? [area.governorate, area.area].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i).join(' · ')
            : '';
          return heading ? (
            <div>
              <span className="font-semibold text-slate-200 block">{heading}</span>
              {c.addressDetails && <span className="text-[11px] text-slate-400 block">{c.addressDetails}</span>}
            </div>
          ) : (
            <span className="text-slate-400">{c.addressDetails || '—'}</span>
          );
        },
      },
      {
        key: 'phone',
        label: 'الهاتف / واتساب',
        sortValue: (c) => c.phone,
        render: (c) => (
          <div className="flex items-center gap-1.5 font-mono text-slate-300">
            <span>{c.phone}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setWaCustomer(c);
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
        key: 'category',
        label: 'التصنيف',
        align: 'center',
        sortValue: (c) => c.category,
        render: (c) => (
          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px] font-semibold border border-slate-700">
            {c.category}
          </span>
        ),
      },
      {
        key: 'creditLimit',
        label: 'الحد الائتماني',
        align: 'left',
        sortValue: (c) => c.creditLimit,
        render: (c) => <span className="font-mono text-slate-400 tabular-nums">{c.creditLimit.toLocaleString()}</span>,
      },
      {
        key: 'currentBalance',
        label: `الرصيد الحالي (${currencySymbol})`,
        align: 'left',
        sortValue: (c) => c.currentBalance,
        render: (c) => {
          const isOverLimit = c.creditLimit > 0 && c.currentBalance > c.creditLimit;
          return (
            <div className="flex flex-col items-end font-mono font-bold tabular-nums">
              <span className={c.currentBalance > 0 ? (isOverLimit ? 'text-rose-400 font-black' : 'text-amber-400') : 'text-emerald-400'}>
                {c.currentBalance.toLocaleString()}
              </span>
              {isOverLimit && (
                <span className="text-[10px] text-rose-400 font-sans flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" /> تجاوز الحد
                </span>
              )}
            </div>
          );
        },
        footerRender: (rows) =>
          `${rows.reduce((s, r) => s + r.currentBalance, 0).toLocaleString()} ${currencySymbol}`,
      },
      {
        key: 'actions',
        label: 'الإجراءات',
        align: 'center',
        sortable: false,
        render: (c) => (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setViewingCustomer(c)}
              title="كشف الحساب التفصيلي"
              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadStatementPDF(c)}
              title="تنزيل كشف الحساب PDF"
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePrintStatement(c)}
              title="طباعة كشف الحساب"
              className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => openEditCustomerModal(c)}
              title="تعديل بيانات العميل"
              className="p-1.5 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Edit className="w-4 h-4" />
            </button>
          </div>
        ),
      },
    ],
    [areaMap, currencySymbol]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">إدارة العملاء وهيكلية المناطق الجغرافية</h2>
          </div>
          <p className="text-xs text-slate-400">
            تصنيف العملاء، تتبع المديونيات وتنبيهات الحد الائتماني، تقارير المناطق، وكشوف الحسابات PDF وواتساب
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'list' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              قائمة العملاء ({customers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('regional_report')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                activeTab === 'regional_report' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              تحليل المناطق والمحافظات
            </button>
          </div>

          <button
            type="button"
            onClick={openNewCustomerModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة عميل جديد</span>
          </button>
        </div>
      </div>

      {/* TAB 1: CUSTOMERS LIST */}
      {activeTab === 'list' && (
        <ErpDataTable<Customer>
          tableId="customers-list"
          title="دليل العملاء"
          data={filteredCustomers}
          columns={customerColumns}
          getRowId={(c) => c.id}
          savedColumnPrefs={savedColumnPrefs}
          onSaveColumnPrefs={onSaveColumnPrefs}
          searchPlaceholder="ابحث بالاسم، الهاتف، المنطقة، أو كود العميل..."
          selectable
          defaultSortKey="currentBalance"
          defaultSortDir="desc"
          onRowClick={(c) => setViewingCustomer(c)}
          filtersSlot={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedAreaFilter}
                onChange={(e) => setSelectedAreaFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="all">جميع المناطق والمحافظات</option>
                {regionalAreas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {[a.governorate, a.district, a.area].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i).join(' - ')}
                  </option>
                ))}
              </select>
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
              >
                <option value="all">جميع التصنيفات</option>
                <option value="تجاري">تجاري</option>
                <option value="جملة">جملة</option>
                <option value="تجزئة">تجزئة</option>
                <option value="VIP">VIP</option>
                <option value="حكومي">حكومي</option>
              </select>
            </div>
          }
          actionsSlot={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void downloadReportAsPDF({
                    title: 'تقرير أرصدة ومديونيات العملاء',
                    company,
                    branch: currentBranch,
                    tables: [
                      {
                        headers: ['الكود', 'اسم العميل', 'الهاتف', 'التصنيف', 'الحد الائتماني', 'الرصيد الحالي'],
                        rows: filteredCustomers.map((c) => [c.code, c.nameAr, c.phone, c.category, c.creditLimit, c.currentBalance]),
                        totals: [
                          'الإجمالي',
                          `${filteredCustomers.length} عميل`,
                          '',
                          '',
                          filteredCustomers.reduce((s, c) => s + c.creditLimit, 0),
                          filteredCustomers.reduce((s, c) => s + c.currentBalance, 0),
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
                    fileName: `قائمة_العملاء_${new Date().toISOString().slice(0, 10)}`,
                    sheets: [
                      {
                        name: 'العملاء',
                        data: [
                          ['الكود', 'الاسم', 'الهاتف', 'التصنيف', 'الحد الائتماني', 'الرصيد الحالي'],
                          ...filteredCustomers.map((c) => [c.code, c.nameAr, c.phone, c.category, c.creditLimit, c.currentBalance]),
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
            </div>
          }
          bulkActionsSlot={(selected) => (
            <button
              type="button"
              onClick={() =>
                exportToExcel({
                  fileName: `عملاء_محددين_${new Date().toISOString().slice(0, 10)}`,
                  sheets: [
                    {
                      name: 'العملاء المحددين',
                      data: [
                        ['الكود', 'الاسم', 'الهاتف', 'التصنيف', 'الرصيد الحالي'],
                        ...selected.map((c) => [c.code, c.nameAr, c.phone, c.category, c.currentBalance]),
                      ],
                    },
                  ],
                })
              }
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
            >
              تصدير Excel ({selected.length})
            </button>
          )}
        />
      )}

      {/* TAB 2: REGIONAL REPORT */}
      {activeTab === 'regional_report' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                تقرير التوزيع الإقليمي وأداء المناطق والتحصيل
              </h3>
              <p className="text-xs text-slate-400">
                تحليل عدد العملاء، المبيعات، التحصيل، والمديونيات حسب المحافظة والمديرية والمنطقة
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  void downloadReportAsPDF({
                    title: 'تقرير التوزيع الإقليمي وأداء المناطق',
                    company,
                    branch: currentBranch,
                    tables: [
                      {
                        headers: ['كود المنطقة', 'المحافظة', 'المديرية / المنطقة', 'العملاء', 'المبيعات', 'المحصل', 'المديونية', 'التحصيل %'],
                        rows: regionalAnalytics.map((r) => [
                          r.area.code,
                          r.area.governorate,
                          `${r.area.district} - ${r.area.area}`,
                          r.customersCount,
                          r.totalSales,
                          r.totalCollected,
                          r.totalDebt,
                          `${r.collectionRate}%`,
                        ]),
                      },
                    ],
                  })
                }
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportToCSV(
                    `regional-report-${new Date().toISOString().split('T')[0]}`,
                    ['المحافظة', 'المديرية', 'المنطقة', 'العملاء', 'المبيعات', 'التحصيل', 'المديونية', 'نسبة التحصيل'],
                    regionalAnalytics.map((r) => [
                      r.area.governorate,
                      r.area.district,
                      r.area.area,
                      r.customersCount,
                      r.totalSales,
                      r.totalCollected,
                      r.totalDebt,
                      `${r.collectionRate}%`,
                    ])
                  )
                }
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg cursor-pointer"
              >
                CSV
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 font-bold">
                <tr>
                  <th className="py-3 px-4">كود المنطقة</th>
                  <th className="py-3 px-4">الدولة / المحافظة</th>
                  <th className="py-3 px-4">المديرية / المنطقة</th>
                  <th className="py-3 px-4 text-center">العملاء</th>
                  <th className="py-3 px-4 text-left">إجمالي المبيعات</th>
                  <th className="py-3 px-4 text-left">المحصل</th>
                  <th className="py-3 px-4 text-left">المديونية القائمة</th>
                  <th className="py-3 px-4 text-center">نسبة التحصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {regionalAnalytics.map((item) => (
                  <tr key={item.area.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">{item.area.code}</td>
                    <td className="py-3 px-4 font-semibold text-slate-200">
                      {[item.area.country, item.area.governorate].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {[item.area.district, item.area.area].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i).join(' - ')}
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-slate-100">{item.customersCount}</td>
                    <td className="py-3 px-4 text-left font-mono text-slate-200 tabular-nums">{item.totalSales.toLocaleString()}</td>
                    <td className="py-3 px-4 text-left font-mono text-emerald-400 tabular-nums">{item.totalCollected.toLocaleString()}</td>
                    <td className="py-3 px-4 text-left font-mono font-bold text-rose-400 tabular-nums">{item.totalDebt.toLocaleString()}</td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          item.collectionRate >= 70
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                            : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                        }`}
                      >
                        %{item.collectionRate}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW CUSTOMER STATEMENT MODAL WITH PREV / NEXT */}
      {viewingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-900 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">كشف حساب تفصيلي: {viewingCustomer.nameAr}</h3>
                  <p className="text-xs text-slate-400">
                    كود: <span className="font-mono text-amber-400">{viewingCustomer.code}</span> · هاتف:{' '}
                    <span className="font-mono">{viewingCustomer.phone}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={viewingIdx <= 0}
                  onClick={() => viewingIdx > 0 && setViewingCustomer(filteredCustomers[viewingIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={viewingIdx < 0 || viewingIdx >= filteredCustomers.length - 1}
                  onClick={() =>
                    viewingIdx >= 0 &&
                    viewingIdx < filteredCustomers.length - 1 &&
                    setViewingCustomer(filteredCustomers[viewingIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadStatementPDF(viewingCustomer)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintStatement(viewingCustomer)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWaCustomer(viewingCustomer)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>واتساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingCustomer(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/70 border-b border-slate-800 text-xs">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">الرصيد الافتتاحي:</span>
                <span className="text-base font-bold font-mono text-slate-200 tabular-nums">
                  {viewingCustomer.openingBalance.toLocaleString()} {currencySymbol}
                </span>
              </div>
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">الحد الائتماني:</span>
                <span className="text-base font-bold font-mono text-slate-200 tabular-nums">
                  {viewingCustomer.creditLimit.toLocaleString()} {currencySymbol}
                </span>
              </div>
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-800">
                <span className="text-slate-400 block mb-1">صافي الرصيد الحالي:</span>
                <span className="text-base font-black font-mono text-amber-400 tabular-nums">
                  {viewingCustomer.currentBalance.toLocaleString()} {currencySymbol}
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
                    <th className="py-2.5 px-3 text-left">مدين (+)</th>
                    <th className="py-2.5 px-3 text-left">دائن (-)</th>
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
                      <td className="py-2.5 px-3 text-left text-slate-200 tabular-nums">
                        {row.debit > 0 ? row.debit.toLocaleString() : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-left text-emerald-400 tabular-nums">
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

      {/* ADD / EDIT CUSTOMER MODAL */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-base text-white">
                {editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد للنظام'}
              </h3>
              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomerSubmit} className="p-6 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-rose-950/70 border border-rose-700/50 text-rose-300 rounded-lg font-semibold">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">اسم العميل الرسمي *</label>
                  <input
                    type="text"
                    required
                    value={formNameAr}
                    onChange={(e) => setFormNameAr(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الاسم التجاري / الشهرة</label>
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
                  <label className="block text-slate-300 font-semibold mb-1">المنطقة الجغرافية *</label>
                  <select
                    value={formRegionalAreaId}
                    onChange={(e) => setFormRegionalAreaId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  >
                    {regionalAreas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {[a.country, a.governorate, a.district, a.area].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i).join(' ← ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العنوان التفصيلي</label>
                  <input
                    type="text"
                    value={formAddressDetails}
                    onChange={(e) => setFormAddressDetails(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تصنيف العميل</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as Customer['category'])}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  >
                    <option value="تجاري">تجاري</option>
                    <option value="جملة">جملة</option>
                    <option value="تجزئة">تجزئة</option>
                    <option value="VIP">VIP</option>
                    <option value="حكومي">حكومي</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الحد الائتماني ({currencySymbol})</label>
                  <input
                    type="number"
                    value={formCreditLimit}
                    onChange={(e) => setFormCreditLimit(Number(e.target.value))}
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
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">الرصيد الافتتاحي</label>
                  <input
                    type="number"
                    value={formOpeningBalance}
                    onChange={(e) => setFormOpeningBalance(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">مندوب المبيعات المسؤول</label>
                  <input
                    type="text"
                    value={formSalesRepName}
                    onChange={(e) => setFormSalesRepName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">ملاحظات وشروط ائتمانية</label>
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
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  حفظ بيانات العميل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp Share Modal */}
      {waCustomer && (
        <WhatsAppShareModal
          isOpen={Boolean(waCustomer)}
          onClose={() => setWaCustomer(null)}
          title={`تذكير ومشاركة كشف حساب العميل: ${waCustomer.nameAr}`}
          recipientName={waCustomer.nameAr}
          defaultPhone={waCustomer.whatsapp || waCustomer.phone}
          defaultTemplateKey={waCustomer.currentBalance > 0 ? 'overdueReminder' : 'statement'}
          templates={whatsappTemplates}
          templateVars={{
            companyName: company?.nameAr || 'المنصور للأنظمة الذكية',
            customerName: waCustomer.nameAr,
            date: new Date().toISOString().split('T')[0],
            balance: waCustomer.currentBalance.toLocaleString(),
            currency: currencySymbol,
          }}
        />
      )}
    </div>
  );
};
