/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Staging Integration & Security Tests: Two-Stage Backup Restore & Migration Persistence
 * Tests ONLY against Staging (PGlite / TEST_POSTGRES_URL) — NEVER touches Production.
 */

import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPgliteExecutor,
  createPgPoolExecutor,
  runMigrations,
  type PgExecutor,
} from '../server/db';
import { TENANT_RLS_TABLES } from '../migrations/001_multi_tenant_core';
import { createErpServerApp } from '../server/app';
import {
  hydrateErpDatabaseFromServerState,
  prepareDatabaseForRestore,
  type CompanyStatePayload,
} from '../src/services/cloudApiService';
import { getInitialDatabase, type ERPDatabase } from '../src/services/storageService';
import { parseSqlServerBakBuffer } from '../src/services/sqlBakParserService';

async function createStagingPgDb(): Promise<PgExecutor> {
  const url = String(process.env.TEST_POSTGRES_URL || '').trim();
  const db = url ? createPgPoolExecutor(url) : createPgliteExecutor('memory://');
  await runMigrations(db);
  return db;
}

async function startStagingServer(db: PgExecutor) {
  const app = createErpServerApp({
    db,
    sessionSecret: 'staging-backup-restore-test-secret-over-32-chars!',
    rateLimits: { loginPerMinute: 300, aiPerMinute: 60, whatsappPerMinute: 60 },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

function extractSessionCookie(resp: Response): string {
  const setCookie = resp.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

// =========================================================================
// Synthetic Uncompressed SQL Server MTF + MDF (.bak / .bakw) Binary Builder
// =========================================================================

type SqlColDef =
  | { name: string; type: 'int' }
  | { name: string; type: 'float' }
  | { name: string; type: 'bit' }
  | { name: string; type: 'guid' }
  | { name: string; type: 'nvarchar' };

function encodeGuidBytes(guidStr: string): Uint8Array {
  const clean = guidStr.replace(/-/g, '');
  const out = new Uint8Array(16);
  const b = (i: number) => parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  // Little-endian Data1, Data2, Data3; Big-endian Data4
  out[0] = b(3);
  out[1] = b(2);
  out[2] = b(1);
  out[3] = b(0);
  out[4] = b(5);
  out[5] = b(4);
  out[6] = b(7);
  out[7] = b(6);
  for (let i = 8; i < 16; i++) out[i] = b(i);
  return out;
}

function encodeUtf16Le(str: string): Uint8Array {
  const buf = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    buf[i * 2] = code & 0xff;
    buf[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return buf;
}

function buildSqlDataRow(
  fixedCols: Array<{
    type: 'int' | 'bigint' | 'smallint' | 'tinyint' | 'float' | 'guid' | 'char2' | 'bit';
    value: number | string | boolean;
    offset: number;
    bitpos?: number;
  }>,
  fsize: number,
  totalCols: number,
  varCols: Uint8Array[]
): Uint8Array {
  const nbmLen = Math.ceil(totalCols / 8);
  const varTotalLen = varCols.reduce((s, c) => s + c.length, 0);
  const hasVar = varCols.length > 0;
  const headerAndFixed = fsize;
  const nbmStart = headerAndFixed + 2;
  const varHeaderStart = nbmStart + nbmLen;
  const varDataStart = varHeaderStart + (hasVar ? 2 + 2 * varCols.length : 0);
  const totalLen = varDataStart + varTotalLen;

  const row = new Uint8Array(totalLen);
  const dv = new DataView(row.buffer);

  row[0] = hasVar ? 0x30 : 0x10;
  row[1] = 0x00;
  dv.setUint16(2, fsize, true);

  for (const fc of fixedCols) {
    if (fc.type === 'int') dv.setInt32(fc.offset, Number(fc.value), true);
    else if (fc.type === 'bigint') dv.setBigInt64(fc.offset, BigInt(fc.value), true);
    else if (fc.type === 'smallint') dv.setInt16(fc.offset, Number(fc.value), true);
    else if (fc.type === 'tinyint') row[fc.offset] = Number(fc.value) & 0xff;
    else if (fc.type === 'float') dv.setFloat64(fc.offset, Number(fc.value), true);
    else if (fc.type === 'guid') row.set(encodeGuidBytes(String(fc.value)), fc.offset);
    else if (fc.type === 'char2') {
      const s = String(fc.value).padEnd(2, ' ');
      row[fc.offset] = s.charCodeAt(0) & 0xff;
      row[fc.offset + 1] = s.charCodeAt(1) & 0xff;
    } else if (fc.type === 'bit') {
      if (fc.value) row[fc.offset] |= 1 << (fc.bitpos || 0);
    }
  }

  dv.setUint16(headerAndFixed, totalCols, true);

  if (hasVar) {
    dv.setUint16(varHeaderStart, varCols.length, true);
    let cursor = varDataStart;
    for (let i = 0; i < varCols.length; i++) {
      row.set(varCols[i], cursor);
      cursor += varCols[i].length;
      dv.setUint16(varHeaderStart + 2 + 2 * i, cursor, true);
    }
  }

  return row;
}

function buildSqlPage(
  pageId: number,
  pageType: number,
  objId: number,
  nextPageId: number,
  records: Uint8Array[]
): Uint8Array {
  const page = new Uint8Array(8192);
  const dv = new DataView(page.buffer);
  page[0] = 1;
  page[1] = pageType;
  dv.setUint32(16, nextPageId, true);
  dv.setUint16(22, records.length, true);
  dv.setUint32(24, objId, true);
  dv.setUint32(32, pageId, true);
  dv.setUint16(36, 1, true); // fileId = 1

  let writePtr = 96;
  records.forEach((rec, idx) => {
    page.set(rec, writePtr);
    dv.setUint16(8192 - 2 * (idx + 1), writePtr, true);
    writePtr += rec.length;
  });
  return page;
}

function buildSyntheticQrightBakBuffer(): ArrayBuffer {
  const GUID_BRANCH = '11111111-1111-1111-1111-111111111111';
  const GUID_STORE = '22222222-2222-2222-2222-222222222222';
  const GUID_ACC_CASH = '33333333-3333-3333-3333-333333333301';
  const GUID_ACC_CUST1 = '33333333-3333-3333-3333-333333333302';
  const GUID_ACC_VEND1 = '33333333-3333-3333-3333-333333333303';
  const GUID_CUST1 = '44444444-4444-4444-4444-444444444401';
  const GUID_MAT1 = '55555555-5555-5555-5555-555555555501';
  const GUID_BILL1 = '66666666-6666-6666-6666-666666666601';
  const GUID_USER1 = '77777777-7777-7777-7777-777777777701';

  const tablesSpec: Array<{
    name: string;
    oid: number;
    cols: SqlColDef[];
    rows: Array<Record<string, number | string | boolean>>;
  }> = [
    {
      name: 'Branchs',
      oid: 1001,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'Name', type: 'nvarchar' },
        { name: 'Phone', type: 'nvarchar' },
        { name: 'City', type: 'nvarchar' },
        { name: 'Country', type: 'nvarchar' },
      ],
      rows: [
        {
          Number: 1,
          GUID: GUID_BRANCH,
          Name: 'شركة الرواد التجارية المستعادة',
          Phone: '777888999',
          City: 'صنعاء',
          Country: 'اليمن',
        },
      ],
    },
    {
      name: 'Stores',
      oid: 1002,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'Code', type: 'nvarchar' },
        { name: 'Name', type: 'nvarchar' },
      ],
      rows: [{ Number: 1, GUID: GUID_STORE, Code: 'WH-BAK-1', Name: 'مستودع الرواد المركزي' }],
    },
    {
      name: 'Accounts',
      oid: 1003,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'Code', type: 'nvarchar' },
        { name: 'Name', type: 'nvarchar' },
        { name: 'Debit', type: 'float' },
        { name: 'Credit', type: 'float' },
      ],
      rows: [
        { Number: 1, GUID: GUID_ACC_CASH, Code: '131', Name: 'الصندوق الرئيسي المستعاد', Debit: 250000, Credit: 0 },
        { Number: 2, GUID: GUID_ACC_CUST1, Code: '12101', Name: 'شركة الأمل للمقاولات', Debit: 75000, Credit: 0 },
        { Number: 3, GUID: GUID_ACC_VEND1, Code: '22101', Name: 'مورد النخبة الدولي', Debit: 0, Credit: 42000 },
      ],
    },
    {
      name: 'Customers',
      oid: 1004,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'AccountGUID', type: 'guid' },
        { name: 'Code', type: 'nvarchar' },
        { name: 'Name', type: 'nvarchar' },
        { name: 'Mobile', type: 'nvarchar' },
        { name: 'City', type: 'nvarchar' },
      ],
      rows: [
        {
          Number: 1,
          GUID: GUID_CUST1,
          AccountGUID: GUID_ACC_CUST1,
          Code: 'C-BAK-1',
          Name: 'شركة الأمل للمقاولات',
          Mobile: '771234567',
          City: 'عدن',
        },
      ],
    },
    {
      name: 'Materials',
      oid: 1005,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'Code', type: 'nvarchar' },
        { name: 'Name', type: 'nvarchar' },
        { name: 'Unity', type: 'nvarchar' },
        { name: 'Last', type: 'float' },
        { name: 'Consumer', type: 'float' },
      ],
      rows: [
        {
          Number: 1,
          GUID: GUID_MAT1,
          Code: 'IT-BAK-1',
          Name: 'كابل طاقة صناعي 16مم',
          Unity: 'لفة',
          Last: 12000,
          Consumer: 15000,
        },
      ],
    },
    {
      name: 'StoresInventory',
      oid: 1006,
      cols: [
        { name: 'MaterialGUID', type: 'guid' },
        { name: 'StoreGUID', type: 'guid' },
        { name: 'Qty', type: 'float' },
      ],
      rows: [{ MaterialGUID: GUID_MAT1, StoreGUID: GUID_STORE, Qty: 48 }],
    },
    {
      name: 'Bills',
      oid: 1007,
      cols: [
        { name: 'Number', type: 'int' },
        { name: 'GUID', type: 'guid' },
        { name: 'CustGUID', type: 'guid' },
        { name: 'StoreGUID', type: 'guid' },
        { name: 'PayType', type: 'int' },
        { name: 'TotalMats', type: 'float' },
        { name: 'TotalFinal', type: 'float' },
        { name: 'Paid', type: 'float' },
        { name: 'BillType', type: 'int' },
      ],
      rows: [
        {
          Number: 901,
          GUID: GUID_BILL1,
          CustGUID: GUID_CUST1,
          StoreGUID: GUID_STORE,
          PayType: 1,
          TotalMats: 75000,
          TotalFinal: 75000,
          Paid: 0,
          BillType: 0,
        },
      ],
    },
    {
      name: 'BillItems',
      oid: 1008,
      cols: [
        { name: 'ParentGUID', type: 'guid' },
        { name: 'MaterialGUID', type: 'guid' },
        { name: 'Qty', type: 'float' },
        { name: 'Price', type: 'float' },
        { name: 'TotalFinal', type: 'float' },
      ],
      rows: [
        {
          ParentGUID: GUID_BILL1,
          MaterialGUID: GUID_MAT1,
          Qty: 5,
          Price: 15000,
          TotalFinal: 75000,
        },
      ],
    },
    {
      name: 'Users',
      oid: 1009,
      cols: [
        { name: 'GUID', type: 'guid' },
        { name: 'Name', type: 'nvarchar' },
      ],
      rows: [{ GUID: GUID_USER1, Name: 'مستخدم النسخة الاحتياطية القديم' }],
    },
  ];

  // Page allocations:
  // 0: File Header (type 15)
  // 1: Page 1 (required by findMdfBounds)
  // 9: Boot page (type 13) with UTF-16 DB name
  // 10: sysallocunits (obj=7)
  // 11: sysrowsets (obj=5)
  // 12: sysschobjs (obj=34)
  // 13-14: syscolpars (obj=41)
  // 15-16: sysrscols (obj=3)
  // 20+: one data page per table (oid = 1001..1009)
  const totalPages = 32;
  const pageBuffers: Uint8Array[] = Array.from({ length: totalPages }, (_, pgId) =>
    buildSqlPage(pgId, pgId === 0 ? 15 : 1, 999, 0, [])
  );

  // Page 9: Boot Page with DB Name
  const bootPage = buildSqlPage(9, 13, 0, 0, []);
  bootPage.set(encodeUtf16Le('QrightBakStaging'), 112);
  pageBuffers[9] = bootPage;

  const allocRecords: Uint8Array[] = [];
  const rowsetRecords: Uint8Array[] = [];
  const schRecords: Uint8Array[] = [];
  const colRecords: Uint8Array[] = [];
  const rscolRecords: Uint8Array[] = [];

  tablesSpec.forEach((tbl, tIdx) => {
    const dataPgId = 20 + tIdx;
    const rsid = BigInt(7000 + tIdx);
    const auid = BigInt(8000 + tIdx);

    // sysallocunits row (fsize >= 45): auid@4, atype@12, ownerid@13, pgfirst@27, pgiam@39
    allocRecords.push(
      buildSqlDataRow(
        [
          { type: 'bigint', value: Number(auid), offset: 4 },
          { type: 'tinyint', value: 1, offset: 12 },
          { type: 'bigint', value: Number(rsid), offset: 13 },
          { type: 'int', value: dataPgId, offset: 27 },
          { type: 'int', value: 0, offset: 39 },
        ],
        46,
        5,
        []
      )
    );

    // sysrowsets row (fsize >= 21): rsid@4, idmajor@13, idminor@17
    rowsetRecords.push(
      buildSqlDataRow(
        [
          { type: 'bigint', value: Number(rsid), offset: 4 },
          { type: 'int', value: tbl.oid, offset: 13 },
          { type: 'int', value: 0, offset: 17 },
        ],
        22,
        3,
        []
      )
    );

    // sysschobjs row (fsize >= 19): oid@4, otype@17('U '), vcol[0]=tableName
    schRecords.push(
      buildSqlDataRow(
        [
          { type: 'int', value: tbl.oid, offset: 4 },
          { type: 'char2', value: 'U ', offset: 17 },
        ],
        20,
        3,
        [encodeUtf16Le(tbl.name)]
      )
    );

    // Compute fixed & variable offsets for table columns
    let fixedOff = 4;
    let varIdx = 0;
    const colOffsets: Array<{ col: SqlColDef; colid: number; rscOffset: number; len: number; xtype: number }> = [];
    tbl.cols.forEach((col, cIdx) => {
      const colid = cIdx + 1;
      if (col.type === 'int') {
        colOffsets.push({ col, colid, rscOffset: fixedOff, len: 4, xtype: 56 });
        fixedOff += 4;
      } else if (col.type === 'float') {
        colOffsets.push({ col, colid, rscOffset: fixedOff, len: 8, xtype: 62 });
        fixedOff += 8;
      } else if (col.type === 'guid') {
        colOffsets.push({ col, colid, rscOffset: fixedOff, len: 16, xtype: 36 });
        fixedOff += 16;
      } else if (col.type === 'bit') {
        colOffsets.push({ col, colid, rscOffset: fixedOff, len: 1, xtype: 104 });
        fixedOff += 1;
      } else {
        varIdx += 1;
        colOffsets.push({ col, colid, rscOffset: -varIdx, len: 256, xtype: 231 });
      }
    });

    for (const meta of colOffsets) {
      // syscolpars row: oid@4, num@8(0), colid@10, xtype@14, length@19, prec@21, scale@22, vcol[0]=name
      colRecords.push(
        buildSqlDataRow(
          [
            { type: 'int', value: tbl.oid, offset: 4 },
            { type: 'smallint', value: 0, offset: 8 },
            { type: 'int', value: meta.colid, offset: 10 },
            { type: 'tinyint', value: meta.xtype, offset: 14 },
            { type: 'smallint', value: meta.len, offset: 19 },
          ],
          28,
          6,
          [encodeUtf16Le(meta.col.name)]
        )
      );
      // sysrscols row: rsid@4, rscolid@12, hbcolid@16, offset@44, nullbit@48, bitpos@52
      rscolRecords.push(
        buildSqlDataRow(
          [
            { type: 'bigint', value: Number(rsid), offset: 4 },
            { type: 'int', value: meta.colid, offset: 12 },
            { type: 'int', value: meta.colid, offset: 16 },
            { type: 'smallint', value: meta.rscOffset, offset: 44 },
            { type: 'smallint', value: 0, offset: 48 },
            { type: 'smallint', value: 0, offset: 52 },
          ],
          55,
          6,
          []
        )
      );
    }

    const rowBytes = tbl.rows.map((r) => {
      const fVals: Array<{
        type: 'int' | 'bigint' | 'smallint' | 'tinyint' | 'float' | 'guid' | 'char2' | 'bit';
        value: number | string | boolean;
        offset: number;
      }> = [];
      const vVals: Uint8Array[] = [];
      for (const meta of colOffsets) {
        const val = r[meta.col.name] ?? '';
        if (meta.col.type === 'int') fVals.push({ type: 'int', value: Number(val), offset: meta.rscOffset });
        else if (meta.col.type === 'float') fVals.push({ type: 'float', value: Number(val), offset: meta.rscOffset });
        else if (meta.col.type === 'guid') fVals.push({ type: 'guid', value: String(val), offset: meta.rscOffset });
        else if (meta.col.type === 'bit') fVals.push({ type: 'bit', value: Boolean(val), offset: meta.rscOffset });
        else vVals.push(encodeUtf16Le(String(val)));
      }
      return buildSqlDataRow(fVals, fixedOff, tbl.cols.length, vVals);
    });

    pageBuffers[dataPgId] = buildSqlPage(dataPgId, 1, tbl.oid, 0, rowBytes);
  });

  // Pack system metadata across pages (chunk syscolpars & sysrscols cleanly so they stay under 8192 bytes)
  pageBuffers[10] = buildSqlPage(10, 1, 7, 0, allocRecords);
  pageBuffers[11] = buildSqlPage(11, 1, 5, 0, rowsetRecords);
  pageBuffers[12] = buildSqlPage(12, 1, 34, 0, schRecords);
  const midCol = Math.ceil(colRecords.length / 2);
  pageBuffers[13] = buildSqlPage(13, 1, 41, 14, colRecords.slice(0, midCol));
  pageBuffers[14] = buildSqlPage(14, 1, 41, 0, colRecords.slice(midCol));
  const midRs = Math.ceil(rscolRecords.length / 2);
  pageBuffers[15] = buildSqlPage(15, 1, 3, 16, rscolRecords.slice(0, midRs));
  pageBuffers[16] = buildSqlPage(16, 1, 3, 0, rscolRecords.slice(midRs));

  // Combine 512B MTF header + all MDF 8192-byte pages
  const mtfHeaderSize = 512;
  const full = new Uint8Array(mtfHeaderSize + totalPages * 8192);
  for (let i = 0; i < totalPages; i++) {
    full.set(pageBuffers[i], mtfHeaderSize + i * 8192);
  }
  return full.buffer;
}

