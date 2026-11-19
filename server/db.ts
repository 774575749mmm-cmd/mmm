/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - PostgreSQL Database Adapter, Transaction Context & Migration Runner
 * Supports Neon PostgreSQL (DATABASE_URL via pg.Pool) and local PGlite (PostgreSQL 18 WASM)
 */

import fs from 'node:fs';
import path from 'node:path';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import {
  ALL_MIGRATIONS,
  TENANT_RLS_TABLES,
  type MigrationDefinition,
  type SqlExecutor,
} from '../migrations/001_multi_tenant_core.ts';
import { migration002AuthSessionVersionAndContact } from '../migrations/002_auth_session_version_and_contact.ts';

export const REGISTERED_MIGRATIONS: MigrationDefinition[] = [
  ...ALL_MIGRATIONS,
  migration002AuthSessionVersionAndContact,
];

export interface TenantDbContext {
  companyId?: string;
  userId?: string;
  bypassRls?: boolean;
}

export interface RlsDiagnostics {
  dialect: 'pg' | 'pglite';
  roleName: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  enforcesViaAppRole: boolean;
  rlsTables: Array<{
    table: string;
    enabled: boolean;
    forced: boolean;
  }>;
}

export interface PgExecutor extends SqlExecutor {
  readonly dialect: 'pg' | 'pglite';
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>, ctx?: TenantDbContext): Promise<T>;
  checkRlsStatus(): Promise<RlsDiagnostics>;
  close(): Promise<void>;
}

function sanitizeDbError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err || 'Database error');
  // Scrub any embedded connection strings or passwords if present
  const scrubbed = msg.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[REDACTED]@');
  return new Error(scrubbed);
}

interface RolePrivilegeInfo {
  roleName: string;
  isSuperuser: boolean;
  bypassRls: boolean;
  hasAppRole: boolean;
}

async function detectRolePrivileges(exec: SqlExecutor): Promise<RolePrivilegeInfo> {
  const res = await exec.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    has_app_role: boolean;
  }>(`
    SELECT
      r.rolname,
      r.rolsuper,
      r.rolbypassrls,
      EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'erp_app_role') AS has_app_role
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const row = res.rows[0];
  return {
    roleName: String(row?.rolname || 'unknown'),
    isSuperuser: Boolean(row?.rolsuper),
    bypassRls: Boolean(row?.rolbypassrls),
    hasAppRole: Boolean(row?.has_app_role),
  };
}

async function applyTenantSessionContext(
  tx: SqlExecutor,
  ctx: TenantDbContext | undefined,
  privs: RolePrivilegeInfo
): Promise<void> {
  const companyId = String(ctx?.companyId || '').trim();
  const userId = String(ctx?.userId || '').trim();
  const bypass = ctx?.bypassRls ? 'true' : '';

  if ((privs.isSuperuser || privs.bypassRls) && privs.hasAppRole && !ctx?.bypassRls) {
    await tx.query('SET LOCAL ROLE erp_app_role');
  }

  await tx.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
  await tx.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
  await tx.query("SELECT set_config('app.bypass_tenant_rls', $1, true)", [bypass]);
}

async function collectRlsDiagnostics(
  exec: SqlExecutor,
  dialect: 'pg' | 'pglite',
  privs: RolePrivilegeInfo
): Promise<RlsDiagnostics> {
  const tableRes = await exec.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
    ORDER BY c.relname
  `,
    [Array.from(TENANT_RLS_TABLES)]
  );

  return {
    dialect,
    roleName: privs.roleName,
    isSuperuser: privs.isSuperuser,
    bypassRls: privs.bypassRls,
    enforcesViaAppRole: (privs.isSuperuser || privs.bypassRls) && privs.hasAppRole,
    rlsTables: tableRes.rows.map((r) => ({
      table: String(r.relname),
      enabled: Boolean(r.relrowsecurity),
      forced: Boolean(r.relforcerowsecurity),
    })),
  };
}

