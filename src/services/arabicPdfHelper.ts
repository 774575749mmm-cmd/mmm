/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Genuine Binary PDF Engine
 * Embedded Cairo TTF (with Presentation Forms-B cmap patch) + DejaVu fallback,
 * Logical-to-Visual UAX #9 BiDi without double-reversal, 12-Element Independent Typography,
 * Intelligent Rule-Driven Table Pagination (`buildDocumentPaginationPlan`), Single/Repeat Header Control,
 * Column Visibility Filtering, and Multi-Document Batch PDF Generation.
 */

import { jsPDF } from 'jspdf';
import type {
  Company,
  Branch,
  Invoice,
  PaymentVoucher,
  PrintTemplateConfig,
  TypographyElementKey,
} from '../types/erp';
import type { ReportPDFOptions } from './exportService';
import { resolveEffectivePrintTemplate } from './printTemplateResolver';
import {
  buildDocumentPaginationPlan,
  ComputedTableChunkBlock,
  wrapTextToWidthMm,
} from './documentPaginationEngine';

// [isolated, final, initial, medial] in Unicode Arabic Presentation Forms-B
const ARABIC_FORMS: Record<string, [string, string, string?, string?]> = {
  '\u0621': ['\uFE80', '\uFE80'],
  '\u0622': ['\uFE81', '\uFE82'],
  '\u0623': ['\uFE83', '\uFE84'],
  '\u0624': ['\uFE85', '\uFE86'],
  '\u0625': ['\uFE87', '\uFE88'],
  '\u0626': ['\uFE89', '\uFE8A', '\uFE8B', '\uFE8C'],
  '\u0627': ['\uFE8D', '\uFE8E'],
  '\u0628': ['\uFE8F', '\uFE90', '\uFE91', '\uFE92'],
  '\u0629': ['\uFE93', '\uFE94'],
  '\u062A': ['\uFE95', '\uFE96', '\uFE97', '\uFE98'],
  '\u062B': ['\uFE99', '\uFE9A', '\uFE9B', '\uFE9C'],
  '\u062C': ['\uFE9D', '\uFE9E', '\uFE9F', '\uFEA0'],
  '\u062D': ['\uFEA1', '\uFEA2', '\uFEA3', '\uFEA4'],
  '\u062E': ['\uFEA5', '\uFEA6', '\uFEA7', '\uFEA8'],
  '\u062F': ['\uFEA9', '\uFEAA'],
  '\u0630': ['\uFEAB', '\uFEAC'],
  '\u0631': ['\uFEAD', '\uFEAE'],
  '\u0632': ['\uFEAF', '\uFEB0'],
  '\u0633': ['\uFEB1', '\uFEB2', '\uFEB3', '\uFEB4'],
  '\u0634': ['\uFEB5', '\uFEB6', '\uFEB7', '\uFEB8'],
  '\u0635': ['\uFEB9', '\uFEBA', '\uFEBB', '\uFEBC'],
  '\u0636': ['\uFEBD', '\uFEBE', '\uFEBF', '\uFEC0'],
  '\u0637': ['\uFEC1', '\uFEC2', '\uFEC3', '\uFEC4'],
  '\u0638': ['\uFEC5', '\uFEC6', '\uFEC7', '\uFEC8'],
  '\u0639': ['\uFEC9', '\uFECA', '\uFECB', '\uFECC'],
  '\u063A': ['\uFECD', '\uFECE', '\uFECF', '\uFED0'],
  '\u0640': ['\u0640', '\u0640', '\u0640', '\u0640'],
  '\u0641': ['\uFED1', '\uFED2', '\uFED3', '\uFED4'],
  '\u0642': ['\uFED5', '\uFED6', '\uFED7', '\uFED8'],
  '\u0643': ['\uFED9', '\uFEDA', '\uFEDB', '\uFEDC'],
  '\u0644': ['\uFEDD', '\uFEDE', '\uFEDF', '\uFEE0'],
  '\u0645': ['\uFEE1', '\uFEE2', '\uFEE3', '\uFEE4'],
  '\u0646': ['\uFEE5', '\uFEE6', '\uFEE7', '\uFEE8'],
  '\u0647': ['\uFEE9', '\uFEEA', '\uFEEB', '\uFEEC'],
  '\u0648': ['\uFEED', '\uFEEE'],
  '\u0649': ['\uFEEF', '\uFEF0'],
  '\u064A': ['\uFEF1', '\uFEF2', '\uFEF3', '\uFEF4'],
};

const LAM_ALEF_LIGATURES: Record<string, [string, string]> = {
  '\u0622': ['\uFEF5', '\uFEF6'],
  '\u0623': ['\uFEF7', '\uFEF8'],
  '\u0625': ['\uFEF9', '\uFEFA'],
  '\u0627': ['\uFEFB', '\uFEFC'],
};

const ARABIC_DIACRITICS_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

function canConnectAfter(ch: string | undefined): boolean {
  if (!ch) return false;
  const forms = ARABIC_FORMS[ch];
  return Boolean(forms && forms[2] && forms[3]);
}

function isArabicLetter(ch: string | undefined): boolean {
  if (!ch) return false;
  return Boolean(ARABIC_FORMS[ch]);
}

/**
 * Shapes logical Arabic characters into Presentation Forms-B including Lam-Alef ligatures.
 */
export function shapeArabicLogical(text: string): string {
  const cleaned = (text || '').replace(ARABIC_DIACRITICS_REGEX, '');
  const chars = Array.from(cleaned);
  const out: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (!isArabicLetter(ch)) {
      out.push(ch);
      continue;
    }

    const prevChar = i > 0 ? chars[i - 1] : undefined;
    const prevConnects = canConnectAfter(prevChar);

    if (ch === '\u0644' && i + 1 < chars.length && LAM_ALEF_LIGATURES[chars[i + 1]]) {
      const lig = LAM_ALEF_LIGATURES[chars[i + 1]];
      out.push(prevConnects ? lig[1] : lig[0]);
      i += 1;
      continue;
    }

    const nextChar = i + 1 < chars.length ? chars[i + 1] : undefined;
    const nextIsArabic = isArabicLetter(nextChar);
    const forms = ARABIC_FORMS[ch];
    const hasInitial = Boolean(forms[2]);
    const hasMedial = Boolean(forms[3]);

    if (prevConnects && nextIsArabic && hasMedial) {
      out.push(forms[3]!);
    } else if (prevConnects && forms[1]) {
      out.push(forms[1]);
    } else if (!prevConnects && nextIsArabic && hasInitial) {
      out.push(forms[2]!);
    } else {
      out.push(forms[0]);
    }
  }

  return out.join('');
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\uFE70-\uFEFC]/.test(text);
}

