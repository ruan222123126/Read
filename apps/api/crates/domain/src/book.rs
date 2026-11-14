use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::normalize_text;

/// 标准书籍实体（CanonicalBook）。
///
/// 同一本书在不同书源下可能有多个 URL，但只有一条 CanonicalBook 记录，
/// 书评、评分、阅读进度全部锚定在它上面，换源不丢上下文。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalBook {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    /// 归一化书名（入库时由 `canonical_key` 计算，用于唯一索引）
    pub title_norm: String,
    /// 归一化作者
    pub author_norm: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    /// 书源数量（聚合后）
    pub source_count: i32,
    /// 聚合评分 0..=10
    pub rating: Option<f32>,
    pub review_count: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl CanonicalBook {
    /// 用原始书名/作者构造一个未落库的实体（id 与时间戳由调用方补全）。
    pub fn new(title: impl Into<String>, author: impl Into<String>) -> Self {
        let title = title.into();
        let author = author.into();
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            title_norm: normalize_text(&title),
            author_norm: normalize_text(&author),
            title,
            author,
            description: None,
            cover_url: None,
            source_count: 0,
            rating: None,
            review_count: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

/// 归一化书名 + 归一化作者的联合键，对应数据库唯一索引。
pub fn canonical_key(title: &str, author: &str) -> String {
    format!("{}|{}", normalize_text(title), normalize_text(author))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn different_sources_same_key() {
        assert_eq!(
            canonical_key("斗破苍穹", "天蚕土豆"),
            canonical_key("《斗破 苍穹》", "天蚕土豆·")
        );
    }

    #[test]
    fn new_fills_norms() {
        let b = CanonicalBook::new(" 全职高手 ", "蝴蝶蓝");
        assert_eq!(b.title_norm, "全职高手");
        assert_eq!(b.author_norm, "蝴蝶蓝");
    }
}
