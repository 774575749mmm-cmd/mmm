/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Unified Print Template Resolver, Typography Converter & Column Visibility Filter
 */

import {
  IntelligentPaginationConfig,
  PrintDocumentType,
  PrintTemplateConfig,
  TypographyUnit,
} from '../types/erp';
import {
  defaultPrintTemplates,
  getDefaultPagination,
  getDefaultTypography,
} from './storageService';

let activePrintTemplatesRegistry: Partial<Record<PrintDocumentType, PrintTemplateConfig>> | undefined;

export function setActivePrintTemplates(
  templates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>
): void {
  activePrintTemplatesRegistry = templates;
}

export function getActivePrintTemplates():
  | Partial<Record<PrintDocumentType, PrintTemplateConfig>>
  | undefined {
  return activePrintTemplatesRegistry;
}

export function inferPrintDocType(title?: string, explicit?: PrintDocumentType): PrintDocumentType {
  if (explicit) return explicit;
  const raw = (title || '').trim();
  if (/كشف حساب|كشف أرصدة|statement/i.test(raw)) return 'statement';
  if (/فاتورة|مرتجع مبيعات|مرتجع مشتريات|invoice/i.test(raw)) return 'invoice';
  if (/سند قبض|سند صرف|مناقلة مالية|voucher|receipt/i.test(raw)) return 'voucher';
  return 'report';
}

export function toPt(value: number, unit: TypographyUnit = 'pt'): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 9;
  const pt = unit === 'px' ? num * 0.75 : num;
  return Math.max(5.5, Math.min(36, Math.round(pt * 100) / 100));
}

export function toPx(value: number, unit: TypographyUnit = 'pt'): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 12;
  const px = unit === 'pt' ? num * (96 / 72) : num;
  return Math.max(7, Math.min(48, Math.round(px * 100) / 100));
}

export function toCssFontSize(value: number, unit: TypographyUnit = 'pt'): string {
  const num = Number(value);
  const safe = Number.isFinite(num) && num > 0 ? Math.max(5, Math.min(48, num)) : 9;
  return `${safe}${unit === 'px' ? 'px' : 'pt'}`;
}

export interface ResolvedPrintTypography {
  unit: TypographyUnit;
  companyName: number;
  documentTitle: number;
  sectionHeadings: number;
  companyDetails: number;
  partyMetadata: number;
  tableHeaders: number;
  tableCells: number;
  numericValues: number;
  priceValues: number;
  totalsAndSummary: number;
  finalAmounts: number;
  notes: number;
  signatures: number;
  footer: number;
  pageNumbers: number;
  colors: Partial<Record<import('../types/erp').TypographyElementKey, string>>;
  weights: Record<import('../types/erp').TypographyElementKey, 'normal' | 'bold'>;
}

const DEFAULT_WEIGHTS: Record<import('../types/erp').TypographyElementKey, 'normal' | 'bold'> = {
  companyName: 'bold',
  documentTitle: 'bold',
  sectionHeadings: 'bold',
  companyDetails: 'normal',
  partyMetadata: 'normal',
  tableHeaders: 'bold',
  tableCells: 'normal',
  numericValues: 'normal',
  priceValues: 'bold',
  totalsAndSummary: 'bold',
  finalAmounts: 'bold',
  notes: 'normal',
  signatures: 'bold',
  footer: 'normal',
  pageNumbers: 'bold',
};

export function resolveEffectiveTypography(tpl: PrintTemplateConfig): ResolvedPrintTypography {
  const def = getDefaultTypography(tpl.docType || 'report');
  const t = tpl.typography;
  if (!t) {
    // Legacy scale compatibility when template predates per-element typography
    const legacyScale = Math.max(0.75, Math.min(1.5, (Number(tpl.fontSizePt) || 10) / 10));
    const s = (n: number) => Math.round(n * legacyScale * 10) / 10;
    return {
      unit: 'pt',
      companyName: s(def.companyName),
      documentTitle: s(def.documentTitle),
      sectionHeadings: s(def.sectionHeadings),
      companyDetails: s(def.companyDetails),
      partyMetadata: s(def.partyMetadata),
      tableHeaders: s(def.tableHeaders),
      tableCells: s(def.tableCells),
      numericValues: s(def.numericValues),
      priceValues: s(def.priceValues),
      totalsAndSummary: s(def.totalsAndSummary),
      finalAmounts: s(def.finalAmounts),
      notes: s(def.notes),
      signatures: s(def.signatures),
      footer: s(def.footer),
      pageNumbers: s(def.pageNumbers),
      colors: {},
      weights: { ...DEFAULT_WEIGHTS },
    };
  }
  const legacySig = t.signaturesAndFooter;
  return {
    unit: t.unit === 'px' ? 'px' : 'pt',
    companyName: Number(t.companyName) || def.companyName,
    documentTitle: Number(t.documentTitle) || def.documentTitle,
    sectionHeadings: Number(t.sectionHeadings) || def.sectionHeadings,
    companyDetails: Number(t.companyDetails) || def.companyDetails,
    partyMetadata: Number(t.partyMetadata) || def.partyMetadata,
    tableHeaders: Number(t.tableHeaders) || def.tableHeaders,
    tableCells: Number(t.tableCells) || def.tableCells,
    numericValues: Number(t.numericValues) || def.numericValues,
    priceValues: Number(t.priceValues) || Number(t.numericValues) || def.priceValues,
    totalsAndSummary: Number(t.totalsAndSummary) || def.totalsAndSummary,
    finalAmounts: Number(t.finalAmounts) || Number(t.totalsAndSummary) || def.finalAmounts,
    notes: Number(t.notes) || def.notes,
    signatures: Number(t.signatures) || Number(legacySig) || def.signatures,
    footer: Number(t.footer) || Number(legacySig) || def.footer,
    pageNumbers: Number(t.pageNumbers) || def.pageNumbers,
    colors: { ...(def.colors || {}), ...(t.colors || {}) },
    weights: { ...DEFAULT_WEIGHTS, ...(def.weights || {}), ...(t.weights || {}) },
  };
}