/**
 * Prepares logical Arabic/mixed text for jsPDF 4.x's native Logical->Visual BiDi engine:
 * - Strips diacritics/control clutter that break metrics
 * - Preserves logical character order (NO manual reversal that would cause double-reversal!)
 * - Wraps dates (YYYY-MM-DD / DD/MM/YYYY), document codes (BAK-1001), and signed numbers (-500.00)
 *   with LRM (\u200E) inside RTL sentences so numbers/dates never flip order.
 */
export function prepareArabicPdfText(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  const raw = String(input)
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(/[\u200B-\u200F\u202A-\u202E]/g, '');
  if (!raw) return '';
  if (!containsArabic(raw)) return raw;

  return raw.replace(
    /(?:\([A-Za-z0-9.,:/%\-_+# ]+\)|[A-Za-z0-9#+-][A-Za-z0-9.,:/%\-_+#()]*(?:[ \t]+[A-Za-z0-9.,:/%\-_+#()]*[A-Za-z0-9)])*)/g,
    '\u200E$&\u200E'
  );
}

let cachedCairoFontB64: string | null = null;
let cachedDejaVuRegularB64: string | null = null;
let cachedDejaVuBoldB64: string | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  if (typeof btoa === 'function') {
    return btoa(chunks.join(''));
  }
  return Buffer.from(bytes).toString('base64');
}

async function fetchOrReadFont(fileName: string): Promise<string> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    const resp = await fetch(`/fonts/${fileName}`);
    if (!resp.ok) {
      throw new Error(`تعذر تحميل خط الطباعة العربية (${fileName} HTTP ${resp.status})`);
    }
    const buf = await resp.arrayBuffer();
    return arrayBufferToBase64(buf);
  }

  const fsMod = 'node:fs';
  const pathMod = 'node:path';
  const fs = await import(/* @vite-ignore */ fsMod);
  const path = await import(/* @vite-ignore */ pathMod);
  const fontPath = path.resolve(process.cwd(), 'public/fonts', fileName);
  const buf: Buffer = fs.readFileSync(fontPath);
  return buf.toString('base64');
}

async function loadPdfFontBundles(preferCairo: boolean): Promise<{
  fontName: 'Cairo' | 'DejaVu';
  regular: string;
  bold: string;
}> {
  if (preferCairo) {
    try {
      if (!cachedCairoFontB64) {
        cachedCairoFontB64 = await fetchOrReadFont('Cairo.ttf');
      }
      return { fontName: 'Cairo', regular: cachedCairoFontB64, bold: cachedCairoFontB64 };
    } catch {
      // Fallback safely to DejaVu if Cairo fails to load
    }
  }
  if (!cachedDejaVuRegularB64) {
    cachedDejaVuRegularB64 = await fetchOrReadFont('DejaVuSans.ttf');
  }
  if (!cachedDejaVuBoldB64) {
    try {
      cachedDejaVuBoldB64 = await fetchOrReadFont('DejaVuSans-Bold.ttf');
    } catch {
      cachedDejaVuBoldB64 = cachedDejaVuRegularB64;
    }
  }
  return { fontName: 'DejaVu', regular: cachedDejaVuRegularB64, bold: cachedDejaVuBoldB64 };
}

/**
 * Patches missing 36 isolated Arabic Presentation Forms-B cmap & Unicode.widths entries (0xFE80..0xFEF1)
 * in Cairo.ttf so jsPDF's processArabic() never outputs tofu (.notdef) glyphs for isolated letters.
 */
function patchCairoIsolatedArabicCmap(doc: jsPDF): void {
  type JsPdfFontMeta = {
    metadata?: {
      cmap?: { tables?: { codeMap?: Record<number, number> }[] };
      Unicode?: { widths?: Record<number, number> };
    };
  };
  const getter = doc as unknown as {
    getFont?: (fontName?: string, fontStyle?: string) => JsPdfFontMeta;
  };
  if (typeof getter.getFont !== 'function') return;

  for (const style of ['normal', 'bold'] as const) {
    try {
      const f = getter.getFont('Cairo', style);
      const cm = f?.metadata?.cmap?.tables?.[0]?.codeMap;
      const uWidths = f?.metadata?.Unicode?.widths;
      if (!cm) continue;

      for (const [baseCh, forms] of Object.entries(ARABIC_FORMS)) {
        const baseCode = baseCh.charCodeAt(0);
        const isoCode = forms[0].charCodeAt(0);
        if (isoCode >= 0xfe80 && !cm[isoCode] && cm[baseCode] !== undefined) {
          cm[isoCode] = cm[baseCode];
        }
        if (uWidths && isoCode >= 0xfe80 && !uWidths[isoCode] && uWidths[baseCode] !== undefined) {
          uWidths[isoCode] = uWidths[baseCode];
        }
      }
    } catch {
      // Ignore if font style isn't registered
    }
  }
}

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return fallback;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function resolveDocGeometry(
  tpl: PrintTemplateConfig,
  maxCols: number
): { format: string | [number, number]; orientation: 'portrait' | 'landscape' } {
  const orientation: 'portrait' | 'landscape' =
    tpl.orientation === 'auto'
      ? maxCols > 5
        ? 'landscape'
        : 'portrait'
      : tpl.orientation;
  let format: string | [number, number] = 'a4';
  if (tpl.paperSize === 'A3') format = 'a3';
  else if (tpl.paperSize === 'LETTER') format = 'letter';
  else if (tpl.paperSize === 'CUSTOM') {
    const w = Math.max(80, Math.min(600, Number(tpl.customWidthMm) || 210));
    const h = Math.max(80, Math.min(800, Number(tpl.customHeightMm) || 297));
    format = orientation === 'landscape' && w < h ? [h, w] : [w, h];
  }
  return { format, orientation };
}

function yieldToMain(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function createArabicDoc(
  orientation: 'portrait' | 'landscape',
  format: string | [number, number],
  preferCairo: boolean
): Promise<{ doc: jsPDF; fontName: 'Cairo' | 'DejaVu' }> {
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format,
    compress: true,
  });

  const bundle = await loadPdfFontBundles(preferCairo);
  if (bundle.fontName === 'Cairo') {
    doc.addFileToVFS('Cairo.ttf', bundle.regular);
    doc.addFont('Cairo.ttf', 'Cairo', 'normal');
    doc.addFont('Cairo.ttf', 'Cairo', 'bold');
    patchCairoIsolatedArabicCmap(doc);
    doc.setFont('Cairo', 'normal');
    return { doc, fontName: 'Cairo' };
  }

  doc.addFileToVFS('DejaVuSans.ttf', bundle.regular);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', bundle.bold);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  return { doc, fontName: 'DejaVu' };
}

