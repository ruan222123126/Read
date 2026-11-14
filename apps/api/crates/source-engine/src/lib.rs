//! 书源解析内核。
//!
//! 目标是兼容 Legado（阅读 3.0）书源 JSON 规范，让用户导入现成书源即可用。
//!
//! 分层：
//! - [`legado`]：书源 JSON 的结构定义与解析（宽松反序列化，容忍缺失字段）
//! - [`rule`]：规则串的拆分与求值（CSS / XPath / 正则 / JSONPath / 变量替换）
//! - [`extract`]：把 HTML 文档喂给规则，产出书籍 / 目录 / 正文
//!
//! 安全约定：本 crate 不做网络请求，也不 eval 任何 JS。`<js>...</js>` 片段
//! 目前只做变量替换，真正的 QuickJS 沙箱执行放在独立 worker 里（见 TODO）。

pub mod extract;
pub mod legado;
pub mod rule;

pub use legado::{BookSource, SearchBook};
pub use rule::{Rule, RuleError};

/// 编码嗅探：Legado 源大量是 GBK/GB18030，必须按站点声明的编码解码。
pub fn decode_body(bytes: &[u8], content_type: Option<&str>) -> String {
    // 1) 优先用 Content-Type 里声明的 charset
    if let Some(idx) = content_type
        .map(|ct| ct.to_ascii_lowercase())
        .as_deref()
        .and_then(|ct| ct.find("charset="))
    {
        let ct = content_type.unwrap_or_default();
        let label = ct[idx + 8..]
            .trim_start_matches('"')
            .split([';', '"', ' '])
            .next()
            .unwrap_or("");
        if let Some(enc) = encoding_rs::Encoding::for_label(label.as_bytes()) {
            let (text, _, _) = enc.decode(bytes);
            return text.into_owned();
        }
    }

    // 2) 退化为 meta charset 嗅探
    let (text, _, _) = encoding_rs::GB18030.decode(bytes);
    let head: String = text.chars().take(2048).collect();
    if let Some(enc) = sniff_meta_charset(&head) {
        let (decoded, _, _) = enc.decode(bytes);
        return decoded.into_owned();
    }

    // 3) 最后按 UTF-8 处理，失败再回落 GB18030
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => text.into_owned(),
    }
}

fn sniff_meta_charset(head: &str) -> Option<&'static encoding_rs::Encoding> {
    let lower = head.to_ascii_lowercase();
    let idx = lower.find("charset=")?;
    let label: String = lower[idx + 8..]
        .trim_start_matches('"')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
        .collect();
    encoding_rs::Encoding::for_label(label.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gbk() {
        let (bytes, _, _) = encoding_rs::GB18030.encode("斗破苍穹");
        assert_eq!(
            decode_body(&bytes, Some("text/html; charset=gbk")),
            "斗破苍穹"
        );
    }

    #[test]
    fn decodes_utf8_default() {
        assert_eq!(decode_body("天蚕土豆".as_bytes(), None), "天蚕土豆");
    }
}
