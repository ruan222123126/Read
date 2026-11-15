"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContinuousReader } from "@/components/reader/continuous-reader";
import { ReaderSettingsPanel } from "@/components/reader/reader-settings-panel";
import { api } from "@/lib/api";
import { db, defaultSettings, getSettings, type ReaderSettings } from "@/lib/db";
import { readTocCache, writeTocCache, type TocCache } from "@/lib/reader/useReader";

export default function ReaderPage() {
  const params = useParams<{ bookId: string }>();
  const router = useRouter();
  const bookId = useMemo(() => {
    const raw = params.bookId;
    return raw ? decodeURIComponent(raw) : "";
  }, [params.bookId]);

  const [toc, setToc] = useState<TocCache | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [jump, setJump] = useState({ index: 0, token: 0 });
  const [fatal, setFatal] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);

  const chapterListRef = useRef<HTMLUListElement>(null);
  // 进度恢复只做一次，避免异步返回时覆盖用户已经滚到的位置
  const restoredRef = useRef(false);

  // 载入设置（与默认值合并，避免历史脏数据导致字段缺失）
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  // 载入目录：先读 sessionStorage 缓存，刷新页面时回源重建，避免"缺少目录缓存"死路
  useEffect(() => {
    const cached = readTocCache(bookId);
    if (cached) {
      setToc(cached);
      restoreProgress(cached);
      return;
    }
    setFatal(null);
    setToc(null);
    void fetchToc();

    async function fetchToc() {
      try {
        const item = await db.shelf.get(bookId);
        if (!item?.sourceId || !item.bookUrl) {
          setFatal("这本书缺少书源信息，请回书城重新打开。");
          return;
        }
        const { chapters } = await api.toc({ sourceId: item.sourceId, bookUrl: item.bookUrl });
        if (!chapters.length) {
          setFatal("这个书源没有返回章节列表。");
          return;
        }
        const fresh: TocCache = { sourceId: item.sourceId, bookUrl: item.bookUrl, chapters };
        writeTocCache(bookId, fresh);
        setToc(fresh);
        restoreProgress(fresh);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : "目录加载失败");
      }
    }

    function restoreProgress(list: TocCache) {
      // 恢复上次阅读位置（仅首次）
      if (restoredRef.current) return;
      restoredRef.current = true;
      void db.shelf.get(bookId).then((item) => {
        if (!item?.currentChapterUrl) return;
        const idx = list.chapters.findIndex((c) => c.url === item.currentChapterUrl);
        if (idx > 0) {
          setChapterIndex(idx);
          setJump({ index: idx, token: 1 });
        }
      });
    }
  }, [bookId]);

  const updateSettings = useCallback(
    (patch: Partial<Omit<ReaderSettings, "id">>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        void db.settings.put(next);
        return next;
      });
    },
    [],
  );

  // 目录面板打开时滚动到当前章节
  useEffect(() => {
    if (!showToc) return;
    const el = chapterListRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "center" });
  }, [showToc]);

  const currentTitle = toc?.chapters[chapterIndex]?.title ?? "阅读";

  const jumpTo = useCallback((index: number) => {
    setChapterIndex(index);
    setJump((prev) => ({ index, token: prev.token + 1 }));
    setShowToc(false);
  }, []);

  // 读到哪一章就存到书架（进度按章节位置算）
  const handleActiveIndex = useCallback(
    (index: number) => {
      setChapterIndex(index);
      if (!toc) return;
      const target = toc.chapters[index];
      if (!target) return;
      void db.shelf
        .get(bookId)
        .then((item) => {
          if (!item) return;
          void db.shelf.put({
            ...item,
            currentChapterUrl: target.url,
            progress: (index + 1) / toc.chapters.length,
            lastReadAt: Date.now(),
          });
        })
        .catch(() => undefined);
    },
    [bookId, toc],
  );

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      {/* 顶栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-paper-edge)] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/shelf"
            className="shrink-0 text-sm text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-seal)]"
          >
            返回
          </Link>
          <span className="truncate font-[family-name:var(--font-serif-cn)] text-sm">
            {currentTitle}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowToc((v) => !v)}
            className="rounded-full px-3 py-1.5 text-xs text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-seal)]"
          >
            目录
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-full px-3 py-1.5 text-xs text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-seal)]"
          >
            排版
          </button>
        </div>
      </header>

      {/* 正文区 */}
      <div className="relative min-h-0 flex-1">
        {fatal ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-[var(--color-seal)]">{fatal}</p>
            <button
              type="button"
              onClick={() => router.push("/explore")}
              className="rounded-full border border-[var(--color-paper-edge)] px-5 py-2 text-xs transition-colors hover:border-[var(--color-ink-faint)]"
            >
              重新搜索这本书
            </button>
          </div>
        ) : toc ? (
          <ContinuousReader
            bookId={bookId}
            toc={toc}
            jump={jump}
            typography={{
              fontFamily: settings.fontFamily,
              fontSize: settings.fontSize,
              lineHeight: settings.lineHeight,
              letterSpacing: settings.letterSpacing,
              paragraphIndent: settings.paragraphIndent,
            }}
            onActiveIndexChange={handleActiveIndex}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-[var(--color-ink-faint)]">载入目录…</span>
          </div>
        )}

        {/* 排版面板 */}
        {showSettings ? (
          <div className="absolute top-3 right-4 z-20 w-72">
            <ReaderSettingsPanel
              settings={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                letterSpacing: settings.letterSpacing,
                fontFamily: settings.fontFamily,
                paragraphIndent: settings.paragraphIndent,
              }}
              onChange={(patch) => updateSettings(patch)}
            />
          </div>
        ) : null}
      </div>

      {/* 目录抽屉 */}
      {showToc && toc ? (
        <div
          className="absolute inset-0 z-30 flex"
          onClick={() => setShowToc(false)}
          role="presentation"
        >
          <div className="flex-1 bg-black/20" />
          <aside
            className="flex h-full w-80 max-w-[85vw] flex-col border-l border-[var(--color-paper-edge)] bg-[var(--color-paper)]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="目录"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--color-paper-edge)] px-5">
              <span className="font-[family-name:var(--font-serif-cn)] text-sm">目录</span>
              <button
                type="button"
                onClick={() => setShowToc(false)}
                className="text-xs text-[var(--color-ink-faint)]"
              >
                关闭
              </button>
            </div>
            <ul ref={chapterListRef} className="reader-scroll flex-1 overflow-y-auto py-2">
              {toc.chapters.map((c, i) => (
                <li key={c.url}>
                  <button
                    type="button"
                    data-active={i === chapterIndex}
                    onClick={() => jumpTo(i)}
                    className={
                      i === chapterIndex
                        ? "w-full bg-[var(--color-paper-deep)] px-5 py-2.5 text-left text-xs text-[var(--color-seal)]"
                        : "w-full px-5 py-2.5 text-left text-xs text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-paper-deep)]"
                    }
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
