import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { OnlineLibraryBook } from "../../models/OnlineLibrary";
import {
  downloadProjectGutenbergBook,
  getProjectGutenbergDownload,
  searchProjectGutenberg,
} from "../../services/onlineLibrary/projectGutenberg";
import {
  LibrarySourceDescriptor,
  LibrarySourceKind,
} from "../../models/LibrarySource";
import { getLibrarySourceRegistry } from "../../services/library/sourceRegistry";
import "./onlineLibrary.css";

interface OnlineLibraryProps {
  importBookFunc: (file: File) => Promise<void>;
  handleOPDSDialog: (isOpen: boolean) => void;
  t: (key: string) => string;
  history: { push: (path: string) => void };
}

interface OnlineLibraryState {
  keyword: string;
  submittedKeyword: string;
  books: OnlineLibraryBook[];
  total: number;
  nextUrl: string;
  isSearching: boolean;
  isLoadingMore: boolean;
  downloadingId: string;
  hasSearched: boolean;
  featuredBooks: OnlineLibraryBook[];
  isFeaturedLoading: boolean;
  error: string;
  sourceRegistry: LibrarySourceDescriptor[];
}

const coverTones = ["sky", "leaf", "clay", "lilac", "ink"];

class OnlineLibrary extends React.Component<
  OnlineLibraryProps,
  OnlineLibraryState
