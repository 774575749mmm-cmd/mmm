/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Stage P0-D Audit Tests: Large AES-256-GCM Encrypted Backup & Restore Integrity
 */

import { describe, it, expect } from 'vitest';
import {
  getInitialDatabase,
  encryptBackupPayload,
  decryptBackupPayload,
  validateBackupPayload,
  ERPDatabase,
} from '../src/services/storageService';
import { exportDatabaseBackupAsync } from '../src/services/backupService';
import { Invoice } from '../src/types/erp';

function buildDbWithInvoices(count: number): ERPDatabase {
  const base = getInitialDatabase();
  const sample = base.invoices[0];
  const invoices: Invoice[] = [];
  for (let i = 0; i < count; i++) {
    invoices.push({
      ...sample,
      id: `inv-scale-${i}`,
      invoiceNumber: `INV-SCALE-${String(i + 1).padStart(5, '0')}`,
      notes: `ملاحظة تجارية للفاتورة رقم ${i + 1} - حفظ البيانات المالية بدقة عالية دون اقتطاع`,
    });
  }
  return {
    ...base,
    invoices,
  };
}

describe('P0-D Large Backup & AES-256-GCM Encryption Integrity', () => {
  it('1. Round-trips AES-256-GCM encrypted backup with 150 invoices cleanly', async () => {
    const db = buildDbWithInvoices(150);
    const cipherJson = await encryptBackupPayload(db, 'StrongPass#2026');
    expect(cipherJson).toContain('ALMANSOOR_ERP_AES256_GCM_V1');

    const plainJson = await decryptBackupPayload(cipherJson, 'StrongPass#2026');
    const check = validateBackupPayload(plainJson);
    expect(check.valid).toBe(true);
    expect(check.stats?.invoices).toBe(150);
    expect(check.db?.invoices[149].invoiceNumber).toBe('INV-SCALE-00150');
  });

  it('2. Round-trips AES-256-GCM encrypted backup with 1,000 invoices (>64KB stack-overflow boundary)', async () => {
    const db = buildDbWithInvoices(1000);
    const cipherJson = await encryptBackupPayload(db, 'Almansoor@1000');
    expect(cipherJson.length).toBeGreaterThan(250_000);

    const plainJson = await decryptBackupPayload(cipherJson, 'Almansoor@1000');
    const check = validateBackupPayload(plainJson);
    expect(check.valid).toBe(true);
    expect(check.stats?.invoices).toBe(1000);
    expect(check.db?.invoices[999].id).toBe('inv-scale-999');
  });

  it('3. Round-trips AES-256-GCM encrypted backup with 10,000 invoices (multi-MB scale)', async () => {
    const db = buildDbWithInvoices(10000);
    const cipherJson = await encryptBackupPayload(db, 'EnterpriseScale#10k');
    expect(cipherJson.length).toBeGreaterThan(2_000_000);

    const plainJson = await decryptBackupPayload(cipherJson, 'EnterpriseScale#10k');
    const check = validateBackupPayload(plainJson);
    expect(check.valid).toBe(true);
    expect(check.stats?.invoices).toBe(10000);
    expect(check.db?.invoices[9999].invoiceNumber).toBe('INV-SCALE-10000');
  }, 15000);

  it('4. Rejects wrong passphrase, empty passphrase, and tampered ciphertext fail-closed', async () => {
    const db = buildDbWithInvoices(50);
    const cipherJson = await encryptBackupPayload(db, 'CorrectPass#1');

    await expect(decryptBackupPayload(cipherJson, 'WrongPass#2')).rejects.toThrow();
    await expect(decryptBackupPayload(cipherJson, '')).rejects.toThrow();

    const parsed = JSON.parse(cipherJson) as { ciphertext: string; [k: string]: unknown };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -4)}AAAA`;
    await expect(decryptBackupPayload(JSON.stringify(parsed), 'CorrectPass#1')).rejects.toThrow();

    const invalidCheck = validateBackupPayload('{"not":"valid"}');
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.db).toBeUndefined();
  });

  it('5. Async chunked backup exporter verifies envelope integrity on 2,000 invoices', async () => {
    const db = buildDbWithInvoices(2000);
    const res = await exportDatabaseBackupAsync(db, {
      skipDownload: true,
      preferWorker: false,
    });
    expect(res.ok).toBe(true);
    expect(res.integrityVerified).toBe(true);
    expect(res.sizeBytes).toBeGreaterThan(500_000);
  });
});
