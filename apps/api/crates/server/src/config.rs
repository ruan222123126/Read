use std::env;

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: Option<String>,
    pub max_connections: u32,
    /// 单次抓取超时（秒）
    pub fetch_timeout_secs: u64,
    /// 同一 host 的最小请求间隔（毫秒）
    pub min_host_interval_ms: u64,
    /// 本地书源目录
    pub sources_dir: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://read:read_dev_password@localhost:5432/read".to_string()
        });

        Ok(Self {
            host: env::var("APP__HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("APP__PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8080),
            database_url,
            redis_url: env::var("REDIS_URL").ok(),
            max_connections: env::var("DB_MAX_CONNECTIONS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(10),
            fetch_timeout_secs: env::var("FETCH_TIMEOUT_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(15),
            min_host_interval_ms: env::var("FETCH_MIN_HOST_INTERVAL_MS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(800),
            sources_dir: env::var("SOURCES_DIR").unwrap_or_else(|_| "sources".to_string()),
        })
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// 日志里隐藏密码。
    pub fn safe_database_url(&self) -> String {
        match self.database_url.rsplit_once('@') {
            Some((_, host)) => format!("postgres://***@{host}"),
            None => "<invalid>".to_string(),
        }
    }
}

impl std::fmt::Display for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "bind={} db={} redis={} fetch_timeout={}s host_interval={}ms",
            self.bind_addr(),
            self.safe_database_url(),
            if self.redis_url.is_some() {
                "on"
            } else {
                "off"
            },
            self.fetch_timeout_secs,
            self.min_host_interval_ms
        )
    }
}
