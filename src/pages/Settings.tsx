import { ChevronLeft, CircleCheck, ExternalLink, KeyRound, Plus, RefreshCw, Trash, TriangleAlert, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PROMPT_BANNED_PHRASES } from '../../shared/antiAi';
import { PROVIDER_KIND_LABEL, PROVIDER_PRESETS } from '../../shared/providers';
import type { AntiAiLevel, AppSettings, Provider, ProviderKind } from '../../shared/types';
import { api } from '../api';
import { Badge, Button, confirmAsk, cx, Empty, Field, Input, Modal, Segmented, Select, Textarea } from '../components/ui';
import { toast, toastError, useApp } from '../store';

export default function SettingsPage() {
  const { settings, updateSettings } = useApp();
  if (!settings) return null;
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-6 py-3">
          <Link to="/" className="flex items-center gap-1 text-sm text-muted hover:text-ink">
            <ChevronLeft className="size-4" /> 作品
          </Link>
          <h1 className="ml-2 text-base font-semibold">设置</h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-8">
        <ProvidersSection />
        <Section title="生成参数" desc="全局默认值，各功能会在此基础上微调（如润色会自动降低随机性）。">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={`创造性（temperature）：${settings.temperature.toFixed(2)}`} hint="越高越天马行空，0.8~1.0 适合正文">
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={settings.temperature}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
            <Field label="单次最大输出 tokens" hint="长章节会自动调高">
              <Input
                type="number"
                min={256}
                max={64000}
                step={256}
                value={settings.maxTokens}
                onChange={(e) => updateSettings({ maxTokens: Math.max(256, Number(e.target.value) || 4096) })}
              />
            </Field>
          </div>
        </Section>
        <AntiAiSection settings={settings} update={updateSettings} />
        <Section title="编辑器与外观">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="主题">
              <Segmented
                value={settings.theme}
                onChange={(theme) => updateSettings({ theme })}
                options={[
                  { value: 'light', label: '明亮' },
                  { value: 'sepia', label: '护眼' },
                  { value: 'dark', label: '夜间' },
                ]}
              />
            </Field>
            <Field label={`正文字号：${settings.editorFontSize}px`}>
              <input
                type="range"
                min={14}
                max={26}
                value={settings.editorFontSize}
                onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
            <Field label={`正文宽度：${settings.editorWidth}px`}>
              <input
                type="range"
                min={520}
                max={1100}
                step={20}
                value={settings.editorWidth}
                onChange={(e) => updateSettings({ editorWidth: Number(e.target.value) })}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
          </div>
        </Section>
        <p className="pb-8 text-center text-xs text-muted">所有作品和 API Key 都只保存在本机的 data/inkwell.db 中。</p>
      </main>
    </div>
  );
}

