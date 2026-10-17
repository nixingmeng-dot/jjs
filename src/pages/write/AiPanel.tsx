import { ArrowRight, Brain, FileText, Lightbulb, ListTree, MessageSquare, ScanSearch, Send, Sparkles, Trash, WandSparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { analyzeAiFlavor, type FlavorHit, type FlavorReport } from '../../../shared/antiAi';
import type { ChapterMeta, ChatTurn } from '../../../shared/types';
import { AiResultView, ModelPicker, useBannedWords } from '../../components/ai';
import { FlavorReportView } from '../../components/FlavorReport';
import { Button, cx, Empty, IconButton, Kbd, Segmented, Textarea } from '../../components/ui';
import { useAiTask, type AiTaskHandle } from '../../hooks/useAiTask';
import { toast, useBook } from '../../store';
import type { EditorHandle } from './editorParts';
import { IDEAS, REWRITES, type WriteAssist } from './useWriteAssist';
import { memorizeNow, useMemory } from '../../memory';

export interface ChatState {
  task: AiTaskHandle;
  messages: ChatTurn[];
  setMessages: Dispatch<SetStateAction<ChatTurn[]>>;
}

export function LenSelect({ value, onChange, options, className }: { value: number; onChange: (n: number) => void; options: number[]; className?: string }) {
  return (
    <select
      value={value}
      title="大约生成多少字"
      onChange={(e) => onChange(Number(e.target.value))}
      className={cx('h-7 cursor-pointer rounded-md bg-transparent px-1.5 text-xs text-muted outline-none hover:bg-hover hover:text-ink', className)}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          约 {n} 字
        </option>
      ))}
    </select>
  );
}

