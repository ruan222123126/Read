/** 与后端 API 对齐的领域类型。 */

export interface Book {
  id: string;
  title: string;
  author: string;
  cover_url: string | null;
  description: string | null;
  source_count: number;
  rating: number | null;
  review_count: number;
}

export interface BookSourceInfo {
  id: string;
  name: string;
  group: string | null;
  url: string;
  enabled: boolean;
  weight: number;
}

export interface HealthResponse {
  status: string;
  version: string;
  database: string;
}
