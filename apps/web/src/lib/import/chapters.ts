/**
 * 正文自动分章。
 *
 * 输入是一段段落流（txt 的行 / mobi、epub 抽出的段落），按标题特征切成章节。
 * 规则面向中文网文常见的排版：
 * - 章/节/回/话：「第一章 绯红」「第1011章 牌局」「第三节 xxx」
 * - 部/卷：「【第一部 小丑】」「第三卷 xxx」——作为独立的卷级目录项
 * - 特殊标题：序章/楔子/尾声/番外/后记……
 *
 * 防误判是第一位的：标题行有长度上限、禁止句末标点、排除「第三章已经发出来了」
 * 这类正文语句；一整段没有标题时按固定段落数切块，保证超长正文不至于
 * 变成单章巨型记录。
 */

import type { ParsedChapter } from "./types";

/** 段落分页符哨兵：mobi 的 <mbp:pagebreak> 在段落流里的占位 */
export const PAGEBREAK = "\u0000";

/** 章/部序号：阿拉伯、全角阿拉伯与中文数字 */
const NUM = "[0-9０-９零〇一二三四五六七八九十百千万两]+";

/**
 * 「第 N 章/节/回/话 标题」。
 * 章字后不再单独写 \s*：让空格落进分隔符组，否则「第二章 发展」会被当成
 * 无分隔符标题，撞上续句黑名单（发/开/说…开头的字）而漏判。
 */
const CHAPTER_RE = new RegExp(
  `^第\\s*(${NUM})\\s*[章节回话]([:：、.．\\-—_]?\\s*)([^。！？；]{0,40})$`,
);

/** 「第 N 部/卷 标题」 */
const VOLUME_RE = new RegExp(
  `^第\\s*(${NUM})\\s*[部卷]([:：、.．\\-—_]?\\s*)([^。！？；]{0,40})$`,
);

/** 序章、楔子、番外等不成序号的标题；单字「序」要求后面不接汉字，防止「序正文」这类正文行误判 */
const SPECIAL_RE =
  /^(序章|序言|序幕|序(?![一-龥])|楔子|引子|前言|尾声|终章|最终章|大结局|后记|完本感言|完结感言|新书感言|番外[篇章]?)([:：、.．\-—]?\s*)([^。！？；]{0,36})$/;

/** 无分隔符直接跟内容时，排除以这些字开头的正文语句（如「第三章已经发出来了」） */
const CONTINUATION_RE =
  /^(已经|就|都|还|才|是|会|要|的|了|在|有|没有|他|她|它|你|我|这|那|但|而|和|与|或|因为|所以|于是|然后|开始|结束|写|发|更|求|说|想|看|听|去|来|能|让|给|被|把|将|从|向|到|之外|之前|之后|以前|以后)/;

/** 单章段落数上限：超过则再切块，避免巨型章节拖垮阅读窗口 */
const MAX_PARAGRAPHS = 1000;

/** 无任何标题时的切块大小 */
const FALLBACK_CHUNK = 400;

const MAX_TITLE_LEN = 50;

interface Heading {
  title: string;
  volume: boolean;
}

/** 成对去掉首尾的全半角括号（【第一部 小丑】 → 第一部 小丑）；不成对则保留 */
function stripBrackets(s: string): string {
  const pairs: [string, string][] = [
    ["【", "】"],
    ["［", "］"],
    ["〔", "〕"],
    ["（", "）"],
    ["(", ")"],
  ];
  for (const [open, close] of pairs) {
    if (s.startsWith(open) && s.endsWith(close)) return s.slice(1, -1).trim();
  }
  return s.trim();
}

/** 判断一个段落是否是标题行；是则返回归一化标题 */
export function detectHeading(raw: string): Heading | null {
  const text = stripBrackets(raw);
  if (!text || text.length > MAX_TITLE_LEN) return null;
  if (/[。！？；…""''」』]/.test(text)) return null;

  const volume = VOLUME_RE.exec(text);
  if (volume) return { title: text, volume: true };

  const chapter = CHAPTER_RE.exec(text);
  if (chapter) {
    const [, , sep, rest] = chapter;
    // 无分隔符时（如「第三章已经发出来了」）要求内容短且不像正文续句
    if (!sep && rest && (rest.length > 15 || CONTINUATION_RE.test(rest))) {
      return null;
    }
    return { title: text, volume: false };
  }

  const special = SPECIAL_RE.exec(text);
  if (special) return { title: text, volume: false };

  return null;
}

/** 超长章节按固定段落数再切块 */
function subdivide(chapter: ParsedChapter): ParsedChapter[] {
  if (chapter.paragraphs.length <= MAX_PARAGRAPHS) return [chapter];
  const parts: ParsedChapter[] = [];
  for (let i = 0; i < chapter.paragraphs.length; i += MAX_PARAGRAPHS) {
    const index = parts.length + 1;
    parts.push({
      title: `${chapter.title}（第${index}部分）`,
      paragraphs: chapter.paragraphs.slice(i, i + MAX_PARAGRAPHS),
    });
  }
  return parts;
}

/**
 * 把段落流切成章节。
 *
 * - 卷/部标题自成一章（通常是正文前的分卷页）
 * - 空的普通章节（标题后紧跟下一个标题）会被丢弃，避免空白页
 * - 整段无标题时按 FALLBACK_CHUNK 切块兜底
 */
export function splitParagraphsIntoChapters(
  paragraphs: string[],
  fallbackTitle: string,
): ParsedChapter[] {
  const raw: ParsedChapter[] = [];
  let current: ParsedChapter | null = null;
  let sawHeading = false;

  const flush = () => {
    if (!current) return;
    const isEmpty = current.paragraphs.length === 0;
    // 空章节只保留卷级分卷页；普通标题不带正文没有阅读价值
    if (!isEmpty || VOLUME_RE.test(stripBrackets(current.title))) {
      raw.push(current);
    }
    current = null;
  };

  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (!text) continue;

    if (text === PAGEBREAK) {
      flush();
      continue;
    }

    const heading = detectHeading(text);
    if (heading) {
      sawHeading = true;
      flush();
      current = { title: heading.title, paragraphs: [] };
      continue;
    }

    if (!current) current = { title: fallbackTitle, paragraphs: [] };
    current.paragraphs.push(text);
  }
  flush();

  if (!sawHeading) {
    // 完全没有标题：按固定大小切块（分页哨兵不进正文）
    const body = paragraphs.filter((p) => p.trim() !== PAGEBREAK);
    const total = Math.max(1, Math.ceil(body.length / FALLBACK_CHUNK));
    const chunks: ParsedChapter[] = [];
    for (let i = 0; i < body.length; i += FALLBACK_CHUNK) {
      const index = chunks.length + 1;
      chunks.push({
        title:
          total > 1 ? `${fallbackTitle}（第${index}部分）` : fallbackTitle,
        paragraphs: body.slice(i, i + FALLBACK_CHUNK).map((p) => p.trim()),
      });
    }
    return chunks;
  }

  return raw.flatMap(subdivide);
}
