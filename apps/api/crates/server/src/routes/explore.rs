use axum::{
    Json,
    extract::{Query, State},
};
use read_domain::fingerprint::content_hash_hex;
use read_fetcher::{FetchError, pipeline};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::sources_store::{self, LoadedSource};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    /// 指定书源 ID；不传则搜索全部可用书源
    pub source_id: Option<String>,
    #[serde(default = "default_page")]
    pub page: u32,
}

fn default_page() -> u32 {
    1
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub items: Vec<SearchItem>,
    pub searched_sources: usize,
    pub failures: Vec<SourceFailure>,
}

#[derive(Debug, Serialize)]
pub struct SearchItem {
    pub name: String,
    pub author: String,
    pub book_url: String,
    pub cover_url: Option<String>,
    pub intro: Option<String>,
    pub last_chapter: Option<String>,
    pub kind: Option<String>,
    pub source_id: String,
    pub source_name: String,
}

#[derive(Debug, Serialize)]
pub struct SourceFailure {
    pub source_id: String,
    pub source_name: String,
    pub reason: String,
}

/// GET /api/v1/explore/search?q=斗破&source_id=...
///
/// 并发搜索所有（或指定）书源；单源失败不影响整体结果，失败原因一并返回。
pub async fn search(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<SearchResponse>> {
    let keyword = query.q.trim().to_string();
    if keyword.is_empty() {
        return Err(AppError::BadRequest("搜索关键词不能为空".into()));
    }

    let sources = sources_store::load(&state, query.source_id.as_deref()).await?;

    let mut set = tokio::task::JoinSet::new();
    for LoadedSource { id, source } in sources {
        let client = state.http.clone();
        let kw = keyword.clone();
        let page = query.page;
        set.spawn(async move {
            let name = source.book_source_name.clone();
            let result = pipeline::search(&client, &source, &kw, page).await;
            (id, name, result)
        });
    }

    let mut items = Vec::new();
    let mut failures = Vec::new();
    let mut searched_sources = 0;

    while let Some(joined) = set.join_next().await {
        let Ok((id, name, result)) = joined else {
            continue;
        };
        match result {
            Ok(books) => {
                searched_sources += 1;
                items.extend(books.into_iter().map(|b| SearchItem {
                    name: b.name,
                    author: b.author,
                    book_url: b.book_url,
                    cover_url: b.cover_url,
                    intro: b.intro,
                    last_chapter: b.last_chapter,
                    kind: b.kind,
                    source_id: id.clone(),
                    source_name: name.clone(),
                }));
            }
            Err(err) => failures.push(SourceFailure {
                source_id: id,
                source_name: name,
                reason: err.to_string(),
            }),
        }
    }

    // 书名 + 作者排序，让同一本书的不同源相邻，便于前端聚合展示
    items.sort_by(|a, b| (&a.name, &a.author).cmp(&(&b.name, &b.author)));

    Ok(Json(SearchResponse {
        items,
        searched_sources,
        failures,
    }))
}

#[derive(Debug, Deserialize)]
pub struct TocQuery {
    pub source_id: String,
    pub book_url: String,
}

#[derive(Debug, Serialize)]
pub struct TocResponse {
    pub chapters: Vec<ChapterItem>,
}

#[derive(Debug, Serialize)]
pub struct ChapterItem {
    pub title: String,
    pub url: String,
}

/// GET /api/v1/explore/toc?source_id=&book_url=
pub async fn toc(
    State(state): State<AppState>,
    Query(query): Query<TocQuery>,
) -> AppResult<Json<TocResponse>> {
    let source = pick_one(&state, &query.source_id).await?;

    let chapters = pipeline::toc(&state.http, &source, &query.book_url).await?;
    Ok(Json(TocResponse {
        chapters: chapters
            .into_iter()
            .map(|c| ChapterItem {
                title: c.title,
                url: c.url,
            })
            .collect(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ContentQuery {
    pub source_id: String,
    pub chapter_url: String,
}

#[derive(Debug, Serialize)]
pub struct ContentResponse {
    pub paragraphs: Vec<String>,
    /// 每段的 SimHash 指纹（16 位 hex），段评锚定用
    pub hashes: Vec<String>,
}

/// GET /api/v1/explore/content?source_id=&chapter_url=
pub async fn content(
    State(state): State<AppState>,
    Query(query): Query<ContentQuery>,
) -> AppResult<Json<ContentResponse>> {
    let source = pick_one(&state, &query.source_id).await?;

    let paragraphs = pipeline::content(&state.http, &source, &query.chapter_url).await?;
    let hashes = paragraphs.iter().map(|p| content_hash_hex(p)).collect();

    Ok(Json(ContentResponse { paragraphs, hashes }))
}

async fn pick_one(
    state: &AppState,
    source_id: &str,
) -> AppResult<read_source_engine::legado::BookSource> {
    let list = sources_store::load(state, Some(source_id)).await?;
    list.into_iter()
        .next()
        .map(|s| s.source)
        .ok_or_else(|| AppError::BadRequest("书源不存在或已停用".into()))
}

impl From<FetchError> for AppError {
    fn from(err: FetchError) -> Self {
        match err {
            FetchError::BadUrl(u) => AppError::BadRequest(format!("URL 非法: {u}")),
            FetchError::RateLimited => AppError::TooManyRequests,
            FetchError::HttpStatus { status } => AppError::Upstream(format!("源站返回 {status}")),
            other => AppError::Upstream(other.to_string()),
        }
    }
}
