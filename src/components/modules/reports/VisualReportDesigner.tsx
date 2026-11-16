/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Stage E Interactive Drag-and-Drop Visual Report Designer
 * Supports HTML5 Drag Reorder, Manual Widths, Pinning (Right/Left), Wrap, Row Height/Padding,
 * Typography/Colors/Borders, Subtotals & Grand Totals, Calculated Formula Fields (safe parser),
 * Filter Builder, Multi-Level Sorting, Grouping, Named Template Persistence, & Phase 1 Print/PDF Engine.
 */

import React, { useMemo, useState } from 'react';
import {
  LayoutTemplate,
  GripVertical,
  Plus,
  Copy,
  Save,
  Trash2,
  RotateCcw,
  Printer,
  FileSpreadsheet,
  Download,
  Filter,
  Sliders,
  Calculator,
  Pin,
  Eye,
  EyeOff,
  Search,
  Layers,
  ArrowUpDown,
} from 'lucide-react';
import { ERPDatabase } from '../../../services/storageService';
import {
  ReportDataSourceKey,
  SavedReportColumnDef,
  SavedReportDesign,
  SavedReportFilterRule,
  User,
} from '../../../types/erp';
import {
  downloadReportAsPDF,
  exportToExcel,
  exportToCSV,
  ReportPDFOptions,
} from '../../../services/exportService';
import { PrintableDocumentData } from '../../common/PrintModal';
import { hasGranularPermission } from '../../../services/securityService';

