"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ReaderSettingsPanel, ReaderView } from "@/components/reader/reader-view";
import { db, defaultSettings, getSettings, type CachedChapter, type ReaderSettings } from "@/lib/db";
import {
  loadChapter,
  preloadChapters,
  pruneChapters,
  readTocCache,
  type TocCache,
} from "@/lib/reader/useReader";

export default function ReaderPage() {
  const params = useParams<{ bookId: string }>();
  const bookId = useMemo(() => {
    const raw = params.bookId;
    return raw ? decodeURIComponent(raw) : "";
  }, [params.bookId]);

  const [toc, setToc] = useState<TocCache | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [chapter, setChapter] = useState<CachedChapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);

  const chapterListRef = useRef<HTMLUListElement>(null);
  // 进度恢复只做一次，避免异步返回时覆盖用户已经翻到的章节
  const restoredRef = useRef(false);

  // 载入设置（与默认值合并，避免历史脏数据导致字段缺失）
  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  // 载入目录
  useEffect(() => {
    const cached = readTocCache(bookId);
    if (!cached) {
      setError("缺少目录缓存，请回书城重新打开这本书。");
      setLoading(false);
      return;
    }
    setToc(cached);

    // 恢复上次阅读位置（仅首次）
    if (restoredRef.current) return;
    restoredRef.current = true;
    void db.shelf.get(bookId).then((item) => {
      if (!item?.currentChapterUrl) return;
      const idx = cached.chapters.findIndex((c) => c.url === item.currentChapterUrl);
      if (idx >= 0) setChapterIndex(idx);
    });
  }, [bookId]);

  // 载入当前章节
  useEffect(() => {
    if (!toc) return;
    const target = toc.chapters[chapterIndex];
    if (!target) {
      setError("章节索引超出范围。");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void loadChapter(bookId, toc.sourceId, target.url, target.title)
      .then((data) => {
        if (cancelled) return;
        setChapter(data);
        setLoading(false);

        // 保存进度到书架
        void db.shelf
          .get(bookId)
          .then((item) => {
            if (!item) return;
            void db.shelf.put({
              ...item,
              currentChapterUrl: target.url,
              progress: (chapterIndex + 1) / toc.chapters.length,
              lastReadAt: Date.now(),
            });
          })
          .catch(() => undefined);

        // 后台预取后续章节
        void preloadChapters(bookId, toc.sourceId, toc.chapters, chapterIndex).catch(
          () => undefined,
        );
        void pruneChapters(bookId).catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "章节加载失败");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, toc, chapterIndex]);

  const goNext = useCallback(() => {
    if (!toc) return;
    setChapterIndex((i) => Math.min(i + 1, toc.chapters.length - 1));
  }, [toc]);

  const goPrev = useCallback(() => {
    setChapterIndex((i) => Math.max(i - 1, 0));
  }, []);

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

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
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
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-xs text-[var(--color-ink-faint)]">载入章节…</span>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-sm text-[var(--color-seal)]">{error}</p>
            <Link
              href="/explore"
              className="rounded-full border border-[var(--color-paper-edge)] px-5 py-2 text-xs transition-colors hover:border-[var(--color-ink-faint)]"
            >
              重新搜索这本书
            </Link>
          </div>
        ) : chapter ? (
          <div className="mx-auto h-full max-w-[46rem] px-6 sm:px-10">
            <ReaderView
              chapter={chapter}
              mode={settings.mode}
              fontSize={settings.fontSize}
              lineHeight={settings.lineHeight}
              letterSpacing={settings.letterSpacing}
              fontFamily={settings.fontFamily}
              paragraphIndent={settings.paragraphIndent}
              onReachEnd={goNext}
              onReachStart={goPrev}
            />
          </div>
        ) : null}

        {/* 排版面板 */}
        {showSettings ? (
          <div className="absolute top-3 right-4 z-20 w-72">
            <ReaderSettingsPanel
              settings={{
                fontSize: settings.fontSize,
                lineHeight: settings.lineHeight,
                letterSpacing: settings.letterSpacing,
                fontFamily: settings.fontFamily,
                mode: settings.mode,
                paragraphIndent: settings.paragraphIndent,
              }}
              onChange={(patch) => updateSettings(patch)}
            />
          </div>
        ) : null}
      </div>

      {/* 底栏：上一章 / 章节进度 / 下一章 */}
      <footer className="flex h-14 shrink-0 items-center justify-between border-t border-[var(--color-paper-edge)] px-4 text-xs text-[var(--color-ink-soft)] sm:px-6">
        <button
          type="button"
          onClick={goPrev}
          disabled={chapterIndex <= 0}
          className="rounded-full px-4 py-1.5 transition-colors hover:text-[var(--color-seal)] disabled:opacity-30"
        >
          上一章
        </button>
        <span className="font-mono text-[var(--color-ink-faint)]">
          {toc ? `${chapterIndex + 1} / ${toc.chapters.length}` : "—"}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!toc || chapterIndex >= toc.chapters.length - 1}
          className="rounded-full px-4 py-1.5 transition-colors hover:text-[var(--color-seal)] disabled:opacity-30"
        >
          下一章
        </button>
      </footer>

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
                    onClick={() => {
                      setChapterIndex(i);
                      setShowToc(false);
                    }}
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
