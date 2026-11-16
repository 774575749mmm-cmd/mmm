/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Unified Print & PDF Template Designer
 * Features:
 * - Explicit Draft vs Saved Baseline model with verified "حفظ التغييرات" & "إلغاء التغييرات"
 * - 15-Element Independent Typography Control (pt/px + +/- Steppers + Presets + Weight B + Color Override)
 * - Intelligent Table Pagination Controls + Multi-Table Preview + Real Print/PDF Sync
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Printer,
  FileDown,
  RotateCcw,
  Copy,
  Eye,
  LayoutTemplate,
  Palette,
  FileCheck2,
  Maximize2,
  Type,
  SplitSquareVertical,
  Save,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import {
  Branch,
  Company,
  IntelligentPaginationConfig,
  PrintDocumentType,
  PrintOrientation,
  PrintPaperSize,
  PrintTemplateConfig,
  PrintTypographyConfig,
  SystemSettings,
  TypographyElementKey,
  TypographyUnit,
} from '../../../types/erp';
import {
  defaultPrintTemplates,
  getDefaultPagination,
  getDefaultTypography,
  PersistenceResult,
  resolveCompanyPrintTemplates,
} from '../../../services/storageService';
import {
  buildDocumentPaginationPlan,
  downloadReportAsPDF,
  generatePrintableHTML,
  printReportPreview,
  ReportPDFOptions,
  resolveEffectivePagination,
  resolveEffectivePrintTemplate,
  resolveEffectiveTypography,
} from '../../../services/exportService';
import { AppLanguage } from '../../../services/i18n';

interface PrintTemplateDesignerProps {
  company: Company;
  branch: Branch;
  settings: SystemSettings;
  canManageSettings?: boolean;
  lang?: AppLanguage;
  onSaveTemplates: (
    map: Record<PrintDocumentType, PrintTemplateConfig>
  ) => Promise<PersistenceResult | { ok: boolean; error?: string }>;
  onDirtyChange?: (dirty: boolean) => void;
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const DOC_TYPE_TABS: { id: PrintDocumentType; labelAr: string; labelEn: string }[] = [
  { id: 'invoice', labelAr: 'قالب الفواتير', labelEn: 'Invoices Template' },
  { id: 'voucher', labelAr: 'قالب السندات', labelEn: 'Vouchers Template' },
  { id: 'statement', labelAr: 'قالب كشوفات الحساب', labelEn: 'Statements Template' },
  { id: 'report', labelAr: 'قالب التقارير العامة', labelEn: 'Reports Template' },
];

const TYPOGRAPHY_FIELDS: {
  key: TypographyElementKey;
  labelAr: string;
  labelEn: string;
  minPt: number;
  maxPt: number;
}[] = [
  { key: 'companyName', labelAr: 'اسم المنشأة في الترويسة', labelEn: 'Company Name', minPt: 9, maxPt: 26 },
  { key: 'documentTitle', labelAr: 'عنوان المستند الرئيسي', labelEn: 'Document Title', minPt: 8, maxPt: 24 },
  { key: 'sectionHeadings', labelAr: 'العناوين الرئيسية والفرعية', labelEn: 'Section Headings', minPt: 7, maxPt: 20 },
  { key: 'companyDetails', labelAr: 'بيانات المنشأة', labelEn: 'Company Details', minPt: 6, maxPt: 16 },
  { key: 'partyMetadata', labelAr: 'بيانات العميل أو المورد', labelEn: 'Party Metadata', minPt: 6, maxPt: 16 },
  { key: 'tableHeaders', labelAr: 'رؤوس الجداول', labelEn: 'Table Headers', minPt: 6, maxPt: 18 },
  { key: 'tableCells', labelAr: 'محتوى خلايا الجداول', labelEn: 'Table Cells Text', minPt: 6, maxPt: 18 },
  { key: 'numericValues', labelAr: 'الأرقام والكميات', labelEn: 'Quantities & Numbers', minPt: 6, maxPt: 18 },
  { key: 'priceValues', labelAr: 'الأسعار والقيم النقدية', labelEn: 'Prices & Monetary Cols', minPt: 6, maxPt: 19 },
  { key: 'totalsAndSummary', labelAr: 'صفوف الإجماليات بالجداول', labelEn: 'Table Totals Row', minPt: 7, maxPt: 20 },
  { key: 'finalAmounts', labelAr: 'المبالغ النهائية بالملخص', labelEn: 'Final Summary Amounts', minPt: 8, maxPt: 24 },
  { key: 'notes', labelAr: 'الملاحظات', labelEn: 'Notes Box', minPt: 6, maxPt: 16 },
  { key: 'signatures', labelAr: 'خانات التوقيعات', labelEn: 'Signatures Block', minPt: 6, maxPt: 15 },
  { key: 'footer', labelAr: 'نص التذييل السفلي', labelEn: 'Footer Text', minPt: 6, maxPt: 15 },
  { key: 'pageNumbers', labelAr: 'أرقام الصفحات', labelEn: 'Page Numbers', minPt: 6, maxPt: 15 },
];

type NumericTypographyFields = Record<TypographyElementKey, number>;

const COMPACT_PRESET_PT: NumericTypographyFields = {
  companyName: 12,
  documentTitle: 10.5,
  sectionHeadings: 9,
  companyDetails: 7,
  partyMetadata: 7.5,
  tableHeaders: 7.5,
  tableCells: 7.5,
  numericValues: 7.5,
  priceValues: 8,
  totalsAndSummary: 8.5,
  finalAmounts: 9.5,
  notes: 7.5,
  signatures: 7,
  footer: 7,
  pageNumbers: 7,
};

const COMFORTABLE_PRESET_PT: NumericTypographyFields = {
  companyName: 17,
  documentTitle: 14,
  sectionHeadings: 12,
  companyDetails: 9.5,
  partyMetadata: 10,
  tableHeaders: 10.5,
  tableCells: 10.5,
  numericValues: 10.5,
  priceValues: 11,
  totalsAndSummary: 11.5,
  finalAmounts: 13,
  notes: 10,
  signatures: 9.5,
  footer: 9,
  pageNumbers: 9,
};

function convertUnitValue(val: number, from: TypographyUnit, to: TypographyUnit): number {
  if (from === to) return val;
  const converted = from === 'pt' ? (val * 96) / 72 : (val * 72) / 96;
  return Math.round(converted * 2) / 2;
}

function cloneTemplatesMap(
  src: Record<PrintDocumentType, PrintTemplateConfig>
): Record<PrintDocumentType, PrintTemplateConfig> {
  return JSON.parse(JSON.stringify(src)) as Record<PrintDocumentType, PrintTemplateConfig>;
}

export const PrintTemplateDesigner: React.FC<PrintTemplateDesignerProps> = ({
  company,
  branch,
  settings,
  canManageSettings = true,
  lang = 'ar',
  onSaveTemplates,
  onDirtyChange,
  onNotify,
}) => {
  const isEn = lang === 'en';
  const [activeDocType, setActiveDocType] = useState<PrintDocumentType>('invoice');
  const [sampleMode, setSampleMode] = useState<'standard' | 'multipage'>('standard');
  const [busyPdf, setBusyPdf] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fontReadyTick, setFontReadyTick] = useState(0);

