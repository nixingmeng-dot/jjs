/** 字数统计：去掉空白后计数，连续的英文/数字算一个词。与主流网文平台口径接近。 */
export function countWords(text: string): number {
  if (!text) return 0;
  const latin = text.match(/[A-Za-z0-9_'-]+/g);
  const nonSpace = text.replace(/\s+/g, '').length;
  if (!latin) return nonSpace;
  const latinChars = latin.reduce((n, w) => n + w.length, 0);
  return nonSpace - latinChars + latin.length;
}

export function formatWords(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  return String(n);
}

export function clip(text: string, max: number, fromEnd = false): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return fromEnd ? '……' + text.slice(text.length - max) : text.slice(0, max) + '……';
}

const CN_NUM = '零一二三四五六七八九';

export function toChineseNumber(n: number): string {
  if (n <= 0) return String(n);
  if (n >= 100000) return String(n);
  const units = ['', '十', '百', '千', '万'];
  const digits = String(n).split('').map(Number);
  let out = '';
  let zero = false;
  digits.forEach((d, i) => {
    const unit = units[digits.length - 1 - i];
    if (d === 0) {
      zero = true;
      return;
    }
    if (zero && out) out += '零';
    zero = false;
    out += CN_NUM[d] + unit;
  });
  return out.replace(/^一十/, '十');
}

const HEADING_NUM = '[零〇一二两三四五六七八九十百千万0-9０-９]+';
const VOLUME_RE = new RegExp(`^\\s*(第${HEADING_NUM}[卷部集](?:[\\s:：·、.-][^\\n]{0,40})?)\\s*$`);
const CHAPTER_RE = new RegExp(
  `^\\s*((?:第${HEADING_NUM}[章回节](?:[\\s:：·、.-]*[^\\n]{0,40})?)|(?:(?:序章|楔子|引子|序言|尾声|后记|番外)[^\\n]{0,40}))\\s*$`,
);

export interface ParsedVolume {
  title: string;
  chapters: { title: string; content: string }[];
}

/** 把整本 TXT 按「第X卷 / 第X章」拆分 */
export function splitNovelText(raw: string): ParsedVolume[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const volumes: ParsedVolume[] = [];
  let vol: ParsedVolume | null = null;
  let chap: { title: string; lines: string[] } | null = null;
  const preface: string[] = [];

  const ensureVolume = () => {
    if (!vol) {
      vol = { title: '正文', chapters: [] };
      volumes.push(vol);
    }
    return vol;
  };
  const flush = () => {
    if (chap) {
      ensureVolume().chapters.push({ title: chap.title, content: tidyParagraphs(chap.lines.join('\n')) });
      chap = null;
    }
  };

  for (const line of lines) {
    const v = line.match(VOLUME_RE);
    if (v && line.trim().length <= 40) {
      flush();
      vol = { title: v[1].trim(), chapters: [] };
      volumes.push(vol);
      continue;
    }
    const c = line.match(CHAPTER_RE);
    if (c && line.trim().length <= 45) {
      flush();
      chap = { title: c[1].trim(), lines: [] };
      continue;
    }
    if (chap) chap.lines.push(line);
    else preface.push(line);
  }
  flush();

  const prefaceText = tidyParagraphs(preface.join('\n'));
  if (volumes.length === 0) {
    return [{ title: '正文', chapters: [{ title: '第一章', content: prefaceText }] }];
  }
  if (prefaceText) {
    volumes[0].chapters.unshift({ title: '前言', content: prefaceText });
  }
  return volumes.filter((v) => v.chapters.length > 0);
}

/** 去掉章节标题里的「第X章」前缀，便于统一编号 */
export function stripChapterPrefix(title: string): string {
  return title.replace(new RegExp(`^第${HEADING_NUM}[章回节][\\s:：·、.-]*`), '').trim();
}

/** 统一段落：去行首尾空白，合并多余空行，可选首行缩进 */
export function tidyParagraphs(text: string, opts: { indent?: boolean; blankLine?: boolean } = {}): string {
  const paras = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''))
    .filter((l) => l.length > 0);
  const indent = opts.indent ? '\u3000\u3000' : '';
  return paras.map((p) => indent + p).join(opts.blankLine ? '\n\n' : '\n');
}

/** 宽松解析模型返回的 JSON（可能带代码块、前后说明文字） */
export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(text);
  for (const cand of candidates) {
    const trimmed = cand.trim();
    const pairs: [string, string][] = [
      ['[', ']'],
      ['{', '}'],
    ];
    // 先尝试最早出现的括号，避免把对象里的数组字段当成结果
    const ia = trimmed.indexOf('[');
    const io = trimmed.indexOf('{');
    if (io !== -1 && (ia === -1 || io < ia)) pairs.reverse();
    for (const [open, close] of pairs) {
      const start = trimmed.indexOf(open);
      const end = trimmed.lastIndexOf(close);
      if (start === -1 || end <= start) continue;
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice) as T;
      } catch {
        try {
          // 常见问题：中文引号、尾逗号
          const fixed = slice.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"');
          return JSON.parse(fixed) as T;
        } catch {
          /* try next */
        }
      }
    }
  }
  return null;
}

export function chapterLabel(index: number, title: string): string {
  const t = title?.trim();
  return `第${toChineseNumber(index)}章${t ? ' ' + t : ''}`;
}

const UNNUMBERED = /^(序章|楔子|引子|序言|前言|尾声|后记|番外|终章)/;

/** 按阅读顺序给章节编号；「楔子」「番外」之类不占章号 */
export function chapterLabels(chapters: { id: string; title: string }[]): Map<string, string> {
  const labels = new Map<string, string>();
  let n = 0;
  for (const c of chapters) {
    const t = (c.title ?? '').trim();
    if (UNNUMBERED.test(t)) labels.set(c.id, t);
    else labels.set(c.id, chapterLabel(++n, t));
  }
  return labels;
}
