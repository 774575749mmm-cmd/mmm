/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Document Books Manager (دفاتر الفواتير والسندات والمستودعات)
 */

import React, { useState } from 'react';
import { BookOpen, Plus, Edit3, Power, Star, X, Check } from 'lucide-react';
import { DocumentBook } from '../../types/erp';

interface DocumentBooksModalProps {
  isOpen: boolean;
  books: DocumentBook[];
  filterCategory?: DocumentBook['category'] | 'all';
  onSaveBook: (book: DocumentBook) => void;
  onToggleBookActive: (bookId: string) => void;
  onSetDefaultBook: (bookId: string) => void;
  onClose: () => void;
  onNotify?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const CATEGORY_LABELS: Record<DocumentBook['category'], string> = {
  sales: 'دفاتر المبيعات',
  purchases: 'دفاتر المشتريات',
  warehouse: 'دفاتر المخزون والمناقلات',
  vouchers: 'دفاتر سندات القبض والصرف',
  ledgers: 'دفاتر اليومية المساعدة',
};

export const DocumentBooksModal: React.FC<DocumentBooksModalProps> = ({
  isOpen,
  books,
  filterCategory = 'all',
  onSaveBook,
  onToggleBookActive,
  onSetDefaultBook,
  onClose,
  onNotify,
}) => {
  const [catTab, setCatTab] = useState<DocumentBook['category'] | 'all'>(filterCategory);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState<DocumentBook['category']>(
    filterCategory === 'all' ? 'sales' : filterCategory
  );
  const [prefix, setPrefix] = useState('SAL-');
  const [nextSequence, setNextSequence] = useState(1001);
  const [padLength, setPadLength] = useState(4);
  const [description, setDescription] = useState('');

  if (!isOpen) return null;

  const visibleBooks = books.filter((b) => catTab === 'all' || b.category === catTab);

  const startEdit = (b: DocumentBook) => {
    setEditingId(b.id);
    setNameAr(b.nameAr);
    setCategory(b.category);
    setPrefix(b.prefix);
    setNextSequence(b.nextSequence);
    setPadLength(b.padLength);
    setDescription(b.description || '');
  };

  const resetForm = () => {
    setEditingId(null);
    setNameAr('');
    setPrefix(category === 'purchases' ? 'PUR-' : category === 'vouchers' ? 'VCH-' : category === 'warehouse' ? 'WHS-' : 'SAL-');
    setNextSequence(1001);
    setPadLength(4);
    setDescription('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameAr.trim() || !prefix.trim()) {
      onNotify?.('error', 'يرجى إدخال اسم الدفتر وبادئة الترقيم.');
      return;
    }
    const existing = editingId ? books.find((b) => b.id === editingId) : undefined;
    const book: DocumentBook = {
      id: existing?.id || `dbook-${Date.now()}`,
      code: existing?.code || `DB-${String(books.length + 1).padStart(3, '0')}`,
      nameAr: nameAr.trim(),
      category,
      prefix: prefix.trim().toUpperCase(),
      nextSequence: Math.max(1, Number(nextSequence) || 1),
      padLength: Math.max(3, Math.min(8, Number(padLength) || 4)),
      isActive: existing ? existing.isActive : true,
      isDefault: existing ? existing.isDefault : false,
      description: description.trim() || undefined,
    };
    onSaveBook(book);
    onNotify?.('success', existing ? `تم تحديث الدفتر [${book.nameAr}]` : `تم إنشاء الدفتر [${book.nameAr}] بنجاح`);
    resetForm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs" dir="rtl">
      <div className="bg-[var(--bg-card)] border-[3px] border-[var(--gold)] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-4 py-3 bg-[#071019] border-b-2 border-[var(--gold)] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[var(--gold)] font-black text-base">
            <BookOpen className="w-5 h-5" />
            <span>إدارة دفاتر الفواتير والسندات وتسلسل الترقيم</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#2B0B0E] border border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>إغلاق</span>
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Category Tabs */}
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-strong)] pb-2">
            <button
              type="button"
              onClick={() => setCatTab('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-extrabold cursor-pointer ${
                catTab === 'all' ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#060B10] border border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              جميع الدفاتر ({books.length})
            </button>
            {(Object.keys(CATEGORY_LABELS) as DocumentBook['category'][]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCatTab(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-extrabold cursor-pointer ${
                  catTab === k ? 'bg-[var(--gold)] text-[#03060A]' : 'bg-[#060B10] border border-[var(--border-strong)] text-[var(--text-secondary)]'
                }`}
              >
                {CATEGORY_LABELS[k]}
              </button>
            ))}
          </div>

          {/* Add / Edit Book Form */}
          <form onSubmit={handleSubmit} className="v20-card-alt p-3.5 grid grid-cols-1 sm:grid-cols-6 gap-2.5 items-end text-xs">
            <div className="sm:col-span-2">
              <label className="block text-[var(--text-secondary)] font-bold mb-1">اسم الدفتر *</label>
              <input
                type="text"
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: دفتر مبيعات المعرض..."
                className="w-full v20-input px-2.5 py-1.5 text-xs"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)] font-bold mb-1">الفئة</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DocumentBook['category'])}
                className="w-full v20-input px-2 py-1.5 text-xs cursor-pointer"
              >
                {(Object.keys(CATEGORY_LABELS) as DocumentBook['category'][]).map((k) => (
                  <option key={k} value={k}>
                    {CATEGORY_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[var(--text-secondary)] font-bold mb-1">البادئة *</label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="w-full v20-input px-2.5 py-1.5 text-xs font-mono text-center"
              />
            </div>
            <div>
              <label className="block text-[var(--text-secondary)] font-bold mb-1">بداية الترقيم</label>
              <input
                type="number"
                min={1}
                value={nextSequence}
                onChange={(e) => setNextSequence(parseInt(e.target.value, 10) || 1)}
                className="w-full v20-input px-2.5 py-1.5 text-xs font-mono text-center tabular-nums"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                type="submit"
                className="flex-1 v20-btn-gold px-3 py-1.5 rounded-md text-xs flex items-center justify-center gap-1 cursor-pointer"
              >
                {editingId ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                <span>{editingId ? 'حفظ' : 'إضافة دفتر'}</span>
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-2.5 py-1.5 rounded-md text-xs font-bold bg-[#08121E] border border-[var(--border-strong)] text-white cursor-pointer"
                >
                  إلغاء
                </button>
              )}
            </div>
          </form>

          {/* Books Table */}
          <div className="overflow-x-auto border-2 border-[var(--border-strong)] rounded-lg bg-[#060D15]">
            <table className="w-full text-right text-xs border-collapse">
              <thead className="bg-[#0B192C] border-b-2 border-[var(--gold)] text-[var(--gold)]">
                <tr>
                  <th className="p-2.5 border-l border-[var(--border-strong)]">الكود</th>
                  <th className="p-2.5 border-l border-[var(--border-strong)]">اسم الدفتر</th>
                  <th className="p-2.5 border-l border-[var(--border-strong)]">الفئة</th>
                  <th className="p-2.5 border-l border-[var(--border-strong)] text-center">البادئة</th>
                  <th className="p-2.5 border-l border-[var(--border-strong)] text-center">التالي</th>
                  <th className="p-2.5 border-l border-[var(--border-strong)] text-center">الحالة</th>
                  <th className="p-2.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {visibleBooks.map((b) => (
                  <tr key={b.id} className="border-b border-[#1B2E44] hover:bg-amber-500/10">
                    <td className="p-2.5 font-mono text-slate-300 border-l border-[#1B2E44]">{b.code}</td>
                    <td className="p-2.5 font-bold text-white border-l border-[#1B2E44]">
                      <div className="flex items-center gap-1.5">
                        <span>{b.nameAr}</span>
                        {b.isDefault && (
                          <span className="text-[10px] font-black text-[var(--gold)]">★ افتراضي</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 text-[var(--text-secondary)] border-l border-[#1B2E44]">
                      {CATEGORY_LABELS[b.category]}
                    </td>
                    <td className="p-2.5 font-mono font-bold text-[var(--info)] text-center border-l border-[#1B2E44]">
                      {b.prefix}
                    </td>
                    <td className="p-2.5 font-mono font-bold text-[var(--gold)] text-center border-l border-[#1B2E44] tabular-nums">
                      {b.prefix}{String(b.nextSequence).padStart(b.padLength, '0')}
                    </td>
                    <td className="p-2.5 text-center border-l border-[#1B2E44]">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${
                          b.isActive
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        {b.isActive ? 'مفعل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(b)}
                          className="px-2 py-1 rounded bg-[#08121E] border border-[var(--border-strong)] text-slate-200 hover:border-[var(--gold)] flex items-center gap-1 cursor-pointer"
                          title="تعديل الدفتر"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>تعديل</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleBookActive(b.id)}
                          className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer ${
                            b.isActive
                              ? 'bg-[#2B0B0E] border-[var(--danger)] text-[var(--danger)]'
                              : 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          }`}
                          title={b.isActive ? 'إيقاف الدفتر' : 'تفعيل الدفتر'}
                        >
                          <Power className="w-3 h-3" />
                          <span>{b.isActive ? 'إيقاف' : 'تفعيل'}</span>
                        </button>
                        {!b.isDefault && b.isActive && (
                          <button
                            type="button"
                            onClick={() => onSetDefaultBook(b.id)}
                            className="px-2 py-1 rounded bg-amber-500/15 border border-[var(--gold)] text-[var(--gold)] flex items-center gap-1 cursor-pointer"
                            title="تعيين كافتراضي"
                          >
                            <Star className="w-3 h-3" />
                            <span>افتراضي</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
