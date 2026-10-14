import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { openDb, Repo } from '../server/db';
import { splitThinkTags, sseEvents, type LlmChunk } from '../server/llm';
import type { AiStreamEvent, BookTree, Chapter } from '../shared/types';

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
  const data = ct.includes('json') && !ct.includes('ndjson') ? await res.json() : await res.text();
  return { status: res.status, data: data as T };
}

beforeEach(() => {
  repo = new Repo(openDb(':memory:'));
  app = createApp(repo);
});

describe('books, volumes, chapters', () => {
  it('creates a book with a starter volume and chapter', async () => {
    const { data: book } = await call('POST', '/books', { title: '长夜' });
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    expect(tree.book.title).toBe('长夜');
    expect(tree.volumes).toHaveLength(1);
    expect(tree.chapters).toHaveLength(1);
    expect(tree.chapters[0].volumeId).toBe(tree.volumes[0].id);
  });

  it('tracks word counts, daily stats and auto snapshots', async () => {
    const { data: book } = await call('POST', '/books', { title: 'A' });
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    const chId = tree.chapters[0].id;
    await call('PATCH', `/chapters/${chId}`, { content: '一二三四五' });
    const { data: ch } = await call<Chapter>('GET', `/chapters/${chId}`);
    expect(ch.wordCount).toBe(5);
    await call('PATCH', `/chapters/${chId}`, { content: '一二三四五六七' });
    const { data: stats } = await call('GET', `/books/${book.id}/stats`);
    expect(stats.totalWords).toBe(7);
    expect(stats.today).toBe(7);
    // 第二次修改前已有正文，应自动留存一个版本
    const { data: snaps } = await call('GET', `/chapters/${chId}/snapshots`);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].wordCount).toBe(5);
    const { data: snap } = await call('GET', `/snapshots/${snaps[0].id}`);
    expect(snap.content).toBe('一二三四五');
  });

  it('reorders and moves chapters across volumes', async () => {
    const { data: book } = await call('POST', '/books', { title: 'B' });
    const { data: v2 } = await call('POST', `/books/${book.id}/volumes`, { title: '第二卷' });
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    const v1 = tree.volumes[0];
    const { data: created } = await call('POST', `/books/${book.id}/chapters/batch`, {
      items: [
        { volumeId: v1.id, title: '甲' },
        { volumeId: v1.id, title: '乙' },
      ],
    });
    expect(created).toHaveLength(2);
    await call('POST', `/books/${book.id}/chapters/reorder`, { ids: [created[1].id], volumeId: v2.id });
    const { data: after } = await call<BookTree>('GET', `/books/${book.id}`);
    expect(after.chapters.find((c) => c.id === created[1].id)?.volumeId).toBe(v2.id);
  });

  it('cascades deletes', async () => {
    const { data: book } = await call('POST', '/books', { title: 'C' });
    await call('POST', `/books/${book.id}/characters`, { name: '林晚' });
    await call('DELETE', `/books/${book.id}`);
    expect((await call('GET', `/books/${book.id}`)).status).toBe(404);
    expect(repo.db.prepare('SELECT COUNT(*) n FROM characters').get()).toEqual({ n: 0 });
  });

  it('round-trips export/import and splits imported txt', async () => {
    const { data: book } = await call('POST', '/books', { title: '归途', author: '某人' });
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    await call('PATCH', `/chapters/${tree.chapters[0].id}`, { title: '雨夜', content: '雨下了一整夜。\n天亮了。' });
    await call('POST', `/books/${book.id}/characters`, { name: '林晚', pinned: true });

    const { data: txt } = await call<string>('GET', `/books/${book.id}/export?format=txt`);
    expect(txt).toContain('第一章 雨夜');
    expect(txt).toContain('\u3000\u3000雨下了一整夜。');

    const { data: backup } = await call('GET', `/books/${book.id}/export?format=json`);
    expect(backup.format).toBe('inkwell-backup');
    const { data: copy } = await call('POST', '/import/backup', backup);
    const { data: copyTree } = await call<BookTree>('GET', `/books/${copy.id}`);
    expect(copyTree.characters[0].name).toBe('林晚');
    expect(copyTree.characters[0].pinned).toBe(1);
    expect(copyTree.chapters[0].wordCount).toBe(11);

    const { data: imported } = await call('POST', '/import/text', { title: '导入', text: txt });
    const { data: impTree } = await call<BookTree>('GET', `/books/${imported.id}`);
    expect(impTree.chapters.map((c) => c.title)).toContain('雨夜');
  });
});

