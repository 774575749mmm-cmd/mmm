/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Native Browser SQL Server (.bak / .bakw) MTF + MDF Parser
 * محرك استخراج وقراءة قواعد بيانات SQL Server غير المضغوطة مباشرة داخل المتصفح
 */

import * as XLSX from 'xlsx';
import {
  Account,
  AccountCategory,
  AccountNature,
  Branch,
  CostCenter,
  Currency,
  Customer,
  Employee,
  ExpenseCategory,
  ExpenseRecord,
  InventoryItem,
  Invoice,
  InvoiceItem,
  ItemWarehouseStock,
  JournalEntry,
  JournalEntryLine,
  PaymentVoucher,
  RegionalArea,
  TreasuryAccount,
  User,
  Vendor,
  Warehouse,
} from '../types/erp';
import { ERPDatabase } from './storageService';
import {
  getEffectiveCurrencyRate,
  getEffectiveSarRate,
  hasSaudiHint,
  hasUsdHint,
  reconcileSaudiCurrenciesInDb,
} from './currencyHelpers';

export interface BakTableSummary {
  objectId: number;
  name: string;
  pageCount: number;
  estimatedRows: number;
}

export interface ParsedBakDatabase {
  fileName: string;
  databaseName: string;
  mdfStartOffset: number;
  totalPages: number;
  tables: BakTableSummary[];
  decodeTable: (tableName: string, maxRows?: number) => Record<string, any>[];
  exportTableToExcel: (tableName: string) => void;
  exportAllKeyTablesToExcel: () => void;
  getQrightMigrationPreview: () => QrightMigrationPreview;
  applyQrightMigration: (
    currentDb: ERPDatabase,
    mode: 'merge' | 'replace',
    options: { includeCompany: boolean; includeRecentInvoices: boolean }
  ) => { updatedDb: ERPDatabase; stats: QrightMigrationStats };
}

export interface QrightMigrationPreview {
  isQrightSchema: boolean;
  companyName: string;
  counts: {
    accounts: number;
    customers: number;
    vendorsFromAccounts: number;
    materials: number;
    warehouses: number;
    warehouseStock: number;
    bills: number;
    bonds: number;
    entryBonds: number;
  };
}

export interface QrightMigrationStats {
  accountsImported: number;
  customersImported: number;
  vendorsImported: number;
  itemsImported: number;
  stockRowsImported: number;
  warehousesImported: number;
  invoicesImported: number;
  vouchersImported: number;
  journalEntriesImported: number;
}

interface AllocUnit {
  auid: bigint;
  atype: number;
  ownerid: bigint;
  pgfirst: number;
  pgiam: number;
}

interface ColMeta {
  colid: number;
  name: string;
  xtype: number;
  length: number;
  prec: number;
  scale: number;
}

interface RsColMeta {
  rscolid: number;
  hbcolid: number;
  offset: number;
  nullbit: number;
  bitpos: number;
}

const utf16Decoder = new TextDecoder('utf-16le');
let cp1256Decoder: TextDecoder | null = null;
try {
  cp1256Decoder = new TextDecoder('windows-1256');
} catch {
  cp1256Decoder = null;
}

function formatGuid(bytes: Uint8Array, offset: number): string {
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  const d1 =
    hex(bytes[offset + 3]) +
    hex(bytes[offset + 2]) +
    hex(bytes[offset + 1]) +
    hex(bytes[offset]);
  const d2 = hex(bytes[offset + 5]) + hex(bytes[offset + 4]);
  const d3 = hex(bytes[offset + 7]) + hex(bytes[offset + 6]);
  const d4 = hex(bytes[offset + 8]) + hex(bytes[offset + 9]);
  const d5 =
    hex(bytes[offset + 10]) +
    hex(bytes[offset + 11]) +
    hex(bytes[offset + 12]) +
    hex(bytes[offset + 13]) +
    hex(bytes[offset + 14]) +
    hex(bytes[offset + 15]);
  return `${d1}-${d2}-${d3}-${d4}-${d5}`;
}

function sqlDateTimeToIso(days: number, ticks: number): string | null {
  if (days < -53690 || days > 2958463) return null;
  const baseMs = Date.UTC(1900, 0, 1);
  const ms = baseMs + days * 86400000 + Math.round((ticks / 300) * 1000);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}

function findMdfBounds(
  bytes: Uint8Array,
  dv: DataView
): { start: number; pageOffsetMap: Map<number, number>; dbName: string } {
  let start = -1;
  const searchLimit = Math.min(bytes.length - 16384, 2_000_000);
  for (let off = 0; off <= searchLimit; off += 512) {
    // Page 0 header: version=1, type=15 (File Header), pageId=0, fileId=1
    if (
      bytes[off] === 1 &&
      bytes[off + 1] === 15 &&
      dv.getUint32(off + 32, true) === 0 &&
      dv.getUint16(off + 36, true) === 1
    ) {
      const nextPgOff = off + 8192;
      if (
        bytes[nextPgOff] === 1 &&
        dv.getUint32(nextPgOff + 32, true) === 1 &&
        dv.getUint16(nextPgOff + 36, true) === 1
      ) {
        start = off;
        break;
      }
    }
  }

  if (start === -1) {
    throw new Error(
      'لم يتم العثور على صفحات بيانات SQL Server غير مضغوطة داخل هذا الملف. إذا كانت النسخة مضغوطة (Backup Compression) أو مشفرة، يرجى استعادتها عبر SSMS أولاً باستخدام سكربت SQL المرفق.'
    );
  }

  // Build exact pageId -> fileOffset map (handles sparse extent jumps in .bak files!)
  const pageOffsetMap = new Map<number, number>();
  for (let off = start; off + 8192 <= bytes.length; off += 8192) {
    // Stop if we hit an MTF stream trailer (MQDA / ESET) at page boundary
    if (
      (bytes[off] === 77 && bytes[off + 1] === 81 && bytes[off + 2] === 68 && bytes[off + 3] === 65) ||
      (bytes[off] === 69 && bytes[off + 1] === 83 && bytes[off + 2] === 69 && bytes[off + 3] === 84)
    ) {
      break;
    }
    if (bytes[off] === 1 && bytes[off + 1] >= 1 && bytes[off + 1] <= 20) {
      const fileId = dv.getUint16(off + 36, true);
      if (fileId === 1) {
        const pgId = dv.getUint32(off + 32, true);
        pageOffsetMap.set(pgId, off);
      }
    }
  }

  // Extract database name from Boot Page (page 9) if present
  let dbName = 'SQLServerDB';
  const bootOff = pageOffsetMap.get(9);
  if (bootOff !== undefined && bytes[bootOff + 1] === 13) {
    const slice = bytes.slice(bootOff + 96, bootOff + 600);
    const text = utf16Decoder.decode(slice);
    const match = text.match(/[A-Za-z0-9_]{3,32}/);
    if (match) dbName = match[0];
  }

  return { start, pageOffsetMap, dbName };
}

