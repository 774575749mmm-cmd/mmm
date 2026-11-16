/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Warehouse Documents Center (أذون المخزون الـ 10)
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Printer,
  Download,
  Eye,
  X,
  FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import {
  WarehouseDocument,
  WarehouseDocType,
  WarehouseDocItem,
  InventoryItem,
  Warehouse,
  Company,
  Branch,
  TableColumnPref,
} from '../../../types/erp';
import { generateNextDocNumber } from '../../../services/storageService';
import {
  exportToExcel,
  downloadReportAsPDF,
  printReportPreview,
} from '../../../services/exportService';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';

interface WarehouseDocsManagerProps {
  documents: WarehouseDocument[];
  items: InventoryItem[];
  warehouses: Warehouse[];
  currencySymbol: string;
  onSaveDocument: (doc: WarehouseDocument) => void;
  company?: Company;
  branch?: Branch;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const WarehouseDocsManager: React.FC<WarehouseDocsManagerProps> = ({
  documents,
  items,
  warehouses,
  currencySymbol,
  onSaveDocument,
  company,
  branch,
  savedColumnPrefs,
  onSaveColumnPrefs,
  onNotify,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [filterWh, setFilterWh] = useState<string>('all');
  const [isNewDocModalOpen, setIsNewDocModalOpen] = useState(false);
  const [inspectDoc, setInspectDoc] = useState<WarehouseDocument | null>(null);

  // Form State
  const [docType, setDocType] = useState<WarehouseDocType>('إذن_توريد');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id || '');
  const [beneficiary, setBeneficiary] = useState('');
  const [reason, setReason] = useState('توريد بضاعة جديدة للمخزن');
  const [docDate, setDocDate] = useState(new Date().toISOString().split('T')[0]);

  const [formItems, setFormItems] = useState<WarehouseDocItem[]>([
    {
      id: `wdi-${Date.now()}`,
      itemId: items[0]?.id || '',
      itemName: items[0]?.nameAr || '',
      unit: items[0]?.baseUnit || 'حبة',
      quantity: 10,
      unitCost: items[0]?.purchasePrice || 0,
      totalCost: (items[0]?.purchasePrice || 0) * 10,
    },
  ]);

  const handleAddItemRow = () => {
    const first = items[0];
    setFormItems((prev) => [
      ...prev,
      {
        id: `wdi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        itemId: first?.id || '',
        itemName: first?.nameAr || '',
        unit: first?.baseUnit || 'حبة',
        quantity: 1,
        unitCost: first?.purchasePrice || 0,
        totalCost: first?.purchasePrice || 0,
      },
    ]);
  };

  const handleRemoveItemRow = (idx: number) => {
    if (formItems.length <= 1) return;
    setFormItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx: number, field: keyof WarehouseDocItem, val: string | number) => {
    setFormItems((prev) => {
      const updated = [...prev];
      const row = { ...updated[idx], [field]: val };

      if (field === 'itemId') {
        const it = items.find((i) => i.id === val);
        if (it) {
          row.itemName = it.nameAr;
          row.unit = it.baseUnit;
          row.unitCost = it.purchasePrice;
          row.totalCost = row.quantity * it.purchasePrice;
        }
      }

      if (field === 'quantity' || field === 'unitCost') {
        const qty = field === 'quantity' ? Number(val) : row.quantity;
        const cost = field === 'unitCost' ? Number(val) : row.unitCost;
        row.totalCost = qty * cost;
      }

      updated[idx] = row;
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!beneficiary.trim()) {
      onNotify?.('error', 'يرجى كتابة اسم المستلم / المورد أو الجهة المستفيدة.');
      return;
    }

    const totalQty = formItems.reduce((s, it) => s + Number(it.quantity), 0);
    const totalCost = formItems.reduce((s, it) => s + Number(it.totalCost), 0);

    const prefix = `WD-${new Date().getFullYear()}-`;
    const documentNumber = generateNextDocNumber(
      prefix,
      documents.map((d) => d.documentNumber),
      4
    );

    const newDoc: WarehouseDocument = {
      id: `wd-${Date.now()}`,
      documentNumber,
      type: docType,
      date: docDate,
      warehouseId: selectedWarehouseId,
      beneficiaryOrSupplier: beneficiary.trim(),
      reason,
      items: formItems,
      totalQuantity: totalQty,
      totalCost,
      status: 'posted',
      performedBy: 'أمين المستودع',
      createdAt: new Date().toISOString(),
    };

    onSaveDocument(newDoc);
    setIsNewDocModalOpen(false);
    setBeneficiary('');
    onNotify?.('success', `تم إصدار وتوثيق ${docType.replace(/_/g, ' ')} رقم ${documentNumber}.`);
  };

  const filteredDocs = useMemo(
    () =>
      documents.filter(
        (d) =>
          (filterType === 'all' || d.type === filterType) &&
          (filterWh === 'all' || d.warehouseId === filterWh)
      ),
    [documents, filterType, filterWh]
  );

  const buildDocPdfOptions = (doc: WarehouseDocument) => {
    const whName = warehouses.find((w) => w.id === doc.warehouseId)?.nameAr || '-';
    return {
      title: `${doc.type.replace(/_/g, ' ')} #${doc.documentNumber}`,
      subtitle: doc.beneficiaryOrSupplier,
      reportCode: doc.documentNumber,
      periodText: doc.date,
      company,
      branch,
      preparedBy: doc.performedBy,
      notes: doc.reason || doc.notes,
      fileName: `مستند_مخزني_${doc.documentNumber}`,
      metadata: {
        'رقم المستند': doc.documentNumber,
        'نوع الإذن': doc.type.replace(/_/g, ' '),
        'المستودع': whName,
        'الجهة / المستفيد': doc.beneficiaryOrSupplier,
        'التاريخ': doc.date,
        'الحالة': doc.status === 'posted' ? 'معتمد' : doc.status === 'cancelled' ? 'ملغى' : 'مسودة',
      },
      tables: [
        {
          title: 'بنود الإذن المخزني',
          headers: ['#', 'الصنف', 'الوحدة', 'الكمية', 'التكلفة الفردية', 'الإجمالي'],
          rows: doc.items.map((it, idx) => [
            String(idx + 1),
            it.itemName,
            it.unit,
            String(it.quantity),
            it.unitCost.toLocaleString(),
            `${it.totalCost.toLocaleString()} ${currencySymbol}`,
          ]),
          totals: ['', 'الإجماليات', '', String(doc.totalQuantity), '', `${doc.totalCost.toLocaleString()} ${currencySymbol}`],
        },
      ],
    };
  };

  const inspectIdx = inspectDoc ? filteredDocs.findIndex((d) => d.id === inspectDoc.id) : -1;

  const columns: ErpTableColumn<WarehouseDocument>[] = [
    {
      key: 'documentNumber',
      label: 'رقم الإذن / المحضر',
      sortable: true,
      render: (doc) => <span className="font-mono font-bold text-amber-400">{doc.documentNumber}</span>,
    },
    {
      key: 'type',
      label: 'نوع المستند',
      sortable: true,
      render: (doc) => <span className="font-bold text-white">{doc.type.replace(/_/g, ' ')}</span>,
    },
    {
      key: 'date',
      label: 'التاريخ',
      sortable: true,
      render: (doc) => <span className="font-mono text-slate-400">{doc.date}</span>,
    },
    {
      key: 'warehouseId',
      label: 'المستودع',
      sortable: true,
      sortValue: (doc) => warehouses.find((w) => w.id === doc.warehouseId)?.nameAr || '',
      render: (doc) => (
        <span className="text-slate-300">{warehouses.find((w) => w.id === doc.warehouseId)?.nameAr || '-'}</span>
      ),
    },
    {
      key: 'beneficiaryOrSupplier',
      label: 'المستفيد / المورد',
      sortable: true,
      render: (doc) => <span className="text-slate-200">{doc.beneficiaryOrSupplier}</span>,
    },
    {
      key: 'totalQuantity',
      label: 'إجمالي الكمية',
      align: 'center',
      sortable: true,
      render: (doc) => <span className="font-mono font-bold text-white">{doc.totalQuantity}</span>,
      footerRender: (rows) => `${rows.reduce((s, r) => s + r.totalQuantity, 0).toLocaleString()}`,
    },
    {
      key: 'totalCost',
      label: 'القيمة',
      align: 'left',
      sortable: true,
      render: (doc) => (
        <span className="font-mono font-bold text-emerald-400">
          {doc.totalCost.toLocaleString()} {currencySymbol}
        </span>
      ),
      footerRender: (rows) =>
        `${rows.reduce((s, r) => s + r.totalCost, 0).toLocaleString()} ${currencySymbol}`,
    },
    {
      key: 'status',
      label: 'الحالة',
      align: 'center',
      render: (doc) => (
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
            doc.status === 'posted' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
          }`}
        >
          {doc.status === 'posted' ? 'معتمد' : 'مسودة'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'إجراءات',
      align: 'center',
      sortable: false,
      render: (doc) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setInspectDoc(doc)}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
            title="معاينة التفاصيل"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void downloadReportAsPDF(buildDocPdfOptions(doc))}
            className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded"
            title="تنزيل PDF"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => printReportPreview(buildDocPdfOptions(doc))}
            className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded"
            title="طباعة"
          >
            <Printer className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
            <FileText className="w-5 h-5" />
          </span>
          <div>
            <h3 className="text-base font-black text-white">أذون ومحاضر المخزون (10 أنواع مستندات)</h3>
            <p className="text-xs text-slate-400">
              إصدار وتوثيق أذون التوريد، الصرف، الاستلام، المرتجعات، التحويلات، ومحاضر التلف والجرد مع الطباعة و PDF
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportToExcel({
                fileName: 'سجل_الأذون_المخزنية',
                sheets: [
                  {
                    name: 'الأذون المخزنية',
                    data: [
                      ['رقم الإذن', 'النوع', 'التاريخ', 'المستودع', 'الجهة', 'الكمية', 'التكلفة', 'الحالة'],
                      ...filteredDocs.map((d) => [
                        d.documentNumber,
                        d.type.replace(/_/g, ' '),
                        d.date,
                        warehouses.find((w) => w.id === d.warehouseId)?.nameAr || '-',
                        d.beneficiaryOrSupplier,
                        d.totalQuantity,
                        d.totalCost,
                        d.status,
                      ]),
                    ],
                  },
                ],
              })
            }
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-emerald-300 font-bold text-xs rounded-xl cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsNewDocModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إصدار إذن / محضر جديد</span>
          </button>
        </div>
      </div>

      <ErpDataTable
        tableId="warehouse_docs"
        title="سجل أذون ومحاضر المخزون"
        data={filteredDocs}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="ابحث برقم الإذن، المستفيد، أو الملاحظات..."
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        onRowClick={(doc) => setInspectDoc(doc)}
        filtersSlot={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-2.5 py-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="all">كافة الأنواع</option>
              <option value="إذن_توريد">إذن توريد</option>
              <option value="إذن_صرف">إذن صرف</option>
              <option value="إذن_استلام">إذن استلام</option>
              <option value="إذن_تحويل">إذن تحويل</option>
              <option value="طلب_مناقلة">طلب مناقلة</option>
              <option value="إذن_مرتجع_مخزني">إذن مرتجع مخزني</option>
              <option value="إذن_تسوية_زيادة">إذن تسوية زيادة</option>
              <option value="إذن_تسوية_عجز">إذن تسوية عجز</option>
              <option value="محضر_جرد">محضر جرد</option>
              <option value="محضر_تلف">محضر تلف</option>
            </select>
            <select
              value={filterWh}
              onChange={(e) => setFilterWh(e.target.value)}
              className="bg-slate-950 border border-slate-700 px-2.5 py-2 rounded-lg text-slate-200 text-xs focus:border-amber-500 focus:outline-none"
            >
              <option value="all">كل المستودعات</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* Modal: Create Document */}
      {isNewDocModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto no-print">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">إصدار إذن أو محضر مخزني جديد</h3>
              <button type="button" onClick={() => setIsNewDocModalOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">نوع المستند *</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as WarehouseDocType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-bold focus:border-amber-500 focus:outline-none"
                  >
                    <option value="إذن_توريد">إذن توريد</option>
                    <option value="إذن_صرف">إذن صرف</option>
                    <option value="إذن_استلام">إذن استلام</option>
                    <option value="إذن_تحويل">إذن تحويل</option>
                    <option value="طلب_مناقلة">طلب مناقلة</option>
                    <option value="إذن_مرتجع_مخزني">إذن مرتجع مخزني</option>
                    <option value="إذن_تسوية_زيادة">إذن تسوية زيادة</option>
                    <option value="إذن_تسوية_عجز">إذن تسوية عجز</option>
                    <option value="محضر_جرد">محضر جرد</option>
                    <option value="محضر_تلف">محضر تلف</option>
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">المستودع المعني *</label>
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameAr}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-300 font-semibold block mb-1">التاريخ</label>
                  <input
                    type="date"
                    value={docDate}
                    onChange={(e) => setDocDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">المستلم / المورد / الجهة المستفيدة *</label>
                  <input
                    type="text"
                    required
                    value={beneficiary}
                    onChange={(e) => setBeneficiary(e.target.value)}
                    placeholder="اسم الشخص أو القسم أو المورد"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">السبب / الملاحظات</label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="موجب أمر الشراء / استهلاك داخلي..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">الأصناف المشمولة بالإذن</span>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="text-amber-400 hover:text-amber-300 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة صنف</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {formItems.map((row, idx) => (
                    <div key={row.id} className="grid grid-cols-12 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800 items-center">
                      <div className="col-span-5">
                        <select
                          value={row.itemId}
                          onChange={(e) => handleItemChange(idx, 'itemId', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-white text-xs"
                        >
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.nameAr} ({it.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          min="1"
                          value={row.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          placeholder="الكمية"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-center text-white font-mono font-bold"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={row.unitCost}
                          onChange={(e) => handleItemChange(idx, 'unitCost', e.target.value)}
                          placeholder="التكلفة"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-left text-white font-mono"
                        />
                      </div>
                      <div className="col-span-2 text-left font-mono font-bold text-emerald-400">
                        {row.totalCost.toLocaleString()}
                      </div>
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItemRow(idx)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewDocModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg"
                >
                  حفظ وتوثيق الإذن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Document Modal with Prev/Next Stepping + PDF/Print */}
      {inspectDoc && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 overflow-y-auto no-print">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden p-6 space-y-4 text-xs">
            <div className="flex flex-wrap justify-between items-center gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  {inspectDoc.type.replace(/_/g, ' ')} - <span className="font-mono text-amber-400">{inspectDoc.documentNumber}</span>
                </h3>
                <span className="text-slate-400">التاريخ: {inspectDoc.date}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={inspectIdx <= 0}
                  onClick={() => inspectIdx > 0 && setInspectDoc(filteredDocs[inspectIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-35"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={inspectIdx < 0 || inspectIdx >= filteredDocs.length - 1}
                  onClick={() =>
                    inspectIdx >= 0 && inspectIdx < filteredDocs.length - 1 && setInspectDoc(filteredDocs[inspectIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-35"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setInspectDoc(null)} className="p-1.5 text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div>
                <span className="text-slate-500 block">المستودع:</span>
                <span className="font-bold text-white">{warehouses.find((w) => w.id === inspectDoc.warehouseId)?.nameAr}</span>
              </div>
              <div>
                <span className="text-slate-500 block">الجهة / المستفيد:</span>
                <span className="font-bold text-white">{inspectDoc.beneficiaryOrSupplier}</span>
              </div>
              <div>
                <span className="text-slate-500 block">السبب / البيان:</span>
                <span className="text-slate-200">{inspectDoc.reason || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">المسؤول:</span>
                <span className="text-slate-200">{inspectDoc.performedBy}</span>
              </div>
            </div>

            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3 text-center">الوحدة</th>
                  <th className="py-2 px-3 text-center">الكمية</th>
                  <th className="py-2 px-3 text-left">التكلفة الفردية</th>
                  <th className="py-2 px-3 text-left">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {inspectDoc.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 px-3 font-sans text-white">{it.itemName}</td>
                    <td className="py-2 px-3 text-center font-sans text-slate-400">{it.unit}</td>
                    <td className="py-2 px-3 text-center font-bold text-white">{it.quantity}</td>
                    <td className="py-2 px-3 text-left text-slate-300">{it.unitCost.toLocaleString()}</td>
                    <td className="py-2 px-3 text-left font-bold text-emerald-400">
                      {it.totalCost.toLocaleString()} {currencySymbol}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap justify-between items-center pt-3 border-t border-slate-800 gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadReportAsPDF(buildDocPdfOptions(inspectDoc))}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تنزيل PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => printReportPreview(buildDocPdfOptions(inspectDoc))}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setInspectDoc(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
