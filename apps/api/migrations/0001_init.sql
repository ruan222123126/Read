-- 初始 schema：书籍实体归一化 + 书源映射 + 书评/段评。
-- 设计要点：
--   1. canonical_books 用 canonical_key（归一化书名|归一化作者）唯一，保证多源聚合成一条。
--   2. book_source_mappings 承载「这本书在这个源下的 URL/健康度」，换源不丢书评。
--   3. chapter_paragraphs 存每段正文的 simhash，段评锚定用 hamming 距离匹配。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- 用户 ----------
CREATE TABLE IF NOT EXISTS users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 标准书籍实体 ----------
CREATE TABLE IF NOT EXISTS canonical_books (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT NOT NULL,
    author        TEXT NOT NULL,
    title_norm    TEXT NOT NULL,
    author_norm   TEXT NOT NULL,
    canonical_key TEXT NOT NULL,
    description   TEXT,
    cover_url     TEXT,
    source_count  INTEGER NOT NULL DEFAULT 0,
    rating        REAL,
    review_count  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_books_key_uniq ON canonical_books (canonical_key);
CREATE INDEX IF NOT EXISTS canonical_books_title_norm_idx ON canonical_books (title_norm);
CREATE INDEX IF NOT EXISTS canonical_books_author_norm_idx ON canonical_books (author_norm);

-- ---------- 书源 ----------
CREATE TABLE IF NOT EXISTS book_sources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    source_group TEXT,
    url          TEXT NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    weight       INTEGER NOT NULL DEFAULT 0,
    raw          JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_sources_url_name_uniq ON book_sources (url, name);

-- ---------- 书源映射（同一本书 × 多个源）----------
CREATE TABLE IF NOT EXISTS book_source_mappings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id          UUID NOT NULL REFERENCES canonical_books(id) ON DELETE CASCADE,
    source_id        UUID NOT NULL REFERENCES book_sources(id) ON DELETE CASCADE,
    book_url         TEXT NOT NULL,
    toc_url          TEXT,
    latest_chapter   TEXT,
    chapter_count    INTEGER,
    latency_ms       INTEGER,
    availability     TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (availability IN ('healthy','degraded','broken','unknown')),
    last_checked_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (book_id, source_id)
);

CREATE INDEX IF NOT EXISTS bsm_book_idx ON book_source_mappings (book_id);
CREATE INDEX IF NOT EXISTS bsm_availability_idx ON book_source_mappings (availability);

-- ---------- 章节正文（用于段评锚定）----------
CREATE TABLE IF NOT EXISTS chapter_paragraphs (
    id          BIGSERIAL PRIMARY KEY,
    book_id     UUID NOT NULL REFERENCES canonical_books(id) ON DELETE CASCADE,
    chapter_url TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    simhash     BIGINT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chapter_url, seq)
);

CREATE INDEX IF NOT EXISTS cp_book_idx ON chapter_paragraphs (book_id);
CREATE INDEX IF NOT EXISTS cp_simhash_idx ON chapter_paragraphs (simhash);

-- ---------- 书评 ----------
CREATE TABLE IF NOT EXISTS reviews (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id    UUID NOT NULL REFERENCES canonical_books(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body_md    TEXT NOT NULL,
    rating     SMALLINT CHECK (rating BETWEEN 1 AND 10),
    spoiler    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviews_book_idx ON reviews (book_id, created_at DESC);

-- ---------- 段评（锚定到 simhash）----------
CREATE TABLE IF NOT EXISTS paragraph_comments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id      UUID NOT NULL REFERENCES canonical_books(id) ON DELETE CASCADE,
    paragraph_id BIGINT REFERENCES chapter_paragraphs(id) ON DELETE SET NULL,
    simhash      BIGINT NOT NULL,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pc_anchor_idx ON paragraph_comments (book_id, simhash);
