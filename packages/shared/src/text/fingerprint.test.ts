import { describe, expect, it } from "vitest";

import { contentHashHex, isSameParagraph, normalizeText, simhash64 } from "./fingerprint";

describe("normalizeText", () => {
  it("去掉书名号与空白", () => {
    expect(normalizeText("《斗破 苍穹》！")).toBe("斗破苍穹");
  });

  it("全角转半角并小写", () => {
    expect(normalizeText("ＡＢＣ－１２３")).toBe("abc123");
  });

  it("去掉作者名里的分隔符", () => {
    expect(normalizeText("天蚕土豆·")).toBe("天蚕土豆");
  });
});

describe("simhash", () => {
  it("空文本为 0", () => {
    expect(simhash64("")).toBe(0n);
    expect(contentHashHex("")).toBe("0000000000000000");
  });

  it("指纹固定 16 位十六进制", () => {
    expect(contentHashHex("第一章 陨落的天才")).toHaveLength(16);
  });

  it("格式化噪声不影响判定", () => {
    const a = "萧炎抬起头，望着远处的山峰，心中涌起一股说不清的滋味。";
    const b = "萧炎抬起头, 望着远处的山峰 , 心中涌起一股说不清的滋味。";
    expect(isSameParagraph(a, b)).toBe(true);
  });

  it("不同内容不会被误判为同一段", () => {
    expect(
      isSameParagraph("萧炎抬起头，望着远处的山峰。", "药老沉默了很久，才缓缓开口。"),
    ).toBe(false);
  });

  it("相同输入指纹稳定", () => {
    expect(contentHashHex("同一段文字")).toBe(contentHashHex("同一段文字"));
  });
});
