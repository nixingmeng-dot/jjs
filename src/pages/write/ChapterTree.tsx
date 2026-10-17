import { ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Trash } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatWords } from '../../../shared/text';
import type { ChapterMeta, Volume } from '../../../shared/types';
import { confirmAsk, cx, IconButton } from '../../components/ui';
import { toastError, useBook } from '../../store';

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-muted/35',
  revising: 'bg-amber-500',
  done: 'bg-ok',
};

/** 侧栏里的分卷 / 章节目录，支持拖拽排序 */
export const ChapterTree = memo(function ChapterTree({ activeId, labels }: { activeId?: string; labels: Map<string, string> }) {
  const tree = useBook((s) => s.tree)!;
  const { create, update, remove, reorder } = useBook.getState();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; overVolume?: string } | null>(null);

  const ordered = useMemo(() => {
    const out: ChapterMeta[] = [];
    for (const v of tree.volumes) out.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return out;
  }, [tree.volumes, tree.chapters]);
  const bookId = tree.book.id;

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
    <div className="flex min-h-0 flex-1 flex-col pt-4">
      <div className="group flex items-center px-4 pb-1 text-[11.5px] font-medium text-muted">
        <span className="flex-1">目录</span>
        <IconButton title="新建分卷" className="size-5 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={addVolume}>
          <FolderPlus className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {tree.volumes.map((v, vi) => {
            const chapters = tree.chapters.filter((c) => c.volumeId === v.id);
            const words = chapters.reduce((n, c) => n + c.wordCount, 0);
            const isCollapsed = collapsed[v.id];
            return (
              <div key={v.id} className="mb-0.5">
                <div
                  className={cx('group flex h-7 items-center gap-1 rounded-md pr-1 pl-1.5 hover:bg-hover', drag?.overVolume === v.id && !drag.over && 'bg-accent-soft')}
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
                  <button type="button" className="flex size-5 items-center justify-center rounded text-muted hover:bg-accent-soft" onClick={() => setCollapsed({ ...collapsed, [v.id]: !isCollapsed })}>
                    {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                  {renaming === v.id ? (
                    <input
                      autoFocus
                      defaultValue={v.title}
                      className="min-w-0 flex-1 rounded border border-line bg-paper px-1 text-[13px] font-medium outline-none ring-2 ring-ai/20"
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
                    <span className="min-w-0 flex-1 truncate font-medium text-ink/90" onDoubleClick={() => setRenaming(v.id)} title={v.summary || v.title}>
                      {v.title}
                    </span>
                  )}
                  <span className="text-[11px] text-muted group-hover:hidden">{words ? (words >= 10000 ? formatWords(words) : words.toLocaleString()) : ''}</span>
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
                        'group relative flex h-7 cursor-pointer items-center gap-2.5 rounded-md pr-1 pl-8',
                        c.id === activeId ? 'bg-accent-soft font-medium text-ink' : 'hover:bg-hover',
                        drag?.id === c.id && 'opacity-40',
                        drag?.over === c.id && drag.id !== c.id && 'before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:bg-ai',
                      )}
                    >
                      <span className={cx('size-1.5 shrink-0 rounded-full', STATUS_DOT[c.status])} />
                      <span className="min-w-0 flex-1 truncate">{labels.get(c.id)}</span>
                      <span className="text-[11px] font-normal text-muted tabular-nums group-hover:hidden">{c.wordCount ? c.wordCount.toLocaleString() : ''}</span>
                      <span className="hidden group-hover:inline-flex">
                        <IconButton
                          title="删除章节"
                          className="size-5 hover:text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChapter(c);
                          }}
                        >
                          <Trash className="size-3" />
                        </IconButton>
                      </span>
                    </div>
                  ))}
                {!isCollapsed && chapters.length === 0 && (
                  <button type="button" onClick={() => addChapter(v.id)} className="ml-8 h-7 text-xs text-muted hover:text-ink">
                    + 新建章节
                  </button>
                )}
              </div>
            );
          })}
        {tree.volumes.length === 0 && (
          <button type="button" onClick={addVolume} className="h-7 px-2 text-xs text-muted hover:text-ink">
            + 新建分卷
          </button>
        )}
      </div>

      <div className="px-2 pb-1.5">
        <button
          type="button"
          onClick={() => lastVolume && addChapter(lastVolume)}
          disabled={!lastVolume}
          className="flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <Plus className="size-4" /> 新建章节
        </button>
      </div>
    </div>
  );
});
