/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Hardened Express Application Factory
 * Auth (PBKDF2-SHA256 + HttpOnly Signed Cookies), RBAC, Rate Limiting, SSRF Guard, Gemini AI Proxy
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export interface ServerUserRecord {
  id: string;
  username: string;
  fullName: string;
  role: string;
  allowedCompanyIds: string[];
  branchId: string;
  active: boolean;
  passwordHash: string;
  passwordSalt: string;
  mustChangePassword?: boolean;
  updatedAt: string;
}

export type PublicServerUser = Omit<ServerUserRecord, 'passwordHash' | 'passwordSalt'>;

export interface SessionPayload {
  userId: string;
  username: string;
  role: string;
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
  'المدير المالي',
  'محاسب',
  'مسؤول المخزون',
  'مسؤول المبيعات',
  'مسؤول المشتريات',
]);

const WHATSAPP_ALLOWED_ROLES = new Set([
  'مالك المؤسسة',
  'مدير النظام',
  'المدير المالي',
  'محاسب',
  'مسؤول المبيعات',
  'أمين الصندوق',
]);

const ADMIN_ROLES = new Set(['مالك المؤسسة', 'مدير النظام']);

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
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    allowedCompanyIds: [...(user.allowedCompanyIds || [])],
    branchId: user.branchId,
    active: user.active,
    mustChangePassword: Boolean(user.mustChangePassword),
    updatedAt: user.updatedAt,
  };
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

  const storePath = options.inMemoryAuthStore
    ? null
    : options.authStorePath || path.resolve('.erp-auth-users.json');
  const authStore = new AuthUserStore(storePath, options.initialUsers);

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

  const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
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
    const storedUser = authStore.findById(verified.payload.userId);
    if (!storedUser || !storedUser.active) {
      res.status(401).json({
        ok: false,
        code: 'ACCOUNT_DISABLED',
        error: 'حساب المستخدم غير مفعل أو غير موجود.',
      });
      return;
    }
    req.authSession = verified.payload;
    req.authUser = storedUser;
    next();
  };

  const requireRoles = (allowed: Set<string>) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
      const role = req.authUser?.role || '';
      if (!allowed.has(role)) {
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

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Baseline HTTP Security Headers (OWASP ASVS alignment)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const loginRateLimiter = createRateLimiter(options.rateLimits?.loginPerMinute ?? 15);
  const aiRateLimiter = createRateLimiter(options.rateLimits?.aiPerMinute ?? 20);
  const whatsappRateLimiter = createRateLimiter(options.rateLimits?.whatsappPerMinute ?? 30);

  // Health & readiness endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');
    res.json({
      ok: true,
      service: 'almansoor-erp-server',
      aiConfigured,
      productionMode: isProduction,
      authInitialized: authStore.hasAnyUsers(),
      timestamp: new Date().toISOString(),
    });
  });

  // Legacy passwordless session minting endpoint is explicitly disabled
  app.post('/api/auth/session', (_req: Request, res: Response) => {
    res.status(410).json({
      ok: false,
      code: 'PASSWORDLESS_SESSION_DISABLED',
      error: 'تم إلغاء إنشاء الجلسات بدون التحقق من كلمة المرور. يرجى استخدام /api/auth/login.',
    });
  });

  app.get('/api/auth/status', (req: Request, res: Response) => {
    const token = extractToken(req);
    let activeUser: PublicServerUser | null = null;
    if (token) {
      const verified = verifySessionToken(token);
      if (verified.valid) {
        const u = authStore.findById(verified.payload.userId);
        if (u && u.active) {
          activeUser = sanitizePublicUser(u);
        }
      }
    }
    res.json({
      ok: true,
      initialized: authStore.hasAnyUsers(),
      authenticated: Boolean(activeUser),
      user: activeUser,
    });
  });

  // Initial Owner Account Bootstrap (ONLY allowed when zero server users exist)
  app.post('/api/auth/bootstrap', (req: Request, res: Response) => {
    if (authStore.hasAnyUsers()) {
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
      allowedCompanyIds?: string[];
      branchId?: string;
      password?: string;
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
        : ['comp-01'];

    const ownerRecord: ServerUserRecord = {
      id: String(body.id || 'usr-01').trim(),
      username,
      fullName,
      role: 'مالك المؤسسة',
      allowedCompanyIds,
      branchId: String(body.branchId || 'br-01').trim(),
      active: true,
      passwordHash: hash,
      passwordSalt: salt,
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
    };

    authStore.upsertUser(ownerRecord);

    const now = Date.now();
    const token = signSessionToken({
      userId: ownerRecord.id,
      username: ownerRecord.username,
      role: ownerRecord.role,
      companyId: allowedCompanyIds[0] || 'comp-01',
      allowedCompanyIds,
      iat: now,
      exp: now + SESSION_TTL_MS,
    });

    setSessionCookie(req, res, token, isProduction);
    res.status(201).json({
      ok: true,
      user: sanitizePublicUser(ownerRecord),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
  });

  // Real Password-Verified Login
  app.post('/api/auth/login', loginRateLimiter, (req: Request, res: Response) => {
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

    const record = userId ? authStore.findById(userId) : authStore.findByUsername(username);
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
        : allowedCompanies[0];

    const now = Date.now();
    const token = signSessionToken({
      userId: record.id,
      username: record.username,
      role: record.role,
      companyId: activeCompanyId,
      allowedCompanyIds: allowedCompanies,
      iat: now,
      exp: now + SESSION_TTL_MS,
    });

    setSessionCookie(req, res, token, isProduction);
    res.json({
      ok: true,
      user: sanitizePublicUser(record),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    });
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

  // Admin-only Server User Provisioning / Password Reset Sync
  app.post(
    '/api/auth/users',
    requireAuth,
    requireRoles(ADMIN_ROLES),
    (req: AuthenticatedRequest, res: Response) => {
      const body = (req.body || {}) as {
        id?: string;
        username?: string;
        fullName?: string;
        role?: string;
        allowedCompanyIds?: string[];
        branchId?: string;
        active?: boolean;
        password?: string;
        mustChangePassword?: boolean;
      };

      const id = String(body.id || '').trim();
      const username = String(body.username || '').trim();
      const fullName = String(body.fullName || '').trim();
      const role = String(body.role || '').trim();
      if (!id || !username || !fullName || !role) {
        res.status(400).json({ ok: false, error: 'بيانات المستخدم غير مكتملة.' });
        return;
      }

      const existing = authStore.findById(id);
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
        res.status(403).json({ ok: false, code: 'NO_COMPANY_ACCESS', error: 'حساب الإدارة لا يملك صلاحية الوصول لأي منشأة.' });
        return;
      }

      const nextAllowedCompanyIds = Array.isArray(body.allowedCompanyIds)
        ? body.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
        : existing?.allowedCompanyIds || [];

      const nextRecord: ServerUserRecord = {
        id,
        username,
        fullName,
        role,
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

      authStore.upsertUser(nextRecord);
      res.status(existing ? 200 : 201).json({
        ok: true,
        user: sanitizePublicUser(nextRecord),
      });
    }
  );

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
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
    const updated: ServerUserRecord = {
      ...user,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
    };
    authStore.upsertUser(updated);
    res.json({ ok: true, user: sanitizePublicUser(updated) });
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
