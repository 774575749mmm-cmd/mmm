import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createPgliteExecutor,
  createPgPoolExecutor,
  createServerDatabaseFromEnv,
  normalizeDatabaseUrl,
  runMigrations,
  rollbackLastMigration,
  type PgExecutor,
} from '../server/db';
import { TENANT_RLS_TABLES } from '../migrations/001_multi_tenant_core';
import { createErpServerApp, ensureInitialOwnerFromEnv } from '../server/app';
import {
  hydrateErpDatabaseFromServerState,
  extractScopedCloudStatePayload,
} from '../src/services/cloudApiService';
import { evaluateLicenseBoundary } from '../src/services/licenseBoundaryService';
import { isPlatformSuperAdmin, isTenantAdminUser } from '../src/services/securityService';
import { getInitialDatabase } from '../src/services/storageService';

async function createTestPgDb(): Promise<PgExecutor> {
  const url = String(process.env.TEST_POSTGRES_URL || '').trim();
  const db = url ? createPgPoolExecutor(url) : createPgliteExecutor('memory://');
  await runMigrations(db);
  return db;
}

async function startPgTestServer(db: PgExecutor) {
  const app = createErpServerApp({
    db,
    sessionSecret: 'phase1-pg-test-secret-over-32-chars-2026!',
    rateLimits: { loginPerMinute: 200, aiPerMinute: 60, whatsappPerMinute: 60 },
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

describe('Phase 1 Cloud Multi-Tenant PostgreSQL, RLS, Tenant Admin & Company Persistence', () => {
  let db: PgExecutor | null = null;
  let srv: Awaited<ReturnType<typeof startPgTestServer>> | null = null;

  beforeEach(async () => {
    db = await createTestPgDb();
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

  describe('1. PostgreSQL Migrations, Schema Constraints & Reversible Rollback', () => {
    it('applies 001_multi_tenant_core with all tables, FKs, RLS ENABLE+FORCE, and cleanly rolls back & reapplies', async () => {
      const rls = await db!.checkRlsStatus();
      expect(rls.rlsTables.map((t) => t.table).sort()).toEqual([...TENANT_RLS_TABLES].sort());
      for (const tbl of rls.rlsTables) {
        expect(tbl.enabled).toBe(true);
        expect(tbl.forced).toBe(true);
      }

      const tablesRes = await db!.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
      const tableNames = tablesRes.rows.map((r) => r.tablename);
      for (const expected of [
        'schema_migrations',
        'companies',
        'users',
        'company_memberships',
        'company_licenses',
        'company_state',
        'company_audit_logs',
      ]) {
        expect(tableNames).toContain(expected);
      }

      // Idempotent second run applies zero duplicate migrations
      const rerun = await runMigrations(db!);
      expect(rerun).toEqual([]);

      // Reversible rollback removes tables and cleans schema_migrations
      const rolledBack = await rollbackLastMigration(db!);
      expect(rolledBack).toBe('001_multi_tenant_core');

      const afterRollbackTables = await db!.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
      );
      expect(afterRollbackTables.rows.map((r) => r.tablename)).not.toContain('company_state');

      // Re-apply cleanly
      const reapplied = await runMigrations(db!);
      expect(reapplied).toEqual(['001_multi_tenant_core']);
    });

    it('enforces real PostgreSQL Row-Level Security across company_state & company_audit_logs', async () => {
      srv = await startPgTestServer(db!);

      // Register Tenant A and Tenant B via HTTP
      const regA = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'rls_user_a',
          fullName: 'مدير ألفا',
          password: 'AlphaUser2026',
          company: { id: 'comp-rls-a', nameAr: 'شركة ألفا RLS', countryCode: 'YE', baseCurrency: 'YER' },
        }),
      });
      expect(regA.status).toBe(201);

      const regB = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'rls_user_b',
          fullName: 'مدير بيتا',
          password: 'BetaUser2026',
          company: { id: 'comp-rls-b', nameAr: 'شركة بيتا RLS', countryCode: 'SA', baseCurrency: 'SAR' },
        }),
      });
      expect(regB.status).toBe(201);

      // Transaction scoped to Company A sees ONLY Company A
      const rowsA = await db!.transaction(
        async (tx) => (await tx.query<{ company_id: string }>('SELECT company_id FROM company_state')).rows,
        { companyId: 'comp-rls-a' }
      );
      expect(rowsA.map((r) => r.company_id)).toEqual(['comp-rls-a']);

      // Transaction scoped to Company B sees ONLY Company B
      const rowsB = await db!.transaction(
        async (tx) => (await tx.query<{ company_id: string }>('SELECT company_id FROM company_state')).rows,
        { companyId: 'comp-rls-b' }
      );
      expect(rowsB.map((r) => r.company_id)).toEqual(['comp-rls-b']);

      // Transaction WITHOUT tenant session context sees 0 rows (default deny RLS)
      const rowsUnset = await db!.transaction(
        async (tx) => (await tx.query<{ company_id: string }>('SELECT company_id FROM company_state')).rows,
        {}
      );
      expect(rowsUnset).toEqual([]);

      // Direct SQL INSERT into Company B inside Company A RLS context is blocked by WITH CHECK policy
      await expect(
        db!.transaction(
          async (tx) => {
            await tx.query(
              `INSERT INTO company_audit_logs (id, company_id, actor_name, action, module, details)
               VALUES ('log-evil', 'comp-rls-b', 'attacker', 'إنشاء', 'النظام', 'cross-tenant write')`
            );
          },
          { companyId: 'comp-rls-a' }
        )
      ).rejects.toThrow();
    });
  });

  describe('2. Company Creation Persistence Across Reload (F5) & Logout/Login', () => {
    it('creates a company in PostgreSQL, survives F5 reload (status/companies/state), and survives logout/login', async () => {
      srv = await startPgTestServer(db!);

      // 1) Bootstrap initial platform owner
      const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'usr-owner',
          username: 'owner',
          fullName: 'عبد الرحمن المنصور',
          password: 'OwnerPass2026',
          company: { id: 'comp-01', nameAr: 'مؤسسة المنصور الرئيسية', countryCode: 'YE', baseCurrency: 'YER' },
        }),
      });
      expect(boot.status).toBe(201);
      const ownerCookie = extractSessionCookie(boot);
      expect(ownerCookie).toContain('erp_session=');

      // 2) Create a new company via Setup Wizard API (/api/companies)
      const createComp = await fetch(`${srv.baseUrl}/api/companies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: ownerCookie,
        },
        body: JSON.stringify({
          id: 'comp-star-sa',
          nameAr: 'شركة النجم السعودي للتجارة',
          nameEn: 'Saudi Star Trading Co',
          countryCode: 'SA',
          baseCurrency: 'SAR',
          valuationPolicy: 'PER_ITEM',
          commercialRecord: 'CR-778899',
          taxNumber: '310123456700003',
        }),
      });
      expect(createComp.status).toBe(201);
      const createData = await createComp.json();
      expect(createData.ok).toBe(true);
      expect(createData.company.id).toBe('comp-star-sa');
      expect(createData.activeCompanyId).toBe('comp-star-sa');
      expect(createData.companies.map((c: { id: string }) => c.id)).toEqual(['comp-01', 'comp-star-sa']);

      const updatedCookie = extractSessionCookie(createComp) || ownerCookie;

      // 3) Simulate page reload (F5): status + companies + state
      const statusAfterReload = await fetch(`${srv.baseUrl}/api/auth/status`, {
        headers: { Cookie: updatedCookie },
      });
      expect(statusAfterReload.status).toBe(200);
      const statusJson = await statusAfterReload.json();
      expect(statusJson.authenticated).toBe(true);
      expect(statusJson.activeCompanyId).toBe('comp-star-sa');
      expect(statusJson.companies.map((c: { id: string }) => c.id)).toContain('comp-star-sa');

      const stateAfterReload = await fetch(`${srv.baseUrl}/api/company/state`, {
        headers: { Cookie: updatedCookie },
      });
      expect(stateAfterReload.status).toBe(200);
      const stateJson = await stateAfterReload.json();
      expect(stateJson.companyId).toBe('comp-star-sa');
      expect(stateJson.company.nameAr).toBe('شركة النجم السعودي للتجارة');
      expect(stateJson.company.baseCurrency).toBe('SAR');

      // 4) Logout and Login again — new company and active selection persist from PostgreSQL
      const logoutResp = await fetch(`${srv.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: updatedCookie },
      });
      expect(logoutResp.status).toBe(200);

      const reloginResp = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'owner', password: 'OwnerPass2026' }),
      });
      expect(reloginResp.status).toBe(200);
      const reloginJson = await reloginResp.json();
      expect(reloginJson.activeCompanyId).toBe('comp-star-sa');
      expect(reloginJson.companies.map((c: { id: string }) => c.id)).toEqual(['comp-01', 'comp-star-sa']);
    });
  });

  describe('3. Strict Multi-Tenant Account Isolation, Cross-Tenant Tamper Blocking & Optimistic Concurrency', () => {
    it('isolates Account A and Account B completely, blocks comp-01 leakage, cross-tenant API/payload spoofing, and revision conflicts', async () => {
      srv = await startPgTestServer(db!);

      // Bootstrap comp-01 first
      await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'super_root',
          fullName: 'مدير المنصة',
          password: 'RootPassword2026',
          company: { id: 'comp-01', nameAr: 'شركة المنصة الافتراضية' },
        }),
      });

      // Register Tenant A + Company A
      const regA = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'tenant_a',
          fullName: 'أحمد ألفا',
          password: 'TenantAPass2026',
          company: { id: 'comp-alpha', nameAr: 'مؤسسة ألفا المستقلة', countryCode: 'YE', baseCurrency: 'YER' },
        }),
      });
      expect(regA.status).toBe(201);
      const cookieA = extractSessionCookie(regA);

      // Register Tenant B + Company B
      const regB = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'tenant_b',
          fullName: 'خالد بيتا',
          password: 'TenantBPass2026',
          company: { id: 'comp-beta', nameAr: 'مؤسسة بيتا المستقلة', countryCode: 'AE', baseCurrency: 'AED' },
        }),
      });
      expect(regB.status).toBe(201);
      const cookieB = extractSessionCookie(regB);

      // Account A's company list NEVER contains comp-01 or comp-beta
      const listA = await fetch(`${srv.baseUrl}/api/companies`, {
        headers: { Cookie: cookieA },
      });
      const listAJson = await listA.json();
      expect(listA.status).toBe(200);
      expect(listAJson.companies.map((c: { id: string }) => c.id)).toEqual(['comp-alpha']);

      // Account A (non-Super-Admin) attempting to switch companies -> 403 FORBIDDEN_SUPER_ADMIN_ONLY
      const evilSwitch = await fetch(`${srv.baseUrl}/api/companies/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({ companyId: 'comp-beta' }),
      });
      expect(evilSwitch.status).toBe(403);
      expect((await evilSwitch.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      // Account A attempting to read Company B via ?companyId= or x-company-id header -> 403
      const evilQueryRead = await fetch(`${srv.baseUrl}/api/company/state?companyId=comp-beta`, {
        headers: { Cookie: cookieA },
      });
      expect(evilQueryRead.status).toBe(403);

      const evilHeaderRead = await fetch(`${srv.baseUrl}/api/company/state`, {
        headers: { Cookie: cookieA, 'x-company-id': 'comp-beta' },
      });
      expect(evilHeaderRead.status).toBe(403);

      // Account A attempting to overwrite Company B via PUT body spoofing or nested invoice.companyId tampering -> 403
      const evilPutTop = await fetch(`${srv.baseUrl}/api/company/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({
          companyId: 'comp-beta',
          state: { company: { id: 'comp-beta' } },
        }),
      });
      expect(evilPutTop.status).toBe(403);

      const evilPutNested = await fetch(`${srv.baseUrl}/api/company/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({
          companyId: 'comp-alpha',
          state: {
            company: { id: 'comp-alpha' },
            activeCompanyId: 'comp-alpha',
            invoices: [{ id: 'inv-tamper', companyId: 'comp-beta', total: 999 }],
          },
        }),
      });
      expect(evilPutNested.status).toBe(403);
      expect((await evilPutNested.json()).code).toBe('TENANT_ISOLATION_VIOLATION');

      // Account A legitimately saves operational state & reloads
      const stateAResp = await fetch(`${srv.baseUrl}/api/company/state`, { headers: { Cookie: cookieA } });
      const stateASnapshot = await stateAResp.json();
      const hydratedA = hydrateErpDatabaseFromServerState(stateASnapshot);

      // Clean isolated hydration must contain zero comp-01 sample records
      expect(hydratedA.company.id).toBe('comp-alpha');
      expect(hydratedA.customers).toEqual([]);
      expect(hydratedA.invoices).toEqual([]);
      expect(hydratedA.journalEntries).toEqual([]);
      expect(hydratedA.chartOfAccounts.every((acc) => acc.currentBalance === 0)).toBe(true);

      const modifiedA = {
        ...hydratedA,
        customers: [
          {
            id: 'cust-alpha-1',
            companyId: 'comp-alpha',
            branchId: hydratedA.branches[0]?.id || 'br-comp-alpha',
            code: 'CUST-A-01',
            nameAr: 'عميل ألفا الرسمي',
            phone: '777000111',
            regionalAreaId: 'area-01',
            addressDetails: 'صنعاء',
            category: 'تجاري' as const,
            creditLimit: 50000,
            paymentTermDays: 30,
            openingBalance: 0,
            currentBalance: 1500,
            status: 'active' as const,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const saveA = await fetch(`${srv.baseUrl}/api/company/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({
          companyId: 'comp-alpha',
          expectedRevision: stateASnapshot.revision,
          state: extractScopedCloudStatePayload(modifiedA, 'comp-alpha'),
        }),
      });
      expect(saveA.status).toBe(200);
      const saveAJson = await saveA.json();
      expect(saveAJson.revision).toBe(stateASnapshot.revision + 1);

      // Stale revision write produces 409 conflict
      const staleSave = await fetch(`${srv.baseUrl}/api/company/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieA },
        body: JSON.stringify({
          companyId: 'comp-alpha',
          expectedRevision: 1,
          state: extractScopedCloudStatePayload(modifiedA, 'comp-alpha'),
        }),
      });
      expect(staleSave.status).toBe(409);

      // Reload Account A verifies persisted customer; Account B sees empty customers
      const reloadA = await (
        await fetch(`${srv.baseUrl}/api/company/state`, { headers: { Cookie: cookieA } })
      ).json();
      expect(reloadA.state.customers.length).toBe(1);
      expect(reloadA.state.customers[0].nameAr).toBe('عميل ألفا الرسمي');

      const stateB = await (
        await fetch(`${srv.baseUrl}/api/company/state`, { headers: { Cookie: cookieB } })
      ).json();
      expect(stateB.companyId).toBe('comp-beta');
      expect(stateB.state.customers).toEqual([]);
    });
  });

  describe('4. Tenant Admin RBAC vs Super Admin Isolation & Non-Blocking License Boundary', () => {
    it('allows Tenant Admin full user/permission control within own company, blocks Super Admin escalation & platform endpoints', async () => {
      srv = await startPgTestServer(db!);

      const boot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'super_admin',
          fullName: 'مدير المنصة المركزي',
          password: 'SuperAdmin2026',
          company: { id: 'comp-01', nameAr: 'شركة المنصة' },
        }),
      });
      const superCookie = extractSessionCookie(boot);

      // Register Tenant A and Tenant B
      const regA = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin_a',
          fullName: 'مدير منشأة ألفا',
          password: 'TenantAdminA2026',
          company: { id: 'comp-ta', nameAr: 'منشأة ألفا' },
        }),
      });
      const cookieAdminA = extractSessionCookie(regA);

      const regB = await fetch(`${srv.baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin_b',
          fullName: 'مدير منشأة بيتا',
          password: 'TenantAdminB2026',
          company: { id: 'comp-tb', nameAr: 'منشأة بيتا' },
        }),
      });
      const regBJson = await regB.json();
      const cookieAdminB = extractSessionCookie(regB);
      expect(regBJson.user.role).toBe('Tenant Admin');
      expect(regBJson.user.isSuperAdmin).toBe(false);

      // Tenant Admin B creates a cashier/accountant user strictly inside Company B
      const createUserB = await fetch(`${srv.baseUrl}/api/company/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({
          id: 'usr-acc-tb',
          username: 'acc_beta',
          fullName: 'محاسب بيتا',
          role: 'محاسب',
          password: 'AccBeta2026',
          branchId: 'br-comp-tb',
          allowedCompanyIds: ['comp-tb'],
        }),
      });
      expect(createUserB.status).toBe(201);

      // Newly created user in Company B can log in immediately on server
      const loginAccB = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'acc_beta', password: 'AccBeta2026' }),
      });
      expect(loginAccB.status).toBe(200);
      const loginAccBJson = await loginAccB.json();
      expect(loginAccBJson.activeCompanyId).toBe('comp-tb');
      expect(loginAccBJson.user.allowedCompanyIds).toEqual(['comp-tb']);

      // Tenant Admin B cannot escalate to Super Admin -> 403
      const escalate = await fetch(`${srv.baseUrl}/api/company/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({
          id: 'usr-evil-super',
          username: 'evil_super',
          fullName: 'متسلل',
          role: 'مدير النظام',
          isSuperAdmin: true,
          password: 'EvilSuper2026',
        }),
      });
      expect(escalate.status).toBe(403);
      expect((await escalate.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ESCALATION');

      // Tenant Admin B cannot assign user to Company A -> 403
      const crossCompanyAssign = await fetch(`${srv.baseUrl}/api/company/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({
          id: 'usr-cross',
          username: 'cross_user',
          fullName: 'مستخدم مخالف',
          role: 'محاسب',
          password: 'CrossUser2026',
          allowedCompanyIds: ['comp-ta'],
        }),
      });
      expect(crossCompanyAssign.status).toBe(403);
      expect((await crossCompanyAssign.json()).code).toBe('TENANT_ISOLATION_VIOLATION');

      // Tenant Admin B cannot access Super Admin /api/admin/overview or /api/admin/companies -> 403
      const forbiddenOverview = await fetch(`${srv.baseUrl}/api/admin/overview`, {
        headers: { Cookie: cookieAdminB },
      });
      expect(forbiddenOverview.status).toBe(403);
      expect((await forbiddenOverview.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      const forbiddenAdminCompanies = await fetch(`${srv.baseUrl}/api/admin/companies`, {
        headers: { Cookie: cookieAdminA },
      });
      expect(forbiddenAdminCompanies.status).toBe(403);

      // Verify users.company_id is populated in PostgreSQL for owner, registered Tenant Admins & created sub-users
      const userCidRows = await db!.transaction(
        async (tx) =>
          (
            await tx.query<{ username: string; company_id: string | null }>(
              'SELECT username, company_id FROM users ORDER BY username ASC'
            )
          ).rows,
        { bypassRls: true }
      );
      expect(userCidRows).toEqual([
        { username: 'acc_beta', company_id: 'comp-tb' },
        { username: 'admin_a', company_id: 'comp-ta' },
        { username: 'admin_b', company_id: 'comp-tb' },
        { username: 'super_admin', company_id: 'comp-01' },
      ]);

      // Tenant Admin B gets 403 FORBIDDEN_SUPER_ADMIN_ONLY on creating/switching companies or changing subscription status
      const forbiddenCreateComp = await fetch(`${srv.baseUrl}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({ nameAr: 'شركة مرفوضة' }),
      });
      expect(forbiddenCreateComp.status).toBe(403);
      expect((await forbiddenCreateComp.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      const forbiddenSwitchComp = await fetch(`${srv.baseUrl}/api/companies/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({ companyId: 'comp-ta' }),
      });
      expect(forbiddenSwitchComp.status).toBe(403);
      expect((await forbiddenSwitchComp.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      const forbiddenStatusChange = await fetch(`${srv.baseUrl}/api/companies/comp-tb/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(forbiddenStatusChange.status).toBe(403);
      expect((await forbiddenStatusChange.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      // Tenant Admin B CAN update own company profile via PUT /api/companies/:id and persists across reload/relogin
      const ownCompanyUpdate = await fetch(`${srv.baseUrl}/api/companies/comp-tb`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({
          nameAr: 'منشأة بيتا المحدثة في PostgreSQL',
          taxNumber: '310999888700003',
        }),
      });
      expect(ownCompanyUpdate.status).toBe(200);
      const ownUpdatedJson = await ownCompanyUpdate.json();
      expect(ownUpdatedJson.company.nameAr).toBe('منشأة بيتا المحدثة في PostgreSQL');
      expect(ownUpdatedJson.company.taxNumber).toBe('310999888700003');

      const stateAfterCompanyUpdate = await (
        await fetch(`${srv.baseUrl}/api/company/state`, { headers: { Cookie: cookieAdminB } })
      ).json();
      expect(stateAfterCompanyUpdate.company.nameAr).toBe('منشأة بيتا المحدثة في PostgreSQL');

      // Tenant Admin B CANNOT update another company (403 TENANT_ISOLATION_VIOLATION) or alter own status (403)
      const crossCompanyUpdate = await fetch(`${srv.baseUrl}/api/companies/comp-ta`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({ nameAr: 'تعديل غير مصرح' }),
      });
      expect(crossCompanyUpdate.status).toBe(403);
      expect((await crossCompanyUpdate.json()).code).toBe('TENANT_ISOLATION_VIOLATION');

      const selfStatusTamper = await fetch(`${srv.baseUrl}/api/companies/comp-tb`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookieAdminB },
        body: JSON.stringify({ nameAr: 'محاولة تغيير الحالة', status: 'suspended' }),
      });
      expect(selfStatusTamper.status).toBe(403);
      expect((await selfStatusTamper.json()).code).toBe('FORBIDDEN_SUPER_ADMIN_ONLY');

      // Super Admin accesses /api/admin/overview -> 200 OK and toggles subscription status -> 200 OK
      const okOverview = await fetch(`${srv.baseUrl}/api/admin/overview`, {
        headers: { Cookie: superCookie },
      });
      expect(okOverview.status).toBe(200);
      const okOverviewJson = await okOverview.json();
      expect(okOverviewJson.totalCompanies).toBe(3);

      const superSuspendBeta = await fetch(`${srv.baseUrl}/api/companies/comp-tb/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superCookie },
        body: JSON.stringify({ status: 'suspended' }),
      });
      expect(superSuspendBeta.status).toBe(200);
      expect((await superSuspendBeta.json()).company.status).toBe('suspended');

      const superReactivateBeta = await fetch(`${srv.baseUrl}/api/companies/comp-tb/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: superCookie },
        body: JSON.stringify({ status: 'active' }),
      });
      expect(superReactivateBeta.status).toBe(200);
      expect((await superReactivateBeta.json()).company.status).toBe('active');

      // Frontend RBAC helper guarantees switcher hiding for Tenant Admin vs visibility for Super Admin
      expect(isPlatformSuperAdmin(regBJson.user)).toBe(false);
      expect(isTenantAdminUser(regBJson.user)).toBe(true);
      expect(isPlatformSuperAdmin({ role: 'مالك المؤسسة', isSuperAdmin: true })).toBe(true);
      expect(isPlatformSuperAdmin({ role: 'مالك المؤسسة' })).toBe(true);
      expect(isPlatformSuperAdmin({ role: 'مدير النظام', isSuperAdmin: false })).toBe(false);

      // Non-blocking license boundary verification (Phase 1 never blocks operations)
      const evalLic = evaluateLicenseBoundary({ companyId: 'comp-tb', status: 'expired_readonly', licenseMode: 'trial' });
      expect(evalLic.allowed).toBe(true);
      expect(evalLic.readOnly).toBe(false);
      expect(evalLic.enforced).toBe(false);

      // Confirm local seed helper remains untouched for default local mode
      const localInit = getInitialDatabase();
      expect(localInit.company.id).toBe('comp-01');
    });

    it('normalizes Neon psql strings, rejects base/placeholder DATABASE_URL, and boots cleanly without ENOTFOUND base crash', async () => {
      expect(normalizeDatabaseUrl("psql 'postgresql://u:p@ep-test.neon.tech/neondb?sslmode=require'")).toBe(
        'postgresql://u:p@ep-test.neon.tech/neondb?sslmode=require'
      );
      expect(normalizeDatabaseUrl('"postgresql://u:p@ep-test.neon.tech/neondb"')).toBe(
        'postgresql://u:p@ep-test.neon.tech/neondb'
      );
      expect(normalizeDatabaseUrl('base')).toBeNull();
      expect(normalizeDatabaseUrl('postgresql://u:p@base/db')).toBeNull();
      expect(normalizeDatabaseUrl('MY_DATABASE_URL')).toBeNull();

      const prevUrl = process.env.DATABASE_URL;
      const prevDir = process.env.ERP_PGLITE_DIR;
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.DATABASE_URL = "psql 'postgresql://u:p@base/db'";
        process.env.ERP_PGLITE_DIR = 'memory://';
        const fallbackDb = await createServerDatabaseFromEnv();
        expect(fallbackDb.dialect).toBe('pglite');
        await fallbackDb.close();

        // In production mode, missing or unreachable DATABASE_URL MUST fail closed (never fall back to PGlite)
        process.env.NODE_ENV = 'production';
        delete process.env.DATABASE_URL;
        await expect(createServerDatabaseFromEnv()).rejects.toThrow(/DATABASE_URL is required/i);

        process.env.DATABASE_URL = 'postgresql://user:pass@nonexistent.neon.invalid/neondb?sslmode=require';
        await expect(createServerDatabaseFromEnv()).rejects.toThrow();
      } finally {
        if (prevUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevUrl;
        if (prevDir === undefined) delete process.env.ERP_PGLITE_DIR;
        else process.env.ERP_PGLITE_DIR = prevDir;
        if (prevEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('5. Staging Auth Initialization, Env Bootstrap & Restricted RLS Role', () => {
    it('reproduces authInitialized:false on fresh Staging DB, initializes securely via ERP_BOOTSTRAP_ADMIN_PASSWORD without SUPERUSER/BYPASSRLS, preserves existing DBs, and sets Secure cookie behind HTTPS proxy', async () => {
      const prevNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'staging';
      try {
        srv = await startPgTestServer(db!);

        // 1. Fresh Staging DB after migrations has RLS active & restricted app role, 0 users -> authInitialized: false
        const healthBeforeResp = await fetch(`${srv.baseUrl}/api/health`);
        expect(healthBeforeResp.status).toBe(200);
        const healthBefore = await healthBeforeResp.json();
        expect(healthBefore.ok).toBe(true);
        expect(healthBefore.rlsReady).toBe(true);
        expect(healthBefore.rlsRoleRestricted).toBe(true);
        expect(healthBefore.authInitialized).toBe(false);

        const statusBeforeResp = await fetch(`${srv.baseUrl}/api/auth/status`);
        expect(statusBeforeResp.status).toBe(200);
        const statusBefore = await statusBeforeResp.json();
        expect(statusBefore.initialized).toBe(false);
        expect(statusBefore.authenticated).toBe(false);

        // 2. Without ERP_BOOTSTRAP_ADMIN_PASSWORD, ensureInitialOwnerFromEnv MUST NOT seed dummy/hardcoded users
        const noEnvRes = await ensureInitialOwnerFromEnv(db!, { NODE_ENV: 'staging' });
        expect(noEnvRes).toEqual({ bootstrapped: false, reason: 'env_password_not_configured' });

        // 3. Weak env password MUST fail policy validation
        await expect(
          ensureInitialOwnerFromEnv(db!, {
            NODE_ENV: 'staging',
            ERP_BOOTSTRAP_ADMIN_PASSWORD: 'weak',
          })
        ).rejects.toThrow(/password strength policy/i);

        // 4. Valid env password initializes Staging owner with PBKDF2-SHA256 & restricted RLS role
        const strongStagingPass = 'StgAdmin#2026!Secure';
        const initRes = await ensureInitialOwnerFromEnv(db!, {
          NODE_ENV: 'staging',
          ERP_BOOTSTRAP_ADMIN_USERNAME: 'stg_owner',
          ERP_BOOTSTRAP_ADMIN_PASSWORD: strongStagingPass,
          ERP_BOOTSTRAP_ADMIN_NAME: 'مدير بيئة Staging',
          ERP_BOOTSTRAP_COMPANY_NAME: 'شركة المنصور Staging',
        });
        expect(initRes.bootstrapped).toBe(true);
        expect(initRes.username).toBe('stg_owner');

        // Confirm restricted erp_app_role NEVER received SUPERUSER or BYPASSRLS
        const roleCheck = await db!.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
          "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'erp_app_role'"
        );
        expect(roleCheck.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

        // 5. Health and auth status now report authInitialized: true / initialized: true
        const healthAfterResp = await fetch(`${srv.baseUrl}/api/health`);
        expect(healthAfterResp.status).toBe(200);
        const healthAfter = await healthAfterResp.json();
        expect(healthAfter.rlsReady).toBe(true);
        expect(healthAfter.rlsRoleRestricted).toBe(true);
        expect(healthAfter.authInitialized).toBe(true);

        const statusAfterInitResp = await fetch(`${srv.baseUrl}/api/auth/status`);
        expect(statusAfterInitResp.status).toBe(200);
        const statusAfterInit = await statusAfterInitResp.json();
        expect(statusAfterInit.initialized).toBe(true);
        expect(statusAfterInit.authenticated).toBe(false);

        // 6. Idempotency / Production protection: re-running ensureInitialOwnerFromEnv NEVER overwrites existing users
        const rerunRes = await ensureInitialOwnerFromEnv(db!, {
          NODE_ENV: 'staging',
          ERP_BOOTSTRAP_ADMIN_USERNAME: 'other_admin',
          ERP_BOOTSTRAP_ADMIN_PASSWORD: 'Another#Strong2026!Pass',
        });
        expect(rerunRes).toEqual({ bootstrapped: false, reason: 'already_initialized' });

        // 7. Login behind simulated multi-hop HTTPS reverse proxy sets HttpOnly + SameSite=Lax + Secure cookie
        const loginResp = await fetch(`${srv.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-Proto': 'https, http',
          },
          body: JSON.stringify({
            username: 'stg_owner',
            password: strongStagingPass,
          }),
        });
        expect(loginResp.status).toBe(200);
        const rawSetCookie = loginResp.headers.get('set-cookie') || '';
        expect(rawSetCookie).toContain('HttpOnly');
        expect(rawSetCookie).toContain('SameSite=Lax');
        expect(rawSetCookie).toContain('Secure');

        const cookie = extractSessionCookie(loginResp);
        const verifyResp = await fetch(`${srv.baseUrl}/api/auth/verify`, {
          headers: { Cookie: cookie },
        });
        expect(verifyResp.status).toBe(200);
        const verifyJson = await verifyResp.json();
        expect(verifyJson.ok).toBe(true);
        expect(verifyJson.user.username).toBe('stg_owner');

        const statusAuthResp = await fetch(`${srv.baseUrl}/api/auth/status`, {
          headers: { Cookie: cookie },
        });
        expect(statusAuthResp.status).toBe(200);
        const statusAuth = await statusAuthResp.json();
        expect(statusAuth.initialized).toBe(true);
        expect(statusAuth.authenticated).toBe(true);
      } finally {
        if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNodeEnv;
      }
    });
  });
});
