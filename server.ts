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

function parseCliFlag(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const prefix = `${flag}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

const PORT = Number(parseCliFlag('--port') || process.env.PORT || 3000);
const HOST = parseCliFlag('--host') || process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

async function startServer(): Promise<void> {
  const dbPromise = createServerDatabaseFromEnv();
  const vitePromise = !isProduction
    ? import('vite').then(({ createServer: createViteServer }) =>
        createViteServer({
          server: {
            middlewareMode: true,
            hmr: false,
            ws: false,
          },
          appType: 'spa',
        })
      )
    : Promise.resolve(null);

  const [db, vite] = await Promise.all([dbPromise, vitePromise]);

  const bootStatus = await ensureInitialOwnerFromEnv(db);
  if (bootStatus.bootstrapped) {
    console.log(`[ERP Auth] Initial owner account bootstrapped from environment (${bootStatus.username}).`);
  } else if (bootStatus.reason === 'env_password_not_configured') {
    console.warn(
      '[ERP Auth] Database has no users yet (authInitialized=false). Set ERP_BOOTSTRAP_ADMIN_PASSWORD or activate via /api/auth/bootstrap.'
    );
  }
  const app = createErpServerApp({ isProduction, db });

  if (vite) {
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

  const httpServer = app.listen(PORT, HOST, () => {
    console.log(`ALMANSOOR SMART FINANCE ERP Server listening on http://${HOST}:${PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[ERP Server] Received ${signal}, shutting down gracefully...`);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    if (vite) {
      await vite.close().catch(() => undefined);
    }
    await db.close().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start ERP server:', err);
  process.exit(1);
});
