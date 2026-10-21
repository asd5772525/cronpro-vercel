// 本地开发：node scripts/dev.js  → http://localhost:3000
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { mkdirSync } from 'node:fs';
import app from '../src/app.js';

mkdirSync('data', { recursive: true });
const root = new Hono();
root.use('/assets/*', serveStatic({ root: './public' }));
root.route('/', app);
const port = Number(process.env.PORT || 3000);
serve({ fetch: root.fetch, port }, () => console.log(`CronPro dev server: http://localhost:${port}`));
