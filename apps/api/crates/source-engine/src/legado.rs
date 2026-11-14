//! Legado 书源 JSON 结构。
//!
//! 只覆盖阅读主链路必需字段；`#[serde(default)]` 全开，保证导入社区书源时
//! 不会因为多出未知字段而失败。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookSource {
    /// 源站主页
    pub book_source_url: String,
    pub book_source_name: String,
    pub book_source_group: Option<String>,
    pub book_source_type: i32,
    pub enabled: bool,

    /// 搜索：URL 模板，`{{key}}` / `{{page}}` 由调用方替换
    pub search_url: String,
    /// 搜索结果列表规则
    pub rule_search: SearchRule,
    /// 详情页规则
    pub rule_book_info: BookInfoRule,
    /// 目录页规则
    pub rule_toc: TocRule,
    /// 正文页规则
    pub rule_content: ContentRule,

    pub header: Option<String>,
    pub login_url: Option<String>,
    pub last_update_time: Option<i64>,
    pub weight: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchRule {
    /// 结果条目列表
    pub book_list: String,
    pub name: String,
    pub author: String,
    pub kind: Option<String>,
    pub word_count: Option<String>,
    pub last_chapter: Option<String>,
    pub intro: Option<String>,
    pub cover_url: Option<String>,
    pub book_url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookInfoRule {
    pub name: String,
    pub author: String,
    pub intro: Option<String>,
    pub kind: Option<String>,
    pub last_chapter: Option<String>,
    pub cover_url: Option<String>,
    pub toc_url: Option<String>,
    pub word_count: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TocRule {
    pub chapter_list: String,
    pub chapter_name: String,
    pub chapter_url: String,
    /// 目录分页：下一页规则（可空）
    pub next_toc_url: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContentRule {
    pub content: String,
    /// 分页正文的下一页规则
    pub next_content_url: Option<String>,
    pub title: Option<String>,
}

/// 搜索结果条目（归一化前的原始抽取结果）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchBook {
    pub name: String,
    pub author: String,
    pub book_url: String,
    pub cover_url: Option<String>,
    pub intro: Option<String>,
    pub last_chapter: Option<String>,
    pub word_count: Option<String>,
    pub kind: Option<String>,
    /// 命中的书源名，便于前端展示「来自 xx 源」
    pub source_name: String,
}

/// 一条目录条目。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TocEntry {
    pub title: String,
    pub url: String,
}

impl BookSource {
    /// 从 JSON 文本解析。容忍顶层是数组或单个对象两种写法。
    pub fn parse_many(json: &str) -> Result<Vec<BookSource>, serde_json::Error> {
        let value: serde_json::Value = serde_json::from_str(json)?;
        match value {
            serde_json::Value::Array(_) => serde_json::from_value(value),
            obj @ serde_json::Value::Object(_) => Ok(vec![serde_json::from_value(obj)?]),
            _ => Ok(Vec::new()),
        }
    }
}
