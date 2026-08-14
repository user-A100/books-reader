import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { LegadoCachedBook, LegadoChapter, LegadoProgress, LegadoServerConfig } from "../../models/Legado";

const CONFIG_KEY = "servers";
const CONFIG_NAMESPACE = "legado";
const PROGRESS_NAMESPACE = "legadoProgress";
const CONTENT_NAMESPACE = "legadoContent";
const CACHED_BOOKS_KEY = "cachedBooks";
const CACHED_BOOKS_NAMESPACE = "legadoCached";

export const getLegadoServers = (): LegadoServerConfig[] => {
  try {
    const value = ConfigService.getObjectConfig(
      CONFIG_KEY,
      CONFIG_NAMESPACE,
      null
    );
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

export const saveLegadoServers = (
  servers: LegadoServerConfig[]
): LegadoServerConfig[] => {
  ConfigService.setObjectConfig(CONFIG_KEY, servers, CONFIG_NAMESPACE);
  return servers;
};

const progressKey = (serverId: string, bookUrl: string): string =>
  `${serverId}:${bookUrl}`;

export const getLocalLegadoProgress = (
  serverId: string,
  bookUrl: string
): LegadoProgress | null => {
  try {
    return ConfigService.getObjectConfig(
      progressKey(serverId, bookUrl),
      PROGRESS_NAMESPACE,
      null
    ) as LegadoProgress | null;
  } catch {
    return null;
  }
};

export const saveLocalLegadoProgress = (
  serverId: string,
  bookUrl: string,
  progress: LegadoProgress
): void => {
  ConfigService.setObjectConfig(
    progressKey(serverId, bookUrl),
    progress,
    PROGRESS_NAMESPACE
  );
};

export const getCachedLegadoContent = (
  serverId: string,
  bookUrl: string,
  chapterIndex: number
): string => {
  try {
    return String(ConfigService.getObjectConfig(
      `${serverId}:${bookUrl}:${chapterIndex}`,
      CONTENT_NAMESPACE,
      ""
    ) || "");
  } catch {
    return "";
  }
};

export const saveCachedLegadoContent = (
  serverId: string,
  bookUrl: string,
  chapterIndex: number,
  content: string
): void => {
  ConfigService.setObjectConfig(
    `${serverId}:${bookUrl}:${chapterIndex}`,
    content,
    CONTENT_NAMESPACE
  );
};

// --- Offline cached-book library -------------------------------------
// Per-chapter content above is just text blobs keyed by index. To browse and
// read cached books without the phone connected we also need book-level
// metadata + the chapter list (TOC), stored as one index record per book.

export const getCachedLegadoBooks = (): LegadoCachedBook[] => {
  try {
    const value = ConfigService.getObjectConfig(
      CACHED_BOOKS_KEY,
      CACHED_BOOKS_NAMESPACE,
      null
    );
    return Array.isArray(value) ? (value as LegadoCachedBook[]) : [];
  } catch {
    return [];
  }
};

const sameBook = (book: { serverId: string; bookUrl: string }, serverId: string, bookUrl: string) =>
  book.serverId === serverId && book.bookUrl === bookUrl;

export const saveCachedLegadoBook = (record: LegadoCachedBook): LegadoCachedBook[] => {
  const books = getCachedLegadoBooks();
  const idx = books.findIndex((item) => sameBook(item, record.serverId, record.bookUrl));
  if (idx >= 0) books[idx] = record;
  else books.push(record);
  ConfigService.setObjectConfig(CACHED_BOOKS_KEY, books, CACHED_BOOKS_NAMESPACE);
  return books;
};

export const removeCachedLegadoBook = (serverId: string, bookUrl: string): LegadoCachedBook[] => {
  const books = getCachedLegadoBooks().filter((item) => !sameBook(item, serverId, bookUrl));
  ConfigService.setObjectConfig(CACHED_BOOKS_KEY, books, CACHED_BOOKS_NAMESPACE);
  return books;
};

// Returns the cached chapter list (TOC) for a book, or null if the book has
// never been cached.
export const getCachedLegadoChapters = (
  serverId: string,
  bookUrl: string
): LegadoChapter[] | null => {
  const books = getCachedLegadoBooks();
  const record = books.find((item) => sameBook(item, serverId, bookUrl));
  return record ? record.chapters : null;
};
