import Link from "next/link";

const features = [
  {
    title: "零延迟翻页",
    body: "章节预取进 IndexedDB，翻页不碰网络。断网、地铁、电梯里都能接着读。",
  },
  {
    title: "一键换源",
    body: "同一本书聚合多个书源，源挂了随时切换，书评与进度原地不动。",
  },
  {
    title: "跨书源段评",
    body: "段评锚定在内容指纹上，换个源排版不同，气泡依然挂在同一句话旁。",
  },
  {
    title: "出版级排版",
    body: "仿真分栏翻页、首字下沉、字体子集化、纸张噪点与色温过渡。",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-14 sm:px-10">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-[family-name:var(--font-kai)] text-3xl tracking-[0.2em] text-[var(--color-seal)]">
            拾页
          </span>
          <span className="text-xs tracking-[0.3em] text-[var(--color-ink-faint)] uppercase">
            Local-first Reader
          </span>
        </div>
        <nav className="flex gap-6 text-sm text-[var(--color-ink-soft)]">
          <Link href="/explore" className="transition-colors hover:text-[var(--color-seal)]">
            书城
          </Link>
          <Link href="/shelf" className="transition-colors hover:text-[var(--color-seal)]">
            书架
          </Link>
          <Link href="/sources" className="transition-colors hover:text-[var(--color-seal)]">
            书源
          </Link>
        </nav>
      </header>

      <section className="mt-20 max-w-2xl">
        <h1 className="font-[family-name:var(--font-serif-cn)] text-4xl leading-[1.35] font-semibold sm:text-5xl">
          把阅读体验
          <br />
          放回你自己的设备里。
        </h1>
        <p className="mt-7 text-[15px] leading-8 text-[var(--color-ink-soft)]">
          书籍元数据统一聚合，书源解析隔离在沙箱引擎里，正文与进度留在浏览器本地。
          于是翻页没有等待，换源不会丢评论，断网也能读完这一章。
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/explore"
            className="rounded-full bg-[var(--color-ink)] px-7 py-3 text-sm text-[var(--color-paper)] transition-transform hover:-translate-y-0.5"
          >
            去书城找书
          </Link>
          <Link
            href="/sources"
            className="rounded-full border border-[var(--color-paper-edge)] px-7 py-3 text-sm text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-ink-faint)]"
          >
            导入书源
          </Link>
        </div>
      </section>

      <section className="mt-24 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-paper-edge)] bg-[var(--color-paper-edge)] sm:grid-cols-2">
        {features.map((f) => (
          <article key={f.title} className="bg-[var(--color-paper)] p-7">
            <h2 className="font-[family-name:var(--font-serif-cn)] text-lg font-semibold">
              {f.title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--color-ink-soft)]">{f.body}</p>
          </article>
        ))}
      </section>

      <footer className="mt-auto pt-20 text-xs text-[var(--color-ink-faint)]">
        拾页 · Local-First 阅读端 · Rust 书源引擎
      </footer>
    </main>
  );
}
