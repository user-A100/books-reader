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

// A Legado book whose metadata + chapter list + chapter contents have been
// cached locally, so it can be browsed and read without the phone connected.
export interface LegadoCachedBook extends LegadoBook {
  serverId: string;
  serverName: string;
  chapters: LegadoChapter[];
  cachedAt: number;
  cachedCount: number;
}

export interface LegadoProgress {
  chapterIndex: number;
  chapterPos: number;
  chapterTitle: string;
  updateTime: number;
}
