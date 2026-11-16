/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Windows-Style Resizable Preview, Print, Binary PDF, Excel, WhatsApp & Bluetooth Modal
 * Uses the Unified Document Engine (generatePrintableHTML with forPreview: true) so Screen Preview == Browser Print 100%.
 */

import React, { useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer,
  FileDown,
  ImageDown,
  FileSpreadsheet,
  MessageCircle,
  Bluetooth,
} from 'lucide-react';
import {
  Company,
  Branch,
  Invoice,
  PaymentVoucher,
  PrintDocumentType,
  PrintTemplateConfig,
} from '../../types/erp';
import {
  ReportPDFOptions,
  SummaryCardDef,
  downloadReportAsPDF,
  downloadInvoicePDF,
  downloadVoucherPDF,
  exportToExcel,
  generatePrintableHTML,
  inferPrintDocType,
  printReportPreview,
  resolveEffectivePrintTemplate,
} from '../../services/exportService';
import {
  downloadPngPages,
  renderPayloadToPngPages,
} from '../../services/documentImageHelper';
import { MdiFloatingFrame } from './MdiWindowManager';
import { WhatsAppShareModal } from './WhatsAppShareModal';

export interface UniversalPreviewPayload {
  title: string;
  subtitle?: string;
  periodText?: string;
  reportCode?: string;
  metadata?: Record<string, string>;
  tables: {
    title?: string;
    headers: string[];
    rows: (string | number)[][];
    totals?: (string | number)[];
    alignments?: ('right' | 'center' | 'left')[];
  }[];
  summaryCards?: SummaryCardDef[];
  notes?: string;
  whatsappText: string;
  defaultPhone?: string;
  bluetoothLines?: string[];
  invoiceObj?: Invoice;
  voucherObj?: PaymentVoucher;
  warehouseName?: string;
  docType?: PrintDocumentType;
  printTemplate?: PrintTemplateConfig;
}

