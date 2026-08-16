import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  LegadoBookSource,
  isLoginCapableSource,
  parseLegadoSourcesJson,
} from "../../services/legadoSource/legadoSourceModel";
import {
  addLegadoSources,
  getLegadoSources,
  removeLegadoSource,
  setLegadoSourceEnabled,
} from "../../services/legadoSource/legadoSourceStorage";
import {
  LegadoBook,
  LegadoChapter,
  LegadoSearchItem,
  LegadoSourceSearchResult,
  assembleTxt,
  ensureLegadoEngineReady,
  legadoGetBookInfo,
  legadoGetChapterContent,
  legadoGetChapterListPage,
  preloadLegadoChapterContent,
  legadoSearch,
  legadoSearchAll,
} from "../../services/legadoSource/legadoEngineClient";
import { addSourceShelfBook } from "../../services/legadoSource/sourceShelfStorage";
import { fetchLegadoSourceJson } from "../../services/legadoSource/legadoSourceRemote";
import { parseWeReadLegacySource } from "../../services/onlineLibrary/weReadLegacy";
import { saveWeReadConfig } from "../../services/onlineLibrary/weReadStorage";
import BookModel from "../../models/Book";
import BookUtil from "../../utils/file/bookUtil";
import { calculateFileMD5 } from "../../utils/common";
import "./bookSources.css";

interface BookSourcesProps {
  t: (key: string) => string;
  history?: { push: (path: string) => void };
  /** Redux-held import entry from ImportLocal (getMd5WithBrowser). */
  importBookFunc?: (file: File) => Promise<void>;
  handleReadingBook: (book: BookModel) => void;
}

interface BookSourcesState {
  sources: LegadoBookSource[];
  selectedSourceUrl: string;
  keyword: string;
  results: LegadoSourceSearchResult[];
  activeSource: LegadoBookSource | null;
  failedSourceCount: number;
  searchProgress: { completed: number; total: number } | null;
  detail: LegadoBook | null;
  chapters: LegadoChapter[];
  chapterCursors: string[];
  content: string;
  contentTitle: string;
  isImporting: boolean;
  importMode: "paste" | "url";
  importText: string;
  importUrl: string;
  isImportingUrl: boolean;
  isLoading: boolean;
  isLoadingMoreChapters: boolean;
  loadingLabel: string;
  error: string;
  isDownloading: boolean;
  openAfterDownload: boolean;
  downloadProgress: string;
}

const LEGADO_ENGINE_MISSING = "legado-engine-not-ready";
const ALL_SOURCES = "__all-enabled-sources__";

