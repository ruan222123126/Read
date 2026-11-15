"use client";

/**
 * 底栏的章节进度条。
 *
 * 椭圆轨道 + 进度填充 + 圆点滑块：
 * - 拖动滑块（或按在轨道任意位置）会实时预览目标章节，松手才真正跳章；
 * - 点按轨道某一点直接跳到对应章节；
 * - 聚焦后可用方向键逐章移动。
 *
 * 拖动期间滑条区域会被「第 X 章 · 章节名」覆盖：条栏高度有限，
 * 浮层放不下，直接替换比浮动提示更稳。
 */

import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface ChapterSliderProps {
  /** 总章节数；不足 2 章时不可拖 */
  count: number;
  /** 当前章（绝对下标） */
  index: number;
  /** 章节列表，拖动预览时取目标章名 */
  chapters: { title: string }[];
  onSeek: (chapterIndex: number) => void;
}

export function ChapterSlider({ count, index, chapters, onSeek }: ChapterSliderProps) {
  /** 轨道几何只看这个元素；指针事件挂在带内边距的外层，扩大触区 */
  const trackRef = useRef<HTMLDivElement>(null);
  /** 拖动中的比例；null 表示没在拖 */
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragging = useRef(false);

  const disabled = count <= 1;
  const ratio = disabled ? 1 : index / (count - 1);
  const shownRatio = dragRatio ?? ratio;
  const previewIndex = disabled
    ? 0
    : Math.min(count - 1, Math.max(0, Math.round(shownRatio * (count - 1))));

  const ratioFromX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    dragging.current = true;
    // 个别浏览器/合成事件里 capture 会失败，不该因此中断拖动
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 指针还在元素上时拖动本来就能工作 */
    }
    setDragRatio(ratioFromX(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setDragRatio(ratioFromX(e.clientX));
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, seek: boolean) => {
    if (!dragging.current) return;
    dragging.current = false;
    const final = ratioFromX(e.clientX);
    setDragRatio(null);
    if (seek && !disabled) {
      const target = Math.round(final * (count - 1));
      if (target !== index) onSeek(target);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const last = count - 1;
    if (e.key === "ArrowLeft") onSeek(Math.max(0, index - 1));
    else if (e.key === "ArrowRight") onSeek(Math.min(last, index + 1));
    else if (e.key === "Home") onSeek(0);
    else if (e.key === "End") onSeek(last);
    else return;
    e.preventDefault();
  };

  const percent = `${shownRatio * 100}%`;

  return (
    <div
      role="slider"
      aria-label={`章节进度：第 ${index + 1} 章，共 ${count} 章`}
      aria-valuemin={1}
      aria-valuemax={Math.max(count, 1)}
      aria-valuenow={index + 1}
      tabIndex={disabled ? -1 : 0}
      data-tap-ignore
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishDrag(e, true)}
      onPointerCancel={(e) => finishDrag(e, false)}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative min-w-0 flex-1 touch-none py-2.5",
        !disabled && "cursor-pointer select-none",
      )}
    >
      <div ref={trackRef} className="relative h-1.5 rounded-full bg-[var(--color-paper-edge)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-seal)]"
          style={{ width: percent }}
        />
        <div
          className={cn(
            "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-seal)] ring-2 ring-[var(--color-paper)]",
            !disabled && dragRatio == null && "transition-[left] duration-150 ease-out",
          )}
          style={{ left: percent }}
        />
      </div>

      {dragRatio != null ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-paper)] text-xs">
          <span className="shrink-0 text-[var(--color-ink-faint)]">
            第 {previewIndex + 1} / {count} 章
          </span>
          <span className="ml-2 min-w-0 truncate text-[var(--color-ink)]">
            {chapters[previewIndex]?.title ?? ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
