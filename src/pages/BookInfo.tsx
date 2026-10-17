import { Download, Trash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { analyzeAiFlavor } from '../../shared/antiAi';
import { formatWords } from '../../shared/text';
import type { BookStats } from '../../shared/types';
import { api, downloadUrl } from '../api';
import { scoreTone, useBannedWords } from '../components/ai';
import { Button, confirmAsk, cx, Field, Input, Textarea } from '../components/ui';
import { toastError, useBook } from '../store';
import { PageHeader } from './BookLayout';

const POVS = ['第三人称有限视角', '第三人称全知视角', '第一人称', '第三人称多视角轮换', '第二人称'];

export default function BookInfoPage() {
  const book = useBook((s) => s.tree!.book);
  const { updateBook } = useBook.getState();
  const navigate = useNavigate();
  const [stats, setStats] = useState<BookStats | null>(null);
  const banned = useBannedWords();

  useEffect(() => {
    useBook
      .getState()
      .flush()
      .then(() => api.get<BookStats>(`/books/${book.id}/stats`))
      .then(setStats)
      .catch(toastError);
  }, [book.id]);

  const sampleReport = useMemo(() => (book.styleSample.length > 60 ? analyzeAiFlavor(book.styleSample, { extraBanned: banned }) : null), [book.styleSample, banned]);
  const max = Math.max(1, ...(stats?.days.map((d) => d.words) ?? [1]));
  const progress = book.targetWords > 0 && stats ? Math.min(100, (stats.totalWords / book.targetWords) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="作品信息" />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <section className="grid gap-4 rounded-xl border border-line bg-panel p-5 sm:grid-cols-2">
          <Field label="书名">
            <Input value={book.title} onChange={(e) => updateBook({ title: e.target.value })} />
          </Field>
          <Field label="笔名">
            <Input value={book.author} onChange={(e) => updateBook({ author: e.target.value })} />
          </Field>
          <Field label="类型">
            <Input value={book.genre} onChange={(e) => updateBook({ genre: e.target.value })} />
          </Field>
          <Field label="标签" hint="逗号分隔，如：重生、群像、慢热">
            <Input value={book.tags} onChange={(e) => updateBook({ tags: e.target.value })} />
          </Field>
          <Field label="简介" className="sm:col-span-2">
            <Textarea value={book.synopsis} onChange={(e) => updateBook({ synopsis: e.target.value })} minRows={3} />
          </Field>
        </section>

        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <div>
            <h2 className="text-sm font-semibold">文风</h2>
            <p className="mt-0.5 text-xs text-muted">这是让 AI 写得像你、而不是像 AI 的最有效的地方。每次生成正文都会带上这些设置。</p>
          </div>
          <Field label="叙事视角">
            <Input list="povs" value={book.pov} onChange={(e) => updateBook({ pov: e.target.value })} placeholder="如：第三人称有限视角，紧跟主角" />
            <datalist id="povs">
              {POVS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="文风要求" hint="具体描述，而不是“优美流畅”">
            <Textarea
              value={book.styleGuide}
              onChange={(e) => updateBook({ styleGuide: e.target.value })}
              minRows={3}
              placeholder="例如：冷峻克制，短句为主，少用形容词；对白带北方口语；动作戏用短段落；不写心理独白，用动作暗示情绪。"
            />
          </Field>
          <Field
            label="文风样本"
            hint={
              <>
                贴一段你自己写的、最满意的文字（300~1500 字），AI 会模仿它的节奏和用词。
                {sampleReport && <span className={cx('ml-2 rounded px-1.5 py-0.5', scoreTone(sampleReport.score))}>样本 AI 味 {sampleReport.score}</span>}
              </>
            }
          >
            <Textarea value={book.styleSample} onChange={(e) => updateBook({ styleSample: e.target.value })} minRows={6} className="font-serif leading-loose" />
          </Field>
          <Field label="本书禁用词" hint="逗号或换行分隔；会写进提示词，并在去 AI 味检测中标出">
            <Textarea value={book.bannedWords} onChange={(e) => updateBook({ bannedWords: e.target.value })} minRows={2} placeholder="例如：修仙界，天骄，恐怖如斯" />
          </Field>
        </section>

        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">目标与统计</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="目标总字数">
              <Input type="number" min={0} step={10000} value={book.targetWords || ''} onChange={(e) => updateBook({ targetWords: Number(e.target.value) || 0 })} placeholder="如：1000000" />
            </Field>
            <Field label="每日目标字数">
              <Input type="number" min={0} step={500} value={book.dailyGoal || ''} onChange={(e) => updateBook({ dailyGoal: Number(e.target.value) || 0 })} placeholder="如：4000" />
            </Field>
          </div>
          {stats && (
            <>
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <div className="text-2xl font-semibold">{formatWords(stats.totalWords)}</div>
                  <div className="text-xs text-muted">总字数{book.targetWords > 0 && ` · 完成 ${progress.toFixed(1)}%`}</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.chapterCount}</div>
                  <div className="text-xs text-muted">章节</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{stats.today.toLocaleString()}</div>
                  <div className="text-xs text-muted">今日新增{book.dailyGoal > 0 && ` / ${book.dailyGoal}`}</div>
                </div>
              </div>
              {book.targetWords > 0 && (
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
                </div>
              )}
              <div>
                <div className="mb-1 text-xs text-muted">最近 30 天新增字数</div>
                {stats.days.length ? (
                  <div className="flex h-28 items-end gap-1 border-b border-line">
                    {stats.days.map((d) => (
                      <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}：${d.words} 字`}>
                        <div className={cx('w-full rounded-t', book.dailyGoal && d.words >= book.dailyGoal ? 'bg-ok' : 'bg-accent/70')} style={{ height: `${(d.words / max) * 100}%` }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-4 text-xs text-muted">开始写作后这里会显示每天的字数。</div>
                )}
              </div>
            </>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-sm font-semibold">导出与备份</h2>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Download className="size-4" />} onClick={() => useBook.getState().flush().then(() => downloadUrl(`/api/books/${book.id}/export?format=txt`))}>
              导出 TXT
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => useBook.getState().flush().then(() => downloadUrl(`/api/books/${book.id}/export?format=md`))}>
              导出 Markdown
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => useBook.getState().flush().then(() => downloadUrl(`/api/books/${book.id}/export?format=json`))}>
              完整备份（含大纲、人物、设定）
            </Button>
          </div>
          <p className="text-xs text-muted">TXT 适合直接上传到网文平台；完整备份可以在首页「导入」恢复。</p>
        </section>

        <section className="flex items-center gap-3 rounded-xl border border-danger/30 bg-panel p-5">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-danger">删除作品</h2>
            <p className="text-xs text-muted">删除后无法恢复，建议先导出完整备份。</p>
          </div>
          <Button
            variant="danger"
            icon={<Trash className="size-4" />}
            onClick={async () => {
              if (!confirmAsk(`确定删除《${book.title}》？此操作不可恢复。`)) return;
              await api.del(`/books/${book.id}`).catch(toastError);
              useBook.setState({ tree: null });
              navigate('/');
            }}
          >
            删除
          </Button>
        </section>
      </main>
    </div>
  );
}
