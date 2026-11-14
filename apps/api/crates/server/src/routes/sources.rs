use axum::{
    Json,
    extract::{Path, State},
};
use read_source_engine::legado::BookSource;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::sources_store;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct SourceRow {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub url: String,
    pub enabled: bool,
    pub weight: i32,
    /// `db`（已入库）或 `file`（本地目录回落）
    pub origin: &'static str,
}

/// GET /api/v1/sources
///
/// 数据库可用时返回库中书源；否则回落到 `SOURCES_DIR` 下的 JSON 文件，
/// 保证没有 PostgreSQL 时前端也能看到书源列表。
pub async fn list_sources(State(state): State<AppState>) -> AppResult<Json<Vec<SourceRow>>> {
    if state.db_ready {
        let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, String, bool, i32)>(
            r#"
            SELECT id, name, source_group, url, enabled, weight
            FROM book_sources
            ORDER BY weight DESC, name ASC
            "#,
        )
        .fetch_all(&state.db)
        .await?;

        if !rows.is_empty() {
            return Ok(Json(
                rows.into_iter()
                    .map(|(id, name, group, url, enabled, weight)| SourceRow {
                        id: id.to_string(),
                        name,
                        group,
                        url,
                        enabled,
                        weight,
                        origin: "db",
                    })
                    .collect(),
            ));
        }
    }

    // 回落到本地目录
    let loaded = sources_store::load(&state, None).await.unwrap_or_default();
    Ok(Json(
        loaded
            .into_iter()
            .map(|s| SourceRow {
                id: s.id,
                name: s.source.book_source_name.clone(),
                group: s.source.book_source_group.clone(),
                url: s.source.book_source_url.clone(),
                enabled: s.source.enabled,
                weight: s.source.weight,
                origin: "file",
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    /// Legado 书源 JSON 原文：数组或单个对象均可
    pub json: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub imported: usize,
    pub skipped: usize,
    pub source_ids: Vec<Uuid>,
}

/// POST /api/v1/sources/import —— 导入 Legado 书源 JSON。
///
/// 以 `(url, name)` 为幂等键，重复导入只更新规则，不产生重复源。
pub async fn import_sources(
    State(state): State<AppState>,
    Json(req): Json<ImportRequest>,
) -> AppResult<Json<ImportResponse>> {
    let sources = BookSource::parse_many(&req.json)
        .map_err(|e| AppError::BadRequest(format!("书源 JSON 解析失败: {e}")))?;

    if sources.is_empty() {
        return Err(AppError::BadRequest("没有解析到任何书源".into()));
    }

    // 先校验 JSON 合法，再检查数据库，给出更有用的错误
    if !state.db_ready {
        return Err(AppError::DatabaseUnavailable);
    }

    let mut ids = Vec::new();
    let mut skipped = 0;

    for src in sources {
        if src.book_source_name.trim().is_empty() || src.book_source_url.trim().is_empty() {
            skipped += 1;
            continue;
        }
        let raw = serde_json::to_value(&src).unwrap_or_default();

        let row = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO book_sources (id, name, source_group, url, enabled, weight, raw)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (url, name) DO UPDATE
              SET raw = EXCLUDED.raw,
                  weight = EXCLUDED.weight,
                  enabled = EXCLUDED.enabled,
                  updated_at = now()
            RETURNING id
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(&src.book_source_name)
        .bind(&src.book_source_group)
        .bind(&src.book_source_url)
        .bind(src.enabled)
        .bind(src.weight)
        .bind(raw)
        .fetch_one(&state.db)
        .await?;

        ids.push(row);
    }

    Ok(Json(ImportResponse {
        imported: ids.len(),
        skipped,
        source_ids: ids,
    }))
}

/// GET /api/v1/sources/:id —— 返回原始书源 JSON，供前端本地解析器复用。
pub async fn get_source(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    // 本地文件书源：`file:<文件名>#<源名>`
    if let Some(rest) = id.strip_prefix("file:") {
        let name = rest.split('#').nth(1).unwrap_or_default();
        let loaded = sources_store::load(&state, Some(&id)).await?;
        let found = loaded
            .into_iter()
            .find(|s| s.source.book_source_name == name)
            .ok_or(AppError::NotFound)?;
        return Ok(Json(
            serde_json::to_value(&found.source).unwrap_or(serde_json::Value::Null),
        ));
    }

    if !state.db_ready {
        return Err(AppError::DatabaseUnavailable);
    }

    let uuid: Uuid = id
        .parse()
        .map_err(|_| AppError::BadRequest("id 不是合法 UUID".into()))?;

    let raw =
        sqlx::query_scalar::<_, serde_json::Value>("SELECT raw FROM book_sources WHERE id = $1")
            .bind(uuid)
            .fetch_optional(&state.db)
            .await?
            .ok_or(AppError::NotFound)?;

    Ok(Json(raw))
}
