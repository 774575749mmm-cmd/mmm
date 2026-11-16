/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Currency Detection, Conversion & Reconciliation Utilities
 */

import { Currency, CurrencyCode } from '../types/erp';
import type { ERPDatabase } from './storageService';

export function normalizeArabicCurrText(input: string | undefined | null): string {
  return String(input || '')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim();
}

export function hasSaudiHint(text: string | undefined | null): boolean {
  const norm = normalizeArabicCurrText(text);
  if (!norm) return false;
  return (
    norm.includes('سعودي') ||
    norm.includes('ريال سعود') ||
    norm.includes('ر.س') ||
    norm.includes('الراجحي') ||
    norm.includes('الاهلي السعودي') ||
    norm.includes('بنك الرياض') ||
    /\bsar\b/i.test(norm) ||
    /\bsr\b/i.test(norm)
  );
}

export function hasUsdHint(text: string | undefined | null): boolean {
  const norm = normalizeArabicCurrText(text);
  if (!norm) return false;
  return norm.includes('دولار') || norm.includes('$') || /\busd\b/i.test(norm);
}

/**
 * Resolves a valid SAR -> YER conversion rate from the currencies list.
 * Handles inverted rates (< 1) and avoids returning 1 when SAR is missing or unset.
 */
export function getEffectiveSarRate(currencies: Currency[] | undefined): number {
  const sar = (currencies || []).find((c) => c.code === 'SAR');
  const raw = Number(sar?.exchangeRate || 0);
  if (raw > 1) return Math.round(raw * 100) / 100;
  if (raw > 0 && raw < 1) return Math.round((1 / raw) * 100) / 100;
  return 142;
}

export function getEffectiveCurrencyRate(
  currencies: Currency[] | undefined,
  code?: CurrencyCode,
  explicitRate?: number,
  overrideBaseCode?: CurrencyCode
): number {
  const baseCode = (
    overrideBaseCode ||
    (currencies || []).find((c) => c.isBase)?.code ||
    'YER'
  ).toUpperCase();
  const target = (code || baseCode).toUpperCase();
  if (target === baseCode) return 1;
  if (explicitRate && explicitRate > 0 && explicitRate !== 1) {
    if (baseCode === 'YER' && explicitRate < 1) {
      return Math.round((1 / explicitRate) * 100) / 100;
    }
    return Math.round(explicitRate * 10000) / 10000;
  }
  const found = (currencies || []).find((c) => c.code.toUpperCase() === target);
  if (found?.isBase) return 1;
  if (target === 'SAR' && baseCode === 'YER') return getEffectiveSarRate(currencies);
  const raw = Number(found?.exchangeRate || 0);
  if (raw > 0) {
    if (baseCode === 'YER' && raw < 1) return Math.round((1 / raw) * 100) / 100;
    return baseCode === 'YER' ? Math.round(raw * 100) / 100 : Math.round(raw * 10000) / 10000;
  }
  return target === 'USD' && baseCode === 'YER' ? 535 : 1;
}

export function getCurrencySymbol(currencies: Currency[] | undefined, code?: CurrencyCode): string {
  const baseCode = ((currencies || []).find((c) => c.isBase)?.code || 'YER').toUpperCase();
  const target = (code || baseCode).toUpperCase();
  const found = (currencies || []).find((c) => c.code.toUpperCase() === target);
  if (found?.symbol) return found.symbol;
  if (target === 'SAR') return 'ر.س';
  if (target === 'USD') return '$';
  if (target === 'YER') return 'ر.ي';
  if (target === 'AED') return 'د.إ';
  if (target === 'KWD') return 'د.ك';
  if (target === 'QAR') return 'ر.ق';
  if (target === 'BHD') return 'د.ب';
  if (target === 'OMR') return 'ر.ع';
  return target;
}

