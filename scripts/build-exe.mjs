// 打包 Windows 免安装版：把服务端和界面打进单个 Inkwell.exe（Node.js 单可执行文件，SEA）。
// 用户双击即可运行，不需要安装 Node.js、不需要 npm install，也不需要任何 C++ 组件。
//
// 用法：npm run build:exe             → release/Inkwell.exe、release/Inkwell-win-x64.zip
//       npm run build:exe -- --host   → 另外生成当前系统可运行的版本，用于本机测试
//
// 可以在任何系统上构建 Windows 版：会下载与当前 Node 同版本的官方 node.exe 并校验 SHA256。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, 'build', 'exe');
const cache = join(root, 'build', 'cache');
const out = join(root, 'release');
const version = process.version;

const step = (s) => console.log(`\n▶ ${s}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (r.status !== 0) throw new Error(`命令失败：${cmd} ${args.join(' ')}`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]))
    .sort();
}

async function download(urls) {
  let last;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = new Error(`${url}：${err.message}`);
    }
  }
  throw last;
}

const mirrors = (path) => [`https://nodejs.org/dist/${version}/${path}`, `https://npmmirror.com/mirrors/node/${version}/${path}`];

/** 与当前 Node 同版本的 Windows x64 node.exe（SEA 的程序块必须由同版本 Node 生成） */
async function windowsNode() {
  if (process.platform === 'win32' && process.arch === 'x64') return process.execPath;
  const file = join(cache, `node-${version}-win-x64.exe`);
  if (existsSync(file)) return file;
  console.log(`  下载 node.exe ${version}……`);
  const sums = (await download(mirrors('SHASUMS256.txt'))).toString();
  const expected = sums.match(/^([0-9a-f]{64})\s+win-x64\/node\.exe$/m)?.[1];
  if (!expected) throw new Error('SHASUMS256.txt 里没有 win-x64/node.exe');
  const exe = await download(mirrors('win-x64/node.exe'));
  if (createHash('sha256').update(exe).digest('hex') !== expected) throw new Error('node.exe 校验失败');
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, exe);
  return file;
}

/** 去掉 node.exe 原有的 Authenticode 签名：注入后签名必然失效，失效的签名比没有签名更容易被误报 */
function stripSignature(file) {
  const buf = readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error(`${file} 不是有效的 PE 文件`);
  const opt = pe + 24;
  const security = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96) + 4 * 8;
  const at = buf.readUInt32LE(security);
  const size = buf.readUInt32LE(security + 4);
  if (!at || !size) return;
  buf.writeUInt32LE(0, security);
  buf.writeUInt32LE(0, security + 4);
  buf.writeUInt32LE(0, opt + 64); // CheckSum
  // 证书表按规范位于文件末尾（8 字节对齐），直接截掉
  writeFileSync(file, at + size >= buf.length - 8 ? buf.subarray(0, at) : buf);
}

/** SEA 熔断标记：直接从 node 程序里读，避免和 Node 版本绑定 */
function seaFuse(file) {
  const fuse = readFileSync(file).toString('latin1').match(/NODE_SEA_FUSE_[0-9a-f]{32}/)?.[0];
  if (!fuse) throw new Error(`${file} 不支持单可执行文件（SEA）`);
  return fuse;
}

async function makeBinary(base, target, opts = {}) {
  const sentinelFuse = seaFuse(base);
  copyFileSync(base, target);
  if (opts.windows) stripSignature(target);
  if (process.platform === 'darwin' && !opts.windows) run('codesign', ['--remove-signature', target]);
  await inject(target, 'NODE_SEA_BLOB', readFileSync(join(work, 'sea-prep.blob')), {
    sentinelFuse,
    ...(process.platform === 'darwin' && !opts.windows ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (process.platform === 'darwin' && !opts.windows) run('codesign', ['--sign', '-', target]);
  if (!opts.windows) chmodSync(target, 0o755);
}

const README = `墨笔 · 小说创作工作台（Windows 免安装版）

1. 把 Inkwell.exe 放到一个固定的文件夹，例如 D:\\墨笔\\
2. 双击 Inkwell.exe，浏览器会自动打开墨笔
3. 使用期间不要关闭黑色窗口，关闭窗口即退出

· 不需要安装 Node.js，也不需要任何微软 C++ 组件
· 作品和 API Key 保存在 Inkwell.exe 旁边的 data 文件夹里，备份时复制整个 data 文件夹
· 以前用 start.bat 版本写的作品：把旧目录里的 data 文件夹复制到 Inkwell.exe 旁边即可
· 第一次运行时 Windows 可能提示“已保护你的电脑”：点“更多信息”→“仍要运行”
· 升级：用新版 Inkwell.exe 覆盖旧的即可，data 文件夹不要删
`;

// ---------------------------------------------------------------------------

step('构建界面');
run(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn']);

step('打包服务端');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, 'server', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  outfile: join(work, 'server.cjs'),
  legalComments: 'none',
  logLevel: 'warning',
});

step('生成程序块');
const dist = join(root, 'dist');
const assets = {};
for (const f of walk(dist)) assets['/' + relative(dist, f).split(sep).join('/')] = f;
writeFileSync(join(work, 'manifest.json'), JSON.stringify(Object.keys(assets)));
assets['manifest.json'] = join(work, 'manifest.json');
writeFileSync(
  join(work, 'sea-config.json'),
  JSON.stringify(
    {
      main: join(work, 'server.cjs'),
      output: join(work, 'sea-prep.blob'),
      disableExperimentalSEAWarning: true,
      // 跨平台构建（在 Linux 上生成 Windows 版）时这两项必须关闭
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2,
  ),
);
run(process.execPath, ['--experimental-sea-config', join(work, 'sea-config.json')]);
console.log(`  界面文件 ${Object.keys(assets).length - 1} 个`);

step(`生成 Windows 版（Node ${version}）`);
const exe = join(out, 'Inkwell.exe');
await makeBinary(await windowsNode(), exe, { windows: true });
writeFileSync(join(out, 'README.txt'), '\ufeff' + README.replace(/\n/g, '\r\n'));
const zip = join(out, 'Inkwell-win-x64.zip');
rmSync(zip, { force: true });
if (process.platform === 'win32') {
  run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${exe}','${join(out, 'README.txt')}' -DestinationPath '${zip}' -Force`]);
} else {
  run('zip', ['-9', '-j', '-q', zip, exe, join(out, 'README.txt')]);
}
console.log(`  ${relative(root, exe)}\n  ${relative(root, zip)}`);

if (process.argv.includes('--host') && process.platform !== 'win32') {
  step('生成本机测试版');
  const hostBin = join(out, `inkwell-${process.platform}-${process.arch}`);
  await makeBinary(process.execPath, hostBin);
  console.log(`  ${relative(root, hostBin)}`);
}