describe('providers', () => {
  it('masks api keys and keeps them when masked value is sent back', async () => {
    const { data: p } = await call('POST', '/providers', {
      name: 'X',
      kind: 'openai',
      baseUrl: 'https://example.com/v1/',
      apiKey: 'sk-1234567890abcd',
      models: ['m1'],
    });
    expect(p.apiKey).toBe('sk-••••abcd');
    expect(p.baseUrl).toBe('https://example.com/v1');
    await call('PATCH', `/providers/${p.id}`, { apiKey: p.apiKey, name: 'Y' });
    expect(repo.getProvider(p.id)?.apiKey).toBe('sk-1234567890abcd');
    const { data: settings } = await call('GET', '/settings');
    expect(settings.defaultProviderId).toBe(p.id);
    expect(settings.defaultModel).toBe('m1');
  });

  it('keeps the default model valid when the model list changes', async () => {
    const { data: p } = await call('POST', '/providers', { name: 'X', baseUrl: 'https://example.com/v1', models: [] });
    expect((await call('GET', '/settings')).data.defaultModel).toBe('');
    await call('PATCH', `/providers/${p.id}`, { models: ['a', 'b'] });
    expect((await call('GET', '/settings')).data.defaultModel).toBe('a');
    await call('PATCH', `/providers/${p.id}`, { models: ['b'] });
    expect((await call('GET', '/settings')).data.defaultModel).toBe('b');
  });
});

