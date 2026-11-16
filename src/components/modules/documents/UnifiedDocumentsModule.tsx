/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Unified Documents Center (مركز المستندات الموحد)
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Eye,
  Download,
  X,
  Package,
  Layers,
  History,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import { TableColumnPref } from '../../../types/erp';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import {
  exportToExcel,
  downloadReportAsPDF,
} from '../../../services/exportService';

export interface UnifiedDocumentItem {
  id: string;
  docNumber: string;
  category: 'فاتورة' | 'سند' | 'قيد_يومية' | 'إذن_مخزني' | 'مناقلة' | 'جرد_فعلي' | 'مصروف';
  sourceModule: string;
  subType: string;
  date: string;
  branchName: string;
  entityName: string;
  totalAmount: number;
  currency: string;
  status: 'معتمد' | 'مسودة' | 'ملغي' | 'قيد_المعالجة';
  createdBy: string;
  rawRef: any;
  linkedJournalEntryId?: string;
}

interface UnifiedDocumentsModuleProps {
  db: ERPDatabase;
  onOpenPrintModal?: (doc: any) => void;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNavigateToRecord?: (module: string, recordId?: string) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const UnifiedDocumentsModule: React.FC<UnifiedDocumentsModuleProps> = ({
  db,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onNavigateToRecord,
  onNotify,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeViewerDoc, setActiveViewerDoc] = useState<UnifiedDocumentItem | null>(null);

  const allDocuments: UnifiedDocumentItem[] = useMemo(() => {
    const list: UnifiedDocumentItem[] = [];

    // 1. Invoices
    db.invoices.forEach((inv) => {
      const branch = db.branches.find((b) => b.id === inv.branchId);
      const isPurchase = inv.type === 'مشتريات' || inv.type === 'مرتجع_مشتريات';
      list.push({
        id: inv.id,
        docNumber: inv.invoiceNumber,
        category: 'فاتورة',
        sourceModule: isPurchase ? 'purchases' : 'sales',
        subType: inv.type.replace(/_/g, ' '),
        date: inv.date,
        branchName: branch?.nameAr || 'الفرع الرئيسي',
        entityName: inv.entityName,
        totalAmount: inv.grandTotal,
        currency: inv.currency || 'YER',
        status: inv.status === 'cancelled' ? 'ملغي' : inv.status === 'draft' ? 'مسودة' : 'معتمد',
        createdBy: inv.createdBy || 'المستخدم',
        rawRef: inv,
        linkedJournalEntryId: inv.journalEntryId,
      });
    });

    // 2. Payment Vouchers
    db.paymentVouchers.forEach((v) => {
      const branch = db.branches.find((b) => b.id === v.branchId);
      list.push({
        id: v.id,
        docNumber: v.voucherNumber,
        category: 'سند',
        sourceModule: 'treasury',
        subType: v.type === 'قبض' ? 'سند قبض مالي' : 'سند صرف مالي',
        date: v.date,
        branchName: branch?.nameAr || 'الفرع الرئيسي',
        entityName: v.entityName,
        totalAmount: v.amount,
        currency: v.currency || 'YER',
        status: v.status === 'cancelled' ? 'ملغي' : 'معتمد',
        createdBy: v.createdBy || 'أمين الصندوق',
        rawRef: v,
        linkedJournalEntryId: v.journalEntryId,
      });
    });

    // 3. Journal Entries
    db.journalEntries.forEach((je) => {
      list.push({
        id: je.id,
        docNumber: je.entryNumber,
        category: 'قيد_يومية',
        sourceModule: 'accounting',
        subType: je.referenceType !== 'دليل_يدوي' ? 'قيد آلي نظامي' : 'قيد يومية يدوي',
        date: je.date,
        branchName: 'المركز الرئيسي',
        entityName: je.description,
        totalAmount: je.totalDebit,
        currency: 'YER',
        status: je.status === 'reversed' ? 'ملغي' : je.status === 'posted' ? 'معتمد' : 'مسودة',
        createdBy: je.createdBy,
        rawRef: je,
      });
    });

    // 4. Warehouse Documents
    (db.warehouseDocuments || []).forEach((wd) => {
      const wh = db.warehouses.find((w) => w.id === wd.warehouseId);
      list.push({
        id: wd.id,
        docNumber: wd.documentNumber,
        category: 'إذن_مخزني',
        sourceModule: 'inventory',
        subType: wd.type.replace(/_/g, ' '),
        date: wd.date,
        branchName: wh?.nameAr || 'المستودع',
        entityName: wd.beneficiaryOrSupplier || wd.reason || 'حركة مخزنية',
        totalAmount: wd.totalCost || 0,
        currency: 'YER',
        status: wd.status === 'posted' ? 'معتمد' : wd.status === 'cancelled' ? 'ملغي' : 'مسودة',
        createdBy: wd.performedBy,
        rawRef: wd,
      });
    });

    // 5. Inventory Transfers
    db.inventoryTransfers.forEach((tr) => {
      const fromWh = db.warehouses.find((w) => w.id === tr.fromWarehouseId);
      const toWh = db.warehouses.find((w) => w.id === tr.toWarehouseId);
      const totalCost = tr.items.reduce((s, it) => s + it.unitCost * it.quantity, 0);
      list.push({
        id: tr.id,
        docNumber: tr.transferNumber,
        category: 'مناقلة',
        sourceModule: 'inventory',
        subType: `تحويل: ${fromWh?.nameAr || '-'} ← ${toWh?.nameAr || '-'}`,
        date: tr.date,
        branchName: fromWh?.nameAr || 'المستودع',
        entityName: `إلى: ${toWh?.nameAr || '-'}`,
        totalAmount: totalCost,
        currency: 'YER',
        status: tr.status === 'completed' ? 'معتمد' : tr.status === 'cancelled' ? 'ملغي' : 'قيد_المعالجة',
        createdBy: tr.performedBy,
        rawRef: tr,
      });
    });

    // 6. Physical Stocktakings
    (db.stocktakings || []).forEach((st) => {
      const wh = db.warehouses.find((w) => w.id === st.warehouseId);
      const diffAbs = st.items.reduce((s, it) => s + Math.abs(it.totalDifferenceValue || 0), 0);
      list.push({
        id: st.id,
        docNumber: st.stocktakeNumber,
        category: 'جرد_فعلي',
        sourceModule: 'inventory',
        subType: `محضر جرد (${st.scope})`,
        date: st.date,
        branchName: wh?.nameAr || 'متعدد المستودعات',
        entityName: st.notes || `عدد الأصناف: ${st.items.length}`,
        totalAmount: diffAbs,
        currency: 'YER',
        status: st.status === 'approved' ? 'معتمد' : st.status === 'cancelled' ? 'ملغي' : 'مسودة',
        createdBy: st.conductedBy,
        rawRef: st,
        linkedJournalEntryId: st.adjustmentJournalEntryId,
      });
    });

    // 7. Expense Records
    db.expenseRecords.forEach((exp) => {
      const branch = db.branches.find((b) => b.id === exp.branchId);
      list.push({
        id: exp.id,
        docNumber: exp.expenseNumber,
        category: 'مصروف',
        sourceModule: 'expenses',
        subType: exp.categoryName,
        date: exp.date,
        branchName: branch?.nameAr || 'الفرع',
        entityName: exp.statement,
        totalAmount: exp.total,
        currency: exp.currency || 'YER',
        status: 'معتمد',
        createdBy: exp.createdBy,
        rawRef: exp,
        linkedJournalEntryId: exp.journalEntryId,
      });
    });

    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [db]);

  const filteredDocs = useMemo(
    () =>
      allDocuments.filter((doc) => {
        if (selectedCategory !== 'all' && doc.category !== selectedCategory) return false;
        if (selectedStatus !== 'all' && doc.status !== selectedStatus) return false;
        if (startDate && doc.date < startDate) return false;
        if (endDate && doc.date > endDate) return false;
        return true;
      }),
    [allDocuments, selectedCategory, selectedStatus, startDate, endDate]
  );

  const handleExportExcel = () => {
    exportToExcel({
      fileName: `سجل_المستندات_الموحد_${new Date().toISOString().slice(0, 10)}`,
      sheets: [
        {
          name: 'المستندات الموحدة',
          data: [
            ['مركز المستندات الموحد - المنصور ERP'],
            [`عدد المستندات: ${filteredDocs.length}`],
            [],
            ['رقم المستند', 'الفئة', 'النوع', 'التاريخ', 'الفرع/المستودع', 'الطرف/البيان', 'المبلغ', 'العملة', 'الحالة', 'المنشئ'],
            ...filteredDocs.map((d) => [
              d.docNumber,
              d.category.replace(/_/g, ' '),
              d.subType,
              d.date,
              d.branchName,
              d.entityName,
              d.totalAmount,
              d.currency,
              d.status,
              d.createdBy,
            ]),
          ],
        },
      ],
    });
    onNotify?.('success', 'تم تصدير سجل المستندات إلى Excel.');
  };

  const handleExportPDF = async () => {
    await downloadReportAsPDF({
      title: 'تقرير سجل المستندات الموحد',
      periodText: startDate || endDate ? `من ${startDate || '-'} إلى ${endDate || '-'}` : 'كافة الفترات',
      company: db.company,
      branch: db.branches[0],
      tables: [
        {
          headers: ['رقم المستند', 'الفئة', 'النوع', 'التاريخ', 'البيان', 'المبلغ', 'الحالة'],
          rows: filteredDocs.slice(0, 150).map((d) => [
            d.docNumber,
            d.category.replace(/_/g, ' '),
            d.subType,
            d.date,
            d.entityName,
            `${d.totalAmount.toLocaleString()} ${d.currency}`,
            d.status,
          ]),
        },
      ],
    });
    onNotify?.('success', 'تم تصدير سجل المستندات بصيغة PDF بنجاح.');
  };

  const columns = useMemo<ErpTableColumn<UnifiedDocumentItem>[]>(
    () => [
      { key: 'docNumber', label: 'رقم المستند', sortValue: (d) => d.docNumber, render: (d) => <span className="font-mono font-bold text-amber-400">{d.docNumber}</span> },
      { key: 'category', label: 'الفئة', render: (d) => <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-bold">{d.category.replace(/_/g, ' ')}</span> },
      { key: 'subType', label: 'النوع التفصيلي', render: (d) => <span className="font-semibold text-white">{d.subType}</span> },
      { key: 'date', label: 'التاريخ', sortValue: (d) => d.date, render: (d) => <span className="font-mono text-slate-400">{d.date}</span> },
      { key: 'branchName', label: 'الفرع / المستودع', render: (d) => d.branchName },
      { key: 'entityName', label: 'الطرف / البيان', render: (d) => <span className="block max-w-xs truncate text-slate-200">{d.entityName}</span> },
      { key: 'totalAmount', label: 'المبلغ', align: 'left', sortValue: (d) => d.totalAmount, render: (d) => <span className="font-mono font-bold text-white">{d.totalAmount.toLocaleString()} <span className="text-[10px] text-slate-500">{d.currency}</span></span> },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        render: (d) => (
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
              d.status === 'معتمد'
                ? 'bg-emerald-500/20 text-emerald-400'
                : d.status === 'ملغي'
                ? 'bg-rose-500/20 text-rose-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            {d.status}
          </span>
        ),
      },
      {
        key: '_actions',
        label: 'إجراءات',
        sortable: false,
        align: 'center',
        render: (d) => (
          <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setActiveViewerDoc(d)}
              className="inline-flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded text-[11px]"
              title="فحص سريع"
            >
              <Eye className="w-3.5 h-3.5 text-amber-400" />
              <span>تدقيق</span>
            </button>
            {onNavigateToRecord && (
              <button
                type="button"
                onClick={() => onNavigateToRecord(d.sourceModule, d.id)}
                className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/15 hover:bg-amber-500 hover:text-slate-950 text-amber-300 font-bold rounded text-[11px]"
                title="فتح في الوحدة الأصلية"
              >
                <ExternalLink className="w-3 h-3" />
                <span>فتح</span>
              </button>
            )}
          </div>
        ),
      },
    ],
    [onNavigateToRecord]
  );

  const activeIndex = activeViewerDoc
    ? filteredDocs.findIndex((d) => d.id === activeViewerDoc.id && d.category === activeViewerDoc.category)
    : -1;

  const linkedEntry = useMemo(
    () =>
      activeViewerDoc?.linkedJournalEntryId
        ? db.journalEntries.find((j) => j.id === activeViewerDoc.linkedJournalEntryId)
        : null,
    [activeViewerDoc, db.journalEntries]
  );

  const linkedMovements = useMemo(
    () =>
      activeViewerDoc
        ? db.stockMovements.filter((sm) => sm.documentNumber === activeViewerDoc.docNumber)
        : [],
    [activeViewerDoc, db.stockMovements]
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
            <Layers className="w-5 h-5" />
          </span>
          <div>
            <h2 className="text-lg font-black text-white">مركز المستندات الموحد والرقابة المركزية</h2>
            <p className="text-xs text-slate-400">
              استعراض وبحث وتدقيق جميع الفواتير والسندات والقيود والأذون والمناقلات ومحاضر الجرد من مكان واحد
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl"
          >
            <Download className="w-4 h-4" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl"
          >
            <Download className="w-4 h-4" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <ErpDataTable
        tableId="unified-documents"
        title="سجل المستندات الموحد"
        data={filteredDocs}
        columns={columns}
        getRowId={(d) => `${d.category}-${d.id}`}
        searchPlaceholder="بحث برقم المستند، الطرف، النوع، المنشئ..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        onRowClick={(doc) => setActiveViewerDoc(doc)}
        filtersSlot={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="all">كافة الأنواع</option>
              <option value="فاتورة">الفواتير</option>
              <option value="سند">سندات القبض والصرف</option>
              <option value="قيد_يومية">قيود اليومية</option>
              <option value="إذن_مخزني">أذون المخزون</option>
              <option value="مناقلة">المناقلات المخزنية</option>
              <option value="جرد_فعلي">محاضر الجرد الفعلي</option>
              <option value="مصروف">المصروفات</option>
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-3 py-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="all">كل الحالات</option>
              <option value="معتمد">معتمد</option>
              <option value="مسودة">مسودة</option>
              <option value="ملغي">ملغي</option>
              <option value="قيد_المعالجة">قيد المعالجة</option>
            </select>

            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-2.5 py-1.5 rounded-lg text-slate-200 font-mono text-xs"
              title="من تاريخ"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-2.5 py-1.5 rounded-lg text-slate-200 font-mono text-xs"
              title="إلى تاريخ"
            />
          </div>
        }
      />

      {/* Document Inspector Modal with Prev/Next Stepping + Jump to Source */}
      {activeViewerDoc && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">
                    تدقيق المستند: {activeViewerDoc.docNumber}
                  </h3>
                  <span className="text-xs text-slate-400">
                    {activeViewerDoc.subType} • {activeViewerDoc.date}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={activeIndex <= 0}
                  onClick={() => activeIndex > 0 && setActiveViewerDoc(filteredDocs[activeIndex - 1])}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40"
                  title="المستند السابق"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={activeIndex < 0 || activeIndex >= filteredDocs.length - 1}
                  onClick={() =>
                    activeIndex < filteredDocs.length - 1 && setActiveViewerDoc(filteredDocs[activeIndex + 1])
                  }
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40"
                  title="المستند التالي"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveViewerDoc(null)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block">رقم المستند</span>
                  <span className="font-mono font-bold text-amber-400">{activeViewerDoc.docNumber}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">التاريخ</span>
                  <span className="font-mono text-white">{activeViewerDoc.date}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">الفرع / المستودع</span>
                  <span className="font-bold text-slate-200">{activeViewerDoc.branchName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">المبلغ الإجمالي</span>
                  <span className="font-mono font-black text-emerald-400">
                    {activeViewerDoc.totalAmount.toLocaleString()} {activeViewerDoc.currency}
                  </span>
                </div>
              </div>

              {linkedEntry && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="font-bold text-emerald-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                    <ShieldCheck className="w-4 h-4" />
                    <span>القيد المحاسبي المزدوج المرتبط ({linkedEntry.entryNumber})</span>
                  </div>
                  <table className="w-full text-right text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-800">
                        <th className="py-1">الحساب</th>
                        <th className="py-1">البيان</th>
                        <th className="py-1 text-left">مدين</th>
                        <th className="py-1 text-left">دائن</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {linkedEntry.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1.5 font-sans text-slate-200">{l.accountName} ({l.accountCode})</td>
                          <td className="py-1.5 font-sans text-slate-400">{l.memo}</td>
                          <td className="py-1.5 text-left text-emerald-400 font-bold">{l.debit > 0 ? l.debit.toLocaleString() : '-'}</td>
                          <td className="py-1.5 text-left text-amber-400 font-bold">{l.credit > 0 ? l.credit.toLocaleString() : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {linkedMovements.length > 0 && (
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="font-bold text-cyan-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                    <Package className="w-4 h-4" />
                    <span>حركات المخزون الناتجة ({linkedMovements.length})</span>
                  </div>
                  {linkedMovements.map((sm) => (
                    <div key={sm.id} className="flex justify-between items-center py-1 border-b border-slate-900">
                      <span className="text-slate-300">
                        {db.inventoryItems.find((i) => i.id === sm.itemId)?.nameAr || sm.itemId}
                      </span>
                      <span className={`font-mono font-bold ${sm.quantityChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {sm.quantityChange > 0 ? `+${sm.quantityChange}` : sm.quantityChange}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-slate-400 flex justify-between items-center text-[11px]">
                <div className="flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-amber-400" />
                  <span>بواسطة: <strong>{activeViewerDoc.createdBy}</strong></span>
                </div>
                <span>الحالة: <strong>{activeViewerDoc.status}</strong></span>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between items-center gap-2">
              {onNavigateToRecord ? (
                <button
                  type="button"
                  onClick={() => {
                    const mod = activeViewerDoc.sourceModule;
                    const id = activeViewerDoc.id;
                    setActiveViewerDoc(null);
                    onNavigateToRecord(mod, id);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>فتح في الوحدة الأصلية</span>
                </button>
              ) : <div />}

              <button
                type="button"
                onClick={() => setActiveViewerDoc(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs"
              >
                إغلاق والعودة للقائمة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
