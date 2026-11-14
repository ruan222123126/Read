pub mod books;
pub mod explore;
pub mod health;
pub mod sources;

use axum::Router;
use axum::routing::get;

use crate::state::AppState;

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
        .route("/explore/content", get(explore::content));

    Router::new().nest("/api/v1", api).with_state(state)
}