export function resolveEffectivePagination(tpl: PrintTemplateConfig): IntelligentPaginationConfig {
  const def = getDefaultPagination(tpl.docType || 'report');
  const p = tpl.pagination;
  return {
    minimumRowsBeforeTableBreak: Math.max(
      1,
      Math.min(20, Math.round(Number(p?.minimumRowsBeforeTableBreak ?? def.minimumRowsBeforeTableBreak)))
    ),
    keepHeadingWithTable: p?.keepHeadingWithTable ?? def.keepHeadingWithTable,
    preventRowSplit: p?.preventRowSplit ?? def.preventRowSplit,
    allowMultipleTablesPerPage: p?.allowMultipleTablesPerPage ?? def.allowMultipleTablesPerPage,
    keepShortTableTogetherMaxRows: Math.max(
      1,
      Math.min(15, Math.round(Number(p?.keepShortTableTogetherMaxRows ?? def.keepShortTableTogetherMaxRows)))
    ),
    tableSpacingMm: Math.max(1, Math.min(20, Number(p?.tableSpacingMm ?? def.tableSpacingMm))),
    headingSpacingBeforeMm: Math.max(
      0,
      Math.min(15, Number(p?.headingSpacingBeforeMm ?? def.headingSpacingBeforeMm))
    ),
    headingSpacingAfterMm: Math.max(
      0,
      Math.min(15, Number(p?.headingSpacingAfterMm ?? def.headingSpacingAfterMm))
    ),
  };
}

export function resolveEffectivePrintTemplate(options: {
  docType?: PrintDocumentType;
  title?: string;
  printTemplate?: PrintTemplateConfig;
  printTemplates?: Partial<Record<PrintDocumentType, PrintTemplateConfig>>;
}): PrintTemplateConfig {
  const docType = inferPrintDocType(options.title, options.docType);
  const base = defaultPrintTemplates[docType] || defaultPrintTemplates.report;
  const fromMap = options.printTemplates?.[docType] || activePrintTemplatesRegistry?.[docType];
  const merged: PrintTemplateConfig = {
    ...base,
    ...(fromMap || {}),
    ...(options.printTemplate || {}),
    fontFamily:
      options.printTemplate?.fontFamily ||
      fromMap?.fontFamily ||
      base.fontFamily ||
      'Cairo',
    repeatHeaderOnPages:
      options.printTemplate?.repeatHeaderOnPages ??
      fromMap?.repeatHeaderOnPages ??
      base.repeatHeaderOnPages ??
      false,
    repeatTableHeader:
      options.printTemplate?.repeatTableHeader ??
      fromMap?.repeatTableHeader ??
      base.repeatTableHeader ??
      true,
    hiddenColumns:
      options.printTemplate?.hiddenColumns ??
      fromMap?.hiddenColumns ??
      base.hiddenColumns ??
      [],
    typography: {
      ...(base.typography || getDefaultTypography(docType)),
      ...(fromMap?.typography || {}),
      ...(options.printTemplate?.typography || {}),
    },
    pagination: {
      ...(base.pagination || getDefaultPagination(docType)),
      ...(fromMap?.pagination || {}),
      ...(options.printTemplate?.pagination || {}),
    },
  };
  return merged;
}

export function applyTemplateColumnVisibility<
  T extends {
    title?: string;
    headers: string[];
    rows: (string | number)[][];
    totals?: (string | number)[];
    alignments?: ('right' | 'center' | 'left')[];
  }
>(table: T, hiddenColumns?: string[]): T {
  if (!hiddenColumns || hiddenColumns.length === 0 || table.headers.length <= 1) {
    return table;
  }
  const normalizedHidden = hiddenColumns
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedHidden.length === 0) return table;

  const keepIndices: number[] = [];
  table.headers.forEach((header, idx) => {
    const norm = String(header ?? '').trim().toLowerCase();
    const shouldHide = normalizedHidden.some((h) => norm === h || norm.includes(h));
    if (!shouldHide) {
      keepIndices.push(idx);
    }
  });

  if (keepIndices.length === 0 || keepIndices.length === table.headers.length) {
    return table;
  }

  return {
    ...table,
    headers: keepIndices.map((i) => table.headers[i]),
    rows: table.rows.map((row) => keepIndices.map((i) => row[i] ?? '')),
    totals: table.totals ? keepIndices.map((i) => table.totals![i] ?? '') : undefined,
    alignments: table.alignments ? keepIndices.map((i) => table.alignments![i] || 'center') : undefined,
  };
}
