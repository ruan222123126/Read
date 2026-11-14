/**
 * 段落内容指纹（与 Rust `read-domain::fingerprint` 同算法）。
 *
 * 段评锚定：不同书源的排版有空格、全半角、错别字差异，所以不能用「第 N 段」
 * 做坐标，必须用内容指纹 + 汉明距离容错匹配。
 */

/** 归一化：全角转半角、去空白、去标点、小写化。 */
export function normalizeText(input: string): string {
  let out = "";
  for (const raw of input) {
    const code = raw.codePointAt(0)!;
    let ch = raw;
    if (code === 0x3000) continue;
    if (code >= 0xff01 && code <= 0xff5e) {
      ch = String.fromCodePoint(code - 0xfee0);
    }
    if (/\s/u.test(ch) || isPunctuation(ch)) continue;
    out += ch.toLowerCase();
  }
  return out;
}

export function isPunctuation(ch: string): boolean {
  if (/[!-/:-@[-`{-~]/.test(ch)) return true;
  const code = ch.codePointAt(0)!;
  if (
    (code >= 0x2000 && code <= 0x206f) ||
    (code >= 0x2e00 && code <= 0x2e7f) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xfe50 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff0f) ||
    (code >= 0xff1a && code <= 0xff20) ||
    (code >= 0xff3b && code <= 0xff40) ||
    (code >= 0xff5b && code <= 0xff65)
  ) {
    return true;
  }
  return "“”‘’—…·《》【】".includes(ch);
}

/** FNV-1a 64 位，返回 bigint。 */
function fnv1a64(token: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < token.length; i++) {
    hash ^= BigInt(token.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash;
}

/** 64 位 SimHash，返回 bigint。 */
export function simhash64(text: string): bigint {
  const chars = Array.from(normalizeText(text));
  if (chars.length === 0) return 0n;

  const tokens: string[] =
    chars.length < 2 ? chars.slice() : chars.slice(0, -1).map((c, i) => c + chars[i + 1]!);

  const weights = new Int32Array(64);
  for (const token of tokens) {
    const h = fnv1a64(token);
    for (let bit = 0; bit < 64; bit++) {
      const on = (h >> BigInt(bit)) & 1n;
      weights[bit]! += on === 1n ? 1 : -1;
    }
  }

  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit]! > 0) out |= 1n << BigInt(bit);
  }
  return out;
}

/** 16 字符十六进制指纹，与后端 `content_hash_hex` 一致。 */
export function contentHashHex(text: string): string {
  return simhash64(text).toString(16).padStart(16, "0");
}

export function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** 容错 3 bit：可吸收少量错别字/空格差异。 */
export function isSameParagraph(a: string, b: string, tolerance = 3): boolean {
  return hamming64(simhash64(a), simhash64(b)) <= tolerance;
}
