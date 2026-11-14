use axum::{Json, extract::State};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct HealthResponse {
    status: &'static str,
    version: &'static str,
    database: &'static str,
}

/// GET /api/v1/health —— 存活 + 数据库连通性探测。
pub async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let database = if !state.db_ready {
        "down"
    } else {
        match sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&state.db)
            .await
        {
            Ok(_) => "up",
            Err(err) => {
                tracing::warn!(%err, "数据库健康检查失败");
                "down"
            }
        }
    };

    Json(HealthResponse {
        status: if database == "up" { "ok" } else { "degraded" },
        version: env!("CARGO_PKG_VERSION"),
        database,
    })
}
