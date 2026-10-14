import { Flag, Plus, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import { chapterLabels } from '../../shared/text';
import type { ChapterMeta, ForeshadowStatus } from '../../shared/types';
import { Button, confirmAsk, cx, Empty, Field, IconButton, Segmented, Select, Textarea } from '../components/ui';
import { toastError, useBook } from '../store';
import { PageHeader } from './BookLayout';

const STATUS: { value: ForeshadowStatus; label: string }[] = [
  { value: 'open', label: '待回收' },
  { value: 'resolved', label: '已回收' },
  { value: 'dropped', label: '已放弃' },
];

export default function ForeshadowsPage() {
  const tree = useBook((s) => s.tree)!;
  const { create, update, remove } = useBook.getState();
  const [filter, setFilter] = useState<'all' | ForeshadowStatus>('open');

  const ordered = useMemo(() => {
    const out: ChapterMeta[] = [];
    for (const v of tree.volumes) out.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return out;
  }, [tree.volumes, tree.chapters]);
  const labels = useMemo(() => chapterLabels(ordered), [ordered]);
  const list = tree.foreshadows.filter((f) => filter === 'all' || f.status === filter);
  const counts = Object.fromEntries(STATUS.map((s) => [s.value, tree.foreshadows.filter((f) => f.status === s.value).length]));

  const chapterSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 text-xs">
      <option value="">未指定</option>
      {tree.volumes.map((v) => (
        <optgroup key={v.id} label={v.title}>
          {ordered
            .filter((c) => c.volumeId === v.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {labels.get(c.id)}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="伏笔" desc="记录埋下的线索和计划回收的位置。「待回收」的伏笔会提供给 AI，避免写出矛盾。">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => create('foreshadows', { title: '', status: 'open' }).catch(toastError)}>
          新建伏笔
        </Button>
      </PageHeader>
      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: 'all' as const, label: `全部 ${tree.foreshadows.length}` }, ...STATUS.map((s) => ({ value: s.value, label: `${s.label} ${counts[s.value]}` }))]}
        />
        {list.length === 0 ? (
          <Empty icon={<Flag className="size-8" />} title={filter === 'open' ? '没有待回收的伏笔' : '暂无伏笔'} />
        ) : (
          list.map((f) => (
            <div key={f.id} className={cx('rounded-xl border border-line bg-panel p-4', f.status !== 'open' && 'opacity-70')}>
              <div className="mb-3 flex items-center gap-2">
                <Flag className={cx('size-4', f.status === 'open' ? 'text-accent' : f.status === 'resolved' ? 'text-ok' : 'text-muted')} />
                <input
                  value={f.title}
                  onChange={(e) => update('foreshadows', f.id, { title: e.target.value })}
                  placeholder="伏笔名称，如：玉佩上的裂痕"
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:font-normal placeholder:text-muted/60"
                />
                <Segmented value={f.status} onChange={(status) => update('foreshadows', f.id, { status }, true)} options={STATUS} />
                <IconButton title="删除" className="hover:text-danger" onClick={() => confirmAsk('删除这条伏笔？') && remove('foreshadows', f.id).catch(toastError)}>
                  <Trash className="size-3.5" />
                </IconButton>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="内容 / 埋设方式">
                  <Textarea value={f.content} onChange={(e) => update('foreshadows', f.id, { content: e.target.value })} minRows={2} />
                </Field>
                <Field label="回收计划">
                  <Textarea value={f.resolvePlan} onChange={(e) => update('foreshadows', f.id, { resolvePlan: e.target.value })} minRows={2} />
                </Field>
                <Field label="埋设于">{chapterSelect(f.plantedChapterId, (v) => update('foreshadows', f.id, { plantedChapterId: v }, true))}</Field>
                <Field label="回收于">{chapterSelect(f.resolvedChapterId, (v) => update('foreshadows', f.id, { resolvedChapterId: v }, true))}</Field>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
