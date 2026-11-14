import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "拾页 · 本地优先的小说阅读器",
    template: "%s · 拾页",
  },
  description:
    "本地优先的沉浸式小说阅读器：多书源聚合、零延迟翻页、断网可读、跨书源段评。",
  applicationName: "拾页",
  appleWebApp: {
    capable: true,
    title: "拾页",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f1e7" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1815" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="paper-grain min-h-full antialiased">
        <Providers>
          <div className="relative z-10">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
