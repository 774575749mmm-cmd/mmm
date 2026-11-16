/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Professional Printable Document Modal
 * Uses the Unified Document Engine (generatePrintableHTML with forPreview: true)
 * so Preview, Browser Print, PDF, and PNG share 100% identical structure, fonts, colors, and header logic.
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, FileDown, ImageDown, Bluetooth, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Company, Branch, PrintDocumentType, PrintTemplateConfig } from '../../types/erp';
import {
  downloadReportAsPDF,
  generatePrintableHTML,
  inferPrintDocType,
  printReportPreview,
  ReportPDFOptions,
  resolveEffectivePrintTemplate,
  SummaryCardDef,
} from '../../services/exportService';
import { downloadPngPages, renderPayloadToPngPages } from '../../services/documentImageHelper';
import { MdiFloatingFrame } from './MdiWindowManager';
import type { UniversalPreviewPayload } from './UniversalPreviewModal';

export interface PrintableDocumentData {
  title: string;
  documentNumber: string;
  date: string;
  dueDate?: string;
  entityName: string;
  entityPhone?: string;
  entityAddress?: string;
  entityTaxNumber?: string;
  statement?: string;
  currencySymbol: string;
  previousBalance?: number;
  newBalance?: number;
  items?: {
    index: number;
    description: string;
    unit: string;
    quantity: number;
    bonusQuantity?: number;
    unitPrice: number;
    discount?: number;
    tax?: number;
    total: number;
    notes?: string;
  }[];
  totals: {
    subtotal: number;
    discountTotal: number;
    taxTotal: number;
    grandTotal: number;
    paidAmount?: number;
    remainingAmount?: number;
  };
  notes?: string;
  amountInWords?: string;
  subtitle?: string;
  customTables?: ReportPDFOptions['tables'];
  customSummaryCards?: SummaryCardDef[];
}

interface PrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: PrintableDocumentData;
  company: Company;
  branch: Branch;
  lang?: 'ar' | 'en';
  docType?: PrintDocumentType;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
}

