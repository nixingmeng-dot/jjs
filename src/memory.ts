// 长篇记忆的前端调度：后台逐个整理章节摘要和卷回顾，结果同步回当前作品。
import { create } from 'zustand';
import type { BookTree, ChapterMeta, MemoryStatus, MemoryUpdate, Volume } from '../shared/types';
import { api } from './api';
import { toast, useApp, useBook } from './store';

interface Job {
  kind: 'chapter' | 'volume';
  id: string;
  bookId: string;
  /** 作者手动触发：不受「自动记忆」开关限制，完成后提示 */
  manual?: boolean;
}

interface MemoryState {
  running: Job | null;
  queue: Job[];
  /** 当前作品待确认的变化 */
  updates: MemoryUpdate[];
}

export const useMemory = create<MemoryState>(() => ({ running: null, queue: [], updates: [] }));

let activeChapter: string | undefined;
/** 正在写的章节先不整理，离开后再整理 */
export const setActiveChapter = (id?: string) => {
  activeChapter = id;
};

const failed = new Set<string>();
const shownErrors = new Set<string>();
const key = (j: Pick<Job, 'kind' | 'id'>) => `${j.kind}:${j.id}`;

const autoEnabled = () => {
  const { settings, providers } = useApp.getState();
  return !!settings?.autoMemory && providers.some((p) => p.enabled && p.models.length);
};

const patchTree = (bookId: string, fn: (t: BookTree) => BookTree) => {
  const tree = useBook.getState().tree;
  if (tree?.book.id === bookId) useBook.setState({ tree: fn(tree) });
};

/** 读取待确认的变化；scan 时把需要整理的章节和分卷排进队列 */
export async function refreshMemory(bookId: string, opts: { scan?: boolean } = {}) {
  const res = await api.get<{ status: MemoryStatus; updates: MemoryUpdate[] }>(`/books/${bookId}/memory`);
  if (useBook.getState().tree?.book.id === bookId) useMemory.setState({ updates: res.updates });
  if (!opts.scan || !autoEnabled()) return;
  for (const id of res.status.chapters) if (id !== activeChapter) enqueue({ kind: 'chapter', id, bookId });
  for (const id of res.status.volumes) enqueue({ kind: 'volume', id, bookId });
}

function enqueue(job: Job, front = false) {
  if (!job.manual && failed.has(key(job))) return;
  const { queue, running } = useMemory.getState();
  if (running && key(running) === key(job)) return;
  const rest = queue.filter((j) => key(j) !== key(job));
  useMemory.setState({ queue: front ? [job, ...rest] : [...rest, job] });
  void pump();
}

let pumping = false;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const [job, ...rest] = useMemory.getState().queue;
      if (!job) break;
      useMemory.setState({ running: job, queue: rest });
      try {
        await runJob(job);
        failed.delete(key(job));
      } catch (err) {
        failed.add(key(job));
        const msg = (err as Error).message || '未知错误';
        if (job.manual || !shownErrors.has(msg)) {
          shownErrors.add(msg);
          toast(`整理记忆失败：${msg}`, 'error');
        }
        // 自动整理失败多半是模型或网络问题，后面的也会失败，先停下，避免白白消耗额度
        if (!job.manual) useMemory.setState({ queue: useMemory.getState().queue.filter((j) => j.manual) });
      }
    }
  } finally {
    useMemory.setState({ running: null });
    pumping = false;
  }
}

async function runJob(job: Job) {
  if (job.kind === 'chapter') {
    const r = await api.post<{ chapter: ChapterMeta; updates: MemoryUpdate[] }>(`/chapters/${job.id}/memorize`);
    patchTree(job.bookId, (t) => ({
      ...t,
      chapters: t.chapters.map((c) => (c.id === job.id ? { ...c, summary: r.chapter.summary, summaryWords: r.chapter.summaryWords } : c)),
    }));
    if (job.manual) toast(r.updates.length ? `本章记忆已更新，有 ${r.updates.length} 条人物 / 设定变化待确认` : '本章记忆已更新', 'ok');
  } else {
    const v = await api.post<Volume>(`/volumes/${job.id}/recap`);
    patchTree(job.bookId, (t) => ({ ...t, volumes: t.volumes.map((x) => (x.id === v.id ? { ...x, recap: v.recap, recapHash: v.recapHash } : x)) }));
  }
  // 章节整理完，所在分卷可能就可以生成卷回顾了
  await refreshMemory(job.bookId, { scan: job.kind === 'chapter' && !job.manual });
}

/** 打开作品：稍等界面加载完，再在后台补齐缺的记忆 */
export function memoryOnBookOpen(bookId: string) {
  useMemory.setState({ updates: [], queue: useMemory.getState().queue.filter((j) => j.bookId === bookId) });
  setTimeout(() => refreshMemory(bookId, { scan: true }).catch(() => {}), 2500);
}

/** 离开一章：等正文保存完再整理 */
export function memoryOnLeaveChapter(bookId: string) {
  void useBook
    .getState()
    .flush()
    .then(() => refreshMemory(bookId, { scan: true }))
    .catch(() => {});
}

/** 立即整理某一章（手动，或章节标为完成） */
export function memorizeNow(bookId: string, chapterId: string, manual = true) {
  if (!manual && !autoEnabled()) return;
  void useBook
    .getState()
    .flush()
    .then(() => enqueue({ kind: 'chapter', id: chapterId, bookId, manual }, true));
}

export async function applyMemoryUpdates(bookId: string, items: { id: string; name: string; fact: string }[], dismiss: string[]) {
  if (dismiss.length) await api.post(`/books/${bookId}/memory-updates/dismiss`, { ids: dismiss });
  const r = await api.post<{ applied: number; updates: MemoryUpdate[] }>(`/books/${bookId}/memory-updates/apply`, { items });
  useMemory.setState({ updates: r.updates });
  await useBook.getState().refresh();
  return r.applied;
}
