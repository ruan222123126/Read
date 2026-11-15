/**
 * MOBI（MOBI7/PalmDOC）解析。
 *
 * 算法与 foliate-js（MIT）一致，已用真实文件验证过：
 * - PDB 记录表 → record0 解析 PalmDOC/MOBI/EXTH 头
 * - 文本记录先按 trailingFlags 剥掉尾部条目与跨记录多字节字符的重叠部分，
 *   再 PalmDOC LZ77 解压，最后按记录流式解码拼接
 * - 元数据走 EXTH（100 作者 / 103 简介 / 503 标题 / 201 封面记录号）
 * - 章节靠 <mbp:pagebreak> 哨兵 + 标题正则兜底
 *
 * 不支持的情况给出明确提示：HUFF/CDIC 压缩与纯 KF8/AZW3。
 */

import { PAGEBREAK, splitParagraphsIntoChapters } from "./chapters";
import { extractFromHtml } from "./html";
import { ImportError, type ParsedBook } from "./types";

function be16(b: Uint8Array, offset: number): number {
  return ((b[offset] ?? 0) << 8) | (b[offset + 1] ?? 0);
}

function be32(b: Uint8Array, offset: number): number {
  return (
    (((b[offset] ?? 0) << 24) |
      ((b[offset + 1] ?? 0) << 16) |
      ((b[offset + 2] ?? 0) << 8) |
      (b[offset + 3] ?? 0)) >>>
    0
  );
}

function readAscii(b: Uint8Array, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const byte = b[offset + i];
    if (byte === undefined) break;
    s += String.fromCharCode(byte);
  }
  return s;
}

/** 从尾部读变长整数（trailing entry 的长度编码在记录末尾）。导出供测试 */
export function getVarLenFromEnd(arr: Uint8Array): number {
  let value = 0;
  const start = Math.max(0, arr.length - 4);
  for (let i = start; i < arr.length; i++) {
    const byte = arr[i];
    if (byte === undefined) break;
    // 高位为 1 的字节标志「值的起点」，重新累计
    if (byte & 0x80) value = 0;
    value = ((value << 7) | (byte & 0x7f)) >>> 0;
  }
  return value;
}

/** 剥掉记录尾部的条目与跨记录多字节字符的重叠字节。导出供测试 */
export function removeTrailingEntries(arr: Uint8Array, flags: number): Uint8Array {
  let entryCount = 0;
  for (let f = flags >>> 1; f > 0; f >>>= 1) if (f & 1) entryCount++;
  for (let i = 0; i < entryCount; i++) {
    const length = getVarLenFromEnd(arr);
    if (length <= 0 || length > arr.length) return arr;
    arr = arr.subarray(0, arr.length - length);
  }
  if (flags & 1 && arr.length > 0) {
    const length = ((arr[arr.length - 1] ?? 0) & 3) + 1;
    arr = arr.subarray(0, Math.max(0, arr.length - length));
  }
  return arr;
}

/** PalmDOC LZ77 解压。导出供测试 */
export function decompressPalmDoc(data: Uint8Array): Uint8Array {
  let out = new Uint8Array(Math.max(4096, data.length * 4));
  let n = 0;
  const push = (byte: number) => {
    if (n === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[n++] = byte;
  };

  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === undefined) break;
    i++;
    if (c === 0) {
      push(0);
    } else if (c <= 8) {
      // 复制接下来 c 个原始字节（UTF-8 多字节字符走这条路）
      const end = Math.min(i + c, data.length);
      for (let j = i; j < end; j++) push(data[j] ?? 0);
      i += c;
    } else if (c < 0x80) {
      push(c);
    } else if (c < 0xc0) {
      // 长度-距离对：13 位距离 + 3 位长度
      const pair = (c << 8) | (data[i] ?? 0);
      i++;
      const distance = (pair & 0x3fff) >> 3;
      const length = (pair & 7) + 3;
      for (let j = 0; j < length; j++) push(out[n - distance] ?? 0);
    } else {
      push(32);
      push(c ^ 0x80);
    }
  }
  return out.subarray(0, n);
}

interface ExthData {
  title?: string;
  author?: string;
  description?: string;
  coverOffset?: number;
  thumbnailOffset?: number;
}

function parseExth(r0: Uint8Array, headerLength: number): ExthData | null {
  const base = 16 + headerLength;
  if (base + 12 > r0.length || readAscii(r0, base, 4) !== "EXTH") return null;
  const totalLength = be32(r0, base + 4);
  const data: ExthData = {};
  let pos = base + 12;
  const end = Math.min(base + totalLength, r0.length);
  while (pos + 8 <= end) {
    const type = be32(r0, pos);
    const size = be32(r0, pos + 4);
    if (size < 8 || pos + size > end) break;
    const body = r0.subarray(pos + 8, pos + size);
    switch (type) {
      case 100:
        data.author ??= new TextDecoder("utf-8").decode(body);
        break;
      case 103:
        data.description ??= new TextDecoder("utf-8").decode(body);
        break;
      case 503:
        data.title ??= new TextDecoder("utf-8").decode(body);
        break;
      case 201:
        data.coverOffset = be32(body, 0);
        break;
      case 202:
        data.thumbnailOffset = be32(body, 0);
        break;
    }
    pos += size;
  }
  return data;
}

