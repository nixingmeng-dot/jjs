import { PROMPT_BANNED_PHRASES, parseWordList } from '../shared/antiAi';
import { chapterLabels, clip } from '../shared/text';
import type { AiRequest, AppSettings, Book, Chapter, ChapterMeta, Character, Foreshadow, Volume, WorldEntry } from '../shared/types';
import { HttpError, type Repo } from './db';
import type { LlmMessage } from './llm';

// ---------------- 角色设定 ----------------

const NOVELIST = `你是一位经验丰富的中文小说作家，正在和作者合写一部长篇小说。你的文字干净、具体、有画面感，读起来像出自一位有个人风格的真人作者，而不像 AI 生成的。
你只输出小说正文本身：不要解释，不要前言后语，不要标题，不要使用 Markdown 符号。`;

const PLANNER = `你是一位资深的长篇小说策划编辑，擅长搭建结构、设计冲突和人物弧光。你的方案具体、可执行：每个情节点都写清"谁、想要什么、遇到什么阻碍、结果如何改变局面"。避免套路化的展开和空泛的形容词。`;

const EDITOR = `你是一位眼光毒辣但有建设性的小说编辑，熟悉网络文学和出版文学。你能一眼看出"AI 味"、节奏拖沓、人物扁平、逻辑漏洞。你的意见必须具体到句子，并给出可以直接替换的改法。`;

const PARTNER = `你是作者的写作搭档，熟悉这部作品的全部资料。你的回答具体、有想象力，给出可以直接拿去用的点子，而不是泛泛的写作理论。回答使用纯文本，少用 Markdown 符号。`;

export function antiAiRules(settings: AppSettings, book?: Book): string {
  if (settings.antiAiLevel === 'off') return '';
  const banned = Array.from(
    new Set([...PROMPT_BANNED_PHRASES, ...parseWordList(settings.extraBannedWords), ...parseWordList(book?.bannedWords)]),
  );
  const rules = [
    '具体胜于抽象：写具体的动作、物件、声音、气味、温度，而不是"一种难以言喻的感觉"。',
    '展示而非告知：不直接说出情绪（"他很愤怒""她感到悲伤"），让动作、对白、身体反应和环境细节把情绪带出来。',
    '句子要有呼吸：长短句交错，允许极短的句子单独成段，允许口语化和不完整的句子；不要每段一样长、一样的结构。',
    '不用排比和对仗式金句，少用"不是……而是……""与其说……不如说……"这类句式。',
    '比喻少而准：一段最多一个，喻体必须来自角色所处的世界和经验；"仿佛""宛如""如同"不要扎堆。',
    '段落和章节结尾不升华、不总结、不点题、不展望，不写"这一刻，他终于明白了……"。停在动作、对白或一个具体画面上，留白。',
    '对白像真人说话：有打断、停顿、答非所问和潜台词；不同角色的说话方式明显不同；少用"××地说道"，能用动作代替对话标签就用动作。',
    '信任读者：不解释刚发生的事意味着什么，不重复强调，不给每个细节配情绪注解。',
    '节奏服务情节：紧张处用短句和动作推进；舒缓处可以写细节，但不写与情节无关的空泛景物。',
    '忠于设定：人物性格、能力、关系、世界规则与已知资料保持一致，不擅自引入重要的新角色或新设定。',
    `避免这些高频套话：${banned.join('、')}。`,
  ];
  if (settings.antiAiLevel === 'strict') {
    rules.push(
      '严格模式：上面列出的套话一律不出现；"然而""仿佛""不禁""缓缓"全文合计不超过两次；破折号最多用一处。',
      '每三段至少有一处具体的、出人意料的细节（一个物件、一个习惯动作、一句方言或行话）。',
      '写完前自查：如果某句话放进任何一本小说都成立，就删掉，或换成只属于这里的细节。',
    );
  }
  return '【写作守则】\n' + rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
}

// ---------------- 上下文 ----------------

