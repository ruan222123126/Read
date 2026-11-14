//! 书源装载：优先数据库，数据库不可用时回落到本地目录。
//!
//! 回落到文件是为了「没有 PostgreSQL 也能把整条链路跑通」：
//! 把 Legado 书源 JSON 丢进 `apps/api/sources/` 即可搜索、抓目录、抓正文。
//! 这既方便本地开发，也符合 Local-First 的思路——书源本来就是用户资产。

use std::path::Path;

use read_source_engine::legado::BookSource;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// 一条可用的书源：ID + 解析后的规则。
#[derive(Debug, Clone)]
pub struct LoadedSource {
    pub id: String,
    pub source: BookSource,
}

/// 读取书源。
///
/// - `source_id` 为 `None`：返回全部启用书源
/// - 数据库可用时走 `book_sources` 表
/// - 数据库不可用时读 `sources_dir` 下的 `*.json`
pub async fn load(state: &AppState, source_id: Option<&str>) -> AppResult<Vec<LoadedSource>> {
    if state.db_ready {
        match load_from_db(state, source_id).await {
            Ok(list) if !list.is_empty() => return Ok(list),
            Ok(_) => tracing::debug!("数据库中暂无书源，尝试本地目录"),
            Err(err) => tracing::warn!(%err, "读取数据库书源失败，尝试本地目录"),
        }
    }

    load_from_dir(state, source_id)
}

async fn load_from_db(state: &AppState, source_id: Option<&str>) -> AppResult<Vec<LoadedSource>> {
    let rows = if let Some(id) = source_id {
        let uuid: uuid::Uuid = id
            .parse()
            .map_err(|_| AppError::BadRequest("source_id 不是合法 UUID".into()))?;
        sqlx::query_as::<_, (uuid::Uuid, serde_json::Value)>(
            "SELECT id, raw FROM book_sources WHERE id = $1 AND enabled = true",
        )
        .bind(uuid)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, (uuid::Uuid, serde_json::Value)>(
            "SELECT id, raw FROM book_sources WHERE enabled = true ORDER BY weight DESC",
        )
        .fetch_all(&state.db)
        .await?
    };

    Ok(rows
        .into_iter()
        .filter_map(|(id, raw)| {
            serde_json::from_value::<BookSource>(raw)
                .ok()
                .map(|source| LoadedSource {
                    id: id.to_string(),
                    source,
                })
        })
        .collect())
}

fn load_from_dir(state: &AppState, source_id: Option<&str>) -> AppResult<Vec<LoadedSource>> {
    let dir = Path::new(&state.sources_dir);
    if !dir.is_dir() {
        return Err(AppError::BadRequest(format!(
            "没有可用的书源：数据库未就绪，且本地书源目录不存在（{}）",
            dir.display()
        )));
    }

    let mut out = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("读取书源目录失败: {e}")))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(sources) = BookSource::parse_many(&text) else {
            tracing::warn!(path = %path.display(), "书源 JSON 解析失败，已跳过");
            continue;
        };

        for source in sources {
            // 文件书源用 `file:<文件名>#<源名>` 作为稳定 ID
            let id = format!(
                "file:{}#{}",
                path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown"),
                source.book_source_name
            );
            if let Some(want) = source_id
                && want != id
            {
                continue;
            }
            out.push(LoadedSource { id, source });
        }
    }

    if out.is_empty() {
        return Err(AppError::BadRequest(format!(
            "本地书源目录 {} 中没有匹配的书源",
            dir.display()
        )));
    }
    Ok(out)
}