export const PrintModal: React.FC<PrintModalProps> = ({
  isOpen,
  onClose,
  document: doc,
  company,
  branch,
  lang = 'ar',
  docType,
  printTemplates,
}) => {
  const reactId = useId();
  const [btStatus, setBtStatus] = useState<{ type: 'idle' | 'ok' | 'err'; msg: string }>({
    type: 'idle',
    msg: '',
  });
  const [isPrintingBt, setIsPrintingBt] = useState(false);
  const [isBusyPdf, setIsBusyPdf] = useState(false);
  const [isBusyPng, setIsBusyPng] = useState(false);
  const [fontReadyTick, setFontReadyTick] = useState(0);

  useEffect(() => {
    let active = true;
    if (isOpen && typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (active) setFontReadyTick((n) => n + 1);
      });
    }
    return () => {
      active = false;
    };
  }, [isOpen]);

  const effectiveDocType: PrintDocumentType = useMemo(
    () =>
      inferPrintDocType(
        doc.title,
        docType || (doc.items && doc.items.length > 0 ? 'invoice' : undefined)
      ),
    [doc.title, doc.items, docType]
  );

  const activeTpl = useMemo(
    () =>
      resolveEffectivePrintTemplate({
        docType: effectiveDocType,
        title: doc.title,
        printTemplates,
      }),
    [effectiveDocType, doc.title, printTemplates]
  );

  const hasBonusCol = Boolean(doc.items?.some((i) => (i.bonusQuantity || 0) > 0));
  const hasDiscountCol = Boolean(doc.items?.some((i) => (i.discount || 0) > 0));

  const reportOptions: ReportPDFOptions = useMemo(() => {
    const metadata: Record<string, string> = {
      'رقم المستند': doc.documentNumber,
      'التاريخ': doc.date,
      'الطرف المعني': doc.entityName,
    };
    if (doc.dueDate) metadata['تاريخ الاستحقاق'] = doc.dueDate;
    if (doc.entityPhone) metadata['الهاتف'] = doc.entityPhone;
    if (doc.entityAddress) metadata['العنوان'] = doc.entityAddress;
    if (doc.entityTaxNumber) metadata['الرقم الضريبي'] = doc.entityTaxNumber;
    if (doc.statement) metadata['البيان'] = doc.statement;
    if (doc.previousBalance !== undefined) {
      metadata['الرصيد السابق'] = `${doc.previousBalance.toLocaleString()} ${doc.currencySymbol}`;
    }
    if (doc.newBalance !== undefined) {
      metadata['الرصيد الحالي'] = `${doc.newBalance.toLocaleString()} ${doc.currencySymbol}`;
    }

    const tables: ReportPDFOptions['tables'] = doc.customTables ? [...doc.customTables] : [];
    if (!doc.customTables) {
      if (doc.items && doc.items.length > 0) {
        const headers = ['#', 'الصنف / الوصف', 'الوحدة', 'الكمية'];
        if (hasBonusCol) headers.push('بونص');
        headers.push('السعر');
        if (hasDiscountCol) headers.push('الخصم');
        headers.push(`الإجمالي (${doc.currencySymbol})`);

        const rows = doc.items.map((item) => {
          const row: (string | number)[] = [
            item.index,
            item.notes ? `${item.description} (${item.notes})` : item.description,
            item.unit,
            item.quantity,
          ];
          if (hasBonusCol) row.push(item.bonusQuantity ? `+${item.bonusQuantity}` : '-');
          row.push(item.unitPrice.toLocaleString());
          if (hasDiscountCol) row.push(item.discount ? item.discount.toLocaleString() : '-');
          row.push(item.total.toLocaleString());
          return row;
        });

        const totalsRow: (string | number)[] = new Array(headers.length).fill('');
        totalsRow[1] = 'الإجمالي المستحق';
        totalsRow[headers.length - 1] = `${doc.totals.grandTotal.toLocaleString()} ${doc.currencySymbol}`;

        tables.push({
          title: 'تفاصيل البنود',
          headers,
          rows,
          totals: totalsRow,
        });
      } else {
        tables.push({
          title: 'ملخص القيمة المالية',
          headers: ['البند', `القيمة (${doc.currencySymbol})`],
          rows: [
            ['المجموع الفرعي', doc.totals.subtotal.toLocaleString()],
            ...(doc.totals.discountTotal > 0 ? [['إجمالي الخصم', doc.totals.discountTotal.toLocaleString()]] : []),
            ...(doc.totals.taxTotal > 0 ? [['ضريبة القيمة المضافة', doc.totals.taxTotal.toLocaleString()]] : []),
            ...(doc.totals.paidAmount !== undefined ? [['المبلغ المسدد', doc.totals.paidAmount.toLocaleString()]] : []),
            ...(doc.totals.remainingAmount !== undefined ? [['المتبقي', doc.totals.remainingAmount.toLocaleString()]] : []),
          ],
          totals: ['المبلغ الإجمالي المستحق', `${doc.totals.grandTotal.toLocaleString()} ${doc.currencySymbol}`],
        });
      }
    }

    const summaryCards: SummaryCardDef[] = [
      {
        label: 'المجموع الفرعي',
        value: `${doc.totals.subtotal.toLocaleString()} ${doc.currencySymbol}`,
      },
    ];
    if (doc.totals.discountTotal > 0) {
      summaryCards.push({
        label: 'إجمالي الخصم',
        value: `${doc.totals.discountTotal.toLocaleString()} ${doc.currencySymbol}`,
        tone: 'red',
      });
    }
    if (doc.totals.taxTotal > 0) {
      summaryCards.push({
        label: 'الضريبة (VAT)',
        value: `${doc.totals.taxTotal.toLocaleString()} ${doc.currencySymbol}`,
      });
    }
    summaryCards.push({
      label: 'الصافي النهائي المستحق',
      value: `${doc.totals.grandTotal.toLocaleString()} ${doc.currencySymbol}`,
      tone: 'gold',
    });
    if (doc.totals.paidAmount !== undefined) {
      summaryCards.push({
        label: 'المبلغ المسدد',
        value: `${doc.totals.paidAmount.toLocaleString()} ${doc.currencySymbol}`,
        tone: 'green',
      });
    }
    if (doc.totals.remainingAmount !== undefined) {
      summaryCards.push({
        label: 'المبلغ المتبقي',
        value: `${doc.totals.remainingAmount.toLocaleString()} ${doc.currencySymbol}`,
        tone: 'red',
      });
    }
    if (doc.previousBalance !== undefined) {
      summaryCards.push({
        label: 'الرصيد السابق للحساب',
        value: `${doc.previousBalance.toLocaleString()} ${doc.currencySymbol}`,
        tone: 'blue',
      });
    }
    if (doc.newBalance !== undefined) {
      summaryCards.push({
        label: 'الرصيد الحالي بعد المستند',
        value: `${doc.newBalance.toLocaleString()} ${doc.currencySymbol}`,
        tone: 'gold',
      });
    }

    const extraNotes = [
      doc.amountInWords ? `المبلغ كتابةً: ${doc.amountInWords}` : '',
      doc.notes || '',
    ]
      .filter(Boolean)
      .join(' | ');

    return {
      title: doc.title,
      subtitle: doc.subtitle,
      reportCode: doc.documentNumber,
      periodText: doc.date,
      metadata,
      tables,
      summaryCards: doc.customSummaryCards || summaryCards,
      company,
      branch,
      notes: extraNotes || undefined,
      fileName: `${doc.title.replace(/\s+/g, '_')}_${doc.documentNumber}`,
      lang,
      docType: effectiveDocType,
      printTemplate: activeTpl,
      printTemplates,
    };
  }, [doc, hasBonusCol, hasDiscountCol, company, branch, lang, effectiveDocType, activeTpl, printTemplates]);

  const unifiedPreviewHtml = useMemo(() => {
    if (!isOpen) return '';
    void fontReadyTick;
    return generatePrintableHTML({ ...reportOptions, forPreview: true });
  }, [isOpen, reportOptions, fontReadyTick]);

  if (!isOpen) return null;

  const handlePrint = () => {
    printReportPreview(reportOptions);
  };

  const handleSavePdf = async () => {
    try {
      setIsBusyPdf(true);
      await downloadReportAsPDF(reportOptions);
    } catch (err) {
      setBtStatus({
        type: 'err',
        msg: err instanceof Error ? err.message : 'تعذر توليد ملف PDF.',
      });
    } finally {
      setIsBusyPdf(false);
    }
  };

  const handleSavePng = async () => {
    try {
      setIsBusyPng(true);
      const payload: UniversalPreviewPayload = {
        title: reportOptions.title,
        reportCode: reportOptions.reportCode,
        periodText: reportOptions.periodText,
        metadata: reportOptions.metadata,
        tables: reportOptions.tables,
        summaryCards: reportOptions.summaryCards,
        notes: reportOptions.notes,
        docType: effectiveDocType,
        printTemplate: activeTpl,
        whatsappText: `${doc.title} #${doc.documentNumber} - ${doc.entityName}: ${doc.totals.grandTotal.toLocaleString()} ${doc.currencySymbol}`,
      };
      const pages = await renderPayloadToPngPages(payload, company, branch, printTemplates);
      if (pages.length > 0) downloadPngPages(pages);
    } catch (err) {
      setBtStatus({
        type: 'err',
        msg: err instanceof Error ? err.message : 'تعذر تصدير الصورة.',
      });
    } finally {
      setIsBusyPng(false);
    }
  };

  const handleBluetoothPrint = async () => {
    setBtStatus({ type: 'idle', msg: '' });
    const nav = navigator as any;
    if (!nav.bluetooth) {
      setBtStatus({
        type: 'err',
        msg: 'متصفحك الحالي لا يدعم Web Bluetooth. استخدم Chrome أو Edge على Android/Windows أو اطبع عبر زر طباعة A4.',
      });
      return;
    }

    setIsPrintingBt(true);
    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          '0000ff00-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        ],
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error('تعذر الاتصال بخدمة GATT للطابعة');

      const services = await server.getPrimaryServices();
      let writableChar: any = null;
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties?.write || ch.properties?.writeWithoutResponse) {
            writableChar = ch;
            break;
          }
        }
        if (writableChar) break;
      }

      if (!writableChar) {
        throw new Error('لم يتم العثور على قناة كتابة ESC/POS متوافقة في الطابعة المختارة');
      }

      const sep = '--------------------------------';
      const lines: string[] = [
        company.nameAr,
        doc.title,
        sep,
        `Doc#: ${doc.documentNumber}`,
        `Date: ${doc.date}`,
        `Party: ${doc.entityName}`,
        sep,
      ];

      if (doc.items && doc.items.length > 0) {
        doc.items.forEach((it) => {
          const bonusStr = it.bonusQuantity ? ` (+${it.bonusQuantity})` : '';
          lines.push(`${it.index}. ${it.description}`);
          lines.push(
            `   ${it.quantity}${bonusStr} x ${it.unitPrice.toLocaleString()} = ${it.total.toLocaleString()} ${doc.currencySymbol}`
          );
        });
        lines.push(sep);
      }

      lines.push(`Total: ${doc.totals.grandTotal.toLocaleString()} ${doc.currencySymbol}`);
      if (doc.totals.paidAmount !== undefined) {
        lines.push(`Paid:  ${doc.totals.paidAmount.toLocaleString()} ${doc.currencySymbol}`);
      }
      if (doc.totals.remainingAmount !== undefined) {
        lines.push(`Rem:   ${doc.totals.remainingAmount.toLocaleString()} ${doc.currencySymbol}`);
      }
      if (doc.previousBalance !== undefined) {
        lines.push(`Prev Bal: ${doc.previousBalance.toLocaleString()} ${doc.currencySymbol}`);
      }
      if (doc.newBalance !== undefined) {
        lines.push(`New Bal:  ${doc.newBalance.toLocaleString()} ${doc.currencySymbol}`);
      }
      lines.push(sep);
      lines.push('Thank you / شكراً لتعاملكم');
      lines.push('\n\n\n');

      const payloadText = lines.join('\n');
      const encoder = new TextEncoder();
      const textBytes = encoder.encode(payloadText);
      const initCmd = new Uint8Array([0x1b, 0x40]);
      const cutCmd = new Uint8Array([0x1d, 0x56, 0x42, 0x00]);

      const fullBytes = new Uint8Array(initCmd.length + textBytes.length + cutCmd.length);
      fullBytes.set(initCmd, 0);
      fullBytes.set(textBytes, initCmd.length);
      fullBytes.set(cutCmd, initCmd.length + textBytes.length);

      for (let i = 0; i < fullBytes.length; i += 100) {
        const chunk = fullBytes.slice(i, i + 100);
        if (writableChar.properties.writeWithoutResponse) {
          await writableChar.writeValueWithoutResponse(chunk);
        } else {
          await writableChar.writeValue(chunk);
        }
      }

      setBtStatus({
        type: 'ok',
        msg: `تم إرسال الإيصال بنجاح إلى الطابعة الحرارية (${device.name || 'Bluetooth Printer'}).`,
      });
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        setBtStatus({ type: 'err', msg: 'تم إلغاء اختيار طابعة البلوتوث.' });
      } else {
        setBtStatus({
          type: 'err',
          msg: err?.message || 'تعذر الاتصال بالطابعة الحرارية عبر البلوتوث.',
        });
      }
    } finally {
      setIsPrintingBt(false);
    }
  };

  const headerActions = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={handleBluetoothPrint}
        disabled={isPrintingBt}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-bold text-xs rounded-md transition-colors cursor-pointer whitespace-nowrap"
      >
        <Bluetooth className="w-3.5 h-3.5" />
        <span>{isPrintingBt ? 'اتصال...' : 'بلوتوث'}</span>
      </button>
      <button
        type="button"
        onClick={handleSavePdf}
        disabled={isBusyPdf}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--info)] hover:brightness-110 disabled:opacity-60 text-[#03060A] font-black text-xs rounded-md transition-colors cursor-pointer whitespace-nowrap"
      >
        <FileDown className="w-3.5 h-3.5" />
        <span>{isBusyPdf ? 'جاري PDF...' : 'حفظ PDF'}</span>
      </button>
      <button
        type="button"
        onClick={handleSavePng}
        disabled={isBusyPng}
        className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-300 hover:brightness-105 disabled:opacity-60 text-[#03060A] font-black text-xs rounded-md transition-colors cursor-pointer whitespace-nowrap"
      >
        <ImageDown className="w-3.5 h-3.5" />
        <span>{isBusyPng ? 'تجهيز PNG...' : 'صور عالية الدقة'}</span>
      </button>
      <button
        type="button"
        onClick={handlePrint}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-md transition-colors cursor-pointer whitespace-nowrap"
      >
        <Printer className="w-3.5 h-3.5" />
        <span>طباعة A4</span>
      </button>
    </div>
  );

  return createPortal(
    <MdiFloatingFrame
      windowId={`print-${reactId}-${doc.documentNumber}`}
      title={lang === 'en' ? `Print Preview: ${doc.title}` : `معاينة طباعة: ${doc.title} (${doc.documentNumber})`}
      subtitle={doc.entityName}
      kind="print"
      defaultWidth={920}
      defaultHeight={670}
      dir={lang === 'en' ? 'ltr' : 'rtl'}
      headerActions={headerActions}
      onClose={onClose}
    >
      <div className="bg-slate-200 min-h-full flex flex-col">
        {btStatus.type !== 'idle' && (
          <div
            className={`px-4 py-2.5 text-xs flex items-center justify-between no-print ${
              btStatus.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-200'
                : 'bg-rose-50 text-rose-800 border-b border-rose-200'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              {btStatus.type === 'ok' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{btStatus.msg}</span>
            </div>
            <button
              type="button"
              onClick={() => setBtStatus({ type: 'idle', msg: '' })}
              className="text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        )}

        <iframe
          title={`PrintPreview-${doc.documentNumber}`}
          srcDoc={unifiedPreviewHtml}
          className="w-full flex-1 min-h-[580px] bg-slate-200 border-0 block"
        />
      </div>
    </MdiFloatingFrame>,
    document.body
  );
};
