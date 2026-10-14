import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { FLAVOR_CATEGORIES, type FlavorCategory, type FlavorHit, type FlavorReport } from '../../shared/antiAi';
import { scoreTone } from './ai';
import { cx } from './ui';

export const CATEGORY_COLORS: Record<FlavorCategory, string> = {
  expression: 'text-rose-500 bg-rose-500/15',
  abstract: 'text-violet-500 bg-violet-500/15',
  sublimation: 'text-red-600 bg-red-600/15',
  purple: 'text-amber-600 bg-amber-500/20',
  connector: 'text-sky-600 bg-sky-500/15',
  adverb: 'text-teal-600 bg-teal-500/15',
  telling: 'text-fuchsia-600 bg-fuchsia-500/15',
  greasy: 'text-pink-600 bg-pink-500/15',
  pattern: 'text-orange-600 bg-orange-500/18',
  custom: 'text-lime-700 bg-lime-500/20',
};

const CATEGORY_DOTS: Record<FlavorCategory, string> = {
  expression: 'bg-rose-500',
  abstract: 'bg-violet-500',
  sublimation: 'bg-red-600',
  purple: 'bg-amber-500',
  connector: 'bg-sky-500',
  adverb: 'bg-teal-500',
  telling: 'bg-fuchsia-500',
  greasy: 'bg-pink-500',
  pattern: 'bg-orange-500',
  custom: 'bg-lime-500',
};

export function FlavorReportView({ report, onLocate }: { report: FlavorReport; onLocate?: (hit: FlavorHit) => void }) {
  const [openCat, setOpenCat] = useState<FlavorCategory | null>(null);
  const grouped = useMemo(() => {
    const m = new Map<FlavorCategory, Map<string, FlavorHit[]>>();
    for (const h of report.hits) {
      if (!m.has(h.cat)) m.set(h.cat, new Map());
      const g = m.get(h.cat)!;
      g.set(h.text, [...(g.get(h.text) ?? []), h]);
    }
    return [...m.entries()].sort((a, b) => countOf(b[1]) - countOf(a[1]));
  }, [report]);

  const s = report.stats;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={cx('flex size-16 shrink-0 flex-col items-center justify-center rounded-full', scoreTone(report.score))}>
          <div className="text-xl leading-none font-bold">{report.score}</div>
          <div className="mt-0.5 text-[10px]">{report.levelLabel}</div>
        </div>
        <div className="text-xs leading-relaxed text-muted">
          AI 味指数（0~100，越低越像人写的）。综合套话密度、句长变化、段尾升华、比喻密度等计算。
          <div className="mt-1 text-ink/70">
            {report.chars} 字 · {report.hits.length} 处可疑
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-center text-[11px]">
        <Stat label="平均句长" value={s.avgSentenceLen} />
        <Stat label="句长变化" value={s.sentenceCv} warn={s.sentences >= 8 && s.sentenceCv < 0.45} hint="低于 0.45 说明句子太整齐" />
        <Stat label="段尾升华" value={s.sublimatedEndings} warn={s.sublimatedEndings >= 2} />
        <Stat label="比喻/千字" value={s.similesPer1k} warn={s.similesPer1k > 6} />
        <Stat label="破折号/千字" value={s.dashesPer1k} warn={s.dashesPer1k > 5} />
        <Stat label="段落变化" value={s.paragraphCv} warn={s.paragraphs >= 5 && s.paragraphCv < 0.35} />
      </div>

      {report.notes.length > 0 && (
        <ul className="space-y-1 rounded-md bg-hover/60 p-2.5 text-xs leading-relaxed">
          {report.notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <Info className="mt-0.5 size-3 shrink-0 text-accent" />
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        {grouped.map(([cat, phrases]) => {
          const meta = FLAVOR_CATEGORIES[cat];
          const open = openCat === cat;
          return (
            <div key={cat} className="rounded-md border border-line">
              <button type="button" onClick={() => setOpenCat(open ? null : cat)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
                <span className={cx('size-2 rounded-full', CATEGORY_DOTS[cat])} />
                <span className="flex-1 font-medium">{meta.label}</span>
                <span className="text-muted">{countOf(phrases)} 处</span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-line px-2.5 py-2">
                  <p className="text-[11px] leading-relaxed text-muted">{meta.tip}</p>
                  <div className="flex flex-wrap gap-1">
                    {[...phrases.entries()].map(([text, hits]) => (
                      <button
                        key={text}
                        type="button"
                        title={onLocate ? '点击定位（再次点击跳到下一处）' : undefined}
                        onClick={() => onLocate && locateNext(hits, onLocate)}
                        className={cx('rounded px-1.5 py-0.5 text-xs', CATEGORY_COLORS[cat], onLocate && 'hover:ring-1 hover:ring-current')}
                      >
                        {text}
                        {hits.length > 1 && <span className="ml-0.5 opacity-70">×{hits.length}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && report.chars > 30 && <div className="py-2 text-center text-xs text-ok">没有发现常见的 AI 套话 👍</div>}
      </div>
    </div>
  );
}

const cursor = new WeakMap<FlavorHit[], number>();
function locateNext(hits: FlavorHit[], onLocate: (h: FlavorHit) => void) {
  const i = cursor.get(hits) ?? 0;
  onLocate(hits[i % hits.length]);
  cursor.set(hits, i + 1);
}

function countOf(m: Map<string, FlavorHit[]>) {
  let n = 0;
  for (const v of m.values()) n += v.length;
  return n;
}

function Stat({ label, value, warn, hint }: { label: string; value: number; warn?: boolean; hint?: string }) {
  return (
    <div title={hint} className={cx('rounded-md border px-1 py-1.5', warn ? 'border-orange-400/50 bg-orange-500/8' : 'border-line')}>
      <div className={cx('text-sm font-semibold', warn && 'text-orange-600 dark:text-orange-400')}>{value}</div>
      <div className="text-muted">{label}</div>
    </div>
  );
}