interface VisualReportDesignerProps {
  db: ERPDatabase;
  currentUser: User;
  onSaveReportDesigns: (designs: SavedReportDesign[]) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DATA_SOURCE_META: Record<
  ReportDataSourceKey,
  {
    labelAr: string;
    defaultCols: Array<{ field: string; label: string; format: 'text' | 'number' | 'currency' | 'date'; widthPx: number }>;
  }
> = {
  invoices: {
    labelAr: 'الفواتير (مبيعات ومشتريات ومرتجعات)',
    defaultCols: [
      { field: 'invoiceNumber', label: 'رقم الفاتورة', format: 'text', widthPx: 120 },
      { field: 'type', label: 'النوع', format: 'text', widthPx: 95 },
      { field: 'date', label: 'التاريخ', format: 'date', widthPx: 105 },
      { field: 'entityName', label: 'العميل / المورد', format: 'text', widthPx: 200 },
      { field: 'currency', label: 'العملة', format: 'text', widthPx: 75 },
      { field: 'subtotal', label: 'قبل الضريبة', format: 'currency', widthPx: 115 },
      { field: 'taxTotal', label: 'الضريبة', format: 'currency', widthPx: 95 },
      { field: 'grandTotal', label: 'الإجمالي', format: 'currency', widthPx: 125 },
      { field: 'paidAmount', label: 'المدفوع', format: 'currency', widthPx: 115 },
      { field: 'remainingAmount', label: 'المتبقي', format: 'currency', widthPx: 115 },
      { field: 'status', label: 'الحالة', format: 'text', widthPx: 85 },
    ],
  },
  journalEntries: {
    labelAr: 'القيود المحاسبية',
    defaultCols: [
      { field: 'entryNumber', label: 'رقم القيد', format: 'text', widthPx: 115 },
      { field: 'date', label: 'التاريخ', format: 'date', widthPx: 105 },
      { field: 'referenceType', label: 'المصدر', format: 'text', widthPx: 110 },
      { field: 'referenceNumber', label: 'رقم المرجع', format: 'text', widthPx: 110 },
      { field: 'description', label: 'البيان', format: 'text', widthPx: 240 },
      { field: 'totalDebit', label: 'مدين', format: 'currency', widthPx: 120 },
      { field: 'totalCredit', label: 'دائن', format: 'currency', widthPx: 120 },
      { field: 'status', label: 'الحالة', format: 'text', widthPx: 85 },
    ],
  },
  customers: {
    labelAr: 'العملاء والمديونية',
    defaultCols: [
      { field: 'code', label: 'كود العميل', format: 'text', widthPx: 100 },
      { field: 'nameAr', label: 'اسم العميل', format: 'text', widthPx: 200 },
      { field: 'phone', label: 'الهاتف', format: 'text', widthPx: 115 },
      { field: 'category', label: 'الفئة', format: 'text', widthPx: 95 },
      { field: 'creditLimit', label: 'الحد الائتماني', format: 'currency', widthPx: 120 },
      { field: 'openingBalance', label: 'الرصيد الافتتاحي', format: 'currency', widthPx: 120 },
      { field: 'currentBalance', label: 'الرصيد الحالي', format: 'currency', widthPx: 130 },
      { field: 'status', label: 'الحالة', format: 'text', widthPx: 85 },
    ],
  },
  vendors: {
    labelAr: 'الموردون والذمم الدائنة',
    defaultCols: [
      { field: 'code', label: 'كود المورد', format: 'text', widthPx: 100 },
      { field: 'nameAr', label: 'اسم المورد', format: 'text', widthPx: 200 },
      { field: 'phone', label: 'الهاتف', format: 'text', widthPx: 115 },
      { field: 'category', label: 'الفئة', format: 'text', widthPx: 95 },
      { field: 'openingBalance', label: 'الرصيد الافتتاحي', format: 'currency', widthPx: 120 },
      { field: 'currentBalance', label: 'الرصيد المستحق', format: 'currency', widthPx: 130 },
      { field: 'status', label: 'الحالة', format: 'text', widthPx: 85 },
    ],
  },
  inventory: {
    labelAr: 'الأصناف والمخزون والتقييم',
    defaultCols: [
      { field: 'code', label: 'الكود', format: 'text', widthPx: 100 },
      { field: 'barcode', label: 'الباركود', format: 'text', widthPx: 120 },
      { field: 'nameAr', label: 'اسم الصنف', format: 'text', widthPx: 210 },
      { field: 'category', label: 'المجموعة', format: 'text', widthPx: 115 },
      { field: 'baseUnit', label: 'الوحدة', format: 'text', widthPx: 80 },
      { field: 'totalStockQty', label: 'الكمية المتوفرة', format: 'number', widthPx: 110 },
      { field: 'purchasePrice', label: 'سعر الشراء', format: 'currency', widthPx: 110 },
      { field: 'salePrice', label: 'سعر البيع', format: 'currency', widthPx: 110 },
      { field: 'stockValuation', label: 'قيمة المخزون', format: 'currency', widthPx: 130 },
    ],
  },
  treasury: {
    labelAr: 'الخزائن والصناديق والبنوك',
    defaultCols: [
      { field: 'code', label: 'الكود', format: 'text', widthPx: 95 },
      { field: 'nameAr', label: 'اسم الحساب/الصندوق', format: 'text', widthPx: 210 },
      { field: 'type', label: 'النوع', format: 'text', widthPx: 95 },
      { field: 'currency', label: 'العملة', format: 'text', widthPx: 80 },
      { field: 'balance', label: 'الرصيد الفعلي', format: 'currency', widthPx: 135 },
      { field: 'baseBalance', label: 'المعادل بالأساس', format: 'currency', widthPx: 135 },
    ],
  },
  expenses: {
    labelAr: 'سجل المصروفات التشغيلية',
    defaultCols: [
      { field: 'expenseNumber', label: 'رقم السند', format: 'text', widthPx: 110 },
      { field: 'date', label: 'التاريخ', format: 'date', widthPx: 105 },
      { field: 'categoryName', label: 'البند', format: 'text', widthPx: 150 },
      { field: 'beneficiary', label: 'المستفيد', format: 'text', widthPx: 150 },
      { field: 'currency', label: 'العملة', format: 'text', widthPx: 75 },
      { field: 'total', label: 'الإجمالي', format: 'currency', widthPx: 125 },
      { field: 'statement', label: 'البيان', format: 'text', widthPx: 200 },
    ],
  },
  vouchers: {
    labelAr: 'سندات القبض والصرف',
    defaultCols: [
      { field: 'voucherNumber', label: 'رقم السند', format: 'text', widthPx: 110 },
      { field: 'type', label: 'النوع', format: 'text', widthPx: 85 },
      { field: 'date', label: 'التاريخ', format: 'date', widthPx: 105 },
      { field: 'entityName', label: 'الطرف', format: 'text', widthPx: 185 },
      { field: 'treasuryAccountName', label: 'الخزينة', format: 'text', widthPx: 155 },
      { field: 'currency', label: 'العملة', format: 'text', widthPx: 75 },
      { field: 'amount', label: 'المبلغ', format: 'currency', widthPx: 120 },
      { field: 'baseAmount', label: 'المعادل بالأساس', format: 'currency', widthPx: 130 },
    ],
  },
  fixedAssets: {
    labelAr: 'الأصول الثابتة والإهلاك',
    defaultCols: [
      { field: 'code', label: 'كود الأصل', format: 'text', widthPx: 100 },
      { field: 'nameAr', label: 'اسم الأصل', format: 'text', widthPx: 200 },
      { field: 'category', label: 'الفئة', format: 'text', widthPx: 120 },
      { field: 'purchaseCost', label: 'تكلفة الشراء', format: 'currency', widthPx: 125 },
      { field: 'totalAccumulatedDepreciation', label: 'مجمع الإهلاك', format: 'currency', widthPx: 125 },
      { field: 'currentBookValue', label: 'القيمة الدفترية', format: 'currency', widthPx: 130 },
      { field: 'status', label: 'الحالة', format: 'text', widthPx: 90 },
    ],
  },
};

/**
 * Safe Arithmetic Formula Parser (supports +, -, *, /, parentheses, numeric constants, and row field identifiers)
 * Zero eval() / Function() execution.
 */
export function evaluateSafeRowFormula(expr: string, row: Record<string, unknown>): number {
  const tokens: Array<{ type: 'num' | 'op' | 'lp' | 'rp' | 'id'; val: string }> = [];
  let i = 0;
  const s = expr || '';
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lp', val: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rp', val: ')' });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < s.length && /[0-9.]/.test(s[i])) {
        numStr += s[i++];
      }
      tokens.push({ type: 'num', val: numStr });
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) {
      let idStr = '';
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) {
        idStr += s[i++];
      }
      tokens.push({ type: 'id', val: idStr });
      continue;
    }
    i++;
  }

  let pos = 0;
  const parseExpr = (): number => {
    let left = parseTerm();
    while (pos < tokens.length && tokens[pos].type === 'op' && (tokens[pos].val === '+' || tokens[pos].val === '-')) {
      const op = tokens[pos++].val;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number => {
    let left = parseFactor();
    while (pos < tokens.length && tokens[pos].type === 'op' && (tokens[pos].val === '*' || tokens[pos].val === '/')) {
      const op = tokens[pos++].val;
      const right = parseFactor();
      if (op === '*') left *= right;
      else left = right === 0 ? 0 : left / right;
    }
    return left;
  };
  const parseFactor = (): number => {
    if (pos >= tokens.length) return 0;
    const tok = tokens[pos];
    if (tok.type === 'op' && tok.val === '-') {
      pos++;
      return -parseFactor();
    }
    if (tok.type === 'lp') {
      pos++;
      const val = parseExpr();
      if (pos < tokens.length && tokens[pos].type === 'rp') pos++;
      return val;
    }
    pos++;
    if (tok.type === 'num') return Number(tok.val) || 0;
    if (tok.type === 'id') return Number(row[tok.val]) || 0;
    return 0;
  };

  try {
    const res = parseExpr();
    return Number.isFinite(res) ? Math.round(res * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

function buildColumnsForSource(source: ReportDataSourceKey): SavedReportColumnDef[] {
  const defs = DATA_SOURCE_META[source].defaultCols;
  return defs.map((d, idx) => ({
    id: `col-${source}-${d.field}`,
    field: d.field,
    label: d.label,
    visible: true,
    order: idx,
    widthPx: d.widthPx,
    pin: idx === 0 ? 'right' : 'none',
    align: d.format === 'currency' || d.format === 'number' ? 'left' : d.format === 'date' ? 'center' : 'right',
    wrapText: false,
    fontSizePx: 12,
    fontWeight: idx === 0 ? 'bold' : 'normal',
    showSubtotal: d.format === 'currency' || d.format === 'number',
    showGrandTotal: d.format === 'currency' || d.format === 'number',
    sortable: true,
    searchable: d.format === 'text' || d.format === 'date',
    format: d.format,
  }));
}

export const VisualReportDesigner: React.FC<VisualReportDesignerProps> = ({
  db,
  currentUser,
  onSaveReportDesigns,
  onOpenPrintModal,
  onNotify,
}) => {
  const savedDesigns = db.savedReportDesigns || [];
  const canEditTemplates = hasGranularPermission(currentUser, 'reports', 'manageSettings') || hasGranularPermission(currentUser, 'reports', 'create');

  const [selectedDesignId, setSelectedDesignId] = useState<string>(savedDesigns[0]?.id || 'new-temp');
  const initialDesign: SavedReportDesign = savedDesigns[0] || {
    id: 'design-init',
    nameAr: 'تقرير مخصص جديد',
    dataSource: 'invoices',
    columns: buildColumnsForSource('invoices'),
    filters: [],
    sortRules: [],
    rowHeightPx: 38,
    cellPaddingPx: 8,
    paperOrientation: 'landscape',
    splitWideTableOnPrint: true,
    createdBy: currentUser.fullName,
    updatedAt: new Date().toISOString(),
  };

  const [design, setDesign] = useState<SavedReportDesign>(initialDesign);
  const [selectedColId, setSelectedColId] = useState<string>(initialDesign.columns[0]?.id || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Calculated Field state
  const [calcLabel, setCalcLabel] = useState('');
  const [calcFormula, setCalcFormula] = useState('');

  // Extract raw records per data source & active company
  const rawRecords = useMemo<Array<Record<string, unknown>>>(() => {
    const cid = db.activeCompanyId || db.company.id;
    switch (design.dataSource) {
      case 'invoices':
        return db.invoices
          .filter((i) => !i.companyId || i.companyId === cid)
          .map((i) => ({ ...i }));
      case 'journalEntries':
        return db.journalEntries
          .filter((j) => !j.companyId || j.companyId === cid)
          .map((j) => ({ ...j }));
      case 'customers':
        return db.customers
          .filter((c) => !c.companyId || c.companyId === cid)
          .map((c) => ({ ...c }));
      case 'vendors':
        return db.vendors
          .filter((v) => !v.companyId || v.companyId === cid)
          .map((v) => ({ ...v }));
      case 'inventory':
        return db.inventoryItems
          .filter((it) => !it.companyId || it.companyId === cid)
          .map((it) => {
            const stocks = db.warehouseStock.filter((s) => s.itemId === it.id);
            const totalStockQty = stocks.reduce((sum, s) => sum + (s.quantityOnHand || 0), 0);
            const stockValuation = stocks.reduce(
              (sum, s) => sum + (s.quantityOnHand || 0) * (s.averageCost || it.purchasePrice || 0),
              0
            );
            return { ...it, totalStockQty, stockValuation: Math.round(stockValuation * 100) / 100 };
          });
      case 'treasury':
        return db.treasuryAccounts
          .filter((t) => !t.companyId || t.companyId === cid)
          .map((t) => {
            const rate = db.currencies.find((c) => c.code === t.currency)?.exchangeRate || 1;
            return { ...t, baseBalance: Math.round(t.balance * rate * 100) / 100 };
          });
      case 'expenses':
        return db.expenseRecords.map((e) => ({ ...e }));
      case 'vouchers':
        return db.paymentVouchers
          .filter((v) => !v.companyId || v.companyId === cid)
          .map((v) => ({ ...v }));
      case 'fixedAssets':
        return db.fixedAssets
          .filter((a) => !a.companyId || a.companyId === cid)
          .map((a) => ({ ...a }));
      default:
        return [];
    }
  }, [db, design.dataSource]);

  const orderedColumns = useMemo(
    () => [...design.columns].sort((a, b) => a.order - b.order),
    [design.columns]
  );

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => c.visible),
    [orderedColumns]
  );

  // Enrich rows with calculated formula columns, then apply filters, search, and multi-level sorting
  const processedRows = useMemo(() => {
    const calcCols = orderedColumns.filter((c) => c.isCalculated && c.formulaExpr);
    let rows = rawRecords.map((r) => {
      if (calcCols.length === 0) return r;
      const copy = { ...r };
      for (const cc of calcCols) {
        copy[cc.field] = evaluateSafeRowFormula(cc.formulaExpr || '0', copy);
      }
      return copy;
    });

    // Apply Dynamic Filters
    if (design.filters.length > 0) {
      rows = rows.filter((row) =>
        design.filters.every((f) => {
          if (!f.field || !f.value.trim()) return true;
          const val = row[f.field];
          const strVal = String(val ?? '').toLowerCase();
          const target = f.value.trim().toLowerCase();
          const numVal = Number(val);
          const numTarget = Number(f.value);
          switch (f.operator) {
            case 'contains':
              return strVal.includes(target);
            case 'equals':
              return strVal === target;
            case 'gt':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal > numTarget;
            case 'lt':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal < numTarget;
            case 'gte':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal >= numTarget;
            case 'lte':
              return Number.isFinite(numVal) && Number.isFinite(numTarget) && numVal <= numTarget;
            default:
              return true;
          }
        })
      );
    }

    // Apply Live Search across Searchable columns
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const searchableCols = visibleColumns.filter((c) => c.searchable !== false);
      rows = rows.filter((row) =>
        searchableCols.some((c) => String(row[c.field] ?? '').toLowerCase().includes(q))
      );
    }

    // Apply Multi-Level Sorting
    if (design.sortRules.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const sr of design.sortRules) {
          if (!sr.field) continue;
          const va = a[sr.field];
          const vb = b[sr.field];
          let cmp = 0;
          if (typeof va === 'number' && typeof vb === 'number') {
            cmp = va - vb;
          } else {
            cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'ar');
          }
          if (cmp !== 0) return sr.direction === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }

    return rows;
  }, [rawRecords, orderedColumns, visibleColumns, design.filters, design.sortRules, searchQuery]);

  // Grouping (with optional Group Subtotals)
  const groupedSections = useMemo(() => {
    if (!design.groupByField) {
      return [{ groupKey: '__all__', groupLabel: '', rows: processedRows }];
    }
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const r of processedRows) {
      const gk = String(r[design.groupByField] ?? 'غير مصنف');
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk)!.push(r);
    }
    return Array.from(groups.entries()).map(([k, list]) => ({
      groupKey: k,
      groupLabel: k,
      rows: list,
    }));
  }, [processedRows, design.groupByField]);

  const selectedCol = orderedColumns.find((c) => c.id === selectedColId) || orderedColumns[0];

  const handleLoadDesign = (id: string) => {
    const found = savedDesigns.find((d) => d.id === id);
    if (!found) return;
    setSelectedDesignId(found.id);
    setDesign(JSON.parse(JSON.stringify(found)));
    setSelectedColId(found.columns[0]?.id || '');
  };

  const handleChangeDataSource = (src: ReportDataSourceKey) => {
    const cols = buildColumnsForSource(src);
    setDesign((prev) => ({
      ...prev,
      dataSource: src,
      columns: cols,
      filters: [],
      groupByField: undefined,
      sortRules: [],
    }));
    setSelectedColId(cols[0]?.id || '');
  };

  const handleDropCol = (targetIdx: number) => {
    if (dragColIdx === null || dragColIdx === targetIdx) {
      setDragColIdx(null);
      setDragOverIdx(null);
      return;
    }
    const copy = [...orderedColumns];
    const [moved] = copy.splice(dragColIdx, 1);
    copy.splice(targetIdx, 0, moved);
    setDesign((prev) => ({
      ...prev,
      columns: copy.map((c, idx) => ({ ...c, order: idx })),
    }));
    setDragColIdx(null);
    setDragOverIdx(null);
  };

  const updateCol = (colId: string, patch: Partial<SavedReportColumnDef>) => {
    setDesign((prev) => ({
      ...prev,
      columns: prev.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)),
    }));
  };

  const handleAddCalculatedField = () => {
    const label = calcLabel.trim();
    const formula = calcFormula.trim();
    if (!label || !formula) {
      onNotify('error', 'يرجى إدخال اسم الحقل المحسوب والمعادلة الحسابية.');
      return;
    }
    const newCol: SavedReportColumnDef = {
      id: `calc-${Date.now()}`,
      field: `calc_${Date.now()}`,
      label,
      visible: true,
      order: orderedColumns.length,
      widthPx: 130,
      pin: 'none',
      align: 'left',
      wrapText: false,
      fontSizePx: 12,
      fontWeight: 'bold',
      textColor: '#fbbf24',
      showSubtotal: true,
      showGrandTotal: true,
      sortable: true,
      searchable: false,
      isCalculated: true,
      formulaExpr: formula,
      format: 'currency',
    };
    setDesign((prev) => ({ ...prev, columns: [...prev.columns, newCol] }));
    setSelectedColId(newCol.id);
    setCalcLabel('');
    setCalcFormula('');
    onNotify('success', `تمت إضافة الحقل المحسوب "${label}".`);
  };

  const handleSaveTemplate = (asClone = false) => {
    if (!canEditTemplates) {
      onNotify('error', 'صلاحيات المستخدم الحالي لا تسمح بحفظ أو تعديل قوالب التقارير.');
      return;
    }
    const nowIso = new Date().toISOString();
    const exists = !asClone && savedDesigns.some((d) => d.id === design.id);
    const savedObj: SavedReportDesign = exists
      ? { ...design, updatedAt: nowIso }
      : {
          ...design,
          id: `rep-design-${Date.now()}`,
          nameAr: asClone ? `${design.nameAr} (نسخة)` : design.nameAr,
          isDefaultTemplate: false,
          createdBy: currentUser.fullName,
          updatedAt: nowIso,
        };

    const nextList = exists
      ? savedDesigns.map((d) => (d.id === savedObj.id ? savedObj : d))
      : [savedObj, ...savedDesigns];

    onSaveReportDesigns(nextList);
    setSelectedDesignId(savedObj.id);
    setDesign(savedObj);
    onNotify('success', `تم حفظ قالب التقرير "${savedObj.nameAr}" بنجاح.`);
  };

  const handleDeleteTemplate = () => {
    if (!canEditTemplates) {
      onNotify('error', 'صلاحياتك لا تسمح بحذف القوالب.');
      return;
    }
    if (savedDesigns.length <= 1) {
      onNotify('info', 'يجب الاحتفاظ بقالب تقرير واحد على الأقل.');
      return;
    }
    const nextList = savedDesigns.filter((d) => d.id !== design.id);
    onSaveReportDesigns(nextList);
    handleLoadDesign(nextList[0].id);
    onNotify('success', 'تم حذف القالب المخصص.');
  };

  const handleResetSourceColumns = () => {
    const freshCols = buildColumnsForSource(design.dataSource);
    setDesign((prev) => ({
      ...prev,
      columns: freshCols,
      filters: [],
      groupByField: undefined,
      sortRules: [],
      rowHeightPx: 38,
      cellPaddingPx: 8,
    }));
    setSelectedColId(freshCols[0]?.id || '');
    onNotify('info', 'تمت استعادة الأعمدة والتنسيق الافتراضي لمصدر البيانات.');
  };

  // Phase 1 Print & PDF Integration (including automatic wide-table splitting or landscape mode)
  const buildPdfPayload = (): ReportPDFOptions => {
    const headers = visibleColumns.map((c) => c.label);
    const alignments = visibleColumns.map((c) => c.align);
    const formatCell = (val: unknown, col: SavedReportColumnDef): string | number => {
      if (val === undefined || val === null) return '';
      if (col.format === 'currency' || col.format === 'number') {
        const n = Number(val);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : String(val);
      }
      return String(val);
    };

    const rows = processedRows.map((r) => visibleColumns.map((c) => formatCell(r[c.field], c)));
    const hasGrandTotals = visibleColumns.some((c) => c.showGrandTotal);
    const totalsRow = hasGrandTotals
      ? visibleColumns.map((c, i) => {
          if (i === 0) return 'الإجمالي العام';
          if (!c.showGrandTotal) return '';
          const sum = processedRows.reduce((s, r) => s + (Number(r[c.field]) || 0), 0);
          return Math.round(sum * 100) / 100;
        })
      : undefined;

    // Auto-split very wide tables cleanly across multiple section tables if splitWideTableOnPrint is enabled (> 7 columns)
    const tables = [];
    if (design.splitWideTableOnPrint && visibleColumns.length > 7) {
      const chunkSize = 6;
      for (let start = 0; start < visibleColumns.length; start += chunkSize) {
        const sliceCols = visibleColumns.slice(start, start + chunkSize);
        // Always include first identifier column on split continuation chunks
        const effectiveCols = start > 0 ? [visibleColumns[0], ...sliceCols] : sliceCols;
        const partIndices = effectiveCols.map((ec) => visibleColumns.findIndex((vc) => vc.id === ec.id));
        tables.push({
          title: `${design.nameAr} (الجزء ${Math.floor(start / chunkSize) + 1})`,
          headers: effectiveCols.map((c) => c.label),
          alignments: effectiveCols.map((c) => c.align),
          rows: processedRows.map((r) => partIndices.map((idx) => formatCell(r[visibleColumns[idx].field], visibleColumns[idx]))),
          totals: totalsRow ? partIndices.map((idx) => totalsRow[idx]) : undefined,
        });
      }
    } else {
      tables.push({
        title: design.nameAr,
        headers,
        alignments,
        rows,
        totals: totalsRow,
      });
    }

    const baseTpl = db.settings.printTemplates?.report;
    const effectiveTpl = baseTpl
      ? {
          ...baseTpl,
          orientation:
            design.paperOrientation === 'auto'
              ? visibleColumns.length > 6
                ? ('landscape' as const)
                : ('portrait' as const)
              : design.paperOrientation,
        }
      : undefined;

    return {
      title: design.nameAr,
      subtitle: `مصدر البيانات: ${DATA_SOURCE_META[design.dataSource].labelAr} (${processedRows.length} سجل)`,
      company: db.company,
      preparedBy: currentUser.fullName,
      docType: 'report',
      printTemplate: effectiveTpl,
      printTemplates: db.settings.printTemplates,
      tables,
      summaryCards: [
        { label: 'عدد السجلات المطابقة', value: `${processedRows.length}`, tone: 'blue' },
        { label: 'الأعمدة الظاهرة', value: `${visibleColumns.length}`, tone: 'gold' },
      ],
    };
  };

  const handlePrintPreview = () => {
    const payload = buildPdfPayload();
    onOpenPrintModal({
      title: payload.title,
      subtitle: payload.subtitle,
      documentNumber: `RPT-${design.id.slice(-4).toUpperCase()}`,
      date: new Date().toISOString().split('T')[0],
      entityName: DATA_SOURCE_META[design.dataSource].labelAr,
      currencySymbol: db.company.baseCurrency || 'YER',
      totals: {
        subtotal: processedRows.length,
        discountTotal: 0,
        taxTotal: 0,
        grandTotal: processedRows.length,
      },
      customTables: payload.tables,
      customSummaryCards: payload.summaryCards,
    });
  };

  const handleDownloadPdf = async () => {
    try {
      await downloadReportAsPDF(buildPdfPayload());
      onNotify('success', 'تم إنشاء وتنزيل ملف PDF للتقرير المصمم بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تصدير PDF');
    }
  };

  const handleExportExcel = () => {
    const headers = visibleColumns.map((c) => c.label);
    const rows = processedRows.map((r) => visibleColumns.map((c) => (r[c.field] as string | number) ?? ''));
    exportToExcel({
      fileName: `${design.nameAr}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheets: [{ name: 'التقرير المصمم', data: [headers, ...rows] }],
    });
    onNotify('success', 'تم تصدير التقرير إلى Excel بنجاح.');
  };

  const handleExportCsv = () => {
    const headers = visibleColumns.map((c) => c.label);
    const rows = processedRows.map((r) => visibleColumns.map((c) => (r[c.field] as string | number) ?? ''));
    exportToCSV(`${design.nameAr}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    onNotify('success', 'تم تصدير التقرير إلى CSV بنجاح.');
  };

  const formatCellDisplay = (val: unknown, col: SavedReportColumnDef) => {
    if (val === undefined || val === null || val === '') return '—';
    if (col.format === 'currency' || col.format === 'number') {
      const n = Number(val);
      return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(val);
    }
    return String(val);
  };

  const calcColumnTotal = (rowsList: Array<Record<string, unknown>>, field: string) => {
    const sum = rowsList.reduce((s, r) => s + (Number(r[field]) || 0), 0);
    return Math.round(sum * 100) / 100;
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Top Designer Toolbar */}
      <div className="bg-[var(--bg-card)] border-2 border-[var(--gold)] rounded-xl p-4 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-[var(--gold)] flex items-center justify-center text-[var(--gold)]">
              <LayoutTemplate className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">مصمم التقارير المرئي التفاعلي (Drag & Drop Report Designer)</h2>
              <p className="text-xs text-slate-400">
                اسحب وأفلت الأعمدة، ثبت الأعمدة يميناً أو يساراً، أضف حقولاً محسوبة وفلاتر وتجميعات، واطبع بنسق عرضي أو مجزأ تلقائياً.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrintPreview}
              className="px-3 py-2 rounded-lg text-xs font-black bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>معاينة وطباعة</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="px-3 py-2 rounded-lg text-xs font-black bg-emerald-600/20 border border-emerald-500 text-emerald-300 hover:bg-emerald-600 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تصدير PDF</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-2 rounded-lg text-xs font-black bg-sky-600/20 border border-sky-500 text-sky-300 hover:bg-sky-600 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-[#08121E] border border-slate-700 text-slate-300 hover:border-slate-500 cursor-pointer"
            >
              CSV
            </button>
          </div>
        </div>

        {/* Template Selector + Name + Data Source + Save/Clone/Reset */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 pt-2 border-t border-slate-800">
          <div className="md:col-span-3">
            <label className="block text-[11px] font-bold text-slate-400 mb-1">القوالب المحفوظة</label>
            <select
              value={selectedDesignId}
              onChange={(e) => handleLoadDesign(e.target.value)}
              className="w-full bg-[#060D15] border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-bold text-white"
            >
              {savedDesigns.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameAr} ({DATA_SOURCE_META[d.dataSource]?.labelAr.split(' ')[0]})
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-bold text-slate-400 mb-1">اسم التقرير المصمم</label>
            <input
              type="text"
              value={design.nameAr}
              onChange={(e) => setDesign((prev) => ({ ...prev, nameAr: e.target.value }))}
              className="w-full bg-[#060D15] border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-bold text-white focus:border-[var(--gold)] focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-[11px] font-bold text-slate-400 mb-1">مصدر البيانات</label>
            <select
              value={design.dataSource}
              onChange={(e) => handleChangeDataSource(e.target.value as ReportDataSourceKey)}
              className="w-full bg-[#060D15] border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-bold text-amber-300"
            >
              {(Object.keys(DATA_SOURCE_META) as ReportDataSourceKey[]).map((key) => (
                <option key={key} value={key}>
                  {DATA_SOURCE_META[key].labelAr}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3 flex items-end gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleSaveTemplate(false)}
              disabled={!canEditTemplates}
              className="flex-1 px-2.5 py-2 rounded-lg text-xs font-black bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] disabled:opacity-40 flex items-center justify-center gap-1 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>حفظ</span>
            </button>
            <button
              type="button"
              onClick={() => handleSaveTemplate(true)}
              disabled={!canEditTemplates}
              title="حفظ كنسخة جديدة"
              className="px-2.5 py-2 rounded-lg text-xs font-bold bg-[#08121E] border border-slate-600 text-slate-200 hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ</span>
            </button>
            <button
              type="button"
              onClick={handleResetSourceColumns}
              title="إعادة الضبط للافتراضي"
              className="p-2 rounded-lg bg-[#08121E] border border-slate-600 text-slate-300 hover:border-amber-400 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDeleteTemplate}
              disabled={!canEditTemplates}
              title="حذف القالب"
              className="p-2 rounded-lg bg-[#2B0B0E] border border-red-800 text-red-400 hover:bg-red-700 hover:text-white cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Left Designer Controls + Right Live Canvas Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Designer Left Sidebar (4 cols) */}
        <div className="xl:col-span-4 space-y-3">
          {/* 1. Drag & Drop Column List */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-[var(--gold)] flex items-center gap-1.5">
                <Sliders className="w-4 h-4" />
                <span>أعمدة التقرير (اسحب وأفلت للترتيب)</span>
              </h3>
              <span className="text-[11px] text-slate-400">
                {visibleColumns.length} / {orderedColumns.length} ظاهر
              </span>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {orderedColumns.map((col, idx) => (
                <div
                  key={col.id}
                  draggable
                  onDragStart={() => setDragColIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOverIdx !== idx) setDragOverIdx(idx);
                  }}
                  onDragLeave={() => setDragOverIdx(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropCol(idx);
                  }}
                  onDragEnd={() => {
                    setDragColIdx(null);
                    setDragOverIdx(null);
                  }}
                  onClick={() => setSelectedColId(col.id)}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                    selectedCol?.id === col.id
                      ? 'bg-amber-500/15 border-[var(--gold)]'
                      : dragOverIdx === idx && dragColIdx !== idx
                      ? 'bg-[#12263A] border-sky-400'
                      : 'bg-[#060D15] border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="cursor-grab text-[var(--gold)] shrink-0">
                      <GripVertical className="w-3.5 h-3.5" />
                    </span>
                    <span className={`text-xs font-bold truncate ${col.visible ? 'text-white' : 'text-slate-500 line-through'}`}>
                      {col.label}
                    </span>
                    {col.isCalculated && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 shrink-0">
                        معادلة
                      </span>
                    )}
                    {col.pin !== 'none' && (
                      <Pin className="w-3 h-3 text-sky-400 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateCol(col.id, { visible: !col.visible });
                      }}
                      className="p-1 rounded hover:bg-slate-800 text-slate-300"
                      title={col.visible ? 'إخفاء العمود' : 'إظهار العمود'}
                    >
                      {col.visible ? <Eye className="w-3.5 h-3.5 text-emerald-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Selected Column Styling, Pinning, Width, Wrap & Totals */}
          {selectedCol && (
            <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-xl p-3 space-y-2.5">
              <h3 className="text-xs font-black text-white border-b border-slate-800 pb-1.5">
                خصائص العمود المحدد: <span className="text-[var(--gold)]">{selectedCol.label}</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">عنوان العمود</label>
                  <input
                    type="text"
                    value={selectedCol.label}
                    onChange={(e) => updateCol(selectedCol.id, { label: e.target.value })}
                    className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">العرض (px)</label>
                  <input
                    type="number"
                    min={50}
                    max={500}
                    value={selectedCol.widthPx}
                    onChange={(e) => updateCol(selectedCol.id, { widthPx: Math.max(50, Number(e.target.value) || 100) })}
                    className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white text-center tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">تثبيت العمود (Freeze)</label>
                  <select
                    value={selectedCol.pin}
                    onChange={(e) => updateCol(selectedCol.id, { pin: e.target.value as 'none' | 'right' | 'left' })}
                    className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="none">غير مثبت</option>
                    <option value="right">تثبيت يمين</option>
                    <option value="left">تثبيت يسار</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">المحاذاة</label>
                  <select
                    value={selectedCol.align}
                    onChange={(e) => updateCol(selectedCol.id, { align: e.target.value as 'right' | 'center' | 'left' })}
                    className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white"
                  >
                    <option value="right">يمين</option>
                    <option value="center">وسط</option>
                    <option value="left">يسار</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">حجم الخط (px)</label>
                  <input
                    type="number"
                    min={9}
                    max={22}
                    value={selectedCol.fontSizePx}
                    onChange={(e) => updateCol(selectedCol.id, { fontSizePx: Math.max(9, Math.min(22, Number(e.target.value) || 12)) })}
                    className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white text-center tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-0.5">وزن الخط والحدود</label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateCol(selectedCol.id, { fontWeight: selectedCol.fontWeight === 'bold' ? 'normal' : 'bold' })
                      }
                      className={`flex-1 py-1 rounded text-xs font-black border cursor-pointer ${
                        selectedCol.fontWeight === 'bold'
                          ? 'bg-[var(--gold)] text-black border-[var(--gold)]'
                          : 'bg-[#060D15] text-slate-300 border-slate-700'
                      }`}
                    >
                      B عريض
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCol.wrapText}
                    onChange={(e) => updateCol(selectedCol.id, { wrapText: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <span>التفاف النص (Wrap)</span>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCol.showGrandTotal}
                    onChange={(e) =>
                      updateCol(selectedCol.id, {
                        showGrandTotal: e.target.checked,
                        showSubtotal: e.target.checked,
                      })
                    }
                    className="accent-amber-400"
                  />
                  <span>إجماليات / مجاميع فرعية</span>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCol.sortable}
                    onChange={(e) => updateCol(selectedCol.id, { sortable: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <span>قابل للفرز</span>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCol.searchable}
                    onChange={(e) => updateCol(selectedCol.id, { searchable: e.target.checked })}
                    className="accent-amber-400"
                  />
                  <span>قابل للبحث</span>
                </label>
              </div>
            </div>
          )}

          {/* 3. Calculated Formula Field Builder */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-black text-amber-300 flex items-center gap-1.5">
              <Calculator className="w-4 h-4" />
              <span>إضافة حقل محسوب (Calculated Field)</span>
            </h3>
            <div className="grid grid-cols-1 gap-1.5">
              <input
                type="text"
                placeholder="اسم العمود (مثال: هامش الربح)"
                value={calcLabel}
                onChange={(e) => setCalcLabel(e.target.value)}
                className="bg-[#060D15] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white"
              />
              <input
                type="text"
                dir="ltr"
                placeholder="المعادلة (مثال: grandTotal - paidAmount أو salePrice - purchasePrice)"
                value={calcFormula}
                onChange={(e) => setCalcFormula(e.target.value)}
                className="bg-[#060D15] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-amber-300 font-mono"
              />
              <button
                type="button"
                onClick={handleAddCalculatedField}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500 text-amber-300 hover:bg-amber-500 hover:text-black text-xs font-black flex items-center justify-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة العمود المحسوب</span>
              </button>
            </div>
          </div>

          {/* 4. Grid Appearance & Page Split Options */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-black text-white">تخطيط الشبكة والصفحة (Grid & Print Layout)</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400">ارتفاع الصف ({design.rowHeightPx}px)</label>
                <input
                  type="range"
                  min={26}
                  max={68}
                  value={design.rowHeightPx}
                  onChange={(e) => setDesign((p) => ({ ...p, rowHeightPx: Number(e.target.value) }))}
                  className="w-full accent-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400">حشوة الخلية ({design.cellPaddingPx}px)</label>
                <input
                  type="range"
                  min={3}
                  max={16}
                  value={design.cellPaddingPx}
                  onChange={(e) => setDesign((p) => ({ ...p, cellPaddingPx: Number(e.target.value) }))}
                  className="w-full accent-amber-400"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">اتجاه الورق</label>
                <select
                  value={design.paperOrientation}
                  onChange={(e) => setDesign((p) => ({ ...p, paperOrientation: e.target.value as 'portrait' | 'landscape' | 'auto' }))}
                  className="w-full bg-[#060D15] border border-slate-700 rounded px-2 py-1 text-xs text-white"
                >
                  <option value="landscape">عرضي (Landscape)</option>
                  <option value="portrait">طولي (Portrait)</option>
                  <option value="auto">تلقائي حسب الأعمدة</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-1.5 text-[11px] text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={design.splitWideTableOnPrint}
                    onChange={(e) => setDesign((p) => ({ ...p, splitWideTableOnPrint: e.target.checked }))}
                    className="accent-amber-400"
                  />
                  <span>تقسيم الجدول العريض للطباعة</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Right Live Preview & Query Canvas (8 cols) */}
        <div className="xl:col-span-8 space-y-3">
          {/* Filter, Grouping, Sorting & Live Search Bar */}
          <div className="bg-[var(--bg-card)] border border-[var(--border-strong)] rounded-xl p-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث فوري في الحقول القابلة للبحث..."
                  className="w-full bg-[#060D15] border border-slate-700 rounded-lg pr-8 pl-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[var(--gold)]" />
                <select
                  value={design.groupByField || ''}
                  onChange={(e) => setDesign((p) => ({ ...p, groupByField: e.target.value || undefined }))}
                  className="bg-[#060D15] border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="">بدون تجميع (Group By)</option>
                  {orderedColumns.map((c) => (
                    <option key={c.id} value={c.field}>
                      تجميع حسب: {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() =>
                  setDesign((p) => ({
                    ...p,
                    filters: [
                      ...p.filters,
                      { id: `flt-${Date.now()}`, field: orderedColumns[0]?.field || '', operator: 'contains', value: '' },
                    ],
                  }))
                }
                className="px-2.5 py-1.5 rounded-lg bg-[#08121E] border border-slate-700 text-xs font-bold text-sky-300 hover:border-sky-400 flex items-center gap-1 cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5" />
                <span>+ فلتر</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setDesign((p) => ({
                    ...p,
                    sortRules: [...p.sortRules, { field: orderedColumns[0]?.field || '', direction: 'desc' }],
                  }))
                }
                className="px-2.5 py-1.5 rounded-lg bg-[#08121E] border border-slate-700 text-xs font-bold text-amber-300 hover:border-amber-400 flex items-center gap-1 cursor-pointer"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>+ فرز متعدد</span>
              </button>
            </div>

            {design.filters.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {design.filters.map((flt) => (
                  <div key={flt.id} className="flex items-center gap-1 bg-[#060D15] border border-slate-700 rounded-lg px-2 py-1">
                    <select
                      value={flt.field}
                      onChange={(e) =>
                        setDesign((p) => ({
                          ...p,
                          filters: p.filters.map((x) => (x.id === flt.id ? { ...x, field: e.target.value } : x)),
                        }))
                      }
                      className="bg-transparent text-xs text-amber-300 font-bold"
                    >
                      {orderedColumns.map((c) => (
                        <option key={c.id} value={c.field} className="bg-[#08121E]">
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={flt.operator}
                      onChange={(e) =>
                        setDesign((p) => ({
                          ...p,
                          filters: p.filters.map((x) =>
                            x.id === flt.id ? { ...x, operator: e.target.value as SavedReportFilterRule['operator'] } : x
                          ),
                        }))
                      }
                      className="bg-transparent text-xs text-slate-300"
                    >
                      <option value="contains" className="bg-[#08121E]">يحتوي</option>
                      <option value="equals" className="bg-[#08121E]">يساوي</option>
                      <option value="gt" className="bg-[#08121E]">&gt;</option>
                      <option value="lt" className="bg-[#08121E]">&lt;</option>
                      <option value="gte" className="bg-[#08121E]">&gt;=</option>
                      <option value="lte" className="bg-[#08121E]">&lt;=</option>
                    </select>
                    <input
                      type="text"
                      value={flt.value}
                      onChange={(e) =>
                        setDesign((p) => ({
                          ...p,
                          filters: p.filters.map((x) => (x.id === flt.id ? { ...x, value: e.target.value } : x)),
                        }))
                      }
                      placeholder="القيمة..."
                      className="w-24 bg-[#0B1623] border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setDesign((p) => ({ ...p, filters: p.filters.filter((x) => x.id !== flt.id) }))}
                      className="text-red-400 hover:text-red-300 px-1 text-xs font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {design.sortRules.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {design.sortRules.map((sr, sIdx) => (
                  <div key={sIdx} className="flex items-center gap-1 bg-[#060D15] border border-slate-700 rounded-lg px-2 py-1 text-xs">
                    <span className="text-slate-400">فرز {sIdx + 1}:</span>
                    <select
                      value={sr.field}
                      onChange={(e) =>
                        setDesign((p) => ({
                          ...p,
                          sortRules: p.sortRules.map((x, idx) => (idx === sIdx ? { ...x, field: e.target.value } : x)),
                        }))
                      }
                      className="bg-transparent text-white font-bold"
                    >
                      {orderedColumns.filter((c) => c.sortable).map((c) => (
                        <option key={c.id} value={c.field} className="bg-[#08121E]">
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={sr.direction}
                      onChange={(e) =>
                        setDesign((p) => ({
                          ...p,
                          sortRules: p.sortRules.map((x, idx) =>
                            idx === sIdx ? { ...x, direction: e.target.value as 'asc' | 'desc' } : x
                          ),
                        }))
                      }
                      className="bg-transparent text-amber-300"
                    >
                      <option value="asc" className="bg-[#08121E]">تصاعدي</option>
                      <option value="desc" className="bg-[#08121E]">تنازلي</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setDesign((p) => ({ ...p, sortRules: p.sortRules.filter((_, idx) => idx !== sIdx) }))}
                      className="text-red-400 px-1 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Designer Interactive Table Canvas */}
          <div className="bg-[var(--bg-card)] border-2 border-[var(--border-strong)] rounded-xl overflow-hidden shadow-lg">
            <div className="px-4 py-2.5 bg-[#071019] border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="font-black text-[var(--gold)]">
                المعاينة التفاعلية الحية — {design.nameAr}
              </span>
              <span className="text-slate-400 tabular-nums">
                عرض {Math.min(processedRows.length, 150)} من أصل {processedRows.length} سجل
              </span>
            </div>

            <div className="overflow-x-auto max-h-[540px]">
              <table className="w-full border-collapse">
                <thead className="bg-[#091422] sticky top-0 z-20">
                  <tr>
                    {visibleColumns.map((col, vIdx) => {
                      const stickyStyle: React.CSSProperties =
                        col.pin === 'right'
                          ? { position: 'sticky', right: 0, zIndex: 25, backgroundColor: '#091422' }
                          : col.pin === 'left'
                          ? { position: 'sticky', left: 0, zIndex: 25, backgroundColor: '#091422' }
                          : {};
                      return (
                        <th
                          key={col.id}
                          onClick={() => setSelectedColId(col.id)}
                          style={{
                            minWidth: `${col.widthPx}px`,
                            width: `${col.widthPx}px`,
                            padding: `${design.cellPaddingPx}px`,
                            textAlign: col.align,
                            ...stickyStyle,
                          }}
                          className={`text-xs font-black border-b-2 border-[var(--gold)] cursor-pointer select-none ${
                            selectedCol?.id === col.id ? 'text-[var(--gold)] bg-amber-500/10' : 'text-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span>{col.label}</span>
                            {col.pin !== 'none' && <Pin className="w-3 h-3 text-sky-400 shrink-0" />}
                            {vIdx >= 0 && col.sortable && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDesign((p) => {
                                    const existing = p.sortRules.find((r) => r.field === col.field);
                                    const nextDir = existing?.direction === 'asc' ? 'desc' : 'asc';
                                    return { ...p, sortRules: [{ field: col.field, direction: nextDir }] };
                                  });
                                }}
                                className="opacity-60 hover:opacity-100"
                              >
                                <ArrowUpDown className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groupedSections.map((sec) => (
                    <React.Fragment key={sec.groupKey}>
                      {sec.groupKey !== '__all__' && (
                        <tr className="bg-[#0F2034]">
                          <td
                            colSpan={visibleColumns.length}
                            className="px-3 py-1.5 text-xs font-black text-amber-300 border-y border-amber-500/40"
                          >
                            المجموعة: {sec.groupLabel} ({sec.rows.length} سجل)
                          </td>
                        </tr>
                      )}
                      {sec.rows.slice(0, 150).map((row, rIdx) => (
                        <tr key={rIdx} className="border-b border-slate-800/70 hover:bg-slate-800/40">
                          {visibleColumns.map((col) => {
                            const stickyStyle: React.CSSProperties =
                              col.pin === 'right'
                                ? { position: 'sticky', right: 0, zIndex: 10, backgroundColor: '#0A1523' }
                                : col.pin === 'left'
                                ? { position: 'sticky', left: 0, zIndex: 10, backgroundColor: '#0A1523' }
                                : {};
                            return (
                              <td
                                key={col.id}
                                style={{
                                  height: `${design.rowHeightPx}px`,
                                  padding: `${design.cellPaddingPx}px`,
                                  fontSize: `${col.fontSizePx}px`,
                                  fontWeight: col.fontWeight,
                                  color: col.textColor || '#e2e8f0',
                                  textAlign: col.align,
                                  whiteSpace: col.wrapText ? 'normal' : 'nowrap',
                                  ...stickyStyle,
                                }}
                                className="tabular-nums border-l border-slate-800/40"
                              >
                                {formatCellDisplay(row[col.field], col)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {sec.groupKey !== '__all__' && visibleColumns.some((c) => c.showSubtotal) && (
                        <tr className="bg-[#0B1726] font-black text-xs text-sky-300 border-b border-sky-700/50">
                          {visibleColumns.map((col, cIdx) => (
                            <td key={col.id} style={{ padding: `${design.cellPaddingPx}px`, textAlign: col.align }} className="tabular-nums">
                              {cIdx === 0
                                ? `مجموع (${sec.groupLabel})`
                                : col.showSubtotal
                                ? calcColumnTotal(sec.rows, col.field).toLocaleString('en-US', { maximumFractionDigits: 2 })
                                : ''}
                            </td>
                          ))}
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
                {visibleColumns.some((c) => c.showGrandTotal) && (
                  <tfoot className="bg-[#111F33] border-t-2 border-[var(--gold)] sticky bottom-0 z-20">
                    <tr>
                      {visibleColumns.map((col, idx) => (
                        <td
                          key={col.id}
                          style={{ padding: `${design.cellPaddingPx}px`, textAlign: col.align }}
                          className="text-xs font-black text-[var(--gold)] tabular-nums"
                        >
                          {idx === 0
                            ? 'الإجمالي العام'
                            : col.showGrandTotal
                            ? calcColumnTotal(processedRows, col.field).toLocaleString('en-US', { maximumFractionDigits: 2 })
                            : ''}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
