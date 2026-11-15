import type { Book, BookSourceInfo, HealthResponse } from "@read/shared";

export interface SearchItem {
  name: string;
  author: string;
  book_url: string;
  cover_url: string | null;
  intro: string | null;
  last_chapter: string | null;
  kind: string | null;
  source_id: string;
  source_name: string;
}

export interface SearchResponse {
  items: SearchItem[];
  searched_sources: number;
  failures: { source_id: string; source_name: string; reason: string }[];
}

export interface TocResponse {
  chapters: { title: string; url: string }[];
}

export interface ContentResponse {
  paragraphs: string[];
  hashes: string[];
}

export interface LocalBookItem {
  id: string;
  title: string;
  author: string;
  description: string | null;
  cover_url: string | null;
  format: string;
  chapter_count: number;
}

export interface UploadLocalBookInput {
  title: string;
  author: string;
  description?: string | null;
  cover_data?: string | null;
  format: string;
  text_hash: string;
  chapters: { title: string; paragraphs: string[] }[];
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/backend";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { code?: string; message?: string }
      | null;
    throw new ApiError(res.status, body?.code ?? "unknown", body?.message ?? res.statusText);
  }

  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  listBooks: (params: { q?: string; limit?: number; offset?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.offset) search.set("offset", String(params.offset));
    const qs = search.toString();
    return request<Book[]>(`/books${qs ? `?${qs}` : ""}`);
  },

  getBook: (id: string) => request<Book>(`/books/${id}`),

  createBook: (input: {
    title: string;
    author: string;
    description?: string;
    cover_url?: string;
  }) =>
    request<Book>("/books", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listSources: () => request<BookSourceInfo[]>("/sources"),

  importSources: (json: string) =>
    request<{ imported: number; skipped: number; source_ids: string[] }>("/sources/import", {
      method: "POST",
      body: JSON.stringify({ json }),
    }),

  /** 书源搜索：并发查所有可用书源 */
  search: (params: { q: string; sourceId?: string; page?: number }) => {
    const search = new URLSearchParams({ q: params.q });
    if (params.sourceId) search.set("source_id", params.sourceId);
    if (params.page) search.set("page", String(params.page));
    return request<SearchResponse>(`/explore/search?${search.toString()}`);
  },

  /** 抓目录 */
  toc: (params: { sourceId: string; bookUrl: string }) => {
    const search = new URLSearchParams({
      source_id: params.sourceId,
      book_url: params.bookUrl,
    });
    return request<TocResponse>(`/explore/toc?${search.toString()}`);
  },

  /** 抓正文（含段落指纹） */
  content: (params: { sourceId: string; chapterUrl: string }) => {
    const search = new URLSearchParams({
      source_id: params.sourceId,
      chapter_url: params.chapterUrl,
    });
    return request<ContentResponse>(`/explore/content?${search.toString()}`);
  },

  /** 上传解析好的整本书到书库；text_hash 重复时返回已有记录并带 duplicate 标记 */
  uploadLocalBook: (input: UploadLocalBookInput) =>
    request<LocalBookItem & { duplicate?: boolean }>("/local-books", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        author: input.author,
        description: input.description ?? undefined,
        cover_data: input.cover_data ?? undefined,
        format: input.format,
        text_hash: input.text_hash,
        chapters: input.chapters,
      }),
    }),

  /** 书库列表（上传的书） */
  listLocalBooks: () => request<LocalBookItem[]>("/local-books"),

  /** 上传书的目录 */
  localToc: (id: string) => request<TocResponse>(`/local-books/${id}/toc`),

  /** 上传书的正文 */
  localContent: (params: { bookId: string; url: string }) => {
    const search = new URLSearchParams({ url: params.url });
    return request<ContentResponse>(`/local-books/${params.bookId}/content?${search.toString()}`);
  },
};
