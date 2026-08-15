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
  assembleTxt,
  isLegadoEngineReady,
  legadoGetBookInfo,
  legadoGetChapterContent,
  legadoGetChapterList,
  legadoSearch,
} from "../../services/legadoSource/legadoEngineClient";
import { parseWeReadLegacySource } from "../../services/onlineLibrary/weReadLegacy";
import { saveWeReadConfig } from "../../services/onlineLibrary/weReadStorage";
import "./bookSources.css";

interface BookSourcesProps {
  t: (key: string) => string;
  history?: { push: (path: string) => void };
  /** Redux-held import entry from ImportLocal (getMd5WithBrowser). */
  importBookFunc?: (file: File) => Promise<void>;
}

interface BookSourcesState {
  sources: LegadoBookSource[];
  selectedSourceUrl: string;
  keyword: string;
  results: LegadoSearchItem[];
  detail: LegadoBook | null;
  chapters: LegadoChapter[];
  content: string;
  contentTitle: string;
  isImporting: boolean;
  importText: string;
  isLoading: boolean;
  loadingLabel: string;
  error: string;
  isDownloading: boolean;
  downloadProgress: string;
}

const LEGADO_ENGINE_MISSING = "legado-engine-not-ready";

class BookSources extends React.Component<BookSourcesProps, BookSourcesState> {
  fileInput = React.createRef<HTMLInputElement>();

