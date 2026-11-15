/**
 * HTML → 段落流。
 *
 * epub 的 XHTML 与 mobi 解压出来的 HTML 共用这一套抽取逻辑：
 * - 块级元素（p、div、h1-h6、blockquote、li 等）是段落边界，内联标签直接拼进文本
 * - <br> 当空格合并（EasyPub/mobi 的章题形如「第一章<br>绯红」，合并后才能整行识别）
 * - <img> 通过回调决定去留，真插图转成 data URI 段落
 * - <mbp:pagebreak> 转成分页哨兵，交给分章逻辑
 */

import { PAGEBREAK } from "./chapters";

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "td",
  "th",
  "section",
  "article",
  "pre",
  "center",
  "table",
  "ul",
  "ol",
  "tr",
  "figure",
  "figcaption",
  "aside",
  "header",
  "footer",
]);

const STRIP_TAGS = new Set(["script", "style", "head", "guide", "reference", "svg"]);

/** 压缩空白；NBSP 当普通空格 */
function cleanText(s: string): string {
  return s
    .replace(/[\u00a0\u200b]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface HtmlWalkState {
  paragraphs: string[];
  /** 收集中的当前段落文本 */
  buffer: string;
  /** 遇到 <img> 时回调；返回一个字符串则作为独立段落插入（data URI），返回空则跳过 */
  onImage: (img: Element) => string | void;
}

function flush(state: HtmlWalkState) {
  const text = cleanText(state.buffer);
  state.buffer = "";
  if (text) state.paragraphs.push(text);
}

function walk(el: Element, state: HtmlWalkState) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      state.buffer += node.nodeValue ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const child = node as Element;
    const tag = child.tagName.toLowerCase();

    if (STRIP_TAGS.has(tag)) continue;
    if (tag === "br") {
      // 标题「第一章<br>绯红」要合并成一行，br 不切段落
      state.buffer += " ";
      continue;
    }
    if (tag === "img" || tag === "image") {
      flush(state);
      const replacement = state.onImage(child);
      if (replacement) state.paragraphs.push(replacement);
      continue;
    }
    if (/^(mbp:)?pagebreak$/.test(tag)) {
      flush(state);
      state.paragraphs.push(PAGEBREAK);
      continue;
    }

    if (BLOCK_TAGS.has(tag)) {
      flush(state);
      walk(child, state);
      flush(state);
    } else {
      walk(child, state);
    }
  }
}

export interface HtmlExtractResult {
  /** 抽出的段落（可能含 PAGEBREAK 哨兵与 data URI 图片段） */
  paragraphs: string[];
  /** 文档内第一个 h1-h4 的文本，作章题候选 */
  title: string | null;
}

/** 解析一段 HTML 并抽取段落；onImage 决定图片替换为何物 */
export function extractFromHtml(
  html: string,
  onImage: (img: Element) => string | void,
): HtmlExtractResult {
  const doc = new DOMParser().parseFromString(html, "text/html");

  let title: string | null = null;
  const heading = doc.querySelector("h1, h2, h3, h4");
  if (heading) {
    const text = cleanText(heading.textContent ?? "");
    if (text) title = text;
  }

  const state: HtmlWalkState = { paragraphs: [], buffer: "", onImage };
  if (doc.body) walk(doc.body, state);
  flush(state);

  return { paragraphs: state.paragraphs, title };
}

/** 相对路径解析（epub 内部 href 相对于所在目录） */
export function resolvePath(baseDir: string, href: string): string {
  const clean = href.split("#")[0];
  if (!clean) return "";
  const stack = baseDir.split("/").filter((part) => part !== "" && part !== ".");
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** zip 内路径所在目录（含尾斜杠，根目录为空串） */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}
