const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  dialog,
  powerSaveBlocker,
  nativeTheme: electronNativeTheme,
  protocol,
  screen,
  systemPreferences,
  net,
  session,
  globalShortcut,
} = require("electron");
const path = require("path");
const isDev = require("electron-is-dev");
const Store = require("electron-store");
const log = require("electron-log/main");
const os = require("os");
const { execFile } = require("child_process");
// Keep the existing local library available after the Books rebrand.
// The folder name is intentionally legacy-only and is not shown in the UI.
app.setPath("userData", path.join(app.getPath("appData"), "koodo-reader"));
const store = new Store();
const fs = require("fs");
const crypto = require("crypto");
const chokidar = require("chokidar");
const {
  TEXT_CHAPTER_EXTENSIONS,
  analyzeFolderBooks,
  buildFolderBookEpub,
} = require("./src/services/folderLibrary/folderBook");
const configDir = app.getPath("userData");
const dirPath = path.join(configDir, "uploads");
const packageJson = require("./package.json");
let mainWin;
let tray = null;
let isQuitting = false;
let readerWindow;
let readerWindowList = [];
let dictWindow;
let transWindow;
let linkWindow;
let mainView;
let webNavigatorView;
let webNavigatorOwner;
let webNavigatorFaviconUrl = "";
//multi tab
// let mainViewList = []
let readerWindowReadyToClose = false;
let dbConnection = {};
let syncUtilCache = {};
let pickerUtilCache = {};
let downloadRequest = null;
let folderLibraryWatcher = null;

const RESIZE_THROTTLE_MS = 300;
const ONLINE_LIBRARY_MAX_BYTES = 80 * 1024 * 1024;
const WEB_NAVIGATOR_BOOK_EXTENSIONS = new Set([
  ".epub",
  ".pdf",
  ".txt",
  ".mobi",
  ".azw3",
  ".azw",
  ".fb2",
  ".cbz",
  ".cbt",
  ".cbr",
  ".cb7",
]);
const FOLDER_LIBRARY_EXTENSIONS = new Set([
  ...WEB_NAVIGATOR_BOOK_EXTENSIONS,
  ".htm",
  ".html",
  ".xml",
  ".xhtml",
  ".mhtml",
  ".docx",
  ".md",
]);

const normalizeFolderLibraryRoot = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Please select a library folder");
  }
  const root = fs.realpathSync(path.resolve(value));
  if (!fs.statSync(root).isDirectory()) {
    throw new Error("The selected library path is not a folder");
  }
  return root;
};

const resolveFolderLibraryPath = (root, relativePath = "", allowMissing = false) => {
  const cleanRelative = String(relativePath || "").replace(/\\/g, "/");
  if (path.isAbsolute(cleanRelative) || cleanRelative.split("/").includes("..")) {
    throw new Error("Invalid library path");
  }
  const candidate = path.resolve(root, cleanRelative);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The path is outside the library");
  }
  if (!allowMissing && fs.existsSync(candidate)) {
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(root, realCandidate);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Symbolic links outside the library are not supported");
    }
    return realCandidate;
  }
  return candidate;
};

const toFolderLibraryEntry = (root, absolutePath, stats) => ({
  name: path.basename(absolutePath),
  path: path.relative(root, absolutePath).split(path.sep).join("/"),
  type: stats.isDirectory() ? "folder" : "file",
  size: stats.isFile() ? stats.size : 0,
  mtimeMs: stats.mtimeMs,
});

const scanFolderLibrary = async (root) => {
  const entries = [];
  const visit = async (directory) => {
    const children = await fs.promises.readdir(directory, { withFileTypes: true });
    children.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        const stats = await fs.promises.stat(absolutePath);
        entries.push(toFolderLibraryEntry(root, absolutePath, stats));
        await visit(absolutePath);
      } else if (
        child.isFile() &&
        FOLDER_LIBRARY_EXTENSIONS.has(path.extname(child.name).toLowerCase())
      ) {
        const stats = await fs.promises.stat(absolutePath);
        entries.push(toFolderLibraryEntry(root, absolutePath, stats));
      }
    }
  };
  await visit(root);
  const folderBooks = analyzeFolderBooks(entries);
  const folderBookMap = new Map(folderBooks.map((book) => [book.path, book]));
  entries.forEach((entry) => {
    if (entry.type === "folder" && folderBookMap.has(entry.path)) {
      entry.folderBook = folderBookMap.get(entry.path);
    }
  });
  return entries;
};

const composeFolderLibraryBook = async (root, relativeFolder) => {
  const folder = resolveFolderLibraryPath(root, relativeFolder);
  if (!(await fs.promises.stat(folder)).isDirectory()) {
    throw new Error("The selected chapter book is not a folder");
  }
  const entries = await scanFolderLibrary(root);
  const descriptor = analyzeFolderBooks(entries).find(
    (book) => book.path === String(relativeFolder || "").replace(/\\/g, "/")
  );
  if (!descriptor) throw new Error("This folder is not a supported chapter book");

  const chapters = [];
  const visit = async (directory) => {
    const children = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(absolutePath);
      } else if (
        child.isFile() &&
        TEXT_CHAPTER_EXTENSIONS.has(path.extname(child.name).toLowerCase()) &&
        !["readme.md", "readme.txt", "index.md", "index.txt"].includes(
          child.name.toLowerCase()
        )
      ) {
        chapters.push({
          path: path.relative(folder, absolutePath).split(path.sep).join("/"),
          content: await fs.promises.readFile(absolutePath, "utf8"),
        });
      }
    }
  };
  await visit(folder);
  if (chapters.length < 2) throw new Error("A chapter book needs at least two text chapters");

  const cacheDirectory = path.join(app.getPath("userData"), "folder-books");
  await fs.promises.mkdir(cacheDirectory, { recursive: true });
  const cacheKey = crypto
    .createHash("sha256")
    .update(`${root}\0${descriptor.path}`)
    .digest("hex");
  const target = path.join(cacheDirectory, `${cacheKey}.epub`);
  const temporary = `${target}.${process.pid}.tmp`;
  const epub = await buildFolderBookEpub(
    descriptor.title,
    chapters,
    `urn:koodo:folder-book:${cacheKey}`
  );
  await fs.promises.writeFile(temporary, epub);
  await fs.promises.rename(temporary, target);
  const stats = await fs.promises.stat(target);
  return {
    path: target,
    name: `${descriptor.title}.epub`,
    title: descriptor.title,
    chapterCount: chapters.length,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
};

const sanitizeFolderLibraryName = (value, markdown = false) => {
  let name = String(value || "").trim();
  if (markdown && !name.toLowerCase().endsWith(".md")) name += ".md";
  if (!name || name === "." || name === ".." || /[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    throw new Error("The name contains invalid characters");
  }
  return name;
};

const stopFolderLibraryWatcher = async () => {
  if (folderLibraryWatcher) await folderLibraryWatcher.close();
  folderLibraryWatcher = null;
};

const startFolderLibraryWatcher = async (root, sender) => {
  await stopFolderLibraryWatcher();
  folderLibraryWatcher = chokidar.watch(root, {
    ignoreInitial: true,
    atomic: true,
    alwaysStat: true,
    awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 150 },
  });
  const notify = (eventName, absolutePath, stats) => {
    if (!sender || sender.isDestroyed()) return;
    const extension = path.extname(absolutePath).toLowerCase();
    if (eventName.includes("Dir") || FOLDER_LIBRARY_EXTENSIONS.has(extension)) {
      sender.send("folder-library-changed", {
        event: eventName,
        path: path.relative(root, absolutePath).split(path.sep).join("/"),
        entry: stats ? toFolderLibraryEntry(root, absolutePath, stats) : null,
      });
    }
  };
  ["add", "change", "unlink", "addDir", "unlinkDir"].forEach((eventName) => {
    folderLibraryWatcher.on(eventName, (absolutePath, stats) =>
      notify(eventName, absolutePath, stats)
    );
  });
};

const assertFolderLibrarySender = (event) => {
  if (!mainWin || event.sender !== mainWin.webContents) {
    throw new Error("Invalid folder library request");
  }
};
const normalizeOnlineLibraryUrl = (value) => {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "www.gutenberg.org"
    ) {
      return null;
    }
    if (!parsed.pathname.startsWith("/ebooks/") && !parsed.pathname.startsWith("/cache/epub/")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeWeReadUrl = (value) => {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "i.weread.qq.com"
    ) {
      return null;
    }
    if (!parsed.pathname.startsWith("/store/") &&
        !parsed.pathname.startsWith("/book/")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

// Allowlist for the logged-in (QR-scan) web sync channel. These endpoints serve
// the user's own shelf, progress, and annotations, fetched with the partition
// session cookies — never chapter body, never paid/decrypted content.
const WEREAD_WEB_PATH_PREFIXES = [
  "/web/shelf",
  "/web/book/bookmarklist",
  "/web/book/info",
  "/shelf/sync",
  "/shelf/bookids",
  "/user/notebooks",
  "/book/info",
  "/book/chapterinfos",
];
const normalizeWeReadWebUrl = (value) => {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "weread.qq.com" && host !== "i.weread.qq.com") return null;
    if (parsed.username || parsed.password) return null;
    const path = parsed.pathname.toLowerCase();
    if (!WEREAD_WEB_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const LEGADO_JSON_ENDPOINTS = new Set([
  "getBookshelf",
  "getChapterList",
  "getBookContent",
  "saveBookProgress",
]);

const buildLegadoUrl = (value) => {
  if (!value || typeof value.baseUrl !== "string") return null;
  if (value.serverType !== "android" && value.serverType !== "reader") {
    return null;
  }
  if (!LEGADO_JSON_ENDPOINTS.has(value.endpoint)) return null;
  try {
    const base = new URL(value.baseUrl.trim());
    if (
      (base.protocol !== "http:" && base.protocol !== "https:") ||
      base.username ||
      base.password
    ) {
      return null;
    }
    base.search = "";
    base.hash = "";
    let pathname = base.pathname.replace(/\/+$/, "");
    if (value.serverType === "reader" && !pathname.endsWith("/reader3")) {
      pathname += "/reader3";
    }
    base.pathname = `${pathname}/${value.endpoint}`.replace(/\/+/g, "/");
    const query = value.query && typeof value.query === "object" ? value.query : {};
    ["url", "index"].forEach((name) => {
      if (query[name] !== undefined && String(query[name]).length <= 8192) {
        base.searchParams.set(name, String(query[name]));
      }
    });
    if (value.serverType === "reader" && typeof value.accessToken === "string") {
      const accessToken = value.accessToken.trim();
      if (accessToken && accessToken.length <= 4096) {
        base.searchParams.set("accessToken", accessToken);
      }
    }
    return base.toString();
  } catch {
    return null;
  }
};

const normalizeWebNavigatorUrl = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

// Second-level suffixes that need a third label to form a registrable domain
// (e.g. "example.co.uk" -> "example.co.uk", not "co.uk"). Keep the list small;
// it only affects the pop-up same-site check, not core navigation.
const WEB_NAVIGATOR_TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "com.au", "net.au", "org.au", "edu.au",
  "co.jp", "co.kr", "co.nz", "co.in", "co.id", "co.za",
  "com.br", "com.mx", "com.ar", "com.tw", "com.hk", "com.sg",
  "com.tr", "com.ua", "com.my", "com.ph", "com.vn",
]);

// Returns the registrable domain (eTLD+1) for a host, or "" on failure. Used
// only to decide whether a pop-up belongs to the site the user is browsing.
const getWebNavigatorRegistrableDomain = (host) => {
  if (typeof host !== "string" || !host) return "";
  const lower = host.toLowerCase();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(lower)) return lower; // IPv4 literal
  const labels = lower.split(".");
  if (labels.length <= 2) return lower;
  const lastTwo = labels.slice(-2).join(".");
  return WEB_NAVIGATOR_TWO_PART_TLDS.has(lastTwo)
    ? labels.slice(-3).join(".")
    : lastTwo;
};

// True when target and base are both https and share the same registrable
// domain. Mirrors inject cross-origin popunder ads via window.open; those never
// share the book site's domain, so this lets the real detail page through while
// discarding the ad.
const isWebNavigatorSameSite = (targetUrl, baseUrl) => {
  try {
    const target = new URL(targetUrl);
    const base = new URL(baseUrl);
    if (target.protocol !== "https:" || base.protocol !== "https:") return false;
    return (
      getWebNavigatorRegistrableDomain(target.hostname) ===
      getWebNavigatorRegistrableDomain(base.hostname)
    );
  } catch {
    return false;
  }
};

