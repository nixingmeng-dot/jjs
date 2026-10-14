import type { Provider } from '../shared/types';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  provider: Provider;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmChunk {
  type: 'text' | 'reasoning';
  text: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

// ---------------- SSE ----------------

export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  const dispatch = function* () {
    if (data.length) yield { event: event || 'message', data: data.join('\n') };
    event = '';
    data = [];
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(buffer[nl] === '\r' ? nl + 2 : nl + 1);
        if (line === '') {
          yield* dispatch();
        } else if (line.startsWith(':')) {
          continue;
        } else {
          const idx = line.indexOf(':');
          const field = idx === -1 ? line : line.slice(0, idx);
          let value = idx === -1 ? '' : line.slice(idx + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).trim();
      }
    }
    yield* dispatch();
  } finally {
    reader.releaseLock();
  }
}

// ---------------- helpers ----------------

export function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

async function describeError(res: Response): Promise<LlmError> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.message ?? j?.error ?? text;
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {
      detail = text;
    }
  } catch {
    /* ignore */
  }
  detail = detail.slice(0, 400);
  const hint: Record<number, string> = {
    400: '请求参数有误（常见原因：模型名不正确）',
    401: 'API Key 无效或未填写',
    403: '没有权限访问该模型或接口',
    404: '接口地址或模型名不存在',
    429: '请求太频繁或账户额度不足',
    500: '服务商内部错误',
    502: '服务商网关错误',
    503: '服务暂时不可用',
  };
  return new LlmError(`${hint[res.status] ?? '请求失败'}（HTTP ${res.status}）${detail ? '：' + detail : ''}`, res.status);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new LlmError(`无法连接到 ${new URL(url).host}：${(err as Error).message}。请检查接口地址和网络/代理。`);
  }
}

/** 部分新模型不接受自定义 temperature / max_tokens，遇到 400 时去掉这些参数重试一次 */
async function postWithParamFallback(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  optional: string[],
  signal?: AbortSignal,
) {
  let res = await postJson(url, headers, body, signal);
  if (res.status === 400) {
    const text = await res.text();
    const mentioned = optional.filter((k) => text.includes(k) || /unsupported|not support/i.test(text));
    if (mentioned.length) {
      const stripped = { ...body };
      for (const k of optional) delete stripped[k];
      res = await postJson(url, headers, stripped, signal);
    } else {
      return new Response(text, { status: 400 });
    }
  }
  return res;
}

function systemText(messages: LlmMessage[]) {
  return messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
}

/** Anthropic / Gemini 要求 user/assistant 交替且以 user 开头 */
function alternating(messages: LlmMessage[]) {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '（继续）' });
  return out;
}

// ---------------- providers ----------------

async function* openaiStream(o: LlmOptions): AsyncGenerator<LlmChunk> {
  const { provider } = o;
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  if (provider.baseUrl.includes('openrouter.ai')) headers['X-Title'] = 'Inkwell Novel';
  const official = provider.baseUrl.includes('api.openai.com');
  const tokenKey = official ? 'max_completion_tokens' : 'max_tokens';
  const body: Record<string, unknown> = { model: o.model, messages: o.messages, stream: true };
  if (o.temperature !== undefined) body.temperature = o.temperature;
  if (o.maxTokens) body[tokenKey] = o.maxTokens;
  const res = await postWithParamFallback(
    joinUrl(provider.baseUrl, '/chat/completions'),
    headers,
    body,
    ['temperature', tokenKey],
    o.signal,
  );
  if (!res.ok || !res.body) throw await describeError(res);
  for await (const ev of sseEvents(res.body)) {
    if (ev.data === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json.error) throw new LlmError(json.error.message ?? JSON.stringify(json.error));
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
    if (typeof delta.content === 'string' && delta.content) yield { type: 'text', text: delta.content };
  }
}

