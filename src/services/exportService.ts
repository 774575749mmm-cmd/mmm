/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Central Unified Export & Print Document Engine
 * Single Source of Truth for Preview (srcdoc), Browser Print (A4/A3/Letter/Custom & Batch),
 * Binary PDF (Cairo TTF + Arabic Reshaper + BiDi), Excel (.xlsx), CSV (UTF-8 BOM) & WhatsApp.
 * Consumes the shared Intelligent Pagination & 12-Element Typography Engine (`buildDocumentPaginationPlan`)
 * so HTML Preview, Browser Print, PDF, and PNG maintain identical pagination, wrapping, and font hierarchy.
 */

import * as XLSX from 'xlsx';
import {
  Company,
  Branch,
  Invoice,
  PaymentVoucher,
  PrintDocumentType,
  PrintTemplateConfig,
} from '../types/erp';
import {
  setActivePrintTemplates,
  getActivePrintTemplates,
  inferPrintDocType,
  resolveEffectivePrintTemplate,
  resolveEffectiveTypography,
  resolveEffectivePagination,
  toCssFontSize,
  applyTemplateColumnVisibility,
} from './printTemplateResolver';
import {
  buildReportPdfBytes,
  buildBatchReportPdfBytes,
  buildInvoicePdfBytes,
  buildVoucherPdfBytes,
} from './arabicPdfHelper';
import {
  buildDocumentPaginationPlan,
  ComputedTableChunkBlock,
  PageContentBlock,
  PaginatedDocumentPlan,
} from './documentPaginationEngine';

export {
  setActivePrintTemplates,
  getActivePrintTemplates,
  inferPrintDocType,
  resolveEffectivePrintTemplate,
  resolveEffectiveTypography,
  resolveEffectivePagination,
  toCssFontSize,
  applyTemplateColumnVisibility,
  buildReportPdfBytes,
  buildBatchReportPdfBytes,
  buildDocumentPaginationPlan,
};
export type { PaginatedDocumentPlan };

export interface SummaryCardDef {
  label: string;
  value: string;
  subValue?: string;
  tone?: 'gold' | 'green' | 'red' | 'blue';
}

export interface ExportTableDef {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
  alignments?: ('right' | 'center' | 'left')[];
}

export interface ReportPDFOptions {
  title: string;
  subtitle?: string;
  reportCode?: string;
  periodText?: string;
  metadata?: Record<string, string>;
  tables: ExportTableDef[];
  summaryCards?: SummaryCardDef[];
  company?: Company;
  branch?: Branch;
  preparedBy?: string;
  notes?: string;
  fileName?: string;
  lang?: 'ar' | 'en';
  docType?: PrintDocumentType;
  printTemplate?: PrintTemplateConfig;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
  forPreview?: boolean;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strictly validates and sanitizes image URLs / data URIs before HTML attribute interpolation.
 * Blocks javascript:, data:text/html, data:image/svg+xml, embedded quotes, and event handler breakouts.
 */
export function sanitizeImageSrc(src?: string): string {
  if (!src || typeof src !== 'string') return '';
  const cleaned = src.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!cleaned) return '';
  if (/["'<>\\]/.test(cleaned)) return '';

  // Allow strictly safe raster base64 image data URIs (no SVG or HTML)
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(cleaned)) {
    return cleaned;
  }

  // Allow relative local paths (not protocol-relative //)
  if (/^\/(?!\/)[A-Za-z0-9._\-\/]+$/.test(cleaned)) {
    return cleaned;
  }

  // Allow validated https:// URLs only
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Reject invalid URLs or non-https schemes (javascript:, vbscript:, file:, etc.)
  }
  return '';
}

/**
 * Clean & format Arabic numbers or financial figures
 */
export function formatCurrencyValue(val: number, currency: string = 'YER'): string {
  return `${Number(val || 0).toLocaleString('ar-YE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function triggerBinaryDownload(bytes: Uint8Array, mimeType: string, fileName: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Verifies PDF binary signature (%PDF- ... %%EOF)
 */
export function verifyPdfSignature(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 100) return false;
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  const tailSlice = bytes.slice(Math.max(0, bytes.length - 64));
  const tail = String.fromCharCode(...tailSlice);
  return header === '%PDF-' && tail.includes('%%EOF');
}

/**
 * Export structured data to a genuine Excel workbook (.xlsx)
 */
export function exportToExcel(options: {
  fileName: string;
  sheets: {
    name: string;
    data: (string | number)[][];
    columnWidths?: number[];
  }[];
}): void {
  const wb = XLSX.utils.book_new();

  options.sheets.forEach((sheetDef) => {
    const ws = XLSX.utils.aoa_to_sheet(sheetDef.data);

    if (sheetDef.columnWidths && sheetDef.columnWidths.length > 0) {
      ws['!cols'] = sheetDef.columnWidths.map((w) => ({ wch: w }));
    } else {
      const maxCols = Math.max(...sheetDef.data.map((row) => row.length), 1);
      ws['!cols'] = Array(maxCols).fill({ wch: 18 });
    }

    if (!ws['!views']) ws['!views'] = [];
    ws['!views'].push({ rightToLeft: true });

    const safeSheetName = (sheetDef.name || 'Sheet1').replace(/[*?:/\\[\]]/g, '').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
  });

  const fileBase = options.fileName.endsWith('.xlsx') ? options.fileName : `${options.fileName}.xlsx`;
  XLSX.writeFile(wb, fileBase);
}

/**
 * Export data to UTF-8 CSV with BOM & formula-injection protection for seamless opening in Excel
 */
export function exportToCSV(fileName: string, headers: string[], rows: (string | number)[][]): void {
  const sanitize = (cell: string | number | undefined | null) => {
    if (cell === undefined || cell === null) return '""';
    if (typeof cell === 'number') {
      return `"${Number.isFinite(cell) ? cell : 0}"`;
    }
    let raw = String(cell);
    const trimmed = raw.trimStart();
    if (/^[=+\-@\t\r]/.test(trimmed) && !/^-\d+(\.\d+)?$/.test(trimmed)) {
      raw = `'${raw}`;
    }
    const str = raw.replace(/"/g, '""');
    return `"${str}"`;
  };

  const headerLine = headers.map(sanitize).join(',');
  const rowLines = rows.map((row) => row.map(sanitize).join(','));
  const csvContent = '\uFEFF' + [headerLine, ...rowLines].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const safeName = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  link.setAttribute('download', safeName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getOriginPrefix(): string {
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.origin !== 'null' &&
    !window.location.origin.startsWith('file:')
  ) {
    return window.location.origin;
  }
  return '';
}

