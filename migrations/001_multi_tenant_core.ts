/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - PostgreSQL Multi-Tenant Core Migration (Reversible)
 * Supports Neon PostgreSQL (DATABASE_URL) & PGlite (PostgreSQL 18 WASM for local/CI verification)
 */

export interface SqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
}

export interface MigrationDefinition {
  id: string;
  description: string;
  up: (exec: SqlExecutor) => Promise<void>;
  down: (exec: SqlExecutor) => Promise<void>;
}

export const TENANT_RLS_TABLES = [
  'companies',
  'company_memberships',
  'company_licenses',
  'company_state',
  'company_audit_logs',
] as const;

export const migration001MultiTenantCore: MigrationDefinition = {
  id: '001_multi_tenant_core',
  description:
    'Create core multi-tenant tables (companies, users, company_memberships, company_licenses, company_state, company_audit_logs) with foreign keys, indexes, and PostgreSQL Row-Level Security.',
  async up(exec: SqlExecutor): Promise<void> {
    await exec.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL DEFAULT '',
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY,
        name_ar TEXT NOT NULL,
        name_en TEXT NOT NULL DEFAULT '',
        country_code TEXT NOT NULL DEFAULT 'YE',
        base_currency TEXT NOT NULL DEFAULT 'YER',
        valuation_policy TEXT NOT NULL DEFAULT 'PER_ITEM',
        commercial_record TEXT NOT NULL DEFAULT '',
        tax_number TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        fiscal_year_start TEXT NOT NULL DEFAULT '2026-01-01',
        status TEXT NOT NULL DEFAULT 'active',
        created_by_user_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL,
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        branch_id TEXT NOT NULL DEFAULT 'br-01',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        last_active_company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
        flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;
      UPDATE users SET company_id = COALESCE(company_id, last_active_company_id) WHERE company_id IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
        ON users (LOWER(username));

      CREATE TABLE IF NOT EXISTS company_memberships (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        branch_id TEXT NOT NULL DEFAULT 'br-01',
        permission_matrix JSONB NOT NULL DEFAULT '{}'::jsonb,
        flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, company_id)
      );

      CREATE INDEX IF NOT EXISTS idx_company_memberships_company_id
        ON company_memberships (company_id, is_active);

      CREATE TABLE IF NOT EXISTS company_licenses (
        company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        license_mode TEXT NOT NULL DEFAULT 'unrestricted',
        status TEXT NOT NULL DEFAULT 'active',
        plan_code TEXT NOT NULL DEFAULT 'standard',
        trial_ends_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        max_users INTEGER,
        hardware_fingerprint TEXT,
        offline_signature TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS company_state (
        company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        schema_version TEXT NOT NULL DEFAULT '3.0.0',
        revision INTEGER NOT NULL DEFAULT 1,
        company_profile JSONB NOT NULL,
        state_json JSONB NOT NULL,
        updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS company_audit_logs (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        actor_name TEXT NOT NULL,
        action TEXT NOT NULL,
        module TEXT NOT NULL,
        details TEXT NOT NULL,
        entity_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_company_audit_logs_company_created
        ON company_audit_logs (company_id, created_at DESC);
    `);

    // Create dedicated non-superuser runtime role when database privileges allow it (for RLS enforcement even when migrations run as superuser)
    await exec.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app_role') THEN
          CREATE ROLE erp_app_role NOSUPERUSER NOBYPASSRLS NOLOGIN;
        END IF;
      EXCEPTION
        WHEN insufficient_privilege THEN
          NULL;
      END $$;

      DO $$
      BEGIN
        GRANT USAGE ON SCHEMA public TO erp_app_role;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
          schema_migrations,
          companies,
          users,
          company_memberships,
          company_licenses,
          company_state,
          company_audit_logs
        TO erp_app_role;
      EXCEPTION
        WHEN undefined_object OR insufficient_privilege THEN
          NULL;
      END $$;
    `);

    // Enable & Force PostgreSQL Row-Level Security (fail-closed when app.current_company_id / app.current_user_id are unset)
    await exec.exec(`
      ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
      ALTER TABLE companies FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_companies ON companies;
      CREATE POLICY tenant_isolation_companies ON companies
        USING (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND id = NULLIF(current_setting('app.current_company_id', true), '')
          )
          OR (
            NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM company_memberships m
              WHERE m.company_id = companies.id
                AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')
                AND m.is_active = TRUE
            )
          )
        )
        WITH CHECK (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND id = NULLIF(current_setting('app.current_company_id', true), '')
          )
          OR (
            NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
            AND created_by_user_id = NULLIF(current_setting('app.current_user_id', true), '')
          )
        );

      ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
      ALTER TABLE company_memberships FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_company_memberships ON company_memberships;
      CREATE POLICY tenant_isolation_company_memberships ON company_memberships
        USING (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
          OR (
            NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
            AND user_id = NULLIF(current_setting('app.current_user_id', true), '')
          )
        )
        WITH CHECK (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        );

      ALTER TABLE company_licenses ENABLE ROW LEVEL SECURITY;
      ALTER TABLE company_licenses FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_company_licenses ON company_licenses;
      CREATE POLICY tenant_isolation_company_licenses ON company_licenses
        USING (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        )
        WITH CHECK (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        );

      ALTER TABLE company_state ENABLE ROW LEVEL SECURITY;
      ALTER TABLE company_state FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_company_state ON company_state;
      CREATE POLICY tenant_isolation_company_state ON company_state
        USING (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        )
        WITH CHECK (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        );

      ALTER TABLE company_audit_logs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE company_audit_logs FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS tenant_isolation_company_audit_logs ON company_audit_logs;
      CREATE POLICY tenant_isolation_company_audit_logs ON company_audit_logs
        USING (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        )
        WITH CHECK (
          NULLIF(current_setting('app.bypass_tenant_rls', true), '') = 'true'
          OR (
            NULLIF(current_setting('app.current_company_id', true), '') IS NOT NULL
            AND company_id = NULLIF(current_setting('app.current_company_id', true), '')
          )
        );
    `);
  },

  async down(exec: SqlExecutor): Promise<void> {
    await exec.exec(`
      DROP POLICY IF EXISTS tenant_isolation_company_audit_logs ON company_audit_logs;
      DROP POLICY IF EXISTS tenant_isolation_company_state ON company_state;
      DROP POLICY IF EXISTS tenant_isolation_company_licenses ON company_licenses;
      DROP POLICY IF EXISTS tenant_isolation_company_memberships ON company_memberships;
      DROP POLICY IF EXISTS tenant_isolation_companies ON companies;

      DROP TABLE IF EXISTS company_audit_logs;
      DROP TABLE IF EXISTS company_state;
      DROP TABLE IF EXISTS company_licenses;
      DROP TABLE IF EXISTS company_memberships;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS companies;
    `);
  },
};

export const ALL_MIGRATIONS: MigrationDefinition[] = [migration001MultiTenantCore];