  constructor(props: BookSourcesProps) {
    super(props);
    const sources = getLegadoSources();
    this.state = {
      sources,
      selectedSourceUrl: sources[0]?.bookSourceUrl || "",
      keyword: "",
      results: [],
      detail: null,
      chapters: [],
      content: "",
      contentTitle: "",
      isImporting: false,
      importText: "",
      isLoading: false,
      loadingLabel: "",
      error: "",
      isDownloading: false,
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
        : sources.some((s) => s.bookSourceUrl === this.state.selectedSourceUrl)
          ? this.state.selectedSourceUrl
          : sources[0]?.bookSourceUrl || "";
    this.setState({ sources, selectedSourceUrl });
  };

  handleSelectSource = (sourceUrl: string) => {
    this.setState({
      selectedSourceUrl: sourceUrl,
      results: [],
      detail: null,
      chapters: [],
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
    this.setState({ results: [], detail: null, chapters: [], content: "" });
    toast.success(this.props.t("Deletion successful"));
  };

  importSources = (text: string) => {
    const legacyWeRead = parseWeReadLegacySource(text);
    if (legacyWeRead) {
      saveWeReadConfig(legacyWeRead);
      this.setState({ isImporting: false, importText: "", error: "" });
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
      { isImporting: false, importText: "", error: "" },
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

  runTask = async (label: string, task: () => Promise<void>) => {
    if (!isLegadoEngineReady()) {
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
    if (!source) {
      toast.error(this.props.t("Please import a book source first"));
      return;
    }
    if (source.enabled === false) {
      toast.error(this.props.t("Please enable this book source first"));
      return;
    }
    if (!keyword) {
      toast.error(this.props.t("Please enter a keyword"));
      return;
    }
    this.runTask(this.props.t("Searching..."), async () => {
      const results = await legadoSearch(source, keyword);
      if (!results.length) {
        toast(this.props.t("No results"));
      }
      this.setState({ results, detail: null, chapters: [], content: "" });
    });
  };

  handleOpenBook = (item: LegadoSearchItem) => {
    const source = this.selectedSource;
    if (!source) return;
    this.runTask(this.props.t("Loading book detail..."), async () => {
      const detail = await legadoGetBookInfo(source, item);
      this.setState({ detail, chapters: [], content: "" });
    });
  };

  handleLoadChapters = () => {
    const source = this.selectedSource;
    const detail = this.state.detail;
    if (!source || !detail) return;
    this.runTask(this.props.t("Loading chapters..."), async () => {
      const chapters = await legadoGetChapterList(source, detail);
      this.setState({ chapters, content: "" });
    });
  };

  handleOpenChapter = (chapter: LegadoChapter, index: number) => {
    const source = this.selectedSource;
    const detail = this.state.detail;
    if (!source || !detail) return;
    this.runTask(this.props.t("Loading chapter..."), async () => {
      const content = await legadoGetChapterContent(source, detail, chapter);
      this.setState({
        content,
        contentTitle: chapter.title || `#${index + 1}`,
      });
    });
  };

  /** Downloads every chapter and imports the assembled TXT into the library. */
  handleDownloadBook = async () => {
    const source = this.selectedSource;
    const detail = this.state.detail;
    const chapters = this.state.chapters;
    if (!source || !detail || !chapters.length) return;
    if (!this.props.importBookFunc) {
      toast.error(this.props.t("Open the library page first, then try again"));
      return;
    }
    this.setState({ isDownloading: true, downloadProgress: `0/${chapters.length}` });
    try {
      const parts: { title: string; content: string }[] = [];
      for (let index = 0; index < chapters.length; index += 1) {
        const chapter = chapters[index];
        const content = await legadoGetChapterContent(source, detail, chapter);
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
      await this.props.importBookFunc(file);
      toast.success(this.props.t("Imported successfully"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${this.props.t("Download failed")}: ${message}`);
    } finally {
      this.setState({ isDownloading: false, downloadProgress: "" });
    }
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
            this.setState({ isImporting: true, importText: "" })
          }
        >
          <Trans>Paste or create</Trans>
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
      ["2", "Detail", !!this.state.detail],
      ["3", "Chapters", this.state.chapters.length > 0],
      ["4", "Content", !!this.state.content],
    ];
    return (
      <div className="book-source-flow" aria-label="Book source parsing flow">
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
              {this.selectedSource?.bookSourceName ||
                this.props.t("Import your first source")}
            </h1>
            {this.selectedSource?.bookSourceUrl && (
              <p className="book-source-address">
                {this.selectedSource.bookSourceUrl}
              </p>
            )}
          </div>
          {this.selectedSource && (
            <span className="book-source-schema-badge">
              <Trans>Legado source</Trans>
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
        {this.state.isLoading && (
          <div className="book-source-loading">
            <span />
            {this.state.loadingLabel}
          </div>
        )}
        {!this.selectedSource && !this.state.isLoading && (
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
          <section className="book-source-section">
            <div className="book-source-section-title">
              <h3><Trans>Search results</Trans></h3>
              <span>{results.length}</span>
            </div>
            <div className="book-source-results">
              {results.map((book, index) => (
                <button
                  key={`${book.bookUrl}-${index}`}
                  onClick={() => this.handleOpenBook(book)}
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
                  </span>
                  <i>→</i>
                </button>
              ))}
            </div>
          </section>
        )}
        {detail && (
          <section className="book-source-section book-source-detail">
            <div className="book-source-section-title">
              <h3><Trans>Parsed detail</Trans></h3>
              <span>2</span>
            </div>
            <div className="book-source-detail-grid">
              {detail.coverUrl && <img src={detail.coverUrl} alt="" />}
              <div>
                <h2>{detail.name}</h2>
                <p className="book-source-author">{detail.author}</p>
                <p>{detail.intro || this.props.t("No description parsed")}</p>
                <button onClick={this.handleLoadChapters}>
                  <Trans>Parse chapter list</Trans>
                </button>
              </div>
            </div>
          </section>
        )}
        {chapters.length > 0 && (
          <section className="book-source-section">
            <div className="book-source-section-title">
              <h3><Trans>Chapter list</Trans></h3>
              <span>{chapters.length}</span>
              <button
                className="book-source-download-button"
                disabled={this.state.isDownloading}
                onClick={this.handleDownloadBook}
              >
                {this.state.isDownloading ? (
                  `${this.props.t("Downloading")} ${this.state.downloadProgress}`
                ) : (
                  <Trans>Download whole book as TXT</Trans>
                )}
              </button>
            </div>
            <div className="book-source-chapters">
              {chapters.map((chapter, index) => (
                <button
                  key={`${chapter.url}-${index}`}
                  onClick={() => this.handleOpenChapter(chapter, index)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {chapter.title}
                </button>
              ))}
            </div>
          </section>
        )}
        {content && (
          <section className="book-source-section book-source-content">
            <div className="book-source-section-title">
              <h3>{this.state.contentTitle}</h3>
              <span>4</span>
            </div>
            <article>{content}</article>
          </section>
        )}
      </main>
    );
  };

  renderImporter = () => {
    if (!this.state.isImporting) return null;
    return (
      <div className="book-source-modal" role="dialog" aria-modal="true">
        <div className="book-source-editor">
          <div className="book-source-editor-title">
            <div><h2><Trans>Import book source</Trans></h2></div>
            <button onClick={() => this.setState({ isImporting: false })}>
              <span className="icon-close" />
            </button>
          </div>
          <p>
            <Trans>
              Paste a Legado book source JSON (single object or array). Rules run in the sandboxed Legado engine plugin.
            </Trans>
          </p>
          <textarea
            spellCheck={false}
            value={this.state.importText}
            onChange={(event) => this.setState({ importText: event.target.value })}
          />
          <div className="book-source-editor-actions">
            <button onClick={() => this.setState({ isImporting: false })}>
              <Trans>Cancel</Trans>
            </button>
            <button onClick={() => this.importSources(this.state.importText)}>
              <Trans>Validate and import</Trans>
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
