import {
  ArrowUp,
  BookOpen,
  ChevronRight,
  CircleDot,
  CircleStop,
  Ellipsis,
  FileClock,
  Highlighter,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  PanelRight,
  PenLine,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  Sparkles,
  StickyNote,
  TextAlignStart,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { analyzeAiFlavor, FLAVOR_CATEGORIES, type FlavorHit, type FlavorReport } from '../../shared/antiAi';
import { chapterLabels, countWords, tidyParagraphs } from '../../shared/text';
import type { AppSettings, BookStats, Chapter, ChapterMeta, ChapterStatus, RewriteMode } from '../../shared/types';
import { api } from '../api';
import { scoreTone, useBannedWords } from '../components/ai';
import { CATEGORY_COLORS } from '../components/FlavorReport';
import { cx, Empty, IconButton, Kbd, Menu, MenuDivider, MenuItem, MenuLabel, Spinner, Textarea } from '../components/ui';
import { useAiTask } from '../hooks/useAiTask';
import { toast, toastError, useApp, useBook, useUi } from '../store';
import { AiPanel, LenSelect, type ChatState } from './write/AiPanel';
import { caretCoords, execReplace, FindBar, scrollToPos, SnapshotsModal, type EditorHandle } from './write/editorParts';
import { REWRITES, useWriteAssist, type WriteAssist } from './write/useWriteAssist';
import { summaryState } from '../../shared/memory';
import { memorizeNow, memoryOnLeaveChapter, setActiveChapter, useMemory } from '../memory';

export default function WritePage() {
  const { bookId, chapterId } = useParams();
  const tree = useBook((s) => s.tree)!;
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
      {chapter ? (
        <ChapterWorkspace
          key={chapter.id}
          meta={chapter}
          label={labels.get(chapter.id) ?? ''}
          volumeTitle={tree.volumes.find((v) => v.id === chapter.volumeId)?.title ?? ''}
          chat={chat}
        />
      ) : ordered.length === 0 ? (
        <div className="flex-1">
          <Empty icon={<PenLine className="size-8" />} title="还没有章节">
            在左侧目录里新建一个章节开始写作，或先去「大纲」页规划分卷和章节。
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

const STATUS: Record<ChapterStatus, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-hover text-ink/70' },
  revising: { label: '修改中', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  done: { label: '完成', cls: 'bg-ok/15 text-ok' },
};

const isTypingTarget = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function ChapterWorkspace({ meta, label, volumeTitle, chat }: { meta: ChapterMeta; label: string; volumeTitle: string; chat: ChatState }) {
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
  const [showPanel, setShowPanel] = useState(() => localStorage.getItem('inkwell.showPanel') === '1');
  const [report, setReport] = useState<FlavorReport | null>(null);
  const [stats, setStats] = useState<BookStats | null>(null);
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null);
  const [fontTick, setFontTick] = useState(0);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef('');
  contentRef.current = content ?? '';

  const fontSize = focus ? settings.editorFontSize + 3 : settings.editorFontSize;
  const width = focus ? Math.min(settings.editorWidth, 700) : settings.editorWidth;

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

  // 内置字体按需分片加载，加载完字形宽度会变，需要重新量高度和坐标
  useEffect(() => {
    const onLoaded = () => setFontTick((n) => n + 1);
    document.fonts.addEventListener('loadingdone', onLoaded);
    return () => document.fonts.removeEventListener('loadingdone', onLoaded);
  }, []);

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
  }, [content, fontSize, width, settings.editorFont, focus, showPanel, fontTick]);

  // 专注模式：打字机式滚动，让光标所在行始终停在视线高度
  const centerCaret = useCallback(() => {
    const ta = taRef.current;
    const sc = scrollRef.current;
    if (!ta || !sc) return;
    const offset = ta.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = offset + caretCoords(ta, ta.selectionEnd).top - sc.clientHeight * 0.42;
  }, []);
  useLayoutEffect(() => {
    if (focus && document.activeElement === taRef.current) centerCaret();
  }, [content, focus, centerCaret]);
  useLayoutEffect(() => {
    if (!focus) return;
    taRef.current?.focus({ preventScroll: true });
    centerCaret();
  }, [focus, centerCaret]);

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

  const assist = useWriteAssist({ meta, editor, content: content ?? '', selection });
  const assistRef = useRef(assist);
  assistRef.current = assist;
  const inlineReady = assist.placement === 'inline' && assist.task.status === 'done' && !!assist.task.text;

  const togglePanel = useCallback((v?: boolean) => {
    setShowPanel((cur) => {
      const next = v ?? !cur;
      localStorage.setItem('inkwell.showPanel', next ? '1' : '0');
      return next;
    });
  }, []);

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const a = assistRef.current;
      if (mod && e.key === 's') {
        e.preventDefault();
        flush().then(() => toast('已保存', 'ok'));
      } else if (mod && e.key === 'f') {
        e.preventDefault();
        setShowFind(true);
      } else if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (!useUi.getState().focus) togglePanel();
      } else if (e.key === 'Escape') {
        if (a.placement === 'inline') {
          if (a.task.running) a.task.stop();
          else a.discard();
        } else if (useUi.getState().focus) setFocus(false);
      } else if (e.key === 'Tab' && !isTypingTarget(e.target) && a.placement === 'inline' && a.task.status === 'done' && a.task.text) {
        e.preventDefault();
        a.accept();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush, setFocus, togglePanel]);

  useEffect(() => () => setFocus(false), [setFocus]);

  // 自动记忆：正在写的这一章先不整理，离开后再整理
  useEffect(() => {
    setActiveChapter(meta.id);
    return () => {
      setActiveChapter(undefined);
      memoryOnLeaveChapter(meta.bookId);
    };
  }, [meta.id, meta.bookId]);

  const toggleMeta = () => {
    setShowMeta(!showMeta);
    localStorage.setItem('inkwell.showMeta', showMeta ? '0' : '1');
  };

  const updateToolbar = () => {
    const ta = taRef.current;
    if (!ta || focus || document.activeElement !== ta) return setToolbar(null);
    const { selectionStart: s, selectionEnd: e } = ta;
    if (e <= s || !ta.value.slice(s, e).trim()) return setToolbar(null);
    const c = caretCoords(ta, s);
    setToolbar({ top: c.top, left: c.left });
  };

  // 正文内预览的位置：章末续写像幽灵文字一样接在后面，文中改写则以浮层卡片显示在选区下方
  const inline = (() => {
    const ta = taRef.current;
    if (assist.placement !== 'inline' || content === null || !ta) return null;
    const t = assist.target;
    const trimmed = content.replace(/\s+$/, '').length;
    let pos = content.length;
    let variant: 'ghost' | 'card' = 'ghost';
    if (t.kind === 'cursor') {
      pos = Math.min(t.pos, content.length);
      if (pos < trimmed) variant = 'card';
    } else if (t.kind === 'range') {
      const at = content.slice(t.start, t.end) === t.original ? t.start : content.indexOf(t.original);
      pos = at < 0 ? t.end : at + t.original.length;
      variant = 'card';
    }
    if (variant === 'ghost') {
      if (!trimmed) return { top: 0, variant };
      const c = caretCoords(ta, trimmed, content);
      return { top: c.top + c.lineHeight, variant };
    }
    const c = caretCoords(ta, pos, content);
    return { top: c.top + c.lineHeight + 6, variant };
  })();

  // 生成过程中让预览保持在视野里
  useEffect(() => {
    const el = inlineRef.current;
    const sc = scrollRef.current;
    if (!el || !sc || !assist.task.running) return;
    const r = el.getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    const overflow = r.bottom - (box.bottom - 96);
    if (overflow > 0) sc.scrollTop += Math.min(overflow, Math.max(0, r.top - box.top - 80));
  }, [assist.task.text, assist.task.running, inline?.top]);

  // 专注模式的页边批注：当前段落里第一处 AI 腔
  const note = useMemo(() => {
    if (!focus || !report || content === null) return null;
    const s = content.lastIndexOf('\n', selection.start - 1) + 1;
    const e = content.indexOf('\n', selection.start);
    const end = e === -1 ? content.length : e;
    return report.hits.find((h) => h.start >= s && h.end <= end && h.end <= content.length) ?? null;
  }, [focus, report, content, selection.start]);
  const noteTop = note && taRef.current && content !== null ? caretCoords(taRef.current, note.start, content).top : 0;

  const words = useMemo(() => countWords(content ?? ''), [content]);
  const selWords = selection.end > selection.start ? countWords((content ?? '').slice(selection.start, selection.end)) : 0;
  const goal = book.dailyGoal;
  const num = meta.title.trim() && label.endsWith(meta.title.trim()) ? label.slice(0, label.length - meta.title.trim().length).trim() : label;
  const tidy = () => {
    const next = tidyParagraphs(contentRef.current, { indent: true });
    if (next !== contentRef.current) editor.replaceRange(0, contentRef.current.length, next);
  };

  return (
    <div className="flex min-w-0 flex-1 bg-bg" data-focus={focus ? '' : undefined}>
      <div className="relative flex min-w-0 flex-1 flex-col">
        {focus ? (
          <FocusChrome
            bookTitle={book.title}
            label={label}
            words={words}
            today={stats?.today}
            goal={goal}
            saving={saving > 0}
            onExit={() => setFocus(false)}
          />
        ) : (
          <div className="flex h-11 shrink-0 items-center gap-1 pr-2 pl-4 text-[13px]">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-muted">
              <BookOpen className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate">{book.title}</span>
              {volumeTitle && (
                <>
                  <ChevronRight className="size-3 shrink-0 text-muted/60" />
                  <span className="max-w-40 truncate">{volumeTitle}</span>
                </>
              )}
              <ChevronRight className="size-3 shrink-0 text-muted/60" />
              <span className="truncate text-ink">{label}</span>
            </div>
            <span className="hidden px-1.5 text-muted lg:inline">{saving ? '保存中…' : '已保存'}</span>
            <span className="px-1.5 text-muted tabular-nums" title={stats ? `今日新增 ${stats.today.toLocaleString()} 字${goal ? ` / 目标 ${goal.toLocaleString()}` : ''}` : undefined}>
              {selWords > 0 && `已选 ${selWords.toLocaleString()} / `}
              {words.toLocaleString()} 字
            </span>
            {report && report.chars > 30 && (
              <button
                type="button"
                onClick={() => setHighlight(!highlight)}
                title={`${report.levelLabel}（越低越好）。点击${highlight ? '取消' : ''}在正文中标注`}
                className={cx('mx-1 rounded px-1.5 py-0.5 text-[12px] font-medium tabular-nums', scoreTone(report.score), highlight && 'ring-1 ring-current')}
              >
                AI 味 {report.score}
              </button>
            )}
            <IconButton title="专注模式" onClick={() => setFocus(true)}>
              <Maximize2 className="size-4" />
            </IconButton>
            <button
              type="button"
              onClick={() => togglePanel()}
              title="AI 助手（Ctrl+J）"
              className={cx(
                'mx-1 inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 font-medium text-ai transition',
                showPanel ? 'bg-ai text-white' : 'bg-ai-soft hover:brightness-95',
              )}
            >
              <Sparkles className="size-3.5" />问 AI
            </button>
            <MoreMenu
              settings={settings}
              showMeta={showMeta}
              highlight={highlight}
              onToggleMeta={toggleMeta}
              onToggleHighlight={() => setHighlight(!highlight)}
              onFind={() => setShowFind(true)}
              onTidy={tidy}
              onSnapshots={() => setShowSnapshots(true)}
              onFocus={() => setFocus(true)}
            />
          </div>
        )}
        {showFind && content !== null && <FindBar editor={editor} content={content} onClose={() => setShowFind(false)} />}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cx('mx-auto px-12', focus ? 'pt-[38vh] pb-[58vh]' : 'pt-10 pb-[45vh]')} style={{ maxWidth: width + 96 }}>
            {!focus && (
              <div className="mb-6">
                {num && <div className="mb-1 text-[13px] text-muted">{num}</div>}
                <input
                  value={meta.title}
                  onChange={(e) => update('chapters', meta.id, { title: e.target.value })}
                  placeholder="无标题"
                  className="w-full bg-transparent text-[34px] leading-tight font-bold tracking-tight outline-none placeholder:text-muted/35"
                />
                {showMeta && <ChapterProps meta={meta} />}
                <div className="mt-5 h-px bg-line" />
              </div>
            )}
            {content === null ? (
              <div className="flex justify-center py-20">
                <Spinner />
              </div>
            ) : (
              <div className="relative" style={{ fontSize }}>
                {focus ? <FocusMirror text={content} caret={selection.start} report={report} /> : highlight && report && <HighlightLayer text={content} report={report} />}
                <textarea
                  ref={taRef}
                  value={content}
                  onChange={(e) => {
                    onChange(e.target.value);
                    setToolbar(null);
                  }}
                  onSelect={(e) => {
                    const { selectionStart: s, selectionEnd: en } = e.currentTarget;
                    setSelection({ start: s, end: en });
                    if (s === en) setToolbar(null);
                  }}
                  onMouseUp={() => setTimeout(updateToolbar)}
                  onKeyUp={(e) => (e.shiftKey || (e.key === 'a' && (e.ctrlKey || e.metaKey))) && updateToolbar()}
                  onBlur={() => setToolbar(null)}
                  onKeyDown={(e) => {
                    const a = assist;
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      if (a.task.running) return;
                      // 空章节且有细纲时，Ctrl+Enter 直接按细纲起草
                      if (!contentRef.current.trim() && meta.outline.trim()) a.doDraft();
                      else a.doContinue();
                    } else if (e.key === 'Tab') {
                      e.preventDefault();
                      if (inlineReady) a.accept();
                      else if (a.placement !== 'inline') {
                        const { start, end } = editor.getSelection();
                        editor.replaceRange(start, end, '\u3000\u3000');
                      }
                    } else if (e.key === 'Escape' && a.placement === 'inline') {
                      e.preventDefault();
                      if (a.task.running) a.task.stop();
                      else a.discard();
                    }
                  }}
                  placeholder={assist.placement === 'inline' ? '' : meta.outline.trim() ? '开始写作…  或按 Ctrl+Enter，让 AI 按细纲起笔' : '开始写作…'}
                  spellCheck={false}
                  className={cx(
                    'prose-editor relative block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted/50',
                    focus ? 'ghost-input min-h-[30vh]' : 'min-h-[50vh]',
                  )}
                />
                {toolbar && !assist.placement && !focus && (
                  <SelectionToolbar
                    top={toolbar.top}
                    left={toolbar.left}
                    onPick={(mode) => {
                      setToolbar(null);
                      assist.doRewrite(mode);
                    }}
                  />
                )}
                {inline && <InlineResult ref={inlineRef} assist={assist} top={inline.top} variant={inline.variant} />}
                {note && (
                  <div
                    className="pointer-events-none absolute right-[calc(100%+44px)] w-[210px] border-l-2 border-ai pl-3 font-sans text-[12.5px] leading-[1.7] text-muted max-[1240px]:hidden"
                    style={{ top: noteTop + 4 }}
                  >
                    <div className="mb-0.5 font-semibold text-ai">◆ {FLAVOR_CATEGORIES[note.cat].label}</div>
                    “{note.text}”——{FLAVOR_CATEGORIES[note.cat].tip}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {!focus && !showPanel && !assist.placement && content !== null && (
          <AiBar
            assist={assist}
            selWords={selection.end > selection.start && (content ?? '').slice(selection.start, selection.end).trim() ? selection.end - selection.start : 0}
            canDraft={!content.trim()}
            hasOutline={!!meta.outline.trim()}
            onOpenPanel={() => togglePanel(true)}
          />
        )}
      </div>

      {showPanel && !focus && content !== null && (
        <AiPanel
          meta={meta}
          editor={editor}
          content={content}
          selection={selection}
          report={report}
          chat={chat}
          assist={assist}
          highlight={highlight}
          setHighlight={setHighlight}
          onClose={() => togglePanel(false)}
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

// ---------------- 顶栏「更多」菜单 ----------------

const FONTS: { value: AppSettings['editorFont']; label: string; family: string }[] = [
  { value: 'sans', label: '黑体', family: 'var(--sans)' },
  { value: 'serif', label: '宋体', family: 'var(--serif)' },
  { value: 'kai', label: '楷体', family: 'var(--kai)' },
];

function MoreMenu({
  settings,
  showMeta,
  highlight,
  onToggleMeta,
  onToggleHighlight,
  onFind,
  onTidy,
  onSnapshots,
  onFocus,
}: {
  settings: AppSettings;
  showMeta: boolean;
  highlight: boolean;
  onToggleMeta: () => void;
  onToggleHighlight: () => void;
  onFind: () => void;
  onTidy: () => void;
  onSnapshots: () => void;
  onFocus: () => void;
}) {
  const updateSettings = useApp((s) => s.updateSettings);
  const size = settings.editorFontSize;
  return (
    <Menu
      width={248}
      trigger={(open, toggle) => (
        <IconButton title="更多" active={open} onClick={toggle}>
          <Ellipsis className="size-4" />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>正文字体</MenuLabel>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1">
            {FONTS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => updateSettings({ editorFont: f.value })}
                className={cx(
                  'flex flex-col items-center rounded-md border py-1.5 transition',
                  settings.editorFont === f.value ? 'border-ink/60 bg-hover' : 'border-line hover:bg-hover',
                )}
              >
                <span className="text-lg leading-tight" style={{ fontFamily: f.family }}>
                  文
                </span>
                <span className="text-[11px] text-muted">{f.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
            <span className="flex-1">字号</span>
            <IconButton title="缩小" className="size-6" disabled={size <= 14} onClick={() => updateSettings({ editorFontSize: size - 1 })}>
              <Minus className="size-3.5" />
            </IconButton>
            <span className="w-6 text-center tabular-nums">{size}</span>
            <IconButton title="放大" className="size-6" disabled={size >= 26} onClick={() => updateSettings({ editorFontSize: size + 1 })}>
              <Plus className="size-3.5" />
            </IconButton>
          </div>
          <MenuDivider />
          <MenuItem icon={<ListTree className="size-4" />} checked={showMeta} onClick={onToggleMeta}>
            显示章节信息
          </MenuItem>
          <MenuItem icon={<Highlighter className="size-4" />} checked={highlight} onClick={onToggleHighlight}>
            在正文中标注 AI 味
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={<Search className="size-4" />} hint="Ctrl F" onClick={() => (close(), onFind())}>
            查找替换
          </MenuItem>
          <MenuItem icon={<TextAlignStart className="size-4" />} onClick={() => (close(), onTidy())}>
            一键排版（段首缩进）
          </MenuItem>
          <MenuItem icon={<FileClock className="size-4" />} onClick={() => (close(), onSnapshots())}>
            历史版本
          </MenuItem>
          <MenuItem icon={<Maximize2 className="size-4" />} hint="Esc 退出" onClick={() => (close(), onFocus())}>
            专注模式
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

// ---------------- 章节属性（细纲 / 摘要 / 备注） ----------------

function ChapterProps({ meta }: { meta: ChapterMeta }) {
  const { update } = useBook.getState();
  const rows: { key: 'outline' | 'summary' | 'notes'; label: string; icon: ReactNode; placeholder: string }[] = [
    { key: 'outline', label: '细纲', icon: <ListTree className="size-4" />, placeholder: '场景、出场人物、事件推进、结尾钩子。AI 写作时会严格参考' },
    { key: 'summary', label: '摘要', icon: <ScrollText className="size-4" />, placeholder: '写完后可让 AI 生成，续写后续章节时作为前情提要' },
    { key: 'notes', label: '备注', icon: <StickyNote className="size-4" />, placeholder: '只给自己看，不会发给 AI' },
  ];
  return (
    <div className="mt-3 grid grid-cols-[92px_minmax(0,1fr)] gap-y-px text-[13.5px]">
      <PropLabel icon={<CircleDot className="size-4" />}>状态</PropLabel>
      <div className="flex h-[30px] items-center px-1">
        <Menu
          align="left"
          width={150}
          trigger={(_open, toggle) => (
            <button type="button" onClick={toggle} className={cx('rounded px-1.5 py-0.5 text-[13px] transition hover:brightness-95', STATUS[meta.status].cls)}>
              {STATUS[meta.status].label}
            </button>
          )}
        >
          {(close) =>
            (Object.keys(STATUS) as ChapterStatus[]).map((s) => (
              <MenuItem
                key={s}
                checked={meta.status === s}
                onClick={() => {
                  update('chapters', meta.id, { status: s }, true);
                  if (s === 'done' && meta.status !== 'done') memorizeNow(meta.bookId, meta.id, false);
                  close();
                }}
              >
                <span className={cx('rounded px-1.5 py-0.5 text-[12.5px]', STATUS[s].cls)}>{STATUS[s].label}</span>
              </MenuItem>
            ))
          }
        </Menu>
      </div>
      {rows.map((r) => (
        <PropRow key={r.key} label={r.key === 'summary' ? <SummaryLabel meta={meta} /> : r.label} icon={r.icon}>
          <PropText value={meta[r.key]} placeholder={r.placeholder} onChange={(v) => update('chapters', meta.id, { [r.key]: v })} />
        </PropRow>
      ))}
    </div>
  );
}

function PropLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-[30px] items-center gap-2 text-muted">
      {icon}
      {children}
    </div>
  );
}

/** 摘要过期或正在整理时，在「摘要」后面标出来 */
function SummaryLabel({ meta }: { meta: ChapterMeta }) {
  const busy = useMemory((s) => s.running?.id === meta.id || s.queue.some((j) => j.id === meta.id));
  const stale = summaryState(meta) === 'stale';
  return (
    <span className="flex items-center gap-1">
      摘要
      {busy ? (
        <Spinner className="size-3" />
      ) : stale ? (
        <span title="生成摘要后正文又改了不少，离开本章后会自动更新" className="rounded bg-amber-500/15 px-1 text-[10.5px] text-amber-700 dark:text-amber-300">
          过期
        </span>
      ) : null}
    </span>
  );
}

function PropRow({ label, icon, children }: { label: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <>
      <PropLabel icon={icon}>{label}</PropLabel>
      <div className="min-w-0">{children}</div>
    </>
  );
}

function PropText({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Textarea
        autoFocus
        value={value}
        minRows={2}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        placeholder={placeholder}
        className="my-0.5 border-0 bg-hover/70 px-2 py-1.5 text-[13.5px] focus:ring-0"
      />
    );
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex h-[30px] w-full min-w-0 items-center rounded-md px-2 text-left transition hover:bg-hover"
    >
      {value.trim() ? <span className="truncate text-ink/85">{value.trim().replace(/\s*\n+\s*/g, ' ')}</span> : <span className="truncate text-muted/60">{placeholder}</span>}
    </button>
  );
}

// ---------------- 选区浮动工具条 ----------------

const TOOLBAR_MAIN: RewriteMode[] = ['polish', 'expand', 'condense', 'deai', 'vivid', 'dialogue'];
const TOOLBAR_MORE: RewriteMode[] = ['sensory', 'tension'];

function SelectionToolbar({ top, left, onPick }: { top: number; left: number; onPick: (mode: RewriteMode) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(left);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.parentElement) return;
    setX(Math.max(-12, Math.min(left - 14, el.parentElement.clientWidth - el.offsetWidth + 12)));
  }, [left]);
  const info = (m: RewriteMode) => REWRITES.find((r) => r.mode === m)!;
  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.preventDefault()}
      className="pop-in absolute z-30 flex items-center gap-0.5 rounded-lg border border-line bg-paper p-1 font-sans text-[13px] shadow-[0_10px_28px_rgba(15,15,15,0.14),0_2px_6px_rgba(15,15,15,0.06)]"
      style={{ top: top - 46, left: x }}
    >
      <Sparkles className="mx-1.5 size-3.5 text-ai" />
      {TOOLBAR_MAIN.map((m) => (
        <button key={m} type="button" title={info(m).title} onClick={() => onPick(m)} className="rounded-md px-2 py-1 whitespace-nowrap transition hover:bg-hover">
          {info(m).label}
        </button>
      ))}
      <div className="mx-0.5 h-4 w-px bg-line" />
      <Menu
        width={170}
        trigger={(open, toggle) => (
          <button type="button" title="更多改写方式" onClick={toggle} className={cx('rounded-md px-1.5 py-1 transition hover:bg-hover', open && 'bg-hover')}>
            <Ellipsis className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            {TOOLBAR_MORE.map((m) => (
              <MenuItem key={m} hint={info(m).title.slice(0, 6)} onClick={() => (close(), onPick(m))}>
                {info(m).label}
              </MenuItem>
            ))}
            <div className="px-2 pt-1 pb-1.5 text-[11px] leading-relaxed text-muted">想按自己的要求改？在底部输入框写下要求再回车。</div>
          </>
        )}
      </Menu>
    </div>
  );
}

// ---------------- 正文内的 AI 结果预览 ----------------

function Chip({ primary, onClick, children, title }: { primary?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 whitespace-nowrap transition',
        primary ? 'border-ai bg-ai text-white hover:brightness-110' : 'border-line bg-paper text-ink/80 hover:bg-hover',
      )}
    >
      {children}
    </button>
  );
}

function InlineResult({ ref, assist, top, variant }: { ref: React.Ref<HTMLDivElement>; assist: WriteAssist; top: number; variant: 'ghost' | 'card' }) {
  const { task, target } = assist;
  const banned = useBannedWords();
  const text = task.text;
  const done = task.status === 'done' && !!text;
  const flavor = useMemo(() => (done && text.length > 30 ? analyzeAiFlavor(text, { extraBanned: banned }) : null), [done, text, banned]);
  const n = countWords(text);

  const bar = (
    <div className="flex flex-wrap items-center gap-1.5 font-sans text-[12.5px]">
      <span className="mr-1 flex items-center gap-1.5 font-medium text-ai">
        <Sparkles className="size-3.5" />
        {assist.label}
      </span>
      {task.running ? (
        <>
          <span className="text-muted">{text ? `已写 ${n} 字…` : task.reasoning ? `思考中（${task.reasoning.length} 字）…` : '连接中…'}</span>
          <Chip onClick={task.stop}>
            <CircleStop className="size-3.5" />
            停止 <Kbd>Esc</Kbd>
          </Chip>
        </>
      ) : task.status === 'error' ? (
        <Chip onClick={assist.discard}>关闭</Chip>
      ) : (
        <>
          <Chip primary onClick={assist.accept}>
            {target.kind === 'range' ? '替换原文' : '接受'} <Kbd>Tab</Kbd>
          </Chip>
          {target.kind === 'range' && <Chip onClick={() => assist.apply('after')}>插到后面</Chip>}
          <Chip onClick={() => task.retry()} title="用同样的要求重新生成">
            <RotateCcw className="size-3.5" />
            换一个
          </Chip>
          <Chip onClick={assist.deaiResult} title="检测这段结果的 AI 味，并让模型针对性改写">
            <WandSparkles className="size-3.5" />
            去AI味
          </Chip>
          <Chip onClick={assist.discard}>
            放弃 <Kbd>Esc</Kbd>
          </Chip>
        </>
      )}
      <span className="ml-auto flex items-center gap-2 text-muted">
        {done && <span className="tabular-nums">{n} 字</span>}
        {flavor && <span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', scoreTone(flavor.score))}>AI 味 {flavor.score}</span>}
      </span>
    </div>
  );

  const error = task.status === 'error' && (
    <div className="flex gap-2 py-1 font-sans text-[13px] text-danger">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 break-words">
        {task.error}
        {/模型服务|API|Key|模型/.test(task.error) && (
          <Link to="/settings" className="ml-1 text-ai underline">
            去设置
          </Link>
        )}
      </div>
    </div>
  );

  if (variant === 'ghost')
    return (
      <div ref={ref} className="absolute inset-x-0 z-20" style={{ top }}>
        <div className="relative -mx-4 rounded-lg bg-gradient-to-b from-ai-soft/80 to-ai-soft/25 px-4 pt-1 pb-2.5">
          <div className="absolute top-2 bottom-2 left-0 w-0.5 rounded bg-ai/50" />
          {error || (
            <div className={cx('prose-editor', task.running && 'stream-caret')} style={{ color: 'color-mix(in srgb, var(--ai) 38%, var(--muted))' }}>
              {text || '\u200b'}
            </div>
          )}
          <div className="mt-2">{bar}</div>
        </div>
      </div>
    );

  return (
    <div
      ref={ref}
      className="pop-in absolute inset-x-0 z-20 -mx-3 overflow-hidden rounded-xl border border-line bg-paper shadow-[0_16px_40px_rgba(15,15,15,0.14),0_2px_6px_rgba(15,15,15,0.06)]"
      style={{ top }}
    >
      {target.kind === 'range' && (
        <div className="line-clamp-3 border-b border-line px-4 py-2.5 font-editor text-[14px] leading-[1.8] text-muted line-through decoration-muted/50">{target.original}</div>
      )}
      <div className="max-h-[42vh] overflow-y-auto px-4 py-3">
        {error || <div className={cx('font-editor text-[15.5px] leading-[1.9] whitespace-pre-wrap', task.running && 'stream-caret')}>{text}</div>}
      </div>
      <div className="border-t border-line bg-side/70 px-3 py-2">{bar}</div>
    </div>
  );
}

// ---------------- 底部 AI 输入条 ----------------

function AiBar({
  assist,
  selWords,
  canDraft,
  hasOutline,
  onOpenPanel,
}: {
  assist: WriteAssist;
  selWords: number;
  canDraft: boolean;
  hasOutline: boolean;
  onOpenPanel: () => void;
}) {
  const [text, setText] = useState('');
  const submit = () => {
    if (assist.task.running) return;
    if (selWords) {
      if (!text.trim()) return toast('写下想怎么改，或者用选区上方的工具条', 'error');
      assist.doRewrite('custom', text);
    } else assist.doContinue(text);
    setText('');
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-10">
      <div className="pointer-events-auto flex w-full max-w-[640px] items-center gap-1.5 rounded-2xl border border-line bg-paper py-1.5 pr-1.5 pl-4 shadow-[0_16px_40px_rgba(15,15,15,0.11),0_2px_6px_rgba(15,15,15,0.05)] focus-within:ring-2 focus-within:ring-ai/15">
        <Sparkles className="size-[18px] shrink-0 text-ai" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={selWords ? `说说怎么改选中的 ${selWords} 字，回车改写` : '写点要求（可选），回车让 AI 从光标处续写'}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-[14px] outline-none placeholder:text-muted"
        />
        {canDraft && hasOutline && !selWords && (
          <button type="button" onClick={assist.doDraft} className="h-7 shrink-0 rounded-md bg-ai-soft px-2.5 text-[12.5px] font-medium text-ai hover:brightness-95">
            按细纲写本章
          </button>
        )}
        {!selWords && <LenSelect value={assist.continueLen} onChange={assist.setContinueLen} options={[200, 500, 1000, 2000]} />}
        <IconButton title="更多 AI 功能（Ctrl+J）" onClick={onOpenPanel}>
          <PanelRight className="size-4" />
        </IconButton>
        <button
          type="button"
          title={selWords ? '改写选中文字' : '从光标处续写（Ctrl+Enter）'}
          onClick={submit}
          disabled={!!selWords && !text.trim()}
          className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-ai text-white transition hover:brightness-110 disabled:bg-hover disabled:text-muted"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------- 专注模式 ----------------

function FocusChrome({
  bookTitle,
  label,
  words,
  today,
  goal,
  saving,
  onExit,
}: {
  bookTitle: string;
  label: string;
  words: number;
  today?: number;
  goal: number;
  saving: boolean;
  onExit: () => void;
}) {
  return (
    <>
      {goal > 0 && today !== undefined && (
        <div className="absolute top-0 left-0 z-30 h-0.5 bg-gradient-to-r from-[#b8823f] to-[#e0ad62]" style={{ width: `${Math.min(100, (today / goal) * 100)}%` }} />
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-44 bg-gradient-to-b from-bg via-bg/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-52 bg-gradient-to-t from-bg via-bg/85 to-transparent" />
      <div className="absolute top-5 left-7 z-20 text-[12.5px] text-muted">
        <span className="font-medium text-ink/55">{bookTitle}</span>
        <span className="ml-2.5">{label}</span>
      </div>
      <div className="absolute top-3.5 right-4 z-20 flex items-center gap-4 text-[12.5px] text-muted">
        <span>
          <span className="font-medium text-ink/55 tabular-nums">{words.toLocaleString()}</span> 字
        </span>
        {goal > 0 && today !== undefined && (
          <span className="tabular-nums">
            今日 {today.toLocaleString()} / {goal.toLocaleString()}
          </span>
        )}
        <span>{saving ? '保存中…' : '已保存'}</span>
        <button type="button" onClick={onExit} className="flex items-center gap-1 rounded-md px-2 py-1 transition hover:bg-hover hover:text-ink">
          <Minimize2 className="size-3.5" />
          退出
        </button>
      </div>
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-5 text-[12px] whitespace-nowrap text-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>Ctrl ↵</Kbd> AI 续写
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Tab</Kbd> 接受续写
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> 退出专注
        </span>
      </div>
    </>
  );
}

/** 专注模式下真正显示文字的镜像层：只有光标所在段落是亮的，并用虚线标出这一段里的 AI 腔 */
function FocusMirror({ text, caret, report }: { text: string; caret: number; report: FlavorReport | null }) {
  const paras = text.split('\n');
  const out: ReactNode[] = [];
  let pos = 0;
  paras.forEach((p, i) => {
    const s = pos;
    const e = pos + p.length;
    const current = caret >= s && caret <= e;
    let inner: ReactNode = p;
    if (current && report) {
      const hits = report.hits.filter((h: FlavorHit) => h.start >= s && h.end <= e && h.end <= text.length);
      if (hits.length) {
        const parts: ReactNode[] = [];
        let at = s;
        hits.forEach((h, k) => {
          if (h.start < at) return;
          if (h.start > at) parts.push(text.slice(at, h.start));
          parts.push(
            <span key={k} className="focus-flag">
              {text.slice(h.start, h.end)}
            </span>,
          );
          at = h.end;
        });
        parts.push(text.slice(at, e));
        inner = parts;
      }
    }
    out.push(
      <span key={i} className="focus-para" style={{ opacity: current ? 1 : 0.26 }}>
        {inner}
      </span>,
    );
    if (i < paras.length - 1) out.push('\n');
    pos = e + 1;
  });
  return (
    <div aria-hidden className="prose-editor pointer-events-none absolute inset-0 text-ink select-none">
      {out}
      {'\u200b'}
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
