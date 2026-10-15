import { useEffect } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { Button, Empty, Spinner } from '../components/ui';
import { useBook, useUi } from '../store';
import { Sidebar } from './Sidebar';

export default function BookLayout() {
  const { bookId } = useParams();
  const { tree, loadingId, error, load } = useBook();
  const focus = useUi((s) => s.focus);

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

  return (
    <div className="flex h-full">
      {!focus && <Sidebar />}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export function PageHeader({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  const book = useBook((s) => s.tree?.book);
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-8 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted">
            {book?.title} <span className="mx-1 text-line">/</span> {title}
          </div>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        {children}
      </div>
      {desc && <p className="mx-auto -mt-1 max-w-5xl px-8 pb-3 text-xs text-muted">{desc}</p>}
    </header>
  );
}
