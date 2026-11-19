/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Stage 1 Auth Hardening & Session Revocation Verification Suite
 * Runs exclusively against isolated PGlite (memory://) or TEST_POSTGRES_URL Staging DB. Never touches Production.
 */

import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPgliteExecutor,
  createPgPoolExecutor,
  rollbackLastMigration,
  runMigrations,
  type PgExecutor,
} from '../server/db.ts';
import {
  createErpServerApp,
  hashPasswordPbkdf2Server,
  isSessionVersionValid,
  type ServerUserRecord,
} from '../server/app.ts';
import { normalizePhoneForStorage } from '../server/tenantRepository.ts';

const TEST_SESSION_SECRET = 'stage1-auth-hardening-staging-secret-key-2026-0001';

interface RunningServer {
  server: http.Server;
  baseUrl: string;
}

async function startServer(opts: {
  db?: PgExecutor;
  initialUsers?: ServerUserRecord[];
}): Promise<RunningServer> {
  const app = createErpServerApp({
    isProduction: false,
    sessionSecret: TEST_SESSION_SECRET,
    inMemoryAuthStore: !opts.db,
    db: opts.db,
    initialUsers: opts.initialUsers,
    rateLimits: { loginPerMinute: 200, aiPerMinute: 60, whatsappPerMinute: 60 },
  });
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function stopServer(s: RunningServer | null): Promise<void> {
  if (!s) return;
  await new Promise<void>((resolve) => s.server.close(() => resolve()));
}

function extractCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0] || '';
}

function signLegacyCookieWithoutSv(payload: {
  userId: string;
  username: string;
  role: string;
  isSuperAdmin?: boolean;
  companyId: string;
  allowedCompanyIds: string[];
}): string {
  const now = Date.now();
  const body = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SESSION_SECRET).update(encoded).digest('base64url');
  return `erp_session=${encodeURIComponent(`${encoded}.${sig}`)}`;
}

