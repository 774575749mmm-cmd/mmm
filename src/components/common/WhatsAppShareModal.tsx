/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Unified WhatsApp Share Modal (PNG Image + Cairo PDF + Editable Text)
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  MessageCircle,
  Copy,
  Check,
  ExternalLink,
  AlertCircle,
  Image as ImageIcon,
  FileText,
  FileDown,
  Share2,
  ClipboardCopy,
  Loader2,
} from 'lucide-react';
import { Branch, Company, WhatsAppTemplates } from '../../types/erp';
import {
  buildWhatsAppLink,
  renderWhatsAppTemplate,
  validateWhatsAppPhone,
} from '../../services/exportService';
import {
  buildPayloadPdfBlob,
  downloadPngPages,
  PngPageAsset,
  RenderedPngResult,
  renderPayloadToPng,
} from '../../services/documentImageHelper';
import type { UniversalPreviewPayload } from './UniversalPreviewModal';

export type WhatsAppTemplateKey = keyof WhatsAppTemplates;
type ShareMode = 'image' | 'pdf' | 'text';

interface WhatsAppShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  recipientName?: string;
  defaultPhone?: string;
  defaultTemplateKey?: WhatsAppTemplateKey;
  templates?: WhatsAppTemplates;
  templateVars?: Record<string, string | number | undefined>;
  defaultMessage?: string;
  previewPayload?: UniversalPreviewPayload | null;
  company?: Company;
  branch?: Branch;
  onDispatched?: (details: { phone: string; message: string; channel: 'whatsapp' }) => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const TEMPLATE_LABELS: Record<WhatsAppTemplateKey, string> = {
  invoice: 'قالب فاتورة مبيعات / مشتريات',
  voucher: 'قالب سند قبض / صرف',
  statement: 'قالب كشف حساب عميل / مورد',
  overdueReminder: 'قالب تذكير مديونية متأخرة',
  paymentConfirmation: 'قالب تأكيد استلام دفعة',
  dailySummary: 'قالب ملخص الإدارة اليومي',
};

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  onClose,
  title = 'مشاركة عبر واتساب',
  recipientName,
  defaultPhone = '',
  defaultTemplateKey = 'invoice',
  templates,
  templateVars = {},
  defaultMessage,
  previewPayload,
  company,
  branch,
  onDispatched,
  onNotify,
}) => {
  const hasDocMedia = Boolean(previewPayload && company);

  const [shareMode, setShareMode] = useState<ShareMode>(hasDocMedia ? 'image' : 'text');
  const [phone, setPhone] = useState(defaultPhone);
  const [selectedTemplate, setSelectedTemplate] = useState<WhatsAppTemplateKey>(defaultTemplateKey);
  const [message, setMessage] = useState(defaultMessage || '');
  const [copied, setCopied] = useState(false);

  // PNG & PDF generated assets
  const [pngAsset, setPngAsset] = useState<RenderedPngResult | null>(null);
  const [activePngPageIdx, setActivePngPageIdx] = useState(0);
  const [pngLoading, setPngLoading] = useState(false);
  const [pngError, setPngError] = useState<string>('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [imageCopied, setImageCopied] = useState(false);

  const waHiddenAnchorRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPhone(defaultPhone || '');
    setSelectedTemplate(defaultTemplateKey);
    setShareMode(previewPayload && company ? 'image' : 'text');
    if (defaultMessage) {
      setMessage(defaultMessage);
    } else if (templates && templates[defaultTemplateKey]) {
      setMessage(renderWhatsAppTemplate(templates[defaultTemplateKey], templateVars));
    }
    setCopied(false);
    setImageCopied(false);
    setPngAsset(null);
    setActivePngPageIdx(0);
    setPngError('');
  }, [isOpen, defaultPhone, defaultTemplateKey, defaultMessage, previewPayload, company]);

  // Render crisp paginated PNG previews on open whenever previewPayload + company exist
  useEffect(() => {
    if (!isOpen || !previewPayload || !company) return;
    let cancelled = false;
    setPngLoading(true);
    setPngError('');
    renderPayloadToPng(previewPayload, company, branch)
      .then((res) => {
        if (!cancelled) {
          setPngAsset(res);
          setActivePngPageIdx(0);
          setPngLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPngError(err instanceof Error ? err.message : 'تعذر إنشاء صورة المستند.');
          setPngLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, previewPayload, company, branch]);

  if (!isOpen) return null;

  const phoneCheck = validateWhatsAppPhone(phone);
  const shortCaption =
    previewPayload && company
      ? `${company.nameAr}\nمرفق: ${previewPayload.title}${previewPayload.periodText ? ` (${previewPayload.periodText})` : ''}`
      : message;
  const activeWaText = shareMode === 'text' ? message : shortCaption || message;
  const waLink = phoneCheck.valid
    ? buildWhatsAppLink(phoneCheck.normalized, activeWaText.trim() || previewPayload?.title || 'مستند')
    : '';

  const applyTemplate = (key: WhatsAppTemplateKey) => {
    setSelectedTemplate(key);
    if (templates && templates[key]) {
      setMessage(renderWhatsAppTemplate(templates[key], templateVars));
    }
  };

  const triggerDownload = (blobOrUrl: Blob | string, fileName: string) => {
    const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (typeof blobOrUrl !== 'string') {
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  };

  const openWhatsAppChatAnchor = () => {
    if (waLink && waHiddenAnchorRef.current) {
      waHiddenAnchorRef.current.click();
      onDispatched?.({ phone: phoneCheck.normalized, message: activeWaText, channel: 'whatsapp' });
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onNotify?.('success', 'تم نسخ نص الرسالة إلى الحافظة.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify?.('error', 'تعذر النسخ التلقائي — انسخ النص يدوياً.');
    }
  };

  const activePngPage: PngPageAsset | null =
    pngAsset?.pages?.[activePngPageIdx] || pngAsset?.pages?.[0] || null;

  const handleCopyImageAndOpenWhatsApp = async (openChat: boolean) => {
    if (!activePngPage) return;
    try {
      const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && ClipboardItemCtor) {
        await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': activePngPage.blob })]);
        setImageCopied(true);
        setTimeout(() => setImageCopied(false), 3000);
        if (openChat && waLink) {
          onNotify?.('success', 'تم نسخ صورة المستند إلى الحافظة — الصقها (Ctrl+V) داخل محادثة واتساب للإرسال كصورة.');
          openWhatsAppChatAnchor();
        } else {
          onNotify?.('success', 'تم نسخ صورة الصفحة الحالية إلى الحافظة — يمكنك لصقها مباشرة في واتساب.');
        }
        return;
      }
      // Fallback: download crisp PNG page(s)
      if (pngAsset && pngAsset.pages.length > 1) {
        downloadPngPages(pngAsset.pages);
      } else {
        triggerDownload(activePngPage.dataUrl, activePngPage.fileName);
      }
      onNotify?.('info', 'تم تنزيل صورة المستند عالية الدقة (PNG) — أرفقها داخل محادثة واتساب.');
      if (openChat && waLink) openWhatsAppChatAnchor();
    } catch {
      if (pngAsset && pngAsset.pages.length > 1) {
        downloadPngPages(pngAsset.pages);
      } else {
        triggerDownload(activePngPage.dataUrl, activePngPage.fileName);
      }
      onNotify?.('info', 'تم تنزيل صورة المستند عالية الدقة (PNG) لإرفاقها داخل محادثة واتساب.');
      if (openChat && waLink) openWhatsAppChatAnchor();
    }
  };

  const handleNativeShareImage = async () => {
    if (!pngAsset || !activePngPage) return;
    try {
      const files = pngAsset.pages.map((p) => new File([p.blob], p.fileName, { type: 'image/png' }));
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files }))) {
        await nav.share({
          files,
          title: previewPayload?.title || title,
          text: shortCaption,
        });
        onDispatched?.({ phone: phoneCheck.normalized || '', message: shortCaption, channel: 'whatsapp' });
        onNotify?.('success', `تمت مشاركة ${files.length} صورة مستند عالية الدقة بنجاح.`);
        return;
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return;
    }
    await handleCopyImageAndOpenWhatsApp(Boolean(waLink));
  };

  const handleDownloadPdfAndOpen = async (openChat: boolean) => {
    if (!previewPayload || !company) return;
    try {
      setPdfBusy(true);
      const { blob, fileName } = await buildPayloadPdfBlob(previewPayload, company, branch);
      triggerDownload(blob, fileName);
      onNotify?.('success', `تم تجهيز وتنزيل ملف PDF (${fileName}) بخط Cairo لإرفاقه في واتساب.`);
      if (openChat && waLink) {
        openWhatsAppChatAnchor();
      }
    } catch (err: unknown) {
      onNotify?.('error', err instanceof Error ? err.message : 'تعذر توليد ملف PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const handleNativeSharePdf = async () => {
    if (!previewPayload || !company) return;
    try {
      setPdfBusy(true);
      const { blob, fileName } = await buildPayloadPdfBlob(previewPayload, company, branch);
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({
          files: [file],
          title: previewPayload.title,
          text: shortCaption,
        });
        onDispatched?.({ phone: phoneCheck.normalized || '', message: shortCaption, channel: 'whatsapp' });
        onNotify?.('success', 'تمت مشاركة ملف PDF بنجاح.');
        return;
      }
      triggerDownload(blob, fileName);
      onNotify?.('info', 'تم تنزيل ملف PDF — أرفقه مباشرة في محادثة واتساب.');
      if (waLink) openWhatsAppChatAnchor();
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        onNotify?.('error', err instanceof Error ? err.message : 'تعذر مشاركة PDF');
      }
    } finally {
      setPdfBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9990] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
      <div className="bg-slate-900 border-2 border-emerald-500/50 rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Hidden anchor for opening wa.me safely without window.open */}
        {waLink && (
          <a
            ref={waHiddenAnchorRef}
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden"
          >
            WhatsApp
          </a>
        )}

        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">{title}</h3>
              {recipientName && <p className="text-xs text-slate-400">المستلم: {recipientName}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Mode Switcher (Image PNG / PDF / Text) */}
        {hasDocMedia && (
          <div className="px-5 pt-3 pb-2 border-b border-slate-800 bg-slate-950/40 flex items-center gap-2 flex-wrap shrink-0">
            <button
              type="button"
              onClick={() => setShareMode('image')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer ${
                shareMode === 'image'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>صورة المستند (PNG)</span>
            </button>
            <button
              type="button"
              onClick={() => setShareMode('pdf')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer ${
                shareMode === 'pdf'
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>ملف PDF الرسمي (Cairo)</span>
            </button>
            <button
              type="button"
              onClick={() => setShareMode('text')}
              className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 cursor-pointer ${
                shareMode === 'text'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>رسالة نصية</span>
            </button>
          </div>
        )}

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Recipient Phone */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">رقم واتساب المستلم (بصيغة دولية)</label>
            <input
              type="text"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="967770001111"
              className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-sm font-mono focus:border-emerald-500 focus:outline-none"
            />
            {phone && !phoneCheck.valid ? (
              <p className="mt-1.5 text-xs text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{phoneCheck.error}</span>
              </p>
            ) : phoneCheck.valid ? (
              <p className="mt-1 text-[11px] text-emerald-400 font-mono">
                الرقم المعتمد للإرسال: +{phoneCheck.normalized}
              </p>
            ) : null}
          </div>

          {/* Mode 1: High-res Paginated PNG Image */}
          {shareMode === 'image' && hasDocMedia && (
            <div className="space-y-3">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <span className="text-xs font-black text-emerald-300">
                    معاينة صورة المستند عالية الدقة (2480px PNG)
                  </span>
                  {activePngPage && (
                    <div className="flex items-center gap-2">
                      {pngAsset && pngAsset.pages.length > 1 && (
                        <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px]">
                          <button
                            type="button"
                            disabled={activePngPageIdx === 0}
                            onClick={() => setActivePngPageIdx((p) => Math.max(0, p - 1))}
                            className="px-1.5 text-amber-300 font-bold disabled:opacity-30 cursor-pointer"
                          >
                            السابق
                          </button>
                          <span className="text-white font-mono">
                            {activePngPage.pageNumber}/{activePngPage.totalPages}
                          </span>
                          <button
                            type="button"
                            disabled={activePngPageIdx >= pngAsset.pages.length - 1}
                            onClick={() =>
                              setActivePngPageIdx((p) => Math.min(pngAsset.pages.length - 1, p + 1))
                            }
                            className="px-1.5 text-amber-300 font-bold disabled:opacity-30 cursor-pointer"
                          >
                            التالي
                          </button>
                        </div>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">
                        {(activePngPage.blob.size / 1024).toFixed(0)} KB · {activePngPage.widthPx}×{activePngPage.heightPx}
                      </span>
                    </div>
                  )}
                </div>

                {pngLoading ? (
                  <div className="py-12 flex items-center justify-center gap-2 text-xs text-amber-300 font-bold">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>جاري توليد صفحات المستند بدقة عالية (2480px)...</span>
                  </div>
                ) : pngError ? (
                  <div className="py-6 text-center text-xs text-rose-400 font-bold">{pngError}</div>
                ) : activePngPage ? (
                  <div className="max-h-72 overflow-y-auto rounded border border-slate-700 bg-white p-1">
                    <img
                      src={activePngPage.dataUrl}
                      alt={previewPayload?.title || 'معاينة المستند'}
                      className="w-full h-auto block"
                    />
                  </div>
                ) : null}
              </div>

              <div className="text-[11px] text-emerald-200/90 bg-emerald-950/40 border border-emerald-700/40 rounded-lg px-3 py-2 leading-relaxed">
                يتم تقسيم التقارير الطويلة تلقائياً إلى صفحات متناسقة بعرض <strong>2480px</strong> للحفاظ على كامل الدقة والوضوح عند التنزيل أو الإرسال عبر واتساب دون أي تشويش.
              </div>
            </div>
          )}

          {/* Mode 2: Official Binary PDF */}
          {shareMode === 'pdf' && hasDocMedia && (
            <div className="space-y-3">
              <div className="bg-slate-950 border border-sky-800/60 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sky-300 font-black text-sm">
                  <FileDown className="w-5 h-5" />
                  <span>مستند PDF رسمي بخط Cairo — {previewPayload?.title}</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  يحتوي ملف PDF على كامل بيانات وتفاصيل المستند منسقة بوضوح باللغة العربية والخطوط الرسمية المعتمدة، وجاهز للإرسال للعميل أو الإدارة عبر واتساب.
                </p>
              </div>
            </div>
          )}

          {/* Mode 3: Editable Text */}
          {shareMode === 'text' && (
            <>
              {templates && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">اختيار قالب رسالة جاهز</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => applyTemplate(e.target.value as WhatsAppTemplateKey)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs focus:border-amber-500 focus:outline-none"
                  >
                    {(Object.keys(TEMPLATE_LABELS) as WhatsAppTemplateKey[]).map((key) => (
                      <option key={key} value={key}>
                        {TEMPLATE_LABELS[key]}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">نص الرسالة القابل للتعديل</label>
                <textarea
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-100 text-xs sm:text-sm leading-relaxed focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-800 bg-slate-950/70 shrink-0">
          {shareMode === 'image' && hasDocMedia ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  disabled={!activePngPage}
                  onClick={() => {
                    if (!pngAsset || !activePngPage) return;
                    if (pngAsset.pages.length > 1) {
                      downloadPngPages(pngAsset.pages);
                      onNotify?.('success', `جاري تنزيل جميع الصفحات (${pngAsset.pages.length} صور عالية الدقة)...`);
                    } else {
                      triggerDownload(activePngPage.dataUrl, activePngPage.fileName);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>
                    {pngAsset && pngAsset.pages.length > 1
                      ? `تنزيل كل الصفحات (${pngAsset.pages.length})`
                      : 'تنزيل PNG'}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!activePngPage}
                  onClick={() => handleCopyImageAndOpenWhatsApp(false)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 disabled:opacity-40 cursor-pointer"
                >
                  {imageCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                  <span>{imageCopied ? 'تم نسخ الصورة' : 'نسخ الصفحة الحالية'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={!pngAsset}
                  onClick={handleNativeShareImage}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>مشاركة ملف الصورة</span>
                </button>
                <button
                  type="button"
                  disabled={!pngAsset || !waLink}
                  onClick={() => handleCopyImageAndOpenWhatsApp(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>نسخ الصورة + فتح واتساب</span>
                </button>
              </div>
            </>
          ) : shareMode === 'pdf' && hasDocMedia ? (
            <>
              <button
                type="button"
                disabled={pdfBusy}
                onClick={() => handleDownloadPdfAndOpen(false)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>{pdfBusy ? 'جاري التوليد...' : 'تنزيل PDF فقط'}</span>
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={pdfBusy}
                  onClick={handleNativeSharePdf}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>مشاركة PDF مباشرة</span>
                </button>
                <button
                  type="button"
                  disabled={pdfBusy || !waLink}
                  onClick={() => handleDownloadPdfAndOpen(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>تحميل PDF + فتح واتساب</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopyText}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  إغلاق
                </button>
                {waLink ? (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      onDispatched?.({ phone: phoneCheck.normalized, message, channel: 'whatsapp' });
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>فتح واتساب للإرسال</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600/30 text-slate-400 cursor-not-allowed"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>أدخل رقماً ونصاً صالحاً</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
