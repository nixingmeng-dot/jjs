import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { countWords } from '../shared/text';
import type {
  AppSettings,
  Book,
  BookStats,
  BookSummary,
  BookTree,
  Chapter,
  ChapterMeta,
  CollectionName,
  Provider,
  SearchHit,
  Snapshot,
} from '../shared/types';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  outline TEXT NOT NULL DEFAULT '',
  styleGuide TEXT NOT NULL DEFAULT '',
  styleSample TEXT NOT NULL DEFAULT '',
  pov TEXT NOT NULL DEFAULT '',
  bannedWords TEXT NOT NULL DEFAULT '',
  targetWords INTEGER NOT NULL DEFAULT 0,
  dailyGoal INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS volumes (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  sort REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  volumeId TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  outline TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  sort REAL NOT NULL DEFAULT 0,
  wordCount INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  aliases TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '配角',
  gender TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  speech TEXT NOT NULL DEFAULT '',
  motivation TEXT NOT NULL DEFAULT '',
  arc TEXT NOT NULL DEFAULT '',
  relations TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS world_entries (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '其他',
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS foreshadows (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  plantedChapterId TEXT NOT NULL DEFAULT '',
  resolvePlan TEXT NOT NULL DEFAULT '',
  resolvedChapterId TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  sort REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  chapterId TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  wordCount INTEGER NOT NULL DEFAULT 0,
  auto INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'openai',
  baseUrl TEXT NOT NULL DEFAULT '',
  apiKey TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_stats (
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bookId, day)
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(bookId, volumeId, sort);
CREATE INDEX IF NOT EXISTS idx_snapshots_chapter ON snapshots(chapterId, createdAt);
`;

export const COLLECTIONS: Record<CollectionName, { table: string; fields: string[] }> = {
  volumes: { table: 'volumes', fields: ['title', 'summary', 'sort'] },
  chapters: {
    table: 'chapters',
    fields: ['volumeId', 'title', 'outline', 'content', 'summary', 'notes', 'status', 'sort'],
  },
  characters: {
    table: 'characters',
    fields: [
      'name', 'aliases', 'role', 'gender', 'age', 'appearance', 'personality', 'background',
      'speech', 'motivation', 'arc', 'relations', 'notes', 'pinned', 'sort',
    ],
  },
  world: { table: 'world_entries', fields: ['category', 'name', 'content', 'pinned', 'sort'] },
  foreshadows: {
    table: 'foreshadows',
    fields: ['title', 'content', 'plantedChapterId', 'resolvePlan', 'resolvedChapterId', 'status', 'sort'],
  },
};

const BOOK_FIELDS = [
  'title', 'author', 'genre', 'tags', 'synopsis', 'outline', 'styleGuide', 'styleSample',
  'pov', 'bannedWords', 'targetWords', 'dailyGoal',
];

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProviderId: '',
  defaultModel: '',
  temperature: 0.85,
  maxTokens: 4096,
  antiAiLevel: 'normal',
  extraBannedWords: '',
  editorFontSize: 18,
  editorWidth: 760,
  theme: 'light',
};

const AUTO_SNAPSHOT_INTERVAL = 20 * 60 * 1000;
const AUTO_SNAPSHOT_KEEP = 30;

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);
const today = () => new Date().toLocaleDateString('sv-SE');

function pick(data: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data[f];
    if (v === undefined) continue;
    out[f] = typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export class Repo {
  constructor(public db: DB) {}

  // ---------- books ----------
  listBooks(): BookSummary[] {
    return this.db
      .prepare(
        `SELECT b.id, b.title, b.author, b.genre, b.synopsis, b.createdAt, b.updatedAt,
           COALESCE(SUM(c.wordCount), 0) AS wordCount, COUNT(c.id) AS chapterCount
         FROM books b LEFT JOIN chapters c ON c.bookId = b.id
         GROUP BY b.id ORDER BY b.updatedAt DESC`,
      )
      .all() as BookSummary[];
  }

  getBook(id: string): Book | undefined {
    return this.db.prepare('SELECT * FROM books WHERE id = ?').get(id) as Book | undefined;
  }

  createBook(data: Partial<Book>, opts: { withStarter?: boolean } = {}): Book {
    const now = Date.now();
    const id = newId();
    const row = { title: '未命名作品', ...pick(data as Record<string, unknown>, BOOK_FIELDS) };
    const cols = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO books (id, ${cols.join(', ')}, createdAt, updatedAt) VALUES (@id, ${cols
          .map((c) => '@' + c)
          .join(', ')}, @now, @now)`,
      )
      .run({ id, ...row, now });
    if (opts.withStarter !== false) {
      const vol = this.insert('volumes', id, { title: '第一卷' });
      this.insert('chapters', id, { volumeId: vol.id, title: '' });
    }
    return this.getBook(id)!;
  }

  updateBook(id: string, data: Record<string, unknown>): Book | undefined {
    const row = pick(data, BOOK_FIELDS);
    if (Object.keys(row).length) {
      const sets = Object.keys(row).map((c) => `${c} = @${c}`);
      this.db
        .prepare(`UPDATE books SET ${sets.join(', ')}, updatedAt = @now WHERE id = @id`)
        .run({ ...row, id, now: Date.now() });
    }
    return this.getBook(id);
  }

  deleteBook(id: string) {
    this.db.prepare('DELETE FROM books WHERE id = ?').run(id);
  }

  touchBook(id: string) {
    this.db.prepare('UPDATE books SET updatedAt = ? WHERE id = ?').run(Date.now(), id);
  }

  getTree(id: string): BookTree | undefined {
    const book = this.getBook(id);
    if (!book) return undefined;
    const all = (sql: string) => this.db.prepare(sql).all(id) as never[];
    return {
      book,
      volumes: all('SELECT * FROM volumes WHERE bookId = ? ORDER BY sort, rowid'),
      chapters: all(
        `SELECT id, bookId, volumeId, title, outline, summary, notes, status, sort, wordCount, createdAt, updatedAt
         FROM chapters WHERE bookId = ? ORDER BY sort, rowid`,
      ),
      characters: all('SELECT * FROM characters WHERE bookId = ? ORDER BY sort, rowid'),
      world: all('SELECT * FROM world_entries WHERE bookId = ? ORDER BY sort, rowid'),
      foreshadows: all('SELECT * FROM foreshadows WHERE bookId = ? ORDER BY sort, rowid'),
    };
  }

  /** 按阅读顺序（卷序 → 章序）排列的章节 */
  orderedChapters(bookId: string, withContent = false): (ChapterMeta & { content?: string })[] {
    const cols = withContent ? 'c.*' : 'c.id, c.bookId, c.volumeId, c.title, c.outline, c.summary, c.notes, c.status, c.sort, c.wordCount, c.createdAt, c.updatedAt';
    return this.db
      .prepare(
        `SELECT ${cols} FROM chapters c JOIN volumes v ON v.id = c.volumeId
         WHERE c.bookId = ? ORDER BY v.sort, v.rowid, c.sort, c.rowid`,
      )
      .all(bookId) as ChapterMeta[];
  }

  // ---------- generic collections ----------
  private nextSort(table: string, bookId: string, extra?: { col: string; val: unknown }) {
    const where = extra ? `bookId = ? AND ${extra.col} = ?` : 'bookId = ?';
    const args = extra ? [bookId, extra.val] : [bookId];
    const row = this.db.prepare(`SELECT MAX(sort) AS m FROM ${table} WHERE ${where}`).get(...args) as { m: number | null };
    return (row.m ?? 0) + 1;
  }

  insert(name: CollectionName, bookId: string, data: Record<string, unknown>) {
    const { table, fields } = COLLECTIONS[name];
    const row = pick(data, fields);
    if (name === 'chapters') {
      if (!row.volumeId) throw new HttpError(400, '缺少 volumeId');
      const content = String(row.content ?? '');
      row.wordCount = countWords(content);
      const now = Date.now();
      row.createdAt = now;
      row.updatedAt = now;
    }
    if (row.sort === undefined) {
      row.sort = this.nextSort(table, bookId, name === 'chapters' ? { col: 'volumeId', val: row.volumeId } : undefined);
    }
    const id = newId();
    const cols = Object.keys(row);
    this.db
      .prepare(`INSERT INTO ${table} (id, bookId, ${cols.join(', ')}) VALUES (@id, @bookId, ${cols.map((c) => '@' + c).join(', ')})`)
      .run({ id, bookId, ...row });
    this.touchBook(bookId);
    return this.getEntity(name, id)!;
  }

  getEntity(name: CollectionName, id: string): Record<string, unknown> | undefined {
    const { table } = COLLECTIONS[name];
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (row && name === 'chapters') delete row.content;
    return row;
  }

  update(name: CollectionName, id: string, data: Record<string, unknown>) {
    const { table, fields } = COLLECTIONS[name];
    const existing = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) throw new HttpError(404, '未找到');
    const row = pick(data, fields);
    if (name === 'chapters') {
      row.updatedAt = Date.now();
      if (typeof row.content === 'string' && row.content !== existing.content) {
        const before = Number(existing.wordCount) || 0;
        row.wordCount = countWords(row.content);
        const delta = (row.wordCount as number) - before;
        if (delta > 0) this.addDailyWords(String(existing.bookId), delta);
        this.maybeAutoSnapshot(id, String(existing.content ?? ''));
      }
    }
    if (Object.keys(row).length) {
      const sets = Object.keys(row).map((c) => `${c} = @${c}`);
      this.db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = @id`).run({ ...row, id });
    }
    this.touchBook(String(existing.bookId));
    return this.getEntity(name, id)!;
  }

  remove(name: CollectionName, id: string) {
    const { table } = COLLECTIONS[name];
    const row = this.db.prepare(`SELECT bookId FROM ${table} WHERE id = ?`).get(id) as { bookId: string } | undefined;
    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (row) this.touchBook(row.bookId);
  }

  reorder(name: CollectionName, ids: string[], volumeId?: string) {
    const { table } = COLLECTIONS[name];
    const tx = this.db.transaction(() => {
      ids.forEach((id, i) => {
        if (name === 'chapters' && volumeId) {
          this.db.prepare(`UPDATE chapters SET sort = ?, volumeId = ? WHERE id = ?`).run(i + 1, volumeId, id);
        } else {
          this.db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).run(i + 1, id);
        }
      });
    });
    tx();
  }

  batchInsert(name: CollectionName, bookId: string, items: Record<string, unknown>[]) {
    const tx = this.db.transaction(() => items.map((it) => this.insert(name, bookId, it)));
    return tx();
  }

  // ---------- chapters ----------
  getChapter(id: string): Chapter | undefined {
    return this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as Chapter | undefined;
  }

  search(bookId: string, q: string): SearchHit[] {
    if (!q.trim()) return [];
    const hits: SearchHit[] = [];
    for (const ch of this.orderedChapters(bookId, true)) {
      const content = ch.content ?? '';
      let idx = content.indexOf(q);
      let n = 0;
      while (idx !== -1 && n < 20) {
        const s = Math.max(0, idx - 20);
        hits.push({
          chapterId: ch.id,
          title: ch.title,
          index: idx,
          snippet: content.slice(s, idx + q.length + 30).replace(/\s+/g, ' '),
        });
        idx = content.indexOf(q, idx + q.length);
        n++;
      }
      if (hits.length >= 200) break;
    }
    return hits;
  }

  // ---------- snapshots ----------
  listSnapshots(chapterId: string): Snapshot[] {
    return this.db
      .prepare('SELECT id, chapterId, note, wordCount, createdAt FROM snapshots WHERE chapterId = ? ORDER BY createdAt DESC')
      .all(chapterId) as Snapshot[];
  }

  getSnapshot(id: string): Snapshot | undefined {
    return this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as Snapshot | undefined;
  }

  createSnapshot(chapterId: string, note: string, content?: string, auto = false): Snapshot {
    const text = content ?? this.getChapter(chapterId)?.content ?? '';
    const id = newId();
    this.db
      .prepare('INSERT INTO snapshots (id, chapterId, note, content, wordCount, auto, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, chapterId, note, text, countWords(text), auto ? 1 : 0, Date.now());
    return this.getSnapshot(id)!;
  }

  deleteSnapshot(id: string) {
    this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  }

  private maybeAutoSnapshot(chapterId: string, previousContent: string) {
    if (!previousContent.trim()) return;
    const last = this.db
      .prepare('SELECT createdAt FROM snapshots WHERE chapterId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(chapterId) as { createdAt: number } | undefined;
    if (last && Date.now() - last.createdAt < AUTO_SNAPSHOT_INTERVAL) return;
    this.createSnapshot(chapterId, '自动保存', previousContent, true);
    this.db
      .prepare(
        `DELETE FROM snapshots WHERE chapterId = ? AND auto = 1 AND id NOT IN (
           SELECT id FROM snapshots WHERE chapterId = ? AND auto = 1 ORDER BY createdAt DESC LIMIT ?)`,
      )
      .run(chapterId, chapterId, AUTO_SNAPSHOT_KEEP);
  }

  // ---------- stats ----------
  private addDailyWords(bookId: string, words: number) {
    this.db
      .prepare(
        `INSERT INTO daily_stats (bookId, day, words) VALUES (?, ?, ?)
         ON CONFLICT(bookId, day) DO UPDATE SET words = words + excluded.words`,
      )
      .run(bookId, today(), words);
  }

  stats(bookId: string): BookStats {
    const totals = this.db
      .prepare('SELECT COALESCE(SUM(wordCount),0) AS w, COUNT(*) AS n FROM chapters WHERE bookId = ?')
      .get(bookId) as { w: number; n: number };
    const days = this.db
      .prepare('SELECT day, words FROM daily_stats WHERE bookId = ? ORDER BY day DESC LIMIT 30')
      .all(bookId) as { day: string; words: number }[];
    const t = today();
    return {
      totalWords: totals.w,
      chapterCount: totals.n,
      today: days.find((d) => d.day === t)?.words ?? 0,
      days: days.reverse(),
    };
  }

  // ---------- providers ----------
  listProviders(): Provider[] {
    return (this.db.prepare('SELECT * FROM providers ORDER BY sort, createdAt').all() as Record<string, unknown>[]).map(rowToProvider);
  }

  getProvider(id: string): Provider | undefined {
    const row = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToProvider(row) : undefined;
  }

  saveProvider(data: Partial<Provider> & { id?: string }): Provider {
    const fields: Record<string, unknown> = {};
    for (const f of ['name', 'kind', 'baseUrl', 'apiKey', 'enabled', 'sort'] as const) {
      if (data[f] !== undefined) fields[f] = data[f];
    }
    if (typeof fields.baseUrl === 'string') fields.baseUrl = fields.baseUrl.trim().replace(/\/+$/, '');
    if (typeof fields.apiKey === 'string') fields.apiKey = fields.apiKey.trim();
    if (data.models !== undefined) fields.models = JSON.stringify(data.models.map((m) => m.trim()).filter(Boolean));
    if (data.id && this.getProvider(data.id)) {
      if (Object.keys(fields).length) {
        const sets = Object.keys(fields).map((c) => `${c} = @${c}`);
        this.db.prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = @id`).run({ ...fields, id: data.id });
      }
      return this.getProvider(data.id)!;
    }
    const id = newId();
    const row = { name: '新服务商', kind: 'openai', baseUrl: '', apiKey: '', models: '[]', enabled: 1, sort: Date.now(), ...fields };
    const cols = Object.keys(row);
    this.db
      .prepare(`INSERT INTO providers (id, ${cols.join(', ')}, createdAt) VALUES (@id, ${cols.map((c) => '@' + c).join(', ')}, @now)`)
      .run({ id, ...row, now: Date.now() });
    return this.getProvider(id)!;
  }

  deleteProvider(id: string) {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(id);
  }

  // ---------- settings ----------
  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const { key, value } of rows) {
      if (key in DEFAULT_SETTINGS) {
        try {
          out[key] = JSON.parse(value);
        } catch {
          /* ignore broken value */
        }
      }
    }
    return out as unknown as AppSettings;
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const tx = this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
      }
    });
    tx();
    return this.getSettings();
  }
}

function rowToProvider(row: Record<string, unknown>): Provider {
  let models: string[] = [];
  try {
    models = JSON.parse(String(row.models ?? '[]'));
  } catch {
    models = [];
  }
  return { ...(row as unknown as Provider), models };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
