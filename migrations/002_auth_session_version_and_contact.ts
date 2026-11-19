/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Migration 002: Auth Session Versioning & User Contact Fields
 * Additive, non-destructive, reversible migration. Does NOT alter migration 001 or weaken RLS.
 */

import type { MigrationDefinition, SqlExecutor } from './001_multi_tenant_core.ts';

export const migration002AuthSessionVersionAndContact: MigrationDefinition = {
  id: '002_auth_session_version_and_contact',
  description:
    'Add phone, phone_normalized, session_version, and password_changed_at columns and lookup indexes to users for safe session revocation and multi-channel auth.',
  async up(exec: SqlExecutor): Promise<void> {
    await exec.exec(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

      UPDATE users
      SET session_version = 1
      WHERE session_version IS NULL OR session_version < 1;

      CREATE INDEX IF NOT EXISTS idx_users_email_lower
        ON users (LOWER(email))
        WHERE email <> '';

      CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
        ON users (phone_normalized)
        WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';
    `);
  },

  async down(exec: SqlExecutor): Promise<void> {
    await exec.exec(`
      DROP INDEX IF EXISTS idx_users_phone_normalized;
      DROP INDEX IF EXISTS idx_users_email_lower;

      ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at;
      ALTER TABLE users DROP COLUMN IF EXISTS session_version;
      ALTER TABLE users DROP COLUMN IF EXISTS phone_normalized;
      ALTER TABLE users DROP COLUMN IF EXISTS phone;
    `);
  },
};
