use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 书源健康度，用于「一键换源」时排序：可用性高、延迟低的排前面。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Healthy,
    Degraded,
    Broken,
    Unknown,
}

impl Availability {
    pub fn as_str(self) -> &'static str {
        match self {
            Availability::Healthy => "healthy",
            Availability::Degraded => "degraded",
            Availability::Broken => "broken",
            Availability::Unknown => "unknown",
        }
    }
}

/// BookSourceMapping：某本 CanonicalBook 在某书源下的具体坐标。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSourceMapping {
    pub id: Uuid,
    pub book_id: Uuid,
    pub source_id: Uuid,
    /// 该书在源站的书页 URL
    pub book_url: String,
    /// 目录页 URL（部分站点与书页不同）
    pub toc_url: Option<String>,
    pub latest_chapter: Option<String>,
    pub chapter_count: Option<i32>,
    /// 最近一次抓取的平均响应耗时（毫秒）
    pub latency_ms: Option<i32>,
    pub availability: Availability,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}
