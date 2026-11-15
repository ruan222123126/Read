// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { decompressPalmDoc, getVarLenFromEnd, parseMobi, removeTrailingEntries } from "./mobi";

/**
 * 测试用 PalmDOC 压缩器：ASCII 直传，多字节/控制字符用 1-8 字节原始复制前缀。
 * 与真实 mobi 编码器的行为一致，足以驱动解压器。
 */
function compressPalmDoc(text: string): Uint8Array {
  const data = new TextEncoder().encode(text);
  const out: number[] = [];
  let run: number[] = [];
  const flushRun = () => {
    for (let i = 0; i < run.length; i += 8) {
      const chunk = run.slice(i, i + 8);
      out.push(chunk.length);
      out.push(...chunk);
    }
    run = [];
  };
  for (const byte of data) {
    if (byte === 0 || byte >= 0x80) {
      run.push(byte);
    } else {
      flushRun();
      out.push(byte);
    }
  }
  flushRun();
  return new Uint8Array(out);
}

const u16 = (v: number): number[] => [v >> 8, v & 0xff];
const u32 = (v: number): number[] => [
  (v >>> 24) & 0xff,
  (v >>> 16) & 0xff,
  (v >>> 8) & 0xff,
  v & 0xff,
];
const str = (s: string): number[] => Array.from(new TextEncoder().encode(s));

/** EXTH 记录：type + 总长 + 数据 */
function exthRecord(type: number, data: string | number): number[] {
  const body = typeof data === "number" ? u32(data) : str(data);
  return [...u32(type), ...u32(8 + body.length), ...body];
}

/**
 * 组装一个最小可解析的 MOBI7 文件：rec0 + 每章一条文本记录 + JPEG 封面。
 * 文本记录带 trailing entry（flags=0x02，无多字节重叠），走完整剥尾流程。
 */
function buildMobi(chapters: string[]): Uint8Array {
  const exthRecords = [
    ...exthRecord(100, "测试作者"),
    ...exthRecord(503, "测试书名"),
    ...exthRecord(201, 0), // 封面相对 resourceStart 偏移 0
  ];
  const exth = [...str("EXTH"), ...u32(12 + exthRecords.length), ...u32(3), ...exthRecords];

  const headerLength = 232;
  const mobiHeader = new Uint8Array(headerLength);
  mobiHeader.set(
    new Uint8Array([
      ...str("MOBI"),
      ...u32(headerLength),
      ...u32(2), // mobi type = MOBI7
      ...u32(65001), // encoding = utf-8
      ...u32(1), // uid
      ...u32(2), // version
    ]),
    0,
  );
  mobiHeader.set(u32(0), 84 - 16); // titleOffset = 0（无 fullname）
  mobiHeader.set(u32(0), 88 - 16); // titleLength = 0
  mobiHeader.set(u32(chapters.length + 1), 108 - 16); // resourceStart = 封面记录号
  mobiHeader.set(u32(0x40), 128 - 16); // EXTH flag
  mobiHeader.set(u32(0x02), 240 - 16); // trailing flags：1 个 trailing entry，无多字节

  const record0 = new Uint8Array([
    ...u16(2), // compression = PalmDOC
    ...u16(0), // unused
    ...u32(0), // textLength（占位）
    ...u16(chapters.length), // text record count
    ...u16(4096), // record size
    ...u16(0), // encryption
    ...u16(0),
    ...mobiHeader,
    ...exth,
  ]);

  // 文本记录：每章一条，尾部带 1 个 trailing entry（1 字节数据 + 2 字节 varint = 3）
  const textRecords = chapters.map((chapter) => {
    const compressed = compressPalmDoc(
      `<html><body><p>${chapter}</p><p>正文内容${chapter.slice(-2)}</p></body></html>`,
    );
    return new Uint8Array([...compressed, 0x00, 0x80, 0x03]);
  });
  const cover = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);

  const records = [record0, ...textRecords, cover];
  const numRecords = records.length;
  const recordListOffset = 78;
  let offset = recordListOffset + numRecords * 8;
  const offsets = records.map((r) => {
    const at = offset;
    offset += r.length;
    return at;
  });

  const lastOffset = offsets[numRecords - 1] ?? 0;
  const lastRecord = records[numRecords - 1] ?? new Uint8Array(0);
  const total = lastOffset + lastRecord.length;
  const file = new Uint8Array(total);
  file.set(str("TestBook").slice(0, 32), 0);
  file.set(str("BOOK"), 60);
  file.set(str("MOBI"), 64);
  file.set(u16(numRecords), 76);
  records.forEach((r, i) => {
    file.set(u32(offsets[i] ?? 0), recordListOffset + i * 8);
    file.set(r, offsets[i] ?? 0);
  });
  return file;
}

