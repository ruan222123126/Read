"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ImportDialog } from "@/components/import/import-dialog";
import { api } from "@/lib/api";
import { addLocalBookToShelf } from "@/lib/import";
import { db } from "@/lib/db";

export default function ShelfPage() {
  const items = useLiveQuery(() => db.shelf.orderBy("lastReadAt").reverse().toArray(), []);
  const [showImport, setShowImport] = useState(false);

  // 触发 Dexie 的惰性初始化
  useEffect(() => {
    void db.shelf.count();
  }, []);

  const isEmpty = items !== undefined && items.length === 0;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-6 py-14 sm:px-10">
      <header className="flex items-baseline justify-between">
        <h1 className="font-[family-name:var(--font-serif-cn)] text-2xl font-semibold">书架</h1>
        <nav className="flex gap-6 text-sm text-[var(--color-ink-soft)]">
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="transition-colors hover:text-[var(--color-seal)]"
          >
            导入书籍
          </button>
          <Link href="/explore" className="transition-colors hover:text-[var(--color-seal)]">
            书城
          </Link>
          <Link href="/sources" className="transition-colors hover:text-[var(--color-seal)]">
            管理书源
          </Link>
        </nav>
      </header>

      {items === undefined ? (
        <p className="mt-16 text-sm text-[var(--color-ink-faint)]">正在读取本地书架…</p>
      ) : isEmpty ? (
        <div className="mt-24 flex flex-col items-center text-center">
          <div className="h-28 w-20 rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)]" />
          <p className="mt-8 text-sm text-[var(--color-ink-soft)]">书架还是空的。</p>
          <p className="mt-2 max-w-sm text-xs leading-6 text-[var(--color-ink-faint)]">
            导入本地的 EPUB / MOBI / TXT 书籍，或先导入一份 Legado 书源在书城里搜书。
          </p>
          <div className="mt-8 flex gap-3">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="rounded-full border border-[var(--color-paper-edge)] px-6 py-2.5 text-sm transition-colors hover:border-[var(--color-ink-faint)]"
            >
              导入书籍
            </button>
            <Link
              href="/sources"
              className="rounded-full border border-[var(--color-paper-edge)] px-6 py-2.5 text-sm leading-9 transition-colors hover:border-[var(--color-ink-faint)]"
            >
              导入书源
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/read/${encodeURIComponent(item.bookId)}`} className="group block">
                <div className="aspect-[3/4] w-full overflow-hidden rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)]">
                  {item.coverUrl ? (
                    // 封面来自远端书源或 data URI，用原生 img 避免 next/image 域名白名单
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.coverUrl}
                      alt={item.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  ) : null}
                </div>
                <p className="mt-3 truncate font-[family-name:var(--font-serif-cn)] text-sm">
                  {item.title}
                </p>
                <p className="mt-1 truncate text-xs text-[var(--color-ink-faint)]">{item.author}</p>
                <div className="mt-2 h-0.5 w-full bg-[var(--color-paper-edge)]">
                  <div
                    className="h-full bg-[var(--color-seal)]"
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <LibrarySection onImport={() => setShowImport(true)} />

      {showImport ? <ImportDialog onClose={() => setShowImport(false)} /> : null}
    </main>
  );
}

/** 服务端书库（上传的书）：本机书架之外的设备从这里一键加入书架 */
function LibrarySection({ onImport }: { onImport: () => void }) {
  const shelfItems = useLiveQuery(() => db.shelf.toArray(), []);
  const shelfIds = new Set((shelfItems ?? []).map((item) => item.bookId));

  const query = useQuery({
    queryKey: ["local-books"],
    queryFn: () => api.listLocalBooks(),
  });

  const books = query.data ?? [];
  if (query.isSuccess && books.length === 0) return null;

  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between border-b border-[var(--color-paper-edge)] pb-3">
        <h2 className="font-[family-name:var(--font-serif-cn)] text-lg font-semibold">
          书库<span className="ml-3 text-xs font-normal text-[var(--color-ink-faint)]">上传的书籍</span>
        </h2>
        <button
          type="button"
          onClick={onImport}
          className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-seal)]"
        >
          + 导入
        </button>
      </div>

      {query.isError ? (
        <p className="mt-6 text-xs leading-6 text-[var(--color-ink-faint)]">
          书库需要后端数据库在运行（docker compose up -d postgres）。
        </p>
      ) : query.isPending ? (
        <p className="mt-6 text-xs text-[var(--color-ink-faint)]">读取书库…</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {books.map((book) => {
            const onShelf = shelfIds.has(book.id);
            return (
              <li key={book.id}>
                <div className="aspect-[3/4] w-full overflow-hidden rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)]">
                  {book.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={book.cover_url}
                      alt={book.title}
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <p className="mt-3 truncate font-[family-name:var(--font-serif-cn)] text-sm">
                  {book.title}
                </p>
                <p className="mt-1 truncate text-xs text-[var(--color-ink-faint)]">
                  {book.author} · {book.format.toUpperCase()} · {book.chapter_count} 章
                </p>
                {onShelf ? (
                  <Link
                    href={`/read/${encodeURIComponent(book.id)}`}
                    className="mt-2 block rounded-full border border-[var(--color-paper-edge)] px-4 py-1.5 text-center text-xs text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-ink-faint)]"
                  >
                    继续阅读
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => void addLocalBookToShelf(book)}
                    className="mt-2 w-full rounded-full border border-[var(--color-paper-edge)] px-4 py-1.5 text-xs text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-ink-faint)]"
                  >
                    加入书架
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
