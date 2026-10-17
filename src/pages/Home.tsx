import { BookOpen, Feather, FileText, Plus, Settings, Trash, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatWords } from '../../shared/text';
import type { Book, BookSummary } from '../../shared/types';
import { api } from '../api';
import { Button, confirmAsk, Empty, Field, IconButton, Input, Modal, Spinner, Textarea, timeAgo } from '../components/ui';
import { toast, toastError, useApp } from '../store';

const GENRES = ['玄幻', '仙侠', '都市', '言情', '悬疑', '科幻', '历史', '武侠', '奇幻', '游戏', '轻小说', '现实', '恐怖', '同人', '其他'];

export default function HomePage() {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const providers = useApp((s) => s.providers);
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.get<BookSummary[]>('/books').then(setBooks).catch(toastError);
  useEffect(() => {
    load();
  }, []);

  const onImport = async (file: File) => {
    try {
      const text = await file.text();
      let book: Book;
      if (file.name.endsWith('.json')) {
        book = await api.post<Book>('/import/backup', JSON.parse(text));
      } else {
        book = await api.post<Book>('/import/text', { title: file.name.replace(/\.(txt|md)$/i, ''), text });
      }
      toast(`已导入《${book.title}》`, 'ok');
      navigate(`/book/${book.id}`);
    } catch (err) {
      toastError(err instanceof SyntaxError ? new Error('备份文件格式错误') : err);
    }
  };

  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <Feather className="size-6 text-accent" />
          <div>
            <h1 className="text-lg font-semibold">墨笔</h1>
            <p className="text-xs text-muted">小说创作工作台</p>
          </div>
          <div className="flex-1" />
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()} title="导入 TXT（自动识别卷/章）或墨笔备份文件">
            导入
          </Button>
          <Link to="/settings">
            <Button icon={<Settings className="size-4" />}>设置</Button>
          </Link>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            新建作品
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {providers.length === 0 && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
            <span className="flex-1">
              还没有接入 AI 模型。墨笔支持 DeepSeek、OpenAI、Claude、Gemini、通义千问、Kimi、智谱、豆包、本地 Ollama 以及任何 OpenAI 兼容接口。
            </span>
            <Link to="/settings">
              <Button variant="primary" size="sm">
                去配置
              </Button>
            </Link>
          </div>
        )}

        {books === null ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : books.length === 0 ? (
          <Empty icon={<BookOpen className="size-10" />} title="还没有作品">
            点击右上角「新建作品」开始写作，或「导入」已有的 TXT 稿件（会自动按“第X卷/第X章”拆分）。
          </Empty>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <Link
                key={b.id}
                to={`/book/${b.id}`}
                className="group relative flex flex-col rounded-xl border border-line bg-panel p-5 transition hover:border-accent/50 hover:shadow-md"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-accent-soft font-serif text-lg text-accent">
                    {b.title.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-serif text-base font-semibold">{b.title}</h2>
                    <div className="mt-1 text-xs text-muted">
                      {[b.genre, b.author].filter(Boolean).join(' · ') || '未设置类型'}
                    </div>
                    <div className="mt-2 flex gap-3 text-xs text-muted">
                      <span>
                        <FileText className="mr-0.5 inline size-3" />
                        {b.chapterCount} 章
                      </span>
                      <span>{formatWords(b.wordCount)} 字</span>
                      <span>{timeAgo(b.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted">{b.synopsis || '暂无简介'}</p>
                <IconButton
                  title="删除作品"
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!confirmAsk(`确定删除《${b.title}》？此操作不可恢复。建议先在作品信息页导出备份。`)) return;
                    await api.del(`/books/${b.id}`).catch(toastError);
                    load();
                  }}
                >
                  <Trash className="size-3.5" />
                </IconButton>
              </Link>
            ))}
          </div>
        )}
      </main>

      <CreateBookModal open={creating} onClose={() => setCreating(false)} onCreated={(b) => navigate(`/book/${b.id}/outline`)} />
    </div>
  );
}

function CreateBookModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (b: Book) => void }) {
  const [form, setForm] = useState({ title: '', genre: '', synopsis: '', author: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!form.title.trim()) return toast('请填写书名', 'error');
    setBusy(true);
    try {
      const book = await api.post<Book>('/books', form);
      setForm({ title: '', genre: '', synopsis: '', author: '' });
      onClose();
      onCreated(book);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建作品"
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="书名">
          <Input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <Input list="genres" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder="如：悬疑" />
            <datalist id="genres">
              {GENRES.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </Field>
          <Field label="笔名">
            <Input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
          </Field>
        </div>
        <Field label="一句话简介 / 灵感" hint="之后可以让 AI 据此生成总纲">
          <Textarea value={form.synopsis} onChange={(e) => setForm({ ...form, synopsis: e.target.value })} minRows={3} />
        </Field>
      </div>
    </Modal>
  );
}
