import { chapterLabels, splitNovelText, stripChapterPrefix, tidyParagraphs } from '../shared/text';
import type { Book } from '../shared/types';
import { HttpError, type Repo } from './db';

export const BACKUP_FORMAT = 'inkwell-backup';

export function exportBook(repo: Repo, bookId: string, format: 'txt' | 'md' | 'json') {
  const tree = repo.getTree(bookId);
  if (!tree) throw new HttpError(404, '作品不存在');
  const { book } = tree;
  const chapters = repo.orderedChapters(bookId, true);
  const labels = chapterLabels(chapters);

  if (format === 'json') {
    return {
      filename: `${book.title || '未命名'}.inkwell.json`,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify(
        {
          format: BACKUP_FORMAT,
          version: 1,
          exportedAt: new Date().toISOString(),
          ...tree,
          chapters,
        },
        null,
        2,
      ),
    };
  }

  const md = format === 'md';
  const out: string[] = [];
  out.push(md ? `# ${book.title}` : `《${book.title}》`);
  if (book.author) out.push(`作者：${book.author}`);
  if (book.synopsis.trim()) out.push('', md ? '> ' + book.synopsis.trim().replace(/\n/g, '\n> ') : `简介：\n${book.synopsis.trim()}`);
  for (const vol of tree.volumes) {
    const volChapters = chapters.filter((c) => c.volumeId === vol.id);
    if (!volChapters.length) continue;
    out.push('', '', md ? `## ${vol.title}` : vol.title);
    for (const ch of volChapters) {
      out.push('', md ? `### ${labels.get(ch.id)}` : labels.get(ch.id)!, '');
      out.push(tidyParagraphs(ch.content ?? '', { indent: !md, blankLine: md }));
    }
  }
  return {
    filename: `${book.title || '未命名'}.${md ? 'md' : 'txt'}`,
    type: `${md ? 'text/markdown' : 'text/plain'}; charset=utf-8`,
    body: out.join('\n') + '\n',
  };
}

type Backup = {
  format: string;
  book: Partial<Book>;
  volumes?: Record<string, unknown>[];
  chapters?: Record<string, unknown>[];
  characters?: Record<string, unknown>[];
  world?: Record<string, unknown>[];
  foreshadows?: Record<string, unknown>[];
};

export function importBackup(repo: Repo, data: Backup): Book {
  if (!data || data.format !== BACKUP_FORMAT || !data.book) throw new HttpError(400, '不是有效的作品备份文件');
  const tx = repo.db.transaction(() => {
    const book = repo.createBook(data.book, { withStarter: false });
    const volMap = new Map<string, string>();
    const chapMap = new Map<string, string>();
    (data.volumes ?? []).forEach((v, i) => {
      const nv = repo.insert('volumes', book.id, { ...v, sort: i + 1 });
      volMap.set(String(v.id), nv.id as string);
    });
    let fallbackVolume: string | undefined;
    const chapterCount: Record<string, number> = {};
    for (const c of data.chapters ?? []) {
      let volumeId = volMap.get(String(c.volumeId));
      if (!volumeId) {
        fallbackVolume ??= repo.insert('volumes', book.id, { title: '未分卷' }).id as string;
        volumeId = fallbackVolume;
      }
      chapterCount[volumeId] = (chapterCount[volumeId] ?? 0) + 1;
      const nc = repo.insert('chapters', book.id, { ...c, volumeId, sort: chapterCount[volumeId] });
      chapMap.set(String(c.id), nc.id as string);
    }
    for (const ch of data.characters ?? []) repo.insert('characters', book.id, ch);
    for (const w of data.world ?? []) repo.insert('world', book.id, w);
    for (const f of data.foreshadows ?? []) {
      repo.insert('foreshadows', book.id, {
        ...f,
        plantedChapterId: chapMap.get(String(f.plantedChapterId)) ?? '',
        resolvedChapterId: chapMap.get(String(f.resolvedChapterId)) ?? '',
      });
    }
    return book;
  });
  return tx();
}

export function importText(repo: Repo, title: string, text: string): Book {
  if (!text.trim()) throw new HttpError(400, '文件内容为空');
  const volumes = splitNovelText(text);
  const tx = repo.db.transaction(() => {
    const book = repo.createBook({ title: title.trim() || '导入的作品' }, { withStarter: false });
    for (const v of volumes) {
      const vol = repo.insert('volumes', book.id, { title: v.title });
      v.chapters.forEach((c, i) => {
        repo.insert('chapters', book.id, {
          volumeId: vol.id,
          title: stripChapterPrefix(c.title) || (/^第/.test(c.title) ? '' : c.title),
          content: c.content,
          sort: i + 1,
        });
      });
    }
    return book;
  });
  return tx();
}

