import { describe, expect, it } from "vitest";

import { decodeText, extractTxtMeta, textToParagraphs } from "./txt";

function utf16leBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2 + 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[2 + i * 2] = code & 0xff;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

describe("decodeText", () => {
  it("UTF-16LE BOM", () => {
    const bytes = utf16leBytes("　　痛！");
    expect(decodeText(bytes)).toBe("　　痛！");
  });

  it("UTF-8 BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("诡秘之主")]);
    expect(decodeText(bytes)).toBe("诡秘之主");
  });

  it("GBK 无 BOM 回退", () => {
    // 诡秘之主 的 GBK 编码
    const bytes = new Uint8Array([0xb9, 0xee, 0xc3, 0xd8, 0xd6, 0xae, 0xd6, 0xf7]);
    expect(decodeText(bytes)).toBe("诡秘之主");
  });
});

describe("extractTxtMeta", () => {
  it("文首 书名/作者/内容简介", () => {
    const text = [
      "　",
      "　书名：诡秘之主",
      "　　作者：爱潜水的乌贼",
      "　　内容简介：",
      "　　蒸汽与机械的浪潮中，谁能触及非凡？",
    ].join("\n");
    const meta = extractTxtMeta(text, "任意.txt");
    expect(meta.title).toBe("诡秘之主");
    expect(meta.author).toBe("爱潜水的乌贼");
    expect(meta.description).toContain("蒸汽与机械");
  });

  it("文件名《X》作者：Y 兜底", () => {
    const meta = extractTxtMeta("正文第一行", "《诡秘之主》（精校版全本）作者：爱潜水的乌贼.txt");
    expect(meta.title).toBe("诡秘之主");
    expect(meta.author).toBe("爱潜水的乌贼");
  });
});

describe("textToParagraphs", () => {
  it("去全角缩进、丢空行", () => {
    const paragraphs = textToParagraphs("　　痛！\r\n\r\n　　好痛！\r\n");
    expect(paragraphs).toEqual(["痛！", "好痛！"]);
  });
});