async function registerFontOnExistingDoc(
  doc: jsPDF,
  preferCairo: boolean
): Promise<'Cairo' | 'DejaVu'> {
  const existing = doc.getFontList() as Record<string, string[]>;
  if (preferCairo && existing.Cairo) return 'Cairo';
  if (!preferCairo && existing.DejaVu) return 'DejaVu';

  const bundle = await loadPdfFontBundles(preferCairo);
  if (bundle.fontName === 'Cairo') {
    if (!existing.Cairo) {
      doc.addFileToVFS('Cairo.ttf', bundle.regular);
      doc.addFont('Cairo.ttf', 'Cairo', 'normal');
      doc.addFont('Cairo.ttf', 'Cairo', 'bold');
      patchCairoIsolatedArabicCmap(doc);
    }
    return 'Cairo';
  }
  if (!existing.DejaVu) {
    doc.addFileToVFS('DejaVuSans.ttf', bundle.regular);
    doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
    doc.addFileToVFS('DejaVuSans-Bold.ttf', bundle.bold);
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  }
  return 'DejaVu';
}

/**
 * Draws text using jsPDF's native Logical->Visual BiDi engine without double reversal.
 */
function drawPdfText(
  doc: jsPDF,
  text: string | number | undefined | null,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right' = 'right',
  forceLtrParagraph = false
): void {
  const prepared = prepareArabicPdfText(text);
  if (!prepared) return;
  const hasAr = !forceLtrParagraph && containsArabic(prepared);
  doc.text(prepared, x, y, {
    align,
    isInputVisual: false,
    isOutputVisual: true,
    isInputRtl: hasAr,
    isOutputRtl: false,
    isSymmetricSwapping: true,
  } as Record<string, unknown>);
}

