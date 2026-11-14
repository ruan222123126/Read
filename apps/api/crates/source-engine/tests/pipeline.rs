//! 端到端解析链路测试：一份仿真的书源 JSON + 三个页面 HTML，
//! 走完「搜索 → 目录 → 正文」全流程，不涉及网络与数据库。

use read_source_engine::{
    extract::{Doc, extract_content, extract_search, extract_toc},
    legado::BookSource,
    rule::Rule,
};

const SOURCE_JSON: &str = r#"
{
  "bookSourceName": "测试源",
  "bookSourceUrl": "https://novel.example.com",
  "bookSourceType": 0,
  "enabled": true,
  "weight": 10,
  "searchUrl": "{{baseUrl}}/search?q={{key}}&page={{page}}",
  "ruleSearch": {
    "bookList": "class.result-list@class.result-item",
    "name": "class.book-name@text",
    "author": "class.book-author@text",
    "bookUrl": "tag.a@href",
    "coverUrl": "tag.img@src",
    "intro": "class.intro@text",
    "lastChapter": "class.latest@text",
    "kind": "class.cat@text"
  },
  "ruleBookInfo": {
    "name": "id.info h1@text",
    "author": "id.info class.author@text",
    "intro": "id.intro@text",
    "coverUrl": "id.info tag.img@src",
    "tocUrl": "class.btn-toc@href"
  },
  "ruleToc": {
    "chapterList": "id.chapter-list@tag.li",
    "chapterName": "tag.a@text",
    "chapterUrl": "tag.a@href"
  },
  "ruleContent": {
    "content": "id.content##广告.*##",
    "nextContentUrl": ""
  }
}
"#;

const SEARCH_HTML: &str = r#"
<html><body>
  <ul class="result-list">
    <li class="result-item">
      <a class="book-name" href="/book/1001">斗破苍穹</a>
      <span class="book-author">天蚕土豆</span>
      <img src="https://img.example.com/cover1.jpg" />
      <p class="intro">三十年河东，三十年河西。</p>
      <span class="latest">第1623章 大结局</span>
      <span class="cat">玄幻</span>
    </li>
    <li class="result-item">
      <a class="book-name" href="/book/1002">武动乾坤</a>
      <span class="book-author">天蚕土豆</span>
      <img src="https://img.example.com/cover2.jpg" />
      <p class="intro">修炼一途，乃窃阴阳。</p>
      <span class="latest">第1300章 终章</span>
      <span class="cat">玄幻</span>
    </li>
  </ul>
</body></html>
"#;

const TOC_HTML: &str = r#"
<html><body>
  <div class="btn-toc"><a href="/book/1001/toc">目录</a></div>
  <ul id="chapter-list">
    <li><a href="/book/1001/1.html">第一章 陨落的天才</a></li>
    <li><a href="/book/1001/2.html">第二章 斗气大陆</a></li>
    <li><a href="/book/1001/3.html">第三章 客人</a></li>
  </ul>
</body></html>
"#;

const CONTENT_HTML: &str = r#"
<html><body>
  <div id="content">
    “斗之力，三段！”<br>
    望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情。<br>
    广告VX公众号：xxx小说<br>
    “萧炎，斗之力，三段！级别：低级！”<br>
    测验魔石碑之旁，一位中年男子，看了一眼碑上所显示出来的信息。
  </div>
</body></html>
"#;

#[test]
fn source_json_parses() {
    let sources = BookSource::parse_many(SOURCE_JSON).expect("书源 JSON 应能解析");
    assert_eq!(sources.len(), 1);
    let src = &sources[0];
    assert_eq!(src.book_source_name, "测试源");
    assert_eq!(src.rule_search.name, "class.book-name@text");
}

#[test]
fn search_url_interpolates() {
    let sources = BookSource::parse_many(SOURCE_JSON).unwrap();
    let src = &sources[0];
    let url = Rule::interpolate(
        &src.search_url,
        &[
            ("baseUrl", &src.book_source_url),
            ("key", "斗破"),
            ("page", "1"),
        ],
    );
    assert_eq!(url, "https://novel.example.com/search?q=斗破&page=1");
}

#[test]
fn full_chain_search_toc_content() {
    let sources = BookSource::parse_many(SOURCE_JSON).unwrap();
    let src = &sources[0];

    // 1) 搜索
    let doc = Doc::parse(SEARCH_HTML);
    let results = extract_search(&doc, &src.rule_search, &src.book_source_name);
    assert_eq!(results.len(), 2, "应解析出两条搜索结果");
    assert_eq!(results[0].name, "斗破苍穹");
    assert_eq!(results[0].author, "天蚕土豆");
    assert_eq!(results[0].book_url, "/book/1001");
    assert_eq!(results[0].source_name, "测试源");
    assert_eq!(results[1].name, "武动乾坤");

    // 2) 目录
    let toc_doc = Doc::parse(TOC_HTML);
    let chapters = extract_toc(&toc_doc, &src.rule_toc);
    assert_eq!(chapters.len(), 3, "应解析出三章");
    assert_eq!(chapters[0].title, "第一章 陨落的天才");
    assert_eq!(chapters[0].url, "/book/1001/1.html");
    assert_eq!(chapters[2].title, "第三章 客人");

    // 3) 正文（含广告清洗）
    let content_doc = Doc::parse(CONTENT_HTML);
    let paragraphs = extract_content(&content_doc, &src.rule_content);
    assert_eq!(paragraphs.len(), 4, "广告行应被清洗掉: {paragraphs:?}");
    assert_eq!(paragraphs[0], "“斗之力，三段！”");
    assert!(
        paragraphs.iter().all(|p| !p.contains("广告")),
        "不应残留广告: {paragraphs:?}"
    );
    assert!(paragraphs.last().unwrap().contains("中年男子"));
}

#[test]
fn paragraphs_have_stable_fingerprints() {
    use read_domain::fingerprint::{content_hash_hex, is_same_paragraph};

    let doc = Doc::parse(CONTENT_HTML);
    let sources = BookSource::parse_many(SOURCE_JSON).unwrap();
    let paragraphs = extract_content(&doc, &sources[0].rule_content);

    // 换源后仅排版差异，指纹应仍然匹配
    let reformatted = paragraphs[0].replace(['“', '”'], "\"");
    assert!(
        is_same_paragraph(&paragraphs[0], &reformatted),
        "排版差异不应影响段落锚定"
    );

    let h1 = content_hash_hex(&paragraphs[0]);
    let h2 = content_hash_hex(&paragraphs[0]);
    assert_eq!(h1, h2);
    assert_eq!(h1.len(), 16);
}
