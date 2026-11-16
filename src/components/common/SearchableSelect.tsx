/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - V20 Searchable Combobox with Ranked Arabic/Numeric Matching & Inline Edit
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Edit3, UserPlus } from 'lucide-react';
import { rankSearchResults } from '../../services/searchHelpers';

export interface SearchableSelectOption {
  id: string;
  code?: string;
  name: string;
  sublabel?: string;
  badge?: string;
  phone?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (option: SearchableSelectOption | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  onEditSelected?: () => void;
  editTitle?: string;
  onQuickAdd?: () => void;
  quickAddTitle?: string;
  allowClear?: boolean;
  clearLabel?: string;
  lang?: 'ar' | 'en';
  maxResults?: number;
  className?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'اختر من القائمة أو ابحث...',
  searchPlaceholder = 'اكتب الاسم أو الرقم / الكود للبحث...',
  disabled = false,
  onEditSelected,
  editTitle = 'تعديل بيانات المحدد',
  onQuickAdd,
  quickAddTitle = 'إضافة جديد',
  allowClear = false,
  clearLabel = 'الكل (بدون تصفية)',
  lang = 'ar',
  maxResults = 60,
  className = '',
}) => {
  const isEn = lang === 'en';
  const selectedOpt = useMemo(
    () => options.find((o) => o.id === value) || null,
    [options, value]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const ranked = useMemo(() => {
    return rankSearchResults(
      options,
      query,
      (o) => ({
        code: o.code,
        id: o.id,
        name: o.name,
        alt: o.sublabel,
        phone: o.phone,
      }),
      maxResults
    );
  }, [options, query, maxResults]);

  const openSearch = (clearQuery: boolean) => {
    if (disabled) return;
    if (clearQuery) setQuery('');
    setIsOpen(true);
    setHighlightIdx(0);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  const handleSelect = (opt: SearchableSelectOption) => {
    onChange(opt);
    setIsOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      openSearch(false);
      return;
    }
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((p) => Math.min(Math.max(0, ranked.length - 1), p + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((p) => Math.max(0, p - 1));
    } else if (e.key === 'Enter' && ranked[highlightIdx]) {
      e.preventDefault();
      handleSelect(ranked[highlightIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setQuery('');
    }
  };

  return (
    <div ref={wrapRef} className={`relative flex items-center gap-1 ${className}`}>
      <div className="relative flex-1 min-w-0">
        {isOpen ? (
          <div className="flex items-center v20-input px-2 py-1 border border-[var(--gold)] bg-[#050B12]">
            <Search className="w-3.5 h-3.5 text-[var(--gold)] shrink-0 ml-1.5" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              disabled={disabled}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlightIdx(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-white text-xs font-bold outline-none placeholder:text-slate-400"
            />
            {query && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setQuery('');
                  setHighlightIdx(0);
                }}
                title="مسح نص البحث"
                className="p-0.5 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center v20-input px-2 py-1 gap-1.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => openSearch(true)}
                className={`flex-1 min-w-0 ${isEn ? 'text-left' : 'text-right'} flex items-center justify-between gap-1 text-xs font-bold text-white cursor-pointer disabled:opacity-50`}
                title={isEn ? 'Click to search' : 'اضغط للبحث والتغيير'}
              >
                <span className="truncate">
                  {selectedOpt ? (
                    <>
                      {selectedOpt.code && (
                        <span className="font-mono text-[10px] text-amber-300 ml-1">[{selectedOpt.code}]</span>
                      )}
                      {selectedOpt.name}
                    </>
                  ) : (
                    <span className="text-slate-400">{placeholder}</span>
                  )}
                </span>
                {selectedOpt?.badge && (
                  <span className="text-[10px] font-black text-[var(--gold)] tabular-nums shrink-0">
                    {selectedOpt.badge}
                  </span>
                )}
              </button>
              {allowClear && selectedOpt && !disabled && (
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  title={clearLabel}
                  className="p-0.5 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => openSearch(true)}
                  title={isEn ? 'Search & change' : 'بحث وتغيير'}
                  className="px-1.5 py-0.5 rounded bg-[#08121E] border border-[var(--border-strong)] hover:border-[var(--gold)] text-[var(--gold)] flex items-center gap-0.5 text-[10px] font-black shrink-0 cursor-pointer"
                >
                  <Search className="w-3 h-3" />
                  <ChevronDown className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          )}

          {isOpen && (
            <div className={`grid-autocomplete-menu top-full ${isEn ? 'left-0' : 'right-0'} w-full min-w-[270px] mt-1 max-h-64 overflow-y-auto z-50`}>
              <div className="px-2.5 py-1 bg-[#071019] border-b border-slate-700 flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  {query.trim()
                    ? `${isEn ? 'Results' : 'نتائج البحث'}: ${ranked.length} / ${options.length}`
                    : `${isEn ? 'Items' : 'القائمة'} (${options.length})`}
                </span>
                {allowClear && selectedOpt ? (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(null);
                      setIsOpen(false);
                      setQuery('');
                    }}
                    className="text-amber-300 hover:text-amber-200 font-bold cursor-pointer"
                  >
                    {clearLabel}
                  </button>
                ) : selectedOpt ? (
                  <span className="text-[var(--gold)] font-bold truncate max-w-[140px]">
                    {selectedOpt.name}
                  </span>
                ) : null}
              </div>

              {ranked.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400 font-bold">
                  {isEn ? `No matching results for "${query}"` : `لا توجد نتائج مطابقة للبحث "${query}"`}
                </div>
              ) : (
              ranked.map((opt, idx) => {
                const isSelected = opt.id === value;
                const isHighlighted = idx === highlightIdx;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(opt);
                    }}
                    className={`w-full text-right px-2.5 py-1.5 text-xs font-bold flex items-center justify-between gap-2 border-b border-slate-800 cursor-pointer ${
                      isHighlighted
                        ? 'bg-[var(--gold)] text-[#03060A]'
                        : isSelected
                        ? 'bg-amber-500/15 text-[var(--gold)]'
                        : 'text-white hover:bg-slate-800'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate flex items-center gap-1.5">
                        {opt.code && (
                          <span
                            className={`font-mono text-[10px] px-1 rounded ${
                              isHighlighted
                                ? 'bg-black/20 text-[#03060A]'
                                : 'bg-slate-800 text-amber-300'
                            }`}
                          >
                            {opt.code}
                          </span>
                        )}
                        <span className="truncate">{opt.name}</span>
                      </div>
                      {opt.sublabel && (
                        <div
                          className={`text-[10px] truncate ${
                            isHighlighted ? 'text-[#03060A]/80' : 'text-slate-400'
                          }`}
                        >
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    {opt.badge && (
                      <span className="text-[11px] shrink-0 tabular-nums font-black">
                        {opt.badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {onEditSelected && selectedOpt && !disabled && (
        <button
          type="button"
          onClick={onEditSelected}
          title={editTitle}
          className="px-2 py-1.5 rounded bg-[#08121E] border border-sky-500/60 text-sky-300 hover:border-[var(--gold)] hover:text-[var(--gold)] cursor-pointer shrink-0"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      )}

      {onQuickAdd && !disabled && (
        <button
          type="button"
          onClick={onQuickAdd}
          title={quickAddTitle}
          className="px-2 py-1.5 rounded bg-[#08121E] border border-[var(--gold)] text-[var(--gold)] hover:bg-[var(--gold)] hover:text-[#03060A] cursor-pointer shrink-0"
        >
          <UserPlus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
