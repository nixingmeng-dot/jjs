import { ChevronsUpDown, Flag, Globe, Info, ListTree, PenLine, Search, Settings, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { chapterLabels, formatWords } from '../../shared/text';
import type { ChapterMeta, SearchHit } from '../../shared/types';
import { api } from '../api';
import { cx, Kbd } from '../components/ui';
import { toastError, useBook, useUi } from '../store';
import { ChapterTree } from './write/ChapterTree';

export function Sidebar() {
  const tree = useBook((s) => s.tree)!;
  const saving = useBook((s) => s.saving);
  const saveError = useBook((s) => s.saveError);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const bookId = tree.book.id;
  const activeChapter = pathname.match(/\/write\/([^/]+)/)?.[1];
  const onWrite = /\/write(\/|$)/.test(pathname) || pathname.replace(/\/$/, '').endsWith(`/book/${bookId}`);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const labels = useMemo(() => {
    const ordered: ChapterMeta[] = [];
    for (const v of tree.volumes) ordered.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return chapterLabels(ordered);
  }, [tree.volumes, tree.chapters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      await useBook.getState().flush();
      api.get<SearchHit[]>(`/books/${bookId}/search?q=${encodeURIComponent(q)}`).then(setHits).catch(toastError);
    }, 300);
    return () => clearTimeout(t);
  }, [query, bookId]);

  const total = tree.chapters.reduce((n, c) => n + c.wordCount, 0);
  const openForeshadows = tree.foreshadows.filter((f) => f.status === 'open').length;
  const nav = [
    { to: 'write', label: '写作', icon: PenLine, active: onWrite },
    { to: 'outline', label: '大纲', icon: ListTree },
    { to: 'characters', label: '人物', icon: Users, count: tree.characters.length },
    { to: 'world', label: '设定', icon: Globe, count: tree.world.length },
    { to: 'foreshadows', label: '伏笔', icon: Flag, count: openForeshadows },
    { to: 'info', label: '作品信息', icon: Info },
  ];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-side text-[13.5px] text-ink/80">
      <div className="px-2 pt-2.5">
        <Link to="/" title="返回作品列表" className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent font-serif text-[13px] font-semibold text-accent-ink">
            {tree.book.title.slice(0, 1) || '墨'}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{tree.book.title}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
        </Link>

        <label className="group mt-1 flex h-[30px] items-center gap-2.5 rounded-md px-2 text-muted focus-within:bg-paper focus-within:ring-1 focus-within:ring-line hover:bg-hover">
          <Search className="size-4 shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
            placeholder="搜索全书"
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
          />
          {query ? (
            <button type="button" title="清除" onClick={() => setQuery('')} className="hover:text-ink">
              <X className="size-3.5" />
            </button>
          ) : (
            <Kbd>Ctrl K</Kbd>
          )}
        </label>
      </div>

      {hits ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
          <div className="px-2 pb-1 text-[11.5px] font-medium text-muted">找到 {hits.length} 处</div>
          {hits.map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                useUi.getState().setJump({ chapterId: h.chapterId, start: h.index, end: h.index + query.trim().length });
                navigate(`/book/${bookId}/write/${h.chapterId}`);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-hover"
            >
              <div className="truncate text-[11px] text-muted">{labels.get(h.chapterId)}</div>
              <div className="line-clamp-2 text-xs leading-relaxed text-ink/90">
                {h.snippet.split(query.trim()).map((part, j, arr) => (
                  <span key={j}>
                    {part}
                    {j < arr.length - 1 && <mark className="rounded-sm bg-ai-soft px-0.5 text-ai">{query.trim()}</mark>}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <>
          <nav className="px-2 pt-3">
            {nav.map(({ to, label, icon: Icon, count, active }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cx(
                    'flex h-[30px] items-center gap-2.5 rounded-md px-2 transition',
                    isActive || active ? 'bg-accent-soft font-medium text-ink' : 'hover:bg-hover',
                  )
                }
              >
                <Icon className="size-4 shrink-0 text-muted" />
                <span className="flex-1">{label}</span>
                {!!count && <span className="text-[11.5px] text-muted">{count}</span>}
              </NavLink>
            ))}
          </nav>
          <ChapterTree activeId={activeChapter} labels={labels} />
        </>
      )}

      <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[11.5px] text-muted">
        <span
          className={cx('size-1.5 shrink-0 rounded-full', saveError ? 'bg-danger' : saving ? 'animate-pulse bg-amber-500' : 'bg-ok')}
          title={saveError ? `保存失败：${saveError}` : undefined}
        />
        <span className="min-w-0 flex-1 truncate">
          {saveError ? '保存失败' : saving ? '保存中…' : '已保存'} · 全书 {total >= 10000 ? formatWords(total) : total.toLocaleString()} 字
        </span>
        <Link to="/settings" title="设置" className="flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-ink">
          <Settings className="size-3.5" />
        </Link>
      </div>
    </aside>
  );
}
