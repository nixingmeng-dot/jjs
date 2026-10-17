import { useState } from 'react';
import { analyzeAiFlavor, issuesForPrompt } from '../../../shared/antiAi';
import type { AiRequest, ChapterMeta, RewriteMode } from '../../../shared/types';
import { api } from '../../api';
import { useBannedWords } from '../../components/ai';
import { useAiTask, type AiTaskHandle } from '../../hooks/useAiTask';
import { toast, toastError, useBook } from '../../store';
import type { EditorHandle } from './editorParts';

export type Target =
  | { kind: 'cursor'; pos: number }
  | { kind: 'range'; start: number; end: number; original: string }
  /** inline：章节原本为空，结果直接在正文里预览 */
  | { kind: 'whole'; inline: boolean }
  | { kind: 'field'; field: 'summary' | 'outline' }
  | { kind: 'none' };

export const REWRITES: { mode: RewriteMode; label: string; title: string }[] = [
  { mode: 'polish', label: '润色', title: '修病句、换准词，不加戏' },
  { mode: 'expand', label: '扩写', title: '补充动作、细节和潜台词' },
  { mode: 'condense', label: '精简', title: '删掉重复和解释' },
  { mode: 'deai', label: '去AI味', title: '去套话、打散句式、删升华' },
  { mode: 'vivid', label: '画面感', title: '把“告知”改成“展示”' },
  { mode: 'dialogue', label: '对白', title: '让台词像真人说话，有潜台词' },
  { mode: 'sensory', label: '感官', title: '加入声音、气味、触感' },
  { mode: 'tension', label: '张力', title: '加快节奏、制造悬念' },
  { mode: 'custom', label: '按要求改', title: '按「额外要求」修改' },
];

export const IDEAS = [
  '接下来剧情可以怎么发展？给我几个方向',
  '这里加一个什么冲突或意外更好看？',
  '给当前场景想几个具体、独特的细节',
  '主角此刻可以做一个什么出人意料的选择？',
  '帮我给新出场的配角起几个名字和一句话人设',
  '这一章的结尾钩子可以怎么设计？',
];

