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
  /** 自动生成的卷回顾（写完的分卷压缩成一段，供后面的章节参考） */
  recap: string;
  /** 生成卷回顾时各章摘要的指纹，摘要变了就重新生成 */
  recapHash: string;
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
  /** 写入摘要时的正文字数，用来判断摘要是否过期 */
  summaryWords: number;
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
  /** 经历与变化（自动记忆整理，或手动添加） */
  facts: MemoryFact[];
  sort: number;
}

export interface WorldEntry {
  id: string;
  bookId: string;
  category: string;
  name: string;
  content: string;
  pinned: number;
  facts: MemoryFact[];
  sort: number;
}

/** 一条记忆：在哪一章发生了什么（chapterId 为空表示手动添加） */
export interface MemoryFact {
  chapterId: string;
  text: string;
}

/** 自动记忆从章节里整理出的变化，作者确认后才写入人物卡、设定和伏笔 */
export interface MemoryUpdate {
  id: string;
  bookId: string;
  chapterId: string;
  kind: 'character' | 'world' | 'foreshadow';
  name: string;
  fact: string;
  category: string;
  /** 伏笔：本章已回收 */
  resolved: number;
  createdAt: number;
}

export interface MemoryStatus {
  /** 需要生成或更新摘要的章节 */
  chapters: string[];
  /** 需要生成卷回顾的分卷 */
  volumes: string[];
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

export interface ModelLimit {
  /** 上下文窗口（输入 + 输出），tokens */
  context?: number;
  /** 单次最大输出，tokens */
  output?: number;
}

/** manual 手动填写；provider 服务商接口返回或实际请求时从报错得知；library 内置模型库 */
export type LimitSource = 'manual' | 'provider' | 'library';

export interface ResolvedLimit extends ModelLimit {
  contextSource?: LimitSource;
  outputSource?: LimitSource;
}

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
  /** 自动识别到的模型上限（按模型 ID） */
  detectedLimits: Record<string, ModelLimit>;
  /** 手动填写的模型上限，优先于自动识别 */
  limitOverrides: Record<string, ModelLimit>;
}

export type AntiAiLevel = 'off' | 'normal' | 'strict';

export interface AppSettings {
  defaultProviderId: string;
  defaultModel: string;
  temperature: number;
  /** 单次最大输出 tokens；0 = 自动，按模型上限 */
  maxTokens: number;
  antiAiLevel: AntiAiLevel;
  extraBannedWords: string;
  editorFontSize: number;
  editorWidth: number;
  /** 正文字体：系统黑体 / 内置思源宋体 / 内置霞鹜文楷 */
  editorFont: 'sans' | 'serif' | 'kai';
  /** 自动记忆：离开章节或标为完成时自动生成摘要、整理人物和设定变化 */
  autoMemory: boolean;
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
  | 'chat'
  | 'memorize'
  | 'volume_recap';

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
