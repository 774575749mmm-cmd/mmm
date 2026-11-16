import http from 'node:http';
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateSaltHex,
  hashPasswordAsync,
  hashPasswordSync,
  verifyPasswordAsync,
  verifyPasswordSync,
  verifyPasswordWithMigrationAsync,
  validatePasswordStrength,
} from '../src/services/securityService';
import {
  createErpServerApp,
  hashPasswordPbkdf2Server,
  resolveSessionSecret,
  validateWhatsAppTarget,
} from '../server/app';
import type { User } from '../src/types/erp';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr-test',
    username: 'tester',
    fullName: 'مستخدم اختبار',
    role: 'محاسب',
    branchId: 'br-01',
    allowedCompanyIds: ['comp-01'],
    email: 'tester@almansoor.erp',
    active: true,
    canViewReports: true,
    canPostEntries: true,
    canAdjustInventory: false,
    canViewCostsAndProfits: false,
    canManageSettings: false,
    ...overrides,
  };
}

async function startTestServer(options: Parameters<typeof createErpServerApp>[0] = {}) {
  const app = createErpServerApp({
    inMemoryAuthStore: true,
    sessionSecret: 'test-session-secret-with-more-than-32-chars!!',
    ...options,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe('Stage P0-A: Password Hashing, Auth Enforcement, Sessions & SSRF Guard', () => {
  describe('Cryptographic Password Hashing & Migration (securityService)', () => {
    it('hashes passwords with PBKDF2-SHA256 >= 210,000 iterations and 16-byte salts', async () => {
      const salt = generateSaltHex();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      const hash = await hashPasswordAsync('Almansoor#2026', salt);
      expect(hash).toMatch(/^v4pbkdf2\$210000\$[0-9a-f]{64}$/);

      const user = makeUser({ passwordSalt: salt, passwordHash: hash });
      expect(await verifyPasswordAsync(user, 'Almansoor#2026')).toBe(true);
      expect(await verifyPasswordAsync(user, 'WrongPass123')).toBe(false);
    });

    it('strictly rejects users without passwordHash or passwordSalt (no empty-hash bypass)', async () => {
      const unhashedUser = makeUser({ passwordHash: undefined, passwordSalt: undefined });
      expect(verifyPasswordSync(unhashedUser, '123')).toBe(false);
      expect(verifyPasswordSync(unhashedUser, 'admin')).toBe(false);
      expect(await verifyPasswordAsync(unhashedUser, 'admin')).toBe(false);
    });

    it('verifies and transparently upgrades legacy v3sync$ and v3sha256$ hashes to PBKDF2-SHA256', async () => {
      const legacySalt = 'a1b2c3d4e5f6a1b2c3d4e5f6';
      const legacySyncHash = hashPasswordSync('Pass1234', legacySalt);
      const legacyUser = makeUser({ passwordSalt: legacySalt, passwordHash: legacySyncHash });

      const migration = await verifyPasswordWithMigrationAsync(legacyUser, 'Pass1234');
      expect(migration.ok).toBe(true);
      expect(migration.upgradedHash).toMatch(/^v4pbkdf2\$210000\$[0-9a-f]{64}$/);
      expect(migration.upgradedSalt).toMatch(/^[0-9a-f]{32}$/);

      // Ensure upgraded credentials verify properly
      const upgradedUser = makeUser({
        passwordSalt: migration.upgradedSalt,
        passwordHash: migration.upgradedHash,
      });
      expect(await verifyPasswordAsync(upgradedUser, 'Pass1234')).toBe(true);
      expect(await verifyPasswordAsync(upgradedUser, 'Wrong1234')).toBe(false);
    });

    it('enforces password strength rules', () => {
      expect(validatePasswordStrength('1234567').ok).toBe(false);
      expect(validatePasswordStrength('onlyletters').ok).toBe(false);
      expect(validatePasswordStrength('123456789').ok).toBe(false);
      expect(validatePasswordStrength('ErpPass2026').ok).toBe(true);
    });
  });

  describe('Server Session Secret & Express Security', () => {
    let srv: Awaited<ReturnType<typeof startTestServer>> | null = null;

    afterEach(async () => {
      if (srv) {
        await srv.close();
        srv = null;
      }
    });

    it('throws in production when ERP_SESSION_SECRET is missing or < 32 chars', () => {
      expect(() => resolveSessionSecret({ envSecret: '', isProduction: true })).toThrow();
      expect(() => resolveSessionSecret({ envSecret: 'short-secret', isProduction: true })).toThrow();
      expect(
        resolveSessionSecret({
          envSecret: 'valid-production-session-secret-length-over-32-chars',
          isProduction: true,
        })
      ).toBe('valid-production-session-secret-length-over-32-chars');
    });

    it('disables passwordless /api/auth/session minting and requires real credentials on /api/auth/login', async () => {
      srv = await startTestServer();
      const disabledResp = await fetch(`${srv.baseUrl}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-01', role: 'مالك المؤسسة' }),
      });
      expect(disabledResp.status).toBe(410);

      // Bootstrap owner
      const bootResp = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'usr-01',
          username: 'admin',
          fullName: 'عبد الرحمن المنصور',
          password: 'OwnerStrong2026',
          allowedCompanyIds: ['comp-01'],
        }),
      });
      expect(bootResp.status).toBe(201);
      const setCookie = bootResp.headers.get('set-cookie') || '';
      expect(setCookie).toContain('erp_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const bootBody = await bootResp.json();
      expect(bootBody.ok).toBe(true);
      expect(bootBody.user.passwordHash).toBeUndefined();
      expect(bootBody.user.passwordSalt).toBeUndefined();

      // Second bootstrap attempt must fail
      const secondBoot = await fetch(`${srv.baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'attacker', password: 'Attacker2026' }),
      });
      expect(secondBoot.status).toBe(403);

      // Login with wrong password must fail
      const badLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'WrongPassword99' }),
      });
      expect(badLogin.status).toBe(401);

      // Login with valid password succeeds & returns HttpOnly cookie
      const goodLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'OwnerStrong2026' }),
      });
      expect(goodLogin.status).toBe(200);
      const loginCookie = (goodLogin.headers.get('set-cookie') || '').split(';')[0];

      // Verify valid cookie
      const verifyOk = await fetch(`${srv.baseUrl}/api/auth/verify`, {
        headers: { Cookie: loginCookie },
      });
      expect(verifyOk.status).toBe(200);
      const verifyData = await verifyOk.json();
      expect(verifyData.user.username).toBe('admin');
      expect(verifyData.user.passwordHash).toBeUndefined();

      // Verify tampered cookie returns 401
      const tamperedCookie = `${loginCookie.slice(0, -4)}XXXX`;
      const verifyTampered = await fetch(`${srv.baseUrl}/api/auth/verify`, {
        headers: { Cookie: tamperedCookie },
      });
      expect(verifyTampered.status).toBe(401);

      // Verify expired token returns 401
      const secret = 'test-session-secret-with-more-than-32-chars!!';
      const expiredPayload = Buffer.from(
        JSON.stringify({
          userId: 'usr-01',
          username: 'admin',
          role: 'مالك المؤسسة',
          companyId: 'comp-01',
          allowedCompanyIds: ['comp-01'],
          iat: Date.now() - 100_000,
          exp: Date.now() - 1_000,
        })
      ).toString('base64url');
      const expiredSig = crypto.createHmac('sha256', secret).update(expiredPayload).digest('base64url');
      const verifyExpired = await fetch(`${srv.baseUrl}/api/auth/verify`, {
        headers: { Authorization: `Bearer ${expiredPayload}.${expiredSig}` },
      });
      expect(verifyExpired.status).toBe(401);
    });

    it('sets Secure cookie attribute automatically in production / HTTPS requests', async () => {
      const { hash, salt } = hashPasswordPbkdf2Server('ProdPass2026');
      srv = await startTestServer({
        isProduction: true,
        sessionSecret: 'prod-session-secret-with-minimum-length-32-chars!!',
        initialUsers: [
          {
            id: 'usr-01',
            username: 'admin',
            fullName: 'Owner',
            role: 'مالك المؤسسة',
            allowedCompanyIds: ['comp-01'],
            branchId: 'br-01',
            active: true,
            passwordHash: hash,
            passwordSalt: salt,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
      const resp = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'ProdPass2026' }),
      });
      expect(resp.status).toBe(200);
      const cookieHeader = resp.headers.get('set-cookie') || '';
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('SameSite=Lax');
      expect(cookieHeader).toContain('Secure');
    });

    it('blocks unauthenticated (401), low-privilege RBAC (403), rate-limit abuse (429), and SSRF attempts', async () => {
      const limitedCreds = hashPasswordPbkdf2Server('Limited2026');
      const adminCreds = hashPasswordPbkdf2Server('AdminStrong2026');
      srv = await startTestServer({
        rateLimits: { aiPerMinute: 2, whatsappPerMinute: 2, loginPerMinute: 10 },
        whatsappFetchImpl: async () =>
          new Response(JSON.stringify({ messages: [{ id: 'wamid.test' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        initialUsers: [
          {
            id: 'usr-admin',
            username: 'admin',
            fullName: 'Owner',
            role: 'مالك المؤسسة',
            allowedCompanyIds: ['comp-01'],
            branchId: 'br-01',
            active: true,
            passwordHash: adminCreds.hash,
            passwordSalt: adminCreds.salt,
            updatedAt: new Date().toISOString(),
          },
          {
            id: 'usr-lim',
            username: 'limited',
            fullName: 'Limited Viewer',
            role: 'مستخدم محدود',
            allowedCompanyIds: ['comp-01'],
            branchId: 'br-01',
            active: true,
            passwordHash: limitedCreds.hash,
            passwordSalt: limitedCreds.salt,
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      // 1. Unauthenticated access -> 401
      const aiUnauth = await fetch(`${srv.baseUrl}/api/ai/analyze`, { method: 'POST' });
      expect(aiUnauth.status).toBe(401);
      const waUnauth = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, { method: 'POST' });
      expect(waUnauth.status).toBe(401);

      // 2. Limited user -> 403 Forbidden
      const limLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'limited', password: 'Limited2026' }),
      });
      const limCookie = (limLogin.headers.get('set-cookie') || '').split(';')[0];

      const aiForbidden = await fetch(`${srv.baseUrl}/api/ai/analyze`, {
        method: 'POST',
        headers: { Cookie: limCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'test' }),
      });
      expect(aiForbidden.status).toBe(403);

      const waForbidden = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, {
        method: 'POST',
        headers: { Cookie: limCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId: '12345678', apiToken: 'tok', toPhone: '967770000000', messageText: 'hi' }),
      });
      expect(waForbidden.status).toBe(403);

      // 3. Admin authenticated + SSRF blocking on /api/whatsapp/dispatch
      const adminLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'AdminStrong2026' }),
      });
      const adminCookie = (adminLogin.headers.get('set-cookie') || '').split(';')[0];

      const ssrfAttempts = [
        'http://127.0.0.1:3000/api/health',
        'https://169.254.169.254/latest/meta-data/',
        'http://localhost:8080/internal',
        'https://10.0.0.5/messages',
        'https://attacker.example.com/v20.0/123456/messages',
      ];
      for (const badUrl of ssrfAttempts) {
        const resCheck = validateWhatsAppTarget({ endpoint: badUrl });
        expect(resCheck.ok).toBe(false);
      }

      const ssrfHttpResp = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'https://169.254.169.254/latest/meta-data/',
          apiToken: 'tok',
          toPhone: '967770000000',
          messageText: 'test',
        }),
      });
      expect(ssrfHttpResp.status).toBe(403);

      // 4. Rate limit (limit=2 per minute) -> 3rd WhatsApp call gets 429
      const validWaPayload = JSON.stringify({
        phoneNumberId: '1234567890',
        apiToken: 'fake-token',
        toPhone: '967770000000',
        messageText: 'hello',
      });
      // Request #2 (first was ssrfHttpResp above, which passed limiter)
      const okWa = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: validWaPayload,
      });
      expect(okWa.status).toBe(200);

      // Request #3 exceeds limit=2 -> 429
      const rateLimitedWa = await fetch(`${srv.baseUrl}/api/whatsapp/dispatch`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
        body: validWaPayload,
      });
      expect(rateLimitedWa.status).toBe(429);
    });
  });
});
