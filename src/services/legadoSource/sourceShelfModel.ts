import { LegadoBookSource } from "./legadoSourceModel";
import { LegadoBook, LegadoChapter } from "./legadoEngineClient";

export interface SourceShelfProgress {
  chapterIndex: number;
  chapterTitle: string;
  chapterPos: number;
  updatedAt: number;
}

export interface SourceShelfBook {
  id: string;
  sourceUrl: string;
  sourceName: string;
  source: LegadoBookSource;
  book: LegadoBook;
  chapters: LegadoChapter[];
  /** Remaining paginated directory URLs, loaded only when reading reaches them. */
  chapterCursors: string[];
  addedAt: number;
  cachedChapterIndexes: number[];
  progress: SourceShelfProgress;
}

export const sourceShelfBookMatches = (
  record: SourceShelfBook,
  sourceUrl: string,
  bookUrl: string
): boolean =>
  record.sourceUrl === sourceUrl && record.book.bookUrl === bookUrl;

export const createSourceShelfBook = (
  source: LegadoBookSource,
  book: LegadoBook,
  chapters: LegadoChapter[],
  chapterCursors: string[] = []
): SourceShelfBook => ({
  id: `source-book-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`,
  sourceUrl: source.bookSourceUrl,
  sourceName: source.bookSourceName,
  source,
  book,
  chapters,
  chapterCursors,
  addedAt: Date.now(),
  cachedChapterIndexes: [],
  progress: {
    chapterIndex: 0,
    chapterTitle: chapters[0]?.title || "",
    chapterPos: 0,
    updatedAt: Date.now(),
  },
});
