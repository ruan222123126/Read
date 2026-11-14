use std::time::Duration;

use anyhow::Context;
use read_fetcher::{HttpClient, HttpClientConfig};

use crate::config::Config;

/// 运行期共享资源。
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    /// 启动时数据库是否可用。false 时服务降级启动。
    pub db_ready: bool,
    /// 抓取客户端（限流 + 编码嗅探），所有书源共用
    pub http: HttpClient,
    /// 本地书源目录（数据库不可用时的回落）
    pub sources_dir: String,
}

impl AppState {
    pub async fn connect(config: &Config) -> anyhow::Result<Self> {
        let http = HttpClient::new(HttpClientConfig {
            timeout: Duration::from_secs(config.fetch_timeout_secs),
            min_host_interval: Duration::from_millis(config.min_host_interval_ms),
            ..Default::default()
        })?;

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.max_connections)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&config.database_url)
            .await;

        match pool {
            Ok(db) => {
                sqlx::migrate!("../../migrations")
                    .run(&db)
                    .await
                    .context("执行数据库迁移失败")?;
                tracing::info!("数据库已连接，迁移已就绪");
                Ok(Self {
                    db,
                    db_ready: true,
                    http,
                    sources_dir: config.sources_dir.clone(),
                })
            }
            Err(err) => {
                tracing::warn!(
                    "无法连接 PostgreSQL（{}）: {err}\n\
                     服务将以降级模式启动：/health 报告 database=down，\
                     需要数据库的接口返回 503；搜索/解析类接口仍可使用。\n\
                     启动数据库后重启即可：docker compose up -d postgres",
                    config.safe_database_url()
                );
                let db = sqlx::postgres::PgPoolOptions::new()
                    .max_connections(config.max_connections)
                    .acquire_timeout(Duration::from_secs(5))
                    .connect_lazy(&config.database_url)?;
                Ok(Self {
                    db,
                    db_ready: false,
                    http,
                    sources_dir: config.sources_dir.clone(),
                })
            }
        }
    }
}
