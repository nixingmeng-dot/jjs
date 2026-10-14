import { Bot, Lightbulb, MessageSquare, ScanSearch, Send, Sparkles, Trash, WandSparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { analyzeAiFlavor, issuesForPrompt, type FlavorHit, type FlavorReport } from '../../../shared/antiAi';
import type { AiRequest, ChapterMeta, ChatTurn, RewriteMode } from '../../../shared/types';
import { api } from '../../api';
import { AiResultView, ModelPicker, useBannedWords } from '../../components/ai';
import { FlavorReportView } from '../../components/FlavorReport';
import { Button, cx, Empty, IconButton, Segmented, Select, Textarea } from '../../components/ui';
import { useAiTask, type AiTaskHandle } from '../../hooks/useAiTask';
import { toast, toastError, useBook } from '../../store';
import type { EditorHandle } from './editorParts';

export interface ChatState {
  task: AiTaskHandle;
  messages: ChatTurn[];
  setMessages: Dispatch<SetStateAction<ChatTurn[]>>;
}

type Target =
  | { kind: 'cursor'; pos: number }
  | { kind: 'range'; start: number; end: number; original: string }
  | { kind: 'whole' }
  | { kind: 'field'; field: 'summary' | 'outline' }
  | { kind: 'none' };

const REWRITES: { mode: RewriteMode; label: string; title: string }[] = [
  { mode: 'polish', label: '润色', title: '修病句、换准词，不加戏' },
  { mode: 'expand', label: '扩写', title: '补充动作、细节和潜台词' },
  { mode: 'condense', label: '精简', title: '删掉重复和解释' },
  { mode: 'deai', label: '去AI味', title: '去套话、打散句式、删升华' },
  { mode: 'vivid', label: '画面感', title: '把“告知”改成“展示”' },
  { mode: 'dialogue', label: '对白', title: '让台词像真人说话，有潜台词' },
  { mode: 'sensory', label: '感官', title: '加入声音、气味、触感' },
  { mode: 'tension', label: '张力', title: '加快节奏、制造悬念' },
  { mode: 'custom', label: '按要求改', title: '按上方「额外要求」修改' },
];

const IDEAS = [
  '接下来剧情可以怎么发展？给我几个方向',
  '这里加一个什么冲突或意外更好看？',
  '给当前场景想几个具体、独特的细节',
  '主角此刻可以做一个什么出人意料的选择？',
  '帮我给新出场的配角起几个名字和一句话人设',
  '这一章的结尾钩子可以怎么设计？',
];

/** 去掉模型偶尔带上的标记 */
function cleanProse(text: string) {
  return text
    .replace(/^\s*```[a-z]*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^\s*<<<\s*\n?/, '')
    .replace(/\n?\s*>>>\s*$/, '')
    .replace(/\s+$/, '');
}

export function AiPanel({
  meta,
  editor,
  content,
  selection,
  report,
  chat,
  highlight,
  setHighlight,
}: {
  meta: ChapterMeta;
  editor: EditorHandle;
  content: string;
  selection: { start: number; end: number };
  report: FlavorReport | null;
  chat: ChatState;
  highlight: boolean;
  setHighlight: (v: boolean) => void;
}) {
  const [tab, setTab] = useState<'write' | 'check' | 'review' | 'chat'>('write');
  const bookId = useBook((s) => s.tree!.book.id);
  const task = useAiTask();
  const review = useAiTask();
  const target = useRef<Target>({ kind: 'none' });
  const [instruction, setInstruction] = useState('');
  const [continueLen, setContinueLen] = useState(() => Number(localStorage.getItem('inkwell.continueLen')) || 500);
  const [draftLen, setDraftLen] = useState(() => Number(localStorage.getItem('inkwell.draftLen')) || 3000);
  const [kind, setKind] = useState<'prose' | 'plain'>('prose');
  const banned = useBannedWords();

  const selText = content.slice(selection.start, selection.end);
  const hasSel = selText.trim().length > 0;

  const start = (req: Omit<AiRequest, 'bookId' | 'chapterId'>, t: Target, k: 'prose' | 'plain' = 'prose') => {
    target.current = t;
    setKind(k);
    setTab('write');
    task.run({ bookId, chapterId: meta.id, instruction: instruction.trim() || undefined, ...req });
  };

  const doContinue = () => {
    const pos = editor.getSelection().end;
    start(
      { task: 'continue', before: content.slice(0, pos), after: content.slice(pos), length: continueLen },
      { kind: 'cursor', pos },
    );
  };

  const doRewrite = (mode: RewriteMode) => {
    const sel = editor.getSelection();
    const text = sel.text.trim() ? sel.text : selText;
    const s = sel.text.trim() ? sel.start : selection.start;
    const e = sel.text.trim() ? sel.end : selection.end;
    if (!text.trim()) return toast('请先在正文中选中要改写的文字', 'error');
    if (mode === 'custom' && !instruction.trim()) return toast('请先在「额外要求」里写下修改要求', 'error');
    start(
      { task: 'rewrite', mode, text, before: content.slice(Math.max(0, s - 800), s), after: content.slice(e, e + 300) },
      { kind: 'range', start: s, end: e, original: text },
    );
  };

  const doDeai = (scope: 'selection' | 'whole') => {
    const isSel = scope === 'selection' && hasSel;
    const text = isSel ? selText : content;
    if (!text.trim()) return toast('没有可处理的文字', 'error');
    const r = analyzeAiFlavor(text, { extraBanned: banned });
    start(
      { task: 'deai', text, issues: issuesForPrompt(r) },
      isSel ? { kind: 'range', start: selection.start, end: selection.end, original: text } : { kind: 'whole' },
    );
  };

  /** 对已生成的结果再做一轮针对性去 AI 味，应用目标不变 */
  const deaiResult = () => {
    const text = task.text;
    const r = analyzeAiFlavor(text, { extraBanned: banned });
    task.run({ bookId, chapterId: meta.id, task: 'deai', text, issues: issuesForPrompt(r) });
  };

  // ---------- 应用结果 ----------
  const apply = async (how: 'replace' | 'insert' | 'append' | 'after') => {
    const text = cleanProse(task.text);
    if (!text) return;
    const cur = editor.getText();
    const t = target.current;
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

  const saveField = (field: 'summary' | 'outline', mode: 'replace' | 'append') => {
    const text = task.text.trim();
    const prev = (useBook.getState().tree?.chapters.find((c) => c.id === meta.id)?.[field] ?? '').trim();
    useBook.getState().update('chapters', meta.id, { [field]: mode === 'append' && prev ? `${prev}\n\n${text}` : text }, true);
    task.reset();
    toast(field === 'summary' ? '已保存为本章摘要' : '已保存为本章细纲', 'ok');
  };

  const t = target.current;
  const resultActions = (() => {
    if (t.kind === 'field')
      return (
        <>
          <Button size="sm" variant="primary" onClick={() => saveField(t.field, 'replace')}>
            保存为{t.field === 'summary' ? '本章摘要' : '本章细纲'}
          </Button>
          {t.field === 'outline' && meta.outline && (
            <Button size="sm" onClick={() => saveField('outline', 'append')}>
              追加到细纲
            </Button>
          )}
        </>
      );
    if (t.kind === 'none') return null;
    return (
      <>
        {t.kind === 'cursor' && (
          <Button size="sm" variant="primary" onClick={() => apply('insert')}>
            插入到光标处
          </Button>
        )}
        {t.kind === 'range' && (
          <>
            <Button size="sm" variant="primary" onClick={() => apply('replace')}>
              替换原文
            </Button>
            <Button size="sm" onClick={() => apply('after')}>
              插到原文后
            </Button>
          </>
        )}
        {t.kind === 'whole' && content.trim() && (
          <Button size="sm" variant="primary" onClick={() => apply('replace')} title="替换前会自动保存历史版本">
            替换全文
          </Button>
        )}
        <Button size="sm" variant={t.kind === 'whole' && !content.trim() ? 'primary' : 'secondary'} onClick={() => apply('append')}>
          {t.kind === 'whole' && !content.trim() ? '写入正文' : '追加到末尾'}
        </Button>
        <Button size="sm" icon={<WandSparkles className="size-3.5" />} onClick={deaiResult} title="检测这段结果的 AI 味，并让模型针对性改写">
          再去AI味
        </Button>
      </>
    );
  })();

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Bot className="size-4 shrink-0 text-accent" />
        <ModelPicker className="min-w-0 flex-1" />
      </div>
      <div className="flex border-b border-line px-2">
        {(
          [
            ['write', '写作', Sparkles],
            ['check', '去AI味', ScanSearch],
            ['review', '审稿', Lightbulb],
            ['chat', '对话', MessageSquare],
          ] as const
        ).map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx(
              'flex flex-1 items-center justify-center gap-1 border-b-2 py-2 text-xs transition',
              tab === k ? 'border-accent font-medium text-accent' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            <Icon className="size-3.5" />
            {l}
            {k === 'check' && report && report.chars > 30 && (
              <span className={cx('rounded px-1 text-[10px]', report.score >= 40 ? 'bg-danger/12 text-danger' : 'bg-hover')}>{report.score}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'write' && (
          <div className="space-y-4">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              minRows={2}
              placeholder="额外要求（可选）：例如“让林晚先开口，语气冷一点”“这段节奏要快”"
              className="text-xs"
            />

            <Group title="生成">
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" className="flex-1" onClick={doContinue} loading={task.running && task.request?.task === 'continue'} disabled={task.running}>
                  从光标处续写
                </Button>
                <Select
                  value={continueLen}
                  onChange={(e) => {
                    setContinueLen(Number(e.target.value));
                    localStorage.setItem('inkwell.continueLen', e.target.value);
                  }}
                  className="h-7 w-28 text-xs"
                >
                  {[200, 500, 1000, 2000].map((n) => (
                    <option key={n} value={n}>
                      约 {n} 字
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={task.running}
                  title={meta.outline ? '根据本章细纲、前情和人物设定起草整章' : '建议先写好本章细纲'}
                  onClick={() => start({ task: 'draft', length: draftLen }, { kind: 'whole' })}
                >
                  按细纲写本章
                </Button>
                <Select
                  value={draftLen}
                  onChange={(e) => {
                    setDraftLen(Number(e.target.value));
                    localStorage.setItem('inkwell.draftLen', e.target.value);
                  }}
                  className="h-7 w-28 text-xs"
                >
                  {[2000, 3000, 4000, 6000].map((n) => (
                    <option key={n} value={n}>
                      约 {n} 字
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" disabled={task.running} onClick={() => start({ task: 'chapter_outline' }, { kind: 'field', field: 'outline' }, 'plain')}>
                  生成本章细纲
                </Button>
                <Button
                  size="sm"
                  disabled={task.running || !content.trim()}
                  title="写完后生成摘要，AI 写后续章节时会作为前情提要"
                  onClick={() => start({ task: 'summary' }, { kind: 'field', field: 'summary' }, 'plain')}
                >
                  生成本章摘要
                </Button>
              </div>
            </Group>

            <Group title={hasSel ? `改写选中的 ${selText.length} 字` : '改写（先在正文中选中文字）'}>
              <div className="grid grid-cols-3 gap-1.5">
                {REWRITES.map((r) => (
                  <Button key={r.mode} size="sm" title={r.title} disabled={!hasSel || task.running} onClick={() => doRewrite(r.mode)}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </Group>

            <Group title="灵感">
              <div className="flex flex-wrap gap-1">
                {IDEAS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={task.running}
                    onClick={() => {
                      target.current = { kind: 'none' };
                      setKind('plain');
                      task.run({ bookId, chapterId: meta.id, task: 'brainstorm', instruction: instruction.trim() ? `${q}\n补充：${instruction.trim()}` : q, before: content.slice(0, editor.getSelection().end) });
                    }}
                    className="rounded-full border border-line px-2 py-0.5 text-left text-[11px] text-muted hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </Group>

            <AiResultView task={task} actions={resultActions} prose={kind === 'prose'} showFlavor={kind === 'prose'} />
          </div>
        )}

        {tab === 'check' && (
          <CheckTab
            content={content}
            selection={selection}
            selText={selText}
            report={report}
            highlight={highlight}
            setHighlight={setHighlight}
            onLocate={(h, offset) => editor.select(h.start + offset, h.end + offset)}
            onDeai={doDeai}
            running={task.running}
          />
        )}

        {tab === 'review' && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted">让 AI 以编辑的视角审读本章：AI 味、节奏、人物、对白、与前文和设定的一致性，并给出具体改法。</p>
            <Button
              variant="primary"
              className="w-full"
              loading={review.running}
              disabled={!content.trim()}
              onClick={() => review.run({ bookId, chapterId: meta.id, task: 'review', text: hasSel ? selText : undefined })}
            >
              {hasSel ? `审读选中的 ${selText.length} 字` : '审读本章'}
            </Button>
            <AiResultView task={review} prose={false} showFlavor={false} />
          </div>
        )}

        {tab === 'chat' && <ChatTab chat={chat} bookId={bookId} chapterId={meta.id} editor={editor} />}
      </div>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function CheckTab({
  content,
  selection,
  selText,
  report,
  highlight,
  setHighlight,
  onLocate,
  onDeai,
  running,
}: {
  content: string;
  selection: { start: number; end: number };
  selText: string;
  report: FlavorReport | null;
  highlight: boolean;
  setHighlight: (v: boolean) => void;
  onLocate: (h: FlavorHit, offset: number) => void;
  onDeai: (scope: 'selection' | 'whole') => void;
  running: boolean;
}) {
  const hasSel = selText.trim().length > 30;
  const [scope, setScope] = useState<'whole' | 'selection'>('whole');
  const banned = useBannedWords();
  const effective = scope === 'selection' && hasSel ? 'selection' : 'whole';
  const selReport = useMemo(() => (effective === 'selection' ? analyzeAiFlavor(selText, { extraBanned: banned }) : null), [effective, selText, banned]);
  const shown = effective === 'selection' ? selReport : report;
  const offset = effective === 'selection' ? selection.start : 0;

  if (!content.trim()) return <Empty icon={<ScanSearch className="size-7" />} title="正文为空" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Segmented
          value={effective}
          onChange={setScope}
          options={[
            { value: 'whole', label: '全章' },
            { value: 'selection', label: hasSel ? `选中 ${selText.length} 字` : '选中文字' },
          ]}
        />
        <label className="ml-auto flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          在正文中标注
        </label>
      </div>
      {shown ? <FlavorReportView report={shown} onLocate={(h) => onLocate(h, offset)} /> : null}
      <Button
        variant="primary"
        className="w-full"
        icon={<WandSparkles className="size-4" />}
        disabled={running}
        onClick={() => onDeai(effective)}
        title="把检测到的问题交给模型逐条修改，结果会显示在「写作」页，确认后再替换"
      >
        AI 针对性去 AI 味（{effective === 'selection' ? '选中部分' : '全章'}）
      </Button>
      <p className="text-[11px] leading-relaxed text-muted">
        检测完全在本地进行，不消耗 token。分数只是参考：少量命中很正常，关键是避免同一类套话扎堆，以及句式过于整齐。
      </p>
    </div>
  );
}

function ChatTab({ chat, bookId, chapterId, editor }: { chat: ChatState; bookId: string; chapterId: string; editor: EditorHandle }) {
  const { task, messages, setMessages } = chat;
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, task.text]);

  const send = async () => {
    const text = input.trim();
    if (!text || task.running) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    const reply = await task.run({ bookId, chapterId, task: 'chat', messages: next });
    if (reply) {
      setMessages([...next, { role: 'assistant', content: reply }]);
      task.reset();
    }
  };

  const insert = (text: string) => {
    const pos = editor.getSelection().end;
    editor.replaceRange(pos, pos, text);
    toast('已插入到光标处', 'ok');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3">
        {messages.length === 0 && !task.running && (
          <Empty icon={<MessageSquare className="size-7" />} title="和熟悉全书的搭档聊聊">
            它能看到作品简介、大纲、相关人物和设定、前情提要以及当前章节，可以问情节走向、人物动机、设定漏洞，或者让它帮你想名字。
          </Empty>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cx('group text-sm leading-relaxed', m.role === 'user' ? 'ml-8' : 'mr-2')}>
            <div className={cx('rounded-lg px-3 py-2 whitespace-pre-wrap', m.role === 'user' ? 'bg-accent-soft' : 'border border-line bg-paper')}>{m.content}</div>
            {m.role === 'assistant' && (
              <div className="mt-1 hidden gap-2 text-[11px] text-muted group-hover:flex">
                <button type="button" className="hover:text-ink" onClick={() => navigator.clipboard.writeText(m.content).then(() => toast('已复制', 'ok'))}>
                  复制
                </button>
                <button type="button" className="hover:text-ink" onClick={() => insert(m.content)}>
                  插入到正文
                </button>
              </div>
            )}
          </div>
        ))}
        {(task.running || task.status === 'error') && (
          <div className="mr-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {task.status === 'error' ? <span className="text-danger">{task.error}</span> : <span className="stream-caret">{task.text}</span>}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="sticky bottom-0 mt-3 bg-panel pt-1">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            minRows={2}
            placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
            className="pr-9 text-xs"
          />
          <IconButton title="发送" className="absolute right-1.5 bottom-1.5" onClick={send} disabled={task.running || !input.trim()}>
            <Send className="size-3.5" />
          </IconButton>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-[11px] text-muted hover:text-danger"
            onClick={() => {
              task.reset();
              setMessages([]);
            }}
          >
            <Trash className="size-3" /> 清空对话
          </button>
        )}
      </div>
    </div>
  );
}