describe("decompressPalmDoc", () => {
  it("字面量、原始复制与空格+字符编码", () => {
    // 'h' = 0x68 字面量直传；0x03 + 3 字节原始复制（「中」）；0xe4 → 空格 + 'd'
    const compressed = new Uint8Array([0x68, 0x03, 0xe4, 0xb8, 0xad, 0xe4]);
    expect(new TextDecoder().decode(decompressPalmDoc(compressed))).toBe("h中 d");
  });

  it("长度-距离对回引", () => {
    // 输出 "abc" 后回引 distance=3 length=3：pair = (3<<3)|0 = 0x18
    const compressed = new Uint8Array([0x61, 0x62, 0x63, 0x80, 0x18]);
    expect(new TextDecoder().decode(decompressPalmDoc(compressed))).toBe("abcabc");
  });
});

describe("getVarLenFromEnd / removeTrailingEntries", () => {
  it("varint 从尾部读取：高位字节重新累计", () => {
    // 最后 4 字节 [0x69, 0x00, 0x80, 0x03]：0x80 处重置，累计得 3
    expect(getVarLenFromEnd(new Uint8Array([0x69, 0x00, 0x80, 0x03]))).toBe(3);
  });

  it("剥掉 trailing entry（flags=0x02）", () => {
    // 条目 = 1 字节数据 + 2 字节 varint（值 3 = 条目总长）
    const data = new Uint8Array([0x68, 0x69, 0x00, 0x80, 0x03]);
    expect(removeTrailingEntries(data, 0x02)).toEqual(new Uint8Array([0x68, 0x69]));
  });

  it("multibyte 标志（bit0）再按末字节低 2 位剥字节", () => {
    const data = new Uint8Array([0x68, 0x69, 0x00]);
    // 末字节 0x00：低 2 位 = 0 → 剥 1 字节
    expect(removeTrailingEntries(data, 0x01)).toEqual(new Uint8Array([0x68, 0x69]));
  });
});

describe("parseMobi", () => {
  it("解析合成 MOBI：元数据、封面、章节", async () => {
    const file = new File([new Uint8Array(buildMobi(["第一章 测试", "第二章 继续"]))], "book.mobi");
    const book = await parseMobi(file);

    expect(book.title).toBe("测试书名");
    expect(book.author).toBe("测试作者");
    expect(book.format).toBe("mobi");
    expect(book.coverData).toMatch(/^data:image\/jpeg;base64,/);
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.title).toBe("第一章 测试");
    expect(book.chapters[0]?.paragraphs).toEqual(["正文内容测试"]);
    expect(book.chapters[1]?.title).toBe("第二章 继续");
    expect(book.chapters[1]?.paragraphs).toEqual(["正文内容继续"]);
  });

  it("加密文件给出可读错误", async () => {
    const raw = buildMobi(["第一章 测试"]);
    // record0 紧跟记录表之后：78 + numRecords*8；records = rec0 + 文本 + 封面 = 3
    const rec0At = 78 + 3 * 8;
    raw[rec0At + 12] = 1; // encryption = 1
    const encrypted = new File([new Uint8Array(raw)], "book.mobi");
    await expect(parseMobi(encrypted)).rejects.toThrow("已加密");
  });

  it("非法魔数直接拒绝", async () => {
    const notMobi = new File([new Uint8Array(200)], "fake.mobi");
    await expect(parseMobi(notMobi)).rejects.toThrow("不是有效的 MOBI");
  });
});
