//! 把 HTML 文档喂给规则，产出书籍 / 目录 / 正文。
//!
//! 支持：
//! - 标准 CSS 选择器
//! - Legado 简写：`class.x` → `.x`，`id.x` → `#x`，`tag.div` → `div`
//! - 属性提取：`@text` `@html` `@href` `@src` `@任意属性`
//! - 结构前缀 `@css:` 与 `@xpath:`（XPath 目前降级为不支持，返回空）
//!
//! 不做任何网络请求、不 eval JS。

use scraper::{ElementRef, Html, Selector};

use crate::legado::{ContentRule, SearchBook, SearchRule, TocEntry, TocRule};
use crate::rule::Rule;

/// 解析后的文档包装。
pub struct Doc {
    html: Html,
}

impl Doc {
    pub fn parse(html: &str) -> Self {
        Self {
            html: Html::parse_document(html),
        }
    }

    /// 按规则选出节点，并提取为字符串列表。
    pub fn select(&self, rule: &Rule) -> Vec<String> {
        if rule.kind == crate::rule::RuleKind::XPath {
            // TODO: XPath 支持（需额外引入 sxd-xpath + 转换层）
            return Vec::new();
        }

        let css = legado_to_css(&rule.body);
        let Ok(selector) = Selector::parse(&css) else {
            return Vec::new();
        };

        self.html
            .select(&selector)
            .map(|el| extract_value(el, rule.attr.as_deref()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// 选第一个节点的文本值，适合书名、作者这类单值规则。
    pub fn select_first(&self, rule: &Rule) -> Option<String> {
        self.select(rule).into_iter().next()
    }
}

fn extract_value(el: ElementRef<'_>, attr: Option<&str>) -> String {
    match attr {
        None | Some("text") => el.text().collect::<String>(),
        Some("html") | Some("innerHtml") => el.inner_html(),
        Some("outerHtml") => el.html(),
        Some(a) => el.value().attr(a).unwrap_or_default().to_string(),
    }
}

/// Legado 简写 → 标准 CSS。
///
/// `class.item` → `.item`，`id.main` → `#main`，`tag.a` → `a`，
/// 其余原样返回（含后代组合符的复杂选择器不做改写）。
pub fn legado_to_css(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for (i, part) in raw.split(' ').enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&rewrite_token(part));
    }
    out
}

fn rewrite_token(tok: &str) -> String {
    if let Some(rest) = tok.strip_prefix("class.") {
        format!(".{rest}")
    } else if let Some(rest) = tok.strip_prefix("id.") {
        format!("#{rest}")
    } else if let Some(rest) = tok.strip_prefix("tag.") {
        rest.to_string()
    } else if let Some(rest) = tok.strip_prefix("id-") {
        // 手写书源里偶尔写成 `id-content`，等价于 `#content`
        format!("#{rest}")
    } else if let Some(rest) = tok.strip_prefix("class-") {
        format!(".{rest}")
    } else {
        tok.to_string()
    }
}

/// 按搜索规则抽取结果列表。
pub fn extract_search(doc: &Doc, rule: &SearchRule, source_name: &str) -> Vec<SearchBook> {
    let list_rule = match Rule::parse(&rule.book_list) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };

    let css = legado_to_css(&list_rule.body);
    let Ok(selector) = Selector::parse(&css) else {
        return Vec::new();
    };

