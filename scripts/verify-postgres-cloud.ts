/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Live PostgreSQL / Neon Verification Script (No PGlite fallback — fails unless real DATABASE_URL is reachable)
 * Usage: DATABASE_URL="postgresql://..." npm run verify:postgres
 */

import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  createPgPoolExecutor,
  normalizeDatabaseUrl,
  runMigrations,
  type PgExecutor,
} from '../server/db.ts';
import { TENANT_RLS_TABLES } from '../migrations/001_multi_tenant_core.ts';
import { createErpServerApp } from '../server/app.ts';

async function main() {
  const cleanUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!cleanUrl) {
    console.error(
      'ERROR: DATABASE_URL is not configured or invalid. Real PostgreSQL/Neon connection is required (PGlite fallback is disabled in this check).'
    );
    process.exit(1);
  }

  let db: PgExecutor | null = null;
  let server: http.Server | null = null;
  const tag = crypto.randomBytes(3).toString('hex');
  const compA = `audit-comp-a-${tag}`;
  const compB = `audit-comp-b-${tag}`;
  const userA = `audit_user_a_${tag}`;
  const userB = `audit_user_b_${tag}`;

  try {
    console.log('1) Connecting to PostgreSQL/Neon via pg.Pool (SSL)...');
    db = createPgPoolExecutor(cleanUrl);
    await db.query('SELECT 1');

    console.log('2) Running migrations & verifying idempotency...');
    await runMigrations(db);
    const secondRun = await runMigrations(db);
    assert.deepEqual(secondRun, [], 'Second migration pass must not re-apply migrations');

    console.log('3) Verifying role privileges & FORCE ROW LEVEL SECURITY...');
    const rls = await db.checkRlsStatus();
    console.log('   Role & RLS snapshot:', {
      dialect: rls.dialect,
      roleName: rls.roleName,
      isSuperuser: rls.isSuperuser,
      bypassRls: rls.bypassRls,
      enforcesViaAppRole: rls.enforcesViaAppRole,
      tables: rls.rlsTables.length,
    });
    assert.equal(rls.dialect, 'pg');
    assert.equal(
      (!rls.isSuperuser && !rls.bypassRls) || rls.enforcesViaAppRole,
      true,
      'Application role must not be unconstrained SUPERUSER or BYPASSRLS'
    );
    assert.equal(rls.rlsTables.length, TENANT_RLS_TABLES.length);
    for (const t of rls.rlsTables) {
      assert.equal(t.enabled && t.forced, true, `FORCE RLS must be active on ${t.table}`);
    }

    console.log('4) Testing isolated multi-tenant registration, cross-tenant block & persistence across restart...');
    const sessionSecret = `verify-pg-live-secret-${crypto.randomBytes(16).toString('hex')}`;
    const app1 = createErpServerApp({ db, sessionSecret, isProduction: false });
    server = http.createServer(app1);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const port1 = (server.address() as { port: number }).port;
    const url1 = `http://127.0.0.1:${port1}`;

    const regA = await fetch(`${url1}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userA,
        fullName: 'Audit Tenant A',
        password: 'AuditPassA2026',
        company: { id: compA, nameAr: `منشأة تدقيق أ ${tag}`, countryCode: 'YE', baseCurrency: 'YER' },
      }),
    });
    assert.equal(regA.status, 201);
    const cookieA = (regA.headers.get('set-cookie') || '').split(';')[0];

    const regB = await fetch(`${url1}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: userB,
        fullName: 'Audit Tenant B',
        password: 'AuditPassB2026',
        company: { id: compB, nameAr: `منشأة تدقيق ب ${tag}`, countryCode: 'SA', baseCurrency: 'SAR' },
      }),
    });
    assert.equal(regB.status, 201);

    const crossRead = await fetch(`${url1}/api/company/state?companyId=${compB}`, {
      headers: { Cookie: cookieA },
    });
    assert.equal(crossRead.status, 403);

    // SQL-level RLS verification with active tenant context vs unset context
    const sqlRowsA = await db.transaction(
      async (tx) => (await tx.query<{ company_id: string }>('SELECT company_id FROM company_state')).rows,
      { companyId: compA }
    );
    assert.deepEqual(sqlRowsA.map((r) => r.company_id), [compA]);

    const sqlRowsNone = await db.transaction(
      async (tx) => (await tx.query<{ company_id: string }>('SELECT company_id FROM company_state')).rows,
      {}
    );
    assert.equal(sqlRowsNone.length, 0, 'Unset tenant context must return 0 rows under RLS');

    // Simulate server & connection pool restart
    await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    server = null;
    await db.close();

    db = createPgPoolExecutor(cleanUrl);
    await runMigrations(db);
    const app2 = createErpServerApp({ db, sessionSecret, isProduction: false });
    server = http.createServer(app2);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const port2 = (server.address() as { port: number }).port;
    const url2 = `http://127.0.0.1:${port2}`;

    const loginA = await fetch(`${url2}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userA, password: 'AuditPassA2026' }),
    });
    assert.equal(loginA.status, 200);
    const loginAJson = (await loginA.json()) as { companies: Array<{ id: string }> };
    assert.deepEqual(loginAJson.companies.map((c) => c.id), [compA]);

    console.log('5) Cleaning up temporary audit test records...');
    await db.transaction(
      async (tx) => {
        await tx.query('DELETE FROM companies WHERE id IN ($1, $2)', [compA, compB]);
        await tx.query('DELETE FROM users WHERE username IN ($1, $2)', [userA, userB]);
      },
      { bypassRls: true }
    );

    console.log('SUCCESS: Real PostgreSQL/Neon connection, SSL, migrations, RLS, and tenant isolation verified!');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    if (db) {
      await db.close().catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error('PostgreSQL cloud verification failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
