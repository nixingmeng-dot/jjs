// 一键启动：按需安装依赖、按需构建界面，然后启动墨笔并打开浏览器。
// 只用 Node 自带模块，保证在依赖安装之前也能运行。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const MIN_NODE = 22;
const MIRROR = 'https://registry.npmmirror.com';

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < MIN_NODE) {
  fail(`当前 Node.js 版本是 ${process.versions.node}，墨笔需要 ${MIN_NODE} 或更高版本。\n    请到 https://nodejs.org/zh-cn/download 下载安装最新的 LTS 版本后重试。`);
}

function hashFiles(paths) {
  const h = createHash('sha1');
  for (const p of paths) {
    h.update(relative(root, p));
    h.update(readFileSync(p));
  }
  return h.digest('hex');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
    .sort();
}

const readStamp = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim() : '');

/** 优先用 Node 自带的 npm-cli.js，避免在 Windows 上通过 shell 调用 npm.cmd */
function runNpm(args, opts) {
  const nodeDir = dirname(process.execPath);
  const cli = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find(existsSync);
  return cli ? spawnSync(process.execPath, [cli, ...args], opts) : spawnSync('npm', args, { ...opts, shell: true });
}
const npm = (args) => runNpm(args, { stdio: 'inherit' }).status === 0;
const npmOutput = (args) => (runNpm(args, { encoding: 'utf8' }).stdout ?? '').trim();

// ---------- 1. 依赖 ----------
const lockFile = join(root, 'package-lock.json');
const installStamp = join(root, 'node_modules', '.inkwell-install');
const lockHash = () => hashFiles([lockFile, join(root, 'package.json')]);

if (readStamp(installStamp) !== lockHash()) {
  console.log('\n  首次运行（或程序已更新），正在安装依赖，大约需要 1~3 分钟……\n');
  const base = ['install', '--no-audit', '--no-fund', '--loglevel=error'];
  const configured = npmOutput(['config', 'get', 'registry']).replace(/\/+$/, '');
  // 用户没改过 npm 源时，先用国内镜像，失败再回退官方源
  const attempts = configured === 'https://registry.npmjs.org' ? [[...base, `--registry=${MIRROR}`], base] : [base, [...base, `--registry=${MIRROR}`]];
  let ok = false;
  for (const args of attempts) {
    if (npm(args)) {
      ok = true;
      break;
    }
    console.log('\n  安装失败，换一个下载源重试……\n');
  }
  if (!ok) fail('依赖安装失败。请检查网络连接后重新运行。');
  writeFileSync(installStamp, lockHash());
}

// ---------- 2. 构建界面 ----------
const sources = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'shared')),
  ...['index.html', 'vite.config.ts', 'package-lock.json'].map((f) => join(root, f)).filter(existsSync),
];
const buildStamp = join(root, 'dist', '.inkwell-build');
const srcHash = hashFiles(sources);

if (!existsSync(join(root, 'dist', 'index.html')) || readStamp(buildStamp) !== srcHash) {
  console.log('\n  正在构建界面……\n');
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const res = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { stdio: 'inherit' });
  if (res.status !== 0) fail('界面构建失败。可以删除 node_modules 文件夹后重新运行试试。');
  writeFileSync(buildStamp, srcHash);
}

// ---------- 3. 启动 ----------
process.env.NODE_ENV = 'production';
process.env.INKWELL_OPEN ??= '1';
const { register } = await import('tsx/esm/api');
register();
await import(pathToFileURL(join(root, 'server', 'index.ts')).href);
