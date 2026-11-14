//! 本地假源站，用于端到端验证「搜索 → 目录 → 正文」。
//!
//! 运行：
//! ```bash
//! cargo run -p read-server --example demo_site
//! ```
//! 然后另开一个终端：
//! ```bash
//! curl "http://localhost:8080/api/v1/explore/search?q=斗破"
//! ```

use axum::{Router, extract::Query, response::Html, routing::get};
use serde::Deserialize;

const BOOKS: &[(&str, &str, &str, &str)] = &[
    (
        "1001",
        "斗破苍穹",
        "天蚕土豆",
        "这里是属于斗气的世界，没有花俏艳丽的魔法，有的，仅仅是繁衍到巅峰的斗气！",
    ),
    (
        "1002",
        "武动乾坤",
        "天蚕土豆",
        "修炼一途，乃窃阴阳，夺造化，转涅槃，握生死，掌轮回。",
    ),
];

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

async fn search(Query(q): Query<SearchQuery>) -> Html<String> {
    let kw = q.q.unwrap_or_default();
    let items: String = BOOKS
        .iter()
        .filter(|(_, name, author, _)| name.contains(&kw) || author.contains(&kw) || kw.is_empty())
        .map(|(id, name, author, intro)| {
            format!(
                r#"<li class="result-item">
                     <a class="book-name" href="/book/{id}">{name}</a>
                     <span class="book-author">{author}</span>
                     <img src="/cover/{id}.jpg" alt="{name}" />
                     <p class="intro">{intro}</p>
                     <span class="latest">第1623章 大结局</span>
                     <span class="cat">玄幻</span>
                   </li>"#
            )
        })
        .collect();

    Html(format!(
        r#"<html><head><meta charset="utf-8"></head><body>
             <ul class="result-list">{items}</ul>
           </body></html>"#
    ))
}

async fn toc() -> Html<&'static str> {
    Html(
        r#"<html><head><meta charset="utf-8"></head><body>
             <ul id="chapter-list">
               <li><a href="/book/1001/1.html">第一章 陨落的天才</a></li>
               <li><a href="/book/1001/2.html">第二章 斗气大陆</a></li>
               <li><a href="/book/1001/3.html">第三章 客人</a></li>
             </ul>
           </body></html>"#,
    )
}

async fn chapter() -> Html<&'static str> {
    Html(
        r#"<html><head><meta charset="utf-8"></head><body>
             <div id="content">
               “斗之力，三段！”<br>
               望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情，唇角有着一抹自嘲。<br>
               广告VX公众号：xxx小说<br>
               “萧炎，斗之力，三段！级别：低级！”<br>
               测验魔石碑之旁，一位中年男子，看了一眼碑上所显示出来的信息，语气漠然的将之公布了出来。<br>
               少年缓缓抬起头来，露出一张有些清秀的稚嫩脸庞，漆黑的眸子木然的在周围那些嘲讽的同龄人身上扫过。<br>
               少年嘴角的自嘲，似乎变得更加苦涩了。<br>
               “这些人，都如此刻薄势力吗？或许是因为三年前他们曾经在自己面前露出过最谦卑的笑容，所以，如今想要讨还回去吧。”<br>
               苦涩的一笑，萧炎落寞的转身，安静的回到了队伍的最后一排，孤单的身影，与周围的世界，有些格格不入。<br>
               魔石碑之旁的中年男子，淡漠的瞥了一眼萧炎，眼中掠过一抹不易察觉的惋惜，旋即消散。<br>
               人群之中，一名少女怔怔的望着那落寞的少年背影，贝齿轻咬着红唇，眼中满是复杂。<br>
               三年之前，他是家族之中最耀眼的天才，斗气九段，被视为百年不遇的奇才。<br>
               三年之后，他却成了所有人茶余饭后的笑料，连斗之气三段都难以维持。<br>
               命运的转折，始于那枚从天上掉落的黑色戒指。<br>
               萧炎低头看了看手指上那枚古朴的黑色戒指，戒指上的纹路已经暗淡无光，仿佛随时都会碎裂开来。<br>
               他没有说话，只是将手缩回袖中，一步一步走向家族的演武场之外。<br>
               夕阳把他的影子拉得很长，长到几乎要触碰到远处的山脊。<br>
               演武场上依旧喧闹，少年们的斗气光芒此起彼伏，像是一场与他无关的烟火。<br>
               走出很远的距离之后，萧炎才停下脚步，抬头看着天边那片橘红色的云。<br>
               “三年。”他轻声说，声音低得只有自己能够听见。<br>
               “我会拿回来的。”<br>
             </div>
           </body></html>"#,
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let app = Router::new()
        .route("/search", get(search))
        .route("/book/{id}", get(toc))
        .route("/book/{id}/{chapter}", get(chapter));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:9911").await?;
    println!("本地假源站已启动: http://127.0.0.1:9911");
    println!("  搜索: http://127.0.0.1:9911/search?q=斗破");
    println!("  目录: http://127.0.0.1:9911/book/1001");
    axum::serve(listener, app).await?;
    Ok(())
}