export function convertToBase(
  amount: number,
  sourceCode: CurrencyCode | undefined,
  currencies: Currency[] | undefined,
  explicitRate?: number
): number {
  const baseCode = ((currencies || []).find((c) => c.isBase)?.code || 'YER').toUpperCase();
  const src = (sourceCode || baseCode).toUpperCase();
  const rate =
    explicitRate && explicitRate > 0 && (src === baseCode || explicitRate !== 1)
      ? explicitRate
      : getEffectiveCurrencyRate(currencies, src);
  return Math.round((Number(amount) || 0) * rate * 100) / 100;
}

export function convertFromBase(
  baseAmount: number,
  targetCode: CurrencyCode | undefined,
  currencies: Currency[] | undefined
): number {
  const rate = getEffectiveCurrencyRate(currencies, targetCode);
  if (rate <= 0) return baseAmount;
  return Math.round(((Number(baseAmount) || 0) / rate) * 100) / 100;
}

export function formatCurrencyAmount(
  amount: number,
  code: CurrencyCode | undefined,
  currencies: Currency[] | undefined
): string {
  const baseCode = ((currencies || []).find((c) => c.isBase)?.code || 'YER').toUpperCase();
  const target = (code || baseCode).toUpperCase();
  const c = (currencies || []).find((x) => x.code.toUpperCase() === target);
  const decimals = c?.decimalPlaces ?? (target === 'YER' ? 0 : 2);
  const sym = getCurrencySymbol(currencies, target);
  const formatted = Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
  return `${formatted} ${sym}`;
}

export function parseTaggedCurrency(
  text: string | undefined | null
): { curr: CurrencyCode; rate: number } | null {
  const m = String(text || '').match(
    /\[(?:العملة الأصلية:\s*)?([A-Z]{3})\s*[×x*]\s*([\d.]+)\]/i
  );
  if (!m) return null;
  const curr = m[1].toUpperCase() as CurrencyCode;
  const rawRate = parseFloat(m[2]) || 1;
  const rate = rawRate > 0 && rawRate < 1 ? Math.round((1 / rawRate) * 100) / 100 : rawRate;
  return { curr, rate: rate > 0 ? rate : 1 };
}

/**
 * Reconciles and repairs SAR / USD currency classifications on both newly imported `.bak` DBs
 * and previously persisted IndexedDB/localStorage DBs, idempotently and without corrupting base YER ledger totals.
 */
