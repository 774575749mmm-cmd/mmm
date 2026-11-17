/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Real Authenticated Login, First-Boot Activation, Tenant Registration & Password Update Modal
 */

import React, { useState, useEffect } from 'react';
import { Shield, Lock, UserCheck, KeyRound, AlertTriangle, CheckCircle2, X, Building2 } from 'lucide-react';
import { CountryPackCode, User } from '../../types/erp';
import {
  generateSaltHex,
  hashPasswordAsync,
  validatePasswordStrength,
  verifyPasswordWithMigrationAsync,
} from '../../services/securityService';
import {
  cloudApiService,
  serverUserToErpUser,
  type ServerPublicUserDto,
} from '../../services/cloudApiService';
import { COUNTRY_COMPLIANCE_PACKS } from '../../services/countryComplianceService';
import { AppLanguage } from '../../services/i18n';

export interface CloudLoginMeta {
  cloudAuthenticated: boolean;
  activeCompanyId?: string | null;
}

interface LoginModalProps {
  isOpen: boolean;
  mode: 'bootstrap' | 'login' | 'force_change_password';
  users: User[];
  activeCompanyId: string;
  allCompanyIds: string[];
  pendingUserForPasswordChange?: User | null;
  canCancel?: boolean;
  lang: AppLanguage;
  onBootstrapComplete: (updatedOwner: User) => void;
  onLoginSuccess: (
    user: User,
    migratedCredentials?: { passwordHash: string; passwordSalt: string },
    meta?: CloudLoginMeta
  ) => void;
  onPasswordChanged: (updatedUser: User) => void;
  onCancel?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  mode,
  users,
  activeCompanyId,
  allCompanyIds,
  pendingUserForPasswordChange,
  canCancel = false,
  lang,
  onBootstrapComplete,
  onLoginSuccess,
  onPasswordChanged,
  onCancel,
}) => {
  const isEn = lang === 'en';
  const [username, setUsername] = useState(users[0]?.username || 'admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [fullName, setFullName] = useState('');
  const [companyNameAr, setCompanyNameAr] = useState('');
  const [countryCode, setCountryCode] = useState<CountryPackCode>('YE');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setIsRegisterMode(false);
    if (mode === 'bootstrap') {
      const owner = users.find((u) => u.role === 'مالك المؤسسة') || users[0];
      if (owner) setUsername(owner.username);
    }
  }, [isOpen, mode, users]);

  if (!isOpen) return null;

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setError(strength.error || 'كلمة المرور ضعيفة.');
      return;
    }
    if (password !== confirmPassword) {
      setError(isEn ? 'Passwords do not match.' : 'تأكيد كلمة المرور غير متطابق.');
      return;
    }

    setIsSubmitting(true);
    try {
      const owner =
        users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase()) ||
        users.find((u) => u.role === 'مالك المؤسسة') ||
        users[0];
      if (!owner) {
        setError(isEn ? 'Owner account not found.' : 'تعذر العثور على حساب المالك.');
        return;
      }

      const companyScope =
        allCompanyIds.length > 0 ? allCompanyIds : [activeCompanyId || 'comp-01'];

      const resp = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: owner.id,
          username: owner.username,
          fullName: owner.fullName,
          allowedCompanyIds: companyScope,
          branchId: owner.branchId,
          password,
        }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(
          body?.error ||
            (isEn ? 'Failed initializing owner credentials.' : 'تعذر تفعيل كلمة مرور المالك على الخادم.')
        );
        return;
      }

      const salt = generateSaltHex(16);
      const hash = await hashPasswordAsync(password, salt);
      const updatedOwner: User = {
        ...owner,
        isSuperAdmin: true,
        passwordSalt: salt,
        passwordHash: hash,
        mustChangePassword: false,
        allowedCompanyIds: Array.from(
          new Set([...(owner.allowedCompanyIds || []), ...companyScope])
        ),
      };
      onBootstrapComplete(updatedOwner);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected bootstrap error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanUser = username.trim();
    const cleanFull = fullName.trim();
    const cleanCompany = companyNameAr.trim();

    if (!cleanUser || !cleanFull || !cleanCompany) {
      setError(
        isEn
          ? 'Please enter full name, username, and company name.'
          : 'يرجى إدخال الاسم الكامل واسم الدخول واسم المنشأة الجديدة.'
      );
      return;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setError(strength.error || 'كلمة المرور ضعيفة.');
      return;
    }
    if (password !== confirmPassword) {
      setError(isEn ? 'Passwords do not match.' : 'تأكيد كلمة المرور غير متطابق.');
      return;
    }

    setIsSubmitting(true);
    try {
      const pack = COUNTRY_COMPLIANCE_PACKS[countryCode];
      const regRes = await cloudApiService.register({
        username: cleanUser,
        fullName: cleanFull,
        password,
        company: {
          nameAr: cleanCompany,
          nameEn: cleanCompany,
          countryCode,
          baseCurrency: pack.baseCurrency,
        },
      });

      if (!regRes.ok || !regRes.data.user) {
        setError(
          regRes.data.error ||
            (isEn ? 'Failed registering tenant account.' : 'تعذر إنشاء الحساب والمنشأة الجديدة.')
        );
        return;
      }

      const erpUser = serverUserToErpUser(regRes.data.user);
      onLoginSuccess(erpUser, undefined, {
        cloudAuthenticated: true,
        activeCompanyId: regRes.data.activeCompanyId,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanUser = username.trim();
    if (!cleanUser || !password) {
      setError(
        isEn
          ? 'Please enter username and password.'
          : 'يرجى إدخال اسم المستخدم وكلمة المرور.'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const localUser = users.find(
        (u) => u.username.trim().toLowerCase() === cleanUser.toLowerCase()
      );

      // 1. Server-verified login (PostgreSQL authoritative session)
      const serverResp = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUser,
          password,
        }),
      });

      if (serverResp.ok) {
        const data = (await serverResp.json().catch(() => ({}))) as {
          user?: ServerPublicUserDto;
          activeCompanyId?: string;
        };
        if (!data.user) {
          setError(isEn ? 'Invalid server response.' : 'استجابة الخادم غير مكتملة.');
          return;
        }
        const serverErpUser = serverUserToErpUser(data.user);
        if (!serverErpUser.active) {
          setError(isEn ? 'This account is inactive.' : 'هذا الحساب موقوف إدارياً.');
          return;
        }
        onLoginSuccess(serverErpUser, undefined, {
          cloudAuthenticated: true,
          activeCompanyId: data.activeCompanyId || serverErpUser.allowedCompanyIds?.[0] || null,
        });
        return;
      }

      // 2. Server rejected login (401/403): NEVER bypass explicit server denials!
      const serverErr = (await serverResp.json().catch(() => ({}))) as { code?: string; error?: string };
      if (
        serverResp.status >= 400 &&
        serverResp.status < 500 &&
        serverErr?.code !== 'NOT_FOUND'
      ) {
        setError(
          serverErr?.error ||
            (isEn
              ? 'Invalid username or password, or account disabled.'
              : 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب غير مخول.')
        );
        return;
      }

      // 3. Offline local-only fallback ONLY if server is unreachable / 5xx offline
      if (localUser && localUser.active && localUser.passwordHash && localUser.passwordSalt) {
        const check = await verifyPasswordWithMigrationAsync(localUser, password);
        if (check.ok) {
          const migrated =
            check.upgradedHash && check.upgradedSalt
              ? { passwordHash: check.upgradedHash, passwordSalt: check.upgradedSalt }
              : undefined;
          onLoginSuccess(localUser, migrated, { cloudAuthenticated: false });
          return;
        }
      }

      setError(
        serverErr?.error ||
          (isEn
            ? 'Invalid username or password, or account not yet activated.'
            : 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب غير مفعل بكلمة مرور.')
      );
    } catch (err: unknown) {
      // Network offline fallback if user exists locally with valid PBKDF2 hash
      const localUser = users.find(
        (u) => u.username.trim().toLowerCase() === cleanUser.toLowerCase()
      );
      if (localUser && localUser.active && localUser.passwordHash && localUser.passwordSalt) {
        const check = await verifyPasswordWithMigrationAsync(localUser, password);
        if (check.ok) {
          const migrated =
            check.upgradedHash && check.upgradedSalt
              ? { passwordHash: check.upgradedHash, passwordSalt: check.upgradedSalt }
              : undefined;
          onLoginSuccess(localUser, migrated, { cloudAuthenticated: false });
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Login error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForceChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!pendingUserForPasswordChange) return;

    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setError(strength.error || 'كلمة المرور ضعيفة.');
      return;
    }
    if (password !== confirmPassword) {
      setError(isEn ? 'Passwords do not match.' : 'تأكيد كلمة المرور غير متطابق.');
      return;
    }

    setIsSubmitting(true);
    try {
      const salt = generateSaltHex(16);
      const hash = await hashPasswordAsync(password, salt);
      await cloudApiService
        .saveCompanyUser({
          id: pendingUserForPasswordChange.id,
          username: pendingUserForPasswordChange.username,
          fullName: pendingUserForPasswordChange.fullName,
          role: pendingUserForPasswordChange.role,
          allowedCompanyIds: pendingUserForPasswordChange.allowedCompanyIds || [activeCompanyId],
          branchId: pendingUserForPasswordChange.branchId,
          active: pendingUserForPasswordChange.active,
          password,
          mustChangePassword: false,
        })
        .catch(() => null);

      onPasswordChanged({
        ...pendingUserForPasswordChange,
        passwordSalt: salt,
        passwordHash: hash,
        mustChangePassword: false,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      dir={isEn ? 'ltr' : 'rtl'}
    >
      <div className="v20-card w-full max-w-md p-6 space-y-4 border-2 border-[var(--gold)] shadow-2xl">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--border-strong)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-[var(--gold)]/15 border border-[var(--gold)] flex items-center justify-center text-[var(--gold)]">
              {isRegisterMode ? <Building2 className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-black text-sm text-[var(--gold)]">
                {mode === 'bootstrap'
                  ? isEn
                    ? 'Initial Owner Activation'
                    : 'التفعيل الأمني الأولي لحساب المالك'
                  : mode === 'force_change_password'
                  ? isEn
                    ? 'Mandatory Password Update'
                    : 'تغيير كلمة المرور الإلزامي'
                  : isRegisterMode
                  ? isEn
                    ? 'Register New Tenant & Company'
                    : 'تسجيل حساب ومنشأة جديدة مستقلة'
                  : isEn
                  ? 'ALMANSOOR ERP — Secure Sign In'
                  : 'تسجيل الدخول الآمن — نظام المنصور'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {mode === 'bootstrap'
                  ? isEn
                    ? 'Set a strong PBKDF2-protected password to unlock the ERP workspace.'
                    : 'قم بتعيين كلمة مرور قوية (8 أحرف على الأقل: أحرف + أرقام) لحماية النظام.'
                  : mode === 'force_change_password'
                  ? isEn
                    ? 'Set your personal password before accessing financial operations.'
                    : 'يرجى تعيين كلمة مرور خاصة بك قبل متابعة العمل المحاسبي.'
                  : isRegisterMode
                  ? isEn
                    ? 'Creates an isolated company workspace in PostgreSQL with Tenant Admin access.'
                    : 'ينشئ منشأة معزولة بالكامل في PostgreSQL بصلاحية مدير المنشأة (Tenant Admin).'
                  : isEn
                  ? 'Password authentication is required for every account and role switch.'
                  : 'التحقق بكلمة المرور إلزامي للدخول وتبديل المستخدمين.'}
              </p>
            </div>
          </div>
          {canCancel && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-slate-400 hover:text-white cursor-pointer"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form
          onSubmit={
            mode === 'bootstrap'
              ? handleBootstrap
              : mode === 'force_change_password'
              ? handleForceChangePassword
              : isRegisterMode
              ? handleRegisterTenant
              : handleLogin
          }
          className="space-y-3 text-xs"
        >
          {mode === 'login' && isRegisterMode && (
            <>
              <div>
                <label className="block font-bold text-slate-300 mb-1">
                  {isEn ? 'Company Name (Arabic) *' : 'اسم المنشأة الجديدة *'}
                </label>
                <input
                  type="text"
                  required
                  value={companyNameAr}
                  onChange={(e) => setCompanyNameAr(e.target.value)}
                  placeholder="مثال: شركة الرواد للتجارة"
                  className="w-full v20-input px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-bold text-slate-300 mb-1">
                    {isEn ? 'Full Name *' : 'الاسم الكامل *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="أحمد محمد"
                    className="w-full v20-input px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-300 mb-1">
                    {isEn ? 'Country Pack' : 'حزمة الدولة والعملة'}
                  </label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value as CountryPackCode)}
                    className="w-full v20-input px-2 py-2 cursor-pointer"
                  >
                    {Object.values(COUNTRY_COMPLIANCE_PACKS).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.nameAr} ({p.baseCurrency})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {mode !== 'force_change_password' && (
            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-[var(--gold)]" />
                <span>{isEn ? 'Username' : 'اسم المستخدم'}</span>
              </label>
              <input
                type="text"
                required
                readOnly={mode === 'bootstrap'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full v20-input px-3 py-2 font-mono"
                autoComplete="username"
              />
            </div>
          )}

          <div>
            <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[var(--gold)]" />
              <span>
                {mode === 'bootstrap' || mode === 'force_change_password' || isRegisterMode
                  ? isEn
                    ? 'New Strong Password'
                    : 'كلمة المرور (أحرف + أرقام، 8+ خانات)'
                  : isEn
                  ? 'Password'
                  : 'كلمة المرور'}
              </span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full v20-input px-3 py-2 font-mono"
              autoComplete={mode === 'login' && !isRegisterMode ? 'current-password' : 'new-password'}
            />
          </div>

          {(mode === 'bootstrap' || mode === 'force_change_password' || isRegisterMode) && (
            <div>
              <label className="block font-bold text-slate-300 mb-1 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isEn ? 'Confirm Password' : 'تأكيد كلمة المرور'}</span>
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full v20-input px-3 py-2 font-mono"
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/60 text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {canCancel && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 rounded-lg bg-[#08121E] border border-[var(--border-strong)] text-slate-200 cursor-pointer"
              >
                {isEn ? 'Cancel' : 'إلغاء'}
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 rounded-lg v20-btn-gold font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isSubmitting
                  ? isEn
                    ? 'Verifying...'
                    : 'جاري التحقق...'
                  : mode === 'bootstrap'
                  ? isEn
                    ? 'Activate Owner & Enter ERP'
                    : 'تفعيل حساب المالك والدخول'
                  : mode === 'force_change_password'
                  ? isEn
                    ? 'Save Password & Continue'
                    : 'حفظ كلمة المرور والدخول'
                  : isRegisterMode
                  ? isEn
                    ? 'Create Account & Company'
                    : 'إنشاء الحساب والمنشأة'
                  : isEn
                  ? 'Sign In'
                  : 'دخول آمن'}
              </span>
            </button>
          </div>

          {mode === 'login' && (
            <div className="pt-2 border-t border-[var(--border-strong)] text-center">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setIsRegisterMode((prev) => !prev);
                }}
                className="text-[11px] font-bold text-amber-300 hover:text-amber-200 underline cursor-pointer"
              >
                {isRegisterMode
                  ? isEn
                    ? 'Back to Sign In'
                    : 'العودة إلى تسجيل الدخول بحساب قائم'
                  : isEn
                  ? 'Create a New Independent Tenant Account & Company'
                  : 'تسجيل حساب ومنشأة جديدة مستقلة (Tenant)'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
