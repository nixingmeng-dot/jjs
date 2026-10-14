import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Spinner, Toasts } from './components/ui';
import './index.css';
import BookInfoPage from './pages/BookInfo';
import BookLayout from './pages/BookLayout';
import CharactersPage from './pages/Characters';
import ForeshadowsPage from './pages/Foreshadows';
import HomePage from './pages/Home';
import OutlinePage from './pages/Outline';
import SettingsPage from './pages/Settings';
import WorldPage from './pages/World';
import WritePage from './pages/Write';
import { flushOnUnload, hasPendingSaves, toastError, useApp } from './store';

function App() {
  const settings = useApp((s) => s.settings);
  const loadApp = useApp((s) => s.loadApp);

  useEffect(() => {
    loadApp().catch(toastError);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingSaves()) {
        flushOnUnload();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [loadApp]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.theme ?? 'light';
  }, [settings?.theme]);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/book/:bookId" element={<BookLayout />}>
          <Route index element={<WritePage />} />
          <Route path="write/:chapterId?" element={<WritePage />} />
          <Route path="outline" element={<OutlinePage />} />
          <Route path="characters/:itemId?" element={<CharactersPage />} />
          <Route path="world/:itemId?" element={<WorldPage />} />
          <Route path="foreshadows" element={<ForeshadowsPage />} />
          <Route path="info" element={<BookInfoPage />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
