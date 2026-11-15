import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@read/shared"],
  experimental: {
    // 阅读器与书源解析都用 TS 直接跑，保持构建快
    optimizePackageImports: ["@read/shared"],
    // /backend 反代默认只缓冲 10MB 请求体；上传整本书的 JSON（正文 + 封面）
    // 可以到几十 MB，放宽到 100MB，与服务端 body 上限保持一致
    proxyClientMaxBodySize: "100mb",
  },
  // 允许局域网内手机等设备访问 dev server
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  async rewrites() {
    // 浏览器统一走同源 /backend，由 Next 服务器反代到 Rust API。
    // 这样手机访问 http://<电脑IP>:3000 也能用，不需要改 base url、也不会撞 CORS。
    const target = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8080";
    return [{ source: "/backend/:path*", destination: `${target}/:path*` }];
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
