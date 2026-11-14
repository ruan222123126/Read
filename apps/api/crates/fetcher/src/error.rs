use thiserror::Error;

#[derive(Debug, Error)]
pub enum FetchError {
    #[error("URL 非法: {0}")]
    BadUrl(String),

    #[error("请求失败: {0}")]
    Request(#[from] reqwest::Error),

    #[error("目标站点返回 {status}")]
    HttpStatus { status: u16 },

    #[error("响应体过大（>{limit} 字节），已拒绝")]
    BodyTooLarge { limit: usize },

    #[error("该站点请求过于频繁，请稍后重试")]
    RateLimited,
}
