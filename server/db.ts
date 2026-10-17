import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MEMORY_MIN_WORDS, summaryState } from '../shared/memory';
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
  MemoryFact,
  MemoryStatus,
  MemoryUpdate,
  ModelLimit,
  Provider,
  SearchHit,
  Snapshot,
  Volume,
} from '../shared/types';
import { cleanLimits } from './modelLimits';

interface Statement {
  run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

/** Node 内置 SQLite（node:sqlite）用到的部分。不依赖任何原生模块，安装时无需编译 */
export interface DB {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
}

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
  sort REAL NOT NULL DEFAULT 0,
  recap TEXT NOT NULL DEFAULT '',
  recapHash TEXT NOT NULL DEFAULT ''
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
  updatedAt INTEGER NOT NULL,
  summaryWords INTEGER NOT NULL DEFAULT 0
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
  sort REAL NOT NULL DEFAULT 0,
  facts TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS world_entries (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '其他',
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  sort REAL NOT NULL DEFAULT 0,
  facts TEXT NOT NULL DEFAULT '[]'
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
  createdAt INTEGER NOT NULL,
  detectedLimits TEXT NOT NULL DEFAULT '{}',
  limitOverrides TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_updates (
  id TEXT PRIMARY KEY,
  bookId TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapterId TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  fact TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  resolved INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
);
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
  volumes: { table: 'volumes', fields: ['title', 'summary', 'recap', 'sort'] },
  chapters: {
    table: 'chapters',
    fields: ['volumeId', 'title', 'outline', 'content', 'summary', 'notes', 'status', 'sort'],
  },
  characters: {
    table: 'characters',
    fields: [
      'name', 'aliases', 'role', 'gender', 'age', 'appearance', 'personality', 'background',
      'speech', 'motivation', 'arc', 'relations', 'notes', 'pinned', 'facts', 'sort',
    ],
  },
  world: { table: 'world_entries', fields: ['category', 'name', 'content', 'pinned', 'facts', 'sort'] },
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
  maxTokens: 0,
  antiAiLevel: 'normal',
  extraBannedWords: '',
  editorFontSize: 18,
  editorWidth: 760,
  editorFont: 'sans',
  autoMemory: true,
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
    if (f === 'facts') out[f] = JSON.stringify(cleanFacts(typeof v === 'string' ? parseJson(v, []) : v));
    else out[f] = typeof v === 'boolean' ? Number(v) : v;
  }
  return out;
}

export function cleanFacts(v: unknown): MemoryFact[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((f) => ({ chapterId: String(f?.chapterId ?? ''), text: String(f?.text ?? '').trim() }))
    .filter((f) => f.text)
    .slice(-200);
}

/** 读出来的行里 facts 是 JSON 文本，转成数组 */
function withFacts<T extends Record<string, unknown>>(row: T): T {
  if (row && typeof row.facts === 'string') (row as Record<string, unknown>).facts = cleanFacts(parseJson(row.facts, []));
  return row;
}

const CHAPTER_META_COLS = 'id, bookId, volumeId, title, outline, summary, summaryWords, notes, status, sort, wordCount, createdAt, updatedAt';

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db: DB = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // 旧版本数据库补列
  const added = new Set<string>();
  for (const [table, col, def] of [
    ['providers', 'detectedLimits', "TEXT NOT NULL DEFAULT '{}'"],
    ['providers', 'limitOverrides', "TEXT NOT NULL DEFAULT '{}'"],
    ['chapters', 'summaryWords', 'INTEGER NOT NULL DEFAULT 0'],
    ['volumes', 'recap', "TEXT NOT NULL DEFAULT ''"],
    ['volumes', 'recapHash', "TEXT NOT NULL DEFAULT ''"],
    ['characters', 'facts', "TEXT NOT NULL DEFAULT '[]'"],
    ['world_entries', 'facts', "TEXT NOT NULL DEFAULT '[]'"],
  ]) {
    const cols = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    if (!cols.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      added.add(`${table}.${col}`);
    }
  }
  // 以前写好的摘要视为与当时的正文一致，不当作过期
  if (added.has('chapters.summaryWords')) db.exec("UPDATE chapters SET summaryWords = wordCount WHERE summary != ''");
  return db;
}

export class Repo {
  private txDepth = 0;
  constructor(public db: DB) {}

