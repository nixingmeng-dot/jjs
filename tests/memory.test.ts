import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDb, Repo } from '../server/db';
import { buildPrompt, parseMemory } from '../server/prompts';
import { summaryState } from '../shared/memory';
import type { BookTree, MemoryUpdate } from '../shared/types';

let app: ReturnType<typeof createApp>;
let repo: Repo;

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.fetch(
    new Request(`http://local/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, data: (ct.includes('json') ? await res.json() : await res.text()) as T };
}

const para = (s: string, n = 40) => Array.from({ length: n }, () => s).join('');

let mock: Server;
let baseUrl: string;
const prompts: string[] = [];
let memoryReply = '';

beforeAll(async () => {
  mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      const user = (body.messages ?? []).map((m: { content: string }) => m.content).join('\n');
      prompts.push(user);
      const text = user.includes('故事记忆') ? memoryReply : user.includes('卷回顾') ? '第一卷回顾：林晚回到雾港，在七号仓库找到父亲的怀表。' : '好';
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
});
afterAll(() => mock.close());

beforeEach(async () => {
  repo = new Repo(openDb(':memory:'));
  app = createApp(repo);
  prompts.length = 0;
  memoryReply = JSON.stringify({
    summary: '林晚冒雨回到修理铺，没拿到东西。她发现七号仓库换了新铜锁，左手被铁皮划伤。',
    characters: [
      { name: '林晚', fact: '左手虎口被铁皮划伤' },
      { name: '沈', fact: '怀表上刻着他的姓' },
    ],
    world: [{ name: '七号仓库', category: '地点', fact: '换了新的铜锁' }],
    foreshadows: [{ title: '父亲的怀表', fact: '表盖内侧刻着沈字', resolved: false }],
  });
  await call('POST', '/providers', { name: 'Mock', kind: 'openai', baseUrl, apiKey: 'k', models: ['m1'] });
});

async function setupBook(chapters = 3) {
  const { data: book } = await call('POST', '/books', { title: '雾港' });
  const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
  const vol = tree.volumes[0].id;
  const ids = [tree.chapters[0].id];
  for (let i = 1; i < chapters; i++) ids.push((await call('POST', `/books/${book.id}/chapters`, { volumeId: vol, title: `第${i + 1}` })).data.id);
  await call('POST', `/books/${book.id}/characters`, { name: '林晚', role: '主角' });
  return { bookId: book.id as string, volumeId: vol as string, ids };
}

describe('story memory', () => {
  it('tracks which chapters need a summary and marks edited ones stale', async () => {
    const { bookId, ids } = await setupBook(2);
    await call('PATCH', `/chapters/${ids[0]}`, { content: para('雨是后半夜停的。林晚把伞往门边一靠。') });
    await call('PATCH', `/chapters/${ids[1]}`, { content: '很短' });
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.chapters).toEqual([ids[0]]);

    await call('PATCH', `/chapters/${ids[0]}`, { summary: '手写的摘要' });
    const meta = repo.getTree(bookId)!.chapters.find((c) => c.id === ids[0])!;
    expect(meta.summaryWords).toBe(meta.wordCount);
    expect(summaryState(meta)).toBe('fresh');
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.chapters).toEqual([]);

    await call('PATCH', `/chapters/${ids[0]}`, { content: para('雨是后半夜停的。林晚把伞往门边一靠。', 80) });
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.chapters).toEqual([ids[0]]);
  });

  it('memorizes a chapter, then applies confirmed updates to cards, settings and foreshadows', async () => {
    const { bookId, ids } = await setupBook(2);
    await call('PATCH', `/chapters/${ids[0]}`, { content: para('林晚推开七号仓库的门，铁皮划破了她的手。') });
    const { status, data } = await call<{ chapter: { summary: string; summaryWords: number; wordCount: number }; updates: MemoryUpdate[] }>(
      'POST',
      `/chapters/${ids[0]}/memorize`,
    );
    expect(status).toBe(200);
    expect(data.chapter.summary).toContain('七号仓库换了新铜锁');
    expect(data.chapter.summaryWords).toBe(data.chapter.wordCount);
    expect(data.updates.map((u) => [u.kind, u.name])).toEqual([
      ['character', '林晚'],
      ['character', '沈'],
      ['world', '七号仓库'],
      ['foreshadow', '父亲的怀表'],
    ]);
    expect(prompts.at(-1)).toContain('已有人物');
    expect(prompts.at(-1)).toContain('林晚推开七号仓库的门');

    // 重新整理会替换这一章未确认的变化，不会重复累积
    await call('POST', `/chapters/${ids[0]}/memorize`);
    const pending = (await call<{ updates: MemoryUpdate[] }>('GET', `/books/${bookId}/memory`)).data.updates;
    expect(pending).toHaveLength(4);

    const byName = (n: string) => pending.find((u) => u.name === n)!;
    const { data: applied } = await call('POST', `/books/${bookId}/memory-updates/apply`, {
      items: [{ id: byName('林晚').id, fact: '左手虎口被铁皮划了一道口子' }, { id: byName('沈').id }, { id: byName('七号仓库').id }, { id: byName('父亲的怀表').id }],
    });
    expect(applied.applied).toBe(4);
    expect(applied.updates).toEqual([]);

    const tree = repo.getTree(bookId)!;
    const lin = tree.characters.find((c) => c.name === '林晚')!;
    expect(lin.facts).toEqual([{ chapterId: ids[0], text: '左手虎口被铁皮划了一道口子' }]);
    expect(tree.characters.find((c) => c.name === '沈')).toMatchObject({ role: '配角', facts: [{ chapterId: ids[0], text: '怀表上刻着他的姓' }] });
    expect(tree.world.find((w) => w.name === '七号仓库')).toMatchObject({ category: '地点', content: '换了新的铜锁' });
    expect(tree.foreshadows.find((f) => f.title === '父亲的怀表')).toMatchObject({ status: 'open', plantedChapterId: ids[0] });

    // 后面的章节能看到这一章的经历，这一章自己和更早的章节看不到
    const later = buildPrompt(repo, { task: 'continue', bookId, chapterId: ids[1] }, repo.getSettings());
    expect(later.messages[1].content).toContain('近况：第一章：左手虎口被铁皮划了一道口子');
    const same = buildPrompt(repo, { task: 'continue', bookId, chapterId: ids[0] }, repo.getSettings());
    expect(same.messages[1].content).not.toContain('左手虎口');
  });

  it('marks a foreshadow resolved and ignores dismissed updates', async () => {
    const { bookId, ids } = await setupBook(1);
    await call('POST', `/books/${bookId}/foreshadows`, { title: '父亲的怀表', status: 'open' });
    await call('PATCH', `/chapters/${ids[0]}`, { content: para('她打开怀表，终于看清了那个字。') });
    memoryReply = JSON.stringify({ summary: '林晚打开怀表。', characters: [{ name: '林晚', fact: '知道了沈的身份' }], world: [], foreshadows: [{ title: '父亲的怀表', resolved: true }] });
    const { data } = await call<{ updates: MemoryUpdate[] }>('POST', `/chapters/${ids[0]}/memorize`);
    const fs = data.updates.find((u) => u.kind === 'foreshadow')!;
    const ch = data.updates.find((u) => u.kind === 'character')!;
    await call('POST', `/books/${bookId}/memory-updates/dismiss`, { ids: [ch.id] });
    await call('POST', `/books/${bookId}/memory-updates/apply`, { items: [{ id: fs.id }] });
    const tree = repo.getTree(bookId)!;
    expect(tree.foreshadows[0]).toMatchObject({ status: 'resolved', resolvedChapterId: ids[0] });
    expect(tree.characters[0].facts).toEqual([]);
    expect(repo.listMemoryUpdates(bookId)).toEqual([]);
  });

  it('falls back to plain text and reports unusable replies', () => {
    expect(parseMemory('林晚回到雾港。')).toEqual({ summary: '林晚回到雾港。', updates: [] });
    expect(parseMemory('```json\n{"summary":"摘要","characters":[{"name":"","fact":"x"}],"world":[{"name":"港口","category":"奇怪","fact":"起雾"}]}\n```')).toEqual({
      summary: '摘要',
      updates: [{ kind: 'world', name: '港口', fact: '起雾', category: '其他', resolved: 0 }],
    });
    expect(parseMemory('{"oops"').summary).toBe('');
  });

  it('recaps a finished volume and uses it for later chapters', async () => {
    const { bookId, volumeId, ids } = await setupBook(2);
    for (const id of ids) await call('PATCH', `/chapters/${id}`, { content: para('林晚在雾港查父亲的下落。'), summary: '林晚在雾港查父亲的下落。' });
    const { data: vol2 } = await call('POST', `/books/${bookId}/volumes`, { title: '第二卷' });
    const { data: c3 } = await call('POST', `/books/${bookId}/chapters`, { volumeId: vol2.id, title: '潮信' });
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.volumes).toEqual([]);
    await call('PATCH', `/chapters/${c3.id}`, { content: para('第二卷开始了。', 80) });
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.volumes).toEqual([volumeId]);

    const { data: recapped } = await call('POST', `/volumes/${volumeId}/recap`);
    expect(recapped.recap).toContain('第一卷回顾');
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.volumes).toEqual([]);

    // 写第二卷时，第一卷超出「最近 3 章」的部分用卷回顾代替
    const { data: c4 } = await call('POST', `/books/${bookId}/chapters`, { volumeId: vol2.id, title: '旧案' });
    const { data: c5 } = await call('POST', `/books/${bookId}/chapters`, { volumeId: vol2.id, title: '沈' });
    const { data: c6 } = await call('POST', `/books/${bookId}/chapters`, { volumeId: vol2.id, title: '怀表' });
    for (const c of [c4, c5]) await call('PATCH', `/chapters/${c.id}`, { summary: '第二卷的事。' });
    const p = buildPrompt(repo, { task: 'continue', bookId, chapterId: c6.id }, repo.getSettings()).messages[1].content;
    expect(p).toContain('【第一卷·回顾】第一卷回顾');
    expect(p).not.toContain('第一章：林晚在雾港');

    // 第一卷的章节摘要变了，卷回顾需要重新生成
    await call('PATCH', `/chapters/${ids[0]}`, { summary: '改过的摘要。' });
    expect((await call('GET', `/books/${bookId}/memory`)).data.status.volumes).toEqual([volumeId]);
  });

  it('fits more of the story into the recap when the model has a larger context', async () => {
    const { bookId, ids } = await setupBook(1);
    const { data: tree } = await call<BookTree>('GET', `/books/${bookId}`);
    const vol = tree.volumes[0].id;
    const all = [ids[0]];
    for (let i = 0; i < 40; i++) all.push((await call('POST', `/books/${bookId}/chapters`, { volumeId: vol, title: `章${i}` })).data.id);
    for (const [i, id] of all.entries()) await call('PATCH', `/chapters/${id}`, { summary: `第${i}章的事件编号E${i}。${'细节'.repeat(120)}` });
    const last = all.at(-1)!;
    const small = buildPrompt(repo, { task: 'continue', bookId, chapterId: last }, repo.getSettings(), { contextTokens: 32768 }).messages[1].content;
    const large = buildPrompt(repo, { task: 'continue', bookId, chapterId: last }, repo.getSettings(), { contextTokens: 1_000_000 }).messages[1].content;
    expect(small).toContain('E39');
    expect(small).not.toContain('E0。');
    expect(small).toMatch(/更早的 \d+ 章从略/);
    expect(large).toContain('E0。');
    expect(large).not.toContain('从略');
  });

  it('retrieves earlier passages about things mentioned in the chapter outline', async () => {
    const { bookId, ids } = await setupBook(4);
    await call('PATCH', `/chapters/${ids[0]}`, {
      content: ['林晚回到雾港。', '父亲的怀表压在抽屉最底下，表盖内侧刻着一个沈字。', '林晚关上抽屉。'].join('\n'),
    });
    await call('PATCH', `/chapters/${ids[1]}`, { content: ['林晚去了码头。', '林晚和老周吵了一架。'].join('\n') });
    await call('PATCH', `/chapters/${ids[2]}`, { content: ['林晚睡了一觉。', '林晚醒来，雨停了。'].join('\n') });
    await call('PATCH', `/chapters/${ids[3]}`, { outline: '林晚在仓库夹层里又看到了那块怀表' });
    const p = buildPrompt(repo, { task: 'draft', bookId, chapterId: ids[3] }, repo.getSettings()).messages[1].content;
    expect(p).toContain('前文相关片段');
    expect(p).toContain('第一章：父亲的怀表压在抽屉最底下');
    // 只有主角名这种处处出现的词，不会被当成相关片段
    expect(p).not.toContain('林晚和老周吵了一架');
  });

  it('remaps memory to the new chapters when importing a backup', async () => {
    const { bookId, ids } = await setupBook(1);
    const lin = repo.getTree(bookId)!.characters[0];
    await call('PATCH', `/characters/${lin.id}`, { facts: [{ chapterId: ids[0], text: '左手受伤' }, { chapterId: '', text: '手动补充' }] });
    const { data: backup } = await call<string>('GET', `/books/${bookId}/export?format=json`);
    const { data: imported } = await call('POST', '/import/backup', typeof backup === 'string' ? JSON.parse(backup) : backup);
    const tree = repo.getTree(imported.id)!;
    expect(tree.characters[0].facts).toEqual([
      { chapterId: tree.chapters[0].id, text: '左手受伤' },
      { chapterId: '', text: '手动补充' },
    ]);
  });

  it('upgrades an old database without losing existing summaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkwell-mem-'));
    const file = join(dir, 'old.db');
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', genre TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '', synopsis TEXT NOT NULL DEFAULT '', outline TEXT NOT NULL DEFAULT '', styleGuide TEXT NOT NULL DEFAULT '',
        styleSample TEXT NOT NULL DEFAULT '', pov TEXT NOT NULL DEFAULT '', bannedWords TEXT NOT NULL DEFAULT '', targetWords INTEGER NOT NULL DEFAULT 0,
        dailyGoal INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE volumes (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', sort REAL NOT NULL DEFAULT 0);
      CREATE TABLE chapters (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, volumeId TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', outline TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
        sort REAL NOT NULL DEFAULT 0, wordCount INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE characters (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', aliases TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '配角',
        gender TEXT NOT NULL DEFAULT '', age TEXT NOT NULL DEFAULT '', appearance TEXT NOT NULL DEFAULT '', personality TEXT NOT NULL DEFAULT '',
        background TEXT NOT NULL DEFAULT '', speech TEXT NOT NULL DEFAULT '', motivation TEXT NOT NULL DEFAULT '', arc TEXT NOT NULL DEFAULT '',
        relations TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, sort REAL NOT NULL DEFAULT 0);
      CREATE TABLE world_entries (id TEXT PRIMARY KEY, bookId TEXT NOT NULL, category TEXT NOT NULL DEFAULT '其他', name TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, sort REAL NOT NULL DEFAULT 0);
      INSERT INTO books (id, title, createdAt, updatedAt) VALUES ('b', '旧书', 1, 1);
      INSERT INTO volumes (id, bookId, title) VALUES ('v', 'b', '第一卷');
      INSERT INTO chapters (id, bookId, volumeId, content, summary, wordCount, createdAt, updatedAt) VALUES ('c1', 'b', 'v', '正文', '旧摘要', 3200, 1, 1);
      INSERT INTO characters (id, bookId, name) VALUES ('p', 'b', '林晚');
    `);
    old.close();
    const db = openDb(file);
    const r = new Repo(db);
    const tree = r.getTree('b')!;
    expect(tree.chapters[0]).toMatchObject({ summary: '旧摘要', summaryWords: 3200 });
    expect(summaryState(tree.chapters[0])).toBe('fresh');
    expect(tree.characters[0].facts).toEqual([]);
    expect(tree.volumes[0]).toMatchObject({ recap: '', recapHash: '' });
    expect(r.listMemoryUpdates('b')).toEqual([]);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
