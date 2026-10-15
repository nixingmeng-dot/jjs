import { Brain, ChevronDown, ChevronRight, ChevronsUpDown, CircleStop, Copy, RotateCcw, Settings, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { analyzeAiFlavor, parseWordList } from '../../shared/antiAi';
import { countWords } from '../../shared/text';
import type { AiTaskHandle } from '../hooks/useAiTask';
import { toast, useApp, useBook } from '../store';
import { Button, cx, IconButton, Spinner } from './ui';

export function ModelPicker({ className }: { className?: string }) {
  const { settings, providers, updateSettings } = useApp();
  const enabled = providers.filter((p) => p.enabled && p.models.length);
  if (!settings) return null;
  if (!enabled.length) {
    return (
      <Link to="/settings" className={cx('inline-flex items-center gap-1 text-xs text-ai hover:underline', className)}>
        <Settings className="size-3.5" /> 配置模型 API
      </Link>
    );
  }
  const value = `${settings.defaultProviderId}::${settings.defaultModel}`;
  const provider = enabled.find((p) => p.id === settings.defaultProviderId);
  const known = !!provider && provider.models.includes(settings.defaultModel);
  // 原生下拉负责交互，上面叠一层可读的「服务商 · 模型」标签
  return (
    <label
      title="选择模型"
      className={cx('relative inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs text-ink/80 transition hover:bg-hover', className)}
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', known ? 'bg-ok' : 'bg-muted/50')} />
      <span className="min-w-0 truncate">{known ? `${provider.name} · ${settings.defaultModel}` : '选择模型…'}</span>
      <ChevronsUpDown className="size-3 shrink-0 text-muted" />
      <select
        value={known ? value : ''}
        onChange={(e) => {
          const [defaultProviderId, defaultModel] = e.target.value.split('::');
          updateSettings({ defaultProviderId, defaultModel });
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {!known && <option value="">选择模型…</option>}
        {enabled.map((p) => (
          <optgroup key={p.id} label={p.name}>
            {p.models.map((m) => (
              <option key={m} value={`${p.id}::${m}`}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function useBannedWords() {
  const extra = useApp((s) => s.settings?.extraBannedWords);
  const bookBanned = useBook((s) => s.tree?.book.bannedWords);
  return useMemo(() => [...parseWordList(extra), ...parseWordList(bookBanned)], [extra, bookBanned]);
}

export function FlavorBadge({ text, className }: { text: string; className?: string }) {
  const banned = useBannedWords();
  const report = useMemo(() => (text.length > 30 ? analyzeAiFlavor(text, { extraBanned: banned }) : null), [text, banned]);
  if (!report) return null;
  return (
    <span
      title={`AI 味 ${report.score} 分（越低越好）`}
      className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium', scoreTone(report.score), className)}
    >
      AI味 {report.score} · {report.levelLabel}
    </span>
  );
}

export function scoreTone(score: number) {
  if (score < 20) return 'bg-ok/12 text-ok';
  if (score < 40) return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  if (score < 60) return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
  return 'bg-danger/12 text-danger';
}

/** 流式结果展示：思考过程、正文、AI 味评分与操作按钮 */
export function AiResultView({
  task,
  actions,
  placeholder,
  showFlavor = true,
  className,
  prose = true,
}: {
  task: AiTaskHandle;
  actions?: ReactNode;
  placeholder?: ReactNode;
  showFlavor?: boolean;
  className?: string;
  prose?: boolean;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  if (task.status === 'idle') return placeholder ? <>{placeholder}</> : null;
  return (
    <div className={cx('rounded-xl border border-line bg-paper shadow-sm', className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        {task.running ? <Spinner className="size-3.5" /> : null}
        <span className="min-w-0 flex-1 truncate">{task.model || '连接中…'}</span>
        {task.text && <span>{countWords(task.text)} 字</span>}
        {showFlavor && task.status === 'done' && task.text && <FlavorBadge text={task.text} />}
        {task.running ? (
          <IconButton title="停止" onClick={task.stop} className="size-6">
            <CircleStop className="size-3.5" />
          </IconButton>
        ) : (
          <>
            <IconButton
              title="复制"
              className="size-6"
              onClick={() => {
                navigator.clipboard.writeText(task.text).then(() => toast('已复制', 'ok'));
              }}
              disabled={!task.text}
            >
              <Copy className="size-3.5" />
            </IconButton>
            <IconButton title="重新生成" className="size-6" onClick={() => task.retry()} disabled={!task.request}>
              <RotateCcw className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>
      {task.reasoning && (
        <div className="border-b border-line px-3 py-1.5">
          <button type="button" onClick={() => setShowReasoning((v) => !v)} className="flex items-center gap-1 text-[11px] text-muted hover:text-ink">
            {showReasoning ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <Brain className="size-3" /> 思考过程（{task.reasoning.length} 字）
          </button>
          {showReasoning && (
            <div className="mt-1 max-h-48 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted">{task.reasoning}</div>
          )}
        </div>
      )}
      {task.status === 'error' ? (
        <div className="flex gap-2 px-3 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 break-words">
            {task.error}
            {/模型服务|API|Key|模型/.test(task.error) && (
              <Link to="/settings" className="ml-1 text-ai underline">
                去设置
              </Link>
            )}
          </div>
        </div>
      ) : (
        <textarea
          value={task.text}
          onChange={(e) => task.setText(e.target.value)}
          readOnly={task.running}
          placeholder={task.running ? '正在生成…' : ''}
          className={cx(
            'block max-h-[46vh] min-h-24 w-full resize-y overflow-y-auto bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none',
            prose && 'font-editor',
          )}
          rows={Math.min(18, Math.max(4, Math.ceil(task.text.length / 26)))}
        />
      )}
      {actions && !task.running && task.status !== 'error' && task.text && (
        <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">{actions}</div>
      )}
    </div>
  );
}

export function AiButton({ onClick, running, children, icon, title, disabled }: { onClick: () => void; running?: boolean; children: ReactNode; icon?: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick} loading={running} icon={icon} title={title} disabled={disabled}>
      {children}
    </Button>
  );
}
