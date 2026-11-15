/**
 * EPUB 解析。
 *
 * EPUB 就是 zip + XHTML：JSZip 解包 → container.xml 找 OPF →
 * manifest/spine 得到阅读顺序 → NCX/EPUB3 nav 取章题 → 逐文档抽段落。
 *
 * 图片两遍处理：第一遍统计每张图被多少个文档引用——像 EasyPub 插图版
 * 那种「每章塞一张水印图」的装饰图（被上百章引用）直接跳过；
 * 第二遍把真插图读出来转成 data URI 段落，封面单独缩放。
 */

import JSZip from "jszip";

import { splitParagraphsIntoChapters } from "./chapters";
import { dirname, extractFromHtml, resolvePath } from "./html";
import { ImportError, type ParsedBook, type ParsedChapter } from "./types";

/** 被这么多文档引用的图视为装饰图（水印/分栏花纹），不入库 */
const DECORATIVE_DOC_THRESHOLD = 8;

/** 封面回退时的体积上限，超过就放弃封面 */
const MAX_COVER_BYTES = 500_000;

function mimeFor(path: string, declared?: string): string {
  if (declared && declared.startsWith("image/")) return declared;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 封面缩放到 400px 宽的 JPEG；canvas 不可用（如测试环境）时退回原图 */
async function makeCoverData(bytes: Uint8Array, mime: string): Promise<string | null> {
  const raw = bytesToDataUri(bytes, mime);
  try {
    const blob = await (await fetch(raw)).blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 400 / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 不可用");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.82);
    } finally {
      bitmap.close?.();
    }
  } catch {
    return bytes.length <= MAX_COVER_BYTES ? raw : null;
  }
}

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new ImportError("EPUB 文件已损坏，无法解包");
  }

  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container ? /full-path="([^"]+)"/.exec(container)?.[1] : null;
  if (!opfPath) throw new ImportError("EPUB 缺少 container.xml，无法定位内容");

  const opfText = await zip.file(opfPath)?.async("string");
  if (!opfText) throw new ImportError("EPUB 缺少 OPF 元数据文件");
  const opfDoc = new DOMParser().parseFromString(opfText, "application/xml");
  if (opfDoc.querySelector("parsererror")) {
    throw new ImportError("EPUB 的 OPF 元数据无法解析");
  }
  const opfDir = dirname(opfPath);

  // ---- 元数据 ----
  const pickElement = (localName: string): Element | null =>
    Array.from(opfDoc.getElementsByTagName("*")).find(
      (n) =>
        n.nodeName.toLowerCase().endsWith(localName) &&
        (n.textContent ?? "").trim().length > 0,
    ) ?? null;
  const title =
    pickElement("dc:title")?.textContent?.trim() ||
    pickElement("title")?.textContent?.trim() ||
    file.name.replace(/\.[^.]+$/, "");
  const author =
    pickElement("dc:creator")?.textContent?.trim() ||
    pickElement("creator")?.textContent?.trim() ||
    "佚名";
  const description =
    pickElement("dc:description")?.textContent?.trim() ||
    pickElement("description")?.textContent?.trim() ||
    null;

  // ---- manifest / spine ----
  const items = Array.from(opfDoc.getElementsByTagName("item")).map(
    (n): ManifestItem => ({
      href: n.getAttribute("href") ?? "",
      mediaType: n.getAttribute("media-type") ?? "",
      properties: n.getAttribute("properties") ?? "",
    }),
  );
  const itemById = new Map<string, ManifestItem>();
  for (const n of opfDoc.getElementsByTagName("item")) {
    const id = n.getAttribute("id");
    if (id) {
      itemById.set(id, {
        href: n.getAttribute("href") ?? "",
        mediaType: n.getAttribute("media-type") ?? "",
        properties: n.getAttribute("properties") ?? "",
      });
    }
  }
  const spine = Array.from(opfDoc.getElementsByTagName("itemref"))
    .map((n) => itemById.get(n.getAttribute("idref") ?? ""))
    .filter((v): v is ManifestItem => Boolean(v))
    .filter(
      (v) =>
        v.mediaType.includes("html") ||
        /\.(x?html)$/i.test(v.href),
    )
    .map((v) => resolvePath(opfDir, v.href));
  if (spine.length === 0) throw new ImportError("EPUB 没有可读的正文文档");

  // ---- 章题表：NCX 优先，EPUB3 nav 兜底 ----
  const labelByHref = new Map<string, string>();
  // NCX 的 <text> 里可能混着 <br/>、<b> 之类的内联标签，剥干净再做目录标题
  const cleanLabel = (label: string): string =>
    label
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  const ncxItem = items.find((m) => m.mediaType.includes("dtbncx"));
  if (ncxItem) {
    const ncxPath = resolvePath(opfDir, ncxItem.href);
    const ncxText = await zip.file(ncxPath)?.async("string");
    if (ncxText) {
      const ncx = new DOMParser().parseFromString(ncxText, "application/xml");
      if (!ncx.querySelector("parsererror")) {
        const ncxDir = dirname(ncxPath);
        for (const point of ncx.getElementsByTagName("navPoint")) {
          const label = cleanLabel(point.getElementsByTagName("text")[0]?.textContent ?? "");
          const src = point.getElementsByTagName("content")[0]?.getAttribute("src");
          if (label && src) labelByHref.set(resolvePath(ncxDir, src), label);
        }
      }
    }
  }
  if (labelByHref.size === 0) {
    const navItem = items.find((m) => m.properties.split(/\s+/).includes("nav"));
    if (navItem) {
      const navPath = resolvePath(opfDir, navItem.href);
      const navText = await zip.file(navPath)?.async("string");
      if (navText) {
        const nav = new DOMParser().parseFromString(navText, "text/html");
        const navDir = dirname(navPath);
        for (const a of nav.querySelectorAll("nav a[href]")) {
          const label = cleanLabel(a.textContent ?? "");
          const href = a.getAttribute("href");
          if (label && href) labelByHref.set(resolvePath(navDir, href), label);
        }
      }
    }
  }

  // ---- 第一遍：读全部文档 + 统计图片引用（判装饰图） ----
  const docs: { path: string; text: string }[] = [];
  const imageDocCount = new Map<string, Set<string>>();
  const imgSrcRe = /<img[^>]*\ssrc=["']([^"']+)["']/gi;
  for (const path of spine) {
    const text = (await zip.file(path)?.async("string")) ?? "";
    docs.push({ path, text });
    for (const m of text.matchAll(imgSrcRe)) {
      const target = resolvePath(dirname(path), m[1] ?? "");
      if (!target) continue;
      let set = imageDocCount.get(target);
      if (!set) imageDocCount.set(target, (set = new Set()));
      set.add(path);
    }
  }
  const decorative = new Set<string>();
  for (const [path, set] of imageDocCount) {
    if (set.size >= DECORATIVE_DOC_THRESHOLD) decorative.add(path);
  }

  // ---- 第二遍：抽段落，真插图转 data URI ----
  const imageCache = new Map<string, string>();
  const chapters: ParsedChapter[] = [];

  for (const doc of docs) {
    const docDir = dirname(doc.path);

    // 文档内引用的图片先全部读好，onImage 里同步查表
    const pendingImages = new Map<string, string>();
    for (const m of doc.text.matchAll(imgSrcRe)) {
      const target = resolvePath(docDir, m[1] ?? "");
      if (!target || decorative.has(target) || pendingImages.has(target)) continue;
      const cached = imageCache.get(target);
      if (cached) {
        pendingImages.set(target, cached);
        continue;
      }
      const bytes = await zip.file(target)?.async("uint8array");
      if (!bytes) continue;
      const uri = bytesToDataUri(bytes, mimeFor(target));
      imageCache.set(target, uri);
      pendingImages.set(target, uri);
    }

    const { paragraphs } = extractFromHtml(doc.text, (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src) return;
      // 显示宽度很小的图（width="140" 这类）当作装饰跳过
      const width = Number(img.getAttribute("width") ?? 0);
      if (width > 0 && width <= 200) return;
      return pendingImages.get(resolvePath(docDir, src));
    });

    const docLabel =
      labelByHref.get(doc.path) ?? undefined;
    for (const chapter of splitParagraphsIntoChapters(paragraphs, docLabel ?? "正文")) {
      chapters.push(chapter);
    }
  }

  if (chapters.length === 0) throw new ImportError("EPUB 里没有抽到任何正文");

  // ---- 封面：meta[name=cover] → properties="cover-image" → 文件名约定 ----
  const coverMeta = Array.from(opfDoc.getElementsByTagName("meta")).find(
    (n) => n.getAttribute("name") === "cover",
  )?.getAttribute("content");
  const coverItem =
    (coverMeta ? itemById.get(coverMeta) : undefined) ??
    items.find((m) => m.properties.split(/\s+/).includes("cover-image")) ??
    items.find((m) => m.mediaType.startsWith("image/") && /cover/i.test(m.href));

  let coverData: string | null = null;
  if (coverItem) {
    const coverPath = resolvePath(opfDir, coverItem.href);
    const bytes = await zip.file(coverPath)?.async("uint8array");
    if (bytes) {
      coverData = await makeCoverData(bytes, mimeFor(coverPath, coverItem.mediaType));
    }
  }

  return { title, author, description, coverData, format: "epub", chapters };
}
