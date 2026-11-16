/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Sales & Invoicing Module
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ShoppingCart,
  Plus,
  Search,
  Eye,
  Printer,
  Trash2,
  X,
  MessageCircle,
  Download,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Tag,
  FileDown,
  FileSpreadsheet,
  Save,
  CheckCircle2,
  Edit3,
  Ban,
} from 'lucide-react';
import {
  Invoice,
  InvoiceItem,
  Customer,
  Warehouse,
  InventoryItem,
  ItemWarehouseStock,
  TreasuryAccount,
  Branch,
  Company,
  Currency,
  CurrencyCode,
  WhatsAppTemplates,
  TableColumnPref,
} from '../../../types/erp';
import { canFulfillStock, getItemStockInWarehouse } from '../../../services/inventoryEngine';
import { PrintableDocumentData } from '../../common/PrintModal';
import {
  triggerAutoDownloadInvoice,
  downloadInvoicePDF,
  exportToExcel,
  exportToCSV,
} from '../../../services/exportService';
import { generateNextDocNumber } from '../../../services/storageService';
import { ErpDataTable, ErpTableColumn } from '../../common/ErpDataTable';
import { WhatsAppShareModal } from '../../common/WhatsAppShareModal';
import { ConfirmModal } from '../../common/ConfirmModal';
import { convertToBase, getCurrencySymbol, getEffectiveCurrencyRate } from '../../../services/currencyHelpers';

interface SalesModuleProps {
  invoices: Invoice[];
  customers: Customer[];
  warehouses: Warehouse[];
  inventoryItems: InventoryItem[];
  warehouseStock: ItemWarehouseStock[];
  treasuryAccounts: TreasuryAccount[];
  currencies?: Currency[];
  currentBranch: Branch;
  currencySymbol: string;
  allowNegativeStock: boolean;
  canPostEntries?: boolean;
  company?: Company;
  autoDownloadInvoices?: boolean;
  whatsappTemplates?: WhatsAppTemplates;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  focusedRecordId?: string;
  onPostSalesInvoice: (invoice: Invoice) => void;
  onSaveDraftInvoice?: (invoice: Invoice) => void;
  onCancelInvoice?: (invoiceId: string) => void;
  onOpenPrintModal: (doc: PrintableDocumentData) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, isBase: true, decimalPlaces: 2 },
  { code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 140, isBase: false, decimalPlaces: 2 },
  { code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 530, isBase: false, decimalPlaces: 2 },
];

