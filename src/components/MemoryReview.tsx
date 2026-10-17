import { useMemo, useState } from 'react';
import { chapterLabels } from '../../shared/text';
import type { ChapterMeta, MemoryUpdate } from '../../shared/types';
import { applyMemoryUpdates, useMemory } from '../memory';
import { toast, toastError, useBook } from '../store';
import { Button, cx, Modal } from './ui';

const KIND: Record<MemoryUpdate['kind'], { label: string; cls: string }> = {
  character: { label: '人物', cls: 'bg-sky-500/12 text-sky-700 dark:text-sky-300' },
  world: { label: '设定', cls: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' },
  foreshadow: { label: '伏笔', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};

/** 自动记忆整理出的变化，作者确认后才写入人物卡、设定和伏笔 */
export function MemoryReview({ onClose }: { onClose: () => void }) {
  const tree = useBook((s) => s.tree)!;
  const updates = useMemory((s) => s.updates);
  const [edits, setEdits] = useState<Record<string, { name: string; fact: string; on: boolean }>>({});
  const [busy, setBusy] = useState(false);

  const { labels, order } = useMemo(() => {
    const ordered: ChapterMeta[] = [];
    for (const v of tree.volumes) ordered.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return { labels: chapterLabels(ordered), order: new Map(ordered.map((c, i) => [c.id, i])) };
  }, [tree.volumes, tree.chapters]);

  const groups = useMemo(() => {
    const m = new Map<string, MemoryUpdate[]>();
    for (const u of updates) m.set(u.chapterId, [...(m.get(u.chapterId) ?? []), u]);
    return [...m.entries()].sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  }, [updates, order]);

  const val = (u: MemoryUpdate) => edits[u.id] ?? { name: u.name, fact: u.fact, on: true };
  const set = (u: MemoryUpdate, patch: Partial<{ name: string; fact: string; on: boolean }>) => setEdits((e) => ({ ...e, [u.id]: { ...val(u), ...patch } }));

  const target = (u: MemoryUpdate) => {
    const name = val(u).name.trim();
    if (u.kind === 'character') {
      const hit = tree.characters.find((c) => c.name.trim() === name || c.aliases.split(/[,，、\s/]+/).some((a) => a.trim() === name));
      return hit ? `记入人物「${hit.name}」` : '新建人物卡';
    }
    if (u.kind === 'world') return tree.world.some((w) => w.name.trim() === name) ? `记入设定「${name}」` : `新建设定（${u.category || '其他'}）`;
    const hit = tree.foreshadows.find(
      (f) => f.status === 'open' && (f.title.trim() === name || (name.length >= 2 && (f.title.includes(name) || name.includes(f.title.trim())))),
    );
    if (u.resolved) return hit ? `标记伏笔「${hit.title}」已回收` : '没找到对应的伏笔，会被忽略';
    return hit ? `补充到伏笔「${hit.title}」` : '新建伏笔';
  };

  const picked = updates.filter((u) => val(u).on);
  const submit = async (all: boolean) => {
    setBusy(true);
    try {
      const items = all ? picked.map((u) => ({ id: u.id, name: val(u).name, fact: val(u).fact })) : [];
      const dismiss = updates.filter((u) => !all || !val(u).on).map((u) => u.id);
      const n = await applyMemoryUpdates(tree.book.id, items, dismiss);
      toast(all && n ? `已记入 ${n} 条` : '已忽略', 'ok');
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={680}
      title="记忆待确认"
      footer={
        <>
          <Button variant="ghost" className="mr-auto" disabled={busy || !updates.length} onClick={() => submit(false)}>
            全部忽略
          </Button>
          <Button onClick={onClose}>稍后</Button>
          <Button variant="primary" loading={busy} disabled={!updates.length} onClick={() => submit(true)}>
            确认（记入 {picked.length} 条）
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] leading-relaxed text-muted">
        AI 从写完的章节里整理出这些变化。勾选的会记入人物卡、设定和伏笔，写后面的章节时带给 AI；没勾选的会被忽略。名字和内容都可以直接改。
      </p>
      {!updates.length && <div className="py-8 text-center text-sm text-muted">没有待确认的内容</div>}
      <div className="space-y-5">
        {groups.map(([chapterId, list]) => (
          <section key={chapterId}>
            <h3 className="mb-1.5 text-[12px] font-medium text-muted">{labels.get(chapterId) ?? '已删除的章节'}</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              {list.map((u) => {
                const v = val(u);
                return (
                  <div key={u.id} className={cx('flex items-start gap-2.5 border-b border-line px-3 py-2 last:border-0', !v.on && 'opacity-50')}>
                    <input type="checkbox" checked={v.on} onChange={(e) => set(u, { on: e.target.checked })} className="mt-2" aria-label="记入" />
                    <span className={cx('mt-1 shrink-0 rounded px-1.5 py-0.5 text-[11px]', KIND[u.kind].cls)}>{KIND[u.kind].label}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-2">
                        <input
                          value={v.name}
                          onChange={(e) => set(u, { name: e.target.value })}
                          className="w-28 shrink-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium outline-none hover:border-line focus:border-line focus:bg-paper"
                        />
                        <input
                          value={v.fact}
                          onChange={(e) => set(u, { fact: e.target.value })}
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[13px] outline-none hover:border-line focus:border-line focus:bg-paper"
                        />
                      </div>
                      <div className="px-1.5 text-[11.5px] text-muted">→ {target(u)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
