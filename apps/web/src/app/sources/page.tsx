"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, api } from "@/lib/api";

export default function SourcesPage() {
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const sources = useQuery({ queryKey: ["sources"], queryFn: api.listSources });

  const importMutation = useMutation({
    mutationFn: (json: string) => api.importSources(json),
    onSuccess: (res) => {
      setNotice(`成功导入 ${res.imported} 个书源${res.skipped ? `，跳过 ${res.skipped} 个` : ""}。`);
      setRaw("");
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (err) => {
      setNotice(err instanceof ApiError ? err.message : "导入失败，请检查后端是否已启动。");
    },
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl px-6 py-14 sm:px-10">
      <header className="flex items-baseline justify-between">
        <h1 className="font-[family-name:var(--font-serif-cn)] text-2xl font-semibold">书源</h1>
        <Link
          href="/shelf"
          className="text-sm text-[var(--color-ink-soft)] transition-colors hover:text-[var(--color-seal)]"
        >
          返回书架
        </Link>
      </header>

      <section className="mt-10 rounded-xl border border-[var(--color-paper-edge)] p-6">
        <h2 className="text-sm font-medium">导入 Legado 书源</h2>
        <p className="mt-2 text-xs leading-6 text-[var(--color-ink-faint)]">
          直接粘贴阅读 3.0 的书源 JSON（数组或单个对象均可），系统会以「源站地址 + 源名」去重。
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          placeholder='[ { "bookSourceName": "示例源", "bookSourceUrl": "https://example.com", "searchUrl": "...", "ruleSearch": { ... } } ]'
          className="mt-4 h-48 w-full resize-y rounded-lg border border-[var(--color-paper-edge)] bg-[var(--color-paper-deep)] p-4 font-mono text-xs leading-6 outline-none focus:border-[var(--color-ink-faint)]"
        />
        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            disabled={!raw.trim() || importMutation.isPending}
            onClick={() => importMutation.mutate(raw)}
            className="rounded-full bg-[var(--color-ink)] px-6 py-2.5 text-sm text-[var(--color-paper)] disabled:opacity-40"
          >
            {importMutation.isPending ? "导入中…" : "导入"}
          </button>
          {notice ? (
            <span className="text-xs text-[var(--color-ink-soft)]">{notice}</span>
          ) : null}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium">已导入（{sources.data?.length ?? 0}）</h2>

        {sources.isPending ? (
          <p className="mt-6 text-xs text-[var(--color-ink-faint)]">读取中…</p>
        ) : sources.isError ? (
          <p className="mt-6 text-xs text-[var(--color-seal)]">
            无法连接后端 API，请先启动 <code className="font-mono">pnpm dev:api</code>。
          </p>
        ) : sources.data.length === 0 ? (
          <p className="mt-6 text-xs text-[var(--color-ink-faint)]">还没有书源。</p>
        ) : (
          <ul className="mt-6 divide-y divide-[var(--color-paper-edge)]">
            {sources.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.name}</p>
                  <p className="mt-1 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                    {s.url}
                  </p>
                </div>
                <span
                  className={
                    s.enabled
                      ? "shrink-0 rounded-full bg-[var(--color-jade)]/12 px-3 py-1 text-xs text-[var(--color-jade)]"
                      : "shrink-0 rounded-full bg-[var(--color-paper-edge)] px-3 py-1 text-xs text-[var(--color-ink-faint)]"
                  }
                >
                  {s.enabled ? "启用" : "停用"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
