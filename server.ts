/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ALMANSOOR SMART FINANCE ERP - Express Server Bootstrap + Vite / Static Middleware
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createErpServerApp, ensureInitialOwnerFromEnv } from './server/app.ts';
import { createServerDatabaseFromEnv } from './server/db.ts';

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const db = await createServerDatabaseFromEnv();
  const bootStatus = await ensureInitialOwnerFromEnv(db);
  if (bootStatus.bootstrapped) {
    console.log(`[ERP Auth] Initial owner account bootstrapped from environment (${bootStatus.username}).`);
  } else if (bootStatus.reason === 'env_password_not_configured') {
    console.warn(
      '[ERP Auth] Database has no users yet (authInitialized=false). Set ERP_BOOTSTRAP_ADMIN_PASSWORD or activate via /api/auth/bootstrap.'
    );
  }
  const app = createErpServerApp({ isProduction, db });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve('dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'API endpoint not found.' });
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ALMANSOOR SMART FINANCE ERP Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ERP server:', err);
  process.exit(1);
});