describe('Staging Two-Stage Backup Restore, Migration & Transaction Rollback Suite', () => {
  let db: PgExecutor | null = null;
  let srv: Awaited<ReturnType<typeof startStagingServer>> | null = null;

  beforeEach(async () => {
    db = await createStagingPgDb();
  }, 30_000);

  afterEach(async () => {
    if (srv) {
      await srv.close();
      srv = null;
    }
    if (db) {
      await db.close();
      db = null;
    }
  });

  async function bootstrapOwner(baseUrl: string) {
    const boot = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-owner',
        username: 'owner',
        fullName: 'عبد الرحمن المنصور',
        password: 'OwnerStagingPass2026',
        company: {
          id: 'comp-01',
          nameAr: 'الشركة الافتراضية الرئيسية',
          countryCode: 'YE',
          baseCurrency: 'YER',
        },
      }),
    });
    expect(boot.status).toBe(201);
    const cookie = extractSessionCookie(boot);
    const data = await boot.json();
    return { cookie, data };
  }

  it('1. Restores JSON backup as independent company & within current company, persisting active company across F5 & re-login', async () => {
    srv = await startStagingServer(db!);
    const { cookie: ownerCookie } = await bootstrapOwner(srv.baseUrl);

    // Prepare JSON backup payload for a distinct restored company with invoices, items, customers
    const seed = getInitialDatabase();
    const stampedSeed = prepareDatabaseForRestore(seed, 'comp-json-restored', 'current_company');
    const jsonBackup: ERPDatabase = {
      ...stampedSeed,
      company: {
        ...stampedSeed.company,
        id: 'comp-json-restored',
        nameAr: 'شركة المنار المستعادة JSON',
        nameEn: 'Almanar Restored Trading',
        baseCurrency: 'SAR',
        countryCode: 'SA',
      },
      companies: [
        {
          ...stampedSeed.company,
          id: 'comp-json-restored',
          nameAr: 'شركة المنار المستعادة JSON',
        },
      ],
      activeCompanyId: 'comp-json-restored',
      customers: [
        {
          ...stampedSeed.customers[0],
          id: 'cust-json-1',
          companyId: 'comp-json-restored',
          code: 'C-JSON-01',
          nameAr: 'عميل المنار التجاري',
          currentBalance: 14500,
        },
      ],
      inventoryItems: [
        {
          ...stampedSeed.inventoryItems[0],
          id: 'item-json-1',
          companyId: 'comp-json-restored',
          code: 'SKU-JSON-01',
          nameAr: 'جهاز خادم سحابي',
          salePrice: 5200,
        },
      ],
      invoices: [
        {
          ...stampedSeed.invoices[0],
          id: 'inv-json-1',
          companyId: 'comp-json-restored',
          invoiceNumber: 'INV-JSON-9001',
          entityId: 'cust-json-1',
          entityName: 'عميل المنار التجاري',
          grandTotal: 5200,
        },
      ],
    };

    const prepared = prepareDatabaseForRestore(jsonBackup, 'comp-json-restored', 'restored_company');
    const { users: _u, companies: _c, ...statePayload } = prepared;

    // Stage 2 commit: restore as independent company (Super Admin)
    const restoreRes = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerCookie,
      },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-json-restored',
        companyProfile: prepared.company,
        state: statePayload,
        sourceLabel: 'almanar-backup.json',
      }),
    });
    expect(restoreRes.status).toBe(200);
    const restoreJson = await restoreRes.json();
    expect(restoreJson.ok).toBe(true);
    expect(restoreJson.activeCompanyId).toBe('comp-json-restored');
    expect(restoreJson.company.nameAr).toBe('شركة المنار المستعادة JSON');
    expect(restoreJson.companies.map((c: { id: string }) => c.id)).toEqual([
      'comp-01',
      'comp-json-restored',
    ]);

    const updatedCookie = extractSessionCookie(restoreRes);
    expect(updatedCookie).toContain('erp_session=');

    // Simulate page reload (F5): must stay on 'comp-json-restored' and NEVER revert to 'comp-01'
    const statusRes = await fetch(`${srv.baseUrl}/api/auth/status`, {
      headers: { Cookie: updatedCookie },
    });
    const statusData = await statusRes.json();
    expect(statusData.authenticated).toBe(true);
    expect(statusData.activeCompanyId).toBe('comp-json-restored');

    const stateRes = await fetch(`${srv.baseUrl}/api/company/state`, {
      headers: { Cookie: updatedCookie },
    });
    expect(stateRes.status).toBe(200);
    const stateData = (await stateRes.json()) as CompanyStatePayload;
    expect(stateData.companyId).toBe('comp-json-restored');
    const hydrated = hydrateErpDatabaseFromServerState(stateData);
    expect(hydrated.company.id).toBe('comp-json-restored');
    expect(hydrated.activeCompanyId).toBe('comp-json-restored');
    expect(hydrated.customers.find((c) => c.id === 'cust-json-1')?.currentBalance).toBe(14500);
    expect(hydrated.invoices.find((i) => i.invoiceNumber === 'INV-JSON-9001')?.grandTotal).toBe(5200);
    expect(hydrated.inventoryItems.find((it) => it.code === 'SKU-JSON-01')?.nameAr).toBe('جهاز خادم سحابي');

    // Simulate logout & login: must resume on 'comp-json-restored'
    await fetch(`${srv.baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: updatedCookie } });
    const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'OwnerStagingPass2026' }),
    });
    expect(loginRes.status).toBe(200);
    const loginData = await loginRes.json();
    expect(loginData.activeCompanyId).toBe('comp-json-restored');

    // Also test restoring inside current_company (overwrites active company state cleanly & stamps records)
    const loginCookie = extractSessionCookie(loginRes);
    const inPlaceBackup = prepareDatabaseForRestore(
      {
        ...seed,
        company: { ...seed.company, id: 'comp-legacy-origin', nameAr: 'المنار المحدثة موضعياً' },
        customers: [
          { ...seed.customers[0], id: 'cust-inplace', companyId: 'comp-legacy-origin', nameAr: 'عميل التحديث الموضعي' },
        ],
      },
      'comp-json-restored',
      'current_company'
    );
    const { users: _u2, companies: _c2, ...inPlacePayload } = inPlaceBackup;
    const inPlaceRes = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({
        targetMode: 'current_company',
        companyProfile: inPlaceBackup.company,
        state: inPlacePayload,
        expectedRevision: stateData.revision,
      }),
    });
    expect(inPlaceRes.status).toBe(200);
    const inPlaceJson = await inPlaceRes.json();
    expect(inPlaceJson.activeCompanyId).toBe('comp-json-restored');
    expect(inPlaceJson.revision).toBe(stateData.revision + 1);
    expect(inPlaceJson.company.nameAr).toBe('المنار المحدثة موضعياً');
  });

  it('2. Parses .bak and .bakw binary SQL Server backups, aligns Stage 1 IDs, and restores full financial/inventory/customer data in Stage 2', async () => {
    srv = await startStagingServer(db!);
    const { cookie: ownerCookie } = await bootstrapOwner(srv.baseUrl);
    const currentDb = getInitialDatabase();
    const binaryBuffer = buildSyntheticQrightBakBuffer();

    for (const ext of ['.bak', '.bakw'] as const) {
      const parsed = parseSqlServerBakBuffer(binaryBuffer, `staging_qright${ext}`);
      const preview = parsed.getQrightMigrationPreview();
      expect(preview.isQrightSchema).toBe(true);
      expect(preview.counts.accounts).toBe(3);
      expect(preview.counts.customers).toBe(1);
      expect(preview.counts.materials).toBe(1);
      expect(preview.counts.bills).toBe(1);

      // Stage 1: Verify company.id, activeCompanyId, companies[], and every record's companyId match
      const targetCompId = ext === '.bak' ? undefined : 'comp-bakw-2';
      const { updatedDb, stats } = parsed.applyQrightMigration(currentDb, 'replace', {
        includeCompany: true,
        includeRecentInvoices: true,
        targetCompanyId: targetCompId,
      });

      const expectedCid = targetCompId || 'comp-bak-1';
      expect(stats.accountsImported).toBe(3);
      expect(stats.customersImported).toBe(1);
      expect(stats.vendorsImported).toBe(1);
      expect(stats.itemsImported).toBe(1);
      expect(stats.stockRowsImported).toBe(1);
      expect(stats.invoicesImported).toBe(1);

      expect(updatedDb.company.id).toBe(expectedCid);
      expect(updatedDb.activeCompanyId).toBe(expectedCid);
      expect((updatedDb.companies || []).map((c) => c.id)).toEqual([expectedCid]);
      expect(updatedDb.customers.every((c) => c.companyId === expectedCid)).toBe(true);
      expect(updatedDb.vendors.every((v) => v.companyId === expectedCid)).toBe(true);
      expect(updatedDb.inventoryItems.every((it) => it.companyId === expectedCid)).toBe(true);
      expect(updatedDb.warehouseStock.every((ws) => ws.companyId === expectedCid)).toBe(true);
      expect(updatedDb.invoices.every((inv) => inv.companyId === expectedCid)).toBe(true);
      expect(updatedDb.chartOfAccounts.every((acc) => acc.companyId === expectedCid)).toBe(true);

      // Stage 2: Commit to PostgreSQL via /api/company/restore
      const prepared = prepareDatabaseForRestore(updatedDb, expectedCid, 'restored_company');
      const { users: _u, companies: _c, ...statePayload } = prepared;
      const restoreRes = await fetch(`${srv.baseUrl}/api/company/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({
          targetMode: 'restored_company',
          targetCompanyId: expectedCid,
          companyProfile: prepared.company,
          state: statePayload,
          sourceLabel: `staging_qright${ext}`,
        }),
      });
      expect(restoreRes.status).toBe(200);
      const restoreData = await restoreRes.json();
      expect(restoreData.activeCompanyId).toBe(expectedCid);

      const newCookie = extractSessionCookie(restoreRes);
      const getStateRes = await fetch(`${srv.baseUrl}/api/company/state`, {
        headers: { Cookie: newCookie },
      });
      expect(getStateRes.status).toBe(200);
      const snapshot = (await getStateRes.json()) as CompanyStatePayload;
      const hydrated = hydrateErpDatabaseFromServerState(snapshot);

      // Verify restored financial, inventory, customer & vendor integrity
      expect(hydrated.company.id).toBe(expectedCid);
      expect(hydrated.company.nameAr).toBe('شركة الرواد التجارية المستعادة');
      expect(hydrated.activeCompanyId).toBe(expectedCid);
      expect(hydrated.customers).toHaveLength(1);
      expect(hydrated.customers[0].nameAr).toBe('شركة الأمل للمقاولات');
      expect(hydrated.vendors).toHaveLength(1);
      expect(hydrated.vendors[0].nameAr).toBe('مورد النخبة الدولي');
      expect(hydrated.inventoryItems).toHaveLength(1);
      expect(hydrated.inventoryItems[0].nameAr).toBe('كابل طاقة صناعي 16مم');
      expect(hydrated.warehouseStock[0].quantityOnHand).toBe(48);
      expect(hydrated.invoices).toHaveLength(1);
      expect(hydrated.invoices[0].grandTotal).toBe(75000);
      expect(hydrated.invoices[0].items[0].quantity).toBe(5);
    }
  });

  it('3. Enforces 403/409 protections, PostgreSQL RLS isolation, and NEVER imports passwords or permissions from backups', async () => {
    srv = await startStagingServer(db!);
    const { cookie: ownerCookie } = await bootstrapOwner(srv.baseUrl);

    // Create Tenant Admin in comp-01 (non-Super-Admin) & Restricted user
    const createTenantAdmin = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        id: 'usr-tadmin',
        username: 'tenant_admin_01',
        fullName: 'مدير منشأة محلي',
        role: 'Tenant Admin',
        password: 'TenantAdminPass2026',
        branchId: 'br-01',
        active: true,
      }),
    });
    expect(createTenantAdmin.status).toBe(201);

    const createRestricted = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        id: 'usr-cashier',
        username: 'cashier_01',
        fullName: 'مستخدم محدود',
        role: 'مستخدم محدود',
        password: 'CashierUser2026',
        branchId: 'br-01',
        active: true,
      }),
    });
    expect(createRestricted.status).toBe(201);

    // Register separate Tenant B to verify cross-tenant isolation
    const regB = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'tenant_b_admin',
        fullName: 'مدير منشأة B',
        password: 'TenantBPass2026',
        company: { id: 'comp-b-isolated', nameAr: 'شركة B المعزولة', countryCode: 'YE', baseCurrency: 'YER' },
      }),
    });
    expect(regB.status).toBe(201);

    const tAdminLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tenant_admin_01', password: 'TenantAdminPass2026' }),
    });
    const tAdminCookie = extractSessionCookie(tAdminLogin);

    const cashierLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cashier_01', password: 'CashierUser2026' }),
    });
    const cashierCookie = extractSessionCookie(cashierLogin);

    const seed = getInitialDatabase();
    const scopedState = prepareDatabaseForRestore(seed, 'comp-01', 'current_company');

    // A) Restricted user cannot call /api/company/restore -> 403
    const resRestricted = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
      body: JSON.stringify({ targetMode: 'current_company', state: scopedState }),
    });
    expect(resRestricted.status).toBe(403);

    // B) Tenant Admin cannot create independent restored company -> 403 FORBIDDEN_SUPER_ADMIN_ONLY
    const resTAdminNew = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tAdminCookie },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-unauthorized-new',
        state: prepareDatabaseForRestore(seed, 'comp-unauthorized-new', 'restored_company'),
      }),
    });
    expect(resTAdminNew.status).toBe(403);
    expect((await resTAdminNew.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

    // C) Tenant Admin cannot overwrite another tenant's company (comp-b-isolated) -> 403 TENANT_ISOLATION_VIOLATION
    const resCrossTenant = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tAdminCookie },
      body: JSON.stringify({
        targetMode: 'current_company',
        targetCompanyId: 'comp-b-isolated',
        state: prepareDatabaseForRestore(seed, 'comp-b-isolated', 'current_company'),
      }),
    });
    expect(resCrossTenant.status).toBe(403);
    expect((await resCrossTenant.json()).code).toBe('TENANT_ISOLATION_VIOLATION');

    // D) Owner restoring existing company in restored_company mode without allowReplaceExisting -> 409 COMPANY_ALREADY_EXISTS
    const resDup = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-01',
        state: scopedState,
        allowReplaceExisting: false,
      }),
    });
    expect(resDup.status).toBe(409);
    expect((await resDup.json()).code).toBe('COMPANY_ALREADY_EXISTS');

    // E) Stale expectedRevision -> 409 REVISION_CONFLICT
    const initialStateRes = await fetch(`${srv.baseUrl}/api/company/state`, {
      headers: { Cookie: ownerCookie },
    });
    const initialStateJson = await initialStateRes.json();
    const save1 = await fetch(`${srv.baseUrl}/api/company/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        companyId: 'comp-01',
        expectedRevision: initialStateJson.revision,
        state: { ...scopedState, company: { ...scopedState.company, id: 'comp-01' }, activeCompanyId: 'comp-01' },
      }),
    });
    expect(save1.status).toBe(200);

    const resStale = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        targetMode: 'current_company',
        expectedRevision: 0,
        state: scopedState,
      }),
    });
    expect(resStale.status).toBe(409);
    expect((await resStale.json()).code).toBe('REVISION_CONFLICT');

    // F) Rule #6: Malicious backup injecting users/passwords/isSuperAdmin must NEVER overwrite DB auth or leak into state_json
    const cleanTargetSeed = prepareDatabaseForRestore(seed, 'comp-clean-isolated', 'current_company');
    const { users: _uClean, companies: _cClean, ...cleanTargetPayload } = cleanTargetSeed;
    const poisonedPayload = {
      ...cleanTargetPayload,
      passwordHash: 'hijacked_hash',
      passwordSalt: 'hijacked_salt',
      users: [
        {
          id: 'usr-tadmin',
          username: 'tenant_admin_01',
          role: 'مالك المؤسسة',
          isSuperAdmin: true,
          passwordHash: 'evil_hash',
          passwordSalt: 'evil_salt',
        },
        {
          id: 'usr-backdoor',
          username: 'backdoor_admin',
          role: 'مالك المؤسسة',
          isSuperAdmin: true,
          passwordHash: 'evil_hash_2',
          passwordSalt: 'evil_salt_2',
        },
      ],
      companies: [{ id: 'comp-01', nameAr: 'Comp' }, { id: 'comp-b-isolated', nameAr: 'Hijacked' }],
    };

    // Mixed-tenant tampering inside restored_company mode must be rejected (403 TENANT_ISOLATION_VIOLATION)
    const tamperedMixedRes = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-clean-isolated',
        state: {
          ...cleanTargetPayload,
          customers: [{ ...cleanTargetSeed.customers[0], companyId: 'comp-b-isolated' }],
        },
      }),
    });
    expect(tamperedMixedRes.status).toBe(403);
    expect((await tamperedMixedRes.json()).code).toBe('TENANT_ISOLATION_VIOLATION');

    const resSanitized = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-clean-isolated',
        companyProfile: { id: 'comp-clean-isolated', nameAr: 'شركة نظيفة معزولة' },
        state: {
          ...poisonedPayload,
          company: { ...cleanTargetSeed.company, id: 'comp-clean-isolated', nameAr: 'شركة نظيفة معزولة' },
          activeCompanyId: 'comp-clean-isolated',
          auditLogs: [],
        },
      }),
    });
    expect(resSanitized.status).toBe(200);

    // Verify DB user credentials & privileges were NOT modified and backdoor user was NOT created
    const usersCheck = await db!.query<{ id: string; username: string; is_super_admin: boolean; role: string }>(
      'SELECT id, username, is_super_admin, role FROM users ORDER BY id'
    );
    expect(usersCheck.rows.some((u) => u.username === 'backdoor_admin')).toBe(false);
    const tAdminRow = usersCheck.rows.find((u) => u.id === 'usr-tadmin');
    expect(tAdminRow?.is_super_admin).toBe(false);
    expect(tAdminRow?.role).toBe('Tenant Admin');

    // Backdoor login fails (401), real Tenant Admin login still succeeds (200)
    const backdoorAttempt = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'backdoor_admin', password: 'evil' }),
    });
    expect(backdoorAttempt.status).toBe(401);

    const realTAdminRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tenant_admin_01', password: 'TenantAdminPass2026' }),
    });
    expect(realTAdminRes.status).toBe(200);

    // Verify stored state_json has zero users/companies/passwordHash keys
    const storedStateRow = await db!.transaction(
      async (tx) =>
        (
          await tx.query<{ state_json: Record<string, unknown> }>(
            'SELECT state_json FROM company_state WHERE company_id = $1',
            ['comp-clean-isolated']
          )
        ).rows[0],
      { companyId: 'comp-clean-isolated' }
    );
    expect(storedStateRow?.state_json).toBeDefined();
    expect('users' in storedStateRow.state_json).toBe(false);
    expect('companies' in storedStateRow.state_json).toBe(false);
    expect('passwordHash' in storedStateRow.state_json).toBe(false);

    // Verify RLS remains ENABLED + FORCED on all 5 multi-tenant tables
    const rls = await db!.checkRlsStatus();
    expect(rls.rlsTables.map((t) => t.table).sort()).toEqual([...TENANT_RLS_TABLES].sort());
    for (const t of rls.rlsTables) {
      expect(t.enabled).toBe(true);
      expect(t.forced).toBe(true);
    }
  });

  it('4. Executes restore inside an atomic PostgreSQL transaction and rolls back completely on mid-transaction failure', async () => {
    const rawDb = db!;
    let failOnCompanyStateInsert = false;

    const faultInjectedDb: PgExecutor = {
      dialect: rawDb.dialect,
      query: rawDb.query.bind(rawDb),
      exec: rawDb.exec.bind(rawDb),
      checkRlsStatus: rawDb.checkRlsStatus.bind(rawDb),
      close: rawDb.close.bind(rawDb),
      transaction(fn, ctx) {
        return rawDb.transaction(async (tx) => {
          const wrappedTx = {
            async query<R extends Record<string, unknown>>(sql: string, params?: unknown[]) {
              if (failOnCompanyStateInsert && /INSERT INTO company_state/i.test(sql)) {
                throw new Error('SIMULATED_MID_TX_DISK_ERROR');
              }
              return tx.query<R>(sql, params);
            },
            exec: tx.exec.bind(tx),
          };
          return fn(wrappedTx);
        }, ctx);
      },
    };

    srv = await startStagingServer(faultInjectedDb);
    const { cookie: ownerCookie } = await bootstrapOwner(srv.baseUrl);

    const seed = getInitialDatabase();
    const rollbackCandidate = prepareDatabaseForRestore(
      {
        ...seed,
        company: { ...seed.company, id: 'comp-rollback-test', nameAr: 'منشأة اختبار التراجع' },
      },
      'comp-rollback-test',
      'restored_company'
    );
    // Re-stamp arrays for comp-rollback-test
    const restamped = prepareDatabaseForRestore(rollbackCandidate, 'comp-rollback-test', 'current_company');
    const { users: _u, companies: _c, ...statePayload } = restamped;

    failOnCompanyStateInsert = true;
    const failedRes = await fetch(`${srv.baseUrl}/api/company/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        targetMode: 'restored_company',
        targetCompanyId: 'comp-rollback-test',
        companyProfile: restamped.company,
        state: statePayload,
      }),
    });
    expect(failedRes.status).toBe(500);
    failOnCompanyStateInsert = false;

    // Verify full atomic rollback: ZERO rows committed for 'comp-rollback-test' across all tenant tables
    const orphanCheck = await rawDb.transaction(
      async (tx) => {
        const comp = await tx.query('SELECT id FROM companies WHERE id = $1', ['comp-rollback-test']);
        const mem = await tx.query('SELECT company_id FROM company_memberships WHERE company_id = $1', [
          'comp-rollback-test',
        ]);
        const lic = await tx.query('SELECT company_id FROM company_licenses WHERE company_id = $1', [
          'comp-rollback-test',
        ]);
        const st = await tx.query('SELECT company_id FROM company_state WHERE company_id = $1', [
          'comp-rollback-test',
        ]);
        const log = await tx.query('SELECT company_id FROM company_audit_logs WHERE company_id = $1', [
          'comp-rollback-test',
        ]);
        const usr = await tx.query<{ last_active_company_id: string }>(
          'SELECT last_active_company_id FROM users WHERE id = $1',
          ['usr-owner']
        );
        return {
          comp: comp.rows.length,
          mem: mem.rows.length,
          lic: lic.rows.length,
          st: st.rows.length,
          log: log.rows.length,
          lastActive: usr.rows[0]?.last_active_company_id,
        };
      },
      { bypassRls: true }
    );

    expect(orphanCheck.comp).toBe(0);
    expect(orphanCheck.mem).toBe(0);
    expect(orphanCheck.lic).toBe(0);
    expect(orphanCheck.st).toBe(0);
    expect(orphanCheck.log).toBe(0);
    expect(orphanCheck.lastActive).toBe('comp-01');
  });
});