interface Ctx {
  book: Book;
  volumes: Volume[];
  chapters: ChapterMeta[];
  characters: Character[];
  world: WorldEntry[];
  foreshadows: Foreshadow[];
  labels: Map<string, string>;
  chapter?: Chapter;
  volume?: Volume;
}

function loadCtx(repo: Repo, req: AiRequest): Ctx {
  const tree = repo.getTree(req.bookId);
  if (!tree) throw new HttpError(404, '作品不存在');
  const chapters = repo.orderedChapters(req.bookId);
  const chapter = req.chapterId ? repo.getChapter(req.chapterId) : undefined;
  const volumeId = req.volumeId ?? chapter?.volumeId;
  return {
    ...tree,
    chapters,
    labels: chapterLabels(chapters),
    chapter,
    volume: tree.volumes.find((v) => v.id === volumeId),
  };
}

const section = (title: string, body: string | undefined | null) => (body && body.trim() ? `【${title}】\n${body.trim()}` : '');

function bookInfo(b: Book) {
  const lines = [`书名：《${b.title}》`];
  if (b.genre) lines.push(`类型：${b.genre}`);
  if (b.tags) lines.push(`标签：${b.tags}`);
  if (b.synopsis) lines.push(`简介：${clip(b.synopsis, 600)}`);
  return section('作品', lines.join('\n'));
}

