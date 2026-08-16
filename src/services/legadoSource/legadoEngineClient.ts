import { pluginHost } from "../plugins/pluginHost";
import type { BookSourceEngine } from "../plugins/pluginTypes";
import type { LegadoBookSource } from "./legadoSourceModel";
import { ensurePluginsStarted } from "../plugins/pluginStartup";

/**
 * Bridge from the bookSources page to the legado-engine plugin running in
 * its Web Worker. The page never talks to the engine directly — it goes
 * through the plugin host so allowlists, RPC timeouts and lifecycle stay
 * in one place.
 */

const LEGADO_PLUGIN_ID = "legado-engine";

export interface LegadoSearchItem {
  name: string;
  author?: string;
  kind?: string;
  coverUrl?: string;
  intro?: string;
  bookUrl: string;
  origin?: string;
  [key: string]: unknown;
}

export interface LegadoBook {
  name?: string;
  author?: string;
  intro?: string;
  coverUrl?: string;
  bookUrl?: string;
  tocUrl?: string;
  [key: string]: unknown;
}

export interface LegadoChapter {
  title?: string;
  url?: string;
  book?: unknown;
  [key: string]: unknown;
}

export interface LegadoChapterPage {
  chapters: LegadoChapter[];
  nextTocUrls: string[];
}

// Session-only cache: keeps online reading responsive without turning it into
// an implicit offline download. Oldest entries are evicted first.
const chapterContentMemory = new Map<string, string>();
const chapterContentPending = new Map<string, Promise<string>>();
const CHAPTER_MEMORY_LIMIT = 24;

const chapterMemoryKey = (
  source: unknown,
  book: LegadoBook,
  chapter: LegadoChapter
): string => {
  const sourceUrl =
    source && typeof source === "object"
      ? String((source as { bookSourceUrl?: unknown }).bookSourceUrl || "")
      : "";
  return `${sourceUrl}\n${String(book.bookUrl || "")}\n${String(
    chapter.url || ""
  )}`;
};

const rememberChapterContent = (key: string, content: string): void => {
  chapterContentMemory.delete(key);
  chapterContentMemory.set(key, content);
  while (chapterContentMemory.size > CHAPTER_MEMORY_LIMIT) {
    const oldest = chapterContentMemory.keys().next().value;
    if (typeof oldest !== "string") break;
    chapterContentMemory.delete(oldest);
  }
};

export interface LegadoSourceSearchResult {
  source: LegadoBookSource;
  book: LegadoSearchItem;
}

export interface LegadoMultiSearchResult {
  results: LegadoSourceSearchResult[];
  failedSources: { sourceName: string; message: string }[];
}

export interface LegadoMultiSearchProgress extends LegadoMultiSearchResult {
  completedSources: number;
  totalSources: number;
}

export const getLegadoEngine = (): BookSourceEngine | null =>
  pluginHost.getBookSourceEngine(LEGADO_PLUGIN_ID);

export const isLegadoEngineReady = (): boolean =>
  !!getLegadoEngine()?.search;

export const ensureLegadoEngineReady = async (): Promise<boolean> => {
  await ensurePluginsStarted();
  return isLegadoEngineReady();
};

export const legadoSearch = async (
  source: unknown,
  keyword: string
): Promise<LegadoSearchItem[]> => {
  await ensurePluginsStarted();
  const engine = getLegadoEngine();
  if (!engine) throw new Error("legado-engine-not-ready");
  return (await engine.search(source, keyword)) as LegadoSearchItem[];
};

/**
 * Searches enabled sources incrementally. The current engine worker owns one
 * mutable network allowlist, so v1 deliberately serializes sources for safety.
 * A future worker pool can raise concurrency without cross-source scope races.
 */
export const legadoSearchAll = async (
  sources: LegadoBookSource[],
  keyword: string,
  concurrency = 1,
  onProgress?: (progress: LegadoMultiSearchProgress) => void
): Promise<LegadoMultiSearchResult> => {
  const queue = sources.filter((source) => source.enabled !== false);
  const results: LegadoSourceSearchResult[] = [];
  const failedSources: { sourceName: string; message: string }[] = [];
  let cursor = 0;
  let completedSources = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const source = queue[cursor++];
      try {
        const books = await legadoSearch(source, keyword);
        books.forEach((book) => results.push({ source, book }));
      } catch (error) {
        failedSources.push({
          sourceName: source.bookSourceName,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        completedSources += 1;
        onProgress?.({
          results: [...results],
          failedSources: [...failedSources],
          completedSources,
          totalSources: queue.length,
        });
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), queue.length) },
      worker
    )
  );
  return { results, failedSources };
};

