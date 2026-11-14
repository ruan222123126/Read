/**
 * 分栏翻页的纯计算部分。
 *
 * 与 DOM 解耦：输入「可用高度 + 每行高度 + 段落列表」，输出每一页包含的段落范围。
 * 真正的列数由 CSS `columns` 排版决定，这里只负责「不许把一行字切一半」这类约束。
 */

export interface Paragraph {
  text: string;
}

export interface PageSlice {
  /** 起始段落索引（含） */
  start: number;
  /** 结束段落索引（不含） */
  end: number;
  /** 本页首段是否要保留首字下沉（仅全书第一页） */
  dropCap: boolean;
}

export interface PaginateOptions {
  /** 容器可用高度（px），已扣除 padding */
  viewportHeight: number;
  /** 单行行高（px），即 fontSize * lineHeight */
  lineHeight: number;
  /** 每行可容纳字符数（用于估算换行） */
  charsPerLine: number;
  /** 段间距（px） */
  paragraphGap?: number;
}

/** 估算一段占用的行数。CJK 字符按 1 个宽度计。 */
export function estimateLines(text: string, charsPerLine: number): number {
  const width = charsPerLine <= 0 ? 1 : charsPerLine;
  const chars = Array.from(text);
  let lines = 0;
  let current = 0;
  for (const ch of chars) {
    const w = ch === "\n" ? width : 1;
    if (current + w > width) {
      lines += 1;
      current = w === width ? 0 : w;
    } else {
      current += w;
    }
  }
  return lines + (current > 0 ? 1 : 0);
}

/**
 * 把段落切成页。保证每页总高度不超过 viewportHeight，
 * 且不会出现「半行」——因为按整行累加。
 */
export function paginate(paragraphs: Paragraph[], options: PaginateOptions): PageSlice[] {
  const { viewportHeight, lineHeight, charsPerLine, paragraphGap = 0 } = options;

  if (paragraphs.length === 0) return [];
  if (viewportHeight <= 0 || lineHeight <= 0) {
    return [{ start: 0, end: paragraphs.length, dropCap: true }];
  }

  const maxLines = Math.max(1, Math.floor(viewportHeight / lineHeight));
  const gapLines = paragraphGap / lineHeight;

  const pages: PageSlice[] = [];
  let start = 0;
  let used = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const lines = estimateLines(paragraphs[i]!.text, charsPerLine);
    const need = lines + (i > start ? gapLines : 0);

    if (used > 0 && used + need > maxLines) {
      pages.push({ start, end: i, dropCap: pages.length === 0 });
      start = i;
      used = lines;
    } else {
      used += need;
    }
  }

  pages.push({ start, end: paragraphs.length, dropCap: pages.length === 0 });
  return pages;
}

/** 页码 → 当前页首段索引，用于把阅读进度映射回段落。 */
export function pageStartIndex(pages: PageSlice[], page: number): number {
  const clamped = Math.max(0, Math.min(page, pages.length - 1));
  return pages[clamped]?.start ?? 0;
}
