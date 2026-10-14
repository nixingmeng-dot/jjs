import { ChevronDown, ChevronRight, FilePlus, FolderPlus, Pencil, Plus, Search, Trash, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { chapterLabels, formatWords } from '../../../shared/text';
import type { ChapterMeta, SearchHit, Volume } from '../../../shared/types';
import { api } from '../../api';
import { confirmAsk, cx, IconButton, Input } from '../../components/ui';
import { toastError, useBook, useUi } from '../../store';

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-muted/40',
  revising: 'bg-amber-500',
  done: 'bg-ok',
};

export const ChapterTree = memo(function ChapterTree({ activeId }: { activeId?: string }) {
  const tree = useBook((s) => s.tree)!;
  const { create, update, remove, reorder } = useBook.getState();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; overVolume?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  const ordered = useMemo(() => {
    const out: ChapterMeta[] = [];
    for (const v of tree.volumes) out.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return out;
  }, [tree.volumes, tree.chapters]);
  const labels = useMemo(() => chapterLabels(ordered), [ordered]);
  const bookId = tree.book.id;

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const t = setTimeout(async () => {
      await useBook.getState().flush();
      api.get<SearchHit[]>(`/books/${bookId}/search?q=${encodeURIComponent(query.trim())}`).then(setHits).catch(toastError);
    }, 300);
    return () => clearTimeout(t);
  }, [query, bookId]);

  const go = (id: string) => navigate(`/book/${bookId}/write/${id}`);

  const addChapter = async (volumeId: string) => {
    try {
      const ch = await create<ChapterMeta>('chapters', { volumeId, title: '' });
      setCollapsed((c) => ({ ...c, [volumeId]: false }));
      go(ch.id);
    } catch (err) {
      toastError(err);
    }
  };

  const addVolume = async () => {
    try {
      const n = tree.volumes.length + 1;
      const v = await create<Volume>('volumes', { title: `第${'一二三四五六七八九十'[n - 1] ?? n}卷` });
      setRenaming(v.id);
    } catch (err) {
      toastError(err);
    }
  };

  const deleteChapter = async (c: ChapterMeta) => {
    if (!confirmAsk(`删除「${labels.get(c.id)}」？${c.wordCount ? `本章有 ${c.wordCount} 字，` : ''}删除后无法恢复。`)) return;
    const idx = ordered.findIndex((x) => x.id === c.id);
    await remove('chapters', c.id).catch(toastError);
    if (c.id === activeId) {
      const next = ordered[idx + 1] ?? ordered[idx - 1];
      navigate(next && next.id !== c.id ? `/book/${bookId}/write/${next.id}` : `/book/${bookId}/write`);
    }
  };

  const deleteVolume = async (v: Volume) => {
    const n = tree.chapters.filter((c) => c.volumeId === v.id).length;
    if (!confirmAsk(`删除「${v.title}」${n ? `及其中的 ${n} 个章节` : ''}？删除后无法恢复。`)) return;
    await remove('volumes', v.id).catch(toastError);
  };

  const drop = async (targetVolume: string, beforeId?: string) => {
    if (!drag) return;
    const moving = drag.id;
    setDrag(null);
    if (moving === beforeId) return;
    const ids = tree.chapters.filter((c) => c.volumeId === targetVolume && c.id !== moving).map((c) => c.id);
    const at = beforeId ? ids.indexOf(beforeId) : ids.length;
    ids.splice(at === -1 ? ids.length : at, 0, moving);
    await reorder('chapters', ids, targetVolume).catch(toastError);
  };

  const moveVolume = async (v: Volume, dir: -1 | 1) => {
    const ids = tree.volumes.map((x) => x.id);
    const i = ids.indexOf(v.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await reorder('volumes', ids).catch(toastError);
  };

  const lastVolume = tree.chapters.find((c) => c.id === activeId)?.volumeId ?? tree.volumes[tree.volumes.length - 1]?.id;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="全书搜索" className="h-8 pl-7 text-xs" />
          {query && (
            <button type="button" className="absolute top-2 right-2 text-muted hover:text-ink" onClick={() => setQuery('')}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {hits ? (
          <div>
            <div className="px-3 py-1.5 text-[11px] text-muted">找到 {hits.length} 处</div>
            {hits.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  useUi.getState().setJump({ chapterId: h.chapterId, start: h.index, end: h.index + query.trim().length });
                  go(h.chapterId);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-hover"
              >
                <div className="truncate text-[11px] text-muted">{labels.get(h.chapterId)}</div>
                <div className="line-clamp-2 text-xs">
                  {h.snippet.split(query.trim()).map((part, j, arr) => (
                    <span key={j}>
                      {part}
                      {j < arr.length - 1 && <mark className="rounded-sm bg-accent-soft text-accent">{query.trim()}</mark>}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        ) : (
          tree.volumes.map((v, vi) => {
            const chapters = tree.chapters.filter((c) => c.volumeId === v.id);
            const words = chapters.reduce((n, c) => n + c.wordCount, 0);
            const isCollapsed = collapsed[v.id];
            return (
              <div key={v.id} className="mb-1">
                <div
                  className={cx('group flex items-center gap-1 px-2 py-1', drag?.overVolume === v.id && !drag.over && 'bg-accent-soft')}
                  onDragOver={(e) => {
                    if (!drag) return;
                    e.preventDefault();
                    setDrag({ ...drag, overVolume: v.id, over: undefined });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(v.id);
                  }}
                >
                  <button type="button" className="text-muted" onClick={() => setCollapsed({ ...collapsed, [v.id]: !isCollapsed })}>
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  {renaming === v.id ? (
                    <input
                      autoFocus
                      defaultValue={v.title}
                      className="min-w-0 flex-1 rounded border border-accent bg-paper px-1 text-xs font-semibold outline-none"
                      onBlur={(e) => {
                        update('volumes', v.id, { title: e.target.value.trim() || v.title }, true);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold" onDoubleClick={() => setRenaming(v.id)} title={v.summary || v.title}>
                      {v.title}
                    </span>
                  )}
                  <span className="text-[10px] text-muted group-hover:hidden">{formatWords(words)}</span>
                  <div className="hidden items-center group-hover:flex">
                    <IconButton title="上移分卷" className="size-5" disabled={vi === 0} onClick={() => moveVolume(v, -1)}>
                      <ChevronDown className="size-3 rotate-180" />
                    </IconButton>
                    <IconButton title="下移分卷" className="size-5" disabled={vi === tree.volumes.length - 1} onClick={() => moveVolume(v, 1)}>
                      <ChevronDown className="size-3" />
                    </IconButton>
                    <IconButton title="重命名" className="size-5" onClick={() => setRenaming(v.id)}>
                      <Pencil className="size-3" />
                    </IconButton>
                    <IconButton title="在本卷新建章节" className="size-5" onClick={() => addChapter(v.id)}>
                      <Plus className="size-3.5" />
                    </IconButton>
                    <IconButton title="删除分卷" className="size-5 hover:text-danger" onClick={() => deleteVolume(v)}>
                      <Trash className="size-3" />
                    </IconButton>
                  </div>
                </div>
                {!isCollapsed &&
                  chapters.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDrag({ id: c.id });
                      }}
                      onDragEnd={() => setDrag(null)}
                      onDragOver={(e) => {
                        if (!drag) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (drag.over !== c.id) setDrag({ ...drag, over: c.id, overVolume: v.id });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        drop(v.id, c.id);
                      }}
                      onClick={() => go(c.id)}
                      className={cx(
                        'group relative mx-1 flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-1 pl-6 text-[13px]',
                        c.id === activeId ? 'bg-accent-soft text-accent' : 'hover:bg-hover',
                        drag?.id === c.id && 'opacity-40',
                        drag?.over === c.id && drag.id !== c.id && 'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:bg-accent',
                      )}
                    >
                      <span className={cx('size-1.5 shrink-0 rounded-full', STATUS_DOT[c.status])} />
                      <span className="min-w-0 flex-1 truncate">{labels.get(c.id)}</span>
                      <span className="text-[10px] text-muted group-hover:hidden">{c.wordCount || ''}</span>
                      <IconButton
                        title="删除章节"
                        className="hidden size-5 group-hover:inline-flex hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteChapter(c);
                        }}
                      >
                        <Trash className="size-3" />
                      </IconButton>
                    </div>
                  ))}
                {!isCollapsed && chapters.length === 0 && (
                  <button type="button" onClick={() => addChapter(v.id)} className="ml-6 py-1 text-xs text-muted hover:text-accent">
                    + 新建章节
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-1 border-t border-line p-2">
        <button
          type="button"
          onClick={() => lastVolume && addChapter(lastVolume)}
          disabled={!lastVolume}
          className="flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs hover:bg-hover disabled:opacity-40"
        >
          <FilePlus className="size-3.5" /> 新章节
        </button>
        <button type="button" onClick={addVolume} className="flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs hover:bg-hover">
          <FolderPlus className="size-3.5" /> 新分卷
        </button>
      </div>
    </aside>
  );
});
