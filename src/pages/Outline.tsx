import { ChevronDown, ChevronRight, ListPlus, PenLine, Plus, Sparkles, Trash } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { chapterLabels, extractJson, formatWords, toChineseNumber } from '../../shared/text';
import type { ChapterMeta, Volume } from '../../shared/types';
import { AiResultView, ModelPicker } from '../components/ai';
import { Button, confirmAsk, cx, Field, IconButton, Input, Modal, Select, Textarea } from '../components/ui';
import { useAiTask } from '../hooks/useAiTask';
import { toast, toastError, useBook } from '../store';
import { PageHeader } from './BookLayout';

export default function OutlinePage() {
  const tree = useBook((s) => s.tree)!;
  const { updateBook, create } = useBook.getState();
  const { book } = tree;
  const task = useAiTask();
  const [instruction, setInstruction] = useState('');
  const [plan, setPlan] = useState<{ kind: 'volumes' | 'chapters'; volumeId?: string } | null>(null);
  const [volCount, setVolCount] = useState(4);

  const ordered = useMemo(() => {
    const out: ChapterMeta[] = [];
    for (const v of tree.volumes) out.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return out;
  }, [tree.volumes, tree.chapters]);
  const labels = useMemo(() => chapterLabels(ordered), [ordered]);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="大纲" desc="从总纲到卷纲再到章节细纲，逐层细化。AI 写正文时会自动读取对应层级的大纲、前情摘要和相关人物。">
        <ModelPicker className="w-56" />
      </PageHeader>
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-sm font-semibold">故事核心</h2>
          <div className="space-y-3">
            <Field label="简介 / 一句话故事" hint="AI 构思总纲的出发点">
              <Textarea value={book.synopsis} onChange={(e) => updateBook({ synopsis: e.target.value })} minRows={2} />
            </Field>
            <Field label="总纲" hint="主线、主要人物弧光、关键转折与结局">
              <Textarea
                value={book.outline}
                onChange={(e) => updateBook({ outline: e.target.value })}
                minRows={8}
                className="font-serif text-[15px] leading-loose"
                placeholder="还没有总纲。可以自己写，也可以填好简介后点下方「AI 构思总纲」。"
              />
            </Field>
            <div className="flex gap-2">
              <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="对总纲的额外要求（可选），如：结局要悲剧、加入双男主线" className="flex-1" />
              <Button
                variant="primary"
                icon={<Sparkles className="size-4" />}
                loading={task.running}
                onClick={() => task.run({ task: 'outline_book', bookId: book.id, instruction: instruction.trim() || undefined })}
              >
                {book.outline.trim() ? 'AI 完善总纲' : 'AI 构思总纲'}
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
                      updateBook({ outline: task.text.trim() }, true);
                      task.reset();
                    }}
                  >
                    {book.outline.trim() ? '替换总纲' : '采用为总纲'}
                  </Button>
                  {book.outline.trim() && (
                    <Button
                      size="sm"
                      onClick={() => {
                        updateBook({ outline: `${book.outline.trim()}\n\n${task.text.trim()}` }, true);
                        task.reset();
                      }}
                    >
                      追加到总纲
                    </Button>
                  )}
                </>
              }
            />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 text-sm font-semibold">
              分卷与章节 <span className="ml-1 font-normal text-muted">{tree.volumes.length} 卷 · {tree.chapters.length} 章</span>
            </h2>
            <Select value={volCount} onChange={(e) => setVolCount(Number(e.target.value))} className="w-24">
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} 卷
                </option>
              ))}
            </Select>
            <Button icon={<Sparkles className="size-4" />} onClick={() => setPlan({ kind: 'volumes' })} disabled={!book.outline.trim() && !book.synopsis.trim()}>
              AI 规划分卷
            </Button>
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => create('volumes', { title: `第${toChineseNumber(tree.volumes.length + 1)}卷` }).catch(toastError)}
            >
              新建分卷
            </Button>
          </div>
          <div className="space-y-4">
            {tree.volumes.map((v) => (
              <VolumeCard key={v.id} volume={v} chapters={tree.chapters.filter((c) => c.volumeId === v.id)} labels={labels} onPlan={() => setPlan({ kind: 'chapters', volumeId: v.id })} />
            ))}
          </div>
        </section>
      </main>
      {plan && <PlanModal plan={plan} count={volCount} onClose={() => setPlan(null)} />}
    </div>
  );
}