export function reconcileSaudiCurrenciesInDb(db: ERPDatabase): ERPDatabase {
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  // 1. Ensure currencies contain YER, USD, SAR with normalized (>1) non-base rates
  const curList: Currency[] = Array.isArray(db.currencies) ? db.currencies.map((c) => ({ ...c })) : [];
  if (!curList.some((c) => c.code === 'YER')) {
    curList.unshift({ code: 'YER', nameAr: 'ريال يمني', symbol: 'ر.ي', exchangeRate: 1, isBase: true, decimalPlaces: 0 });
  }
  const existingSar = curList.find((c) => c.code === 'SAR');
  if (!existingSar) {
    curList.push({ code: 'SAR', nameAr: 'ريال سعودي', symbol: 'ر.س', exchangeRate: 142, isBase: false, decimalPlaces: 2 });
  } else {
    const r = Number(existingSar.exchangeRate || 0);
    if (r > 0 && r < 1) existingSar.exchangeRate = round2(1 / r);
    else if (r <= 1 && !existingSar.isBase) existingSar.exchangeRate = 142;
  }
  const existingUsd = curList.find((c) => c.code === 'USD');
  if (!existingUsd) {
    curList.push({ code: 'USD', nameAr: 'دولار أمريكي', symbol: '$', exchangeRate: 535, isBase: false, decimalPlaces: 2 });
  } else {
    const r = Number(existingUsd.exchangeRate || 0);
    if (r > 0 && r < 1) existingUsd.exchangeRate = round2(1 / r);
    else if (r <= 1 && !existingUsd.isBase) existingUsd.exchangeRate = 535;
  }

  // 2. Propagate Chart of Accounts currencies (from nameAr + parent chain)
  const accList = (db.chartOfAccounts || []).map((a) => ({ ...a }));
  const accByCode = new Map(accList.map((a) => [a.code, a]));
  const accById = new Map(accList.map((a) => [a.id, a]));

  const resolveAccCurrency = (acc: (typeof accList)[0]): CurrencyCode | undefined => {
    if (acc.currency && acc.currency !== 'YER') return acc.currency;
    if (hasSaudiHint(acc.nameAr)) return 'SAR';
    if (hasUsdHint(acc.nameAr)) return 'USD';
    let pCode = acc.parentCode;
    const seen = new Set<string>();
    while (pCode && !seen.has(pCode)) {
      seen.add(pCode);
      const pAcc = accByCode.get(pCode);
      if (!pAcc) break;
      if (pAcc.currency && pAcc.currency !== 'YER') return pAcc.currency;
      if (hasSaudiHint(pAcc.nameAr)) return 'SAR';
      if (hasUsdHint(pAcc.nameAr)) return 'USD';
      pCode = pAcc.parentCode;
    }
    return acc.currency;
  };

  accList.forEach((acc) => {
    const detected = resolveAccCurrency(acc);
    if (detected) acc.currency = detected;
  });

  // 3. Upgrade any legacy imported BAK-* invoices & VBK-* vouchers that still say YER/1 despite having [SAR × rate] tag
  const invList = (db.invoices || []).map((inv) => {
    const tagged = parseTaggedCurrency(inv.notes);
    if (
      tagged &&
      tagged.curr !== 'YER' &&
      tagged.rate > 1 &&
      inv.currency === 'YER' &&
      (inv.exchangeRate || 1) === 1 &&
      inv.invoiceNumber.startsWith('BAK-')
    ) {
      return {
        ...inv,
        currency: tagged.curr,
        exchangeRate: tagged.rate,
        subtotal: round2(inv.subtotal / tagged.rate),
        discountTotal: round2(inv.discountTotal / tagged.rate),
        taxTotal: round2(inv.taxTotal / tagged.rate),
        grandTotal: round2(inv.grandTotal / tagged.rate),
        paidAmount: round2(inv.paidAmount / tagged.rate),
        remainingAmount: round2(inv.remainingAmount / tagged.rate),
      };
    }
    return inv;
  });

  const vchList = (db.paymentVouchers || []).map((v) => {
    const tagged = parseTaggedCurrency(v.statement);
    if (
      tagged &&
      tagged.curr !== 'YER' &&
      tagged.rate > 1 &&
      v.currency === 'YER' &&
      (v.exchangeRate || 1) === 1 &&
      v.voucherNumber.startsWith('VBK-')
    ) {
      const base = v.baseAmount || v.amount;
      return {
        ...v,
        currency: tagged.curr,
        exchangeRate: tagged.rate,
        amount: round2(base / tagged.rate),
        baseAmount: base,
      };
    }
    return v;
  });

  // Track SAR transactions per entityId & accountId
  const sarCountsByEntity = new Map<string, number>();
  const yerCountsByEntity = new Map<string, number>();
  const sarCountsByAccId = new Map<string, number>();
  const sarCountsByAccCode = new Map<string, number>();

  const bumpSarEntity = (id?: string) => {
    if (id) sarCountsByEntity.set(id, (sarCountsByEntity.get(id) || 0) + 1);
  };
  const bumpYerEntity = (id?: string) => {
    if (id) yerCountsByEntity.set(id, (yerCountsByEntity.get(id) || 0) + 1);
  };

  invList.forEach((inv) => {
    if (!inv.entityId || inv.status === 'cancelled') return;
    const tagged = parseTaggedCurrency(inv.notes);
    if (inv.currency === 'SAR' || tagged?.curr === 'SAR' || hasSaudiHint(inv.notes)) {
      bumpSarEntity(inv.entityId);
    } else {
      bumpYerEntity(inv.entityId);
    }
  });

  vchList.forEach((v) => {
    if (!v.entityId || v.status !== 'posted') return;
    const tagged = parseTaggedCurrency(v.statement);
    if (v.currency === 'SAR' || tagged?.curr === 'SAR' || hasSaudiHint(v.statement)) {
      bumpSarEntity(v.entityId);
    } else {
      bumpYerEntity(v.entityId);
    }
  });

  (db.journalEntries || []).forEach((je) => {
    if (je.status !== 'posted') return;
    je.lines.forEach((ln) => {
      const tagged = parseTaggedCurrency(ln.memo);
      if (ln.currency === 'SAR' || tagged?.curr === 'SAR' || hasSaudiHint(ln.memo) || hasSaudiHint(ln.accountName)) {
        if (ln.accountId) sarCountsByAccId.set(ln.accountId, (sarCountsByAccId.get(ln.accountId) || 0) + 1);
        if (ln.accountCode) sarCountsByAccCode.set(ln.accountCode, (sarCountsByAccCode.get(ln.accountCode) || 0) + 1);
        if (je.referenceId) bumpSarEntity(je.referenceId);
      }
    });
  });

  // 4. Reconcile Customers & Vendors
  const custList = (db.customers || []).map((c) => {
    if (c.currency && c.currency !== 'YER') {
      if (c.linkedAccountId && accById.has(c.linkedAccountId)) {
        accById.get(c.linkedAccountId)!.currency = c.currency;
      }
      return c;
    }
    const linkedAcc =
      (c.linkedAccountId ? accById.get(c.linkedAccountId) : undefined) ||
      (c.linkedAccountCode ? accByCode.get(c.linkedAccountCode) : undefined);
    const sarTx =
      (sarCountsByEntity.get(c.id) || 0) +
      (c.linkedAccountId ? sarCountsByAccId.get(c.linkedAccountId) || 0 : 0) +
      (c.linkedAccountCode ? sarCountsByAccCode.get(c.linkedAccountCode) || 0 : 0);
    const yerTx = yerCountsByEntity.get(c.id) || 0;

    let inferred: CurrencyCode | undefined;
    if (
      hasSaudiHint(`${c.nameAr} ${c.notes || ''} ${c.addressDetails || ''}`) ||
      linkedAcc?.currency === 'SAR' ||
      (sarTx > 0 && sarTx >= yerTx)
    ) {
      inferred = 'SAR';
    } else if (hasUsdHint(`${c.nameAr} ${c.notes || ''}`) || linkedAcc?.currency === 'USD') {
      inferred = 'USD';
    }

    if (inferred) {
      if (linkedAcc) linkedAcc.currency = inferred;
      return { ...c, currency: inferred };
    }
    return c;
  });

  const vendList = (db.vendors || []).map((v) => {
    if (v.currency && v.currency !== 'YER') {
      if (v.linkedAccountId && accById.has(v.linkedAccountId)) {
        accById.get(v.linkedAccountId)!.currency = v.currency;
      }
      return v;
    }
    const linkedAcc =
      (v.linkedAccountId ? accById.get(v.linkedAccountId) : undefined) ||
      (v.linkedAccountCode ? accByCode.get(v.linkedAccountCode) : undefined);
    const sarTx =
      (sarCountsByEntity.get(v.id) || 0) +
      (v.linkedAccountId ? sarCountsByAccId.get(v.linkedAccountId) || 0 : 0) +
      (v.linkedAccountCode ? sarCountsByAccCode.get(v.linkedAccountCode) || 0 : 0);
    const yerTx = yerCountsByEntity.get(v.id) || 0;

    let inferred: CurrencyCode | undefined;
    if (
      hasSaudiHint(`${v.nameAr} ${v.notes || ''} ${v.address || ''}`) ||
      linkedAcc?.currency === 'SAR' ||
      (sarTx > 0 && sarTx >= yerTx)
    ) {
      inferred = 'SAR';
    } else if (hasUsdHint(`${v.nameAr} ${v.notes || ''}`) || linkedAcc?.currency === 'USD') {
      inferred = 'USD';
    }

    if (inferred) {
      if (linkedAcc) linkedAcc.currency = inferred;
      return { ...v, currency: inferred };
    }
    return v;
  });

  // Also ensure any account with SAR JE activity gets marked SAR
  accList.forEach((acc) => {
    if (!acc.currency || acc.currency === 'YER') {
      if ((sarCountsByAccId.get(acc.id) || 0) > 0 || (sarCountsByAccCode.get(acc.code) || 0) > 0) {
        acc.currency = 'SAR';
      }
    }
  });

  // 5. Upgrade untagged BAK-* invoices belonging to SAR/USD parties AND repair unscaled YER line items on foreign BAK-* invoices (strictly idempotent)
  const partyCurrencyMap = new Map<string, CurrencyCode>();
  custList.forEach((c) => {
    if (c.currency && c.currency !== 'YER') partyCurrencyMap.set(c.id, c.currency);
  });
  vendList.forEach((v) => {
    if (v.currency && v.currency !== 'YER') partyCurrencyMap.set(v.id, v.currency);
  });
  accList.forEach((a) => {
    if (a.currency && a.currency !== 'YER') partyCurrencyMap.set(a.id, a.currency);
  });

  const repairedInvList = invList.map((inv) => {
    let curInv = inv;
    const isBak = curInv.invoiceNumber.startsWith('BAK-');
    const existingTag = parseTaggedCurrency(curInv.notes);

    // 5a. If BAK-* invoice is still YER/1 and has no [العملة الأصلية:] tag, check if party (or note) is SAR/USD
    if (
      isBak &&
      curInv.currency === 'YER' &&
      (curInv.exchangeRate || 1) === 1 &&
      !existingTag
    ) {
      const partyCurr = partyCurrencyMap.get(curInv.entityId);
      const targetCurr: CurrencyCode | undefined =
        partyCurr && partyCurr !== 'YER'
          ? partyCurr
          : hasSaudiHint(`${curInv.entityName} ${curInv.notes || ''}`)
          ? 'SAR'
          : undefined;
      if (targetCurr && targetCurr !== 'YER') {
        const effRate = getEffectiveCurrencyRate(curList, targetCurr);
        if (effRate > 1) {
          const baseNote = curInv.notes ? `${curInv.notes} ` : '';
          curInv = {
            ...curInv,
            currency: targetCurr,
            exchangeRate: effRate,
            subtotal: round2(curInv.subtotal / effRate),
            discountTotal: round2(curInv.discountTotal / effRate),
            taxTotal: round2(curInv.taxTotal / effRate),
            grandTotal: round2(curInv.grandTotal / effRate),
            paidAmount: round2(curInv.paidAmount / effRate),
            remainingAmount: round2(curInv.remainingAmount / effRate),
            notes: `${baseNote}[العملة الأصلية: ${targetCurr} × ${effRate}]`.trim(),
          };
        }
      }
    }

    // 5b. For foreign BAK-* invoices, ensure exchangeRate > 1 and check whether items still store raw YER values
    if (isBak && curInv.currency !== 'YER') {
      const effRate = getEffectiveCurrencyRate(curList, curInv.currency, curInv.exchangeRate);
      if ((curInv.exchangeRate || 1) <= 1 && effRate > 1) {
        curInv = { ...curInv, exchangeRate: effRate };
      }
      if (effRate > 1 && Array.isArray(curInv.items) && curInv.items.length > 0 && curInv.grandTotal > 0) {
        const itemsSum = curInv.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
        const expectedYer = curInv.grandTotal * effRate;
        const ratio = expectedYer > 0 ? itemsSum / expectedYer : 0;
        if (itemsSum > curInv.grandTotal * 2 && ratio >= 0.85 && ratio <= 1.15) {
          curInv = {
            ...curInv,
            items: curInv.items.map((it) => ({
              ...it,
              unitPrice: round2(it.unitPrice / effRate),
              discountAmount: round2(it.discountAmount / effRate),
              subtotal: round2(it.subtotal / effRate),
              taxAmount: round2(it.taxAmount / effRate),
              total: round2(it.total / effRate),
            })),
          };
        }
      }
    }

    return curInv;
  });

  return {
    ...db,
    currencies: curList,
    chartOfAccounts: accList,
    customers: custList,
    vendors: vendList,
    invoices: repairedInvList,
    paymentVouchers: vchList,
  };
}
