"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";

import { db } from "@/lib/db";

export default function ShelfPage() {
  const items = useLiveQuery(() => db.shelf.orderBy("lastReadAt").reverse().toArray(), []);

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
            先导入一份 Legado 书源，然后在书城里搜索想读的书。
          </p>
          <Link
            href="/sources"
            className="mt-8 rounded-full border border-[var(--color-paper-edge)] px-6 py-2.5 text-sm transition-colors hover:border-[var(--color-ink-faint)]"
          >
            导入书源
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/read/${encodeURIComponent(item.bookId)}`} className="group block">
                <div className="aspect-[3/4] w-full overflow-hidden rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)]">
                  {item.coverUrl ? (
                    // 封面来自远端书源，用原生 img 避免 next/image 域名白名单
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
    </main>
  );
}
