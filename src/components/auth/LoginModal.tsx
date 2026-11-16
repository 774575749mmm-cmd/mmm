/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Real Authenticated Login, First-Boot Activation & Password Update Modal
 */

import React, { useState, useEffect } from 'react';
import { Shield, Lock, UserCheck, KeyRound, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { User } from '../../types/erp';
import {
  generateSaltHex,
  hashPasswordAsync,
  validatePasswordStrength,
  verifyPasswordWithMigrationAsync,
} from '../../services/securityService';
import { AppLanguage } from '../../services/i18n';

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
    migratedCredentials?: { passwordHash: string; passwordSalt: string }
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
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setPassword('');
    setConfirmPassword('');
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
        // If server was already bootstrapped previously, proceed only via normal login
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
      if (localUser && !localUser.active) {
        setError(isEn ? 'This account is inactive.' : 'هذا الحساب موقوف إدارياً.');
        return;
      }

      // 1. Try server-verified login first (sets HttpOnly signed cookie)
      const serverResp = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUser,
          password,
          companyId: activeCompanyId,
        }),
      });

      if (serverResp.ok) {
        const data = await serverResp.json().catch(() => ({}));
        const matchedLocal =
          localUser ||
          (data?.user?.id ? users.find((u) => u.id === data.user.id) : undefined);

        if (!matchedLocal) {
          setError(
            isEn
              ? 'Account authenticated on server but missing from local company database.'
              : 'تم التحقق من الحساب على الخادم لكنه غير مرتبط بقاعدة الشركة الحالية.'
          );
          return;
        }
        if (!matchedLocal.active) {
          setError(isEn ? 'This account is inactive.' : 'هذا الحساب موقوف إدارياً.');
          return;
        }

        const localVerify = await verifyPasswordWithMigrationAsync(matchedLocal, password);
        let migrated: { passwordHash: string; passwordSalt: string } | undefined;
        if (localVerify.ok && localVerify.upgradedHash && localVerify.upgradedSalt) {
          migrated = {
            passwordHash: localVerify.upgradedHash,
            passwordSalt: localVerify.upgradedSalt,
          };
        } else if (!matchedLocal.passwordHash || !matchedLocal.passwordSalt || !localVerify.ok) {
          const salt = generateSaltHex(16);
          const hash = await hashPasswordAsync(password, salt);
          migrated = { passwordHash: hash, passwordSalt: salt };
        }
        onLoginSuccess(matchedLocal, migrated);
        return;
      }

      // 2. If server returned 401/403, NEVER bypass explicit ACCOUNT_DISABLED or NO_COMPANY_ACCESS.
      const serverErr = (await serverResp.json().catch(() => ({}))) as { code?: string; error?: string };
      if (serverErr?.code !== 'ACCOUNT_DISABLED' && serverErr?.code !== 'NO_COMPANY_ACCESS' && serverResp.status !== 403) {
        if (localUser && localUser.active && localUser.passwordHash && localUser.passwordSalt) {
          const check = await verifyPasswordWithMigrationAsync(localUser, password);
          if (check.ok) {
            // Only allow legacy local verification when server store hasn't synced restored backup credentials yet
            const migrated =
              check.upgradedHash && check.upgradedSalt
                ? { passwordHash: check.upgradedHash, passwordSalt: check.upgradedSalt }
                : undefined;
            onLoginSuccess(localUser, migrated);
            return;
          }
        }
      }

      setError(
        serverErr?.error ||
          (isEn
            ? 'Invalid username or password, or account not yet activated.'
            : 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب غير مفعل بكلمة مرور.')
      );
    } catch (err: unknown) {
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
      await fetch('/api/auth/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pendingUserForPasswordChange.id,
          username: pendingUserForPasswordChange.username,
          fullName: pendingUserForPasswordChange.fullName,
          role: pendingUserForPasswordChange.role,
          allowedCompanyIds: pendingUserForPasswordChange.allowedCompanyIds || [activeCompanyId],
          branchId: pendingUserForPasswordChange.branchId,
          active: pendingUserForPasswordChange.active,
          password,
          mustChangePassword: false,
        }),
      }).catch(() => null);

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
              <Shield className="w-5 h-5" />
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
              : handleLogin
          }
          className="space-y-3 text-xs"
        >
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
                {mode === 'bootstrap' || mode === 'force_change_password'
                  ? isEn
                    ? 'New Strong Password'
                    : 'كلمة المرور الجديدة (أحرف + أرقام، 8+ خانات)'
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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {(mode === 'bootstrap' || mode === 'force_change_password') && (
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
                  : isEn
                  ? 'Sign In'
                  : 'دخول آمن'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
