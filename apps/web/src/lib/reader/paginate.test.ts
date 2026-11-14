import { describe, expect, it } from "vitest";

import { estimateLines, pageStartIndex, paginate } from "./paginate";

describe("estimateLines", () => {
  it("短文本占一行", () => {
    expect(estimateLines("你好", 10)).toBe(1);
  });

  it("超出每行宽度会换行", () => {
    expect(estimateLines("一二三四五六七八九十一二", 10)).toBe(2);
  });

  it("空文本占零行", () => {
    expect(estimateLines("", 10)).toBe(0);
  });
});

describe("paginate", () => {
  const paragraphs = Array.from({ length: 10 }, (_, i) => ({
    text: `第${i}段内容，大约十来个字的样子。`,
  }));

  it("空段落返回空页", () => {
    expect(paginate([], { viewportHeight: 800, lineHeight: 36, charsPerLine: 40 })).toEqual([]);
  });

  it("不会把内容撑出视口（每页行数受限）", () => {
    const pages = paginate(paragraphs, {
      viewportHeight: 180,
      lineHeight: 36,
      charsPerLine: 40,
    });
    expect(pages.length).toBeGreaterThan(1);
    // 页区间必须连续且不重不漏
    expect(pages[0]!.start).toBe(0);
    expect(pages.at(-1)!.end).toBe(paragraphs.length);
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.start).toBe(pages[i - 1]!.end);
    }
  });

  it("只有第一页需要首字下沉", () => {
    const pages = paginate(paragraphs, { viewportHeight: 200, lineHeight: 40, charsPerLine: 20 });
    expect(pages[0]!.dropCap).toBe(true);
    expect(pages.slice(1).every((p) => !p.dropCap)).toBe(true);
  });

  it("视口非法时退化为单页", () => {
    const pages = paginate(paragraphs, { viewportHeight: 0, lineHeight: 0, charsPerLine: 40 });
    expect(pages).toEqual([{ start: 0, end: paragraphs.length, dropCap: true }]);
  });
});

describe("pageStartIndex", () => {
  const pages = [
    { start: 0, end: 3, dropCap: true },
    { start: 3, end: 6, dropCap: false },
  ];

  it("返回该页首段索引", () => {
    expect(pageStartIndex(pages, 1)).toBe(3);
  });

  it("越界时钳制到最后一页", () => {
    expect(pageStartIndex(pages, 99)).toBe(3);
    expect(pageStartIndex(pages, -5)).toBe(0);
  });
});