function buildFontFaceAndImportsCss(): string {
  const origin = getOriginPrefix();
  return `
    @font-face {
      font-family: 'Cairo';
      src: url('${origin}/fonts/Cairo.ttf') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'DejaVu';
      src: url('${origin}/fonts/DejaVuSans.ttf') format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'DejaVu';
      src: url('${origin}/fonts/DejaVuSans-Bold.ttf') format('truetype');
      font-weight: 700 900;
      font-style: normal;
      font-display: swap;
    }
  `;
}

function resolveFontStack(fontFamily?: PrintTemplateConfig['fontFamily']): string {
  if (fontFamily === 'DejaVu') {
    return `'DejaVu', 'Cairo', 'Segoe UI', Tahoma, sans-serif`;
  }
  if (fontFamily === 'Tajawal') {
    return `'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif`;
  }
  return `'Cairo', 'Segoe UI', Tahoma, sans-serif`;
}

interface RenderedDocFragment {
  plan: PaginatedDocumentPlan;
  tpl: PrintTemplateConfig;
  lang: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  effectiveOrientation: 'portrait' | 'landscape';
  pageSizeCss: string;
  paperWidthMm: number;
  paperHeightMm: number;
  fontStack: string;
  baseFontCss: string;
  scopedCss: string;
  bodyHtml: string;
}

