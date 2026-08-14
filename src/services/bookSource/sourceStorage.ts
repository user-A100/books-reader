import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  BookSource,
  SourceBookDetail,
  SourceBookSummary,
  SourceChapter,
  SourceChapterContent,
} from "../../models/BookSource";

const SOURCE_LIST_KEY = "bookSourceList";
const SOURCE_MAP_KEY = "bookSources";

export const getBookSources = (): BookSource[] => {
  const ids: string[] = ConfigService.getAllListConfig(SOURCE_LIST_KEY) || [];
  return ids
    .map((id) => ConfigService.getObjectConfig(id, SOURCE_MAP_KEY, null))
    .filter((source): source is BookSource => !!source);
};

export const saveBookSource = (source: BookSource): void => {
  ConfigService.setObjectConfig(source.id, source, SOURCE_MAP_KEY);
  ConfigService.setListConfig(source.id, SOURCE_LIST_KEY);
};

export const deleteBookSource = (id: string): void => {
  ConfigService.deleteListConfig(id, SOURCE_LIST_KEY);
  ConfigService.deleteObjectConfig(id, SOURCE_MAP_KEY);
  clearBookSourceCache(id);
};

export const setBookSourceEnabled = (id: string, enabled: boolean): void => {
  const source = ConfigService.getObjectConfig(
    id,
    SOURCE_MAP_KEY,
    null
  ) as BookSource | null;
  if (!source) return;
  saveBookSource({ ...source, enabled });
};

// Per-source snapshot of the last successful search + opened detail so the
// page is not blank every time it is reopened. Book sources are network-driven
// and fetch live on demand; without this the user loses their previous results
// the moment they leave the page. The cache is keyed by source id and capped
// to one snapshot per source.
const SOURCE_CACHE_MAP_KEY = "bookSourceCache";

export interface BookSourceCache {
  keyword: string;
  results: SourceBookSummary[];
  detail: SourceBookDetail | null;
  chapters: SourceChapter[];
  content: SourceChapterContent | null;
  cachedAt: number;
}

export const getBookSourceCache = (id: string): BookSourceCache | null => {
  return (
    (ConfigService.getObjectConfig(id, SOURCE_CACHE_MAP_KEY, null) as
      | BookSourceCache
      | null) || null
  );
};

export const saveBookSourceCache = (
  id: string,
  cache: Omit<BookSourceCache, "cachedAt">
): void => {
  ConfigService.setObjectConfig(
    id,
    { ...cache, cachedAt: Date.now() },
    SOURCE_CACHE_MAP_KEY
  );
};

export const clearBookSourceCache = (id: string): void => {
  ConfigService.deleteObjectConfig(id, SOURCE_CACHE_MAP_KEY);
};

