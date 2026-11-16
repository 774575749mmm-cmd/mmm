/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - High-Resolution Paginated PNG Image & PDF Blob Renderer
 * Consumes the Unified Intelligent Pagination Engine (`buildDocumentPaginationPlan`)
 * and 12-Element Typography so PNG exports match Preview, Browser Print, and PDF page-for-page.
 */

import {
  Branch,
  Company,
  PrintDocumentType,
  PrintTemplateConfig,
  TypographyElementKey,
} from '../types/erp';
import { UniversalPreviewPayload } from '../components/common/UniversalPreviewModal';
import { ReportPDFOptions } from './exportService';
import { inferPrintDocType } from './printTemplateResolver';
import {
  buildInvoicePdfBytes,
  buildReportPdfBytes,
  buildVoucherPdfBytes,
} from './arabicPdfHelper';
import {
  buildDocumentPaginationPlan,
  wrapTextToWidthMm,
} from './documentPaginationEngine';

const yieldUi = (): Promise<void> =>
  typeof window === 'undefined' ? Promise.resolve() : new Promise((r) => setTimeout(r, 0));

export interface PngPageAsset {
  pageNumber: number;
  totalPages: number;
  blob: Blob;
  dataUrl: string;
  fileName: string;
  widthPx: number;
  heightPx: number;
}

export interface RenderedPngResult {
  blob: Blob;
  dataUrl: string;
  fileName: string;
  pages: PngPageAsset[];
}

function resolveCanvasFontFamily(fontFamily?: PrintTemplateConfig['fontFamily']): string {
  if (fontFamily === 'DejaVu') return '"DejaVu", "Cairo", "Segoe UI", Tahoma, sans-serif';
  if (fontFamily === 'Tajawal') return '"Tajawal", "Cairo", "Segoe UI", Tahoma, sans-serif';
  return '"Cairo", "Segoe UI", Tahoma, sans-serif';
}

/**
 * Renders any UniversalPreviewPayload into 1..N crisp A4-proportioned high-DPI PNG pages (2480px wide @2x)
 * sharing the exact pagination plan and 12 typography sizes with HTML Preview, Browser Print, and PDF.
 */
