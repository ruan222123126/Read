import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@read/shared"],
  experimental: {
    // 阅读器与书源解析都用 TS 直接跑，保持构建快
    optimizePackageImports: ["@read/shared"],
  },
  async headers() {
    return [
      {
        // Service Worker 必须每次校验，否则缓存旧版本
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