interface UniversalPreviewModalProps {
  isOpen: boolean;
  payload: UniversalPreviewPayload | null;
  company: Company;
  branch: Branch;
  lang?: 'ar' | 'en';
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  onClose: () => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const UniversalPreviewModal: React.FC<UniversalPreviewModalProps> = ({
  isOpen,
  payload,
  company,
  branch,
  lang = 'ar',
  printTemplates,
  onClose,
  onNotify,
}) => {
  const reactId = useId();
  const [isWaOpen, setIsWaOpen] = useState(false);
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

  const inferredDocType: PrintDocumentType = useMemo(() => {
    if (!payload) return 'report';
    return inferPrintDocType(
      payload.title,
      payload.docType ||
        (payload.invoiceObj ? 'invoice' : payload.voucherObj ? 'voucher' : undefined)
    );
  }, [payload]);

  const activeTpl = useMemo(
    () =>
      resolveEffectivePrintTemplate({
        docType: inferredDocType,
        title: payload?.title,
        printTemplate: payload?.printTemplate,
        printTemplates,
      }),
    [inferredDocType, payload?.title, payload?.printTemplate, printTemplates]
  );

  const pdfOptions: ReportPDFOptions | null = useMemo(() => {
    if (!payload) return null;
    return {
      docType: inferredDocType,
      printTemplate: activeTpl,
      printTemplates,
      title: payload.title,
      subtitle: payload.subtitle,
      reportCode: payload.reportCode,
      periodText: payload.periodText,
      metadata: payload.metadata,
      tables: payload.tables,
      summaryCards: payload.summaryCards,
      company,
      branch,
      notes: payload.notes,
      lang,
    };
  }, [payload, inferredDocType, activeTpl, printTemplates, company, branch, lang]);

  const unifiedPreviewHtml = useMemo(() => {
    if (!isOpen || !pdfOptions) return '';
    void fontReadyTick;
    return generatePrintableHTML({ ...pdfOptions, forPreview: true });
  }, [isOpen, pdfOptions, fontReadyTick]);

  if (!isOpen || !payload || !pdfOptions) return null;

  const handleCleanPrint = () => {
    printReportPreview(pdfOptions);
    onNotify?.('info', 'تم تجهيز المستند للطباعة المعزولة.');
  };

  const handleSavePdf = async () => {
    try {
      setIsBusyPdf(true);
      if (payload.invoiceObj) {
        await downloadInvoicePDF(payload.invoiceObj, company, branch, payload.warehouseName, activeTpl);
      } else if (payload.voucherObj) {
        await downloadVoucherPDF(payload.voucherObj, company, branch, activeTpl);
      } else {
        await downloadReportAsPDF(pdfOptions);
      }
      onNotify?.('success', 'تم إنشاء وتنزيل ملف PDF الثنائي بنجاح.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إنشاء ملف PDF';
      onNotify?.('error', msg);
    } finally {
      setIsBusyPdf(false);
    }
  };

  const handleSavePngPages = async () => {
    try {
      setIsBusyPng(true);
      const pages = await renderPayloadToPngPages(payload, company, branch, printTemplates);
      if (pages.length === 0) {
        onNotify?.('error', 'تعذر توليد صفحات الصورة.');
        return;
      }
      downloadPngPages(pages);
      onNotify?.(
        'success',
        pages.length > 1
          ? `تم حفظ ${pages.length} صفحات صور عالية الدقة (2480px) بنجاح بدون قص أو ضعف في الجودة.`
          : 'تم حفظ صورة المستند عالية الدقة (2480px PNG) بنجاح.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر إنشاء صور PNG';
      onNotify?.('error', msg);
    } finally {
      setIsBusyPng(false);
    }
  };

  const handleExportExcel = () => {
    const sheets = payload.tables.map((t, idx) => ({
      name: t.title || `بيانات_${idx + 1}`,
      data: [t.headers, ...t.rows, ...(t.totals ? [t.totals] : [])],
    }));
    exportToExcel({
      fileName: `${payload.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`,
      sheets: sheets.length > 0 ? sheets : [{ name: 'ملخص', data: [[payload.title]] }],
    });
    onNotify?.('success', 'تم تصدير ملف Excel (.xlsx) بنجاح.');
  };

  const handleBluetoothPrint = async () => {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: { acceptAllDevices: boolean; optionalServices: string[] }) => Promise<{
          gatt?: {
            connect: () => Promise<{
              getPrimaryServices: () => Promise<
                {
                  getCharacteristics: () => Promise<
                    {
                      properties: { write?: boolean; writeWithoutResponse?: boolean };
                      writeValue: (data: Uint8Array) => Promise<void>;
                    }[]
                  >;
                }[]
              >;
            }>;
          };
        }>;
      };
    };

    if (!nav.bluetooth) {
      onNotify?.(
        'error',
        'المتصفح الحالي لا يدعم الطباعة بالبلوتوث المباشر (Web Bluetooth). يرجى استخدام Chrome أو Edge على سطح المكتب أو أندرويد.'
      );
      return;
    }

    try {
      onNotify?.('info', 'جاري البحث عن طابعات البلوتوث القريبة...');
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
        ],
      });
      const server = await device.gatt?.connect();
      if (!server) throw new Error('تعذر الاتصال بخدمة GATT للطابعة');
      const services = await server.getPrimaryServices();
      let targetChar: {
        properties: { write?: boolean; writeWithoutResponse?: boolean };
        writeValue: (data: Uint8Array) => Promise<void>;
      } | null = null;

      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            targetChar = ch;
            break;
          }
        }
        if (targetChar) break;
      }
      if (!targetChar) {
        onNotify?.('error', 'الجهاز المتصل لا يدعم استقبال بيانات الطباعة النصية.');
        return;
      }

      const lines =
        payload.bluetoothLines && payload.bluetoothLines.length > 0
          ? payload.bluetoothLines
          : [company.nameAr, company.phone, '----------------', payload.title];
      const data = new TextEncoder().encode(lines.join('\n') + '\n\n\n\x1D\x56\x00');
      for (let i = 0; i < data.length; i += 20) {
        await targetChar.writeValue(data.slice(i, i + 20));
      }
      onNotify?.('success', 'تم إرسال الإيصال إلى طابعة البلوتوث بنجاح.');
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name !== 'NotFoundError') {
        onNotify?.('error', `خطأ بلوتوث: ${e?.message || 'غير معروف'}`);
      }
    }
  };

  const headerActions = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={handleCleanPrint}
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[var(--gold)] text-[#03060A] hover:bg-[var(--gold-hover)] flex items-center gap-1 cursor-pointer whitespace-nowrap"
      >
        <Printer className="w-3.5 h-3.5" />
        <span>طباعة</span>
      </button>
      <button
        type="button"
        onClick={handleSavePdf}
        disabled={isBusyPdf}
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[var(--info)] text-[#03060A] hover:brightness-110 flex items-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
      >
        <FileDown className="w-3.5 h-3.5" />
        <span>{isBusyPdf ? 'جاري PDF...' : 'حفظ PDF'}</span>
      </button>
      <button
        type="button"
        onClick={handleSavePngPages}
        disabled={isBusyPng}
        title="تصدير التقرير كصور A4 مقسّمة بدقة 2480 بكسل بدون فقدان الجودة"
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-amber-300 text-[#03060A] hover:brightness-105 flex items-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
      >
        <ImageDown className="w-3.5 h-3.5" />
        <span>{isBusyPng ? 'تجهيز PNG...' : 'صور عالية الدقة'}</span>
      </button>
      <button
        type="button"
        onClick={handleExportExcel}
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#10B981] text-[#03060A] hover:brightness-110 flex items-center gap-1 cursor-pointer whitespace-nowrap"
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        <span>Excel</span>
      </button>
      <button
        type="button"
        onClick={() => setIsWaOpen(true)}
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#25D366] text-[#03060A] hover:brightness-110 flex items-center gap-1 cursor-pointer whitespace-nowrap"
      >
        <MessageCircle className="w-3.5 h-3.5" />
        <span>واتس</span>
      </button>
      <button
        type="button"
        onClick={handleBluetoothPrint}
        className="px-2.5 py-1.5 rounded-md text-xs font-black bg-[#3B82F6] text-white hover:brightness-110 flex items-center gap-1 cursor-pointer whitespace-nowrap"
      >
        <Bluetooth className="w-3.5 h-3.5" />
        <span>بلوتوث</span>
      </button>
    </div>
  );

  return (
    <>
      {createPortal(
        <MdiFloatingFrame
          windowId={`preview-${reactId}`}
          title={lang === 'en' ? `Preview: ${payload.title}` : `معاينة: ${payload.title}`}
          subtitle={payload.periodText || payload.subtitle}
          kind="preview"
          defaultWidth={960}
          defaultHeight={680}
          dir={lang === 'en' ? 'ltr' : 'rtl'}
          headerActions={headerActions}
          onClose={onClose}
        >
          <div className="w-full h-full min-h-[580px] bg-slate-200 flex flex-col">
            <iframe
              title={`Preview-${payload.title}`}
              srcDoc={unifiedPreviewHtml}
              className="w-full flex-1 min-h-[580px] bg-slate-200 border-0 block"
            />
          </div>
        </MdiFloatingFrame>,
        document.body
      )}

      <WhatsAppShareModal
        isOpen={isWaOpen}
        title={`مشاركة عبر واتساب: ${payload.title}`}
        defaultPhone={payload.defaultPhone}
        defaultMessage={payload.whatsappText}
        previewPayload={payload}
        company={company}
        branch={branch}
        onClose={() => setIsWaOpen(false)}
        onNotify={onNotify}
      />
    </>
  );
};
