"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CachedChapter } from "@/lib/db";
import { cn } from "@/lib/utils";

export interface ReaderViewProps {
  chapter: CachedChapter;
  /** paged: 左右分栏翻页；scroll: 上下滚动 */
  mode: "paged" | "scroll";
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: "serif" | "kai" | "sans";
  paragraphIndent: boolean;
  /** 翻到章末时触发（用于自动进入下一章） */
  onReachEnd?: () => void;
  /** 翻到章首再往前时触发 */
  onReachStart?: () => void;
  /** 当前页变化，用于保存进度 */
  onPageChange?: (page: number, total: number) => void;
}

/** 排版面板用的设置子集，字段名与本地库保持一致，避免映射时丢字段。 */
export interface ReaderPanelSettings {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: "serif" | "kai" | "sans";
  mode: "paged" | "scroll";
  paragraphIndent: boolean;
}

const FONT_STACK: Record<ReaderViewProps["fontFamily"], string> = {
  serif: "var(--font-serif-cn)",
  kai: "var(--font-kai)",
  sans: "var(--font-sans-cn)",
};

export function ReaderView({
  chapter,
  mode,
  fontSize,
  lineHeight,
  letterSpacing,
  fontFamily,
  paragraphIndent,
  onReachEnd,
  onReachStart,
  onPageChange,
}: ReaderViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // 章节切换时回到第一页
  useEffect(() => {
    setPage(0);
  }, [chapter.id]);

  // 统计列数：宽度完全交给 CSS（100cqw），JS 只数一共几页
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || mode !== "paged") return;

    let raf = 0;
    let prev = -1;
    let stableFrames = 0;
    let frames = 0;
    let disposed = false;

    // 分栏重排是异步的（字体加载、样式计算都会影响），
    // 所以要反复测量，直到列数稳定且字体已就绪。
    const measure = () => {
      if (disposed) return;
      const node = contentRef.current;
      const width = el.clientWidth;
      if (!node || width === 0) {
        raf = requestAnimationFrame(measure);
        return;
      }

      const cols = Math.max(1, Math.round(node.scrollWidth / width));
      if (cols === prev) {
        stableFrames += 1;
      } else {
        prev = cols;
        stableFrames = 0;
      }

      setTotalPages(cols);
      setPage((p) => Math.min(p, cols - 1));

      frames += 1;
      const fontsReady = document.fonts?.status === "loaded";
      // 稳定 4 帧且字体就绪才停；最多测 180 帧（约 3 秒）兜底
      if ((stableFrames < 4 || !fontsReady) && frames < 180) {
        raf = requestAnimationFrame(measure);
      }
    };

    measure();

    // 容器尺寸变化后重新计数
    const ro = new ResizeObserver(() => {
      prev = -1;
      stableFrames = 0;
      frames = 0;
      cancelAnimationFrame(raf);
      measure();
    });
    ro.observe(el);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, chapter.id, fontSize, lineHeight, letterSpacing, fontFamily]);

  useEffect(() => {
    onPageChange?.(page, totalPages);
  }, [page, totalPages, onPageChange]);

  const next = useCallback(() => {
    if (mode === "scroll") {
      const el = viewportRef.current;
      if (!el) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      if (atBottom) {
        onReachEnd?.();
      } else {
        el.scrollBy({ top: el.clientHeight * 0.9, behavior: "smooth" });
      }
      return;
    }

    if (page >= totalPages - 1) {
      onReachEnd?.();
      return;
    }
    setPage((p) => p + 1);
  }, [mode, page, totalPages, onReachEnd]);

  const prev = useCallback(() => {
    if (mode === "scroll") {
      const el = viewportRef.current;
      if (!el) return;
      if (el.scrollTop <= 8) {
        onReachStart?.();
      } else {
        el.scrollBy({ top: -el.clientHeight * 0.9, behavior: "smooth" });
      }
      return;
    }

    if (page <= 0) {
      onReachStart?.();
      return;
    }
    setPage((p) => p - 1);
  }, [mode, page, onReachStart]);

  // 键盘翻页
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          setPage(0);
          break;
        case "End":
          e.preventDefault();
          if (mode === "paged") setPage(totalPages - 1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, mode, totalPages]);

  // 点击左右区域翻页
  const onViewportClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.28) prev();
    else if (x > rect.width * 0.72) next();
  };

  const paragraphs = useMemo(
    () =>
      chapter.paragraphs.map((text, i) => (
        <p key={i} data-index={i}>
          {text}
        </p>
      )),
    [chapter.paragraphs],
  );

  const bodyStyle: React.CSSProperties = {
    fontFamily: FONT_STACK[fontFamily],
    fontSize: `${fontSize}px`,
    lineHeight,
    letterSpacing: `${letterSpacing}px`,
    textIndent: paragraphIndent ? "2em" : "0",
  };

  if (mode === "scroll") {
    return (
      <div
        ref={viewportRef}
        onClick={onViewportClick}
        className="reader-scroll relative h-full overflow-y-auto"
      >
        <div className="mx-auto max-w-[42rem] px-6 py-10">
          <h2 className="mb-8 font-[family-name:var(--font-serif-cn)] text-xl font-semibold">
            {chapter.title}
          </h2>
          <div className="reader-body" style={bodyStyle}>
            {paragraphs}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      onClick={onViewportClick}
      className="reader-viewport relative h-full overflow-hidden"
      role="region"
      aria-label="正文"
    >
      <div
        ref={contentRef}
        className="paged-columns reader-body px-0"
        style={{
          ...bodyStyle,
          // 位移用百分比：一页 = 一个容器宽，不依赖像素测量
          transform: `translateX(-${page * 100}%)`,
        }}
      >
        <h2
          className="mb-6 font-[family-name:var(--font-serif-cn)] text-xl font-semibold"
          style={{ textIndent: 0 }}
        >
          {chapter.title}
        </h2>
        {paragraphs}
      </div>

      {/* 页码 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <span className="font-mono text-[11px] tracking-widest text-[var(--color-ink-faint)]">
          {page + 1} / {totalPages}
        </span>
      </div>
    </div>
  );
}

/** 阅读设置面板 */
export function ReaderSettingsPanel({
  settings,
  onChange,
  className,
}: {
  settings: ReaderPanelSettings;
  onChange: (patch: Partial<ReaderPanelSettings>) => void;
  className?: string;
}) {
  const fonts: { key: ReaderPanelSettings["fontFamily"]; label: string; cls: string }[] = [
    { key: "serif", label: "宋体", cls: "font-[family-name:var(--font-serif-cn)]" },
    { key: "kai", label: "楷体", cls: "font-[family-name:var(--font-kai)]" },
    { key: "sans", label: "黑体", cls: "font-[family-name:var(--font-sans-cn)]" },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-paper-edge)] bg-[var(--color-paper)] p-5 shadow-sm",
        className,
      )}
    >
      <div className="space-y-5 text-xs">
        <div>
          <p className="mb-2 text-[var(--color-ink-faint)]">字体</p>
          <div className="flex gap-2">
            {fonts.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onChange({ fontFamily: f.key })}
                className={cn(
                  "flex-1 rounded-lg border py-2 transition-colors",
                  f.cls,
                  settings.fontFamily === f.key
                    ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                    : "border-[var(--color-paper-edge)] text-[var(--color-ink-soft)]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>字号</span>
            <span className="font-mono">{settings.fontSize}px</span>
          </span>
          <input
            type="range"
            min={14}
            max={30}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>行距</span>
            <span className="font-mono">{settings.lineHeight.toFixed(1)}</span>
          </span>
          <input
            type="range"
            min={1.4}
            max={2.6}
            step={0.1}
            value={settings.lineHeight}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>字间距</span>
            <span className="font-mono">{settings.letterSpacing}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.5}
            value={settings.letterSpacing}
            onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <div>
          <p className="mb-2 text-[var(--color-ink-faint)]">翻页方式</p>
          <div className="flex gap-2">
            {(
              [
                { key: "paged", label: "左右翻页" },
                { key: "scroll", label: "上下滚动" },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange({ mode: m.key })}
                className={cn(
                  "flex-1 rounded-lg border py-2 transition-colors",
                  settings.mode === m.key
                    ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                    : "border-[var(--color-paper-edge)] text-[var(--color-ink-soft)]",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between text-[var(--color-ink-faint)]">
          <span>首行缩进</span>
          <input
            type="checkbox"
            checked={settings.paragraphIndent}
            onChange={(e) => onChange({ paragraphIndent: e.target.checked })}
            className="accent-[var(--color-seal)]"
          />
        </label>
      </div>
    </div>
  );
}
