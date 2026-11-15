/**
 * 连续滚动的窗口计算。
 *
 * 读者往下滑会不断追加新章，DOM 不能无限长，
 * 所以窗口满了要从头部裁掉几章。裁完必须把 scrollTop 减去被裁掉的高度，
 * 否则画面会突然往上跳——这部分逻辑与 DOM 无关，单独放这里便于测试。
 */

/** 追加一章后是否需要裁剪头部 */
export function needsTrim(loaded: number, max: number): boolean {
  return loaded > max;
}

/** 裁剪后新的窗口起始章下标 */
export function nextBase(base: number, cut: number): number {
  return base + Math.max(0, cut);
}

/**
 * 裁剪后的 scrollTop。
 *
 * removedHeight 是被裁掉那几章叠起来的总高度（px）。
 * 结果不会小于 0，避免裁掉的内容比已滚动距离还多时滚到负坐标。
 */
export function adjustScrollTop(scrollTop: number, removedHeight: number): number {
  return Math.max(0, scrollTop - removedHeight);
}

/** 视口底部还剩多少像素 */
export function remainingPixels(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
): number {
  return scrollHeight - scrollTop - clientHeight;
}

/** 剩余空间不足阈值时触发加载 */
export function shouldLoadMore(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdRatio: number,
): boolean {
  if (clientHeight <= 0) return false;
  return remainingPixels(scrollHeight, scrollTop, clientHeight) < clientHeight * thresholdRatio;
}