const clampWebNavigatorBounds = (bounds) => {
  if (!mainWin || !bounds) return null;
  const content = mainWin.getContentBounds();
  const x = Math.max(
    0,
    Math.min(Math.floor(Number(bounds.x) || 0), Math.max(0, content.width - 1))
  );
  const y = Math.max(
    0,
    Math.min(Math.floor(Number(bounds.y) || 0), Math.max(0, content.height - 1))
  );
  const width = Math.max(
    1,
    Math.min(Math.floor(Number(bounds.width) || 1), content.width - x)
  );
  const height = Math.max(
    1,
    Math.min(Math.floor(Number(bounds.height) || 1), content.height - y)
  );
  return { x, y, width, height };
};

const sendWebNavigatorState = (extra = {}) => {
  if (
    !webNavigatorView ||
    webNavigatorView.webContents.isDestroyed() ||
    !webNavigatorOwner ||
    webNavigatorOwner.isDestroyed()
  ) {
    return;
  }
  const contents = webNavigatorView.webContents;
  const history = contents.navigationHistory;
  webNavigatorOwner.send("web-navigator-state", {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    isLoading: contents.isLoading(),
    faviconUrl: webNavigatorFaviconUrl,
    ...extra,
  });
};

const closeWebNavigatorView = () => {
  if (!webNavigatorView) return;
  const contents = webNavigatorView.webContents;
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.contentView.removeChildView(webNavigatorView);
  }
  if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
  webNavigatorView = null;
  webNavigatorOwner = null;
  webNavigatorFaviconUrl = "";
};

