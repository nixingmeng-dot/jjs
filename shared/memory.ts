/** 长篇记忆：前后端共用的判断规则 */

/** 少于这个字数的章节不整理记忆 */
export const MEMORY_MIN_WORDS = 300;

export type SummaryState = 'none' | 'missing' | 'stale' | 'fresh';

/** 章节摘要是否需要（重新）生成：生成摘要后正文又改动了较多，就算过期 */
export function summaryState(c: { wordCount: number; summary: string; summaryWords?: number }): SummaryState {
  const has = !!c.summary?.trim();
  if (!has) return c.wordCount >= MEMORY_MIN_WORDS ? 'missing' : 'none';
  const delta = Math.abs(c.wordCount - (c.summaryWords ?? 0));
  return delta >= Math.max(300, c.wordCount * 0.2) ? 'stale' : 'fresh';
}

/** 记忆预算（字符数）：按模型上下文的约 12% 给前情提要，上下限保证小模型放得下、大模型不过度花钱 */
export function memoryBudget(contextTokens?: number) {
  return Math.max(4000, Math.min(30000, Math.round((contextTokens ?? 32768) * 0.12)));
}