function isImageRecord(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  if ((b[0] ?? 0) === 0xff && (b[1] ?? 0) === 0xd8) return true; // JPEG
  if ((b[0] ?? 0) === 0x89 && (b[1] ?? 0) === 0x50) return true; // PNG
  if ((b[0] ?? 0) === 0x47 && (b[1] ?? 0) === 0x49 && (b[2] ?? 0) === 0x46) return true; // GIF
  return false;
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function parseMobi(file: File): Promise<ParsedBook> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.length < 80 || readAscii(buf, 60, 4) !== "BOOK" || readAscii(buf, 64, 4) !== "MOBI") {
    throw new ImportError("不是有效的 MOBI 文件");
  }

  const numRecords = be16(buf, 76);
  if (numRecords < 2) throw new ImportError("MOBI 文件内容为空");
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) offsets.push(be32(buf, 78 + i * 8));
  const record = (index: number): Uint8Array =>
    buf.subarray(
      offsets[index],
      index + 1 < numRecords ? offsets[index + 1] : buf.byteLength,
    );

  const r0 = record(0);
  const compression = be16(r0, 0);
  const textRecordCount = be16(r0, 8);
  const encryption = be16(r0, 12);
  const hasMobiHeader = readAscii(r0, 16, 4) === "MOBI";
  const headerLength = hasMobiHeader ? be32(r0, 20) : 0;
  const encoding = hasMobiHeader ? be32(r0, 28) : 65001;
  const trailingFlags = headerLength >= 0xe4 ? be32(r0, 240) : 0;
  const exthFlag = hasMobiHeader ? be32(r0, 128) : 0;
  const resourceStart = hasMobiHeader ? be32(r0, 108) : numRecords;
  const titleOffset = hasMobiHeader ? be32(r0, 84) : 0;
  const titleLength = hasMobiHeader ? be32(r0, 88) : 0;

  if (encryption !== 0) {
    throw new ImportError("这本 MOBI 已加密（DRM），无法导入");
  }
  if (compression === 17480) {
    throw new ImportError("该 MOBI 使用 HUFF/CDIC 压缩，暂不支持，请转换为 EPUB 或 TXT 后重试");
  }
  if (compression !== 1 && compression !== 2) {
    throw new ImportError(`不支持的 MOBI 压缩类型（${compression}）`);
  }
  if (textRecordCount === 0) {
    throw new ImportError("该文件不包含 MOBI7 正文（可能是纯 AZW3/KF8），请转换为 EPUB 或 TXT 后重试");
  }

  const exth = exthFlag & 0x40 ? parseExth(r0, headerLength) : null;

  // ---- 解压全文（流式解码，跨记录的多字节字符由分块边界自动衔接） ----
  const decompress =
    compression === 1
      ? (data: Uint8Array) => data
      : decompressPalmDoc;
  let text: string;
  try {
    const streamDecoder = new TextDecoder(encoding === 1252 ? "windows-1252" : "utf-8");
    const parts: string[] = [];
    for (let i = 0; i < textRecordCount; i++) {
      const raw = removeTrailingEntries(record(1 + i), trailingFlags);
      parts.push(streamDecoder.decode(decompress(raw), { stream: true }));
    }
    parts.push(streamDecoder.decode());
    text = parts.join("");
  } catch {
    throw new ImportError("MOBI 正文解压失败，文件可能已损坏");
  }

  // 编码错乱（多半是撞上 AZW3/KF8 混排）就直接放弃，给出可行动的提示
  const sample = text.slice(0, 2000);
  const replacements = (sample.match(/\ufffd/g) ?? []).length;
  if (replacements > sample.length * 0.05 || !sample.includes("<")) {
    throw new ImportError("无法识别该 MOBI 的正文格式（可能是 AZW3/KF8），请转换为 EPUB 或 TXT 后重试");
  }

  // ---- 元数据 ----
  const fullName =
    titleLength > 0 && titleOffset + titleLength <= r0.length
      ? new TextDecoder(encoding === 1252 ? "windows-1252" : "utf-8").decode(
          r0.subarray(titleOffset, titleOffset + titleLength),
        ).trim()
      : "";
  const title = exth?.title?.trim() || fullName || file.name.replace(/\.[^.]+$/, "") || "未命名书籍";
  const author = exth?.author?.trim() || "佚名";
  const description = exth?.description?.trim() || null;

  // ---- 封面：EXTH 201 记录号 → 资源区魔数扫描兜底 ----
  const tryCover = (index: number): string | null => {
    if (index < 0 || index >= numRecords) return null;
    const rec = record(index);
    if (!isImageRecord(rec)) return null;
    const mime = rec[0] === 0x89 ? "image/png" : rec[2] === 0x46 ? "image/gif" : "image/jpeg";
    return bytesToDataUri(rec, mime);
  };
  let coverData: string | null = null;
  const coverIndex =
    exth?.coverOffset !== undefined
      ? resourceStart + exth.coverOffset
      : exth?.thumbnailOffset !== undefined
        ? resourceStart + exth.thumbnailOffset
        : -1;
  coverData = tryCover(coverIndex);
  if (!coverData) {
    for (let i = resourceStart; i < numRecords; i++) {
      const uri = tryCover(i);
      if (uri) {
        coverData = uri;
        break;
      }
    }
  }
  // 封面过大就放弃（后端单行存储，不缩放）
  if (coverData && coverData.length > 900_000) coverData = null;

  // ---- 章节切分：先按 <mbp:pagebreak> 把巨型 HTML 切成小节，再逐节抽段落 ----
  // 整本 10MB+ 的 HTML 一次性丢进 DOMParser 会被截断/卡死，必须分块
  const paragraphs: string[] = [];
  for (const section of text.split(/<\s*(?:mbp:)?pagebreak[^>]*>/i)) {
    if (!section.trim()) continue;
    if (paragraphs.length > 0) paragraphs.push(PAGEBREAK);
    paragraphs.push(...extractFromHtml(section, () => undefined).paragraphs);
  }
  const chapters = splitParagraphsIntoChapters(paragraphs, "正文");
  if (chapters.length === 0) throw new ImportError("MOBI 里没有抽到任何正文");

  return { title, author, description, coverData, format: "mobi", chapters };
}
