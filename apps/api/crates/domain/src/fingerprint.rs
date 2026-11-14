//! 段评锚定：内容指纹。
//!
//! 不同书源的排版（空格、全半角、错别字）会有差异，所以段评坐标不能用
//! 「第 N 段」，而要用段落内容的 SimHash。渲染时对每段算指纹，与库中
//! 指纹做汉明距离比较，距离足够小即认为同一段。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::normalize_text;

/// 段落归一化：与 `normalize_text` 一致，额外合并成单行。
pub fn normalize_paragraph(input: &str) -> String {
    normalize_text(input)
}

/// 计算 64 位 SimHash。
pub fn simhash64(text: &str) -> u64 {
    let norm = normalize_paragraph(text);
    let chars: Vec<char> = norm.chars().collect();
    if chars.is_empty() {
        return 0;
    }

    // CJK 用字符 bigram 作为特征，长度不足时退化为 unigram
    let tokens: Vec<String> = if chars.len() < 2 {
        chars.iter().map(|c| c.to_string()).collect()
    } else {
        chars.windows(2).map(|w| w.iter().collect()).collect()
    };

    let mut weights = [0i32; 64];
    for token in tokens {
        let h = hash64(&token);
        for (bit, w) in weights.iter_mut().enumerate() {
            if (h >> bit) & 1 == 1 {
                *w += 1;
            } else {
                *w -= 1;
            }
        }
    }

    let mut out = 0u64;
    for (bit, w) in weights.iter().enumerate() {
        if *w > 0 {
            out |= 1 << bit;
        }
    }
    out
}

fn hash64(token: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    hasher.finish()
}

/// 指纹的十六进制表示（16 个字符），落库时作为 `paragraph_hash` 前缀索引。
pub fn content_hash_hex(text: &str) -> String {
    format!("{:016x}", simhash64(text))
}

/// 汉明距离。
pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// 两段文本是否被认为是「同一段」（容错 3 bit，约可吸收少量错别字/空格差异）。
pub fn is_same_paragraph(a: &str, b: &str) -> bool {
    hamming(simhash64(a), simhash64(b)) <= 3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tolerant_to_formatting_noise() {
        let a = "萧炎抬起头，望着远处的山峰，心中涌起一股说不清的滋味。";
        let b = "萧炎抬起头, 望着远处的山峰 , 心中涌起一股说不清的滋味。";
        assert!(is_same_paragraph(a, b), "格式化差异应命中同一段");
    }

    #[test]
    fn different_text_differs() {
        let a = "萧炎抬起头，望着远处的山峰。";
        let b = "药老沉默了很久，才缓缓开口讲述当年的往事。";
        assert!(!is_same_paragraph(a, b));
    }

    #[test]
    fn empty_is_zero() {
        assert_eq!(simhash64(""), 0);
        assert_eq!(content_hash_hex(""), "0000000000000000");
    }

    #[test]
    fn hex_is_stable_width() {
        assert_eq!(content_hash_hex("第一章 陨落的天才").len(), 16);
    }
}