function styleInfo(b: Book) {
  return [
    section('叙事视角', b.pov),
    section('文风要求', b.styleGuide),
    b.styleSample?.trim()
      ? `【文风样本】（作者本人的文字。模仿它的句式节奏、用词习惯和叙述距离，不要照抄内容）\n"""\n${clip(b.styleSample.trim(), 1500)}\n"""`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mentions(text: string, name: string, aliases = '') {
  // 单字别名太容易误命中，忽略
  const names = [name, ...aliases.split(/[,，、\s/]+/)].map((s) => s.trim()).filter((s) => s.length >= 2);
  return names.some((n) => text.includes(n));
}

function characterInfo(ctx: Ctx, focus: string, limit = 12) {
  const picked = ctx.characters
    .filter((c) => c.name && (c.pinned || /主角/.test(c.role) || mentions(focus, c.name, c.aliases)))
    .slice(0, limit);
  if (!picked.length) return '';
  const fmt = (c: Character) => {
    const head = [c.role, c.gender, c.age].filter(Boolean).join('，');
    const parts = [
      c.aliases && `别名：${c.aliases}`,
      c.appearance && `外貌：${clip(c.appearance, 80)}`,
      c.personality && `性格：${clip(c.personality, 120)}`,
      c.speech && `说话方式：${clip(c.speech, 120)}`,
      c.motivation && `动机：${clip(c.motivation, 100)}`,
      c.relations && `关系：${clip(c.relations, 100)}`,
      c.background && `背景：${clip(c.background, 120)}`,
    ].filter(Boolean);
    return `- ${c.name}${head ? `（${head}）` : ''}${parts.length ? '：' + parts.join('；') : ''}`;
  };
  return section('相关人物', picked.map(fmt).join('\n'));
}

function worldInfo(ctx: Ctx, focus: string, limit = 12) {
  const picked = ctx.world.filter((w) => w.name && (w.pinned || focus.includes(w.name))).slice(0, limit);
  if (!picked.length) return '';
  return section('相关设定', picked.map((w) => `- [${w.category}] ${w.name}：${clip(w.content, 300)}`).join('\n'));
}

function foreshadowInfo(ctx: Ctx) {
  const open = ctx.foreshadows.filter((f) => f.status === 'open' && f.title).slice(0, 10);
  if (!open.length) return '';
  return section(
    '未回收的伏笔（不必强行回收，但不要写出矛盾）',
    open.map((f) => `- ${f.title}${f.content ? '：' + clip(f.content, 80) : ''}${f.resolvePlan ? `（计划：${clip(f.resolvePlan, 60)}）` : ''}`).join('\n'),
  );
}

function previousChapters(ctx: Ctx, beforeChapterId?: string, count = 6) {
  const idx = beforeChapterId ? ctx.chapters.findIndex((c) => c.id === beforeChapterId) : ctx.chapters.length;
  return ctx.chapters.slice(0, idx === -1 ? ctx.chapters.length : idx).slice(-count);
}

function recapInfo(ctx: Ctx, repo: Repo, opts: { beforeChapterId?: string; includeTail: boolean }) {
  const prev = previousChapters(ctx, opts.beforeChapterId);
  if (!prev.length) return '';
  const lines = prev.map((c) => `- ${ctx.labels.get(c.id)}：${c.summary ? clip(c.summary, 300) : c.outline ? '（细纲）' + clip(c.outline, 160) : '（无摘要）'}`);
  let out = section('前情提要', lines.join('\n'));
  if (opts.includeTail) {
    const last = repo.getChapter(prev[prev.length - 1].id);
    if (last?.content.trim()) out += '\n\n' + section('上一章结尾', clip(last.content.trim(), 800, true));
  }
  return out;
}

function outlineInfo(ctx: Ctx, bookOutlineMax = 1200) {
  return [
    section('总纲', clip(ctx.book.outline, bookOutlineMax)),
    ctx.volume ? section(`当前分卷：${ctx.volume.title}`, ctx.volume.summary || '（暂无卷纲）') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function chapterHead(ctx: Ctx) {
  if (!ctx.chapter) return '';
  return section('本章', `${ctx.labels.get(ctx.chapter.id)}\n细纲：${ctx.chapter.outline?.trim() || '（作者未填写细纲）'}`);
}

const join = (...parts: (string | false | undefined | null)[]) => parts.filter((p) => p && String(p).trim()).join('\n\n');

// ---------------- 改写模式 ----------------

export const REWRITE_MODES: Record<string, string> = {
  polish:
    '润色：在保留原意、情节和人物语气的前提下，修正病句和啰嗦处，换掉不准确的词，让节奏有变化。不添加新情节，也不要变得更华丽。',
  expand:
    '扩写到原文的 1.5~2 倍：补充具体的动作细节、环境里可感知的细节、人物的小动作和对白里的潜台词。不要加入解释情绪的心理独白，不要堆砌比喻。',
  condense: '精简到原文的 60% 左右：删去重复、解释性的句子和无效修饰，保留关键动作、对白和信息。',
  deai:
    '去 AI 味：删掉套话和万能神态描写，把直接说出的情绪改为动作和细节，打散整齐的句式，删掉段尾的总结和升华，让文字像一位有个人风格的作者写的。情节和信息保持不变。',
  vivid:
    '增强画面感（展示而非告知）：把直接陈述情绪、性格、氛围的句子，改写成读者能看到、听到、闻到、摸到的具体细节和动作。',
  dialogue:
    '打磨对白：让每个角色的说话方式符合其身份和性格；加入潜台词、打断、答非所问或口头禅；删掉"角色互相说明双方都知道的信息"的台词；精简对话标签，能用动作代替就用动作。',
  sensory: '加入感官细节（声音、气味、触感、温度、味道），每处都要具体并服务于情绪或情节，不要堆砌。',
  tension: '增强张力：压缩铺垫，用短句加快节奏，让角色的目标受阻、增加不确定性，结尾留下悬念。',
  custom: '按作者的要求修改。',
};

// ---------------- 构建 ----------------

export interface BuiltPrompt {
  messages: LlmMessage[];
  temperature?: number;
}

export function buildPrompt(repo: Repo, req: AiRequest, settings: AppSettings): BuiltPrompt {
  const ctx = loadCtx(repo, req);
  const { book } = ctx;
  const extra = req.instruction?.trim() ? `作者的额外要求：${req.instruction.trim()}` : '';
  const writerSystem = join(NOVELIST, antiAiRules(settings, book), styleInfo(book));
  const length = Math.max(100, Math.min(req.length ?? 1000, 8000));
  const creativeTemp = settings.temperature;
  const focusOf = (...t: (string | undefined)[]) => t.filter(Boolean).join('\n');

  const sys = (content: string): LlmMessage => ({ role: 'system', content });
  const user = (content: string): LlmMessage => ({ role: 'user', content });

  switch (req.task) {
    case 'continue': {
      if (!ctx.chapter) throw new HttpError(400, '请先选择章节');
      const before = req.before ?? ctx.chapter.content;
      const focus = focusOf(ctx.chapter.outline, clip(before, 3000, true), req.after);
      const body = join(
        bookInfo(book),
        outlineInfo(ctx, 800),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter.id, includeTail: before.trim().length < 1500 }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        chapterHead(ctx),
        section('正文·光标之前', before.trim() ? clip(before, 3000, true) : '（本章尚未开始）'),
        req.after?.trim() ? section('正文·光标之后（续写的内容要能自然衔接到这里）', clip(req.after, 600)) : '',
        `---\n任务：从光标处继续写约 ${length} 字。\n${extra}
- 紧接光标前最后一个字往下写，不重复、不复述上文。
- 推进细纲里还没写到的内容，但不要在这一段里把整章的事情全部写完。
- 不写章节标题，结尾不要总结或升华。`,
      );
      return { messages: [sys(writerSystem), user(body)], temperature: creativeTemp };
    }

    case 'draft': {
      if (!ctx.chapter) throw new HttpError(400, '请先选择章节');
      const focus = focusOf(ctx.chapter.outline, ctx.chapter.title);
      const body = join(
        bookInfo(book),
        outlineInfo(ctx),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter.id, includeTail: true }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        chapterHead(ctx),
        `---\n任务：根据【本章】的细纲写出这一章的完整正文，约 ${length} 字。\n${extra}
- 开头直接进入场景（一个动作或一句对白），不要用景物描写或回顾前情开场。
- 用场景推进而不是概述；关键冲突写成有来有回的对手戏。
- 与上一章结尾自然衔接。
- 结尾停在一个动作、一句台词或一个悬念上，不要总结。
- 不写章节标题。`,
      );
      return { messages: [sys(writerSystem), user(body)], temperature: creativeTemp };
    }

    case 'rewrite': {
      const text = req.text?.trim();
      if (!text) throw new HttpError(400, '请先选中要处理的文字');
      const mode = req.mode && REWRITE_MODES[req.mode] ? req.mode : 'polish';
      if (mode === 'custom' && !extra) throw new HttpError(400, '请填写修改要求');
      const focus = focusOf(text, req.before?.slice(-600));
      const body = join(
        bookInfo(book),
        characterInfo(ctx, focus, 6),
        worldInfo(ctx, focus, 6),
        req.before?.trim() ? section('上文', clip(req.before, 600, true)) : '',
        `【待处理的文字】\n<<<\n${text}\n>>>`,
        req.after?.trim() ? section('下文', clip(req.after, 300)) : '',
        `---\n任务：${REWRITE_MODES[mode]}\n${extra}
只输出处理后的文字本身：不要解释，不要加引号、标题或"<<<"标记；保持原文的人称、时态和分段方式。`,
      );
      return {
        messages: [sys(writerSystem), user(body)],
        temperature: mode === 'polish' || mode === 'condense' ? Math.min(creativeTemp, 0.7) : creativeTemp,
      };
    }

    case 'deai': {
      const text = (req.text ?? ctx.chapter?.content ?? '').trim();
      if (!text) throw new HttpError(400, '没有可处理的文字');
      const issues = (req.issues ?? []).slice(0, 40);
      const body = join(
        characterInfo(ctx, text, 6),
        `【原文】\n<<<\n${text}\n>>>`,
        issues.length ? section('检测到的 AI 味问题', issues.map((i) => '- ' + i).join('\n')) : '',
        `---\n任务：在不改变情节、信息和人物关系的前提下重写原文，彻底去掉 AI 腔：
1. 逐一处理上面列出的问题词句：删掉，或换成只属于这个场景的具体细节。
2. 打散整齐划一的句式，长短句交错；需要强调的短句可以单独成段。
3. 删掉段尾的感悟、总结和升华。
4. 把直接说出的情绪改成动作、对白或身体反应。
5. 原文里已经具体、生动的句子保留不动，不要为了改而改。
${extra}
只输出改写后的全文，不要解释，不要加"<<<"标记。`,
      );
      return {
        messages: [sys(join(NOVELIST, antiAiRules({ ...settings, antiAiLevel: 'strict' }, book), styleInfo(book))), user(body)],
        temperature: Math.min(creativeTemp, 0.9),
      };
    }

    case 'review': {
      const text = (req.text ?? ctx.chapter?.content ?? '').trim();
      if (!text) throw new HttpError(400, '本章还没有内容');
      const focus = focusOf(text.slice(0, 4000), ctx.chapter?.outline);
      const body = join(
        bookInfo(book),
        styleInfo(book),
        outlineInfo(ctx, 600),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter?.id, includeTail: false }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        chapterHead(ctx),
        section('待审正文', clip(text, 20000)),
        `---\n请审读这一章，给出具体可操作的修改意见。${extra}
按以下结构输出（纯文本，用"一、二、"和"1. 2."编号）：
一、总体评价（不超过三句话）
二、AI 味与文字问题：摘出具体句子，说明问题，并给出改写示例
三、节奏与结构：哪里拖沓、哪里太赶
四、人物与对白：是否立得住、说话是否有区分度
五、逻辑与设定一致性：对照前情和设定找出矛盾
六、最值得优先修改的三处`,
      );
      return { messages: [sys(EDITOR), user(body)], temperature: 0.5 };
    }

    case 'summary': {
      const text = (req.text ?? ctx.chapter?.content ?? '').trim();
      if (!text) throw new HttpError(400, '本章还没有内容');
      const body = join(
        section(`${ctx.chapter ? ctx.labels.get(ctx.chapter.id) : '本章'}·正文`, clip(text, 15000)),
        `---\n任务：为这一章写一段供后续写作参考的剧情摘要，150~250 字：
- 按顺序写出关键事件
- 主要人物的状态、关系或目标有什么变化
- 新出现的人物、物品、信息或伏笔
只陈述事实，不评价，不要以"本章讲述了"开头。`,
      );
      return {
        messages: [sys('你是严谨的小说编辑助理，擅长准确、简练地概括剧情。'), user(body)],
        temperature: 0.3,
      };
    }

    case 'chapter_outline': {
      if (!ctx.chapter) throw new HttpError(400, '请先选择章节');
      const focus = focusOf(ctx.chapter.outline, ctx.chapter.title, ctx.volume?.summary);
      const body = join(
        bookInfo(book),
        outlineInfo(ctx),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter.id, includeTail: true }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        section('本章', `${ctx.labels.get(ctx.chapter.id)}${ctx.chapter.outline ? `\n现有细纲：${ctx.chapter.outline}` : ''}`),
        `---\n任务：为本章写一份细纲${ctx.chapter.outline ? '（在现有细纲基础上完善）' : ''}。${extra}
按以下格式输出纯文本，不用 Markdown 符号：
场景：……
出场人物：……
本章目标：主角在这一章想要什么
事件推进：
1. ……
2. ……
3. ……
（每一步写清谁做了什么、结果怎样）
冲突与转折：……
结尾钩子：……`,
      );
      return { messages: [sys(PLANNER), user(body)], temperature: Math.min(creativeTemp, 0.9) };
    }

    case 'outline_book': {
      const body = join(
        bookInfo(book),
        section('现有总纲', book.outline),
        characterInfo({ ...ctx, characters: ctx.characters.map((c) => ({ ...c, pinned: 1 })) }, '', 15),
        worldInfo({ ...ctx, world: ctx.world.map((w) => ({ ...w, pinned: 1 })) }, '', 15),
        `---\n任务：${book.outline.trim() ? '在现有总纲的基础上修订、完善' : '构思这部小说的总纲'}。${extra}
输出结构：
一、一句话故事、核心冲突、主题
二、主要人物与成长弧光（每人：起点 → 转变 → 终点）
三、主线剧情（分开端、发展、高潮、结局四个阶段，每阶段写关键事件）
四、重要支线与人物关系变化
五、关键转折与伏笔安排
要求：情节具体到事件，动机可信，避免套路和空话。纯文本输出，用"一、二、"和"1. 2."编号，不用 Markdown 符号。`,
      );
      return { messages: [sys(PLANNER), user(body)], temperature: creativeTemp };
    }

    case 'outline_volumes': {
      const count = Math.max(1, Math.min(req.count ?? 4, 12));
      const existing = ctx.volumes.map((v) => `- ${v.title}：${v.summary ? clip(v.summary, 200) : '（无卷纲）'}`).join('\n');
      const body = join(
        bookInfo(book),
        section('总纲', clip(book.outline, 3000)),
        section('已有分卷', existing),
        characterInfo(ctx, book.outline, 10),
        `---\n任务：${existing ? '接在已有分卷之后，' : ''}规划 ${count} 个分卷。${extra}
每卷要写清：本卷的核心冲突、主角在本卷的目标与变化、高潮事件、卷末钩子。各卷之间要有升级感。
只输出 JSON 数组，不要任何其他文字：
[{"title":"卷名（不要带"第X卷"）","summary":"本卷剧情概要，约 200 字"}]`,
      );
      return { messages: [sys(PLANNER), user(body)], temperature: Math.min(creativeTemp, 0.9) };
    }

    case 'outline_chapters': {
      if (!ctx.volume) throw new HttpError(400, '请选择分卷');
      const count = Math.max(1, Math.min(req.count ?? 10, 40));
      const inVolume = ctx.chapters.filter((c) => c.volumeId === ctx.volume!.id);
      const firstInVolume = inVolume[0]?.id;
      const prior = firstInVolume ? previousChapters(ctx, firstInVolume, 3) : previousChapters(ctx, undefined, 3);
      const focus = focusOf(ctx.volume.summary, book.outline);
      const body = join(
        bookInfo(book),
        outlineInfo(ctx, 2000),
        prior.length ? section('上一卷末尾', prior.map((c) => `- ${ctx.labels.get(c.id)}：${clip(c.summary || c.outline, 200)}`).join('\n')) : '',
        inVolume.length
          ? section('本卷已有章节', inVolume.map((c) => `- ${ctx.labels.get(c.id)}：${clip(c.outline, 120) || '（无细纲）'}`).join('\n'))
          : '',
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        `---\n任务：${inVolume.length ? '接着本卷已有章节，继续' : ''}为本卷规划 ${count} 章的章节细纲。${extra}
- 每章要有明确的推进：一个场景目标、一个阻碍或转折、一个结尾钩子。
- 节奏有张有弛，不要每章都是同一种结构；整卷要朝卷纲中的高潮推进。
只输出 JSON 数组，不要任何其他文字：
[{"title":"章节标题（不要带"第X章"）","outline":"本章细纲，100~200 字：场景、出场人物、事件推进、结尾钩子"}]`,
      );
      return {
        messages: [sys(PLANNER), user(body)],
        temperature: Math.min(creativeTemp, 0.9),
      };
    }

    case 'character': {
      const current = req.characterId ? ctx.characters.find((c) => c.id === req.characterId) : undefined;
      if (!current && !extra) throw new HttpError(400, '请描述你想要的人物');
      const others = ctx.characters.filter((c) => c.id !== current?.id && c.name);
      const currentData = current
        ? JSON.stringify(
            Object.fromEntries(
              ['name', 'aliases', 'role', 'gender', 'age', 'appearance', 'personality', 'background', 'speech', 'motivation', 'arc', 'relations'].map(
                (k) => [k, (current as unknown as Record<string, unknown>)[k]],
              ),
            ),
            null,
            1,
          )
        : '';
      const body = join(
        bookInfo(book),
        section('总纲', clip(book.outline, 1000)),
        section('已有人物', others.map((c) => `- ${c.name}（${c.role}）${c.personality ? '：' + clip(c.personality, 40) : ''}`).join('\n')),
        current ? section('现有人物资料', currentData) : '',
        `---\n任务：${current ? '完善这个人物：保留已有设定，补全空缺字段，让人物更立体。' : '根据作者的描述设计一个人物。'}
${extra}
要求：人物要有内在矛盾和缺点；说话方式要具体（语气、口头禅、用词习惯），并附一句示例台词；动机要能推动情节；与已有人物建立至少一条有张力的关系。
只输出 JSON 对象，不要任何其他文字：
{"name":"","aliases":"别名/称号","role":"主角/配角/反派/路人","gender":"","age":"","appearance":"外貌，抓一两个记忆点","personality":"性格，包含矛盾面","background":"背景经历","speech":"说话方式与示例台词","motivation":"核心动机与恐惧","arc":"人物弧光","relations":"与其他人物的关系"}`,
      );
      return { messages: [sys(PLANNER), user(body)], temperature: creativeTemp };
    }

    case 'world': {
      const entry = req.worldId ? ctx.world.find((w) => w.id === req.worldId) : undefined;
      if (!entry) throw new HttpError(400, '请选择设定条目');
      const related = ctx.world.filter((w) => w.id !== entry.id && w.name).slice(0, 15);
      const body = join(
        bookInfo(book),
        section('总纲', clip(book.outline, 1000)),
        section('其他设定', related.map((w) => `- [${w.category}] ${w.name}：${clip(w.content, 100)}`).join('\n')),
        section('设定条目', `类别：${entry.category}\n名称：${entry.name || '（未命名）'}${entry.content ? `\n现有内容：\n${entry.content}` : ''}`),
        `---\n任务：${entry.content ? '扩写并完善这条设定' : '为这条设定撰写内容'}。${extra}
要求：具体、可直接用于写作；写清规则、限制和代价（能力、魔法、科技体系尤其如此）；与其他设定保持一致；给出一两个可以直接用进情节的细节。纯文本输出，不用 Markdown 符号。`,
      );
      return { messages: [sys(PLANNER), user(body)], temperature: creativeTemp };
    }

    case 'brainstorm': {
      if (!extra) throw new HttpError(400, '请输入你想讨论的问题');
      const before = req.before ?? ctx.chapter?.content ?? '';
      const focus = focusOf(ctx.chapter?.outline, clip(before, 1500, true), req.instruction);
      const body = join(
        bookInfo(book),
        outlineInfo(ctx, 1500),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter?.id, includeTail: false }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        chapterHead(ctx),
        before.trim() ? section('当前正文（末尾）', clip(before, 1500, true)) : '',
        `---\n${extra.replace(/^作者的额外要求：/, '作者的问题：')}
给出具体、彼此差异明显、可以直接拿去用的点子，至少有一个出人意料的选项；每条简短说明为什么可行。纯文本，用 1. 2. 编号。`,
      );
      return { messages: [sys(PARTNER), user(body)], temperature: Math.max(creativeTemp, 0.9) };
    }

    case 'chat': {
      const turns = (req.messages ?? []).filter((m) => m.content?.trim()).slice(-20);
      if (!turns.length) throw new HttpError(400, '消息为空');
      const focus = focusOf(...turns.map((t) => t.content), ctx.chapter?.outline);
      const context = join(
        bookInfo(book),
        styleInfo(book),
        outlineInfo(ctx, 2000),
        recapInfo(ctx, repo, { beforeChapterId: ctx.chapter?.id, includeTail: false }),
        characterInfo(ctx, focus),
        worldInfo(ctx, focus),
        foreshadowInfo(ctx),
        chapterHead(ctx),
        ctx.chapter?.content.trim() ? section('当前章节正文（末尾）', clip(ctx.chapter.content, 2000, true)) : '',
      );
      return {
        messages: [sys(`${PARTNER}\n\n以下是这部作品的资料，回答时以此为准：\n\n${context}`), ...turns.map((t) => ({ role: t.role, content: t.content }))],
        temperature: creativeTemp,
      };
    }

    default:
      throw new HttpError(400, `未知任务：${String(req.task)}`);
  }
}