function Section({ title, desc, children, action }: { title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const LEVELS: { value: AntiAiLevel; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '不额外约束文风，完全交给模型。' },
  { value: 'normal', label: '标准', desc: '在每次生成正文时注入写作守则：具体细节、展示而非告知、长短句交错、不升华不总结、对白像真人，并避开常见套话。' },
  { value: 'strict', label: '严格', desc: '在标准基础上进一步限制高频词数量，要求每几段出现一个意料之外的具体细节，并让模型自查。适合对文字要求高的场景，偶尔会略显克制。' },
];

function AntiAiSection({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => void }) {
  const [words, setWords] = useState(settings.extraBannedWords);
  const [showBuiltin, setShowBuiltin] = useState(false);
  return (
    <Section title="去 AI 味" desc="墨笔从两个方向降低 AI 腔：生成时用写作守则约束模型；生成后用本地检测器标出套话、整齐句式和段尾升华，并可一键针对性改写。">
      <div className="space-y-4">
        <Field label="生成约束强度">
          <Segmented value={settings.antiAiLevel} onChange={(antiAiLevel) => update({ antiAiLevel })} options={LEVELS.map((l) => ({ value: l.value, label: l.label }))} />
          <p className="mt-1.5 text-xs leading-relaxed text-muted">{LEVELS.find((l) => l.value === settings.antiAiLevel)?.desc}</p>
        </Field>
        <Field label="自定义禁用词" hint="用逗号或换行分隔。会同时写进提示词，并在检测时标出。">
          <Textarea
            value={words}
            minRows={3}
            onChange={(e) => setWords(e.target.value)}
            onBlur={() => words !== settings.extraBannedWords && update({ extraBannedWords: words })}
            placeholder="例如：淡淡的，一丝丝，不由自主"
          />
        </Field>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowBuiltin((v) => !v)}>
          {showBuiltin ? '收起' : '查看'}内置的高频套话清单（{PROMPT_BANNED_PHRASES.length} 条，检测器另有 100+ 条规则）
        </button>
        {showBuiltin && (
          <div className="flex flex-wrap gap-1">
            {PROMPT_BANNED_PHRASES.map((w) => (
              <Badge key={w}>{w}</Badge>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------- Providers ----------------

function ProvidersSection() {
  const { providers, setProviders, settings, updateSettings } = useApp();
  const [editing, setEditing] = useState<Provider | 'new' | null>(null);
  const [presetKey, setPresetKey] = useState('deepseek');

  const reload = async () => setProviders(await api.get<Provider[]>('/providers'));

  return (
    <Section
      title="模型服务"
      desc="接入任意数量的 API。支持 OpenAI 兼容接口（DeepSeek / 通义 / Kimi / 智谱 / 豆包 / 硅基流动 / OpenRouter / Ollama / 各类中转）、Anthropic Claude 原生接口和 Google Gemini 原生接口。"
      action={
        <div className="flex gap-2">
          <Select value={presetKey} onChange={(e) => setPresetKey(e.target.value)} className="w-48">
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            添加
          </Button>
        </div>
      }
    >
      {providers.length === 0 ? (
        <Empty icon={<KeyRound className="size-8" />} title="还没有添加模型服务">
          在右上角选择服务商并点击「添加」，填入 API Key 即可。
        </Empty>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {providers.map((p) => (
            <div key={p.id} className={cx('flex items-center gap-3 px-4 py-3', !p.enabled && 'opacity-55')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge>{PROVIDER_KIND_LABEL[p.kind]}</Badge>
                  {settings?.defaultProviderId === p.id && <Badge className="bg-accent-soft text-accent">默认</Badge>}
                  {!p.hasKey && <Badge className="bg-orange-500/15 text-orange-600">无 Key</Badge>}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {p.baseUrl} · {p.models.length ? p.models.join('、') : <span className="text-orange-600">未添加模型</span>}
                </div>
              </div>
              {settings?.defaultProviderId !== p.id && p.models.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => updateSettings({ defaultProviderId: p.id, defaultModel: p.models[0] })}>
                  设为默认
                </Button>
              )}
              <Button size="sm" onClick={() => setEditing(p)}>
                编辑
              </Button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <ProviderModal
          provider={editing === 'new' ? null : editing}
          presetKey={presetKey}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
            await useApp.getState().loadApp();
          }}
        />
      )}
    </Section>
  );
}

interface ProviderForm {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: number;
}

function ProviderModal({ provider, presetKey, onClose, onSaved }: { provider: Provider | null; presetKey: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey)!;
  const [form, setForm] = useState<ProviderForm>(() =>
    provider
      ? { name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: provider.models, enabled: provider.enabled }
      : { name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl, apiKey: '', models: preset.models, enabled: 1 },
  );
  const [saved, setSaved] = useState<Provider | null>(provider);
  const [modelInput, setModelInput] = useState('');
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'fetch' | 'test'>('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const hint = provider ? undefined : preset;

  useEffect(() => setTestResult(null), [form.baseUrl, form.apiKey, form.kind]);

  const persist = async () => {
    const body = { ...form };
    const result = saved ? await api.patch<Provider>(`/providers/${saved.id}`, body) : await api.post<Provider>('/providers', body);
    setSaved(result);
    setForm((f) => ({ ...f, apiKey: result.apiKey }));
    return result;
  };

  const addModel = (m: string) => {
    const v = m.trim();
    if (v && !form.models.includes(v)) setForm((f) => ({ ...f, models: [...f.models, v] }));
  };

  const fetchModels = async () => {
    setBusy('fetch');
    try {
      const p = await persist();
      const { models } = await api.post<{ models: string[] }>(`/providers/${p.id}/models`);
      setRemoteModels(models);
      if (!models.length) toast('服务商没有返回模型列表，请手动填写模型名');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const p = await persist();
      const r = await api.post<{ ok: boolean; model: string; latency?: number; sample?: string; error?: string }>(`/providers/${p.id}/test`, {
        model: form.models[0],
      });
      setTestResult(
        r.ok ? { ok: true, text: `连接成功：${r.model}，首字延迟 ${r.latency} ms，回复「${r.sample}」` } : { ok: false, text: r.error ?? '失败' },
      );
    } catch (err) {
      setTestResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!form.baseUrl.trim()) return toast('请填写接口地址', 'error');
    setBusy('save');
    try {
      await persist();
      await onSaved();
      toast('已保存', 'ok');
      onClose();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!saved || !confirmAsk(`删除「${saved.name}」？`)) return;
    await api.del(`/providers/${saved.id}`).catch(toastError);
    await onSaved();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={640}
      title={provider ? `编辑：${provider.name}` : `添加：${preset.name}`}
      footer={
        <>
          {saved && (
            <Button variant="danger" icon={<Trash className="size-4" />} onClick={remove} className="mr-auto">
              删除
            </Button>
          )}
          <Button icon={<Zap className="size-4" />} onClick={test} loading={busy === 'test'} disabled={!form.models.length}>
            测试连接
          </Button>
          <Button variant="primary" onClick={save} loading={busy === 'save'}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hint?.hint && <div className="rounded-md bg-hover px-3 py-2 text-xs text-muted">{hint.hint}</div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="名称">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="接口协议">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProviderKind })}>
              {Object.entries(PROVIDER_KIND_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="接口地址（Base URL）" hint={form.kind === 'openai' ? '通常以 /v1 结尾，会自动拼接 /chat/completions' : undefined}>
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
        </Field>
        <Field
          label="API Key"
          hint={
            hint?.keyUrl ? (
              <a href={hint.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                获取 Key <ExternalLink className="size-3" />
              </a>
            ) : hint?.noKey ? (
              '本地模型可留空'
            ) : undefined
          }
        >
          <Input
            type="password"
            autoComplete="off"
            value={form.apiKey}
            onFocus={(e) => form.apiKey.includes('••••') && e.target.select()}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </Field>

        <Field label="模型" hint="第一个为该服务商的默认模型">
          <div className="flex flex-wrap gap-1.5 rounded-md border border-line bg-paper p-2">
            {form.models.map((m, i) => (
              <span key={m} className={cx('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs', i === 0 ? 'bg-accent-soft text-accent' : 'bg-hover')}>
                {i > 0 && (
                  <button type="button" title="设为首选" className="hover:underline" onClick={() => setForm((f) => ({ ...f, models: [m, ...f.models.filter((x) => x !== m)] }))}>
                    {m}
                  </button>
                )}
                {i === 0 && m}
                <button type="button" onClick={() => setForm((f) => ({ ...f, models: f.models.filter((x) => x !== m) }))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addModel(modelInput);
                  setModelInput('');
                }
              }}
              onBlur={() => {
                addModel(modelInput);
                setModelInput('');
              }}
              placeholder="输入模型名后回车"
              className="min-w-40 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
        </Field>
        <div>
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy === 'fetch'} onClick={fetchModels}>
            从服务商拉取模型列表
          </Button>
          {remoteModels && remoteModels.length > 0 && (
            <div className="mt-2 rounded-md border border-line">
              <div className="border-b border-line p-1.5">
                <Input value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder={`筛选 ${remoteModels.length} 个模型`} className="h-7 text-xs" />
              </div>
              <div className="max-h-52 overflow-y-auto p-1.5">
                {remoteModels
                  .filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
                  .slice(0, 300)
                  .map((m) => (
                    <label key={m} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={form.models.includes(m)}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, models: e.target.checked ? [...f.models, m] : f.models.filter((x) => x !== m) }))
                        }
                      />
                      {m}
                    </label>
                  ))}
              </div>
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} />
          启用
        </label>
        {testResult && (
          <div className={cx('flex gap-2 rounded-md px-3 py-2 text-xs', testResult.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger')}>
            {testResult.ok ? <CircleCheck className="size-4 shrink-0" /> : <TriangleAlert className="size-4 shrink-0" />}
            <span className="break-all">{testResult.text}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
