use axum::{
    Json,
    extract::{Path, Query, State},
};
use read_domain::fingerprint::content_hash_hex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ensure_db};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct UploadChapter {
    pub title: String,
    /// 段落数组；图片段为 data:image/… 开头的 data URI
    pub paragraphs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UploadLocalBookRequest {
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// 封面 data URI（前端已缩放，最大 ~100KB）
    pub cover_data: Option<String>,
    /// 来源格式：epub | mobi | txt
    pub format: String,
    /// 全文规范化后的 SHA-256，去重用
    pub text_hash: String,
    pub chapters: Vec<UploadChapter>,
}

#[derive(Debug, Serialize)]
pub struct LocalBookRow {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub format: String,
    pub chapter_count: i32,
    /// text_hash 已存在时为 true：没有重复入库，直接返回库里那条
    pub duplicate: bool,
}

/// POST /api/v1/local-books
///
/// 上传解析好的整本书（浏览器端解析 epub/mobi/txt 后一次性提交）。
/// 同一 text_hash 幂等返回已有记录（duplicate: true），不重复入库。
///
/// 注意：全书 JSON 可达几十 MB，注册路由时单独放宽了 body 上限。
pub async fn upload_local_book(
    State(state): State<AppState>,
    Json(req): Json<UploadLocalBookRequest>,
) -> AppResult<Json<LocalBookRow>> {
    ensure_db(&state)?;

    let title = req.title.trim().to_string();
    let author = match req.author.as_deref().map(str::trim) {
        Some(a) if !a.is_empty() => a.to_string(),
        _ => "佚名".to_string(),
    };
    if title.is_empty() {
        return Err(AppError::BadRequest("书名不能为空".into()));
    }
    if req.text_hash.trim().is_empty() {
        return Err(AppError::BadRequest("缺少全文指纹 text_hash".into()));
    }
    if req.chapters.is_empty() {
        return Err(AppError::BadRequest("这本书没有可入库的章节".into()));
    }
    if req.chapters.len() > 20_000 {
        return Err(AppError::BadRequest("章节数量超出上限（20000）".into()));
    }

    if let Some(existing) = find_by_hash(&state, req.text_hash.trim()).await? {
        return Ok(Json(LocalBookRow {
            duplicate: true,
            ..existing
        }));
    }

    let id = Uuid::new_v4();
    let chapter_count = req.chapters.len() as i32;

    let mut tx = state.db.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO local_books (id, title, author, description, cover_url, format, chapter_count, text_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(id)
    .bind(&title)
    .bind(&author)
    .bind(req.description.as_deref().filter(|d| !d.trim().is_empty()))
    .bind(req.cover_data.as_deref().filter(|c| !c.is_empty()))
    .bind(&req.format)
    .bind(chapter_count)
    .bind(req.text_hash.trim())
    .execute(&mut *tx)
    .await?;

    // 章节一次性 UNNEST 批量插入，1400+ 章也只有一条语句
    let idxs: Vec<i32> = (0..chapter_count).collect();
    let titles: Vec<String> = req
        .chapters
        .iter()
        .map(|c| {
            let t = c.title.trim();
            if t.is_empty() {
                "（无标题）".to_string()
            } else {
                t.to_string()
            }
        })
        .collect();
    let paragraphs: Vec<String> = req
        .chapters
        .iter()
        .map(|c| serde_json::to_string(&c.paragraphs).unwrap_or_else(|_| "[]".to_string()))
        .collect();

    sqlx::query(
        r#"
        INSERT INTO local_chapters (book_id, idx, title, paragraphs)
        SELECT $1, i, t, p::jsonb
        FROM unnest($2::int[], $3::text[], $4::text[]) AS u(i, t, p)
        "#,
    )
    .bind(id)
    .bind(&idxs)
    .bind(&titles)
    .bind(&paragraphs)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Json(LocalBookRow {
        id,
        title,
        author,
        description: req.description.filter(|d| !d.trim().is_empty()),
        cover_url: req.cover_data.filter(|c| !c.is_empty()),
        format: req.format.clone(),
        chapter_count,
        duplicate: false,
    }))
}

async fn find_by_hash(state: &AppState, hash: &str) -> AppResult<Option<LocalBookRow>> {
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            i32,
        ),
    >(
        r#"
        SELECT id, title, author, description, cover_url, format, chapter_count
        FROM local_books WHERE text_hash = $1
        "#,
    )
    .bind(hash)
    .fetch_optional(&state.db)
    .await?;

    Ok(row.map(
        |(id, title, author, description, cover_url, format, chapter_count)| LocalBookRow {
            id,
            title,
            author,
            description,
            cover_url,
            format,
            chapter_count,
            duplicate: false,
        },
    ))
}

#[derive(Debug, Serialize)]
pub struct LocalBookListItem {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub format: String,
    pub chapter_count: i32,
}

/// GET /api/v1/local-books —— 书库列表（上传的书）
pub async fn list_local_books(
    State(state): State<AppState>,
) -> AppResult<Json<Vec<LocalBookListItem>>> {
    ensure_db(&state)?;

    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            i32,
        ),
    >(
        r#"
        SELECT id, title, author, description, cover_url, format, chapter_count
        FROM local_books
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, title, author, description, cover_url, format, chapter_count)| {
                    LocalBookListItem {
                        id,
                        title,
                        author,
                        description,
                        cover_url,
                        format,
                        chapter_count,
                    }
                },
            )
            .collect(),
    ))
}

#[derive(Debug, Serialize)]
pub struct LocalTocResponse {
    pub chapters: Vec<LocalTocItem>,
}

#[derive(Debug, Serialize)]
pub struct LocalTocItem {
    pub title: String,
    /// 合成地址 local://<idx>，与书源章节 URL 同构
    pub url: String,
}

/// GET /api/v1/local-books/{id}/toc —— 上传书的目录
pub async fn local_toc(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<LocalTocResponse>> {
    ensure_db(&state)?;

    let rows = sqlx::query_as::<_, (i32, String)>(
        r#"
        SELECT idx, title FROM local_chapters
        WHERE book_id = $1
        ORDER BY idx
        "#,
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        return Err(AppError::NotFound);
    }

    Ok(Json(LocalTocResponse {
        chapters: rows
            .into_iter()
            .map(|(idx, title)| LocalTocItem {
                title,
                url: format!("local://{idx}"),
            })
            .collect(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct LocalContentQuery {
    /// 形如 local://42
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct LocalContentResponse {
    pub paragraphs: Vec<String>,
    /// 每段的 SimHash 指纹（16 位 hex），与 explore/content 同构
    pub hashes: Vec<String>,
}

/// GET /api/v1/local-books/{id}/content?url=local://42
pub async fn local_content(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(query): Query<LocalContentQuery>,
) -> AppResult<Json<LocalContentResponse>> {
    ensure_db(&state)?;

    let idx = query
        .url
        .strip_prefix("local://")
        .and_then(|s| s.parse::<i32>().ok())
        .ok_or_else(|| AppError::BadRequest("章节地址不合法，应为 local://<序号>".into()))?;

    let row = sqlx::query_as::<_, (String,)>(
        r#"
        SELECT paragraphs FROM local_chapters
        WHERE book_id = $1 AND idx = $2
        "#,
    )
    .bind(id)
    .bind(idx)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    let paragraphs: Vec<String> = serde_json::from_str(&row.0).unwrap_or_default();
    let hashes = paragraphs.iter().map(|p| content_hash_hex(p)).collect();

    Ok(Json(LocalContentResponse { paragraphs, hashes }))
}
