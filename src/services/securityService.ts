/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Security, Salted Password Hashing, RBAC & Tenant Matrix, Sanitization & Validation
 */

import {
  User,
  UserRoleType,
  PermissionAction,
  GranularPermissionMatrix,
} from '../types/erp';

const DEFAULT_ROLE_PERMISSION_PRESETS: Record<UserRoleType, Record<string, Partial<Record<PermissionAction, boolean>>>> = {
  'مالك المؤسسة': {
    '*': { view: true, create: true, edit: true, delete: true, post: true, approve: true, export: true, print: true, manageSettings: true, viewCosts: true },
  },
  'مدير النظام': {
    '*': { view: true, create: true, edit: true, delete: true, post: true, approve: true, export: true, print: true, manageSettings: true, viewCosts: true },
  },
  'Tenant Admin': {
    '*': { view: true, create: true, edit: true, delete: true, post: true, approve: true, export: true, print: true, manageSettings: true, viewCosts: true },
  },
  'المدير المالي': {
    '*': { view: true, create: true, edit: true, delete: false, post: true, approve: true, export: true, print: true, manageSettings: false, viewCosts: true },
    accounting: { view: true, create: true, edit: true, delete: false, post: true, approve: true, export: true, print: true },
  },
  'محاسب': {
    '*': { view: true, create: true, edit: true, delete: false, post: true, approve: false, export: true, print: true, manageSettings: false, viewCosts: true },
  },
  'أمين الصندوق': {
    vouchers: { view: true, create: true, edit: true, delete: false, post: true, approve: false, export: true, print: true },
    sales: { view: true, create: true, edit: false, delete: false, post: true, approve: false, export: true, print: true },
    reports: { view: true, export: true, print: true },
  },
  'مسؤول المخزون': {
    inventory: { view: true, create: true, edit: true, delete: false, post: true, approve: false, export: true, print: true, viewCosts: true },
    purchases: { view: true, create: true, edit: false, delete: false, post: false, approve: false, export: true, print: true },
    reports: { view: true, export: true, print: true },
  },
  'مسؤول المبيعات': {
    sales: { view: true, create: true, edit: true, delete: false, post: true, approve: false, export: true, print: true, viewCosts: false },
    parties: { view: true, create: true, edit: true, delete: false, export: true, print: true },
    reports: { view: true, export: true, print: true },
  },
  'مسؤول المشتريات': {
    purchases: { view: true, create: true, edit: true, delete: false, post: true, approve: false, export: true, print: true, viewCosts: true },
    parties: { view: true, create: true, edit: true, delete: false, export: true, print: true },
    inventory: { view: true, viewCosts: true },
  },
  'مستخدم محدود': {
    '*': { view: true, create: false, edit: false, delete: false, post: false, approve: false, export: false, print: true, manageSettings: false, viewCosts: false },
  },
};

export function sanitizeInputText(input: unknown, maxLen = 600): string {
  const raw = String(input ?? '').replace(/\0/g, '').trim();
  // Strip unsafe HTML/script tags while keeping standard Arabic/English commercial punctuation
  const stripped = raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<\/?(iframe|object|embed|svg|style)[^>]*>/gi, '')
    .replace(/on\w+\s*=/gi, '');
  return stripped.slice(0, maxLen);
}

const PBKDF2_ITERATIONS = 210_000;

export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export function validatePasswordStrength(password: string): { ok: boolean; error?: string } {
  const candidate = String(password || '');
  if (candidate.length < 8) {
    return { ok: false, error: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.' };
  }
  if (!/[A-Za-z\u0600-\u06FF]/.test(candidate) || !/[0-9]/.test(candidate)) {
    return {
      ok: false,
      error: 'كلمة المرور يجب أن تحتوي على أحرف وأرقام معاً لتعزيز الأمان.',
    };
  }
  return { ok: true };
}

/**
 * Cryptographic random salt generator (128-bit default = 16 bytes -> 32 hex chars).
 */
export function generateSaltHex(bytes = 16): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('Cryptographic random number generator (crypto.getRandomValues) is unavailable.');
}

