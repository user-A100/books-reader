jest.mock("../../utils/storage/databaseService", () => ({
  __esModule: true,
  default: {
    getRecordsByBookKey: jest.fn(),
    saveAllRecords: jest.fn(),
  },
}));

import DatabaseService from "../../utils/storage/databaseService";
import { WeReadBookmark } from "../../models/WeRead";
import {
  buildChapterIndexMap,
  importWeReadBookmarks,
  mapBookmarkToNote,
  mapWeReadStyleToColor,
  wereadNoteKey,
} from "./wereadNoteImport";

const bookmark = (over: Partial<WeReadBookmark> = {}): WeReadBookmark => ({
  bookmarkId: "bm1",
  bookId: "330000001",
  chapterUid: 100,
  chapterName: "第一章",
  text: "被划线的文字",
  content: "",
  style: 0,
  colorStyle: 0,
  createTime: 0,
  ...over,
});

describe("mapWeReadStyleToColor", () => {
  it("maps known colorStyle ints to palette tokens", () => {
    expect(mapWeReadStyleToColor(99, 0)).toBe("background-#FEF3CD");
    expect(mapWeReadStyleToColor(99, 1)).toBe("background-#D4EDDA");
    expect(mapWeReadStyleToColor(99, 2)).toBe("background-#D1ECF1");
  });
  it("falls back to style when colorStyle is outside the palette", () => {
    expect(mapWeReadStyleToColor(3, 99)).toBe("background-#F8D7DA");
    expect(mapWeReadStyleToColor(4, 99)).toBe("background-#E2D9F3");
  });
  it("prefers colorStyle over style when set", () => {
    expect(mapWeReadStyleToColor(0, 3)).toBe("background-#F8D7DA");
  });
  it("falls back to default for unknown styles", () => {
    expect(mapWeReadStyleToColor(99, 88)).toBe("background-#FEF3CD");
  });
});

describe("wereadNoteKey", () => {
  it("is stable and namespaced", () => {
    expect(wereadNoteKey("330000001", "bm1")).toBe("weread-330000001-bm1");
  });
});

describe("buildChapterIndexMap", () => {
  it("assigns sequential indices in first-seen order", () => {
    const bms = [
      bookmark({ chapterUid: 300 }),
      bookmark({ chapterUid: 100 }),
      bookmark({ chapterUid: 300 }),
      bookmark({ chapterUid: 200 }),
    ];
    const map = buildChapterIndexMap(bms);
    expect(map.get(300)).toBe(0);
    expect(map.get(100)).toBe(1);
    expect(map.get(200)).toBe(2);
    expect(map.size).toBe(3);
  });
});

describe("mapBookmarkToNote", () => {
  it("treats empty content as a highlight (notes='')", () => {
    const note = mapBookmarkToNote(bookmark(), "weread-330000001", 0, "0");
    expect(note.text).toBe("被划线的文字");
    expect(note.notes).toBe("");
    expect(note.bookKey).toBe("weread-330000001");
    expect(note.key).toBe("weread-330000001-bm1");
    expect(note.range).toBe("{}");
    expect(note.tag).toEqual(["weread"]);
  });

  it("treats non-empty content as a thought (notes=content)", () => {
    const note = mapBookmarkToNote(
      bookmark({ content: "我的想法" }),
      "weread-330000001",
      0,
      "0"
    );
    expect(note.notes).toBe("我的想法");
  });

  it("stores chapter context in cfi as serialized JSON without a real cfi", () => {
    const note = mapBookmarkToNote(
      bookmark({ chapterName: "第二章", chapterUid: 2 }),
      "weread-x",
      1,
      "50"
    );
    const parsed = JSON.parse(note.cfi);
    expect(parsed.chapterTitle).toBe("第二章");
    expect(parsed.chapterDocIndex).toBe("1");
    expect(parsed.percentage).toBe("50");
    expect(parsed.cfi).toBe("");
  });

  it("overrides date from createTime in milliseconds", () => {
    const note = mapBookmarkToNote(
      bookmark({ createTime: 1700000000000 }),
      "weread-x",
      0,
      "0"
    );
    expect(note.date.year).toBe(2023);
  });

  it("overrides date from createTime in seconds", () => {
    const note = mapBookmarkToNote(
      bookmark({ createTime: 1700000000 }),
      "weread-x",
      0,
      "0"
    );
    expect(note.date.year).toBe(2023);
  });
});

describe("importWeReadBookmarks", () => {
  const mockedGet = DatabaseService.getRecordsByBookKey as jest.Mock;
  const mockedSave = DatabaseService.saveAllRecords as jest.Mock;

  beforeEach(() => {
    mockedGet.mockReset();
    mockedSave.mockReset();
  });

  it("imports all bookmarks when none exist", async () => {
    mockedGet.mockResolvedValue([]);
    const result = await importWeReadBookmarks("b1", "weread-b1", [
      bookmark({ bookmarkId: "1", text: "划线一" }),
      bookmark({ bookmarkId: "2", text: "划线二" }),
    ]);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave.mock.calls[0][0]).toHaveLength(2);
  });

  it("skips bookmarks whose stable key already exists (idempotent)", async () => {
    mockedGet.mockResolvedValue([{ key: "weread-b1-1", text: "" }]);
    const result = await importWeReadBookmarks("b1", "weread-b1", [
      bookmark({ bookmarkId: "1", text: "已存在的划线" }),
      bookmark({ bookmarkId: "2", text: "新划线" }),
    ]);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("skips bookmarks whose text already exists (dedup fallback)", async () => {
    mockedGet.mockResolvedValue([{ key: "other", text: "重复文本" }]);
    const result = await importWeReadBookmarks("b1", "weread-b1", [
      bookmark({ bookmarkId: "new", text: "重复文本" }),
    ]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("returns zeros for an empty list without touching the db", async () => {
    const result = await importWeReadBookmarks("b1", "weread-b1", []);
    expect(result.imported).toBe(0);
    expect(mockedSave).not.toHaveBeenCalled();
  });
});
