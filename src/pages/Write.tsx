import { ClipboardList, FileClock, Highlighter, Maximize2, Minimize2, PanelRight, PenLine, Search, TextAlignStart } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { analyzeAiFlavor, type FlavorReport } from '../../shared/antiAi';
import { chapterLabels, countWords, formatWords, tidyParagraphs } from '../../shared/text';
import type { BookStats, Chapter, ChapterMeta, ChapterStatus } from '../../shared/types';
import { api } from '../api';
import { useBannedWords } from '../components/ai';
import { CATEGORY_COLORS } from '../components/FlavorReport';
import { cx, Empty, IconButton, Segmented, Spinner, Textarea } from '../components/ui';
import { useAiTask } from '../hooks/useAiTask';
import { toast, toastError, useApp, useBook, useUi } from '../store';
import { AiPanel, type ChatState } from './write/AiPanel';
import { ChapterTree } from './write/ChapterTree';
import { execReplace, FindBar, scrollToPos, SnapshotsModal, type EditorHandle } from './write/editorParts';

export default function WritePage() {
  const { bookId, chapterId } = useParams();
  const tree = useBook((s) => s.tree)!;
  const focus = useUi((s) => s.focus);
  const navigate = useNavigate();
  const chat = useChatState();

  const ordered = useMemo(() => {
    const out: ChapterMeta[] = [];
    for (const v of tree.volumes) out.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return out;
  }, [tree.volumes, tree.chapters]);
  const labels = useMemo(() => chapterLabels(ordered), [ordered]);
  const chapter = ordered.find((c) => c.id === chapterId);

  useEffect(() => {
    const key = `inkwell.last.${bookId}`;
    if (chapterId && chapter) {
      localStorage.setItem(key, chapterId);
      return;
    }
    const last = localStorage.getItem(key);
    const target = ordered.find((c) => c.id === last) ?? ordered[0];
    if (target && target.id !== chapterId) navigate(`/book/${bookId}/write/${target.id}`, { replace: true });
  }, [bookId, chapterId, chapter, ordered, navigate]);

  return (
    <div className="flex h-full">
      {!focus && <ChapterTree activeId={chapterId} />}
      {chapter ? (
        <ChapterWorkspace key={chapter.id} meta={chapter} label={labels.get(chapter.id) ?? ''} chat={chat} />
      ) : ordered.length === 0 ? (
        <div className="flex-1">
          <Empty icon={<PenLine className="size-8" />} title="还没有章节">
            在左侧新建一个章节开始写作，或先去「大纲」页规划分卷和章节。
          </Empty>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}

function useChatState(): ChatState {
  const task = useAiTask();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  return { task, messages, setMessages };
}

const STATUS_OPTIONS: { value: ChapterStatus; label: string }[] = [
  { value: 'draft', label: '草稿' },
  { value: 'revising', label: '修改中' },
  { value: 'done', label: '完成' },
];

function ChapterWorkspace({ meta, label, chat }: { meta: ChapterMeta; label: string; chat: ChatState }) {
  const settings = useApp((s) => s.settings)!;
  const book = useBook((s) => s.tree!.book);
  const saving = useBook((s) => s.saving);
  const { update, flush } = useBook.getState();
  const { focus, setFocus } = useUi();
  const banned = useBannedWords();

  const [content, setContent] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [showMeta, setShowMeta] = useState(() => localStorage.getItem('inkwell.showMeta') !== '0');
  const [highlight, setHighlight] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showPanel, setShowPanel] = useState(() => localStorage.getItem('inkwell.showPanel') !== '0');
  const [report, setReport] = useState<FlavorReport | null>(null);
  const [stats, setStats] = useState<BookStats | null>(null);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef('');
  contentRef.current = content ?? '';

  // 载入正文
  useEffect(() => {
    let alive = true;
    (async () => {
      await flush();
      try {
        const ch = await api.get<Chapter>(`/chapters/${meta.id}`);
        if (!alive) return;
        setContent(ch.content);
        const jump = useUi.getState().jump;
        if (jump?.chapterId === meta.id) {
          useUi.getState().setJump(null);
          requestAnimationFrame(() => requestAnimationFrame(() => editor.select(jump.start, jump.end)));
        }
      } catch (err) {
        toastError(err);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  // 有新的跳转请求（同一章内搜索）
  const jump = useUi((s) => s.jump);
  useEffect(() => {
    if (jump?.chapterId === meta.id && content !== null) {
      useUi.getState().setJump(null);
      editor.select(jump.start, jump.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  const loadStats = useCallback(() => api.get<BookStats>(`/books/${book.id}/stats`).then(setStats).catch(() => {}), [book.id]);
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  useEffect(() => {
    if (saving !== 0) return;
    const t = setTimeout(loadStats, 1500);
    return () => clearTimeout(t);
  }, [saving, loadStats]);

  const onChange = useCallback(
    (v: string) => {
      setContent(v);
      update('chapters', meta.id, { content: v });
    },
    [meta.id, update],
  );

  // 自动增高，同时保持滚动位置不跳
  useLayoutEffect(() => {
    const ta = taRef.current;
    const sc = scrollRef.current;
    if (!ta || !sc) return;
    const top = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    sc.scrollTop = top;
  }, [content, settings.editorFontSize, settings.editorWidth, focus, showPanel]);

  // AI 味分析（防抖）
  useEffect(() => {
    if (content === null) return;
    const t = setTimeout(() => setReport(analyzeAiFlavor(content, { extraBanned: banned })), 450);
    return () => clearTimeout(t);
  }, [content, banned]);

  const editor = useMemo<EditorHandle>(
    () => ({
      textarea: () => taRef.current,
      getText: () => contentRef.current,
      getSelection: () => {
        const ta = taRef.current;
        if (!ta) return { start: 0, end: 0, text: '' };
        return { start: ta.selectionStart, end: ta.selectionEnd, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
      },
      replaceRange: (start, end, text, select) => {
        const ta = taRef.current;
        if (!ta) return;
        execReplace(ta, start, end, text, onChange);
        if (select) requestAnimationFrame(() => ta.setSelectionRange(start, start + text.length));
        if (scrollRef.current) scrollToPos(ta, scrollRef.current, start);
      },
      select: (start, end) => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(start, end);
        setSelection({ start, end });
        if (scrollRef.current) scrollToPos(ta, scrollRef.current, start);
      },
    }),
    [onChange],
  );

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 's') {
        e.preventDefault();
        flush().then(() => toast('已保存', 'ok'));
      } else if (mod && e.key === 'f') {
        e.preventDefault();
        setShowFind(true);
      } else if (e.key === 'Escape' && useUi.getState().focus) {
        setFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush, setFocus]);

  useEffect(() => () => setFocus(false), [setFocus]);

  const toggle = (key: string, v: boolean, set: (v: boolean) => void) => {
    set(v);
    localStorage.setItem(key, v ? '1' : '0');
  };

  const words = useMemo(() => countWords(content ?? ''), [content]);
  const goal = book.dailyGoal;

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-paper">
        {/* 工具栏 */}
        <div className={cx('flex items-center gap-1 border-b border-line px-3 py-1.5', focus && 'opacity-30 transition-opacity hover:opacity-100')}>
          <span className="shrink-0 font-serif text-sm text-muted">{label.split(' ')[0]}</span>
          <input
            value={meta.title}
            onChange={(e) => update('chapters', meta.id, { title: e.target.value })}
            placeholder="章节标题"
            className="min-w-0 flex-1 bg-transparent px-1.5 py-1 font-serif text-base font-semibold outline-none placeholder:font-normal placeholder:text-muted/60"
          />
          <Segmented value={meta.status} onChange={(status) => update('chapters', meta.id, { status }, true)} options={STATUS_OPTIONS} className="mr-1" />
          <IconButton title="细纲 / 摘要 / 备注" active={showMeta} onClick={() => toggle('inkwell.showMeta', !showMeta, setShowMeta)}>
            <ClipboardList className="size-4" />
          </IconButton>
          <IconButton title="在正文中标注 AI 味" active={highlight} onClick={() => setHighlight(!highlight)}>
            <Highlighter className="size-4" />
          </IconButton>
          <IconButton
            title="一键排版：去除多余空行与空格，段首缩进两格"
            onClick={() => {
              const tidy = tidyParagraphs(contentRef.current, { indent: true });
              if (tidy !== contentRef.current) editor.replaceRange(0, contentRef.current.length, tidy);
            }}
          >
            <TextAlignStart className="size-4" />
          </IconButton>
          <IconButton title="查找替换（Ctrl+F）" active={showFind} onClick={() => setShowFind(!showFind)}>
            <Search className="size-4" />
          </IconButton>
          <IconButton title="历史版本" onClick={() => setShowSnapshots(true)}>
            <FileClock className="size-4" />
          </IconButton>
          <IconButton title={focus ? '退出专注（Esc）' : '专注模式'} active={focus} onClick={() => setFocus(!focus)}>
            {focus ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </IconButton>
          <IconButton title="AI 助手面板" active={showPanel && !focus} onClick={() => toggle('inkwell.showPanel', !showPanel, setShowPanel)}>
            <PanelRight className="size-4" />
          </IconButton>
        </div>
        {showFind && content !== null && <FindBar editor={editor} content={content} onClose={() => setShowFind(false)} />}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto px-8 pt-8 pb-[40vh]" style={{ maxWidth: settings.editorWidth + 64 }}>
            {showMeta && !focus && <ChapterMetaCard meta={meta} />}
            {content === null ? (
              <div className="flex justify-center py-20">
                <Spinner />
              </div>
            ) : (
              <div className="relative" style={{ fontSize: settings.editorFontSize }}>
                {highlight && report && <HighlightLayer text={content} report={report} />}
                <textarea
                  ref={taRef}
                  value={content}
                  onChange={(e) => onChange(e.target.value)}
                  onSelect={(e) => setSelection({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const { start, end } = editor.getSelection();
                      editor.replaceRange(start, end, '\u3000\u3000');
                    }
                  }}
                  placeholder={meta.outline ? '开始写作…（右侧「按细纲写本章」可以让 AI 先起草）' : '开始写作…'}
                  spellCheck={false}
                  className="prose-editor relative block min-h-[60vh] w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted/50"
                />
              </div>
            )}
          </div>
        </div>

        {/* 状态栏 */}
        <div className={cx('flex items-center gap-4 border-t border-line px-4 py-1 text-[11px] text-muted', focus && 'opacity-30 hover:opacity-100')}>
          <span>本章 {words.toLocaleString()} 字</span>
          {selection.end > selection.start && <span>已选 {countWords((content ?? '').slice(selection.start, selection.end))} 字</span>}
          {stats && (
            <span className="flex items-center gap-1.5">
              今日 +{stats.today.toLocaleString()}
              {goal > 0 && (
                <>
                  <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-line">
                    <span className="block h-full bg-accent" style={{ width: `${Math.min(100, (stats.today / goal) * 100)}%` }} />
                  </span>
                  {goal.toLocaleString()}
                </>
              )}
            </span>
          )}
          {stats && <span>全书 {formatWords(stats.totalWords)}</span>}
          {report && report.chars > 30 && (
            <button type="button" className="hover:text-ink" onClick={() => setHighlight(!highlight)} title="点击切换正文标注">
              AI 味 {report.score}（{report.levelLabel}）
            </button>
          )}
          <div className="flex-1" />
          <span>{saving ? '保存中…' : '已保存'}</span>
        </div>
      </div>

      {showPanel && !focus && content !== null && (
        <AiPanel
          meta={meta}
          editor={editor}
          content={content}
          selection={selection}
          report={report}
          chat={chat}
          highlight={highlight}
          setHighlight={setHighlight}
        />
      )}
      {showSnapshots && (
        <SnapshotsModal
          chapterId={meta.id}
          content={content ?? ''}
          onClose={() => setShowSnapshots(false)}
          onRestore={(text) => editor.replaceRange(0, contentRef.current.length, text)}
        />
      )}
    </div>
  );
}

function HighlightLayer({ text, report }: { text: string; report: FlavorReport }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  report.hits.forEach((h, i) => {
    if (h.end > text.length) return;
    if (h.start > pos) parts.push(text.slice(pos, h.start));
    parts.push(
      <mark key={i} className={cx('flavor-mark text-transparent', CATEGORY_COLORS[h.cat])}>
        {text.slice(h.start, h.end)}
      </mark>,
    );
    pos = h.end;
  });
  parts.push(text.slice(pos) + '\u200b');
  return (
    <div aria-hidden className="prose-editor pointer-events-none absolute inset-0 text-transparent select-none">
      {parts}
    </div>
  );
}

function ChapterMetaCard({ meta }: { meta: ChapterMeta }) {
  const { update } = useBook.getState();
  const [tab, setTab] = useState<'outline' | 'summary' | 'notes'>('outline');
  const field = tab;
  const placeholders = {
    outline: '本章细纲：场景、出场人物、事件推进、结尾钩子。AI 写作时会严格参考这里。',
    summary: '本章剧情摘要。写完后可在右侧 AI 面板一键生成——AI 续写后续章节时会把它作为「前情提要」。',
    notes: '只给自己看的备注，不会发送给 AI。',
  };
  return (
    <div className="mb-8 rounded-lg border border-line bg-bg/60 font-sans">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        {(
          [
            ['outline', '细纲'],
            ['summary', '摘要'],
            ['notes', '备注'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cx('rounded px-2 py-0.5 text-xs', tab === k ? 'bg-panel font-medium shadow-sm' : 'text-muted hover:text-ink')}
          >
            {l}
            {meta[k] && <span className="ml-1 inline-block size-1 rounded-full bg-accent align-middle" />}
          </button>
        ))}
      </div>
      <Textarea
        key={field}
        value={meta[field]}
        onChange={(e) => update('chapters', meta.id, { [field]: e.target.value })}
        placeholder={placeholders[field]}
        minRows={2}
        className="border-0 bg-transparent text-[13px] focus:ring-0"
      />
    </div>
  );
}