export const SalesModule: React.FC<SalesModuleProps> = ({
  invoices,
  customers,
  warehouses,
  inventoryItems,
  warehouseStock,
  treasuryAccounts,
  currencies = DEFAULT_CURRENCIES,
  currentBranch,
  currencySymbol,
  allowNegativeStock,
  canPostEntries = true,
  company,
  autoDownloadInvoices = true,
  whatsappTemplates,
  savedColumnPrefs,
  onSaveColumnPrefs,
  focusedRecordId,
  onPostSalesInvoice,
  onSaveDraftInvoice,
  onCancelInvoice,
  onOpenPrintModal,
  onNotify,
}) => {
  const [filterPaymentType, setFilterPaymentType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isNewInvoiceModalOpen, setIsNewInvoiceModalOpen] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [cancelTargetInvoice, setCancelTargetInvoice] = useState<Invoice | null>(null);
  const [waInvoice, setWaInvoice] = useState<Invoice | null>(null);
  const [formError, setFormError] = useState('');

  // Form State
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || '');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(warehouses[0]?.id || '');
  const [paymentType, setPaymentType] = useState<'نقدي' | 'آجل' | 'جزئي'>('نقدي');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState(treasuryAccounts[0]?.id || '');
  const [invoiceCurrency, setInvoiceCurrency] = useState<CurrencyCode>('YER');
  const [exchangeRate, setExchangeRate] = useState(1);
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [partialPaidAmount, setPartialPaidAmount] = useState(0);

  // Quick picker state
  const [activeDepartment, setActiveDepartment] = useState<string>('all');
  const [itemSearch, setItemSearch] = useState('');
  const [itemsList, setItemsList] = useState<InvoiceItem[]>([]);
  const gridContainerRef = useRef<HTMLTableSectionElement | null>(null);

  const [tempItemId, setTempItemId] = useState(inventoryItems[0]?.id || '');
  const [tempQuantity, setTempQuantity] = useState(1);
  const [tempBonusQty, setTempBonusQty] = useState(0);
  const [tempPrice, setTempPrice] = useState(inventoryItems[0]?.salePrice || 0);
  const [tempDiscountPercent, setTempDiscountPercent] = useState(0);
  const [tempLineNotes, setTempLineNotes] = useState('');

  useEffect(() => {
    if (!focusedRecordId) return;
    const match = invoices.find(
      (i) => (i.id === focusedRecordId || i.invoiceNumber === focusedRecordId) && i.type === 'مبيعات'
    );
    if (match) setViewingInvoice(match);
  }, [focusedRecordId, invoices]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    inventoryItems.forEach((it) => {
      if (it.category && it.category.trim()) set.add(it.category.trim());
    });
    return Array.from(set);
  }, [inventoryItems]);

  const selectableItems = useMemo(() => {
    return inventoryItems.filter((it) => {
      const matchDept = activeDepartment === 'all' || it.category === activeDepartment;
      const q = itemSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        it.nameAr.toLowerCase().includes(q) ||
        it.code.toLowerCase().includes(q) ||
        it.barcode.toLowerCase().includes(q);
      return matchDept && matchSearch;
    });
  }, [inventoryItems, activeDepartment, itemSearch]);

  const recalcLine = (
    itemDef: InventoryItem | undefined,
    qty: number,
    bonusQty: number,
    price: number,
    discountPct: number,
    notes: string,
    existingId?: string
  ): InvoiceItem | null => {
    if (!itemDef) return null;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const subtotal = r2(qty * price);
    const discountAmount = r2(subtotal * (discountPct / 100));
    const taxableAmount = r2(subtotal - discountAmount);
    const taxAmount = r2(taxableAmount * (itemDef.taxRate || 0.05));
    const total = r2(taxableAmount + taxAmount);

    return {
      id: existingId || `item-line-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      itemId: itemDef.id,
      itemName: itemDef.nameAr,
      itemBarcode: itemDef.barcode,
      unit: itemDef.baseUnit,
      quantity: qty,
      bonusQuantity: bonusQty > 0 ? bonusQty : 0,
      unitPrice: price,
      discountPercentage: discountPct,
      discountAmount,
      subtotal,
      taxPercentage: (itemDef.taxRate || 0.05) * 100,
      taxAmount,
      total,
      unitCost: itemDef.purchasePrice,
      notes: notes || undefined,
    };
  };

  const handleItemSelectChange = (itemId: string) => {
    setTempItemId(itemId);
    const it = inventoryItems.find((i) => i.id === itemId);
    if (it) {
      const rate = exchangeRate > 0 ? exchangeRate : 1;
      setTempPrice(Math.round((it.salePrice / rate) * 100) / 100);
    }
  };

  const handleAddItemToInvoice = (overrideItemId?: string) => {
    setFormError('');
    const targetId = overrideItemId || tempItemId || selectableItems[0]?.id;
    const it = inventoryItems.find((i) => i.id === targetId);
    if (!it) return;

    const qty = Math.max(1, Number(tempQuantity) || 1);
    const bonus = Math.max(0, Number(tempBonusQty) || 0);
    const check = canFulfillStock(warehouseStock, it.id, selectedWarehouseId, qty + bonus, allowNegativeStock);
    if (!check.canFulfill) {
      setFormError(check.message || 'الرصيد المخزني غير كافٍ في المستودع المختار.');
      return;
    }

    const rate = exchangeRate > 0 ? exchangeRate : 1;
    const scaledSale = Math.round((it.salePrice / rate) * 100) / 100;
    const line = recalcLine(
      it,
      qty,
      bonus,
      overrideItemId ? scaledSale : Number(tempPrice) || scaledSale,
      Number(tempDiscountPercent) || 0,
      tempLineNotes.trim()
    );
    if (!line) return;

    setItemsList((prev) => [...prev, line]);
    setTempQuantity(1);
    setTempBonusQty(0);
    setTempDiscountPercent(0);
    setTempLineNotes('');
  };

  const handleInlineLineChange = (
    idx: number,
    patch: Partial<{
      itemId: string;
      quantity: number;
      bonusQuantity: number;
      unitPrice: number;
      discountPercentage: number;
      notes: string;
    }>
  ) => {
    setFormError('');
    setItemsList((prev) => {
      const next = [...prev];
      const current = next[idx];
      if (!current) return prev;

      const targetItemId = patch.itemId ?? current.itemId;
      const itemDef = inventoryItems.find((i) => i.id === targetItemId);
      if (!itemDef) return prev;

      const nextQty = Math.max(0, patch.quantity ?? current.quantity);
      const nextBonus = Math.max(0, patch.bonusQuantity ?? (current.bonusQuantity || 0));
      const nextPrice =
        patch.itemId && patch.itemId !== current.itemId
          ? itemDef.salePrice
          : Math.max(0, patch.unitPrice ?? current.unitPrice);
      const nextDisc = Math.min(100, Math.max(0, patch.discountPercentage ?? current.discountPercentage));
      const nextNotes = patch.notes ?? (current.notes || '');

      const check = canFulfillStock(
        warehouseStock,
        itemDef.id,
        selectedWarehouseId,
        nextQty + nextBonus,
        allowNegativeStock
      );
      if (!check.canFulfill) {
        setFormError(check.message || 'الرصيد المخزني غير كافٍ.');
        return prev;
      }

      const recalculated = recalcLine(itemDef, nextQty, nextBonus, nextPrice, nextDisc, nextNotes, current.id);
      if (recalculated) next[idx] = recalculated;
      return next;
    });
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLElement>, rowIdx: number, colIdx: number) => {
    if (!gridContainerRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const targetRow = e.key === 'ArrowDown' ? rowIdx + 1 : rowIdx - 1;
      const targetEl = gridContainerRef.current.querySelector<HTMLElement>(
        `[data-grid-row="${targetRow}"][data-grid-col="${colIdx}"]`
      );
      if (targetEl) {
        e.preventDefault();
        targetEl.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const nextColEl = gridContainerRef.current.querySelector<HTMLElement>(
        `[data-grid-row="${rowIdx}"][data-grid-col="${colIdx + 1}"]`
      );
      if (nextColEl) {
        nextColEl.focus();
      } else {
        const nextRowEl = gridContainerRef.current.querySelector<HTMLElement>(
          `[data-grid-row="${rowIdx + 1}"][data-grid-col="0"]`
        );
        if (nextRowEl) {
          nextRowEl.focus();
        } else {
          const fallback = selectableItems[0] || inventoryItems[0];
          if (fallback) handleAddItemToInvoice(fallback.id);
        }
      }
    }
  };

  const calculatedSubtotal = itemsList.reduce((sum, it) => sum + it.subtotal, 0);
  const calculatedDiscount = itemsList.reduce((sum, it) => sum + it.discountAmount, 0);
  const calculatedTax = itemsList.reduce((sum, it) => sum + it.taxAmount, 0);
  const calculatedGrandTotal = calculatedSubtotal - calculatedDiscount + calculatedTax;

  const currentCustomer = customers.find((c) => c.id === selectedCustomerId);
  const previewPaidAmount =
    paymentType === 'نقدي'
      ? calculatedGrandTotal
      : paymentType === 'آجل'
      ? 0
      : Math.min(calculatedGrandTotal, Number(partialPaidAmount) || 0);
  const previewRemainingAmount = calculatedGrandTotal - previewPaidAmount;
  const previousCustBalance = currentCustomer?.currentBalance ?? 0;
  const projectedCustBalance = previousCustBalance + previewRemainingAmount * exchangeRate;

  const resetModalForm = () => {
    setEditingDraftId(null);
    setItemsList([]);
    setInvoiceNotes('');
    setFormError('');
    setPartialPaidAmount(0);
    const custCurr = currentCustomer?.currency || 'YER';
    setInvoiceCurrency(custCurr);
    setExchangeRate(getEffectiveCurrencyRate(currencies, custCurr));
    setInvoiceDate(new Date().toISOString().split('T')[0]);
  };

  const openEditDraft = (draft: Invoice) => {
    setEditingDraftId(draft.id);
    setSelectedCustomerId(draft.entityId);
    setSelectedWarehouseId(draft.warehouseId);
    setPaymentType(draft.paymentType);
    setSelectedTreasuryId(draft.treasuryAccountId || treasuryAccounts[0]?.id || '');
    setInvoiceCurrency(draft.currency || 'YER');
    setExchangeRate(draft.exchangeRate || 1);
    setInvoiceDate(draft.date);
    setDueDate(draft.dueDate || '');
    setInvoiceNotes(draft.notes || '');
    setPartialPaidAmount(draft.paidAmount);
    setItemsList(draft.items);
    setFormError('');
    setIsNewInvoiceModalOpen(true);
  };

  const buildInvoicePayload = (asDraft: boolean): Invoice | null => {
    setFormError('');
    if (itemsList.length === 0) {
      setFormError('يرجى إضافة صنف واحد على الأقل إلى الفاتورة.');
      return null;
    }

    const existingDraft = editingDraftId ? invoices.find((i) => i.id === editingDraftId) : undefined;
    const year = new Date().getFullYear();
    const invoiceNumber =
      existingDraft?.invoiceNumber ||
      generateNextDocNumber(
        `INV-${year}-`,
        invoices.filter((i) => i.type === 'مبيعات').map((i) => i.invoiceNumber),
        4
      );

    const paid = previewPaidAmount;
    const remaining = previewRemainingAmount;

    return {
      id: existingDraft?.id || `inv-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      invoiceNumber,
      type: 'مبيعات',
      paymentType,
      date: invoiceDate,
      dueDate: paymentType !== 'نقدي' ? dueDate || invoiceDate : undefined,
      branchId: currentBranch.id,
      warehouseId: selectedWarehouseId,
      entityId: selectedCustomerId,
      entityName: currentCustomer?.nameAr || 'عميل نقدي',
      currency: invoiceCurrency,
      exchangeRate,
      items: itemsList,
      subtotal: calculatedSubtotal,
      discountTotal: calculatedDiscount,
      taxTotal: calculatedTax,
      grandTotal: calculatedGrandTotal,
      paidAmount: paid,
      remainingAmount: remaining,
      previousBalanceSnapshot: previousCustBalance,
      newBalanceSnapshot: projectedCustBalance,
      paymentMethod: paymentType !== 'آجل' ? 'صندوق' : undefined,
      treasuryAccountId: paymentType !== 'آجل' ? selectedTreasuryId : undefined,
      status: asDraft ? 'draft' : paid >= calculatedGrandTotal ? 'paid' : 'posted',
      salesRepName: currentCustomer?.salesRepName || 'عصام الشرعبي',
      notes: invoiceNotes,
      createdBy: 'مسؤول المبيعات',
      createdAt: existingDraft?.createdAt || new Date().toISOString(),
    };
  };

  const handleSubmitPost = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = buildInvoicePayload(false);
    if (!payload) return;

    onPostSalesInvoice(payload);
    onNotify?.('success', `تم اعتماد وترحيل فاتورة المبيعات رقم ${payload.invoiceNumber}.`);
    if (autoDownloadInvoices) {
      const whName = warehouses.find((w) => w.id === payload.warehouseId)?.nameAr;
      triggerAutoDownloadInvoice(payload, company, currentBranch, whName);
    }
    setIsNewInvoiceModalOpen(false);
    resetModalForm();
  };

  const handleSaveAsDraft = () => {
    if (!onSaveDraftInvoice) return;
    const payload = buildInvoicePayload(true);
    if (!payload) return;
    onSaveDraftInvoice(payload);
    onNotify?.('info', `تم حفظ الفاتورة كمسودة برقم ${payload.invoiceNumber}.`);
    setIsNewInvoiceModalOpen(false);
    resetModalForm();
  };

  const handlePrintInvoice = (inv: Invoice) => {
    const cust = customers.find((c) => c.id === inv.entityId);
    const docData: PrintableDocumentData = {
      title: 'فاتورة مبيعات ضريبية معتمدة',
      documentNumber: inv.invoiceNumber,
      date: inv.date,
      dueDate: inv.dueDate,
      entityName: inv.entityName,
      entityPhone: cust?.phone,
      entityAddress: cust?.addressDetails,
      statement: `طريقة السداد: ${inv.paymentType} · الفرع: ${currentBranch.nameAr}`,
      currencySymbol: inv.currency || currencySymbol,
      previousBalance: inv.previousBalanceSnapshot,
      newBalance: inv.newBalanceSnapshot ?? cust?.currentBalance,
      items: inv.items.map((it, idx) => ({
        index: idx + 1,
        description: it.itemName,
        unit: it.unit,
        quantity: it.quantity,
        bonusQuantity: it.bonusQuantity,
        unitPrice: it.unitPrice,
        discount: it.discountAmount,
        tax: it.taxAmount,
        total: it.total,
        notes: it.notes,
      })),
      totals: {
        subtotal: inv.subtotal,
        discountTotal: inv.discountTotal,
        taxTotal: inv.taxTotal,
        grandTotal: inv.grandTotal,
        paidAmount: inv.paidAmount,
        remainingAmount: inv.remainingAmount,
      },
      notes: inv.notes || 'البضاعة المباعة لا ترد ولا تستبدل بعد مرور 3 أيام من تاريخ الاستلام.',
      amountInWords: `المبلغ المستحق: ${inv.grandTotal.toLocaleString()} ${inv.currency || currencySymbol} فقط لا غير.`,
    };
    onOpenPrintModal(docData);
  };

  const salesInvoices = useMemo(
    () =>
      invoices.filter((inv) => {
        if (inv.type !== 'مبيعات') return false;
        const matchPay = filterPaymentType === 'all' || inv.paymentType === filterPaymentType;
        const matchStatus = filterStatus === 'all' || inv.status === filterStatus;
        return matchPay && matchStatus;
      }),
    [invoices, filterPaymentType, filterStatus]
  );

  const viewingIdx = viewingInvoice ? salesInvoices.findIndex((i) => i.id === viewingInvoice.id) : -1;

  const columns: ErpTableColumn<Invoice>[] = useMemo(
    () => [
      {
        key: 'invoiceNumber',
        label: 'رقم الفاتورة',
        sortValue: (i) => i.invoiceNumber,
        render: (i) => <span className="font-mono font-bold text-amber-400">{i.invoiceNumber}</span>,
      },
      {
        key: 'entityName',
        label: 'العميل',
        sortValue: (i) => i.entityName,
        render: (i) => <span className="font-semibold text-slate-100">{i.entityName}</span>,
      },
      {
        key: 'date',
        label: 'التاريخ',
        sortValue: (i) => i.date,
        render: (i) => <span className="font-mono text-slate-400">{i.date}</span>,
      },
      {
        key: 'paymentType',
        label: 'الدفع',
        align: 'center',
        sortValue: (i) => i.paymentType,
        render: (i) => (
          <span
            className={`text-[11px] px-2 py-0.5 rounded font-semibold ${
              i.paymentType === 'نقدي'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                : i.paymentType === 'آجل'
                ? 'bg-amber-950 text-amber-400 border border-amber-800/40'
                : 'bg-sky-950 text-sky-400 border border-sky-800/40'
            }`}
          >
            {i.paymentType}
          </span>
        ),
      },
      {
        key: 'status',
        label: 'الحالة',
        align: 'center',
        sortValue: (i) => i.status,
        render: (i) => {
          const badge =
            i.status === 'draft'
              ? 'bg-slate-800 text-amber-300'
              : i.status === 'cancelled'
              ? 'bg-rose-950/70 text-rose-400 line-through'
              : 'bg-emerald-950/70 text-emerald-400';
          const label =
            i.status === 'draft'
              ? 'مسودة'
              : i.status === 'cancelled'
              ? 'ملغاة'
              : i.status === 'paid'
              ? 'مدفوعة'
              : 'مرحلة';
          return <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${badge}`}>{label}</span>;
        },
      },
      {
        key: 'grandTotal',
        label: 'الإجمالي',
        align: 'left',
        sortValue: (i) => convertToBase(i.grandTotal, i.currency, currencies, i.exchangeRate),
        render: (i) => {
          const curr = i.currency || 'YER';
          const sym = getCurrencySymbol(currencies, curr);
          const baseEq = convertToBase(i.grandTotal, curr, currencies, i.exchangeRate);
          return curr !== 'YER' ? (
            <div className="leading-tight font-mono tabular-nums">
              <div className="font-black text-emerald-300">
                {i.grandTotal.toLocaleString()} {sym}
              </div>
              <div className="text-[10px] text-slate-400">{baseEq.toLocaleString()} ر.ي</div>
            </div>
          ) : (
            <span className="font-mono font-bold text-white tabular-nums">
              {i.grandTotal.toLocaleString()} {sym}
            </span>
          );
        },
        footerRender: (rows) =>
          `${rows
            .filter((r) => r.status !== 'cancelled')
            .reduce((s, r) => s + convertToBase(r.grandTotal, r.currency, currencies, r.exchangeRate), 0)
            .toLocaleString()} ${currencySymbol}`,
      },
      {
        key: 'remainingAmount',
        label: 'المتبقي',
        align: 'left',
        sortValue: (i) => convertToBase(i.remainingAmount, i.currency, currencies, i.exchangeRate),
        render: (i) => {
          const curr = i.currency || 'YER';
          const sym = getCurrencySymbol(currencies, curr);
          return (
            <span
              className={`font-mono font-bold tabular-nums ${
                i.remainingAmount > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {i.remainingAmount.toLocaleString()} {sym}
            </span>
          );
        },
        footerRender: (rows) =>
          `${rows
            .filter((r) => r.status !== 'cancelled')
            .reduce((s, r) => s + convertToBase(r.remainingAmount, r.currency, currencies, r.exchangeRate), 0)
            .toLocaleString()} ${currencySymbol}`,
      },
      {
        key: 'actions',
        label: 'الإجراءات',
        align: 'center',
        sortable: false,
        render: (inv) => (
          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setViewingInvoice(inv)}
              title="عرض تفاصيل الفاتورة"
              className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Eye className="w-4 h-4" />
            </button>
            {inv.status === 'draft' && (
              <>
                <button
                  type="button"
                  onClick={() => openEditDraft(inv)}
                  title="تعديل المسودة"
                  className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onPostSalesInvoice({
                      ...inv,
                      status: inv.paidAmount >= inv.grandTotal ? 'paid' : 'posted',
                    });
                    onNotify?.('success', `تم ترحيل الفاتورة ${inv.invoiceNumber}.`);
                  }}
                  title="ترحيل المسودة"
                  className="p-1.5 text-emerald-400 hover:bg-emerald-950/60 rounded-lg cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                const whName = warehouses.find((w) => w.id === inv.warehouseId)?.nameAr;
                void downloadInvoicePDF(inv, company, currentBranch, whName);
              }}
              title="تنزيل PDF حقيقي"
              className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <FileDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handlePrintInvoice(inv)}
              title="طباعة الفاتورة"
              className="p-1.5 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWaInvoice(inv)}
              title="مشاركة عبر واتساب"
              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
            </button>
            {canPostEntries && (inv.status === 'posted' || inv.status === 'paid' || inv.status === 'partial') && onCancelInvoice && (
              <button
                type="button"
                onClick={() => setCancelTargetInvoice(inv)}
                title="إلغاء وعكس الفاتورة"
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                <Ban className="w-4 h-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [currencySymbol, warehouses, company, currentBranch, canPostEntries, onCancelInvoice]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShoppingCart className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-bold text-white">المبيعات وفواتير العملاء والتحصيل</h2>
          </div>
          <p className="text-xs text-slate-400">
            إصدار فواتير نقدية وآجلة ومسودات، دعم البونص والعملات، تصفية الأقسام السريعة، وتتبع الرصيد التراكمي
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            resetModalForm();
            setIsNewInvoiceModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-sm transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إصدار فاتورة مبيعات جديدة</span>
        </button>
      </div>

      {/* Data Table */}
      <ErpDataTable<Invoice>
        tableId="sales-invoices"
        title="فواتير المبيعات"
        data={salesInvoices}
        columns={columns}
        getRowId={(r) => r.id}
        savedColumnPrefs={savedColumnPrefs}
        onSaveColumnPrefs={onSaveColumnPrefs}
        searchPlaceholder="بحث برقم الفاتورة، العميل، التاريخ..."
        selectable
        defaultSortKey="date"
        defaultSortDir="desc"
        onRowClick={(inv) => setViewingInvoice(inv)}
        filtersSlot={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterPaymentType}
              onChange={(e) => setFilterPaymentType(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="all">جميع طرق السداد</option>
              <option value="نقدي">نقدي</option>
              <option value="آجل">آجل</option>
              <option value="جزئي">جزئي</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
            >
              <option value="all">جميع الحالات</option>
              <option value="posted">مرحلة</option>
              <option value="paid">مدفوعة</option>
              <option value="draft">مسودات</option>
              <option value="cancelled">ملغاة</option>
            </select>
          </div>
        }
        actionsSlot={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                exportToExcel({
                  fileName: `فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}`,
                  sheets: [
                    {
                      name: 'فواتير المبيعات',
                      data: [
                        ['رقم الفاتورة', 'العميل', 'التاريخ', 'الدفع', 'المجموع', 'الخصم', 'الضريبة', 'الإجمالي', 'المدفوع', 'المتبقي', 'الحالة'],
                        ...salesInvoices.map((i) => [
                          i.invoiceNumber,
                          i.entityName,
                          i.date,
                          i.paymentType,
                          i.subtotal,
                          i.discountTotal,
                          i.taxTotal,
                          i.grandTotal,
                          i.paidAmount,
                          i.remainingAmount,
                          i.status,
                        ]),
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
                  `فواتير_المبيعات_${new Date().toISOString().slice(0, 10)}`,
                  ['رقم الفاتورة', 'العميل', 'التاريخ', 'الدفع', 'الإجمالي', 'المتبقي', 'الحالة'],
                  salesInvoices.map((i) => [
                    i.invoiceNumber,
                    i.entityName,
                    i.date,
                    i.paymentType,
                    i.grandTotal,
                    i.remainingAmount,
                    i.status,
                  ])
                )
              }
              className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer"
            >
              CSV
            </button>
          </div>
        }
        bulkActionsSlot={(selected) => (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                selected.forEach((inv) => {
                  const whName = warehouses.find((w) => w.id === inv.warehouseId)?.nameAr;
                  triggerAutoDownloadInvoice(inv, company, currentBranch, whName);
                });
              }}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل PDF ({selected.length})</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportToExcel({
                  fileName: `فواتير_محددة_${new Date().toISOString().slice(0, 10)}`,
                  sheets: [
                    {
                      name: 'الفواتير',
                      data: [
                        ['رقم الفاتورة', 'العميل', 'التاريخ', 'الدفع', 'المجموع', 'الضريبة', 'الإجمالي', 'المدفوع', 'المتبقي'],
                        ...selected.map((i) => [
                          i.invoiceNumber,
                          i.entityName,
                          i.date,
                          i.paymentType,
                          i.subtotal,
                          i.taxTotal,
                          i.grandTotal,
                          i.paidAmount,
                          i.remainingAmount,
                        ]),
                      ],
                    },
                  ],
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel ({selected.length})</span>
            </button>
          </div>
        )}
      />

      {/* NEW / EDIT DRAFT SALES INVOICE MODAL */}
      {isNewInvoiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-6xl max-h-[94vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-bold text-base text-white">
                    {editingDraftId ? 'تعديل مسودة فاتورة مبيعات' : 'إصدار فاتورة مبيعات جديدة'}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    إدخال سريع بالجدول (Enter للانتقال، الأسهم ↑↓ للتنقل بين السطور، دعم البونص والعملات وحفظ كمسودة)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewInvoiceModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitPost} className="p-5 space-y-5 text-xs">
              {formError && (
                <div className="p-3 bg-rose-950/60 border border-rose-700/50 text-rose-300 rounded-xl flex items-center gap-2 font-semibold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العميل *</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedCustomerId(nextId);
                      const picked = customers.find((c) => c.id === nextId);
                      if (picked && !editingDraftId) {
                        const cCurr = picked.currency || 'YER';
                        setInvoiceCurrency(cCurr);
                        setExchangeRate(getEffectiveCurrencyRate(currencies, cCurr));
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {customers.map((c) => {
                      const cCurr = c.currency || 'YER';
                      const cRate = getEffectiveCurrencyRate(currencies, cCurr);
                      const cSym = getCurrencySymbol(currencies, cCurr);
                      const cNative = cCurr !== 'YER' ? Math.round((c.currentBalance / cRate) * 100) / 100 : c.currentBalance;
                      return (
                        <option key={c.id} value={c.id}>
                          {c.nameAr} ({c.code}) - الرصيد: {cNative.toLocaleString()} {cSym}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">مستودع الصرف *</label>
                  <select
                    value={selectedWarehouseId}
                    onChange={(e) => setSelectedWarehouseId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nameAr} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">طريقة السداد *</label>
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value as 'نقدي' | 'آجل' | 'جزئي')}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    <option value="نقدي">نقدي (سداد كامل)</option>
                    <option value="آجل">آجل (على الحساب)</option>
                    <option value="جزئي">جزئي (دفعة + آجل)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">تاريخ الفاتورة</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">العملة وسعر الصرف</label>
                  <div className="flex gap-2">
                    <select
                      value={invoiceCurrency}
                      onChange={(e) => {
                        const c = e.target.value as CurrencyCode;
                        setInvoiceCurrency(c);
                        setExchangeRate(currencies.find((x) => x.code === c)?.exchangeRate ?? 1);
                      }}
                      className="w-1/2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 text-amber-300 font-mono font-bold"
                    >
                      {currencies.map((c) => (
                        <option key={c.code} value={c.code}>{c.code}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0.001}
                      step="any"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(Number(e.target.value))}
                      className="w-1/2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-2 font-mono text-white"
                    />
                  </div>
                </div>

                {paymentType !== 'آجل' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">الخزينة المقبوض فيها</label>
                    <select
                      value={selectedTreasuryId}
                      onChange={(e) => setSelectedTreasuryId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                    >
                      {treasuryAccounts.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nameAr} ({t.balance.toLocaleString()} {t.currency})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {paymentType === 'جزئي' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">الدفعة النقدية المقدمة</label>
                    <input
                      type="number"
                      min={0}
                      value={partialPaidAmount}
                      onChange={(e) => setPartialPaidAmount(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                {paymentType !== 'نقدي' && (
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">تاريخ الاستحقاق</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}
              </div>

              {/* Department Filter Chips & Quick Item Adder */}
              <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Tag className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-slate-400 font-semibold ml-1">تصفية سريعة بالأقسام:</span>
                    <button
                      type="button"
                      onClick={() => setActiveDepartment('all')}
                      className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                        activeDepartment === 'all'
                          ? 'bg-amber-500 text-slate-950'
                          : 'bg-slate-900 text-slate-300 border border-slate-800'
                      }`}
                    >
                      الكل ({inventoryItems.length})
                    </button>
                    {departments.map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setActiveDepartment(dept)}
                        className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer ${
                          activeDepartment === dept
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-900 text-slate-300 border border-slate-800'
                        }`}
                      >
                        {dept}
                      </button>
                    ))}
                  </div>

                  <div className="relative w-full sm:w-56">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="بحث عن صنف أو باركود..."
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-8 pl-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-7 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-slate-400 text-[11px] mb-1">الصنف المطلوب</label>
                    <select
                      value={tempItemId}
                      onChange={(e) => handleItemSelectChange(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      {selectableItems.map((it) => {
                        const avail = getItemStockInWarehouse(warehouseStock, it.id, selectedWarehouseId);
                        return (
                          <option key={it.id} value={it.id}>
                            {it.nameAr} ({it.baseUnit}) · متاح: {avail}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">الكمية</label>
                    <input
                      type="number"
                      min={1}
                      value={tempQuantity}
                      onChange={(e) => setTempQuantity(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-emerald-400 text-[11px] mb-1">بونص</label>
                    <input
                      type="number"
                      min={0}
                      value={tempBonusQty}
                      onChange={(e) => setTempBonusQty(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-emerald-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">السعر</label>
                    <input
                      type="number"
                      value={tempPrice}
                      onChange={(e) => setTempPrice(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">خصم %</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={tempDiscountPercent}
                      onChange={(e) => setTempDiscountPercent(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => handleAddItemToInvoice()}
                      className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                    >
                      + إضافة للجدول
                    </button>
                  </div>
                </div>
              </div>

              {/* Editable Multi-Row Grid */}
              <div className="border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-2.5 w-8 text-center">#</th>
                      <th className="py-2.5 px-2.5 min-w-[200px]">الصنف</th>
                      <th className="py-2.5 px-2 text-center w-20">الكمية</th>
                      <th className="py-2.5 px-2 text-center w-20 text-emerald-400">بونص</th>
                      <th className="py-2.5 px-2 text-left w-28">السعر</th>
                      <th className="py-2.5 px-2 text-center w-20">خصم %</th>
                      <th className="py-2.5 px-2 min-w-[120px]">ملاحظة</th>
                      <th className="py-2.5 px-2.5 text-left w-28">الإجمالي</th>
                      <th className="py-2.5 px-2 text-center w-12">حذف</th>
                    </tr>
                  </thead>
                  <tbody ref={gridContainerRef} className="divide-y divide-slate-800/60 font-mono">
                    {itemsList.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-500 font-sans">
                          لم يتم إضافة أصناف حتى الآن.
                        </td>
                      </tr>
                    ) : (
                      itemsList.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="py-2 px-2.5 text-center text-slate-500">{idx + 1}</td>
                          <td className="py-2 px-2.5 font-sans">
                            <select
                              value={item.itemId}
                              data-grid-row={idx}
                              data-grid-col={0}
                              onChange={(e) => handleInlineLineChange(idx, { itemId: e.target.value })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 0)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-100 font-semibold"
                            >
                              {inventoryItems.map((it) => (
                                <option key={it.id} value={it.id}>{it.nameAr} ({it.baseUnit})</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              data-grid-row={idx}
                              data-grid-col={1}
                              onChange={(e) => handleInlineLineChange(idx, { quantity: Number(e.target.value) })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 1)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-center font-bold text-white"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              value={item.bonusQuantity || 0}
                              data-grid-row={idx}
                              data-grid-col={2}
                              onChange={(e) => handleInlineLineChange(idx, { bonusQuantity: Number(e.target.value) })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 2)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-center font-bold text-emerald-300"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              value={item.unitPrice}
                              data-grid-row={idx}
                              data-grid-col={3}
                              onChange={(e) => handleInlineLineChange(idx, { unitPrice: Number(e.target.value) })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 3)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-left text-slate-200"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={item.discountPercentage}
                              data-grid-row={idx}
                              data-grid-col={4}
                              onChange={(e) => handleInlineLineChange(idx, { discountPercentage: Number(e.target.value) })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 4)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-1.5 py-1 text-center text-rose-300"
                            />
                          </td>
                          <td className="py-2 px-2 font-sans">
                            <input
                              type="text"
                              value={item.notes || ''}
                              data-grid-row={idx}
                              data-grid-col={5}
                              onChange={(e) => handleInlineLineChange(idx, { notes: e.target.value })}
                              onKeyDown={(e) => handleGridKeyDown(e, idx, 5)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-md px-2 py-1 text-slate-200"
                            />
                          </td>
                          <td className="py-2 px-2.5 text-left font-bold text-amber-300 tabular-nums">
                            {item.total.toLocaleString()}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => setItemsList((prev) => prev.filter((x) => x.id !== item.id))}
                              className="text-slate-500 hover:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals & Balance */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
                <div className="w-full sm:w-1/2 space-y-3">
                  <textarea
                    rows={2}
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    placeholder="ملاحظات وشروط الفاتورة..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-none focus:border-amber-500"
                  />
                  {currentCustomer && (
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 grid grid-cols-3 gap-2 text-center font-mono tabular-nums">
                      <div>
                        <span className="font-sans text-[11px] text-slate-400 block">الرصيد السابق</span>
                        <strong className="text-slate-200">{previousCustBalance.toLocaleString()}</strong>
                      </div>
                      <div>
                        <span className="font-sans text-[11px] text-slate-400 block">المتبقي بالأساسية</span>
                        <strong className="text-amber-400">+{(previewRemainingAmount * exchangeRate).toLocaleString()}</strong>
                      </div>
                      <div>
                        <span className="font-sans text-[11px] text-slate-400 block">الرصيد الجديد</span>
                        <strong className="text-emerald-400">{projectedCustBalance.toLocaleString()}</strong>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-full sm:w-80 bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 font-mono tabular-nums">
                  <div className="flex justify-between text-slate-400">
                    <span className="font-sans">المجموع الفرعي:</span>
                    <span>{calculatedSubtotal.toLocaleString()} {invoiceCurrency}</span>
                  </div>
                  {calculatedDiscount > 0 && (
                    <div className="flex justify-between text-rose-400">
                      <span className="font-sans">الخصم:</span>
                      <span>-{calculatedDiscount.toLocaleString()} {invoiceCurrency}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-400">
                    <span className="font-sans">الضريبة:</span>
                    <span>+{calculatedTax.toLocaleString()} {invoiceCurrency}</span>
                  </div>
                  <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-bold text-white">
                    <span className="font-sans">الإجمالي المستحق:</span>
                    <span className="text-amber-400">{calculatedGrandTotal.toLocaleString()} {invoiceCurrency}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex flex-wrap justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNewInvoiceModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg cursor-pointer"
                >
                  إلغاء
                </button>
                {onSaveDraftInvoice && (
                  <button
                    type="button"
                    onClick={handleSaveAsDraft}
                    className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold rounded-lg cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>حفظ كمسودة</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="px-6 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg cursor-pointer"
                >
                  اعتماد وترحيل الفاتورة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW INVOICE DETAILS MODAL WITH PREV / NEXT */}
      {viewingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col text-slate-100">
            <div className="p-5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-white">
                  تفاصيل فاتورة المبيعات: {viewingInvoice.invoiceNumber}
                </h3>
                <p className="text-xs text-slate-400">
                  العميل: {viewingInvoice.entityName} · التاريخ: {viewingInvoice.date}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={viewingIdx <= 0}
                  onClick={() => viewingIdx > 0 && setViewingInvoice(salesInvoices[viewingIdx - 1])}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>السابق</span>
                </button>
                <button
                  type="button"
                  disabled={viewingIdx < 0 || viewingIdx >= salesInvoices.length - 1}
                  onClick={() =>
                    viewingIdx >= 0 &&
                    viewingIdx < salesInvoices.length - 1 &&
                    setViewingInvoice(salesInvoices[viewingIdx + 1])
                  }
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold rounded-lg cursor-pointer"
                >
                  <span>التالي</span>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const whName = warehouses.find((w) => w.id === viewingInvoice.warehouseId)?.nameAr;
                    void downloadInvoicePDF(viewingInvoice, company, currentBranch, whName);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <FileDown className="w-4 h-4" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintInvoice(viewingInvoice)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 font-bold text-xs rounded-lg cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWaInvoice(viewingInvoice)}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>واتساب</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewingInvoice(null)}
                  className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-950 text-slate-400 font-bold">
                    <tr>
                      <th className="py-2.5 px-3">الصنف</th>
                      <th className="py-2.5 px-3 text-center">الكمية</th>
                      <th className="py-2.5 px-3 text-center">بونص</th>
                      <th className="py-2.5 px-3 text-left">السعر</th>
                      <th className="py-2.5 px-3 text-left">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {viewingInvoice.items.map((it) => {
                      const vSym = getCurrencySymbol(currencies, viewingInvoice.currency);
                      return (
                        <tr key={it.id}>
                          <td className="py-2.5 px-3 font-sans text-slate-200">{it.itemName}</td>
                          <td className="py-2.5 px-3 text-center font-bold text-white">{it.quantity}</td>
                          <td className="py-2.5 px-3 text-center text-emerald-400">
                            {it.bonusQuantity ? `+${it.bonusQuantity}` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-left text-slate-300">{it.unitPrice.toLocaleString()} {vSym}</td>
                          <td className="py-2.5 px-3 text-left font-bold text-amber-300">{it.total.toLocaleString()} {vSym}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                <div>
                  <span className="text-slate-400 block font-sans">القيد المحاسبي:</span>
                  <span className="text-amber-400 font-bold">{viewingInvoice.journalEntryId || 'مرحل آلياً'}</span>
                </div>
                {viewingInvoice.previousBalanceSnapshot !== undefined && (() => {
                  const vCurr = viewingInvoice.currency || 'YER';
                  const vRate = getEffectiveCurrencyRate(currencies, vCurr, viewingInvoice.exchangeRate);
                  const vSym = getCurrencySymbol(currencies, vCurr);
                  const prevNat = vCurr !== 'YER' ? Math.round((viewingInvoice.previousBalanceSnapshot / vRate) * 100) / 100 : viewingInvoice.previousBalanceSnapshot;
                  const newBase = viewingInvoice.newBalanceSnapshot ?? viewingInvoice.previousBalanceSnapshot;
                  const newNat = vCurr !== 'YER' ? Math.round((newBase / vRate) * 100) / 100 : newBase;
                  return (
                    <div>
                      <span className="text-slate-400 block font-sans">الرصيد السابق ← الجديد:</span>
                      <span className="text-slate-200 font-bold">
                        {prevNat.toLocaleString()} ←{' '}
                        <span className="text-emerald-400">
                          {newNat.toLocaleString()}
                        </span>{' '}
                        {vSym}
                      </span>
                      {vCurr !== 'YER' && (
                        <span className="text-[10px] text-slate-400 block">
                          ({viewingInvoice.previousBalanceSnapshot.toLocaleString()} ← {newBase.toLocaleString()} ر.ي)
                        </span>
                      )}
                    </div>
                  );
                })()}
                <div className="text-left">
                  <span className="text-slate-400 block font-sans">الإجمالي:</span>
                  <span className="text-base font-black text-white">
                    {viewingInvoice.grandTotal.toLocaleString()} {getCurrencySymbol(currencies, viewingInvoice.currency)}
                  </span>
                  {viewingInvoice.currency && viewingInvoice.currency !== 'YER' && (
                    <span className="text-[10px] text-slate-400 block">
                      ({convertToBase(viewingInvoice.grandTotal, viewingInvoice.currency, currencies, viewingInvoice.exchangeRate).toLocaleString()} ر.ي)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice ConfirmModal */}
      <ConfirmModal
        isOpen={Boolean(cancelTargetInvoice)}
        title="تأكيد إلغاء وعكس فاتورة المبيعات"
        message={
          cancelTargetInvoice
            ? `هل أنت متأكد من إلغاء الفاتورة رقم ${cancelTargetInvoice.invoiceNumber} للعميل ${cancelTargetInvoice.entityName}؟ سيتم إرجاع المخزون للمستودع وعكس القيد المالي ورصيد العميل والخزينة.`
            : ''
        }
        confirmLabel="نعم، إلغاء وعكس الفاتورة"
        variant="danger"
        onCancel={() => setCancelTargetInvoice(null)}
        onConfirm={() => {
          if (cancelTargetInvoice && onCancelInvoice) {
            onCancelInvoice(cancelTargetInvoice.id);
            onNotify?.('info', `تم إلغاء وعكس فاتورة المبيعات رقم ${cancelTargetInvoice.invoiceNumber}.`);
          }
          setCancelTargetInvoice(null);
        }}
      />

      {/* WhatsApp Share Modal */}
      {waInvoice && (
        <WhatsAppShareModal
          isOpen={Boolean(waInvoice)}
          onClose={() => setWaInvoice(null)}
          title={`مشاركة فاتورة مبيعات رقم ${waInvoice.invoiceNumber}`}
          recipientName={waInvoice.entityName}
          defaultPhone={
            customers.find((c) => c.id === waInvoice.entityId)?.whatsapp ||
            customers.find((c) => c.id === waInvoice.entityId)?.phone ||
            ''
          }
          defaultTemplateKey="invoice"
          templates={whatsappTemplates}
          templateVars={{
            companyName: company?.nameAr || 'المنصور للأنظمة الذكية',
            invoiceNumber: waInvoice.invoiceNumber,
            customerName: waInvoice.entityName,
            date: waInvoice.date,
            grandTotal: waInvoice.grandTotal.toLocaleString(),
            paidAmount: waInvoice.paidAmount.toLocaleString(),
            remainingAmount: waInvoice.remainingAmount.toLocaleString(),
            currency: waInvoice.currency || currencySymbol,
          }}
        />
      )}
    </div>
  );
};