async function createIsolatedStagingDb(): Promise<PgExecutor> {
  const testUrl = (process.env.TEST_POSTGRES_URL || '').trim();
  if (testUrl) {
    const db = createPgPoolExecutor(testUrl);
    await db.exec('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await runMigrations(db);
    return db;
  }
  const db = createPgliteExecutor('memory://');
  await runMigrations(db);
  return db;
}

describe('Stage 1 — Auth Hardening, Mandatory Tenant Linkage, Forced Password Change & Session Revocation', () => {
  let db: PgExecutor | null = null;
  let srv: RunningServer | null = null;

  afterEach(async () => {
    await stopServer(srv);
    srv = null;
    if (db) {
      await db.close();
      db = null;
    }
  });

  it('1. Migration 002 adds contact & session_version columns/indexes, preserves RLS, and rolls back cleanly without touching 001', async () => {
    db = await createIsolatedStagingDb();

    const colsRes = await db.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `
    );
    const cols = colsRes.rows.map((r) => r.column_name);
    expect(cols).toContain('phone');
    expect(cols).toContain('phone_normalized');
    expect(cols).toContain('session_version');
    expect(cols).toContain('password_changed_at');

    const idxRes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'users'"
    );
    const indexes = idxRes.rows.map((r) => r.indexname);
    expect(indexes).toContain('idx_users_email_lower');
    expect(indexes).toContain('idx_users_phone_normalized');

    // RLS remains ENABLED + FORCED across all tenant tables
    const rls = await db.checkRlsStatus();
    expect(rls.rlsTables.length).toBeGreaterThan(0);
    expect(rls.rlsTables.every((t) => t.enabled && t.forced)).toBe(true);

    // Roll back ONLY migration 002 -> users table and 001 tables stay intact
    const rolledBack = await rollbackLastMigration(db);
    expect(rolledBack).toBe('002_auth_session_version_and_contact');

    const colsAfterRollback = (
      await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'"
      )
    ).rows.map((r) => r.column_name);
    expect(colsAfterRollback).not.toContain('session_version');
    expect(colsAfterRollback).not.toContain('phone_normalized');
    expect(colsAfterRollback).toContain('username');

    // Re-apply migration 002 cleanly
    const reapplied = await runMigrations(db);
    expect(reapplied).toEqual(['002_auth_session_version_and_contact']);
  });

  it('2. Owner bootstrap stores email & normalized phone, blocks duplicate bootstrap, and supports login by username or unique email', async () => {
    expect(normalizePhoneForStorage('٠٠٩٦٧ ٧٧١-٢٣٤-٥٦٧')).toBe('+967771234567');
    expect(normalizePhoneForStorage('+967 771 234 567')).toBe('+967771234567');

    db = await createIsolatedStagingDb();
    srv = await startServer({ db });

    const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner_main',
        fullName: 'المالك الرئيسي',
        email: 'owner.stage1@almansoor.test',
        phone: '+967 770 112 233',
        password: 'OwnerPassword2026',
        company: { id: 'comp-01', nameAr: 'شركة المنصور الاختبارية' },
      }),
    });
    expect(boot.status).toBe(201);
    const bootBody = (await boot.json()) as {
      ok: boolean;
      user: { email: string; phone: string; sessionVersion: number; isSuperAdmin: boolean };
    };
    expect(bootBody.ok).toBe(true);
    expect(bootBody.user.email).toBe('owner.stage1@almansoor.test');
    expect(bootBody.user.phone).toBe('+967 770 112 233');
    expect(bootBody.user.sessionVersion).toBe(1);
    expect(bootBody.user.isSuperAdmin).toBe(true);

    // Duplicate bootstrap strictly blocked
    const dupBoot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'attacker', password: 'AttackPassword2026' }),
    });
    expect(dupBoot.status).toBe(403);

    // Login via username succeeds
    const loginByUser = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner_main', password: 'OwnerPassword2026' }),
    });
    expect(loginByUser.status).toBe(200);

    // Login via registered email (case-insensitive) succeeds
    const loginByEmail = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'OWNER.STAGE1@ALMANSOOR.TEST', password: 'OwnerPassword2026' }),
    });
    expect(loginByEmail.status).toBe(200);
    const emailLoginBody = (await loginByEmail.json()) as { user: { username: string }; activeCompanyId: string };
    expect(emailLoginBody.user.username).toBe('owner_main');
    expect(emailLoginBody.activeCompanyId).toBe('comp-01');
  });

  it('3. Company registration enforces company.nameAr, links user & session atomically, persists across reload/relogin, and isolates from comp-01', async () => {
    db = await createIsolatedStagingDb();
    srv = await startServer({ db });

    // Seed comp-01 owner first
    await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'AdminPassword2026',
        company: { id: 'comp-01', nameAr: 'الشركة الافتراضية' },
      }),
    });

    // Missing company name must fail 400 COMPANY_NAME_REQUIRED (no stranded user created!)
    const missingComp = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'orphan_user',
        fullName: 'مستخدم بلا منشأة',
        password: 'OrphanUser2026',
      }),
    });
    expect(missingComp.status).toBe(400);
    const missingBody = (await missingComp.json()) as { code: string };
    expect(missingBody.code).toBe('COMPANY_NAME_REQUIRED');

    // Verify no orphan user was inserted
    const orphanCheck = await db.query('SELECT id FROM users WHERE username = $1', ['orphan_user']);
    expect(orphanCheck.rows.length).toBe(0);

    // Register valid tenant & company
    const reg = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'tenant_alpha',
        fullName: 'مدير شركة ألفا',
        email: 'alpha@tenant.test',
        phone: '+967771112233',
        password: 'AlphaPassword2026',
        company: {
          id: 'comp-alpha-01',
          nameAr: 'شركة ألفا المستقلة',
          countryCode: 'SA',
          baseCurrency: 'SAR',
        },
      }),
    });
    expect(reg.status).toBe(201);
    const tenantCookie = extractCookie(reg);
    expect(tenantCookie).toContain('erp_session=');
    const regBody = (await reg.json()) as {
      activeCompanyId: string;
      company: { id: string; nameAr: string };
      user: { phone: string; companyId: string; lastActiveCompanyId: string };
    };
    expect(regBody.activeCompanyId).toBe('comp-alpha-01');
    expect(regBody.company.id).toBe('comp-alpha-01');
    expect(regBody.user.phone).toBe('+967771112233');
    expect(regBody.user.lastActiveCompanyId).toBe('comp-alpha-01');

    // Duplicate company.id rejected with 409 COMPANY_ALREADY_EXISTS
    const dupComp = await fetch(`${srv.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'tenant_beta',
        fullName: 'مدير بيتا',
        password: 'BetaPassword2026',
        company: { id: 'comp-alpha-01', nameAr: 'محاولة تكرار' },
      }),
    });
    expect(dupComp.status).toBe(409);
    expect(((await dupComp.json()) as { code: string }).code).toBe('COMPANY_ALREADY_EXISTS');

    // Reload simulation (/api/auth/status & /api/company/state) stays bound to comp-alpha-01
    const statusRes = await fetch(`${srv.baseUrl}/api/auth/status`, {
      headers: { Cookie: tenantCookie },
    });
    const statusData = (await statusRes.json()) as { authenticated: boolean; activeCompanyId: string };
    expect(statusData.authenticated).toBe(true);
    expect(statusData.activeCompanyId).toBe('comp-alpha-01');

    // Attempting to read comp-01 state is blocked by tenant isolation (403)
    const crossTenant = await fetch(`${srv.baseUrl}/api/company/state?companyId=comp-01`, {
      headers: { Cookie: tenantCookie },
    });
    expect(crossTenant.status).toBe(403);

    // Logout & relogin keeps user bound to comp-alpha-01 (never comp-01)
    const relogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alpha@tenant.test', password: 'AlphaPassword2026' }),
    });
    expect(relogin.status).toBe(200);
    const reloginData = (await relogin.json()) as { activeCompanyId: string };
    expect(reloginData.activeCompanyId).toBe('comp-alpha-01');
  });

  it('4. Forced password change works end-to-end in PostgreSQL for non-admin roles (محاسب) and revokes temporary session', async () => {
    db = await createIsolatedStagingDb();
    srv = await startServer({ db });

    const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner',
        password: 'OwnerPassword2026',
        company: { id: 'comp-01', nameAr: 'شركة الاختبار' },
      }),
    });
    const ownerCookie = extractCookie(boot);

    // Owner creates non-admin accountant with mustChangePassword = true
    const createAcc = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({
        id: 'usr-acc-01',
        username: 'acc_sami',
        fullName: 'سامي المحاسب',
        email: 'sami@company.test',
        role: 'محاسب',
        allowedCompanyIds: ['comp-01'],
        password: 'TempPassword123',
        mustChangePassword: true,
      }),
    });
    expect(createAcc.status).toBe(201);

    // Accountant logs in with temporary password
    const accLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'acc_sami', password: 'TempPassword123' }),
    });
    expect(accLogin.status).toBe(200);
    const tempSessionCookie = extractCookie(accLogin);
    const accLoginData = (await accLogin.json()) as { user: { mustChangePassword: boolean; role: string } };
    expect(accLoginData.user.role).toBe('محاسب');
    expect(accLoginData.user.mustChangePassword).toBe(true);

    // Reusing the same temporary password is rejected (400 SAME_PASSWORD_NOT_ALLOWED)
    const samePassRes = await fetch(`${srv.baseUrl}/api/auth/complete-forced-password-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tempSessionCookie },
      body: JSON.stringify({ newPassword: 'TempPassword123' }),
    });
    expect(samePassRes.status).toBe(400);
    expect(((await samePassRes.json()) as { code: string }).code).toBe('SAME_PASSWORD_NOT_ALLOWED');

    // Accountant completes forced password change with strong new password
    const completeRes = await fetch(`${srv.baseUrl}/api/auth/complete-forced-password-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: tempSessionCookie },
      body: JSON.stringify({ newPassword: 'SamiStrongPass2026' }),
    });
    expect(completeRes.status).toBe(200);
    const refreshedCookie = extractCookie(completeRes);
    const completeData = (await completeRes.json()) as {
      ok: boolean;
      revokedPreviousSessions: boolean;
      user: { mustChangePassword: boolean; sessionVersion: number };
    };
    expect(completeData.ok).toBe(true);
    expect(completeData.revokedPreviousSessions).toBe(true);
    expect(completeData.user.mustChangePassword).toBe(false);
    expect(completeData.user.sessionVersion).toBe(2);

    // Pre-change cookie is immediately revoked (401 SESSION_REVOKED)
    const staleVerify = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { Cookie: tempSessionCookie },
    });
    expect(staleVerify.status).toBe(401);
    expect(((await staleVerify.json()) as { code: string }).code).toBe('SESSION_REVOKED');

    // Refreshed cookie works on protected routes and shows mustChangePassword = false
    const newStateRes = await fetch(`${srv.baseUrl}/api/company/state`, {
      headers: { Cookie: refreshedCookie },
    });
    expect(newStateRes.status).toBe(200);

    // Calling forced change endpoint again returns 409 PASSWORD_CHANGE_NOT_REQUIRED
    const repeatRes = await fetch(`${srv.baseUrl}/api/auth/complete-forced-password-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: refreshedCookie },
      body: JSON.stringify({ newPassword: 'AnotherPass2026' }),
    });
    expect(repeatRes.status).toBe(409);

    // Old temp password fails login; new password succeeds login with mustChangePassword === false
    const oldLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'acc_sami', password: 'TempPassword123' }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'acc_sami', password: 'SamiStrongPass2026' }),
    });
    expect(newLogin.status).toBe(200);
    const newLoginData = (await newLogin.json()) as { user: { mustChangePassword: boolean } };
    expect(newLoginData.user.mustChangePassword).toBe(false);
  });

  it('5. Blocks Tenant Admin from taking over, deactivating, or resetting Super Admin password (PostgreSQL + In-Memory) and logs audit refusal', async () => {
    db = await createIsolatedStagingDb();
    srv = await startServer({ db });

    // Bootstrap Super Admin (usr-01) in comp-01
    const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-01',
        username: 'super_owner',
        fullName: 'مدير المنصة الأعلى',
        password: 'SuperOwnerPass2026',
        company: { id: 'comp-01', nameAr: 'الشركة الرئيسية' },
      }),
    });
    const superCookie = extractCookie(boot);

    // Super Admin creates a Tenant Admin in the SAME company comp-01
    const createTenantAdmin = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: superCookie },
      body: JSON.stringify({
        id: 'usr-tadmin-01',
        username: 'tenant_admin_comp01',
        fullName: 'مدير منشأة 1',
        role: 'Tenant Admin',
        allowedCompanyIds: ['comp-01'],
        password: 'TenantAdminPass2026',
      }),
    });
    expect(createTenantAdmin.status).toBe(201);

    // Tenant Admin logs in
    const taLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tenant_admin_comp01', password: 'TenantAdminPass2026' }),
    });
    expect(taLogin.status).toBe(200);
    const taCookie = extractCookie(taLogin);

    // Attack A: Tenant Admin tries to reset Super Admin password and demote role
    const attackA = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: taCookie },
      body: JSON.stringify({
        id: 'usr-01',
        username: 'super_owner',
        fullName: 'تم الاستيلاء',
        role: 'محاسب',
        active: true,
        password: 'HackedPassword999',
        allowedCompanyIds: ['comp-01'],
      }),
    });
    expect(attackA.status).toBe(403);
    expect(((await attackA.json()) as { code: string }).code).toBe('FORBIDDEN_SUPER_ADMIN_PROTECTION');

    // Attack B: Tenant Admin tries to deactivate Super Admin via /api/auth/users
    const attackB = await fetch(`${srv.baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: taCookie },
      body: JSON.stringify({
        id: 'usr-01',
        username: 'super_owner',
        fullName: 'مدير المنصة الأعلى',
        role: 'Tenant Admin',
        active: false,
        allowedCompanyIds: ['comp-01'],
      }),
    });
    expect(attackB.status).toBe(403);
    expect(((await attackB.json()) as { code: string }).code).toBe('FORBIDDEN_SUPER_ADMIN_PROTECTION');

    // Verify Super Admin account is completely untouched & original password still logs in
    const superRelogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'super_owner', password: 'SuperOwnerPass2026' }),
    });
    expect(superRelogin.status).toBe(200);
    const superData = (await superRelogin.json()) as {
      user: { isSuperAdmin: boolean; role: string; active: boolean };
    };
    expect(superData.user.isSuperAdmin).toBe(true);
    expect(superData.user.role).toBe('مالك المؤسسة');
    expect(superData.user.active).toBe(true);

    // Verify refusal was logged in PostgreSQL company_audit_logs
    const refusalLogs = await db.query<{ action: string; entity_id: string }>(
      "SELECT action, entity_id FROM company_audit_logs WHERE action = 'رفض' AND entity_id = 'usr-01'"
    );
    expect(refusalLogs.rows.length).toBeGreaterThanOrEqual(2);

    // Tenant Admin CAN still legitimately manage regular users inside comp-01
    const legitCreate = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: taCookie },
      body: JSON.stringify({
        id: 'usr-cashier-01',
        username: 'cashier_01',
        fullName: 'أمين صندوق',
        role: 'أمين الصندوق',
        allowedCompanyIds: ['comp-01'],
        password: 'CashierPass2026',
      }),
    });
    expect(legitCreate.status).toBe(201);

    // Also verify in-memory store enforces FORBIDDEN_SUPER_ADMIN_PROTECTION
    await stopServer(srv);
    const ownerHash = hashPasswordPbkdf2Server('SuperMemPass2026');
    const taHash = hashPasswordPbkdf2Server('TenantMemPass2026');
    srv = await startServer({
      initialUsers: [
        {
          id: 'usr-mem-super',
          username: 'mem_super',
          fullName: 'Super Mem',
          role: 'مالك المؤسسة',
          isSuperAdmin: true,
          allowedCompanyIds: ['comp-01'],
          branchId: 'br-01',
          active: true,
          passwordHash: ownerHash.hash,
          passwordSalt: ownerHash.salt,
          sessionVersion: 1,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'usr-mem-ta',
          username: 'mem_ta',
          fullName: 'TA Mem',
          role: 'Tenant Admin',
          isSuperAdmin: false,
          allowedCompanyIds: ['comp-01'],
          branchId: 'br-01',
          active: true,
          passwordHash: taHash.hash,
          passwordSalt: taHash.salt,
          sessionVersion: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const memTaLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mem_ta', password: 'TenantMemPass2026' }),
    });
    const memTaCookie = extractCookie(memTaLogin);
    const memAttack = await fetch(`${srv.baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: memTaCookie },
      body: JSON.stringify({
        id: 'usr-mem-super',
        username: 'mem_super',
        fullName: 'Hijacked',
        role: 'محاسب',
        password: 'HijackedPass2026',
        allowedCompanyIds: ['comp-01'],
      }),
    });
    expect(memAttack.status).toBe(403);
    expect(((await memAttack.json()) as { code: string }).code).toBe('FORBIDDEN_SUPER_ADMIN_PROTECTION');
  });

  it('6. session_version stays backward-compatible with legacy cookies (no sv) and revokes prior sessions immediately on password change, admin reset, and revoke-sessions', async () => {
    // Unit assertions for backward compatibility
    expect(isSessionVersionValid(undefined, 1)).toBe(true);
    expect(isSessionVersionValid(null, 1)).toBe(true);
    expect(isSessionVersionValid(1, 1)).toBe(true);
    expect(isSessionVersionValid(undefined, 2)).toBe(false);
    expect(isSessionVersionValid(1, 2)).toBe(false);
    expect(isSessionVersionValid(2, 2)).toBe(true);
    expect(isSessionVersionValid(0, 1)).toBe(false);

    db = await createIsolatedStagingDb();
    srv = await startServer({ db });

    const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-01',
        username: 'owner',
        fullName: 'المالك',
        password: 'OwnerPass2026',
        company: { id: 'comp-01', nameAr: 'شركة الجلسات' },
      }),
    });
    const deviceACookie = extractCookie(boot);

    // Device B logs in
    const loginB = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'OwnerPass2026' }),
    });
    const deviceBCookie = extractCookie(loginB);

    // Pre-upgrade legacy cookie WITHOUT `sv` claim
    const legacyCookie = signLegacyCookieWithoutSv({
      userId: 'usr-01',
      username: 'owner',
      role: 'مالك المؤسسة',
      isSuperAdmin: true,
      companyId: 'comp-01',
      allowedCompanyIds: ['comp-01'],
    });

    // Legacy cookie succeeds while session_version === 1
    const legacyBefore = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { Cookie: legacyCookie },
    });
    expect(legacyBefore.status).toBe(200);

    // Device A changes password -> session_version bumps to 2
    const chg = await fetch(`${srv.baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: deviceACookie },
      body: JSON.stringify({
        currentPassword: 'OwnerPass2026',
        newPassword: 'OwnerNewPass2026',
      }),
    });
    expect(chg.status).toBe(200);
    const deviceARefreshedCookie = extractCookie(chg);
    const chgBody = (await chg.json()) as {
      revokedPreviousSessions: boolean;
      user: { sessionVersion: number };
    };
    expect(chgBody.revokedPreviousSessions).toBe(true);
    expect(chgBody.user.sessionVersion).toBe(2);

    // Device A refreshed cookie works (sv=2)
    expect((await fetch(`${srv.baseUrl}/api/auth/verify`, { headers: { Cookie: deviceARefreshedCookie } })).status).toBe(200);

    // Device B cookie (sv=1) and Legacy cookie (no sv) are BOTH revoked immediately
    const devBVerify = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { Cookie: deviceBCookie },
    });
    expect(devBVerify.status).toBe(401);
    expect(((await devBVerify.json()) as { code: string }).code).toBe('SESSION_REVOKED');

    const legacyAfter = await fetch(`${srv.baseUrl}/api/auth/status`, {
      headers: { Cookie: legacyCookie },
    });
    const legacyStatus = (await legacyAfter.json()) as { authenticated: boolean; sessionRevoked: boolean };
    expect(legacyStatus.authenticated).toBe(false);
    expect(legacyStatus.sessionRevoked).toBe(true);

    // Explicit POST /api/auth/revoke-sessions (keepCurrent: true) revokes other devices while keeping caller
    const loginC = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'OwnerNewPass2026' }),
    });
    const deviceCCookie = extractCookie(loginC);

    const revokeOthers = await fetch(`${srv.baseUrl}/api/auth/revoke-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: deviceARefreshedCookie },
      body: JSON.stringify({ keepCurrent: true }),
    });
    expect(revokeOthers.status).toBe(200);
    const deviceAVersion3 = extractCookie(revokeOthers);
    expect((await fetch(`${srv.baseUrl}/api/auth/verify`, { headers: { Cookie: deviceAVersion3 } })).status).toBe(200);
    expect((await fetch(`${srv.baseUrl}/api/auth/verify`, { headers: { Cookie: deviceCCookie } })).status).toBe(401);

    // Admin resetting a regular user's password via POST /api/company/users revokes that user's active session immediately
    await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: deviceAVersion3 },
      body: JSON.stringify({
        id: 'usr-emp-01',
        username: 'emp_one',
        fullName: 'موظف مبيعات',
        role: 'مسؤول المبيعات',
        allowedCompanyIds: ['comp-01'],
        password: 'EmpInitPass2026',
      }),
    });
    const empLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'emp_one', password: 'EmpInitPass2026' }),
    });
    const empOldCookie = extractCookie(empLogin);
    expect((await fetch(`${srv.baseUrl}/api/auth/verify`, { headers: { Cookie: empOldCookie } })).status).toBe(200);

    // Owner resets emp_one's password
    const resetEmp = await fetch(`${srv.baseUrl}/api/company/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: deviceAVersion3 },
      body: JSON.stringify({
        id: 'usr-emp-01',
        username: 'emp_one',
        fullName: 'موظف مبيعات',
        role: 'مسؤول المبيعات',
        allowedCompanyIds: ['comp-01'],
        password: 'EmpResetPass2026',
        mustChangePassword: true,
      }),
    });
    expect(resetEmp.status).toBe(200);

    // emp_one's old session cookie is immediately invalidated
    const empAfterReset = await fetch(`${srv.baseUrl}/api/auth/verify`, {
      headers: { Cookie: empOldCookie },
    });
    expect(empAfterReset.status).toBe(401);
    expect(((await empAfterReset.json()) as { code: string }).code).toBe('SESSION_REVOKED');
  });
});