async function* anthropicStream(o: LlmOptions): AsyncGenerator<LlmChunk> {
  const { provider } = o;
  const base = provider.baseUrl.replace(/\/v1\/?$/, '');
  const body: Record<string, unknown> = {
    model: o.model,
    max_tokens: o.maxTokens || 4096,
    messages: alternating(o.messages),
    stream: true,
  };
  const system = systemText(o.messages);
  if (system) body.system = system;
  if (o.temperature !== undefined) body.temperature = Math.min(1, o.temperature);
  const res = await postWithParamFallback(
    joinUrl(base, '/v1/messages'),
    { 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
    body,
    ['temperature'],
    o.signal,
  );
  if (!res.ok || !res.body) throw await describeError(res);
  for await (const ev of sseEvents(res.body)) {
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const type = json.type ?? ev.event;
    if (type === 'error') throw new LlmError(json.error?.message ?? 'Anthropic 返回错误');
    if (type === 'message_stop') return;
    if (type === 'content_block_delta') {
      const d = json.delta;
      if (d?.type === 'text_delta' && d.text) yield { type: 'text', text: d.text };
      else if (d?.type === 'thinking_delta' && d.thinking) yield { type: 'reasoning', text: d.thinking };
    }
  }
}

async function* geminiStream(o: LlmOptions): AsyncGenerator<LlmChunk> {
  const { provider } = o;
  const base = provider.baseUrl.replace(/\/v1(beta)?\/?$/, '');
  const model = o.model.replace(/^models\//, '');
  const generationConfig: Record<string, unknown> = {};
  if (o.temperature !== undefined) generationConfig.temperature = o.temperature;
  if (o.maxTokens) generationConfig.maxOutputTokens = o.maxTokens;
  const body: Record<string, unknown> = {
    contents: alternating(o.messages).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig,
  };
  const system = systemText(o.messages);
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await postJson(
    joinUrl(base, `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`),
    { 'x-goog-api-key': provider.apiKey },
    body,
    o.signal,
  );
  if (!res.ok || !res.body) throw await describeError(res);
  for await (const ev of sseEvents(res.body)) {
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (json.error) throw new LlmError(json.error.message ?? 'Gemini 返回错误');
    if (json.promptFeedback?.blockReason) throw new LlmError(`内容被安全策略拦截：${json.promptFeedback.blockReason}`);
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (typeof p.text !== 'string' || !p.text) continue;
      yield { type: p.thought ? 'reasoning' : 'text', text: p.text };
    }
  }
}

/** 一些推理模型把思考过程放在正文的 <think>…</think> 里，这里拆出来 */
export async function* splitThinkTags(src: AsyncIterable<LlmChunk>): AsyncGenerator<LlmChunk> {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let mode: 'detect' | 'think' | 'text' = 'detect';
  let buf = '';
  for await (const c of src) {
    if (c.type !== 'text' || mode === 'text') {
      yield c;
      continue;
    }
    buf += c.text;
    if (mode === 'detect') {
      const t = buf.trimStart();
      if (t.length < OPEN.length && OPEN.startsWith(t)) continue;
      if (t.startsWith(OPEN)) {
        mode = 'think';
        buf = t.slice(OPEN.length);
      } else {
        mode = 'text';
        yield { type: 'text', text: buf };
        buf = '';
        continue;
      }
    }
    const end = buf.indexOf(CLOSE);
    if (end === -1) {
      if (buf.length > CLOSE.length) {
        yield { type: 'reasoning', text: buf.slice(0, -CLOSE.length) };
        buf = buf.slice(-CLOSE.length);
      }
      continue;
    }
    if (end > 0) yield { type: 'reasoning', text: buf.slice(0, end) };
    const rest = buf.slice(end + CLOSE.length).replace(/^\s+/, '');
    mode = 'text';
    buf = '';
    if (rest) yield { type: 'text', text: rest };
  }
  if (buf) yield { type: mode === 'think' ? 'reasoning' : 'text', text: buf };
}

export function streamChat(o: LlmOptions): AsyncGenerator<LlmChunk> {
  if (!o.model) throw new LlmError('未选择模型，请在设置中为该服务商添加模型');
  if (!o.provider.baseUrl) throw new LlmError('服务商未填写接口地址');
  switch (o.provider.kind) {
    case 'anthropic':
      return anthropicStream(o);
    case 'gemini':
      return geminiStream(o);
    default:
      return splitThinkTags(openaiStream(o));
  }
}

export async function listModels(provider: Provider, signal?: AbortSignal): Promise<string[]> {
  let url: string;
  const headers: Record<string, string> = {};
  if (provider.kind === 'anthropic') {
    url = joinUrl(provider.baseUrl.replace(/\/v1\/?$/, ''), '/v1/models?limit=1000');
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.kind === 'gemini') {
    url = joinUrl(provider.baseUrl.replace(/\/v1(beta)?\/?$/, ''), '/v1beta/models?pageSize=1000');
    headers['x-goog-api-key'] = provider.apiKey;
  } else {
    url = joinUrl(provider.baseUrl, '/models');
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (err) {
    throw new LlmError(`无法连接到 ${new URL(url).host}：${(err as Error).message}`);
  }
  if (!res.ok) throw await describeError(res);
  const json: any = await res.json();
  let ids: string[];
  if (provider.kind === 'gemini') {
    ids = (json.models ?? [])
      .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''));
  } else {
    ids = (json.data ?? json.models ?? []).map((m: any) => String(m.id ?? m.name));
  }
  return Array.from(new Set(ids.filter(Boolean))).sort();
}