export async function renderPayloadToPngPages(
  payload: UniversalPreviewPayload,
  company: Company,
  branch?: Branch,
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>
): Promise<PngPageAsset[]> {
  if (typeof document === 'undefined') {
    throw new Error('توليد الصور متاح في المتصفح فقط.');
  }

  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {
    // ignore
  }

  const inferredDocType = inferPrintDocType(
    payload.title,
    payload.docType ||
      (payload.invoiceObj ? 'invoice' : payload.voucherObj ? 'voucher' : undefined)
  );

  const reportOpts: ReportPDFOptions = {
    docType: inferredDocType,
    printTemplate: payload.printTemplate,
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
    lang: 'ar',
  };

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d')!;
  mCtx.direction = 'rtl';

  const plan = buildDocumentPaginationPlan(reportOpts);
  const { tpl: activeTpl, typoPt, pagination, pages } = plan;
  const canvasFont = resolveCanvasFontFamily(activeTpl.fontFamily);

  const primaryColor = activeTpl.primaryColor || '#0F172A';
  const accentColor = activeTpl.accentColor || '#D97706';
  const tableHeaderBg = activeTpl.tableHeaderBg || '#0F172A';
  const tableHeaderText = activeTpl.tableHeaderText || '#F5C748';
  const borderColor = activeTpl.borderColor || '#CBD5E1';
  const typoColors = plan.typo.colors || {};
  const typoWeights = plan.typo.weights;
  const elemColor = (key: TypographyElementKey, fallback: string) => typoColors[key] || fallback;
  const elemWeight = (key: TypographyElementKey, fallback: string) =>
    typoWeights?.[key] === 'bold' ? '800' : typoWeights?.[key] === 'normal' ? '500' : fallback;

  const logicalW = 1240;
  const pxPerMm = logicalW / plan.pageWidthMm;
  const logicalH = Math.round(plan.pageHeightMm * pxPerMm);
  const ptToMm = 0.352778;
  const ptPx = (pt: number) => Math.max(9, Math.round(pt * ptToMm * pxPerMm));
  const mmPx = (mm: number) => mm * pxPerMm;
  const scale = 2; // 2480px wide physical canvas

  const marginTopPx = mmPx(plan.marginTopMm);
  const marginLeftPx = mmPx(plan.marginLeftMm);
  const marginRightPx = mmPx(plan.marginRightMm);
  const marginBottomPx = mmPx(plan.marginBottomMm);
  const innerW = logicalW - marginLeftPx - marginRightPx;
  const rightEdge = logicalW - marginRightPx;

  const measurePxMm = (txt: string, pt: number, bold: boolean): number => {
    mCtx.font = `${bold ? '800' : '600'} ${ptPx(pt)}px ${canvasFont}`;
    return mCtx.measureText(String(txt ?? '')).width / pxPerMm;
  };

  const isolateLtr = (txt: string) =>
    txt.replace(/[A-Za-z0-9#+-][A-Za-z0-9.,:/%\-_+#()]*/g, '\u200E$&\u200E');

  const safeBaseTitle =
    payload.title.replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '_').slice(0, 44) || 'document';
  const totalPages = pages.length;
  const assets: PngPageAsset[] = [];

  for (let pIdx = 0; pIdx < totalPages; pIdx++) {
    if (pIdx > 0) await yieldUi();
    const page = pages[pIdx];
    const canvas = document.createElement('canvas');
    canvas.width = logicalW * scale;
    canvas.height = logicalH * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.direction = 'rtl';

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, logicalW, logicalH);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = Math.max(1, Number(activeTpl.borderWidthPx) || 1);
    ctx.strokeRect(10, 10, logicalW - 20, logicalH - 20);

    let y = marginTopPx;

    // 1. Page Header
    if (page.headerKind === 'full') {
      if (!activeTpl.showHeader) {
        const barH = Math.max(38, ptPx(typoPt.documentTitle) * 1.9 + 10);
        ctx.fillStyle = primaryColor;
        ctx.fillRect(marginLeftPx, y, innerW, barH);
        ctx.fillStyle = accentColor;
        ctx.fillRect(marginLeftPx, y + barH, innerW, 3);
        ctx.fillStyle = elemColor('documentTitle', tableHeaderText);
        ctx.font = `${elemWeight('documentTitle', '800')} ${ptPx(typoPt.documentTitle)}px ${canvasFont}`;
        ctx.textAlign = 'right';
        ctx.fillText(payload.title, rightEdge - 14, y + barH * 0.65);
        if (payload.periodText) {
          ctx.textAlign = 'left';
          ctx.fillStyle = elemColor('partyMetadata', '#E2E8F0');
          ctx.font = `${elemWeight('partyMetadata', '700')} ${ptPx(typoPt.partyMetadata)}px ${canvasFont}`;
          ctx.fillText(payload.periodText, marginLeftPx + 14, y + barH * 0.65);
        }
        y += barH + 14;
      } else {
        const hdrH = mmPx(plan.headerFullHeightMm) - 8;
        ctx.textAlign = 'center';
        ctx.fillStyle = elemColor('companyName', primaryColor);
        ctx.font = `${elemWeight('companyName', '800')} ${ptPx(typoPt.companyName)}px ${canvasFont}`;
        ctx.fillText(company.nameAr || 'المنصور للأنظمة المالية', logicalW / 2, y + ptPx(typoPt.companyName) + 2);

        if (activeTpl.showCompanyDetails) {
          ctx.fillStyle = elemColor('companyDetails', '#475569');
          ctx.font = `${elemWeight('companyDetails', '600')} ${ptPx(typoPt.companyDetails)}px ${canvasFont}`;
          const subParts = [
            branch?.nameAr,
            company.commercialRecord ? `س.ت: ${company.commercialRecord}` : '',
            company.address,
            company.phone ? `هاتف: ${company.phone}` : '',
          ].filter(Boolean);
          ctx.fillText(
            subParts.join(' · '),
            logicalW / 2,
            y + ptPx(typoPt.companyName) + ptPx(typoPt.companyDetails) + 12
          );
        }

        const bannerY = y + Math.max(46, hdrH - 42);
        const bannerH = Math.max(36, ptPx(typoPt.documentTitle) * 1.8 + 8);
        ctx.fillStyle = primaryColor;
        ctx.fillRect(marginLeftPx, bannerY, innerW, bannerH);
        ctx.fillStyle = accentColor;
        ctx.fillRect(marginLeftPx, bannerY + bannerH, innerW, 3);

        ctx.fillStyle = elemColor('documentTitle', tableHeaderText);
        ctx.font = `${elemWeight('documentTitle', '800')} ${ptPx(typoPt.documentTitle)}px ${canvasFont}`;
        ctx.textAlign = 'right';
        ctx.fillText(payload.title, rightEdge - 14, bannerY + bannerH * 0.65);
        if (payload.periodText) {
          ctx.fillStyle = '#E2E8F0';
          ctx.textAlign = 'left';
          ctx.font = `${elemWeight('partyMetadata', '700')} ${ptPx(typoPt.partyMetadata)}px ${canvasFont}`;
          ctx.fillText(payload.periodText, marginLeftPx + 14, bannerY + bannerH * 0.65);
        }
        y = bannerY + bannerH + 14;
      }
    } else if (page.headerKind === 'continuation') {
      const stripH = Math.max(30, mmPx(plan.continuationStripHeightMm) - 6);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(marginLeftPx, y, innerW, stripH);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(marginLeftPx, y, innerW, stripH);
      ctx.fillStyle = elemColor('sectionHeadings', primaryColor);
      ctx.font = `${elemWeight('sectionHeadings', '800')} ${ptPx(typoPt.sectionHeadings)}px ${canvasFont}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${payload.title} — تابع`, rightEdge - 14, y + stripH * 0.68);
      ctx.fillStyle = elemColor('pageNumbers', '#475569');
      ctx.font = `${elemWeight('pageNumbers', '700')} ${ptPx(typoPt.pageNumbers)}px ${canvasFont}`;
      ctx.textAlign = 'left';
      ctx.fillText(`صفحة ${page.pageNumber} من ${totalPages}`, marginLeftPx + 14, y + stripH * 0.68);
      y += stripH + 10;
    }

    // 2. Render Blocks
    for (const block of page.blocks) {
      if (block.kind === 'metadata') {
        const metaRows = Math.ceil(block.entries.length / 2);
        const rowH = Math.max(24, ptPx(typoPt.partyMetadata) * 1.65);
        const boxH = metaRows * rowH + 12;
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(marginLeftPx, y, innerW, boxH);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(marginLeftPx, y, innerW, boxH);

        block.entries.forEach(([k, v], idx) => {
          const r = Math.floor(idx / 2);
          const isRightCol = idx % 2 === 0;
          const cellX = isRightCol ? rightEdge - 12 : logicalW / 2 - 12;
          const cellY = y + rowH * 0.72 + r * rowH;
          ctx.textAlign = 'right';
          ctx.fillStyle = '#475569';
          ctx.font = `700 ${ptPx(typoPt.partyMetadata)}px ${canvasFont}`;
          const labelTxt = `${k.replace(/_/g, ' ')}: `;
          ctx.fillText(labelTxt, cellX, cellY);
          const labelW = ctx.measureText(labelTxt).width;
          ctx.fillStyle = elemColor('partyMetadata', primaryColor);
          ctx.font = `${elemWeight('partyMetadata', '800')} ${ptPx(typoPt.partyMetadata)}px ${canvasFont}`;
          ctx.fillText(String(v), cellX - labelW - 4, cellY, innerW / 2 - labelW - 22);
        });
        y += boxH + 14;
      } else if (block.kind === 'table-chunk') {
        if (block.isFirstChunk && block.title) {
          y += mmPx(pagination.headingSpacingBeforeMm);
          ctx.textAlign = 'right';
          ctx.fillStyle = elemColor('sectionHeadings', primaryColor);
          ctx.font = `${elemWeight('sectionHeadings', '800')} ${ptPx(typoPt.sectionHeadings)}px ${canvasFont}`;
          ctx.fillText(block.title, rightEdge, y + ptPx(typoPt.sectionHeadings) + 2);
          y += ptPx(typoPt.sectionHeadings) + 8 + mmPx(pagination.headingSpacingAfterMm);
        }

        const colWidthsPx = block.colWidthsMm.map((w) => (w / plan.contentWidthMm) * innerW);

        if (block.showTableHeader) {
          const hh = Math.max(32, mmPx(block.headerHeightMm));
          ctx.fillStyle = tableHeaderBg;
          ctx.fillRect(marginLeftPx, y, innerW, hh);
          let curX = rightEdge;
          ctx.font = `${elemWeight('tableHeaders', '800')} ${ptPx(typoPt.tableHeaders)}px ${canvasFont}`;
          block.headers.forEach((h, cIdx) => {
            const cw = colWidthsPx[cIdx];
            curX -= cw;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.strokeRect(curX, y, cw, hh);
            ctx.fillStyle = elemColor('tableHeaders', tableHeaderText);
            ctx.textAlign = 'center';
            ctx.fillText(String(h), curX + cw / 2, y + hh * 0.65, cw - 8);
          });
          y += hh;
        }

        if (block.isEmptyTable) {
          const eh = 36;
          ctx.fillStyle = '#F8FAFC';
          ctx.fillRect(marginLeftPx, y, innerW, eh);
          ctx.strokeStyle = borderColor;
          ctx.strokeRect(marginLeftPx, y, innerW, eh);
          ctx.fillStyle = '#64748B';
          ctx.textAlign = 'center';
          ctx.font = `700 ${ptPx(typoPt.tableCells)}px ${canvasFont}`;
          ctx.fillText('لا توجد بيانات', logicalW / 2, y + 23);
          y += eh;
        } else {
          for (const row of block.rows) {
            const rh = Math.max(26, mmPx(row.heightMm));
            ctx.fillStyle = row.originalIndex % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
            ctx.fillRect(marginLeftPx, y, innerW, rh);
            let rx = rightEdge;
            row.wrappedCells.forEach((lines, cIdx) => {
              const cw = colWidthsPx[cIdx];
              rx -= cw;
              ctx.strokeStyle = borderColor;
              ctx.lineWidth = 1;
              ctx.strokeRect(rx, y, cw, rh);
              const isPrice = Boolean(row.isPriceCol?.[cIdx]);
              const isNum = row.isNumericCol[cIdx];
              const fontPx = ptPx(
                isPrice ? typoPt.priceValues : isNum ? typoPt.numericValues : typoPt.tableCells
              );
              const weightStr = isPrice
                ? elemWeight('priceValues', '800')
                : isNum
                ? elemWeight('numericValues', '700')
                : elemWeight('tableCells', '600');
              const cellFill = isPrice
                ? elemColor('priceValues', '#0F172A')
                : isNum
                ? elemColor('numericValues', '#0F172A')
                : elemColor('tableCells', '#0F172A');
              const lineStep = fontPx * 1.38;
              ctx.font = `${weightStr} ${fontPx}px ${canvasFont}`;
              ctx.fillStyle = cellFill;
              ctx.textAlign = 'center';
              lines.forEach((ln, lIdx) => {
                ctx.fillText(ln, rx + cw / 2, y + fontPx + 5 + lIdx * lineStep, cw - 10);
              });
            });
            y += rh;
          }
        }

        if (block.totals) {
          const th = Math.max(32, mmPx(block.totals.heightMm));
          ctx.fillStyle = '#FEF3C7';
          ctx.fillRect(marginLeftPx, y, innerW, th);
          let tx = rightEdge;
          ctx.font = `${elemWeight('totalsAndSummary', '800')} ${ptPx(typoPt.totalsAndSummary)}px ${canvasFont}`;
          block.totals.rawCells.forEach((tot, cIdx) => {
            const cw = colWidthsPx[cIdx] || 80;
            tx -= cw;
            ctx.strokeStyle = accentColor;
            ctx.strokeRect(tx, y, cw, th);
            ctx.fillStyle = elemColor('totalsAndSummary', '#78350F');
            ctx.textAlign = 'center';
            ctx.fillText(String(tot ?? ''), tx + cw / 2, y + th * 0.65, cw - 8);
          });
          y += th;
        }

        if (block.isFinalChunk) {
          y += mmPx(pagination.tableSpacingMm);
        }
      } else if (block.kind === 'summary-cards') {
        const gap = 12;
        const cols = 3;
        const cardW = (innerW - gap * (cols - 1)) / cols;
        const hasSub = block.cards.some((c) => Boolean(c.subValue) || (c.value || '').includes(' | '));
        const cardH = Math.max(hasSub ? 74 : 56, mmPx(14));
        const rowStepY = cardH + 10;
        block.cards.forEach((card, idx) => {
          const r = Math.floor(idx / cols);
          const c = idx % cols;
          const cx = rightEdge - (c + 1) * cardW - c * gap;
          const cy = y + r * rowStepY;
          ctx.fillStyle = '#F8FAFC';
          ctx.fillRect(cx, cy, cardW, cardH);
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 1;
          ctx.strokeRect(cx, cy, cardW, cardH);
          ctx.textAlign = 'right';
          ctx.fillStyle = '#475569';
          ctx.font = `700 ${ptPx(typoPt.notes)}px ${canvasFont}`;
          ctx.fillText(card.label, cx + cardW - 12, cy + 20, cardW - 24);

          const parts =
            !card.subValue && (card.value || '').includes(' | ')
              ? card.value.split(' | ').map((x) => x.trim()).filter(Boolean)
              : [card.value, ...(card.subValue ? [card.subValue] : [])];

          ctx.fillStyle = elemColor('finalAmounts', primaryColor);
          ctx.font = `${elemWeight('finalAmounts', '900')} ${ptPx(typoPt.finalAmounts)}px ${canvasFont}`;
          ctx.fillText(isolateLtr(parts[0] || ''), cx + cardW - 12, cy + 44, cardW - 24);
          if (parts[1]) {
            ctx.fillStyle = '#334155';
            ctx.font = `700 ${ptPx(typoPt.notes)}px ${canvasFont}`;
            ctx.fillText(isolateLtr(parts[1]), cx + cardW - 12, cy + 64, cardW - 24);
          }
        });
        y += Math.ceil(block.cards.length / cols) * rowStepY + 8;
      } else if (block.kind === 'notes') {
        const noteLines = wrapTextToWidthMm(
          `ملاحظات: ${block.text}`,
          plan.contentWidthMm - 8,
          typoPt.notes,
          false,
          measurePxMm
        );
        const lineH = ptPx(typoPt.notes) * 1.45;
        const boxH = Math.max(36, noteLines.length * lineH + 14);
        ctx.fillStyle = '#F0FDF4';
        ctx.fillRect(marginLeftPx, y, innerW, boxH);
        ctx.strokeStyle = '#86EFAC';
        ctx.strokeRect(marginLeftPx, y, innerW, boxH);
        ctx.textAlign = 'right';
        ctx.fillStyle = elemColor('notes', '#166534');
        ctx.font = `${elemWeight('notes', '700')} ${ptPx(typoPt.notes)}px ${canvasFont}`;
        noteLines.forEach((ln, idx) => {
          ctx.fillText(ln, rightEdge - 12, y + 20 + idx * lineH, innerW - 24);
        });
        y += boxH + 12;
      } else if (block.kind === 'signatures' && block.showSignatures) {
        const sigW = (innerW - 24) / 3;
        const sigH = 66;
        const labels = block.signatureLabels || ['إعداد / المحاسب', 'المراجعة والتدقيق', 'اعتماد الإدارة'];
        const names = [block.preparedBy || 'المحاسب المالي', 'رئيس الحسابات', 'المدير العام'];
        for (let idx = 0; idx < 3; idx++) {
          const sx = rightEdge - (idx + 1) * sigW - idx * 12;
          ctx.strokeStyle = borderColor;
          ctx.strokeRect(sx, y, sigW, sigH);
          ctx.textAlign = 'center';
          ctx.fillStyle = elemColor('signatures', '#475569');
          ctx.font = `${elemWeight('signatures', '700')} ${ptPx(typoPt.signatures)}px ${canvasFont}`;
          ctx.fillText(labels[idx] || '', sx + sigW / 2, y + 22);
          ctx.fillStyle = elemColor('signatures', primaryColor);
          ctx.fillText(names[idx], sx + sigW / 2, y + 52);
        }
        y += sigH + 12;
      }
    }

    // 3. Footer & Page Number
    if (activeTpl.showFooter || activeTpl.showPageNumbers) {
      const footY = logicalH - Math.max(18, marginBottomPx * 0.45);
      ctx.strokeStyle = borderColor;
      ctx.beginPath();
      ctx.moveTo(marginLeftPx, footY - 18);
      ctx.lineTo(rightEdge, footY - 18);
      ctx.stroke();

      if (activeTpl.showFooter) {
        ctx.fillStyle = elemColor('footer', '#64748B');
        ctx.font = `${elemWeight('footer', '700')} ${ptPx(typoPt.footer)}px ${canvasFont}`;
        ctx.textAlign = 'right';
        ctx.fillText(
          `${activeTpl.footerText?.trim() || company.invoiceFooterNote || 'شكراً لتعاملكم معنا - نظام المنصور للإدارة المالية الذكية'} · ${new Date().toLocaleDateString('ar-YE')}`,
          rightEdge,
          footY
        );
      }
      if (activeTpl.showPageNumbers) {
        ctx.fillStyle = elemColor('pageNumbers', primaryColor);
        ctx.font = `${elemWeight('pageNumbers', '800')} ${ptPx(typoPt.pageNumbers)}px ${canvasFont}`;
        ctx.textAlign = 'left';
        ctx.fillText(`صفحة ${page.pageNumber} من ${totalPages}`, marginLeftPx, footY);
      }
    }

    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('تعذر تحويل الصورة.'))), 'image/png', 1.0);
    });

    const fileName =
      totalPages === 1
        ? `${safeBaseTitle}.png`
        : `${safeBaseTitle}_صفحة_${page.pageNumber}_من_${totalPages}.png`;

    assets.push({
      pageNumber: page.pageNumber,
      totalPages,
      blob,
      dataUrl,
      fileName,
      widthPx: canvas.width,
      heightPx: canvas.height,
    });
  }

  return assets;
}

