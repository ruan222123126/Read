//! 书源抓取编排：把「书源规则 + 抓取客户端 + 解析器」串成可用的动作。
//!
//! 提供三个高层动作，与 Legado 的三段流程一一对应：
//! - [`search`]  搜索
//! - [`toc`]     目录
//! - [`content`] 正文

use crate::{FetchError, HttpClient};
use read_source_engine::{
    extract::{Doc, extract_content, extract_search, extract_toc},
    legado::{BookSource, SearchBook, TocEntry},
    rule::Rule,
};

/// 搜索时替换 URL 模板里的 `{{key}}` / `{{page}}` / `{{baseUrl}}`。
pub async fn search(
    client: &HttpClient,
    source: &BookSource,
    keyword: &str,
    page: u32,
) -> Result<Vec<SearchBook>, FetchError> {
    let url = Rule::interpolate(
        &source.search_url,
        &[
            ("baseUrl", &source.book_source_url),
            ("key", keyword),
            ("page", &page.to_string()),
        ],
    );
    // 部分书源的 searchUrl 没带 baseUrl，补全为绝对地址
    let url = absolutize(&source.book_source_url, &url);

    let page = client.fetch(&url, Some(&source.book_source_url)).await?;
    let doc = Doc::parse(&page.text);
    Ok(extract_search(
        &doc,
        &source.rule_search,
        &source.book_source_name,
    ))
}

/// 抓目录。
pub async fn toc(
    client: &HttpClient,
    source: &BookSource,
    toc_url: &str,
) -> Result<Vec<TocEntry>, FetchError> {
    let url = absolutize(&source.book_source_url, toc_url);
    let page = client.fetch(&url, Some(&source.book_source_url)).await?;
    let doc = Doc::parse(&page.text);

    let mut entries = extract_toc(&doc, &source.rule_toc);

    // 章节 URL 统一转成绝对地址，方便后续直接抓正文
    for e in &mut entries {
        e.url = absolutize(&url, &e.url);
    }
    Ok(entries)
}

/// 抓正文（单页）。
pub async fn content(
    client: &HttpClient,
    source: &BookSource,
    chapter_url: &str,
) -> Result<Vec<String>, FetchError> {
    let url = absolutize(&source.book_source_url, chapter_url);
    let page = client.fetch(&url, Some(&source.book_source_url)).await?;
    let doc = Doc::parse(&page.text);
    Ok(extract_content(&doc, &source.rule_content))
}

/// 把相对 URL 补成绝对地址。
pub fn absolutize(base: &str, url: &str) -> String {
    let url = url.trim();
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    if url.starts_with("//") {
        let scheme = if base.starts_with("https") {
            "https:"
        } else {
            "http:"
        };
        return format!("{scheme}{url}");
    }

    let base = base.trim_end_matches('/');
    if let Some(rest) = url.strip_prefix('/') {
        // 取 base 的 origin
        if let Some(idx) = base.find("://") {
            let after_scheme = &base[idx + 3..];
            let origin_end = after_scheme
                .find('/')
                .map(|i| idx + 3 + i)
                .unwrap_or(base.len());
            return format!("{}/{}", &base[..origin_end], rest);
        }
        return format!("{base}/{rest}");
    }

    format!("{base}/{url}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_absolute_urls() {
        assert_eq!(
            absolutize("https://a.com", "https://b.com/x"),
            "https://b.com/x"
        );
    }

    #[test]
    fn resolves_root_relative() {
        assert_eq!(
            absolutize("https://a.com/book/1", "/chapter/2"),
            "https://a.com/chapter/2"
        );
    }

    #[test]
    fn resolves_path_relative() {
        assert_eq!(
            absolutize("https://a.com/book", "1.html"),
            "https://a.com/book/1.html"
        );
    }

    #[test]
    fn resolves_protocol_relative() {
        assert_eq!(
            absolutize("https://a.com", "//cdn.com/x"),
            "https://cdn.com/x"
        );
        assert_eq!(
            absolutize("http://a.com", "//cdn.com/x"),
            "http://cdn.com/x"
        );
    }

    #[test]
    fn strips_trailing_slash_from_base() {
        assert_eq!(
            absolutize("https://a.com/", "1.html"),
            "https://a.com/1.html"
        );
    }
}
