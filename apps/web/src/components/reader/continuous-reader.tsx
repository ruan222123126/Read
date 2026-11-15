"use client";

/**
 * 连续滚动阅读器。
 *
 * 不再按「页」切分：整章是页面里的一段流光，滚到底自动接上下一章，
 * 中途没有按钮、没有页码、没有翻页动画打断阅读。
 *
 * 两个必须守住的不变量：
 * 1. 从目录跳到第 N 章时，第 N 章的标题必须贴住视口顶部（不多也不少）。
 *    为此滚动容器始终挂载，跳转后按真实 DOM 位置摆正，而不是假设它天然是 0。
 * 2. 窗口满了从头部裁剪章节时，要把被裁掉的高度从 scrollTop 里扣掉，
 *    读者看到的画面不能动。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CachedChapter, ReaderSettings } from "@/lib/db";
import { loadChapter, preloadChapters, pruneChapters, type TocCache } from "@/lib/reader/useReader";
import { adjustScrollTop, needsTrim, nextBase, shouldLoadMore } from "@/lib/reader/window";

/** 窗口内最多保留的章节数 */
const WINDOW_MAX = 24;
/** 超过上限时从头部裁掉的章节数 */
const WINDOW_TRIM = 8;
/** 剩余不足多少屏就继续加载下一章 */
const LOAD_THRESHOLD = 1.1;

const FONT_STACK = {
  serif: "var(--font-serif-cn)",
  kai: "var(--font-kai)",
  sans: "var(--font-sans-cn)",
} as const;

export type ReaderTypography = Pick<
  ReaderSettings,
  "fontFamily" | "fontSize" | "lineHeight" | "letterSpacing" | "paragraphIndent"
>;

export interface ContinuousReaderProps {
  bookId: string;
  toc: TocCache;
  /** 跳章指令：token 变化就重新从 index 开始加载并定位到该章开头 */
  jump: { index: number; token: number };
  typography: ReaderTypography;
  /** 当前读到目录里的哪一章（绝对下标） */
  onActiveIndexChange?: (index: number) => void;
}