export const legadoGetBookInfo = async (
  source: unknown,
  book: LegadoSearchItem
): Promise<LegadoBook> => {
  await ensurePluginsStarted();
  const engine = getLegadoEngine();
  if (!engine?.getBookDetail) throw new Error("legado-engine-not-ready");
  return (await engine.getBookDetail(source, {
    bookUrl: book.bookUrl,
    name: book.name,
    author: book.author || "",
  })) as LegadoBook;
};

export const legadoGetChapterList = async (
  source: unknown,
  book: LegadoBook
): Promise<LegadoChapter[]> => {
  await ensurePluginsStarted();
  const engine = getLegadoEngine();
  if (!engine?.getChapterList) throw new Error("legado-engine-not-ready");
  return (await engine.getChapterList(source, book)) as LegadoChapter[];
};

/** Loads only one directory page so long books can open immediately. */
export const legadoGetChapterListPage = async (
  source: unknown,
  book: LegadoBook,
  cursor?: string
): Promise<LegadoChapterPage> => {
  await ensurePluginsStarted();
  const engine = getLegadoEngine();
  if (!engine?.getChapterListPage) {
    const chapters = await legadoGetChapterList(source, book);
    return { chapters, nextTocUrls: [] };
  }
  const result = await engine.getChapterListPage(source, book, cursor);
  return {
    chapters: Array.isArray(result?.chapters)
      ? (result.chapters as LegadoChapter[])
      : [],
    nextTocUrls: Array.isArray(result?.nextTocUrls)
      ? result.nextTocUrls.filter(
          (item): item is string => typeof item === "string" && !!item.trim()
        )
      : [],
  };
};

export const legadoGetChapterContent = async (
  source: unknown,
  book: LegadoBook,
  chapter: LegadoChapter,
  nextChapter?: LegadoChapter,
  chapterUrls?: string[]
): Promise<string> => {
  const memoryKey = chapterMemoryKey(source, book, chapter);
  const remembered = chapterContentMemory.get(memoryKey);
  if (remembered !== undefined) return remembered;
  const pending = chapterContentPending.get(memoryKey);
  if (pending) return pending;
  const request = (async () => {
    await ensurePluginsStarted();
    const engine = getLegadoEngine();
    if (!engine?.getChapterContent) throw new Error("legado-engine-not-ready");
    const result = (await engine.getChapterContent(source, {
      ...chapter,
      url: chapter.url || "",
      book,
      nextChapterUrl: nextChapter?.url || "",
      chapterUrls: Array.isArray(chapterUrls) ? chapterUrls : [],
    })) as unknown;
    // The engine returns the chapter text; tolerate object wrappers.
    let content: string;
    if (typeof result === "string") content = result;
    else if (
      result &&
      typeof (result as { content?: unknown }).content === "string"
    ) {
      content = (result as { content: string }).content;
    } else content = String(result ?? "");
    rememberChapterContent(memoryKey, content);
    return content;
  })();
  chapterContentPending.set(memoryKey, request);
  try {
    return await request;
  } finally {
    chapterContentPending.delete(memoryKey);
  }
};

export const preloadLegadoChapterContent = async (
  source: unknown,
  book: LegadoBook,
  chapter: LegadoChapter | undefined,
  nextChapter?: LegadoChapter,
  chapterUrls?: string[]
): Promise<void> => {
  if (!chapter?.url) return;
  try {
    await legadoGetChapterContent(
      source,
      book,
      chapter,
      nextChapter,
      chapterUrls
    );
  } catch {
    // Prefetch is opportunistic; the normal reader request still reports errors.
  }
};

/** Assembles fetched chapters into a single TXT document. */
export const assembleTxt = (
  bookTitle: string,
  author: string,
  chapters: { title: string; content: string }[]
): string => {
  const header = author ? `${bookTitle}\n作者：${author}\n\n` : `${bookTitle}\n\n`;
  const body = chapters
    .map((chapter) => `${chapter.title}\n\n${chapter.content.trim()}`)
    .join("\n\n\n");
  return header + body + "\n";
};
