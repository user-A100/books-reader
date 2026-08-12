import { WeReadBook, WeReadChapter, WeReadSearchPage } from "../../models/WeRead";
import { getWeReadConfig, hasWeReadCredentials } from "./weReadStorage";

const API_BASE = "https://i.weread.qq.com";
const PAGE_SIZE = 20;

const getIpcRenderer = () => {
  try {
    return (window as any).require?.("electron")?.ipcRenderer || null;
  } catch {
    return null;
  }
};

const requestJson = async (
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<any> => {
  const config = getWeReadConfig();
  if (!hasWeReadCredentials(config)) {
    throw new Error("请先填写微信读书的 vid、accessToken 和完整 User-Agent");
  }
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers = {
    vid: config.vid.trim(),
    accessToken: config.accessToken.trim(),
    "User-Agent": config.userAgent.trim(),
    baseapi: "36",
    appver: "10.2.1.10167607",
    basever: "10.2.1.10167607",
    osver: "16",
    channelId: "0",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const ipcRenderer = getIpcRenderer();
  if (ipcRenderer) {
    const response = await ipcRenderer.invoke("weread-request", {
      url,
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response?.ok) throw new Error(response?.error || `HTTP ${response?.status || 500}`);
    return response.data;
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

const stringValue = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const coverUrl = (value: unknown): string => {
  const url = stringValue(value).trim();
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://")) return `https://${url.slice(7)}`;
  return url;
};

const toBook = (value: any): WeReadBook | null => {
  const info = value?.bookInfo || value || {};
  const id = stringValue(info.bookId || info.bookID || info.id).trim();
  const title = stringValue(info.title || info.name).trim();
  if (!id || !title) return null;
  return {
    id,
    title,
    author: stringValue(info.author || info.authorName).trim(),
    coverUrl: coverUrl(info.cover),
    description: stringValue(info.intro || info.description).trim(),
    category: stringValue(info.category || info.kind).trim(),
    detailUrl: `${API_BASE}/book/info?bookId=${encodeURIComponent(id)}&teenmode=0`,
    totalWords: stringValue(info.totalWords || info.wordCount).trim(),
    updateTime: stringValue(info.updateTime).trim(),
  };
};

export const searchWeRead = async (
  keyword: string,
  page = 1
): Promise<WeReadSearchPage> => {
  const params = new URLSearchParams({
    count: String(PAGE_SIZE),
    type: "0",
    keyword,
    v: "2",
    scope: "17",
    maxIdx: String((page - 1) * PAGE_SIZE),
  });
  const result = await requestJson(`/store/search?${params.toString()}`);
  const books = (Array.isArray(result?.books) ? result.books : [])
    .map(toBook)
    .filter((book): book is WeReadBook => !!book);
  return {
    books,
    total: Number(result?.total || result?.totalCount || books.length) || books.length,
    nextPage: books.length === PAGE_SIZE ? page + 1 : 0,
  };
};

export const getWeReadBook = async (book: WeReadBook): Promise<WeReadBook> => {
  const result = await requestJson(`/book/info?bookId=${encodeURIComponent(book.id)}&teenmode=0`);
  const detail = toBook(result);
  return detail ? { ...book, ...detail, detailUrl: book.detailUrl } : book;
};

export const getWeReadChapters = async (book: WeReadBook): Promise<WeReadChapter[]> => {
  const result = await requestJson("/book/chapterInfos", {
    method: "POST",
    body: { bookIds: [book.id], synckeys: [0], teenmode: 0 },
  });
  const data = Array.isArray(result?.data) ? result.data[0] : null;
  const chapters = Array.isArray(data?.updated) ? data.updated : [];
  return chapters
    .map((chapter: any) => ({
      id: stringValue(chapter.chapterUid || chapter.chapterId || chapter.id),
      title: stringValue(chapter.title || chapter.name).trim(),
      updateTime: stringValue(chapter.updateTime),
      isPaid: Number(chapter.price || 0) > 0 || Number(chapter.paid || 0) > 0,
      isVip: Number(chapter.price || 0) > 0,
    }))
    .filter((chapter: WeReadChapter) => !!chapter.id && !!chapter.title);
};
