import { Pin, PinOff, Plus, Search, Sparkles, Trash, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { extractJson } from '../../shared/text';
import type { Character } from '../../shared/types';
import { AiResultView, ModelPicker } from '../components/ai';
import { Badge, Button, confirmAsk, cx, Empty, Field, IconButton, Input, Modal, Textarea } from '../components/ui';
import { useAiTask } from '../hooks/useAiTask';
import { toast, toastError, useBook } from '../store';
import { PageHeader } from './BookLayout';

const ROLES = ['主角', '女主', '男主', '配角', '反派', '导师', '路人'];

const FIELDS: { key: keyof Character; label: string; hint?: string; rows?: number }[] = [
  { key: 'appearance', label: '外貌', hint: '抓一两个记忆点，比堆砌五官更有效' },
  { key: 'personality', label: '性格', hint: '写出矛盾面和缺点' },
  { key: 'speech', label: '说话方式', hint: '语气、口头禅、用词习惯，附一句示例台词——AI 写对白时会照这个来' },
  { key: 'motivation', label: '动机与恐惧' },
  { key: 'background', label: '背景经历', rows: 3 },
  { key: 'arc', label: '人物弧光', hint: '起点 → 转变 → 终点' },
  { key: 'relations', label: '人物关系' },
  { key: 'notes', label: '备注' },
];

type Draft = Partial<Record<keyof Character, string>>;

export default function CharactersPage() {
  const tree = useBook((s) => s.tree)!;
  const { itemId } = useParams();
  const navigate = useNavigate();
  const { create, update, remove } = useBook.getState();
  const [q, setQ] = useState('');
  const [creatingAi, setCreatingAi] = useState(false);
  const [completion, setCompletion] = useState<Draft | null>(null);
  const task = useAiTask();

  const list = tree.characters;
  const current = list.find((c) => c.id === itemId);
  const base = `/book/${tree.book.id}/characters`;

  useEffect(() => {
    if (!current && list.length) navigate(`${base}/${list[0].id}`, { replace: true });
  }, [current, list, base, navigate]);

  const groups = useMemo(() => {
    const filtered = list.filter((c) => !q || c.name.includes(q) || c.aliases.includes(q));
    const order = (r: string) => {
      const i = ROLES.indexOf(r);
      return i === -1 ? 99 : i;
    };
    return [...filtered].sort((a, b) => order(a.role) - order(b.role) || a.sort - b.sort);
  }, [list, q]);

  const add = async () => {
    const c = await create<Character>('characters', { name: '新人物', role: '配角' }).catch(toastError);
    if (c) navigate(`${base}/${c.id}`);
  };

  const complete = async () => {
    if (!current) return;
    setCompletion(null);
    const text = await task.run({ task: 'character', bookId: tree.book.id, characterId: current.id });
    if (text === null) return;
    const data = extractJson<Draft>(text);
    if (!data || typeof data !== 'object') return toast('没能解析出人物资料，请重试', 'error');
    setCompletion(data);
    task.reset();
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="人物" desc="AI 写作时会自动带上正文中出现的人物资料；标记为「常驻」的人物每次都会提供给 AI。">
        <ModelPicker className="w-56" />
      </PageHeader>
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 gap-5 px-6 py-5">
        <aside className="flex w-60 shrink-0 flex-col rounded-xl border border-line bg-panel">
          <div className="space-y-2 border-b border-line p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2 size-3.5 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索人物" className="h-8 pl-7 text-xs" />
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" className="flex-1" icon={<Plus className="size-3.5" />} onClick={add}>
                新建
              </Button>
              <Button size="sm" className="flex-1" icon={<Sparkles className="size-3.5" />} onClick={() => setCreatingAi(true)}>
                AI 创建
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {groups.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`${base}/${c.id}`)}
                className={cx('flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm', c.id === itemId ? 'bg-accent-soft text-accent' : 'hover:bg-hover')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-hover font-serif text-xs">{c.name.slice(0, 1)}</span>
                <span className="min-w-0 flex-1 truncate">{c.name || '未命名'}</span>
                {c.pinned ? <Pin className="size-3 text-accent" /> : null}
                <Badge>{c.role}</Badge>
              </button>
            ))}
            {list.length === 0 && <Empty icon={<Users className="size-7" />} title="还没有人物" />}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto pb-10">
          {current ? (
            <div className="space-y-4 rounded-xl border border-line bg-panel p-5">
              <div className="flex items-center gap-2">
                <input
                  value={current.name}
                  onChange={(e) => update('characters', current.id, { name: e.target.value })}
                  className="min-w-0 flex-1 bg-transparent font-serif text-xl font-semibold outline-none"
                  placeholder="姓名"
                />
                <Button
                  size="sm"
                  variant={current.pinned ? 'primary' : 'secondary'}
                  icon={current.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                  title="常驻：无论正文是否提到，都提供给 AI"
                  onClick={() => update('characters', current.id, { pinned: current.pinned ? 0 : 1 }, true)}
                >
                  {current.pinned ? '常驻' : '按需'}
                </Button>
                <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={task.running} onClick={complete} title="根据总纲和已有人物补全、丰富这个人物">
                  AI 完善
                </Button>
                <IconButton
                  title="删除人物"
                  className="hover:text-danger"
                  onClick={() => confirmAsk(`删除人物「${current.name}」？`) && remove('characters', current.id).catch(toastError)}
                >
                  <Trash className="size-4" />
                </IconButton>
              </div>
              {task.status === 'error' || task.running ? <AiResultView task={task} prose={false} showFlavor={false} /> : null}
              <div className="grid grid-cols-4 gap-3">
                <Field label="定位">
                  <Input list="roles" value={current.role} onChange={(e) => update('characters', current.id, { role: e.target.value })} />
                  <datalist id="roles">
                    {ROLES.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </Field>
                <Field label="性别">
                  <Input value={current.gender} onChange={(e) => update('characters', current.id, { gender: e.target.value })} />
                </Field>
                <Field label="年龄">
                  <Input value={current.age} onChange={(e) => update('characters', current.id, { age: e.target.value })} />
                </Field>
                <Field label="别名 / 称号" hint="逗号分隔">
                  <Input value={current.aliases} onChange={(e) => update('characters', current.id, { aliases: e.target.value })} />
                </Field>
              </div>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <Textarea
                    value={String(current[f.key] ?? '')}
                    onChange={(e) => update('characters', current.id, { [f.key]: e.target.value })}
                    minRows={f.rows ?? 2}
                  />
                </Field>
              ))}
            </div>
          ) : (
            <Empty icon={<Users className="size-8" />} title="新建一个人物">
              好的人物设定是 AI 写出“不 AI”文字的关键——尤其是「说话方式」。
            </Empty>
          )}
        </main>
      </div>

      {completion && current && (
        <CompletionModal
          current={current}
          data={completion}
          onClose={() => setCompletion(null)}
          onApply={(patch) => {
            update('characters', current.id, patch, true);
            setCompletion(null);
            toast('已更新人物资料', 'ok');
          }}
        />
      )}
      {creatingAi && (
        <CreateWithAi
          onClose={() => setCreatingAi(false)}
          onCreated={(id) => {
            setCreatingAi(false);
            navigate(`${base}/${id}`);
          }}
        />
      )}
    </div>
  );
}

