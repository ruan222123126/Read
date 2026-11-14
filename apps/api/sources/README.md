# 本地书源目录

把 Legado（阅读 3.0）书源 JSON 放到这个目录，`*.json` 会被自动加载。

## 为什么有这个目录

数据库没起来时（或干脆不想装 PostgreSQL），后端会回落到这里读取书源，
这样「搜索 → 目录 → 正文」整条链路可以立刻跑通验证。

- 数据库可用时优先用 `book_sources` 表（通过 `POST /api/v1/sources/import` 导入）
- 数据库不可用时读本目录，书源 ID 形如 `file:local-demo.json#本地示例源`

## local-demo.json

指向 `http://127.0.0.1:9911` 的本地假源站，配合下面这个命令即可完整验证：

```bash
# 启动本地假源站（见 apps/api/sources/demo_site.rs 说明）
cargo run -p read-server --example demo_site
```

然后：

```bash
curl "http://localhost:8080/api/v1/explore/search?q=斗破"
curl "http://localhost:8080/api/v1/explore/toc?source_id=file:local-demo.json%23本地示例源&book_url=http://127.0.0.1:9911/book/1001"
```
