import DOMPurify from "dompurify";
import React from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { RouteComponentProps } from "react-router-dom";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { applySymbolColoring, getDefaultSymbolColorRules, parseSymbolColorRules, SymbolColorRule } from "../../utils/reader/symbolColorUtil";
import { LegadoBook, LegadoChapter, LegadoProgress, LegadoServerConfig } from "../../models/Legado";
import {
  getLegadoBookshelf,
  getLegadoChapters,
  getLegadoContent,
  getLegadoCoverUrl,
  normalizeLegadoBaseUrl,
  saveLegadoProgress,
} from "../../services/legado/legadoClient";
import {
  getLegadoServers,
  getLocalLegadoProgress,
  saveLegadoServers,
  saveLocalLegadoProgress,
  getCachedLegadoContent,
  saveCachedLegadoContent,
} from "../../services/legado/legadoStorage";
import "./legado.css";

interface Props extends RouteComponentProps {
  t: (key: string) => string;
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
    };
  })();

  componentDidMount() {
    document.body.classList.add("legado-route-active");
    window.addEventListener("keydown", this.handleEscape, true);
    if (this.selectedServer) this.loadBookshelf();
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
    }, () => this.selectedServer && this.loadBookshelf());
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
    }, this.loadBookshelf);
  };

  loadBookshelf = () => {
    const server = this.selectedServer;
    if (!server) return;
    this.run(async () => {
      const books = await getLegadoBookshelf(server);
      this.setState({ books });
      toast.success(`${this.props.t("Bookshelf refreshed")}: ${books.length}`);
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

  cacheCurrentChapter = async () => {
    const { selectedBook: book, selectedChapter: chapter, content } = this.state;
    const server = this.selectedServer;
    if (!server || !book || !chapter || !content) return;
    saveCachedLegadoContent(server.id, book.bookUrl, chapter.index, content);
    toast.success("本章内容已缓存");
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
    this.run(() => this.loadChapter(book, chapter));
  };

  writeProgress = async (book: LegadoBook, chapter: LegadoChapter, chapterPos: number) => {
    const server = this.selectedServer;
    if (!server) return;
    const progress: LegadoProgress = {
      chapterIndex: chapter.index,
      chapterPos: Math.max(0, Math.round(chapterPos)),
      chapterTitle: chapter.title,
      updateTime: Date.now(),
    };
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
          <header><div><small>LEGADO SERVICE</small><h2><Trans>Add Legado server</Trans></h2></div>{this.state.servers.length > 0 && <button className="legado-icon" onClick={() => this.setState({ editing: false })}>×</button>}</header>
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

  renderColorPanel() {
    return (
      <div className="legado-popover-root">
        <div className="legado-popover-backdrop" onClick={this.togglePalette} />
        <div className="legado-color-card" role="dialog" aria-modal="true">
          <header>
            <div>
              <small>READER</small>
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
        <header><button onClick={() => { this.persistCurrentProgress(); this.setState({ selectedBook: null, selectedChapter: null, content: "" }); }}>← <Trans>Back to bookshelf</Trans></button><div><strong>{book.name}</strong><small>{chapter.title}</small></div><button onClick={() => this.moveChapter(-1)} disabled={this.state.loading}>‹</button><button onClick={() => this.moveChapter(1)} disabled={this.state.loading}>›</button><button onClick={this.cacheCurrentChapter} title="缓存本章">⇩</button><button className="legado-tool-highlight" onClick={this.togglePalette} title={this.props.t("Symbol coloring")} aria-label={this.props.t("Symbol coloring")}><svg className="legado-tool-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3" /><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" /></svg></button><button onClick={() => this.setState({ fontSize: Math.max(12, this.state.fontSize - 1) })}>A−</button><button onClick={() => this.setState({ fontSize: Math.min(30, this.state.fontSize + 1) })}>A＋</button><button onClick={() => this.setState({ sepia: !this.state.sepia })}>◐</button><button onClick={this.toggleFullscreen} title="全屏阅读">⛶</button></header>
        <div className="legado-reader-body">
          <aside>{this.state.chapters.map((item) => <button className={item.index === chapter.index ? "active" : ""} key={`${item.index}-${item.url}`} onClick={() => this.openChapter(item)}><span>{item.index + 1}</span>{item.title}</button>)}<button className="legado-toc-toggle" onClick={() => this.setState({ tocCollapsed: !this.state.tocCollapsed })} title={this.state.tocCollapsed ? "展开目录" : "收起目录"}>{this.state.tocCollapsed ? "›" : "‹"}</button></aside>
          <article ref={this.readerRef}>
            {this.state.loading ? <div className="legado-loading"><i /><Trans>Loading chapter...</Trans></div> : <div className="legado-prose" style={{ fontSize: this.state.fontSize, lineHeight: this.state.lineHeight, maxWidth: this.state.contentWidth }} dangerouslySetInnerHTML={{ __html: renderContent(this.state.content, chapter.title) }} />}
          </article>
        </div>
        {this.state.highlightPalette && this.renderColorPanel()}
      </div>
    );
  }

  render() {
    if (this.state.selectedBook && this.state.selectedChapter) return this.renderReader();
    const filter = this.state.filter.trim().toLowerCase();
    const books = this.state.books.filter((book) => !filter || `${book.name} ${book.author}`.toLowerCase().includes(filter));
    return (
      <div className="legado-page">
        <aside className="legado-sources">
          <header><div><small>REMOTE SHELVES</small><h2>Legado</h2></div><button className="legado-icon" onClick={() => this.setState({ draft: emptyServer(), editing: true })}>＋</button></header>
          {this.state.servers.map((server) => <button key={server.id} className={`legado-server ${server.id === this.state.selectedServerId ? "active" : ""}`} onClick={() => this.selectServer(server)}><span>阅</span><div><strong>{server.name}</strong><small>{server.serverType === "android" ? "Android · LAN" : "Reader · Remote"}</small></div><i onClick={(event) => { event.stopPropagation(); this.setState({ draft: { ...server }, editing: true }); }}>•••</i></button>)}
          {this.selectedServer && <button className="legado-delete" onClick={() => this.deleteServer(this.selectedServer!)}><Trans>Delete server</Trans></button>}
        </aside>
        <main className="legado-library">
          <header className="legado-hero"><div><small>LEGADO WEB</small><h1>{this.selectedServer?.name || this.props.t("Legado bookshelf")}</h1><p><Trans>Read the books on your phone and sync chapter progress in both directions.</Trans></p></div><button onClick={this.loadBookshelf} disabled={!this.selectedServer || this.state.loading}>↻ <Trans>Refresh bookshelf</Trans></button></header>
          <div className="legado-search"><span>⌕</span><input value={this.state.filter} onChange={(event) => this.setState({ filter: event.target.value })} placeholder={this.props.t("Search title or author")} /><em>{books.length}</em></div>
          {this.state.error && <pre className="legado-error">{this.state.error}</pre>}
          {this.state.loading && !this.state.selectedBook && <div className="legado-loading"><i /><Trans>Connecting to Legado...</Trans></div>}
          {!this.state.loading && this.selectedServer && books.length === 0 && !this.state.error && <div className="legado-empty"><span>阅</span><h3><Trans>No books returned</Trans></h3><p><Trans>Make sure the phone Web service is running, then refresh the bookshelf.</Trans></p></div>}
          <section className="legado-book-grid">{books.map((book) => <button key={book.bookUrl} className="legado-book" onClick={() => this.openBook(book)}><div className="legado-cover">{book.coverUrl && this.selectedServer ? <img src={getLegadoCoverUrl(this.selectedServer, book.coverUrl)} alt="" /> : <span>书</span>}<em>{book.durChapterIndex > 0 ? `${book.durChapterIndex + 1}` : "NEW"}</em></div><strong>{book.name}</strong><small>{book.author || this.props.t("Unknown author")}</small><p>{book.durChapterTitle || book.latestChapterTitle || book.originName}</p></button>)}</section>
        </main>
        {this.state.editing && this.renderConfig()}
      </div>
    );
  }
}

export default Legado;
