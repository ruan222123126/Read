use axum::{
    Json,
    extract::{Path, Query, State},
};
use read_domain::{CanonicalBook, canonical_key};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult, ensure_db};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    /// 模糊搜索书名/作者
    pub q: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct BookRow {
    pub id: Uuid,
    pub title: String,
    pub author: String,
    pub cover_url: Option<String>,
    pub description: Option<String>,
    pub source_count: i32,
    pub rating: Option<f32>,
    pub review_count: i32,
}

/// GET /api/v1/books?q=&limit=&offset=
pub async fn list_books(
    State(state): State<AppState>,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<Vec<BookRow>>> {
    ensure_db(&state)?;
    let limit = query.limit.clamp(1, 100);
    let pattern = query.q.map(|q| format!("%{}%", q.trim()));

    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            Option<String>,
            Option<String>,
            i32,
            Option<f32>,
            i32,
        ),
    >(
        r#"
        SELECT id, title, author, cover_url, description, source_count, rating, review_count
        FROM canonical_books
        WHERE ($1::text IS NULL OR title ILIKE $1 OR author ILIKE $1)
        ORDER BY updated_at DESC
        LIMIT $2 OFFSET $3
        "#,
    )
    .bind(pattern)
    .bind(limit)
    .bind(query.offset.max(0))
    .fetch_all(&state.db)
    .await?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(
                    id,
                    title,
                    author,
                    cover_url,
                    description,
                    source_count,
                    rating,
                    review_count,
                )| {
                    BookRow {
                        id,
                        title,
                        author,
                        cover_url,
                        description,
                        source_count,
                        rating,
                        review_count,
                    }
                },
            )
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CreateBookRequest {
    pub title: String,
    pub author: String,
    pub description: Option<String>,
    pub cover_url: Option<String>,
}

/// POST /api/v1/books —— 幂等 upsert，同一「归一化书名 + 作者」只会有一条记录。
pub async fn create_book(
    State(state): State<AppState>,
    Json(req): Json<CreateBookRequest>,
) -> AppResult<Json<BookRow>> {
    ensure_db(&state)?;
    let title = req.title.trim();
    let author = req.author.trim();
    if title.is_empty() || author.is_empty() {
        return Err(AppError::BadRequest("书名和作者不能为空".into()));
    }

    let book = CanonicalBook::new(title, author);
    let key = canonical_key(title, author);

    let row = sqlx::query_as::<_, (Uuid, String, String, Option<String>, Option<String>, i32, Option<f32>, i32)>(
        r#"
        INSERT INTO canonical_books (id, title, author, title_norm, author_norm, canonical_key, description, cover_url)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (canonical_key) DO UPDATE
          SET description = COALESCE(EXCLUDED.description, canonical_books.description),
              cover_url   = COALESCE(EXCLUDED.cover_url, canonical_books.cover_url),
              updated_at  = now()
        RETURNING id, title, author, cover_url, description, source_count, rating, review_count
        "#,
    )
    .bind(book.id)
    .bind(&book.title)
    .bind(&book.author)
    .bind(&book.title_norm)
    .bind(&book.author_norm)
    .bind(&key)
    .bind(&req.description)
    .bind(&req.cover_url)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(BookRow {
        id: row.0,
        title: row.1,
        author: row.2,
        cover_url: row.3,
        description: row.4,
        source_count: row.5,
        rating: row.6,
        review_count: row.7,
    }))
}

/// GET /api/v1/books/:id
pub async fn get_book(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<BookRow>> {
    ensure_db(&state)?;
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            Option<String>,
            Option<String>,
            i32,
            Option<f32>,
            i32,
        ),
    >(
        r#"
        SELECT id, title, author, cover_url, description, source_count, rating, review_count
        FROM canonical_books WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;

    Ok(Json(BookRow {
        id: row.0,
        title: row.1,
        author: row.2,
        cover_url: row.3,
        description: row.4,
        source_count: row.5,
        rating: row.6,
        review_count: row.7,
    }))
}
