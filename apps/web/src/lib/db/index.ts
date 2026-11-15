/**
 * 本地数据库（IndexedDB / Dexie）。
 *
 * Local-First 的核心：书架、阅读进度、已缓存的章节正文与段评全部落在本地，
 * 网络只负责「补充」和「同步」，翻页永远走本地。
 */

import Dexie, { type EntityTable } from "dexie";

/** 书架条目 */
export interface ShelfItem {
  id: string;
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  /** 选定的书源，换源时更新 */
  sourceId?: string;
  /** 该书源下的书籍页地址，用于重建目录 */
  bookUrl?: string;
  /** 当前阅读到的章节 URL */
  currentChapterUrl?: string;
  /** 阅读进度 0..1 */
  progress: number;
  addedAt: number;
  lastReadAt: number;
  /** 是否离线缓存完整目录 */
  cached: boolean;
}

/** 章节正文缓存（预加载后续 5–10 章） */
export interface CachedChapter {
  /** `${bookId}::${chapterUrl}` */
  id: string;
  bookId: string;
  chapterUrl: string;
  title: string;
  paragraphs: string[];
  /** 每段的内容指纹，段评锚定用 */
  hashes: string[];
  fetchedAt: number;
  /** 所属书源，便于换源后标记来源 */
  sourceId?: string;
}

/** 阅读器设置，本地持久化 */
export interface ReaderSettings {
  id: "settings";
  fontFamily: "serif" | "kai" | "sans";
  fontSize: number;
  lineHeight: number;
  /** 纸张色调：warm | ivory | gray | night */
  theme: "warm" | "ivory" | "gray" | "night";
  letterSpacing: number;
  paragraphIndent: boolean;
}

export const defaultSettings: ReaderSettings = {
  id: "settings",
  fontFamily: "serif",
  fontSize: 18,
  lineHeight: 2,
  theme: "warm",
  letterSpacing: 0,
  paragraphIndent: true,
};

class ReadDatabase extends Dexie {
  shelf!: EntityTable<ShelfItem, "id">;
  chapters!: EntityTable<CachedChapter, "id">;
  settings!: EntityTable<ReaderSettings, "id">;

  constructor() {
    super("read");
    this.version(1).stores({
      shelf: "id, bookId, lastReadAt",
      chapters: "id, bookId, fetchedAt",
      settings: "id",
    });
  }
}

export const db = new ReadDatabase();

export async function getSettings(): Promise<ReaderSettings> {
  const saved = await db.settings.get("settings");
  if (!saved) return defaultSettings;
  // 与默认值合并：老版本或异常写入可能缺少字段，缺的用默认值补齐
  return {
    ...defaultSettings,
    ...Object.fromEntries(
      Object.entries(saved).filter(([, v]) => v !== undefined && v !== null),
    ),
    id: "settings",
  } as ReaderSettings;
}

export async function saveSettings(patch: Partial<Omit<ReaderSettings, "id">>) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await db.settings.put(next);
  return next;
}

export function chapterKey(bookId: string, chapterUrl: string) {
  return `${bookId}::${chapterUrl}`;
}