  const initialResolved = useMemo(
    () => resolveCompanyPrintTemplates(settings, company.id),
    [settings, company.id]
  );

  const [savedBaseline, setSavedBaseline] = useState<Record<PrintDocumentType, PrintTemplateConfig>>(
    () => cloneTemplatesMap(initialResolved)
  );
  const [draftMap, setDraftMap] = useState<Record<PrintDocumentType, PrintTemplateConfig>>(
    () => cloneTemplatesMap(initialResolved)
  );

  const prevCompanyIdRef = useRef(company.id);

  const dirtyDocTypes = useMemo(() => {
    const dirty: PrintDocumentType[] = [];
    for (const dt of ['invoice', 'voucher', 'statement', 'report'] as PrintDocumentType[]) {
      if (JSON.stringify(draftMap[dt]) !== JSON.stringify(savedBaseline[dt])) {
        dirty.push(dt);
      }
    }
    return dirty;
  }, [draftMap, savedBaseline]);

  const hasAnyUnsavedChanges = dirtyDocTypes.length > 0;
  const isCurrentDocDirty = dirtyDocTypes.includes(activeDocType);

  // Sync baseline cleanly when switching company or when clean and external DB updated
  useEffect(() => {
    if (prevCompanyIdRef.current !== company.id) {
      prevCompanyIdRef.current = company.id;
      const nextResolved = cloneTemplatesMap(initialResolved);
      setSavedBaseline(nextResolved);
      setDraftMap(cloneTemplatesMap(nextResolved));
      setSaveError(null);
      return;
    }
    if (!hasAnyUnsavedChanges) {
      const nextStr = JSON.stringify(initialResolved);
      const curStr = JSON.stringify(savedBaseline);
      if (nextStr !== curStr) {
        const synced = cloneTemplatesMap(initialResolved);
        setSavedBaseline(synced);
        setDraftMap(cloneTemplatesMap(synced));
      }
    }
  }, [company.id, initialResolved, hasAnyUnsavedChanges, savedBaseline]);

