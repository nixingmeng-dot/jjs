import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app';
import { openDb, Repo } from './db';

const dataDir = resolve(process.env.INKWELL_DATA_DIR ?? join(process.cwd(), 'data'));
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';

const repo = new Repo(openDb(join(dataDir, 'inkwell.db')));
const app = createApp(repo);

const distDir = resolve(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' || existsSync(join(distDir, 'index.html'))) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`\n  墨笔·小说工作台 已启动  →  http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${info.port}`);
  console.log(`  数据目录：${dataDir}\n`);
});
