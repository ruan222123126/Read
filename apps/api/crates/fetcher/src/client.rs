use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};

use crate::Page;
use crate::error::FetchError;
use crate::limiter::{HostRateLimiter, host_of};

#[derive(Debug, Clone)]
pub struct HttpClientConfig {
    /// 单次请求超时
    pub timeout: Duration,
    /// 同一 host 的最小请求间隔
    pub min_host_interval: Duration,
    /// 响应体上限，防止被超大页面打爆内存
    pub max_body_bytes: usize,
    /// 默认 UA（很多源站会拦截空 UA 与非浏览器 UA）
    pub user_agent: String,
    /// 失败重试次数（不含首次）
    pub retries: u32,
}

impl Default for HttpClientConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(15),
            min_host_interval: Duration::from_millis(800),
            max_body_bytes: 8 * 1024 * 1024,
            user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                .to_string(),
            retries: 1,
        }
    }
}

/// 包装 reqwest 的抓取客户端：限流 + 编码嗅探 + 体积保护。
#[derive(Clone)]
pub struct HttpClient {
    inner: reqwest::Client,
    limiter: HostRateLimiter,
    config: HttpClientConfig,
}

impl HttpClient {
    pub fn new(config: HttpClientConfig) -> anyhow::Result<Self> {
        let inner = reqwest::Client::builder()
            .timeout(config.timeout)
            .connect_timeout(Duration::from_secs(8))
            .user_agent(config.user_agent.clone())
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()?;

        Ok(Self {
            inner,
            limiter: HostRateLimiter::new(config.min_host_interval),
            config,
        })
    }

    /// 抓取一个页面并解码为 UTF-8 文本。
    pub async fn fetch(&self, url: &str, referer: Option<&str>) -> Result<Page, FetchError> {
        if !url.starts_with("http://") && !url.starts_with("https://") {
            return Err(FetchError::BadUrl(url.to_string()));
        }

        let host = host_of(url);
        self.limiter.acquire(&host).await;

        let started = Instant::now();
        let mut last_err: Option<FetchError> = None;

        for attempt in 0..=self.config.retries {
            match self.try_once(url, referer).await {
                Ok((final_url, status, bytes, content_type)) => {
                    let text = read_source_engine::decode_body(&bytes, content_type.as_deref());
                    return Ok(Page {
                        url: url.to_string(),
                        final_url,
                        text,
                        status,
                        elapsed_ms: started.elapsed().as_millis() as u64,
                    });
                }
                Err(err) => {
                    tracing::debug!(url, attempt, %err, "抓取失败");
                    let retryable = matches!(err, FetchError::Request(_));
                    last_err = Some(err);
                    if !retryable {
                        break;
                    }
                    // 简单退避，避免立刻重试再次触发限流
                    tokio::time::sleep(Duration::from_millis(300 * (attempt as u64 + 1))).await;
                }
            }
        }

        Err(last_err.unwrap_or(FetchError::BadUrl(url.to_string())))
    }

    async fn try_once(
        &self,
        url: &str,
        referer: Option<&str>,
    ) -> Result<(String, u16, Vec<u8>, Option<String>), FetchError> {
        let mut req = self
            .inner
            .get(url)
            .header(
                ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            )
            .header(ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
            .header(USER_AGENT, &self.config.user_agent);

        if let Some(r) = referer {
            req = req.header(REFERER, r);
        }

        let res = req.send().await?;
        let status = res.status().as_u16();
        let final_url = res.url().to_string();
        let content_type = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);

        if !res.status().is_success() {
            return Err(FetchError::HttpStatus { status });
        }

        if let Some(len) = res.content_length()
            && len as usize > self.config.max_body_bytes
        {
            return Err(FetchError::BodyTooLarge {
                limit: self.config.max_body_bytes,
            });
        }

        let bytes = res.bytes().await?;
        if bytes.len() > self.config.max_body_bytes {
            return Err(FetchError::BodyTooLarge {
                limit: self.config.max_body_bytes,
            });
        }

        Ok((final_url, status, bytes.to_vec(), content_type))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};

    async fn spawn_server(body: &'static str, content_type: &'static str) -> String {
        let app = Router::new().route(
            "/page",
            get(move || async move { ([("content-type", content_type)], body) }),
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{addr}/page")
    }

    #[tokio::test]
    async fn fetches_and_decodes_utf8() {
        let url = spawn_server(
            "<html><body>斗破苍穹</body></html>",
            "text/html; charset=utf-8",
        )
        .await;
        let client = HttpClient::new(HttpClientConfig::default()).unwrap();
        let page = client.fetch(&url, None).await.unwrap();
        assert_eq!(page.status, 200);
        assert!(page.text.contains("斗破苍穹"));
    }

    #[tokio::test]
    async fn decodes_gbk_pages() {
        // GBK 编码的「斗破苍穹」
        let (gbk, _, _) = encoding_rs::GB18030.encode("<html>斗破苍穹</html>");
        let leaked: &'static [u8] = Box::leak(gbk.into_owned().into_boxed_slice());

        let app = Router::new().route(
            "/page",
            get(move || async move { ([("content-type", "text/html; charset=gbk")], leaked) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = HttpClient::new(HttpClientConfig::default()).unwrap();
        let page = client
            .fetch(&format!("http://{addr}/page"), None)
            .await
            .unwrap();
        assert!(page.text.contains("斗破苍穹"), "实际: {}", page.text);
    }

    #[tokio::test]
    async fn rejects_non_http_url() {
        let client = HttpClient::new(HttpClientConfig::default()).unwrap();
        let err = client.fetch("file:///etc/passwd", None).await.unwrap_err();
        assert!(matches!(err, FetchError::BadUrl(_)));
    }

    #[tokio::test]
    async fn surfaces_http_errors() {
        let app = Router::new().route(
            "/page",
            get(|| async { (axum::http::StatusCode::NOT_FOUND, "nope") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = HttpClient::new(HttpClientConfig::default()).unwrap();
        let err = client
            .fetch(&format!("http://{addr}/page"), None)
            .await
            .unwrap_err();
        assert!(matches!(err, FetchError::HttpStatus { status: 404 }));
    }
}
