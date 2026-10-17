// 从 models.dev 生成内置模型上限库 server/modelLimits.json。
// 用法：npm run update-model-limits（需要能访问 https://models.dev）
import { writeFileSync } from 'node:fs';
import { normalizeModelId } from '../server/modelLimits';

const SOURCE = 'https://models.dev/api.json';

/** 同一个模型在不同服务商那里上限不同时，优先采用原厂的数据 */
const FIRST_PARTY: [RegExp, string[]][] = [
  [/^(gpt|o\d|chatgpt|codex)/, ['openai']],
  [/^claude/, ['anthropic']],
  [/^(gemini|gemma)/, ['google']],
  [/^deepseek/, ['deepseek']],
  [/^(glm|chatglm)/, ['zhipuai', 'zai']],
  [/^(qwen|qwq|qvq)/, ['alibaba-cn', 'alibaba']],
  [/^(kimi|moonshot)/, ['moonshotai-cn', 'moonshotai']],
  [/^(doubao|seed)/, ['volcengine']],
  [/^grok/, ['xai']],
  [/^(mistral|codestral|magistral|devstral|ministral|pixtral)/, ['mistral']],
  [/^(minimax|abab)/, ['minimax-cn', 'minimax']],
  [/^step/, ['stepfun', 'stepfun-ai']],
  [/^mimo/, ['xiaomi']],
  [/^llama/, ['llama', 'meta']],
  [/^command/, ['cohere']],
  [/^sonar/, ['perplexity']],
];

type Entry = { provider: string; context: number; output: number };

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
const data = (await res.json()) as Record<string, { models?: Record<string, any> }>;

const byId = new Map<string, Entry[]>();
for (const [provider, p] of Object.entries(data)) {
  for (const [key, m] of Object.entries(p.models ?? {})) {
    const out = m?.modalities?.output;
    if (Array.isArray(out) && !out.includes('text')) continue;
    const context = Number(m?.limit?.context) || 0;
    const output = Number(m?.limit?.output) || 0;
    if (!context && !output) continue;
    const id = normalizeModelId(String(m.id ?? key));
    if (!id || id.length > 80) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push({ provider, context, output });
  }
}

const pickOne = (id: string, list: Entry[]): Entry => {
  const preferred = FIRST_PARTY.find(([re]) => re.test(id))?.[1] ?? [];
  for (const p of preferred) {
    const hit = list.find((e) => e.provider === p);
    if (hit) return hit;
  }
  // 否则取各家出现次数最多的数值，打平时取输出较小的（保守）
  const counts = new Map<string, { e: Entry; n: number }>();
  for (const e of list) {
    const k = `${e.context}/${e.output}`;
    counts.set(k, { e, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.e.output - b.e.output)[0].e;
};

const models: Record<string, [number, number]> = {};
for (const id of [...byId.keys()].sort()) {
  const e = pickOne(id, byId.get(id)!);
  models[id] = [e.context, e.output];
}

const file = new URL('../server/modelLimits.json', import.meta.url);
writeFileSync(
  file,
  JSON.stringify({
    source: SOURCE,
    license: 'MIT License, Copyright (c) 2025 models.dev',
    updated: new Date().toISOString().slice(0, 10),
    format: '归一化模型 ID → [上下文 tokens, 最大输出 tokens]，0 表示未知',
    models,
  }),
);
console.log(`已写入 ${Object.keys(models).length} 个模型 → ${file.pathname}`);
