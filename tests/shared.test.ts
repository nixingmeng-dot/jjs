import { describe, expect, it } from 'vitest';
import { analyzeAiFlavor, issuesForPrompt } from '../shared/antiAi';
import { chapterLabels, countWords, extractJson, splitNovelText, toChineseNumber } from '../shared/text';

describe('text utils', () => {
  it('counts Chinese chars and Latin words', () => {
    expect(countWords('你好，世界！')).toBe(6);
    expect(countWords('他说 hello world 了')).toBe(5);
    expect(countWords('  \n ')).toBe(0);
  });

  it('formats Chinese numbers', () => {
    expect(toChineseNumber(1)).toBe('一');
    expect(toChineseNumber(10)).toBe('十');
    expect(toChineseNumber(15)).toBe('十五');
    expect(toChineseNumber(105)).toBe('一百零五');
    expect(toChineseNumber(1200)).toBe('一千二百');
  });

  it('labels chapters, skipping unnumbered ones', () => {
    const labels = chapterLabels([
      { id: 'a', title: '楔子' },
      { id: 'b', title: '雨夜' },
      { id: 'c', title: '' },
    ]);
    expect(labels.get('a')).toBe('楔子');
    expect(labels.get('b')).toBe('第一章 雨夜');
    expect(labels.get('c')).toBe('第二章');
  });

  it('splits a novel into volumes and chapters', () => {
    const raw = `书名
作者：某人

第一卷 起风
第一章 雨夜
　　雨下了一整夜。
第2章：来客
有人敲门。

第二卷 远行
第三章 出城
城门开了。`;
    const vols = splitNovelText(raw);
    expect(vols.map((v) => v.title)).toEqual(['第一卷 起风', '第二卷 远行']);
    expect(vols[0].chapters.map((c) => c.title)).toEqual(['前言', '第一章 雨夜', '第2章：来客']);
    expect(vols[0].chapters[1].content).toBe('雨下了一整夜。');
    expect(vols[1].chapters[0].content).toBe('城门开了。');
  });

  it('extracts JSON from noisy model output', () => {
    expect(extractJson('好的：\n```json\n[{"title":"a"}]\n```')).toEqual([{ title: 'a' }]);
    expect(extractJson('{"name":"林","tags":["x"]}')).toEqual({ name: '林', tags: ['x'] });
    expect(extractJson('[{"a":1},]')).toEqual([{ a: 1 }]);
    expect(extractJson('没有 JSON')).toBeNull();
  });
});

describe('anti-AI analyzer', () => {
  const aiText = `夜色如墨，月光洒在青石板上，空气中弥漫着淡淡的花香。
林晚深吸一口气，眼中闪过一丝复杂的情绪。她感到一阵难以言喻的悲伤，心中涌起无数回忆。
他嘴角勾起一抹弧度，缓缓地说道："你终于来了。"
这一刻，她终于明白，命运的齿轮已经开始转动。一切都将不同。
然而，与此同时，远处传来了脚步声，时间仿佛静止了。`;

  const humanText = `林晚把伞往门边一靠，水顺着伞骨淌了一地。
"鞋。"老周头也没抬。
她低头。两只鞋都湿透了，左脚那只还沾着半片烂菜叶，是菜市场门口那滩水坑里带出来的。她踢掉鞋，光脚踩在水泥地上，凉得一缩。
"东西呢？"
"没拿到。"
老周终于放下手里那把螺丝刀。螺丝刀滚了半圈，停在一堆拆开的收音机零件中间。他盯着她看了很久，久到楼下那辆三轮车又按了两声喇叭。
"那你回来干什么。"`;

  it('flags typical AI phrasing heavily', () => {
    const r = analyzeAiFlavor(aiText);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.level).toBe('heavy');
    const texts = r.hits.map((h) => h.text);
    expect(texts).toContain('深吸一口气');
    expect(texts).toContain('命运的齿轮');
    expect(texts.some((t) => t.includes('嘴角勾起'))).toBe(true);
    expect(r.byCategory.sublimation).toBeGreaterThan(0);
  });

  it('scores concrete prose as clean', () => {
    const r = analyzeAiFlavor(humanText);
    expect(r.score).toBeLessThan(20);
    expect(r.level).toBe('clean');
  });

  it('honors custom banned words and produces prompt issues', () => {
    const r = analyzeAiFlavor('他看着她，修仙界的天骄们都沉默了，修仙界从未如此安静。修仙界啊修仙界。', {
      extraBanned: ['修仙界'],
    });
    expect(r.byCategory.custom).toBe(4);
    expect(issuesForPrompt(r)[0]).toContain('「修仙界」出现 4 次');
  });

  it('does not produce overlapping hits', () => {
    const r = analyzeAiFlavor(aiText);
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i].start).toBeGreaterThanOrEqual(r.hits[i - 1].end);
  });
});
