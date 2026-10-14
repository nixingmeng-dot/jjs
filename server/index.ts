import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app';
import { openDb, Repo } from './db';

const dataDir = resolve(process.env.INKWELL_DATA_DIR ?? join(process.cwd(), 'data'));
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';
const url = `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`;
const openOnStart = process.env.INKWELL_OPEN === '1';

function openBrowser(target: string) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', `start "" "${target}"`]]
      : process.platform === 'darwin'
        ? ['open', [target]]
        : ['xdg-open', [target]];
  try {
    spawn(cmd, args as string[], { stdio: 'ignore', detached: true, windowsHide: true, windowsVerbatimArguments: true })
      .on('error', () => {})
      .unref();
  } catch {
    /* 打不开浏览器不影响使用 */
  }
}

const repo = new Repo(openDb(join(dataDir, 'inkwell.db')));
const app = createApp(repo);

const distDir = resolve(process.cwd(), 'dist');
if (process.env.NODE_ENV === 'production' || existsSync(join(distDir, 'index.html'))) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

const server = serve({ fetch: app.fetch, port, hostname }, () => {
  console.log(`\n  墨笔·小说工作台 已启动  →  ${url}`);
  console.log(`  数据目录：${dataDir}\n`);
  if (openOnStart) {
    console.log('  正在打开浏览器……如果没有自动打开，请手动访问上面的地址。');
    console.log('  使用期间请不要关闭这个窗口；关闭窗口即退出墨笔。\n');
    openBrowser(url);
  }
});

server.on('error', async (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err;
  // 重复双击启动时，端口已被上一个墨笔占用：直接打开它即可
  const alreadyRunning = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.json() as Promise<{ app?: string }>)
    .then((j) => j?.app === 'inkwell')
    .catch(() => false);
  if (alreadyRunning) {
    console.log(`\n  墨笔已经在运行：${url}`);
    if (openOnStart) openBrowser(url);
    process.exit(0);
  }
  console.error(`\n  端口 ${port} 被其他程序占用。可以设置环境变量 PORT 换一个端口，例如：set PORT=8788\n`);
  process.exit(1);
});
