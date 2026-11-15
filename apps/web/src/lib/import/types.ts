/**
 * 上传解析的类型定义。
 *
 * 解析发生在浏览器端（epub/mobi/txt → 结构化书），再一次性上传入库。
 */

/** 解析后的单章 */
export interface ParsedChapter {
  title: string;
  /** 段落数组；图片段为 data:image/… 开头的 data URI */
  paragraphs: string[];
}

/** 解析后的整本书 */
export interface ParsedBook {
  title: string;
  author: string;
  description: string | null;
  /** 封面 data URI（尽量缩放到 ~400px），没有则为 null */
  coverData: string | null;
  format: "epub" | "mobi" | "txt";
  chapters: ParsedChapter[];
}

/** 解析或上传失败的用户可读错误 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** 服务端返回的书库条目（与后端 LocalBookListItem 对应） */
export interface LocalBook {
  id: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  format: string;
  chapterCount: number;
}
