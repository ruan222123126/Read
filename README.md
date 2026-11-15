# 拾页 · Local-First 小说阅读站

本地优先阅读端 + 统一书籍元数据中心 + 沙箱化书源解析引擎。

- **前端**：Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4
- **本地层**：IndexedDB (Dexie) + 章节预取 + 段落指纹
- **后端**：Rust (Axum) + SQLx + PostgreSQL + Redis + MinIO
- **书源引擎**：Legado（阅读 3.0）JSON 兼容，纯解析无 IO

```
read/
├─ apps/
│  ├─ web/                          Next.js 前端
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ page.tsx             首页
│  │     │  ├─ explore/             书城（搜索 + 多源聚合）
│  │     │  ├─ shelf/               书架（IndexedDB）
│  │     │  ├─ sources/             书源导入与管理
│  │     │  └─ read/[bookId]/       阅读器
│  │     ├─ components/reader/      分栏翻页视图 + 排版面板
│  │     └─ lib/
│  │        ├─ api.ts               后端 API 客户端
│  │        ├─ db/                  Dexie 表结构
│  │        └─ reader/              章节缓存 / 预取 / 分页算法
│  └─ api/                          Rust 工作区
│     ├─ crates/domain/             归一化、SimHash 指纹、书源映射
│     ├─ crates/source-engine/      Legado 规则解析（CSS / 正则 / 变量）
│     ├─ crates/fetcher/            HTTP 抓取（限流 / 编码 / 重试）
│     ├─ crates/server/             Axum HTTP 服务
│     ├─ migrations/                PostgreSQL schema
│     └─ sources/                   本地书源目录（DB 不可用时回落）
└─ packages/shared/                 前后端共享类型 + TS 版指纹算法
```

## 快速开始

```bash
# 1. 依赖
pnpm install

# 2. 基础设施（可选，没有 Docker 也能跑）
pnpm db:up

# 3. 环境变量
cp .env.example .env

# 4. 后端（自动跑 migrations；DB 不可用时降级启动）
pnpm dev:api          # http://localhost:8080

# 5. 前端
pnpm dev:web          # http://localhost:3000
```

### 手机访问（局域网调试）

```bash
pnpm dev:lan
```

启动后终端会打印形如 `http://192.168.1.10:3000` 的地址，手机连同一个 Wi-Fi
直接打开即可。要点：

- Next 监听 `0.0.0.0`，API 也监听 `0.0.0.0`（见 `.env.example`）。
- 浏览器一律请求同源 `/backend/*`，由 Next 服务端反代到 Rust API，
  所以**不需要**在手机上改 `localhost`，也不会遇到 CORS。
- 首次连不上多半是 Windows 防火墙：放行 Node.js，或执行
  `netsh advfirewall firewall add rule name="read-dev" dir=in action=allow protocol=TCP localport=3000`

## 部署到服务器

Linux 服务器上一条 Docker Compose 拉起 web / api / PostgreSQL / Redis / MinIO，
可选 Caddy 自动 HTTPS：

```bash
cp .env.production.example .env   # 改掉密码
docker compose -f docker-compose.prod.yml up -d --build
```

完整步骤（域名 + HTTPS、日常更新、备份恢复、排查）见 **[docs/deploy.md](docs/deploy.md)**。

## 端到端验证（不需要数据库）

仓库内置了一个假源站和一条书源，用来验证完整链路：

```bash
# 终端 1：启动假源站
cd apps/api && cargo run -p read-server --example demo_site

# 终端 2：启动 API
cd apps/api && cargo run -p read-server

# 终端 3：启动前端
pnpm dev:web
```

打开 http://localhost:3000/explore ，搜索「斗破」，点「加入书架并阅读」，
即可看到抓取到的目录与正文（广告行已被清洗，每段附带 SimHash 指纹）。

命令行同样可用：

```bash
curl "http://localhost:8080/api/v1/health"
# {"status":"degraded","version":"0.1.0","database":"down"}

curl "http://localhost:8080/api/v1/explore/search?q=斗破"
curl "http://localhost:8080/api/v1/explore/toc?source_id=file:local-demo.json%23本地示例源&book_url=/book/1001"
curl "http://localhost:8080/api/v1/explore/content?source_id=file:local-demo.json%23本地示例源&chapter_url=/book/1001/1.html"
```