function VolumeCard({ volume, chapters, labels, onPlan }: { volume: Volume; chapters: ChapterMeta[]; labels: Map<string, string>; onPlan: () => void }) {
  const { update, remove, create } = useBook.getState();
  const bookId = useBook((s) => s.tree!.book.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);
  const words = chapters.reduce((n, c) => n + c.wordCount, 0);
  return (
    <div className="rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <button type="button" onClick={() => setOpen(!open)} className="text-muted">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <input
          value={volume.title}
          onChange={(e) => update('volumes', volume.id, { title: e.target.value })}
          className="min-w-0 flex-1 bg-transparent font-serif text-base font-semibold outline-none"
        />
        <span className="text-xs text-muted">
          {chapters.length} 章 · {formatWords(words)} 字
        </span>
        <Button size="sm" icon={<Sparkles className="size-3.5" />} onClick={onPlan} title="根据总纲和卷纲规划本卷章节细纲">
          AI 规划章节
        </Button>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => create('chapters', { volumeId: volume.id, title: '' }).catch(toastError)}>
          章节
        </Button>
        <IconButton
          title="删除分卷"
          className="hover:text-danger"
          onClick={() => {
            if (confirmAsk(`删除「${volume.title}」${chapters.length ? `及其中的 ${chapters.length} 个章节` : ''}？`)) remove('volumes', volume.id).catch(toastError);
          }}
        >
          <Trash className="size-3.5" />
        </IconButton>
      </div>
      {open && (
        <div className="space-y-3 p-4">
          <Textarea
            value={volume.summary}
            onChange={(e) => update('volumes', volume.id, { summary: e.target.value })}
            minRows={2}
            placeholder="卷纲：本卷的核心冲突、主角目标与变化、高潮事件、卷末钩子"
            className="text-[13px]"
          />
          {chapters.length > 0 && (
            <div className="divide-y divide-line rounded-lg border border-line">
              {chapters.map((c) => (
                <div key={c.id} className="group flex gap-3 px-3 py-2">
                  <div className="w-44 shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="shrink-0 font-serif text-xs text-muted">{(labels.get(c.id) ?? '').split(' ')[0]}</span>
                      <input
                        value={c.title}
                        onChange={(e) => update('chapters', c.id, { title: e.target.value })}
                        placeholder="标题"
                        className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted/60"
                      />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                      <span className={cx(c.status === 'done' ? 'text-ok' : c.status === 'revising' && 'text-amber-600')}>
                        {{ draft: '草稿', revising: '修改中', done: '完成' }[c.status]}
                      </span>
                      <span>{c.wordCount} 字</span>
                      {c.summary && <span title={c.summary}>有摘要</span>}
                    </div>
                  </div>
                  <Textarea
                    value={c.outline}
                    onChange={(e) => update('chapters', c.id, { outline: e.target.value })}
                    minRows={1}
                    placeholder="细纲"
                    className="flex-1 border-transparent bg-transparent px-1.5 py-0.5 text-[13px] hover:border-line focus:bg-paper"
                  />
                  <div className="flex shrink-0 items-start gap-0.5 opacity-0 group-hover:opacity-100">
                    <IconButton title="去写作" onClick={() => navigate(`/book/${bookId}/write/${c.id}`)}>
                      <PenLine className="size-3.5" />
                    </IconButton>
                    <IconButton
                      title="删除章节"
                      className="hover:text-danger"
                      onClick={() => confirmAsk(`删除「${labels.get(c.id)}」？`) && remove('chapters', c.id).catch(toastError)}
                    >
                      <Trash className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PlanItem {
  title: string;
  body: string;
  checked: boolean;
}

function PlanModal({ plan, count, onClose }: { plan: { kind: 'volumes' | 'chapters'; volumeId?: string }; count: number; onClose: () => void }) {
  const tree = useBook((s) => s.tree)!;
  const { createMany } = useBook.getState();
  const task = useAiTask();
  const [n, setN] = useState(plan.kind === 'volumes' ? count : 10);
  const [instruction, setInstruction] = useState('');
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const volume = tree.volumes.find((v) => v.id === plan.volumeId);
  const isVol = plan.kind === 'volumes';

  const run = async () => {
    setItems(null);
    const text = await task.run({
      task: isVol ? 'outline_volumes' : 'outline_chapters',
      bookId: tree.book.id,
      volumeId: plan.volumeId,
      count: n,
      instruction: instruction.trim() || undefined,
    });
    if (text === null) return;
    const parsed = extractJson<{ title?: string; summary?: string; outline?: string }[]>(text);
    if (!Array.isArray(parsed) || !parsed.length) {
      toast('没能从结果中解析出列表，可以重试，或手动复制需要的内容', 'error');
      return;
    }
    setItems(
      parsed.map((p) => ({
        title: String(p.title ?? '').replace(/^第[^卷章]{1,6}[卷章][\s:：]*/, ''),
        body: String((isVol ? p.summary : p.outline) ?? p.summary ?? p.outline ?? ''),
        checked: true,
      })),
    );
  };

  const accept = async () => {
    if (!items) return;
    const chosen = items.filter((i) => i.checked);
    if (!chosen.length) return;
    setBusy(true);
    try {
      if (isVol) {
        const start = tree.volumes.length;
        await createMany(
          'volumes',
          chosen.map((i, k) => ({ title: `第${toChineseNumber(start + k + 1)}卷 ${i.title}`.trim(), summary: i.body })),
        );
      } else {
        await createMany(
          'chapters',
          chosen.map((i) => ({ volumeId: plan.volumeId, title: i.title, outline: i.body })),
        );
      }
      toast(`已添加 ${chosen.length} 个${isVol ? '分卷' : '章节'}`, 'ok');
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
      width={760}
      title={isVol ? 'AI 规划分卷' : `AI 规划章节 · ${volume?.title ?? ''}`}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          {items && (
            <Button variant="primary" loading={busy} onClick={accept} icon={<ListPlus className="size-4" />}>
              添加选中的 {items.filter((i) => i.checked).length} 项
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="w-24">
            {(isVol ? [1, 2, 3, 4, 5, 6, 8, 10] : [3, 5, 8, 10, 15, 20, 30]).map((k) => (
              <option key={k} value={k}>
                {k} {isVol ? '卷' : '章'}
              </option>
            ))}
          </Select>
          <Input value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="额外要求（可选），如：前三章要快速进入主线" className="flex-1" />
          <Button variant="primary" icon={<Sparkles className="size-4" />} loading={task.running} onClick={run}>
            {items ? '重新生成' : '开始规划'}
          </Button>
        </div>
        {!isVol && !volume?.summary.trim() && <p className="text-xs text-amber-600">提示：本卷还没有卷纲，先写卷纲能让规划更贴合你的设想。</p>}
        {!items && <AiResultView task={task} prose={false} showFlavor={false} />}
        {items && (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className={cx('flex gap-3 rounded-lg border border-line p-3', !it.checked && 'opacity-50')}>
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                  className="mt-1.5"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input value={it.title} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="h-7 font-medium" />
                  <Textarea
                    value={it.body}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                    minRows={2}
                    className="text-[13px]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
