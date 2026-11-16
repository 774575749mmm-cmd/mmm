/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Unified Intelligent Table & Document Pagination Engine
 * Measures actual wrapped text & element heights using configured per-element typography (pt/px)
 * and enforces rule-driven table placement (Minimum Rows Before Table Break, keep-heading-with-table,
 * short-table cohesion, multi-table sharing, and zero orphan/clipped rows) identically across
 * HTML Preview, Browser Print, Binary PDF, and PNG export.
 */

import {
  IntelligentPaginationConfig,
  PrintTemplateConfig,
  TypographyElementKey,
} from '../types/erp';
import type { ExportTableDef, ReportPDFOptions, SummaryCardDef } from './exportService';
import {
  applyTemplateColumnVisibility,
  resolveEffectivePagination,
  resolveEffectivePrintTemplate,
  resolveEffectiveTypography,
  ResolvedPrintTypography,
  toPt,
} from './printTemplateResolver';

export interface PaginationMeasurementAdapter {
  measureTextMm?: (text: string, fontSizePt: number, isBold: boolean) => number;
}

export interface ComputedTableRow {
  originalIndex: number;
  rawCells: (string | number)[];
  wrappedCells: string[][];
  isNumericCol: boolean[];
  isPriceCol: boolean[];
  alignments: ('right' | 'center' | 'left')[];
  heightMm: number;
}

export interface ComputedTotalsRow {
  rawCells: (string | number)[];
  wrappedCells: string[][];
  alignments: ('right' | 'center' | 'left')[];
  heightMm: number;
}

export interface ComputedTableChunkBlock {
  kind: 'table-chunk';
  tableIndex: number;
  isFirstChunk: boolean;
  isFinalChunk: boolean;
  title?: string;
  showTableHeader: boolean;
  headers: string[];
  wrappedHeaders: string[][];
  colWidthsMm: number[];
  isNumericCol: boolean[];
  isPriceCol: boolean[];
  alignments: ('right' | 'center' | 'left')[];
  headerHeightMm: number;
  rows: ComputedTableRow[];
  totals?: ComputedTotalsRow;
  isEmptyTable?: boolean;
  totalHeightMm: number;
}

export interface ComputedMetadataBlock {
  kind: 'metadata';
  entries: [string, string][];
  heightMm: number;
}

export interface ComputedSummaryCardsBlock {
  kind: 'summary-cards';
  cards: SummaryCardDef[];
  heightMm: number;
}

export interface ComputedNotesBlock {
  kind: 'notes';
  text: string;
  heightMm: number;
}

export interface ComputedSignaturesBlock {
  kind: 'signatures';
  showSignatures: boolean;
  showStamp: boolean;
  signatureLabels: [string, string, string];
  preparedBy: string;
  heightMm: number;
}

export type PageContentBlock =
  | ComputedMetadataBlock
  | ComputedTableChunkBlock
  | ComputedSummaryCardsBlock
  | ComputedNotesBlock
  | ComputedSignaturesBlock;

export interface PaginatedPage {
  pageNumber: number;
  headerKind: 'full' | 'none' | 'continuation';
  blocks: PageContentBlock[];
  usedHeightMm: number;
  remainingHeightMm: number;
}

export interface TablePlacementDecision {
  tableIndex: number;
  title?: string;
  totalRows: number;
  startedOnPage: number;
  movedToNextPage: boolean;
  reason: string;
  remainingBeforeMm: number;
  requiredMinMm: number;
  minRowsRequired: number;
}

export interface PaginatedDocumentPlan {
  tpl: PrintTemplateConfig;
  typo: ResolvedPrintTypography;
  typoPt: Record<TypographyElementKey, number>;
  pagination: IntelligentPaginationConfig;
  lang: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  orientation: 'portrait' | 'landscape';
  format: string | [number, number];
  pageWidthMm: number;
  pageHeightMm: number;
  cssPageSize: string;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  contentWidthMm: number;
  usableBodyHeightMm: number;
  headerFullHeightMm: number;
  continuationStripHeightMm: number;
  footerHeightMm: number;
  pages: PaginatedPage[];
  decisions: TablePlacementDecision[];
}

export function isPriceColumnHeader(header: string): boolean {
  const h = String(header || '').trim();
  if (!h) return false;
  return /(?:السعر|سعر|الإجمالي|الاجمالي|الصافي|المبلغ|الرصيد|مدين|دائن|المعادل|التكلفة|تكلفة|القيمة|الخصم|خصم|الضريبة|ضريبة|المجموع|المتبقي|المدفوع|price|total|amount|debit|credit|balance|discount|tax|net|subtotal|cost)/i.test(
    h
  );
}

