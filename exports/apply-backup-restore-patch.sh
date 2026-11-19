#!/usr/bin/env bash
# Safe Review-Branch Transfer & Verification Script for ALMANSOOR SMART FINANCE ERP
# Target Repo: 774575749mmm-cmd/mmm
# Base Branch: main (Expected HEAD: e7e25b5f4761e2fba9fdee54f2fb3241ff282387)
# Review Branch: backup-restore-fixes-review
# Safety: NEVER modifies main directly, NEVER runs git commit/push/deploy, NEVER touches Production.

set -euo pipefail

DEFAULT_PATCH="./backup-restore-fixes.patch"
if [ ! -f "$DEFAULT_PATCH" ] && [ -f "./exports/backup-restore-fixes.patch" ]; then
  DEFAULT_PATCH="./exports/backup-restore-fixes.patch"
fi
PATCH_FILE="${1:-$DEFAULT_PATCH}"
EXPECTED_BASE="e7e25b5f4761e2fba9fdee54f2fb3241ff282387"
REVIEW_BRANCH="backup-restore-fixes-review"

if [ ! -f "$PATCH_FILE" ]; then
  echo "ERROR: Patch file not found: $PATCH_FILE" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Run this script from inside your local clone of 774575749mmm-cmd/mmm." >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Working tree is not clean. Commit or stash existing changes first." >&2
  exit 1
fi

CURRENT_HEAD="$(git rev-parse HEAD)"
echo "Current HEAD: $CURRENT_HEAD"
if [ "$CURRENT_HEAD" != "$EXPECTED_BASE" ]; then
  echo "WARNING: HEAD ($CURRENT_HEAD) differs from expected base ($EXPECTED_BASE)."
  echo "Continuing with strict dry-run check (no files modified on conflict)..."
fi

echo "1) Creating review branch '$REVIEW_BRANCH' without modifying 'main'..."
git checkout -b "$REVIEW_BRANCH"

echo "2) Verifying patch applies cleanly (dry run)..."
git apply --check "$PATCH_FILE"
echo "   Dry-run OK (0 conflicts)."

echo "3) Applying patch (10 files only)..."
git apply "$PATCH_FILE"

echo "4) Changed files summary:"
git status -sb
git diff --stat

echo "5) Running TypeScript check, Vitest suite (isolated Staging/PGlite), and build..."
npx tsc --noEmit
npx vitest run
npm run build

echo ""
echo "=== ALL CHECKS PASSED ON BRANCH: $REVIEW_BRANCH ==="
echo "Review changes with 'git diff' before committing. Next manual commands:"
echo "  git add server/app.ts server/tenantRepository.ts src/App.tsx src/components/common/ConfirmModal.tsx src/components/modules/settings/DataMigrationPanel.tsx src/components/modules/settings/SettingsModule.tsx src/components/modules/workbenches/SettingsWorkbench.tsx src/services/cloudApiService.ts src/services/sqlBakParserService.ts tests/backup-restore-staging.test.ts"
echo "  git commit -m \"fix(restore): atomic postgres two-stage backup restore and migration\""
echo "  git push -u origin $REVIEW_BRANCH"
echo "  # Then open Pull Request: $REVIEW_BRANCH -> main on 774575749mmm-cmd/mmm"