function formatHtmlCell(raw: string | number | undefined | null): string {
  if (raw === undefined || raw === null || raw === '') return '-';
  const s = String(raw);
  if (s.includes(' | ')) {
    return s
      .split(' | ')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<div style="line-height:1.35;"><bdi dir="auto">${escapeHtml(p)}</bdi></div>`)
      .join('');
  }
  return `<bdi dir="auto">${escapeHtml(s)}</bdi>`;
}

function renderTableChunkHtml(
  chunk: ComputedTableChunkBlock,
  contentWidthMm: number,
  isEn: boolean
): string {
  const titleHtml =
    chunk.isFirstChunk && chunk.title
      ? `<h3 class="table-title">${escapeHtml(chunk.title)}</h3>`
      : '';

  const colGroupHtml = `<colgroup>${chunk.colWidthsMm
    .map((w) => {
      const pct = ((w / Math.max(contentWidthMm, 1)) * 100).toFixed(2);
      return `<col style="width:${pct}%;" />`;
    })
    .join('')}</colgroup>`;

  const theadHtml = chunk.showTableHeader
    ? `<thead><tr>${chunk.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
    : '';

  let tbodyHtml = '';
  if (chunk.isEmptyTable) {
    tbodyHtml = `<tbody><tr><td colspan="${Math.max(
      chunk.headers.length,
      1
    )}" class="cell-text" style="text-align:center;font-weight:700;padding:12px;">${
      isEn ? 'No data available' : 'لا توجد بيانات'
    }</td></tr></tbody>`;
  } else {
    tbodyHtml = `<tbody>${chunk.rows
      .map(
        (row) =>
          `<tr class="${row.originalIndex % 2 === 1 ? 'even-row' : ''}">${row.rawCells
            .map((cell, cIdx) => {
              const align = row.alignments[cIdx] || 'center';
              const cellClass = row.isPriceCol[cIdx]
                ? 'cell-price'
                : row.isNumericCol[cIdx]
                ? 'cell-num'
                : 'cell-text';
              return `<td class="${cellClass}" style="text-align:${align};">${formatHtmlCell(cell)}</td>`;
            })
            .join('')}</tr>`
      )
      .join('')}</tbody>`;
  }

  const tfootHtml = chunk.totals
    ? `<tfoot><tr class="totals-row">${chunk.totals.rawCells
        .map((tot, cIdx) => {
          const align = chunk.totals!.alignments[cIdx] || (isEn ? 'right' : 'left');
          return `<td style="text-align:${align};font-weight:bold;">${formatHtmlCell(tot)}</td>`;
        })
        .join('')}</tr></tfoot>`
    : '';

  return `
    <div class="table-container ${chunk.isFirstChunk ? 'table-first-chunk' : 'table-cont-chunk'}">
      ${titleHtml}
      <table class="report-table">
        ${colGroupHtml}
        ${theadHtml}
        ${tbodyHtml}
        ${tfootHtml}
      </table>
    </div>
  `;
}

function renderDocumentFragment(options: ReportPDFOptions, scopeClass: string): RenderedDocFragment {
  const plan = buildDocumentPaginationPlan(options);
  const { tpl, typo, pagination, lang, dir, orientation, pageWidthMm, pageHeightMm, cssPageSize } =
    plan;
  const isEn = lang === 'en';
  const fontStack = resolveFontStack(tpl.fontFamily);
  const unit = typo.unit;

  const sizeCompanyName = toCssFontSize(typo.companyName, unit);
  const sizeDocTitle = toCssFontSize(typo.documentTitle, unit);
  const sizeSectionHead = toCssFontSize(typo.sectionHeadings, unit);
  const sizeCompanyDetails = toCssFontSize(typo.companyDetails, unit);
  const sizePartyMeta = toCssFontSize(typo.partyMetadata, unit);
  const sizeTableHeader = toCssFontSize(typo.tableHeaders, unit);
  const sizeTableCell = toCssFontSize(typo.tableCells, unit);
  const sizeNumericVal = toCssFontSize(typo.numericValues, unit);
  const sizePriceVal = toCssFontSize(typo.priceValues, unit);
  const sizeTotalsSummary = toCssFontSize(typo.totalsAndSummary, unit);
  const sizeFinalAmounts = toCssFontSize(typo.finalAmounts, unit);
  const sizeNotes = toCssFontSize(typo.notes, unit);
  const sizeSignatures = toCssFontSize(typo.signatures, unit);
  const sizeFooter = toCssFontSize(typo.footer, unit);
  const sizePageNumbers = toCssFontSize(typo.pageNumbers, unit);

  const compName = escapeHtml(options.company?.nameAr || 'المنصور للأنظمة المالية والإدارية الذكية');
  const compNameEn = options.company?.nameEn ? escapeHtml(options.company.nameEn) : '';
  const branchName = escapeHtml(options.branch?.nameAr || (isEn ? 'Main Branch' : 'الفرع الرئيسي'));
  const cr = options.company?.commercialRecord
    ? `${isEn ? 'CR' : 'س.ت'}: ${escapeHtml(options.company.commercialRecord)}`
    : '';
  const tax = options.company?.taxNumber
    ? `${isEn ? 'Tax ID' : 'ر.ض'}: ${escapeHtml(options.company.taxNumber)}`
    : '';
  const phone = options.company?.phone
    ? `${isEn ? 'Tel' : 'هاتف'}: ${escapeHtml(options.company.phone)}`
    : '';
  const address = options.company?.address ? escapeHtml(options.company.address) : '';
  const now = new Date();
  const locale = isEn ? 'en-US' : 'ar-YE';
  const printDate = escapeHtml(
    now.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
  );
  const printTime = escapeHtml(
    now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  );

  const safeColor = (c: string | undefined, fallback: string) =>
    c && /^#[0-9a-fA-F]{3,8}$/.test(c.trim()) ? c.trim() : fallback;

  const primaryColor = safeColor(tpl.primaryColor, '#0f172a');
  const accentColor = safeColor(tpl.accentColor, '#d97706');
  const tableHeaderBg = safeColor(tpl.tableHeaderBg, '#0f172a');
  const tableHeaderText = safeColor(tpl.tableHeaderText, '#fbbf24');
  const borderColor = safeColor(tpl.borderColor, '#cbd5e1');
  const borderWidth = Math.max(0, Math.min(4, Number(tpl.borderWidthPx) || 1));

  const typoColor = (key: import('../types/erp').TypographyElementKey, fallback: string) =>
    safeColor(typo.colors?.[key], fallback);
  const typoWeight = (key: import('../types/erp').TypographyElementKey, boldVal = '700') =>
    typo.weights?.[key] === 'normal' ? '400' : typo.weights?.[key] === 'bold' ? boldVal : boldVal;

  const borderSide = isEn ? 'left' : 'right';
  const badgeAlign = isEn ? 'right' : 'left';
  const thAlign = isEn ? 'left' : 'right';
  const preparedBySafe = escapeHtml(
    options.preparedBy || (isEn ? 'Financial Accountant' : 'المحاسب المالي')
  );
  const footerNoteText = escapeHtml(
    tpl.footerText?.trim() || options.company?.invoiceFooterNote || 'ALMANSOOR SMART FINANCE ERP'
  );

  // Banner vs corporate logo/name strictly mutually exclusive so header NEVER duplicates!
  const safeBannerSrc = sanitizeImageSrc(options.company?.bannerBase64);
  const safeLogoSrc = sanitizeImageSrc(options.company?.logoUrl);
  const hasBanner = Boolean(
    tpl.useCustomBanner && options.company?.useFullBanner && safeBannerSrc
  );
  const hasLogo = Boolean(tpl.showLogo && safeLogoSrc);
  const logoHtml = hasLogo
    ? `<img src="${escapeHtml(safeLogoSrc)}" alt="${compName}" class="company-logo" style="max-height:${
        tpl.logoSizePx
      }px;max-width:${tpl.logoSizePx * 2}px;object-fit:contain;" />`
    : '';

  const fullHeaderHtml = !tpl.showHeader
    ? `<div class="doc-title-banner no-break">
         <div>
           <h2>${escapeHtml(options.title)}</h2>
           ${options.subtitle ? `<div class="banner-sub">${escapeHtml(options.subtitle)}</div>` : ''}
         </div>
         <div style="text-align:${badgeAlign};">
           ${options.periodText ? `<div class="banner-period">${escapeHtml(options.periodText)}</div>` : ''}
           ${options.reportCode ? `<div class="code">${escapeHtml(options.reportCode)}</div>` : ''}
         </div>
       </div>`
    : hasBanner
    ? `<div class="header-banner-wrap no-break">
         <img src="${escapeHtml(safeBannerSrc)}" alt="${compName}" class="full-banner-img" />
         <div class="doc-title-banner">
           <div>
             <h2>${escapeHtml(options.title)}</h2>
             ${options.subtitle ? `<div class="banner-sub">${escapeHtml(options.subtitle)}</div>` : ''}
           </div>
           <div style="text-align:${badgeAlign};">
             ${
               options.periodText
                 ? `<div class="banner-period">${isEn ? 'Date / Period' : 'التاريخ / الفترة'}: ${escapeHtml(
                     options.periodText
                   )}</div>`
                 : ''
             }
             ${options.reportCode ? `<div class="code">${escapeHtml(options.reportCode)}</div>` : ''}
           </div>
         </div>
       </div>`
    : `<div class="header-section logo-pos-${tpl.logoPosition} no-break">
         <div class="company-info-wrap">
           ${tpl.logoPosition !== 'left' ? logoHtml : ''}
           <div class="company-info">
             <h1>${compName}</h1>
             ${compNameEn ? `<div class="sub-en">${compNameEn}</div>` : ''}
             ${
               tpl.showCompanyDetails
                 ? `<div class="sub">${branchName} ${cr ? '&bull; ' + cr : ''} ${tax ? '&bull; ' + tax : ''}</div>
                    ${
                      address || phone
                        ? `<div class="sub">${[address, phone].filter(Boolean).join(' &bull; ')}</div>`
                        : ''
                    }`
                 : ''
             }
           </div>
           ${tpl.logoPosition === 'left' ? logoHtml : ''}
         </div>
         <div class="report-badge">
           <div class="badge-pill">${escapeHtml(options.title)}</div>
           ${options.subtitle ? `<div class="badge-sub">${escapeHtml(options.subtitle)}</div>` : ''}
           ${
             options.periodText
               ? `<div class="badge-period">${isEn ? 'Period' : 'الفترة'}: ${escapeHtml(
                   options.periodText
                 )}</div>`
               : ''
           }
           ${options.reportCode ? `<div class="code">${escapeHtml(options.reportCode)}</div>` : ''}
         </div>
       </div>`;

  const renderBlockHtml = (block: PageContentBlock): string => {
    if (block.kind === 'metadata') {
      return `<div class="metadata-grid no-break">
        ${block.entries
          .map(
            ([key, val]) =>
              `<div class="meta-item"><span class="meta-label">${escapeHtml(
                key.replace(/_/g, ' ')
              )}:</span> <span class="meta-val"><bdi dir="auto">${escapeHtml(val)}</bdi></span></div>`
          )
          .join('')}
      </div>`;
    }

    if (block.kind === 'table-chunk') {
      return renderTableChunkHtml(block, plan.contentWidthMm, isEn);
    }

    if (block.kind === 'summary-cards') {
      return `<div class="summary-cards-grid no-break">
        ${block.cards
          .map((card) => {
            const legacyParts =
              !card.subValue && (card.value || '').includes(' | ')
                ? card.value
                    .split(' | ')
                    .map((x) => x.trim())
                    .filter(Boolean)
                : null;
            const toneClass = card.tone ? `tone-${card.tone}` : '';
            const body =
              legacyParts && legacyParts.length > 1
                ? legacyParts
                    .map(
                      (p, i) =>
                        `<div class="${i === 0 ? 'sc-val' : 'sc-sub'}"><bdi dir="auto">${escapeHtml(
                          p
                        )}</bdi></div>`
                    )
                    .join('')
                : `<div class="sc-val"><bdi dir="auto">${escapeHtml(card.value)}</bdi></div>${
                    card.subValue
                      ? `<div class="sc-sub"><bdi dir="auto">${escapeHtml(card.subValue)}</bdi></div>`
                      : ''
                  }`;
            return `<div class="summary-card-box ${toneClass}"><div class="sc-label">${escapeHtml(
              card.label
            )}</div>${body}</div>`;
          })
          .join('')}
      </div>`;
    }

    if (block.kind === 'notes') {
      return `<div class="notes-box no-break"><strong>${
        isEn ? 'Notes' : 'ملاحظات'
      }:</strong> <bdi dir="auto">${escapeHtml(block.text)}</bdi></div>`;
    }

    if (block.kind === 'signatures') {
      const sigLabels = block.signatureLabels || ['إعداد / المحاسب', 'مراجعة وتدقيق', 'اعتماد الإدارة'];
      const stampHtml = block.showStamp
        ? `<div class="official-stamp">
             <div class="stamp-ring">
               <div class="stamp-title">${compName}</div>
               <div class="stamp-sub">${isEn ? 'VERIFIED & APPROVED' : 'معتمد ومصدق إلكترونياً'}</div>
             </div>
           </div>`
        : '';

      if (block.showSignatures) {
        return `<div class="signatures-section no-break">
          <div class="sig-box"><div class="sig-role">${escapeHtml(
            sigLabels[0] || 'إعداد / المحاسب'
          )}</div><div class="sig-line">${escapeHtml(block.preparedBy)}</div></div>
          <div class="sig-box"><div class="sig-role">${escapeHtml(
            sigLabels[1] || 'مراجعة وتدقيق'
          )}</div><div class="sig-line">${isEn ? 'Accountant' : 'رئيس الحسابات'}</div></div>
          <div class="sig-box"><div class="sig-role">${escapeHtml(
            sigLabels[2] || 'اعتماد الإدارة'
          )}</div><div class="sig-line">${isEn ? 'Management' : 'المدير العام'}</div></div>
          ${stampHtml}
        </div>`;
      }
      return stampHtml ? `<div class="signatures-section no-break">${stampHtml}</div>` : '';
    }

    return '';
  };

  const totalPages = plan.pages.length;
  const pagesHtml = plan.pages
    .map((page) => {
      const topHtml =
        page.headerKind === 'full'
          ? fullHeaderHtml
          : page.headerKind === 'continuation'
          ? `<div class="continuation-strip">
               <span>${escapeHtml(options.title)} — ${
                 isEn ? 'Continued' : 'تابع'
               }</span>
               ${options.reportCode ? `<span class="code">${escapeHtml(options.reportCode)}</span>` : ''}
             </div>`
          : '';

      const blocksHtml = page.blocks.map(renderBlockHtml).join('\n');

      const footerBarHtml =
        tpl.showFooter || tpl.showPageNumbers
          ? `<div class="footer-bar no-break">
               <div class="footer-meta">${
                 tpl.showFooter ? `${footerNoteText} &bull; ${preparedBySafe} &bull; ${printDate} ${printTime}` : ''
               }</div>
               ${
                 tpl.showPageNumbers
                   ? `<div class="page-number-badge">${
                       isEn
                         ? `Page ${page.pageNumber} of ${totalPages}`
                         : `صفحة ${page.pageNumber} من ${totalPages}`
                     }</div>`
                   : ''
               }
             </div>`
          : '';

      return `<section class="doc-page" data-page="${page.pageNumber}" data-total-pages="${totalPages}">
        <div class="doc-page-body">
          ${topHtml}
          ${blocksHtml}
        </div>
        ${footerBarHtml}
      </section>`;
    })
    .join('\n');

  const s = `.${scopeClass}`;
  const previewCardShadow = options.forPreview
    ? 'box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);'
    : 'box-shadow: none;';

  const scopedCss = `
    ${s} {
      direction: ${dir};
      font-family: ${fontStack};
      font-size: ${sizeTableCell};
      color: #0f172a;
      line-height: 1.45;
    }
    ${s} .doc-page {
      width: ${pageWidthMm}mm;
      max-width: 100%;
      min-height: ${pageHeightMm}mm;
      margin: ${options.forPreview ? '0 auto 18px auto' : '0 auto'};
      background: #ffffff;
      border: ${borderWidth}px solid ${borderColor};
      border-radius: ${options.forPreview ? '4px' : '0'};
      ${previewCardShadow}
      padding: ${plan.marginTopMm}mm ${plan.marginRightMm}mm ${plan.marginBottomMm}mm ${plan.marginLeftMm}mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      break-after: page;
      page-break-after: always;
    }
    ${s} .doc-page:last-child {
      margin-bottom: 0;
      break-after: auto;
      page-break-after: auto;
    }
    ${s} .doc-page-body {
      flex: 1 1 auto;
    }
    ${s} .header-section {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
      border-bottom: 3px solid ${accentColor}; padding-bottom: 9px; margin-bottom: 11px;
    }
    ${s} .header-section.logo-pos-center { flex-direction: column; align-items: center; text-align: center; }
    ${s} .company-info-wrap { display: flex; align-items: center; gap: 12px; }
    ${s} .header-section.logo-pos-center .company-info-wrap { flex-direction: column; }
    ${s} .company-info h1 { font-size: ${sizeCompanyName}; font-weight: ${typoWeight('companyName', '800')}; color: ${typoColor('companyName', primaryColor)}; margin-bottom: 2px; line-height: 1.25; }
    ${s} .company-info .sub-en { font-size: ${sizeCompanyDetails}; font-weight: 700; color: ${typoColor('companyDetails', '#64748b')}; margin-bottom: 2px; line-height: 1.3; }
    ${s} .company-info .sub { font-size: ${sizeCompanyDetails}; font-weight: ${typoWeight('companyDetails', '600')}; color: ${typoColor('companyDetails', '#475569')}; line-height: 1.35; }
    ${s} .full-banner-img { width: 100%; max-height: 120px; object-fit: contain; display: block; margin-bottom: 6px; }
    ${s} .doc-title-banner {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 7px 11px; background: ${primaryColor}; color: #ffffff;
      border-bottom: 3px solid ${accentColor}; border-radius: 4px; margin-bottom: 11px;
    }
    ${s} .doc-title-banner h2 { font-size: ${sizeDocTitle}; font-weight: ${typoWeight('documentTitle', '800')}; color: ${typoColor('documentTitle', tableHeaderText)}; line-height: 1.25; }
    ${s} .doc-title-banner .banner-sub { font-size: ${sizeSectionHead}; color: ${typoColor('sectionHeadings', '#e2e8f0')}; }
    ${s} .doc-title-banner .banner-period { font-size: ${sizePartyMeta}; color: ${typoColor('partyMetadata', '#e2e8f0')}; }
    ${s} .report-badge { text-align: ${badgeAlign}; display: flex; flex-direction: column; align-items: ${isEn ? 'flex-end' : 'flex-start'}; }
    ${s} .badge-pill {
      display: inline-block; padding: 4px 11px; border-radius: 5px;
      background: ${primaryColor}; color: ${typoColor('documentTitle', tableHeaderText)}; border-bottom: 2px solid ${accentColor};
      font-size: ${sizeDocTitle}; font-weight: ${typoWeight('documentTitle', '800')}; margin-bottom: 3px; line-height: 1.25;
    }
    ${s} .badge-sub { font-size: ${sizeSectionHead}; color: ${typoColor('sectionHeadings', '#475569')}; font-weight: ${typoWeight('sectionHeadings', '700')}; }
    ${s} .badge-period { font-size: ${sizePartyMeta}; color: ${typoColor('partyMetadata', primaryColor)}; font-weight: ${typoWeight('partyMetadata', '700')}; margin-top: 2px; }
    ${s} .code { font-size: ${sizeCompanyDetails}; color: ${typoColor('companyDetails', '#64748b')}; font-family: monospace; margin-top: 2px; font-weight: 700; }
    ${s} .continuation-strip {
      display: flex; justify-content: space-between; align-items: center;
      padding: 4px 10px; margin-bottom: 8px; border-radius: 4px;
      background: #f8fafc; border: 1px solid ${borderColor}; border-${borderSide}: 3px solid ${accentColor};
      font-size: ${sizeSectionHead}; font-weight: ${typoWeight('sectionHeadings', '800')}; color: ${typoColor('sectionHeadings', primaryColor)};
    }
    ${s} .metadata-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); gap: 6px 14px;
      background: #f8fafc; border: ${borderWidth}px solid ${borderColor}; border-radius: 6px;
      padding: 8px 12px; margin-bottom: 10px;
    }
    ${s} .meta-item { display: flex; gap: 6px; font-size: ${sizePartyMeta}; font-weight: ${typoWeight('partyMetadata', '700')}; align-items: baseline; line-height: 1.4; }
    ${s} .meta-label { color: #64748b; font-weight: 700; white-space: nowrap; }
    ${s} .meta-val { color: ${typoColor('partyMetadata', primaryColor)}; font-weight: ${typoWeight('partyMetadata', '800')}; }
    ${s} .table-container { margin-bottom: ${pagination.tableSpacingMm}mm; }
    ${s} .table-title {
      font-size: ${sizeSectionHead}; font-weight: ${typoWeight('sectionHeadings', '800')}; color: ${typoColor('sectionHeadings', primaryColor)};
      margin-top: ${pagination.headingSpacingBeforeMm}mm;
      margin-bottom: ${pagination.headingSpacingAfterMm}mm;
      padding-${borderSide}: 8px; border-${borderSide}: 4px solid ${accentColor};
      break-after: avoid; page-break-after: avoid;
      line-height: 1.35;
    }
    ${s} .report-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 4px; }
    ${s} .report-table tr { break-inside: avoid; page-break-inside: avoid; }
    ${s} .report-table th {
      background: ${tableHeaderBg}; color: ${typoColor('tableHeaders', tableHeaderText)}; font-weight: ${typoWeight('tableHeaders', '700')};
      font-size: ${sizeTableHeader};
      text-align: ${thAlign}; padding: 5px 6px; border: ${borderWidth}px solid ${borderColor};
      word-wrap: break-word; overflow-wrap: break-word; line-height: 1.35;
    }
    ${s} .report-table td {
      padding: 4.5px 6px; border: ${borderWidth}px solid ${borderColor}; color: ${typoColor('tableCells', '#1e293b')};
      font-size: ${sizeTableCell}; font-weight: ${typoWeight('tableCells', '600')};
      word-wrap: break-word; overflow-wrap: break-word; line-height: 1.38;
    }
    ${s} .report-table td.cell-text {
      font-size: ${sizeTableCell};
      font-weight: ${typoWeight('tableCells', '600')};
      color: ${typoColor('tableCells', '#1e293b')};
    }
    ${s} .report-table td.cell-num {
      font-size: ${sizeNumericVal};
      font-variant-numeric: tabular-nums;
      font-weight: ${typoWeight('numericValues', '700')};
      color: ${typoColor('numericValues', '#0f172a')};
    }
    ${s} .report-table td.cell-price {
      font-size: ${sizePriceVal};
      font-variant-numeric: tabular-nums;
      font-weight: ${typoWeight('priceValues', '700')};
      color: ${typoColor('priceValues', primaryColor)};
    }
    ${s} .report-table tbody tr.even-row { background: #f8fafc; }
    ${s} .report-table tfoot tr.totals-row td {
      background: #fef3c7; font-weight: ${typoWeight('totalsAndSummary', '800')} !important; color: ${typoColor('totalsAndSummary', '#78350f')} !important;
      font-size: ${sizeTotalsSummary} !important;
      font-variant-numeric: tabular-nums;
      border-top: 2px solid ${accentColor}; border-bottom: 2px solid ${accentColor};
    }
    ${s} .summary-cards-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;
      margin-top: 8px; padding-top: 8px; border-top: 2px solid ${primaryColor};
    }
    ${s} .summary-card-box {
      border: ${borderWidth}px solid ${borderColor}; border-radius: 6px; background: #f8fafc;
      padding: 6px 9px; break-inside: avoid; page-break-inside: avoid; font-variant-numeric: tabular-nums;
    }
    ${s} .summary-card-box.tone-green { background: #ecfdf5; border-color: #059669; }
    ${s} .summary-card-box.tone-red { background: #fff1f2; border-color: #e11d48; }
    ${s} .summary-card-box.tone-gold { background: #fffbeb; border-color: #d97706; }
    ${s} .summary-card-box.tone-blue { background: #eff6ff; border-color: #2563eb; }
    ${s} .sc-label { font-size: ${sizeNotes}; color: #475569; font-weight: 700; margin-bottom: 2px; }
    ${s} .sc-val { font-size: ${sizeFinalAmounts}; color: ${typoColor('finalAmounts', primaryColor)}; font-weight: ${typoWeight('finalAmounts', '900')}; line-height: 1.3; }
    ${s} .sc-sub { font-size: ${sizeNotes}; color: #334155; font-weight: 700; margin-top: 2px; border-top: 1px dashed ${borderColor}; padding-top: 2px; }
    ${s} .notes-box {
      margin-top: 8px; padding: 8px 11px; background: #f0fdf4; border: 1px solid #bbf7d0;
      border-radius: 6px; font-size: ${sizeNotes}; font-weight: ${typoWeight('notes', '600')}; color: ${typoColor('notes', '#166534')}; line-height: 1.45;
    }
    ${s} .signatures-section {
      display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px;
      margin-top: 12px; padding-top: 10px; border-top: 1px dashed ${borderColor}; text-align: center;
    }
    ${s} .sig-box { flex: 1 1 140px; border: 1px solid ${borderColor}; border-radius: 6px; padding: 7px; background: #fcfcfd; }
    ${s} .sig-role { font-size: ${sizeSignatures}; font-weight: ${typoWeight('signatures', '700')}; color: ${typoColor('signatures', '#475569')}; margin-bottom: 18px; }
    ${s} .sig-line { border-top: 1px solid #94a3b8; width: 75%; margin: 0 auto; padding-top: 3px; font-size: ${sizeSignatures}; color: ${typoColor('signatures', '#64748b')}; }
    ${s} .official-stamp { display: flex; align-items: center; justify-content: center; }
    ${s} .stamp-ring {
      width: 82px; height: 82px; border-radius: 50%; border: 3px double ${accentColor};
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 5px; transform: rotate(-8deg); background: rgba(254, 243, 199, 0.25);
    }
    ${s} .stamp-title { font-size: 0.7em; font-weight: 900; color: ${primaryColor}; line-height: 1.2; text-align: center; }
    ${s} .stamp-sub { font-size: 0.6em; font-weight: 800; color: ${accentColor}; margin-top: 3px; }
    ${s} .footer-bar {
      margin-top: auto; padding-top: 6px; border-top: 1px solid ${borderColor};
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      font-size: ${sizeFooter}; font-weight: ${typoWeight('footer', '600')}; color: ${typoColor('footer', '#64748b')};
    }
    ${s} .footer-meta { flex: 1 1 auto; }
    ${s} .page-number-badge {
      font-size: ${sizePageNumbers}; font-weight: ${typoWeight('pageNumbers', '800')}; color: ${typoColor('pageNumbers', primaryColor)};
      white-space: nowrap; font-variant-numeric: tabular-nums;
    }
    ${s} .no-break { break-inside: avoid; page-break-inside: avoid; }
    @media print {
      ${s} .doc-page {
        width: ${pageWidthMm}mm !important;
        height: ${(pageHeightMm - 0.5).toFixed(2)}mm !important;
        min-height: 0 !important;
        margin: 0 !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        overflow: hidden !important;
      }
    }
  `;

  return {
    plan,
    tpl,
    lang,
    dir,
    effectiveOrientation: orientation,
    pageSizeCss: cssPageSize,
    paperWidthMm: pageWidthMm,
    paperHeightMm: pageHeightMm,
    fontStack,
    baseFontCss: sizeTableCell,
    scopedCss,
    bodyHtml: `<div class="doc-scope ${scopeClass}" lang="${lang}" dir="${dir}">${pagesHtml}</div>`,
  };
}

/**
 * Generate a standalone, XSS-safe print-ready / preview-ready HTML document.
 * Shared single source of truth for Preview modals (forPreview: true) and Browser Print (forPreview: false).
 */
export function generatePrintableHTML(options: ReportPDFOptions): string {
  const frag = renderDocumentFragment(options, 'doc-scope-0');
  const outerBg = options.forPreview ? '#e2e8f0' : '#ffffff';
  const outerPad = options.forPreview ? '16px' : '0';

  return `<!DOCTYPE html>
<html lang="${frag.lang}" dir="${frag.dir}">
<head>
  <meta charset="UTF-8">
  <title></title>
  <style>
    ${buildFontFaceAndImportsCss()}
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body {
      font-family: ${frag.fontStack};
      direction: ${frag.dir};
      background: ${outerBg};
      color: #0f172a;
      padding: ${outerPad};
      font-size: ${frag.baseFontCss};
    }
    ${frag.scopedCss}
    @page {
      size: ${frag.pageSizeCss};
      margin: 0;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }
    @media print {
      html, body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; }
    }
  </style>
</head>
<body>
  ${frag.bodyHtml}
</body>
</html>`;
}

/**
 * Generates a single unified printable HTML bundle containing N independent documents,
 * each paginated cleanly with isolated styles and zero cross-document bleed.
 */
export function generateBatchPrintableHTML(
  docs: ReportPDFOptions[],
  opts?: { forPreview?: boolean }
): string {
  if (!docs || docs.length === 0) {
    return generatePrintableHTML({
      title: 'دفعة مستندات فارغة',
      tables: [],
      forPreview: opts?.forPreview,
    });
  }
  if (docs.length === 1) {
    return generatePrintableHTML({ ...docs[0], forPreview: opts?.forPreview });
  }

  const fragments = docs.map((d, idx) =>
    renderDocumentFragment({ ...d, forPreview: opts?.forPreview }, `doc-scope-${idx}`)
  );
  const first = fragments[0];
  const outerBg = opts?.forPreview ? '#e2e8f0' : '#ffffff';
  const outerPad = opts?.forPreview ? '16px' : '0';
  const namedPagesCss = fragments
    .map(
      (f, idx) =>
        `@page batch_page_${idx} { size: ${f.pageSizeCss}; margin: 0; } .batch-doc-sheet-${idx} { page: batch_page_${idx}; }`
    )
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="${first.lang}" dir="${first.dir}">
<head>
  <meta charset="UTF-8">
  <title></title>
  <style>
    ${buildFontFaceAndImportsCss()}
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body {
      font-family: ${first.fontStack};
      direction: ${first.dir};
      background: ${outerBg};
      color: #0f172a;
      padding: ${outerPad};
    }
    .batch-doc-sheet {
      margin-bottom: ${opts?.forPreview ? '18px' : '0'};
      break-after: page;
      page-break-after: always;
    }
    .batch-doc-sheet:last-child {
      margin-bottom: 0;
      break-after: auto;
      page-break-after: auto;
    }
    ${fragments.map((f) => f.scopedCss).join('\n    ')}
    @page {
      size: ${first.pageSizeCss};
      margin: 0;
      @top-left { content: none; }
      @top-center { content: none; }
      @top-right { content: none; }
      @bottom-left { content: none; }
      @bottom-center { content: none; }
      @bottom-right { content: none; }
    }
    ${namedPagesCss}
    @media print {
      html, body { background: #ffffff !important; padding: 0 !important; margin: 0 !important; }
      .batch-doc-sheet { margin-bottom: 0 !important; }
    }
  </style>
</head>
<body>
  ${fragments
    .map((f, idx) => `<div class="batch-doc-sheet batch-doc-sheet-${idx}">${f.bodyHtml}</div>`)
    .join('\n  ')}
</body>
</html>`;
}

function printHtmlViaIframe(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !win) {
    if (document.body.contains(iframe)) document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const cleanup = () => {
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 600);
  };

  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      win.onafterprint = cleanup;
      win.focus();
      win.print();
    } finally {
      setTimeout(cleanup, 4000);
    }
  };

  const waitImages = async () => {
    const imgs = Array.from(doc.images || []);
    if (imgs.length === 0) return;
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              if (typeof img.decode === 'function') {
                img.decode().then(() => resolve()).catch(() => resolve());
              } else {
                resolve();
              }
              return;
            }
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
      )
    );
  };

  const fontsReady = (doc as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready;
  const assetsPromise = Promise.all([
    fontsReady && typeof fontsReady.then === 'function' ? fontsReady : Promise.resolve(),
    waitImages(),
  ]);

  Promise.race([assetsPromise, new Promise((r) => setTimeout(r, 1200))]).then(() => {
    setTimeout(triggerPrint, 60);
  });
}

/**
 * Open report in an isolated iframe print preview (iframe-safe, never calls window.open/popups).
 * Strips browser titles/URLs/headers cleanly and awaits font & image readiness before opening print dialog.
 */
export function printReportPreview(options: ReportPDFOptions): void {
  const html = generatePrintableHTML({ ...options, forPreview: false });
  printHtmlViaIframe(html);
}

/**
 * Prints multiple documents sequentially as separated pages in a single browser print job.
 */
export function printBatchDocuments(docs: ReportPDFOptions[]): void {
  const html = generateBatchPrintableHTML(docs, { forPreview: false });
  printHtmlViaIframe(html);
}

/**
 * Generates and downloads a REAL binary .pdf report embedded with Cairo/DejaVu TrueType font.
 */
export async function downloadReportAsPDF(options: ReportPDFOptions): Promise<Uint8Array> {
  const baseName = (
    options.fileName || `${options.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}`
  ).replace(/\.(pdf|html)$/i, '');
  const bytes = await buildReportPdfBytes(options);
  if (typeof document !== 'undefined') {
    triggerBinaryDownload(bytes, 'application/pdf', `${baseName}.pdf`);
  }
  return bytes;
}

/**
 * Generates and downloads a REAL binary .pdf batch containing multiple independent documents.
 */
export async function downloadBatchReportAsPDF(
  docs: ReportPDFOptions[],
  fileName?: string
): Promise<Uint8Array> {
  const baseName = (
    fileName || `دفعة_مستندات_${new Date().toISOString().slice(0, 10)}`
  ).replace(/\.(pdf|html)$/i, '');
  const bytes = await buildBatchReportPdfBytes(docs);
  if (typeof document !== 'undefined') {
    triggerBinaryDownload(bytes, 'application/pdf', `${baseName}.pdf`);
  }
  return bytes;
}

/**
 * Generates and downloads a REAL binary .pdf invoice.
 */
export async function downloadInvoicePDF(
  invoice: Invoice,
  company?: Company,
  branch?: Branch,
  warehouseName?: string,
  printTemplate?: PrintTemplateConfig
): Promise<Uint8Array> {
  const bytes = await buildInvoicePdfBytes(invoice, company, branch, warehouseName, printTemplate);
  if (typeof document !== 'undefined') {
    triggerBinaryDownload(bytes, 'application/pdf', `فاتورة_${invoice.invoiceNumber}.pdf`);
  }
  return bytes;
}

/**
 * Generates and downloads a REAL binary .pdf voucher.
 */
export async function downloadVoucherPDF(
  voucher: PaymentVoucher,
  company?: Company,
  branch?: Branch,
  printTemplate?: PrintTemplateConfig
): Promise<Uint8Array> {
  const bytes = await buildVoucherPdfBytes(voucher, company, branch, printTemplate);
  if (typeof document !== 'undefined') {
    const prefix = voucher.type === 'قبض' ? 'سند_قبض' : 'سند_صرف';
    triggerBinaryDownload(bytes, 'application/pdf', `${prefix}_${voucher.voucherNumber}.pdf`);
  }
  return bytes;
}

/**
 * Triggers instant auto-download of the genuine binary invoice .pdf upon posting
 */
export function triggerAutoDownloadInvoice(
  invoice: Invoice,
  company?: Company,
  branch?: Branch,
  warehouseName?: string,
  printTemplate?: PrintTemplateConfig
): void {
  void downloadInvoicePDF(invoice, company, branch, warehouseName, printTemplate).catch((err) => {
    console.error('Auto PDF download failed:', err);
  });
}

/**
 * Validates & normalizes a WhatsApp phone number to digits-only international format (defaulting local Yemen 7xxxxxxxx numbers to 967).
 */
export function validateWhatsAppPhone(phone: string): { valid: boolean; normalized: string; error?: string } {
  let digits = (phone || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (/^7[0-9]{8}$/.test(digits)) {
    digits = `967${digits}`;
  } else if (/^07[0-9]{8}$/.test(digits)) {
    digits = `967${digits.slice(1)}`;
  }
  if (digits.length < 9 || digits.length > 15) {
    return {
      valid: false,
      normalized: digits,
      error: 'رقم الهاتف غير صالح. يرجى إدخال رقم دولي صحيح (مثل 967770001111).',
    };
  }
  return { valid: true, normalized: digits };
}

/**
 * Replaces template variables cleanly in Arabic WhatsApp messages.
 */
export function renderWhatsAppTemplate(
  template: string,
  vars: Record<string, string | number | undefined>
): string {
  let result = template || '';
  for (const [key, value] of Object.entries(vars)) {
    const safeVal = value === undefined || value === null ? '' : String(value);
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), safeVal);
  }
  return result;
}

/**
 * Generate WhatsApp Web link with formatted message & normalized phone.
 */
export function buildWhatsAppLink(phone: string, text: string): string {
  const { normalized } = validateWhatsAppPhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}
