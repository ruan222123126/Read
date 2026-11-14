//! 领域模型：书籍实体归一化、正文指纹、书源映射。
//!
//! 这一层不依赖数据库、HTTP 或任何 IO，纯计算，方便单元测试与复用
//! （前端 WASM 侧将来也能直接拿去做段评锚定）。

pub mod book;
pub mod fingerprint;
pub mod mapping;

pub use book::{CanonicalBook, canonical_key};
pub use fingerprint::{content_hash_hex, is_same_paragraph, normalize_paragraph, simhash64};
pub use mapping::{Availability, BookSourceMapping};

/// 归一化后的纯文本：全角转半角、去空白、去标点、小写化。
pub fn normalize_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        // 全角 ASCII（U+FF01..U+FF5E）→ 半角
        let ch = match ch {
            '\u{3000}' => continue,
            c if ('\u{FF01}'..='\u{FF5E}').contains(&c) => {
                char::from_u32(c as u32 - 0xFEE0).unwrap_or(c)
            }
            c => c,
        };
        if ch.is_whitespace() || is_punctuation(ch) {
            continue;
        }
        for lower in ch.to_lowercase() {
            out.push(lower);
        }
    }
    out
}

/// 判断字符是否属于「标点/符号」类，归一化时丢弃。
pub fn is_punctuation(ch: char) -> bool {
    if ch.is_ascii_punctuation() {
        return true;
    }
    matches!(ch as u32,
        0x2000..=0x206F   // General Punctuation
        | 0x2E00..=0x2E7F // Supplemental Punctuation
        | 0x3000..=0x303F // CJK Symbols and Punctuation
        | 0xFE30..=0xFE4F // CJK Compatibility Forms
        | 0xFE50..=0xFE6F // Small Form Variants
        | 0xFF00..=0xFF0F // Fullwidth ASCII punctuation 前半
        | 0xFF1A..=0xFF20
        | 0xFF3B..=0xFF40
        | 0xFF5B..=0xFF65
    ) || matches!(
        ch,
        '“' | '”' | '‘' | '’' | '—' | '…' | '·' | '《' | '》' | '【' | '】'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fullwidth_and_punct_are_stripped() {
        assert_eq!(normalize_text("《斗破 苍穹》！"), "斗破苍穹");
        assert_eq!(normalize_text("ＡＢＣ－１２３"), "abc123");
        assert_eq!(normalize_text("  天 蚕 土 豆  "), "天蚕土豆");
    }
}