const mergeChapterPages = (
  current: LegadoChapter[],
  incoming: LegadoChapter[]
): LegadoChapter[] => {
  const seen = new Set(
    current.map((chapter) => String(chapter.url || chapter.title || ""))
  );
  return current.concat(
    incoming.filter((chapter) => {
      const key = String(chapter.url || chapter.title || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
  );
};

class BookSources extends React.Component<BookSourcesProps, BookSourcesState> {
  fileInput = React.createRef<HTMLInputElement>();
  private searchRunId = 0;
  private loadingMoreChapters = false;

  constructor(props: BookSourcesProps) {
    super(props);
    const sources = getLegadoSources();
    this.state = {
      sources,
      selectedSourceUrl: sources.length ? ALL_SOURCES : "",
      keyword: "",
      results: [],
      activeSource: null,
      failedSourceCount: 0,
      searchProgress: null,
      detail: null,
      chapters: [],
      chapterCursors: [],
      content: "",
      contentTitle: "",
      isImporting: false,
      importMode: "paste",
      importText: "",
      importUrl: "",
      isImportingUrl: false,
      isLoading: false,
      isLoadingMoreChapters: false,
      loadingLabel: "",
      error: "",
      isDownloading: false,
      openAfterDownload: false,
      downloadProgress: "",
    };
  }

  get selectedSource(): LegadoBookSource | null {
    return (
      this.state.sources.find(
        (source) => source.bookSourceUrl === this.state.selectedSourceUrl
      ) || null
    );
  }

  refreshSources = (preferredUrl?: string) => {
    const sources = getLegadoSources();
    const selectedSourceUrl =
      preferredUrl && sources.some((s) => s.bookSourceUrl === preferredUrl)
        ? preferredUrl
        : this.state.selectedSourceUrl === ALL_SOURCES && sources.length
          ? ALL_SOURCES
        : sources.some((s) => s.bookSourceUrl === this.state.selectedSourceUrl)
          ? this.state.selectedSourceUrl
          : sources[0]?.bookSourceUrl || "";
    this.setState({ sources, selectedSourceUrl });
  };

  handleSelectSource = (sourceUrl: string) => {
    this.searchRunId += 1;
    this.setState({
      selectedSourceUrl: sourceUrl,
      results: [],
      activeSource: null,
      failedSourceCount: 0,
      searchProgress: null,
      detail: null,
      chapters: [],
      chapterCursors: [],
      content: "",
      error: "",
    });
  };

  handleToggleSource = (source: LegadoBookSource) => {
    setLegadoSourceEnabled(source.bookSourceUrl, source.enabled === false);
    this.refreshSources(source.bookSourceUrl);
  };

  handleDeleteSource = (source: LegadoBookSource) => {
    if (!window.confirm(`${this.props.t("Delete")} “${source.bookSourceName}”?`))
      return;
    removeLegadoSource(source.bookSourceUrl);
    this.refreshSources();
    this.setState({ results: [], detail: null, chapters: [], chapterCursors: [], content: "" });
    toast.success(this.props.t("Deletion successful"));
  };

  importSources = (text: string) => {
    const legacyWeRead = parseWeReadLegacySource(text);
    if (legacyWeRead) {
      saveWeReadConfig(legacyWeRead);
      this.setState({ isImporting: false, importText: "", importUrl: "", error: "" });
      toast.success("已导入微信读书书源；请在微信读书页面填写授权参数");
      this.props.history?.push("/manager/weread");
      return;
    }
    const sources = parseLegadoSourcesJson(text);
    if (!sources.length) {
      this.setState({
        error: this.props.t(
          "No valid Legado sources found: each needs bookSourceUrl, bookSourceName and ruleSearch"
        ),
      });
      return;
    }
    const added = addLegadoSources(sources);
    this.setState(
      { isImporting: false, importText: "", importUrl: "", error: "" },
      () => this.refreshSources(sources[0]?.bookSourceUrl)
    );
    toast.success(
      `${this.props.t("Imported successfully")}: ${added} / ${sources.length}`
    );
  };

  handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    this.importSources(await file.text());
  };

  handleImportUrl = async () => {
    const value = this.state.importUrl.trim();
    if (!value) {
      toast.error(this.props.t("Please enter a URL"));
      return;
    }
    this.setState({ isImportingUrl: true, error: "" });
    try {
      const json = await fetchLegadoSourceJson(value);
      this.importSources(json);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = this.props.t(rawMessage);
      this.setState({ error: message });
      toast.error(`${this.props.t("Import failed")}: ${message}`);
    } finally {
      this.setState({ isImportingUrl: false });
    }
  };

  runTask = async (label: string, task: () => Promise<void>) => {
    if (!(await ensureLegadoEngineReady())) {
      const message = this.props.t(
        "Install and enable the Legado Book Sources plugin first"
      );
      this.setState({ error: message });
      toast.error(message);
      return;
    }
    this.setState({ isLoading: true, loadingLabel: label, error: "" });
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shown =
        message === LEGADO_ENGINE_MISSING
          ? this.props.t("Install and enable the Legado Book Sources plugin first")
          : message;
      this.setState({ error: shown });
      toast.error(shown);
    } finally {
      this.setState({ isLoading: false, loadingLabel: "" });
    }
  };

  handleSearch = () => {
    const source = this.selectedSource;
    const keyword = this.state.keyword.trim();
    const enabledSources = this.state.sources.filter(
      (item) => item.enabled !== false
    );
    const isAllSources = this.state.selectedSourceUrl === ALL_SOURCES;
    if ((!isAllSources && !source) || (isAllSources && !enabledSources.length)) {
      toast.error(this.props.t("Please import a book source first"));
      return;
    }
    if (source?.enabled === false) {
      toast.error(this.props.t("Please enable this book source first"));
      return;
    }
    if (!keyword) {
      toast.error(this.props.t("Please enter a keyword"));
      return;
    }
    const searchRunId = ++this.searchRunId;
    this.setState({
      results: [],
      detail: null,
      chapters: [],
      chapterCursors: [],
      content: "",
      failedSourceCount: 0,
      searchProgress: isAllSources
        ? { completed: 0, total: enabledSources.length }
        : null,
    });
    this.runTask(this.props.t("Searching..."), async () => {
      const outcome = isAllSources
        ? await legadoSearchAll(enabledSources, keyword, 1, (progress) => {
            if (searchRunId !== this.searchRunId) return;
            this.setState({
              results: progress.results,
              failedSourceCount: progress.failedSources.length,
              searchProgress: {
                completed: progress.completedSources,
                total: progress.totalSources,
              },
            });
          })
        : {
            results: (await legadoSearch(source!, keyword)).map((book) => ({
              source: source!,
              book,
            })),
            failedSources: [],
          };
      if (searchRunId !== this.searchRunId) return;
      const results = outcome.results;
      if (!results.length) {
        toast(this.props.t("No results"));
      }
      this.setState({
        results,
        activeSource: null,
        failedSourceCount: outcome.failedSources.length,
        detail: null,
        chapters: [],
        chapterCursors: [],
        content: "",
      });
    });
  };

  handleOpenBook = ({ source, book: item }: LegadoSourceSearchResult) => {
    this.runTask(this.props.t("Loading book detail..."), async () => {
      const parsedDetail = await legadoGetBookInfo(source, item);
      const detail: LegadoBook = {
        ...parsedDetail,
        bookUrl: parsedDetail.bookUrl || item.bookUrl,
        name: parsedDetail.name || item.name,
        author: parsedDetail.author || item.author || "",
      };
      this.setState({
        activeSource: source,
        detail,
        chapters: [],
        chapterCursors: [],
        content: "",
        loadingLabel: this.props.t("Loading chapters..."),
      });
      const page = await legadoGetChapterListPage(source, detail);
      this.setState({
        chapters: page.chapters,
        chapterCursors: page.nextTocUrls,
      });
      void preloadLegadoChapterContent(
        source,
        detail,
        page.chapters[0],
        page.chapters[1],
        page.chapters.map((chapter) => String(chapter.url || "")).filter(Boolean)
      );
    });
  };

  loadNextChapterPage = async (): Promise<void> => {
    const { activeSource: source, detail, chapterCursors } = this.state;
    const cursor = chapterCursors[0];
    if (!source || !detail || !cursor || this.loadingMoreChapters) return;
    this.loadingMoreChapters = true;
    this.setState({ isLoadingMoreChapters: true });
    try {
      const page = await legadoGetChapterListPage(source, detail, cursor);
      this.setState((state) => ({
        chapters: mergeChapterPages(state.chapters, page.chapters),
        chapterCursors: [...state.chapterCursors.slice(1), ...page.nextTocUrls],
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingMoreChapters = false;
      this.setState({ isLoadingMoreChapters: false });
    }
  };

  loadAllChapterPages = async (
    source: LegadoBookSource,
    detail: LegadoBook,
    initial: LegadoChapter[],
    initialCursors: string[]
  ): Promise<LegadoChapter[]> => {
    let chapters = initial;
    const cursors = [...initialCursors];
    const visited = new Set<string>();
    while (cursors.length) {
      const cursor = cursors.shift()!;
      if (visited.has(cursor)) continue;
      visited.add(cursor);
      const page = await legadoGetChapterListPage(source, detail, cursor);
      chapters = mergeChapterPages(chapters, page.chapters);
      page.nextTocUrls.forEach((next) => {
        if (!visited.has(next)) cursors.push(next);
      });
    }
    this.setState({ chapters, chapterCursors: [] });
    return chapters;
  };

  handleOpenChapter = (chapter: LegadoChapter, index: number) => {
    const source = this.state.activeSource;
    const detail = this.state.detail;
    if (!source || !detail) return;
    this.runTask(this.props.t("Loading chapter..."), async () => {
      const content = await legadoGetChapterContent(
        source,
        detail,
        chapter,
        this.state.chapters[index + 1],
        this.state.chapters.map((item) => String(item.url || "")).filter(Boolean)
      );
      this.setState({
        content,
        contentTitle: chapter.title || `#${index + 1}`,
      });
    });
  };

  /** Downloads the book, imports it through Koodo's normal pipeline and optionally opens it. */
  handleDownloadBook = async (openAfterDownload = false) => {
    const source = this.state.activeSource;
    const detail = this.state.detail;
    let chapters = this.state.chapters;
    if (!source || !detail || !chapters.length) return;
    if (!this.props.importBookFunc) {
      toast.error(this.props.t("Open the library page first, then try again"));
      return;
    }
    this.setState({
      isDownloading: true,
      openAfterDownload,
      downloadProgress: `0/${chapters.length}`,
    });
    try {
      chapters = await this.loadAllChapterPages(
        source,
        detail,
        chapters,
        this.state.chapterCursors
      );
      const parts: { title: string; content: string }[] = [];
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        const content = await legadoGetChapterContent(
          source,
          detail,
          chapter,
          chapters[index + 1],
          chapters.map((item) => String(item.url || "")).filter(Boolean)
        );
        parts.push({ title: chapter.title || `第${index + 1}章`, content });
        this.setState({
          downloadProgress: `${index + 1}/${chapters.length}`,
        });
      }
      const title = detail.name || this.props.t("Untitled");
      const author = detail.author || "";
      const txt = assembleTxt(title, author, parts);
      const fileName = `${title}.txt`.replace(/[\\/:*?"<>|]/g, " ");
      const file = new File([txt], fileName, { type: "text/plain" });
      const md5 = await calculateFileMD5(file);
      await this.props.importBookFunc(file);
      const importedBook = md5 ? await BookUtil.getBookByMd5(md5) : null;
      if (!importedBook) {
        throw new Error(this.props.t("The book was downloaded but could not be opened"));
      }
      if (openAfterDownload) {
        this.props.handleReadingBook(importedBook);
        await BookUtil.redirectBook(importedBook);
      } else {
        toast.success(this.props.t("Added to library"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${this.props.t("Download failed")}: ${message}`);
    } finally {
      this.setState({
        isDownloading: false,
        openAfterDownload: false,
        downloadProgress: "",
      });
    }
  };

  handleReadOnline = () => {
    const { activeSource: source, detail, chapters, chapterCursors } = this.state;
    if (!source || !detail || !chapters.length) return;
    const record = addSourceShelfBook(source, detail, chapters, chapterCursors);
    toast.success(this.props.t("Added to online bookshelf"));
    this.props.history?.push(`/manager/sourceShelf?book=${encodeURIComponent(record.id)}`);
  };

  renderSourceRail = () => (
    <aside className="book-source-rail">
      <div className="book-source-rail-heading">
        <div>
          <h2>
            <Trans>Book Sources</Trans>
          </h2>
        </div>
        <button
          className="book-source-icon-button"
          title={this.props.t("Import JSON")}
          onClick={() => this.fileInput.current?.click()}
        >
          <span className="icon-add" />
        </button>
      </div>
      <input
        ref={this.fileInput}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={this.handleFile}
      />
      <div className="book-source-import-actions">
        <button onClick={() => this.fileInput.current?.click()}>
          <Trans>Import JSON</Trans>
        </button>
        <button
          onClick={() =>
            this.setState({
              isImporting: true,
              importMode: "paste",
              importText: "",
              importUrl: "",
              error: "",
            })
          }
        >
          <Trans>Paste or create</Trans>
        </button>
        <button
          onClick={() =>
            this.setState({
              isImporting: true,
              importMode: "url",
              importText: "",
              importUrl: "",
              error: "",
            })
          }
        >
          <Trans>Import from URL</Trans>
        </button>
      </div>
      <div className="book-source-list">
        {this.state.sources.length === 0 && (
          <div className="book-source-empty-rail">
            <Trans>No book sources yet</Trans>
            <small>
              <Trans>Import a Legado book source JSON to begin.</Trans>
            </small>
          </div>
        )}
        {this.state.sources.length > 0 && (
          <div
            className={`book-source-card book-source-all-card ${
              this.state.selectedSourceUrl === ALL_SOURCES ? "active" : ""
            }`}
            onClick={() => this.handleSelectSource(ALL_SOURCES)}
          >
            <div className="book-source-card-topline">
              <span className="book-source-status on" />
              <strong><Trans>All enabled sources</Trans></strong>
              <span className="book-source-count">{this.state.sources.filter((item) => item.enabled !== false).length}</span>
            </div>
            <p><Trans>Search every enabled source together</Trans></p>
          </div>
        )}
        {this.state.sources.map((source) => (
          <div
            key={source.bookSourceUrl}
            className={`book-source-card ${
              source.bookSourceUrl === this.state.selectedSourceUrl ? "active" : ""
            }`}
            onClick={() => this.handleSelectSource(source.bookSourceUrl)}
          >
            <div className="book-source-card-topline">
              <span
                className={`book-source-status ${source.enabled !== false ? "on" : ""}`}
              />
              <strong>{source.bookSourceName}</strong>
              <button
                className="book-source-plain-button"
                onClick={(event) => {
                  event.stopPropagation();
                  this.handleDeleteSource(source);
                }}
                title={this.props.t("Delete")}
              >
                <span className="icon-trash" />
              </button>
            </div>
            <p>{source.bookSourceGroup || source.bookSourceUrl}</p>
            {isLoginCapableSource(source) && (
              <p className="book-source-limited">
                <Trans>Optional login available</Trans>
              </p>
            )}
            <label onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={source.enabled !== false}
                onChange={() => this.handleToggleSource(source)}
              />
              <span>
                <Trans>{source.enabled !== false ? "Enabled" : "Disabled"}</Trans>
              </span>
            </label>
          </div>
        ))}
      </div>
    </aside>
  );

  renderFlow = () => {
    const steps = [
      ["1", "Search", this.state.results.length > 0],
      ["2", "Choose a book", !!this.state.detail],
      ["3", "Read in Koodo", false],
    ];
    return (
      <div
        className="book-source-flow"
        aria-label={this.props.t("Book source workflow")}
      >
        {steps.map(([number, label, complete], index) => (
          <React.Fragment key={String(label)}>
            <div className={complete ? "complete" : ""}>
              <span>{number}</span>
              <Trans>{String(label)}</Trans>
            </div>
            {index < steps.length - 1 && <i />}
          </React.Fragment>
        ))}
      </div>
    );
  };

  renderWorkspace = () => {
    const { detail, chapters, content, results } = this.state;
    return (
      <main className="book-source-workspace">
        <header className="book-source-header">
          <div>
            <h1>
              {this.state.selectedSourceUrl === ALL_SOURCES
                ? this.props.t("Search all book sources")
                : this.selectedSource?.bookSourceName ||
                this.props.t("Import your first source")}
            </h1>
            {this.selectedSource?.bookSourceUrl && (
              <p className="book-source-address">
                {this.selectedSource.bookSourceUrl}
              </p>
            )}
          </div>
          {this.state.sources.length > 0 && (
            <span className="book-source-schema-badge">
              <Trans>{this.state.selectedSourceUrl === ALL_SOURCES ? "Multi-source search" : "Legado source"}</Trans>
            </span>
          )}
        </header>
        {this.renderFlow()}
        <div className="book-source-search-row">
          <input
            value={this.state.keyword}
            placeholder={this.props.t("Search title, author or keyword")}
            onChange={(event) => this.setState({ keyword: event.target.value })}
            onKeyDown={(event) => event.key === "Enter" && this.handleSearch()}
          />
          <button disabled={this.state.isLoading} onClick={this.handleSearch}>
            <span className="icon-search" />
            <Trans>Test search</Trans>
          </button>
        </div>
        {this.state.error && (
          <pre className="book-source-error">{this.state.error}</pre>
        )}
        {this.state.failedSourceCount > 0 && !this.state.error && (
          <div className="book-source-partial-warning">
            <Trans
              i18nKey="Some sources failed while other results are still available"
              values={{ count: this.state.failedSourceCount }}
            />
          </div>
        )}
        {this.state.isLoading && (
          <div className="book-source-loading">
            <span />
            {this.state.loadingLabel}
            {this.state.searchProgress && (
              <em>
                {this.state.searchProgress.completed}/
                {this.state.searchProgress.total}
              </em>
            )}
          </div>
        )}
        {this.state.sources.length === 0 && !this.state.isLoading && (
          <section className="book-source-welcome">
            <span className="icon-search-book" />
            <h3>
              <Trans>Sources are recipes, not bundled content.</Trans>
            </h3>
            <p>
              <Trans>
                Import a Legado source JSON, search, preview chapters, then download the book into your library.
              </Trans>
            </p>
          </section>
        )}
        {results.length > 0 && (
          <section className="book-source-section book-source-catalog">
            <div className="book-source-section-title">
              <h3><Trans>Search results</Trans></h3>
              <span>{results.length}</span>
            </div>
            <div className="book-source-catalog-grid">
              <div className="book-source-results">
              {results.map((result, index) => {
                const { book, source } = result;
                return (
                  <button
                    className={
                      detail?.bookUrl === book.bookUrl &&
                      this.state.activeSource?.bookSourceUrl === source.bookSourceUrl
                        ? "active"
                        : ""
                    }
                    key={`${source.bookSourceUrl}-${book.bookUrl}-${index}`}
                    onClick={() => this.handleOpenBook(result)}
                  >
                    <div className="book-source-cover">
                      {book.coverUrl ? (
                        <img src={book.coverUrl} alt="" />
                      ) : (
                        <span className="icon-book" />
                      )}
                    </div>
                    <span>
                      <strong>{book.name}</strong>
                      <small>{book.author || this.props.t("Unknown author")}</small>
                      <em>{source.bookSourceName}</em>
                    </span>
                    <i>›</i>
                  </button>
                );
              })}
              </div>
              {detail ? (
                <div className="book-source-detail-card">
                  <div className="book-source-detail-grid">
                    <div className="book-source-detail-cover">
                      {detail.coverUrl ? (
                        <img src={detail.coverUrl} alt="" />
                      ) : (
                        <span className="icon-book" />
                      )}
                    </div>
                    <div>
                      <p className="book-source-detail-kicker">
                        <Trans>Ready for your Koodo library</Trans>
                      </p>
                      <h2>{detail.name}</h2>
                      <p className="book-source-author">
                        {detail.author || this.props.t("Unknown author")}
                      </p>
                      <p className="book-source-intro">
                        {detail.intro || this.props.t("No description parsed")}
                      </p>
                    </div>
                  </div>
                  <div className="book-source-detail-meta">
                    <span>
                      <strong>{chapters.length || "—"}</strong>
                      <Trans>Chapters</Trans>
                    </span>
                    <span>
                      <strong>TXT</strong>
                      <Trans>Local book</Trans>
                    </span>
                  </div>
                  <div className="book-source-detail-actions">
                    <button
                      className="book-source-secondary-action"
                      disabled={!chapters.length || this.state.isDownloading}
                      onClick={() => this.handleDownloadBook(false)}
                    >
                      <Trans>Download to local library</Trans>
                    </button>
                    <button
                      className="book-source-read-action"
                      disabled={!chapters.length || this.state.isDownloading}
                      onClick={this.handleReadOnline}
                    >
                      <><span className="icon-book" /> <Trans>Read online</Trans></>
                    </button>
                  </div>
                  <p className="book-source-reader-note">
                    <Trans>
                      Online reading loads one chapter at a time. Downloading the whole book is optional.
                    </Trans>
                  </p>
                </div>
              ) : (
                <div className="book-source-detail-placeholder">
                  <span className="icon-book" />
                  <p><Trans>Select a result to see its details and chapter list.</Trans></p>
                </div>
              )}
            </div>
          </section>
        )}
        {chapters.length > 0 && (
          <details className="book-source-section book-source-chapter-preview">
            <summary>
              <span><Trans>Preview chapter list</Trans></span>
              <small>{chapters.length}</small>
            </summary>
            <div
              className="book-source-chapters"
              onScroll={(event) => {
                const element = event.currentTarget;
                if (
                  element.scrollHeight - element.scrollTop - element.clientHeight < 80
                ) {
                  void this.loadNextChapterPage();
                }
              }}
            >
              {chapters.map((chapter, index) => (
                <button
                  key={`${chapter.url}-${index}`}
                  onClick={() => this.handleOpenChapter(chapter, index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {chapter.title}
                </button>
              ))}
              {this.state.chapterCursors.length > 0 && (
                <button
                  onClick={() => void this.loadNextChapterPage()}
                  disabled={this.state.isLoadingMoreChapters}
                >
                  {this.state.isLoadingMoreChapters
                    ? this.props.t("Loading more chapters...")
                    : this.props.t("Load more chapters")}
                </button>
              )}
            </div>
          </details>
        )}
        {content && (
          <section className="book-source-section book-source-content" aria-label={this.props.t("Chapter preview")}>
            <div className="book-source-section-title">
              <div>
                <small><Trans>Chapter preview</Trans></small>
                <h3>{this.state.contentTitle}</h3>
              </div>
            </div>
            <article>{content}</article>
          </section>
        )}
      </main>
    );
  };

  renderImporter = () => {
    if (!this.state.isImporting) return null;
    const isUrl = this.state.importMode === "url";
    return (
      <div className="book-source-modal" role="dialog" aria-modal="true">
        <div className={`book-source-editor${isUrl ? " book-source-url-editor" : ""}`}>
          <div className="book-source-editor-title">
            <div>
              <h2>
                {this.props.t(
                  isUrl ? "Import book source from URL" : "Import book source"
                )}
              </h2>
            </div>
            <button
              disabled={this.state.isImportingUrl}
              onClick={() => this.setState({ isImporting: false })}
            >
              <span className="icon-close" />
            </button>
          </div>
          <p>
            {this.props.t(
              isUrl
                ? "Enter a direct book source JSON URL."
                : "Paste a Legado book source JSON (single object or array). Rules run in the sandboxed Legado engine plugin."
            )}
          </p>
          {isUrl ? (
            <input
              type="url"
              autoFocus
              spellCheck={false}
              placeholder="https://example.com/sources.json"
              value={this.state.importUrl}
              disabled={this.state.isImportingUrl}
              onChange={(event) => this.setState({ importUrl: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") void this.handleImportUrl();
              }}
            />
          ) : (
            <textarea
              autoFocus
              spellCheck={false}
              value={this.state.importText}
              onChange={(event) => this.setState({ importText: event.target.value })}
            />
          )}
          <div className="book-source-editor-actions">
            <button
              disabled={this.state.isImportingUrl}
              onClick={() => this.setState({ isImporting: false })}
            >
              <Trans>Cancel</Trans>
            </button>
            <button
              disabled={this.state.isImportingUrl}
              onClick={() =>
                isUrl
                  ? void this.handleImportUrl()
                  : this.importSources(this.state.importText)
              }
            >
              {this.props.t(
                isUrl ? "Download and import" : "Validate and import"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  render() {
    return (
      <div className="book-sources-page">
        {this.renderSourceRail()}
        {this.renderWorkspace()}
        {this.renderImporter()}
      </div>
    );
  }
}

export default BookSources;
