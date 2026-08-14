import {
  WeReadBookmark,
  WeReadNotebook,
  WeReadShelfItem,
} from "../../models/WeRead";

const API_BASE_MOBILE = "https://i.weread.qq.com";
const API_BASE_WEB = "https://weread.qq.com";

const getIpcRenderer = () => {
  try {
    return (window as any).require?.("electron")?.ipcRenderer || null;
  } catch {
    return null;
  }
};

// All sync requests go through the main-process `weread-web-request` channel,
// which carries the partition session cookies (set after QR login) and enforces
// the endpoint allowlist. No credentials are handled in the renderer.
const requestWebJson = async (url: string): Promise<any> => {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) {
    throw new Error("同步仅支持桌面版，请在 Books 桌面端扫码登录后使用");
  }
  const response = await ipcRenderer.invoke("weread-web-request", { url });
  if (!response?.ok) {
    throw new Error(response?.error || `HTTP ${response?.status || 500}`);
  }
  const body = response.data;
  // WeRead answers unauthenticated/expired sessions with HTTP 200 plus an
  // error envelope (not a 401). Without this check the sync silently imports
  // nothing and the user sees a misleading "0 imported" success. Detect the
  // known signals so we surface a clear "please re-login" error instead.
  if (body && typeof body === "object") {
    if (body.success === false) {
      throw new Error(
        `微信读书未登录或会话已失效：${body.errorMessage || body.errMsg || "请重新扫码登录"}`
      );
    }
    const code = body.err ?? body.errCode ?? body.errorCode;
    if (typeof code === "number" && code !== 0) {
      throw new Error(
        `微信读书返回错误（${code}）：${body.errMsg || body.errorMessage || "请重新扫码登录"}`
      );
    }
  }
  return body;
};

export const getWeReadLoginStatus = async (): Promise<boolean> => {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke("weread-web-login-status");
    return !!result?.loggedIn;
  } catch {
    return false;
  }
};

const stringValue = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const numValue = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const coverUrl = (value: unknown): string => {
  const url = stringValue(value).trim();
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://")) return `https://${url.slice(7)}`;
  return url;
};

// Unwrap common WeRead response envelopes: { data: {...} } | { books: [...] } | [...]
const unwrap = (result: any): any =>
  result?.data && typeof result.data === "object" ? result.data : result;

const toShelfItem = (entry: any): WeReadShelfItem | null => {
  const info = entry?.bookInfo || entry?.book || entry || {};
  const bookId = stringValue(info.bookId || info.bookID || entry?.bookId).trim();
  const title = stringValue(info.title || info.name || entry?.title).trim();
  if (!bookId || !title) return null;
  let progress = numValue(entry?.progress ?? entry?.readPercent ?? entry?.percentage);
  if (progress > 0 && progress <= 1) progress = progress * 100;
  return {
    bookId,
    bookKey: `weread-${bookId}`,
    title,
    author: stringValue(info.author || info.authorName).trim(),
    coverUrl: coverUrl(info.cover || info.coverUrl),
    category: stringValue(info.category || info.kind || entry?.category).trim(),
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    readingTime: numValue(entry?.readSeconds ?? entry?.readingTime),
    syncedAt: 0,
  };
};

const extractShelfItems = (result: any): WeReadShelfItem[] => {
  const root = unwrap(result);
  const candidates: any[] = [];
  if (Array.isArray(root?.books)) candidates.push(...root.books);
  if (Array.isArray(root?.bookList)) candidates.push(...root.bookList);
  if (Array.isArray(root)) candidates.push(...root);
  return candidates
    .map(toShelfItem)
    .filter((item): item is WeReadShelfItem => !!item);
};

const extractBookIds = (result: any): string[] => {
  const root = unwrap(result);
  const ids = root?.bookIds || root?.ids || root;
  if (Array.isArray(ids)) {
    return ids
      .map((entry) =>
        stringValue(typeof entry === "object" ? entry?.bookId : entry).trim()
      )
      .filter((id) => !!id);
  }
  return [];
};

// Three-layer fallback: shelf/sync (richest) → web bookIds + per-book info → error.
export const getWeReadShelf = async (): Promise<WeReadShelfItem[]> => {
  try {
    const result = await requestWebJson(`${API_BASE_MOBILE}/shelf/sync`);
    const items = extractShelfItems(result);
    if (items.length) return items;
  } catch {
    // fall through to next layer
  }
  try {
    const idsResult = await requestWebJson(`${API_BASE_WEB}/web/shelf/bookIds`);
    const bookIds = extractBookIds(idsResult);
    if (bookIds.length) {
      const items: WeReadShelfItem[] = [];
      for (const bookId of bookIds) {
        try {
          const info = await requestWebJson(
            `${API_BASE_MOBILE}/book/info?bookId=${encodeURIComponent(bookId)}&teenmode=0`
          );
          const item = toShelfItem(info);
          if (item) items.push(item);
        } catch {
          // skip individual book failures, continue the rest
        }
      }
      if (items.length) return items;
    }
  } catch {
    // fall through
  }
  throw new Error("无法获取微信读书书架，请确认已登录后重试");
};

export const getWeReadNotebooks = async (): Promise<WeReadNotebook[]> => {
  const result = await requestWebJson(`${API_BASE_MOBILE}/user/notebooks`);
  const root = unwrap(result);
  const list = Array.isArray(root?.books)
    ? root.books
    : Array.isArray(root?.notebooks)
    ? root.notebooks
    : Array.isArray(root)
    ? root
    : [];
  return list
    .map((entry): WeReadNotebook | null => {
      const book = entry?.book || entry?.bookInfo || entry || {};
      const bookId = stringValue(book.bookId || book.bookID).trim();
      if (!bookId) return null;
      return {
        bookId,
        noteCount: numValue(
          entry?.noteCount ?? entry?.bookmarkCount ?? book.noteCount
        ),
        readingTime: numValue(entry?.readSeconds ?? entry?.readingTime),
      };
    })
    .filter((item): item is WeReadNotebook => !!item);
};

export const getWeReadBookmarks = async (
  bookId: string
): Promise<WeReadBookmark[]> => {
  const result = await requestWebJson(
    `${API_BASE_WEB}/web/book/bookmarklist?bookId=${encodeURIComponent(bookId)}&type=1`
  );
  const root = unwrap(result);
  const list = Array.isArray(root?.updated)
    ? root.updated
    : Array.isArray(root?.books)
    ? root.books
    : Array.isArray(root)
    ? root
    : [];
  return list
    .map((entry): WeReadBookmark | null => {
      const text = stringValue(
        entry?.markText || entry?.abstract || entry?.content
      ).trim();
      if (!text) return null;
      const rawId = stringValue(entry?.bookmarkId || entry?.id).trim();
      const bookmarkId =
        rawId || `${numValue(entry?.chapterUid)}-${numValue(entry?.createTime)}`;
      return {
        bookmarkId,
        bookId,
        chapterUid: numValue(entry?.chapterUid || entry?.chapterId),
        chapterName: stringValue(entry?.chapterName || entry?.title).trim(),
        text,
        content: stringValue(entry?.content).trim(),
        style: numValue(entry?.style),
        colorStyle: numValue(entry?.colorStyle),
        createTime: numValue(entry?.createTime || entry?.createTimeStamp),
      };
    })
    .filter((item): item is WeReadBookmark => !!item);
};
