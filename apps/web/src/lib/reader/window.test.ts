import { describe, expect, it } from "vitest";

import {
  adjustScrollTop,
  needsTrim,
  nextBase,
  remainingPixels,
  shouldLoadMore,
} from "./window";

describe("needsTrim", () => {
  it("窗口未满时不裁剪", () => {
    expect(needsTrim(24, 24)).toBe(false);
    expect(needsTrim(10, 24)).toBe(false);
  });

  it("超出上限才裁剪", () => {
    expect(needsTrim(25, 24)).toBe(true);
  });
});

describe("nextBase", () => {
  it("从头部裁掉 N 章后起始下标后移 N", () => {
    expect(nextBase(0, 8)).toBe(8);
    expect(nextBase(12, 8)).toBe(20);
  });

  it("未裁剪时不变", () => {
    expect(nextBase(5, 0)).toBe(5);
  });
});

describe("adjustScrollTop", () => {
  it("裁掉多少高度就减去多少，画面不跳", () => {
    expect(adjustScrollTop(5000, 1200)).toBe(3800);
  });

  it("被裁高度超过已滚动距离时钳到 0", () => {
    expect(adjustScrollTop(300, 1200)).toBe(0);
  });
});

describe("remainingPixels", () => {
  it("已滚到底时为 0", () => {
    expect(remainingPixels(1000, 800, 200)).toBe(0);
  });

  it("中途计算剩余距离", () => {
    expect(remainingPixels(1000, 300, 200)).toBe(500);
  });
});

describe("shouldLoadMore", () => {
  it("剩余不足一屏的 1.1 倍时继续加载", () => {
    // 剩 100px < 200 * 1.1
    expect(shouldLoadMore(1000, 700, 200, 1.1)).toBe(true);
  });

  it("剩余充足时按兵不动", () => {
    // 剩 500px > 200 * 1.1
    expect(shouldLoadMore(1000, 300, 200, 1.1)).toBe(false);
  });

  it("视口高度为 0 时不做判断，避免首帧误触发", () => {
    expect(shouldLoadMore(1000, 0, 0, 1.1)).toBe(false);
  });
});