  useEffect(() => {
    onDirtyChange?.(hasAnyUnsavedChanges);
  }, [hasAnyUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    if (!hasAnyUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasAnyUnsavedChanges]);

  useEffect(() => {
    let active = true;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (active) setFontReadyTick((n) => n + 1);
      });
    }
    return () => {
      active = false;
    };
  }, []);

  const currentTpl: PrintTemplateConfig = useMemo(
    () =>
      resolveEffectivePrintTemplate({
        docType: activeDocType,
        printTemplates: draftMap,
      }),
    [activeDocType, draftMap]
  );

  const currentTypo = useMemo(() => resolveEffectiveTypography(currentTpl), [currentTpl]);
  const currentPagination = useMemo(() => resolveEffectivePagination(currentTpl), [currentTpl]);

  const updateDraftTemplate = (patch: Partial<PrintTemplateConfig>) => {
    if (!canManageSettings) return;
    setSaveError(null);
    setDraftMap((prev) => ({
      ...prev,
      [activeDocType]: {
        ...resolveEffectivePrintTemplate({ docType: activeDocType, printTemplates: prev }),
        ...patch,
        docType: activeDocType,
      },
    }));
  };

  const buildFullTypographyDraft = (): PrintTypographyConfig => ({
    unit: currentTypo.unit,
    companyName: currentTypo.companyName,
    documentTitle: currentTypo.documentTitle,
    sectionHeadings: currentTypo.sectionHeadings,
    companyDetails: currentTypo.companyDetails,
    partyMetadata: currentTypo.partyMetadata,
    tableHeaders: currentTypo.tableHeaders,
    tableCells: currentTypo.tableCells,
    numericValues: currentTypo.numericValues,
    priceValues: currentTypo.priceValues,
    totalsAndSummary: currentTypo.totalsAndSummary,
    finalAmounts: currentTypo.finalAmounts,
    notes: currentTypo.notes,
    signatures: currentTypo.signatures,
    footer: currentTypo.footer,
    pageNumbers: currentTypo.pageNumbers,
    colors: { ...(currentTypo.colors || {}) },
    weights: { ...(currentTypo.weights || {}) },
  });

  const updateTypographyField = (key: TypographyElementKey, rawVal: number) => {
    if (!canManageSettings) return;
    const unit = currentTypo.unit;
    const minVal = unit === 'px' ? 7 : 5.5;
    const maxVal = unit === 'px' ? 38 : 28;
    const clamped = Math.min(
      maxVal,
      Math.max(minVal, Number.isFinite(rawVal) ? rawVal : currentTypo[key])
    );
    const rounded = Math.round(clamped * 2) / 2;
    const baseDraft = buildFullTypographyDraft();
    baseDraft[key] = rounded;

    const nextBasePt =
      key === 'tableCells'
        ? Math.min(16, Math.max(7.5, unit === 'px' ? (rounded * 72) / 96 : rounded))
        : currentTpl.fontSizePt;

    updateDraftTemplate({ typography: baseDraft, fontSizePt: Math.round(nextBasePt * 10) / 10 });
  };

  const updateTypographyWeight = (key: TypographyElementKey) => {
    if (!canManageSettings) return;
    const baseDraft = buildFullTypographyDraft();
    const cur = baseDraft.weights?.[key] || 'normal';
    baseDraft.weights = {
      ...(baseDraft.weights || {}),
      [key]: cur === 'bold' ? 'normal' : 'bold',
    };
    updateDraftTemplate({ typography: baseDraft });
  };

  const updateTypographyColor = (key: TypographyElementKey, hexColor?: string) => {
    if (!canManageSettings) return;
    const baseDraft = buildFullTypographyDraft();
    const nextColors = { ...(baseDraft.colors || {}) };
    if (!hexColor) {
      delete nextColors[key];
    } else {
      nextColors[key] = hexColor;
    }
    baseDraft.colors = nextColors;
    updateDraftTemplate({ typography: baseDraft });
  };

  const handleUnitChange = (newUnit: TypographyUnit) => {
    if (!canManageSettings || newUnit === currentTypo.unit) return;
    const oldUnit = currentTypo.unit;
    const baseDraft = buildFullTypographyDraft();
    const nextTypo: PrintTypographyConfig = {
      ...baseDraft,
      unit: newUnit,
      companyName: convertUnitValue(currentTypo.companyName, oldUnit, newUnit),
      documentTitle: convertUnitValue(currentTypo.documentTitle, oldUnit, newUnit),
      sectionHeadings: convertUnitValue(currentTypo.sectionHeadings, oldUnit, newUnit),
      companyDetails: convertUnitValue(currentTypo.companyDetails, oldUnit, newUnit),
      partyMetadata: convertUnitValue(currentTypo.partyMetadata, oldUnit, newUnit),
      tableHeaders: convertUnitValue(currentTypo.tableHeaders, oldUnit, newUnit),
      tableCells: convertUnitValue(currentTypo.tableCells, oldUnit, newUnit),
      numericValues: convertUnitValue(currentTypo.numericValues, oldUnit, newUnit),
      priceValues: convertUnitValue(currentTypo.priceValues, oldUnit, newUnit),
      totalsAndSummary: convertUnitValue(currentTypo.totalsAndSummary, oldUnit, newUnit),
      finalAmounts: convertUnitValue(currentTypo.finalAmounts, oldUnit, newUnit),
      notes: convertUnitValue(currentTypo.notes, oldUnit, newUnit),
      signatures: convertUnitValue(currentTypo.signatures, oldUnit, newUnit),
      footer: convertUnitValue(currentTypo.footer, oldUnit, newUnit),
      pageNumbers: convertUnitValue(currentTypo.pageNumbers, oldUnit, newUnit),
    };
    updateDraftTemplate({ typography: nextTypo });
  };

  const handleApplyTypographyPreset = (preset: 'compact' | 'default' | 'comfortable') => {
    if (!canManageSettings) return;
    const defTypo = getDefaultTypography(activeDocType);
    const sourceNums: NumericTypographyFields =
      preset === 'compact'
        ? COMPACT_PRESET_PT
        : preset === 'comfortable'
        ? COMFORTABLE_PRESET_PT
        : {
            companyName: defTypo.companyName,
            documentTitle: defTypo.documentTitle,
            sectionHeadings: defTypo.sectionHeadings,
            companyDetails: defTypo.companyDetails,
            partyMetadata: defTypo.partyMetadata,
            tableHeaders: defTypo.tableHeaders,
            tableCells: defTypo.tableCells,
            numericValues: defTypo.numericValues,
            priceValues: defTypo.priceValues,
            totalsAndSummary: defTypo.totalsAndSummary,
            finalAmounts: defTypo.finalAmounts,
            notes: defTypo.notes,
            signatures: defTypo.signatures,
            footer: defTypo.footer,
            pageNumbers: defTypo.pageNumbers,
          };

    const targetUnit = currentTypo.unit;
    const finalTypo: PrintTypographyConfig = {
      unit: targetUnit,
      companyName:
        targetUnit === 'px' ? convertUnitValue(sourceNums.companyName, 'pt', 'px') : sourceNums.companyName,
      documentTitle:
        targetUnit === 'px' ? convertUnitValue(sourceNums.documentTitle, 'pt', 'px') : sourceNums.documentTitle,
      sectionHeadings:
        targetUnit === 'px' ? convertUnitValue(sourceNums.sectionHeadings, 'pt', 'px') : sourceNums.sectionHeadings,
      companyDetails:
        targetUnit === 'px' ? convertUnitValue(sourceNums.companyDetails, 'pt', 'px') : sourceNums.companyDetails,
      partyMetadata:
        targetUnit === 'px' ? convertUnitValue(sourceNums.partyMetadata, 'pt', 'px') : sourceNums.partyMetadata,
      tableHeaders:
        targetUnit === 'px' ? convertUnitValue(sourceNums.tableHeaders, 'pt', 'px') : sourceNums.tableHeaders,
      tableCells:
        targetUnit === 'px' ? convertUnitValue(sourceNums.tableCells, 'pt', 'px') : sourceNums.tableCells,
      numericValues:
        targetUnit === 'px' ? convertUnitValue(sourceNums.numericValues, 'pt', 'px') : sourceNums.numericValues,
      priceValues:
        targetUnit === 'px' ? convertUnitValue(sourceNums.priceValues, 'pt', 'px') : sourceNums.priceValues,
      totalsAndSummary:
        targetUnit === 'px' ? convertUnitValue(sourceNums.totalsAndSummary, 'pt', 'px') : sourceNums.totalsAndSummary,
      finalAmounts:
        targetUnit === 'px' ? convertUnitValue(sourceNums.finalAmounts, 'pt', 'px') : sourceNums.finalAmounts,
      notes: targetUnit === 'px' ? convertUnitValue(sourceNums.notes, 'pt', 'px') : sourceNums.notes,
      signatures:
        targetUnit === 'px' ? convertUnitValue(sourceNums.signatures, 'pt', 'px') : sourceNums.signatures,
      footer: targetUnit === 'px' ? convertUnitValue(sourceNums.footer, 'pt', 'px') : sourceNums.footer,
      pageNumbers:
        targetUnit === 'px' ? convertUnitValue(sourceNums.pageNumbers, 'pt', 'px') : sourceNums.pageNumbers,
      colors: preset === 'default' ? {} : { ...(currentTypo.colors || {}) },
      weights: preset === 'default' ? { ...(defTypo.weights || {}) } : { ...(currentTypo.weights || {}) },
    };

    updateDraftTemplate({
      typography: finalTypo,
      fontSizePt: sourceNums.tableCells,
    });
    onNotify(
      'info',
      preset === 'compact'
        ? 'تم تطبيق حزمة الخطوط المدمجة في المسودة الحية. اضغط "حفظ التغييرات" للتثبيت.'
        : preset === 'comfortable'
        ? 'تم تطبيق حزمة الخطوط المكبرة في المسودة الحية. اضغط "حفظ التغييرات" للتثبيت.'
        : 'تم تجهيز أحجام الخطوط الافتراضية في المسودة الحية. اضغط "حفظ التغييرات" للتثبيت.'
    );
  };

  const updatePaginationField = <K extends keyof IntelligentPaginationConfig>(
    key: K,
    val: IntelligentPaginationConfig[K]
  ) => {
    if (!canManageSettings) return;
    updateDraftTemplate({
      pagination: {
        ...currentPagination,
        [key]: val,
      },
    });
  };

  const handleResetPagination = () => {
    if (!canManageSettings) return;
    updateDraftTemplate({ pagination: getDefaultPagination(activeDocType) });
    onNotify('info', 'تمت استعادة إعدادات التوزيع الذكي الافتراضية في المسودة.');
  };

  const handleResetCurrent = () => {
    if (!canManageSettings) return;
    setSaveError(null);
    const def = JSON.parse(JSON.stringify(defaultPrintTemplates[activeDocType])) as PrintTemplateConfig;
    setDraftMap((prev) => ({
      ...prev,
      [activeDocType]: def,
    }));
    onNotify(
      'info',
      isEn
        ? 'Default settings loaded into live draft. Click Save Changes to persist.'
        : 'تمت استعادة الإعدادات الافتراضية في المسودة الحية. اضغط "حفظ التغييرات" لتثبيتها.'
    );
  };

  const handleDiscardChanges = () => {
    setSaveError(null);
    setDraftMap(cloneTemplatesMap(savedBaseline));
    onNotify(
      'info',
      isEn ? 'Unsaved draft changes discarded.' : 'تم إلغاء التغييرات غير المحفوظة والعودة إلى آخر نسخة محفوظة.'
    );
  };

  const handleSaveChanges = async () => {
    if (!canManageSettings || isSaving) return;
    setSaveError(null);
    setIsSaving(true);
    try {
      const normalizedToSave: Record<PrintDocumentType, PrintTemplateConfig> = {
        invoice: resolveEffectivePrintTemplate({ docType: 'invoice', printTemplates: draftMap }),
        voucher: resolveEffectivePrintTemplate({ docType: 'voucher', printTemplates: draftMap }),
        statement: resolveEffectivePrintTemplate({ docType: 'statement', printTemplates: draftMap }),
        report: resolveEffectivePrintTemplate({ docType: 'report', printTemplates: draftMap }),
      };
      const res = await onSaveTemplates(normalizedToSave);
      if (!res || !res.ok) {
        const errMsg = res?.error || 'تعذر حفظ القوالب في التخزين الدائم. يرجى المحاولة مرة أخرى.';
        setSaveError(errMsg);
        onNotify('error', errMsg);
        return;
      }
      const committed = cloneTemplatesMap(normalizedToSave);
      setSavedBaseline(committed);
      setDraftMap(cloneTemplatesMap(committed));
      onNotify(
        'success',
        isEn
          ? 'Print templates saved and persisted cleanly.'
          : 'تم حفظ التغييرات وتثبيتها نهائياً لجميع القوالب (المعاينة + الطباعة + PDF).'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء الحفظ.';
      setSaveError(msg);
      onNotify('error', msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyToAll = () => {
    if (!canManageSettings) return;
    setSaveError(null);
    const snap = resolveEffectivePrintTemplate({ docType: activeDocType, printTemplates: draftMap });
    const nextMap: Record<PrintDocumentType, PrintTemplateConfig> = {
      invoice: {
        ...JSON.parse(JSON.stringify(snap)),
        id: 'tpl-invoice',
        nameAr: defaultPrintTemplates.invoice.nameAr,
        docType: 'invoice',
      },
      voucher: {
        ...JSON.parse(JSON.stringify(snap)),
        id: 'tpl-voucher',
        nameAr: defaultPrintTemplates.voucher.nameAr,
        docType: 'voucher',
      },
      statement: {
        ...JSON.parse(JSON.stringify(snap)),
        id: 'tpl-statement',
        nameAr: defaultPrintTemplates.statement.nameAr,
        docType: 'statement',
      },
      report: {
        ...JSON.parse(JSON.stringify(snap)),
        id: 'tpl-report',
        nameAr: defaultPrintTemplates.report.nameAr,
        docType: 'report',
      },
    };
    setDraftMap(nextMap);
    onNotify(
      'info',
      isEn
        ? 'Applied style & typography to all document drafts. Click Save Changes to persist.'
        : 'تم تعميم التنسيق والخطوط على مسودات القوالب الأربعة. اضغط "حفظ التغييرات" للتثبيت النهائي.'
    );
  };

  const sampleReportOptions = useMemo((): ReportPDFOptions => {
    const today = new Date().toISOString().split('T')[0];

    if (sampleMode === 'multipage') {
      const bulkRows = Array.from({ length: 34 }, (_, idx) => [
        String(idx + 1),
        idx % 5 === 0
          ? `صنف أجهزة شبكات وسيرفرات مؤسسية متكامل مع ملحقات التوصيل والضمان الممتد لمدة عامين — دفعة #${idx + 1}`
          : `مستلزمات ومواد تشغيلية قياسية — البند رقم ${idx + 1}`,
        idx % 2 === 0 ? 'حبة' : 'كرتون',
        String((idx % 6) + 1),
        (25000 + idx * 1750).toLocaleString('en-US'),
        ((25000 + idx * 1750) * ((idx % 6) + 1)).toLocaleString('en-US'),
      ]);
      return {
        title: 'تقرير اختبار التوزيع الذكي والخطوط (34 بنداً + جدولان)',
        subtitle: 'معاينة التوزيع المتوازن ومنع الأسطر اليتيمة وانقسام الصفوف',
        reportCode: 'PAG-TEST-34',
        periodText: `التاريخ: ${today}`,
        metadata: {
          الفرع: branch.nameAr,
          العملة: 'ريال يمني (YER)',
          نظام_الترقيم: 'ذكي متزامن HTML + PDF',
        },
        tables: [
          {
            title: 'الجدول الأول: سجل الأصناف التفصيلي (34 صفاً)',
            headers: ['#', 'الصنف والوصف التفصيلي', 'الوحدة', 'الكمية', 'سعر الوحدة', 'الإجمالي'],
            rows: bulkRows,
            totals: ['-', 'الإجمالي العام للأصناف', '', '119', '', '2,140,000 ر.ي'],
          },
          {
            title: 'الجدول الثاني: ملخص التوزيع الضريبي والخصومات',
            headers: ['الفئة', 'العدد', 'القيمة الخاضعة', 'الضريبة', 'الصافي'],
            rows: [
              ['مبيعات نقدية مباشرة', '18', '1,120,000', '56,000', '1,176,000'],
              ['مبيعات آجلة معتمدة', '16', '964,000', '0', '964,000'],
            ],
            totals: ['الإجمالي', '34', '2,084,000', '56,000', '2,140,000'],
          },
        ],
        summaryCards: [
          { label: 'إجمالي القيمة', value: '2,140,000 ر.ي', tone: 'gold' },
          { label: 'الضريبة المستحقة', value: '56,000 ر.ي', tone: 'blue' },
          { label: 'عدد الصفوف الكلي', value: '36 صفاً', tone: 'green' },
        ],
        notes: 'يتغير عدد الصفحات ومواقع كسر الجداول تلقائياً فور تعديل أي حجم خط أو تعديل الحد الأدنى لصفوف الجدول.',
        company,
        branch,
        lang,
        docType: activeDocType,
        printTemplate: currentTpl,
        fileName: 'Pagination_Typography_Test',
      };
    }

    if (activeDocType === 'voucher') {
      return {
        title: 'سند قبض رسمي — معاينة القالب',
        subtitle: 'معاينة مطابقة للطباعة والـ PDF',
        reportCode: 'RV-TEST-001',
        periodText: `التاريخ: ${today}`,
        metadata: {
          المستلم_من: 'شركة النخبة للتجارة والمقاولات',
          الصندوق: 'الصندوق الرئيسي (ريال يمني)',
          وسيلة_الدفع: 'نقداً',
          البيان: 'دفعة تحت الحساب وفق الفاتورة رقم SAL-1042',
        },
        summaryCards: [
          { label: 'مبلغ السند', value: '250,000 ر.ي', tone: 'gold' },
          { label: 'الرصيد السابق', value: '750,000 ر.ي', tone: 'blue' },
          { label: 'الرصيد بعد السند', value: '500,000 ر.ي', tone: 'green' },
        ],
        tables: [
          {
            title: 'تفاصيل السند المحاسبي',
            headers: ['#', 'الحساب / الطرف', 'العملة', 'المبلغ', 'المعادل باليمني', 'البيان'],
            rows: [['1', 'شركة النخبة للتجارة', 'YER', '250,000', '250,000', 'سداد دفعة من الرصيد']],
            totals: ['-', 'الإجمالي', '', '250,000', '250,000 ر.ي', ''],
          },
        ],
        notes: 'مستند معاينة لاختبار التنسيق والخطوط الـ 15 والألوان والهوامش والترويسة والختم والتوقيعات.',
        company,
        branch,
        lang,
        docType: 'voucher',
        printTemplate: currentTpl,
        fileName: 'Template_Preview_Voucher',
      };
    }

    if (activeDocType === 'statement') {
      return {
        title: 'كشف حساب تفصيلي — معاينة القالب',
        subtitle: 'مقارنة المدين والدائن والرصيد التراكمي',
        reportCode: 'STMT-TEST',
        periodText: `حتى تاريخ: ${today}`,
        metadata: {
          الحساب: 'مؤسسة الأفق التجارية',
          العملة: 'SAR / YER',
          عدد_الحركات: '4 حركات',
        },
        summaryCards: [
          { label: 'إجمالي مدين', value: '1,200,000 ر.ي', tone: 'blue' },
          { label: 'إجمالي دائن', value: '450,000 ر.ي', tone: 'green' },
          { label: 'الرصيد الختامي', value: '750,000 ر.ي', tone: 'gold' },
        ],
        tables: [
          {
            title: 'سجل الحركات المالية',
            headers: ['التاريخ', 'نوع المستند', 'الرقم', 'البيان', 'مدين', 'دائن', 'الرصيد'],
            rows: [
              ['2026-01-01', 'رصيد افتتاحي', 'OP-BAL', 'الرصيد الافتتاحي للحساب', '200,000', '-', '200,000'],
              ['2026-02-10', 'فاتورة مبيعات', 'SAL-1001', 'بضاعة متنوعة بالآجل', '1,000,000', '-', '1,200,000'],
              ['2026-02-15', 'سند قبض', 'RV-0018', 'دفعة نقدية مستلمة', '-', '450,000', '750,000'],
            ],
            totals: ['الإجمالي', '3 حركات', '', '', '1,200,000', '450,000', '750,000'],
          },
        ],
        company,
        branch,
        lang,
        docType: 'statement',
        printTemplate: currentTpl,
        fileName: 'Template_Preview_Statement',
      };
    }

    return {
      title: activeDocType === 'invoice' ? 'فاتورة مبيعات ضريبية — معاينة القالب' : 'تقرير مالي شامل — معاينة القالب',
      subtitle: company.nameEn,
      reportCode: activeDocType === 'invoice' ? 'SAL-TEST-1042' : 'RPT-TEST-01',
      periodText: `التاريخ: ${today}`,
      metadata: {
        العميل_أو_القسم: 'شركة الرواد الحديثة للتجارة',
        المستودع: branch.nameAr,
        طريقة_الدفع: 'نقدي / آجل',
        العملة: 'ريال يمني (YER)',
      },
      summaryCards: [
        { label: 'الإجمالي الصافي', value: '485,000 ر.ي', tone: 'gold' },
        { label: 'المدفوع نقداً', value: '285,000 ر.ي', tone: 'green' },
        { label: 'المتبقي ذمم', value: '200,000 ر.ي', tone: 'red' },
      ],
      tables: [
        {
          title: 'تفاصيل البنود والأصناف',
          headers: ['#', 'الصنف / الوصف', 'الوحدة', 'الكمية', 'السعر', 'الضريبة', 'الإجمالي'],
          rows: [
            ['1', 'شاشة عرض مكتبية LED 27 بوصة عالية الدقة', 'حبة', '2', '120,000', '0', '240,000'],
            ['2', 'طابعة ليزرية شبكية سريعة متعددة المهام', 'حبة', '1', '185,000', '0', '185,000'],
            ['3', 'جهاز قارئ باركود لاسلكي ثنائي الأبعاد', 'حبة', '2', '30,000', '0', '60,000'],
          ],
          totals: ['-', 'الإجمالي المستحق', '', '5', '', '0', '485,000 ر.ي'],
        },
      ],
      notes: 'تخضع كافة الأصناف لسياسة الضمان المحددة في الفاتورة الرسمية.',
      company,
      branch,
      lang,
      docType: activeDocType,
      printTemplate: currentTpl,
      fileName: `Template_Preview_${activeDocType}`,
    };
  }, [activeDocType, sampleMode, company, branch, lang, currentTpl]);

  const paginationPlan = useMemo(() => {
    void fontReadyTick;
    return buildDocumentPaginationPlan(sampleReportOptions);
  }, [sampleReportOptions, fontReadyTick]);

  const previewHtml = useMemo(() => {
    void fontReadyTick;
    return generatePrintableHTML({ ...sampleReportOptions, forPreview: true });
  }, [sampleReportOptions, fontReadyTick]);

  const handleTestPdf = async () => {
    try {
      setBusyPdf(true);
      await downloadReportAsPDF(sampleReportOptions);
      onNotify('success', isEn ? 'Test PDF downloaded successfully.' : 'تم تنزيل ملف PDF التجريبي بالقالب المصمم.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر إنشاء PDF الاختباري.');
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <div className="space-y-3 text-xs" dir={isEn ? 'ltr' : 'rtl'}>
      {!canManageSettings && (
        <div className="bg-amber-950/60 border border-amber-500/60 text-amber-200 rounded-lg px-3 py-2 flex items-center gap-2 font-bold">
          <Lock className="w-4 h-4 shrink-0 text-amber-400" />
          <span>
            وضع العرض فقط: لا يملك هذا المستخدم صلاحية تعديل إعدادات النظام والقوالب. يمكنك فقط معاينة القوالب وطباعتها.
          </span>
        </div>
      )}

      {saveError && (
        <div className="bg-rose-950/70 border border-rose-500 text-rose-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-2 font-bold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>فشل الحفظ الفعلي: {saveError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-xs underline text-rose-300 cursor-pointer"
          >
            إخفاء
          </button>
        </div>
      )}

      {/* Document Type Switcher & Save/Action Bar */}
      <div className="v20-card p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <LayoutTemplate className="w-4 h-4 text-[var(--gold)] ml-1" />
            {DOC_TYPE_TABS.map((tab) => {
              const tabDirty = dirtyDocTypes.includes(tab.id);
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveDocType(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-black cursor-pointer transition flex items-center gap-1.5 ${
                    activeDocType === tab.id
                      ? 'bg-[var(--gold)] text-[#03060A]'
                      : 'bg-[#08121E] border border-[var(--border-strong)] text-white hover:border-[var(--gold)]'
                  }`}
                >
                  <span>{isEn ? tab.labelEn : tab.labelAr}</span>
                  {tabDirty && (
                    <span
                      className={`w-2 h-2 rounded-full ${
                        activeDocType === tab.id ? 'bg-rose-700' : 'bg-amber-400'
                      }`}
                      title="يحتوي هذا القالب على تعديلات غير محفوظة"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {hasAnyUnsavedChanges ? (
              <span className="px-2.5 py-1 rounded bg-amber-950/70 border border-amber-500/70 text-amber-300 font-black flex items-center gap-1 text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>تغييرات غير محفوظة — مسودة حية ({dirtyDocTypes.length})</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 font-bold flex items-center gap-1 text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>تم الحفظ والتثبيت</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              disabled={!hasAnyUnsavedChanges || !canManageSettings || isSaving}
              onClick={handleSaveChanges}
              className={`px-4 py-1.5 rounded-md font-black flex items-center gap-1.5 transition cursor-pointer ${
                hasAnyUnsavedChanges && canManageSettings
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-900/40'
                  : 'bg-slate-800 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'جاري التحقق والحفظ...' : 'حفظ التغييرات'}</span>
            </button>

            <button
              type="button"
              disabled={!hasAnyUnsavedChanges || !canManageSettings || isSaving}
              onClick={handleDiscardChanges}
              className="px-3 py-1.5 rounded-md bg-[#08121E] border border-rose-500/60 text-rose-300 disabled:opacity-40 disabled:cursor-not-allowed font-bold flex items-center gap-1 cursor-pointer hover:bg-rose-950/40"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>إلغاء التغييرات</span>
            </button>

            <button
              type="button"
              disabled={!canManageSettings || isSaving}
              onClick={handleResetCurrent}
              className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-[var(--border-strong)] text-slate-200 disabled:opacity-40 font-bold flex items-center gap-1 cursor-pointer hover:border-rose-400"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>استعادة الإعدادات الافتراضية</span>
            </button>

            <button
              type="button"
              disabled={!canManageSettings || isSaving}
              onClick={handleApplyToAll}
              className="px-2.5 py-1.5 rounded-md bg-[#08121E] border border-sky-500/60 text-sky-300 disabled:opacity-40 font-bold flex items-center gap-1 cursor-pointer hover:border-[var(--gold)]"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>تعميم على كل القوالب</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => printReportPreview(sampleReportOptions)}
              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-[#03060A] font-black flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isEn ? 'Test Print' : 'اختبار الطباعة'}</span>
            </button>
            <button
              type="button"
              disabled={busyPdf}
              onClick={handleTestPdf}
              className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-black flex items-center gap-1 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>{busyPdf ? 'جاري التوليد...' : isEn ? 'Test PDF' : 'اختبار تنزيل PDF'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Designer Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* Controls Panel */}
        <div
          className={`xl:col-span-5 v20-card p-3.5 space-y-3.5 max-h-[850px] overflow-y-auto ${
            !canManageSettings ? 'opacity-80 pointer-events-none select-none' : ''
          }`}
        >
          {/* Section 1: Paper Size, Orientation & Margins */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
            <h4 className="font-black text-[var(--gold)] flex items-center gap-1.5">
              <Maximize2 className="w-3.5 h-3.5" />
              <span>مقاس الورق، الاتجاه والهوامش (mm)</span>
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">مقاس الورق:</label>
                <select
                  value={currentTpl.paperSize}
                  onChange={(e) => updateDraftTemplate({ paperSize: e.target.value as PrintPaperSize })}
                  className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
                >
                  <option value="A4">A4 قياسي (210 × 297 mm)</option>
                  <option value="A3">A3 عريض (297 × 420 mm)</option>
                  <option value="LETTER">Letter (215.9 × 279.4 mm)</option>
                  <option value="CUSTOM">مقاس مخصص (عرض × ارتفاع)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">اتجاه الصفحة:</label>
                <select
                  value={currentTpl.orientation}
                  onChange={(e) => updateDraftTemplate({ orientation: e.target.value as PrintOrientation })}
                  className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
                >
                  <option value="portrait">عمودي (Portrait)</option>
                  <option value="landscape">أفقي (Landscape)</option>
                  <option value="auto">تلقائي حسب الأعمدة (Auto)</option>
                </select>
              </div>
            </div>

            {currentTpl.paperSize === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">العرض المخصص (mm):</label>
                  <input
                    type="number"
                    min={50}
                    max={600}
                    value={currentTpl.customWidthMm || 210}
                    onChange={(e) =>
                      updateDraftTemplate({ customWidthMm: Math.max(50, Number(e.target.value) || 210) })
                    }
                    className="w-full v20-input px-2 py-1 text-center tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">الارتفاع المخصص (mm):</label>
                  <input
                    type="number"
                    min={50}
                    max={900}
                    value={currentTpl.customHeightMm || 297}
                    onChange={(e) =>
                      updateDraftTemplate({ customHeightMm: Math.max(50, Number(e.target.value) || 297) })
                    }
                    className="w-full v20-input px-2 py-1 text-center tabular-nums"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2 pt-1">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">أعلى (mm)</label>
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={currentTpl.marginTopMm}
                  onChange={(e) =>
                    updateDraftTemplate({ marginTopMm: Math.max(2, Number(e.target.value) || 10) })
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">يمين (mm)</label>
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={currentTpl.marginRightMm}
                  onChange={(e) =>
                    updateDraftTemplate({ marginRightMm: Math.max(2, Number(e.target.value) || 10) })
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">أسفل (mm)</label>
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={currentTpl.marginBottomMm}
                  onChange={(e) =>
                    updateDraftTemplate({ marginBottomMm: Math.max(2, Number(e.target.value) || 10) })
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">يسار (mm)</label>
                <input
                  type="number"
                  min={2}
                  max={40}
                  value={currentTpl.marginLeftMm}
                  onChange={(e) =>
                    updateDraftTemplate({ marginLeftMm: Math.max(2, Number(e.target.value) || 10) })
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Section 2: 15-Element Independent Typography + Weight + Color Control */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-black text-[var(--gold)] flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5" />
                <span>التحكم المستقل بكل عناصر النص ({TYPOGRAPHY_FIELDS.length} عنصراً)</span>
              </h4>
              <div className="flex items-center gap-1">
                {(['pt', 'px'] as TypographyUnit[]).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => handleUnitChange(u)}
                    className={`px-2 py-0.5 rounded text-[11px] font-black cursor-pointer transition ${
                      currentTypo.unit === u
                        ? 'bg-[var(--gold)] text-[#03060A]'
                        : 'bg-[#0B1624] text-slate-300 border border-[var(--border-strong)]'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleApplyTypographyPreset('compact')}
                className="px-2 py-1 rounded bg-[#0B1624] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[10px] font-bold text-slate-200 cursor-pointer"
              >
                حزمة مدمجة (تقارير طويلة)
              </button>
              <button
                type="button"
                onClick={() => handleApplyTypographyPreset('default')}
                className="px-2 py-1 rounded bg-[#0B1624] border border-sky-500/40 hover:border-[var(--gold)] text-[10px] font-bold text-sky-300 cursor-pointer"
              >
                افتراضي متوازن
              </button>
              <button
                type="button"
                onClick={() => handleApplyTypographyPreset('comfortable')}
                className="px-2 py-1 rounded bg-[#0B1624] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[10px] font-bold text-amber-200 cursor-pointer"
              >
                حزمة مكبرة واضحة
              </button>
            </div>

            {/* 15 Granular Element Controls */}
            <div className="space-y-1.5 pt-1">
              {TYPOGRAPHY_FIELDS.map((field) => {
                const val = currentTypo[field.key];
                const minV = currentTypo.unit === 'px' ? Math.round((field.minPt * 96) / 72) : field.minPt;
                const maxV = currentTypo.unit === 'px' ? Math.round((field.maxPt * 96) / 72) : field.maxPt;
                const weight = currentTypo.weights?.[field.key] || 'normal';
                const customColor = currentTypo.colors?.[field.key];
                return (
                  <div
                    key={field.key}
                    data-typo-key={field.key}
                    className="bg-[#08121E] border border-slate-800 rounded px-2 py-1.5 flex flex-wrap items-center justify-between gap-2"
                  >
                    <label className="text-[11px] font-semibold text-slate-200 leading-tight flex-1 min-w-[125px]">
                      {isEn ? field.labelEn : field.labelAr}
                    </label>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateTypographyField(field.key, val - 0.5)}
                        className="w-5 h-6 rounded bg-[#04080F] border border-slate-700 text-slate-300 hover:text-white font-black cursor-pointer"
                        title="تصغير الحجم"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={minV}
                        max={maxV}
                        step={0.5}
                        aria-label={isEn ? field.labelEn : field.labelAr}
                        value={val}
                        onChange={(e) => updateTypographyField(field.key, Number(e.target.value))}
                        className="w-12 v20-input px-1 py-0.5 text-center text-[11px] tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => updateTypographyField(field.key, val + 0.5)}
                        className="w-5 h-6 rounded bg-[#04080F] border border-slate-700 text-slate-300 hover:text-white font-black cursor-pointer"
                        title="تكبير الحجم"
                      >
                        +
                      </button>
                      <span className="text-[9px] text-slate-400 font-mono w-4">{currentTypo.unit}</span>

                      <button
                        type="button"
                        onClick={() => updateTypographyWeight(field.key)}
                        className={`w-6 h-6 rounded text-[10px] font-black border cursor-pointer transition ${
                          weight === 'bold'
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                            : 'bg-[#04080F] border-slate-700 text-slate-400 hover:text-white'
                        }`}
                        title={weight === 'bold' ? 'خط عريض (Bold) - اضغط للتبديل إلى عادي' : 'خط عادي (Normal) - اضغط للتبديل إلى عريض'}
                      >
                        B
                      </button>

                      <input
                        type="color"
                        value={customColor || currentTpl.primaryColor || '#0f172a'}
                        onChange={(e) => updateTypographyColor(field.key, e.target.value)}
                        title={`تخصيص لون: ${field.labelAr}`}
                        className="w-6 h-6 rounded border border-slate-700 bg-[#04080F] cursor-pointer p-0"
                      />
                      {customColor && (
                        <button
                          type="button"
                          onClick={() => updateTypographyColor(field.key, undefined)}
                          className="text-[9px] px-1 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                          title="استعادة لون القالب الافتراضي"
                        >
                          تلقائي
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Intelligent Table & Content Pagination Engine */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-black text-[var(--gold)] flex items-center gap-1.5">
                <SplitSquareVertical className="w-3.5 h-3.5" />
                <span>محرك التوزيع الذكي للجداول والصفحات</span>
              </h4>
              <button
                type="button"
                onClick={handleResetPagination}
                className="text-[10px] text-sky-300 hover:underline font-bold cursor-pointer"
              >
                استعادة الافتراضي
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">
                  أقل عدد صفوف لبدء جدول بنهاية الصفحة:
                </label>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={currentPagination.minimumRowsBeforeTableBreak}
                  onChange={(e) =>
                    updatePaginationField(
                      'minimumRowsBeforeTableBreak',
                      Math.min(15, Math.max(1, Math.round(Number(e.target.value) || 4)))
                    )
                  }
                  className="w-full v20-input px-2 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">
                  حد صفوف الجدول القصير للحفاظ عليه كاملاً:
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={currentPagination.keepShortTableTogetherMaxRows}
                  onChange={(e) =>
                    updatePaginationField(
                      'keepShortTableTogetherMaxRows',
                      Math.min(12, Math.max(1, Math.round(Number(e.target.value) || 5)))
                    )
                  }
                  className="w-full v20-input px-2 py-1 text-center tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">فراغ بين الجداول (mm)</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  step={0.5}
                  value={currentPagination.tableSpacingMm}
                  onChange={(e) =>
                    updatePaginationField(
                      'tableSpacingMm',
                      Math.min(20, Math.max(1, Number(e.target.value) || 4))
                    )
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">قبل العنوان (mm)</label>
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={currentPagination.headingSpacingBeforeMm}
                  onChange={(e) =>
                    updatePaginationField(
                      'headingSpacingBeforeMm',
                      Math.min(15, Math.max(0, Number(e.target.value) || 2))
                    )
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-1">بعد العنوان (mm)</label>
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  value={currentPagination.headingSpacingAfterMm}
                  onChange={(e) =>
                    updatePaginationField(
                      'headingSpacingAfterMm',
                      Math.min(15, Math.max(0, Number(e.target.value) || 2))
                    )
                  }
                  className="w-full v20-input px-1.5 py-1 text-center tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentPagination.keepHeadingWithTable}
                  onChange={(e) => updatePaginationField('keepHeadingWithTable', e.target.checked)}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>ربط عنوان القسم/الجدول مع بدايته (منع انفصال العنوان أسفل الصفحة)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentPagination.preventRowSplit}
                  onChange={(e) => updatePaginationField('preventRowSplit', e.target.checked)}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>منع انقسام صف البيانات الواحد بين صفحتين</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentPagination.allowMultipleTablesPerPage}
                  onChange={(e) => updatePaginationField('allowMultipleTablesPerPage', e.target.checked)}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>السماح باجتماع أكثر من جدول قصير في صفحة واحدة إذا اتسعت المساحة</span>
              </label>
            </div>
          </div>

          {/* Section 4: Colors, Font Family & Borders */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
            <h4 className="font-black text-[var(--gold)] flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              <span>الألوان العامة، نوع الخط والحدود</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">اللون الأساسي:</label>
                <input
                  type="color"
                  value={currentTpl.primaryColor}
                  onChange={(e) => updateDraftTemplate({ primaryColor: e.target.value })}
                  className="w-full h-8 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">اللون الثانوي / المميز:</label>
                <input
                  type="color"
                  value={currentTpl.accentColor}
                  onChange={(e) => updateDraftTemplate({ accentColor: e.target.value })}
                  className="w-full h-8 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">حدود الإطار والجدول:</label>
                <input
                  type="color"
                  value={currentTpl.borderColor}
                  onChange={(e) => updateDraftTemplate({ borderColor: e.target.value })}
                  className="w-full h-8 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">خلفية ترويسة الجدول:</label>
                <input
                  type="color"
                  value={currentTpl.tableHeaderBg}
                  onChange={(e) => updateDraftTemplate({ tableHeaderBg: e.target.value })}
                  className="w-full h-8 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">نص ترويسة الجدول:</label>
                <input
                  type="color"
                  value={currentTpl.tableHeaderText}
                  onChange={(e) => updateDraftTemplate({ tableHeaderText: e.target.value })}
                  className="w-full h-8 rounded border border-[var(--border-strong)] bg-[#050B12] cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-300 mb-1">سمك الحدود (px):</label>
                <input
                  type="number"
                  min={0}
                  max={4}
                  step={0.5}
                  value={currentTpl.borderWidthPx}
                  onChange={(e) =>
                    updateDraftTemplate({ borderWidthPx: Math.min(4, Math.max(0, Number(e.target.value) || 1)) })
                  }
                  className="w-full v20-input px-1 py-1.5 text-center tabular-nums"
                />
              </div>
              <div className="col-span-2 sm:col-span-3 pt-1">
                <label className="block text-[10px] text-slate-300 mb-1">عائلة خط المستند والـ PDF:</label>
                <select
                  value={currentTpl.fontFamily || 'Cairo'}
                  onChange={(e) =>
                    updateDraftTemplate({
                      fontFamily: e.target.value as PrintTemplateConfig['fontFamily'],
                    })
                  }
                  className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
                >
                  <option value="Cairo">Cairo (الخط العربي الافتراضي — مضمّن للطباعة و PDF)</option>
                  <option value="DejaVu">DejaVu Sans (دعم موسع للرموز والأحرف اللاتينية)</option>
                  <option value="Tajawal">Tajawal (واجهة HTML مع Cairo للـ PDF)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 5: Header, Logo, Stamp, Signatures & Columns */}
          <div className="bg-[#060D15] border border-[var(--border-strong)] rounded-lg p-3 space-y-2.5">
            <h4 className="font-black text-[var(--gold)] flex items-center gap-1.5">
              <FileCheck2 className="w-3.5 h-3.5" />
              <span>الترويسة، الشعار، التوقيعات والترقيم</span>
            </h4>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showHeader}
                  onChange={(e) => updateDraftTemplate({ showHeader: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار ترويسة المنشأة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.useCustomBanner}
                  onChange={(e) => updateDraftTemplate({ useCustomBanner: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار صورة الترويسة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showCompanyDetails}
                  onChange={(e) => updateDraftTemplate({ showCompanyDetails: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>بيانات المنشأة الضريبية</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showLogo}
                  onChange={(e) => updateDraftTemplate({ showLogo: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار الشعار</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.repeatTableHeader}
                  onChange={(e) => updateDraftTemplate({ repeatTableHeader: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>تكرار رأس الجدول بكل صفحة</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showSignatures}
                  onChange={(e) => updateDraftTemplate({ showSignatures: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار خانات التوقيع</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showStamp}
                  onChange={(e) => updateDraftTemplate({ showStamp: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار الختم الرسمي</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showFooter}
                  onChange={(e) => updateDraftTemplate({ showFooter: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>إظهار التذييل الرسمي</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentTpl.showPageNumbers}
                  onChange={(e) => updateDraftTemplate({ showPageNumbers: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>ترقيم الصفحات</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer col-span-2">
                <input
                  type="checkbox"
                  checked={Boolean(currentTpl.repeatHeaderOnPages)}
                  onChange={(e) => updateDraftTemplate({ repeatHeaderOnPages: e.target.checked })}
                  className="w-4 h-4 accent-amber-400"
                />
                <span>تكرار ترويسة المنشأة بكل صفحة (إيقاف لمنع التكرار عند تعدد الصفحات)</span>
              </label>
            </div>

            <div className="pt-1 border-t border-slate-800">
              <label className="block text-[10px] text-slate-400 mb-1">
                أعمدة مخفية عند الطباعة/PDF (افصل بفاصلة، مثال: الخصم, الضريبة):
              </label>
              <input
                type="text"
                value={(currentTpl.hiddenColumns || []).join('، ')}
                onChange={(e) =>
                  updateDraftTemplate({
                    hiddenColumns: e.target.value
                      .split(/[،,]+/)
                      .map((x) => x.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="اتركه فارغاً لإظهار كافة الأعمدة"
                className="w-full v20-input px-2 py-1 text-xs"
              />
            </div>

            {currentTpl.showLogo && (
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">موضع الشعار:</label>
                  <select
                    value={currentTpl.logoPosition}
                    onChange={(e) =>
                      updateDraftTemplate({ logoPosition: e.target.value as PrintTemplateConfig['logoPosition'] })
                    }
                    className="w-full v20-input px-2 py-1 text-xs cursor-pointer"
                  >
                    <option value="right">يمين الترويسة</option>
                    <option value="center">المنتصف</option>
                    <option value="left">يسار الترويسة</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">عرض الشعار (px):</label>
                  <input
                    type="number"
                    min={32}
                    max={140}
                    value={currentTpl.logoSizePx}
                    onChange={(e) =>
                      updateDraftTemplate({
                        logoSizePx: Math.min(140, Math.max(32, Number(e.target.value) || 64)),
                      })
                    }
                    className="w-full v20-input px-2 py-1 text-center tabular-nums"
                  />
                </div>
              </div>
            )}

            {currentTpl.showSignatures && (
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <label className="block text-[10px] text-slate-400">مسميات خانات التوقيع (3 خانات):</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[0, 1, 2].map((idx) => (
                    <input
                      key={idx}
                      type="text"
                      value={currentTpl.signatureLabels?.[idx] || ''}
                      onChange={(e) => {
                        const base: [string, string, string] = [
                          currentTpl.signatureLabels?.[0] || 'إعداد المحاسب',
                          currentTpl.signatureLabels?.[1] || 'المدير المالي',
                          currentTpl.signatureLabels?.[2] || 'المستلم',
                        ];
                        base[idx] = e.target.value;
                        updateDraftTemplate({ signatureLabels: base });
                      }}
                      className="v20-input px-2 py-1 text-[11px]"
                    />
                  ))}
                </div>
              </div>
            )}

            {currentTpl.showFooter && (
              <div className="pt-1 border-t border-slate-800">
                <label className="block text-[10px] text-slate-400 mb-1">نص التذييل المخصص:</label>
                <input
                  type="text"
                  value={currentTpl.footerText || ''}
                  onChange={(e) => updateDraftTemplate({ footerText: e.target.value })}
                  placeholder="اتركه فارغاً لاستخدام التذييل الرسمي التلقائي للمنشأة"
                  className="w-full v20-input px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>
        </div>

        {/* Live Synchronized Preview Frame */}
        <div className="xl:col-span-7 v20-card p-3 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-strong)] pb-2 mb-2">
            <div className="flex items-center gap-1.5 font-black text-[var(--gold)]">
              <Eye className="w-4 h-4" />
              <span>معاينة حية مطابقة 100% للطباعة والـ PDF</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-[#08121E] border border-[var(--border-strong)] rounded p-0.5">
                <button
                  type="button"
                  onClick={() => setSampleMode('standard')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    sampleMode === 'standard' ? 'bg-[var(--gold)] text-[#03060A]' : 'text-slate-300'
                  }`}
                >
                  نموذج قياسي
                </button>
                <button
                  type="button"
                  onClick={() => setSampleMode('multipage')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                    sampleMode === 'multipage' ? 'bg-[var(--gold)] text-[#03060A]' : 'text-slate-300'
                  }`}
                >
                  تقرير طويل / جداول متعددة
                </button>
              </div>
              <span className="text-[11px] font-mono text-emerald-300 bg-[#08121E] px-2 py-0.5 rounded border border-emerald-500/30">
                {paginationPlan.pages.length} {paginationPlan.pages.length === 1 ? 'صفحة' : 'صفحات'} · {currentTpl.paperSize} · عنوان:{currentTypo.documentTitle}{currentTypo.unit} · خلايا:{currentTypo.tableCells}{currentTypo.unit} · أسعار:{currentTypo.priceValues}{currentTypo.unit} · نهائي:{currentTypo.finalAmounts}{currentTypo.unit}
              </span>
            </div>
          </div>

          <div className="bg-slate-200 rounded-lg p-2 flex-1 min-h-[600px] overflow-hidden">
            <iframe
              title="Live Print Template Preview"
              srcDoc={previewHtml}
              className="w-full h-[750px] bg-white rounded shadow-inner border border-slate-300"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