/**
 * Downloads all crisp PNG pages sequentially so long reports preserve full 2480px print-grade clarity.
 */
export function downloadPngPages(pages: PngPageAsset[]): void {
  pages.forEach((p, idx) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = p.dataUrl;
      a.download = p.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }, idx * 240);
  });
}

/**
 * Renders any UniversalPreviewPayload onto crisp 2480px-wide paginated PNG(s) (returns page 1 + full pages list).
 */
export async function renderPayloadToPng(
  payload: UniversalPreviewPayload,
  company: Company,
  branch?: Branch,
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>
): Promise<RenderedPngResult> {
  const pages = await renderPayloadToPngPages(payload, company, branch, printTemplates);
  const first = pages[0];
  return {
    blob: first.blob,
    dataUrl: first.dataUrl,
    fileName: first.fileName,
    pages,
  };
}

/**
 * Generates an in-memory PDF Blob for any UniversalPreviewPayload (for WhatsApp Web Share / Download).
 */
export async function buildPayloadPdfBlob(
  payload: UniversalPreviewPayload,
  company: Company,
  branch?: Branch,
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>
): Promise<{ blob: Blob; fileName: string }> {
  let bytes: Uint8Array;
  let fileName: string;

  if (payload.invoiceObj) {
    bytes = await buildInvoicePdfBytes(
      payload.invoiceObj,
      company,
      branch,
      payload.warehouseName,
      payload.printTemplate || printTemplates?.invoice
    );
    fileName = `فاتورة_${payload.invoiceObj.invoiceNumber}.pdf`;
  } else if (payload.voucherObj) {
    bytes = await buildVoucherPdfBytes(
      payload.voucherObj,
      company,
      branch,
      payload.printTemplate || printTemplates?.voucher
    );
    const pfx = payload.voucherObj.type === 'قبض' ? 'سند_قبض' : 'سند_صرف';
    fileName = `${pfx}_${payload.voucherObj.voucherNumber}.pdf`;
  } else {
    const inferredDocType = inferPrintDocType(payload.title, payload.docType);
    const opts: ReportPDFOptions = {
      docType: inferredDocType,
      printTemplate: payload.printTemplate,
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
    };
    bytes = await buildReportPdfBytes(opts);
    const safeTitle = payload.title.replace(/[^\u0600-\u06FFa-zA-Z0-9_-]+/g, '_').slice(0, 48);
    fileName = `${safeTitle || 'report'}.pdf`;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    blob: new Blob([copy.buffer], { type: 'application/pdf' }),
    fileName,
  };
}