/** 去掉模型偶尔带上的标记 */
export function cleanProse(text: string) {
  return text
    .replace(/^\s*```[a-z]*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^\s*<<<\s*\n?/, '')
    .replace(/\n?\s*>>>\s*$/, '')
    .replace(/\s+$/, '');
}

export interface WriteAssist {
  task: AiTaskHandle;
  target: Target;
  label: string;
  kind: 'prose' | 'plain';
  /** inline：结果在正文里预览；panel：结果在右侧面板 */
  placement: 'inline' | 'panel' | null;
  instruction: string;
  setInstruction: (v: string) => void;
  continueLen: number;
  setContinueLen: (n: number) => void;
  draftLen: number;
  setDraftLen: (n: number) => void;
  doContinue: (instruction?: string) => void;
  doDraft: () => void;
  doRewrite: (mode: RewriteMode, instruction?: string) => void;
  doDeai: (scope: 'selection' | 'whole') => void;
  deaiResult: () => void;
  genField: (field: 'outline' | 'summary') => void;
  brainstorm: (question: string) => void;
  apply: (how: 'replace' | 'insert' | 'append' | 'after') => Promise<void>;
  /** 正文内预览的默认操作：续写插入、改写替换、起草写入 */
  accept: () => void;
  saveField: (field: 'summary' | 'outline', mode: 'replace' | 'append') => void;
  discard: () => void;
}

/** 写作页的 AI 动作与结果状态。放在章节工作区里，开关右侧面板不会打断正在生成的内容。 */
export function useWriteAssist({
  meta,
  editor,
  content,
  selection,
}: {
  meta: ChapterMeta;
  editor: EditorHandle;
  content: string;
  selection: { start: number; end: number };
}): WriteAssist {
  const bookId = useBook((s) => s.tree!.book.id);
  const task = useAiTask();
  const banned = useBannedWords();
  const [target, setTarget] = useState<Target>({ kind: 'none' });
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'prose' | 'plain'>('prose');
  const [instruction, setInstruction] = useState('');
  const [continueLen, setContinueLenState] = useState(() => Number(localStorage.getItem('inkwell.continueLen')) || 500);
  const [draftLen, setDraftLenState] = useState(() => Number(localStorage.getItem('inkwell.draftLen')) || 3000);

  const setContinueLen = (n: number) => {
    setContinueLenState(n);
    localStorage.setItem('inkwell.continueLen', String(n));
  };
  const setDraftLen = (n: number) => {
    setDraftLenState(n);
    localStorage.setItem('inkwell.draftLen', String(n));
  };

  const start = (req: Omit<AiRequest, 'bookId' | 'chapterId'>, t: Target, name: string, k: 'prose' | 'plain' = 'prose', extra?: string) => {
    setTarget(t);
    setLabel(name);
    setKind(k);
    const instr = (extra ?? instruction).trim();
    task.run({ bookId, chapterId: meta.id, instruction: instr || undefined, ...req });
  };

  const doContinue = (extra?: string) => {
    const pos = editor.getSelection().end;
    start({ task: 'continue', before: content.slice(0, pos), after: content.slice(pos), length: continueLen }, { kind: 'cursor', pos }, 'AI 续写', 'prose', extra);
  };

  const doDraft = () => start({ task: 'draft', length: draftLen }, { kind: 'whole', inline: !content.trim() }, '按细纲写本章');

  const doRewrite = (mode: RewriteMode, extra?: string) => {
    const sel = editor.getSelection();
    const live = sel.text.trim().length > 0;
    const s = live ? sel.start : selection.start;
    const e = live ? sel.end : selection.end;
    const text = content.slice(s, e);
    if (!text.trim()) return toast('请先在正文中选中要改写的文字', 'error');
    if (mode === 'custom' && !(extra ?? instruction).trim()) return toast('请先写下修改要求', 'error');
    start(
      { task: 'rewrite', mode, text, before: content.slice(Math.max(0, s - 800), s), after: content.slice(e, e + 300) },
      { kind: 'range', start: s, end: e, original: text },
      REWRITES.find((r) => r.mode === mode)?.label ?? '改写',
      'prose',
      extra,
    );
  };

  const doDeai = (scope: 'selection' | 'whole') => {
    const selText = content.slice(selection.start, selection.end);
    const isSel = scope === 'selection' && selText.trim().length > 0;
    const text = isSel ? selText : content;
    if (!text.trim()) return toast('没有可处理的文字', 'error');
    const r = analyzeAiFlavor(text, { extraBanned: banned });
    start(
      { task: 'deai', text, issues: issuesForPrompt(r) },
      isSel ? { kind: 'range', start: selection.start, end: selection.end, original: text } : { kind: 'whole', inline: false },
      '去AI味',
    );
  };

  /** 对已生成的结果再做一轮针对性去 AI 味，应用目标不变 */
  const deaiResult = () => {
    const text = task.text;
    const r = analyzeAiFlavor(text, { extraBanned: banned });
    setLabel('再去AI味');
    task.run({ bookId, chapterId: meta.id, task: 'deai', text, issues: issuesForPrompt(r) });
  };

  const genField = (field: 'outline' | 'summary') =>
    start({ task: field === 'outline' ? 'chapter_outline' : 'summary' }, { kind: 'field', field }, field === 'outline' ? '生成本章细纲' : '生成本章摘要', 'plain');

  const brainstorm = (q: string) => {
    setTarget({ kind: 'none' });
    setLabel('灵感');
    setKind('plain');
    task.run({
      bookId,
      chapterId: meta.id,
      task: 'brainstorm',
      instruction: instruction.trim() ? `${q}\n补充：${instruction.trim()}` : q,
      before: content.slice(0, editor.getSelection().end),
    });
  };

  const apply = async (how: 'replace' | 'insert' | 'append' | 'after') => {
    const text = cleanProse(task.text);
    if (!text) return;
    const cur = editor.getText();
    const t = target;
    if (how === 'append') {
      const sep = cur.trim() ? (cur.endsWith('\n') ? '' : '\n') : '';
      editor.replaceRange(cur.length, cur.length, sep + text);
    } else if (t.kind === 'cursor' && how === 'insert') {
      const pos = Math.min(t.pos, cur.length);
      // 光标停在一句话结尾且位于段末时，续写另起一段
      const atParagraphEnd = /[。！？…”」』]$/.test(cur.slice(0, pos)) && (pos === cur.length || cur[pos] === '\n');
      editor.replaceRange(pos, pos, atParagraphEnd && !text.startsWith('\n') ? '\n' + text : text);
    } else if (t.kind === 'range') {
      let s = t.start;
      let e = t.end;
      if (cur.slice(s, e) !== t.original) {
        s = cur.indexOf(t.original);
        e = s + t.original.length;
      }
      if (s < 0) {
        const pos = editor.getSelection().end;
        editor.replaceRange(pos, pos, text);
        toast('原文已经改动，已插入到光标处');
      } else if (how === 'after') {
        editor.replaceRange(e, e, '\n' + text);
      } else {
        editor.replaceRange(s, e, text, true);
      }
    } else if (t.kind === 'whole' && how === 'replace') {
      if (cur.trim()) await api.post(`/chapters/${meta.id}/snapshots`, { note: 'AI 改写前自动保存', content: cur }).catch(toastError);
      editor.replaceRange(0, cur.length, text);
    } else {
      const pos = editor.getSelection().end;
      editor.replaceRange(pos, pos, text);
    }
    task.reset();
    toast('已写入正文，可用 Ctrl+Z 撤销', 'ok');
  };

  const accept = () => {
    if (target.kind === 'cursor') apply('insert');
    else if (target.kind === 'range') apply('replace');
    else if (target.kind === 'whole') apply(target.inline ? 'append' : 'replace');
  };

  const saveField = (field: 'summary' | 'outline', mode: 'replace' | 'append') => {
    const text = task.text.trim();
    const prev = (useBook.getState().tree?.chapters.find((c) => c.id === meta.id)?.[field] ?? '').trim();
    useBook.getState().update('chapters', meta.id, { [field]: mode === 'append' && prev ? `${prev}\n\n${text}` : text }, true);
    task.reset();
    toast(field === 'summary' ? '已保存为本章摘要' : '已保存为本章细纲', 'ok');
  };

  const placement =
    task.status === 'idle'
      ? null
      : target.kind === 'cursor' || target.kind === 'range' || (target.kind === 'whole' && target.inline)
        ? 'inline'
        : 'panel';

  return {
    task,
    target,
    label,
    kind,
    placement,
    instruction,
    setInstruction,
    continueLen,
    setContinueLen,
    draftLen,
    setDraftLen,
    doContinue,
    doDraft,
    doRewrite,
    doDeai,
    deaiResult,
    genField,
    brainstorm,
    apply,
    accept,
    saveField,
    discard: task.reset,
  };
}