export function isNumericColumnHeader(header: string): boolean {
  const h = String(header || '').trim();
  if (!h) return false;
  if (h === '#' || h === 'م') return true;
  if (isPriceColumnHeader(h)) return true;
  return /^(?:#|م|الكمية|الكميه|بونص|البونص|العدد|نسبة|Rate|Qty|Quantity|Count)$/i.test(h);
}

export function isNumericCellValue(val: string | number | undefined | null, headerLabel?: string): boolean {
  if (typeof val === 'number') return true;
  const s = String(val ?? '').trim();
  if (!s || s === '-') {
    return headerLabel ? isNumericColumnHeader(headerLabel) : false;
  }
  // Matches numbers, formatted decimals, percentages, currencies (YER/SAR/USD/ر.ي/ر.س), bonus (+2), dates
  if (
    /^[+\-−()]*[\d٠-٩]{1,3}(?:[,،][\d٠-٩]{3})*(?:\.[\d٠-٩]+)?(?:\s*(?:%|ر\.ي|ر\.س|دولار|SAR|YER|USD|\(\+[\d.]+\)))*$/i.test(
      s
    ) ||
    /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(s)
  ) {
    return true;
  }
  if (s.includes(' | ')) {
    const parts = s.split(' | ').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0 && parts.every((p) => isNumericCellValue(p))) {
      return true;
    }
  }
  return false;
}

const NUMERIC_HEADER_HINT = /(?:الكمية|السعر|الخصم|الضريبة|الإجمالي|الصافي|المبلغ|الرصيد|مدين|دائن|المعادل|التكلفة|القيمة|qty|price|total|amount|debit|credit|balance)/i;

let cachedCanvasCtx: CanvasRenderingContext2D | null = null;

function getBrowserMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!cachedCanvasCtx) {
    const c = document.createElement('canvas');
    cachedCanvasCtx = c.getContext('2d');
  }
  return cachedCanvasCtx;
}

export function createDefaultMeasureTextMm(fontFamily?: PrintTemplateConfig['fontFamily']) {
  const familyName =
    fontFamily === 'DejaVu'
      ? '"DejaVu", "Cairo", "Segoe UI", Tahoma, sans-serif'
      : fontFamily === 'Tajawal'
      ? '"Tajawal", "Cairo", "Segoe UI", Tahoma, sans-serif'
      : '"Cairo", "Segoe UI", Tahoma, sans-serif';

  return (text: string, fontSizePt: number, isBold: boolean): number => {
    const clean = String(text ?? '');
    if (!clean) return 0;

    // Fallback deterministic metric for Cairo/DejaVu Arabic+Latin characters (in mm)
    const ptToMm = 0.352778;
    let units = 0;
    for (const ch of Array.from(clean)) {
      if (ch === ' ') units += 0.3;
      else if (/[\u0600-\u06FF\uFE70-\uFEFC]/.test(ch)) units += 0.56;
      else if (/[A-Z]/.test(ch)) units += 0.62;
      else if (/[0-9]/.test(ch)) units += 0.54;
      else if (/[.,:/\-_|()%]/.test(ch)) units += 0.32;
      else units += 0.52;
    }
    const heuristicMm = units * fontSizePt * ptToMm * (isBold ? 1.07 : 1.0);

    const ctx = getBrowserMeasureCtx();
    if (ctx) {
      try {
        ctx.font = `${isBold ? '700' : '400'} ${fontSizePt}pt ${familyName}`;
        const pxW = ctx.measureText(clean).width;
        const measuredMm = (pxW * 25.4) / 96;
        // Guard against zero-metric when custom font hasn't finished hydrating
        return Math.max(measuredMm, heuristicMm * 0.88);
      } catch {
        return heuristicMm;
      }
    }
    return heuristicMm;
  };
}

