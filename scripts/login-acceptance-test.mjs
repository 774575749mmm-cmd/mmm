/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP — Login UI Acceptance Test (UAT)
 *
 * Simulates a real user in Chromium entering valid credentials on the Login screen,
 * verifies transition into the ERP Dashboard, checks session persistence across reload,
 * and writes a structured acceptance report to docs/LOGIN_ACCEPTANCE_REPORT.md.
 *
 * Safety Guarantees:
 * - Runs against an isolated ephemeral PGlite Preview instance (DATABASE_URL="").
 * - Never touches Production, Staging, or the workspace's existing .erp-pglite-data.
 * - Generates an ephemeral strong test password at runtime (no hardcoded secrets).
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const WORKSPACE_ROOT = process.cwd();
const UAT_PORT = Number(process.env.LOGIN_UAT_PORT || 3198);
const TARGET_URL = (process.env.LOGIN_UAT_BASE_URL || `http://127.0.0.1:${UAT_PORT}`).replace(/\/+$/, '');
const REPORT_PATH = path.resolve(
  WORKSPACE_ROOT,
  process.env.LOGIN_UAT_REPORT_PATH || 'docs/LOGIN_ACCEPTANCE_REPORT.md'
);
const USE_EXTERNAL_SERVER = Boolean(process.env.LOGIN_UAT_BASE_URL);
const PGLITE_DIR = path.join(os.tmpdir(), `erp-login-uat-pglite-${Date.now()}-${process.pid}`);

function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'playwright',
    '/usr/local/share/bun-global/node_modules/playwright-core/index.js',
    '/usr/local/lib/node_modules/playwright-core/index.js',
  ];
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod?.chromium) return mod;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'Playwright runtime not found. Install playwright-core or ensure global playwright-core is available.'
  );
}

function resolveChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const knownPaths = [
    '/ms-playwright/chromium_headless_shell-1247/chrome-headless-shell-linux64/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ];
  for (const p of knownPaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function generateEphemeralPassword() {
  if (process.env.LOGIN_UAT_PASSWORD && process.env.LOGIN_UAT_PASSWORD.length >= 8) {
    return process.env.LOGIN_UAT_PASSWORD;
  }
  const randomHex = crypto.randomBytes(6).toString('hex');
  return `Uat#${randomHex}9A`;
}

function attachPageListeners(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (/WebSocket|hmr|24678/i.test(text)) {
        bucket.hmrNotes.push(text);
      } else {
        bucket.consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    const text = String(err?.message || err);
    if (/WebSocket closed without opened/i.test(text)) {
      bucket.hmrNotes.push(text);
    } else {
      bucket.pageErrors.push(text);
    }
  });
}

async function waitForHealth(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // retry until server is ready
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for isolated Preview server health at ${url}/api/health`);
}

function formatMarkdownReport(meta, checks, serverLogs, serverErrLogs) {
  const passedCount = checks.filter((c) => c.status === 'PASS').length;
  const totalCount = checks.length;
  const overall = passedCount === totalCount ? 'PASS' : 'FAIL';

  const summaryRows = checks
    .map(
      (c) =>
        `| ${c.id} | ${c.title} | **${c.status}** | ${c.httpSummary} | ${c.unexpectedConsoleErrors.length} / ${c.pageErrors.length} |`
    )
    .join('\n');

  const detailSections = checks
    .map((c) => {
      const stepsMd = c.steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n');
      const evidenceJson = JSON.stringify(c.evidence, null, 2);
      const consoleSummary =
        c.unexpectedConsoleErrors.length === 0 && c.pageErrors.length === 0
          ? `0 أخطاء تطبيق في Console، 0 أخطاء PageError${
              c.expected401LogsCount > 0
                ? ` (مع ${c.expected401LogsCount} سجل شبكة متوقع لرفض 401 المقصود)`
                : ''
            }.`
          : `أخطاء Console: ${JSON.stringify(c.unexpectedConsoleErrors)} | أخطاء PageError: ${JSON.stringify(
              c.pageErrors
            )}`;

      return `### ${c.id}. ${c.title}
- **النتيجة:** \`${c.status}\`
- **خطوات التنفيذ الفعلية:**
${stepsMd}
- **استجابة الخادم ونتيجة الواجهة:** ${c.outcomeSummary}
- **الأدلة المرصودة:**
\`\`\`json
${evidenceJson}
\`\`\`
- **فحص Console و PageErrors:** ${consoleSummary}
`;
    })
    .join('\n---\n\n');

  const hmrNoteText =
    meta.totalHmrNotes > 0
      ? `تم رصد ${meta.totalHmrNotes} إشعار(ات) متوقعة متعلقة بتعطيل Vite HMR WebSocket في بيئة التطوير المعزولة دون أي تأثير على الوظائف.`
      : 'لم تُرصد أي إشعارات HMR.';

  return `# تقرير اختبار قبول تسجيل الدخول (Login Acceptance Test Report)

- **النظام:** ALMANSOOR SMART FINANCE ERP
- **تاريخ التنفيذ (UTC):** \`${meta.executedAt}\`
- **النتيجة الإجمالية:** **${overall} (${passedCount}/${totalCount})**
- **أداة التنفيذ:** متصفح Chromium حقيقي عبر Playwright (\`scripts/login-acceptance-test.mjs\`)
- **البيئة المستهدفة:** \`${meta.targetUrl}\`
- **محرك قاعدة البيانات:** \`${meta.health.databaseDriver}\` (\`rlsReady: ${meta.health.rlsReady}\`, \`production: ${meta.health.production}\`)
- **عزل البيانات:** بيئة PGlite معزولة ومؤقتة بالكامل (\`DATABASE_URL=""\`) دون أي مساس بـ Production أو Staging أو الحسابات القائمة.

---

## ملخص النتائج

| # | الاختبار | النتيجة | استجابات الخادم | أخطاء Console / PageError |
|---:|---|---:|---|---:|
${summaryRows}

---

## التفاصيل والأدلة لكل سيناريو

${detailSections}

---

## سجلات الخادم وبيئة التشغيل

- **ملاحظة HMR:** ${hmrNoteText}
- **مخرجات الخادم (stdout):**
\`\`\`text
${serverLogs.length > 0 ? serverLogs.join('\n') : '(لا توجد سجلات)'}
\`\`\`
- **تحذيرات/سجلات التمهيد (stderr):**
\`\`\`text
${serverErrLogs.length > 0 ? serverErrLogs.join('\n') : '(لا توجد أخطاء)'}
\`\`\`
`;
}

