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
    429: '服务商限流、满载或额度不足（已自动重试）',
    500: '服务商内部错误',
    502: '服务商网关错误',
    503: '服务暂时不可用',
  };
  return new LlmError(`${hint[res.status] ?? '请求失败'}（HTTP ${res.status}）${detail ? '：' + detail : ''}`, res.status);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))), { once: true });
  });
}

const RETRY_DELAYS = [1500, 4000];

async function postJson(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new LlmError(`无法连接到 ${new URL(url).host}：${(err as Error).message}。请检查接口地址和网络/代理。`);
    }
    if ((res.status !== 429 && res.status !== 503) || attempt >= RETRY_DELAYS.length) return res;
    // 满载 / 限流时自动重试；额度不足重试也没用
    const text = await res.text();
    if (/quota|insufficient|billing|balance|余额|欠费/i.test(text)) return new Response(text, { status: res.status, headers: res.headers });
    const after = Number(res.headers.get('retry-after'));
    await sleep(after > 0 && after <= 10 ? after * 1000 : RETRY_DELAYS[attempt], signal);
  }
}

/** 部分模型不接受某些参数（如 temperature、max_tokens、reasoning），遇到 400 时去掉报错里提到的参数重试 */
async function postWithParamFallback(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  optional: string[],
  signal?: AbortSignal,
) {
  let current = body;
  let remaining = optional.filter((k) => k in body);
  for (;;) {
    const res = await postJson(url, headers, current, signal);
    if (res.status !== 400 || !remaining.length) return res;
    const text = await res.text();
    let drop = remaining.filter((k) => text.includes(k));
    if (!drop.length && /unsupported|not support/i.test(text)) drop = remaining;
    if (!drop.length) return new Response(text, { status: 400 });
    current = { ...current };
    for (const k of drop) delete current[k];
    remaining = remaining.filter((k) => !drop.includes(k));
  }
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

/** OpenAI Responses 接口（/v1/responses）的流式调用 */
async function* responsesStream(o: LlmOptions): AsyncGenerator<LlmChunk> {
  const { provider } = o;
  const headers: Record<string, string> = {};
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  if (provider.baseUrl.includes('openrouter.ai')) headers['X-Title'] = 'Inkwell Novel';
  const base = provider.baseUrl.replace(/\/responses\/?$/, '');
  const body: Record<string, unknown> = {
    model: o.model,
    input: o.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    store: false,
    // 推理模型返回思考摘要；普通模型不支持时会被参数回退去掉
    reasoning: { summary: 'auto' },
  };
  const system = systemText(o.messages);
  if (system) body.instructions = system;
  if (o.temperature !== undefined) body.temperature = o.temperature;
  if (o.maxTokens) body.max_output_tokens = o.maxTokens;
  const res = await postWithParamFallback(
    joinUrl(base, '/responses'),
    headers,
    body,
    ['reasoning', 'temperature', 'max_output_tokens', 'store'],
    o.signal,
  );
  if (!res.ok || !res.body) throw await describeError(res);
  let gotText = false;
  let refusal = '';
  for await (const ev of sseEvents(res.body)) {
    if (ev.data === '[DONE]') break;
    let json: any;
    try {
      json = JSON.parse(ev.data);
    } catch {
      continue;
    }
    const type = json.type ?? ev.event;
    if (type === 'response.output_text.delta') {
      if (typeof json.delta === 'string' && json.delta) {
        gotText = true;
        yield { type: 'text', text: json.delta };
      }
    } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
      if (typeof json.delta === 'string' && json.delta) yield { type: 'reasoning', text: json.delta };
    } else if (type === 'response.reasoning_summary_part.added') {
      if (json.summary_index > 0) yield { type: 'reasoning', text: '\n\n' };
    } else if (type === 'response.refusal.delta') {
      if (typeof json.delta === 'string') refusal += json.delta;
    } else if (type === 'error') {
      throw new LlmError(json.message ?? json.error?.message ?? 'Responses 接口返回错误');
    } else if (type === 'response.failed') {
      throw new LlmError(json.response?.error?.message ?? '生成失败（response.failed）');
    } else if (type === 'response.incomplete') {
      const reason = json.response?.incomplete_details?.reason;
      if (reason === 'content_filter') throw new LlmError('内容被安全策略拦截，输出不完整');
      if (reason === 'max_output_tokens' && !gotText) {
        const used = json.response?.usage?.output_tokens_details?.reasoning_tokens;
        throw new LlmError(
          `输出额度用完了：模型${used ? `把 ${used} 个 token 都用在了思考上，` : ''}还没开始写正文。请到「设置 → 生成参数」调高「单次最大输出 tokens」（推理模型建议 16000 以上）。`,
        );
      }
      break;
    } else if (type === 'response.completed') {
      // 个别中转不推送增量，只在结束时给出完整结果
      if (!gotText) {
        const text = (json.response?.output ?? [])
          .flatMap((item: any) => item?.content ?? [])
          .filter((c: any) => c?.type === 'output_text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('');
        if (text) {
          gotText = true;
          yield { type: 'text', text };
        }
      }
      break;
    }
  }
  if (!gotText && refusal) throw new LlmError(`模型拒绝了这个请求：${refusal.slice(0, 300)}`);
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
    case 'responses':
      return splitThinkTags(responsesStream(o));
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
    url = joinUrl(provider.kind === 'responses' ? provider.baseUrl.replace(/\/responses\/?$/, '') : provider.baseUrl, '/models');
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