function pdfNum(val: number | undefined | null, decimals = 2): string {
  return Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

async function renderReportIntoDoc(
  doc: jsPDF,
  options: ReportPDFOptions,
  pdfFont: 'Cairo' | 'DejaVu',
  addPageBeforeStart: boolean
): Promise<void> {
  const measureTextMm = (txt: string, pt: number, bold: boolean): number => {
    doc.setFont(pdfFont, bold ? 'bold' : 'normal');
    doc.setFontSize(pt);
    return doc.getTextWidth(prepareArabicPdfText(txt));
  };

  const plan = buildDocumentPaginationPlan(options, { measureTextMm });
  const { tpl, typoPt, pagination, lang, pages, marginTopMm, marginRightMm, marginBottomMm, marginLeftMm, contentWidthMm } =
    plan;
  const isEnDoc = lang === 'en';
  const ptToMm = 0.352778;

  const primaryRgb = hexToRgb(tpl.primaryColor, [15, 23, 42]);
  const accentRgb = hexToRgb(tpl.accentColor, [217, 119, 6]);
  const headerBgRgb = hexToRgb(tpl.tableHeaderBg, [30, 41, 59]);
  const headerTextRgb = hexToRgb(tpl.tableHeaderText, [255, 255, 255]);
  const borderRgb = hexToRgb(tpl.borderColor, [203, 213, 225]);
  const typoColors = plan.typo.colors || {};
  const typoWeights = plan.typo.weights;
  const elemRgb = (key: TypographyElementKey, fallback: [number, number, number]): [number, number, number] =>
    hexToRgb(typoColors[key], fallback);
  const elemStyle = (key: TypographyElementKey, fallback: 'normal' | 'bold'): 'normal' | 'bold' =>
    typoWeights?.[key] === 'bold' ? 'bold' : typoWeights?.[key] === 'normal' ? 'normal' : fallback;
  const totalPages = pages.length;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const footLabel =
    tpl.footerText ||
    options.company?.invoiceFooterNote ||
    (isEnDoc ? 'ALMANSOOR SMART FINANCE ERP' : 'المنصور للأنظمة المالية الذكية ERP');

  const tryEmbedImage = (
    dataUrl: string | undefined,
    x: number,
    iy: number,
    w: number,
    h: number
  ): boolean => {
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
    try {
      const fmtMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp)/i);
      const imgFmt = fmtMatch ? fmtMatch[1].toUpperCase().replace('JPG', 'JPEG') : 'PNG';
      if (imgFmt !== 'PNG' && imgFmt !== 'JPEG' && imgFmt !== 'WEBP') return false;
      doc.addImage(dataUrl, imgFmt, x, iy, w, h, undefined, 'FAST');
      return true;
    } catch {
      return false;
    }
  };

  const drawFullHeader = (contentRight: number): number => {
    const docTitleRgb = elemRgb('documentTitle', headerTextRgb);
    const docTitleStyle = elemStyle('documentTitle', 'bold');
    const compNameRgb = elemRgb('companyName', accentRgb);
    const compNameStyle = elemStyle('companyName', 'bold');
    const compDetRgb = elemRgb('companyDetails', [226, 232, 240]);
    const compDetStyle = elemStyle('companyDetails', 'normal');
    const metaStyle = elemStyle('partyMetadata', 'normal');

    if (!tpl.showHeader) {
      const boxH = Math.max(11, typoPt.documentTitle * ptToMm * 1.9 + 3);
      doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.rect(marginLeftMm, marginTopMm, contentWidthMm, boxH, 'F');
      doc.setFont(pdfFont, docTitleStyle);
      doc.setTextColor(docTitleRgb[0], docTitleRgb[1], docTitleRgb[2]);
      doc.setFontSize(typoPt.documentTitle);
      drawPdfText(
        doc,
        options.title,
        isEnDoc ? marginLeftMm + 4 : contentRight - 4,
        marginTopMm + boxH * 0.65,
        isEnDoc ? 'left' : 'right',
        isEnDoc
      );
      return marginTopMm + boxH + 3;
    }

    const hasBanner = Boolean(
      tpl.useCustomBanner && options.company?.useFullBanner && options.company?.bannerBase64
    );
    if (hasBanner && tryEmbedImage(options.company?.bannerBase64, marginLeftMm, marginTopMm, contentWidthMm, 20)) {
      const barH = Math.max(10, typoPt.documentTitle * ptToMm * 1.6 + 3.5);
      doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.rect(marginLeftMm, marginTopMm + 20.5, contentWidthMm, barH, 'F');
      doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.rect(marginLeftMm, marginTopMm + 20.5 + barH, contentWidthMm, 1, 'F');
      doc.setFont(pdfFont, docTitleStyle);
      doc.setTextColor(docTitleRgb[0], docTitleRgb[1], docTitleRgb[2]);
      doc.setFontSize(typoPt.documentTitle);
      drawPdfText(doc, options.title, contentRight - 4, marginTopMm + 20.5 + barH * 0.65, 'right', isEnDoc);
      doc.setFont(pdfFont, metaStyle);
      doc.setFontSize(typoPt.partyMetadata);
      drawPdfText(
        doc,
        options.periodText || options.reportCode || '',
        marginLeftMm + 4,
        marginTopMm + 20.5 + barH * 0.65,
        'left',
        isEnDoc
      );
      return marginTopMm + 24 + barH;
    }

    const boxH = Math.max(
      22,
      typoPt.companyName * ptToMm * 1.55 +
        (tpl.showCompanyDetails ? typoPt.companyDetails * ptToMm * 2.5 : 0) +
        5
    );
    doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.rect(marginLeftMm, marginTopMm, contentWidthMm, boxH, 'F');
    doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
    doc.rect(marginLeftMm, marginTopMm + boxH, contentWidthMm, 1.2, 'F');

    let logoRightReserve = 4;
    if (tpl.showLogo && options.company?.logoUrl) {
      const logoDim = Math.max(10, Math.min(18, (tpl.logoSizePx || 56) * 0.28));
      const lx = tpl.logoPosition === 'left' ? marginLeftMm + 3 : contentRight - logoDim - 3;
      if (tryEmbedImage(options.company.logoUrl, lx, marginTopMm + 2, logoDim, logoDim)) {
        if (tpl.logoPosition !== 'left') logoRightReserve = logoDim + 6;
      }
    }

    doc.setFont(pdfFont, compNameStyle);
    doc.setTextColor(compNameRgb[0], compNameRgb[1], compNameRgb[2]);
    doc.setFontSize(typoPt.companyName);
    drawPdfText(
      doc,
      options.company?.nameAr || 'المنصور للأنظمة المالية والإدارية الذكية',
      contentRight - logoRightReserve,
      marginTopMm + 7.5,
      'right',
      isEnDoc
    );

    if (tpl.showCompanyDetails) {
      doc.setFont(pdfFont, compDetStyle);
      doc.setTextColor(compDetRgb[0], compDetRgb[1], compDetRgb[2]);
      doc.setFontSize(typoPt.companyDetails);
      const subCompanyParts = [
        options.branch?.nameAr || 'الفرع الرئيسي',
        options.company?.commercialRecord ? `CR: ${options.company.commercialRecord}` : '',
        options.company?.taxNumber ? `TAX: ${options.company.taxNumber}` : '',
        options.company?.phone || '',
      ]
        .filter(Boolean)
        .join('  |  ');
      drawPdfText(
        doc,
        subCompanyParts,
        contentRight - logoRightReserve,
        marginTopMm + boxH * 0.68,
        'right',
        isEnDoc
      );
    }

    const bannerTitleRgb = elemRgb('documentTitle', [255, 255, 255]);
    doc.setFont(pdfFont, docTitleStyle);
    doc.setTextColor(bannerTitleRgb[0], bannerTitleRgb[1], bannerTitleRgb[2]);
    doc.setFontSize(typoPt.documentTitle);
    const titleWrapped = wrapTextToWidthMm(
      options.title,
      contentWidthMm * 0.44,
      typoPt.documentTitle,
      docTitleStyle === 'bold',
      measureTextMm
    );
    drawPdfText(doc, titleWrapped[0], marginLeftMm + 4, marginTopMm + 8, 'left', isEnDoc);

    doc.setFont(pdfFont, metaStyle);
    doc.setTextColor(203, 213, 225);
    doc.setFontSize(typoPt.partyMetadata);
    const leftMeta = options.periodText
      ? `${isEnDoc ? 'Period' : 'الفترة'}: ${options.periodText}`
      : options.subtitle || options.reportCode || '';
    drawPdfText(doc, leftMeta, marginLeftMm + 4, marginTopMm + boxH * 0.68, 'left', isEnDoc);

    return marginTopMm + boxH + 4;
  };

  const drawContinuationHeader = (pageNum: number, contentRight: number): number => {
    const secRgb = elemRgb('sectionHeadings', primaryRgb);
    const secStyle = elemStyle('sectionHeadings', 'bold');
    const stripH = Math.max(6.2, typoPt.sectionHeadings * ptToMm * 1.45 + 1.5);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.rect(marginLeftMm, marginTopMm, contentWidthMm, stripH, 'FD');
    doc.setFont(pdfFont, secStyle);
    doc.setFontSize(typoPt.sectionHeadings);
    doc.setTextColor(secRgb[0], secRgb[1], secRgb[2]);
    drawPdfText(
      doc,
      `${options.title} — ${isEnDoc ? `Continued (Page ${pageNum})` : `تابع (صفحة ${pageNum})`}`,
      isEnDoc ? marginLeftMm + 3 : contentRight - 3,
      marginTopMm + stripH * 0.68,
      isEnDoc ? 'left' : 'right',
      isEnDoc
    );
    return marginTopMm + stripH + 2.5;
  };

  const drawTableChunk = async (
    chunk: ComputedTableChunkBlock,
    startY: number,
    contentRight: number
  ): Promise<number> => {
    let y = startY;
    const colWidths = chunk.colWidthsMm;
    const colCount = Math.max(chunk.headers.length, 1);

    const colLeftAt = (cIdx: number): number => {
      if (isEnDoc) {
        let offset = 0;
        for (let i = 0; i < cIdx; i++) offset += colWidths[i];
        return marginLeftMm + offset;
      }
      let rightOffset = 0;
      for (let i = 0; i <= cIdx; i++) rightOffset += colWidths[i];
      return contentRight - rightOffset;
    };

    const drawColGridLines = (rowY: number, rowH: number, color: [number, number, number]) => {
      doc.setDrawColor(color[0], color[1], color[2]);
      let acc = 0;
      for (let i = 0; i < colCount - 1; i++) {
        acc += colWidths[i];
        const lx = isEnDoc ? marginLeftMm + acc : contentRight - acc;
        doc.line(lx, rowY, lx, rowY + rowH);
      }
    };

    if (chunk.isFirstChunk && chunk.title) {
      const secRgb = elemRgb('sectionHeadings', primaryRgb);
      const secStyle = elemStyle('sectionHeadings', 'bold');
      y += pagination.headingSpacingBeforeMm;
      const barH = Math.max(6.8, typoPt.sectionHeadings * ptToMm * 1.45 + 1.8);
      doc.setFillColor(241, 245, 249);
      doc.rect(marginLeftMm, y, contentWidthMm, barH, 'F');
      doc.setFillColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.rect(isEnDoc ? marginLeftMm : contentRight - 2, y, 2, barH, 'F');
      doc.setFont(pdfFont, secStyle);
      doc.setTextColor(secRgb[0], secRgb[1], secRgb[2]);
      doc.setFontSize(typoPt.sectionHeadings);
      drawPdfText(
        doc,
        chunk.title,
        isEnDoc ? marginLeftMm + 5 : contentRight - 5,
        y + barH * 0.68,
        isEnDoc ? 'left' : 'right',
        isEnDoc
      );
      y += barH + pagination.headingSpacingAfterMm;
    }

    if (chunk.showTableHeader) {
      const thRgb = elemRgb('tableHeaders', headerTextRgb);
      const thStyle = elemStyle('tableHeaders', 'bold');
      const thLineH = Math.max(3.6, typoPt.tableHeaders * ptToMm * 1.45);
      const headerH = chunk.headerHeightMm;
      doc.setFillColor(headerBgRgb[0], headerBgRgb[1], headerBgRgb[2]);
      doc.rect(marginLeftMm, y, contentWidthMm, headerH, 'F');
      drawColGridLines(y, headerH, [71, 85, 105]);
      doc.setFont(pdfFont, thStyle);
      doc.setFontSize(typoPt.tableHeaders);
      doc.setTextColor(thRgb[0], thRgb[1], thRgb[2]);
      chunk.wrappedHeaders.forEach((lines, cIdx) => {
        const cellLeft = colLeftAt(cIdx);
        const w = colWidths[cIdx];
        lines.forEach((ln, lineIdx) => {
          drawPdfText(
            doc,
            ln,
            cellLeft + w / 2,
            y + 1.6 + thLineH * 0.8 + lineIdx * thLineH,
            'center',
            isEnDoc
          );
        });
      });
      y += headerH;
    }

    if (chunk.isEmptyTable) {
      const emptyH = 8.5;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
      doc.rect(marginLeftMm, y, contentWidthMm, emptyH, 'FD');
      doc.setFont(pdfFont, elemStyle('tableCells', 'normal'));
      doc.setFontSize(typoPt.tableCells);
      doc.setTextColor(100, 116, 139);
      drawPdfText(
        doc,
        isEnDoc ? 'No data available' : 'لا توجد بيانات',
        marginLeftMm + contentWidthMm / 2,
        y + 5.6,
        'center',
        isEnDoc
      );
      y += emptyH;
    } else {
      const textCellRgb = elemRgb('tableCells', [30, 41, 59]);
      const numCellRgb = elemRgb('numericValues', [30, 41, 59]);
      const priceCellRgb = elemRgb('priceValues', [15, 23, 42]);
      const textCellStyle = elemStyle('tableCells', 'normal');
      const numCellStyle = elemStyle('numericValues', 'normal');
      const priceCellStyle = elemStyle('priceValues', 'bold');

      for (let i = 0; i < chunk.rows.length; i++) {
        if (i > 0 && i % 100 === 0) await yieldToMain();
        const row = chunk.rows[i];
        if (row.originalIndex % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(marginLeftMm, y, contentWidthMm, row.heightMm, 'F');
        }
        doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
        doc.rect(marginLeftMm, y, contentWidthMm, row.heightMm, 'S');
        drawColGridLines(y, row.heightMm, borderRgb);

        row.wrappedCells.forEach((lines, cIdx) => {
          const isPrice = Boolean(row.isPriceCol?.[cIdx]);
          const isNum = row.isNumericCol[cIdx];
          const cellPt = isPrice
            ? typoPt.priceValues
            : isNum
            ? typoPt.numericValues
            : typoPt.tableCells;
          const cRgb = isPrice ? priceCellRgb : isNum ? numCellRgb : textCellRgb;
          const cStyle = isPrice ? priceCellStyle : isNum ? numCellStyle : textCellStyle;
          const cellLineH = Math.max(3.4, cellPt * ptToMm * 1.45);
          doc.setFont(pdfFont, cStyle);
          doc.setFontSize(cellPt);
          doc.setTextColor(cRgb[0], cRgb[1], cRgb[2]);
          const cellLeft = colLeftAt(cIdx);
          const w = colWidths[cIdx] ?? contentWidthMm / colCount;
          const alignPref = row.alignments[cIdx] || 'center';

          lines.forEach((ln, lineIdx) => {
            const ty = y + 1.3 + cellLineH * 0.78 + lineIdx * cellLineH;
            if (alignPref === 'right') {
              drawPdfText(doc, ln, cellLeft + w - 1.5, ty, 'right', isEnDoc);
            } else if (alignPref === 'left') {
              drawPdfText(doc, ln, cellLeft + 1.5, ty, 'left', isEnDoc);
            } else {
              drawPdfText(doc, ln, cellLeft + w / 2, ty, 'center', isEnDoc);
            }
          });
        });

        y += row.heightMm;
      }
    }

    if (chunk.totals) {
      const totRgb = elemRgb('totalsAndSummary', [120, 53, 15]);
      const totStyle = elemStyle('totalsAndSummary', 'bold');
      const totH = chunk.totals.heightMm;
      const totLineH = Math.max(3.8, typoPt.totalsAndSummary * ptToMm * 1.48);
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
      doc.rect(marginLeftMm, y, contentWidthMm, totH, 'FD');
      drawColGridLines(y, totH, accentRgb);
      doc.setFont(pdfFont, totStyle);
      doc.setFontSize(typoPt.totalsAndSummary);
      doc.setTextColor(totRgb[0], totRgb[1], totRgb[2]);
      chunk.totals.wrappedCells.forEach((lines, cIdx) => {
        const cellLeft = colLeftAt(cIdx);
        const w = colWidths[cIdx] ?? contentWidthMm / colCount;
        lines.forEach((ln, lineIdx) => {
          drawPdfText(
            doc,
            ln,
            cellLeft + w / 2,
            y + 1.5 + totLineH * 0.78 + lineIdx * totLineH,
            'center',
            isEnDoc
          );
        });
      });
      y += totH;
    }

    if (chunk.isFinalChunk) {
      y += pagination.tableSpacingMm;
    }
    return y;
  };

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    if (pIdx > 0 || addPageBeforeStart) {
      doc.addPage(plan.format, plan.orientation);
    }
    doc.setFont(pdfFont, 'normal');

    const page = pages[pIdx];
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const contentRight = pageW - marginRightMm;

    let y =
      page.headerKind === 'full'
        ? drawFullHeader(contentRight)
        : page.headerKind === 'continuation'
        ? drawContinuationHeader(page.pageNumber, contentRight)
        : marginTopMm;

    for (const block of page.blocks) {
      if (block.kind === 'metadata') {
        const cols = contentWidthMm >= 145 ? 2 : 1;
        const colW = contentWidthMm / cols;
        const metaLineH = Math.max(3.6, typoPt.partyMetadata * ptToMm * 1.48);
        const metaStyle = elemStyle('partyMetadata', 'normal');
        const metaRgb = elemRgb('partyMetadata', primaryRgb);
        doc.setFont(pdfFont, metaStyle);
        doc.setFontSize(typoPt.partyMetadata);

        const metaPairs = block.entries.map(([k, v]) => {
          const wrapped = wrapTextToWidthMm(
            `${k.replace(/_/g, ' ')}: ${v}`,
            colW - 6,
            typoPt.partyMetadata,
            metaStyle === 'bold',
            measureTextMm
          );
          return { lines: wrapped, height: wrapped.length * metaLineH + 1.8 };
        });

        const rowHeights: number[] = [];
        for (let i = 0; i < metaPairs.length; i += cols) {
          const h1 = metaPairs[i]?.height || 5;
          const h2 = cols === 2 ? metaPairs[i + 1]?.height || 0 : 0;
          rowHeights.push(Math.max(h1, h2));
        }
        const boxH = rowHeights.reduce((s, h) => s + h, 0) + 4;
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
        doc.rect(marginLeftMm, y, contentWidthMm, boxH, 'FD');

        let curMetaY = y + 4.5;
        for (let r = 0; r < rowHeights.length; r++) {
          for (let c = 0; c < cols; c++) {
            const item = metaPairs[r * cols + c];
            if (!item) continue;
            const cellX = isEnDoc ? marginLeftMm + c * colW + 4 : contentRight - c * colW - 4;
            doc.setTextColor(metaRgb[0], metaRgb[1], metaRgb[2]);
            item.lines.forEach((ln, lIdx) => {
              drawPdfText(
                doc,
                ln,
                cellX,
                curMetaY + lIdx * metaLineH,
                isEnDoc ? 'left' : 'right',
                isEnDoc
              );
            });
          }
          curMetaY += rowHeights[r];
        }
        y += boxH + 3.5;
      } else if (block.kind === 'table-chunk') {
        y = await drawTableChunk(block, y, contentRight);
      } else if (block.kind === 'summary-cards') {
        const cols = contentWidthMm >= 145 ? 3 : 2;
        const gap = 3;
        const cardW = (contentWidthMm - gap * (cols - 1)) / cols;
        const hasSub = block.cards.some((c) => Boolean(c.subValue) || (c.value || '').includes(' | '));
        const valLineH = Math.max(4.4, typoPt.finalAmounts * ptToMm * 1.45);
        const subLineH = Math.max(3.6, typoPt.notes * ptToMm * 1.38);
        const cardH = Math.max(
          hasSub ? 15 : 11,
          4.5 + subLineH + valLineH + (hasSub ? subLineH + 1.5 : 0)
        );
        const rowsCount = Math.ceil(block.cards.length / cols);
        const finalRgb = elemRgb('finalAmounts', primaryRgb);
        const finalStyle = elemStyle('finalAmounts', 'bold');

        for (let r = 0; r < rowsCount; r++) {
          for (let c = 0; c < cols; c++) {
            const card = block.cards[r * cols + c];
            if (!card) continue;
            const cx = isEnDoc
              ? marginLeftMm + c * (cardW + gap)
              : contentRight - (c + 1) * cardW - c * gap;
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
            doc.rect(cx, y, cardW, cardH, 'FD');

            doc.setFont(pdfFont, 'normal');
            doc.setFontSize(typoPt.notes);
            doc.setTextColor(71, 85, 105);
            const labelLines = wrapTextToWidthMm(card.label, cardW - 4, typoPt.notes, false, measureTextMm);
            drawPdfText(
              doc,
              labelLines[0],
              isEnDoc ? cx + 2 : cx + cardW - 2,
              y + 4.2,
              isEnDoc ? 'left' : 'right',
              isEnDoc
            );

            const parts =
              !card.subValue && (card.value || '').includes(' | ')
                ? card.value.split(' | ').map((x) => x.trim()).filter(Boolean)
                : [card.value, ...(card.subValue ? [card.subValue] : [])];

            doc.setFont(pdfFont, finalStyle);
            doc.setFontSize(typoPt.finalAmounts);
            doc.setTextColor(finalRgb[0], finalRgb[1], finalRgb[2]);
            const p1Lines = wrapTextToWidthMm(
              parts[0] || '',
              cardW - 4,
              typoPt.finalAmounts,
              finalStyle === 'bold',
              measureTextMm
            );
            drawPdfText(
              doc,
              p1Lines[0],
              isEnDoc ? cx + 2 : cx + cardW - 2,
              y + 4.8 + valLineH,
              isEnDoc ? 'left' : 'right',
              isEnDoc
            );

            if (parts[1]) {
              doc.setFont(pdfFont, 'normal');
              doc.setFontSize(typoPt.notes);
              doc.setTextColor(51, 65, 85);
              const p2Lines = wrapTextToWidthMm(parts[1], cardW - 4, typoPt.notes, false, measureTextMm);
              drawPdfText(
                doc,
                p2Lines[0],
                isEnDoc ? cx + 2 : cx + cardW - 2,
                y + 5.5 + valLineH + subLineH,
                isEnDoc ? 'left' : 'right',
                isEnDoc
              );
            }
          }
          y += cardH + 2.5;
        }
        y += 2;
      } else if (block.kind === 'notes') {
        const noteLineH = Math.max(3.8, typoPt.notes * ptToMm * 1.48);
        const noteRgb = elemRgb('notes', [22, 101, 52]);
        const noteStyle = elemStyle('notes', 'normal');
        doc.setFont(pdfFont, noteStyle);
        doc.setFontSize(typoPt.notes);
        const noteLines = wrapTextToWidthMm(
          `${isEnDoc ? 'Notes' : 'ملاحظات'}: ${block.text}`,
          contentWidthMm - 8,
          typoPt.notes,
          noteStyle === 'bold',
          measureTextMm
        );
        const noteH = noteLines.length * noteLineH + 4.5;
        doc.setFillColor(240, 253, 244);
        doc.setDrawColor(187, 247, 208);
        doc.rect(marginLeftMm, y, contentWidthMm, noteH, 'FD');
        doc.setTextColor(noteRgb[0], noteRgb[1], noteRgb[2]);
        noteLines.forEach((ln, idx) => {
          drawPdfText(
            doc,
            ln,
            isEnDoc ? marginLeftMm + 4 : contentRight - 4,
            y + 4.5 + idx * noteLineH,
            isEnDoc ? 'left' : 'right',
            isEnDoc
          );
        });
        y += noteH + 3.5;
      } else if (block.kind === 'signatures') {
        if (block.showSignatures) {
          const sigRgb = elemRgb('signatures', primaryRgb);
          const sigStyle = elemStyle('signatures', 'bold');
          const sigW = (contentWidthMm - (block.showStamp ? 24 : 0)) / 3;
          const sigH = Math.max(15, typoPt.signatures * ptToMm * 2.5 + 8);
          const labels = block.signatureLabels || ['إعداد / المحاسب', 'المراجعة والتدقيق', 'اعتماد الإدارة'];
          const sigTitles = isEnDoc ? ['Prepared By', 'Reviewed By', 'Approved By'] : labels;
          const sigNames = isEnDoc
            ? [block.preparedBy || 'Financial Accountant', 'Chief Accountant', 'General Manager']
            : [block.preparedBy || 'المحاسب المالي', 'رئيس الحسابات', 'المدير العام'];

          for (let idx = 0; idx < 3; idx++) {
            const sx = isEnDoc ? marginLeftMm + idx * sigW : contentRight - (idx + 1) * sigW;
            doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
            doc.rect(sx + 1.5, y, sigW - 3, sigH, 'S');
            doc.setFont(pdfFont, sigStyle);
            doc.setTextColor(71, 85, 105);
            doc.setFontSize(typoPt.signatures);
            drawPdfText(doc, sigTitles[idx] || '', sx + sigW / 2, y + 5, 'center', isEnDoc);
            doc.setFont(pdfFont, 'normal');
            doc.setTextColor(sigRgb[0], sigRgb[1], sigRgb[2]);
            drawPdfText(doc, sigNames[idx], sx + sigW / 2, y + sigH - 3.5, 'center', isEnDoc);
          }

          if (block.showStamp) {
            const stX = isEnDoc ? contentRight - 11 : marginLeftMm + 11;
            const stY = y + sigH / 2;
            doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
            doc.circle(stX, stY, 8.5, 'S');
            doc.circle(stX, stY, 7.2, 'S');
            doc.setFont(pdfFont, 'bold');
            doc.setFontSize(5.5);
            doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
            drawPdfText(doc, isEnDoc ? 'VERIFIED' : 'معتمد', stX, stY + 1, 'center', isEnDoc);
          }
          y += sigH + 3;
        } else if (block.showStamp) {
          const stX = isEnDoc ? contentRight - 12 : marginLeftMm + 12;
          const stY = y + 9;
          doc.setDrawColor(accentRgb[0], accentRgb[1], accentRgb[2]);
          doc.circle(stX, stY, 8.5, 'S');
          doc.setFont(pdfFont, 'bold');
          doc.setFontSize(6);
          doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
          drawPdfText(doc, isEnDoc ? 'VERIFIED' : 'معتمد', stX, stY + 1, 'center', isEnDoc);
          y += 19;
        }
      }
    }

    // Footer & Page Numbers
    if (tpl.showFooter || tpl.showPageNumbers) {
      const footY = pageH - Math.max(4.5, marginBottomMm * 0.5);
      doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
      doc.line(marginLeftMm, footY - 4, contentRight, footY - 4);
      if (tpl.showFooter) {
        const footRgb = elemRgb('footer', [100, 116, 139]);
        doc.setTextColor(footRgb[0], footRgb[1], footRgb[2]);
        doc.setFont(pdfFont, elemStyle('footer', 'normal'));
        doc.setFontSize(typoPt.footer);
        drawPdfText(doc, `${footLabel} | ${stamp}`, contentRight, footY, 'right', isEnDoc);
      }
      if (tpl.showPageNumbers) {
        const pnRgb = elemRgb('pageNumbers', [100, 116, 139]);
        doc.setTextColor(pnRgb[0], pnRgb[1], pnRgb[2]);
        doc.setFont(pdfFont, elemStyle('pageNumbers', 'bold'));
        doc.setFontSize(typoPt.pageNumbers);
        drawPdfText(
          doc,
          isEnDoc ? `Page ${page.pageNumber} of ${totalPages}` : `صفحة ${page.pageNumber} من ${totalPages}`,
          marginLeftMm,
          footY,
          'left',
          isEnDoc
        );
      }
    }
  }
}

