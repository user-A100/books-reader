import Note from "../../models/Note";
import { WeReadBookmark } from "../../models/WeRead";
import DatabaseService from "../../utils/storage/databaseService";

// WeRead highlight style int -> app color token. Mirrors the palette used by the
// in-reader highlight picker (popupNote/component.tsx).
const WEREAD_STYLE_COLORS: Record<number, string> = {
  0: "background-#FEF3CD",
  1: "background-#D4EDDA",
  2: "background-#D1ECF1",
  3: "background-#F8D7DA",
  4: "background-#E2D9F3",
};

export const mapWeReadStyleToColor = (
  style: number,
  colorStyle: number
): string => WEREAD_STYLE_COLORS[colorStyle] || WEREAD_STYLE_COLORS[style] || "background-#FEF3CD";

// Stable, idempotent primary key: survives repeated syncs so re-syncing skips
// already-imported bookmarks instead of duplicating them.
export const wereadNoteKey = (bookId: string, bookmarkId: string): string =>
  `weread-${bookId}-${bookmarkId}`;

// Derive a chapter index from bookmark order. WeRead gives chapterUid (an opaque
// chapter id), not a 0-based spine index; we map uids to sequential indices in
// first-seen order. Good enough for list grouping — chapterName is the primary
// label shown to the user.
export const buildChapterIndexMap = (
  bookmarks: WeReadBookmark[]
): Map<number, number> => {
  const map = new Map<number, number>();
  let nextIndex = 0;
  for (const bookmark of bookmarks) {
    if (!map.has(bookmark.chapterUid)) {
      map.set(bookmark.chapterUid, nextIndex);
      nextIndex++;
    }
  }
  return map;
};

const toDateStruct = (createTime: number) => {
  if (!createTime || createTime <= 0) return null;
  // WeRead timestamps may be seconds or milliseconds; normalize to ms.
  const ms = createTime > 1e12 ? createTime : createTime * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};

export const mapBookmarkToNote = (
  bookmark: WeReadBookmark,
  bookKey: string,
  chapterIndex: number,
  percentage: string
): Note => {
  const note = new Note(
    bookKey,
    bookmark.chapterName || "",
    chapterIndex,
    bookmark.text,
    // Serialized BookLocation carrying only chapter context — no real epubcfi,
    // since WeRead's char-offset ranges can't map back to one without a renderer.
    JSON.stringify({
      chapterTitle: bookmark.chapterName || "",
      chapterDocIndex: String(chapterIndex),
      chapterHref: "",
      percentage,
      cfi: "",
    }),
    "{}",
    bookmark.content || "",
    percentage,
    mapWeReadStyleToColor(bookmark.style, bookmark.colorStyle),
    ["weread"]
  );
  note.key = wereadNoteKey(bookmark.bookId, bookmark.bookmarkId);
  const date = toDateStruct(bookmark.createTime);
  if (date) note.date = date;
  return note;
};

export interface WeReadImportResult {
  imported: number;
  skipped: number;
}

// Idempotent bulk import: skips bookmarks already present (by stable key, with a
// text-dedup fallback for bookmarks whose id was synthesized). Never overwrites
// existing notes, so user edits in the local reader are preserved.
export const importWeReadBookmarks = async (
  bookId: string,
  bookKey: string,
  bookmarks: WeReadBookmark[]
): Promise<WeReadImportResult> => {
  if (!bookmarks.length) return { imported: 0, skipped: 0 };

  const chapterIndexMap = buildChapterIndexMap(bookmarks);
  const totalChapters = Math.max(1, chapterIndexMap.size);

  const existing: any[] = await DatabaseService.getRecordsByBookKey(
    bookKey,
    "notes"
  );
  const existingKeys = new Set(existing.map((note) => String(note.key)));
  const existingTexts = new Set(
    existing.map((note) => String(note.text || "")).filter(Boolean)
  );

  const toInsert: Note[] = [];
  let skipped = 0;
  for (const bookmark of bookmarks) {
    const key = wereadNoteKey(bookId, bookmark.bookmarkId);
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    if (bookmark.text && existingTexts.has(bookmark.text)) {
      skipped++;
      continue;
    }
    const chapterIndex = chapterIndexMap.get(bookmark.chapterUid) ?? 0;
    const percentage =
      bookmark.chapterUid > 0
        ? String(Math.round((chapterIndex / totalChapters) * 100))
        : "0";
    toInsert.push(mapBookmarkToNote(bookmark, bookKey, chapterIndex, percentage));
    existingKeys.add(key);
    if (bookmark.text) existingTexts.add(bookmark.text);
  }

  if (toInsert.length) {
    await DatabaseService.saveAllRecords(toInsert, "notes");
  }
  return { imported: toInsert.length, skipped };
};
