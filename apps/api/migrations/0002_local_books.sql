-- 上传书籍（本地导入）的书库表。
-- 与书源书的差异：正文解析后直接入库，目录即章节表本身，
-- 不需要 book_source_mappings，也不占用 canonical_books 的 canonical_key 唯一键
-- （同一本书允许上传多个不同版本，用文件内容的 text_hash 做幂等去重）。

-- ---------- 上传的书 ----------
CREATE TABLE IF NOT EXISTS local_books (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT NOT NULL,
    author        TEXT NOT NULL DEFAULT '佚名',
    description   TEXT,
    -- 封面 data URI（前端已缩放到 ~400px），远端 URL 同样可存
    cover_url     TEXT,
    -- 来源格式：epub | mobi | txt
    format        TEXT NOT NULL DEFAULT 'txt',
    chapter_count INTEGER NOT NULL DEFAULT 0,
    -- 全文规范化后的 SHA-256，重复上传同一本书时幂等返回
    text_hash     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS local_books_hash_uniq ON local_books (text_hash);
CREATE INDEX IF NOT EXISTS local_books_created_idx ON local_books (created_at DESC);

-- ---------- 上传书的章节 ----------
-- paragraphs 存 JSON 字符串数组；图片段落为 data:image/… 开头的 data URI。
CREATE TABLE IF NOT EXISTS local_chapters (
    id         BIGSERIAL PRIMARY KEY,
    book_id    UUID NOT NULL REFERENCES local_books(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    title      TEXT NOT NULL,
    paragraphs TEXT NOT NULL,
    UNIQUE (book_id, idx)
);

CREATE INDEX IF NOT EXISTS local_chapters_book_idx ON local_chapters (book_id, idx);
