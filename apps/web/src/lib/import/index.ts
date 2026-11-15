/**
 * 上传书籍的编排入口：按扩展名分派解析器 → 算全文指纹 → 上传入库 → 加入书架。
 */

import { api, type LocalBookItem } from "@/lib/api";
import { db } from "@/lib/db";

import { parseEpub } from "./epub";
import { parseMobi } from "./mobi";
import { parseTxt } from "./txt";
import { ImportError, type ParsedBook } from "./types";

export type { ParsedBook, ParsedChapter } from "./types";
export { ImportError } from "./types";

/** 按文件名判断是否是支持的书箱格式 */
export function isSupportedBookFile(name: string): boolean {
  return /\.(epub|mobi|azw3?|prc|txt)$/i.test(name);
}

async function parseByFormat(file: File): Promise<ParsedBook> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".epub")) return parseEpub(file);
  if (/\.(mobi|azw3?|prc)$/.test(name)) return parseMobi(file);
  if (name.endsWith(".txt")) return parseTxt(file);
  throw new ImportError("暂不支持该格式，请使用 EPUB / MOBI / TXT 文件");
}

/** 全文（含图片占位）的 SHA-256，服务端据此去重 */
async function textHashOf(book: ParsedBook): Promise<string> {
  const body = book.chapters
    .flatMap((c) => c.paragraphs)
    .join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${book.title}\n${book.author}\n${body}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 把书库里的书加入本机书架 */
export async function addLocalBookToShelf(book: LocalBookItem): Promise<void> {
  const existing = await db.shelf.get(book.id);
  if (existing) {
    await db.shelf.put({ ...existing, lastReadAt: Date.now() });
    return;
  }
  await db.shelf.put({
    id: book.id,
    bookId: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.cover_url ?? undefined,
    sourceId: `local:${book.id}`,
    bookUrl: "local://book",
    progress: 0,
    addedAt: Date.now(),
    lastReadAt: Date.now(),
    cached: true,
  });
}

export interface ImportItemResult {
  file: string;
  status: "done" | "duplicate" | "error";
  message?: string;
  book?: LocalBookItem;
}

export interface ImportProgress {
  file: string;
  phase: "parsing" | "uploading";
}

/** 逐个解析并上传文件；每个文件独立成败，不互相影响 */
export async function importFiles(
  files: File[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportItemResult[]> {
  const results: ImportItemResult[] = [];

  for (const file of files) {
    try {
      onProgress?.({ file: file.name, phase: "parsing" });
      const book = await parseByFormat(file);
      const textHash = await textHashOf(book);

      onProgress?.({ file: file.name, phase: "uploading" });
      const saved = await api.uploadLocalBook({
        title: book.title,
        author: book.author,
        description: book.description,
        cover_data: book.coverData,
        format: book.format,
        text_hash: textHash,
        chapters: book.chapters,
      });

      await addLocalBookToShelf(saved);
      results.push({
        file: file.name,
        status: saved.duplicate ? "duplicate" : "done",
        message: saved.duplicate
          ? "书库中已存在这本书，已直接加入书架"
          : `识别出 ${saved.chapter_count} 章`,
        book: saved,
      });
    } catch (error) {
      results.push({
        file: file.name,
        status: "error",
        message:
          error instanceof ImportError
            ? error.message
            : error instanceof Error
              ? error.message
              : "导入失败",
      });
    }
  }

  return results;
}
