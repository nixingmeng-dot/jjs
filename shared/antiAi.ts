/**
 * 去 AI 味检测：基于中文网文/出版编辑常见的「AI 腔」特征做本地分析，无需调用模型。
 * 词库是启发式的——命中不代表一定要改，但扎堆出现时读者几乎一定会察觉。
 */

export type FlavorCategory =
  | 'expression'
  | 'abstract'
  | 'sublimation'
  | 'purple'
  | 'connector'
  | 'adverb'
  | 'telling'
  | 'greasy'
  | 'pattern'
  | 'custom';

export const FLAVOR_CATEGORIES: Record<FlavorCategory, { label: string; tip: string }> = {
  expression: {
    label: '神态动作套话',
    tip: '“嘴角上扬”“眼中闪过一丝”“深吸一口气”是被用滥的万能神态。换成只属于这个角色、这个场景的动作，或者干脆删掉，让台词自己说话。',
  },
  abstract: {
    label: '空泛情绪词',
    tip: '“难以言喻”“五味杂陈”等于什么都没说。写出具体的反应：手在抖、喉咙发紧、突然想起某件小事。',
  },
  sublimation: {
    label: '升华 / 总结',
    tip: '段尾、章尾的感悟和点题（“这一刻他终于明白……”）是最明显的 AI 痕迹。停在动作或对话上，把意义留给读者。',
  },
  purple: {
    label: '模板化氛围描写',
    tip: '“阳光洒在”“空气中弥漫着”“时间仿佛静止”是模板。挑一个只有这里才有的细节，比堆十个形容词有效。',
  },
  connector: {
    label: '论文腔连接词',
    tip: '“然而”“与此同时”“此外”“事实上”是说明文腔调，小说叙述里多数可以直接删掉。',
  },
  adverb: {
    label: '副词堆砌',
    tip: '“缓缓地”“轻轻地”“不禁”会削弱动词。换一个更准确的动词，比“副词 + 动词”更有力。',
  },
  telling: {
    label: '直接告知情绪',
    tip: '“他感到愤怒”“心中涌起一股悲伤”是告知。改成展示：他做了什么、说了什么、身体有什么反应。',
  },
  greasy: {
    label: '油腻网文腔',
    tip: '“邪魅一笑”“宠溺”“深邃的眼眸”容易让读者出戏，除非是刻意追求的风格。',
  },
  pattern: {
    label: 'AI 句式',
    tip: '“不是……而是……”、比喻扎堆、“XX 地说道”式对话标签都是生成文本的典型句式。',
  },
  custom: { label: '自定义禁用词', tip: '你在设置或作品里添加的禁用词。' },
};

interface Rule {
  cat: FlavorCategory;
  re: RegExp;
  w: number;
}

const r = (cat: FlavorCategory, w: number, ...sources: string[]): Rule[] =>
  sources.map((s) => ({ cat, w, re: new RegExp(s, 'g') }));

const EMOTIONS =
  '愤怒|悲伤|恐惧|害怕|开心|快乐|紧张|不安|绝望|温暖|幸福|愧疚|失落|孤独|震惊|困惑|无奈|欣慰|羞愧|兴奋|心疼|委屈|酸楚|惊讶|激动';

