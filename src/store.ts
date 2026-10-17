import { create } from 'zustand';
import type { AppSettings, Book, BookTree, CollectionName, Provider } from '../shared/types';
import { api, patchKeepalive } from './api';

// ---------------- toasts ----------------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'ok';
}

export const useToasts = create<{ list: Toast[]; push: (text: string, kind?: Toast['kind']) => void; dismiss: (id: number) => void }>(
  (set, get) => ({
    list: [],
    push: (text, kind = 'info') => {
      const id = Date.now() + Math.random();
      set({ list: [...get().list, { id, text, kind }] });
      setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 2800);
    },
    dismiss: (id) => set({ list: get().list.filter((t) => t.id !== id) }),
  }),
);

export const toast = (text: string, kind?: Toast['kind']) => useToasts.getState().push(text, kind);
export const toastError = (err: unknown) => toast((err as Error)?.message || String(err), 'error');

// ---------------- app (settings / providers) ----------------

interface AppState {
  settings: AppSettings | null;
  providers: Provider[];
  loadApp: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setProviders: (list: Provider[]) => void;
}

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  providers: [],
  loadApp: async () => {
    const [settings, providers] = await Promise.all([api.get<AppSettings>('/settings'), api.get<Provider[]>('/providers')]);
    set({ settings, providers });
  },
  updateSettings: async (patch) => {
    const prev = get().settings;
    if (prev) set({ settings: { ...prev, ...patch } });
    try {
      set({ settings: await api.patch<AppSettings>('/settings', patch) });
    } catch (err) {
      set({ settings: prev });
      toastError(err);
    }
  },
  setProviders: (providers) => set({ providers }),
}));

// ---------------- current book ----------------

type Item = { id: string } & Record<string, unknown>;
type ListKey = Exclude<keyof BookTree, 'book'>;

const listKey: Record<CollectionName, ListKey> = {
  volumes: 'volumes',
  chapters: 'chapters',
  characters: 'characters',
  world: 'world',
  foreshadows: 'foreshadows',
};

const SAVE_DELAY = 700;
const pending = new Map<string, { path: string; patch: Record<string, unknown>; timer: ReturnType<typeof setTimeout> }>();

interface BookState {
  tree: BookTree | null;
  loadingId: string | null;
  error: string;
  saving: number;
  saveError: string;
  load: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  updateBook: (patch: Partial<Book>, immediate?: boolean) => void;
  create: <T extends { id: string } = Item>(name: CollectionName, data: Record<string, unknown>) => Promise<T>;
  createMany: <T extends { id: string } = Item>(name: CollectionName, items: Record<string, unknown>[]) => Promise<T[]>;
  update: (name: CollectionName, id: string, patch: Record<string, unknown>, immediate?: boolean) => void;
  remove: (name: CollectionName, id: string) => Promise<void>;
  reorder: (name: CollectionName, ids: string[], volumeId?: string) => Promise<void>;
  flush: () => Promise<void>;
}

