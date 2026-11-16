/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Enterprise Reusable DataTable
 * Features: Instant search, Asc/Desc sorting, pagination, page-size selector, total count,
 * multi-row selection + RBAC bulk actions, totals footer, column customizer & responsive layout.
 */

import React, { useMemo, useState, useEffect, useDeferredValue } from 'react';
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { SavedTableView, TableColumnPref } from '../../types/erp';
import { ColumnCustomizerModal } from './ColumnCustomizerModal';
import { normalizeArabicSearch, rankSearchResults } from '../../services/searchHelpers';

export interface ErpTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  searchValue?: (row: T) => string;
  align?: 'right' | 'center' | 'left';
  defaultVisible?: boolean;
  render: (row: T, index: number) => React.ReactNode;
  footerRender?: (filteredRows: T[]) => React.ReactNode;
  headerClassName?: string;
  cellClassName?: string;
}

interface ErpDataTableProps<T> {
  tableId: string;
  title?: string;
  data: T[];
  columns: ErpTableColumn<T>[];
  getRowId: (row: T) => string;
  searchPlaceholder?: string;
  savedColumnPrefs?: TableColumnPref[];
  onSaveColumnPrefs?: (tableId: string, prefs: TableColumnPref[]) => void;
  savedViews?: SavedTableView[];
  onSaveView?: (view: SavedTableView) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActionsSlot?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode;
  filtersSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  defaultPageSize?: number;
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  lang?: 'ar' | 'en';
}