export function wrapTextToWidthMm(
  text: string,
  maxWidthMm: number,
  fontSizePt: number,
  isBold: boolean,
  measureTextMm: (t: string, pt: number, bold: boolean) => number
): string[] {
  const raw = String(text ?? '').trim();
  if (!raw) return ['-'];

  // Preserve explicit dual-line currency splits ("100 SAR | 14,200 YER")
  if (raw.includes(' | ')) {
    const segs = raw.split(' | ').map((s) => s.trim()).filter(Boolean);
    if (segs.length > 1) {
      return segs.flatMap((seg) =>
        wrapTextToWidthMm(seg, maxWidthMm, fontSizePt, isBold, measureTextMm)
      );
    }
  }

  const normalized = raw.replace(/\s+/g, ' ').trim();
  const safeMax = Math.max(maxWidthMm, 6);
  if (measureTextMm(normalized, fontSizePt, isBold) <= safeMax) {
    return [normalized];
  }

  const words = normalized.split(' ');
  const lines: string[] = [];
  let current = '';

  const splitLongWord = (w: string): string => {
    let chunk = '';
    for (const ch of Array.from(w)) {
      if (chunk && measureTextMm(chunk + ch, fontSizePt, isBold) > safeMax) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    return chunk;
  };

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (measureTextMm(candidate, fontSizePt, isBold) <= safeMax) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current =
        measureTextMm(w, fontSizePt, isBold) > safeMax ? splitLongWord(w) : w;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [normalized];
}

export function resolvePaperGeometryMm(
  tpl: PrintTemplateConfig,
  maxCols: number
): {
  orientation: 'portrait' | 'landscape';
  format: string | [number, number];
  pageWidthMm: number;
  pageHeightMm: number;
  cssPageSize: string;
} {
  const orientation: 'portrait' | 'landscape' =
    tpl.orientation === 'auto'
      ? maxCols > 5
        ? 'landscape'
        : 'portrait'
      : tpl.orientation;

  let w = 210;
  let h = 297;
  let format: string | [number, number] = 'a4';

  if (tpl.paperSize === 'A3') {
    w = 297;
    h = 420;
    format = 'a3';
  } else if (tpl.paperSize === 'LETTER') {
    w = 215.9;
    h = 279.4;
    format = 'letter';
  } else if (tpl.paperSize === 'CUSTOM') {
    w = Math.max(80, Math.min(600, Number(tpl.customWidthMm) || 210));
    h = Math.max(80, Math.min(800, Number(tpl.customHeightMm) || 297));
    format = orientation === 'landscape' && w < h ? [h, w] : [w, h];
  }

  const pageWidthMm = orientation === 'landscape' ? Math.max(w, h) : Math.min(w, h);
  const pageHeightMm = orientation === 'landscape' ? Math.min(w, h) : Math.max(w, h);
  const cssPageSize =
    tpl.paperSize === 'CUSTOM'
      ? `${pageWidthMm}mm ${pageHeightMm}mm`
      : `${tpl.paperSize === 'LETTER' ? 'letter' : tpl.paperSize} ${orientation}`;

  return { orientation, format, pageWidthMm, pageHeightMm, cssPageSize };
}

/**
 * Computes the complete deterministic multi-page layout for any ReportPDFOptions structure.
 */
export function buildDocumentPaginationPlan(
  options: ReportPDFOptions,
  adapter?: PaginationMeasurementAdapter
): PaginatedDocumentPlan {
  const lang: 'ar' | 'en' = options.lang === 'en' ? 'en' : 'ar';
  const dir: 'rtl' | 'ltr' = lang === 'en' ? 'ltr' : 'rtl';
  const isEn = lang === 'en';

  const tpl = resolveEffectivePrintTemplate({
    docType: options.docType,
    title: options.title,
    printTemplate: options.printTemplate,
    printTemplates: options.printTemplates,
  });
  const typo = resolveEffectiveTypography(tpl);
  const pagination = resolveEffectivePagination(tpl);
  const unit = typo.unit;

  const typoPt: Record<TypographyElementKey, number> = {
    companyName: toPt(typo.companyName, unit),
    documentTitle: toPt(typo.documentTitle, unit),
    sectionHeadings: toPt(typo.sectionHeadings, unit),
    companyDetails: toPt(typo.companyDetails, unit),
    partyMetadata: toPt(typo.partyMetadata, unit),
    tableHeaders: toPt(typo.tableHeaders, unit),
    tableCells: toPt(typo.tableCells, unit),
    numericValues: toPt(typo.numericValues, unit),
    priceValues: toPt(typo.priceValues, unit),
    totalsAndSummary: toPt(typo.totalsAndSummary, unit),
    finalAmounts: toPt(typo.finalAmounts, unit),
    notes: toPt(typo.notes, unit),
    signatures: toPt(typo.signatures, unit),
    footer: toPt(typo.footer, unit),
    pageNumbers: toPt(typo.pageNumbers, unit),
  };

  const visibleTables: ExportTableDef[] = options.tables.map((t) =>
    applyTemplateColumnVisibility(t, tpl.hiddenColumns)
  );
  const maxCols = Math.max(...visibleTables.map((t) => t.headers.length), 4);
  const { orientation, format, pageWidthMm, pageHeightMm, cssPageSize } =
    resolvePaperGeometryMm(tpl, maxCols);

  const marginTopMm = Math.max(4, Math.min(35, Number(tpl.marginTopMm) || 10));
  const marginRightMm = Math.max(4, Math.min(35, Number(tpl.marginRightMm) || 10));
  const marginBottomMm = Math.max(6, Math.min(35, Number(tpl.marginBottomMm) || 12));
  const marginLeftMm = Math.max(4, Math.min(35, Number(tpl.marginLeftMm) || 10));
  const contentWidthMm = Math.max(45, pageWidthMm - marginLeftMm - marginRightMm);

  const measureTextMm =
    adapter?.measureTextMm || createDefaultMeasureTextMm(tpl.fontFamily);

  // Measure header heights dynamically from typography sizes & banner settings
  const hasBanner = Boolean(
    tpl.useCustomBanner && options.company?.useFullBanner && options.company?.bannerBase64
  );
  const ptToMm = 0.352778;
  const headerFullHeightMm = !tpl.showHeader
    ? Math.max(12, typoPt.documentTitle * ptToMm * 1.9 + 5)
    : hasBanner
    ? Math.max(30, 21 + typoPt.documentTitle * ptToMm * 1.6 + 6)
    : tpl.logoPosition === 'center'
    ? Math.max(
        34,
        (tpl.showLogo ? Math.min(20, (tpl.logoSizePx || 64) * 0.26) : 0) +
          typoPt.companyName * ptToMm * 1.6 +
          (tpl.showCompanyDetails ? typoPt.companyDetails * ptToMm * 3.0 : 0) +
          typoPt.documentTitle * ptToMm * 1.8 +
          8
      )
    : Math.max(
        24,
        typoPt.companyName * ptToMm * 1.55 +
          (tpl.showCompanyDetails ? typoPt.companyDetails * ptToMm * 2.8 : 0) +
          8
      );

  const continuationStripHeightMm = Math.max(
    7.5,
    typoPt.sectionHeadings * ptToMm * 1.5 + 3.2
  );
  const footerHeightMm =
    tpl.showFooter || tpl.showPageNumbers
      ? Math.max(
          7,
          Math.max(typoPt.footer, typoPt.pageNumbers) * ptToMm * 1.6 + 3.5
        )
      : 0;

  // Keep a small 2.5mm sub-pixel cushion so printed browser pages never overflow a blank page
  const usableBodyHeightMm = Math.max(
    40,
    pageHeightMm - marginTopMm - marginBottomMm - footerHeightMm - 2.5
  );

  const pages: PaginatedPage[] = [];
  const decisions: TablePlacementDecision[] = [];

  let curPage: PaginatedPage = {
    pageNumber: 1,
    headerKind: 'full',
    blocks: [],
    usedHeightMm: headerFullHeightMm,
    remainingHeightMm: Math.max(0, usableBodyHeightMm - headerFullHeightMm),
  };

  let tablesOnCurrentPage = 0;

  const commitAndStartNewPage = () => {
    curPage.remainingHeightMm = Math.max(0, usableBodyHeightMm - curPage.usedHeightMm);
    pages.push(curPage);
    const nextNum = pages.length + 1;
    const hKind: PaginatedPage['headerKind'] = tpl.repeatHeaderOnPages
      ? 'full'
      : 'continuation';
    const nextHeaderH = tpl.repeatHeaderOnPages
      ? headerFullHeightMm
      : continuationStripHeightMm;
    curPage = {
      pageNumber: nextNum,
      headerKind: hKind,
      blocks: [],
      usedHeightMm: nextHeaderH,
      remainingHeightMm: Math.max(0, usableBodyHeightMm - nextHeaderH),
    };
    tablesOnCurrentPage = 0;
  };

  const remainingOnPage = () => Math.max(0, usableBodyHeightMm - curPage.usedHeightMm);
  const pageHasBodyContent = () => curPage.blocks.length > 0;

  // 1. Metadata block
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    const entries = Object.entries(options.metadata);
    const cols = contentWidthMm >= 145 ? 2 : 1;
    const colW = contentWidthMm / cols;
    const metaLineH = Math.max(3.6, typoPt.partyMetadata * ptToMm * 1.48);
    const pairHeights = entries.map(([k, v]) => {
      const wrapped = wrapTextToWidthMm(
        `${k.replace(/_/g, ' ')}: ${v}`,
        colW - 6,
        typoPt.partyMetadata,
        false,
        measureTextMm
      );
      return wrapped.length * metaLineH + 1.8;
    });
    let metaRowsH = 0;
    for (let i = 0; i < pairHeights.length; i += cols) {
      const h1 = pairHeights[i] || 0;
      const h2 = cols === 2 ? pairHeights[i + 1] || 0 : 0;
      metaRowsH += Math.max(h1, h2);
    }
    const metaBoxH = metaRowsH + 4.5 + 3.5; // padding + bottom gap
    if (remainingOnPage() < metaBoxH && pageHasBodyContent()) {
      commitAndStartNewPage();
    }
    curPage.blocks.push({
      kind: 'metadata',
      entries,
      heightMm: metaBoxH,
    });
    curPage.usedHeightMm += metaBoxH;
  }

  // 2. Intelligent Table Distribution
  visibleTables.forEach((table, tableIndex) => {
    const colCount = Math.max(table.headers.length, 1);

    // Proportional column widths based on headers + sample rows
    const weights = table.headers.map((h, cIdx) => {
      let maxCharW = measureTextMm(String(h), typoPt.tableHeaders, true) + 4;
      const sample = table.rows.slice(0, 40);
      for (const r of sample) {
        const w = measureTextMm(String(r[cIdx] ?? ''), typoPt.tableCells, false) + 3.5;
        if (w > maxCharW) maxCharW = w;
      }
      return Math.min(Math.max(maxCharW, 12), contentWidthMm * 0.55);
    });
    const weightSum = weights.reduce((s, w) => s + w, 0) || 1;
    const minColW = Math.min(12, contentWidthMm / colCount);
    const rawCols = weights.map((w) => Math.max(minColW, (w / weightSum) * contentWidthMm));
    const scaleCol = contentWidthMm / (rawCols.reduce((s, w) => s + w, 0) || 1);
    const colWidthsMm = rawCols.map((w) => w * scaleCol);

    const isPriceCol = table.headers.map((h) => isPriceColumnHeader(h));
    const isNumericCol = table.headers.map((h, cIdx) => {
      if (isPriceCol[cIdx] || isNumericColumnHeader(h)) return true;
      const sampleVals = table.rows.slice(0, 12).map((r) => r[cIdx]);
      const nonEmpty = sampleVals.filter((v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-');
      if (nonEmpty.length === 0) return false;
      const numHits = nonEmpty.filter((v) => isNumericCellValue(v, h)).length;
      return numHits / nonEmpty.length >= 0.65;
    });

    const alignments: ('right' | 'center' | 'left')[] = table.headers.map((_, cIdx) => {
      if (table.alignments?.[cIdx]) return table.alignments[cIdx];
      if (isNumericCol[cIdx]) return isEn ? 'right' : 'center';
      return isEn ? 'left' : 'right';
    });

    // Header height
    const thLineH = Math.max(3.1, typoPt.tableHeaders * ptToMm * 1.42);
    const wrappedHeaders = table.headers.map((h, cIdx) =>
      wrapTextToWidthMm(String(h), colWidthsMm[cIdx] - 2.6, typoPt.tableHeaders, true, measureTextMm)
    );
    const maxHeaderLines = Math.max(...wrappedHeaders.map((l) => l.length), 1);
    const headerHeightMm = Math.max(5.5, maxHeaderLines * thLineH + 2.8);

    // Pre-wrap and compute exact height for every single data row
    const rowLayouts: ComputedTableRow[] = table.rows.map((row, rIdx) => {
      const rowIsNumeric: boolean[] = [];
      const rowIsPrice: boolean[] = [];
      let rowMaxLineHeight = 0;
      const wrappedCells = table.headers.map((h, cIdx) => {
        const val = row[cIdx];
        const cellIsPrice = isPriceCol[cIdx];
        const cellIsNum = !cellIsPrice && (isNumericCol[cIdx] || isNumericCellValue(val, h));
        rowIsPrice.push(cellIsPrice);
        rowIsNumeric.push(cellIsNum);
        const fontPt = cellIsPrice
          ? typoPt.priceValues
          : cellIsNum
          ? typoPt.numericValues
          : typoPt.tableCells;
        const lineH = Math.max(3.0, fontPt * ptToMm * 1.42);
        if (lineH > rowMaxLineHeight) rowMaxLineHeight = lineH;
        return wrapTextToWidthMm(String(val ?? '-'), colWidthsMm[cIdx] - 2.6, fontPt, false, measureTextMm);
      });
      const maxLines = Math.max(...wrappedCells.map((l) => l.length), 1);
      const heightMm = Math.max(4.8, maxLines * (rowMaxLineHeight || 3.8) + 2.2);
      return {
        originalIndex: rIdx,
        rawCells: row,
        wrappedCells,
        isNumericCol: rowIsNumeric,
        isPriceCol: rowIsPrice,
        alignments,
        heightMm,
      };
    });

    // Totals row height if present
    let totalsLayout: ComputedTotalsRow | undefined;
    if (table.totals && table.totals.length > 0) {
      const totLineH = Math.max(3.8, typoPt.totalsAndSummary * ptToMm * 1.48);
      const wrappedTotals = table.headers.map((_, cIdx) => {
        const raw = String(table.totals![cIdx] ?? '').trim();
        return raw
          ? wrapTextToWidthMm(raw, colWidthsMm[cIdx] - 2.6, typoPt.totalsAndSummary, true, measureTextMm)
          : [''];
      });
      const maxTotLines = Math.max(...wrappedTotals.map((l) => l.length), 1);
      totalsLayout = {
        rawCells: table.totals,
        wrappedCells: wrappedTotals,
        alignments,
        heightMm: Math.max(6.8, maxTotLines * totLineH + 3.0),
      };
    }

    // Section heading height (tied to table when keepHeadingWithTable is true)
    const headingLineH = Math.max(4.4, typoPt.sectionHeadings * ptToMm * 1.45);
    const headingBlockH = table.title
      ? pagination.headingSpacingBeforeMm + headingLineH + 2.2 + pagination.headingSpacingAfterMm
      : 0;

    // Spacing before table when another table or element already precedes it
    const preSpacingMm = tablesOnCurrentPage > 0 ? pagination.tableSpacingMm : 0;

    // Evaluate whether current page has enough remaining space to start this table
    const remBefore = remainingOnPage() - preSpacingMm;
    const totalRows = rowLayouts.length;
    const emptyRowH = 8.5;
    const totalTableDataH = rowLayouts.reduce((s, r) => s + r.heightMm, 0);
    const isShortTable = totalRows > 0 && totalRows <= pagination.keepShortTableTogetherMaxRows;
    const effectiveMinRows = Math.min(totalRows, pagination.minimumRowsBeforeTableBreak);

    let minRequiredToStartMm = 0;
    let moveReason = 'fits-current-page';
    let shouldMoveBeforeStart = false;

    if (!pagination.allowMultipleTablesPerPage && tablesOnCurrentPage > 0) {
      shouldMoveBeforeStart = true;
      moveReason = 'single-table-per-page-policy';
      minRequiredToStartMm = headingBlockH + headerHeightMm;
    } else if (totalRows === 0) {
      minRequiredToStartMm = headingBlockH + headerHeightMm + emptyRowH;
      if (remBefore < minRequiredToStartMm && pageHasBodyContent()) {
        shouldMoveBeforeStart = true;
        moveReason = 'insufficient-space-for-empty-table';
      }
    } else if (isShortTable) {
      const fullShortTableH =
        headingBlockH + headerHeightMm + totalTableDataH + (totalsLayout?.heightMm || 0);
      minRequiredToStartMm = fullShortTableH;
      const freshPageBudget =
        usableBodyHeightMm - (tpl.repeatHeaderOnPages ? headerFullHeightMm : continuationStripHeightMm);
      if (remBefore < fullShortTableH && pageHasBodyContent() && fullShortTableH <= freshPageBudget) {
        shouldMoveBeforeStart = true;
        moveReason = `short-table(${totalRows}r)-kept-intact-on-next-page`;
      } else if (remBefore < headingBlockH + headerHeightMm + rowLayouts[0].heightMm && pageHasBodyContent()) {
        shouldMoveBeforeStart = true;
        moveReason = 'insufficient-space-for-first-row';
      }
    } else {
      const minRowsH = rowLayouts
        .slice(0, effectiveMinRows)
        .reduce((s, r) => s + r.heightMm, 0);
      minRequiredToStartMm =
        (pagination.keepHeadingWithTable ? headingBlockH : 0) + headerHeightMm + minRowsH;
      const freshPageBudget =
        usableBodyHeightMm - (tpl.repeatHeaderOnPages ? headerFullHeightMm : continuationStripHeightMm);
      // Move table to next page if remaining space < heading + thead + minRows (e.g. 4 rows)
      // (as long as the current page isn't already empty / the requirement fits on a fresh page)
      if (remBefore < minRequiredToStartMm && pageHasBodyContent()) {
        if (minRequiredToStartMm <= freshPageBudget || remBefore < headingBlockH + headerHeightMm + rowLayouts[0].heightMm) {
          shouldMoveBeforeStart = true;
          moveReason = `remaining(${remBefore.toFixed(1)}mm)<minRequired(${minRequiredToStartMm.toFixed(1)}mm for thead+${effectiveMinRows}r)`;
        }
      }
    }

    if (shouldMoveBeforeStart) {
      commitAndStartNewPage();
    } else if (preSpacingMm > 0) {
      curPage.usedHeightMm += preSpacingMm;
    }

    const startedOnPage = curPage.pageNumber;
    decisions.push({
      tableIndex,
      title: table.title,
      totalRows,
      startedOnPage,
      movedToNextPage: shouldMoveBeforeStart,
      reason: moveReason,
      remainingBeforeMm: Math.round(Math.max(0, remBefore) * 10) / 10,
      requiredMinMm: Math.round(minRequiredToStartMm * 10) / 10,
      minRowsRequired: isShortTable ? totalRows : effectiveMinRows,
    });

    // Empty table special render
    if (totalRows === 0) {
      const blockH = headingBlockH + headerHeightMm + emptyRowH;
      curPage.blocks.push({
        kind: 'table-chunk',
        tableIndex,
        isFirstChunk: true,
        isFinalChunk: true,
        title: table.title,
        showTableHeader: true,
        headers: table.headers,
        wrappedHeaders,
        colWidthsMm,
        isNumericCol,
        isPriceCol,
        alignments,
        headerHeightMm,
        rows: [],
        isEmptyTable: true,
        totalHeightMm: blockH,
      });
      curPage.usedHeightMm += blockH;
      tablesOnCurrentPage++;
      return;
    }

    // Stream rows cleanly across pages respecting preventRowSplit and keepHeadingWithTable
    let chunkIndex = 0;
    let chunkRows: ComputedTableRow[] = [];
    let chunkOverheadMm = headingBlockH + headerHeightMm;
    let showHeaderOnChunk = true;
    let currentChunkUsedMm = chunkOverheadMm;

    const flushChunk = (isFinalChunk: boolean, attachTotals?: ComputedTotalsRow) => {
      const dataH = chunkRows.reduce((s, r) => s + r.heightMm, 0);
      const totH = attachTotals ? attachTotals.heightMm : 0;
      const totalChunkH =
        (chunkIndex === 0 ? headingBlockH : 0) +
        (showHeaderOnChunk ? headerHeightMm : 0) +
        dataH +
        totH;

      curPage.blocks.push({
        kind: 'table-chunk',
        tableIndex,
        isFirstChunk: chunkIndex === 0,
        isFinalChunk,
        title: chunkIndex === 0 ? table.title : undefined,
        showTableHeader: showHeaderOnChunk,
        headers: table.headers,
        wrappedHeaders,
        colWidthsMm,
        isNumericCol,
        isPriceCol,
        alignments,
        headerHeightMm: showHeaderOnChunk ? headerHeightMm : 0,
        rows: chunkRows,
        totals: attachTotals,
        totalHeightMm: totalChunkH,
      });
      curPage.usedHeightMm += totalChunkH;
      tablesOnCurrentPage++;
      chunkIndex++;
      chunkRows = [];
      showHeaderOnChunk = Boolean(tpl.repeatTableHeader);
      chunkOverheadMm = showHeaderOnChunk ? headerHeightMm : 0;
      currentChunkUsedMm = chunkOverheadMm;
    };

    for (let rIdx = 0; rIdx < rowLayouts.length; rIdx++) {
      const row = rowLayouts[rIdx];
      const rem = remainingOnPage();

      if (currentChunkUsedMm + row.heightMm > rem && chunkRows.length > 0) {
        // Flush completed rows onto current page, start fresh page for next row
        flushChunk(false, undefined);
        commitAndStartNewPage();
      } else if (
        chunkRows.length === 0 &&
        chunkOverheadMm + row.heightMm > rem &&
        pageHasBodyContent()
      ) {
        // Not even 1 row fits cleanly alongside heading/header on current page
        commitAndStartNewPage();
      }

      chunkRows.push(row);
      currentChunkUsedMm += row.heightMm;
    }

    // Attach totals row safely (avoid orphaned totals-only chunk on a new page when possible)
    if (totalsLayout) {
      const rem = remainingOnPage();
      if (currentChunkUsedMm + totalsLayout.heightMm > rem) {
        if (chunkRows.length >= 2) {
          // Move last row together with totals onto next page so totals isn't orphaned alone
          const carriedLastRow = chunkRows.pop()!;
          flushChunk(false, undefined);
          commitAndStartNewPage();
          chunkRows = [carriedLastRow];
          flushChunk(true, totalsLayout);
        } else {
          flushChunk(false, undefined);
          commitAndStartNewPage();
          flushChunk(true, totalsLayout);
        }
      } else {
        flushChunk(true, totalsLayout);
      }
    } else {
      flushChunk(true, undefined);
    }
  });

  // 3. Summary Cards Block (keep together when it fits on a page)
  if (options.summaryCards && options.summaryCards.length > 0) {
    const cards = options.summaryCards;
    const cols = contentWidthMm >= 145 ? 3 : 2;
    const cardRows = Math.ceil(cards.length / cols);
    const hasSub = cards.some(
      (c) => Boolean(c.subValue) || (c.value || '').includes(' | ')
    );
    const valLineH = Math.max(4.4, typoPt.finalAmounts * ptToMm * 1.45);
    const subLineH = Math.max(3.6, typoPt.notes * ptToMm * 1.38);
    const cardH = Math.max(
      hasSub ? 15 : 11,
      4.5 + subLineH + valLineH + (hasSub ? subLineH + 1.5 : 0)
    );
    const totalCardsH = cardRows * (cardH + 2.5) + 4;
    if (remainingOnPage() < totalCardsH && pageHasBodyContent()) {
      commitAndStartNewPage();
    }
    curPage.blocks.push({
      kind: 'summary-cards',
      cards,
      heightMm: totalCardsH,
    });
    curPage.usedHeightMm += totalCardsH;
  }

  // 4. Notes Block
  if (options.notes && options.notes.trim()) {
    const noteLineH = Math.max(3.8, typoPt.notes * ptToMm * 1.48);
    const wrappedNote = wrapTextToWidthMm(
      `${isEn ? 'Notes' : 'ملاحظات'}: ${options.notes}`,
      contentWidthMm - 8,
      typoPt.notes,
      false,
      measureTextMm
    );
    const notesH = wrappedNote.length * noteLineH + 6.5;
    if (remainingOnPage() < notesH && pageHasBodyContent()) {
      commitAndStartNewPage();
    }
    curPage.blocks.push({
      kind: 'notes',
      text: options.notes,
      heightMm: notesH,
    });
    curPage.usedHeightMm += notesH;
  }

  // 5. Signatures & Official Stamp Block
  if (tpl.showSignatures || tpl.showStamp) {
    const sigLineH = Math.max(3.5, typoPt.signatures * ptToMm * 1.45);
    const sigH = tpl.showSignatures
      ? Math.max(22, sigLineH * 2 + 15)
      : 23;
    if (remainingOnPage() < sigH && pageHasBodyContent()) {
      commitAndStartNewPage();
    }
    curPage.blocks.push({
      kind: 'signatures',
      showSignatures: tpl.showSignatures,
      showStamp: tpl.showStamp,
      signatureLabels: tpl.signatureLabels || [
        'إعداد / المحاسب',
        'المراجعة والتدقيق',
        'اعتماد الإدارة',
      ],
      preparedBy: options.preparedBy || (isEn ? 'Financial Accountant' : 'المحاسب المالي'),
      heightMm: sigH,
    });
    curPage.usedHeightMm += sigH;
  }

  curPage.remainingHeightMm = Math.max(0, usableBodyHeightMm - curPage.usedHeightMm);
  pages.push(curPage);

  return {
    tpl,
    typo,
    typoPt,
    pagination,
    lang,
    dir,
    orientation,
    format,
    pageWidthMm,
    pageHeightMm,
    cssPageSize,
    marginTopMm,
    marginRightMm,
    marginBottomMm,
    marginLeftMm,
    contentWidthMm,
    usableBodyHeightMm,
    headerFullHeightMm,
    continuationStripHeightMm,
    footerHeightMm,
    pages,
    decisions,
  };
}