> {
  state: OnlineLibraryState = {
    keyword: "",
    submittedKeyword: "",
    books: [],
    total: 0,
    nextUrl: "",
    isSearching: false,
    isLoadingMore: false,
    downloadingId: "",
    hasSearched: false,
    featuredBooks: [],
    isFeaturedLoading: true,
    error: "",
    sourceRegistry: [],
  };

  componentDidMount() {
    this.loadFeaturedBooks();
    this.refreshSourceRegistry();
  }

  refreshSourceRegistry = () => {
    this.setState({ sourceRegistry: getLibrarySourceRegistry() });
  };

  handleOpenSource = (source: LibrarySourceDescriptor) => {
    if (!source.configured) return;
    if (source.kind === "catalog") {
      this.openProjectGutenbergCatalog();
      return;
    }
    if (source.kind === "opds") {
      this.props.handleOPDSDialog(true);
      return;
    }
    if (source.kind === "native") {
      this.props.history.push("/manager/weread");
      return;
    }
    this.props.history.push("/manager/sources");
  };

  openProjectGutenbergCatalog = async () => {
    if (this.state.isSearching) return;
    this.setState({ isSearching: true, error: "" });
    try {
      const page = await searchProjectGutenberg(
        "",
        "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads"
      );
      this.setState({
        books: page.books,
        total: page.total,
        nextUrl: page.nextUrl,
        submittedKeyword: this.props.t("Popular downloads"),
        hasSearched: true,
      });
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.setState({ isSearching: false });
    }
  };

  getSourceKindLabel = (kind: LibrarySourceKind) => {
    if (kind === "web") return this.props.t("Online reading");
    if (kind === "opds") return "OPDS";
    if (kind === "native") return "API source";
    return this.props.t("Downloadable catalog");
  };

  loadFeaturedBooks = async () => {
    try {
      const page = await searchProjectGutenberg(
        "",
        "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads"
      );
      this.setState({ featuredBooks: page.books.slice(0, 8) });
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.setState({ isFeaturedLoading: false });
    }
  };

  handleSearch = async () => {
    const keyword = this.state.keyword.trim();
    if (!keyword || this.state.isSearching) return;
    this.setState({
      isSearching: true,
      error: "",
      submittedKeyword: keyword,
    });
    try {
      const page = await searchProjectGutenberg(keyword);
      this.setState({
        books: page.books,
        total: page.total,
        nextUrl: page.nextUrl,
        hasSearched: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ error: message, hasSearched: true, books: [] });
    } finally {
      this.setState({ isSearching: false });
    }
  };

  handleLoadMore = async () => {
    if (!this.state.nextUrl || this.state.isLoadingMore) return;
    this.setState({ isLoadingMore: true, error: "" });
    try {
      const page = await searchProjectGutenberg(
        this.state.submittedKeyword,
        this.state.nextUrl
      );
      this.setState((state) => ({
        books: [...state.books, ...page.books],
        total: page.total,
        nextUrl: page.nextUrl,
      }));
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.setState({ isLoadingMore: false });
    }
  };

  handleDownload = async (book: OnlineLibraryBook) => {
    if (this.state.downloadingId) return;
    this.setState({ downloadingId: book.id, error: "" });
    toast.loading(`${this.props.t("Downloading")}: ${book.title}`, {
      id: "online-library-download",
    });
    try {
      const download = await getProjectGutenbergDownload(book);
      const buffer = await downloadProjectGutenbergBook(download);
      const file = new File([buffer], download.fileName, {
        type: "application/epub+zip",
      });
      await this.props.importBookFunc(file);
      toast.success(this.props.t("Downloaded and added to bookshelf"), {
        id: "online-library-download",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ error: message });
      toast.error(`${this.props.t("Import failed")}: ${message}`, {
        id: "online-library-download",
      });
    } finally {
      this.setState({ downloadingId: "" });
    }
  };

  renderSearchBox(compact = false) {
    return (
      <div className={`online-library-search ${compact ? "compact" : ""}`}>
        <input
          autoFocus={!compact}
          value={this.state.keyword}
          placeholder={this.props.t("Search title, author, subject or language")}
          onChange={(event) => this.setState({ keyword: event.target.value })}
          onKeyDown={(event) => event.key === "Enter" && this.handleSearch()}
        />
        <button
          aria-label={this.props.t("Search")}
          disabled={this.state.isSearching || !this.state.keyword.trim()}
          onClick={this.handleSearch}
        >
          {this.state.isSearching ? <i /> : <span className="icon-search" />}
        </button>
      </div>
    );
  }

  renderLanding() {
    return (
      <main className="online-library-landing">
        <h1><Trans>Online Library</Trans></h1>
        <p>
          <Trans>Public-domain books, ready for your Koodo bookshelf.</Trans>
        </p>
        {this.renderSearchBox()}
        <div className="online-library-search-hint">
          <Trans>Try a title, author, subject or language</Trans>
        </div>
        <div className="online-library-catalog-actions">
          <button onClick={() => this.props.handleOPDSDialog(true)}>
            <span className="icon-setting" /> <Trans>Manage library sources</Trans>
          </button>
          <small>
            <Trans>Catalog sources download books to your shelf. Web sources stay online.</Trans>
          </small>
        </div>
        <section className="online-library-source-dock">
          <header>
            <div>
              <strong><Trans>Choose where a book comes from</Trans></strong>
            </div>
            <button onClick={this.refreshSourceRegistry} title={this.props.t("Refresh")}>
              <span className="icon-refresh" />
            </button>
          </header>
          <div className="online-library-source-list">
            {this.state.sourceRegistry.map((source) => (
              <button
                key={source.id}
                className={`online-library-source-card ${source.kind}`}
                disabled={!source.configured}
                onClick={() => this.handleOpenSource(source)}
              >
                <span className="online-library-source-icon">
                  {source.kind === "web" ? "≈" : source.kind === "opds" ? "◎" : "↧"}
                </span>
                <span className="online-library-source-copy">
                  <strong>{source.name}</strong>
                  <small>{source.description}</small>
                </span>
                <span className="online-library-source-kind">
                  {this.getSourceKindLabel(source.kind)}
                </span>
              </button>
            ))}
          </div>
          <footer>
            <button onClick={() => this.props.handleOPDSDialog(true)}>
              <span className="icon-add" /> <Trans>Add OPDS catalog</Trans>
            </button>
            <button onClick={() => this.props.history.push("/manager/sources")}>
              <span className="icon-search-book" /> <Trans>Manage web sources</Trans>
            </button>
          </footer>
        </section>
        <section className="online-library-featured">
          <header>
            <span><Trans>Popular public-domain books</Trans></span>
            <button onClick={this.loadFeaturedBooks} disabled={this.state.isFeaturedLoading}>
              <Trans>Refresh</Trans>
            </button>
          </header>
          {this.state.isFeaturedLoading ? (
            <div className="online-library-featured-loading"><i /> <Trans>Loading books...</Trans></div>
          ) : this.state.featuredBooks.length ? (
            <div className="online-library-featured-grid">
              {this.state.featuredBooks.map((book) => (
                <button
                  key={book.id}
                  onClick={() => this.setState({ keyword: book.title }, this.handleSearch)}
                >
                  <span className={`online-library-mini-cover ${coverTones[Number(book.id) % coverTones.length] || "sky"}`}>
                    <em>PG · {book.id.padStart(5, "0")}</em>
                    <strong>{book.title}</strong>
                  </span>
                  <strong>{book.title}</strong>
                  <small>{book.authors[0] || this.props.t("Unknown author")}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="online-library-featured-empty">
              <Trans>Search a title above to browse the catalog.</Trans>
            </div>
          )}
        </section>
        <footer>
          <strong><Trans>Project Gutenberg</Trans></strong>
          <span>
            <Trans>Open catalog · EPUB · added locally after download</Trans>
          </span>
        </footer>
      </main>
    );
  }

  renderResults() {
    return (
      <main className="online-library-results-page">
        <header>
          <button
            className="online-library-back"
            onClick={() => this.setState({ hasSearched: false, error: "" })}
            aria-label={this.props.t("Back")}
          >
            ←
          </button>
          <h2><Trans>Online Library</Trans></h2>
          {this.renderSearchBox(true)}
        </header>
        <div className="online-library-results-heading">
          <div>
            <p><Trans>Project Gutenberg catalog</Trans></p>
            <h1>“{this.state.submittedKeyword}”</h1>
          </div>
          <span>
            {this.state.total.toLocaleString()} <Trans>matches</Trans>
          </span>
        </div>
        {this.state.error && (
          <div className="online-library-error">{this.state.error}</div>
        )}
        {this.state.isSearching ? (
          <div className="online-library-state"><i /><Trans>Searching...</Trans></div>
        ) : this.state.books.length === 0 ? (
          <div className="online-library-state">
            <span className="icon-search-book" />
            <strong><Trans>No downloadable books found</Trans></strong>
            <small><Trans>Try another title, author or broader keyword.</Trans></small>
          </div>
        ) : (
          <div className="online-library-grid">
            {this.state.books.map((book, index) => {
              const isDownloading = this.state.downloadingId === book.id;
              return (
                <article key={`${book.id}-${index}`}>
                  <div className={`online-library-cover ${coverTones[Number(book.id) % coverTones.length] || "sky"}`}>
                    <em>PG · {book.id.padStart(5, "0")}</em>
                    <strong>{book.title}</strong>
                    <span>{book.authors[0] || this.props.t("Unknown author")}</span>
                  </div>
                  <div className="online-library-book-meta">
                    <strong>{book.title}</strong>
                    <span>{book.authors.join(" · ") || this.props.t("Unknown author")}</span>
                    <div>
                      {book.language && <small>{book.language.toUpperCase()}</small>}
                      <button
                        disabled={!!this.state.downloadingId}
                        onClick={() => this.handleDownload(book)}
                      >
                        {isDownloading ? (
                          <><i /> <Trans>Adding...</Trans></>
                        ) : (
                          <><span className="icon-import" /> <Trans>Download to bookshelf</Trans></>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {this.state.nextUrl && !this.state.isSearching && (
          <button
            className="online-library-more"
            disabled={this.state.isLoadingMore}
            onClick={this.handleLoadMore}
          >
            {this.state.isLoadingMore ? this.props.t("Loading...") : this.props.t("Load more books")}
          </button>
        )}
      </main>
    );
  }

  render() {
    return (
      <div className="online-library-page">
        {this.state.hasSearched ? this.renderResults() : this.renderLanding()}
      </div>
    );
  }
}

export default OnlineLibrary;