const ALL_KEYS: (keyof Character)[] = ['name', 'aliases', 'role', 'gender', 'age', 'appearance', 'personality', 'speech', 'motivation', 'background', 'arc', 'relations'];
const LABELS: Partial<Record<keyof Character, string>> = {
  name: '姓名',
  aliases: '别名',
  role: '定位',
  gender: '性别',
  age: '年龄',
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.label])),
};

function CompletionModal({ current, data, onClose, onApply }: { current: Character; data: Draft; onClose: () => void; onApply: (patch: Draft) => void }) {
  const changed = ALL_KEYS.filter((k) => typeof data[k] === 'string' && data[k]!.trim() && data[k]!.trim() !== String(current[k] ?? '').trim());
  const [picked, setPicked] = useState<Set<string>>(() => new Set(changed.filter((k) => !String(current[k] ?? '').trim() || k !== 'name')));
  return (
    <Modal
      open
      onClose={onClose}
      width={760}
      title="AI 完善建议"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!picked.size} onClick={() => onApply(Object.fromEntries([...picked].map((k) => [k, data[k as keyof Character]])))}>
            应用选中的 {picked.size} 项
          </Button>
        </>
      }
    >
      {changed.length === 0 ? (
        <Empty title="AI 没有提出新的修改" />
      ) : (
        <div className="space-y-2">
          {changed.map((k) => (
            <label key={k} className={cx('flex gap-3 rounded-lg border border-line p-3', !picked.has(k) && 'opacity-55')}>
              <input
                type="checkbox"
                checked={picked.has(k)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(k);
                  else next.delete(k);
                  setPicked(next);
                }}
                className="mt-1"
              />
              <div className="min-w-0 flex-1 text-sm">
                <div className="mb-1 text-xs font-medium text-muted">{LABELS[k]}</div>
                {String(current[k] ?? '').trim() && <div className="mb-1 text-xs text-muted line-through">{String(current[k])}</div>}
                <div className="leading-relaxed whitespace-pre-wrap">{data[k]}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

function CreateWithAi({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const tree = useBook((s) => s.tree)!;
  const task = useAiTask();
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!desc.trim()) return toast('请描述你想要的人物', 'error');
    const text = await task.run({ task: 'character', bookId: tree.book.id, instruction: desc.trim() });
    if (text === null) return;
    const data = extractJson<Draft>(text);
    if (!data?.name) return toast('没能解析出人物资料，请重试', 'error');
    setBusy(true);
    try {
      const c = await useBook.getState().create<Character>('characters', data);
      toast(`已创建「${c.name}」`, 'ok');
      onCreated(c.id);
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
      title="AI 创建人物"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" icon={<Sparkles className="size-4" />} loading={task.running || busy} onClick={run}>
            生成
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="人物描述" hint="越具体越好">
          <Textarea
            autoFocus
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            minRows={4}
            placeholder="例如：主角的师兄，表面玩世不恭，实际是宗门安插的眼线；对主角有真感情，最终会为此背叛宗门。"
          />
        </Field>
        <AiResultView task={task} prose={false} showFlavor={false} />
      </div>
    </Modal>
  );
}
