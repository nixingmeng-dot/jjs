import { ChevronLeft, Feather, Flag, Globe, Info, ListTree, PenLine, Settings, Users } from 'lucide-react';
import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router';
import { formatWords } from '../../shared/text';
import { Button, cx, Empty, Spinner } from '../components/ui';
import { useBook, useUi } from '../store';

const NAV = [
  { to: 'write', label: '写作', icon: PenLine },
  { to: 'outline', label: '大纲', icon: ListTree },
  { to: 'characters', label: '人物', icon: Users },
  { to: 'world', label: '设定', icon: Globe },
  { to: 'foreshadows', label: '伏笔', icon: Flag },
  { to: 'info', label: '作品', icon: Info },
];

export default function BookLayout() {
  const { bookId } = useParams();
  const { tree, loadingId, error, load, saving, saveError } = useBook();
  const focus = useUi((s) => s.focus);
  const { pathname } = useLocation();

  useEffect(() => {
    if (bookId && tree?.book.id !== bookId) load(bookId);
  }, [bookId, load, tree?.book.id]);

  useEffect(() => {
    if (tree) document.title = `${tree.book.title} · 墨笔`;
    return () => {
      document.title = '墨笔 · 小说创作工作台';
    };
  }, [tree?.book.title]);

  useEffect(() => () => void useBook.getState().flush(), []);

  if (error)
    return (
      <Empty title="无法打开作品">
        {error}
        <div className="mt-3">
          <Link to="/">
            <Button>返回作品列表</Button>
          </Link>
        </div>
      </Empty>
    );
  if (!tree || tree.book.id !== bookId || loadingId)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  const total = tree.chapters.reduce((n, c) => n + c.wordCount, 0);

  return (
    <div className="flex h-full">
      {!focus && (
        <nav className="flex w-16 shrink-0 flex-col items-center border-r border-line bg-panel py-3">
          <Link to="/" title="返回作品列表" className="mb-3 flex size-10 items-center justify-center rounded-lg text-accent hover:bg-hover">
            <Feather className="size-5" />
          </Link>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  'mb-1 flex w-12 flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] transition',
                  isActive || (to === 'write' && pathname.replace(/\/$/, '').endsWith(`/book/${bookId}`)) ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-ink',
                )
              }
            >
              <Icon className="size-4.5" />
              {label}
            </NavLink>
          ))}
          <div className="flex-1" />
          <div className="mb-2 px-1 text-center text-[10px] leading-tight text-muted" title={`全书 ${total} 字`}>
            {formatWords(total)}
            <br />字
          </div>
          <div
            title={saveError ? `保存失败：${saveError}` : saving ? '保存中' : '已保存'}
            className={cx('mb-3 size-2 rounded-full', saveError ? 'bg-danger' : saving ? 'animate-pulse bg-amber-500' : 'bg-ok')}
          />
          <Link to="/settings" title="设置" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-ink">
            <Settings className="size-4.5" />
          </Link>
        </nav>
      )}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  const book = useBook((s) => s.tree?.book);
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-3">
        <Link to="/" className="text-muted hover:text-ink" title="作品列表">
          <ChevronLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted">《{book?.title}》</div>
          <h1 className="text-base font-semibold">{title}</h1>
        </div>
        {children}
      </div>
      {desc && <p className="mx-auto max-w-5xl px-6 pb-3 -mt-1 text-xs text-muted">{desc}</p>}
    </header>
  );
}
