import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { chapterLabels } from '../../shared/text';
import type { ChapterMeta, MemoryFact } from '../../shared/types';
import { useBook } from '../store';
import { IconButton } from './ui';

/** 人物 / 设定的「经历与变化」：自动记忆整理进来，也可以手动加减 */
export function FactsField({ facts, onChange }: { facts: MemoryFact[]; onChange: (facts: MemoryFact[]) => void }) {
  const tree = useBook((s) => s.tree)!;
  const [text, setText] = useState('');
  const { labels, order } = useMemo(() => {
    const ordered: ChapterMeta[] = [];
    for (const v of tree.volumes) ordered.push(...tree.chapters.filter((c) => c.volumeId === v.id));
    return { labels: chapterLabels(ordered), order: new Map(ordered.map((c, i) => [c.id, i])) };
  }, [tree.volumes, tree.chapters]);
  // 按章节顺序显示，手动添加的排在最后
  const sorted = [...facts].sort((a, b) => (order.get(a.chapterId) ?? Infinity) - (order.get(b.chapterId) ?? Infinity));

  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...facts, { chapterId: '', text: t }]);
    setText('');
  };

  return (
    <div>
      {/* 不用 Field：它是 <label>，点删除按钮会聚焦到输入框 */}
      <div className="mb-1 flex items-baseline gap-2 text-xs font-medium text-muted">
        <span>经历与变化</span>
        <span className="font-normal text-muted/80">自动记忆从章节里整理，写后面的章节时会带给 AI；记错的可以删掉</span>
      </div>
      <div className="rounded-md border border-line bg-paper">
        {!facts.length && <div className="px-3 py-2 text-xs text-muted">还没有。写完一章后会自动整理到这里，也可以在下面手动添加。</div>}
        {sorted.map((f, i) => (
          <div key={`${f.chapterId}-${i}`} className="group flex items-start gap-2 border-b border-line px-3 py-1.5 text-[13px]">
            <span className="w-14 shrink-0 pt-px text-[12px] text-muted">
              {f.chapterId ? (labels.get(f.chapterId)?.split(' ')[0] ?? '已删章节') : '手动'}
            </span>
            <span className="min-w-0 flex-1 leading-relaxed">{f.text}</span>
            <IconButton title="删除这条" className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onChange(facts.filter((x) => x !== f))}>
              <X className="size-3.5" />
            </IconButton>
          </div>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          onBlur={add}
          placeholder="手动添加一条，回车保存"
          className="w-full rounded-b-md bg-transparent px-3 py-1.5 text-[13px] outline-none placeholder:text-muted/60"
        />
      </div>
    </div>
  );
}
