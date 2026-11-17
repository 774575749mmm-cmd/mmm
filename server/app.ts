/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Hardened Express Application Factory
 * PostgreSQL Multi-Tenant Source of Truth, Auth (PBKDF2-SHA256 + HttpOnly Signed Cookies),
 * RBAC (Super Admin vs Tenant Admin), Rate Limiting, SSRF Guard, Gemini AI Proxy
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import type { PgExecutor } from './db.ts';
import {
  PgTenantRepository,
  sanitizePublicServerUser,
  type ServerUserRecord,
  type PublicServerUser,
  type ServerUserFlags,
} from './tenantRepository.ts';
import { evaluateLicenseBoundary } from '../src/services/licenseBoundaryService.ts';

export type { ServerUserRecord, PublicServerUser, ServerUserFlags };

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
  isSuperAdmin?: boolean;
  companyId: string;
  allowedCompanyIds: string[];
  iat: number;
  exp: number;
}

export interface ServerRateLimits {
  loginPerMinute?: number;
  aiPerMinute?: number;
  whatsappPerMinute?: number;
}

export interface ServerAppOptions {
  isProduction?: boolean;
  sessionSecret?: string;
  authStorePath?: string;
  inMemoryAuthStore?: boolean;
  db?: PgExecutor;
  initialUsers?: ServerUserRecord[];
  rateLimits?: ServerRateLimits;
  whatsappFetchImpl?: typeof fetch;
}

const PBKDF2_ITERATIONS = 210_000;
const SESSION_COOKIE_NAME = 'erp_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const AI_ALLOWED_ROLES = new Set([
  'مالك المؤسسة',
  'مدير النظام',
  'Tenant Admin',
  'المدير المالي',
  'محاسب',
  'مسؤول المخزون',
  'مسؤول المبيعات',
  'مسؤول المشتريات',
]);

const WHATSAPP_ALLOWED_ROLES = new Set([
  'مالك المؤسسة',
  'مدير النظام',
  'Tenant Admin',
  'المدير المالي',
  'محاسب',
  'مسؤول المبيعات',
  'أمين الصندوق',
]);

const ADMIN_ROLES = new Set(['مالك المؤسسة', 'مدير النظام', 'Tenant Admin']);

export function resolveSessionSecret(opts: { envSecret?: string; isProduction: boolean }): string {
  const raw = (opts.envSecret ?? process.env.ERP_SESSION_SECRET ?? '').trim();
  if (opts.isProduction) {
    if (!raw || raw.length < 32) {
      throw new Error(
        'CRITICAL SECURITY CONFIG ERROR: ERP_SESSION_SECRET environment variable must be configured with at least 32 characters in production mode.'
      );
    }
    return raw;
  }
  if (raw.length >= 16) return raw;
  return crypto.randomBytes(32).toString('hex');
}

