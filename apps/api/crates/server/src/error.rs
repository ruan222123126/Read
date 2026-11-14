use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("资源不存在")]
    NotFound,

    #[error("请求参数不合法: {0}")]
    BadRequest(String),

    #[error("数据库未就绪，请先启动 PostgreSQL（docker compose up -d postgres）")]
    DatabaseUnavailable,

    #[error("请求过于频繁，请稍后重试")]
    TooManyRequests,

    #[error("书源抓取失败: {0}")]
    Upstream(String),

    #[error("数据库错误")]
    Database(#[from] sqlx::Error),

    #[error("内部错误: {0}")]
    Internal(#[from] anyhow::Error),
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            AppError::NotFound => "not_found",
            AppError::BadRequest(_) => "bad_request",
            AppError::DatabaseUnavailable => "database_unavailable",
            AppError::TooManyRequests => "too_many_requests",
            AppError::Upstream(_) => "upstream_error",
            AppError::Database(_) => "database_error",
            AppError::Internal(_) => "internal_error",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match &self {
            AppError::NotFound => StatusCode::NOT_FOUND,
            AppError::BadRequest(_) => StatusCode::BAD_REQUEST,
            AppError::DatabaseUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            AppError::TooManyRequests => StatusCode::TOO_MANY_REQUESTS,
            AppError::Upstream(_) => StatusCode::BAD_GATEWAY,
            AppError::Database(_) | AppError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status.is_server_error() {
            tracing::error!(error = %self, "请求处理失败");
        }

        let body = ErrorBody {
            code: self.code(),
            message: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

/// 数据接口的统一前置检查：数据库未就绪时直接返回 503，
/// 避免每个查询都等一次 5 秒超时。
pub fn ensure_db(state: &crate::state::AppState) -> AppResult<()> {
    if state.db_ready {
        Ok(())
    } else {
        Err(AppError::DatabaseUnavailable)
    }
}