  /** 在事务里执行 fn，出错整体回滚；可以嵌套 */
  transaction<T>(fn: () => T): T {
    const sp = `sp${this.txDepth}`;
    this.db.exec(`SAVEPOINT ${sp}`);
    this.txDepth++;
    try {
      const out = fn();
      this.db.exec(`RELEASE ${sp}`);
      return out;
    } catch (err) {
      this.db.exec(`ROLLBACK TO ${sp}`);
      this.db.exec(`RELEASE ${sp}`);
      throw err;
    } finally {
      this.txDepth--;
    }
  }

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
      chapters: all(`SELECT ${CHAPTER_META_COLS} FROM chapters WHERE bookId = ? ORDER BY sort, rowid`),
      characters: (all('SELECT * FROM characters WHERE bookId = ? ORDER BY sort, rowid') as Record<string, unknown>[]).map(withFacts) as never[],
      world: (all('SELECT * FROM world_entries WHERE bookId = ? ORDER BY sort, rowid') as Record<string, unknown>[]).map(withFacts) as never[],
      foreshadows: all('SELECT * FROM foreshadows WHERE bookId = ? ORDER BY sort, rowid'),
    };
  }

  /** 按阅读顺序（卷序 → 章序）排列的章节 */
  orderedChapters(bookId: string, withContent = false): (ChapterMeta & { content?: string })[] {
    const cols = withContent ? 'c.*' : CHAPTER_META_COLS.split(', ').map((c) => 'c.' + c).join(', ');
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
      if (typeof row.summary === 'string' && row.summary.trim()) row.summaryWords = row.wordCount;
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
    return row && withFacts(row);
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
      // 写入摘要（AI 生成或手动修改）即视为与当前正文一致
      if (typeof row.summary === 'string') row.summaryWords = row.wordCount ?? existing.wordCount;
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
    this.transaction(() => {
      ids.forEach((id, i) => {
        if (name === 'chapters' && volumeId) {
          this.db.prepare(`UPDATE chapters SET sort = ?, volumeId = ? WHERE id = ?`).run(i + 1, volumeId, id);
        } else {
          this.db.prepare(`UPDATE ${table} SET sort = ? WHERE id = ?`).run(i + 1, id);
        }
      });
    });
  }

  batchInsert(name: CollectionName, bookId: string, items: Record<string, unknown>[]) {
    return this.transaction(() => items.map((it) => this.insert(name, bookId, it)));
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
    if (data.limitOverrides !== undefined) fields.limitOverrides = JSON.stringify(cleanLimits(data.limitOverrides));
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

  // ---------- memory ----------
  /** 哪些章节需要（重新）生成摘要、哪些写完的分卷需要卷回顾 */
  memoryStatus(bookId: string): MemoryStatus {
    const chapters = this.orderedChapters(bookId);
    const volumes = this.db.prepare('SELECT * FROM volumes WHERE bookId = ? ORDER BY sort, rowid').all(bookId) as unknown as Volume[];
    const need = chapters.filter((c) => ['missing', 'stale'].includes(summaryState(c))).map((c) => c.id);
    const written = (v: Volume) => chapters.filter((c) => c.volumeId === v.id && c.wordCount >= MEMORY_MIN_WORDS);
    const volumeIds = volumes
      .filter((v, i) => {
        const ws = written(v);
        if (!ws.length || ws.some((c) => summaryState(c) !== 'fresh')) return false;
        // 后面的分卷已经开写，这一卷才算写完
        if (!volumes.slice(i + 1).some((later) => written(later).length)) return false;
        return !v.recap.trim() || v.recapHash !== this.volumeRecapHash(v.id);
      })
      .map((v) => v.id);
    return { chapters: need, volumes: volumeIds };
  }

  volumeRecapHash(volumeId: string) {
    const rows = this.db
      .prepare('SELECT summary FROM chapters WHERE volumeId = ? AND wordCount >= ? ORDER BY sort, rowid')
      .all(volumeId, MEMORY_MIN_WORDS) as { summary: string }[];
    return createHash('sha1').update(rows.map((r) => r.summary.trim()).join('\n')).digest('hex').slice(0, 16);
  }

  setVolumeRecap(volumeId: string, recap: string) {
    this.db.prepare('UPDATE volumes SET recap = ?, recapHash = ? WHERE id = ?').run(recap, this.volumeRecapHash(volumeId), volumeId);
    return this.getEntity('volumes', volumeId) as unknown as Volume;
  }

  listMemoryUpdates(bookId: string): MemoryUpdate[] {
    return this.db.prepare('SELECT * FROM memory_updates WHERE bookId = ? ORDER BY createdAt, rowid').all(bookId) as unknown as MemoryUpdate[];
  }

  /** 一章重新整理后，替换它之前未确认的变化 */
  replaceMemoryUpdates(bookId: string, chapterId: string, items: Pick<MemoryUpdate, 'kind' | 'name' | 'fact' | 'category' | 'resolved'>[]) {
    this.transaction(() => {
      this.db.prepare('DELETE FROM memory_updates WHERE chapterId = ?').run(chapterId);
      const stmt = this.db.prepare(
        'INSERT INTO memory_updates (id, bookId, chapterId, kind, name, fact, category, resolved, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const now = Date.now();
      for (const u of items) stmt.run(newId(), bookId, chapterId, u.kind, u.name, u.fact, u.category, u.resolved ? 1 : 0, now);
    });
    return this.listMemoryUpdates(bookId).filter((u) => u.chapterId === chapterId);
  }

  dismissMemoryUpdates(bookId: string, ids: string[]) {
    const stmt = this.db.prepare('DELETE FROM memory_updates WHERE id = ? AND bookId = ?');
    this.transaction(() => ids.forEach((id) => stmt.run(id, bookId)));
  }

  /** 把作者确认的变化写进人物卡、设定和伏笔（确认时可以改名字和内容） */
  applyMemoryUpdates(bookId: string, items: { id: string; name?: string; fact?: string }[]) {
    type Row = { id: string; name: string; aliases?: string; facts: MemoryFact[] };
    const rows = (sql: string) => (this.db.prepare(sql).all(bookId) as Record<string, unknown>[]).map(withFacts) as unknown as Row[];
    return this.transaction(() => {
      let applied = 0;
      for (const item of items) {
        const u = this.db.prepare('SELECT * FROM memory_updates WHERE id = ? AND bookId = ?').get(item.id, bookId) as MemoryUpdate | undefined;
        if (!u) continue;
        this.db.prepare('DELETE FROM memory_updates WHERE id = ?').run(u.id);
        const name = String(item.name ?? u.name).trim();
        const fact = String(item.fact ?? u.fact).trim();
        if (!name || !fact) continue;
        const entry = { chapterId: u.chapterId, text: fact };
        const append = (collection: CollectionName, row: Row) => {
          if (!row.facts.some((f) => f.chapterId === entry.chapterId && f.text === entry.text)) this.update(collection, row.id, { facts: [...row.facts, entry] });
        };
        if (u.kind === 'character') {
          const hit = rows('SELECT * FROM characters WHERE bookId = ?').find(
            (c) => c.name.trim() === name || (c.aliases ?? '').split(/[,，、\s/]+/).some((a) => a.trim() === name),
          );
          if (hit) append('characters', hit);
          else this.insert('characters', bookId, { name, role: '配角', facts: [entry] });
        } else if (u.kind === 'world') {
          const hit = rows('SELECT * FROM world_entries WHERE bookId = ?').find((w) => w.name.trim() === name);
          if (hit) append('world', hit);
          else this.insert('world', bookId, { name, category: u.category || '其他', content: fact });
        } else {
          const open = this.db.prepare("SELECT * FROM foreshadows WHERE bookId = ? AND status = 'open'").all(bookId) as { id: string; title: string; content: string }[];
          const same = (t: string) => t.trim() === name || (t.trim().length >= 2 && name.length >= 2 && (t.includes(name) || name.includes(t.trim())));
          const hit = open.find((f) => same(f.title));
          if (u.resolved) {
            if (!hit) continue;
            this.update('foreshadows', hit.id, { status: 'resolved', resolvedChapterId: u.chapterId });
          } else if (hit) {
            this.update('foreshadows', hit.id, { content: [hit.content.trim(), fact].filter(Boolean).join('\n') });
          } else {
            this.insert('foreshadows', bookId, { title: name, content: fact, plantedChapterId: u.chapterId, status: 'open' });
          }
        }
        applied++;
      }
      return applied;
    });
  }

  /** 合并自动识别到的模型上限（服务商接口返回或从报错得知） */
  mergeDetectedLimits(id: string, limits: Record<string, ModelLimit>) {
    const p = this.getProvider(id);
    if (!p || !Object.keys(limits).length) return;
    const next = { ...p.detectedLimits };
    for (const [model, l] of Object.entries(cleanLimits(limits))) next[model] = { ...next[model], ...l };
    this.db.prepare('UPDATE providers SET detectedLimits = ? WHERE id = ?').run(JSON.stringify(next), id);
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
    this.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULT_SETTINGS && v !== undefined) stmt.run(k, JSON.stringify(v));
      }
    });
    return this.getSettings();
  }
}

function parseJson<T>(v: unknown, fallback: T): T {
  try {
    return JSON.parse(String(v ?? '')) ?? fallback;
  } catch {
    return fallback;
  }
}

function rowToProvider(row: Record<string, unknown>): Provider {
  return {
    ...(row as unknown as Provider),
    models: parseJson<string[]>(row.models, []),
    detectedLimits: cleanLimits(parseJson(row.detectedLimits, {})),
    limitOverrides: cleanLimits(parseJson(row.limitOverrides, {})),
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
