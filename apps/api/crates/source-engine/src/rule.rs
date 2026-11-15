//! 规则串解析与求值。
//!
//! Legado 规则串形态（简化）：
//! - `@css:.list > li`            显式 CSS
//! - `@xpath://div[@id='list']`   显式 XPath
//! - `.list > li`                 裸选择器，默认按 CSS
//! - `tag.a@href` / `class.item@text`  Legado 的简写语法
//! - `选择器##正则##替换`          用 `##` 分隔的「正则清洗」三段式
//! - `{{baseUrl}}/search?q={{key}}`  变量替换
//!
//! 本模块只负责「拆分 + 正则/变量」这类无 DOM 的部分；依赖 DOM 的部分在
//! `extract` 里完成。

use regex::Regex;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RuleError {
    #[error("空规则")]
    Empty,
    #[error("正则非法: {0}")]
    BadRegex(String),
    #[error("选择器非法: {0}")]
    BadSelector(String),
    #[error("暂不支持的规则类型: {0}")]
    Unsupported(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleKind {
    Css,
    XPath,
    JsonPath,
    /// 纯字面量，不查询
    Literal,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub raw: String,
    pub kind: RuleKind,
    /// 主体部分（去掉 `@css:` 之类前缀）
    pub body: String,
    /// 取属性名：`@href` / `@text` / `@html`
    pub attr: Option<String>,
    /// `##` 之后的清洗正则
    pub regex: Option<String>,
    /// 正则的替换内容，缺省为空串（即删除匹配）
    pub replacement: Option<String>,
}

impl Rule {
    pub fn parse(raw: &str) -> Result<Self, RuleError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(RuleError::Empty);
        }

        let (kind, rest) = if let Some(r) = raw.strip_prefix("@css:") {
            (RuleKind::Css, r)
        } else if let Some(r) = raw.strip_prefix("@xpath:") {
            (RuleKind::XPath, r)
        } else if let Some(r) = raw.strip_prefix("@json:") {
            (RuleKind::JsonPath, r)
        } else if raw.starts_with("//") || raw.starts_with("/html") {
            (RuleKind::XPath, raw)
        } else {
            (RuleKind::Css, raw)
        };

        // 三段式：`选择器##正则##替换`
        let mut parts = rest.splitn(3, "##");
        let head = parts.next().unwrap_or_default();
        let regex = parts.next().map(str::to_string);
        let replacement = parts.next().map(str::to_string);

        // 取属性后缀：`tag.a@href`
        let (selector, attr) = if kind == RuleKind::Css {
            split_attr(head)
        } else {
            (head.to_string(), None)
        };

        let kind = if selector.is_empty() && attr.is_none() {
            RuleKind::Literal
        } else {
            kind
        };

        Ok(Rule {
            raw: raw.to_string(),
            kind,
            body: selector,
            attr,
            regex,
            replacement,
        })
    }

    /// 用变量替换 `{{name}}` 占位符。
    pub fn interpolate(template: &str, vars: &[(&str, &str)]) -> String {
        let mut out = template.to_string();
        for (k, v) in vars {
            out = out.replace(&format!("{{{{{k}}}}}"), v);
        }
        out
    }

    /// 应用 `##正则##替换` 清洗段。没有正则段时原样返回。
    pub fn apply_cleaning(&self, input: &str) -> String {
        let Some(pattern) = &self.regex else {
            return input.to_string();
        };
        let Ok(re) = Regex::new(pattern) else {
            return input.to_string();
        };
        re.replace_all(input, self.replacement.as_deref().unwrap_or(""))
            .to_string()
    }
}

/// 把 `tag.a@href` 拆成 `("tag.a", Some("href"))`。
///
/// 注意：Legado 的列表规则里 `@` 也用作「容器@条目」的分隔符
/// （如 `class.list@class.item`），所以只有在后缀确实是属性名时才当作取属性。
fn split_attr(body: &str) -> (String, Option<String>) {
    if let Some(idx) = body.rfind('@') {
        let (sel, attr) = body.split_at(idx);
        let attr = &attr[1..];
        if is_attr_name(attr) {
            return (sel.to_string(), Some(attr.to_string()));
        }
    }
    // 非属性后缀的 `@` 视作后代分隔符
    (body.replace('@', " "), None)
}

pub(crate) fn is_attr_name(attr: &str) -> bool {
    if attr.is_empty() || attr.contains('.') || attr.contains(' ') || attr.contains('>') {
        return false;
    }
    const KNOWN: &[&str] = &[
        "text",
        "ownText",
        "html",
        "innerHtml",
        "outerHtml",
        "href",
        "src",
        "content",
        "value",
        "title",
        "alt",
        "data-src",
        "data-original",
    ];
    KNOWN.contains(&attr) || attr.starts_with("data-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_css_with_attr() {
        let r = Rule::parse(".book-list li .name@text").unwrap();
        assert_eq!(r.kind, RuleKind::Css);
        assert_eq!(r.body, ".book-list li .name");
        assert_eq!(r.attr.as_deref(), Some("text"));
    }

    #[test]
    fn parses_three_part_regex() {
        let r = Rule::parse("@css:#content##广告\\S*##").unwrap();
        assert_eq!(r.kind, RuleKind::Css);
        assert_eq!(r.body, "#content");
        assert_eq!(r.regex.as_deref(), Some("广告\\S*"));
        assert_eq!(r.replacement.as_deref(), Some(""));
    }

    #[test]
    fn applies_cleaning_regex() {
        let r = Rule::parse("#content##\\s*请收藏本站\\S*##").unwrap();
        assert_eq!(
            r.apply_cleaning("正文开始\n请收藏本站abc\n正文结束"),
            "正文开始\n正文结束"
        );
    }

    #[test]
    fn keeps_literal_when_no_cleaning() {
        let r = Rule::parse("#content").unwrap();
        assert_eq!(r.apply_cleaning("原样"), "原样");
    }

    #[test]
    fn parses_xpath() {
        let r = Rule::parse("@xpath://div[@id='list']/a").unwrap();
        assert_eq!(r.kind, RuleKind::XPath);
        assert_eq!(r.body, "//div[@id='list']/a");
    }

    #[test]
    fn interpolates_vars() {
        let s = Rule::interpolate(
            "{{baseUrl}}/s?q={{key}}&p={{page}}",
            &[("baseUrl", "https://a.com"), ("key", "斗破"), ("page", "1")],
        );
        assert_eq!(s, "https://a.com/s?q=斗破&p=1");
    }
}
