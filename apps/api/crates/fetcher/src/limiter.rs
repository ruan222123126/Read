//! 按 host 的软限流。
//!
//! 不是精确的令牌桶，只保证「同一 host 的两次请求至少间隔 `min_interval`」。
//! 目的是避免把源站打挂导致 IP 被封，而不是做精确配额。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct HostRateLimiter {
    inner: Arc<Mutex<HashMap<String, Instant>>>,
    min_interval: Duration,
}

impl HostRateLimiter {
    pub fn new(min_interval: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            min_interval,
        }
    }

    /// 等待到可以请求该 host 的时刻，返回实际等待时长。
    pub async fn acquire(&self, host: &str) -> Duration {
        let wait = {
            let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            let next_allowed = guard
                .get(host)
                .map(|last| *last + self.min_interval)
                .unwrap_or(now);
            let wait = next_allowed.saturating_duration_since(now);
            guard.insert(host.to_string(), next_allowed.max(now));
            wait
        };

        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        wait
    }
}

/// 从 URL 里取 host，失败时返回空串（此时不限流）。
pub fn host_of(url: &str) -> String {
    url::Host::parse(url)
        .ok()
        .map(|h| h.to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn first_request_does_not_wait() {
        let limiter = HostRateLimiter::new(Duration::from_millis(50));
        assert!(limiter.acquire("a.com").await.is_zero());
    }

    #[tokio::test]
    async fn second_request_to_same_host_waits() {
        let limiter = HostRateLimiter::new(Duration::from_millis(60));
        limiter.acquire("a.com").await;
        let waited = limiter.acquire("a.com").await;
        assert!(waited >= Duration::from_millis(40), "实际等待 {waited:?}");
    }

    #[tokio::test]
    async fn different_hosts_are_independent() {
        let limiter = HostRateLimiter::new(Duration::from_millis(200));
        limiter.acquire("a.com").await;
        assert!(limiter.acquire("b.com").await.is_zero());
    }
}
