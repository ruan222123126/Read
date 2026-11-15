"use client";

/**
 * 导入书籍对话框：拖拽 / 多选 EPUB、MOBI、TXT 文件，
 * 逐个解析上传，行内反馈每个文件的识别结果。
 */

import { useCallback, useRef, useState } from "react";

import { importFiles } from "@/lib/import";

interface ImportItem {
  file: string;
  status: "pending" | "parsing" | "uploading" | "done" | "duplicate" | "error";
  message?: string;
}

const STATUS_TEXT: Record<ImportItem["status"], string> = {
  pending: "等待中",
  parsing: "解析中…",
  uploading: "上传中…",
  done: "已入库",
  duplicate: "已存在",
  error: "失败",
};

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const runImport = useCallback(async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setItems(files.map((file) => ({ file: file.name, status: "pending" })));

    await importFiles(files, (progress) => {
      setItems((prev) =>
        prev.map((item) =>
          item.file === progress.file
            ? { ...item, status: progress.phase === "parsing" ? "parsing" : "uploading" }
            : item,
        ),
      );
    }).then((results) => {
      setItems((prev) =>
        prev.map((item) => {
          const result = results.find((r) => r.file === item.file);
          return result
            ? { ...item, status: result.status, message: result.message }
            : item;
        }),
      );
      setBusy(false);
    });
  }, [busy]);

  const pickFiles = (list: FileList | null) => {
    void runImport(Array.from(list ?? []));
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-lg rounded-sm border border-[var(--color-paper-edge)] bg-[var(--color-paper)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="导入书籍"
      >
        <div className="flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-serif-cn)] text-lg font-semibold">导入书籍</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-soft)]"
          >
            关闭
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--color-ink-faint)]">
          支持 EPUB（含插图版）、MOBI、TXT。自动识别书名作者、切分章节后存入书库。
        </p>

        <div
          className={`mt-5 flex flex-col items-center justify-center rounded-sm border border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-[var(--color-seal)] bg-[var(--color-paper-deep)]"
              : "border-[var(--color-paper-edge)]"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFiles(e.dataTransfer.files);
          }}
        >
          <p className="text-sm text-[var(--color-ink-soft)]">把书籍文件拖到这里</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-full border border-[var(--color-paper-edge)] px-5 py-2 text-xs transition-colors hover:border-[var(--color-ink-faint)] disabled:opacity-50"
          >
            选择文件
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".epub,.mobi,.azw3,.azw,.prc,.txt"
            className="hidden"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 ? (
          <ul className="mt-4 max-h-56 space-y-1.5 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.file}
                className="flex items-baseline justify-between gap-3 rounded-sm bg-[var(--color-paper-deep)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-[var(--color-ink-soft)]">{item.file}</p>
                  {item.message ? (
                    <p
                      className={`mt-0.5 truncate text-[10px] ${
                        item.status === "error" ? "text-[var(--color-seal)]" : "text-[var(--color-ink-faint)]"
                      }`}
                    >
                      {item.message}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 text-[10px] ${
                    item.status === "error"
                      ? "text-[var(--color-seal)]"
                      : item.status === "done" || item.status === "duplicate"
                        ? "text-[var(--color-jade)]"
                        : "text-[var(--color-ink-faint)]"
                  }`}
                >
                  {STATUS_TEXT[item.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