## 已落地的东西

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| Monorepo 脚手架 | ✅ | pnpm workspace + Cargo workspace，统一脚本 |
| 基础设施编排 | ✅ | docker compose：PostgreSQL 16 / Redis 7 / MinIO |
| 数据库 schema | ✅ | 书籍实体、书源、书源映射、章节段落、书评、段评 |
| 书籍实体归一化 | ✅ | `归一化书名\|归一化作者` 唯一索引，多源聚合成一条 |
| 段评锚定算法 | ✅ | SimHash64 + 汉明距离容错，Rust 与 TS 双实现（算法一致） |
| Legado 规则解析 | ✅ | JSON 结构、CSS 简写、`##正则##` 清洗、`{{变量}}` 替换 |
| HTTP 抓取 | ✅ | UA/超时/重试/体积上限、GBK 嗅探、按 host 软限流 |
| 搜索 → 目录 → 正文 | ✅ | 并发搜索多源、单源失败隔离、相对 URL 补全 |
| 本地存储 | ✅ | Dexie：shelf / chapters / settings |
| 阅读器 | ✅ | 分栏翻页、滚动模式、键盘/点击翻页、字号行距字距、首行缩进 |
| 章节预取 | ✅ | 读完自动预取后 5 章，超量自动清理 |
| 书评 / 段评 UI | ⬜ | 数据表与算法已就位，接口与浮层待补 |
| 用户鉴权 | ⬜ | 表结构已就位 |
| JS 沙箱（QuickJS） | ⬜ | 当前只做变量替换，不 eval 任何脚本 |

## 设计要点

### 为什么书评不能挂在「书源 URL」上

同一本书在 5 个书源里是 5 个 URL。若评论按 URL 存储，换源即失联。
因此拆成两层：`canonical_books`（唯一实体）承载评论与评分，
`book_source_mappings` 只记录「这本书在该源下的坐标与健康度」。

### 为什么段评不能用「第 N 段」

不同书源排版空格、全半角、错别字都不同。入库时对每段做归一化
（全角→半角、去空白、去标点、小写）后算 SimHash64，渲染时对本地段落
再算一次，汉明距离 ≤ 3 即认为同一段。前端切源后气泡自动重新挂载。

```rust
// apps/api/crates/domain/src/fingerprint.rs
pub fn is_same_paragraph(a: &str, b: &str) -> bool {
    hamming(simhash64(a), simhash64(b)) <= 3
}
```

```ts
// packages/shared/src/text/fingerprint.ts（同算法）
isSameParagraph(a, b); // true
```

### 书源引擎的边界

`read-source-engine` 不做网络请求、不 eval JS，只做「HTML + 规则 → 结构化数据」，
因此可以被单测完全覆盖，也能安全地搬进 worker 或 WASM。
`<js>...</js>` 片段的执行留给独立 worker + QuickJS。

### 分栏翻页为什么不用 JS 算宽度

页宽用 CSS 容器查询单位 `100cqw` —— 一页恰好等于视口宽度。
JS 只负责数一共几页（`scrollWidth / clientWidth`）并做位移，
首帧就是正确的分栏，不需要等一次测量。

### 数据库不可用时为什么还能跑

`AppState::connect` 连不上 PostgreSQL 时不退出，改用惰性连接池启动：
- `/health` 如实报告 `database: "down"`
- 需要数据库的接口返回 503
- 书源回落到 `apps/api/sources/*.json`，搜索/目录/正文照常工作

这样开发时不装 Docker 也能把整条链路跑通。

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:web` | 前端开发服务器 |
| `pnpm dev:lan` | 前端开发服务器（打印手机可用的局域网地址） |
| `pnpm dev:api` | 后端开发服务器 |
| `pnpm test` | 前端 + 后端全部单测（35 + 17） |
| `pnpm lint` | ESLint + clippy（`-D warnings`） |
| `pnpm typecheck` | TS 类型检查 |
| `pnpm fmt` | rustfmt + prettier |
| `pnpm db:migrate` | 手动执行 SQLx migrations |

## 路线图

1. ~~核心闭环：书源搜索 → 目录抓取 → 正文净化~~ ✅
2. **极致阅读器**：字体子集化、纸张色调切换、一键换源（当前：分栏翻页与预取已完成）
3. **社区与书评**：元数据聚合清洗、Markdown 长评、段评浮层
4. **JS 沙箱**：QuickJS worker + 500ms/内存上限，支持需要脚本清洗的书源
