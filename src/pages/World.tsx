import { Globe, Pin, PinOff, Plus, Search, Sparkles, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { WorldEntry } from '../../shared/types';
import { AiResultView, ModelPicker } from '../components/ai';
import { Button, confirmAsk, cx, Empty, Field, IconButton, Input, Textarea } from '../components/ui';
import { FactsField } from '../components/FactsField';
import { useAiTask } from '../hooks/useAiTask';
import { toastError, useBook } from '../store';
import { PageHeader } from './BookLayout';

const CATEGORIES = ['地点', '势力', '力量体系', '种族', '物品', '历史', '规则', '职业', '其他'];

export default function WorldPage() {
  const tree = useBook((s) => s.tree)!;
  const { itemId } = useParams();
  const navigate = useNavigate();
  const { create, update, remove } = useBook.getState();
  const [q, setQ] = useState('');
  const [instruction, setInstruction] = useState('');
  const task = useAiTask();
  const base = `/book/${tree.book.id}/world`;
  const current = tree.world.find((w) => w.id === itemId);

  useEffect(() => {
    if (!current && tree.world.length) navigate(`${base}/${tree.world[0].id}`, { replace: true });
  }, [current, tree.world, base, navigate]);

  useEffect(() => task.reset(), [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const m = new Map<string, WorldEntry[]>();
    for (const w of tree.world) {
      if (q && !w.name.includes(q) && !w.content.includes(q)) continue;
      m.set(w.category || '其他', [...(m.get(w.category || '其他') ?? []), w]);
    }
    const order = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : 50);
    return [...m.entries()].sort((a, b) => order(a[0]) - order(b[0]));
  }, [tree.world, q]);

  const add = async (category = '地点') => {
    const w = await create<WorldEntry>('world', { category, name: '' }).catch(toastError);
    if (w) navigate(`${base}/${w.id}`);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="设定" desc="世界观、地点、势力、力量体系等。正文或细纲里提到条目名称时，AI 会自动参考；标记「常驻」的条目每次都会提供。">
        <ModelPicker className="w-56" />
      </PageHeader>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 gap-5 px-6 py-5">
        <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-line bg-panel">
          <div className="space-y-2 border-b border-line p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索设定" className="h-8 pl-7 text-xs" />
            </div>
            <Button size="sm" className="w-full" icon={<Plus className="size-3.5" />} onClick={() => add(current?.category)}>
              新建条目
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {grouped.map(([cat, items]) => (
              <div key={cat} className="mb-2">
                <div className="px-2.5 py-1 text-[11px] font-medium text-muted">{cat}</div>
                {items.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => navigate(`${base}/${w.id}`)}
                    className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm', w.id === itemId ? 'bg-accent-soft text-accent' : 'hover:bg-hover')}
                  >
                    <span className="min-w-0 flex-1 truncate">{w.name || '未命名'}</span>
                    {w.pinned ? <Pin className="size-3 text-accent" /> : null}
                  </button>
                ))}
              </div>
            ))}
            {tree.world.length === 0 && <Empty icon={<Globe className="size-7" />} title="还没有设定" />}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto pb-10">
          {current ? (
            <div className="space-y-4 rounded-xl border border-line bg-panel p-5">
              <div className="flex items-center gap-2">
                <input
                  value={current.name}
                  onChange={(e) => update('world', current.id, { name: e.target.value })}
                  placeholder="条目名称（AI 靠这个名字判断是否相关）"
                  className="min-w-0 flex-1 bg-transparent font-serif text-xl font-semibold outline-none placeholder:text-base placeholder:font-normal placeholder:text-muted/60"
                />
                <Button
                  size="sm"
                  variant={current.pinned ? 'primary' : 'secondary'}
                  icon={current.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                  onClick={() => update('world', current.id, { pinned: current.pinned ? 0 : 1 }, true)}
                  title="常驻：每次都提供给 AI（适合核心世界规则）"
                >
                  {current.pinned ? '常驻' : '按需'}
                </Button>
                <IconButton title="删除" className="hover:text-danger" onClick={() => confirmAsk(`删除「${current.name || '未命名'}」？`) && remove('world', current.id).catch(toastError)}>
                  <Trash className="size-4" />
                </IconButton>
              </div>
              <Field label="分类">
                <div className="flex flex-wrap gap-1">
                  {[...new Set([...CATEGORIES, current.category])].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update('world', current.id, { category: c }, true)}
                      className={cx('rounded-full border px-2.5 py-0.5 text-xs', c === current.category ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink')}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="内容" hint="写清规则、限制和代价，比写“很强大”有用得多">
                <Textarea value={current.content} onChange={(e) => update('world', current.id, { content: e.target.value })} minRows={10} className="leading-loose" />
              </Field>
              <FactsField facts={current.facts ?? []} onChange={(facts) => update('world', current.id, { facts }, true)} />
              <div className="flex gap-2">
                <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="对 AI 的要求（可选）" className="flex-1" />
                <Button
                  icon={<Sparkles className="size-4" />}
                  loading={task.running}
                  onClick={() => task.run({ task: 'world', bookId: tree.book.id, worldId: current.id, instruction: instruction.trim() || undefined })}
                >
                  {current.content.trim() ? 'AI 扩写完善' : 'AI 撰写'}
                </Button>
              </div>
              <AiResultView
                task={task}
                prose={false}
                showFlavor={false}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        update('world', current.id, { content: task.text.trim() }, true);
                        task.reset();
                      }}
                    >
                      替换内容
                    </Button>
                    {current.content.trim() && (
                      <Button
                        size="sm"
                        onClick={() => {
                          update('world', current.id, { content: `${current.content.trim()}\n\n${task.text.trim()}` }, true);
                          task.reset();
                        }}
                      >
                        追加
                      </Button>
                    )}
                  </>
                }
              />
            </div>
          ) : (
            <Empty icon={<Globe className="size-8" />} title="新建一个设定条目" />
          )}
        </main>
      </div>
    </div>
  );
}
