"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ApiError, api, type SearchItem } from "@/lib/api";
import { db } from "@/lib/db";

interface Aggregated {
  name: string;
  author: string;
  cover: string | null;
  intro: string | null;
  lastChapter: string | null;
  kind: string | null;
  sources: SearchItem[];
}

/** 把同一本书的多个书源聚成一条，符合「统一书籍实体」的设计。 */
function aggregate(items: SearchItem[]): Aggregated[] {
  const map = new Map<string, Aggregated>();
  for (const item of items) {
    const key = `${item.name}::${item.author}`;
    const existing = map.get(key);
    if (existing) {
      existing.sources.push(item);
      existing.cover ??= item.cover_url;
      existing.intro ??= item.intro;
      existing.lastChapter ??= item.last_chapter;
      existing.kind ??= item.kind;
    } else {
      map.set(key, {
        name: item.name,
        author: item.author,
        cover: item.cover_url,
        intro: item.intro,
        lastChapter: item.last_chapter,
        kind: item.kind,
        sources: [item],
      });
    }
  }
  return [...map.values()];
}

export default function ExplorePage() {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [submitted, setSubmitted] = useState("");

  const search = useQuery({
    queryKey: ["explore", submitted],
    queryFn: () => api.search({ q: submitted }),
    enabled: submitted.length > 0,
  });

  const books = useMemo(() => aggregate(search.data?.items ?? []), [search.data]);

  const addToShelf = useMutation({
    mutationFn: async (book: Aggregated) => {
      const now = Date.now();
      const bookId = `${book.name}::${book.author}`;
      // 同时缓存目录，便于阅读器首屏直接出章节
      const primary = book.sources[0];
      await db.shelf.put({
        id: bookId,
        bookId,
        title: book.name,
        author: book.author,
        coverUrl: book.cover ?? undefined,
        sourceId: primary?.source_id,
        bookUrl: primary?.book_url,
        progress: 0,
        addedAt: now,
        lastReadAt: now,
        cached: false,
      });
      if (primary) {
        try {
          const toc = await api.toc({
            sourceId: primary.source_id,
            bookUrl: primary.book_url,
          });
          // 抓不到章节列表（比如加进来的是单篇/消歧义页）就不写缓存，
          // 让阅读器回源重抓，给出「没有返回章节列表」的真实提示
          if (toc.chapters.length === 0) {
            return bookId;
          }
          sessionStorage.setItem(
            `toc:${bookId}`,
            JSON.stringify({
              sourceId: primary.source_id,
              bookUrl: primary.book_url,
              chapters: toc.chapters,
            }),
          );
        } catch {
          // 目录抓取失败不影响加入书架
        }
      }
      return bookId;
    },
    onSuccess: (bookId) => router.push(`/read/${encodeURIComponent(bookId)}`),
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-6 py-14 sm:px-10">
      <header className="flex items-baseline justify-between">
        <h1 className="font-[family-name:var(--font-serif-cn)] text-2xl font-semibold">书城</h1>
        <nav className="flex gap-6 text-sm text-[var(--color-ink-soft)]">
          <Link href="/shelf" className="transition-colors hover:text-[var(--color-seal)]">
            书架
          </Link>
          <Link href="/sources" className="transition-colors hover:text-[var(--color-seal)]">
            书源
          </Link>
        </nav>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(keyword.trim());
        }}
        className="mt-10 flex gap-3"
      >
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索书名或作者"
          className="h-11 flex-1 rounded-full border border-[var(--color-paper-edge)] bg-transparent px-5 text-sm outline-none focus:border-[var(--color-ink-faint)]"
        />
        <button
          type="submit"
          disabled={!keyword.trim() || search.isFetching}
          className="h-11 rounded-full bg-[var(--color-ink)] px-7 text-sm text-[var(--color-paper)] disabled:opacity-40"
        >
          {search.isFetching ? "搜索中…" : "搜索"}
        </button>
      </form>

      {search.isError ? (
        <p className="mt-8 text-sm text-[var(--color-seal)]">
          {search.error instanceof ApiError ? search.error.message : "搜索失败"}
        </p>
      ) : null}

      {search.data && books.length === 0 && !search.isFetching ? (
        <p className="mt-12 text-sm text-[var(--color-ink-faint)]">没有找到相关书籍。</p>
      ) : null}

      {books.length > 0 ? (
        <ul className="mt-12 space-y-8">
          {books.map((book) => (
            <li
              key={`${book.name}::${book.author}`}
              className="flex gap-6 border-b border-[var(--color-paper-edge)] pb-8 last:border-0"
            >
              <div className="h-32 w-24 shrink-0 overflow-hidden rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)]">
                {book.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={book.cover} alt={book.name} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-[family-name:var(--font-serif-cn)] text-lg">{book.name}</h2>
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  {book.author}
                  {book.kind ? ` · ${book.kind}` : ""}
                </p>
                {book.intro ? (
                  <p className="mt-3 line-clamp-2 text-xs leading-6 text-[var(--color-ink-soft)]">
                    {book.intro}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {book.sources.length} 个书源
                  </span>
                  {book.sources.slice(0, 3).map((s) => (
                    <span
                      key={s.source_id}
                      className="rounded-full border border-[var(--color-paper-edge)] px-2.5 py-0.5 text-[11px] text-[var(--color-ink-soft)]"
                    >
                      {s.source_name}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => addToShelf.mutate(book)}
                    disabled={addToShelf.isPending}
                    className="ml-auto rounded-full bg-[var(--color-ink)] px-5 py-2 text-xs text-[var(--color-paper)] disabled:opacity-40"
                  >
                    {addToShelf.isPending ? "准备中…" : "加入书架并阅读"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {search.data && search.data.failures.length > 0 ? (
        <details className="mt-10 text-xs text-[var(--color-ink-faint)]">
          <summary className="cursor-pointer">
            {search.data.failures.length} 个书源抓取失败
          </summary>
          <ul className="mt-3 space-y-1">
            {search.data.failures.map((f) => (
              <li key={f.source_id} className="font-mono">
                {f.source_name}: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
