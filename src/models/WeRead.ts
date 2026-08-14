export interface WeReadSourceConfig {
  id: "weread";
  name: string;
  baseUrl: string;
  description?: string;
  enabled: boolean;
  vid: string;
  accessToken: string;
  userAgent: string;
  loginMode?: "qr" | "manual";
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

export interface WeReadShelfItem {
  bookId: string;
  bookKey: string;
  title: string;
  author: string;
  coverUrl: string;
  category: string;
  progress: number;
  readingTime: number;
  syncedAt: number;
}

export interface WeReadBookmark {
  bookmarkId: string;
  bookId: string;
  chapterUid: number;
  chapterName: string;
  text: string;
  content: string;
  style: number;
  colorStyle: number;
  createTime: number;
}

export interface WeReadNotebook {
  bookId: string;
  noteCount: number;
  readingTime: number;
}

export interface WeReadSyncResult {
  shelfCount: number;
  bookmarkCount: number;
  notebookCount: number;
  importedNotes: number;
  skippedNotes: number;
  errors: string[];
  syncedAt: number;
}