export function normalizeDatabaseUrl(rawInput: string | undefined): string | null {
  let raw = String(rawInput || '').trim();
  if (!raw) return null;

  // Handle copy-pasted Neon CLI strings like: psql 'postgresql://...' or psql "postgresql://..."
  if (/^psql\s+/i.test(raw)) {
    const match = raw.match(/(postgres(?:ql)?:\/\/[^\s'"]+)/i);
    if (match?.[1]) {
      raw = match[1].trim();
    } else {
      return null;
    }
  }

  // Strip wrapping quotes if present
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }

  if (!/^postgres(?:ql)?:\/\//i.test(raw)) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    const host = (parsed.hostname || '').trim().toLowerCase();
    if (!host || host === 'base' || host === '___dummy___' || host === 'my_database_url') {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function createPgPoolExecutor(databaseUrl: string): PgExecutor {
  const cleanUrl = normalizeDatabaseUrl(databaseUrl);
  if (!cleanUrl) {
    throw new Error('DATABASE_URL is missing or not a valid postgresql:// connection string.');
  }

  const isLocal = /localhost|127\.0\.0\.1/i.test(cleanUrl);
  const sslMode = String(process.env.PGSSLMODE || '').trim().toLowerCase();
  const poolConfig: PoolConfig = {
    connectionString: cleanUrl,
    max: Number(process.env.PG_POOL_MAX || 12),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl:
      sslMode === 'disable' || (isLocal && sslMode !== 'require')
        ? false
        : { rejectUnauthorized: sslMode === 'verify-full' },
  };

  const pool = new Pool(poolConfig);
  pool.on('error', () => {
    // Connection/query errors are surfaced & sanitized per query/transaction call
  });
  let cachedPrivs: RolePrivilegeInfo | null = null;

  const wrapClient = (client: PoolClient): SqlExecutor => ({
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const res = await client.query<T>(sql, params);
      return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });

  const baseExecutor: PgExecutor = {
    dialect: 'pg',
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      try {
        const res = await pool.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
      } catch (err) {
        throw sanitizeDbError(err);
      }
    },
    async exec(sql: string) {
      try {
        await pool.query(sql);
      } catch (err) {
        throw sanitizeDbError(err);
      }
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>, ctx?: TenantDbContext): Promise<T> {
      const client = await pool.connect();
      const tx = wrapClient(client);
      try {
        await client.query('BEGIN');
        if (!cachedPrivs || ((cachedPrivs.isSuperuser || cachedPrivs.bypassRls) && !cachedPrivs.hasAppRole)) {
          cachedPrivs = await detectRolePrivileges(tx);
        }
        await applyTenantSessionContext(tx, ctx, cachedPrivs);
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw sanitizeDbError(err);
      } finally {
        client.release();
      }
    },
    async checkRlsStatus() {
      const privs =
        cachedPrivs && !( (cachedPrivs.isSuperuser || cachedPrivs.bypassRls) && !cachedPrivs.hasAppRole )
          ? cachedPrivs
          : await detectRolePrivileges(baseExecutor);
      cachedPrivs = privs;
      return collectRlsDiagnostics(baseExecutor, 'pg', privs);
    },
    async close() {
      await pool.end();
    },
  };

  return baseExecutor;
}

export function createPgliteExecutor(dataDirOrMemory = 'memory://'): PgExecutor {
  if (dataDirOrMemory !== 'memory://') {
    const abs = path.resolve(dataDirOrMemory);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
    }
  }
  const pglite = new PGlite(dataDirOrMemory);
  let cachedPrivs: RolePrivilegeInfo | null = null;
  let txQueue: Promise<unknown> = Promise.resolve();

  const baseExecutor: PgExecutor = {
    dialect: 'pglite',
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      try {
        const res = await pglite.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
      } catch (err) {
        throw sanitizeDbError(err);
      }
    },
    async exec(sql: string) {
      try {
        await pglite.exec(sql);
      } catch (err) {
        throw sanitizeDbError(err);
      }
    },
    async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>, ctx?: TenantDbContext): Promise<T> {
      const run = async () => {
        await pglite.waitReady;
        return pglite.transaction(async (rawTx) => {
          const tx: SqlExecutor = {
            async query<R extends Record<string, unknown>>(sql: string, params?: unknown[]) {
              const res = await rawTx.query<R>(sql, params);
              return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
            },
            async exec(sql: string) {
              await rawTx.exec(sql);
            },
          };
          if (!cachedPrivs || ((cachedPrivs.isSuperuser || cachedPrivs.bypassRls) && !cachedPrivs.hasAppRole)) {
            cachedPrivs = await detectRolePrivileges(tx);
          }
          await applyTenantSessionContext(tx, ctx, cachedPrivs);
          return fn(tx);
        });
      };

      const next = txQueue.then(run, run);
      txQueue = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    async checkRlsStatus() {
      const privs =
        cachedPrivs && !( (cachedPrivs.isSuperuser || cachedPrivs.bypassRls) && !cachedPrivs.hasAppRole )
          ? cachedPrivs
          : await detectRolePrivileges(baseExecutor);
      cachedPrivs = privs;
      return collectRlsDiagnostics(baseExecutor, 'pglite', privs);
    },
    async close() {
      await pglite.close();
    },
  };

  return baseExecutor;
}

export async function runMigrations(db: PgExecutor): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRes = await db.query<{ id: string }>('SELECT id FROM schema_migrations');
  const appliedIds = new Set(appliedRes.rows.map((r) => String(r.id)));
  const newlyApplied: string[] = [];

  for (const migration of REGISTERED_MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;
    await db.transaction(
      async (tx) => {
        await migration.up(tx);
        await tx.query(
          'INSERT INTO schema_migrations (id, description) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
          [migration.id, migration.description]
        );
      },
      { bypassRls: true }
    );
    newlyApplied.push(migration.id);
  }

  // Idempotent non-destructive upgrade: ensure users.company_id exists on databases migrated prior to this column addition
  await db.transaction(
    async (tx) => {
      await tx.exec(`
        DO $$
        BEGIN
          IF to_regclass('public.users') IS NOT NULL THEN
            ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;
            UPDATE users SET company_id = COALESCE(company_id, last_active_company_id) WHERE company_id IS NULL;
          END IF;
        END $$;
      `);
    },
    { bypassRls: true }
  );

  return newlyApplied;
}

export async function rollbackLastMigration(db: PgExecutor): Promise<string | null> {
  const res = await db.query<{ id: string }>(
    'SELECT id FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1'
  );
  const lastId = res.rows[0]?.id;
  if (!lastId) return null;

  const migration = REGISTERED_MIGRATIONS.find((m) => m.id === lastId);
  if (!migration) {
    throw new Error(`Migration definition not found for rollback: ${lastId}`);
  }

  await db.transaction(
    async (tx) => {
      await migration.down(tx);
      await tx.query('DELETE FROM schema_migrations WHERE id = $1', [migration.id]);
    },
    { bypassRls: true }
  );
  return migration.id;
}

export async function createServerDatabaseFromEnv(): Promise<PgExecutor> {
  const isProduction = process.env.NODE_ENV === 'production';
  const rawDbUrl = String(process.env.DATABASE_URL || '').trim();
  const normalizedUrl = normalizeDatabaseUrl(rawDbUrl);
  const pgliteDir = process.env.ERP_PGLITE_DIR || path.resolve('.erp-pglite-data');

  if (isProduction && !rawDbUrl) {
    throw new Error(
      'CRITICAL DATABASE CONFIG ERROR: DATABASE_URL is required in production mode (Neon PostgreSQL). Refusing to fall back to ephemeral local storage.'
    );
  }

  if (rawDbUrl && !normalizedUrl) {
    if (isProduction) {
      throw new Error(
        'CRITICAL DATABASE CONFIG ERROR: Invalid DATABASE_URL format. Expected a valid postgresql:// connection URI.'
      );
    }
    console.warn(
      '[ERP DB] Ignoring invalid/non-URI DATABASE_URL in non-production mode; using local PGlite PostgreSQL engine.'
    );
  }

  if (normalizedUrl) {
    const pgDb = createPgPoolExecutor(normalizedUrl);
    try {
      await runMigrations(pgDb);
      const rls = await pgDb.checkRlsStatus();
      const allForced =
        rls.rlsTables.length === TENANT_RLS_TABLES.length &&
        rls.rlsTables.every((t) => t.enabled && t.forced);
      const roleProtected = (!rls.isSuperuser && !rls.bypassRls) || rls.enforcesViaAppRole;

      if (isProduction && !allForced) {
        throw new Error(
          'CRITICAL SECURITY CONFIG ERROR: PostgreSQL FORCE ROW LEVEL SECURITY is not active on all tenant tables.'
        );
      }
      if (isProduction && !roleProtected) {
        throw new Error(
          `CRITICAL SECURITY CONFIG ERROR: Database role "${rls.roleName}" has SUPERUSER or BYPASSRLS without restricted erp_app_role downgrade.`
        );
      }
      return pgDb;
    } catch (err) {
      await pgDb.close().catch(() => undefined);
      if (isProduction) {
        throw sanitizeDbError(err);
      }
      console.warn(
        '[ERP DB] PostgreSQL connection failed in non-production mode; falling back to local PGlite engine:',
        sanitizeDbError(err).message
      );
    }
  }

  const localDb = createPgliteExecutor(pgliteDir);
  await runMigrations(localDb);
  return localDb;
}