export function parseSqlServerBakBuffer(buffer: ArrayBuffer, fileName: string): ParsedBakDatabase {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const { start: mdfStart, pageOffsetMap, dbName } = findMdfBounds(bytes, dv);
  const totalPages = pageOffsetMap.size;

  const getPageOffset = (pgId: number): number => {
    if (pgId <= 0) return -1;
    return pageOffsetMap.get(pgId) ?? -1;
  };

  const iterSlots = (pageOff: number): number[] => {
    const slotCnt = dv.getUint16(pageOff + 22, true);
    const out: number[] = [];
    for (let s = 0; s < slotCnt; s++) {
      const soff = dv.getUint16(pageOff + 8192 - 2 * (s + 1), true);
      if (soff >= 96 && soff < 8192) {
        out.push(pageOff + soff);
      }
    }
    return out;
  };

  const walkChain = (pgFirst: number): number[] => {
    const visited = new Set<number>();
    const pages: number[] = [];
    let pg = pgFirst;
    while (pg > 0 && !visited.has(pg)) {
      visited.add(pg);
      const off = getPageOffset(pg);
      if (off < 0) break;
      pages.push(off);
      pg = dv.getUint32(off + 16, true); // m_nextPage
    }
    return pages;
  };

  const findPagesByObjId = (targetObjId: number): number[] => {
    const out: number[] = [];
    for (const off of pageOffsetMap.values()) {
      if (bytes[off] === 1 && bytes[off + 1] === 1 && dv.getUint32(off + 24, true) === targetObjId) {
        out.push(off);
      }
    }
    return out;
  };

  const parseVarLen = (recOff: number, fsize: number) => {
    const statusA = bytes[recOff];
    if (recOff + fsize + 2 > bytes.length) {
      return { nbm: new Uint8Array(0), vcols: [] as { slice: Uint8Array; complex: boolean }[] };
    }
    const ncols = dv.getUint16(recOff + fsize, true);
    const nbmLen = Math.ceil(ncols / 8);
    const nbmStart = recOff + fsize + 2;
    const nbm = bytes.subarray(nbmStart, nbmStart + nbmLen);
    if ((statusA & 0x20) === 0) {
      return { nbm, vcols: [] as { slice: Uint8Array; complex: boolean }[] };
    }
    const vpos = nbmStart + nbmLen;
    if (vpos + 2 > bytes.length) return { nbm, vcols: [] };
    const nvar = dv.getUint16(vpos, true);
    if (vpos + 2 + 2 * nvar > bytes.length) return { nbm, vcols: [] };
    const ends: number[] = [];
    for (let i = 0; i < nvar; i++) {
      ends.push(dv.getUint16(vpos + 2 + 2 * i, true));
    }
    let cur = vpos + 2 + 2 * nvar;
    const vcols: { slice: Uint8Array; complex: boolean }[] = [];
    for (const e of ends) {
      const complex = (e & 0x8000) !== 0;
      const realEnd = recOff + (e & 0x7fff);
      if (realEnd >= cur && realEnd <= bytes.length) {
        vcols.push({ slice: bytes.subarray(cur, realEnd), complex });
        cur = realEnd;
      } else {
        vcols.push({ slice: new Uint8Array(0), complex: true });
      }
    }
    return { nbm, vcols };
  };

  // 1. Read sysallocunits (obj=7)
  const allocPages = findPagesByObjId(7);
  const allocs: AllocUnit[] = [];
  for (const pOff of allocPages) {
    for (const rOff of iterSlots(pOff)) {
      if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
      const fsize = dv.getUint16(rOff + 2, true);
      if (fsize < 45) continue;
      const auid = dv.getBigInt64(rOff + 4, true);
      const atype = bytes[rOff + 12];
      const ownerid = dv.getBigInt64(rOff + 13, true);
      const pgfirst = dv.getUint32(rOff + 27, true);
      const pgiam = dv.getUint32(rOff + 39, true);
      allocs.push({ auid, atype, ownerid, pgfirst, pgiam });
    }
  }

  // 2. Read sysrowsets (obj=5)
  const rowsetPages = findPagesByObjId(5);
  const rowsets = new Map<bigint, { idmajor: number; idminor: number }>();
  for (const pOff of rowsetPages) {
    for (const rOff of iterSlots(pOff)) {
      if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
      const fsize = dv.getUint16(rOff + 2, true);
      if (fsize < 21) continue;
      const rsid = dv.getBigInt64(rOff + 4, true);
      const idmajor = dv.getInt32(rOff + 13, true);
      const idminor = dv.getInt32(rOff + 17, true);
      rowsets.set(rsid, { idmajor, idminor });
    }
  }

  const objAlloc = new Map<number, { rsid: bigint; auid: bigint; pgfirst: number; pgiam: number }>();
  for (const a of allocs) {
    if (a.atype === 1) {
      const rs = rowsets.get(a.ownerid);
      if (rs && (rs.idminor === 0 || rs.idminor === 1)) {
        const existing = objAlloc.get(rs.idmajor);
        // Prefer populated allocation unit if multiple partitions exist
        if (!existing || a.pgfirst > 0 || a.pgiam > 0) {
          objAlloc.set(rs.idmajor, { rsid: a.ownerid, auid: a.auid, pgfirst: a.pgfirst, pgiam: a.pgiam });
        }
      }
    }
  }

  // 3. Read sysschobjs (obj=34)
  const schPages =
    objAlloc.has(34) && objAlloc.get(34)!.pgfirst > 0
      ? walkChain(objAlloc.get(34)!.pgfirst)
      : findPagesByObjId(34);
  const userTablesByName = new Map<string, number>();
  for (const pOff of schPages) {
    for (const rOff of iterSlots(pOff)) {
      if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
      const fsize = dv.getUint16(rOff + 2, true);
      if (fsize < 19) continue;
      const oid = dv.getInt32(rOff + 4, true);
      const otype = String.fromCharCode(bytes[rOff + 17], bytes[rOff + 18]).trim();
      if (otype !== 'U') continue;
      const { vcols } = parseVarLen(rOff, fsize);
      if (vcols.length > 0 && !vcols[0].complex) {
        const tname = utf16Decoder.decode(vcols[0].slice);
        if (tname) userTablesByName.set(tname, oid);
      }
    }
  }

  // 4. Read syscolpars (obj=41)
  const colPages =
    objAlloc.has(41) && objAlloc.get(41)!.pgfirst > 0
      ? walkChain(objAlloc.get(41)!.pgfirst)
      : findPagesByObjId(41);
  const colsByObj = new Map<number, Map<number, ColMeta>>();
  for (const pOff of colPages) {
    for (const rOff of iterSlots(pOff)) {
      if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
      const fsize = dv.getUint16(rOff + 2, true);
      if (fsize < 27) continue;
      const oid = dv.getInt32(rOff + 4, true);
      const num = dv.getInt16(rOff + 8, true);
      if (num !== 0) continue;
      const colid = dv.getInt32(rOff + 10, true);
      const xtype = bytes[rOff + 14];
      const length = dv.getUint16(rOff + 19, true);
      const prec = bytes[rOff + 21];
      const scale = bytes[rOff + 22];
      const { vcols } = parseVarLen(rOff, fsize);
      const cname = vcols.length > 0 && !vcols[0].complex ? utf16Decoder.decode(vcols[0].slice) : `col_${colid}`;
      if (!colsByObj.has(oid)) colsByObj.set(oid, new Map());
      colsByObj.get(oid)!.set(colid, { colid, name: cname, xtype, length, prec, scale });
    }
  }

  // 5. Read sysrscols (obj=3)
  const rsColPages = findPagesByObjId(3);
  const rscolsByRsid = new Map<bigint, RsColMeta[]>();
  for (const pOff of rsColPages) {
    for (const rOff of iterSlots(pOff)) {
      if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
      const fsize = dv.getUint16(rOff + 2, true);
      if (fsize < 54) continue;
      const rsid = dv.getBigInt64(rOff + 4, true);
      const rscolid = dv.getInt32(rOff + 12, true);
      const hbcolid = dv.getInt32(rOff + 16, true);
      const offset = dv.getInt16(rOff + 44, true);
      const nullbit = dv.getUint16(rOff + 48, true);
      const bitpos = dv.getInt16(rOff + 52, true);
      if (!rscolsByRsid.has(rsid)) rscolsByRsid.set(rsid, []);
      rscolsByRsid.get(rsid)!.push({ rscolid, hbcolid, offset, nullbit, bitpos });
    }
  }

  const getIamDataPages = (pgiam: number, auid: bigint): number[] => {
    const targetObjId = Number((auid >> 16n) & 0xffffffffn);
    const pgSet = new Set<number>();
    for (const iamOff of walkChain(pgiam)) {
      if (bytes[iamOff + 1] !== 10) continue;
      const startPg = dv.getUint32(iamOff + 136, true);
      for (let i = 0; i < 8; i++) {
        const sp = dv.getUint32(iamOff + 142 + i * 6, true);
        if (sp > 0) pgSet.add(sp);
      }
      const bmLen = Math.min(7988, 8192 - 194);
      for (let b = 0; b < bmLen; b++) {
        const byteVal = bytes[iamOff + 194 + b];
        if (byteVal !== 0) {
          for (let bit = 0; bit < 8; bit++) {
            if ((byteVal & (1 << bit)) !== 0) {
              const extPg = startPg + (b * 8 + bit) * 8;
              for (let k = 0; k < 8; k++) pgSet.add(extPg + k);
            }
          }
        }
      }
    }
    const out: number[] = [];
    Array.from(pgSet)
      .sort((a, b) => a - b)
      .forEach((pgId) => {
        const pOff = getPageOffset(pgId);
        if (
          pOff >= 0 &&
          bytes[pOff] === 1 &&
          bytes[pOff + 1] === 1 &&
          dv.getUint32(pOff + 24, true) === targetObjId
        ) {
          out.push(pOff);
        }
      });
    return out;
  };

  const getTablePageOffsets = (oid: number): number[] => {
    const alloc = objAlloc.get(oid);
    if (!alloc) return [];
    if (alloc.pgfirst > 0) return walkChain(alloc.pgfirst);
    if (alloc.pgiam > 0) return getIamDataPages(alloc.pgiam, alloc.auid);
    return [];
  };

  const decodeTable = (tableName: string, maxRows = 100000): Record<string, any>[] => {
    const oid = userTablesByName.get(tableName);
    if (oid === undefined) return [];
    const alloc = objAlloc.get(oid);
    const cmeta = colsByObj.get(oid);
    if (!alloc || !cmeta) return [];
    const rcols = rscolsByRsid.get(alloc.rsid) || [];
    const pageOffsets = getTablePageOffsets(oid);
    const rows: Record<string, any>[] = [];

    for (const pOff of pageOffsets) {
      for (const rOff of iterSlots(pOff)) {
        if ((bytes[rOff] & 0x0e) !== 0 && (bytes[rOff] & 0x0e) !== 2) continue;
        const fsize = dv.getUint16(rOff + 2, true);
        const { nbm, vcols } = parseVarLen(rOff, fsize);
        const row: Record<string, any> = {};

        for (const rc of rcols) {
          const col = cmeta.get(rc.rscolid);
          if (!col) continue;
          const nb = rc.nullbit - 1;
          const isNull =
            nb >= 0 && Math.floor(nb / 8) < nbm.length ? (nbm[Math.floor(nb / 8)] & (1 << (nb % 8))) !== 0 : false;
          if (isNull) {
            row[col.name] = null;
            continue;
          }

          if (rc.offset < 0) {
            const vidx = -rc.offset - 1;
            const vc = vcols[vidx];
            if (!vc || vc.complex) {
              row[col.name] = null;
            } else if (col.xtype === 231) {
              row[col.name] = utf16Decoder.decode(vc.slice);
            } else if (col.xtype === 167) {
              row[col.name] = cp1256Decoder ? cp1256Decoder.decode(vc.slice) : utf16Decoder.decode(vc.slice);
            } else {
              row[col.name] = `<${vc.slice.length}B>`;
            }
          } else if (col.xtype === 104) {
            row[col.name] = rc.offset < fsize ? (bytes[rOff + rc.offset] & (1 << rc.bitpos)) !== 0 : false;
          } else if (rc.offset + col.length <= fsize) {
            const valOff = rOff + rc.offset;
            if (col.xtype === 56) row[col.name] = dv.getInt32(valOff, true);
            else if (col.xtype === 127) row[col.name] = Number(dv.getBigInt64(valOff, true));
            else if (col.xtype === 52) row[col.name] = dv.getInt16(valOff, true);
            else if (col.xtype === 48) row[col.name] = bytes[valOff];
            else if (col.xtype === 62) row[col.name] = dv.getFloat64(valOff, true);
            else if (col.xtype === 59) row[col.name] = dv.getFloat32(valOff, true);
            else if (col.xtype === 36) row[col.name] = formatGuid(bytes, valOff);
            else if (col.xtype === 61) {
              const ticks = dv.getInt32(valOff, true);
              const days = dv.getInt32(valOff + 4, true);
              row[col.name] = sqlDateTimeToIso(days, ticks);
            } else {
              row[col.name] = null;
            }
          }
        }
        rows.push(row);
        if (rows.length >= maxRows) return rows;
      }
    }
    return rows;
  };

  // Build table summaries
  const tables: BakTableSummary[] = Array.from(userTablesByName.entries())
    .map(([name, oid]) => {
      const pOffs = getTablePageOffsets(oid);
      let estRows = 0;
      for (const pOff of pOffs) {
        estRows += dv.getUint16(pOff + 22, true);
      }
      return {
        objectId: oid,
        name,
        pageCount: pOffs.length,
        estimatedRows: estRows,
      };
    })
    .sort((a, b) => b.estimatedRows - a.estimatedRows);

  const exportTableToExcel = (tableName: string) => {
    const rows = decodeTable(tableName);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ message: 'لا توجد صفوف' }]);
    XLSX.utils.book_append_sheet(wb, ws, tableName.slice(0, 31));
    XLSX.writeFile(wb, `${dbName}_${tableName}.xlsx`);
  };

  const exportAllKeyTablesToExcel = () => {
    const preferred = [
      'Branchs',
      'Currency',
      'Stores',
      'Groups',
      'Accounts',
      'Customers',
      'Materials',
      'StoresInventory',
      'Bills',
      'BillItems',
      'Bonds',
      'EntryBonds',
      'EntryBondsItems',
    ].filter((t) => userTablesByName.has(t));

    const wb = XLSX.utils.book_new();
    preferred.forEach((tName) => {
      const rows = decodeTable(tName, 25000);
      if (rows.length > 0) {
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, tName.slice(0, 31));
      }
    });
    XLSX.writeFile(wb, `${dbName}_Extracted_Tables.xlsx`);
  };

  const getQrightMigrationPreview = (): QrightMigrationPreview => {
    const isQrightSchema =
      userTablesByName.has('Accounts') && userTablesByName.has('Customers') && userTablesByName.has('Materials');
    const branchRows = userTablesByName.has('Branchs') ? decodeTable('Branchs', 5) : [];
    const companyName = String(branchRows[0]?.Name || dbName);
    const countOf = (name: string) => tables.find((t) => t.name === name)?.estimatedRows || 0;
    const accs = userTablesByName.has('Accounts') ? decodeTable('Accounts', 10000) : [];
    const vendorsCount = accs.filter((a) => {
      const code = String(a.Code || '').trim();
      return (code.startsWith('221') || code.startsWith('222')) && code.length >= 4;
    }).length;

    return {
      isQrightSchema,
      companyName,
      counts: {
        accounts: countOf('Accounts'),
        customers: countOf('Customers'),
        vendorsFromAccounts: vendorsCount,
        materials: countOf('Materials'),
        warehouses: countOf('Stores'),
        warehouseStock: countOf('StoresInventory'),
        bills: countOf('Bills'),
        bonds: countOf('Bonds'),
        entryBonds: countOf('EntryBonds'),
      },
    };
  };

  const applyQrightMigration = (
    currentDb: ERPDatabase,
    mode: 'merge' | 'replace',
    options: { includeCompany: boolean; includeRecentInvoices: boolean }
  ): { updatedDb: ERPDatabase; stats: QrightMigrationStats } => {
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
    let updatedDb: ERPDatabase = { ...currentDb };

    // 1. Currencies (resolve base currency first for company profile; handle Arabic Alef Maqsura & inverted rates)
    const currRows = decodeTable('Currency', 20);
    const currGuidToCode = new Map<string, Currency['code']>();
    if (currRows.length > 0) {
      const mappedCurrencies: Currency[] = [];
      currRows.forEach((c) => {
        const name = String(c.Name || '');
        const symbolRaw = String(c.Code || '');
        const combined = `${name} ${symbolRaw}`;
        let code: Currency['code'] | null = null;
        let symbol = symbolRaw;
        if (name.includes('يمن') || symbolRaw.includes('ر.ي') || /\byer\b/i.test(combined)) {
          code = 'YER';
          symbol = 'ر.ي';
        } else if (hasUsdHint(combined)) {
          code = 'USD';
          symbol = '$';
        } else if (hasSaudiHint(combined)) {
          code = 'SAR';
          symbol = 'ر.س';
        }
        if (code) {
          if (c.GUID) currGuidToCode.set(String(c.GUID), code);
          let rate = Number(c.CurrencyVal || 0);
          if (code !== 'YER' && rate > 0 && rate < 1) {
            rate = Math.round((1 / rate) * 100) / 100;
          }
          if (code !== 'YER' && rate <= 1) {
            rate = code === 'SAR' ? 142 : 535;
          }
          if (!mappedCurrencies.some((x) => x.code === code)) {
            mappedCurrencies.push({
              code,
              nameAr: name || (code === 'SAR' ? 'ريال سعودي' : code === 'USD' ? 'دولار أمريكي' : 'ريال يمني'),
              symbol,
              exchangeRate: code === 'YER' ? 1 : rate || 1,
              isBase: code === 'YER',
              decimalPlaces: code === 'YER' ? 0 : 2,
            });
          }
        }
      });
      if (mappedCurrencies.length > 0) {
        currentDb.currencies.forEach((defC) => {
          if (!mappedCurrencies.some((m) => m.code === defC.code)) {
            mappedCurrencies.push(defC);
          }
        });
        updatedDb.currencies = mappedCurrencies;
      }
    }
    const baseCurrCode = updatedDb.currencies.find((c) => c.isBase)?.code || 'YER';
    const importedSarRate = getEffectiveSarRate(updatedDb.currencies);

    // 2. Users from Users table
    const userRows = userTablesByName.has('Users') ? decodeTable('Users', 500) : [];
    const userGuidToName = new Map<string, string>();
    const mappedUsers: User[] = userRows
      .filter((u) => String(u.Name || '').trim() !== '')
      .sort((a, b) => Number(a.Number || 0) - Number(b.Number || 0))
      .map((u, idx) => {
        const fullName = String(u.Name || '').trim();
        if (u.GUID) userGuidToName.set(String(u.GUID), fullName);
        const isAdmin = idx === 0 || Number(u.Number) === 1 || fullName === 'منصور' || fullName === 'ايمن';
        return {
          id: `usr-bak-${u.Number || idx + 1}`,
          username: String(u.Code || `user${idx + 1}`),
          fullName,
          role: isAdmin ? 'مالك المؤسسة' : 'محاسب',
          branchId: 'br-bak-1',
          email: u.Email ? String(u.Email) : '',
          active: u.IsView !== false,
          canViewReports: true,
          canPostEntries: true,
          canAdjustInventory: isAdmin,
          canViewCostsAndProfits: isAdmin,
          canManageSettings: isAdmin,
        };
      });
    if (mode === 'replace' && mappedUsers.length > 0) {
      updatedDb.users = mappedUsers;
    }

    // 3. Company & Branchs (strictly from Branchs table, no demo fallback in replace mode)
    const branchRows = userTablesByName.has('Branchs') ? decodeTable('Branchs', 50) : [];
    const mappedBranches: Branch[] = branchRows
      .filter((b) => String(b.Name || '').trim() !== '')
      .map((b, idx) => ({
        id: `br-bak-${b.Number || idx + 1}`,
        companyId: 'comp-bak-1',
        code: String(b.Code || `BR-${idx + 1}`).trim(),
        nameAr: String(b.Name || dbName).trim(),
        phone: String(b.Phone || b.Mobile || '').trim(),
        address: [b.Address, b.StreetName, b.District, b.City].filter(Boolean).map(String).join(' - '),
        managerName: updatedDb.users[0]?.fullName || 'الإدارة',
        isMain: idx === 0,
        status: b.IsView === false ? 'inactive' : 'active',
      }));

    if (mappedBranches.length > 0) {
      if (mode === 'replace') {
        updatedDb.branches = mappedBranches;
        updatedDb.users = updatedDb.users.map((u) => ({ ...u, branchId: mappedBranches[0].id }));
      } else if (options.includeCompany) {
        const mergedBr = [...currentDb.branches];
        mappedBranches.forEach((b) => {
          if (!mergedBr.some((x) => x.code === b.code || x.nameAr === b.nameAr)) {
            mergedBr.push(b);
          }
        });
        updatedDb.branches = mergedBr;
      }
    }

    if ((mode === 'replace' || options.includeCompany) && branchRows.length > 0) {
      const b0 = branchRows[0];
      const compAddr = [b0.Address, b0.StreetName, b0.District, b0.City, b0.Country]
        .filter(Boolean)
        .map(String)
        .join(' - ');
      const latin = b0.LatinName && b0.LatinName !== 'Company Name' ? String(b0.LatinName).trim() : '';
      updatedDb.company = {
        id: 'comp-bak-1',
        nameAr: String(b0.Name || dbName).trim(),
        nameEn: latin || String(b0.Name || dbName).trim(),
        commercialRecord: String(b0.CommercialRegistry || '').trim(),
        taxNumber: String(b0.TaxNumber || b0.VatNumber || '').trim(),
        phone: String(b0.Phone || b0.Mobile || '').trim(),
        email: String(b0.Email || '').trim(),
        address: compAddr,
        baseCurrency: baseCurrCode,
      };
    }
    const branchId = updatedDb.branches[0]?.id || 'br-1';

    // 4. Regional Areas (strictly from Addy hierarchy + distinct Customer City/Address)
    const addyRows = userTablesByName.has('Addy') ? decodeTable('Addy', 2000) : [];
    const addyByGuid = new Map<string, Record<string, any>>();
    addyRows.forEach((a) => {
      if (a.GUID) addyByGuid.set(String(a.GUID), a);
    });

    const getAddyPath = (row: Record<string, any>): Record<string, any>[] => {
      const path: Record<string, any>[] = [];
      const visited = new Set<string>();
      let cur: Record<string, any> | undefined = row;
      while (cur && cur.GUID && !visited.has(String(cur.GUID))) {
        visited.add(String(cur.GUID));
        path.unshift(cur);
        const pGuid = String(cur.ParentGUID || '');
        if (!pGuid || pGuid === ZERO_GUID) break;
        cur = addyByGuid.get(pGuid);
      }
      return path;
    };

    const addyGuidToAreaId = new Map<string, string>();
    const areaNameToId = new Map<string, string>();
    const mappedRegionalAreas: RegionalArea[] = [];

    addyRows
      .filter((a) => String(a.Name || '').trim() !== '')
      .sort((a, b) => Number(a.Number || 0) - Number(b.Number || 0))
      .forEach((a, idx) => {
        const path = getAddyPath(a);
        const leafName = String(a.Name || '').trim();
        const rootName = path.length > 0 ? String(path[0].Name || '').trim() : '';
        const parentName = path.length >= 3 ? String(path[path.length - 2].Name || '').trim() : '';
        const areaObj: RegionalArea = {
          id: `area-bak-${a.Number || idx + 1}`,
          country: String(branchRows[0]?.Country || '').trim(),
          governorate: rootName === 'زبائن التحويل' && path.length >= 2 ? String(path[1].Name || '').trim() : rootName,
          district: parentName === 'زبائن التحويل' ? '' : parentName,
          area: leafName,
          code: String(a.Code || `A-${idx + 1}`).trim(),
        };
        mappedRegionalAreas.push(areaObj);
        if (a.GUID) addyGuidToAreaId.set(String(a.GUID), areaObj.id);
        if (!areaNameToId.has(leafName)) areaNameToId.set(leafName, areaObj.id);
      });

    // 5. Stores -> Warehouses
    const storeRows = decodeTable('Stores', 200);
    const storeGuidToWhId = new Map<string, string>();
    const mappedWarehouses: Warehouse[] = storeRows.map((s, idx) => {
      const whId = `wh-bak-${s.Number || idx + 1}`;
      if (s.GUID) storeGuidToWhId.set(String(s.GUID), whId);
      const rawName = String(s.Name || '').trim();
      const label = !rawName || rawName === String(s.Code || '').trim() ? `مستودع ${s.Code || idx + 1}` : rawName;
      return {
        id: whId,
        branchId,
        code: String(s.Code || `WH-${idx + 1}`),
        nameAr: label,
        location: updatedDb.company.address || '',
        keeperName: '',
        status: 'active',
      };
    });
    if (mappedWarehouses.length > 0) {
      if (mode === 'replace') {
        updatedDb.warehouses = mappedWarehouses;
      } else {
        const mergedWh = [...currentDb.warehouses];
        mappedWarehouses.forEach((w) => {
          const exIdx = mergedWh.findIndex((x) => x.code === w.code || x.nameAr === w.nameAr);
          if (exIdx >= 0) {
            for (const [g, id] of storeGuidToWhId.entries()) {
              if (id === w.id) storeGuidToWhId.set(g, mergedWh[exIdx].id);
            }
          } else {
            mergedWh.push(w);
          }
        });
        updatedDb.warehouses = mergedWh;
      }
    }
    const defaultWhId = updatedDb.warehouses[0]?.id || 'wh-1';

    // 6. Accounts -> Chart of Accounts (Qright COA: 1*/7*=Assets, 211*=Equity, 2*/8*=Liabilities, 3*=COGS/Purchases, 4*/6*=Revenues, 5*=Expenses)
    const accRows = decodeTable('Accounts', 20000);
    const accByGuid = new Map<string, Record<string, any>>();
    const accGuidToMapped = new Map<string, Account>();
    const accIdToRawTotals = new Map<string, { debit: number; credit: number }>();
    accRows.forEach((a) => {
      if (a.GUID) accByGuid.set(String(a.GUID), a);
    });
    const parentGuids = new Set<string>(accRows.map((a) => String(a.ParentGUID || '')));

    const getAccountPathText = (accRow: Record<string, any> | undefined): string => {
      const parts: string[] = [];
      let cur = accRow;
      const seen = new Set<string>();
      while (cur && cur.GUID && !seen.has(String(cur.GUID))) {
        seen.add(String(cur.GUID));
        parts.push(String(cur.Name || ''), String(cur.Notes || ''));
        cur = cur.ParentGUID ? accByGuid.get(String(cur.ParentGUID)) : undefined;
      }
      return parts.join(' ');
    };

    const resolveBakAccCurrency = (accRow: Record<string, any> | undefined): Currency['code'] => {
      if (!accRow) return 'YER';
      if (accRow.CurrencyGUID && currGuidToCode.has(String(accRow.CurrencyGUID))) {
        const c = currGuidToCode.get(String(accRow.CurrencyGUID))!;
        if (c !== 'YER') return c;
      }
      const pathText = getAccountPathText(accRow);
      if (hasSaudiHint(pathText)) return 'SAR';
      if (hasUsdHint(pathText)) return 'USD';
      return 'YER';
    };

    const mappedAccounts: Account[] = accRows
      .filter((a) => String(a.Name || '').trim() !== '')
      .map((a, idx) => {
        const code = String(a.Code || `ACC-${a.Number || idx + 1}`).trim();
        const first = code.charAt(0);
        let category: AccountCategory = 'أصول';
        let nature: AccountNature = 'debit';
        if (code.startsWith('211')) {
          category = 'حقوق_ملكية';
          nature = 'credit';
        } else if (first === '2' || first === '8') {
          category = 'خصوم';
          nature = 'credit';
        } else if (first === '3' || first === '5') {
          category = 'مصروفات';
          nature = 'debit';
        } else if (first === '4' || first === '6') {
          category = 'إيرادات';
          nature = 'credit';
        }
        const parentObj = a.ParentGUID ? accByGuid.get(String(a.ParentGUID)) : undefined;
        const debit = Math.round(Number(a.Debit || 0) * 100) / 100;
        const credit = Math.round(Number(a.Credit || 0) * 100) / 100;
        const bal = nature === 'debit' ? debit - credit : credit - debit;
        const accId = `acc-bak-${a.Number || idx + 1}`;
        const accObj: Account = {
          id: accId,
          code,
          nameAr: String(a.Name).trim(),
          category,
          nature,
          currency: resolveBakAccCurrency(a),
          parentCode: parentObj ? String(parentObj.Code || '') : undefined,
          level: code.length <= 1 ? 1 : code.length <= 2 ? 2 : code.length <= 4 ? 3 : 4,
          isLeaf: !parentGuids.has(String(a.GUID || '')),
          currentBalance: Math.round(bal * 100) / 100,
          importedDebit: debit,
          importedCredit: credit,
        };
        accIdToRawTotals.set(accId, { debit, credit });
        if (a.GUID) accGuidToMapped.set(String(a.GUID), accObj);
        return accObj;
      });

    if (mode === 'replace') {
      updatedDb.chartOfAccounts = mappedAccounts;
    } else {
      const mergedAcc = [...currentDb.chartOfAccounts];
      mappedAccounts.forEach((acc) => {
        const exIdx = mergedAcc.findIndex((x) => x.code === acc.code);
        if (exIdx >= 0) {
          const keepId = mergedAcc[exIdx].id;
          mergedAcc[exIdx] = { ...mergedAcc[exIdx], ...acc, id: keepId };
        } else {
          mergedAcc.push(acc);
        }
      });
      updatedDb.chartOfAccounts = mergedAcc;
    }

    // 6b. Cost Centers from Cost table
    const costRows = userTablesByName.has('Cost') ? decodeTable('Cost', 500) : [];
    const mappedCostCenters: CostCenter[] = costRows
      .filter((c) => String(c.Name || '').trim() !== '')
      .map((c, idx) => ({
        id: `cc-bak-${c.Number || idx + 1}`,
        code: String(c.Code || idx + 1).trim(),
        nameAr: String(c.Name).trim(),
        status: c.IsView === false ? 'inactive' : 'active',
      }));
    if (mode === 'replace') {
      updatedDb.costCenters = mappedCostCenters;
    }

    // 6c. Cash Boxes / Banks / Exchange Treasuries strictly from Accounts (13* / Bonds)
    // Note: Qright Accounts.Debit/Credit values are already expressed in base currency (YER)
    const accGuidToTreasury = new Map<string, TreasuryAccount>();
    const mappedTreasuries: TreasuryAccount[] = accRows
      .filter((a) => {
        const guid = String(a.GUID || '');
        const code = String(a.Code || '').trim();
        const isLeaf = !parentGuids.has(guid);
        return isLeaf && code.startsWith('13') && String(a.Name || '').trim() !== '';
      })
      .map((a, idx) => {
        const name = String(a.Name).trim();
        const code = String(a.Code || '').trim();
        const type: TreasuryAccount['type'] = /محفظة|جيب|كاش/.test(name)
          ? 'محفظة'
          : /بنك|مصرف|كريمي|صراف|حساب/.test(name)
          ? 'بنك'
          : 'صندوق';
        const balYer = Math.round((Number(a.Debit || 0) - Number(a.Credit || 0)) * 100) / 100;
        const mappedAcc = a.GUID ? accGuidToMapped.get(String(a.GUID)) : undefined;
        const trCurr = resolveBakAccCurrency(a);
        const trRate = trCurr !== 'YER' ? getEffectiveCurrencyRate(updatedDb.currencies, trCurr) : 1;
        const balNative = trCurr !== 'YER' ? Math.round((balYer / trRate) * 100) / 100 : balYer;
        const tr: TreasuryAccount = {
          id: `tr-bak-${a.Number || idx + 1}`,
          code,
          nameAr: name,
          type,
          currency: trCurr,
          branchId,
          generalLedgerAccountId: mappedAcc?.id || `acc-bak-${a.Number || idx + 1}`,
          balance: balNative,
          status: 'active',
        };
        if (a.GUID) accGuidToTreasury.set(String(a.GUID), tr);
        return tr;
      })
      .sort((a, b) => {
        if (a.code === '131') return -1;
        if (b.code === '131') return 1;
        return a.code.localeCompare(b.code, 'en');
      });

    if (mode === 'replace') {
      updatedDb.treasuryAccounts = mappedTreasuries;
    } else if (mappedTreasuries.length > 0) {
      const mergedTr = [...currentDb.treasuryAccounts];
      mappedTreasuries.forEach((tr) => {
        const ex = mergedTr.find((x) => x.code === tr.code || x.nameAr === tr.nameAr);
        if (!ex) mergedTr.push(tr);
      });
      updatedDb.treasuryAccounts = mergedTr;
    }

    // 6d. Expense Categories strictly from 5* operating expense leaf accounts (exclude 3* COGS/purchases)
    const mappedExpenseCategories: ExpenseCategory[] = mappedAccounts
      .filter((a) => a.category === 'مصروفات' && a.code.startsWith('5') && a.isLeaf)
      .map((a, idx) => ({
        id: `ec-bak-${idx + 1}`,
        nameAr: a.nameAr,
        ledgerAccountId: a.id,
      }));
    if (mode === 'replace') {
      updatedDb.expenseCategories = mappedExpenseCategories;
    }

    // 6e. Employees strictly from Employees table
    const empRows = userTablesByName.has('Employees') ? decodeTable('Employees', 2000) : [];
    const mappedEmployees: Employee[] = empRows
      .filter((e) => String(e.Name || '').trim() !== '')
      .map((e, idx) => ({
        id: `emp-bak-${e.Number || idx + 1}`,
        code: String(e.Code || idx + 1).trim(),
        nameAr: String(e.Name).trim(),
        jobTitle: String(e.JobTitle || 'موظف').trim(),
        department: 'عام',
        phone: String(e.Mobile || e.Phone || '').trim(),
        nationalId: String(e.Barcode || '').trim(),
        hireDate: String(e.DateStart || e.DateRegister || today).slice(0, 10),
        basicSalary: Number(e.MainSalary || e.BasicSalary || e.Salary || 0),
        housingAllowance: 0,
        transportAllowance: 0,
        otherAllowances: 0,
        status: e.IsView === false ? 'terminated' : 'active',
        currentLoanBalance: 0,
      }));
    if (mode === 'replace') {
      updatedDb.employees = mappedEmployees;
    }

    // 7. Customers & Vendors clean separation (221*/222* supplier accounts go strictly to Vendors, never Customers; 211* is Partner Capital, never Vendors)
    const custRows = decodeTable('Customers', 20000);
    const isVendorAccountCode = (code: string) => code.startsWith('221') || code.startsWith('222');
    const custRowByAccGuid = new Map<string, Record<string, any>>();
    custRows.forEach((c) => {
      if (c.AccountGUID && !custRowByAccGuid.has(String(c.AccountGUID))) {
        custRowByAccGuid.set(String(c.AccountGUID), c);
      }
    });

    const custGuidToId = new Map<string, string>();
    const accGuidToCustId = new Map<string, string>();
    const custGuidToVendId = new Map<string, string>();
    const mappedCustomers: Customer[] = custRows
      .filter((c) => {
        if (String(c.Name || '').trim() === '') return false;
        const acc = c.AccountGUID ? accByGuid.get(String(c.AccountGUID)) : undefined;
        const accCode = String(acc?.Code || '').trim();
        return !isVendorAccountCode(accCode) && !accCode.startsWith('211');
      })
      .map((c, idx) => {
        const acc = c.AccountGUID ? accByGuid.get(String(c.AccountGUID)) : undefined;
        const mappedAcc = c.AccountGUID ? accGuidToMapped.get(String(c.AccountGUID)) : undefined;
        const bal = acc ? Math.round((Number(acc.Debit || 0) - Number(acc.Credit || 0)) * 100) / 100 : 0;
        const phone = String(c.Mobile || c.Phone || '').trim();
        const cid = `cust-bak-${c.Number || idx + 1}`;
        if (c.GUID) custGuidToId.set(String(c.GUID), cid);
        if (c.AccountGUID) accGuidToCustId.set(String(c.AccountGUID), cid);

        const cityStr = String(c.City || '').trim();
        const addrStr = String(c.Address || '').trim();
        const streetStr = String(c.StreetName || '').trim();
        const rawAddyGuid = String(c.AddyGUID || '');

        let custAreaId =
          rawAddyGuid && rawAddyGuid !== ZERO_GUID ? addyGuidToAreaId.get(rawAddyGuid) || '' : '';
        if (!custAreaId) {
          const fallbackName = [cityStr, addrStr].find((n) => n && areaNameToId.has(n));
          if (fallbackName) {
            custAreaId = areaNameToId.get(fallbackName) || '';
          } else {
            const extraName = cityStr || addrStr;
            if (extraName) {
              const newAreaId = `area-bak-c-${mappedRegionalAreas.length + 1}`;
              const extraArea: RegionalArea = {
                id: newAreaId,
                country: String(branchRows[0]?.Country || '').trim(),
                governorate: '',
                district: '',
                area: extraName,
                code: `C-${mappedRegionalAreas.length + 1}`,
              };
              mappedRegionalAreas.push(extraArea);
              areaNameToId.set(extraName, newAreaId);
              custAreaId = newAreaId;
            }
          }
        }

        const addrParts = [cityStr, addrStr, streetStr].filter(
          (v, i, arr) => Boolean(v) && arr.indexOf(v) === i
        );

        const areaRow = rawAddyGuid && rawAddyGuid !== ZERO_GUID ? addyByGuid.get(rawAddyGuid) : undefined;
        const areaHintText = areaRow ? getAddyPath(areaRow).map((x) => String(x.Name || '')).join(' ') : '';
        const accPathText = getAccountPathText(acc);
        const custTextHints = `${String(c.Name || '')} ${accPathText} ${areaHintText} ${String(c.Notes || '')} ${cityStr} ${addrStr}`;
        const directCurr =
          (c.CurrencyGUID && currGuidToCode.get(String(c.CurrencyGUID))) ||
          (acc?.CurrencyGUID && currGuidToCode.get(String(acc.CurrencyGUID))) ||
          (hasSaudiHint(custTextHints) ? 'SAR' : hasUsdHint(custTextHints) ? 'USD' : undefined);

        return {
          id: cid,
          branchId,
          code: String(c.Code || `C-${idx + 1}`).trim(),
          nameAr: String(c.Name).trim(),
          phone,
          whatsapp: phone || undefined,
          email: c.Email ? String(c.Email) : undefined,
          taxNumber: c.TaxNumber ? String(c.TaxNumber) : undefined,
          commercialRecord: c.CommercialRegistry ? String(c.CommercialRegistry) : undefined,
          regionalAreaId: custAreaId,
          addressDetails: addrParts.join(' - '),
          category: 'تجاري',
          creditLimit: 0,
          paymentTermDays: 30,
          openingBalance: bal,
          currentBalance: bal,
          currency: directCurr || 'YER',
          linkedAccountId: mappedAcc?.id,
          linkedAccountCode: mappedAcc?.code,
          status: c.IsView === false ? 'inactive' : 'active',
          notes: c.Notes ? String(c.Notes) : undefined,
          createdAt: String(c.DateJoin || today).slice(0, 10),
        };
      });

    if (mode === 'replace') {
      updatedDb.regionalAreas = mappedRegionalAreas;
    } else if (mappedRegionalAreas.length > 0) {
      const mergedAreas = [...currentDb.regionalAreas];
      mappedRegionalAreas.forEach((a) => {
        if (!mergedAreas.some((x) => x.code === a.code || (x.area === a.area && x.governorate === a.governorate))) {
          mergedAreas.push(a);
        }
      });
      updatedDb.regionalAreas = mergedAreas;
    }

    // 7b. Vendors strictly from 221*/222* supplier leaf accounts (merged with any metadata from Customers table)
    const accGuidToVendId = new Map<string, string>();
    const mappedVendors: Vendor[] = accRows
      .filter((a) => {
        const code = String(a.Code || '').trim();
        const isLeaf = !parentGuids.has(String(a.GUID || ''));
        return isLeaf && isVendorAccountCode(code) && code.length >= 4;
      })
      .map((a, idx) => {
        const bal = Math.round((Number(a.Credit || 0) - Number(a.Debit || 0)) * 100) / 100;
        const vid = `vend-bak-${a.Number || idx + 1}`;
        const accGuid = String(a.GUID || '');
        const custMeta = accGuid ? custRowByAccGuid.get(accGuid) : undefined;
        if (accGuid) accGuidToVendId.set(accGuid, vid);
        if (custMeta?.GUID) custGuidToVendId.set(String(custMeta.GUID), vid);

        const addrParts = [custMeta?.City, custMeta?.Address, custMeta?.StreetName]
          .filter(Boolean)
          .map((x) => String(x).trim())
          .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);

        const vendAccPath = getAccountPathText(a);
        const vendTextHints = `${String(custMeta?.Name || '')} ${vendAccPath} ${String(custMeta?.Notes || a.Notes || '')}`;
        const vendCurr =
          (custMeta?.CurrencyGUID && currGuidToCode.get(String(custMeta.CurrencyGUID))) ||
          (a.CurrencyGUID && currGuidToCode.get(String(a.CurrencyGUID))) ||
          (hasSaudiHint(vendTextHints) ? 'SAR' : hasUsdHint(vendTextHints) ? 'USD' : 'YER');

        return {
          id: vid,
          branchId,
          code: String(a.Code || `V-${idx + 1}`).trim(),
          nameAr: String(custMeta?.Name || a.Name || '').trim(),
          phone: String(custMeta?.Mobile || custMeta?.Phone || '').trim(),
          address: addrParts.join(' - ') || String(custMeta?.Notes || a.Notes || '').trim(),
          category: 'مورد رئيسي',
          openingBalance: bal,
          currentBalance: bal,
          currency: vendCurr,
          linkedAccountId: `acc-bak-${a.Number || idx + 1}`,
          linkedAccountCode: String(a.Code || '').trim(),
          paymentTermDays: 30,
          status: custMeta?.IsView === false ? 'inactive' : 'active',
          notes: custMeta?.Notes ? String(custMeta.Notes) : a.Notes ? String(a.Notes) : undefined,
          createdAt: String(custMeta?.DateJoin || today).slice(0, 10),
        };
      });

    // 7. Materials + Groups + StoresInventory
    const groupRows = decodeTable('Groups', 500);
    const groupByGuid = new Map<string, string>();
    groupRows.forEach((g) => {
      if (g.GUID && g.Name) groupByGuid.set(String(g.GUID), String(g.Name).trim());
    });

    const matRows = decodeTable('Materials', 20000);
    const matGuidToItem = new Map<string, InventoryItem>();
    const mappedItems: InventoryItem[] = matRows
      .filter((m) => String(m.Name || '').trim() !== '')
      .map((m, idx) => {
        const salePrice = Number(m.Consumer || m.Wholesale || m.Last || 0);
        const purchasePrice = Number(m.Last || m.Last2 || 0);
        const wholesalePrice = Number(m.Wholesale || salePrice * 0.92 || 0);
        const rawCode = String(m.Code || m.Number || idx + 1).trim();
        const rawBarcode = String(m.CodeID || m.Barcode || m.Code || m.Number || idx + 1).trim();
        const item: InventoryItem = {
          id: `it-bak-${m.Number || idx + 1}`,
          code: rawCode,
          barcode: rawBarcode,
          nameAr: String(m.Name).trim(),
          nameEn: m.LatinName ? String(m.LatinName).trim() : undefined,
          category: (m.GroupGUID && groupByGuid.get(String(m.GroupGUID))) || 'أصناف مستوردة',
          baseUnit: String(m.Unity || 'حبة').trim(),
          secondaryUnit: m.Unit2 ? String(m.Unit2).trim() : undefined,
          unitConversionFactor: Number(m.Unit2Fact || 1) > 1 ? Number(m.Unit2Fact) : undefined,
          purchasePrice,
          salePrice: salePrice > 0 ? salePrice : purchasePrice,
          wholesalePrice: wholesalePrice > 0 ? wholesalePrice : salePrice,
          minSalePrice: Math.round((salePrice > 0 ? salePrice : purchasePrice) * 0.85),
          minQuantityAlert: 5,
          maxQuantity: 10000,
          valuationMethod: 'WEIGHTED_AVERAGE',
          taxRate: currentDb.settings.defaultTaxRate || 0.05,
          status: 'active',
          createdAt: today,
        };
        if (m.GUID) matGuidToItem.set(String(m.GUID), item);
        return item;
      });

    const invStockRows = decodeTable('StoresInventory', 50000);
    const mappedStock: ItemWarehouseStock[] = [];
    invStockRows.forEach((s) => {
      const item = s.MaterialGUID ? matGuidToItem.get(String(s.MaterialGUID)) : undefined;
      if (!item) return;
      const whId = (s.StoreGUID && storeGuidToWhId.get(String(s.StoreGUID))) || defaultWhId;
      const qty = Number(s.Qty || 0);
      if (qty === 0 && mode === 'merge') return;
      const existing = mappedStock.find((x) => x.itemId === item.id && x.warehouseId === whId);
      if (existing) existing.quantityOnHand += qty;
      else {
        mappedStock.push({
          itemId: item.id,
          warehouseId: whId,
          quantityOnHand: qty,
          averageCost: item.purchasePrice,
        });
      }
    });

    if (mode === 'replace') {
      updatedDb.inventoryItems = mappedItems;
      updatedDb.warehouseStock = mappedStock;
    } else {
      const mergedItems = [...currentDb.inventoryItems];
      const mergedStock = [...currentDb.warehouseStock];
      mappedItems.forEach((it) => {
        const exIdx = mergedItems.findIndex((x) => x.code === it.code);
        if (exIdx >= 0) {
          const oldId = mergedItems[exIdx].id;
          mergedItems[exIdx] = { ...mergedItems[exIdx], ...it, id: oldId };
        } else {
          mergedItems.push(it);
        }
      });
      mappedStock.forEach((st) => {
        const origItem = mappedItems.find((m) => m.id === st.itemId);
        const targetItem = origItem ? mergedItems.find((x) => x.code === origItem.code) : undefined;
        const resolvedId = targetItem ? targetItem.id : st.itemId;
        const sIdx = mergedStock.findIndex((x) => x.itemId === resolvedId && x.warehouseId === st.warehouseId);
        if (sIdx >= 0) mergedStock[sIdx] = { ...st, itemId: resolvedId };
        else mergedStock.push({ ...st, itemId: resolvedId });
      });
      updatedDb.inventoryItems = mergedItems;
      updatedDb.warehouseStock = mergedStock;
    }

    // 8. Full Historical Transactions (Bills + Bonds + EntryBondsItems -> Invoices, PaymentVouchers, JournalEntries)
    let invoicesImported = 0;
    let vouchersImported = 0;
    let journalEntriesImported = 0;
    const mappedExpenses: ExpenseRecord[] = [];
    const custTxNet = new Map<string, number>();
    const addCustTxNet = (custId: string, delta: number) => {
      custTxNet.set(custId, (custTxNet.get(custId) || 0) + delta);
    };
    const vendTxNet = new Map<string, number>();
    const addVendTxNet = (vendId: string, delta: number) => {
      vendTxNet.set(vendId, (vendTxNet.get(vendId) || 0) + delta);
    };
    const jeDebitByAccId = new Map<string, number>();
    const jeCreditByAccId = new Map<string, number>();

    if (options.includeRecentInvoices) {
      const ebiRows = userTablesByName.has('EntryBondsItems') ? decodeTable('EntryBondsItems', 100000) : [];
      const ebiByParent = new Map<string, Record<string, any>[]>();
      ebiRows.forEach((item) => {
        const pGuid = String(item.ParentGUID || '');
        if (!pGuid) return;
        if (!ebiByParent.has(pGuid)) ebiByParent.set(pGuid, []);
        ebiByParent.get(pGuid)!.push(item);
      });

      const coveredEntryGuids = new Set<string>();
      const custById = new Map(mappedCustomers.map((c) => [c.id, c]));
      const vendById = new Map(mappedVendors.map((v) => [v.id, v]));

      // 8a. Bills -> Invoices (all Qright bills; TotalFinal & Paid are already stored in base YER)
      if (userTablesByName.has('Bills')) {
        const patterns = decodeTable('BillsPatterns', 200);
        const patternTypeMap = new Map<string, number>();
        patterns.forEach((p) => {
          if (p.GUID) patternTypeMap.set(String(p.GUID), Number(p.BillType ?? 1));
        });

        const billRows = decodeTable('Bills', 50000)
          .filter((b) => !b.IsRecycleBin && b.IsPosted !== 0 && Number(b.TotalFinal || b.Total || 0) > 0)
          .sort((a, b) => String(a.Date || '').localeCompare(String(b.Date || '')));

        const billItemRows = userTablesByName.has('BillItems') ? decodeTable('BillItems', 100000) : [];
        const itemsByBillGuid = new Map<string, Record<string, any>[]>();
        billItemRows.forEach((bi) => {
          const pGuid = String(bi.ParentGUID || '');
          if (!pGuid) return;
          if (!itemsByBillGuid.has(pGuid)) itemsByBillGuid.set(pGuid, []);
          itemsByBillGuid.get(pGuid)!.push(bi);
        });

        const mappedInvoices: Invoice[] = [];
        billRows.forEach((b, idx) => {
          const bt = patternTypeMap.get(String(b.BillsPatternsGUID || '')) ?? 1;
          if (bt !== 0 && bt !== 1 && bt !== 2 && bt !== 3) return;
          let invType: Invoice['type'] = 'مبيعات';
          if (bt === 0) invType = 'مشتريات';
          else if (bt === 2) invType = 'مرتجع_مشتريات';
          else if (bt === 3) invType = 'مرتجع_مبيعات';

          let entityId =
            (b.CustGUID && custGuidToVendId.get(String(b.CustGUID))) ||
            (b.CustAccGUID && accGuidToVendId.get(String(b.CustAccGUID))) ||
            (b.CustGUID && custGuidToId.get(String(b.CustGUID))) ||
            (b.CustAccGUID && custGuidToId.get(String(b.CustAccGUID))) ||
            (b.CustAccGUID && accGuidToCustId.get(String(b.CustAccGUID))) ||
            '';
          let entityName =
            (entityId && vendById.get(entityId)?.nameAr) ||
            (entityId && custById.get(entityId)?.nameAr) ||
            '';

          if (!entityId && b.CustAccGUID && accByGuid.has(String(b.CustAccGUID))) {
            const accInfo = accByGuid.get(String(b.CustAccGUID));
            entityName = String(accInfo?.Name || 'عميل نقدي');
            entityId = String(b.CustAccGUID);
          }
          if (!entityId) {
            entityId = 'cash-customer';
            entityName = 'عميل نقدي عام';
          }

          const childItems = itemsByBillGuid.get(String(b.GUID || '')) || [];
          const grandTotalBase = Number(b.TotalFinal || b.Total || 0);
          const rawBillRate = Number(b.CurrencyVal || 0);
          const partyObj = vendById.get(entityId) || custById.get(entityId);
          const custAccInfo = b.CustAccGUID ? accByGuid.get(String(b.CustAccGUID)) : undefined;
          const accCurrHint =
            (custAccInfo?.CurrencyGUID && currGuidToCode.get(String(custAccInfo.CurrencyGUID))) ||
            (hasSaudiHint(`${entityName} ${custAccInfo ? getAccountPathText(custAccInfo) : ''} ${b.Notes || ''}`)
              ? 'SAR'
              : hasUsdHint(`${entityName} ${custAccInfo ? getAccountPathText(custAccInfo) : ''} ${b.Notes || ''}`)
              ? 'USD'
              : undefined);
          const origCurr =
            (b.CurrencyGUID && currGuidToCode.get(String(b.CurrencyGUID))) ||
            (partyObj?.currency && partyObj.currency !== 'YER' ? partyObj.currency : undefined) ||
            accCurrHint ||
            'YER';
          let effectiveRate =
            rawBillRate > 0 && rawBillRate < 1
              ? Math.round((1 / rawBillRate) * 100) / 100
              : rawBillRate;
          if (origCurr !== 'YER' && effectiveRate <= 1) {
            effectiveRate = origCurr === 'SAR' ? importedSarRate : getEffectiveCurrencyRate(updatedDb.currencies, origCurr);
          }
          const isForeign = origCurr !== 'YER' && effectiveRate > 1;
          const divRate = isForeign ? effectiveRate : 1;

          const invItems: InvoiceItem[] = childItems.map((ci, cIdx) => {
            const mat = ci.MaterialGUID ? matGuidToItem.get(String(ci.MaterialGUID)) : undefined;
            const qty = Number(ci.Qty || 1);
            const rawPrice = Number(ci.Price || 0);
            const rawDisc = Number(ci.Disc || 0);
            const rawVat = Number(ci.VAT || 0);
            const rawTotal = Number(ci.TotalFinal || qty * rawPrice);
            const unitPrice = Math.round((rawPrice / divRate) * 100) / 100;
            const discountAmount = Math.round((rawDisc / divRate) * 100) / 100;
            const taxAmount = Math.round((rawVat / divRate) * 100) / 100;
            const subtotal = Math.round(((qty * rawPrice) / divRate) * 100) / 100;
            const total = Math.round((rawTotal / divRate) * 100) / 100;
            return {
              id: `bi-bak-${idx}-${cIdx}`,
              itemId: mat?.id || 'unknown',
              itemName: mat?.nameAr || 'صنف مستورد',
              itemBarcode: mat?.barcode || '',
              unit: mat?.baseUnit || 'حبة',
              quantity: qty,
              unitPrice,
              discountPercentage: 0,
              discountAmount,
              subtotal,
              taxPercentage: 0,
              taxAmount,
              total,
              unitCost: mat?.purchasePrice || rawPrice,
            };
          });

          const currTag = origCurr !== 'YER' ? ` [العملة الأصلية: ${origCurr} × ${effectiveRate}]` : '';
          const isCash = b.PayType === 0;
          const paidAmountBase = isCash ? grandTotalBase : Number(b.Paid || b.PayCash || 0);
          const jeId = b.EntryGUID ? `je-bak-${b.EntryGUID}` : undefined;
          if (b.EntryGUID) coveredEntryGuids.add(String(b.EntryGUID));

          const grandTotal = Math.round((grandTotalBase / divRate) * 100) / 100;
          const paidAmount = Math.round((paidAmountBase / divRate) * 100) / 100;

          const inv: Invoice = {
            id: `inv-bak-${b.Number || idx + 1}`,
            invoiceNumber: `BAK-${b.Number || idx + 1}`,
            type: invType,
            paymentType: isCash ? 'نقدي' : paidAmountBase > 0 ? 'جزئي' : 'آجل',
            date: String(b.Date || today).slice(0, 10),
            branchId,
            warehouseId: (b.StoreGUID && storeGuidToWhId.get(String(b.StoreGUID))) || defaultWhId,
            entityId,
            entityName,
            currency: isForeign ? origCurr : 'YER',
            exchangeRate: isForeign ? effectiveRate : 1,
            items: invItems,
            subtotal: Math.round((Number(b.TotalMats || grandTotalBase) / divRate) * 100) / 100,
            discountTotal: Math.round((Number(b.Disc || 0) / divRate) * 100) / 100,
            taxTotal: Math.round((Number(b.VAT || 0) / divRate) * 100) / 100,
            grandTotal,
            paidAmount,
            remainingAmount: Math.max(0, Math.round((grandTotal - paidAmount) * 100) / 100),
            status: paidAmountBase >= grandTotalBase ? 'paid' : 'posted',
            journalEntryId: jeId,
            notes: `${b.Notes ? String(b.Notes) : `فاتورة ${invType} مستوردة (#${b.Number})`}${currTag}`,
            createdBy: (b.UserGUID && userGuidToName.get(String(b.UserGUID))) || 'الإدارة',
            createdAt: String(b.DateTime || now),
          };
          mappedInvoices.push(inv);

          const grandTotalYer = grandTotalBase;
          const paidYer = paidAmountBase;
          // Amounts in Qright Bills are already in YER; track net impact on customer or vendor balance
          if (custById.has(entityId)) {
            if (invType === 'مبيعات') addCustTxNet(entityId, grandTotalYer - paidYer);
            else if (invType === 'مرتجع_مبيعات') addCustTxNet(entityId, -grandTotalYer);
            else if (invType === 'مشتريات') addCustTxNet(entityId, -(grandTotalYer - paidYer));
            else if (invType === 'مرتجع_مشتريات') addCustTxNet(entityId, grandTotalYer);
          } else if (vendById.has(entityId)) {
            if (invType === 'مشتريات') addVendTxNet(entityId, grandTotalYer - paidYer);
            else if (invType === 'مرتجع_مشتريات') addVendTxNet(entityId, -grandTotalYer);
            else if (invType === 'مبيعات') addVendTxNet(entityId, -(grandTotalYer - paidYer));
            else if (invType === 'مرتجع_مبيعات') addVendTxNet(entityId, grandTotalYer);
          }
        });

        invoicesImported = mappedInvoices.length;
        if (mode === 'replace') {
          updatedDb.invoices = mappedInvoices;
        } else {
          const mergedInv = [...currentDb.invoices];
          const existingNums = new Set(mergedInv.map((x) => x.invoiceNumber));
          mappedInvoices.forEach((inv) => {
            if (!existingNums.has(inv.invoiceNumber)) {
              existingNums.add(inv.invoiceNumber);
              mergedInv.push(inv);
            }
          });
          updatedDb.invoices = mergedInv;
        }
      }

      // 8b. Bonds -> PaymentVouchers (EntryBondsItems Debit/Credit are already stored in base YER)
      if (userTablesByName.has('Bonds')) {
        const bondPatterns = decodeTable('BondsPatterns', 100);
        const bpMap = new Map<string, Record<string, any>>();
        bondPatterns.forEach((p) => {
          if (p.GUID) bpMap.set(String(p.GUID), p);
        });

        const bondRows = decodeTable('Bonds', 50000).filter((bo) => !bo.IsRecycleBin);
        const mappedVouchers: PaymentVoucher[] = [];
        const defTreasury = mappedTreasuries[0] || updatedDb.treasuryAccounts[0];

        bondRows.forEach((bo, idx) => {
          const entryGuid = String(bo.EntryGUID || '');
          const lines = entryGuid ? ebiByParent.get(entryGuid) || [] : [];
          if (lines.length === 0) return;

          const pat = bpMap.get(String(bo.BondsPatternsGUID || ''));
          const patName = String(pat?.Name || '');
          const bondCashGuid = String(bo.AccountGUID || '');
          const nonCashLines = lines.filter((l) => String(l.AccountGUID || '') !== bondCashGuid);
          const targetLines = nonCashLines.length > 0 ? nonCashLines : lines;
          const batchId = entryGuid ? `bak-batch-${entryGuid}` : `bak-batch-${bo.Number || idx + 1}`;

          if (entryGuid) coveredEntryGuids.add(entryGuid);

          targetLines.forEach((partyLine, lIdx) => {
            const debit = Number(partyLine?.Debit || 0);
            const credit = Number(partyLine?.Credit || 0);
            const amount = credit > 0 ? credit : debit;
            if (amount <= 0) return;

            const partyAccGuid = String(partyLine?.AccountGUID || bo.AccountGUID || '');
            const mappedAcc = accGuidToMapped.get(partyAccGuid);
            let entityType: PaymentVoucher['entityType'] = 'أخرى';
            let entityId: string | undefined = mappedAcc?.id;
            let entityName =
              mappedAcc?.nameAr ||
              (accByGuid.get(partyAccGuid)?.Name ? String(accByGuid.get(partyAccGuid)!.Name) : 'حساب عام');

            if (accGuidToCustId.has(partyAccGuid)) {
              entityType = 'عميل';
              entityId = accGuidToCustId.get(partyAccGuid);
              entityName = custById.get(entityId!)?.nameAr || entityName;
            } else if (accGuidToVendId.has(partyAccGuid)) {
              entityType = 'مورد';
              entityId = accGuidToVendId.get(partyAccGuid);
              entityName = vendById.get(entityId!)?.nameAr || entityName;
            } else if (
              mappedAcc?.category === 'مصروفات' ||
              String(mappedAcc?.code || '').startsWith('5') ||
              String(mappedAcc?.code || '').startsWith('3') ||
              patName.includes('مصروف')
            ) {
              entityType = 'مصروف';
            }

            const vType: PaymentVoucher['type'] = credit > 0 ? 'قبض' : 'صرف';
            const rawVRate = Number(partyLine?.CurrencyVal || bo.CurrencyVal || 0);
            const partyCurr =
              (entityType === 'عميل' && entityId ? custById.get(entityId)?.currency : undefined) ||
              (entityType === 'مورد' && entityId ? vendById.get(entityId)?.currency : undefined) ||
              mappedAcc?.currency;
            const origCurr =
              (partyLine?.CurrencyGUID && currGuidToCode.get(String(partyLine.CurrencyGUID))) ||
              (bo.CurrencyGUID && currGuidToCode.get(String(bo.CurrencyGUID))) ||
              (partyCurr && partyCurr !== 'YER' ? partyCurr : 'YER');
            let effectiveRate =
              rawVRate > 0 && rawVRate < 1 ? Math.round((1 / rawVRate) * 100) / 100 : rawVRate;
            if (origCurr !== 'YER' && effectiveRate <= 1) {
              effectiveRate = origCurr === 'SAR' ? importedSarRate : getEffectiveCurrencyRate(updatedDb.currencies, origCurr);
            }
            const isForeign = origCurr !== 'YER' && effectiveRate > 1;
            const currTag = origCurr !== 'YER' ? ` [العملة الأصلية: ${origCurr} × ${effectiveRate}]` : '';
            const jeId = entryGuid ? `je-bak-${entryGuid}` : undefined;
            const resolvedTr = accGuidToTreasury.get(bondCashGuid) || defTreasury;
            const performer = (bo.UserGUID && userGuidToName.get(String(bo.UserGUID))) || 'الإدارة';
            const lineStmt = `${String(partyLine?.Notes || bo.Notes || patName || `سند ${vType} مستورد`)}${currTag}`;
            const voucherNumber = `VBK-${bo.Number || idx + 1}${targetLines.length > 1 ? `-${lIdx + 1}` : ''}`;

            const v: PaymentVoucher = {
              id: `pv-bak-${bo.Number || idx + 1}-${idx}-${lIdx}`,
              voucherNumber,
              batchId,
              type: vType,
              date: String(bo.Date || today).slice(0, 10),
              branchId,
              treasuryAccountId: resolvedTr?.id || 'tr-1',
              treasuryAccountName:
                accByGuid.get(bondCashGuid)?.Name || resolvedTr?.nameAr || 'الصندوق',
              entityType,
              entityId,
              entityName,
              amount: isForeign ? Math.round((amount / effectiveRate) * 100) / 100 : amount,
              currency: isForeign ? origCurr : 'YER',
              exchangeRate: isForeign ? effectiveRate : 1,
              baseAmount: amount,
              paymentMethod: 'نقداً',
              statement: lineStmt,
              journalEntryId: jeId,
              status: 'posted',
              receivedOrPaidBy: performer,
              createdBy: performer,
              createdAt: String(bo.DateTime || now),
            };
            mappedVouchers.push(v);

            if (entityType === 'مصروف' && vType === 'صرف') {
              mappedExpenses.push({
                id: `exp-bak-${bo.Number || idx + 1}-${idx}-${lIdx}`,
                expenseNumber: voucherNumber,
                date: v.date,
                branchId,
                categoryId: entityId || 'cat-general',
                categoryName: entityName,
                treasuryAccountId: v.treasuryAccountId,
                treasuryAccountName: v.treasuryAccountName,
                amount,
                currency: 'YER',
                taxAmount: 0,
                total: amount,
                beneficiary: entityName,
                statement: lineStmt,
                journalEntryId: jeId,
                createdBy: performer,
              });
            }

            if (entityType === 'عميل' && entityId) {
              addCustTxNet(entityId, vType === 'قبض' ? -amount : amount);
            } else if (entityType === 'مورد' && entityId) {
              addVendTxNet(entityId, vType === 'صرف' ? -amount : amount);
            }
          });
        });

        vouchersImported = mappedVouchers.length;
        if (mode === 'replace') {
          updatedDb.paymentVouchers = mappedVouchers;
        } else {
          const mergedV = [...currentDb.paymentVouchers];
          const existingVNums = new Set(mergedV.map((x) => x.voucherNumber));
          mappedVouchers.forEach((v) => {
            if (!existingVNums.has(v.voucherNumber)) {
              existingVNums.add(v.voucherNumber);
              mergedV.push(v);
            }
          });
          updatedDb.paymentVouchers = mergedV;
          const mergedExp = [...currentDb.expenseRecords];
          const existingExpNums = new Set(mergedExp.map((x) => x.expenseNumber));
          mappedExpenses.forEach((ex) => {
            if (!existingExpNums.has(ex.expenseNumber)) {
              existingExpNums.add(ex.expenseNumber);
              mergedExp.push(ex);
            }
          });
          updatedDb.expenseRecords = mergedExp;
        }
      }

      // 8c. Standalone EntryBonds + EntryBondsItems (not already covered by Bills/Bonds) -> JournalEntries
      if (userTablesByName.has('EntryBonds') && ebiRows.length > 0) {
        const ebRows = decodeTable('EntryBonds', 50000).filter((eb) => !eb.IsRecycleBin);
        const mappedJournals: JournalEntry[] = [];

        ebRows.forEach((eb, idx) => {
          const guid = String(eb.GUID || '');
          if (!guid || coveredEntryGuids.has(guid)) return;
          const lines = ebiByParent.get(guid) || [];
          if (lines.length === 0) return;

          // Prioritize entries touching any customer/vendor/opening balance OR keep up to 25000 daily journal entries
          const touchesParty = lines.some(
            (l) => accGuidToCustId.has(String(l.AccountGUID || '')) || accGuidToVendId.has(String(l.AccountGUID || ''))
          );
          if (!touchesParty && !eb.IsEntryStart && mappedJournals.length >= 25000) return;

          const jeLines: JournalEntryLine[] = lines.map((ln, lIdx) => {
            const acc = accGuidToMapped.get(String(ln.AccountGUID || ''));
            const rawLnRate = Number(ln.CurrencyVal || eb.CurrencyVal || 0);
            const origCurr =
              (ln.CurrencyGUID && currGuidToCode.get(String(ln.CurrencyGUID))) ||
              (acc?.currency && acc.currency !== 'YER' ? acc.currency : 'YER');
            let effectiveRate =
              rawLnRate > 0 && rawLnRate < 1 ? Math.round((1 / rawLnRate) * 100) / 100 : rawLnRate;
            if (origCurr !== 'YER' && effectiveRate <= 1) {
              effectiveRate = origCurr === 'SAR' ? importedSarRate : getEffectiveCurrencyRate(updatedDb.currencies, origCurr);
            }
            const currTag = origCurr !== 'YER' ? ` [${origCurr} × ${effectiveRate}]` : '';
            const dVal = Number(ln.Debit || 0);
            const cVal = Number(ln.Credit || 0);
            const resolvedAccId = acc?.id || String(ln.AccountGUID || '');
            if (resolvedAccId) {
              jeDebitByAccId.set(resolvedAccId, (jeDebitByAccId.get(resolvedAccId) || 0) + dVal);
              jeCreditByAccId.set(resolvedAccId, (jeCreditByAccId.get(resolvedAccId) || 0) + cVal);
            }
            return {
              id: `jel-bak-${idx}-${lIdx}`,
              accountId: resolvedAccId,
              accountCode: acc?.code || '',
              accountName: acc?.nameAr || String(accByGuid.get(String(ln.AccountGUID || ''))?.Name || 'حساب'),
              debit: dVal,
              credit: cVal,
              currency: 'YER',
              exchangeRate: 1,
              memo: `${String(ln.Notes || eb.Notes || (eb.IsEntryStart ? 'رصيد افتتاحي مرحل' : 'قيد يومية مستورد'))}${currTag}`,
            };
          });

          const totalDebit = jeLines.reduce((s, l) => s + l.debit, 0);
          const totalCredit = jeLines.reduce((s, l) => s + l.credit, 0);
          const je: JournalEntry = {
            id: `je-bak-${guid}`,
            entryNumber: `JBK-${eb.Number || idx + 1}`,
            date: String(eb.Date || today).slice(0, 10),
            branchId,
            referenceType: 'دليل_يدوي',
            referenceNumber: `JBK-${eb.Number || idx + 1}`,
            description: String(eb.Notes || (eb.IsEntryStart ? 'قيد رصيد افتتاحي مستورد' : 'قيد محاسبي مستورد')),
            lines: jeLines,
            totalDebit,
            totalCredit,
            status: 'posted',
            createdBy: (eb.UserGUID && userGuidToName.get(String(eb.UserGUID))) || 'الإدارة',
            createdAt: String(eb.DateTime || now),
          };
          mappedJournals.push(je);

          // Update customer/vendor txNet for any standalone entry line touching their linked account
          lines.forEach((ln) => {
            const accGuid = String(ln.AccountGUID || '');
            const dVal = Number(ln.Debit || 0);
            const cVal = Number(ln.Credit || 0);
            const cid = accGuidToCustId.get(accGuid);
            if (cid) addCustTxNet(cid, dVal - cVal);
            const vid = accGuidToVendId.get(accGuid);
            if (vid) addVendTxNet(vid, cVal - dVal);
          });
        });

        journalEntriesImported = mappedJournals.length;
        if (mode === 'replace') {
          updatedDb.journalEntries = mappedJournals;
        } else {
          const mergedJe = [...currentDb.journalEntries];
          const existingJeIds = new Set(mergedJe.map((x) => x.id));
          mappedJournals.forEach((je) => {
            if (!existingJeIds.has(je.id)) {
              existingJeIds.add(je.id);
              mergedJe.push(je);
            }
          });
          updatedDb.journalEntries = mergedJe;
        }
      }

      // 8d. Reconcile BOTH customer & vendor openingBalance so openingBalance + txNet === currentBalance,
      // infer currency from majority of transactions if still YER, and deduct imported JE lines from leaf importedDebit/importedCredit!
      mappedCustomers.forEach((c) => {
        const net = custTxNet.get(c.id) || 0;
        c.openingBalance = Math.round((c.currentBalance - net) * 100) / 100;
        if (!c.currency || c.currency === 'YER') {
          const custInvSar = updatedDb.invoices.filter((inv) => inv.entityId === c.id && (inv.notes || '').includes('SAR')).length;
          const custVchSar = updatedDb.paymentVouchers.filter((v) => v.entityId === c.id && (v.statement || '').includes('SAR')).length;
          const totalTx =
            updatedDb.invoices.filter((inv) => inv.entityId === c.id).length +
            updatedDb.paymentVouchers.filter((v) => v.entityId === c.id).length;
          if (totalTx > 0 && custInvSar + custVchSar === totalTx) {
            c.currency = 'SAR';
          }
        }
      });
      mappedVendors.forEach((v) => {
        const net = vendTxNet.get(v.id) || 0;
        v.openingBalance = Math.round((v.currentBalance - net) * 100) / 100;
        if (!v.currency || v.currency === 'YER') {
          const vendInvSar = updatedDb.invoices.filter((inv) => inv.entityId === v.id && (inv.notes || '').includes('SAR')).length;
          const vendVchSar = updatedDb.paymentVouchers.filter((vo) => vo.entityId === v.id && (vo.statement || '').includes('SAR')).length;
          const totalTx =
            updatedDb.invoices.filter((inv) => inv.entityId === v.id).length +
            updatedDb.paymentVouchers.filter((vo) => vo.entityId === v.id).length;
          if (totalTx > 0 && vendInvSar + vendVchSar === totalTx) {
            v.currency = 'SAR';
          }
        }
      });
      updatedDb.chartOfAccounts.forEach((acc) => {
        if (!acc.isLeaf) return;
        const raw = accIdToRawTotals.get(acc.id);
        if (!raw) return;
        const jeD = jeDebitByAccId.get(acc.id) || 0;
        const jeC = jeCreditByAccId.get(acc.id) || 0;
        acc.importedDebit = Math.round((raw.debit - jeD) * 100) / 100;
        acc.importedCredit = Math.round((raw.credit - jeC) * 100) / 100;
      });
    } else if (mode === 'replace') {
      updatedDb.invoices = [];
      updatedDb.paymentVouchers = [];
      updatedDb.journalEntries = [];
    }

    // Apply reconciled customers & vendors
    if (mode === 'replace') {
      updatedDb.customers = mappedCustomers;
      updatedDb.vendors = mappedVendors;
      // Clear ALL remaining demo-only arrays so ZERO leftover demo/seed data appears
      updatedDb.stockMovements = [];
      updatedDb.inventoryTransfers = [];
      updatedDb.stocktakings = [];
      updatedDb.warehouseDocuments = [];
      updatedDb.treasuryTransfers = [];
      updatedDb.expenseRecords = mappedExpenses;
      updatedDb.payrollRuns = [];
      updatedDb.fixedAssets = [];
      updatedDb.taskAlerts = [];
      updatedDb.dispatchLogs = [];
      updatedDb.settings = {
        ...currentDb.settings,
        companyPhone: updatedDb.company.phone,
        companyAddress: updatedDb.company.address,
        companyTaxNumber: updatedDb.company.taxNumber,
        companyCommercialRecord: updatedDb.company.commercialRecord,
        notificationPhone: updatedDb.company.phone,
      };
    } else {
      const mergedCust = [...currentDb.customers];
      mappedCustomers.forEach((c) => {
        const exIdx = mergedCust.findIndex((x) => x.code === c.code);
        if (exIdx >= 0) mergedCust[exIdx] = { ...mergedCust[exIdx], ...c, id: mergedCust[exIdx].id };
        else mergedCust.push(c);
      });
      updatedDb.customers = mergedCust;

      if (mappedVendors.length > 0) {
        const mergedVend = [...currentDb.vendors];
        mappedVendors.forEach((v) => {
          const exIdx = mergedVend.findIndex((x) => x.code === v.code);
          if (exIdx >= 0) mergedVend[exIdx] = { ...mergedVend[exIdx], ...v, id: mergedVend[exIdx].id };
          else mergedVend.push(v);
        });
        updatedDb.vendors = mergedVend;
      }
    }

    const stats: QrightMigrationStats = {
      accountsImported: mappedAccounts.length,
      customersImported: mappedCustomers.length,
      vendorsImported: mappedVendors.length,
      itemsImported: mappedItems.length,
      stockRowsImported: mappedStock.length,
      warehousesImported: mappedWarehouses.length,
      invoicesImported,
      vouchersImported,
      journalEntriesImported,
    };

    const migrationLog = {
      id: `log-bak-${Date.now()}`,
      timestamp: now,
      userId: updatedDb.users[0]?.id || 'u-1',
      userName: updatedDb.users[0]?.fullName || 'الإدارة',
      action: 'إنشاء' as const,
      module: 'الإعدادات' as const,
      details: `استيراد شامل من نسخة SQL Server (${fileName}): ${stats.accountsImported} حساب، ${stats.customersImported} عميل، ${stats.itemsImported} صنف، ${stats.invoicesImported} فاتورة، ${stats.vouchersImported} سند، ${stats.journalEntriesImported} قيد، ${mappedRegionalAreas.length} منطقة`,
    };
    updatedDb.auditLogs = mode === 'replace' ? [migrationLog] : [migrationLog, ...currentDb.auditLogs];

    updatedDb = reconcileSaudiCurrenciesInDb(updatedDb);
    return { updatedDb, stats };
  };

  return {
    fileName,
    databaseName: dbName,
    mdfStartOffset: mdfStart,
    totalPages,
    tables,
    decodeTable,
    exportTableToExcel,
    exportAllKeyTablesToExcel,
    getQrightMigrationPreview,
    applyQrightMigration,
  };
}
