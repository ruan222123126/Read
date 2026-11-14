/**
 * Legado（阅读 3.0）书源 JSON 类型定义。
 *
 * 只覆盖阅读主链路必需字段，其余字段用 `[key: string]: unknown` 兜住，
 * 保证导入社区书源时不会因为多字段而报错。
 */

export interface LegadoBookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string;
  bookSourceType?: number;
  enabled?: boolean;
  enabledExplore?: boolean;
  searchUrl: string;
  ruleSearch: LegadoSearchRule;
  ruleBookInfo?: LegadoBookInfoRule;
  ruleToc: LegadoTocRule;
  ruleContent: LegadoContentRule;
  header?: string;
  loginUrl?: string;
  weight?: number;
  lastUpdateTime?: number;
  [key: string]: unknown;
}

export interface LegadoSearchRule {
  bookList: string;
  name: string;
  author: string;
  kind?: string;
  wordCount?: string;
  lastChapter?: string;
  intro?: string;
  coverUrl?: string;
  bookUrl: string;
  [key: string]: unknown;
}

export interface LegadoBookInfoRule {
  name?: string;
  author?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  coverUrl?: string;
  tocUrl?: string;
  wordCount?: string;
  [key: string]: unknown;
}

export interface LegadoTocRule {
  chapterList: string;
  chapterName: string;
  chapterUrl: string;
  nextTocUrl?: string;
  [key: string]: unknown;
}

export interface LegadoContentRule {
  content: string;
  nextContentUrl?: string;
  title?: string;
  [key: string]: unknown;
}

/** 搜索命中结果（归一化前）。 */
export interface RawSearchBook {
  name: string;
  author: string;
  bookUrl: string;
  coverUrl?: string;
  intro?: string;
  lastChapter?: string;
  wordCount?: string;
  kind?: string;
  sourceName: string;
  sourceId: string;
}

/** 宽松解析：数组或单对象都接受。 */
export function parseBookSources(json: unknown): LegadoBookSource[] {
  if (Array.isArray(json)) return json as LegadoBookSource[];
  if (json && typeof json === "object") return [json as LegadoBookSource];
  return [];
}
