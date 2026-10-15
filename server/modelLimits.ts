import { readFileSync } from 'node:fs';
import type { LimitSource, ModelLimit, Provider, ResolvedLimit } from '../shared/types';
import type { LlmMessage } from './llm';

/** 不知道模型上限时的输出额度：足够推理模型思考 + 写一章；太大的话服务商通常会在报错里给出真实上限，再自动修正 */
export const FALLBACK_OUTPUT = 32768;

/** 把各家的写法归一：去掉组织前缀、大小写、:free / @eu 这类后缀 */
export function normalizeModelId(id: string): string {
  let s = id.trim().toLowerCase();
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/^hf:/, '').replace(/[:@].*$/, '');
  return s;
}

function variants(id: string): string[] {
  const n = normalizeModelId(id);
  const out = [n];
  const noDate = n.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '');
  if (noDate !== n) out.push(noDate);
  const noLatest = noDate.replace(/-latest$/, '');
  if (noLatest !== noDate) out.push(noLatest);
  return out;
}

let library: Record<string, [number, number]> | null = null;

function loadLibrary() {
  if (!library) {
    try {
      library = JSON.parse(readFileSync(new URL('./modelLimits.json', import.meta.url), 'utf8')).models ?? {};
    } catch {
      library = {};
    }
  }
  return library!;
}

/** 内置模型库（models.dev 快照）里的上限 */
export function libraryLimit(model: string): ModelLimit | undefined {
  const lib = loadLibrary();
  for (const v of variants(model)) {
    const hit = lib[v];
    if (hit) return { context: hit[0] || undefined, output: hit[1] || undefined };
  }
  return undefined;
}

/** 优先级：手动填写 > 服务商（接口返回或报错得知） > 内置模型库 */
export function resolveLimit(p: Provider, model: string, opts: { overrides?: boolean } = {}): ResolvedLimit {
  const layers: [LimitSource, ModelLimit | undefined][] = [
    ['manual', opts.overrides === false ? undefined : p.limitOverrides?.[model]],
    ['provider', p.detectedLimits?.[model]],
    ['library', libraryLimit(model)],
  ];
  const out: ResolvedLimit = {};
  for (const [src, l] of layers) {
    if (!l) continue;
    if (!out.context && l.context) Object.assign(out, { context: l.context, contextSource: src });
    if (!out.output && l.output) Object.assign(out, { output: l.output, outputSource: src });
  }
  return out;
}

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 256 ? Math.floor(n) : undefined;
};

/** 读取 /models 列表里各家自带的长度字段（OpenRouter、Gemini、Groq、Mistral、Together、vLLM 等） */
export function limitFromModelInfo(m: any): ModelLimit | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const pick = (...vals: unknown[]) => vals.map(num).find(Boolean);
  const context = pick(
    m.context_length,
    m.context_window,
    m.max_context_length,
    m.max_model_len,
    m.max_input_tokens,
    m.inputTokenLimit,
    m.input_token_limit,
    m.top_provider?.context_length,
    m.limit?.context,
    m.limits?.context,
  );
  let output = pick(
    m.max_completion_tokens,
    m.max_output_tokens,
    m.outputTokenLimit,
    m.output_token_limit,
    m.top_provider?.max_completion_tokens,
    m.limit?.output,
    m.limits?.output,
  );
  // max_tokens 在不同服务商含义不一，只有能和上下文区分开时才当作输出上限
  if (!output && context && num(m.max_tokens) && num(m.max_tokens)! < context) output = num(m.max_tokens);
  return context || output ? { context, output } : undefined;
}

/**
 * 从「输出额度太大」一类的报错里读出可用的数值。
 * retryWith：这次应该改用的输出额度；learned：可以记下来的模型上限（余额不足之类与模型无关的不记）。
 */
export function parseLimitError(text: string, requested: number): { retryWith: number; learned?: ModelLimit } | null {
  const t = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const margin = 64;
  // Anthropic：input length and `max_tokens` exceed context limit: 188240 + 21333 > 200000
  let m = t.match(/(\d{2,})\s*\+\s*(\d{2,})\s*>\s*(\d{3,})/);
  if (m) {
    const [input, , context] = m.slice(1).map(Number);
    return { retryWith: context - input - margin, learned: { context } };
  }
  // OpenAI / vLLM：maximum context length is 32768 tokens. However, you requested 100100 tokens (100 in the messages, ...)
  m = t.match(/context (?:length|window)\D{0,24}(\d{3,})/i);
  if (m) {
    const context = Number(m[1]);
    const used = t.match(/(\d+)\s*(?:tokens?\s*)?in the messages/i) ?? t.match(/messages resulted in (\d+)/i) ?? t.match(/prompt (?:is|has|contains) (\d+)/i);
    if (used) return { retryWith: context - Number(used[1]) - margin, learned: { context } };
  }
  const aboutTokens = /max[\s_-]*(?:output|completion|new)?[\s_-]*tokens|output tokens|completion tokens|maxOutputTokens|输出.{0,6}(?:token|长度)/i.test(t);
  const aboutCredit = /credit|afford|quota|balance|余额|额度|充值/i.test(t);
  if (!aboutTokens) return null;
  const nums = (t.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 256 && n < requested);
  if (!nums.length) return null;
  const retryWith = Math.max(...nums);
  return { retryWith, learned: aboutCredit ? undefined : { output: retryWith } };
}

/** 粗略估算提示词 token 数：中日韩字符按 1.1 个，其他按 3.5 个字符一个 */
export function estimateTokens(messages: LlmMessage[]): number {
  let n = 0;
  for (const m of messages) {
    const cjk = (m.content.match(/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g) ?? []).length;
    n += cjk * 1.1 + (m.content.length - cjk) / 3.5 + 8;
  }
  return Math.ceil(n);
}

/**
 * 决定这次请求的输出额度。默认按模型的最大输出来，计费只按实际生成的 token，额度给足不会多花钱；
 * 同时扣掉提示词，保证不超过上下文窗口。
 */
export function planMaxTokens(o: { limit: ResolvedLimit; override?: number; promptTokens: number }): number {
  const { limit } = o;
  let cap = o.override && o.override > 0 ? o.override : (limit.output ?? FALLBACK_OUTPUT);
  if (limit.output) cap = Math.min(cap, limit.output);
  if (limit.context) cap = Math.min(cap, Math.max(1024, limit.context - o.promptTokens - 512));
  return Math.max(256, Math.floor(cap));
}

export function cleanLimits(input: unknown): Record<string, ModelLimit> {
  const out: Record<string, ModelLimit> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [model, l] of Object.entries(input as Record<string, any>)) {
    const context = num(l?.context);
    const output = num(l?.output);
    if (model.trim() && (context || output)) out[model] = { ...(context ? { context } : {}), ...(output ? { output } : {}) };
  }
  return out;
}