export function AiPanel({
  meta,
  editor,
  content,
  selection,
  report,
  chat,
  assist,
  highlight,
  setHighlight,
  onClose,
}: {
  meta: ChapterMeta;
  editor: EditorHandle;
  content: string;
  selection: { start: number; end: number };
  report: FlavorReport | null;
  chat: ChatState;
  assist: WriteAssist;
  highlight: boolean;
  setHighlight: (v: boolean) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'write' | 'check' | 'review' | 'chat'>('write');
  const bookId = useBook((s) => s.tree!.book.id);
  const review = useAiTask();
  const { task, target: t } = assist;
  const memorizing = useMemory((s) => s.running?.id === meta.id || s.queue.some((j) => j.id === meta.id));

  const selText = content.slice(selection.start, selection.end);
  const hasSel = selText.trim().length > 0;

  // 从面板发起的动作，结果若在面板里显示，就切回「写作」页签
  const run = (fn: () => void) => {
    fn();
    setTab('write');
  };

  const resultActions = (() => {
    if (t.kind === 'field')
      return (
        <>
          <Button size="sm" variant="primary" onClick={() => assist.saveField(t.field, 'replace')}>
            保存为{t.field === 'summary' ? '本章摘要' : '本章细纲'}
          </Button>
          {t.field === 'outline' && meta.outline && (
            <Button size="sm" onClick={() => assist.saveField('outline', 'append')}>
              追加到细纲
            </Button>
          )}
        </>
      );
    if (t.kind === 'none') return null;
    return (
      <>
        {t.kind === 'whole' && content.trim() && (
          <Button size="sm" variant="primary" onClick={() => assist.apply('replace')} title="替换前会自动保存历史版本">
            替换全文
          </Button>
        )}
        <Button size="sm" variant={t.kind === 'whole' && !content.trim() ? 'primary' : 'secondary'} onClick={() => assist.apply('append')}>
          {t.kind === 'whole' && !content.trim() ? '写入正文' : '追加到末尾'}
        </Button>
        <Button size="sm" icon={<WandSparkles className="size-3.5" />} onClick={assist.deaiResult} title="检测这段结果的 AI 味，并让模型针对性改写">
          再去AI味
        </Button>
      </>
    );
  })();

  return (
    <aside className="flex h-full w-[360px] shrink-0 flex-col border-l border-line bg-side">
      <div className="flex h-11 shrink-0 items-center gap-1.5 pr-2 pl-4">
        <Sparkles className="size-4 shrink-0 text-ai" />
        <span className="text-[13.5px] font-semibold">AI 助手</span>
        <ModelPicker className="ml-auto min-w-0" />
        <IconButton title="收起（Ctrl+J）" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex gap-1 border-b border-line px-3">
        {(
          [
            ['write', '写作'],
            ['check', '去AI味'],
            ['review', '审稿'],
            ['chat', '对话'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx(
              '-mb-px flex items-center gap-1 border-b-2 px-2 py-2 text-[13px] transition',
              tab === k ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {l}
            {k === 'check' && report && report.chars > 30 && (
              <span className={cx('rounded px-1 text-[10.5px] tabular-nums', report.score >= 40 ? 'bg-danger/12 text-danger' : 'bg-hover text-muted')}>{report.score}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'write' && (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-line bg-paper focus-within:ring-2 focus-within:ring-ai/15">
              <Textarea
                value={assist.instruction}
                onChange={(e) => assist.setInstruction(e.target.value)}
                minRows={2}
                placeholder="额外要求（可选）：例如“让林晚先开口，语气冷一点”"
                className="border-0 bg-transparent text-[13px] focus:ring-0"
              />
              <div className="flex items-center gap-1 px-2 pb-2">
                <LenSelect value={assist.continueLen} onChange={assist.setContinueLen} options={[200, 500, 1000, 2000]} />
                <div className="flex-1" />
                <button
                  type="button"
                  disabled={task.running}
                  onClick={() => run(() => assist.doContinue())}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ai px-3 text-[13px] font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" />
                  从光标处续写
                  <span className="text-[11px] opacity-70">Ctrl ↵</span>
                </button>
              </div>
            </div>

            <Group title="本章">
              <ActionRow
                icon={<FileText className="size-4" />}
                label="按细纲写本章"
                hint={meta.outline ? undefined : '建议先写细纲'}
                disabled={task.running}
                onClick={() => run(assist.doDraft)}
                extra={<LenSelect value={assist.draftLen} onChange={assist.setDraftLen} options={[2000, 3000, 4000, 6000]} />}
              />
              <ActionRow icon={<ListTree className="size-4" />} label="生成本章细纲" disabled={task.running} onClick={() => run(() => assist.genField('outline'))} />
              <ActionRow
                icon={<Brain className="size-4" />}
                label={memorizing ? '正在整理本章记忆…' : '更新本章记忆'}
                hint="摘要 + 人物 / 设定变化"
                disabled={memorizing || !content.trim()}
                onClick={() => memorizeNow(meta.bookId, meta.id)}
              />
            </Group>

            <Group title={hasSel ? `改写选中的 ${selText.length} 字` : '改写（先在正文中选中文字）'}>
              <div className="flex flex-wrap gap-1.5">
                {REWRITES.map((r) => (
                  <button
                    key={r.mode}
                    type="button"
                    title={r.title}
                    disabled={!hasSel || task.running}
                    onClick={() => assist.doRewrite(r.mode)}
                    className="rounded-md border border-line bg-paper px-2.5 py-1 text-[12.5px] transition hover:border-ai/40 hover:text-ai disabled:pointer-events-none disabled:opacity-45"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </Group>

            <Group title="灵感">
              <div className="-mx-2">
                {IDEAS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={task.running}
                    onClick={() => run(() => assist.brainstorm(q))}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink/75 hover:bg-hover hover:text-ink disabled:opacity-50"
                  >
                    <Lightbulb className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">{q}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </Group>

            {assist.placement === 'inline' ? (
              <div className="rounded-xl border border-dashed border-ai/40 bg-ai-soft/60 px-3.5 py-3 text-[12.5px] leading-relaxed text-ai">
                {assist.label}的结果显示在正文里。
                <span className="ml-1 text-ink/70">
                  <Kbd>Tab</Kbd> 接受 · <Kbd>Esc</Kbd> {task.running ? '停止' : '放弃'}
                </span>
              </div>
            ) : (
              <AiResultView task={task} actions={resultActions} prose={assist.kind === 'prose'} showFlavor={assist.kind === 'prose'} />
            )}
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
            onDeai={(scope) => run(() => assist.doDeai(scope))}
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

function ActionRow({
  icon,
  label,
  hint,
  extra,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  extra?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="-mx-2 flex items-center rounded-md hover:bg-hover">
      <button type="button" disabled={disabled} onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-[13px] disabled:opacity-45">
        <span className="text-muted">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {hint && <span className="shrink-0 text-[11px] text-muted">{hint}</span>}
      </button>
      {extra}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11.5px] font-medium text-muted">{title}</div>
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
