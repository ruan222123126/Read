import { beforeEach, describe, expect, it, vi } from "vitest";

import { readTocCache, tocStorageKey, writeTocCache, type TocCache } from "./useReader";

const store = new Map<string, string>();

const sessionStorageStub = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};

function seed(raw: unknown) {
  sessionStorageStub.setItem(tocStorageKey("书"), JSON.stringify(raw));
}

describe("readTocCache", () => {
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", sessionStorageStub);
    return () => vi.unstubAllGlobals();
  });

  const usable: TocCache = {
    sourceId: "s",
    bookUrl: "https://example.com/book",
    chapters: [{ title: "第一章", url: "https://example.com/book/1" }],
  };

  it("可用缓存原样返回", () => {
    writeTocCache("书", usable);
    expect(readTocCache("书")).toEqual(usable);
  });

  it("空章节目录当没有缓存，交给回源流程给出真实提示", () => {
    // 单篇/消歧义页抓不到目录，历史上会缓存空列表导致「章节索引超出范围」
    seed({ ...usable, chapters: [] });
    expect(readTocCache("书")).toBeNull();
  });

  it("章节缺 url 的缓存同样不可用", () => {
    seed({ ...usable, chapters: [{ title: "第一章" }] });
    expect(readTocCache("书")).toBeNull();
  });

  it("结构不对或 JSON 坏掉时返回 null", () => {
    seed({ chapters: "oops" });
    expect(readTocCache("书")).toBeNull();
    sessionStorageStub.setItem(tocStorageKey("书"), "{not json");
    expect(readTocCache("书")).toBeNull();
  });
});