const RULES: Rule[] = [
  ...r(
    'expression',
    1.5,
    '嘴角(?:微微|轻轻)?(?:勾起|上扬|扬起|翘起|噙着|挂着)(?:一抹|一丝)?(?:弧度|笑意|笑容|冷笑|微笑)?',
    '一抹(?:弧度|笑意|微笑|冷笑|苦笑|淡笑|浅笑|红晕)',
    '(?:眼|眸|眼底|眼中|眸中|眼里|眸子里|眼神中)(?:闪过|划过|掠过|浮现出?)(?:一丝|一抹)',
    '闪过一丝',
    '瞳孔(?:骤然|猛地|猛然|微微|不由得?)?(?:一缩|骤缩|收缩|微缩|地震|放大)',
    '眉头(?:紧锁|微皱|一皱|紧皱|微蹙|轻蹙|紧蹙)',
    '深吸(?:了)?一口气',
    '倒吸(?:了)?一口凉气',
    '心(?:中|头|下|里)一(?:凛|震|紧|沉|颤|动)',
    '心跳(?:都)?漏(?:了)?(?:半|一)拍',
    '似笑非笑',
    '意味深长',
    '若有所思',
    '冷哼一声',
    '喃喃自语',
    '一字一顿',
    '目光如炬',
    '眼神(?:变得)?(?:坚定|复杂|深邃|晦暗不明)',
    '(?:身体|浑身|整个人)(?:猛地|微微)?一(?:僵|颤|震)',
    '不置可否',
    '微微(?:一笑|颔首|一怔|一愣|一顿)',
    '眼眶(?:微微)?(?:泛红|一红|湿润)',
  ),
  ...r(
    'abstract',
    1.5,
    '难以言喻|无法言喻|无以言表|无法用言语(?:来)?(?:形容|表达)|难以名状',
    '(?:一股|一种|一阵)(?:莫名|难以名状|说不清道不明|复杂|奇异|异样)的',
    '莫名的(?:情绪|感觉|情感|悸动|心慌)',
    '五味杂陈|百感交集|思绪万千|心潮澎湃|感慨万千|心绪万千|心乱如麻',
    '复杂的(?:情绪|情感|神色|眼神|心情|神情)',
    '说不清道不明',
    '前所未有的',
    '某种(?:东西|力量|情绪|感觉)',
  ),
  ...r(
    'sublimation',
    2,
    '(?:这|那)一刻',
    '命运的齿轮',
    '(?:终于|这才|此刻|那时|瞬间)(?:明白|懂得|意识到|理解)(?:了)?',
    '一切(?:都)?(?:将|会|已经)(?:不同|改变|不一样)',
    '新的(?:篇章|旅程|征程)',
    '(?:或许|也许)(?:这|那)(?:就是|便是)',
    '才是(?:真正的|最重要的)',
    '(?:人生|命运|成长|生命)的(?:意义|真谛)',
    '故事(?:才刚刚|才)开始',
  ),
  ...r(
    'purple',
    1.2,
    '(?:阳光|月光|余晖|夕阳|晨光|灯光)(?:透过[^，。！？\\n]{1,10})?(?:洒|倾泻|铺)(?:在|落|进|满)',
    '洒落',
    '空气中(?:弥漫|充斥|飘荡|飘散)着',
    '弥漫着一股',
    '熠熠生辉|璀璨夺目|流光溢彩|美轮美奂|如梦似幻',
    '(?:如同|宛如|仿佛|好似)一(?:幅|副)[^，。！？\\n]{0,6}画(?:卷)?',
    '画卷',
    '交织(?:在一起|成)',
    '诉说着',
    '时间(?:仿佛|似乎)(?:都)?(?:静止|凝固|停止)(?:了)?',
    '空气(?:仿佛|似乎)?(?:都)?(?:凝固|凝结)(?:了)?',
    '死一般的(?:寂静|沉默)',
    '落针可闻|鸦雀无声',
    '微风(?:轻轻)?(?:拂过|吹过|轻拂)',
  ),
  ...r(
    'connector',
    0.8,
    '与此同时',
    '此外',
    '总而言之|总之',
    '毋庸置疑|不可否认|显而易见|毫无疑问',
    '值得一提的是',
    '事实上',
    '换句话说|换言之',
    '不仅如此',
    '由此可见',
  ),
  ...r('connector', 0.5, '然而'),
  ...r(
    'adverb',
    0.5,
    '(?:缓缓|轻轻|静静|淡淡|深深|默默|慢慢|微微|紧紧|狠狠)地',
    '不禁|不由得|不由自主|情不自禁',
    '缓缓(?:说道|开口|道)',
  ),
  ...r(
    'telling',
    1.2,
    `(?:感到|感觉到|感受到)(?:了)?(?:一阵|一股|一丝|十分|非常|无比|很|有些|莫名)?(?:的)?(?:${EMOTIONS})`,
    '(?:心中|心里|心头|胸中|内心|心底)(?:涌起|升起|泛起|充满|涌上|涌出)',
    '涌上心头',
    `一(?:阵|股)(?:暖流|寒意|${EMOTIONS}|怒火|喜悦)`,
    `[他她我](?:很|非常|十分|无比|特别)(?:生气|${EMOTIONS}|难过|伤心|高兴)`,
    '充满了(?:希望|绝望|期待|愤怒|恐惧|力量)',
  ),
  ...r(
    'greasy',
    1.5,
    '邪魅|宠溺|魅惑|霸道总裁',
    '低沉的嗓音|磁性的(?:嗓音|声音)',
    '深邃的(?:眼眸|双眸|眸子|眼睛)',
    '成功引起了我的注意',
    '俊美无俦|倾国倾城|绝美的(?:容颜|脸庞)',
  ),
  ...r('greasy', 0.6, '眼眸|双眸|眸子|眸光'),
  ...r(
    'pattern',
    2,
    '不是[^。！？\\n]{1,25}?[，,]?而是',
    '与其说[^。！？\\n]{1,25}?不如说',
  ),
  ...r('pattern', 0.8, '[\\u4e00-\\u9fa5]{1,3}地(?:说|问|答|喊|笑)道'),
  ...r('pattern', 0.4, '仿佛|宛如|犹如|如同|恍若|好似'),
];