    let pick = |item: &ElementRef<'_>, sub: &str| -> Option<String> {
        if sub.trim().is_empty() {
            return None;
        }
        let r = Rule::parse(sub).ok()?;
        // 直接对当前节点取值：`text` / `href` / `@href` / `ownText`
        if is_self_value_rule(&r) {
            return non_empty(extract_value(*item, self_attr(&r)));
        }
        let sel = Selector::parse(&legado_to_css(&r.body)).ok()?;
        let el = item.select(&sel).next()?;
        let v = extract_value(el, r.attr.as_deref()).trim().to_string();
        (!v.is_empty()).then_some(v)
    };

    doc.html
        .select(&selector)
        .filter_map(|item| {
            let name = pick(&item, &rule.name)?;
            let book_url = pick(&item, &rule.book_url)?;
            Some(SearchBook {
                name,
                author: pick(&item, &rule.author).unwrap_or_default(),
                book_url,
                cover_url: rule.cover_url.as_deref().and_then(|r| pick(&item, r)),
                intro: rule.intro.as_deref().and_then(|r| pick(&item, r)),
                last_chapter: rule.last_chapter.as_deref().and_then(|r| pick(&item, r)),
                word_count: rule.word_count.as_deref().and_then(|r| pick(&item, r)),
                kind: rule.kind.as_deref().and_then(|r| pick(&item, r)),
                source_name: source_name.to_string(),
            })
        })
        .collect()
}

/// 按目录规则抽取章节列表。
pub fn extract_toc(doc: &Doc, rule: &TocRule) -> Vec<TocEntry> {
    let Ok(list_rule) = Rule::parse(&rule.chapter_list) else {
        return Vec::new();
    };
    let css = legado_to_css(&list_rule.body);
    let Ok(selector) = Selector::parse(&css) else {
        return Vec::new();
    };

    let name_rule = Rule::parse(&rule.chapter_name).ok();
    let url_rule = Rule::parse(&rule.chapter_url).ok();

    doc.html
        .select(&selector)
        .filter_map(|item| {
            let title = name_rule
                .as_ref()
                .and_then(|r| sub_value(&item, r))
                .or_else(|| {
                    let t = item.text().collect::<String>().trim().to_string();
                    (!t.is_empty()).then_some(t)
                })?;
            let url = url_rule.as_ref().and_then(|r| sub_value(&item, r))?;
            Some(TocEntry { title, url })
        })
        .collect()
}

/// 按正文规则抽取正文段落。
///
/// 返回按行切分、已去除空行与常见广告噪声的段落。
pub fn extract_content(doc: &Doc, rule: &ContentRule) -> Vec<String> {
    let Ok(r) = Rule::parse(&rule.content) else {
        return Vec::new();
    };
    let css = legado_to_css(&r.body);
    let Ok(selector) = Selector::parse(&css) else {
        return Vec::new();
    };

    let Some(el) = doc.html.select(&selector).next() else {
        return Vec::new();
    };

    // scraper 的 text() 会把 <br> 丢掉，按 DOM 顺序重建换行
    let raw = render_text_with_breaks(el);
    sanitize_paragraphs(&raw, &r)
}

/// 清洗正文：按行切段、去空行、去常见站点噪声。
pub fn sanitize_paragraphs(raw: &str, rule: &Rule) -> Vec<String> {
    let text = rule.apply_cleaning(raw);

    text.lines()
        .map(|l| l.trim().trim_start_matches('\u{3000}').trim().to_string())
        .filter(|l| !l.is_empty())
        .filter(|l| !is_noise(l))
        .collect()
}

fn is_noise(line: &str) -> bool {
    const NOISE: &[&str] = &[
        "本章未完，请点击下一页继续阅读",
        "请记住本书首发域名",
        "最新网址",
        "手机版阅读网址",
        "笔趣阁",
    ];
    NOISE.iter().any(|n| line.contains(n))
}

fn sub_value(item: &ElementRef<'_>, rule: &Rule) -> Option<String> {
    // 直接对当前节点取值：`text` / `href` / `@href` / `ownText`
    if is_self_value_rule(rule) {
        return non_empty(extract_value(*item, self_attr(rule)));
    }

    let sel = Selector::parse(&legado_to_css(&rule.body)).ok()?;
    let el = item.select(&sel).next()?;
    let v = extract_value(el, rule.attr.as_deref()).trim().to_string();
    (!v.is_empty()).then_some(v)
}