/**
 * Generates a multi-page executive PDF for any ReportPDFOptions structure.
 */
export async function buildReportPdfBytes(options: ReportPDFOptions): Promise<Uint8Array> {
  const tpl = resolveEffectivePrintTemplate({
    docType: options.docType,
    title: options.title,
    printTemplate: options.printTemplate,
    printTemplates: options.printTemplates,
  });
  const maxCols = Math.max(...options.tables.map((t) => t.headers.length), 4);
  const { format, orientation } = resolveDocGeometry(tpl, maxCols);
  const preferCairo = tpl.fontFamily !== 'DejaVu';
  const { doc, fontName } = await createArabicDoc(orientation, format, preferCairo);

  doc.setProperties({
    title: options.title,
    subject: options.subtitle || 'ALMANSOOR SMART FINANCE ERP',
    author: options.company?.nameAr || 'Almansoor ERP',
    creator: 'Almansoor Smart Finance ERP PDF Engine',
  });

  await renderReportIntoDoc(doc, options, fontName, false);

  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

/**
 * Generates a unified multi-document PDF batch where every document starts on its own page
 * with independent headers, totals, signatures, and isolated per-document page numbering.
 */
export async function buildBatchReportPdfBytes(docs: ReportPDFOptions[]): Promise<Uint8Array> {
  if (!docs || docs.length === 0) {
    return buildReportPdfBytes({
      title: 'دفعة مستندات فارغة',
      tables: [],
    });
  }
  if (docs.length === 1) {
    return buildReportPdfBytes(docs[0]);
  }

  const first = docs[0];
  const firstTpl = resolveEffectivePrintTemplate({
    docType: first.docType,
    title: first.title,
    printTemplate: first.printTemplate,
    printTemplates: first.printTemplates,
  });
  const firstMaxCols = Math.max(...first.tables.map((t) => t.headers.length), 4);
  const firstGeo = resolveDocGeometry(firstTpl, firstMaxCols);
  const { doc } = await createArabicDoc(firstGeo.orientation, firstGeo.format, firstTpl.fontFamily !== 'DejaVu');

  doc.setProperties({
    title: `طباعة دفعة مستندات (${docs.length})`,
    subject: 'ALMANSOOR SMART FINANCE ERP Batch Document Print',
    author: first.company?.nameAr || 'Almansoor ERP',
    creator: 'Almansoor Smart Finance ERP Batch PDF Engine',
  });

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const tpl = resolveEffectivePrintTemplate({
      docType: d.docType,
      title: d.title,
      printTemplate: d.printTemplate,
      printTemplates: d.printTemplates,
    });
    const activeFont = await registerFontOnExistingDoc(doc, tpl.fontFamily !== 'DejaVu');
    await renderReportIntoDoc(doc, d, activeFont, i > 0);
  }

  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

/**
 * Generates a genuine binary PDF document for Sales / Purchase / Return Invoices.
 */
export async function buildInvoicePdfBytes(
  invoice: Invoice,
  company?: Company,
  branch?: Branch,
  warehouseName?: string,
  printTemplate?: PrintTemplateConfig
): Promise<Uint8Array> {
  const docLabel =
    invoice.type === 'مبيعات'
      ? 'فاتورة مبيعات'
      : invoice.type === 'مشتريات'
      ? 'فاتورة مشتريات'
      : invoice.type === 'مرتجع_مبيعات'
      ? 'إشعار مرتجع مبيعات'
      : 'إشعار مرتجع مشتريات';

  const statusLabel =
    invoice.status === 'posted'
      ? 'مرحلة / معتمدة'
      : invoice.status === 'paid'
      ? 'مدفوعة بالكامل'
      : invoice.status === 'partial'
      ? 'مدفوعة جزئياً'
      : invoice.status === 'cancelled'
      ? 'ملغاة / معكوسة'
      : 'مسودة';

  const partyLabel =
    invoice.type === 'مشتريات' || invoice.type === 'مرتجع_مشتريات' ? 'المورد' : 'العميل';

  const rows = invoice.items.map((item, idx) => [
    String(idx + 1),
    item.itemName,
    item.unit,
    String(item.quantity + (item.bonusQuantity ? ` (+${item.bonusQuantity})` : '')),
    `${pdfNum(item.unitPrice)}`,
    `${pdfNum(item.discountAmount)}`,
    `${pdfNum(item.taxAmount)}`,
    `${pdfNum(item.total)} ${invoice.currency}`,
  ]);

  const invCurr = invoice.currency || 'YER';
  const invRate =
    invoice.exchangeRate && invoice.exchangeRate > 1
      ? invoice.exchangeRate
      : invCurr === 'SAR'
      ? 142
      : invCurr === 'USD'
      ? 535
      : 1;
  const formatBalSnapshot = (baseVal?: number) => {
    if (baseVal === undefined) return '-';
    if (invCurr !== 'YER' && invRate > 1) {
      const nativeBal = Math.round((baseVal / invRate) * 100) / 100;
      return `${pdfNum(nativeBal)} ${invCurr} (${pdfNum(baseVal)} YER)`;
    }
    return `${pdfNum(baseVal)} YER`;
  };

  return buildReportPdfBytes({
    docType: 'invoice',
    printTemplate,
    title: `${docLabel} #${invoice.invoiceNumber}`,
    subtitle: `${partyLabel}: ${invoice.entityName}`,
    reportCode: invoice.invoiceNumber,
    periodText: invoice.date,
    company,
    branch,
    preparedBy: invoice.createdBy || 'مسؤول المبيعات',
    notes: invoice.notes,
    metadata: {
      'رقم المستند': invoice.invoiceNumber,
      'التاريخ': invoice.date,
      [partyLabel]: invoice.entityName,
      'نوع الدفع': invoice.paymentType,
      'العملة وسعر الصرف': `${invCurr} (${invRate})`,
      'المستودع': warehouseName || invoice.warehouseId,
      'الحالة': statusLabel,
      'الرصيد السابق': formatBalSnapshot(invoice.previousBalanceSnapshot),
      'الرصيد بعد الفاتورة': formatBalSnapshot(invoice.newBalanceSnapshot),
    },
    tables: [
      {
        title: 'بنود الفاتورة التفصيلية',
        headers: ['#', 'اسم الصنف', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الخصم', 'الضريبة', 'الإجمالي'],
        rows,
        alignments: ['center', 'right', 'center', 'center', 'center', 'center', 'center', 'center'],
        totals: [
          '',
          'الإجماليات',
          '',
          String(invoice.items.reduce((s, i) => s + i.quantity + (i.bonusQuantity || 0), 0)),
          '',
          pdfNum(invoice.discountTotal),
          pdfNum(invoice.taxTotal),
          `${pdfNum(invoice.grandTotal)} ${invoice.currency}`,
        ],
      },
      {
        title: 'ملخص السداد والاستحقاق',
        headers: ['المجموع الفرعي', 'الخصم', 'الضريبة', 'الصافي النهائي', 'المدفوع', 'المتبقي'],
        rows: [
          [
            `${pdfNum(invoice.subtotal)} ${invoice.currency}`,
            `${pdfNum(invoice.discountTotal)} ${invoice.currency}`,
            `${pdfNum(invoice.taxTotal)} ${invoice.currency}`,
            `${pdfNum(invoice.grandTotal)} ${invoice.currency}`,
            `${pdfNum(invoice.paidAmount)} ${invoice.currency}`,
            `${pdfNum(invoice.remainingAmount)} ${invoice.currency}`,
          ],
        ],
        alignments: ['center', 'center', 'center', 'center', 'center', 'center'],
      },
    ],
  });
}

/**
 * Generates a genuine binary PDF document for Receipt / Payment Vouchers.
 */
export async function buildVoucherPdfBytes(
  voucher: PaymentVoucher,
  company?: Company,
  branch?: Branch,
  printTemplate?: PrintTemplateConfig
): Promise<Uint8Array> {
  const title =
    voucher.type === 'قبض'
      ? `سند قبض مالي #${voucher.voucherNumber}`
      : `سند صرف مالي #${voucher.voucherNumber}`;
  return buildReportPdfBytes({
    docType: 'voucher',
    printTemplate,
    title,
    subtitle: `${voucher.entityType}: ${voucher.entityName}`,
    reportCode: voucher.voucherNumber,
    periodText: voucher.date,
    company,
    branch,
    preparedBy: voucher.createdBy || 'أمين الصندوق',
    notes: voucher.statement,
    metadata: {
      'رقم السند': voucher.voucherNumber,
      'نوع السند': voucher.type === 'قبض' ? 'سند قبض' : 'سند صرف',
      'التاريخ': voucher.date,
      'الطرف / الحساب': `${voucher.entityType} - ${voucher.entityName}`,
      'الخزينة / البنك': voucher.treasuryAccountName,
      'طريقة الدفع': voucher.paymentMethod.replace(/_/g, ' '),
      'العملة وسعر الصرف': `${voucher.currency} (${voucher.exchangeRate})`,
      'الحالة': voucher.status === 'posted' ? 'مرحل ومعتمد' : 'ملغى',
      'المستلم / المحصل': voucher.receivedOrPaidBy || '-',
    },
    tables: [
      {
        title: 'بيانات القيمة المالية للسند',
        headers: ['رقم السند', 'البيان', 'المبلغ بالعملة', 'المعادل بالأساس (YER)', 'المرجع'],
        rows: [
          [
            voucher.voucherNumber,
            voucher.statement || '-',
            `${pdfNum(voucher.amount)} ${voucher.currency}`,
            `${pdfNum(voucher.baseAmount)} YER`,
            voucher.linkedInvoiceNumber || voucher.checkNumber || voucher.transferReference || '-',
          ],
        ],
        alignments: ['center', 'right', 'center', 'center', 'center'],
      },
    ],
  });
}
