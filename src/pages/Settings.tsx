import { ChevronLeft, CircleCheck, ExternalLink, KeyRound, Plus, RefreshCw, Trash, TriangleAlert, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PROMPT_BANNED_PHRASES } from '../../shared/antiAi';
import { PROVIDER_KIND_LABEL, PROVIDER_PRESETS } from '../../shared/providers';
import type { AntiAiLevel, AppSettings, LimitSource, ModelLimit, Provider, ProviderKind, ResolvedLimit } from '../../shared/types';
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
            <Field label="单次最大输出 tokens" hint="留空 = 自动，按每个模型的上限">
              <Input
                type="number"
                min={0}
                step={1024}
                value={settings.maxTokens || ''}
                placeholder="自动"
                onChange={(e) => updateSettings({ maxTokens: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                onBlur={() => settings.maxTokens > 0 && settings.maxTokens < 256 && updateSettings({ maxTokens: 256 })}
              />
            </Field>
          </div>
        </Section>
        <AntiAiSection settings={settings} update={updateSettings} />
        <Section title="编辑器与外观">
          <div className="grid gap-5 sm:grid-cols-2">
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
            <Field label="正文字体" hint="宋体、楷体已内置，无需联网">
              <Segmented
                value={settings.editorFont}
                onChange={(editorFont) => updateSettings({ editorFont })}
                options={[
                  { value: 'sans', label: '黑体' },
                  { value: 'serif', label: '宋体' },
                  { value: 'kai', label: '楷体' },
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
        <button type="button" className="text-xs text-ai hover:underline" onClick={() => setShowBuiltin((v) => !v)}>
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
  limitOverrides: Record<string, ModelLimit>;
}

function ProviderModal({ provider, presetKey, onClose, onSaved }: { provider: Provider | null; presetKey: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const preset = PROVIDER_PRESETS.find((p) => p.key === presetKey)!;
  const [form, setForm] = useState<ProviderForm>(() =>
    provider
      ? {
          name: provider.name,
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          models: provider.models,
          enabled: provider.enabled,
          limitOverrides: provider.limitOverrides ?? {},
        }
      : { name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl, apiKey: '', models: preset.models, enabled: 1, limitOverrides: {} },
  );
  const [autoLimits, setAutoLimits] = useState<Record<string, ResolvedLimit>>({});
  const [limitsTick, setLimitsTick] = useState(0);
  const [saved, setSaved] = useState<Provider | null>(provider);
  const [modelInput, setModelInput] = useState('');
  const [remoteModels, setRemoteModels] = useState<string[] | null>(null);
  const [modelFilter, setModelFilter] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'fetch' | 'test'>('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const hint = provider ? undefined : preset;

  useEffect(() => setTestResult(null), [form.baseUrl, form.apiKey, form.kind]);

  const modelsKey = form.models.join('\n');
  useEffect(() => {
    if (!form.models.length) return setAutoLimits({});
    const t = setTimeout(() => {
      api.post<Record<string, ResolvedLimit>>('/model-limits', { providerId: saved?.id, models: form.models }).then(setAutoLimits).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, modelsKey, limitsTick]);

  const setOverride = (model: string, key: keyof ModelLimit, value?: number) =>
    setForm((f) => {
      const next = { ...f.limitOverrides, [model]: { ...f.limitOverrides[model], [key]: value } };
      if (!next[model].context && !next[model].output) delete next[model];
      return { ...f, limitOverrides: next };
    });

  const persist = async () => {
    const body = { ...form, limitOverrides: Object.fromEntries(Object.entries(form.limitOverrides).filter(([m]) => form.models.includes(m))) };
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
      setLimitsTick((n) => n + 1);
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
      const r = await api.post<{ ok: boolean; model: string; latency?: number; sample?: string; kind?: string; error?: string }>(`/providers/${p.id}/test`, {
        model: form.models[0],
      });
      setTestResult(
        r.ok
          ? { ok: true, text: `连接成功：${r.model}，首字延迟 ${r.latency} ms，${r.kind === 'reasoning' ? '收到思考过程' : '回复'}「${r.sample}」` }
          : { ok: false, text: r.error ?? '失败' },
      );
    } catch (err) {
      setTestResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy('');
      setLimitsTick((n) => n + 1);
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
        <Field
          label="接口地址（Base URL）"
          hint={form.kind === 'openai' ? '通常以 /v1 结尾，会自动拼接 /chat/completions' : form.kind === 'responses' ? '通常以 /v1 结尾，会自动拼接 /responses' : undefined}
        >
          <Input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
        </Field>
        <Field
          label="API Key"
          hint={
            hint?.keyUrl ? (
              <a href={hint.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-ai hover:underline">
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
        {form.models.length > 0 && (
          <div>
            {/* 不用 Field：它是 <label>，点表格任意处都会聚焦到第一个输入框 */}
            <div className="mb-1 flex items-baseline gap-2 text-xs font-medium text-muted">
              <span>模型上限</span>
              <span className="font-normal text-muted/80">自动识别，生成时据此设置输出额度；需要时可以手动改</span>
            </div>
            <div className="rounded-md border border-line text-xs">
              <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_92px] gap-2 border-b border-line px-2.5 py-1.5 text-[11px] text-muted">
                <span>模型</span>
                <span className="text-right">上下文</span>
                <span className="text-right">最大输出</span>
                <span className="text-right">来源</span>
              </div>
              {form.models.map((m) => {
                const auto = autoLimits[m] ?? {};
                const own = form.limitOverrides[m] ?? {};
                const sources = [own.context ? 'manual' : auto.contextSource, own.output ? 'manual' : auto.outputSource].filter(Boolean) as LimitSource[];
                return (
                  <div key={m} className="grid grid-cols-[minmax(0,1fr)_88px_88px_92px] items-center gap-2 border-b border-line px-2.5 py-1 last:border-0">
                    <span className="truncate" title={m}>
                      {m}
                    </span>
                    <LimitCell value={own.context} auto={auto.context} source={auto.contextSource} onChange={(v) => setOverride(m, 'context', v)} />
                    <LimitCell value={own.output} auto={auto.output} source={auto.outputSource} onChange={(v) => setOverride(m, 'output', v)} />
                    <span className="truncate text-right text-[11px] text-muted">
                      {sources.length ? [...new Set(sources)].map((s) => LIMIT_SOURCE[s]).join(' · ') : '未识别'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              来源：「服务商」是模型列表接口返回的，或实际请求时从报错里得知的；「模型库」是内置的 models.dev 数据。都没有时按 32K 输出，服务商报错会自动改用它给出的上限。输入框留空即用自动值，可以填 128k、1m 这样的写法。
            </p>
          </div>
        )}
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

const LIMIT_SOURCE: Record<LimitSource, string> = { manual: '手动', provider: '服务商', library: '模型库' };

/** 能被 1000 整除按十进制显示（384000 → 384K），否则按 1024 显示（131072 → 128K） */
function formatTokens(n?: number) {
  if (!n) return '';
  const unit = (dec: number, bin: number) => (n % dec === 0 || n % bin !== 0 ? dec : bin);
  if (n >= 1_000_000) return `${+(n / unit(1e6, 1048576)).toFixed(2)}M`;
  if (n >= 1000) return `${+(n / unit(1000, 1024)).toFixed(1)}K`;
  return String(n);
}

function parseTokens(s: string): number | undefined {
  const m = s.trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([km]?)$/i);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1e6 : m[2].toLowerCase() === 'k' ? 1e3 : 1));
  return n >= 256 ? n : undefined;
}

function LimitCell({ value, auto, source, onChange }: { value?: number; auto?: number; source?: LimitSource; onChange: (v?: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => setText(value ? String(value) : ''), [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseTokens(text);
        if (!v) setText('');
        onChange(v);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder={auto ? formatTokens(auto) : '—'}
      title={auto ? `自动识别：${auto.toLocaleString()} tokens（${LIMIT_SOURCE[source ?? 'library']}）` : '未识别'}
      className={cx(
        'h-7 w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 text-right tabular-nums outline-none hover:border-line focus:border-line focus:bg-paper',
        value ? 'font-semibold text-ink' : 'placeholder:text-ink/75',
      )}
    />
  );
}