fn non_empty(v: String) -> Option<String> {
    let t = v.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// 判断规则是否是「取当前节点自身的值」，而不是「在当前节点下查找子节点」。
///
/// Legado 里 `text`、`ownText`、`href`、`@href`、`text@href` 都表示直接取值。
fn is_self_value_rule(rule: &Rule) -> bool {
    if matches!(rule.body.as_str(), "text" | "ownText" | "html") {
        return true;
    }
    // `@href`：纯属性取值
    if rule.body.is_empty() && rule.attr.is_some() {
        return true;
    }
    // `href` / `src` / `content`：裸属性名
    rule.attr.is_none() && crate::rule::is_attr_name(&rule.body)
}

/// 把「自身取值」规则映射为 `extract_value` 需要的属性名。
fn self_attr(rule: &Rule) -> Option<&str> {
    if let Some(attr) = rule.attr.as_deref() {
        return Some(attr);
    }
    match rule.body.as_str() {
        "text" | "ownText" | "html" => Some(rule.body.as_str()),
        other => Some(other),
    }
}

/// 按 DOM 顺序渲染文本，把 `<br>` 与块级元素边界转成换行。
///
/// 会跳过站点噪声子树（导航、页头、工具栏、脚注等），否则正文里
/// 会混进「姊妹计划」「数据项」「编辑」这类无关文字。
fn render_text_with_breaks(root: ElementRef<'_>) -> String {
    use scraper::node::Node;
    use std::collections::HashSet;

    // 先收集所有噪声子树的根节点 id，遍历时跳过它们的整棵子树
    let noisy: HashSet<_> = root
        .descendants()
        .filter_map(|n| match n.value() {
            Node::Element(e) if is_noise_element(e) => Some(n.id()),
            _ => None,
        })
        .collect();

    let mut out = String::new();

    for node in root.descendants() {
        // 是否有祖先（或自己）落在噪声集合里
        let inside_noise =
            noisy.contains(&node.id()) || node.ancestors().any(|a| noisy.contains(&a.id()));

        match node.value() {
            Node::Element(e) if is_noise_element(e) => {
                // 噪声子树根，整棵跳过
            }
            Node::Element(e) => {
                if !inside_noise
                    && matches!(
                        e.name(),
                        "br" | "p" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "dd" | "dl"
                    )
                {
                    out.push('\n');
                }
            }
            Node::Text(t) if !inside_noise => {
                out.push_str(t);
            }
            _ => {}
        }
    }
    out
}

/// 站点噪声元素：导航、页头、脚注、工具条、隐藏块。
fn is_noise_element(el: &scraper::node::Element) -> bool {
    /// 这些标签的内容一律不要：脚本、样式、无脚本降级块（里面常是原始 HTML 字符串）
    const NOISE_TAGS: &[&str] = &[
        "script", "style", "noscript", "template", "iframe", "svg", "object",
    ];
    const NOISE_IDS: &[&str] = &[
        "headerContainer",
        "mw-navigation",
        "mw-panel",
        "mw-head",
        "catlinks",
        "printfooter",
        "mw-indicator-~ext-wikisource-download",
    ];
    const NOISE_CLASSES: &[&str] = &[
        "noprint",
        "mw-editsection",
        "printfooter",
        "catlinks",
        "mw-jump-link",
        "vector-header",
        "vector-toc",
        "vector-column-start",
        "vector-column-end",
        "plainSister",
        "sistersitebox",
        "mw-hidden-catlinks",
    ];

    if NOISE_TAGS.contains(&el.name()) {
        return true;
    }
    if let Some(id) = el.attr("id")
        && NOISE_IDS.contains(&id)
    {
        return true;
    }
    if let Some(class) = el.attr("class") {
        let has = class.split_whitespace();
        for c in has {
            if NOISE_CLASSES.contains(&c) {
                return true;
            }
        }
    }
    // 隐藏块
    if el.attr("style").is_some_and(|s| s.contains("display:none")) {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const HTML: &str = r#"
    <html><body>
      <div class="list">
        <div class="item">
          <a class="name" href="/book/1">斗破苍穹</a>
          <span class="author">天蚕土豆</span>
        </div>
      </div>
    </body></html>"#;

    #[test]
    fn rewrites_legado_shorthand() {
        assert_eq!(legado_to_css("class.list tag.div"), ".list div");
        assert_eq!(legado_to_css("id.main"), "#main");
        assert_eq!(legado_to_css(".a > .b"), ".a > .b");
    }

    #[test]
    fn extracts_search() {
        let doc = Doc::parse(HTML);
        let rule = SearchRule {
            book_list: "class.list@class.item".into(),
            name: "class.name@text".into(),
            author: "class.author@text".into(),
            book_url: "class.name@href".into(),
            ..Default::default()
        };
        let items = extract_search(&doc, &rule, "测试源");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "斗破苍穹");
        assert_eq!(items[0].author, "天蚕土豆");
        assert_eq!(items[0].book_url, "/book/1");
    }

    #[test]
    fn sanitizes_noise() {
        let raw = "第一段\n\n　第二段　\n请记住本书首发域名\n";
        let rule = Rule::parse("#content").unwrap();
        let out = sanitize_paragraphs(raw, &rule);
        assert_eq!(out, vec!["第一段", "第二段"]);
    }

    #[test]
    fn applies_cleaning_regex_in_content() {
        let html = r#"<div id="content">正文一<br>广告QQ群12345<br>正文二</div>"#;
        let doc = Doc::parse(html);
        let rule = ContentRule {
            content: "#content##广告QQ群\\d+##".into(),
            ..Default::default()
        };
        let out = extract_content(&doc, &rule);
        assert_eq!(out, vec!["正文一", "正文二"]);
    }

    /// 真实场景：维基文库目录的 chapterName 就是 `text`，chapterUrl 是 `href`，
    /// 表示直接取 <a> 自身的文本与属性，而不是在它内部继续查找。
    #[test]
    fn supports_self_value_rules_in_toc() {
        let html = r#"
        <div id="mw-content-text">
          <ul>
            <li><a href="/wiki/西遊記/第001回">第一回</a></li>
            <li><a href="/wiki/西遊記/第002回">第二回</a></li>
          </ul>
        </div>"#;
        let doc = Doc::parse(html);
        let rule = TocRule {
            chapter_list: "id.mw-content-text tag.a".into(),
            chapter_name: "text".into(),
            chapter_url: "href".into(),
            ..Default::default()
        };
        let out = extract_toc(&doc, &rule);
        assert_eq!(out.len(), 2, "应解析出两章: {out:?}");
        assert_eq!(out[0].title, "第一回");
        assert_eq!(out[0].url, "/wiki/西遊記/第001回");
        assert_eq!(out[1].title, "第二回");
    }

    /// 导航、页头、脚注等噪声子树必须整棵剔除，不能只剔除根节点自身的文本。
    #[test]
    fn drops_noise_subtrees_in_content() {
        let html = r#"
        <div id="content">
          <div id="headerContainer"><span>西遊記</span><span>作者：吳承恩</span></div>
          <p>詩曰：</p>
          <ul class="noprint"><li>姊妹计划: 数据项</li></ul>
          <p>混沌未分天地亂。</p>
        </div>"#;
        let doc = Doc::parse(html);
        let rule = ContentRule {
            content: "#content".into(),
            ..Default::default()
        };
        let out = extract_content(&doc, &rule);
        assert_eq!(out, vec!["詩曰：", "混沌未分天地亂。"], "{out:?}");
    }

    #[test]
    fn supports_at_prefixed_attr_in_list_rule() {
        // Legado 语义：`@href` 取「当前节点自身」的属性。
        // 所以这里的 bookList 直接选中 <a>。
        let html = r#"<div><a href="/b/1">书</a></div>"#;
        let doc = Doc::parse(html);
        let rule = SearchRule {
            book_list: "tag.a".into(),
            name: "text".into(),
            author: "".into(),
            book_url: "@href".into(),
            ..Default::default()
        };
        let out = extract_search(&doc, &rule, "源");
        assert_eq!(out.len(), 1, "{out:?}");
        assert_eq!(out[0].name, "书");
        assert_eq!(out[0].book_url, "/b/1");
    }
}
