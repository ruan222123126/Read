/**
 * TXT 解析：编码探测 → 元数据提取 → 自动分章。
 *
 * 中文小说 TXT 的编码五花八门（UTF-8/UTF-16/GBK），浏览器 TextDecoder
 * 自带全部解码表，用「BOM → 严格 UTF-8 → GB18030 → Big5」逐级回退。
 */

import { splitParagraphsIntoChapters } from "./chapters";
import { ImportError, type ParsedBook } from "./types";

/** 按可靠性从高到低解码字节流；全部失败时宽松地按 GB18030 解 */
export function decodeText(bytes: Uint8Array): string {
  // BOM 优先
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }

  // 无 BOM：UTF-8 严格解码失败就视为本地编码
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // 继续回退
  }
  for (const label of ["gb18030", "big5"]) {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      // 继续回退
    }
  }
  return new TextDecoder("gb18030").decode(bytes);
}

export interface TxtMeta {
  title: string;
  author: string;
  description: string | null;
}

/** 从文首「书名：/作者：/内容简介：」或文件名《X》作者：Y 提取元数据 */
export function extractTxtMeta(text: string, fileName: string): TxtMeta {
  const head = text.split(/\r\n|\n|\r/).slice(0, 60);
  let title = "";
  let author = "";
  let description: string | null = null;

  for (const line of head) {
    const t = line.replace(/\s+/g, " ").trim();
    if (!title) {
      const m = /^书\s*名\s*[:：]\s*(.{1,60})$/.exec(t);
      if (m) title = m[1]?.trim() ?? "";
    }
    if (!author) {
      const m = /^(作\s*者|作者名)\s*[:：]\s*(.{1,40})$/.exec(t);
      if (m) author = m[2]?.trim() ?? "";
    }
    if (!description) {
      const m = /^内容简介\s*[:：]?\s*(.*)$/.exec(t);
      if (m) {
        const body = m[1]?.trim() || head
          .slice(head.indexOf(line) + 1, head.indexOf(line) + 4)
          .map((l) => l.trim())
          .join(" ");
        if (body) description = body.slice(0, 300);
      }
    }
  }

  // 文件名兜底：《诡秘之主》（精校版…）作者：xxx.txt
  const base = fileName.replace(/\.[^.]+$/, "");
  if (!title) {
    const m = /《(.+?)》/.exec(base);
    title = (m ? m[1] : base.replace(/[(（【[][^)）】\]]*[)）】\]]/g, "").trim() || base) ?? "";
  }
  if (!author) {
    const m = /作者\s*[:：]\s*([^._]+)/.exec(base);
    if (m) author = m[1]?.trim() ?? "";
  }

  return {
    title: title || "未命名书籍",
    author: author || "佚名",
    description,
  };
}

/** 全文按行整理成段落：去行首缩进、丢空行 */
export function textToParagraphs(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, ""))
    .filter((line) => line.length > 0);
}

export async function parseTxt(file: File): Promise<ParsedBook> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new ImportError("文件是空的");
  const text = decodeText(bytes);
  const meta = extractTxtMeta(text, file.name);
  const paragraphs = textToParagraphs(text);
  const chapters = splitParagraphsIntoChapters(paragraphs, "正文");
  return {
    title: meta.title,
    author: meta.author,
    description: meta.description,
    coverData: null,
    format: "txt",
    chapters,
  };
}
