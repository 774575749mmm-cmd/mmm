/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Licensing Boundary Interface (Phase 1 Preparation — Non-Enforcing)
 * Separates User Identity, Company Membership, and Future Commercial Licensing (Trial / Paid / Offline Signed).
 */

export type LicenseMode = 'unrestricted' | 'trial' | 'paid';
export type LicenseStatus = 'active' | 'trialing' | 'expired_readonly' | 'suspended';

export interface CompanyLicenseBoundary {
  companyId: string;
  licenseMode: LicenseMode;
  status: LicenseStatus;
  planCode: string;
  trialEndsAt?: string | null;
  expiresAt?: string | null;
  maxUsers?: number | null;
  hardwareFingerprint?: string | null;
  offlineSignature?: string | null;
  updatedAt?: string;
}

export interface LicenseEvaluationResult {
  allowed: boolean;
  readOnly: boolean;
  enforced: boolean;
  status: LicenseStatus;
  licenseMode: LicenseMode;
  planCode: string;
  trialEndsAt?: string | null;
  expiresAt?: string | null;
}

/**
 * Phase 1 License Boundary Evaluator:
 * Returns clean structural contract without restricting or blocking any operation yet.
 * Future Phase 2/3 will activate 14-day trial, read-only expired mode, and Ed25519 offline signature checks.
 */
export function evaluateLicenseBoundary(
  license?: Partial<CompanyLicenseBoundary> | null
): LicenseEvaluationResult {
  return {
    allowed: true,
    readOnly: false,
    enforced: false,
    status: license?.status || 'active',
    licenseMode: license?.licenseMode || 'unrestricted',
    planCode: license?.planCode || 'standard',
    trialEndsAt: license?.trialEndsAt ?? null,
    expiresAt: license?.expiresAt ?? null,
  };
}
