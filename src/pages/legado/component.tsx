import DOMPurify from "dompurify";
import React from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { RouteComponentProps } from "react-router-dom";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { applySymbolColoring, getDefaultSymbolColorRules, parseSymbolColorRules, SymbolColorRule } from "../../utils/reader/symbolColorUtil";
import { LegadoBook, LegadoCachedBook, LegadoChapter, LegadoProgress, LegadoServerConfig } from "../../models/Legado";
import {
  getLegadoBookshelf,
  getLegadoChapters,
  getLegadoContent,
  getLegadoCoverUrl,
  normalizeLegadoBaseUrl,
  saveLegadoProgress,
} from "../../services/legado/legadoClient";
import {
  getCachedLegadoBooks,
  getCachedLegadoContent,
  getCachedLegadoChapters,
  getLegadoServers,
  getLocalLegadoProgress,
  removeCachedLegadoBook,
  saveCachedLegadoBook,
  saveCachedLegadoContent,
  saveLegadoServers,
  saveLocalLegadoProgress,
} from "../../services/legado/legadoStorage";
import "./legado.css";

interface Props extends RouteComponentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  handleMode: (mode: string) => void;
}
interface State {
  servers: LegadoServerConfig[];
  selectedServerId: string;
  editing: boolean;
  draft: LegadoServerConfig;
  books: LegadoBook[];
  filter: string;
  selectedBook: LegadoBook | null;
  chapters: LegadoChapter[];
  selectedChapter: LegadoChapter | null;
  content: string;
  loading: boolean;
  error: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  sepia: boolean;
  tocCollapsed: boolean;
  symbolEnabled: boolean;
  symbolRules: SymbolColorRule[];
  highlightPalette: boolean;
  cachePopup: boolean;
  cacheCount: number;
  caching: { label: string; done: number; total: number; lastError: string } | null;
  view: "online" | "cached";
  cachedBooks: LegadoCachedBook[];
  offline: boolean;
  offlineServerId: string;
  hasRequestedBookshelf: boolean;
}

const emptyServer = (): LegadoServerConfig => ({
  id: `legado-${Date.now()}`,
  name: "手机阅读",
  baseUrl: "http://192.168.1.100:1122",
  serverType: "android",
  accessToken: "",
});

const renderContent = (value: string, chapterTitle = ""): string => {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(value);
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = looksLikeHtml
    ? value
    : (() => {
        const lines = value.split(/\r?\n/);
        const firstIdx = lines.findIndex((line) => line.trim());
        const first = firstIdx >= 0 ? lines[firstIdx].trim() : "";
        const title = chapterTitle.trim();
        const hasTitle = !!title && first.replace(/\s+/g, " ") === title.replace(/\s+/g, " ");
        const bodyStart = hasTitle ? firstIdx + 1 : 0;
        // Each non-empty line becomes its own <p> so every paragraph shares the
        // same first-line indent (text-indent: 2em) and alignment. Splitting on
        // blank lines alone merges single-newline paragraphs into one block and
        // only indents its first line.
        const paragraphs = lines
          .slice(bodyStart)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => `<p>${escape(line)}</p>`)
          .join("");
        return (hasTitle ? `<h2>${escape(title)}</h2>` : "") + paragraphs;
      })();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
};

class Legado extends React.Component<Props, State> {
  private readerRef = React.createRef<HTMLDivElement>();

  state: State = (() => {
    const servers = getLegadoServers();
    return {
      servers,
      selectedServerId: servers[0]?.id || "",
      editing: servers.length === 0,
      draft: emptyServer(),
      books: [],
      filter: "",
      selectedBook: null,
      chapters: [],
      selectedChapter: null,
      content: "",
      loading: false,
      error: "",
      fontSize: 17,
      lineHeight: 2,
      contentWidth: 720,
      sepia: false,
      tocCollapsed: false,
      symbolEnabled: ConfigService.getReaderConfig("isSymbolColoring") === "yes",
      symbolRules: parseSymbolColorRules(ConfigService.getReaderConfig("symbolColorRules")),
      highlightPalette: false,
      cachePopup: false,
      cacheCount: 10,
      caching: null,
      view: "online",
      cachedBooks: getCachedLegadoBooks(),
      offline: false,
      offlineServerId: "",
      hasRequestedBookshelf: false,
    };
  })();

