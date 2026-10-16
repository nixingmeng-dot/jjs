// 免安装版启动测试：node scripts/smoke-exe.mjs <可执行文件>
// 检查：能启动、界面和字体从 exe 内部读出、能读写数据（data 在 exe 旁边）、重复启动会识别已运行的实例、没有多余警告。
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '');
if (!existsSync(source)) throw new Error(`找不到 ${source}`);
// 复制到临时目录再运行：测试会新建数据，不能碰真实 exe 旁边的 data 文件夹
const sandbox = mkdtempSync(join(tmpdir(), 'inkwell-smoke-'));
const exe = join(sandbox, basename(source));
copyFileSync(source, exe);
const port = 18787;
const base = `http://127.0.0.1:${port}`;
const dataDir = join(sandbox, 'data');

const env = { ...process.env, PORT: String(port), INKWELL_OPEN: '0' };
delete env.INKWELL_DATA_DIR;
const ok = (cond, msg) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
};

function launch() {
  const child = spawn(exe, [], { env, cwd: process.platform === 'win32' ? process.env.SystemRoot : '/' });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, output: () => output, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}

const first = launch();
try {
  const t0 = Date.now();
  let health;
  while (Date.now() - t0 < 60_000) {
    health = await fetch(`${base}/api/health`)
      .then((r) => r.json())
      .catch(() => null);
    if (health) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  ok(health?.app === 'inkwell', `启动成功（${Date.now() - t0} ms）`);

  const html = await (await fetch(`${base}/book/x/write`)).text();
  ok(html.includes('id="root"'), '首页和前端路由从 exe 内部读出');
  const js = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  const css = html.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  const jsRes = await fetch(base + js);
  ok(jsRes.ok && jsRes.headers.get('content-type')?.startsWith('text/javascript'), `脚本 ${js}`);
  const cssText = await (await fetch(base + css)).text();
  const font = cssText.match(/url\((\/assets\/[^)]+\.woff2)\)/)?.[1];
  const fontRes = await fetch(base + font);
  ok(fontRes.ok && fontRes.headers.get('content-type') === 'font/woff2' && (await fontRes.arrayBuffer()).byteLength > 1000, `内置字体 ${font}`);

  const book = await (
    await fetch(`${base}/api/books`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '冒烟测试' }) })
  ).json();
  const books = await (await fetch(`${base}/api/books`)).json();
  ok(books.some((b) => b.id === book.id), '新建作品并读回');
  ok(existsSync(join(dataDir, 'inkwell.db')), `数据保存在 exe 旁边：${dataDir}`);

  const second = launch();
  const code = await Promise.race([second.exited, new Promise((r) => setTimeout(() => r('timeout'), 15_000))]);
  ok(code === 0 && second.output().includes('已经在运行'), '重复启动时识别到已运行的实例并退出');

  const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
  ok(evil.status === 403, '拒绝来自其他网站的请求');

  ok(!/ExperimentalWarning|Warning:/.test(first.output()), '没有输出实验性功能警告');
  console.log('\n----- exe 输出 -----\n' + first.output().trim());
} finally {
  first.child.kill();
  await first.exited;
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
