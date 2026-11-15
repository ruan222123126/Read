"use client";

/**
 * 阅读器排版面板。
 *
 * 阅读器本身是连续滚动（见 continuous-reader.tsx），
 * 这里只负责字体、字号、行距这些纯排版参数。
 */

import { cn } from "@/lib/utils";

/** 排版面板的设置子集，字段名与本地库保持一致，避免映射时丢字段。 */
export interface ReaderPanelSettings {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontFamily: "serif" | "kai" | "sans";
  paragraphIndent: boolean;
}

export function ReaderSettingsPanel({
  settings,
  onChange,
  className,
}: {
  settings: ReaderPanelSettings;
  onChange: (patch: Partial<ReaderPanelSettings>) => void;
  className?: string;
}) {
  const fonts: { key: ReaderPanelSettings["fontFamily"]; label: string; cls: string }[] = [
    { key: "serif", label: "宋体", cls: "font-[family-name:var(--font-serif-cn)]" },
    { key: "kai", label: "楷体", cls: "font-[family-name:var(--font-kai)]" },
    { key: "sans", label: "黑体", cls: "font-[family-name:var(--font-sans-cn)]" },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-paper-edge)] bg-[var(--color-paper)] p-5 shadow-sm",
        className,
      )}
    >
      <div className="space-y-5 text-xs">
        <div>
          <p className="mb-2 text-[var(--color-ink-faint)]">字体</p>
          <div className="flex gap-2">
            {fonts.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onChange({ fontFamily: f.key })}
                className={cn(
                  "flex-1 rounded-lg border py-2 transition-colors",
                  f.cls,
                  settings.fontFamily === f.key
                    ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                    : "border-[var(--color-paper-edge)] text-[var(--color-ink-soft)]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>字号</span>
            <span className="font-mono">{settings.fontSize}px</span>
          </span>
          <input
            type="range"
            min={14}
            max={30}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>行距</span>
            <span className="font-mono">{settings.lineHeight.toFixed(1)}</span>
          </span>
          <input
            type="range"
            min={1.4}
            max={2.6}
            step={0.1}
            value={settings.lineHeight}
            onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <label className="block">
          <span className="flex justify-between text-[var(--color-ink-faint)]">
            <span>字间距</span>
            <span className="font-mono">{settings.letterSpacing}px</span>
          </span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.5}
            value={settings.letterSpacing}
            onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--color-seal)]"
          />
        </label>

        <label className="flex items-center justify-between text-[var(--color-ink-faint)]">
          <span>首行缩进</span>
          <input
            type="checkbox"
            checked={settings.paragraphIndent}
            onChange={(e) => onChange({ paragraphIndent: e.target.checked })}
            className="accent-[var(--color-seal)]"
          />
        </label>
      </div>
    </div>
  );
}