describe('AI pipeline', () => {
  let mock: Server;
  let baseUrl: string;
  let lastBody: any;

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (req.url?.endsWith('/models')) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
          return;
        }
        lastBody = JSON.parse(raw || '{}');
        if (req.headers.authorization !== 'Bearer sk-test') {
          res.statusCode = 401;
          res.end(JSON.stringify({ error: { message: 'bad key' } }));
          return;
        }
        res.setHeader('content-type', 'text/event-stream');
        const parts = ['<think>想一想', '</think>', '雨', '停了。'];
        for (const p of parts) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
    });
    await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
  });
  afterAll(() => mock.close());

  async function setup(apiKey = 'sk-test') {
    const { data: provider } = await call('POST', '/providers', { name: 'Mock', kind: 'openai', baseUrl, apiKey, models: ['m1'] });
    const { data: book } = await call('POST', '/books', { title: '长夜', styleSample: '我的文字样本。' });
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    await call('POST', `/books/${book.id}/characters`, { name: '林晚', role: '主角', speech: '说话很冲' });
    await call('POST', `/books/${book.id}/characters`, { name: '路人甲', role: '路人' });
    return { provider, book, chapterId: tree.chapters[0].id };
  }

  const parse = (s: string) =>
    s
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as AiStreamEvent);

  it('streams text, separates <think> reasoning and injects anti-AI rules + context', async () => {
    const { book, chapterId } = await setup();
    await call('PATCH', `/chapters/${chapterId}`, { outline: '林晚在雨夜回到家' });
    const { status, data } = await call<string>('POST', '/ai/run', { task: 'continue', bookId: book.id, chapterId, length: 300 });
    expect(status).toBe(200);
    const events = parse(data);
    expect(events[0]).toEqual({ t: 'meta', provider: 'Mock', model: 'm1' });
    const text = events.filter((e) => e.t === 'text').map((e) => (e as { v: string }).v).join('');
    const reasoning = events.filter((e) => e.t === 'reasoning').map((e) => (e as { v: string }).v).join('');
    expect(text).toBe('雨停了。');
    expect(reasoning).toBe('想一想');
    expect(events.at(-1)).toEqual({ t: 'done' });

    const [system, user] = lastBody.messages;
    expect(system.role).toBe('system');
    expect(system.content).toContain('写作守则');
    expect(system.content).toContain('我的文字样本');
    expect(user.content).toContain('林晚');
    expect(user.content).not.toContain('路人甲');
    expect(user.content).toContain('林晚在雨夜回到家');
    expect(lastBody.stream).toBe(true);
  });

  it('reports provider errors as stream events', async () => {
    const { book, chapterId } = await setup('wrong');
    const { data } = await call<string>('POST', '/ai/run', { task: 'draft', bookId: book.id, chapterId });
    const events = parse(data);
    const err = events.find((e) => e.t === 'error') as { v: string };
    expect(err.v).toContain('API Key 无效');
    expect(err.v).toContain('bad key');
  });

  it('fails fast when no provider is configured', async () => {
    const { data: book } = await call('POST', '/books', { title: 'x' });
    const { status, data } = await call('POST', '/ai/run', { task: 'brainstorm', bookId: book.id, instruction: '下一步？' });
    expect(status).toBe(400);
    expect(data.error).toContain('模型服务');
  });

  it('lists models and tests connection', async () => {
    const { provider } = await setup();
    const { data } = await call('POST', `/providers/${provider.id}/models`);
    expect(data.models).toEqual(['a-model', 'b-model']);
    const { data: test } = await call('POST', `/providers/${provider.id}/test`, {});
    expect(test.ok).toBe(true);
  });

  it('builds prompts for every planning task', async () => {
    const { book, chapterId } = await setup();
    const { data: tree } = await call<BookTree>('GET', `/books/${book.id}`);
    const { data: world } = await call('POST', `/books/${book.id}/world`, { name: '雾城', category: '地点' });
    const char = tree.characters[0];
    const tasks = [
      { task: 'outline_book' },
      { task: 'outline_volumes', count: 3 },
      { task: 'outline_chapters', volumeId: tree.volumes[0].id, count: 5 },
      { task: 'chapter_outline', chapterId },
      { task: 'character', characterId: char.id },
      { task: 'world', worldId: world.id },
      { task: 'rewrite', mode: 'vivid', text: '他很生气。' },
      { task: 'deai', text: '她深吸一口气。', issues: ['「深吸一口气」'] },
      { task: 'chat', messages: [{ role: 'user', content: '林晚该怎么出场？' }] },
    ];
    for (const t of tasks) {
      const { status, data } = await call('POST', '/ai/preview', { bookId: book.id, ...t });
      expect(status, `${t.task}: ${JSON.stringify(data)}`).toBe(200);
      expect(data.messages.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('llm stream helpers', () => {
  it('parses SSE split across chunks', async () => {
    const enc = new TextEncoder();
    const chunks = ['data: {"a"', ':1}\n\nevent: x\r\ndata: 2\r\n\r\n', 'data: tail'];
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((s) => c.enqueue(enc.encode(s)));
        c.close();
      },
    });
    const out = [];
    for await (const ev of sseEvents(stream)) out.push(ev);
    expect(out).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'x', data: '2' },
      { event: 'message', data: 'tail' },
    ]);
  });

  it('passes text through when there is no think tag', async () => {
    async function* src(): AsyncGenerator<LlmChunk> {
      yield { type: 'text', text: '<' };
      yield { type: 'text', text: 'b>你好' };
    }
    const out: LlmChunk[] = [];
    for await (const c of splitThinkTags(src())) out.push(c);
    expect(out.map((c) => c.text).join('')).toBe('<b>你好');
    expect(out.every((c) => c.type === 'text')).toBe(true);
  });
});