export function ContinuousReader({
  bookId,
  toc,
  jump,
  typography,
  onActiveIndexChange,
}: ContinuousReaderProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const [chapters, setChapters] = useState<CachedChapter[]>([]);
  const [baseIndex, setBaseIndex] = useState(jump.index);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  // 用 ref 承载「不用触发渲染」的可变状态，避免闭包读到旧值
  const cursor = useRef({ base: jump.index, through: jump.index, loading: false, session: 0 });
  const pendingTrim = useRef<number | null>(null);
  /** 需要在下一次渲染后把第 jump 章摆到顶部 */
  const pendingAlign = useRef<number | null>(null);
  const lastActive = useRef(-1);
  const activeCb = useRef(onActiveIndexChange);

  useEffect(() => {
    activeCb.current = onActiveIndexChange;
  }, [onActiveIndexChange]);

  /**
   * 把目标章节的标题对齐到视口顶部。
   *
   * 直接写 scrollTop = 0 在真实浏览器里并不可靠：
   * 字体晚一步加载、图片撑开高度，都会让第一次写入被 clamp 到旧高度。
   * 所以这里按节点的真实 offsetTop 定位，并在接下来几帧里复查修正。
   */
  const alignToChapter = useCallback((absoluteIndex: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let frame = 0;
    let lastOffset = -1;
    let settled = 0;

    const apply = () => {
      const target = scroller.querySelector<HTMLElement>(
        `[data-chapter-index="${absoluteIndex}"]`,
      );
      if (target) {
        const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        const next = scroller.scrollTop + top;
        if (Math.abs(next - lastOffset) > 1) {
          lastOffset = next;
          settled = 0;
          scroller.scrollTop = next;
        } else {
          settled += 1;
        }
      }

      frame += 1;
      // 连续 3 帧位置不再变化就停，最多修正 30 帧（字体加载兜底）
      if (settled < 3 && frame < 30) {
        requestAnimationFrame(apply);
      }
    };

    apply();
  }, []);

  const boot = useCallback(
    async (index: number) => {
      const session = ++cursor.current.session;
      cursor.current.base = index;
      cursor.current.through = index;
      cursor.current.loading = false;
      pendingTrim.current = null;

      setChapters([]);
      setBaseIndex(index);
      setPhase("loading");
      setError(null);
      setMoreError(null);
      setReachedEnd(false);
      // 跳转的那一章就是当前章，别让旧的检测结果把它盖掉
      lastActive.current = index;

      const target = toc.chapters[index];
      if (!target) {
        setError("章节索引超出范围。");
        setPhase("error");
        return;
      }

      try {
        const data = await loadChapter(bookId, toc.sourceId, target.url, target.title);
        if (session !== cursor.current.session) return;
        cursor.current.through = index + 1;
        pendingAlign.current = index;
        setChapters([data]);
        setPhase("ready");
        void preloadChapters(bookId, toc.sourceId, toc.chapters, index, 3).catch(() => undefined);
        void pruneChapters(bookId).catch(() => undefined);
      } catch (e) {
        if (session !== cursor.current.session) return;
        setError(e instanceof Error ? e.message : "章节加载失败");
        setPhase("error");
      }
    },
    [bookId, toc],
  );

  useEffect(() => {
    void boot(jump.index);
    // jump.token 变化表示「同一章也要重来」（例如目录里再点一次）
  }, [boot, jump.index, jump.token]);

  const loadMore = useCallback(async () => {
    const state = cursor.current;
    if (state.loading) return;

    const next = state.through;
    if (next >= toc.chapters.length) {
      setReachedEnd(true);
      return;
    }

    const session = state.session;
    state.loading = true;
    setLoadingMore(true);
    setMoreError(null);

    try {
      const target = toc.chapters[next];
      if (!target) {
        setReachedEnd(true);
        return;
      }
      const data = await loadChapter(bookId, toc.sourceId, target.url, target.title);
      if (session !== state.session) return;

      state.through = next + 1;

      // 窗口满了就裁掉头部，同时记下裁掉的高度
      let trimHeight = 0;
      const scroller = scrollerRef.current;
      if (scroller && needsTrim(state.through - state.base, WINDOW_MAX)) {
        const nodes = scroller.querySelectorAll<HTMLElement>("[data-chapter]");
        const anchor = nodes[WINDOW_TRIM];
        if (nodes[0] && anchor) {
          const top = nodes[0].getBoundingClientRect().top;
          const cut = anchor.getBoundingClientRect().top;
          trimHeight = cut - top;
        }
      }

      if (trimHeight > 0) {
        pendingTrim.current = trimHeight;
        state.base = nextBase(state.base, WINDOW_TRIM);
        setBaseIndex(state.base);
        setChapters((prev) => [...prev.slice(WINDOW_TRIM), data]);
      } else {
        setChapters((prev) => [...prev, data]);
      }

      setReachedEnd(state.through >= toc.chapters.length);
      void preloadChapters(bookId, toc.sourceId, toc.chapters, next, 3).catch(() => undefined);
    } catch (e) {
      if (session !== state.session) return;
      setMoreError(e instanceof Error ? e.message : "下一章加载失败");
    } finally {
      if (session === state.session) {
        state.loading = false;
        setLoadingMore(false);
      }
    }
  }, [bookId, toc]);

  /**
   * 布局阶段摆正位置。
   * 顺序很重要：先补偿裁剪造成的位移，再处理跳章对齐，
   * 否则两者会互相抵消，跳过去就落在目标章前面几页。
   */
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (pendingTrim.current != null) {
      scroller.scrollTop = adjustScrollTop(scroller.scrollTop, pendingTrim.current);
      pendingTrim.current = null;
    }

    const alignTo = pendingAlign.current;
    if (alignTo != null) {
      pendingAlign.current = null;
      alignToChapter(alignTo);
    }
  }, [chapters, phase, alignToChapter]);

  const check = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const nodes = scroller.querySelectorAll<HTMLElement>("[data-chapter]");
    if (nodes.length === 0) return;

    const scrollerTop = scroller.getBoundingClientRect().top;
    const probe = scroller.scrollTop + scroller.clientHeight * 0.35;

    let active = 0;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) break;
      const top = node.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
      if (top <= probe) active = i;
      else break;
    }

    const absolute = cursor.current.base + active;
    if (absolute !== lastActive.current) {
      lastActive.current = absolute;
      activeCb.current?.(absolute);
    }

    if (
      shouldLoadMore(
        scroller.scrollHeight,
        scroller.scrollTop,
        scroller.clientHeight,
        LOAD_THRESHOLD,
      )
    ) {
      void loadMore();
    }
  }, [loadMore]);

  const ticking = useRef(false);
  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      check();
    });
  }, [check]);

  // 新章渲染完后补一次检查：短章节留不满一屏时要继续接下一章
  useEffect(() => {
    if (phase !== "ready") return;
    const id = requestAnimationFrame(check);
    return () => cancelAnimationFrame(id);
  }, [chapters, phase, check]);

  // 浏览器自带的滚动恢复会和「跳章定位」抢方向盘，关掉
  useEffect(() => {
    if (typeof history === "undefined" || !("scrollRestoration" in history)) return;
    const prev = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => {
      history.scrollRestoration = prev;
    };
  }, []);

  const bodyStyle: React.CSSProperties = useMemo(
    () => ({
      fontFamily: FONT_STACK[typography.fontFamily],
      fontSize: `${typography.fontSize}px`,
      lineHeight: typography.lineHeight,
      letterSpacing: `${typography.letterSpacing}px`,
      textIndent: typography.paragraphIndent ? "2em" : "0",
    }),
    [typography],
  );

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="reader-scroll relative h-full overflow-y-auto overscroll-contain"
      role="region"
      aria-label="正文"
    >
      {phase === "error" ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-[var(--color-seal)]">{error}</p>
          <button
            type="button"
            onClick={() => void boot(jump.index)}
            className="rounded-full border border-[var(--color-paper-edge)] px-5 py-2 text-xs transition-colors hover:border-[var(--color-ink-faint)]"
          >
            重试
          </button>
        </div>
      ) : phase === "loading" ? (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs text-[var(--color-ink-faint)]">载入章节…</span>
        </div>
      ) : (
        <div className="mx-auto max-w-[42rem] px-6 pb-16 sm:px-10">
          {chapters.map((chapter, i) => (
            <section
              key={chapter.chapterUrl}
              data-chapter
              data-chapter-index={baseIndex + i}
              className={i === 0 ? "pt-8" : "pt-16"}
              aria-label={chapter.title}
            >
              {i > 0 ? (
                <div
                  aria-hidden
                  className="mb-10 flex items-center justify-center gap-3 text-xs tracking-[0.5em] text-[var(--color-ink-faint)]"
                >
                  <span className="h-px w-10 bg-[var(--color-paper-edge)]" />
                  <span>·</span>
                  <span className="h-px w-10 bg-[var(--color-paper-edge)]" />
                </div>
              ) : null}
              <h2 className="mb-8 font-[family-name:var(--font-serif-cn)] text-xl font-semibold">
                {chapter.title}
              </h2>
              <div className="reader-body" style={bodyStyle}>
                {chapter.paragraphs.map((text, index) => {
                  // 上传书的分页哨兵不该露出来
                  if (text === "\u0000") return null;
                  // 插图段落：解析器把 EPUB 里的图片转成了 data URI
                  if (text.startsWith("data:image/")) {
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={index}
                        src={text}
                        alt=""
                        className="mx-auto my-6 block max-w-full"
                      />
                    );
                  }
                  return <p key={index}>{text}</p>;
                })}
              </div>
            </section>
          ))}

          <div className="flex h-24 items-center justify-center text-xs text-[var(--color-ink-faint)]">
            {moreError ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                className="rounded-full border border-[var(--color-paper-edge)] px-4 py-1.5 transition-colors hover:border-[var(--color-ink-faint)]"
              >
                下一章加载失败，点击重试
              </button>
            ) : loadingMore ? (
              <span>正在载入下一章…</span>
            ) : reachedEnd ? (
              <span>全书完</span>
            ) : (
              <span className="opacity-0">继续下滑</span>
            )}
          </div>
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {chapters.length > 0
          ? `已加载 ${baseIndex + 1} 至 ${baseIndex + chapters.length} 章，共 ${toc.chapters.length} 章`
          : ""}
      </span>
    </div>
  );
}