export const useBook = create<BookState>((set, get) => {
  const send = async (key: string) => {
    const job = pending.get(key);
    if (!job) return;
    pending.delete(key);
    clearTimeout(job.timer);
    set({ saving: get().saving + 1 });
    try {
      const saved = await api.patch<Record<string, unknown>>(job.path, job.patch);
      set({ saveError: '' });
      // 只同步服务端计算的字段，避免覆盖用户在请求期间的新输入
      if (key.startsWith('chapters:')) {
        const tree = get().tree;
        if (tree)
          set({
            tree: {
              ...tree,
              chapters: tree.chapters.map((c) =>
                c.id === saved.id
                  ? { ...c, wordCount: saved.wordCount as number, summaryWords: saved.summaryWords as number, updatedAt: saved.updatedAt as number }
                  : c,
              ),
            },
          });
      }
    } catch (err) {
      set({ saveError: (err as Error).message });
      toastError(err);
    } finally {
      set({ saving: get().saving - 1 });
    }
  };

  const queue = (key: string, path: string, patch: Record<string, unknown>, immediate?: boolean) => {
    const existing = pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const merged = { ...(existing?.patch ?? {}), ...patch };
    pending.set(key, { path, patch: merged, timer: setTimeout(() => send(key), immediate ? 0 : SAVE_DELAY) });
  };

  return {
    tree: null,
    loadingId: null,
    error: '',
    saving: 0,
    saveError: '',

    load: async (id) => {
      await get().flush();
      set({ loadingId: id, error: '' });
      try {
        const tree = await api.get<BookTree>(`/books/${id}`);
        if (get().loadingId === id) set({ tree, loadingId: null });
      } catch (err) {
        set({ error: (err as Error).message, loadingId: null, tree: null });
      }
    },

    refresh: async () => {
      const id = get().tree?.book.id;
      if (!id) return;
      await get().flush();
      set({ tree: await api.get<BookTree>(`/books/${id}`) });
    },

    updateBook: (patch, immediate) => {
      const tree = get().tree;
      if (!tree) return;
      set({ tree: { ...tree, book: { ...tree.book, ...patch } } });
      queue(`book:${tree.book.id}`, `/books/${tree.book.id}`, patch, immediate);
    },

    create: async (name, data) => {
      const tree = get().tree;
      if (!tree) throw new Error('未打开作品');
      const item = await api.post<Item>(`/books/${tree.book.id}/${name}`, data);
      const cur = get().tree!;
      set({ tree: { ...cur, [listKey[name]]: [...(cur[listKey[name]] as unknown as Item[]), item] } });
      return item as never;
    },

    createMany: async (name, items) => {
      const tree = get().tree;
      if (!tree) throw new Error('未打开作品');
      const created = await api.post<Item[]>(`/books/${tree.book.id}/${name}/batch`, { items });
      const cur = get().tree!;
      set({ tree: { ...cur, [listKey[name]]: [...(cur[listKey[name]] as unknown as Item[]), ...created] } });
      return created as never;
    },

    update: (name, id, patch, immediate) => {
      const tree = get().tree;
      if (!tree) return;
      const key = listKey[name];
      const localPatch = { ...patch };
      delete localPatch.content;
      set({
        tree: {
          ...tree,
          [key]: (tree[key] as unknown as Item[]).map((it) => (it.id === id ? { ...it, ...localPatch } : it)),
        },
      });
      queue(`${name}:${id}`, `/${name}/${id}`, patch, immediate);
    },

    remove: async (name, id) => {
      const tree = get().tree;
      if (!tree) return;
      const job = pending.get(`${name}:${id}`);
      if (job) {
        clearTimeout(job.timer);
        pending.delete(`${name}:${id}`);
      }
      await api.del(`/${name}/${id}`);
      const cur = get().tree!;
      const next = { ...cur, [listKey[name]]: (cur[listKey[name]] as unknown as Item[]).filter((it) => it.id !== id) };
      if (name === 'volumes') next.chapters = next.chapters.filter((c) => c.volumeId !== id);
      set({ tree: next });
    },

    reorder: async (name, ids, volumeId) => {
      const tree = get().tree;
      if (!tree) return;
      const key = listKey[name];
      const order = new Map(ids.map((id, i) => [id, i + 1]));
      const list = (tree[key] as unknown as Item[]).map((it) =>
        order.has(it.id) ? { ...it, sort: order.get(it.id)!, ...(volumeId ? { volumeId } : {}) } : it,
      );
      list.sort((a, b) => (a.sort as number) - (b.sort as number));
      set({ tree: { ...tree, [key]: list } });
      await api.post(`/books/${tree.book.id}/${name}/reorder`, { ids, volumeId });
    },

    flush: async () => {
      await Promise.all([...pending.keys()].map((k) => send(k)));
    },
  };
});

export function flushOnUnload() {
  for (const [key, job] of pending) {
    clearTimeout(job.timer);
    patchKeepalive(job.path, job.patch);
    pending.delete(key);
  }
}

export const hasPendingSaves = () => pending.size > 0;

// ---------------- ui ----------------

interface Jump {
  chapterId: string;
  start: number;
  end: number;
}

export const useUi = create<{
  focus: boolean;
  setFocus: (v: boolean) => void;
  jump: Jump | null;
  setJump: (j: Jump | null) => void;
}>((set) => ({
  focus: false,
  setFocus: (focus) => set({ focus }),
  jump: null,
  setJump: (jump) => set({ jump }),
}));