  componentDidMount() {
    document.body.classList.add("legado-route-active");
    window.addEventListener("keydown", this.handleEscape, true);
  }

  componentWillUnmount() {
    document.body.classList.remove("legado-route-active");
    window.removeEventListener("keydown", this.handleEscape, true);
    this.persistCurrentProgress();
  }

  componentDidUpdate() {
    const content = this.readerRef.current?.querySelector(".legado-prose") as HTMLElement | null;
    if (!content || ConfigService.getReaderConfig("isSymbolColoring") !== "yes") return;
    const doc = document.implementation.createHTMLDocument("legado-preview");
    doc.body.innerHTML = content.innerHTML;
    applySymbolColoring(doc, parseSymbolColorRules(ConfigService.getReaderConfig("symbolColorRules")));
    if (content.innerHTML !== doc.body.innerHTML) content.innerHTML = doc.body.innerHTML;
  }

  handleEscape = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) return;
      if (!this.state.selectedBook || !this.state.selectedChapter || this.state.loading) return;
      event.preventDefault();
      event.stopPropagation();
      this.moveChapter(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (this.state.editing && this.state.servers.length > 0) {
      this.setState({ editing: false, error: "" });
      return;
    }
    if (this.state.selectedBook) {
      this.persistCurrentProgress();
      this.setState({
        selectedBook: null,
        chapters: [],
        selectedChapter: null,
        content: "",
        error: "",
        offline: false,
        offlineServerId: "",
      });
      return;
    }
    this.props.handleMode("home");
    this.props.history.push("/manager/home");
  };

  get selectedServer(): LegadoServerConfig | null {
    return this.state.servers.find((server) => server.id === this.state.selectedServerId) || null;
  }

  run = async (task: () => Promise<void>) => {
    this.setState({ loading: true, error: "" });
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ error: message });
      toast.error(message);
    } finally {
      this.setState({ loading: false });
    }
  };

  saveServer = () => {
    try {
      const draft = {
        ...this.state.draft,
        name: this.state.draft.name.trim() || "Legado",
        baseUrl: normalizeLegadoBaseUrl(this.state.draft.baseUrl),
        accessToken: this.state.draft.accessToken.trim(),
      };
      const existing = this.state.servers.some((server) => server.id === draft.id);
      const servers = existing
        ? this.state.servers.map((server) => server.id === draft.id ? draft : server)
        : [...this.state.servers, draft];
      saveLegadoServers(servers);
      this.setState({ servers, selectedServerId: draft.id, editing: false, books: [], selectedBook: null }, this.loadBookshelf);
      toast.success(this.props.t("Legado server saved"));
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  deleteServer = (server: LegadoServerConfig) => {
    if (!window.confirm(`${this.props.t("Delete")} “${server.name}”?`)) return;
    const servers = this.state.servers.filter((item) => item.id !== server.id);
    saveLegadoServers(servers);
    this.setState({
      servers,
      selectedServerId: servers[0]?.id || "",
      editing: servers.length === 0,
      draft: emptyServer(),
      books: [],
      selectedBook: null,
      chapters: [],
      selectedChapter: null,
      content: "",
      hasRequestedBookshelf: false,
    });
  };

  selectServer = (server: LegadoServerConfig) => {
    this.persistCurrentProgress();
    this.setState({
      selectedServerId: server.id,
      books: [],
      selectedBook: null,
      chapters: [],
      selectedChapter: null,
      content: "",
      error: "",
      hasRequestedBookshelf: false,
    });
  };

  loadBookshelf = () => {
    const server = this.selectedServer;
    if (!server) return;
    this.setState({ hasRequestedBookshelf: true }, () => {
      this.run(async () => {
        const books = await getLegadoBookshelf(server);
        this.setState({ books });
        toast.success(`${this.props.t("Bookshelf refreshed")}: ${books.length}`);
      });
    });
  };

  openBook = (book: LegadoBook) => {
    const server = this.selectedServer;
    if (!server) return;
    this.persistCurrentProgress();
    this.run(async () => {
      const chapters = await getLegadoChapters(server, book);
      const local = getLocalLegadoProgress(server.id, book.bookUrl);
      const remote: LegadoProgress = {
        chapterIndex: book.durChapterIndex,
        chapterPos: book.durChapterPos,
        chapterTitle: book.durChapterTitle,
        updateTime: book.durChapterTime,
      };
      const progress = local && local.updateTime > remote.updateTime ? local : remote;
      const chapter = chapters.find((item) => item.index === progress.chapterIndex) || chapters[0] || null;
      this.setState({ selectedBook: book, chapters, selectedChapter: null, content: "", highlightPalette: false });
      if (chapter) await this.loadChapter(book, chapter, progress.chapterPos);
    });
  };

  loadChapter = async (book: LegadoBook, chapter: LegadoChapter, chapterPos = 0) => {
    const server = this.selectedServer;
    if (!server) return;
    this.persistCurrentProgress();
    const cached = getCachedLegadoContent(server.id, book.bookUrl, chapter.index);
    const content = cached || await getLegadoContent(server, book, chapter.index);
    this.setState({ selectedChapter: chapter, content }, () => {
      const reader = this.readerRef.current;
      if (reader) {
        const ratio = content.length > 0 ? Math.min(1, chapterPos / content.length) : 0;
        reader.scrollTop = ratio * Math.max(0, reader.scrollHeight - reader.clientHeight);
      }
    });
    await this.writeProgress(book, chapter, chapterPos);
  };

  // Offline chapter load: reads only from the local cache, never the phone.
  // Used when a cached book is opened from the "已缓存" library, so it works
  // without a server connection. Uncached chapters render as a placeholder.
  loadCachedChapter = async (book: LegadoBook, chapter: LegadoChapter, chapterPos = 0) => {
    const serverId = this.state.offlineServerId;
    if (!serverId) return;
    this.setState({ loading: true });
    try {
      const content = getCachedLegadoContent(serverId, book.bookUrl, chapter.index);
      this.setState({ selectedChapter: chapter, content }, () => {
        const reader = this.readerRef.current;
        if (reader) {
          const ratio = content.length > 0 ? Math.min(1, chapterPos / content.length) : 0;
          reader.scrollTop = ratio * Math.max(0, reader.scrollHeight - reader.clientHeight);
        }
      });
      if (content) {
        const progress: LegadoProgress = {
          chapterIndex: chapter.index,
          chapterPos: Math.max(0, Math.round(chapterPos)),
          chapterTitle: chapter.title,
          updateTime: Date.now(),
        };
        saveLocalLegadoProgress(serverId, book.bookUrl, progress);
      }
    } finally {
      this.setState({ loading: false });
    }
  };

  openCachedBook = (record: LegadoCachedBook) => {
    this.persistCurrentProgress();
    const chapters = record.chapters;
    const local = getLocalLegadoProgress(record.serverId, record.bookUrl);
    const chapter = chapters.find((item) => item.index === local?.chapterIndex) || chapters[0] || null;
    this.setState({
      selectedBook: record,
      chapters,
      selectedChapter: null,
      content: "",
      offline: true,
      offlineServerId: record.serverId,
      highlightPalette: false,
    });
    if (chapter) this.loadCachedChapter(record, chapter, local?.chapterPos || 0);
  };

  removeCachedBook = (record: LegadoCachedBook) => {
    if (!window.confirm(`${this.props.t("Delete")} “${record.name}”?`)) return;
    const cachedBooks = removeCachedLegadoBook(record.serverId, record.bookUrl);
    this.setState({ cachedBooks });
    toast.success(this.props.t("Done"));
  };

  cacheCurrentChapter = async () => {
    const { selectedBook: book, selectedChapter: chapter, content } = this.state;
    const server = this.selectedServer;
    if (!server || !book || !chapter || !content) return;
    saveCachedLegadoContent(server.id, book.bookUrl, chapter.index, content);
    this.upsertCachedBookRecord();
    toast.success(this.props.t("Cached current chapter"));
    this.setState({ cachePopup: false });
  };

  // Fetches and stores chapter contents sequentially. Skips chapters that are
  // already cached so re-running "cache all" only fills the gaps. A separate
  // `caching` state tracks progress without hijacking the reader's `loading`
  // flag (which would blank out the current chapter with the loading spinner).
  //
  // Legado's Android web service triggers a book-source load per uncached
  // chapter; firing these back-to-back overwhelms the source (or Legado's own
  // source-load thread pool), which is why only the first few chapters succeed
  // and the rest time out / return isSuccess:false. We throttle with a small
  // inter-request delay and retry once with backoff to ride out the queue.
  cacheChapters = async (
    chapters: LegadoChapter[],
    label: string
  ): Promise<{ total: number; failed: number; lastError: string }> => {
    const { selectedBook: book } = this.state;
    const server = this.selectedServer;
    if (!server || !book) return { total: 0, failed: 0, lastError: "" };
    const total = chapters.length;
    let done = 0;
    let failed = 0;
    let lastError = "";
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    this.setState({ caching: { label, done, total, lastError } });
    for (const chapter of chapters) {
      try {
        const existing = getCachedLegadoContent(server.id, book.bookUrl, chapter.index);
        if (!existing) {
          let fetched: string | null = null;
          let attemptError = "";
          for (let attempt = 0; attempt < 2 && !fetched; attempt++) {
            try {
              if (attempt > 0) await delay(1200 * attempt);
              fetched = await getLegadoContent(server, book, chapter.index);
            } catch (error) {
              attemptError = error instanceof Error ? error.message : String(error);
            }
          }
          if (!fetched) {
            lastError = attemptError;
            throw new Error(attemptError);
          }
          saveCachedLegadoContent(server.id, book.bookUrl, chapter.index, fetched);
        }
      } catch (error) {
        failed++;
        lastError = error instanceof Error ? error.message : String(error);
      }
      done++;
      this.setState({ caching: { label, done, total, lastError } });
      await delay(400);
    }
    return { total, failed, lastError };
  };

  // Upsert a book into the offline cached-books index: stores metadata +
  // full chapter list (TOC) so the book can be browsed without the phone.
  upsertCachedBookRecord = () => {
    const { selectedBook: book, chapters } = this.state;
    const server = this.selectedServer;
    if (!server || !book || !chapters.length) return;
    let cachedCount = 0;
    for (const chapter of chapters) {
      if (getCachedLegadoContent(server.id, book.bookUrl, chapter.index)) cachedCount++;
    }
    const record: LegadoCachedBook = {
      ...book,
      serverId: server.id,
      serverName: server.name,
      chapters: chapters.map((chapter) => ({ index: chapter.index, title: chapter.title, url: chapter.url })),
      cachedAt: Date.now(),
      cachedCount,
    };
    const cachedBooks = saveCachedLegadoBook(record);
    this.setState({ cachedBooks });
  };

  reportCacheResult = (result: { total: number; failed: number; lastError: string }) => {
    const { total, failed, lastError } = result;
    if (total === 0) return;
    if (failed === 0) {
      toast.success(this.props.t("Cached N chapters", { count: total }));
    } else {
      toast.error(
        `${this.props.t("Cached chapters with failures", { done: total - failed, total, failed })}${lastError ? ` · ${lastError}` : ""}`,
        { duration: 6000 }
      );
    }
  };

  cacheAll = async () => {
    const { chapters } = this.state;
    if (!chapters.length) return;
    const result = await this.cacheChapters(chapters, this.props.t("Cache all"));
    this.setState({ caching: null });
    this.upsertCachedBookRecord();
    if (result.total > 0 && result.failed === 0) {
      toast.success(this.props.t("Cached all chapters", { total: result.total }));
    } else {
      this.reportCacheResult(result);
    }
  };

  cacheCustom = async () => {
    const { chapters, selectedChapter, cacheCount } = this.state;
    if (!selectedChapter) return;
    const start = chapters.findIndex((item) => item.index === selectedChapter.index);
    if (start < 0) return;
    const count = Math.max(1, Math.min(cacheCount || 1, chapters.length - start));
    const slice = chapters.slice(start, start + count);
    const result = await this.cacheChapters(slice, this.props.t("Cache next chapters"));
    this.setState({ caching: null });
    this.upsertCachedBookRecord();
    this.reportCacheResult(result);
  };

  toggleFullscreen = async () => {
    const element = document.querySelector(".legado-reader") as HTMLElement | null;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      toast.error("当前环境不支持全屏阅读");
    }
  };

  togglePalette = () =>
    this.setState((state) => ({ highlightPalette: !state.highlightPalette }));

  toggleSymbolColor = () => {
    const symbolEnabled = !this.state.symbolEnabled;
    this.setState({ symbolEnabled });
    ConfigService.setReaderConfig("isSymbolColoring", symbolEnabled ? "yes" : "no");
    this.forceUpdate();
  };

  updateSymbolRule = (id: string, patch: Partial<SymbolColorRule>) => {
    this.setState({
      symbolRules: this.state.symbolRules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule
      ),
    });
  };

  addSymbolRule = () => {
    this.setState({
      symbolRules: [
        ...this.state.symbolRules,
        { id: `rule-${Date.now()}`, start: "(", end: ")", color: "#b487d8", enabled: true },
      ],
    });
  };

  deleteSymbolRule = (id: string) => {
    this.setState({ symbolRules: this.state.symbolRules.filter((rule) => rule.id !== id) });
  };

  restoreSymbolRules = () => {
    this.setState({ symbolRules: getDefaultSymbolColorRules() });
  };

  applySymbolRules = () => {
    const symbolRules = this.state.symbolRules.filter(
      (rule) => rule.start.trim() && rule.end.trim()
    );
    this.setState({ symbolRules });
    ConfigService.setReaderConfig("symbolColorRules", JSON.stringify(symbolRules));
    toast.success(this.props.t("Symbol color rules applied"));
    this.forceUpdate();
  };

  openChapter = (chapter: LegadoChapter) => {
    const book = this.state.selectedBook;
    if (!book) return;
    if (this.state.offline) {
      this.persistCurrentProgress();
      this.loadCachedChapter(book, chapter);
      return;
    }
    this.run(() => this.loadChapter(book, chapter));
  };

  writeProgress = async (book: LegadoBook, chapter: LegadoChapter, chapterPos: number) => {
    const progress: LegadoProgress = {
      chapterIndex: chapter.index,
      chapterPos: Math.max(0, Math.round(chapterPos)),
      chapterTitle: chapter.title,
      updateTime: Date.now(),
    };
    // Offline: only persist locally, never push to the phone.
    if (this.state.offline) {
      const serverId = this.state.offlineServerId;
      if (serverId) saveLocalLegadoProgress(serverId, book.bookUrl, progress);
      return;
    }
    const server = this.selectedServer;
    if (!server) return;
    saveLocalLegadoProgress(server.id, book.bookUrl, progress);
    await saveLegadoProgress(server, book, progress);
  };

  persistCurrentProgress = () => {
    const { selectedBook, selectedChapter, content } = this.state;
    const reader = this.readerRef.current;
    if (!selectedBook || !selectedChapter || !reader || !content) return;
    const scrollable = Math.max(1, reader.scrollHeight - reader.clientHeight);
    const chapterPos = (reader.scrollTop / scrollable) * content.length;
    this.writeProgress(selectedBook, selectedChapter, chapterPos).catch(() => undefined);
  };

  moveChapter = (offset: number) => {
    const current = this.state.selectedChapter;
    if (!current) return;
    const position = this.state.chapters.findIndex((chapter) => chapter.index === current.index);
    const target = this.state.chapters[position + offset];
    if (target) this.openChapter(target);
  };

  renderConfig() {
    const draft = this.state.draft;
    return (
      <div className="legado-modal" role="dialog" aria-modal="true">
        <section className="legado-config-card">
          <header><div><h2><Trans>Add Legado server</Trans></h2></div>{this.state.servers.length > 0 && <button className="legado-icon" onClick={() => this.setState({ editing: false })}>×</button>}</header>
          <label><span><Trans>Name</Trans></span><input value={draft.name} onChange={(event) => this.setState({ draft: { ...draft, name: event.target.value } })} /></label>
          <label><span><Trans>Server type</Trans></span><select value={draft.serverType} onChange={(event) => this.setState({ draft: { ...draft, serverType: event.target.value as "android" | "reader" } })}><option value="android">开源阅读（Android）</option><option value="reader">Reader 服务端</option></select></label>
          <label><span><Trans>Server address</Trans></span><input value={draft.baseUrl} onChange={(event) => this.setState({ draft: { ...draft, baseUrl: event.target.value } })} placeholder="http://192.168.1.100:1122" /></label>
          {draft.serverType === "reader" && <label><span>Access Token</span><input type="password" value={draft.accessToken} onChange={(event) => this.setState({ draft: { ...draft, accessToken: event.target.value } })} placeholder="username:token" /></label>}
          <p><Trans>Android Legado must have Web service enabled and be on the same network.</Trans></p>
          <footer><button className="primary" onClick={this.saveServer}><Trans>Save and connect</Trans></button></footer>
        </section>
      </div>
    );
  }

  renderCachePanel() {
    const { caching, chapters, selectedChapter, cacheCount } = this.state;
    const total = chapters.length;
    const start = selectedChapter
      ? chapters.findIndex((item) => item.index === selectedChapter.index)
      : -1;
    const maxForward = start >= 0 ? chapters.length - start : 0;
    const busy = !!caching;
    const pct = caching && caching.total > 0 ? Math.round((caching.done / caching.total) * 100) : 0;
    return (
      <div className="legado-popover-root">
        <div className="legado-popover-backdrop" onClick={() => { if (!busy) this.setState({ cachePopup: false }); }} />
        <div className="legado-color-card" role="dialog" aria-modal="true">
          <header>
            <div><h2><Trans>Cache chapters</Trans></h2></div>
            <button className="legado-icon" disabled={busy} onClick={() => this.setState({ cachePopup: false })}>×</button>
          </header>
          <div className="legado-cache-list">
            <button className="legado-cache-item" disabled={busy || total === 0} onClick={this.cacheAll}>
              <span><Trans>Cache all</Trans></span>
              <small>{total}</small>
            </button>
            <button className="legado-cache-item" disabled={busy} onClick={this.cacheCurrentChapter}>
              <span><Trans>Cache current chapter</Trans></span>
            </button>
            <div className="legado-cache-custom">
              <span><Trans>Cache next chapters</Trans></span>
              <div className="legado-cache-custom-row">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, maxForward)}
                  value={cacheCount}
                  disabled={busy}
                  onChange={(event) => this.setState({ cacheCount: Math.max(1, Number(event.target.value) || 1) })}
                />
                <button
                  className="primary"
                  disabled={busy || maxForward <= 0}
                  onClick={this.cacheCustom}
                ><Trans>Cache</Trans></button>
              </div>
              <p><Trans>Cache forward from the current chapter</Trans></p>
            </div>
          </div>
          {caching && (
            <div className="legado-cache-progress">
              <div className="legado-cache-progress-row">
                <span>{caching.label}</span>
                <em>{caching.done}/{caching.total}</em>
              </div>
              <i><em style={{ width: `${pct}%` }} /></i>
              {caching.lastError && <p className="legado-cache-error">{caching.lastError}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  renderColorPanel() {    return (
      <div className="legado-popover-root">
        <div className="legado-popover-backdrop" onClick={this.togglePalette} />
        <div className="legado-color-card" role="dialog" aria-modal="true">
          <header>
            <div>
              <h2><Trans>Symbol coloring</Trans></h2>
            </div>
            <button className="legado-icon" onClick={this.togglePalette}>×</button>
          </header>
          <p className="legado-color-hint">
            <Trans>Color only the text between matching symbols. Rules can span inline formatting and paragraphs.</Trans>
          </p>
          <div className="legado-symbol-toggle">
            <span><Trans>Symbol coloring</Trans></span>
            <button
              className={`legado-switch ${this.state.symbolEnabled ? "on" : ""}`}
              onClick={this.toggleSymbolColor}
              aria-pressed={this.state.symbolEnabled}
              aria-label={this.props.t("Symbol coloring")}
            >
              <i />
            </button>
          </div>
          {this.state.symbolEnabled && (
            <div className="legado-symbol-rules">
              {this.state.symbolRules.map((rule) => (
                <div className="legado-symbol-rule" key={rule.id}>
                  <input
                    className="legado-symbol-sym"
                    value={rule.start}
                    maxLength={12}
                    onChange={(event) => this.updateSymbolRule(rule.id, { start: event.target.value })}
                    aria-label={this.props.t("Start")}
                  />
                  <span className="legado-symbol-arrow">→</span>
                  <input
                    className="legado-symbol-sym"
                    value={rule.end}
                    maxLength={12}
                    onChange={(event) => this.updateSymbolRule(rule.id, { end: event.target.value })}
                    aria-label={this.props.t("End")}
                  />
                  <label className="legado-symbol-color">
                    <input
                      type="color"
                      value={rule.color}
                      onChange={(event) => this.updateSymbolRule(rule.id, { color: event.target.value })}
                      aria-label={this.props.t("Color")}
                    />
                  </label>
                  <button
                    className="legado-symbol-delete"
                    onClick={() => this.deleteSymbolRule(rule.id)}
                    aria-label={this.props.t("Delete rule")}
                  >
                    ×
                  </button>
                  <div className="legado-symbol-preview">
                    {rule.start}<span style={{ color: rule.color }}><Trans>Example text</Trans></span>{rule.end}
                  </div>
                </div>
              ))}
              <div className="legado-symbol-actions">
                <button onClick={this.addSymbolRule}><Trans>Add rule</Trans></button>
                <button onClick={this.restoreSymbolRules}><Trans>Restore defaults</Trans></button>
                <button className="primary" onClick={this.applySymbolRules}><Trans>Apply rules</Trans></button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  renderReader() {
    const { selectedBook: book, selectedChapter: chapter } = this.state;
    if (!book || !chapter) return null;
    return (
      <div className={`legado-reader ${this.state.sepia ? "legado-sepia" : ""} ${this.state.tocCollapsed ? "legado-toc-collapsed" : ""}`}>
        <header><button onClick={() => { this.persistCurrentProgress(); this.setState({ selectedBook: null, selectedChapter: null, content: "", offline: false, offlineServerId: "" }); }}>← <Trans>Back to bookshelf</Trans></button><div><strong>{book.name}</strong><small>{chapter.title}</small></div><button onClick={() => this.moveChapter(-1)} disabled={this.state.loading}>‹</button><button onClick={() => this.moveChapter(1)} disabled={this.state.loading}>›</button>{!this.state.offline && <button onClick={() => this.setState({ cachePopup: true })} title={this.props.t("Cache chapters")}>⇩</button>}<button className="legado-tool-highlight" onClick={this.togglePalette} title={this.props.t("Symbol coloring")} aria-label={this.props.t("Symbol coloring")}><svg className="legado-tool-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></svg></button><button onClick={() => this.setState({ fontSize: Math.max(12, this.state.fontSize - 1) })}>A−</button><button onClick={() => this.setState({ fontSize: Math.min(30, this.state.fontSize + 1) })}>A＋</button><button onClick={() => this.setState({ sepia: !this.state.sepia })}>◐</button><button onClick={this.toggleFullscreen} title="全屏阅读">⛶</button></header>
        <div className="legado-reader-body">
          <aside>{this.state.chapters.map((item) => <button className={item.index === chapter.index ? "active" : ""} key={`${item.index}-${item.url}`} onClick={() => this.openChapter(item)}><span>{item.index + 1}</span>{item.title}</button>)}<button className="legado-toc-toggle" onClick={() => this.setState({ tocCollapsed: !this.state.tocCollapsed })} title={this.state.tocCollapsed ? "展开目录" : "收起目录"}>{this.state.tocCollapsed ? "›" : "‹"}</button></aside>
          <article ref={this.readerRef}>
            {this.state.loading ? <div className="legado-loading"><i /><Trans>Loading chapter...</Trans></div> : this.state.content ? <div className="legado-prose" style={{ fontSize: this.state.fontSize, lineHeight: this.state.lineHeight, maxWidth: this.state.contentWidth }} dangerouslySetInnerHTML={{ __html: renderContent(this.state.content, chapter.title) }} /> : <div className="legado-empty"><span>阅</span><h3><Trans>This chapter is not cached</Trans></h3><p><Trans>Open the book while connected and cache it, then read offline.</Trans></p></div>}
          </article>
        </div>
        {this.state.highlightPalette && this.renderColorPanel()}
        {this.state.cachePopup && this.renderCachePanel()}
      </div>
    );
  }

  render() {
    if (this.state.selectedBook && this.state.selectedChapter) return this.renderReader();
    const { view, cachedBooks } = this.state;
    const filter = this.state.filter.trim().toLowerCase();
    const onlineBooks = this.state.books.filter((book) => !filter || `${book.name} ${book.author}`.toLowerCase().includes(filter));
    const offlineBooks = cachedBooks.filter((book) => !filter || `${book.name} ${book.author}`.toLowerCase().includes(filter));
    const isCached = view === "cached";
    return (
      <div className="legado-page">
        <aside className="legado-sources">
          <header><div><h2><Trans>Legado</Trans></h2></div><button className="legado-icon" onClick={() => this.setState({ draft: emptyServer(), editing: true })}>＋</button></header>
          {this.state.servers.map((server) => <button key={server.id} className={`legado-server ${server.id === this.state.selectedServerId ? "active" : ""}`} onClick={() => this.selectServer(server)}><span>阅</span><div><strong>{server.name}</strong><small>{server.serverType === "android" ? "Android · LAN" : "Reader · Remote"}</small></div><i onClick={(event) => { event.stopPropagation(); this.setState({ draft: { ...server }, editing: true }); }}>•••</i></button>)}
          {this.selectedServer && <button className="legado-delete" onClick={() => this.deleteServer(this.selectedServer!)}><Trans>Delete server</Trans></button>}
        </aside>
        <main className="legado-library">
          <header className="legado-hero"><div><h1>{isCached ? this.props.t("Cached books") : (this.selectedServer?.name || this.props.t("Legado bookshelf"))}</h1><p><Trans>Read the books on your phone and sync chapter progress in both directions.</Trans></p></div>{!isCached && <button onClick={this.loadBookshelf} disabled={!this.selectedServer || this.state.loading}>↻ <Trans>Connect and refresh</Trans></button>}</header>
          <div className="legado-tabs">
            <button className={!isCached ? "active" : ""} onClick={() => this.setState({ view: "online" })}><Trans>Legado bookshelf</Trans></button>
            <button className={isCached ? "active" : ""} onClick={() => this.setState({ view: "cached", cachedBooks: getCachedLegadoBooks() })}><Trans>Cached books</Trans> <em>{cachedBooks.length}</em></button>
          </div>
          <div className="legado-search"><span>⌕</span><input value={this.state.filter} onChange={(event) => this.setState({ filter: event.target.value })} placeholder={this.props.t("Search title or author")} /><em>{isCached ? offlineBooks.length : onlineBooks.length}</em></div>
          {this.state.error && <pre className="legado-error">{this.state.error}</pre>}
          {!isCached && this.state.loading && !this.state.selectedBook && <div className="legado-loading"><i /><Trans>Connecting to Legado...</Trans></div>}
          {!isCached && !this.state.loading && this.selectedServer && onlineBooks.length === 0 && !this.state.error && (
            this.state.hasRequestedBookshelf
              ? <div className="legado-empty"><span>阅</span><h3><Trans>No books returned</Trans></h3><p><Trans>Make sure the phone Web service is running, then refresh the bookshelf.</Trans></p></div>
              : <div className="legado-empty"><span>阅</span><h3><Trans>Not connected yet</Trans></h3><p><Trans>Click Connect and refresh when you want to load your phone bookshelf.</Trans></p></div>
          )}
          {isCached && offlineBooks.length === 0 && <div className="legado-empty"><span>阅</span><h3><Trans>No cached books</Trans></h3><p><Trans>Open a book while connected and cache it, then read it here offline.</Trans></p></div>}
          <section className="legado-book-grid">
            {isCached
              ? offlineBooks.map((book) => (
                  <div key={`${book.serverId}:${book.bookUrl}`} className="legado-book legado-book-cached">
                    <button className="legado-book-open" onClick={() => this.openCachedBook(book)}>
                      <div className="legado-cover"><span>书</span><em>{book.cachedCount}/{book.chapters.length}</em></div>
                      <strong>{book.name}</strong>
                      <small>{book.author || this.props.t("Unknown author")}</small>
                      <p>{book.serverName}</p>
                    </button>
                    <button className="legado-book-remove" title={this.props.t("Delete")} onClick={() => this.removeCachedBook(book)}>×</button>
                  </div>
                ))
              : onlineBooks.map((book) => <button key={book.bookUrl} className="legado-book" onClick={() => this.openBook(book)}><div className="legado-cover">{book.coverUrl && this.selectedServer ? <img src={getLegadoCoverUrl(this.selectedServer, book.coverUrl)} alt="" /> : <span>书</span>}<em>{book.durChapterIndex > 0 ? `${book.durChapterIndex + 1}` : "NEW"}</em></div><strong>{book.name}</strong><small>{book.author || this.props.t("Unknown author")}</small><p>{book.durChapterTitle || book.latestChapterTitle || book.originName}</p></button>)}
          </section>
        </main>
        {this.state.editing && this.renderConfig()}
      </div>
    );
  }
}

export default Legado;