/**
 * @deprecated Legacy FNV-1a verifier retained solely to verify and transparently migrate pre-remediation v3sync$ hashes.
 */
export function hashPasswordSync(password: string, salt: string): string {
  const material = `${salt}::ALMANSOOR_ERP_V3::${password}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < material.length; i++) {
      const ch = material.charCodeAt(i);
      h1 ^= (ch + round * 17) & 0xff;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ h1, 0x85ebca6b) >>> 0;
    }
  }
  return `v3sync$${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

async function derivePbkdf2Hex(password: string, salt: string, iterations: number): Promise<string> {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WebCrypto SubtleCrypto is required for PBKDF2-SHA256 password hashing.');
  }
  const enc = new TextEncoder();
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: enc.encode(`${salt}::ALMANSOOR_ERP_V4`),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashLegacySha256(password: string, salt: string): Promise<string> {
  if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
    throw new Error('WebCrypto SubtleCrypto is required.');
  }
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}::ALMANSOOR_ERP_PBKDF::${password}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(digest));
  return `v3sha256$${arr.map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function hashPasswordAsync(
  password: string,
  salt: string,
  iterations = PBKDF2_ITERATIONS
): Promise<string> {
  const safeIter = Math.max(100_000, Math.floor(iterations));
  const derivedHex = await derivePbkdf2Hex(password, salt, safeIter);
  return `v4pbkdf2$${safeIter}$${derivedHex}`;
}

export function verifyPasswordSync(user: User, candidatePassword: string): boolean {
  if (!user.active || !candidatePassword) return false;
  if (!user.passwordHash || !user.passwordSalt) {
    return false;
  }
  if (user.passwordHash.startsWith('v3sync$')) {
    return constantTimeEqual(hashPasswordSync(candidatePassword, user.passwordSalt), user.passwordHash);
  }
  return false;
}

export async function verifyPasswordWithMigrationAsync(
  user: User,
  candidatePassword: string
): Promise<{ ok: boolean; upgradedHash?: string; upgradedSalt?: string }> {
  if (!user.active || !candidatePassword) return { ok: false };
  if (!user.passwordHash || !user.passwordSalt) {
    return { ok: false };
  }

  if (user.passwordHash.startsWith('v4pbkdf2$')) {
    const parts = user.passwordHash.split('$');
    if (parts.length !== 3) return { ok: false };
    const iter = Number(parts[1]);
    const expectedHex = parts[2];
    if (!Number.isFinite(iter) || iter < 10_000 || !expectedHex) return { ok: false };
    const actualHex = await derivePbkdf2Hex(candidatePassword, user.passwordSalt, iter);
    if (!constantTimeEqual(actualHex, expectedHex)) return { ok: false };
    if (iter < PBKDF2_ITERATIONS) {
      const upgradedSalt = generateSaltHex(16);
      const upgradedHash = await hashPasswordAsync(candidatePassword, upgradedSalt, PBKDF2_ITERATIONS);
      return { ok: true, upgradedHash, upgradedSalt };
    }
    return { ok: true };
  }

  if (user.passwordHash.startsWith('v3sha256$')) {
    const computed = await hashLegacySha256(candidatePassword, user.passwordSalt);
    if (!constantTimeEqual(computed, user.passwordHash)) return { ok: false };
    const upgradedSalt = generateSaltHex(16);
    const upgradedHash = await hashPasswordAsync(candidatePassword, upgradedSalt, PBKDF2_ITERATIONS);
    return { ok: true, upgradedHash, upgradedSalt };
  }

  if (user.passwordHash.startsWith('v3sync$')) {
    const syncOk = verifyPasswordSync(user, candidatePassword);
    if (!syncOk) return { ok: false };
    const upgradedSalt = generateSaltHex(16);
    const upgradedHash = await hashPasswordAsync(candidatePassword, upgradedSalt, PBKDF2_ITERATIONS);
    return { ok: true, upgradedHash, upgradedSalt };
  }

  return { ok: false };
}

export async function verifyPasswordAsync(user: User, candidatePassword: string): Promise<boolean> {
  const res = await verifyPasswordWithMigrationAsync(user, candidatePassword);
  return res.ok;
}

export function buildUserRoleMatrix(role: UserRoleType): GranularPermissionMatrix {
  return JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSION_PRESETS[role] || DEFAULT_ROLE_PERMISSION_PRESETS['مستخدم محدود']));
}

export function isPlatformSuperAdmin(
  user: { isSuperAdmin?: boolean; role?: string } | null | undefined
): boolean {
  return Boolean(
    user &&
      (user.isSuperAdmin === true ||
        (user.role === 'مالك المؤسسة' && user.isSuperAdmin !== false))
  );
}

export function isTenantAdminUser(
  user: { role?: string; canManageSettings?: boolean } | null | undefined
): boolean {
  if (!user) return false;
  return (
    user.role === 'Tenant Admin' ||
    user.role === 'مالك المؤسسة' ||
    user.role === 'مدير النظام' ||
    Boolean(user.canManageSettings)
  );
}

export function getRoleDisplayLabel(role: string, lang: 'ar' | 'en' = 'ar'): string {
  if (role === 'Tenant Admin') {
    return lang === 'en' ? 'Tenant Admin' : 'مدير المنشأة (Tenant Admin)';
  }
  return role;
}

export function hasGranularPermission(
  user: User | null | undefined,
  moduleKey: string,
  action: PermissionAction
): boolean {
  if (!user || !user.active) return false;
  if (
    user.role === 'مالك المؤسسة' ||
    user.role === 'مدير النظام' ||
    user.role === 'Tenant Admin'
  ) {
    return true;
  }

  // Check explicit user permissionMatrix first
  const matrix = user.permissionMatrix;
  if (matrix) {
    if (matrix[moduleKey] && typeof matrix[moduleKey][action] === 'boolean') {
      return Boolean(matrix[moduleKey][action]);
    }
    if (matrix['*'] && typeof matrix['*'][action] === 'boolean') {
      return Boolean(matrix['*'][action]);
    }
  }

  // Fallback to legacy boolean flags on User
  switch (action) {
    case 'post':
      if (moduleKey === 'inventory') return Boolean(user.canAdjustInventory || user.canPostEntries);
      return Boolean(user.canPostEntries);
    case 'approve':
      return user.role === 'المدير المالي' || Boolean(user.canManageSettings);
    case 'manageSettings':
      return Boolean(user.canManageSettings);
    case 'viewCosts':
      return Boolean(user.canViewCostsAndProfits);
    case 'export':
    case 'print':
    case 'view':
      return moduleKey === 'reports' ? Boolean(user.canViewReports) : true;
    case 'edit':
      if (moduleKey === 'sales' || moduleKey === 'purchases') return user.canEditInvoices !== false;
      if (moduleKey === 'vouchers') return user.canEditVouchers !== false;
      if (moduleKey === 'currencies') return Boolean(user.canEditExchangeRates ?? user.canManageSettings);
      if (moduleKey === 'settings') return Boolean(user.canManageSettings);
      if (moduleKey === 'accounting') return Boolean(user.canPostEntries);
      if (moduleKey === 'inventory') return Boolean(user.canAdjustInventory || user.canPostEntries);
      return user.role !== 'مستخدم محدود';
    case 'delete':
      if (moduleKey === 'sales' || moduleKey === 'purchases') return Boolean(user.canDeleteInvoices);
      if (moduleKey === 'vouchers') return Boolean(user.canDeleteVouchers);
      return false;
    case 'create':
      if (moduleKey === 'settings') return Boolean(user.canManageSettings);
      if (moduleKey === 'currencies') return Boolean(user.canEditExchangeRates ?? user.canManageSettings);
      if (moduleKey === 'inventory') return Boolean(user.canAdjustInventory || user.canPostEntries);
      if (moduleKey === 'accounting') return Boolean(user.canPostEntries);
      return user.role !== 'مستخدم محدود';
    default:
      return false;
  }
}

export function assertPermission(
  user: User | null | undefined,
  moduleKey: string,
  action: PermissionAction
): { ok: true } | { ok: false; error: string } {
  if (!user) {
    return { ok: false, error: 'تعذر تنفيذ العملية: لا توجد جلسة مستخدم نشطة.' };
  }
  if (!user.active) {
    return { ok: false, error: 'هذا الحساب موقوف إدارياً ولا يملك صلاحية التنفيذ.' };
  }
  if (!hasGranularPermission(user, moduleKey, action)) {
    return {
      ok: false,
      error: `صلاحية مرفوضة: المستخدم (${user.fullName}) لا يملك صلاحية (${action}) على وحدة (${moduleKey}).`,
    };
  }
  return { ok: true };
}

export function assertTenantAccess(
  user: User | null | undefined,
  targetCompanyId?: string
): { ok: true } | { ok: false; error: string } {
  if (!user) return { ok: false, error: 'لا توجد جلسة مستخدم نشطة.' };
  if (!user.active) {
    return { ok: false, error: 'هذا الحساب موقوف إدارياً ولا يملك صلاحية الوصول.' };
  }
  const cleanTarget = String(targetCompanyId || '').trim();
  if (!cleanTarget) {
    return {
      ok: false,
      error: 'عزل المنشآت: معرف الشركة المستهدفة مفقود، تم رفض الوصول.',
    };
  }
  const allowed = Array.isArray(user.allowedCompanyIds)
    ? user.allowedCompanyIds.map((c) => String(c).trim()).filter(Boolean)
    : [];
  if (allowed.length === 0) {
    return {
      ok: false,
      error: `عزل المنشآت: المستخدم (${user.fullName}) لا يملك منشآت مصرحاً بها.`,
    };
  }
  if (!allowed.includes(cleanTarget)) {
    return {
      ok: false,
      error: `عزل المنشآت: المستخدم (${user.fullName}) غير مخول للوصول إلى بيانات الشركة (${cleanTarget}).`,
    };
  }
  return { ok: true };
}

export interface UploadValidationResult {
  ok: boolean;
  error?: string;
}

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_DATA_EXT = /\.(csv|xlsx|xls|json|enc)$/i;

export function validateUploadFile(
  file: { name: string; size: number; type?: string },
  kind: 'image' | 'spreadsheet' | 'backup'
): UploadValidationResult {
  const maxBytes = kind === 'image' ? 3 * 1024 * 1024 : 40 * 1024 * 1024;
  if (file.size <= 0) {
    return { ok: false, error: 'الملف المحدد فارغ (0 بايت).' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: `حجم الملف يتجاوز الحد الأقصى المسموح (${Math.round(maxBytes / 1024 / 1024)} MB).` };
  }
  const cleanName = file.name.trim();
  if (/\.(exe|bat|cmd|sh|js|html|htm|svg|php)$/i.test(cleanName)) {
    return { ok: false, error: 'تم رفض الملف: صيغة الملف غير مسموحة لأسباب أمنية.' };
  }
  if (kind === 'image') {
    if (file.type && !ALLOWED_IMAGE_MIME.has(file.type)) {
      return { ok: false, error: 'صيغ الصور المسموحة فقط: PNG, JPG, WEBP.' };
    }
  } else {
    if (!ALLOWED_DATA_EXT.test(cleanName)) {
      return { ok: false, error: 'امتداد الملف غير مدعوم. الصيغ المسموحة: CSV, XLSX, XLS, JSON, ENC.' };
    }
  }
  return { ok: true };
}
