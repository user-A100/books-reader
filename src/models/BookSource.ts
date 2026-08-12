export type BookSourceField = string;

export interface BookSourceRequest {
  url: string;
  method?: "GET";
  headers?: Record<string, string>;
}

export interface BookSourceSearchRule {
  request: BookSourceRequest;
  list: string;
  fields: {
    title: BookSourceField;
    author?: BookSourceField;
    cover?: BookSourceField;
    detailUrl: BookSourceField;
  };
}

export interface BookSourceDetailRule {
  fields: {
    title?: BookSourceField;
    author?: BookSourceField;
    cover?: BookSourceField;
    description?: BookSourceField;
    tocUrl: BookSourceField;
  };
}

export interface BookSourceTocRule {
  list: string;
  fields: {
    title: BookSourceField;
    url: BookSourceField;
  };
}

export interface BookSourceContentRule {
  body: string;
  remove?: string[];
}

export interface BookSource {
  id: string;
  schemaVersion: 1;
  name: string;
  baseUrl: string;
  allowedHosts?: string[];
  description?: string;
  enabled: boolean;
  search: BookSourceSearchRule;
  detail: BookSourceDetailRule;
  toc: BookSourceTocRule;
  content: BookSourceContentRule;
}

export interface SourceBookSummary {
  title: string;
  author: string;
  coverUrl: string;
  detailUrl: string;
}

export interface SourceBookDetail extends SourceBookSummary {
  description: string;
  tocUrl: string;
}

export interface SourceChapter {
  title: string;
  url: string;
}

export interface SourceChapterContent {
  title: string;
  url: string;
  html: string;
  text: string;
}
