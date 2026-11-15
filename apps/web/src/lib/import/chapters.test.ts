import { describe, expect, it } from "vitest";

import { PAGEBREAK, splitParagraphsIntoChapters } from "./chapters";

describe("splitParagraphsIntoChapters", () => {
  it("识别常规章标题并切章", () => {
    const chapters = splitParagraphsIntoChapters(
      ["第一章 绯红", "正文甲", "正文乙", "第1011章 牌局", "正文丙"],
      "正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ title: "第一章 绯红", paragraphs: ["正文甲", "正文乙"] });
    expect(chapters[1]).toMatchObject({ title: "第1011章 牌局", paragraphs: ["正文丙"] });
  });

  it("识别中文数字与分隔符变体", () => {
    const chapters = splitParagraphsIntoChapters(
      ["第九十九章：红烟囱", "甲", "第三节　内容", "乙"],
      "正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("第九十九章：红烟囱");
    expect(chapters[1]?.title).toBe("第三节　内容");
  });

  it("卷/部标题自成一章（分卷页）", () => {
    const chapters = splitParagraphsIntoChapters(
      ["【第一部 小丑】", "第一章 测试", "甲"],
      "正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("第一部 小丑");
    expect(chapters[0]?.paragraphs).toHaveLength(0);
    expect(chapters[1]).toMatchObject({ title: "第一章 测试", paragraphs: ["甲"] });
  });

  it("识别序章/楔子/番外等特殊标题，保留括号", () => {
    const chapters = splitParagraphsIntoChapters(
      ["序章", "这一天的清晨和往常一样。", "番外 那个角落（下）", "角落里的对话还在继续。"],
      "正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("序章");
    expect(chapters[1]?.title).toBe("番外 那个角落（下）");
  });

  it("不把正文语句误判为章标题", () => {
    const chapters = splitParagraphsIntoChapters(
      ["第一章 测试", "第三章已经发出来了，大家快去看。", "他骂了一句娘。", "第一章之外的故事"],
      "正文",
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.paragraphs).toHaveLength(3);
  });

  it("无标题时按固定大小切块兜底", () => {
    const paragraphs = Array.from({ length: 850 }, (_, i) => `第${i}段正文内容。`);
    const chapters = splitParagraphsIntoChapters(paragraphs, "正文");
    expect(chapters.length).toBe(3);
    expect(chapters[0]?.title).toBe("正文（第1部分）");
    expect(chapters[2]?.paragraphs).toHaveLength(50);
  });

  it("处理分页哨兵与空段落", () => {
    const chapters = splitParagraphsIntoChapters(
      ["", PAGEBREAK, "第一章 测试", "甲", PAGEBREAK, "第二章 继", "乙"],
      "正文",
    );
    expect(chapters).toHaveLength(2);
    expect(chapters.map((c) => c.title)).toEqual(["第一章 测试", "第二章 继"]);
  });

  it("超长章节按段落数再切块", () => {
    const paragraphs = [
      "第一章 长章",
      ...Array.from({ length: 1201 }, (_, i) => `段落${i}`),
    ];
    const chapters = splitParagraphsIntoChapters(paragraphs, "正文");
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("第一章 长章（第1部分）");
    expect(chapters[1]?.title).toBe("第一章 长章（第2部分）");
    expect(chapters[0]?.paragraphs).toHaveLength(1000);
    expect(chapters[1]?.paragraphs).toHaveLength(201);
  });
});