export interface FlavorHit {
  start: number;
  end: number;
  text: string;
  cat: FlavorCategory;
  w: number;
}

export interface FlavorReport {
  score: number;
  level: 'clean' | 'mild' | 'obvious' | 'heavy';
  levelLabel: string;
  chars: number;
  hits: FlavorHit[];
  byCategory: Partial<Record<FlavorCategory, number>>;
  stats: {
    sentences: number;
    avgSentenceLen: number;
    /** 句长变异系数：越低越「整齐」，人写的文字通常更参差 */
    sentenceCv: number;
    paragraphs: number;
    paragraphCv: number;
    similesPer1k: number;
    dashesPer1k: number;
    sublimatedEndings: number;
    repeatedOpeners: number;
  };
  notes: string[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseWordList(input: string | undefined | null): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(/[\n,，、;；]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function cv(values: number[]): number {
  if (values.length < 2) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?…]+[”」』"]?)|\n+/)
    .map((s) => s.replace(/\s+/g, ''))
    .filter((s) => s.replace(/[。！？!?…”“「」『』"，,、]/g, '').length >= 2);
}

const SUBLIMATION_END = /(明白|懂得|意识到|终将|注定|从此|再也不|或许|也许|这一刻|那一刻|意义|未来|希望|命运)[^。！？]*[。！？…]*$/;

export function analyzeAiFlavor(text: string, opts: { extraBanned?: string[] } = {}): FlavorReport {
  const raw: FlavorHit[] = [];
  const rules = [...RULES];
  for (const word of opts.extraBanned ?? []) {
    if (word.length >= 1) rules.push({ cat: 'custom', w: 1.5, re: new RegExp(escapeRe(word), 'g') });
  }
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      raw.push({ start: m.index, end: m.index + m[0].length, text: m[0], cat: rule.cat, w: rule.w });
    }
  }
  // 去重：重叠区间保留更长 / 权重更高者
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || b.w - a.w);
  const hits: FlavorHit[] = [];
  for (const h of raw) {
    const last = hits[hits.length - 1];
    if (last && h.start < last.end) {
      if (h.w > last.w && h.end - h.start >= last.end - last.start) hits[hits.length - 1] = h;
      continue;
    }
    hits.push(h);
  }

  const chars = text.replace(/\s/g, '').length;
  const sentences = splitSentences(text);
  const sentLens = sentences.map((s) => s.length);
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const paraLens = paragraphs.map((p) => p.replace(/\s/g, '').length);

  const sentenceCv = cv(sentLens);
  const paragraphCv = cv(paraLens);
  const per1k = (n: number) => (chars > 0 ? (n / chars) * 1000 : 0);
  const similes = (text.match(/仿佛|宛如|犹如|如同|恍若|好似|像是|好像/g) ?? []).length;
  const dashes = (text.match(/——/g) ?? []).length;

  let sublimatedEndings = 0;
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (/[”」』"]$/.test(trimmed)) continue; // 以对话结尾的不算
    const lastSentence = splitSentences(trimmed).pop() ?? '';
    if (lastSentence.length >= 6 && SUBLIMATION_END.test(lastSentence)) sublimatedEndings++;
  }

  let repeatedOpeners = 0;
  let run = 1;
  for (let i = 1; i < sentences.length; i++) {
    const a = sentences[i - 1].replace(/^[“「"]/, '')[0];
    const b = sentences[i].replace(/^[“「"]/, '')[0];
    if (a && a === b && /[他她我你它这那]/.test(a)) {
      run++;
      if (run === 3) repeatedOpeners++;
    } else run = 1;
  }

  const byCategory: Partial<Record<FlavorCategory, number>> = {};
  let weighted = 0;
  for (const h of hits) {
    byCategory[h.cat] = (byCategory[h.cat] ?? 0) + 1;
    weighted += h.w;
  }

  const density = (weighted / Math.max(chars, 300)) * 1000;
  const lexical = 80 * (1 - Math.exp(-density / 16));
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const sentencePenalty = sentences.length >= 8 ? clamp01((0.55 - sentenceCv) / 0.3) * 12 : 0;
  const paragraphPenalty = paragraphs.length >= 5 ? clamp01((0.45 - paragraphCv) / 0.3) * 6 : 0;
  const endingPenalty = paragraphs.length > 0 ? clamp01(sublimatedEndings / Math.max(paragraphs.length, 4) / 0.3) * 8 : 0;
  const similePenalty = clamp01((per1k(similes) - 4) / 8) * 6;
  const dashPenalty = clamp01((per1k(dashes) - 3) / 6) * 4;
  const openerPenalty = Math.min(repeatedOpeners * 2, 6);
  const score = Math.round(
    Math.min(100, lexical + sentencePenalty + paragraphPenalty + endingPenalty + similePenalty + dashPenalty + openerPenalty),
  );

  const level: FlavorReport['level'] = score < 20 ? 'clean' : score < 40 ? 'mild' : score < 60 ? 'obvious' : 'heavy';
  const levelLabel = { clean: '清爽', mild: '轻微', obvious: '明显', heavy: '浓重' }[level];

  const notes: string[] = [];
  if (sentences.length >= 8 && sentenceCv < 0.45)
    notes.push(`句子长短过于整齐（变异系数 ${sentenceCv.toFixed(2)}）。试着插入几个极短句，或让一句长句一口气写完一个动作链。`);
  if (paragraphs.length >= 5 && paragraphCv < 0.35)
    notes.push('段落长度几乎一样，读起来像模板。可以让关键的一句话单独成段。');
  if (sublimatedEndings >= 2) notes.push(`${sublimatedEndings} 个段落以感悟、总结或展望收尾，建议停在动作或对话上。`);
  if (per1k(similes) > 6) notes.push(`比喻过密（每千字 ${per1k(similes).toFixed(1)} 个），保留最贴切的一个即可。`);
  if (per1k(dashes) > 5) notes.push('破折号使用偏多，这是生成文本的常见习惯。');
  if (repeatedOpeners > 0) notes.push(`有 ${repeatedOpeners} 处连续三句以上用同一个字（如“他”）开头。`);

  return {
    score: chars < 30 ? 0 : score,
    level: chars < 30 ? 'clean' : level,
    levelLabel: chars < 30 ? '文本过短' : levelLabel,
    chars,
    hits,
    byCategory,
    stats: {
      sentences: sentences.length,
      avgSentenceLen: sentences.length ? Math.round(sentLens.reduce((a, b) => a + b, 0) / sentences.length) : 0,
      sentenceCv: Number(sentenceCv.toFixed(2)),
      paragraphs: paragraphs.length,
      paragraphCv: Number(paragraphCv.toFixed(2)),
      similesPer1k: Number(per1k(similes).toFixed(1)),
      dashesPer1k: Number(per1k(dashes).toFixed(1)),
      sublimatedEndings,
      repeatedOpeners,
    },
    notes,
  };
}

/** 把检测结果整理成给模型的修改清单 */
export function issuesForPrompt(report: FlavorReport, limit = 25): string[] {
  const counts = new Map<string, { n: number; cat: FlavorCategory }>();
  for (const h of report.hits) {
    const cur = counts.get(h.text);
    if (cur) cur.n++;
    else counts.set(h.text, { n: 1, cat: h.cat });
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([text, { n, cat }]) => `「${text}」${n > 1 ? `出现 ${n} 次` : ''}（${FLAVOR_CATEGORIES[cat].label}）`);
  return [...lines, ...report.notes];
}

/** 写进系统提示词的高频 AI 套话（精选，过长会稀释注意力） */
export const PROMPT_BANNED_PHRASES = [
  '嘴角勾起一抹弧度',
  '眼中闪过一丝',
  '瞳孔骤缩',
  '眉头紧锁',
  '深吸一口气',
  '倒吸一口凉气',
  '心中一凛',
  '心跳漏了一拍',
  '似笑非笑',
  '意味深长',
  '难以言喻',
  '五味杂陈',
  '百感交集',
  '一股莫名的',
  '这一刻',
  '命运的齿轮',
  '他终于明白',
  '空气中弥漫着',
  '阳光洒在',
  '时间仿佛静止',
  '空气仿佛凝固',
  '死一般的寂静',
  '熠熠生辉',
  '交织',
  '诉说着',
  '不禁',
  '不由得',
  '缓缓地',
  '与此同时',
  '总而言之',
  '邪魅',
  '宠溺',
  '深邃的眼眸',
  '心中涌起',
  '感到一阵',
];
