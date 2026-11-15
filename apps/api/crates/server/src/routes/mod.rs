pub mod books;
pub mod explore;
pub mod health;
pub mod local_books;
pub mod sources;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};

use crate::state::AppState;

/// 上传整本书的 JSON 上限（80MB，全书正文 + 内嵌图片 data URI）
const UPLOAD_BODY_LIMIT: usize = 80_000_000;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health::health))
        .route("/books", get(books::list_books).post(books::create_book))
        .route("/books/{id}", get(books::get_book))
        .route(
            "/sources",
            get(sources::list_sources).post(sources::import_sources),
        )
        .route("/sources/{id}", get(sources::get_source))
        // 书源探索：搜索 / 目录 / 正文
        .route("/explore/search", get(explore::search))
        .route("/explore/toc", get(explore::toc))
        .route("/explore/content", get(explore::content))
        // 上传书库：浏览器解析好的整本书一次入库
        .route(
            "/local-books",
            post(local_books::upload_local_book)
                .get(local_books::list_local_books)
                .layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)),
        )
        .route("/local-books/{id}/toc", get(local_books::local_toc))
        .route("/local-books/{id}/content", get(local_books::local_content));

    Router::new().nest("/api/v1", api).with_state(state)
}