export function validatePasswordStrengthServer(password: string): { ok: boolean; error?: string } {
  const candidate = String(password || '');
  if (candidate.length < 8) {
    return { ok: false, error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.' };
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(candidate) || !/[0-9]/.test(candidate)) {
    return {
      ok: false,
      error: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام معاً.',
    };
  }
  return { ok: true };
}

export function hashPasswordPbkdf2Server(
  password: string,
  salt = crypto.randomBytes(16).toString('hex'),
  iterations = PBKDF2_ITERATIONS
): { hash: string; salt: string } {
  const derived = crypto.pbkdf2Sync(
    password,
    `${salt}::ALMANSOOR_ERP_V4`,
    iterations,
    32,
    'sha256'
  );
  return {
    salt,
    hash: `v4pbkdf2$${iterations}$${derived.toString('hex')}`,
  };
}

export function verifyPasswordServer(password: string, storedHash: string, storedSalt: string): boolean {
  if (!password || !storedHash || !storedSalt) return false;
  if (!storedHash.startsWith('v4pbkdf2$')) return false;
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const iter = Number(parts[1]);
  const expectedHex = parts[2];
  if (!Number.isFinite(iter) || iter < 10_000 || !/^[0-9a-f]+$/i.test(expectedHex)) {
    return false;
  }
  const derivedHex = crypto
    .pbkdf2Sync(password, `${storedSalt}::ALMANSOOR_ERP_V4`, iter, 32, 'sha256')
    .toString('hex');
  const a = Buffer.from(derivedHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function sanitizePublicUser(user: ServerUserRecord): PublicServerUser {
  return sanitizePublicServerUser(user);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

function isRequestHttps(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return proto === 'https';
}

function setSessionCookie(req: Request, res: Response, token: string, isProduction: boolean): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isProduction || isRequestHttps(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response, isProduction: boolean): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProduction || isRequestHttps(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function validateWhatsAppTarget(params: {
  phoneNumberId?: string;
  endpoint?: string;
}): { ok: true; url: string } | { ok: false; status: number; code: string; error: string } {
  const rawEndpoint = String(params.endpoint || '').trim();
  const rawPhoneId = String(params.phoneNumberId || '').trim();

  if (rawEndpoint) {
    let parsed: URL;
    try {
      parsed = new URL(rawEndpoint);
    } catch {
      return { ok: false, status: 400, code: 'SSRF_INVALID_URL', error: 'عنوان Endpoint غير صالح.' };
    }

    if (parsed.protocol !== 'https:') {
      return {
        ok: false,
        status: 403,
        code: 'SSRF_BLOCKED_PROTOCOL',
        error: 'يُمنع الاتصال بأي بروتوكول غير HTTPS المشفر.',
      };
    }

    if (parsed.username || parsed.password) {
      return {
        ok: false,
        status: 403,
        code: 'SSRF_BLOCKED_CREDENTIALS',
        error: 'عنوان الاتصال يحتوي على بيانات مصادقة غير مصرح بها.',
      };
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      host === 'localhost' ||
      net.isIP(host) !== 0 ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return {
        ok: false,
        status: 403,
        code: 'SSRF_BLOCKED_HOST',
        error: 'محاولة وصول محظورة (SSRF): يُمنع استهداف الشبكة المحلية أو عناوين IP.',
      };
    }

    if (host !== 'graph.facebook.com') {
      return {
        ok: false,
        status: 403,
        code: 'SSRF_DISALLOWED_HOST',
        error: 'يسمح فقط بالاتصال مع خادم Meta الرسمي (graph.facebook.com).',
      };
    }

    if (!/^\/v\d{1,2}\.\d+\/[0-9]{6,24}\/messages$/.test(parsed.pathname)) {
      return {
        ok: false,
        status: 400,
        code: 'SSRF_INVALID_PATH',
        error: 'مسار Meta WhatsApp API غير مطابق للصيغة الرسمية المعتمدة.',
      };
    }

    return { ok: true, url: `https://graph.facebook.com${parsed.pathname}` };
  }

  if (!/^[0-9]{6,24}$/.test(rawPhoneId)) {
    return {
      ok: false,
      status: 422,
      code: 'EXTERNAL_CREDENTIALS_REQUIRED',
      error:
        'إرسال WhatsApp Business API التلقائي يتطلب Phone Number ID رقمياً صحيحاً ومفتاح Bearer Token الرسمي.',
    };
  }

  return {
    ok: true,
    url: `https://graph.facebook.com/v20.0/${rawPhoneId}/messages`,
  };
}

class AuthUserStore {
  private users: Map<string, ServerUserRecord> = new Map();
  private readonly filePath: string | null;

  constructor(filePath: string | null, initialUsers?: ServerUserRecord[]) {
    this.filePath = filePath;
    if (initialUsers && initialUsers.length > 0) {
      for (const u of initialUsers) {
        this.users.set(u.id, { ...u });
      }
    } else if (this.filePath) {
      this.loadFromDisk();
    }
  }

  private loadFromDisk(): void {
    if (!this.filePath) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ServerUserRecord[];
      if (Array.isArray(parsed)) {
        this.users.clear();
        for (const u of parsed) {
          if (u && typeof u.id === 'string' && typeof u.username === 'string' && u.passwordHash) {
            this.users.set(u.id, u);
          }
        }
      }
    } catch {
      // Ignore corrupt disk cache cleanly
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(Array.from(this.users.values()), null, 2), 'utf8');
    } catch {
      // Ignore write failures in read-only environments
    }
  }

  hasAnyUsers(): boolean {
    return this.users.size > 0;
  }

  findById(id: string): ServerUserRecord | undefined {
    return this.users.get(id);
  }

  findByUsername(username: string): ServerUserRecord | undefined {
    const target = username.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.username.trim().toLowerCase() === target) {
        return u;
      }
    }
    return undefined;
  }

  upsertUser(record: ServerUserRecord): void {
    this.users.set(record.id, { ...record });
    this.persist();
  }
}

function createRateLimiter(maxPerMinute: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + 60_000 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > maxPerMinute) {
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMIT_EXCEEDED',
        error: 'تم تجاوز الحد الأقصى لعدد الطلبات المسموح بها في الدقيقة. يرجى الانتظار قليلاً.',
      });
      return;
    }
    next();
  };
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function createErpServerApp(options: ServerAppOptions = {}): Express {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const sessionSecret = resolveSessionSecret({
    envSecret: options.sessionSecret,
    isProduction,
  });

  const pgRepo = options.db ? new PgTenantRepository(options.db) : null;
  const storePath =
    pgRepo || options.inMemoryAuthStore
      ? null
      : options.authStorePath || path.resolve('.erp-auth-users.json');
  const authStore = pgRepo ? null : new AuthUserStore(storePath, options.initialUsers);

  const signSessionToken = (payload: SessionPayload): string => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  };

  const verifySessionToken = (
    token: string
  ): { valid: true; payload: SessionPayload } | { valid: false; reason: string } => {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return { valid: false, reason: 'MALFORMED' };
    const [encoded, sig] = parts;
    if (!encoded || !sig) return { valid: false, reason: 'MALFORMED' };

    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
      if (!payload.userId || !payload.exp || Date.now() > payload.exp) {
        return { valid: false, reason: 'EXPIRED' };
      }
      return { valid: true, payload };
    } catch {
      return { valid: false, reason: 'CORRUPT_PAYLOAD' };
    }
  };

  const extractToken = (req: Request): string => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies[SESSION_COOKIE_NAME]) {
      return cookies[SESSION_COOKIE_NAME];
    }
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return '';
  };

  interface AuthenticatedRequest extends Request {
    authSession?: SessionPayload;
    authUser?: ServerUserRecord;
  }

  const findUserByIdUnified = async (id: string): Promise<ServerUserRecord | undefined> => {
    if (pgRepo) return pgRepo.findUserById(id);
    return authStore!.findById(id);
  };

  const findUserByUsernameUnified = async (username: string): Promise<ServerUserRecord | undefined> => {
    if (pgRepo) return pgRepo.findUserByUsername(username);
    return authStore!.findByUsername(username);
  };

  const hasAnyUsersUnified = async (): Promise<boolean> => {
    if (pgRepo) return pgRepo.hasAnyUsers();
    return authStore!.hasAnyUsers();
  };

  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractToken(req);
      if (!token) {
        res.status(401).json({
          ok: false,
          code: 'AUTH_REQUIRED',
          error: 'جلسة العمل غير موجودة أو منتهية. يرجى تسجيل الدخول أولاً.',
        });
        return;
      }
      const verified = verifySessionToken(token);
      if (!verified.valid) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_SESSION',
          error: 'توكن الجلسة غير صالح أو منتهي الصلاحية.',
        });
        return;
      }
      const storedUser = await findUserByIdUnified(verified.payload.userId);
      if (!storedUser || !storedUser.active) {
        res.status(401).json({
          ok: false,
          code: 'ACCOUNT_DISABLED',
          error: 'حساب المستخدم غير مفعل أو غير موجود.',
        });
        return;
      }

      // Derive authoritative company memberships from PostgreSQL, never trust stale cookie claims alone
      const authoritativeAllowed = Array.isArray(storedUser.allowedCompanyIds)
        ? storedUser.allowedCompanyIds
        : [];
      const sessionCompanyId = verified.payload.companyId;
      const effectiveCompanyId =
        sessionCompanyId && authoritativeAllowed.includes(sessionCompanyId)
          ? sessionCompanyId
          : storedUser.lastActiveCompanyId && authoritativeAllowed.includes(storedUser.lastActiveCompanyId)
          ? storedUser.lastActiveCompanyId
          : authoritativeAllowed[0] || '';

      req.authSession = {
        ...verified.payload,
        role: storedUser.role,
        isSuperAdmin: Boolean(storedUser.isSuperAdmin),
        companyId: effectiveCompanyId,
        allowedCompanyIds: authoritativeAllowed,
      };
      req.authUser = storedUser;
      next();
    } catch (err) {
      res.status(500).json({
        ok: false,
        code: 'AUTH_VERIFICATION_FAILED',
        error: err instanceof Error ? err.message : 'فشل التحقق من جلسة المستخدم.',
      });
    }
  };

  const requireRoles = (allowed: Set<string>) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const role = req.authUser?.role || '';
      const hasSettingsFlag =
        allowed === ADMIN_ROLES && Boolean(req.authUser?.flags?.canManageSettings);
      if (!allowed.has(role) && !hasSettingsFlag) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN_ROLE',
          error: `صلاحية مرفوضة: الدور (${role || 'غير معروف'}) غير مخول لتنفيذ هذا الإجراء.`,
        });
        return;
      }
      next();
    };
  };

  const requireSuperAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser || req.authUser.isSuperAdmin !== true) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_SUPER_ADMIN_ONLY',
        error: 'صلاحية مرفوضة: هذه الواجهة مخصصة لمدير المنصة المركزي (Super Admin) فقط.',
      });
      return;
    }
    next();
  };

  const app = express();
  app.use(express.json({ limit: '16mb' }));

  // Baseline HTTP Security Headers (OWASP ASVS alignment)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const loginRateLimiter = createRateLimiter(options.rateLimits?.loginPerMinute ?? 30);
  const aiRateLimiter = createRateLimiter(options.rateLimits?.aiPerMinute ?? 20);
  const whatsappRateLimiter = createRateLimiter(options.rateLimits?.whatsappPerMinute ?? 30);

  // Health & readiness endpoint (executes live DB check & non-secret RLS diagnostics)
  app.get('/api/health', async (_req: Request, res: Response) => {
    try {
      const apiKey = (process.env.GEMINI_API_KEY || '').trim();
      const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
      let rlsReady: boolean | null = null;
      let rlsRoleRestricted: boolean | null = null;
      if (options.db) {
        await options.db.query('SELECT 1');
        const rls = await options.db.checkRlsStatus();
        rlsReady = rls.rlsTables.length > 0 && rls.rlsTables.every((t) => t.enabled && t.forced);
        rlsRoleRestricted = (!rls.isSuperuser && !rls.bypassRls) || rls.enforcesViaAppRole;
      }
      const authInitialized = await hasAnyUsersUnified();
      res.json({
        ok: true,
        service: 'almansoor-erp-server',
        databaseDriver: options.db ? options.db.dialect : 'in_memory',
        rlsReady,
        rlsRoleRestricted,
        aiConfigured,
        production: isProduction,
        productionMode: isProduction,
        authInitialized,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Health check failed',
      });
    }
  });

  // Legacy passwordless session minting endpoint is explicitly disabled
  app.post('/api/auth/session', (_req: Request, res: Response) => {
    res.status(410).json({
      ok: false,
      code: 'PASSWORDLESS_SESSION_DISABLED',
      error: 'تم إلغاء إنشاء الجلسات بدون التحقق من كلمة المرور. يرجى استخدام /api/auth/login.',
    });
  });

  app.get('/api/auth/status', async (req: Request, res: Response) => {
    try {
      const token = extractToken(req);
      let activeUser: PublicServerUser | null = null;
      let activeCompanyId: string | null = null;
      let companies: unknown[] = [];
      let licenseBoundary = evaluateLicenseBoundary(null);

      if (token) {
        const verified = verifySessionToken(token);
        if (verified.valid) {
          const u = await findUserByIdUnified(verified.payload.userId);
          if (u && u.active) {
            activeUser = sanitizePublicUser(u);
            if (pgRepo) {
              const authCompanies = await pgRepo.getUserAuthorizedCompanies(u.id);
              const allowedSet = new Set(authCompanies.map((c) => c.id));
              activeCompanyId =
                (verified.payload.companyId && allowedSet.has(verified.payload.companyId)
                  ? verified.payload.companyId
                  : null) ||
                (u.lastActiveCompanyId && allowedSet.has(u.lastActiveCompanyId)
                  ? u.lastActiveCompanyId
                  : null) ||
                u.companyId ||
                authCompanies[0]?.id ||
                null;
              companies = u.isSuperAdmin
                ? authCompanies
                : authCompanies.filter((c) => c.id === activeCompanyId);
              if (activeCompanyId) {
                const st = await pgRepo.getCompanyState(u.id, activeCompanyId);
                if (st.ok) {
                  licenseBoundary = evaluateLicenseBoundary(st.snapshot.license);
                }
              }
            } else {
              activeCompanyId = verified.payload.companyId || u.allowedCompanyIds[0] || null;
            }
          }
        }
      }

      const initialized = await hasAnyUsersUnified();
      res.json({
        ok: true,
        initialized,
        authenticated: Boolean(activeUser),
        user: activeUser,
        companies,
        activeCompanyId,
        licenseBoundary,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Status check failed',
      });
    }
  });

  // Initial Owner Account Bootstrap (ONLY allowed when zero server users exist)
  app.post('/api/auth/bootstrap', async (req: Request, res: Response) => {
    try {
      if (await hasAnyUsersUnified()) {
        res.status(403).json({
          ok: false,
          code: 'ALREADY_BOOTSTRAPPED',
          error: 'النظام مهيأ مسبقاً بحساب مدير. يرجى تسجيل الدخول بكلمة المرور.',
        });
        return;
      }

      const body = (req.body || {}) as {
        id?: string;
        username?: string;
        fullName?: string;
        email?: string;
        allowedCompanyIds?: string[];
        branchId?: string;
        password?: string;
        company?: {
          id?: string;
          nameAr?: string;
          nameEn?: string;
          countryCode?: string;
          baseCurrency?: string;
        };
        initialState?: Record<string, unknown>;
      };

      const username = String(body.username || 'admin').trim();
      const fullName = String(body.fullName || 'مالك المؤسسة').trim();
      const password = String(body.password || '');
      const strength = validatePasswordStrengthServer(password);
      if (!strength.ok) {
        res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: strength.error });
        return;
      }

      const { hash, salt } = hashPasswordPbkdf2Server(password);
      const allowedCompanyIds =
        Array.isArray(body.allowedCompanyIds) && body.allowedCompanyIds.length > 0
          ? body.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
          : [body.company?.id || 'comp-01'];

      const ownerRecord: ServerUserRecord = {
        id: String(body.id || 'usr-01').trim(),
        username,
        fullName,
        email: String(body.email || `${username}@almansoor.erp`).trim(),
        role: 'مالك المؤسسة',
        isSuperAdmin: true,
        allowedCompanyIds,
        branchId: String(body.branchId || 'br-01').trim(),
        active: true,
        passwordHash: hash,
        passwordSalt: salt,
        mustChangePassword: false,
        lastActiveCompanyId: allowedCompanyIds[0] || 'comp-01',
        flags: {
          canViewReports: true,
          canPostEntries: true,
          canAdjustInventory: true,
          canViewCostsAndProfits: true,
          canManageSettings: true,
          canEditInvoices: true,
          canDeleteInvoices: true,
          canEditVouchers: true,
          canDeleteVouchers: true,
          canEditExchangeRates: true,
        },
        updatedAt: new Date().toISOString(),
      };

      let createdCompanies: unknown[] = [];
      if (pgRepo) {
        const companyInputs = allowedCompanyIds.map((cid, idx) => ({
          id: cid,
          nameAr: idx === 0 ? body.company?.nameAr || 'مؤسسة المنصور للتجارة والاستثمار' : `منشأة ${cid}`,
          nameEn: idx === 0 ? body.company?.nameEn || 'Almansoor Trading & Investment' : cid,
          countryCode: idx === 0 ? body.company?.countryCode || 'YE' : 'YE',
          baseCurrency: idx === 0 ? body.company?.baseCurrency || 'YER' : 'YER',
        }));
        const bootRes = await pgRepo.bootstrapOwner({
          user: ownerRecord,
          companies: companyInputs,
          initialState: body.initialState,
        });
        if (!bootRes.ok) {
          res.status(403).json({ ok: false, code: bootRes.code, error: bootRes.error });
          return;
        }
        createdCompanies = bootRes.companies;
      } else {
        authStore!.upsertUser(ownerRecord);
      }

      const now = Date.now();
      const activeCompanyId = allowedCompanyIds[0] || 'comp-01';
      const token = signSessionToken({
        userId: ownerRecord.id,
        username: ownerRecord.username,
        role: ownerRecord.role,
        isSuperAdmin: true,
        companyId: activeCompanyId,
        allowedCompanyIds,
        iat: now,
        exp: now + SESSION_TTL_MS,
      });

      setSessionCookie(req, res, token, isProduction);
      res.status(201).json({
        ok: true,
        user: sanitizePublicUser(ownerRecord),
        companies: createdCompanies,
        activeCompanyId,
        licenseBoundary: evaluateLicenseBoundary(null),
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Bootstrap failed',
      });
    }
  });

  // Independent Tenant Registration (creates an isolated account + optional new company with ZERO access to existing companies)
  app.post('/api/auth/register', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      if (!pgRepo) {
        res.status(501).json({
          ok: false,
          code: 'POSTGRES_REQUIRED',
          error: 'التسجيل المستقل للمنشآت يتطلب تفعيل قاعدة بيانات PostgreSQL.',
        });
        return;
      }

      const body = (req.body || {}) as {
        username?: string;
        fullName?: string;
        email?: string;
        password?: string;
        company?: {
          id?: string;
          nameAr?: string;
          nameEn?: string;
          countryCode?: string;
          baseCurrency?: string;
          valuationPolicy?: string;
          commercialRecord?: string;
          taxNumber?: string;
          phone?: string;
          address?: string;
          fiscalYearStart?: string;
          branchName?: string;
          warehouseName?: string;
        };
        initialState?: Record<string, unknown>;
      };

      const username = String(body.username || '').trim();
      const fullName = String(body.fullName || '').trim();
      const password = String(body.password || '');

      if (!username || !fullName) {
        res.status(400).json({
          ok: false,
          code: 'MISSING_FIELDS',
          error: 'يرجى إدخال اسم المستخدم والاسم الكامل.',
        });
        return;
      }
      const strength = validatePasswordStrengthServer(password);
      if (!strength.ok) {
        res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: strength.error });
        return;
      }

      const { hash, salt } = hashPasswordPbkdf2Server(password);
      const regRes = await pgRepo.registerTenantAccount({
        username,
        fullName,
        email: body.email,
        passwordHash: hash,
        passwordSalt: salt,
        company:
          body.company && body.company.nameAr && body.company.nameAr.trim()
            ? {
                ...body.company,
                nameAr: body.company.nameAr.trim(),
              }
            : undefined,
        initialState: body.initialState,
      });

      if (!regRes.ok) {
        res.status(regRes.status).json({
          ok: false,
          code: regRes.code,
          error: regRes.error,
        });
        return;
      }

      const now = Date.now();
      const activeCompanyId = regRes.company?.id || null;
      if (activeCompanyId) {
        const token = signSessionToken({
          userId: regRes.user.id,
          username: regRes.user.username,
          role: regRes.user.role,
          isSuperAdmin: false,
          companyId: activeCompanyId,
          allowedCompanyIds: [activeCompanyId],
          iat: now,
          exp: now + SESSION_TTL_MS,
        });
        setSessionCookie(req, res, token, isProduction);
      }

      res.status(201).json({
        ok: true,
        user: sanitizePublicUser(regRes.user),
        company: regRes.company,
        companies: regRes.companies,
        activeCompanyId,
        licenseBoundary: evaluateLicenseBoundary(null),
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Registration failed',
      });
    }
  });

  // Real Password-Verified Login
  app.post('/api/auth/login', loginRateLimiter, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        username?: string;
        userId?: string;
        password?: string;
        companyId?: string;
      };
      const username = String(body.username || '').trim();
      const userId = String(body.userId || '').trim();
      const password = String(body.password || '');

      if ((!username && !userId) || !password) {
        res.status(400).json({
          ok: false,
          code: 'MISSING_CREDENTIALS',
          error: 'يرجى إدخال اسم المستخدم وكلمة المرور.',
        });
        return;
      }

      const record = userId
        ? await findUserByIdUnified(userId)
        : await findUserByUsernameUnified(username);

      if (!record) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          error: 'اسم المستخدم أو كلمة المرور غير صحيحة أو الحساب موقوف.',
        });
        return;
      }
      if (!record.active) {
        res.status(401).json({
          ok: false,
          code: 'ACCOUNT_DISABLED',
          error: 'حساب المستخدم موقوف إدارياً ولا يمكنه تسجيل الدخول.',
        });
        return;
      }

      const passwordValid = verifyPasswordServer(password, record.passwordHash, record.passwordSalt);
      if (!passwordValid) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          error: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
        });
        return;
      }

      const allowedCompanies = Array.isArray(record.allowedCompanyIds)
        ? record.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (allowedCompanies.length === 0) {
        res.status(403).json({
          ok: false,
          code: 'NO_COMPANY_ACCESS',
          error: 'عذراً، هذا الحساب لا يملك صلاحية الوصول إلى أي منشأة.',
        });
        return;
      }

      const requestedCompany = String(body.companyId || '').trim();
      const activeCompanyId =
        requestedCompany && allowedCompanies.includes(requestedCompany)
          ? requestedCompany
          : record.lastActiveCompanyId && allowedCompanies.includes(record.lastActiveCompanyId)
          ? record.lastActiveCompanyId
          : allowedCompanies[0];

      let companies: unknown[] = [];
      let licenseBoundary = evaluateLicenseBoundary(null);
      if (pgRepo) {
        await pgRepo.updateLastActiveCompany(record.id, activeCompanyId);
        companies = await pgRepo.getUserAuthorizedCompanies(record.id);
        const st = await pgRepo.getCompanyState(record.id, activeCompanyId);
        if (st.ok) {
          licenseBoundary = evaluateLicenseBoundary(st.snapshot.license);
        }
      }

      const now = Date.now();
      const token = signSessionToken({
        userId: record.id,
        username: record.username,
        role: record.role,
        isSuperAdmin: Boolean(record.isSuperAdmin),
        companyId: activeCompanyId,
        allowedCompanyIds: allowedCompanies,
        iat: now,
        exp: now + SESSION_TTL_MS,
      });

      setSessionCookie(req, res, token, isProduction);
      res.json({
        ok: true,
        user: sanitizePublicUser({ ...record, lastActiveCompanyId: activeCompanyId }),
        companies,
        activeCompanyId,
        licenseBoundary,
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Login error',
      });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    clearSessionCookie(req, res, isProduction);
    res.json({ ok: true });
  });

  app.get('/api/auth/verify', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      ok: true,
      session: req.authSession,
      user: req.authUser ? sanitizePublicUser(req.authUser) : undefined,
    });
  });

  // =========================================================================
  // PostgreSQL Authoritative Multi-Company Endpoints
  // =========================================================================

  app.get('/api/companies', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.status(501).json({
          ok: false,
          code: 'POSTGRES_REQUIRED',
          error: 'إدارة المنشآت تتطلب تفعيل PostgreSQL.',
        });
        return;
      }
      const user = req.authUser!;
      const allAuthorized = await pgRepo.getUserAuthorizedCompanies(user.id);
      const allowedSet = new Set(allAuthorized.map((c) => c.id));
      const activeCompanyId =
        (req.authSession?.companyId && allowedSet.has(req.authSession.companyId)
          ? req.authSession.companyId
          : null) ||
        (user.lastActiveCompanyId && allowedSet.has(user.lastActiveCompanyId)
          ? user.lastActiveCompanyId
          : null) ||
        user.companyId ||
        allAuthorized[0]?.id ||
        null;

      const visibleCompanies = user.isSuperAdmin
        ? allAuthorized
        : allAuthorized.filter((c) => c.id === activeCompanyId);

      res.json({
        ok: true,
        companies: visibleCompanies,
        activeCompanyId,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed loading companies',
      });
    }
  });

  // Only Platform Super Admin (مالك المؤسسة) may create additional companies
  app.post(
    '/api/companies',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!pgRepo) {
          res.status(501).json({
            ok: false,
            code: 'POSTGRES_REQUIRED',
            error: 'تأسيس وحفظ المنشآت يتطلب قاعدة بيانات PostgreSQL.',
          });
          return;
        }
        const actor = req.authUser!;
        const body = (req.body || {}) as {
          id?: string;
          nameAr?: string;
          nameEn?: string;
          countryCode?: string;
          baseCurrency?: string;
          valuationPolicy?: string;
          commercialRecord?: string;
          taxNumber?: string;
          phone?: string;
          email?: string;
          address?: string;
          fiscalYearStart?: string;
          branchName?: string;
          warehouseName?: string;
          initialState?: Record<string, unknown>;
        };

        const nameAr = String(body.nameAr || '').trim();
        if (!nameAr) {
          res.status(400).json({
            ok: false,
            code: 'COMPANY_NAME_REQUIRED',
            error: 'اسم المنشأة بالعربية مطلوب.',
          });
          return;
        }

        const createRes = await pgRepo.createCompanyForUser({
          actor,
          company: {
            id: body.id,
            nameAr,
            nameEn: body.nameEn,
            countryCode: body.countryCode,
            baseCurrency: body.baseCurrency,
            valuationPolicy: body.valuationPolicy,
            commercialRecord: body.commercialRecord,
            taxNumber: body.taxNumber,
            phone: body.phone,
            email: body.email,
            address: body.address,
            fiscalYearStart: body.fiscalYearStart,
            branchName: body.branchName,
            warehouseName: body.warehouseName,
          },
          initialState: body.initialState,
        });

        if (!createRes.ok) {
          res.status(createRes.status).json({
            ok: false,
            code: createRes.code,
            error: createRes.error,
          });
          return;
        }

        const now = Date.now();
        const allowedIds = createRes.companies.map((c) => c.id);
        const token = signSessionToken({
          userId: actor.id,
          username: actor.username,
          role: actor.role,
          isSuperAdmin: Boolean(actor.isSuperAdmin),
          companyId: createRes.company.id,
          allowedCompanyIds: allowedIds,
          iat: now,
          exp: now + SESSION_TTL_MS,
        });
        setSessionCookie(req, res, token, isProduction);

        res.status(201).json({
          ok: true,
          company: createRes.company,
          companies: createRes.companies,
          activeCompanyId: createRes.company.id,
          revision: createRes.revision,
          licenseBoundary: evaluateLicenseBoundary({ companyId: createRes.company.id }),
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed creating company',
        });
      }
    }
  );

  // Tenant Admin can update own company profile in PostgreSQL; Super Admin can update any company
  app.put(
    '/api/companies/:id',
    requireAuth,
    requireRoles(ADMIN_ROLES),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!pgRepo) {
          res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
          return;
        }
        const actor = req.authUser!;
        const targetCompanyId = String(req.params.id || '').trim();
        const sessionCompanyId = req.authSession?.companyId || '';

        if (!targetCompanyId) {
          res.status(400).json({ ok: false, code: 'COMPANY_ID_REQUIRED', error: 'معرف المنشأة مطلوب.' });
          return;
        }

        if (!actor.isSuperAdmin && targetCompanyId !== sessionCompanyId) {
          res.status(403).json({
            ok: false,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: لا تملك صلاحية تعديل منشأة خارج جلستك الحالية.',
          });
          return;
        }

        const body = (req.body || {}) as {
          nameAr?: string;
          nameEn?: string;
          countryCode?: string;
          baseCurrency?: string;
          valuationPolicy?: string;
          commercialRecord?: string;
          taxNumber?: string;
          phone?: string;
          email?: string;
          address?: string;
          fiscalYearStart?: string;
          status?: string;
        };

        const updateRes = await pgRepo.updateCompanyProfile({
          actor,
          companyId: targetCompanyId,
          patch: body,
        });

        if (!updateRes.ok) {
          res.status(updateRes.status).json({
            ok: false,
            code: updateRes.code,
            error: updateRes.error,
          });
          return;
        }

        res.json({
          ok: true,
          company: updateRes.company,
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed updating company',
        });
      }
    }
  );

  // Only Platform Super Admin (مالك المؤسسة) may activate/suspend company subscriptions
  app.patch(
    '/api/companies/:id/status',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!pgRepo) {
          res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
          return;
        }
        const actor = req.authUser!;
        const targetCompanyId = String(req.params.id || '').trim();
        const body = (req.body || {}) as { status?: string; active?: boolean };
        const rawStatus =
          body.status || (body.active === false ? 'suspended' : body.active === true ? 'active' : '');
        const cleanStatus =
          rawStatus === 'active' || rawStatus === 'inactive' || rawStatus === 'suspended'
            ? rawStatus
            : null;

        if (!targetCompanyId || !cleanStatus) {
          res.status(400).json({
            ok: false,
            code: 'INVALID_STATUS',
            error: 'حالة اشتراك المنشأة غير صالحة (المسموح: active, inactive, suspended).',
          });
          return;
        }

        const statusRes = await pgRepo.setCompanySubscriptionStatus({
          actor,
          companyId: targetCompanyId,
          status: cleanStatus,
        });

        if (!statusRes.ok) {
          res.status(statusRes.status).json({
            ok: false,
            code: statusRes.code,
            error: statusRes.error,
          });
          return;
        }

        res.json({
          ok: true,
          company: statusRes.company,
          license: statusRes.license,
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed updating company subscription status',
        });
      }
    }
  );

  // Only Platform Super Admin (مالك المؤسسة) may switch between companies
  app.post(
    '/api/companies/switch',
    requireAuth,
    requireSuperAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!pgRepo) {
          res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
          return;
        }
        const actor = req.authUser!;
        const body = (req.body || {}) as { companyId?: string };
        const targetCompanyId = String(body.companyId || '').trim();
        if (!targetCompanyId) {
          res.status(400).json({
            ok: false,
            code: 'COMPANY_ID_REQUIRED',
            error: 'معرف المنشأة المستهدفة مطلوب.',
          });
          return;
        }

        const switchRes = await pgRepo.switchActiveCompany(actor.id, targetCompanyId);
        if (!switchRes.ok) {
          res.status(switchRes.status).json({
            ok: false,
            code: switchRes.code,
            error: switchRes.error,
          });
          return;
        }

        const now = Date.now();
        const allowedIds = switchRes.companies.map((c) => c.id);
        const token = signSessionToken({
          userId: actor.id,
          username: actor.username,
          role: switchRes.membershipRole || actor.role,
          isSuperAdmin: Boolean(actor.isSuperAdmin),
          companyId: switchRes.company.id,
          allowedCompanyIds: allowedIds,
          iat: now,
          exp: now + SESSION_TTL_MS,
        });
        setSessionCookie(req, res, token, isProduction);

        res.json({
          ok: true,
          activeCompanyId: switchRes.company.id,
          company: switchRes.company,
          companies: switchRes.companies,
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed switching company',
        });
      }
    }
  );

  app.get('/api/company/state', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
        return;
      }
      const sessionCompanyId = req.authSession?.companyId || '';
      const requestedQueryCid = String(req.query?.companyId || req.headers['x-company-id'] || '').trim();

      if (!sessionCompanyId) {
        res.status(403).json({
          ok: false,
          code: 'NO_COMPANY_ACCESS',
          error: 'عذراً، هذا الحساب لا يملك منشأة نشطة مصرح بها.',
        });
        return;
      }
      if (requestedQueryCid && requestedQueryCid !== sessionCompanyId) {
        res.status(403).json({
          ok: false,
          code: 'TENANT_ISOLATION_VIOLATION',
          error: `عزل المنشآت: محاولة الوصول غير المصرح بها لمنشأة (${requestedQueryCid}) من جلسة (${sessionCompanyId}).`,
        });
        return;
      }

      const stateRes = await pgRepo.getCompanyState(req.authUser!.id, sessionCompanyId);
      if (!stateRes.ok) {
        res.status(stateRes.status).json({
          ok: false,
          code: stateRes.code,
          error: stateRes.error,
        });
        return;
      }

      res.json({
        ok: true,
        ...stateRes.snapshot,
        licenseBoundary: evaluateLicenseBoundary(stateRes.snapshot.license),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed loading company state',
      });
    }
  });

  app.put('/api/company/state', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
        return;
      }
      const sessionCompanyId = req.authSession?.companyId || '';
      if (!sessionCompanyId) {
        res.status(403).json({
          ok: false,
          code: 'NO_COMPANY_ACCESS',
          error: 'عذراً، هذا الحساب لا يملك منشأة نشطة مصرح بها.',
        });
        return;
      }

      const body = (req.body || {}) as {
        companyId?: string;
        activeCompanyId?: string;
        expectedRevision?: number;
        state?: Record<string, unknown>;
      };

      const bodyCid = String(body.companyId || '').trim();
      const bodyActiveCid = String(body.activeCompanyId || '').trim();
      const headerCid = String(req.headers['x-company-id'] || '').trim();
      if (
        (bodyCid && bodyCid !== sessionCompanyId) ||
        (bodyActiveCid && bodyActiveCid !== sessionCompanyId) ||
        (headerCid && headerCid !== sessionCompanyId)
      ) {
        res.status(403).json({
          ok: false,
          code: 'TENANT_ISOLATION_VIOLATION',
          error: 'عزل المنشآت: تم رفض محاولة تمرير معرف منشأة مخالف للجلسة الموثقة.',
        });
        return;
      }

      const stateObj =
        body.state && typeof body.state === 'object'
          ? body.state
          : (body as Record<string, unknown>);

      const saveRes = await pgRepo.saveCompanyState({
        userId: req.authUser!.id,
        companyId: sessionCompanyId,
        state: stateObj,
        expectedRevision:
          typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined,
      });

      if (!saveRes.ok) {
        res.status(saveRes.status).json({
          ok: false,
          code: saveRes.code,
          error: saveRes.error,
          serverRevision: saveRes.serverRevision,
        });
        return;
      }

      res.json({
        ok: true,
        companyId: saveRes.companyId,
        revision: saveRes.revision,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed saving company state',
      });
    }
  });

  // Tenant-Scoped User Management (strictly restricted to active session companyId)
  app.get('/api/company/users', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.status(501).json({ ok: false, code: 'POSTGRES_REQUIRED', error: 'PostgreSQL required.' });
        return;
      }
      const sessionCompanyId = req.authSession?.companyId || '';
      if (!sessionCompanyId) {
        res.status(403).json({ ok: false, code: 'NO_COMPANY_ACCESS', error: 'لا توجد منشأة نشطة.' });
        return;
      }
      const listRes = await pgRepo.listCompanyUsers(req.authUser!.id, sessionCompanyId);
      if (!listRes.ok) {
        res.status(listRes.status).json({ ok: false, code: listRes.code, error: listRes.error });
        return;
      }
      res.json({ ok: true, companyId: sessionCompanyId, users: listRes.users });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed listing company users',
      });
    }
  });

  const handleUpsertScopedUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const body = (req.body || {}) as {
        id?: string;
        username?: string;
        fullName?: string;
        email?: string;
        role?: string;
        isSuperAdmin?: boolean;
        allowedCompanyIds?: string[];
        branchId?: string;
        active?: boolean;
        password?: string;
        mustChangePassword?: boolean;
        flags?: ServerUserFlags;
        permissionMatrix?: Record<string, unknown>;
        companyId?: string;
      };

      const id = String(body.id || '').trim();
      const username = String(body.username || '').trim();
      const fullName = String(body.fullName || '').trim();
      const role = String(body.role || '').trim();
      if (!id || !username || !fullName || !role) {
        res.status(400).json({ ok: false, error: 'بيانات المستخدم غير مكتملة.' });
        return;
      }

      // Block privilege escalation to Super Admin by Tenant Admin / non-Super-Admin
      if ((body.isSuperAdmin || role === 'مالك المؤسسة') && !req.authUser?.isSuperAdmin) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN_SUPER_ADMIN_ESCALATION',
          error: 'صلاحية مرفوضة: مدير المنشأة لا يملك صلاحية منح صفة Super Admin أو دور مالك المؤسسة.',
        });
        return;
      }

      if (pgRepo) {
        const sessionCompanyId = req.authSession?.companyId || '';
        const targetBodyCompany = String(body.companyId || '').trim();
        if (targetBodyCompany && targetBodyCompany !== sessionCompanyId) {
          res.status(403).json({
            ok: false,
            code: 'TENANT_ISOLATION_VIOLATION',
            error: 'عزل المنشآت: لا يمكنك إدارة مستخدم لمنشأة خارج جلستك الحالية.',
          });
          return;
        }
        if (!sessionCompanyId) {
          res.status(403).json({
            ok: false,
            code: 'NO_COMPANY_ACCESS',
            error: 'حساب الإدارة لا يملك صلاحية الوصول لأي منشأة.',
          });
          return;
        }

        let passwordHash: string | undefined;
        let passwordSalt: string | undefined;
        if (body.password !== undefined && body.password !== '') {
          const strength = validatePasswordStrengthServer(String(body.password));
          if (!strength.ok) {
            res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: strength.error });
            return;
          }
          const hashed = hashPasswordPbkdf2Server(String(body.password));
          passwordHash = hashed.hash;
          passwordSalt = hashed.salt;
        }

        const upsertRes = await pgRepo.upsertCompanyUser({
          actor: req.authUser!,
          companyId: sessionCompanyId,
          targetUser: {
            id,
            username,
            fullName,
            email: body.email,
            role,
            isSuperAdmin: Boolean(req.authUser?.isSuperAdmin && body.isSuperAdmin),
            allowedCompanyIds: body.allowedCompanyIds,
            branchId: body.branchId,
            active: body.active,
            passwordHash,
            passwordSalt,
            mustChangePassword: body.mustChangePassword,
            flags: body.flags,
            permissionMatrix: body.permissionMatrix,
          },
        });

        if (!upsertRes.ok) {
          res.status(upsertRes.status).json({
            ok: false,
            code: upsertRes.code,
            error: upsertRes.error,
          });
          return;
        }

        res.status(upsertRes.created ? 201 : 200).json({
          ok: true,
          user: upsertRes.user,
        });
        return;
      }

      // In-memory store path (preserves legacy unit tests cleanly)
      const existing = authStore!.findById(id);
      let passwordHash = existing?.passwordHash || '';
      let passwordSalt = existing?.passwordSalt || '';

      if (body.password !== undefined && body.password !== '') {
        const strength = validatePasswordStrengthServer(String(body.password));
        if (!strength.ok) {
          res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: strength.error });
          return;
        }
        const hashed = hashPasswordPbkdf2Server(String(body.password));
        passwordHash = hashed.hash;
        passwordSalt = hashed.salt;
      } else if (!existing) {
        res.status(400).json({
          ok: false,
          code: 'PASSWORD_REQUIRED',
          error: 'يجب تعيين كلمة مرور قوية عند إنشاء مستخدم جديد.',
        });
        return;
      }

      const actorAllowed = Array.isArray(req.authUser?.allowedCompanyIds)
        ? req.authUser!.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
        : [];
      if (actorAllowed.length === 0) {
        res.status(403).json({
          ok: false,
          code: 'NO_COMPANY_ACCESS',
          error: 'حساب الإدارة لا يملك صلاحية الوصول لأي منشأة.',
        });
        return;
      }

      const nextAllowedCompanyIds = Array.isArray(body.allowedCompanyIds)
        ? body.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
        : existing?.allowedCompanyIds || [];

      if (
        !req.authUser?.isSuperAdmin &&
        nextAllowedCompanyIds.some((cid) => !actorAllowed.includes(cid))
      ) {
        res.status(403).json({
          ok: false,
          code: 'TENANT_ISOLATION_VIOLATION',
          error: 'عزل المنشآت: لا يمكنك إسناد مستخدم لمنشأة لا تملك صلاحيتها.',
        });
        return;
      }

      const nextRecord: ServerUserRecord = {
        id,
        username,
        fullName,
        role,
        isSuperAdmin: Boolean(req.authUser?.isSuperAdmin && body.isSuperAdmin),
        allowedCompanyIds: nextAllowedCompanyIds,
        branchId: String(body.branchId || existing?.branchId || 'br-01').trim(),
        active: body.active !== undefined ? Boolean(body.active) : existing?.active !== false,
        passwordHash,
        passwordSalt,
        mustChangePassword:
          body.mustChangePassword !== undefined
            ? Boolean(body.mustChangePassword)
            : Boolean(existing?.mustChangePassword),
        updatedAt: new Date().toISOString(),
      };

      authStore!.upsertUser(nextRecord);
      res.status(existing ? 200 : 201).json({
        ok: true,
        user: sanitizePublicUser(nextRecord),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed saving user',
      });
    }
  };

  app.post('/api/company/users', requireAuth, requireRoles(ADMIN_ROLES), handleUpsertScopedUser);
  app.post('/api/auth/users', requireAuth, requireRoles(ADMIN_ROLES), handleUpsertScopedUser);

  app.post('/api/auth/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const body = (req.body || {}) as { currentPassword?: string; newPassword?: string };
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');

      if (!verifyPasswordServer(currentPassword, user.passwordHash, user.passwordSalt)) {
        res.status(401).json({ ok: false, error: 'كلمة المرور الحالية غير صحيحة.' });
        return;
      }
      const strength = validatePasswordStrengthServer(newPassword);
      if (!strength.ok) {
        res.status(400).json({ ok: false, code: 'WEAK_PASSWORD', error: strength.error });
        return;
      }

      const hashed = hashPasswordPbkdf2Server(newPassword);
      if (pgRepo) {
        await pgRepo.updateUserPassword(user.id, hashed.hash, hashed.salt);
      } else {
        authStore!.upsertUser({
          ...user,
          passwordHash: hashed.hash,
          passwordSalt: hashed.salt,
          mustChangePassword: false,
          updatedAt: new Date().toISOString(),
        });
      }

      res.json({
        ok: true,
        user: sanitizePublicUser({
          ...user,
          mustChangePassword: false,
          updatedAt: new Date().toISOString(),
        }),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Password change failed',
      });
    }
  });

  // =========================================================================
  // Platform Super Admin Only Endpoints (Blocked 403 for Tenant Admin)
  // =========================================================================

  app.get('/api/admin/overview', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.json({ ok: true, totalCompanies: 0, totalUsers: 0, companies: [] });
        return;
      }
      const overview = await pgRepo.getAdminOverview();
      res.json({ ok: true, ...overview });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Admin overview failed',
      });
    }
  });

  app.get('/api/admin/companies', requireAuth, requireSuperAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      if (!pgRepo) {
        res.json({ ok: true, companies: [] });
        return;
      }
      const overview = await pgRepo.getAdminOverview();
      res.json({ ok: true, companies: overview.companies });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Admin companies failed',
      });
    }
  });

  // Protected WhatsApp Cloud API Dispatch Proxy with strict SSRF protection, RBAC & Rate Limit
  app.post(
    '/api/whatsapp/dispatch',
    requireAuth,
    requireRoles(WHATSAPP_ALLOWED_ROLES),
    whatsappRateLimiter,
    async (req: Request, res: Response) => {
      const body = (req.body || {}) as {
        endpoint?: string;
        phoneNumberId?: string;
        apiToken?: string;
        toPhone?: string;
        messageText?: string;
      };
      const token = String(body.apiToken || process.env.WHATSAPP_API_TOKEN || '').trim();
      const phoneId = String(body.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
      const toPhone = String(body.toPhone || '').replace(/[^\d]/g, '');
      const messageText = String(body.messageText || '').trim();

      const targetCheck = validateWhatsAppTarget({
        endpoint: body.endpoint,
        phoneNumberId: phoneId,
      });
      if (!targetCheck.ok) {
        res.status(targetCheck.status).json({
          ok: false,
          code: targetCheck.code,
          error: targetCheck.error,
        });
        return;
      }

      if (!token || !toPhone || !messageText) {
        res.status(422).json({
          ok: false,
          code: 'EXTERNAL_CREDENTIALS_REQUIRED',
          error:
            'إرسال WhatsApp Business API التلقائي يتطلب بيانات ربط رسمية (Phone Number ID + Bearer Token + رقم المستلم).',
        });
        return;
      }

      const fetchImpl = options.whatsappFetchImpl || fetch;
      try {
        const upstream = await fetchImpl(targetCheck.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            type: 'text',
            text: { body: messageText },
          }),
        });
        const data = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
          res.status(upstream.status).json({
            ok: false,
            code: 'WHATSAPP_UPSTREAM_ERROR',
            error: (data as { error?: { message?: string } })?.error?.message || 'WhatsApp API upstream error',
          });
          return;
        }
        res.json({ ok: true, providerResponse: data });
      } catch (err: unknown) {
        res.status(502).json({
          ok: false,
          code: 'WHATSAPP_NETWORK_ERROR',
          error: err instanceof Error ? err.message : 'Failed connecting to WhatsApp API',
        });
      }
    }
  );

  // Protected Server-Side Smart ERP Solutions Advisor via Gemini AI
  app.post(
    '/api/ai/analyze',
    requireAuth,
    requireRoles(AI_ALLOWED_ROLES),
    aiRateLimiter,
    async (req: Request, res: Response) => {
      try {
        const ai = getGeminiClient();
        if (!ai) {
          res.status(503).json({
            error:
              'خدمة التحليل الذكي بالذكاء الاصطناعي غير مفعّلة حالياً لعدم توفر GEMINI_API_KEY في إعدادات الخادم. يمكنك الاعتماد على الفاحص المحلي الفوري للنظام.',
            code: 'AI_KEY_MISSING',
          });
          return;
        }

        const body = (req.body || {}) as {
          lang?: 'ar' | 'en';
          question?: string;
          snapshot?: Record<string, unknown>;
          localFindings?: Array<Record<string, unknown>>;
        };

        const lang = body.lang === 'en' ? 'en' : 'ar';
        const question = String(body.question || '').trim().slice(0, 1200);
        const snapshotJson = JSON.stringify(body.snapshot || {}, null, 2).slice(0, 14000);
        const findingsJson = JSON.stringify((body.localFindings || []).slice(0, 15), null, 2).slice(0, 8000);

        const responseLanguageDirective =
          lang === 'en'
            ? 'Respond strictly in clear professional financial English.'
            : 'أجب باللغة العربية الفصحى المحاسبية الواضحة والمختصرة والعملية.';

        const prompt = [
          'You are a Principal ERP Financial & Inventory Solutions Architect for ALMANSOOR SMART FINANCE ERP.',
          'Analyze the live ERP telemetry snapshot and deterministic audit findings below, then produce accurate, concrete, actionable solutions grounded strictly in the provided figures (never invent account codes, customer names, or amounts that are not in the data).',
          responseLanguageDirective,
          '',
          '### Live ERP Snapshot:',
          snapshotJson,
          '',
          '### Deterministic Local Scanner Findings:',
          findingsJson,
          '',
          question
            ? `### User Question / Specific Request:\n${question}`
            : '### Task:\nProvide an executive diagnosis of financial health, cashflow/currency exposure, receivables risk, and inventory bottlenecks with concrete step-by-step solutions inside the ERP.',
        ].join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                executiveSummary: { type: Type.STRING },
                overallRisk: { type: Type.STRING, enum: ['low', 'moderate', 'high', 'critical'] },
                directAnswer: { type: Type.STRING },
                solutions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      priority: { type: Type.STRING, enum: ['critical', 'high', 'medium', 'low'] },
                      category: {
                        type: Type.STRING,
                        enum: ['accounting', 'liquidity', 'receivables', 'inventory', 'currency', 'operations'],
                      },
                      rootCause: { type: Type.STRING },
                      actionSteps: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      expectedImpact: { type: Type.STRING },
                      targetModule: {
                        type: Type.STRING,
                        enum: [
                          'accounting',
                          'treasury',
                          'inventory',
                          'customers',
                          'vendors',
                          'sales',
                          'purchases',
                          'expenses',
                          'reports',
                          'settings',
                        ],
                      },
                    },
                    required: ['title', 'priority', 'category', 'rootCause', 'actionSteps', 'expectedImpact', 'targetModule'],
                  },
                },
              },
              required: ['executiveSummary', 'overallRisk', 'directAnswer', 'solutions'],
            },
          },
        });

        const rawText = response.text || '';
        const parsed = JSON.parse(rawText);
        res.json({
          ok: true,
          analysis: parsed,
          generatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unexpected AI server error';
        const status =
          /429|quota|rate/i.test(msg) ? 429 : /401|403|permission|key/i.test(msg) ? 403 : /400|invalid/i.test(msg) ? 400 : 500;
        res.status(status).json({
          error: msg,
          code: status === 429 ? 'RATE_LIMIT' : status === 403 ? 'AUTH_ERROR' : 'AI_FAILURE',
        });
      }
    }
  );

  return app;
}
