export type ChapterStatus = 'draft' | 'revising' | 'done';
export type ForeshadowStatus = 'open' | 'resolved' | 'dropped';

export interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  tags: string;
  synopsis: string;
  /** 总纲 */
  outline: string;
  /** 文风设定 */
  styleGuide: string;
  /** 作者文字样本，用于模仿文风 */
  styleSample: string;
  /** 叙事视角 */
  pov: string;
  /** 本书额外禁用词，换行或逗号分隔 */
  bannedWords: string;
  targetWords: number;
  dailyGoal: number;
  createdAt: number;
  updatedAt: number;
}

export interface BookSummary {
  id: string;
  title: string;
  author: string;
  genre: string;
  synopsis: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
  chapterCount: number;
}

export interface Volume {
  id: string;
  bookId: string;
  title: string;
  /** 卷纲 */
  summary: string;
  sort: number;
}

export interface ChapterMeta {
  id: string;
  bookId: string;
  volumeId: string;
  title: string;
  /** 细纲 */
  outline: string;
  /** 章节摘要（供 AI 作为前情提要） */
  summary: string;
  notes: string;
  status: ChapterStatus;
  sort: number;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface Chapter extends ChapterMeta {
  content: string;
}

export interface Character {
  id: string;
  bookId: string;
  name: string;
  aliases: string;
  role: string;
  gender: string;
  age: string;
  appearance: string;
  personality: string;
  background: string;
  /** 说话方式 / 口头禅 */
  speech: string;
  motivation: string;
  arc: string;
  relations: string;
  notes: string;
  /** 1 = 始终放入 AI 上下文 */
  pinned: number;
  sort: number;
}

export interface WorldEntry {
  id: string;
  bookId: string;
  category: string;
  name: string;
  content: string;
  pinned: number;
  sort: number;
}

export interface Foreshadow {
  id: string;
  bookId: string;
  title: string;
  content: string;
  plantedChapterId: string;
  resolvePlan: string;
  resolvedChapterId: string;
  status: ForeshadowStatus;
  sort: number;
}

export interface Snapshot {
  id: string;
  chapterId: string;
  note: string;
  wordCount: number;
  createdAt: number;
  content?: string;
}

export interface BookTree {
  book: Book;
  volumes: Volume[];
  chapters: ChapterMeta[];
  characters: Character[];
  world: WorldEntry[];
  foreshadows: Foreshadow[];
}

export type CollectionName = 'volumes' | 'chapters' | 'characters' | 'world' | 'foreshadows';

export interface BookStats {
  totalWords: number;
  chapterCount: number;
  today: number;
  days: { day: string; words: number }[];
}

export interface SearchHit {
  chapterId: string;
  title: string;
  index: number;
  snippet: string;
}

/** openai = Chat Completions；responses = OpenAI Responses；anthropic = Messages；gemini = generateContent */
export type ProviderKind = 'openai' | 'responses' | 'anthropic' | 'gemini';

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** 返回给前端时会被打码 */
  apiKey: string;
  hasKey?: boolean;
  models: string[];
  enabled: number;
  sort: number;
  createdAt: number;
}

export type AntiAiLevel = 'off' | 'normal' | 'strict';

export interface AppSettings {
  defaultProviderId: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  antiAiLevel: AntiAiLevel;
  extraBannedWords: string;
  editorFontSize: number;
  editorWidth: number;
  /** 正文字体：系统黑体 / 内置思源宋体 / 内置霞鹜文楷 */
  editorFont: 'sans' | 'serif' | 'kai';
  theme: 'light' | 'dark' | 'sepia';
}

export type AiTask =
  | 'continue'
  | 'draft'
  | 'rewrite'
  | 'deai'
  | 'review'
  | 'summary'
  | 'chapter_outline'
  | 'outline_book'
  | 'outline_volumes'
  | 'outline_chapters'
  | 'character'
  | 'world'
  | 'brainstorm'
  | 'chat';

export type RewriteMode =
  | 'polish'
  | 'expand'
  | 'condense'
  | 'deai'
  | 'vivid'
  | 'dialogue'
  | 'sensory'
  | 'tension'
  | 'custom';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  task: AiTask;
  bookId: string;
  chapterId?: string;
  volumeId?: string;
  characterId?: string;
  worldId?: string;
  providerId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  mode?: RewriteMode;
  /** 用户附加要求 */
  instruction?: string;
  /** 选中文本 / 待处理文本 */
  text?: string;
  before?: string;
  after?: string;
  /** 目标字数 */
  length?: number;
  /** 生成条目数量（分卷/章节） */
  count?: number;
  /** AI 味检测出的问题，供针对性改写 */
  issues?: string[];
  messages?: ChatTurn[];
}

/** /api/ai/run 以 NDJSON 返回的事件 */
export type AiStreamEvent =
  | { t: 'meta'; provider: string; model: string }
  | { t: 'text'; v: string }
  | { t: 'reasoning'; v: string }
  | { t: 'error'; v: string }
  | { t: 'done' };