export function ErpDataTable<T>({
  tableId,
  title = 'الجدول',
  data,
  columns,
  getRowId,
  searchPlaceholder,
  savedColumnPrefs,
  onSaveColumnPrefs,
  savedViews,
  onSaveView,
  selectable = false,
  selectedIds,
  onSelectionChange,
  bulkActionsSlot,
  filtersSlot,
  actionsSlot,
  onRowClick,
  emptyMessage,
  defaultPageSize = 25,
  defaultSortKey,
  defaultSortDir = 'desc',
  lang = 'ar',
}: ErpDataTableProps<T>) {
  const isEn = lang === 'en';
  const effectiveSearchPlaceholder =
    searchPlaceholder || (isEn ? 'Instant search in records (code, number, name)...' : 'بحث فوري في السجلات (الرقم، الاسم، الهاتف)...');
  const effectiveEmptyMessage =
    emptyMessage || (isEn ? 'No matching records for the current search or filters' : 'لا توجد سجلات مطابقة لمعايير البحث أو التصفية الحالية');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey || null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [internalSelected, setInternalSelected] = useState<string[]>([]);
  const [showColModal, setShowColModal] = useState(false);
  const [newViewName, setNewViewName] = useState('');

  const activeSelected = selectedIds !== undefined ? selectedIds : internalSelected;
  const setSelection = (ids: string[]) => {
    if (onSelectionChange) {
      onSelectionChange(ids);
    } else {
      setInternalSelected(ids);
    }
  };

  const columnsSignature = columns.map((c) => `${c.key}:${c.label}:${c.defaultVisible !== false}`).join('|');

  const defaultPrefs: TableColumnPref[] = useMemo(
    () =>
      columns.map((c, idx) => ({
        key: c.key,
        label: c.label,
        visible: c.defaultVisible !== false,
        order: idx,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnsSignature]
  );

  const [localPrefs, setLocalPrefs] = useState<TableColumnPref[]>(defaultPrefs);

  useEffect(() => {
    const nextPrefs =
      savedColumnPrefs && savedColumnPrefs.length > 0
        ? (() => {
            const mapSaved = new Map(savedColumnPrefs.map((p) => [p.key, p]));
            const merged = columns.map((c, idx) => {
              const found = mapSaved.get(c.key);
              return found
                ? { ...found, label: c.label }
                : { key: c.key, label: c.label, visible: c.defaultVisible !== false, order: idx + 100 };
            });
            merged.sort((a, b) => a.order - b.order);
            return merged.map((m, idx) => ({ ...m, order: idx }));
          })()
        : defaultPrefs;

    setLocalPrefs((prev) => {
      if (
        prev.length === nextPrefs.length &&
        prev.every(
          (p, i) =>
            p.key === nextPrefs[i].key &&
            p.label === nextPrefs[i].label &&
            p.visible === nextPrefs[i].visible &&
            p.order === nextPrefs[i].order
        )
      ) {
        return prev;
      }
      return nextPrefs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedColumnPrefs, columnsSignature, defaultPrefs]);

  const orderedVisibleColumns = useMemo(() => {
    const colMap = new Map(columns.map((c) => [c.key, c]));
    return [...localPrefs]
      .sort((a, b) => a.order - b.order)
      .filter((p) => p.visible && colMap.has(p.key))
      .map((p) => colMap.get(p.key)!);
  }, [localPrefs, columns]);

  // Filter & rank by normalized Arabic & digit-aware instant search (matches codes, numbers, and names)
  const filteredRows = useMemo(() => {
    const q = normalizeArabicSearch(deferredSearch);
    if (!q) return data;
    return rankSearchResults(
      data,
      deferredSearch,
      (row) => {
        const rec = row as Record<string, unknown>;
        const codeCandidate = String(
          rec.code ??
            rec.invoiceNumber ??
            rec.voucherNumber ??
            rec.expenseNumber ??
            rec.entryNumber ??
            rec.accountCode ??
            rec.barcode ??
            rec.documentNumber ??
            ''
        );
        const nameCandidate = String(
          rec.nameAr ?? rec.entityName ?? rec.accountName ?? rec.itemName ?? rec.categoryName ?? ''
        );
        const allText = columns
          .map((col) => {
            if (col.searchValue) return col.searchValue(row);
            const v = rec[col.key];
            return v !== undefined && v !== null ? String(v) : '';
          })
          .join(' ');
        return {
          code: codeCandidate,
          id: getRowId(row),
          name: nameCandidate || allText,
          alt: allText,
          phone: String(rec.phone ?? rec.whatsapp ?? ''),
        };
      },
      Math.max(data.length, 500)
    );
  }, [data, deferredSearch, columns, getRowId]);

  // Sort filtered rows
  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filteredRows;

    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const va = col.sortValue
        ? col.sortValue(a)
        : ((a as Record<string, unknown>)[col.key] as string | number) ?? '';
      const vb = col.sortValue
        ? col.sortValue(b)
        : ((b as Record<string, unknown>)[col.key] as string | number) ?? '';

      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va);
      const sb = String(vb);
      return sortDir === 'asc' ? sa.localeCompare(sb, 'ar') : sb.localeCompare(sa, 'ar');
    });
    return copy;
  }, [filteredRows, sortKey, sortDir, columns]);

  const totalResults = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [sortedRows, safePage, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const pageIds = paginatedRows.map(getRowId);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => activeSelected.includes(id));

  const toggleSelectPage = () => {
    if (allOnPageSelected) {
      setSelection(activeSelected.filter((id) => !pageIds.includes(id)));
    } else {
      const merged = new Set([...activeSelected, ...pageIds]);
      setSelection(Array.from(merged));
    }
  };

  const toggleRow = (id: string) => {
    if (activeSelected.includes(id)) {
      setSelection(activeSelected.filter((x) => x !== id));
    } else {
      setSelection([...activeSelected, id]);
    }
  };

  const selectedRowObjects = useMemo(
    () => data.filter((r) => activeSelected.includes(getRowId(r))),
    [data, activeSelected, getRowId]
  );

  const hasFooter = orderedVisibleColumns.some((c) => Boolean(c.footerRender));

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden shadow-lg" dir={isEn ? 'ltr' : 'rtl'}>
      {/* Toolbar */}
      <div className="p-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className={`w-4 h-4 text-slate-400 absolute ${isEn ? 'left-3' : 'right-3'} top-1/2 -translate-y-1/2 pointer-events-none`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={effectiveSearchPlaceholder}
              className={`w-full ${isEn ? 'pl-9 pr-8' : 'pr-9 pl-8'} py-2 text-xs sm:text-sm bg-slate-950 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className={`absolute ${isEn ? 'right-2.5' : 'left-2.5'} top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer`}
                aria-label={isEn ? 'Clear search' : 'مسح البحث'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {filtersSlot}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {actionsSlot}
          {savedViews && savedViews.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => {
                const v = savedViews.find((sv) => sv.id === e.target.value);
                if (v) {
                  setLocalPrefs(v.columns);
                  onSaveColumnPrefs?.(tableId, v.columns);
                }
              }}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 cursor-pointer"
            >
              <option value="">{isEn ? 'Saved Views...' : 'العروض المحفوظة...'}</option>
              {savedViews
                .filter((sv) => sv.tableId === tableId)
                .map((sv) => (
                  <option key={sv.id} value={sv.id}>
                    {sv.nameAr}
                  </option>
                ))}
            </select>
          )}
          {onSaveView && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder={isEn ? 'View name...' : 'اسم العرض...'}
                className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  const clean = newViewName.trim();
                  if (!clean) return;
                  onSaveView({
                    id: `view-${Date.now()}`,
                    tableId,
                    nameAr: clean,
                    columns: localPrefs,
                    createdBy: 'المستخدم',
                  });
                  setNewViewName('');
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-slate-700 cursor-pointer"
              >
                {isEn ? 'Save View' : 'حفظ العرض'}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowColModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            title={isEn ? 'Customize columns' : 'إظهار وإخفاء وإعادة ترتيب الأعمدة'}
          >
            <Columns3 className="w-3.5 h-3.5 text-amber-400" />
            <span>{isEn ? 'Columns' : 'الأعمدة'}</span>
          </button>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectable && activeSelected.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-bold text-amber-300">
            {isEn ? `Selected ${activeSelected.length} records` : `تم تحديد ${activeSelected.length} سجل`}
            <button
              type="button"
              onClick={() => setSelection([])}
              className={`${isEn ? 'ml-3' : 'mr-3'} text-slate-300 hover:text-white underline font-normal cursor-pointer`}
            >
              {isEn ? 'Clear selection' : 'إلغاء التحديد'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {bulkActionsSlot?.(selectedRowObjects, () => setSelection([]))}
          </div>
        </div>
      )}

      {/* Table wrapper */}
      <div className="overflow-x-auto">
        <table className="w-full text-right border-collapse">
          <thead>
            <tr className="bg-slate-950/90 border-b border-slate-800 text-xs font-bold text-slate-300">
              {selectable && (
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectPage}
                    className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                    aria-label="تحديد كل الصفوف في الصفحة"
                  />
                </th>
              )}
              {orderedVisibleColumns.map((col) => {
                const isSorted = sortKey === col.key;
                const alignClass =
                  col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right';
                return (
                  <th
                    key={col.key}
                    className={`px-3.5 py-3 whitespace-nowrap ${alignClass} ${col.headerClassName || ''}`}
                  >
                    {col.sortable !== false ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className="inline-flex items-center gap-1 hover:text-amber-400 transition-colors"
                      >
                        <span>{col.label}</span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ArrowUp className="w-3.5 h-3.5 text-amber-400" />
                          ) : (
                            <ArrowDown className="w-3.5 h-3.5 text-amber-400" />
                          )
                        ) : (
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        )}
                      </button>
                    ) : (
                      <span>{col.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/70 text-xs sm:text-sm">
            {paginatedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={orderedVisibleColumns.length + (selectable ? 1 : 0)}
                  className="px-6 py-10 text-center text-slate-400"
                >
                  {effectiveEmptyMessage}
                </td>
              </tr>
            ) : (
              paginatedRows.map((row, idx) => {
                const rowId = getRowId(row);
                const isSelected = activeSelected.includes(rowId);
                return (
                  <tr
                    key={rowId}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={`transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-amber-500/10 hover:bg-amber-500/15'
                        : 'hover:bg-slate-800/45'
                    }`}
                  >
                    {selectable && (
                      <td
                        className="px-3 py-2.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(rowId)}
                          className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                          aria-label="تحديد الصف"
                        />
                      </td>
                    )}
                    {orderedVisibleColumns.map((col) => {
                      const alignClass =
                        col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right';
                      return (
                        <td
                          key={col.key}
                          className={`px-3.5 py-2.5 text-slate-200 ${alignClass} ${col.cellClassName || ''}`}
                        >
                          {col.render(row, (safePage - 1) * pageSize + idx)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>

          {hasFooter && filteredRows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-950/90 border-t-2 border-amber-500/40 font-bold text-xs sm:text-sm text-amber-300">
                {selectable && <td className="px-3 py-3" />}
                {orderedVisibleColumns.map((col) => {
                  const alignClass =
                    col.align === 'center' ? 'text-center' : col.align === 'left' ? 'text-left' : 'text-right';
                  return (
                    <td key={col.key} className={`px-3.5 py-3 tabular-nums ${alignClass}`}>
                      {col.footerRender ? col.footerRender(filteredRows) : ''}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Footer Pagination & Stats */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span>
            {isEn ? 'Total results:' : 'إجمالي النتائج:'} <strong className="text-amber-400 tabular-nums">{totalResults}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <label className="flex items-center gap-1.5">
            <span>{isEn ? 'Rows:' : 'الصفوف:'}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              {[10, 25, 50, 100].map((sz) => (
                <option key={sz} value={sz}>
                  {sz}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 hover:border-amber-500 disabled:opacity-40 cursor-pointer"
          >
            {isEn ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>{isEn ? 'Prev' : 'السابق'}</span>
          </button>

          <span className="px-2.5 py-1 text-slate-200 tabular-nums">
            {isEn ? `Page ${safePage} of ${totalPages}` : `صفحة ${safePage} من ${totalPages}`}
          </span>

          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 hover:border-amber-500 disabled:opacity-40 cursor-pointer"
          >
            <span>{isEn ? 'Next' : 'التالي'}</span>
            {isEn ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <ColumnCustomizerModal
        isOpen={showColModal}
        onClose={() => setShowColModal(false)}
        title={title}
        columns={localPrefs}
        onSave={(updated) => {
          setLocalPrefs(updated);
          onSaveColumnPrefs?.(tableId, updated);
        }}
        onReset={() => {
          setLocalPrefs(defaultPrefs);
          onSaveColumnPrefs?.(tableId, defaultPrefs);
        }}
      />
    </div>
  );
}
