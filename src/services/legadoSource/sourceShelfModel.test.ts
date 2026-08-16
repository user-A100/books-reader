import {
  createSourceShelfBook,
  sourceShelfBookMatches,
} from "./sourceShelfModel";
import { LegadoBookSource } from "./legadoSourceModel";

const source: LegadoBookSource = {
  bookSourceUrl: "https://example.com",
  bookSourceName: "Example",
  ruleSearch: {},
};

describe("source shelf model", () => {
  test("creates a shelf record without downloading chapter content", () => {
    const record = createSourceShelfBook(
      source,
      { bookUrl: "/book/1", name: "Book" },
      [{ title: "Chapter 1", url: "/chapter/1" }]
    );

    expect(record.sourceUrl).toBe(source.bookSourceUrl);
    expect(record.chapters).toHaveLength(1);
    expect(record.cachedChapterIndexes).toEqual([]);
    expect(record.progress.chapterIndex).toBe(0);
  });

  test("deduplicates by source and book url", () => {
    const record = createSourceShelfBook(
      source,
      { bookUrl: "/book/1", name: "Book" },
      []
    );

    expect(sourceShelfBookMatches(record, source.bookSourceUrl, "/book/1")).toBe(true);
    expect(sourceShelfBookMatches(record, "https://other.test", "/book/1")).toBe(false);
  });
});
