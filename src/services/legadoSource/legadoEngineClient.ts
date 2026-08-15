import { pluginHost } from "../plugins/pluginHost";
import type { BookSourceEngine } from "../plugins/pluginTypes";

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

export const getLegadoEngine = (): BookSourceEngine | null =>
  pluginHost.getBookSourceEngine(LEGADO_PLUGIN_ID);

export const isLegadoEngineReady = (): boolean =>
  !!getLegadoEngine()?.search;

export const legadoSearch = async (
  source: unknown,
  keyword: string
): Promise<LegadoSearchItem[]> => {
  const engine = getLegadoEngine();
  if (!engine) throw new Error("legado-engine-not-ready");
  return (await engine.search(source, keyword)) as LegadoSearchItem[];
};

export const legadoGetBookInfo = async (
  source: unknown,
  book: LegadoSearchItem
): Promise<LegadoBook> => {
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
  const engine = getLegadoEngine();
  if (!engine?.getChapterList) throw new Error("legado-engine-not-ready");
  return (await engine.getChapterList(source, book)) as LegadoChapter[];
};

export const legadoGetChapterContent = async (
  source: unknown,
  book: LegadoBook,
  chapter: LegadoChapter
): Promise<string> => {
  const engine = getLegadoEngine();
  if (!engine?.getChapterContent) throw new Error("legado-engine-not-ready");
  const result = (await engine.getChapterContent(source, {
    ...chapter,
    url: chapter.url || "",
    book,
  })) as unknown;
  // The engine returns the chapter text; tolerate object wrappers.
  if (typeof result === "string") return result;
  if (result && typeof (result as { content?: unknown }).content === "string") {
    return (result as { content: string }).content;
  }
  return String(result ?? "");
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
