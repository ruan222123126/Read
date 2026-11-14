//! 抓取编排层。
//!
//! 与 `read-source-engine` 的分工：
//! - `read-source-engine`：纯解析（HTML + 规则 → 结构化数据），无 IO、无网络
//! - `read-fetcher`：负责把 URL 变成 HTML（UA、超时、重试、编码嗅探、限流），
//!   并把「搜索 / 目录 / 正文」串成完整动作
//!
//! 这样解析器可以被单测完全覆盖，抓取策略可以独立演进（代理池 / 浏览器直连）。

mod client;
mod error;
mod limiter;
pub mod pipeline;

pub use client::{HttpClient, HttpClientConfig};
pub use error::FetchError;
pub use limiter::HostRateLimiter;

/// 抓取后的页面，`text` 已按站点声明的编码解码为 UTF-8。
#[derive(Debug, Clone)]
pub struct Page {
    pub url: String,
    /// 最终 URL（跟随重定向后）
    pub final_url: String,
    pub text: String,
    pub status: u16,
    pub elapsed_ms: u64,
}
