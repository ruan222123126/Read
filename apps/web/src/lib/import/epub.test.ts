// @vitest-environment happy-dom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parseEpub } from "./epub";

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试书名</dc:title>
    <dc:creator opf:role="aut">测试作者</dc:creator>
    <dc:description>测试简介内容</dc:description>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch0" href="Text/chapter0.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch0"/>
    <itemref idref="ch1"/>
  </spine>
</package>`;

const NCX = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n0"><navLabel><text>第一章 开端</text></navLabel><content src="Text/chapter0.xhtml"/></navPoint>
    <navPoint id="n1"><navLabel><text>第二章 发展</text></navLabel><content src="Text/chapter1.xhtml"/></navPoint>
  </navMap>
</ncx>`;

const CH0 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c0</title></head><body>
<h2>第一章 开端</h2>
<p class="a">&#x3000;&#x3000;正文第一段。</p>
<p><img src="../Images/deco.png" width="140"/></p>
<p><img src="../Images/real.png" width="800"/></p>
<p>正文第二段。</p>
</body></html>`;

const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title></head><body>
<h2>第二章 发展</h2>
<p>&#x3000;&#x3000;第二卷的内容。</p>
</body></html>`;

// 最小 JPEG / PNG 魔数占位
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

async function buildEpub(): Promise<File> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/content.opf", OPF);
  zip.file("OEBPS/toc.ncx", NCX);
  zip.file("OEBPS/Text/chapter0.xhtml", CH0);
  zip.file("OEBPS/Text/chapter1.xhtml", CH1);
  zip.file("OEBPS/Images/cover.jpg", FAKE_JPEG);
  zip.file("OEBPS/Images/deco.png", FAKE_PNG);
  zip.file("OEBPS/Images/real.png", FAKE_PNG);
  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new File([new Uint8Array(buffer)], "book.epub");
}

describe("parseEpub", () => {
  it("提取元数据、NCX 章题、段落与插图", async () => {
    const book = await parseEpub(await buildEpub());

    expect(book.title).toBe("测试书名");
    expect(book.author).toBe("测试作者");
    expect(book.description).toBe("测试简介内容");
    expect(book.format).toBe("epub");
    expect(book.coverData).toMatch(/^data:image\/jpeg;base64,/);

    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0]?.title).toBe("第一章 开端");
    // h2 标题成为章题段落；real.png 插在两段正文之间，deco.png 被跳过
    expect(book.chapters[0]?.paragraphs).toEqual([
      "正文第一段。",
      expect.stringMatching(/^data:image\/png;base64,/),
      "正文第二段。",
    ]);
    expect(book.chapters[1]?.title).toBe("第二章 发展");
    expect(book.chapters[1]?.paragraphs).toEqual(["第二卷的内容。"]);
  });

  it("小尺寸装饰图被跳过，大图转为 data URI 段落", async () => {
    const book = await parseEpub(await buildEpub());
    const paragraphs = book.chapters[0]?.paragraphs ?? [];
    expect(paragraphs.some((p: string) => p.startsWith("data:image/png"))).toBe(true);
    // 全书只有一个 data:image/png（real.png），deco.png 因 width<=200 被跳过
    const allImages = book.chapters.flatMap((c) => c.paragraphs).filter((p) => p.startsWith("data:image/"));
    expect(allImages).toHaveLength(1);
  });

  it("坏文件给出可读错误", async () => {
    const zip = new JSZip();
    const buffer = await zip.generateAsync({ type: "uint8array" });
    const bad = new File([new Uint8Array(buffer)], "broken.epub");
    await expect(parseEpub(bad)).rejects.toThrow("container.xml");
  });
});
