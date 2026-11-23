import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { env } from './lib/env';
import { authenticate, errorHandler } from './middleware/auth';
import { buMiddleware } from './lib/bu';
import authRouter from './routes/auth';
import { pendingListBadges } from './services/pending';

export interface ModuleDef {
  path: string;
  router: Router;
}

/**
 * Every file in src/modules/*.ts must `export default { path: '/products', router } satisfies ModuleDef`
 * (or an array of them). They are auto-mounted under /api after authentication.
 */
function loadModules(): ModuleDef[] {
  const dir = path.join(__dirname, 'modules');
  const out: ModuleDef[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.(ts|js)$/.test(f) || f.endsWith('.d.ts')) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(dir, f));
    const def = mod.default ?? mod;
    for (const d of Array.isArray(def) ? def : [def]) if (d?.router && d?.path) out.push(d);
  }
  return out;
}

export function createApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: env.clientOrigin.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('dev'));
  fs.mkdirSync(env.uploadDir, { recursive: true });

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRouter);

  // Product pictures are public, non-sensitive media so <img> tags can load them without a bearer token.
  // Only files written by POST /api/products/:id/image live here (random names, image types only).
  const productMedia = path.resolve(env.uploadDir, 'products');
  fs.mkdirSync(productMedia, { recursive: true });
  app.use('/api/media/products', express.static(productMedia, { maxAge: '7d', index: false, dotfiles: 'deny' }), (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const api = Router();
  api.use(authenticate);
  api.use(buMiddleware); // Business Unit context for the Prisma scope (lib/bu.ts)
  api.use(pendingListBadges); // adds pendingCount to document list rows
  for (const m of loadModules()) {
    api.use(m.path, m.router);
    console.log(`  mounted /api${m.path}`);
  }
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
