# 部署到 Linux 服务器

用 Docker Compose 把整套站点拉起来：**web（Next.js）+ api（Rust）+ PostgreSQL + Redis + MinIO**，
可选 Caddy 提供自动 HTTPS。数据库迁移由 API 启动时自动执行，不需要手动跑。

## 0. 服务器要求

- Linux（Ubuntu/Debian 系最省事），能 SSH
- 内存 ≥ 2G：首次构建 Rust API 较吃内存，2G 机器建议先加 2G swap：
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile \
    && sudo mkswap /swapfile && sudo swapon /swapfile \
    && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
- 磁盘 ≥ 10G（镜像 + 数据卷）
- 需要 Docker Engine + Compose 插件：
  ```bash
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER   # 重新登录后生效
  ```

## 1. 首次部署

```bash
# 1) 拉代码
git clone https://github.com/ruan222123126/Read.git && cd Read

# 2) 生产环境变量：改掉两个密码再继续！
cp .env.production.example .env
vim .env   # 修改 POSTGRES_PASSWORD 和 MINIO_ROOT_PASSWORD

# 3) 构建并启动（首次要编译 Rust，视机器 5-15 分钟）
docker compose -f docker-compose.prod.yml up -d --build

# 4) 验证
docker compose -f docker-compose.prod.yml ps        # 5 个服务都 Up / healthy
curl http://127.0.0.1:3000                          # 前端 HTML
curl http://127.0.0.1:3000/backend/health           # {"status":"ok","database":"up",...}
```

浏览器打开 `http://服务器IP:3000` 即可使用。安全组/防火墙记得放行 3000 端口
（用域名 + HTTPS 时放行 80、443）。

## 2. 域名 + HTTPS（可选）

1. 域名的 **A 记录**解析到服务器 IP；
2. `.env` 里设置 `DOMAIN=read.example.com`；
3. 启动时带上 tls profile（并注释掉 web 的 ports，避免 3000 裸奔）：
   ```bash
   docker compose -f docker-compose.prod.yml --profile tls up -d
   ```
   Caddy 会自动申请并续期 Let's Encrypt 证书，之后用 `https://域名` 访问。

## 3. 日常更新

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

增量构建只重编改动部分（cargo 缓存挂在镜像构建缓存里）。有新依赖或
Dockerfile 变动导致缓存失效时，重新构建会久一些。

> `/backend` 反代目标（`API_INTERNAL_URL`）在**构建期**固定为 compose 网络里的
> `http://api:8080`。自己改拓扑时需要重新构建并传
> `--build-arg API_INTERNAL_URL=...`。

## 4. 数据备份与恢复

所有状态都在 named volumes 里（`pgdata` / `redisdata` / `miniodata`）。

```bash
# 备份数据库（建议加 cron，比如每天凌晨）
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U read read | gzip > backup-$(date +%F).sql.gz

# MinIO（封面等）
docker run --rm -v read_miniodata:/data -v $PWD:/backup alpine \
  tar czf /backup/minio-$(date +%F).tar.gz /data
```

恢复：起一个新库后 `gunzip -c backup.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U read read`。

## 5. 常用排查

```bash
docker compose -f docker-compose.prod.yml logs -f api     # API 日志
docker compose -f docker-compose.prod.yml logs -f web     # 前端日志
docker compose -f docker-compose.prod.yml exec postgres psql -U read read
```

- API 起不来：先看 `logs api`，多半是 `.env` 密码没改导致 pg 健康检查不过
- 页面能开但数据全 503：`curl http://127.0.0.1:3000/backend/health` 看 `database` 字段
- 首次构建 OOM：回到第 0 步把 swap 加上再 `up -d --build`
