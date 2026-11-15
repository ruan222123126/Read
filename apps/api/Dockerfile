# Rust API 镜像。
#
# workspace 自包含在 apps/api 下，构建上下文就是 apps/api 目录
# （compose 里已按这个方式配置）：
#   docker build apps/api
#
# 要点：
# - SQLx migrations 通过 sqlx::migrate! 编译期嵌入二进制，运行时镜像不用带 migrations/
# - TLS 全部走 rustls（sqlx / reqwest），运行时只需要 CA 证书，不依赖系统 OpenSSL
# - 本地书源回落目录 sources/ 会在运行时读取，镜像里带上并指向 /app/sources

# ---------- 构建 ----------
# rust:1 即最新 stable，与 rust-toolchain.toml 的 channel = "stable" 一致
FROM rust:1-bookworm AS build
WORKDIR /api
COPY . .

# 依赖与编译产物挂 BuildKit 缓存，改代码重新构建不会从头编译全部 crate
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-target,target=/api/target \
    cargo build --release -p read-server \
    && cp /api/target/release/read-server /out-read-server

# ---------- 运行 ----------
FROM debian:bookworm-slim AS run
# 出站抓取书源需要系统 CA
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out-read-server /app/read-server
COPY sources /app/sources

ENV APP__HOST=0.0.0.0 \
    APP__PORT=8080 \
    SOURCES_DIR=/app/sources \
    RUST_LOG=read_server=info,tower_http=info
EXPOSE 8080
CMD ["/app/read-server"]
