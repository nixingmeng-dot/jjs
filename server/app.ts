import { Hono } from 'hono';
import type { AiRequest, AiStreamEvent, AppSettings, CollectionName, Provider, ResolvedLimit, Volume } from '../shared/types';
import { COLLECTIONS, HttpError, type Repo } from './db';
import { listModels, streamChat } from './llm';
import { estimateTokens, planMaxTokens, resolveLimit } from './modelLimits';
import { buildPrompt, parseMemory } from './prompts';
import { exportBook, importBackup, importText } from './transfer';

const MASK = '••••';

function maskProvider(p: Provider): Provider {
  const key = p.apiKey ?? '';
  return {
    ...p,
    apiKey: key ? `${key.slice(0, 3)}${MASK}${key.slice(-4)}` : '',
    hasKey: key.length > 0,
  };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopback = (url: string) => {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

export function createApp(repo: Repo, opts: { localOnly?: boolean } = {}) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof SyntaxError) return c.json({ error: '请求格式错误' }, 400);
    console.error(err);
    return c.json({ error: err.message || '服务器内部错误' }, 500);
  });

  // 只监听本机时，拒绝 Host 不是本机的请求（防 DNS 重绑定读取作品、改服务商地址套取 Key）
  // 和来自其他网站的请求（防跨站提交，例如偷偷调用 AI 消耗额度）
  if (opts.localOnly) {
    app.use('*', async (c, next) => {
      const origin = c.req.header('origin');
      if (!isLoopback(c.req.url) || (origin !== undefined && !isLoopback(origin))) return c.json({ error: '只接受来自本机的请求' }, 403);
      await next();
    });
  }

  const api = new Hono();
  const body = async <T = Record<string, unknown>>(c: { req: { json: () => Promise<unknown> } }) =>
    ((await c.req.json().catch(() => ({}))) ?? {}) as T;
  const mustBook = (id: string) => {
    if (!repo.getBook(id)) throw new HttpError(404, '作品不存在');
  };

  api.get('/health', (c) => c.json({ ok: true, app: 'inkwell' }));

  // ---------- books ----------
  api.get('/books', (c) => c.json(repo.listBooks()));
  api.post('/books', async (c) => c.json(repo.createBook(await body(c))));
  api.get('/books/:id', (c) => {
    const tree = repo.getTree(c.req.param('id'));
    if (!tree) throw new HttpError(404, '作品不存在');
    return c.json(tree);
  });
  api.patch('/books/:id', async (c) => {
    mustBook(c.req.param('id'));
    return c.json(repo.updateBook(c.req.param('id'), await body(c)));
  });
  api.delete('/books/:id', (c) => {
    repo.deleteBook(c.req.param('id'));
    return c.json({ ok: true });
  });
  api.get('/books/:id/stats', (c) => {
    mustBook(c.req.param('id'));
    return c.json(repo.stats(c.req.param('id')));
  });
  api.get('/books/:id/search', (c) => c.json(repo.search(c.req.param('id'), c.req.query('q') ?? '')));
  api.get('/books/:id/export', (c) => {
    const format = (c.req.query('format') ?? 'txt') as 'txt' | 'md' | 'json';
    if (!['txt', 'md', 'json'].includes(format)) throw new HttpError(400, '不支持的导出格式');
    const file = exportBook(repo, c.req.param('id'), format);
    return c.body(file.body, 200, {
      'content-type': file.type,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    });
  });

  api.post('/import/backup', async (c) => c.json(importBackup(repo, await body(c))));
  api.post('/import/text', async (c) => {
    const { title, text } = await body<{ title?: string; text?: string }>(c);
    return c.json(importText(repo, title ?? '', text ?? ''));
  });

  // ---------- collections ----------
  for (const name of Object.keys(COLLECTIONS) as CollectionName[]) {
    api.post(`/books/:bookId/${name}`, async (c) => {
      mustBook(c.req.param('bookId'));
      return c.json(repo.insert(name, c.req.param('bookId'), await body(c)));
    });
    api.post(`/books/:bookId/${name}/batch`, async (c) => {
      mustBook(c.req.param('bookId'));
      const { items } = await body<{ items?: Record<string, unknown>[] }>(c);
      if (!Array.isArray(items)) throw new HttpError(400, 'items 必须是数组');
      return c.json(repo.batchInsert(name, c.req.param('bookId'), items));
    });
    api.post(`/books/:bookId/${name}/reorder`, async (c) => {
      const { ids, volumeId } = await body<{ ids?: string[]; volumeId?: string }>(c);
      if (!Array.isArray(ids)) throw new HttpError(400, 'ids 必须是数组');
      repo.reorder(name, ids, volumeId);
      return c.json({ ok: true });
    });
    api.patch(`/${name}/:id`, async (c) => c.json(repo.update(name, c.req.param('id'), await body(c))));
    api.delete(`/${name}/:id`, (c) => {
      repo.remove(name, c.req.param('id'));
      return c.json({ ok: true });
    });
  }

  // ---------- chapters & snapshots ----------
  api.get('/chapters/:id', (c) => {
    const ch = repo.getChapter(c.req.param('id'));
    if (!ch) throw new HttpError(404, '章节不存在');
    return c.json(ch);
  });
  api.get('/chapters/:id/snapshots', (c) => c.json(repo.listSnapshots(c.req.param('id'))));
  api.post('/chapters/:id/snapshots', async (c) => {
    const { note, content } = await body<{ note?: string; content?: string }>(c);
    if (!repo.getChapter(c.req.param('id'))) throw new HttpError(404, '章节不存在');
    return c.json(repo.createSnapshot(c.req.param('id'), note || '手动保存', content));
  });
  api.get('/snapshots/:id', (c) => {
    const s = repo.getSnapshot(c.req.param('id'));
    if (!s) throw new HttpError(404, '版本不存在');
    return c.json(s);
  });
  api.delete('/snapshots/:id', (c) => {
    repo.deleteSnapshot(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---------- settings ----------
  api.get('/settings', (c) => c.json(repo.getSettings()));
  api.patch('/settings', async (c) => c.json(repo.updateSettings(await body<Partial<AppSettings>>(c))));

  // ---------- providers ----------
  api.get('/providers', (c) => c.json(repo.listProviders().map(maskProvider)));
  /** 默认服务商的模型列表变化后，保证默认模型仍然有效 */
  const syncDefault = (p: Provider) => {
    const s = repo.getSettings();
    if (!s.defaultProviderId) repo.updateSettings({ defaultProviderId: p.id, defaultModel: p.models[0] ?? '' });
    else if (s.defaultProviderId === p.id && !p.models.includes(s.defaultModel)) repo.updateSettings({ defaultModel: p.models[0] ?? '' });
  };

  api.post('/providers', async (c) => {
    const data = await body<Partial<Provider>>(c);
    delete data.id;
    const p = repo.saveProvider(data);
    syncDefault(p);
    return c.json(maskProvider(p));
  });
  api.patch('/providers/:id', async (c) => {
    const data = await body<Partial<Provider>>(c);
    if (typeof data.apiKey === 'string' && data.apiKey.includes(MASK)) delete data.apiKey;
    if (!repo.getProvider(c.req.param('id'))) throw new HttpError(404, '服务商不存在');
    const p = repo.saveProvider({ ...data, id: c.req.param('id') });
    syncDefault(p);
    return c.json(maskProvider(p));
  });
  api.delete('/providers/:id', (c) => {
    repo.deleteProvider(c.req.param('id'));
    const s = repo.getSettings();
    if (s.defaultProviderId === c.req.param('id')) {
      const next = repo.listProviders()[0];
      repo.updateSettings({ defaultProviderId: next?.id ?? '', defaultModel: next?.models[0] ?? '' });
    }
    return c.json({ ok: true });
  });
  api.post('/providers/:id/models', async (c) => {
    const p = repo.getProvider(c.req.param('id'));
    if (!p) throw new HttpError(404, '服务商不存在');
    try {
      const { ids, limits } = await listModels(p, AbortSignal.timeout(20000));
      repo.mergeDetectedLimits(p.id, limits);
      return c.json({ models: ids, limits });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });
  api.post('/providers/:id/test', async (c) => {
    const p = repo.getProvider(c.req.param('id'));
    if (!p) throw new HttpError(404, '服务商不存在');
    const { model } = await body<{ model?: string }>(c);
    const m = model || p.models[0];
    if (!m) throw new HttpError(400, '请先添加至少一个模型');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 45000);
    const started = Date.now();
    try {
      let sample = '';
      let kind = 'text';
      for await (const chunk of streamChat({
        provider: p,
        model: m,
        messages: [{ role: 'user', content: '请只回复两个字：你好' }],
        // 用和正式请求一样的额度，顺便验证服务商接受它；拿到第一段就中断，不会真的用满
        maxTokens: planMaxTokens({ limit: resolveLimit(p, m), override: repo.getSettings().maxTokens, promptTokens: 32 }),
        onLearn: (l) => repo.mergeDetectedLimits(p.id, { [m]: l }),
        signal: ac.signal,
      })) {
        sample += chunk.text;
        kind = chunk.type;
        break;
      }
      return c.json({ ok: true, model: m, latency: Date.now() - started, sample: sample.slice(0, 50), kind });
    } catch (err) {
      const msg = ac.signal.aborted ? '连接超时（45 秒无响应）' : (err as Error).message;
      return c.json({ ok: false, model: m, error: msg });
    } finally {
      clearTimeout(timer);
      ac.abort();
    }
  });

  /** 模型的自动识别上限（不含手动填写），供设置页显示 */
  api.post('/model-limits', async (c) => {
    const { providerId, models } = await body<{ providerId?: string; models?: string[] }>(c);
    const p = (providerId && repo.getProvider(providerId)) || ({ detectedLimits: {}, limitOverrides: {} } as unknown as Provider);
    const out: Record<string, ResolvedLimit> = {};
    for (const m of (models ?? []).slice(0, 500)) out[m] = resolveLimit(p, m, { overrides: false });
    return c.json(out);
  });

  // ---------- AI ----------
  const resolveModel = (req: AiRequest) => {
    const settings = repo.getSettings();
    const providerId = req.providerId || settings.defaultProviderId || repo.listProviders().find((p) => p.enabled)?.id;
    const provider = providerId ? repo.getProvider(providerId) : undefined;
    if (!provider) throw new HttpError(400, '还没有配置模型服务，请先到「设置 → 模型服务」添加 API。');
    const model =
      req.model || (provider.id === settings.defaultProviderId ? settings.defaultModel : '') || provider.models[0] || '';
    if (!model) throw new HttpError(400, `「${provider.name}」还没有添加模型，请到设置中添加。`);
    return { settings, provider, model };
  };

  // ---------- 故事记忆 ----------
  /** 后台整理用：不流式返回，只收集正文 */
  const collect = async (req: AiRequest) => {
    const { settings, provider, model } = resolveModel(req);
    const limit = resolveLimit(provider, model);
    const built = buildPrompt(repo, req, settings, { contextTokens: limit.context });
    const signal = AbortSignal.timeout(240_000);
    let text = '';
    try {
      for await (const chunk of streamChat({
        provider,
        model,
        messages: built.messages,
        temperature: built.temperature,
        maxTokens: planMaxTokens({ limit, override: settings.maxTokens, promptTokens: estimateTokens(built.messages) }),
        onLearn: (l) => repo.mergeDetectedLimits(provider.id, { [model]: l }),
        signal,
      })) {
        if (chunk.type === 'text') text += chunk.text;
      }
    } catch (err) {
      if (signal.aborted) throw new HttpError(504, '整理超时（4 分钟无结果），请稍后重试');
      throw err;
    }
    return text;
  };
  // 同一章 / 同一卷同时只整理一次
  const inflight = new Map<string, Promise<unknown>>();
  const once = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const running = inflight.get(key);
    if (running) return running as Promise<T>;
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  api.get('/books/:id/memory', (c) => {
    const id = c.req.param('id');
    mustBook(id);
    return c.json({ status: repo.memoryStatus(id), updates: repo.listMemoryUpdates(id) });
  });
  api.post('/chapters/:id/memorize', async (c) => {
    const id = c.req.param('id');
    const ch = repo.getChapter(id);
    if (!ch) throw new HttpError(404, '章节不存在');
    const result = await once(`chapter:${id}`, async () => {
      const parsed = parseMemory(await collect({ task: 'memorize', bookId: ch.bookId, chapterId: id }));
      if (!parsed.summary) throw new HttpError(502, '模型没有返回可用的摘要，请重试或换一个模型');
      repo.update('chapters', id, { summary: parsed.summary });
      const updates = repo.replaceMemoryUpdates(ch.bookId, id, parsed.updates);
      return { chapter: repo.getEntity('chapters', id), updates };
    });
    return c.json(result);
  });
  api.post('/volumes/:id/recap', async (c) => {
    const id = c.req.param('id');
    const vol = repo.getEntity('volumes', id) as unknown as Volume | undefined;
    if (!vol) throw new HttpError(404, '分卷不存在');
    const result = await once(`volume:${id}`, async () => {
      const recap = (await collect({ task: 'volume_recap', bookId: vol.bookId, volumeId: id })).trim().slice(0, 1500);
      if (!recap) throw new HttpError(502, '模型没有返回卷回顾，请重试');
      return repo.setVolumeRecap(id, recap);
    });
    return c.json(result);
  });
  api.post('/books/:id/memory-updates/apply', async (c) => {
    const id = c.req.param('id');
    const { items } = await body<{ items?: { id: string; name?: string; fact?: string }[] }>(c);
    if (!Array.isArray(items)) throw new HttpError(400, 'items 必须是数组');
    const applied = repo.applyMemoryUpdates(id, items);
    return c.json({ applied, updates: repo.listMemoryUpdates(id) });
  });
  api.post('/books/:id/memory-updates/dismiss', async (c) => {
    const id = c.req.param('id');
    const { ids } = await body<{ ids?: string[] }>(c);
    if (!Array.isArray(ids)) throw new HttpError(400, 'ids 必须是数组');
    repo.dismissMemoryUpdates(id, ids);
    return c.json({ updates: repo.listMemoryUpdates(id) });
  });

  api.post('/ai/preview', async (c) => {
    const req = await body<AiRequest>(c);
    const settings = repo.getSettings();
    return c.json(buildPrompt(repo, req, settings));
  });

  api.post('/ai/run', async (c) => {
    const req = await body<AiRequest>(c);
    if (!req.bookId) throw new HttpError(400, '缺少 bookId');
    const { settings, provider, model } = resolveModel(req);
    const limit = resolveLimit(provider, model);
    const built = buildPrompt(repo, req, settings, { contextTokens: limit.context });
    const controller = new AbortController();
    c.req.raw.signal?.addEventListener('abort', () => controller.abort());
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(out) {
        const send = (ev: AiStreamEvent) => {
          try {
            out.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
          } catch {
            controller.abort();
          }
        };
        send({ t: 'meta', provider: provider.name, model });
        try {
          for await (const chunk of streamChat({
            provider,
            model,
            messages: built.messages,
            temperature: req.temperature ?? built.temperature,
            maxTokens: planMaxTokens({
              limit,
              override: req.maxTokens ?? settings.maxTokens,
              promptTokens: estimateTokens(built.messages),
            }),
            onLearn: (l) => repo.mergeDetectedLimits(provider.id, { [model]: l }),
            signal: controller.signal,
          })) {
            if (controller.signal.aborted) break;
            send({ t: chunk.type, v: chunk.text });
          }
          send({ t: 'done' });
        } catch (err) {
          if (!controller.signal.aborted) send({ t: 'error', v: (err as Error).message || '生成失败' });
        } finally {
          try {
            out.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      },
    });
  });

  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: '接口不存在' }, 404));
  return app;
}
