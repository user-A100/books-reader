export interface WeReadSourceConfig {
  id: "weread";
  name: string;
  baseUrl: string;
  description?: string;
  enabled: boolean;
  vid: string;
  accessToken: string;
  userAgent: string;
}

export interface WeReadBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  description: string;
  category: string;
  detailUrl: string;
  totalWords: string;
  updateTime: string;
}

export interface WeReadSearchPage {
  books: WeReadBook[];
  total: number;
  nextPage: number;
}

export interface WeReadChapter {
  id: string;
  title: string;
  updateTime: string;
  isPaid: boolean;
  isVip: boolean;
}
