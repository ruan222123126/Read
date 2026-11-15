# Next.js 前端镜像。
#
# pnpm workspace 依赖仓库根目录的 lockfile 和 packages/shared，
# 所以构建上下文必须是仓库根目录：
#   docker build -f apps/web/Dockerfile .
# （compose 里已按这个方式配置。）
#
# 注意：/backend 反代目标 API_INTERNAL_URL 在构建期写进 routes-manifest，
# compose 网络里 API 固定叫 api（http://api:8080）；换拓扑需要重新 build 并传
# --build-arg API_INTERNAL_URL=...。

# ---------- 构建 ----------
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable

# 先只拷贝依赖清单，锁文件不变时这层缓存可复用
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@read/web..."

# 再拷贝源码并构建
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG API_INTERNAL_URL=http://api:8080
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @read/web build

# ---------- 运行 ----------
# standalone 产物自带精简 node_modules，无需再装依赖
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