const loadWebNavigatorUrl = async (contents, url) => {
  try {
    await contents.loadURL(url);
    sendWebNavigatorState({ error: "" });
    return true;
  } catch (error) {
    // A redirect, a popup replacement, or a browser challenge can cancel the
    // original navigation. Electron represents that normal transition as -3.
    if (error?.code === "ERR_ABORTED") return true;
    sendWebNavigatorState({
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const getWebNavigatorDownloadPath = (libraryPath, filename) => {
  if (typeof libraryPath !== "string" || !libraryPath.trim()) return null;
  const safeName = path
    .basename(filename || "book")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .slice(0, 180);
  const extension = path.extname(safeName).toLowerCase();
  if (!WEB_NAVIGATOR_BOOK_EXTENSIONS.has(extension)) return null;
  const vaultPath = path.resolve(libraryPath);
  return {
    path: path.join(vaultPath, "downloads", `${Date.now()}-${safeName}`),
    fileName: safeName,
  };
};

const createWebNavigatorView = (owner, libraryPath) => {
  closeWebNavigatorView();
  webNavigatorOwner = owner;
  webNavigatorFaviconUrl = "";
  webNavigatorView = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: "persist:koodo-web-navigator",
    },
  });

  const contents = webNavigatorView.webContents;
  const navigatorSession = contents.session;
  const handleDownload = (_event, item, downloadContents) => {
    if (downloadContents !== contents || !webNavigatorOwner) return;
    const downloadTarget = getWebNavigatorDownloadPath(
      libraryPath,
      item.getFilename()
    );
    if (!downloadTarget) {
      item.cancel();
      webNavigatorOwner.send("web-navigator-download", {
        ok: false,
        error: "Only supported book formats can be added to the bookshelf",
      });
      return;
    }
    try {
      fs.mkdirSync(path.dirname(downloadTarget.path), { recursive: true });
      item.setSavePath(downloadTarget.path);
      item.once("done", (_doneEvent, state) => {
        if (!webNavigatorOwner || webNavigatorOwner.isDestroyed()) return;
        if (state === "completed") {
          webNavigatorOwner.send("web-navigator-download", {
            ok: true,
            path: downloadTarget.path,
            fileName: downloadTarget.fileName,
          });
        } else {
          webNavigatorOwner.send("web-navigator-download", {
            ok: false,
            error: "Book download was cancelled or interrupted",
          });
        }
      });
    } catch (error) {
      item.cancel();
      webNavigatorOwner.send("web-navigator-download", {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  navigatorSession.on("will-download", handleDownload);
  contents.once("destroyed", () =>
    navigatorSession.removeListener("will-download", handleDownload)
  );
  navigatorSession.setPermissionCheckHandler(() => false);
  navigatorSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  contents.setWindowOpenHandler(({ url }) => {
    const safeUrl = normalizeWebNavigatorUrl(url);
    if (safeUrl) {
      const currentUrl = contents.getURL();
      // Only follow pop-ups that stay on the site the user is already on.
      // Book mirrors inject cross-origin popunder ads through window.open on
      // every click; without this guard the ad URL hijacks the view and
      // replaces the real book/detail page the user tapped. Same-site detail
      // pages still load normally; cross-origin ad pop-ups are discarded.
      if (!currentUrl || isWebNavigatorSameSite(safeUrl, currentUrl)) {
        void loadWebNavigatorUrl(contents, safeUrl);
      }
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!normalizeWebNavigatorUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!normalizeWebNavigatorUrl(url)) event.preventDefault();
  });
  contents.on("did-start-loading", () => sendWebNavigatorState());
  contents.on(
    "did-start-navigation",
    (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) webNavigatorFaviconUrl = "";
    }
  );
  contents.on("page-favicon-updated", (_event, favicons) => {
    const faviconUrl = Array.isArray(favicons)
      ? favicons.find((favicon) => normalizeWebNavigatorUrl(favicon))
      : "";
    if (!faviconUrl) return;
    webNavigatorFaviconUrl = faviconUrl;
    sendWebNavigatorState();
  });
  contents.on("did-stop-loading", () => sendWebNavigatorState());
  contents.on("did-navigate", () => sendWebNavigatorState({ error: "" }));
  contents.on("did-navigate-in-page", () =>
    sendWebNavigatorState({ error: "" })
  );
  contents.on("page-title-updated", () => sendWebNavigatorState());
  contents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        sendWebNavigatorState({
          url: validatedUrl,
          error: errorDescription || "Unable to load this page",
        });
      }
    }
  );
  return webNavigatorView;
};

const throttle = (func, wait = RESIZE_THROTTLE_MS) => {
  let lastCall = 0;
  let timeoutId = null;
  return function (...args) {
    const now = Date.now();
    const invoke = () => {
      lastCall = Date.now();
      func.apply(this, args);
    };
    if (now - lastCall >= wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      invoke();
    } else if (!timeoutId) {
      timeoutId = setTimeout(
        () => {
          timeoutId = null;
          invoke();
        },
        wait - (now - lastCall)
      );
    }
  };
};

const extractClixmlErrors = (text) => {
  if (!text) return "";
  const matches = text.match(
    /<S S="Error">([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]*>)*[^<]*)<\/S>/g
  );
  if (!matches) return text;
  return matches
    .map((m) =>
      m
        .replace(/<\/?S[^>]*>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/_x000D__x000A_/g, "\n")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
};

const runPowerShellScript = (script, timeout = 30000) => {
  return new Promise((resolve, reject) => {
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Sta",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawMessage = (stderr || stdout || error.message || "").trim();
          const cleanMessage = extractClixmlErrors(rawMessage) || rawMessage;
          reject(new Error(cleanMessage));
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
};

const OCR_TEMP_DIR = path.join(configDir, "ocr-tmp");

// macOS OCR 二进制支持的语言（VNRecognizeTextRequest recognitionLanguages）
const MACOS_OCR_LANGS = new Set([
  "zh-Hans",
  "zh-Hant",
  "en-US",
  "ja-JP",
  "ko-KR",
  "fr-FR",
]);

// 把渲染进程传入的语言代码映射为各平台可识别的标签
// key: 应用内统一代码；value: { macos, win }
const OCR_LANG_MAP = {
  "zh-CN": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-SG": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-TW": { macos: "zh-Hant", win: "zh-Hant-TW" },
  "zh-HK": { macos: "zh-Hant", win: "zh-Hant-HK" },
  "zh-Hans": { macos: "zh-Hans", win: "zh-Hans-CN" },
  "zh-Hant": { macos: "zh-Hant", win: "zh-Hant-TW" },
  en: { macos: "en-US", win: "en-US" },
  "en-US": { macos: "en-US", win: "en-US" },
  "en-GB": { macos: "en-US", win: "en-GB" },
  ja: { macos: "ja-JP", win: "ja" },
  "ja-JP": { macos: "ja-JP", win: "ja" },
  ko: { macos: "ko-KR", win: "ko" },
  "ko-KR": { macos: "ko-KR", win: "ko" },
  fr: { macos: "fr-FR", win: "fr" },
  "fr-FR": { macos: "fr-FR", win: "fr" },
};

const resolveOcrLang = (lang) => {
  if (!lang || lang === "auto") return { macos: "auto", win: "auto" };
  return OCR_LANG_MAP[lang] || { macos: lang, win: lang };
};

// 从 base64 或 dataURL 中解析出 { buffer, ext }
const parseOcrImageInput = (input) => {
  if (typeof input !== "string" || !input) {
    throw new Error("Invalid image data");
  }
  // dataURL: data:image/png;base64,xxxx
  const dataUrlMatch = input.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (dataUrlMatch) {
    const ext =
      dataUrlMatch[1].toLowerCase() === "jpeg"
        ? "jpg"
        : dataUrlMatch[1].toLowerCase();
    return { buffer: Buffer.from(dataUrlMatch[2], "base64"), ext };
  }
  // 纯 base64，按 PNG 处理
  return { buffer: Buffer.from(input, "base64"), ext: "png" };
};

const writeOcrTempImage = (buffer, ext) => {
  if (!fs.existsSync(OCR_TEMP_DIR)) {
    fs.mkdirSync(OCR_TEMP_DIR, { recursive: true });
  }
  const fileName = `ocr-${process.pid}-${Date.now()}.${ext}`;
  const filePath = path.join(OCR_TEMP_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return filePath;
};

const cleanWindowsOcrText = (text) => {
  if (!text) return text;
  // Windows.Media.Ocr 对中日韩等无词边界的语言按"字"分词，Text 用空格连接，
  // 导致中文每字之间出现空格。循环去除 CJK 文字/全角标点之间的空格，
  // 保留英文与数字之间的空格。单次 replace 无法合并连续序列（如"符 号 学"），
  // 需循环直到无变化。
  //
  // CJK 范围用 Unicode 码点表示：
  //   一-龿   CJK 统一汉字（基本区）
  //   㐀-䶿   CJK 扩展 A 区
  //   ぀-ヿ   日文平假名 / 片假名
  //   가-힯   韩文谚文音节
  //   　-〿   CJK 符号与标点（全角空格、· 、。 等）
  //   ＀-￯   全角符号（全角字母数字、（） 等）
  const cjk =
    "\\u4e00-\\u9fbf\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af\\u3000-\\u303f\\uff00-\\uffef";
  const pattern = new RegExp("([" + cjk + "])\\s+([" + cjk + "])", "gu");
  let prev;
  let cur = text;
  do {
    prev = cur;
    cur = cur.replace(pattern, "$1$2");
  } while (cur !== prev);
  return cur;
};

// Windows: 通过 PowerShell 调用 Windows.Media.Ocr (WinRT)
const runWindowsOcr = (imagePath, winLang) => {
  // PowerShell 脚本里用单引号包裹路径，需转义内部单引号
  const escapePsSingle = (s) => s.replace(/'/g, "''");
  const escapedPath = escapePsSingle(imagePath);
  const langClause =
    winLang === "auto"
      ? "[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages()"
      : "$( $__lang = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]::new('" +
        escapePsSingle(winLang) +
        "'); [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::TryCreateFromLanguage($__lang) )";
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
function EncodeOut($prefix, $text) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  Write-Output -NoEnumerate ($prefix + [Convert]::ToBase64String($bytes))
}
try {
  $path = '${escapedPath}'
  $file = Await ([Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = ${langClause}
  if ($null -eq $engine) { Write-Output 'LANGERR'; exit 0 }
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  EncodeOut 'OK' $result.Text
} catch {
  EncodeOut 'ERR' $_.Exception.Message
  exit 0
}
`;
  return runPowerShellScript(script, 60000).then((text) => {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      throw new Error("Windows OCR returned empty result");
    }
    if (trimmed === "LANGERR") {
      const err = new Error(
        "Language package not installed! See: https://support.microsoft.com/help/17213"
      );
      err.code = "LANG_NOT_INSTALLED";
      throw err;
    }
    if (trimmed.startsWith("ERR")) {
      const msg = Buffer.from(trimmed.slice(3), "base64")
        .toString("utf8")
        .trim();
      throw new Error(msg || "Windows OCR failed");
    }
    if (trimmed.startsWith("OK")) {
      const b64 = trimmed.slice(2);
      const raw = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";
      return cleanWindowsOcrText(raw);
    }
    throw new Error("Windows OCR returned unexpected output");
  });
};

// macOS: 调用打包的 Vision framework 二进制
const runMacosOcr = (imagePath, macosLang) => {
  const arch = process.arch; // arm64 / x64
  const archName =
    arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch;
  const binPath = isDev
    ? path.join(__dirname, "assets/macos/ocr-" + archName + "-apple-darwin")
    : path.join(
        process.resourcesPath,
        "assets/macos/ocr-" + archName + "-apple-darwin"
      );
  if (!fs.existsSync(binPath)) {
    const err = new Error("macOS OCR binary not found: " + binPath);
    err.code = "BIN_NOT_FOUND";
    throw err;
  }
  return new Promise((resolve, reject) => {
    execFile(
      binPath,
      [imagePath, macosLang],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = (stderr || error.message || "").trim();
          const err = new Error(msg || "macOS OCR failed");
          err.code = "BIN_FAILED";
          reject(err);
          return;
        }
        resolve((stdout || "").trim());
      }
    );
  });
};

const getWindowHandleValue = (win) => {
  if (!win || typeof win.getNativeWindowHandle !== "function") {
    return "";
  }

  try {
    const handle = win.getNativeWindowHandle();
    if (!Buffer.isBuffer(handle) || handle.length === 0) {
      return "";
    }

    if (handle.length >= 8 && typeof handle.readBigUInt64LE === "function") {
      return handle.readBigUInt64LE(0).toString();
    }

    return handle.readUInt32LE(0).toString();
  } catch (error) {
    console.warn("Failed to resolve native window handle:", error);
    return "";
  }
};

const loadUrlInAuxWindow = async (win, url) => {
  const wc = win.webContents;
  let currentUrl = "";
  try {
    currentUrl = wc.getURL();
  } catch (_) {
    currentUrl = "";
  }
  if (currentUrl === url) {
    wc.reload();
    return;
  }
  let needBlankIntermediate = false;
  try {
    const current = new URL(currentUrl);
    const next = new URL(url);
    // When only the hash differs, Chromium treats it as a same-page hashchange
    // and won't reload the page. Navigating through about:blank forces a full reload.
    needBlankIntermediate =
      current.origin === next.origin &&
      current.pathname === next.pathname &&
      current.search === next.search;
  } catch (_) {
    // ignore invalid URLs (e.g. empty string, about:blank)
  }
  if (needBlankIntermediate) {
    await wc.loadURL("about:blank");
  }
  await wc.loadURL(url);
};

const getWindowsHelloScript = (mode, message = "", hwnd = "") => {
  const escapedMessage = message.replace(/'/g, "''");
  const escapedHwnd = String(hwnd || "").replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

function Invoke-WinRtAsync {
  param(
    [Parameter(Mandatory = $true)] $Operation,
    [Parameter(Mandatory = $true)] [Type[]] $ResultTypes
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetGenericArguments().Count -eq $ResultTypes.Count -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1

  if (-not $method) {
    throw 'Unable to bridge Windows Runtime async operation.'
  }

  $genericMethod = $method.MakeGenericMethod($ResultTypes)
  $task = $genericMethod.Invoke($null, @($Operation))
  return $task.GetAwaiter().GetResult()
}

function Request-WindowsHelloVerification {
  param(
    [Parameter(Mandatory = $true)] [string] $Message,
    [string] $Hwnd
  )

  $isWindowInteropSupported = [Environment]::OSVersion.Version.Build -ge 22000 -and -not [string]::IsNullOrWhiteSpace($Hwnd)

  if (-not $isWindowInteropSupported) {
    return Invoke-WinRtAsync -Operation ($verifier::RequestVerificationAsync($Message)) -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace KoodoReaderInterop
{
    [ComImport]
    [Guid("39E050C3-4E74-441A-8DC0-B81104DF949C")]
    [InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    public interface IUserConsentVerifierInterop
    {
        [return: MarshalAs(UnmanagedType.IInspectable)]
        object RequestVerificationForWindowAsync(
            IntPtr appWindow,
            [MarshalAs(UnmanagedType.HString)] string message,
            [In] ref Guid riid);
    }

    public static class UserConsentVerifierInteropHelper
    {
        public static object RequestVerificationForWindow(object activationFactory, long hwnd, string message, Guid riid)
        {
            IntPtr ptr = IntPtr.Zero;

            try
            {
                ptr = Marshal.GetIUnknownForObject(activationFactory);
                var interop = (IUserConsentVerifierInterop)Marshal.GetTypedObjectForIUnknown(ptr, typeof(IUserConsentVerifierInterop));
                return interop.RequestVerificationForWindowAsync(new IntPtr(hwnd), message, ref riid);
            }
            finally
            {
                if (ptr != IntPtr.Zero)
                {
                    Marshal.Release(ptr);
                }
            }
        }
    }
}
"@

  $activationFactory = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeMarshal]::GetActivationFactory($verifier)
  $asyncOperationGuid = [Guid]::Parse('fd596ffd-2318-558f-9dbe-d21df43764a5')
  $operation = [KoodoReaderInterop.UserConsentVerifierInteropHelper]::RequestVerificationForWindow($activationFactory, [Int64]::Parse($Hwnd), $Message, $asyncOperationGuid)
  return Invoke-WinRtAsync -Operation $operation -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerificationResult])
}

$verifier = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$availability = Invoke-WinRtAsync -Operation ($verifier::CheckAvailabilityAsync()) -ResultTypes @([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])

if ('${mode}' -eq 'check') {
  [Console]::Out.Write((@{
    available = ($availability.ToString() -eq 'Available')
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
  exit 0
}

if ($availability.ToString() -ne 'Available') {
  [Console]::Out.Write((@{
    success = $false
    code = 'Unavailable'
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
  exit 0
}

try {
  $result = Request-WindowsHelloVerification -Message '${escapedMessage}' -Hwnd '${escapedHwnd}'
  [Console]::Out.Write((@{
    success = ($result.ToString() -eq 'Verified')
    code = $result.ToString()
    status = $availability.ToString()
  } | ConvertTo-Json -Compress))
} catch {
  [Console]::Out.Write((@{
    success = $false
    code = 'Error'
    status = $_.Exception.Message
  } | ConvertTo-Json -Compress))
}
`.trim();
};

const getBiometricCapability = async () => {
  if (process.platform === "darwin") {
    const available =
      typeof systemPreferences.canPromptTouchID === "function" &&
      systemPreferences.canPromptTouchID();
    return {
      available,
      provider: "Touch ID",
      platform: process.platform,
      status: available ? "Available" : "Unavailable",
    };
  }

  if (process.platform === "win32") {
    try {
      const output = await runPowerShellScript(getWindowsHelloScript("check"));
      const result = output ? JSON.parse(output) : {};
      return {
        available: !!result.available,
        provider: "Windows Hello",
        platform: process.platform,
        status: result.status || "Unavailable",
      };
    } catch (error) {
      return {
        available: false,
        provider: "Windows Hello",
        platform: process.platform,
        status: "Error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    available: false,
    provider: "Biometric",
    platform: process.platform,
    status: "Unsupported",
  };
};

const promptBiometricAuth = async (
  promptMessage = "Authenticate",
  owningWindow = null
) => {
  if (process.platform === "darwin") {
    const available =
      typeof systemPreferences.canPromptTouchID === "function" &&
      systemPreferences.canPromptTouchID();
    if (!available) {
      return {
        success: false,
        code: "Unavailable",
        provider: "Touch ID",
      };
    }

    try {
      await systemPreferences.promptTouchID(promptMessage);
      return {
        success: true,
        code: "Verified",
        provider: "Touch ID",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        code: /cancel/i.test(message) ? "Canceled" : "Failed",
        provider: "Touch ID",
      };
    }
  }

  if (process.platform === "win32") {
    try {
      const hwnd = getWindowHandleValue(owningWindow);
      const output = await runPowerShellScript(
        getWindowsHelloScript("verify", promptMessage, hwnd),
        120000
      );
      const result = output ? JSON.parse(output) : {};
      return {
        success: !!result.success,
        code:
          result.code === "Unavailable" && result.status
            ? result.status
            : result.code || "Error",
        provider: "Windows Hello",
      };
    } catch (error) {
      console.error("Biometric verification error:", error.message);
      return {
        success: false,
        code: "Error",
        provider: "Windows Hello",
      };
    }
  }

  return {
    success: false,
    code: "Unsupported",
    provider: "Biometric",
  };
};

// Discord Rich Presence setup
let discordRPCClient = null;
let discordRPCReady = false;
let discordRPCConnecting = false;
const DISCORD_CLIENT_ID = "";

function initDiscordRPC() {
  if (!DISCORD_CLIENT_ID) return Promise.resolve();
  if (discordRPCConnecting || discordRPCReady) return Promise.resolve();
  discordRPCConnecting = true;
  return new Promise((resolve) => {
    try {
      const DiscordRPC = require("discord-rpc");
      DiscordRPC.register(DISCORD_CLIENT_ID);
      const client = new DiscordRPC.Client({ transport: "ipc" });
      client.on("ready", () => {
        console.info("Discord RPC connected");
        discordRPCClient = client;
        discordRPCReady = true;
        discordRPCConnecting = false;
        resolve();
      });
      client.login({ clientId: DISCORD_CLIENT_ID }).catch((err) => {
        console.warn("Discord RPC login failed:", err.message);
        discordRPCClient = null;
        discordRPCReady = false;
        discordRPCConnecting = false;
        resolve();
      });
    } catch (e) {
      console.warn("Discord RPC init failed:", e.message);
      discordRPCClient = null;
      discordRPCReady = false;
      discordRPCConnecting = false;
      resolve();
    }
  });
}
function destroyDiscordRPC() {
  if (discordRPCClient) {
    try {
      discordRPCClient.destroy();
    } catch (_) {}
    discordRPCClient = null;
  }
  discordRPCReady = false;
  discordRPCConnecting = false;
}
function buildProgressBar(percentage) {
  const total = 10;
  const filled = Math.round((percentage / 100) * total);
  const empty = total - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}
const singleInstance = app.requestSingleInstanceLock();
var filePath = null;
var pendingDeepLink = null;
if (process.platform != "darwin" && process.argv.length >= 2) {
  filePath = process.argv[1];
  // Check argv for a deep link URL (cold start)
  for (const arg of process.argv) {
    if (arg.startsWith("books-reader://")) {
      pendingDeepLink = arg;
      break;
    }
  }
}
log.transports.file.fileName = "debug.log";
log.transports.file.maxSize = 1024 * 1024; // 1MB
log.initialize();
store.set("appVersion", packageJson.version);
store.set("appPlatform", os.platform() + " " + os.release());
const mainWinDisplayScale = store.get("mainWinDisplayScale") || 1;
let options = {
  width: parseInt(store.get("mainWinWidth") || 1050) / mainWinDisplayScale,
  height: parseInt(store.get("mainWinHeight") || 660) / mainWinDisplayScale,
  x: parseInt(store.get("mainWinX")),
  y: parseInt(store.get("mainWinY")),
  backgroundColor:
    store.get("appSkin") === "night" ? "rgba(47, 52, 55, 1)" : "#fff",
  minWidth: 300,
  minHeight: 100,
  webPreferences: {
    webSecurity: false,
    nodeIntegration: true,
    contextIsolation: false,
    nativeWindowOpen: true,
    nodeIntegrationInSubFrames: false,
    allowRunningInsecureContent: false,
    enableRemoteModule: true,
    sandbox: false,
  },
};
const Database = require("better-sqlite3");
const appIconPath = isDev
  ? path.join(__dirname, "./public/assets/icon.png")
  : path.join(__dirname, "./assets/appx/icon.ico");
options = Object.assign({}, options, { icon: appIconPath });
// Single Instance Lock
if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", (event, argv, workingDir) => {
    if (mainWin) {
      if (!mainWin.isVisible()) mainWin.show();
      mainWin.focus();
    }
    // Handle deep link passed via second-instance argv
    const deepLink = argv.find((arg) => arg.startsWith("books-reader://"));
    if (deepLink) {
      handleCallback(deepLink);
    }
  });
}
if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
  // Make sure the directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dirPath, "log.json"),
    JSON.stringify({ filePath }),
    "utf-8"
  );
}
const getDBConnection = (dbName, storagePath, sqlStatement) => {
  if (!dbConnection[dbName]) {
    if (!fs.existsSync(path.join(storagePath, "config"))) {
      fs.mkdirSync(path.join(storagePath, "config"), { recursive: true });
    }
    dbConnection[dbName] = new Database(
      path.join(storagePath, "config", `${dbName}.db`),
      {}
    );
    dbConnection[dbName].pragma("journal_mode = WAL");
    dbConnection[dbName].exec(sqlStatement["createTableStatement"][dbName]);
    if (sqlStatement["migrateStatement"][dbName]) {
      let sqlList = sqlStatement["migrateStatement"][dbName];
      for (let sql of sqlList) {
        try {
          dbConnection[dbName].exec(sql);
        } catch (error) {}
      }
    }
  }
  return dbConnection[dbName];
};
const getSyncUtil = async (config, isUseCache = true) => {
  if (!isUseCache || !syncUtilCache[config.service]) {
    const { SyncUtil } = await import("./src/assets/lib/kookit-extra.min.mjs");
    syncUtilCache[config.service] = new SyncUtil(config.service, config);
  }
  return syncUtilCache[config.service];
};
const removeSyncUtil = (config) => {
  if (syncUtilCache[config.service]) {
    syncUtilCache[config.service].clearQueue();
    delete syncUtilCache[config.service];
  }
};
const getPickerUtil = async (config, isUseCache = true) => {
  if (!isUseCache || !pickerUtilCache[config.service]) {
    const { SyncUtil } = await import("./src/assets/lib/kookit-extra.min.mjs");
    pickerUtilCache[config.service] = new SyncUtil(config.service, config);
  }
  return pickerUtilCache[config.service];
};
const removePickerUtil = (config) => {
  if (pickerUtilCache[config.service]) {
    pickerUtilCache[config.service] = null;
  }
};
const getNativeThemeSource = (appSkin) => {
  if (appSkin === "night") {
    return "dark";
  }
  if (appSkin === "light") {
    return "light";
  }
  return "system";
};
const getNativeDarkColorStatus = () => {
  if (
    typeof electronNativeTheme.shouldUseDarkColorsForSystemIntegratedUI !==
    "undefined"
  ) {
    return electronNativeTheme.shouldUseDarkColorsForSystemIntegratedUI;
  }
  return electronNativeTheme.shouldUseDarkColors;
};
const applyNativeThemeSource = (appSkin) => {
  if (process.type !== "browser") {
    return false;
  }
  electronNativeTheme.themeSource = getNativeThemeSource(appSkin);
  store.set("appSkin", appSkin || "system");
  return getNativeDarkColorStatus();
};
applyNativeThemeSource(store.get("appSkin"));
// Simple encryption function
const encrypt = (text, key) => {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return Buffer.from(result).toString("base64");
};

// Simple decryption function
const decrypt = (encryptedText, key) => {
  const buff = Buffer.from(encryptedText, "base64").toString();
  let result = "";
  for (let i = 0; i < buff.length; i++) {
    const charCode = buff.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return result;
};
// Helper to check if two rectangles intersect (for partial visibility)
const rectanglesIntersect = (rect1, rect2) => {
  return !(
    rect1.x + rect1.width <= rect2.x ||
    rect1.y + rect1.height <= rect2.y ||
    rect1.x >= rect2.x + rect2.width ||
    rect1.y >= rect2.y + rect2.height
  );
};

// Check if the window is at least partially visible on any display
const isWindowPartiallyVisible = (bounds) => {
  const displays = screen.getAllDisplays();
  for (const display of displays) {
    if (rectanglesIntersect(bounds, display.workArea)) {
      return true;
    }
  }
  return false;
};
const createTray = () => {
  let iconPath = isDev
    ? path.join(__dirname, "./public/assets/icon.png")
    : path.join(__dirname, "./build/assets/icon.png");
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (os.platform() === "darwin") {
    trayIcon = trayIcon.resize({ width: 16, height: 16, quality: "best" });
    trayIcon.setTemplateImage(false);
  }
  tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Books",
      click: () => {
        if (mainWin) {
          mainWin.show();
          mainWin.focus();
        }
      },
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip("Books");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWin) {
      mainWin.show();
      mainWin.focus();
    }
  });
};
const createMainWin = () => {
  const isMainWindVisible = isWindowPartiallyVisible({
    width: parseInt(store.get("mainWinWidth") || 1050) / mainWinDisplayScale,
    height: parseInt(store.get("mainWinHeight") || 660) / mainWinDisplayScale,
    x: parseInt(store.get("mainWinX")),
    y: parseInt(store.get("mainWinY")),
  });
  if (!isMainWindVisible) {
    delete options.x;
    delete options.y;
  }
  mainWin = new BrowserWindow(options);
  if (store.get("isAlwaysOnTop") === "yes") {
    mainWin.setAlwaysOnTop(true);
  }
  if (store.get("isAutoMaximizeWin") === "yes") {
    mainWin.maximize();
  }

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  const urlLocation = isDev
    ? "http://localhost:3000"
    : `file://${path.join(__dirname, "./build/index.html")}`;
  mainWin.loadURL(urlLocation);
  // Handle deep link on cold start: wait for renderer to mount its IPC listeners
  mainWin.webContents.once("did-finish-load", () => {
    if (pendingDeepLink) {
      const link = pendingDeepLink;
      pendingDeepLink = null;
      // Give React time to register ipcRenderer listeners before dispatching
      setTimeout(() => handleCallback(link), 1500);
    }
  });
  mainWin.on("close", (event) => {
    if (!isQuitting && store.get("isMinimizeToTray") === "yes") {
      event.preventDefault();
      mainWin.hide();
      if (!tray) {
        createTray();
      }
      return;
    }
    if (mainWin && !mainWin.isDestroyed()) {
      let bounds = mainWin.getBounds();
      const currentDisplay = screen.getDisplayMatching(bounds);
      const primaryDisplay = screen.getPrimaryDisplay();
      if (bounds.width > 300 && bounds.height > 100) {
        store.set({
          mainWinWidth: bounds.width,
          mainWinHeight: bounds.height,
          mainWinX: mainWin.isMaximized() ? 0 : bounds.x,
          mainWinY: mainWin.isMaximized() ? 0 : bounds.y,
          mainWinDisplayScale:
            currentDisplay.scaleFactor / primaryDisplay.scaleFactor,
        });
      }
    }
    closeWebNavigatorView();
    mainWin = null;
  });
  const syncMainViewBounds = () => {
    if (mainView) {
      if (!mainWin) return;
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  };
  mainWin.on("resize", throttle(syncMainViewBounds));
  mainWin.on("maximize", () => {
    if (mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  mainWin.on("unmaximize", () => {
    if (mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  mainWin.on("focus", () => {
    if (mainView && !mainView.webContents.isDestroyed()) {
      mainView.webContents.focus();
    }
  });
  mainWin.webContents.on(
    "console-message",
    (event, level, message, line, sourceId) => {
      console.log(`[Renderer Console] Message: ${message}`);
    }
  );
  //cancel-download-app
  ipcMain.handle("cancel-download-app", (event, arg) => {
    // Implement cancellation logic here
    // Note: In this example, we are not keeping a reference to the request,
    // so we cannot actually abort it. This is a placeholder for demonstration.
    if (downloadRequest) {
      downloadRequest.abort();
      downloadRequest = null;
    }
    event.returnValue = "cancelled";
  });
  // Discord RPC handlers
  ipcMain.handle("discord-rpc-update", async (event, config) => {
    if (!DISCORD_CLIENT_ID) return;
    const { bookTitle, author, percentage } = config;
    if (!discordRPCReady) {
      await initDiscordRPC();
    }
    if (!discordRPCClient || !discordRPCReady) return;
    try {
      const progressBar = buildProgressBar(percentage);
      await discordRPCClient.setActivity({
        details: bookTitle,
        state: `${progressBar} ${percentage}%  |  by ${author}`,
        largeImageKey: "books_reader_logo",
        largeImageText: "Books",
        startTimestamp: Date.now(),
        instance: false,
        buttons: [],
      });
    } catch (e) {
      console.warn("Failed to set Discord activity:", e.message);
    }
  });
  ipcMain.handle("discord-rpc-clear", async (event) => {
    if (discordRPCClient) {
      try {
        await discordRPCClient.clearActivity();
      } catch (e) {
        console.warn("Failed to clear Discord activity:", e.message);
      }
    }
  });
  ipcMain.handle("update-win-app", () => ({
    success: false,
    message: "Books does not use the upstream updater.",
  }));
  ipcMain.handle("open-book", (event, config) => {
    let { url, isMergeWord, isAutoFullscreen, isAutoMaximize, isPreventSleep } =
      config;
    if (isMergeWord) {
      delete options.backgroundColor;
    }
    store.set({
      url,
      isMergeWord: isMergeWord || "no",
      isAutoFullscreen: isAutoFullscreen || "no",
      isAutoMaximize: isAutoMaximize || "no",
      isPreventSleep: isPreventSleep || "no",
    });
    let id;
    if (isPreventSleep === "yes") {
      id = powerSaveBlocker.start("prevent-display-sleep");
      console.info(powerSaveBlocker.isStarted(id));
    }
    if (readerWindow) {
      readerWindowList.push(readerWindow);
    }
    if (isAutoFullscreen === "yes" || isAutoMaximize === "yes") {
      readerWindow = new BrowserWindow(options);
      readerWindow.loadURL(url);
      if (isAutoFullscreen === "yes") {
        readerWindow.setFullScreen(true);
      } else if (isAutoMaximize === "yes") {
        readerWindow.maximize();
      }
    } else {
      const scaleRatio = store.get("windowDisplayScale") || 1;
      const isWindowVisible = isWindowPartiallyVisible({
        x: parseInt(store.get("windowX")),
        y: parseInt(store.get("windowY")),
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
      });
      readerWindow = new BrowserWindow({
        ...options,
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
        x: isWindowVisible ? parseInt(store.get("windowX")) : undefined,
        y: isWindowVisible ? parseInt(store.get("windowY")) : undefined,
        frame: isMergeWord === "yes" ? false : true,
        hasShadow: isMergeWord === "yes" ? false : true,
        transparent: isMergeWord === "yes" ? true : false,
      });
      readerWindow.loadURL(url);
      // readerWindow.webContents.openDevTools();
    }
    if (store.get("isAlwaysOnTop") === "yes") {
      readerWindow.setAlwaysOnTop(true);
    }
    readerWindowReadyToClose = false;
    readerWindow.on("close", (event) => {
      // --- Step 1: ask renderer to flush reading-time data first ---
      if (
        !readerWindowReadyToClose &&
        readerWindow &&
        !readerWindow.isDestroyed()
      ) {
        event.preventDefault();
        readerWindow.webContents.send("before-reader-close");
        return;
      }
      // --- Step 2: actual close logic (reached after renderer replied) ---
      if (readerWindow && !readerWindow.isDestroyed()) {
        let bounds = readerWindow.getBounds();
        const currentDisplay = screen.getDisplayMatching(bounds);
        const primaryDisplay = screen.getPrimaryDisplay();
        if (bounds.width > 300 && bounds.height > 100) {
          store.set({
            windowWidth: bounds.width,
            windowHeight: bounds.height,
            windowX:
              readerWindow.isMaximized() &&
              currentDisplay.id === primaryDisplay.id
                ? 0
                : bounds.x,
            windowY:
              readerWindow.isMaximized() &&
              currentDisplay.id === primaryDisplay.id
                ? 0
                : bounds.y < 0
                  ? 0
                  : bounds.y,
            windowDisplayScale:
              currentDisplay.scaleFactor / primaryDisplay.scaleFactor,
          });
        }
      }
      if (isPreventSleep && !readerWindow.isDestroyed()) {
        id && powerSaveBlocker.stop(id);
      }
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send("reading-finished", {});
      }
      if (discordRPCClient) {
        try {
          discordRPCClient.clearActivity();
        } catch (e) {
          console.warn("Failed to clear Discord activity:", e.message);
        }
      }
    });
    // Renderer finished flushing reading-time data — proceed with actual close
    ipcMain.once("reader-close-ready", () => {
      if (readerWindow && !readerWindow.isDestroyed()) {
        readerWindowReadyToClose = true;
        readerWindow.close();
      }
    });

    event.returnValue = "success";
  });
  ipcMain.handle("generate-tts", async (event, voiceConfig) => {
    let { text, speed, plugin, config } = voiceConfig;
    let voiceFunc = plugin.script;
    // eslint-disable-next-line no-eval
    eval(voiceFunc);
    return global.getAudioPath(text, speed, dirPath, config);
  });
  ipcMain.handle("cloud-upload", async (event, config) => {
    let syncUtil = await getSyncUtil(config, config.isUseCache);
    let result = await syncUtil.uploadFile(
      config.fileName,
      config.fileName,
      config.type
    );
    return result;
  });

  ipcMain.handle("cloud-download", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.downloadFile(
      config.fileName,
      (config.isTemp ? "temp-" : "") + config.fileName,
      config.type
    );
    return result;
  });
  ipcMain.handle("cloud-progress", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.getDownloadedSize();
    return result;
  });
  ipcMain.handle("picker-download", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.remote.downloadFile(
      config.sourcePath,
      config.destPath
    );
    return result;
  });
  ipcMain.handle("picker-progress", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.getDownloadedSize();
    return result;
  });
  ipcMain.handle("cloud-reset", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.resetCounters();
    return result;
  });
  ipcMain.handle("cloud-stats", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = syncUtil.getStats();
    return result;
  });
  ipcMain.handle("cloud-delete", async (event, config) => {
    try {
      let syncUtil = await getSyncUtil(config, config.isUseCache);
      let result = await syncUtil.deleteFile(config.fileName, config.type);
      return result;
    } catch (error) {
      console.error("Error deleting file:", error);
    }
    return false;
  });

  ipcMain.handle("cloud-list", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.listFiles(config.type);
    return result;
  });
  ipcMain.handle("picker-list", async (event, config) => {
    let pickerUtil = await getPickerUtil(config);
    let result = await pickerUtil.listFileInfos(config.currentPath);
    return result;
  });
  ipcMain.handle("cloud-exist", async (event, config) => {
    let syncUtil = await getSyncUtil(config);
    let result = await syncUtil.isExist(config.fileName, config.type);
    return result;
  });
  ipcMain.handle("cloud-close", async (event, config) => {
    removeSyncUtil(config);
    return "pong";
  });

  ipcMain.handle("clear-tts", async (event, config) => {
    if (!fs.existsSync(path.join(dirPath, "tts"))) {
      return "pong";
    } else {
      const fsExtra = require("fs-extra");
      try {
        await fsExtra.remove(path.join(dirPath, "tts"));
        await fsExtra.mkdir(path.join(dirPath, "tts"));
        return "pong";
      } catch (err) {
        console.error(err);
        return "pong";
      }
    }
  });
  ipcMain.handle("select-path", async (event) => {
    var path = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return path.filePaths[0];
  });
  ipcMain.handle("folder-library-select", async (event) => {
    assertFolderLibrarySender(event);
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Select folder library",
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("folder-library-open", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    await startFolderLibraryWatcher(root, event.sender);
    return { root, entries: await scanFolderLibrary(root) };
  });
  ipcMain.handle("folder-library-scan", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    return { root, entries: await scanFolderLibrary(root) };
  });
  ipcMain.handle("folder-library-compose-book", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    return composeFolderLibraryBook(root, config?.folder || "");
  });
  ipcMain.handle("folder-library-create", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    const parent = resolveFolderLibraryPath(root, config?.parent || "");
    const parentStats = await fs.promises.stat(parent);
    if (!parentStats.isDirectory()) throw new Error("The target is not a folder");
    const isMarkdown = config?.type === "markdown";
    const name = sanitizeFolderLibraryName(config?.name, isMarkdown);
    const target = resolveFolderLibraryPath(root, path.join(config?.parent || "", name), true);
    if (isMarkdown) {
      await fs.promises.writeFile(target, `# ${path.basename(name, ".md")}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } else {
      await fs.promises.mkdir(target);
    }
    return path.relative(root, target).split(path.sep).join("/");
  });
  ipcMain.handle("folder-library-move", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    const source = resolveFolderLibraryPath(root, config?.source);
    const targetDirectory = resolveFolderLibraryPath(root, config?.target || "");
    if (!(await fs.promises.stat(targetDirectory)).isDirectory()) {
      throw new Error("The target is not a folder");
    }
    const target = resolveFolderLibraryPath(
      root,
      path.join(config?.target || "", path.basename(source)),
      true
    );
    const sourceRelative = path.relative(source, target);
    if (!sourceRelative || (!sourceRelative.startsWith("..") && !path.isAbsolute(sourceRelative))) {
      throw new Error("A folder cannot be moved into itself");
    }
    if (fs.existsSync(target)) throw new Error("An item with this name already exists");
    await fs.promises.rename(source, target);
    return path.relative(root, target).split(path.sep).join("/");
  });
  ipcMain.handle("folder-library-copy-files", async (event, config) => {
    assertFolderLibrarySender(event);
    const root = normalizeFolderLibraryRoot(config?.root);
    const targetDirectory = resolveFolderLibraryPath(root, config?.target || "");
    if (!(await fs.promises.stat(targetDirectory)).isDirectory()) {
      throw new Error("The target is not a folder");
    }
    const copied = [];
    for (const sourceValue of Array.isArray(config?.sources) ? config.sources : []) {
      const source = fs.realpathSync(path.resolve(sourceValue));
      const stats = await fs.promises.stat(source);
      if (!stats.isFile() || !FOLDER_LIBRARY_EXTENSIONS.has(path.extname(source).toLowerCase())) {
        continue;
      }
      const target = resolveFolderLibraryPath(
        root,
        path.join(config?.target || "", path.basename(source)),
        true
      );
      if (path.resolve(source) === path.resolve(target)) continue;
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      copied.push(path.relative(root, target).split(path.sep).join("/"));
    }
    return copied;
  });
  ipcMain.handle("folder-library-show", async (event, config) => {
    assertFolderLibrarySender(event);
    const { shell } = require("electron");
    const root = normalizeFolderLibraryRoot(config?.root);
    return shell.openPath(root);
  });
  ipcMain.handle("select-file", async (event, config) => {
    const dialogOptions = { properties: ["openFile"] };
    if (config && config.filters) {
      dialogOptions.filters = config.filters;
    }
    var result = await dialog.showOpenDialog(dialogOptions);
    return result.filePaths[0];
  });
  // Plugin host file store. All paths are plugin-relative ("id/main.js"),
  // validated before touching the filesystem: no absolute paths, no "..",
  // and the resolved path must stay inside the plugins directory.
  const pluginsDir = path.join(configDir, "plugins");
  const resolvePluginPath = (relativePath) => {
    if (
      typeof relativePath !== "string" ||
      !relativePath ||
      relativePath.includes("\\") ||
      relativePath.includes("..") ||
      path.isAbsolute(relativePath) ||
      relativePath.split("/").some((part) => !part || /[^a-zA-Z0-9._-]/.test(part))
    ) {
      return null;
    }
    const resolved = path.resolve(pluginsDir, relativePath);
    if (!resolved.startsWith(pluginsDir + path.sep)) return null;
    return resolved;
  };
  ipcMain.handle("plugin-read-file", async (event, config) => {
    const resolved = resolvePluginPath(config && config.path);
    if (!resolved) return null;
    try {
      return await fs.promises.readFile(resolved, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  });
  ipcMain.handle("plugin-write-file", async (event, config) => {
    const resolved = resolvePluginPath(config && config.path);
    if (!resolved || typeof (config && config.content) !== "string") {
      return false;
    }
    await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
    await fs.promises.writeFile(resolved, config.content, "utf8");
    return true;
  });
  ipcMain.handle("plugin-delete-file", async (event, config) => {
    const resolved = resolvePluginPath(config && config.path);
    if (!resolved) return false;
    try {
      await fs.promises.rm(resolved, { recursive: true, force: true });
    } catch (error) {
      return false;
    }
    return true;
  });
  ipcMain.handle("plugin-list-dir", async (event, config) => {
    const relativePath = (config && config.path) || "";
    const resolved = relativePath
      ? resolvePluginPath(relativePath)
      : pluginsDir;
    if (!resolved) return [];
    try {
      const entries = await fs.promises.readdir(resolved, {
        withFileTypes: true,
      });
      return entries.map((entry) =>
        entry.isDirectory() ? entry.name + "/" : entry.name
      );
    } catch (error) {
      return [];
    }
  });
  // Main-process download for the plugin registry and plugin bundles so a
  // proxy can be swapped at this level later. HTTPS only, redirects followed
  // manually (re-validated), 20 MB cap, bytes returned as base64.
  ipcMain.handle("plugin-download", async (event, config) => {
    const https = require("https");
    const DOWNLOAD_MAX_BYTES = 20 * 1024 * 1024;
    const fetchWithRedirects = async (urlText, depth) => {
      if (depth > 4) throw new Error("Too many redirects");
      let url;
      try {
        url = new URL(urlText);
      } catch (error) {
        throw new Error("Invalid URL");
      }
      if (url.protocol !== "https:") throw new Error("Only https is allowed");
      const chunks = [];
      let total = 0;
      let status, headers, location;
      await new Promise((resolve, reject) => {
        const request = https.request(
          url,
          { timeout: 30000 },
          (response) => {
            status = response.statusCode;
            headers = response.headers;
            location = response.headers.location;
            response.on("data", (chunk) => {
              total += chunk.length;
              if (total > DOWNLOAD_MAX_BYTES) {
                request.destroy(new Error("Download exceeds 20 MB"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("end", () => resolve());
            response.on("error", reject);
          }
        );
        request.on("timeout", () => {
          request.destroy(new Error("Download timed out"));
        });
        request.on("error", reject);
        request.end();
      });
      if (
        location &&
        [301, 302, 303, 307, 308].includes(status)
      ) {
        return fetchWithRedirects(new URL(location, url).toString(), depth + 1);
      }
      if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status}`);
      }
      return {
        status,
        bytes: Buffer.concat(chunks).toString("base64"),
      };
    };
    if (typeof (config && config.url) !== "string") {
      throw new Error("Missing url");
    }
    return fetchWithRedirects(config.url, 0);
  });
  // Main-process HTTP fetch for book-source plugins. Runs in Node (no CORS,
  // no browser origin restrictions) so cross-origin book-source sites that
  // don't send Access-Control-Allow-Origin still work. SSRF guards live in
  // the renderer-side host API; this handler trusts the renderer and only
  // enforces: http(s) only, no private IPs, 20 MB cap, 30 s timeout.
  ipcMain.handle("plugin-http-fetch", async (event, config) => {
    const https = require("https");
    const http = require("http");
    if (typeof (config && config.url) !== "string") {
      throw new Error("Missing url");
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(config.url);
    } catch (error) {
      throw new Error("Invalid URL");
    }
    const isPrivateHost = (hostname) => {
      const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "::1"
      )
        return true;
      const parts = host.split(".").map(Number);
      if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p)))
        return false;
      return (
        parts[0] === 10 ||
        parts[0] === 127 ||
        (parts[0] === 169 && parts[1] === 254) ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168)
      );
    };
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      isPrivateHost(parsedUrl.hostname)
    ) {
      throw new Error("Blocked by SSRF guard");
    }
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;
    const method = String(config.method || "GET").toUpperCase();
    const headers = config.headers || {};
    if (!headers["User-Agent"] && !headers["user-agent"]) {
      headers["User-Agent"] =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    }
    const chunks = [];
    return await new Promise((resolve, reject) => {
      const request = lib.request(
        parsedUrl,
        { method, headers, timeout: 30000 },
        (response) => {
          // Follow redirects manually (3xx), re-validating the target.
          if (
            [301, 302, 303, 307, 308].includes(response.statusCode) &&
            response.headers.location
          ) {
            const next = new URL(
              response.headers.location,
              parsedUrl
            );
            if (isPrivateHost(next.hostname)) {
              return reject(new Error("Redirected to a private host"));
            }
            // Recurse via the same IPC by issuing a fresh request.
            const followLib = next.protocol === "https:" ? https : http;
            const followReq = followLib.request(
              next,
              { method, headers, timeout: 30000 },
              (followRes) => {
                followRes.on("data", (chunk) => {
                  chunks.push(chunk);
                  if (Buffer.concat(chunks).length > 20 * 1024 * 1024) {
                    followReq.destroy(new Error("Response exceeds 20 MB"));
                  }
                });
                followRes.on("end", () => {
                  const body = Buffer.concat(chunks);
                  const flatHeaders = {};
                  Object.entries(followRes.headers).forEach(([k, v]) => {
                    flatHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
                  });
                  resolve({
                    status: followRes.statusCode,
                    finalUrl: next.toString(),
                    headers: flatHeaders,
                    body: body.toString("base64"),
                    binary: true,
                  });
                });
                followRes.on("error", reject);
              }
            );
            followReq.on("timeout", () =>
              followReq.destroy(new Error("Request timed out"))
            );
            followReq.on("error", reject);
            if (config.body) followReq.write(config.body);
            followReq.end();
            return;
          }
          response.on("data", (chunk) => {
            chunks.push(chunk);
            if (Buffer.concat(chunks).length > 20 * 1024 * 1024) {
              request.destroy(new Error("Response exceeds 20 MB"));
            }
          });
          response.on("end", () => {
            const body = Buffer.concat(chunks);
            const flatHeaders = {};
            Object.entries(response.headers).forEach(([k, v]) => {
              flatHeaders[k] = Array.isArray(v) ? v.join(", ") : v;
            });
            resolve({
              status: response.statusCode,
              finalUrl: parsedUrl.toString(),
              headers: flatHeaders,
              body: body.toString("base64"),
              binary: true,
            });
          });
          response.on("error", reject);
        }
      );
      request.on("timeout", () =>
        request.destroy(new Error("Request timed out"))
      );
      request.on("error", reject);
      if (config.body) request.write(config.body);
      request.end();
    });
  });
  ipcMain.handle("encrypt-data", async (event, config) => {
    const { TokenService } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let fingerprint = await TokenService.getFingerprint();
    let encrypted = encrypt(config.token, fingerprint);
    store.set("encryptedToken", encrypted);
    return "pong";
  });
  ipcMain.handle("decrypt-data", async (event) => {
    let encrypted = store.get("encryptedToken");
    if (!encrypted) return "";
    const { TokenService } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let fingerprint = await TokenService.getFingerprint();
    let decrypted = decrypt(encrypted, fingerprint);
    if (decrypted.startsWith("{") && decrypted.endsWith("}")) {
      return decrypted;
    } else {
      try {
        const { safeStorage } = require("electron");
        decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        let newEncrypted = encrypt(decrypted, fingerprint);
        store.set("encryptedToken", newEncrypted);
        return decrypted;
      } catch (error) {
        console.error("Decryption failed:", error);
        return "{}";
      }
    }
  });
  ipcMain.handle("check-cloud-url", async (event, config) => {
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");
    const { url } = config;
    return new Promise((resolve) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (e) {
        return resolve({ ok: false, reason: "invalid_url", detail: e.message });
      }
      const isHttps = parsedUrl.protocol === "https:";
      const lib = isHttps ? https : http;
      const port = parsedUrl.port
        ? parseInt(parsedUrl.port)
        : isHttps
          ? 443
          : 80;
      const options = {
        hostname: parsedUrl.hostname,
        port,
        path: parsedUrl.pathname || "/",
        method: "HEAD",
        timeout: 8000,
        rejectUnauthorized: true,
      };
      const req = lib.request(options, (res) => {
        resolve({
          ok: true,
          status: res.statusCode,
          detail: `HTTP ${res.statusCode}`,
        });
      });
      req.on("timeout", () => {
        req.destroy();
        resolve({
          ok: false,
          reason: "timeout",
          detail: `Connection to ${parsedUrl.hostname}:${port} timed out after 8s`,
        });
      });
      req.on("error", (err) => {
        let reason = "unknown";
        if (err.code === "ENOTFOUND") {
          reason = "dns_failed";
        } else if (err.code === "ECONNREFUSED") {
          reason = "connection_refused";
        } else if (err.code === "ECONNRESET") {
          reason = "connection_reset";
        } else if (err.code === "ETIMEDOUT") {
          reason = "timeout";
        } else if (
          err.code === "CERT_HAS_EXPIRED" ||
          err.code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
          err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
        ) {
          reason = "ssl_error";
        } else if (err.message && err.message.includes("SSL")) {
          reason = "ssl_error";
        }
        resolve({
          ok: false,
          reason,
          code: err.code || "",
          detail: err.message,
        });
      });
      req.end();
    });
  });
  ipcMain.handle("get-mac", async (event, config) => {
    const { machineIdSync } = require("node-machine-id");
    return machineIdSync();
  });
  ipcMain.handle("get-device-name", async () => {
    return os.hostname() || "";
  });
  ipcMain.handle("get-store-value", async (event, config) => {
    return store.get(config.key);
  });
  ipcMain.handle("get-biometric-capability", async () => {
    return await getBiometricCapability();
  });
  ipcMain.handle("prompt-biometric-auth", async (event, config) => {
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ||
      BrowserWindow.getFocusedWindow() ||
      mainWin ||
      null;
    return await promptBiometricAuth(config?.message, senderWindow);
  });

  ipcMain.handle("reset-reader-position", async (event) => {
    store.delete("windowX");
    store.delete("windowY");
    return "success";
  });
  ipcMain.handle("reset-main-position", async (event) => {
    store.delete("mainWinX");
    store.delete("mainWinY");
    app.relaunch();
    app.exit();
    return "success";
  });

  ipcMain.handle("select-zip-file", async (event, config) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Zip Files", extensions: ["zip"] }],
    });

    if (result.canceled) {
      return "";
    } else {
      const filePath = result.filePaths[0];
      return filePath;
    }
  });

  ipcMain.handle("select-book", async (event, config) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Books",
          extensions: [
            "epub",
            "pdf",
            "txt",
            "mobi",
            "azw3",
            "azw",
            "htm",
            "html",
            "xml",
            "xhtml",
            "mhtml",
            "docx",
            "md",
            "fb2",
            "cbz",
            "cbt",
            "cbr",
            "cb7",
          ],
        },
      ],
    });

    if (result.canceled) {
      console.info("User canceled the file selection");
      return [];
    } else {
      const filePaths = result.filePaths;
      console.info("Selected file path:", filePaths);
      return filePaths;
    }
  });
  ipcMain.handle("custom-database-command", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { query, storagePath, data, dbName, executeType } = config;
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    const row = db.prepare(query);
    let result;
    if (data && data.length > 0) {
      result = row[executeType](...data);
    } else {
      result = row[executeType]();
    }
    return result;
  });
  ipcMain.handle("database-command", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { statement, statementType, executeType, dbName, data, storagePath } =
      config;
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    let sql = "";
    if (statementType === "string") {
      sql = SqlStatement.sqlStatement[statement][dbName];
    } else if (statementType === "function") {
      sql = SqlStatement.sqlStatement[statement][dbName](data);
    }
    const row = db.prepare(sql);
    let result;
    if (data) {
      if (statement.startsWith("save") || statement.startsWith("update")) {
        data = SqlStatement.jsonToSqlite[dbName](data);
      }
      result = row[executeType](data);
    } else {
      result = row[executeType]();
    }
    if (executeType === "all") {
      return result.map((item) => SqlStatement.sqliteToJson[dbName](item));
    } else if (executeType === "get") {
      return SqlStatement.sqliteToJson[dbName](result);
    } else {
      return result;
    }
  });
  ipcMain.handle("close-database", async (event, config) => {
    const { SqlStatement } =
      await import("./src/assets/lib/kookit-extra.min.mjs");
    let { dbName, storagePath } = config;
    let db = getDBConnection(dbName, storagePath, SqlStatement.sqlStatement);
    delete dbConnection[dbName];
    // Flush WAL into the main .db file and flip to rollback journal mode so the
    // on-disk file is self-contained (header read/write version = 1, no -wal
    // dependency). Other consumers — e.g. the Expo app's expo-sqlite
    // deserializeDatabaseAsync — can only open a non-WAL SQLite image; without
    // this, backups restored there fail with "unable to open database file".
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.pragma("journal_mode = DELETE");
    } catch (error) {
      console.error("failed to checkpoint/switch journal mode:", error);
    }
    db.close();
  });
  ipcMain.handle("set-always-on-top", async (event, config) => {
    store.set("isAlwaysOnTop", config.isAlwaysOnTop);
    if (mainWin && !mainWin.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        mainWin.setAlwaysOnTop(true);
      } else {
        mainWin.setAlwaysOnTop(false);
      }
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        readerWindow.setAlwaysOnTop(true);
      } else {
        readerWindow.setAlwaysOnTop(false);
      }
    }
    return "pong";
  });
  ipcMain.handle("set-auto-maximize", async (event, config) => {
    store.set("isAutoMaximizeWin", config.isAutoMaximizeWin);
    if (mainWin && !mainWin.isDestroyed()) {
      if (config.isAutoMaximizeWin === "yes") {
        mainWin.maximize();
      } else {
        mainWin.unmaximize();
      }
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      if (config.isAlwaysOnTop === "yes") {
        readerWindow.setAlwaysOnTop(true);
      } else {
        readerWindow.setAlwaysOnTop(false);
      }
    }
    return "pong";
  });
  ipcMain.handle("toggle-auto-launch", async (event, config) => {
    app.setLoginItemSettings({
      openAtLogin: config.isAutoLaunch === "yes",
    });
    return "pong";
  });
  ipcMain.handle("toggle-minimize-to-tray", async (event, config) => {
    store.set("isMinimizeToTray", config.isMinimizeToTray);
    if (config.isMinimizeToTray === "no" && tray) {
      tray.destroy();
      tray = null;
    }
    return "pong";
  });
  ipcMain.handle("open-explorer-folder", async (event, config) => {
    const { shell } = require("electron");
    if (config.isFolder) {
      shell.openPath(config.path);
    } else {
      shell.showItemInFolder(config.path);
    }

    return "pong";
  });
  ipcMain.handle("get-debug-logs", async (event, config) => {
    const { shell } = require("electron");
    const file = log.transports.file.getFile();
    shell.showItemInFolder(file.path);
    return "pong";
  });

  ipcMain.on("user-data", (event, arg) => {
    event.returnValue = dirPath;
  });
  ipcMain.handle("hide-reader", (event, arg) => {
    if (
      readerWindow &&
      !readerWindow.isDestroyed() &&
      readerWindow.isFocused()
    ) {
      readerWindow.minimize();
      event.returnvalue = true;
    } else if (mainWin && mainWin.isFocused()) {
      mainWin.minimize();
      event.returnvalue = true;
    } else {
      event.returnvalue = false;
    }
  });
  ipcMain.handle("open-console", (event, arg) => {
    mainWin.webContents.openDevTools();
    event.returnvalue = true;
  });
  ipcMain.handle("reload-reader", (event, arg) => {
    if (readerWindowList.length > 0) {
      readerWindowList.forEach((win) => {
        if (
          win &&
          !win.isDestroyed() &&
          win.webContents.getURL().indexOf(arg.bookKey) > -1
        ) {
          win.reload();
        }
      });
    }
    if (
      readerWindow &&
      !readerWindow.isDestroyed() &&
      readerWindow.webContents.getURL().indexOf(arg.bookKey) > -1
    ) {
      readerWindow.reload();
    }
  });
  ipcMain.handle("reload-main", (event, arg) => {
    if (mainWin) {
      mainWin.reload();
    }
  });

  ipcMain.handle("clear-all-data", (event, config) => {
    store.clear();
  });
  ipcMain.handle("web-navigator-open", async (event, config) => {
    if (!mainWin || event.sender !== mainWin.webContents) return false;
    const url = normalizeWebNavigatorUrl(config?.url);
    const bounds = clampWebNavigatorBounds(config?.bounds);
    if (!url || !bounds) return false;
    const view = createWebNavigatorView(event.sender, config?.libraryPath);
    mainWin.contentView.addChildView(view);
    view.setBounds(bounds);
    return loadWebNavigatorUrl(view.webContents, url);
  });
  ipcMain.handle("web-navigator-navigate", async (event, value) => {
    if (!mainWin || event.sender !== mainWin.webContents) return false;
    const url = normalizeWebNavigatorUrl(value);
    if (!url || !webNavigatorView) return false;
    return loadWebNavigatorUrl(webNavigatorView.webContents, url);
  });
  ipcMain.handle("web-navigator-action", (event, action) => {
    if (
      !mainWin ||
      event.sender !== mainWin.webContents ||
      !webNavigatorView ||
      webNavigatorView.webContents.isDestroyed()
    ) {
      return false;
    }
    const contents = webNavigatorView.webContents;
    const history = contents.navigationHistory;
    if (action === "back" && history.canGoBack()) history.goBack();
    if (action === "forward" && history.canGoForward()) history.goForward();
    if (action === "reload") contents.reload();
    if (action === "stop") contents.stop();
    return true;
  });
  ipcMain.handle("web-navigator-resize", (event, value) => {
    if (
      !mainWin ||
      event.sender !== mainWin.webContents ||
      !webNavigatorView
    ) {
      return false;
    }
    const bounds = clampWebNavigatorBounds(value);
    if (!bounds) return false;
    webNavigatorView.setBounds(bounds);
    return true;
  });
  ipcMain.handle("web-navigator-close", (event) => {
    if (!mainWin || event.sender !== mainWin.webContents) return false;
    closeWebNavigatorView();
    return true;
  });
  ipcMain.handle("online-library-request", async (event, value) => {
    if (!mainWin || event.sender !== mainWin.webContents) {
      return { ok: false, error: "Invalid sender" };
    }
    const url = normalizeOnlineLibraryUrl(value);
    if (!url) return { ok: false, error: "Unsupported library URL" };
    try {
      const response = await net.fetch(url, {
        method: "GET",
        redirect: "follow",
        credentials: "omit",
        headers: {
          Accept: "application/atom+xml, application/epub+zip, application/xml",
          "User-Agent": `Books/${packageJson.version}`,
        },
      });
      const finalUrl = normalizeOnlineLibraryUrl(response.url);
      if (!response.ok || !finalUrl) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }
      const finalPath = new URL(finalUrl).pathname;
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const isCatalogResponse = finalPath.includes(".opds");
      if (
        (isCatalogResponse && !contentType.includes("xml")) ||
        (!isCatalogResponse &&
          !contentType.includes("application/epub+zip") &&
          !contentType.includes("application/octet-stream"))
      ) {
        return { ok: false, error: "Unexpected library response type" };
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > ONLINE_LIBRARY_MAX_BYTES) {
        return { ok: false, error: "Downloaded file is too large" };
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (data.byteLength > ONLINE_LIBRARY_MAX_BYTES) {
        return { ok: false, error: "Downloaded file is too large" };
      }
      return {
        ok: true,
        status: response.status,
        contentType,
        data,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  ipcMain.handle("weread-request", async (event, value) => {
    if (!mainWin || event.sender !== mainWin.webContents) {
      return { ok: false, error: "Invalid sender" };
    }
    const url = normalizeWeReadUrl(value?.url);
    const method = value?.method === "POST" ? "POST" : "GET";
    if (!url) return { ok: false, error: "Unsupported WeRead URL" };
    if (typeof value?.body === "string" && value.body.length > 256 * 1024) {
      return { ok: false, error: "Request body is too large" };
    }
    const incomingHeaders = value?.headers && typeof value.headers === "object"
      ? value.headers
      : {};
    const headers = {};
    [
      "vid",
      "accessToken",
      "User-Agent",
      "baseapi",
      "appver",
      "basever",
      "osver",
      "channelId",
      "Content-Type",
      "Accept",
    ].forEach((name) => {
      if (typeof incomingHeaders[name] === "string" && incomingHeaders[name].length <= 2048) {
        headers[name] = incomingHeaders[name];
      }
    });
    try {
      const response = await net.fetch(url, {
        method,
        redirect: "follow",
        credentials: "omit",
        headers,
        body: method === "POST" ? value.body || "{}" : undefined,
      });
      const finalUrl = normalizeWeReadUrl(response.url);
      if (!response.ok || !finalUrl) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("json")) {
        return { ok: false, error: "Unexpected WeRead response type" };
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 5 * 1024 * 1024) {
        return { ok: false, error: "WeRead response is too large" };
      }
      const text = await response.text();
      if (text.length > 5 * 1024 * 1024) {
        return { ok: false, error: "WeRead response is too large" };
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, error: "Invalid WeRead JSON response" };
      }
      return { ok: true, status: response.status, contentType, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  // Logged-in web sync channel: carries the partition session cookies so it can
  // reach the user's shelf/progress/annotation endpoints. Independent from
  // weread-request (which is credentials:"omit" + manual vid/accessToken).
  ipcMain.handle("weread-web-request", async (event, value) => {
    if (!mainWin || event.sender !== mainWin.webContents) {
      return { ok: false, error: "Invalid sender" };
    }
    const url = normalizeWeReadWebUrl(value?.url);
    if (!url) return { ok: false, error: "Unsupported WeRead URL" };
    try {
      const partitionSession = session.fromPartition(
        "persist:koodo-web-navigator"
      );
      const response = await partitionSession.fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "application/json" },
      });
      const finalUrl = normalizeWeReadWebUrl(response.url);
      if (!response.ok || !finalUrl) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (!contentType.includes("json")) {
        return { ok: false, error: "Unexpected WeRead response type" };
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 5 * 1024 * 1024) {
        return { ok: false, error: "WeRead response is too large" };
      }
      const text = await response.text();
      if (text.length > 5 * 1024 * 1024) {
        return { ok: false, error: "WeRead response is too large" };
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { ok: false, error: "Invalid WeRead JSON response" };
      }
      return { ok: true, status: response.status, contentType, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  // Zero-network login check: reads cookies persisted in the embedded-browser
  // partition after the user scanned the WeRead QR code.
  ipcMain.handle("weread-web-login-status", async (event) => {
    if (!mainWin || event.sender !== mainWin.webContents) {
      return { loggedIn: false };
    }
    try {
      const ses = session.fromPartition("persist:koodo-web-navigator");
      const allCookies = await ses.cookies.get({});
      const wereadCookies = allCookies.filter(
        (cookie) =>
          cookie.domain && cookie.domain.toLowerCase().includes("weread.qq.com")
      );
      const hasVid = wereadCookies.some(
        (cookie) => cookie.name === "wr_vid" && cookie.value
      );
      const hasSkey = wereadCookies.some(
        (cookie) => cookie.name === "wr_skey" && cookie.value
      );
      return { loggedIn: hasVid && hasSkey };
    } catch {
      return { loggedIn: false };
    }
  });
  ipcMain.handle("legado-request", async (event, value) => {
    if (!mainWin || event.sender !== mainWin.webContents) {
      return { ok: false, error: "Invalid sender" };
    }
    const url = buildLegadoUrl(value);
    const method = value?.endpoint === "saveBookProgress" ? "POST" : "GET";
    if (!url) return { ok: false, error: "Unsupported Legado request" };
    const body = method === "POST" ? JSON.stringify(value?.body || {}) : undefined;
    if (body && body.length > 256 * 1024) {
      return { ok: false, error: "Request body is too large" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await net.fetch(url, {
        method,
        redirect: "error",
        credentials: "omit",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": `Books/${packageJson.version}`,
        },
        body,
      });
      if (!response.ok) {
        return { ok: false, status: response.status, error: `HTTP ${response.status}` };
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 10 * 1024 * 1024) {
        return { ok: false, error: "Legado response is too large" };
      }
      const text = await response.text();
      if (text.length > 10 * 1024 * 1024) {
        return { ok: false, error: "Legado response is too large" };
      }
      try {
        return { ok: true, status: response.status, data: JSON.parse(text) };
      } catch {
        return { ok: false, error: "Invalid Legado JSON response" };
      }
    } catch (error) {
      return {
        ok: false,
        error:
          error?.name === "AbortError"
            ? "Legado request timed out"
            : error instanceof Error
              ? error.message
              : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  });
  ipcMain.handle("new-tab", (event, config) => {
    if (mainWin) {
      mainView = new WebContentsView(options);
      mainWin.contentView.addChildView(mainView);
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
      mainView.webContents.loadURL(config.url);
    }
  });
  ipcMain.handle("reload-tab", (event, config) => {
    if (mainWin && mainView) {
      mainView.webContents.reload();
    }
  });
  ipcMain.handle("adjust-tab-size", (event, config) => {
    if (mainWin && mainView) {
      let { width, height } = mainWin.getContentBounds();
      mainView.setBounds({ x: 0, y: 0, width: width, height: height });
    }
  });
  ipcMain.handle("exit-tab", (event, message) => {
    return new Promise((resolve) => {
      const doRemoveTab = () => {
        if (mainWin && mainView) {
          mainWin.contentView.removeChildView(mainView);
        }
        if (discordRPCClient) {
          try {
            discordRPCClient.clearActivity();
          } catch (e) {
            console.warn("Failed to clear Discord activity:", e.message);
          }
        }
        resolve(undefined);
      };

      // Ask the tab renderer to flush reading-time data first, then close
      if (mainView && !mainView.webContents.isDestroyed()) {
        const timeoutId = setTimeout(() => {
          // Fallback: if renderer doesn't reply within 3s, close anyway
          ipcMain.removeListener("tab-close-ready", onTabCloseReady);
          doRemoveTab();
        }, 3000);
        const onTabCloseReady = () => {
          clearTimeout(timeoutId);
          doRemoveTab();
        };
        ipcMain.once("tab-close-ready", onTabCloseReady);
        mainView.webContents.send("before-tab-close");
      } else {
        doRemoveTab();
      }
    });
  });
  ipcMain.handle("enter-tab-fullscreen", () => {
    if (mainWin && mainView) {
      mainWin.setFullScreen(true);
      console.info("enter full");
    }
  });
  ipcMain.handle("exit-tab-fullscreen", () => {
    if (mainWin && mainView) {
      mainWin.setFullScreen(false);
      console.info("exit full");
    }
  });
  ipcMain.handle("enter-fullscreen", () => {
    if (readerWindow) {
      readerWindow.setFullScreen(true);
      console.info("enter full");
    }
  });
  ipcMain.handle("exit-fullscreen", () => {
    if (readerWindow && !readerWindow.isDestroyed()) {
      readerWindow.setFullScreen(false);
      console.info("exit full");
    }
  });
  ipcMain.handle("open-url", async (event, config) => {
    if (config.type === "dict") {
      if (!dictWindow || dictWindow.isDestroyed()) {
        dictWindow = new BrowserWindow();
      }
      dictWindow.focus();
      await loadUrlInAuxWindow(dictWindow, config.url);
    } else if (config.type === "trans") {
      if (!transWindow || transWindow.isDestroyed()) {
        transWindow = new BrowserWindow();
      }
      transWindow.focus();
      await loadUrlInAuxWindow(transWindow, config.url);
    } else {
      if (!linkWindow || linkWindow.isDestroyed()) {
        linkWindow = new BrowserWindow();
      }
      linkWindow.loadURL(config.url);
      linkWindow.focus();
    }

    event.returnvalue = true;
  });
  ipcMain.handle("switch-moyu", (event, arg) => {
    let id;
    if (store.get("isPreventSleep") === "yes") {
      id = powerSaveBlocker.start("prevent-display-sleep");
      console.info(powerSaveBlocker.isStarted(id));
    }
    if (readerWindow && !readerWindow.isDestroyed()) {
      readerWindowReadyToClose = true;
      readerWindow.close();
      if (store.get("isMergeWord") === "yes") {
        delete options.backgroundColor;
      }
      const scaleRatio = store.get("windowDisplayScale") || 1;
      Object.assign(options, {
        width: parseInt(store.get("windowWidth") || 1050) / scaleRatio,
        height: parseInt(store.get("windowHeight") || 660) / scaleRatio,
        x: parseInt(store.get("windowX")),
        y: parseInt(store.get("windowY")),
        frame: store.get("isMergeWord") !== "yes" ? false : true,
        hasShadow: store.get("isMergeWord") !== "yes" ? false : true,
        transparent: store.get("isMergeWord") !== "yes" ? true : false,
      });

      store.set(
        "isMergeWord",
        store.get("isMergeWord") !== "yes" ? "yes" : "no"
      );
      if (readerWindow) {
        readerWindowList.push(readerWindow);
      }
      readerWindow = new BrowserWindow(options);
      if (store.get("isAlwaysOnTop") === "yes") {
        readerWindow.setAlwaysOnTop(true);
      }

      readerWindow.loadURL(store.get("url"));
      readerWindowReadyToClose = false;
      readerWindow.on("close", (event) => {
        // --- Step 1: ask renderer to flush reading-time data first ---
        if (
          !readerWindowReadyToClose &&
          readerWindow &&
          !readerWindow.isDestroyed()
        ) {
          event.preventDefault();
          readerWindow.webContents.send("before-reader-close");
          return;
        }
        // --- Step 2: actual close logic (reached after renderer replied) ---
        if (!readerWindow.isDestroyed()) {
          let bounds = readerWindow.getBounds();
          const currentDisplay = screen.getDisplayMatching(bounds);
          const primaryDisplay = screen.getPrimaryDisplay();
          if (bounds.width > 300 && bounds.height > 100) {
            store.set({
              windowWidth: bounds.width,
              windowHeight: bounds.height,
              windowX:
                readerWindow.isMaximized() &&
                currentDisplay.id === primaryDisplay.id
                  ? 0
                  : bounds.x,
              windowY:
                readerWindow.isMaximized() &&
                currentDisplay.id === primaryDisplay.id
                  ? 0
                  : bounds.y < 0
                    ? 0
                    : bounds.y,
            });
          }
        }
        if (store.get("isPreventSleep") && !readerWindow.isDestroyed()) {
          id && powerSaveBlocker.stop(id);
        }
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send("reading-finished", {});
        }
        if (discordRPCClient) {
          try {
            discordRPCClient.clearActivity();
          } catch (e) {
            console.warn("Failed to clear Discord activity:", e.message);
          }
        }
      });
      // Renderer finished flushing reading-time data — proceed with actual close
      ipcMain.once("reader-close-ready", () => {
        if (readerWindow && !readerWindow.isDestroyed()) {
          readerWindowReadyToClose = true;
          readerWindow.close();
        }
      });
    }
    event.returnvalue = false;
  });
  ipcMain.on("storage-location", (event, config) => {
    event.returnValue = path.join(dirPath, "data");
  });
  ipcMain.on("url-window-status", (event, config) => {
    if (config.type === "dict") {
      event.returnValue =
        dictWindow && !dictWindow.isDestroyed() ? true : false;
    } else if (config.type === "trans") {
      event.returnValue =
        transWindow && !transWindow.isDestroyed() ? true : false;
    } else {
      event.returnValue =
        linkWindow && !linkWindow.isDestroyed() ? true : false;
    }
  });
  ipcMain.on("get-dirname", (event, arg) => {
    event.returnValue = __dirname;
  });
  ipcMain.on("system-color", (event, arg) => {
    event.returnValue = getNativeDarkColorStatus() || false;
  });
  ipcMain.handle("set-native-theme-source", (event, appSkin) => {
    return applyNativeThemeSource(appSkin);
  });
  ipcMain.on("check-main-open", (event, arg) => {
    event.returnValue = mainWin ? true : false;
  });
  ipcMain.on("get-file-data", function (event) {
    if (fs.existsSync(path.join(dirPath, "log.json"))) {
      try {
        const _data = JSON.parse(
          fs.readFileSync(path.join(dirPath, "log.json"), "utf-8") || "{}"
        );
        if (_data && _data.filePath) {
          filePath = _data.filePath;
          setTimeout(() => {
            fs.writeFileSync(path.join(dirPath, "log.json"), "{}", "utf-8");
          }, 1000);
        }
      } catch (error) {
        console.error("Error reading log.json:", error);
      }
    }

    event.returnValue = filePath;
    filePath = null;
  });
  ipcMain.on("check-file-data", function (event) {
    if (fs.existsSync(path.join(dirPath, "log.json"))) {
      try {
        const _data = JSON.parse(
          fs.readFileSync(path.join(dirPath, "log.json"), "utf-8") || "{}"
        );
        if (_data && _data.filePath) {
          filePath = _data.filePath;
        }
      } catch (error) {
        console.error("Error reading log.json:", error);
      }
    }

    event.returnValue = filePath;
    filePath = null;
  });
  ipcMain.handle("system-ocr", async (event, config) => {
    const { base64, lang } = config || {};
    let tempPath = null;
    try {
      const { buffer, ext } = parseOcrImageInput(base64);
      tempPath = writeOcrTempImage(buffer, ext);
      const { macos, win } = resolveOcrLang(lang);
      let text = "";
      if (process.platform === "darwin") {
        text = await runMacosOcr(tempPath, macos);
      } else if (process.platform === "win32") {
        text = await runWindowsOcr(tempPath, win);
      } else {
        return {
          ok: false,
          error: "System OCR is only supported on Windows and macOS",
        };
      }
      return { ok: true, text };
    } catch (error) {
      log.error("system-ocr failed:", error.message);
      return { ok: false, error: error.message || "OCR failed" };
    } finally {
      if (tempPath) {
        try {
          fs.unlinkSync(tempPath);
        } catch (e) {
          // 忽略清理失败
        }
      }
    }
  });
};

// === 摸鱼快捷键 (stealth / slacking-off toggle) ===
// Inspired by ColorTxt's "摸鱼快捷键": one OS-level global hotkey instantly
// hides every Books window and removes it from the taskbar (Windows) / dock
// (macOS), so reading at work stays discreet. Pressing the same hotkey again
// restores every window exactly as it was (minimized windows re-minimize).
// Default Ctrl+`; works even when Books is not the focused app.
const DEFAULT_MOYU_ACCELERATOR = "Control+`";
// ColorTxt's signature Ctrl+` is commonly grabbed by terminals/IDEs on
// developer machines, so if the preferred accelerator is occupied we fall
// through this chain until one registers. The settings UI shows whichever key
// actually bound, so the user always knows the real hotkey.
const MOYU_ACCELERATOR_FALLBACKS = [
  "Control+`",
  "CommandOrControl+Shift+`",
  "CommandOrControl+Shift+H",
];
let moyuStealthActive = false;
let moyuRegisteredAccelerator = null;
const moyuMinimizedSnapshot = new Map(); // windowId -> wasMinimized

const getMoyuAccelerator = () => {
  const stored = store.get("moyuAccelerator");
  return typeof stored === "string" && stored.trim()
    ? stored.trim()
    : DEFAULT_MOYU_ACCELERATOR;
};
const isMoyuEnabled = () => store.get("moyuEnabled") !== false; // default on

// Validates an Electron accelerator string the user picked in settings. A global
// shortcut needs at least one modifier (Ctrl/Alt/Cmd/...) plus a real key, so we
// reject bare keys, modifier-only input, and unsupported key tokens before
// attempting to register — that way malformed choices are never persisted.
const MOYU_MODIFIERS = new Set([
  "Control", "Ctrl", "Command", "Cmd", "CommandOrControl", "Alt", "Option",
  "Shift", "Meta", "Super",
]);
const MOYU_KEYS = new Set([
  "Space", "Backspace", "Delete", "Insert", "Return", "Enter", "Up", "Down",
  "Left", "Right", "Home", "End", "PageUp", "PageDown", "Escape", "Esc", "Tab",
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
]);
const isValidMoyuAccelerator = (acc) => {
  if (typeof acc !== "string") return false;
  const parts = acc.split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return false; // modifier + key, at minimum
  const key = parts[parts.length - 1];
  if (MOYU_MODIFIERS.has(key)) return false; // ends on a modifier → no key
  const hasModifier = parts.slice(0, -1).some((p) => MOYU_MODIFIERS.has(p));
  if (!hasModifier) return false;
  return (
    /^[A-Za-z]$/.test(key) ||
    /^[0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    MOYU_KEYS.has(key)
  );
};

const toggleMoyuStealth = () => {
  const windows = BrowserWindow.getAllWindows();
  if (!moyuStealthActive) {
    // Enter stealth: remember each window's minimized state, then hide it and
    // drop it from the taskbar/dock so it leaves no trace.
    for (const win of windows) {
      if (win.isDestroyed()) continue;
      moyuMinimizedSnapshot.set(win.id, win.isMinimized());
      win.setSkipTaskbar(true);
      win.hide();
    }
    moyuStealthActive = true;
    if (process.platform === "darwin") {
      try {
        app.dock.hide();
      } catch {
        // dock API unavailable — ignore
      }
    }
    return;
  }
  // Exit stealth: restore visibility and each window's prior minimized state.
  moyuStealthActive = false;
  if (process.platform === "darwin") {
    try {
      app.dock.show();
    } catch {
      // dock API unavailable — ignore
    }
  }
  let firstFocusable = null;
  for (const win of windows) {
    if (win.isDestroyed()) continue;
    win.setSkipTaskbar(false);
    win.show();
    if (moyuMinimizedSnapshot.get(win.id)) {
      win.minimize();
    } else if (!firstFocusable) {
      firstFocusable = win;
    }
  }
  moyuMinimizedSnapshot.clear();
  if (firstFocusable) firstFocusable.focus();
};

const registerMoyuShortcut = () => {
  if (moyuRegisteredAccelerator) {
    try {
      globalShortcut.unregister(moyuRegisteredAccelerator);
    } catch {
      // already unregistered — ignore
    }
    moyuRegisteredAccelerator = null;
  }
  if (!isMoyuEnabled()) return;
  // If the user explicitly chose an accelerator, try only that one. Otherwise
  // walk the fallback chain so the feature works even when Ctrl+` is taken.
  const stored = store.get("moyuAccelerator");
  const candidates =
    typeof stored === "string" && stored.trim()
      ? [stored.trim()]
      : MOYU_ACCELERATOR_FALLBACKS;
  for (const accelerator of candidates) {
    try {
      if (globalShortcut.register(accelerator, toggleMoyuStealth)) {
        moyuRegisteredAccelerator = accelerator;
        if (accelerator !== DEFAULT_MOYU_ACCELERATOR) {
          log.info(
            `摸鱼快捷键已注册：${accelerator}（默认 ${DEFAULT_MOYU_ACCELERATOR} 被占用，已改用备选）`
          );
        }
        return;
      }
    } catch (error) {
      log.warn(
        `摸鱼快捷键注册异常（${accelerator}）：${
          error && error.message ? error.message : String(error)
        }`
      );
    }
  }
  log.warn("摸鱼快捷键注册失败：所有候选快捷键均被占用，可在设置中关闭");
};

ipcMain.handle("moyu-get-config", () => {
  const hasCustomKey = !!store.get("moyuAccelerator");
  return {
    enabled: isMoyuEnabled(),
    // Show the accelerator that actually registered (may differ from the
    // preferred Ctrl+` if it was occupied).
    accelerator: moyuRegisteredAccelerator || getMoyuAccelerator(),
    defaultAccelerator: DEFAULT_MOYU_ACCELERATOR,
    hasCustomKey, // true once the user has chosen their own hotkey
    active: moyuStealthActive,
  };
});
ipcMain.handle("moyu-set-enabled", (_event, enabled) => {
  store.set("moyuEnabled", !!enabled);
  registerMoyuShortcut();
  return { enabled: isMoyuEnabled() };
});
// Let the user pick their own hotkey in settings. `accelerator` is an Electron
// accelerator string (e.g. "Control+Alt+P"); pass null/"" to clear the custom
// choice and fall back to the built-in chain. We try to register the candidate
// live so we can tell the user immediately if it's already taken.
ipcMain.handle("moyu-set-accelerator", (_event, raw) => {
  // null / empty => reset to the built-in fallback chain
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
    if (moyuRegisteredAccelerator) {
      try { globalShortcut.unregister(moyuRegisteredAccelerator); } catch {}
      moyuRegisteredAccelerator = null;
    }
    try { store.delete("moyuAccelerator"); } catch {}
    registerMoyuShortcut();
    return {
      ok: true,
      reset: true,
      accelerator: moyuRegisteredAccelerator,
      hasCustomKey: false,
    };
  }

  const candidate = String(raw).trim();
  if (!isValidMoyuAccelerator(candidate)) {
    // Don't touch the live binding; just reject the malformed input.
    return {
      ok: false,
      reason: "invalid",
      accelerator: moyuRegisteredAccelerator,
      hasCustomKey: !!store.get("moyuAccelerator"),
    };
  }

  // Step aside from the current binding so the candidate is tested fairly.
  const prev = moyuRegisteredAccelerator;
  if (prev) {
    try { globalShortcut.unregister(prev); } catch {}
    moyuRegisteredAccelerator = null;
  }

  const enabled = isMoyuEnabled();
  let bound = false;
  if (enabled) {
    try { bound = !!globalShortcut.register(candidate, toggleMoyuStealth); } catch {}
  }

  if (bound) {
    store.set("moyuAccelerator", candidate);
    moyuRegisteredAccelerator = candidate;
    return { ok: true, accelerator: candidate, hasCustomKey: true };
  }

  // Valid key, but we couldn't bind it right now (feature off, or the key is
  // occupied by another app). Remember the choice for the next enable, then
  // restore whatever was bound before so the feature keeps working.
  store.set("moyuAccelerator", candidate);
  if (enabled) {
    if (prev) {
      try { globalShortcut.register(prev, toggleMoyuStealth); moyuRegisteredAccelerator = prev; } catch {}
    }
    if (!moyuRegisteredAccelerator) registerMoyuShortcut();
  }
  return {
    ok: false,
    reason: enabled ? "occupied" : "disabled",
    pending: true,
    accelerator: moyuRegisteredAccelerator,
    hasCustomKey: true,
  };
});

app.on("ready", () => {
  createMainWin();
  registerMoyuShortcut();
});
app.on("before-quit", () => {
  isQuitting = true;
  destroyDiscordRPC();
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
  app.quit();
});
app.on("open-file", (e, pathToFile) => {
  filePath = pathToFile;
});
// Register protocol handler
app.setAsDefaultProtocolClient("books-reader");
const serializeArg = (arg) => {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};
const originalConsoleLog = console.log;
console.log = function (...args) {
  originalConsoleLog(...args); // 保留原日志
  log.info(args.map(serializeArg).join(" ")); // 写入日志文件
};
const originalConsoleError = console.error;
console.error = function (...args) {
  originalConsoleError(...args); // 保留原错误日志
  log.error(args.map(serializeArg).join(" ")); // 写入错误日志文件
};
const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  originalConsoleWarn(...args); // 保留原警告日志
  log.warn(args.map(serializeArg).join(" ")); // 写入警告日志文件
};
const originalConsoleInfo = console.info;
console.info = function (...args) {
  originalConsoleInfo(...args); // 保留原信息日志
  log.info(args.map(serializeArg).join(" ")); // 写入信息日志文件
};
// Handle MacOS deep linking
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleCallback(url);
});
const handleCallback = (url) => {
  try {
    // 检查 URL 是否有效
    if (!url.startsWith("books-reader://")) {
      console.error("Invalid URL format:", url);
      return;
    }

    // 解析 URL
    const parsedUrl = new URL(url);
    const code = parsedUrl.searchParams.get("code");
    const state = parsedUrl.searchParams.get("state");
    const pickerData = parsedUrl.searchParams.get("pickerData");

    const bookKey = parsedUrl.searchParams.get("bookKey");
    const noteKey = parsedUrl.searchParams.get("noteKey");
    const importUrl = parsedUrl.searchParams.get("importUrl");

    if (code && mainWin) {
      mainWin.webContents.send("oauth-callback", { code, state });
    }
    if (pickerData && mainWin) {
      let config = JSON.parse(decodeURIComponent(pickerData));
      mainWin.webContents.send("picker-finished", config);
    }
    if (bookKey && mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("open-book-from-link", { bookKey });
    }
    if (noteKey && mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("open-note-from-link", { noteKey });
    }
    if (importUrl && mainWin) {
      const decodedUrl = decodeURIComponent(importUrl);
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.show();
      mainWin.focus();
      mainWin.webContents.send("import-url-from-link", { url: decodedUrl });
    }
  } catch (error) {
    console.error("Error handling callback URL:", error);
    console.info("Problematic URL:", url);
  }
};
