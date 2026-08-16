import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  SourceShelfBook,
  SourceShelfProgress,
  createSourceShelfBook,
  sourceShelfBookMatches,
} from "./sourceShelfModel";
import { LegadoBookSource } from "./legadoSourceModel";
import { LegadoBook, LegadoChapter } from "./legadoEngineClient";
import { sourceChapterCache } from "./sourceChapterCache";

const SHELF_KEY = "plugin:legado-engine:online-shelf";
const MAX_BOOKS = 300;

const saveBooks = (books: SourceShelfBook[]): SourceShelfBook[] => {
  ConfigService.setReaderConfig(SHELF_KEY, JSON.stringify(books.slice(0, MAX_BOOKS)));
  return books;
};

export const getSourceShelfBooks = (): SourceShelfBook[] => {
  try {
    const raw = ConfigService.getReaderConfig(SHELF_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as SourceShelfBook[])
      .filter(
        (book) =>
          !!book?.id &&
          !!book?.sourceUrl &&
          !!book?.book?.bookUrl &&
          Array.isArray(book?.chapters)
      )
      .map((book) => ({
        ...book,
        chapterCursors: Array.isArray(book.chapterCursors)
          ? book.chapterCursors.filter(
              (item): item is string => typeof item === "string" && !!item.trim()
            )
          : [],
        cachedChapterIndexes: Array.isArray(book.cachedChapterIndexes)
          ? book.cachedChapterIndexes
          : [],
        progress: book.progress || {
          chapterIndex: 0,
          chapterTitle: book.chapters[0]?.title || "",
          chapterPos: 0,
          updatedAt: book.addedAt || Date.now(),
        },
      }));
  } catch {
    return [];
  }
};

export const addSourceShelfBook = (
  source: LegadoBookSource,
  book: LegadoBook,
  chapters: LegadoChapter[],
  chapterCursors: string[] = []
): SourceShelfBook => {
  const books = getSourceShelfBooks();
  const existing = books.find((item) =>
    sourceShelfBookMatches(item, source.bookSourceUrl, book.bookUrl || "")
  );
  if (existing) {
    const updated = {
      ...existing,
      source,
      sourceName: source.bookSourceName,
      book,
      chapters,
      chapterCursors,
    };
    saveBooks(books.map((item) => (item.id === existing.id ? updated : item)));
    return updated;
  }
  const record = createSourceShelfBook(source, book, chapters, chapterCursors);
  saveBooks([record, ...books]);
  return record;
};

export const updateSourceShelfChapters = (
  id: string,
  chapters: LegadoChapter[],
  chapterCursors: string[]
): SourceShelfBook | null => {
  let updated: SourceShelfBook | null = null;
  const books = getSourceShelfBooks().map((book) => {
    if (book.id !== id) return book;
    updated = { ...book, chapters, chapterCursors };
    return updated;
  });
  saveBooks(books);
  return updated;
};

export const updateSourceShelfProgress = (
  id: string,
  progress: SourceShelfProgress
): void => {
  saveBooks(
    getSourceShelfBooks().map((book) =>
      book.id === id ? { ...book, progress } : book
    )
  );
};

export const saveSourceChapterContent = async (
  bookId: string,
  chapterIndex: number,
  content: string
): Promise<void> => {
  await sourceChapterCache.write(bookId, chapterIndex, content);
};

export const markSourceChaptersCached = (
  bookId: string,
  chapterIndexes: number[]
): void => {
  const incoming = new Set(chapterIndexes);
  saveBooks(
    getSourceShelfBooks().map((book) =>
      book.id === bookId
        ? {
            ...book,
            cachedChapterIndexes: Array.from(
              new Set([...book.cachedChapterIndexes, ...incoming])
            ).sort((a, b) => a - b),
          }
        : book
    )
  );
};

export const getSourceChapterContent = async (
  bookId: string,
  chapterIndex: number
): Promise<string> => sourceChapterCache.read(bookId, chapterIndex);

export const removeSourceShelfBook = async (id: string): Promise<SourceShelfBook[]> => {
  const books = getSourceShelfBooks();
  await sourceChapterCache.deleteBook(id);
  return saveBooks(books.filter((book) => book.id !== id));
};
