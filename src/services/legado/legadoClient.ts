import {
  LegadoBook,
  LegadoChapter,
  LegadoProgress,
  LegadoServerConfig,
} from "../../models/Legado";

type Endpoint =
  | "getBookshelf"
  | "getChapterList"
  | "getBookContent"
  | "saveBookProgress";

interface RequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
}

const getIpcRenderer = () => {
  try {
    return (window as any).require?.("electron")?.ipcRenderer || null;
  } catch {
    return null;
  }
};

export const normalizeLegadoBaseUrl = (value: string): string => {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("服务器地址必须使用 HTTP 或 HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new Error("请不要把账号密码写在服务器地址中");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
};

export const buildLegadoRequestUrl = (
  config: LegadoServerConfig,
  endpoint: Endpoint,
  query: Record<string, string | number> = {}
): string => {
  const base = normalizeLegadoBaseUrl(config.baseUrl);
  const prefix =
    config.serverType === "reader" && !base.endsWith("/reader3")
      ? "/reader3"
      : "";
  const url = new URL(`${base}${prefix}/${endpoint}`);
  Object.entries(query).forEach(([key, value]) =>
    url.searchParams.set(key, String(value))
  );
  if (config.serverType === "reader" && config.accessToken.trim()) {
    url.searchParams.set("accessToken", config.accessToken.trim());
  }
  return url.toString();
};

export const getLegadoCoverUrl = (
  config: LegadoServerConfig,
  coverPath: string
): string => {
  if (!coverPath) return "";
  const base = normalizeLegadoBaseUrl(config.baseUrl);
  const prefix =
    config.serverType === "reader" && !base.endsWith("/reader3")
      ? "/reader3"
      : "";
  const url = new URL(`${base}${prefix}/cover`);
  url.searchParams.set("path", coverPath);
  if (config.serverType === "reader" && config.accessToken.trim()) {
    url.searchParams.set("accessToken", config.accessToken.trim());
  }
  return url.toString();
};

const unwrapResponse = (value: any): any => {
  if (!value || typeof value !== "object") return value;
  if (value.isSuccess === false) {
    throw new Error(value.errorMsg || "Legado 请求失败");
  }
  if (Object.prototype.hasOwnProperty.call(value, "data")) return value.data;
  return value;
};

const requestJson = async (
  config: LegadoServerConfig,
  endpoint: Endpoint,
  options: RequestOptions = {}
): Promise<any> => {
  const ipcRenderer = getIpcRenderer();
  if (ipcRenderer) {
    const response = await ipcRenderer.invoke("legado-request", {
      baseUrl: normalizeLegadoBaseUrl(config.baseUrl),
      serverType: config.serverType,
      accessToken: config.accessToken,
      endpoint,
      query: options.query,
      body: options.body,
    });
    if (!response?.ok) {
      throw new Error(response?.error || `HTTP ${response?.status || 500}`);
    }
    return unwrapResponse(response.data);
  }

  const method = endpoint === "saveBookProgress" ? "POST" : "GET";
  const response = await fetch(
    buildLegadoRequestUrl(config, endpoint, options.query),
    {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(options.body || {}) : undefined,
    }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return unwrapResponse(await response.json());
};

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

const number = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const toLegadoBook = (value: any): LegadoBook | null => {
  const bookUrl = text(value?.bookUrl || value?.url).trim();
  const name = text(value?.name || value?.bookName).trim();
  if (!bookUrl || !name) return null;
  return {
    bookUrl,
    name,
    author: text(value?.author).trim(),
    coverUrl: text(value?.customCoverUrl || value?.coverUrl).trim(),
    intro: text(value?.customIntro || value?.intro).trim(),
    origin: text(value?.origin || value?.bookSourceUrl).trim(),
    originName: text(value?.originName || value?.bookSourceName).trim(),
    latestChapterTitle: text(value?.latestChapterTitle).trim(),
    durChapterIndex: number(value?.durChapterIndex),
    durChapterPos: number(value?.durChapterPos),
    durChapterTime: number(value?.durChapterTime),
    durChapterTitle: text(value?.durChapterTitle).trim(),
  };
};

export const getLegadoBookshelf = async (
  config: LegadoServerConfig
): Promise<LegadoBook[]> => {
  const data = await requestJson(config, "getBookshelf");
  return (Array.isArray(data) ? data : [])
    .map(toLegadoBook)
    .filter((book): book is LegadoBook => !!book);
};

export const getLegadoChapters = async (
  config: LegadoServerConfig,
  book: LegadoBook
): Promise<LegadoChapter[]> => {
  const data = await requestJson(config, "getChapterList", {
    query: { url: book.bookUrl },
  });
  return (Array.isArray(data) ? data : []).map((chapter: any, index) => ({
    index: number(chapter?.index, index),
    title: text(chapter?.title || chapter?.name || `第 ${index + 1} 章`).trim(),
    url: text(chapter?.url).trim(),
  }));
};

export const getLegadoContent = async (
  config: LegadoServerConfig,
  book: LegadoBook,
  chapterIndex: number
): Promise<string> => {
  const data = await requestJson(config, "getBookContent", {
    query: { url: book.bookUrl, index: chapterIndex },
  });
  if (data && typeof data === "object" && "text" in data) {
    return text(data.text);
  }
  return text(data);
};

export const saveLegadoProgress = async (
  config: LegadoServerConfig,
  book: LegadoBook,
  progress: LegadoProgress
): Promise<void> => {
  const body =
    config.serverType === "reader"
      ? { url: book.bookUrl, index: progress.chapterIndex }
      : {
          name: book.name,
          author: book.author,
          durChapterIndex: progress.chapterIndex,
          durChapterPos: progress.chapterPos,
          durChapterTime: progress.updateTime,
          durChapterTitle: progress.chapterTitle,
        };
  await requestJson(config, "saveBookProgress", { body });
};
