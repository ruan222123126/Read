/**
 * 章节数据获取 + 本地缓存 + 预取。
 *
 * Local-First 的关键：
 * - 正文一旦抓到就写进 IndexedDB，之后翻页完全离线
 * - 读完当前章就静默预取后面 N 章，翻页时不用等网络
 */

import { api } from "@/lib/api";
import { chapterKey, db, type CachedChapter } from "@/lib/db";
import { contentHashHex } from "@read/shared";

export interface TocCache {
  sourceId: string;
  bookUrl: string;
  chapters: { title: string; url: string }[];
}

export const PRELOAD_AHEAD = 5;

export function tocStorageKey(bookId: string) {
  return `toc:${bookId}`;
}

export function readTocCache(bookId: string): TocCache | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(tocStorageKey(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TocCache;
  } catch {
    return null;
  }
}

export function writeTocCache(bookId: string, toc: TocCache) {
  sessionStorage.setItem(tocStorageKey(bookId), JSON.stringify(toc));
}

/** 优先本地缓存，缺失时回源抓取并写入缓存。 */
export async function loadChapter(
  bookId: string,
  sourceId: string,
  chapterUrl: string,
  title: string,
): Promise<CachedChapter> {
  const key = chapterKey(bookId, chapterUrl);
  const cached = await db.chapters.get(key);
  if (cached) return cached;

  const res = await api.content({ sourceId, chapterUrl });
  const record: CachedChapter = {
    id: key,
    bookId,
    chapterUrl,
    title,
    paragraphs: res.paragraphs,
    // 后端已算好指纹；本地再算一次保证前后端算法一致
    hashes: res.paragraphs.map((p) => contentHashHex(p)),
    fetchedAt: Date.now(),
    sourceId,
  };
  await db.chapters.put(record);
  return record;
}

/** 静默预取后续章节，失败不打扰用户。 */
export async function preloadChapters(
  bookId: string,
  sourceId: string,
  chapters: { title: string; url: string }[],
  fromIndex: number,
  ahead = PRELOAD_AHEAD,
) {
  const targets = chapters.slice(fromIndex + 1, fromIndex + 1 + ahead);
  for (const chapter of targets) {
    const key = chapterKey(bookId, chapter.url);
    const exists = await db.chapters.get(key);
    if (exists) continue;
    try {
      await loadChapter(bookId, sourceId, chapter.url, chapter.title);
    } catch {
      // 预取失败静默放弃，真正读到时再重试
      break;
    }
  }
}

/** 清理超过保留数量的旧章节缓存，避免无限膨胀。 */
export async function pruneChapters(bookId: string, keep = 40) {
  const all = await db.chapters.where("bookId").equals(bookId).sortBy("fetchedAt");
  const excess = all.length - keep;
  if (excess <= 0) return;
  await db.chapters.bulkDelete(all.slice(0, excess).map((c) => c.id));
}
