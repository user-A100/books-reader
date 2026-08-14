import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import {
  BookSource,
  SourceBookDetail,
  SourceBookSummary,
  SourceChapter,
  SourceChapterContent,
} from "../../models/BookSource";
import {
  deleteBookSource,
  getBookSourceCache,
  getBookSources,
  saveBookSource,
  saveBookSourceCache,
  setBookSourceEnabled,
} from "../../services/bookSource/sourceStorage";
import { parseBookSourceJson } from "../../services/bookSource/sourceValidation";
import { parseWeReadLegacySource } from "../../services/onlineLibrary/weReadLegacy";
import { saveWeReadConfig } from "../../services/onlineLibrary/weReadStorage";
import {
  fetchBookSourceChapters,
  fetchBookSourceContent,
  fetchBookSourceDetail,
  searchBookSource,
} from "../../services/bookSource/sourceEngine";
import "./bookSources.css";

interface BookSourcesProps {
  t: (key: string) => string;
  history?: { push: (path: string) => void };
}

interface BookSourcesState {
  sources: BookSource[];
  selectedSourceId: string;
  keyword: string;
  results: SourceBookSummary[];
  detail: SourceBookDetail | null;
  chapters: SourceChapter[];
  content: SourceChapterContent | null;
  isImporting: boolean;
  importText: string;
  isLoading: boolean;
  loadingLabel: string;
  error: string;
}

const SOURCE_TEMPLATE = `{
  "id": "my-book-source",
  "schemaVersion": 1,
  "name": "我的书源",
  "baseUrl": "https://example.com",
  "allowedHosts": ["example.com"],
  "description": "使用 CSS 选择器解析公开网页",
  "enabled": true,
  "search": {
    "request": { "url": "/search?q={{keyword}}", "method": "GET" },
    "list": ".book-item",
    "fields": {
      "title": ".title@text",
      "author": ".author@text",
      "cover": "img@src",
      "detailUrl": "a@href"
    }
  },
  "detail": {
    "fields": {
      "title": "h1@text",
      "author": ".author@text",
      "cover": ".cover img@src",
      "description": ".intro@text",
      "tocUrl": ".catalog@href"
    }
  },
  "toc": {
    "list": ".chapter-list a",
    "fields": { "title": "@text", "url": "@href" }
  },
  "content": {
    "body": "#chapter-content",
    "remove": ["script", ".advertisement"]
  }
}`;

class BookSources extends React.Component<BookSourcesProps, BookSourcesState> {
  fileInput = React.createRef<HTMLInputElement>();

  constructor(props: BookSourcesProps) {
    super(props);
    const sources = getBookSources();
    const selectedSourceId = sources[0]?.id || "";
    const cache = selectedSourceId ? getBookSourceCache(selectedSourceId) : null;
    this.state = {
      sources,
      selectedSourceId,
      keyword: cache?.keyword || "",
      results: cache?.results || [],
      detail: cache?.detail || null,
      chapters: cache?.chapters || [],
      content: cache?.content || null,
      isImporting: false,
      importText: "",
      isLoading: false,
      loadingLabel: "",
      error: "",
    };
  }

  get selectedSource(): BookSource | null {
    return (
      this.state.sources.find(
        (source) => source.id === this.state.selectedSourceId
      ) || null
    );
  }

  // Persist the current inspector state as the selected source's snapshot, so
  // reopening the page (or switching back to this source) restores it instead
  // of going blank. Called after every successful fetch.
  persistCache = () => {
    const id = this.state.selectedSourceId;
    if (!id) return;
    saveBookSourceCache(id, {
      keyword: this.state.keyword,
      results: this.state.results,
      detail: this.state.detail,
      chapters: this.state.chapters,
      content: this.state.content,
    });
  };

  refreshSources = (preferredId?: string) => {
    const sources = getBookSources();
    const selectedSourceId =
      preferredId && sources.some((source) => source.id === preferredId)
        ? preferredId
        : sources.some((source) => source.id === this.state.selectedSourceId)
          ? this.state.selectedSourceId
          : sources[0]?.id || "";
    this.setState({ sources, selectedSourceId });
  };

  resetInspector = () => {
    this.setState({
      results: [],
      detail: null,
      chapters: [],
      content: null,
      error: "",
    });
  };

  // Restore a source's last snapshot when selected, so previously fetched
  // books reappear instead of the page going blank.
  handleSelectSource = (sourceId: string) => {
    const cache = getBookSourceCache(sourceId);
    this.setState({
      selectedSourceId: sourceId,
      keyword: cache?.keyword || "",
      results: cache?.results || [],
      detail: cache?.detail || null,
      chapters: cache?.chapters || [],
      content: cache?.content || null,
      error: "",
    });
  };

  handleToggleSource = (source: BookSource) => {
    setBookSourceEnabled(source.id, !source.enabled);
    this.refreshSources(source.id);
  };

  handleDeleteSource = (source: BookSource) => {
    if (!window.confirm(`${this.props.t("Delete")} “${source.name}”?`)) return;
    deleteBookSource(source.id);
    this.refreshSources();
    this.resetInspector();
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
    const results = parseBookSourceJson(text);
    const invalid = results.filter((result) => !result.valid);
    if (invalid.length) {
      this.setState({
        error: invalid
          .flatMap((result, index) =>
            result.errors.map((error) => `#${index + 1} ${error}`)
          )
          .join("\n"),
      });
      return;
    }
    const sources = results
      .map((result) => result.source)
      .filter((source): source is BookSource => !!source);
    sources.forEach(saveBookSource);
    this.setState(
      { isImporting: false, importText: "", error: "" },
      () => this.refreshSources(sources[0]?.id)
    );
    toast.success(
      `${this.props.t("Imported successfully")}: ${sources.length}`
    );
  };

  handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    this.importSources(await file.text());
  };

  runTask = async (label: string, task: () => Promise<void>) => {
    this.setState({ isLoading: true, loadingLabel: label, error: "" });
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ error: message });
      toast.error(message);
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
    if (!source.enabled) {
      toast.error(this.props.t("Please enable this book source first"));
      return;
    }
    if (!keyword) {
      toast.error(this.props.t("Please enter a keyword"));
      return;
    }
    this.runTask(this.props.t("Searching..."), async () => {
      const results = await searchBookSource(source, keyword);
      this.setState({ results, detail: null, chapters: [], content: null }, this.persistCache);
    });
  };

  handleOpenBook = (summary: SourceBookSummary) => {
    const source = this.selectedSource;
    if (!source) return;
    this.runTask(this.props.t("Loading book detail..."), async () => {
      const detail = await fetchBookSourceDetail(source, summary);
      this.setState({ detail, chapters: [], content: null }, this.persistCache);
    });
  };

  handleLoadChapters = () => {
    const source = this.selectedSource;
    const detail = this.state.detail;
    if (!source || !detail) return;
    this.runTask(this.props.t("Loading chapters..."), async () => {
      const chapters = await fetchBookSourceChapters(source, detail);
      this.setState({ chapters, content: null }, this.persistCache);
    });
  };

  handleOpenChapter = (chapter: SourceChapter) => {
    const source = this.selectedSource;
    if (!source) return;
    this.runTask(this.props.t("Loading chapter..."), async () => {
      const content = await fetchBookSourceContent(source, chapter);
      this.setState({ content }, this.persistCache);
    });
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
            this.setState({ isImporting: true, importText: SOURCE_TEMPLATE })
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
              <Trans>Import a JSON rule to begin.</Trans>
            </small>
          </div>
        )}
        {this.state.sources.map((source) => (
          <div
            key={source.id}
            className={`book-source-card ${
              source.id === this.state.selectedSourceId ? "active" : ""
            }`}
            onClick={() => this.handleSelectSource(source.id)}
          >
            <div className="book-source-card-topline">
              <span className={`book-source-status ${source.enabled ? "on" : ""}`} />
              <strong>{source.name}</strong>
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
            <p>{source.description || source.baseUrl}</p>
            <label onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={() => this.handleToggleSource(source)}
              />
              <span>
                <Trans>{source.enabled ? "Enabled" : "Disabled"}</Trans>
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
            <h1>{this.selectedSource?.name || this.props.t("Build your first source")}</h1>
            {this.selectedSource?.baseUrl && <p className="book-source-address">{this.selectedSource.baseUrl}</p>}
          </div>
          {this.selectedSource && (
            <span className="book-source-schema-badge">Schema v1 · CSS</span>
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
                Import a rule, test every parsing step, then decide whether to keep it.
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
                <button key={`${book.detailUrl}-${index}`} onClick={() => this.handleOpenBook(book)}>
                  <div className="book-source-cover">
                    {book.coverUrl ? <img src={book.coverUrl} alt="" /> : <span className="icon-book" />}
                  </div>
                  <span><strong>{book.title}</strong><small>{book.author || this.props.t("Unknown author")}</small></span>
                  <i>→</i>
                </button>
              ))}
            </div>
          </section>
        )}
        {detail && (
          <section className="book-source-section book-source-detail">
            <div className="book-source-section-title"><h3><Trans>Parsed detail</Trans></h3><span>2</span></div>
            <div className="book-source-detail-grid">
              {detail.coverUrl && <img src={detail.coverUrl} alt="" />}
              <div>
                <h2>{detail.title}</h2>
                <p className="book-source-author">{detail.author}</p>
                <p>{detail.description || this.props.t("No description parsed")}</p>
                <button onClick={this.handleLoadChapters}><Trans>Parse chapter list</Trans></button>
              </div>
            </div>
          </section>
        )}
        {chapters.length > 0 && (
          <section className="book-source-section">
            <div className="book-source-section-title"><h3><Trans>Chapter list</Trans></h3><span>{chapters.length}</span></div>
            <div className="book-source-chapters">
              {chapters.map((chapter, index) => (
                <button key={`${chapter.url}-${index}`} onClick={() => this.handleOpenChapter(chapter)}>
                  <span>{String(index + 1).padStart(2, "0")}</span>{chapter.title}
                </button>
              ))}
            </div>
          </section>
        )}
        {content && (
          <section className="book-source-section book-source-content">
            <div className="book-source-section-title"><h3>{content.title}</h3><span>4</span></div>
            <article dangerouslySetInnerHTML={{ __html: content.html }} />
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
            <button onClick={() => this.setState({ isImporting: false })}><span className="icon-close" /></button>
          </div>
          <p><Trans>Selectors use the form “.title@text” or “a@href”. JavaScript is not executed.</Trans></p>
          <textarea spellCheck={false} value={this.state.importText} onChange={(event) => this.setState({ importText: event.target.value })} />
          <div className="book-source-editor-actions">
            <button onClick={() => this.setState({ isImporting: false })}><Trans>Cancel</Trans></button>
            <button onClick={() => this.importSources(this.state.importText)}><Trans>Validate and import</Trans></button>
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