async function run() {
  const { chromium } = loadPlaywright();
  const executablePath = resolveChromiumExecutable();
  const testUsername = process.env.LOGIN_UAT_USERNAME || 'admin';
  const testPassword = generateEphemeralPassword();
  const wrongPassword = `${testPassword}_INVALID`;

  const serverLogs = [];
  const serverErrLogs = [];
  const checks = [];

  let serverProc = null;
  let browser = null;
  let totalHmrNotes = 0;

  try {
    if (!USE_EXTERNAL_SERVER) {
      const tsxBin = path.join(WORKSPACE_ROOT, 'node_modules', '.bin', 'tsx');
      serverProc = spawn(tsxBin, ['server.ts'], {
        cwd: WORKSPACE_ROOT,
        detached: true,
        env: {
          ...process.env,
          PORT: String(UAT_PORT),
          NODE_ENV: 'development',
          DATABASE_URL: '',
          ERP_PGLITE_DIR: PGLITE_DIR,
          ERP_BOOTSTRAP_ADMIN_PASSWORD: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      serverProc.stdout.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (line) serverLogs.push(line);
      });
      serverProc.stderr.on('data', (chunk) => {
        const line = chunk.toString().trim();
        if (line) serverErrLogs.push(line);
      });
    }

    const health = await waitForHealth(TARGET_URL);
    if (health.production === true) {
      throw new Error('Safety guard triggered: refusing to run Login UAT against a production server.');
    }

    // Ensure the isolated test database has an initialized owner account before testing the Login flow
    if (health.authInitialized === false) {
      const bootRes = await fetch(`${TARGET_URL}/api/auth/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: testUsername,
          password: testPassword,
          fullName: 'مالك اختبار القبول',
          email: 'login.uat@example.test',
          phone: '+967770000111',
        }),
      });
      if (bootRes.status !== 201) {
        const errBody = await bootRes.text();
        throw new Error(`Failed to seed isolated UAT owner account (${bootRes.status}): ${errBody}`);
      }
    }

    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const bucket = { consoleErrors: [], pageErrors: [], hmrNotes: [] };
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    attachPageListeners(page, bucket);

    // =========================================================================
    // CHECK 1: Login screen renders cleanly in an unauthenticated browser
    // =========================================================================
    {
      const errStart = bucket.consoleErrors.length;
      const pageErrStart = bucket.pageErrors.length;

      const statusPromise = page.waitForResponse((r) => r.url().includes('/api/auth/status'));
      await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
      const statusResp = await statusPromise;
      const statusBody = await statusResp.json();

      const modalHeading = page.locator('.fixed.inset-0 h2').last();
      await modalHeading.waitFor({ state: 'visible', timeout: 15000 });
      const headingText = (await modalHeading.textContent())?.trim() || '';

      const usernameInput = page.locator('input[autocomplete="username"]');
      const passwordInput = page.locator('input[type="password"]').first();
      const submitButton = page.locator('button[type="submit"]');

      const userInputVisible = await usernameInput.isVisible();
      const passInputVisible = await passwordInput.isVisible();
      const submitBtnVisible = await submitButton.isVisible();

      const newConsole = bucket.consoleErrors.slice(errStart);
      const newPageErrs = bucket.pageErrors.slice(pageErrStart);

      const passed =
        statusResp.status() === 200 &&
        statusBody?.initialized === true &&
        statusBody?.authenticated === false &&
        headingText.includes('تسجيل الدخول الآمن') &&
        userInputVisible &&
        passInputVisible &&
        submitBtnVisible &&
        newConsole.length === 0 &&
        newPageErrs.length === 0;

      checks.push({
        id: 1,
        title: 'عرض شاشة تسجيل الدخول دون أخطاء',
        status: passed ? 'PASS' : 'FAIL',
        httpSummary: `GET /api/auth/status → ${statusResp.status()}`,
        steps: [
          `فتح عنوان النظام المعزول (${TARGET_URL}) في سياق متصفح Chromium جديد دون جلسة مسبقة.`,
          'انتظار استجابة فحص حالة المصادقة GET /api/auth/status واكتمال تحميل الواجهة.',
          'التحقق من ظهور عنوان نافذة الدخول وحقل اسم المستخدم وحقل كلمة المرور وزر تسجيل الدخول.',
        ],
        outcomeSummary: `أعاد الخادم HTTP ${statusResp.status()} (initialized: ${statusBody?.initialized}, authenticated: ${statusBody?.authenticated})، وظهرت نافذة "${headingText}" بكامل عناصرها.`,
        evidence: {
          httpStatus: statusResp.status(),
          initialized: statusBody?.initialized,
          authenticated: statusBody?.authenticated,
          modalHeading: headingText,
          usernameInputVisible: userInputVisible,
          passwordInputVisible: passInputVisible,
          submitButtonVisible: submitBtnVisible,
        },
        expected401LogsCount: 0,
        unexpectedConsoleErrors: newConsole,
        pageErrors: newPageErrs,
      });
    }

    // =========================================================================
    // CHECK 2: Reject invalid credentials & stay locked on Login screen
    // =========================================================================
    {
      const errStart = bucket.consoleErrors.length;
      const pageErrStart = bucket.pageErrors.length;

      await page.locator('input[autocomplete="username"]').fill(testUsername);
      await page.locator('input[type="password"]').first().fill(wrongPassword);

      const badLoginPromise = page.waitForResponse(
        (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
      );
      await page.locator('button[type="submit"]').click();
      const badLoginResp = await badLoginPromise;
      const badLoginBody = await badLoginResp.json();
      await page.waitForTimeout(250);

      const modalStillVisible = await page.locator('.fixed.inset-0 h2').last().isVisible();
      const lockScreenVisible = await page.getByText('مساحة العمل مقفلة — يرجى تسجيل الدخول').isVisible();
      const postFailChecks = await page.evaluate(async () => {
        const rStatus = await fetch('/api/auth/status', { credentials: 'include' });
        const statusBody = await rStatus.json();
        const rState = await fetch('/api/company/state', { credentials: 'include' });
        return {
          authenticated: statusBody?.authenticated,
          companyStateHttpStatus: rState.status,
        };
      });
      const dashboardBlocked =
        modalStillVisible &&
        lockScreenVisible &&
        postFailChecks.authenticated === false &&
        postFailChecks.companyStateHttpStatus === 401;
      const modalText = await page.locator('.fixed.inset-0').last().innerText();
      const errorDisplayedInUi =
        Boolean(badLoginBody?.error) && modalText.includes(String(badLoginBody.error).slice(0, 20));

      const rawConsole = bucket.consoleErrors.slice(errStart);
      const expected401 = rawConsole.filter((m) => /status of 401/i.test(m));
      const unexpectedConsole = rawConsole.filter((m) => !/status of 401/i.test(m));
      const newPageErrs = bucket.pageErrors.slice(pageErrStart);

      const passed =
        badLoginResp.status() === 401 &&
        modalStillVisible &&
        dashboardBlocked &&
        errorDisplayedInUi &&
        unexpectedConsole.length === 0 &&
        newPageErrs.length === 0;

      checks.push({
        id: 2,
        title: 'رفض بيانات الاعتماد الخاطئة ومنع الدخول للوحة التحكم',
        status: passed ? 'PASS' : 'FAIL',
        httpSummary: `POST /api/auth/login → ${badLoginResp.status()}, GET /api/company/state → ${postFailChecks.companyStateHttpStatus}`,
        steps: [
          `إدخال اسم المستخدم "${testUsername}" مع كلمة مرور غير صحيحة في نموذج تسجيل الدخول.`,
          'النقر على زر تسجيل الدخول ورصد استجابة الخادم POST /api/auth/login.',
          'التحقق من ظهور رسالة الخطأ داخل النافذة وبقاء شاشة القفل ورفض الوصول إلى بيانات لوحة التحكم (/api/company/state → 401).',
        ],
        outcomeSummary: `رفض الخادم المحاولة برمز HTTP ${badLoginResp.status()} والرسالة "${badLoginBody?.error || ''}"، وبقيت شاشة القفل مفعّلة مع رفض GET /api/company/state برمز HTTP ${postFailChecks.companyStateHttpStatus}.`,
        evidence: {
          httpStatus: badLoginResp.status(),
          serverErrorMessage: badLoginBody?.error || null,
          errorDisplayedInUi,
          loginModalRemainsOpen: modalStillVisible,
          lockScreenVisible,
          serverAuthenticatedAfterFail: postFailChecks.authenticated,
          protectedStateHttpStatus: postFailChecks.companyStateHttpStatus,
          dashboardBlocked,
        },
        expected401LogsCount: expected401.length,
        unexpectedConsoleErrors: unexpectedConsole,
        pageErrors: newPageErrs,
      });
    }

    // =========================================================================
    // CHECK 3: Valid credentials login submission & server authentication
    // =========================================================================
    let loginUserPayload = null;
    let loginCompaniesCount = 0;

    {
      const errStart = bucket.consoleErrors.length;
      const pageErrStart = bucket.pageErrors.length;

      await page.locator('input[autocomplete="username"]').fill(testUsername);
      await page.locator('input[type="password"]').first().fill(testPassword);

      const loginPromise = page.waitForResponse(
        (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
      );
      const statePromise = page.waitForResponse(
        (r) => r.url().includes('/api/company/state') && r.request().method() === 'GET'
      );

      await page.locator('button[type="submit"]').click();

      const loginResp = await loginPromise;
      const loginBody = await loginResp.json();
      const stateResp = await statePromise;

      loginUserPayload = loginBody?.user || null;
      loginCompaniesCount = Array.isArray(loginBody?.companies) ? loginBody.companies.length : 0;

      const cookies = await context.cookies(TARGET_URL);
      const sessionCookie = cookies.find((c) => /session|erp/i.test(c.name) && c.httpOnly);

      const newConsole = bucket.consoleErrors.slice(errStart);
      const newPageErrs = bucket.pageErrors.slice(pageErrStart);

      const passed =
        loginResp.status() === 200 &&
        loginBody?.ok === true &&
        loginUserPayload?.username === testUsername &&
        stateResp.status() === 200 &&
        Boolean(sessionCookie) &&
        newConsole.length === 0 &&
        newPageErrs.length === 0;

      checks.push({
        id: 3,
        title: 'محاكاة إدخال بيانات اعتماد صحيحة وتنفيذ تسجيل الدخول',
        status: passed ? 'PASS' : 'FAIL',
        httpSummary: `POST /api/auth/login → ${loginResp.status()}, GET /api/company/state → ${stateResp.status()}`,
        steps: [
          `إدخال اسم المستخدم الصحيح "${testUsername}" وكلمة المرور الصحيحة (المولدة مؤقتاً للاختبار) في حقول النموذج.`,
          'النقر على زر تسجيل الدخول ورصد طلب المصادقة POST /api/auth/login.',
          'التحقق من إصدار ملف تعريف ارتباط الجلسة الآمن (HttpOnly) وتحميل حالة المنشأة GET /api/company/state.',
        ],
        outcomeSummary: `نجح تسجيل الدخول برمز HTTP ${loginResp.status()} للمستخدم "${loginUserPayload?.username}" بدور "${loginUserPayload?.role}" وإصدار جلسة sessionVersion=${loginUserPayload?.sessionVersion}، مع إصدار كوكي HttpOnly وتحميل حالة الشركة بنجاح (HTTP ${stateResp.status()}).`,
        evidence: {
          loginHttpStatus: loginResp.status(),
          companyStateHttpStatus: stateResp.status(),
          authenticatedUser: loginUserPayload
            ? {
                username: loginUserPayload.username,
                fullName: loginUserPayload.fullName,
                role: loginUserPayload.role,
                sessionVersion: loginUserPayload.sessionVersion,
                mustChangePassword: loginUserPayload.mustChangePassword,
              }
            : null,
          companiesLinkedCount: loginCompaniesCount,
          httpOnlySessionCookieSet: Boolean(sessionCookie),
          sessionCookieName: sessionCookie?.name || null,
        },
        expected401LogsCount: 0,
        unexpectedConsoleErrors: newConsole,
        pageErrors: newPageErrs,
      });
    }

    // =========================================================================
    // CHECK 4: Verify successful transition into the ERP Dashboard UI
    // =========================================================================
    {
      const errStart = bucket.consoleErrors.length;
      const pageErrStart = bucket.pageErrors.length;

      const logoutButton = page.locator('button[title="تسجيل الخروج"]');
      await logoutButton.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(300);

      const loginOverlayCount = await page.locator('.fixed.inset-0 input[autocomplete="username"]').count();
      const lockScreenStillVisible = await page
        .getByText('مساحة العمل مقفلة — يرجى تسجيل الدخول')
        .isVisible()
        .catch(() => false);
      const logoutVisible = await logoutButton.isVisible();
      const createCompanyBtnVisible = await page.locator('button[title="تأسيس منشأة / شركة جديدة"]').isVisible();
      const navTab1Visible = await page.getByRole('button', { name: '1. الفواتير والمخزن', exact: true }).isVisible();
      const navTab8Visible = await page
        .getByRole('button', { name: '8. التخصيص والصلاحيات والدفاتر', exact: true })
        .isVisible();

      const headerUserVisible = await page
        .locator('body')
        .innerText()
        .then((t) => t.includes(loginUserPayload?.fullName || 'مالك') || t.includes('المؤسسة'));

      const newConsole = bucket.consoleErrors.slice(errStart);
      const newPageErrs = bucket.pageErrors.slice(pageErrStart);

      const passed =
        loginOverlayCount === 0 &&
        !lockScreenStillVisible &&
        logoutVisible &&
        createCompanyBtnVisible &&
        navTab1Visible &&
        navTab8Visible &&
        headerUserVisible &&
        newConsole.length === 0 &&
        newPageErrs.length === 0;

      checks.push({
        id: 4,
        title: 'التحقق من الانتقال الناجح إلى لوحة التحكم',
        status: passed ? 'PASS' : 'FAIL',
        httpSummary: 'UI Transition Verified',
        steps: [
          'التحقق من إغلاق نافذة تسجيل الدخول وزوال شاشة القفل بالكامل بعد نجاح المصادقة.',
          'التحقق من ظهور شريط الأدوات العلوي (زر تسجيل الخروج وزر تأسيس منشأة جديدة).',
          'التحقق من ظهور وحدات التنقل الرئيسية للوحة التحكم (مثل: 1. الفواتير والمخزن و 8. التخصيص والصلاحيات والدفاتر).',
        ],
        outcomeSummary: 'أُغلقت نافذة الدخول وزالت شاشة القفل، وانتقل المتصفح تلقائياً إلى لوحة التحكم الرئيسية بكامل أزرار التنقل والتحكم النشطة.',
        evidence: {
          loginModalDismissed: loginOverlayCount === 0,
          lockScreenDismissed: !lockScreenStillVisible,
          logoutButtonVisible: logoutVisible,
          createCompanyButtonVisible: createCompanyBtnVisible,
          invoicesModuleTabVisible: navTab1Visible,
          settingsModuleTabVisible: navTab8Visible,
          activeUserContextRendered: headerUserVisible,
        },
        expected401LogsCount: 0,
        unexpectedConsoleErrors: newConsole,
        pageErrors: newPageErrs,
      });
    }

    // =========================================================================
    // CHECK 5: Verify session remains active on Dashboard after full reload (F5)
    // =========================================================================
    {
      const errStart = bucket.consoleErrors.length;
      const pageErrStart = bucket.pageErrors.length;

      const reloadStatusPromise = page.waitForResponse((r) => r.url().includes('/api/auth/status'));
      const reloadStatePromise = page.waitForResponse(
        (r) => r.url().includes('/api/company/state') && r.request().method() === 'GET'
      );

      await page.reload({ waitUntil: 'networkidle' });

      const reloadStatusResp = await reloadStatusPromise;
      const reloadStatusBody = await reloadStatusResp.json();
      const reloadStateResp = await reloadStatePromise;

      const logoutStillVisible = await page
        .locator('button[title="تسجيل الخروج"]')
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true)
        .catch(() => false);
      const loginModalReappeared = (await page.locator('.fixed.inset-0 input[autocomplete="username"]').count()) > 0;

      const newConsole = bucket.consoleErrors.slice(errStart);
      const newPageErrs = bucket.pageErrors.slice(pageErrStart);

      const passed =
        reloadStatusResp.status() === 200 &&
        reloadStatusBody?.authenticated === true &&
        reloadStatusBody?.user?.username === testUsername &&
        reloadStateResp.status() === 200 &&
        logoutStillVisible &&
        !loginModalReappeared &&
        newConsole.length === 0 &&
        newPageErrs.length === 0;

      checks.push({
        id: 5,
        title: 'استمرارية الجلسة وبقاء المستخدم داخل لوحة التحكم بعد إعادة التحميل (F5)',
        status: passed ? 'PASS' : 'FAIL',
        httpSummary: `GET /api/auth/status → ${reloadStatusResp.status()}, GET /api/company/state → ${reloadStateResp.status()}`,
        steps: [
          'تنفيذ إعادة تحميل كاملة للصفحة في المتصفح (page.reload / F5).',
          'رصد استجابة GET /api/auth/status و GET /api/company/state بعد إعادة التحميل.',
          'التحقق من بقاء المستخدم داخل لوحة التحكم وعدم إعادته لشاشة تسجيل الدخول.',
        ],
        outcomeSummary: `استمرت الجلسة بنجاح بعد إعادة التحميل (authenticated: ${reloadStatusBody?.authenticated}) وبقيت لوحة التحكم مفتوحة ومفعّلة.`,
        evidence: {
          reloadAuthStatusHttp: reloadStatusResp.status(),
          reloadAuthenticated: reloadStatusBody?.authenticated,
          reloadUsername: reloadStatusBody?.user?.username || null,
          reloadCompanyStateHttp: reloadStateResp.status(),
          dashboardRemainedVisible: logoutStillVisible,
          loginModalReappeared,
        },
        expected401LogsCount: 0,
        unexpectedConsoleErrors: newConsole,
        pageErrors: newPageErrs,
      });
    }

    totalHmrNotes = bucket.hmrNotes.length;
    await context.close();

    const meta = {
      executedAt: new Date().toISOString(),
      targetUrl: TARGET_URL,
      health,
      totalHmrNotes,
    };

    const reportMarkdown = formatMarkdownReport(meta, checks, serverLogs, serverErrLogs);
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, reportMarkdown, 'utf8');

    const allPassed = checks.every((c) => c.status === 'PASS');
    console.log(
      JSON.stringify(
        {
          overall: allPassed ? 'PASS' : 'FAIL',
          passed: checks.filter((c) => c.status === 'PASS').length,
          total: checks.length,
          reportPath: path.relative(WORKSPACE_ROOT, REPORT_PATH),
          checks: checks.map((c) => ({
            id: c.id,
            title: c.title,
            status: c.status,
            httpSummary: c.httpSummary,
            unexpectedConsoleErrors: c.unexpectedConsoleErrors.length,
            pageErrors: c.pageErrors.length,
          })),
        },
        null,
        2
      )
    );

    if (!allPassed) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverProc && serverProc.pid) {
      try {
        process.kill(-serverProc.pid, 'SIGTERM');
      } catch {
        try {
          serverProc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }
    if (!USE_EXTERNAL_SERVER) {
      fs.rmSync(PGLITE_DIR, { recursive: true, force: true });
    }
  }
}

run().catch((err) => {
  console.error('[LOGIN UAT FATAL]', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
