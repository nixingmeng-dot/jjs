import './quiet';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import type { Hono } from 'hono';
import { createApp } from './app';
import { openDb, Repo } from './db';

/** 以 Windows 免安装版（Node 单可执行文件 Inkwell.exe）运行 */
const packaged = isSea();
const dataDir = resolve(process.env.INKWELL_DATA_DIR ?? join(packaged ? dirname(process.execPath) : process.cwd(), 'data'));
const basePort = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';
const urlOf = (port: number) => `http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`;
const openOnStart = packaged ? process.env.INKWELL_OPEN !== '0' : process.env.INKWELL_OPEN === '1';

if (packaged) {
  process.title = '墨笔';
  process.on('uncaughtException', (err) => fatal(`程序出错：${err.message}`));
}

/** 出错退出。免安装版是双击打开的窗口，直接退出的话用户来不及看到原因 */
function fatal(msg: string) {
  console.error(`\n  ✗ ${msg}\n`);
  if (packaged && process.stdin.isTTY) {
    console.error('  按回车键关闭窗口。');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
    return;
  }
  process.exit(1);
}

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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 免安装版的界面文件打包在 exe 里（构建见 scripts/build-exe.mjs） */
function serveEmbedded(app: Hono) {
  const files = new Set<string>(JSON.parse(getAsset('manifest.json', 'utf8')));
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();
  app.get('*', (c) => {
    let path = '/index.html';
    try {
      const p = decodeURIComponent(new URL(c.req.url).pathname);
      if (files.has(p)) path = p;
    } catch {
      /* 非法路径按首页处理 */
    }
    let body = cache.get(path);
    if (!body) cache.set(path, (body = new Uint8Array(getAsset(path))));
    return c.body(body, 200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  });
}

let repo: Repo;
try {
  repo = new Repo(openDb(join(dataDir, 'inkwell.db')));
} catch (err) {
  fatal(
    `无法打开数据文件 ${join(dataDir, 'inkwell.db')}：${(err as Error).message}` +
      (packaged ? '\n    请把 Inkwell.exe 放到一个可以写入的文件夹（例如 D:\\墨笔），不要放在 C:\\Program Files 里或直接在压缩包里运行。' : ''),
  );
}

if (repo!) {
  const app = createApp(repo);
  if (packaged) {
    serveEmbedded(app);
  } else if (process.env.NODE_ENV === 'production' || existsSync(join(resolve(process.cwd(), 'dist'), 'index.html'))) {
    app.use('/*', serveStatic({ root: './dist' }));
    app.get('*', serveStatic({ path: './dist/index.html' }));
  }

  const isInkwell = (port: number) =>
    fetch(`${urlOf(port)}/api/health`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.json() as Promise<{ app?: string }>)
      .then((j) => j?.app === 'inkwell')
      .catch(() => false);

  const start = (port: number) => {
    const url = urlOf(port);
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
      if (err.code !== 'EADDRINUSE') return fatal(`启动失败：${err.message}`);
      // 重复双击启动时，端口已被上一个墨笔占用：直接打开它即可
      if (await isInkwell(port)) {
        console.log(`\n  墨笔已经在运行：${url}`);
        if (openOnStart) openBrowser(url);
        setTimeout(() => process.exit(0), packaged ? 1500 : 0);
        return;
      }
      // 被别的程序占用：没指定端口时往后找一个空闲的
      if (!process.env.PORT && port < basePort + 10) return start(port + 1);
      fatal(`端口 ${port} 被其他程序占用。可以设置环境变量 PORT 换一个端口，例如：set PORT=8788`);
    });
  };

  start(basePort);
}
