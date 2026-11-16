/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Normalized Arabic & Numeric Ranked Search Utilities
 */

const ARABIC_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/**
 * Converts Arabic/Persian numerals (٠١٢٣٤٥٦٧٨٩ / ۰۱۲۳۴۵۶۷۸۹) to Western ASCII digits (0-9)
 */
export function normalizeDigits(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return '';
  return String(input)
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

/**
 * Normalizes Arabic letters, digits, and spacing for reliable search matching.
 */
export function normalizeArabicSearch(input: string | number | undefined | null): string {
  const digits = normalizeDigits(input);
  return digits
    .replace(ARABIC_DIACRITICS_RE, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts normalized numeric core if text looks like an item/party number (e.g. "001", "IT-1", "it-bak-1" -> "1").
 */
export function extractNumericSuffix(val: string | undefined | null): string | null {
  if (!val) return null;
  const norm = normalizeDigits(val).trim();
  if (/^\d+$/.test(norm)) {
    return String(parseInt(norm, 10));
  }
  const m = /(?:^|[-_#/])0*(\d+)$/.exec(norm);
  return m ? String(parseInt(m[1], 10)) : null;
}

export interface SearchableFields {
  code?: string;
  barcode?: string;
  id?: string;
  name?: string;
  alt?: string;
  phone?: string;
}

/**
 * Scores a candidate record against a search query so exact numeric codes (e.g. "1")
 * and exact/prefix matches ALWAYS appear at the very top instead of being buried
 * behind random substrings like "629104000101".
 */
export function scoreSearchMatch(query: string, fields: SearchableFields): number {
  const q = normalizeArabicSearch(query);
  if (!q) return 1;

  const qNumeric = /^\d+$/.test(q) ? String(parseInt(q, 10)) : null;

  const code = normalizeArabicSearch(fields.code);
  const barcode = normalizeArabicSearch(fields.barcode);
  const id = normalizeArabicSearch(fields.id);
  const name = normalizeArabicSearch(fields.name);
  const alt = normalizeArabicSearch(fields.alt);
  const phone = normalizeArabicSearch(fields.phone);

  // 1. Exact matches (Highest Priority)
  if (code === q || barcode === q) return 1200;
  if (qNumeric) {
    const codeNum = extractNumericSuffix(code);
    const barNum = extractNumericSuffix(barcode);
    const idNum = extractNumericSuffix(id);
    if (codeNum === qNumeric) return 1150;
    if (barNum === qNumeric) return 1120;
    if (idNum === qNumeric) return 1080;
  }
  if (name === q || phone === q) return 1050;

  // 2. Starts-with matches
  if (code.startsWith(q) || barcode.startsWith(q)) return 750;
  if (name.startsWith(q)) return 650;
  if (phone.startsWith(q)) return 600;

  // 3. Word-boundary start in name / alt
  const words = name.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 450;
  if (alt && alt.split(/\s+/).some((w) => w.startsWith(q))) return 350;

  // 4. Substring match
  if (code.includes(q) || barcode.includes(q)) return 240;
  if (name.includes(q)) return 200;
  if (phone.includes(q)) return 180;
  if (alt.includes(q)) return 120;

  // 5. Multi-token AND match (e.g. "معوز اصفر" matches "معاوز حضرمي اصفر")
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const hay = `${code} ${barcode} ${name} ${alt} ${phone}`;
    if (tokens.every((t) => hay.includes(t))) return 160;
  }

  return 0;
}

/**
 * Filters and ranks an array by search relevance score descending.
 */
export function rankSearchResults<T>(
  items: T[],
  query: string,
  getFields: (item: T) => SearchableFields,
  limit: number = 30
): T[] {
  const q = normalizeArabicSearch(query);
  if (!q) return items.slice(0, limit);

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = scoreSearchMatch(q, getFields(item));
    if (s > 0) {
      scored.push({ item, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}
