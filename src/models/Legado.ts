export type LegadoServerType = "android" | "reader";

export interface LegadoServerConfig {
  id: string;
  name: string;
  baseUrl: string;
  serverType: LegadoServerType;
  accessToken: string;
}

export interface LegadoBook {
  bookUrl: string;
  name: string;
  author: string;
  coverUrl: string;
  intro: string;
  origin: string;
  originName: string;
  latestChapterTitle: string;
  durChapterIndex: number;
  durChapterPos: number;
  durChapterTime: number;
  durChapterTitle: string;
}

export interface LegadoChapter {
  index: number;
  title: string;
  url: string;
}

export interface LegadoProgress {
  chapterIndex: number;
  chapterPos: number;
  chapterTitle: string;
  updateTime: number;
}
