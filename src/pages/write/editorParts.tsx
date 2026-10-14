import { FileClock, Save, Trash, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { countWords } from '../../../shared/text';
import type { Snapshot } from '../../../shared/types';
import { api } from '../../api';
import { Button, confirmAsk, cx, Empty, IconButton, Input, Modal, Spinner } from '../../components/ui';
import { toast, toastError } from '../../store';

export interface EditorHandle {
  textarea: () => HTMLTextAreaElement | null;
  getText: () => string;
  getSelection: () => { start: number; end: number; text: string };
  /** 通过浏览器的编辑命令写入，保留 Ctrl+Z 撤销 */
  replaceRange: (start: number, end: number, text: string, select?: boolean) => void;
  select: (start: number, end: number) => void;
}

const MIRROR_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'whiteSpace',
  'overflowWrap', 'wordBreak', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent', 'tabSize',
] as const;

export function caretTop(ta: HTMLTextAreaElement, pos: number): number {
  const div = document.createElement('div');
  const cs = getComputedStyle(ta);
  for (const p of MIRROR_PROPS) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: ta.clientWidth + 'px' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = '\u200b';
  div.appendChild(span);
  document.body.appendChild(div);
  const top = span.offsetTop;
  div.remove();
  return top;
}

export function scrollToPos(ta: HTMLTextAreaElement, scroller: HTMLElement, pos: number) {
  const offset = ta.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, offset + caretTop(ta, pos) - scroller.clientHeight / 3), behavior: 'smooth' });
}

export function execReplace(ta: HTMLTextAreaElement, start: number, end: number, text: string, fallback: (v: string) => void) {
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(start, end);
  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch {
    ok = false;
  }
  if (!ok || ta.value.slice(start, start + text.length) !== text) {
    const v = ta.value;
    fallback(v.slice(0, start) + text + v.slice(end));
    requestAnimationFrame(() => ta.setSelectionRange(start + text.length, start + text.length));
  }
}

// ---------------- 查找替换 ----------------

export function FindBar({ editor, content, onClose }: { editor: EditorHandle; content: string; onClose: () => void }) {
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [idx, setIdx] = useState(0);
  const matches: number[] = [];
  if (find) {
    let i = content.indexOf(find);
    while (i !== -1 && matches.length < 5000) {
      matches.push(i);
      i = content.indexOf(find, i + find.length);
    }
  }
  const goto = (n: number) => {
    if (!matches.length) return;
    const k = ((n % matches.length) + matches.length) % matches.length;
    setIdx(k);
    editor.select(matches[k], matches[k] + find.length);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5">
      <Input
        autoFocus
        value={find}
        onChange={(e) => {
          setFind(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') goto(e.shiftKey ? idx - 1 : idx + (matches.length && editor.getSelection().text === find ? 1 : 0));
          if (e.key === 'Escape') onClose();
        }}
        placeholder="查找"
        className="h-7 w-40 text-xs"
      />
      <span className="w-14 text-center text-[11px] text-muted">{find ? `${matches.length ? idx + 1 : 0}/${matches.length}` : ''}</span>
      <Button size="sm" variant="ghost" onClick={() => goto(idx - 1)} disabled={!matches.length}>
        上一个
      </Button>
      <Button size="sm" variant="ghost" onClick={() => goto(idx + 1)} disabled={!matches.length}>
        下一个
      </Button>
      <Input value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="替换为" className="ml-2 h-7 w-36 text-xs" />
      <Button
        size="sm"
        variant="ghost"
        disabled={!matches.length}
        onClick={() => {
          const sel = editor.getSelection();
          if (sel.text === find) editor.replaceRange(sel.start, sel.end, repl);
          else goto(idx);
        }}
      >
        替换
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!matches.length}
        onClick={() => {
          const n = matches.length;
          editor.replaceRange(0, content.length, content.split(find).join(repl));
          toast(`已替换 ${n} 处`, 'ok');
        }}
      >
        全部替换
      </Button>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onClose}>
        关闭
      </Button>
    </div>
  );
}

// ---------------- 历史版本 ----------------

export function SnapshotsModal({
  chapterId,
  content,
  onClose,
  onRestore,
}: {
  chapterId: string;
  content: string;
  onClose: () => void;
  onRestore: (text: string) => void;
}) {
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [active, setActive] = useState<Snapshot | null>(null);
  const [note, setNote] = useState('');

  const load = () => api.get<Snapshot[]>(`/chapters/${chapterId}/snapshots`).then(setList).catch(toastError);
  useEffect(() => {
    load();
  }, [chapterId]);

  const open = async (s: Snapshot) => {
    setActive(s);
    if (s.content === undefined) {
      const full = await api.get<Snapshot>(`/snapshots/${s.id}`).catch(toastError);
      if (full) setActive(full);
    }
  };

  const saveNow = async () => {
    await api.post(`/chapters/${chapterId}/snapshots`, { note: note.trim() || '手动保存', content }).catch(toastError);
    setNote('');
    toast('已保存版本', 'ok');
    load();
  };

  return (
    <Modal open onClose={onClose} title="历史版本" width={900}>
      <div className="mb-3 flex gap-2">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="版本备注（可选），如：改写前" className="flex-1" />
        <Button icon={<Save className="size-4" />} onClick={saveNow}>
          保存当前版本（{countWords(content)} 字）
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted">编辑时每 20 分钟自动留存一个版本（保留最近 30 个），AI 整章改写前也会自动保存。</p>
      <div className="flex h-[52vh] gap-3">
        <div className="w-60 shrink-0 overflow-y-auto rounded-md border border-line">
          {list === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <Empty icon={<FileClock className="size-6" />} title="暂无历史版本" />
          ) : (
            list.map((s) => (
              <div
                key={s.id}
                onClick={() => open(s)}
                className={cx('group flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-xs', active?.id === s.id ? 'bg-accent-soft' : 'hover:bg-hover')}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.note}</div>
                  <div className="text-muted">
                    {new Date(s.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {s.wordCount} 字
                  </div>
                </div>
                <IconButton
                  title="删除"
                  className="hidden size-6 group-hover:inline-flex"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await api.del(`/snapshots/${s.id}`).catch(toastError);
                    if (active?.id === s.id) setActive(null);
                    load();
                  }}
                >
                  <Trash className="size-3" />
                </IconButton>
              </div>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col rounded-md border border-line">
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-line px-3 py-2">
                <span className="flex-1 text-xs text-muted">预览：{active.note}</span>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<RotateCcw className="size-3.5" />}
                  disabled={active.content === undefined}
                  onClick={async () => {
                    if (!confirmAsk('用这个版本替换当前正文？当前内容会先自动保存为一个版本。')) return;
                    await api.post(`/chapters/${chapterId}/snapshots`, { note: '恢复前自动保存', content }).catch(toastError);
                    onRestore(active.content ?? '');
                    onClose();
                  }}
                >
                  恢复此版本
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-serif text-sm leading-loose whitespace-pre-wrap">
                {active.content ?? <Spinner />}
              </div>
            </>
          ) : (
            <Empty title="选择左侧的版本进行预览" />
          )}
        </div>
      </div>
    </Modal>
  );
}
