import React from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { RouteComponentProps } from "react-router-dom";
import {
  LegadoChapter,
  legadoGetChapterContent,
  legadoGetChapterListPage,
  preloadLegadoChapterContent,
} from "../../services/legadoSource/legadoEngineClient";
import { renderSourceChapter } from "../../services/legadoSource/sourceContent";
import { SourceShelfBook } from "../../services/legadoSource/sourceShelfModel";
import {
  getSourceChapterContent,
  getSourceShelfBooks,
  markSourceChaptersCached,
  removeSourceShelfBook,
  saveSourceChapterContent,
  updateSourceShelfChapters,
  updateSourceShelfProgress,
} from "../../services/legadoSource/sourceShelfStorage";
import "./sourceShelf.css";

interface Props extends RouteComponentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  handleMode: (mode: string) => void;
}

interface State {
  books: SourceShelfBook[];
  filter: string;
  selectedBook: SourceShelfBook | null;
  selectedChapterIndex: number;
  content: string;
  loading: boolean;
  loadingMoreChapters: boolean;
  error: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  tocCollapsed: boolean;
  sepia: boolean;
  cacheMenu: boolean;
  caching: { done: number; total: number } | null;
}

class SourceShelf extends React.Component<Props, State> {
  private readerRef = React.createRef<HTMLElement>();
  private chapterLoadId = 0;
  private loadingMore = false;

  state: State = {
    books: getSourceShelfBooks(),
    filter: "",
    selectedBook: null,
    selectedChapterIndex: 0,
    content: "",
    loading: false,
    loadingMoreChapters: false,
    error: "",
    fontSize: 17,
    lineHeight: 2,
    contentWidth: 720,
    tocCollapsed: false,
    sepia: false,
    cacheMenu: false,
    caching: null,
  };

  componentDidMount() {
    document.body.classList.add("source-shelf-route-active");
    window.addEventListener("keydown", this.handleKeydown, true);
    const id = new URLSearchParams(this.props.location.search).get("book");
    const book = id ? this.state.books.find((item) => item.id === id) : null;
    if (book) this.openBook(book);
  }

  componentWillUnmount() {
    document.body.classList.remove("source-shelf-route-active");
    window.removeEventListener("keydown", this.handleKeydown, true);
    this.persistProgress();
  }

  get selectedChapter(): LegadoChapter | null {
    return this.state.selectedBook?.chapters[this.state.selectedChapterIndex] || null;
  }

  handleKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (!this.state.selectedBook || this.state.loading) return;
      event.preventDefault();
      this.moveChapter(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "Escape" && this.state.selectedBook) {
      event.preventDefault();
      this.closeReader();
    }
  };

  getCurrentPosition = (): number => {
    const reader = this.readerRef.current;
    if (!reader || !this.state.content) return 0;
    const max = Math.max(1, reader.scrollHeight - reader.clientHeight);
    return Math.round((reader.scrollTop / max) * this.state.content.length);
  };

  persistProgress = () => {
    const book = this.state.selectedBook;
    const chapter = this.selectedChapter;
    if (!book || !chapter) return;
    updateSourceShelfProgress(book.id, {
      chapterIndex: this.state.selectedChapterIndex,
      chapterTitle: chapter.title || "",
      chapterPos: this.getCurrentPosition(),
      updatedAt: Date.now(),
    });
  };

  openBook = (book: SourceShelfBook) => {
    this.persistProgress();
    const chapterIndex = Math.min(
      Math.max(0, book.progress?.chapterIndex || 0),
      Math.max(0, book.chapters.length - 1)
    );
    this.setState({ selectedBook: book, selectedChapterIndex: chapterIndex, error: "" }, () =>
      this.loadChapter(chapterIndex, book.progress?.chapterPos || 0)
    );
  };

  closeReader = () => {
    this.chapterLoadId += 1;
    this.persistProgress();
    this.setState({
      books: getSourceShelfBooks(),
      selectedBook: null,
      content: "",
      error: "",
      cacheMenu: false,
    });
    this.props.history.replace("/manager/sourceShelf");
  };

  loadChapter = async (chapterIndex: number, chapterPos = 0) => {
    const book = this.state.selectedBook;
    const chapter = book?.chapters[chapterIndex];
    if (!book || !chapter) return;
    this.persistProgress();
    const loadId = ++this.chapterLoadId;
    this.setState({ loading: true, error: "", selectedChapterIndex: chapterIndex });
    try {
      const cached = await getSourceChapterContent(book.id, chapterIndex);
      const content =
        cached ||
        (await legadoGetChapterContent(
          book.source,
          book.book,
          chapter,
          book.chapters[chapterIndex + 1],
          book.chapters.map((item) => String(item.url || "")).filter(Boolean)
        ));
      if (loadId !== this.chapterLoadId) return;
      this.setState({ content }, () => {
        const reader = this.readerRef.current;
        if (!reader) return;
        const ratio = content.length ? Math.min(1, chapterPos / content.length) : 0;
        reader.scrollTop = ratio * Math.max(0, reader.scrollHeight - reader.clientHeight);
      });
      void preloadLegadoChapterContent(
        book.source,
        book.book,
        book.chapters[chapterIndex + 1],
        book.chapters[chapterIndex + 2],
        book.chapters.map((item) => String(item.url || "")).filter(Boolean)
      );
      updateSourceShelfProgress(book.id, {
        chapterIndex,
        chapterTitle: chapter.title || "",
        chapterPos,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (loadId !== this.chapterLoadId) return;
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ content: "", error: message });
      toast.error(message);
    } finally {
      if (loadId === this.chapterLoadId) this.setState({ loading: false });
    }
  };

  loadMoreChapters = async (): Promise<SourceShelfBook | null> => {
    const book = this.state.selectedBook;
    const cursor = book?.chapterCursors[0];
    if (!book || !cursor || this.loadingMore) return book;
    this.loadingMore = true;
    this.setState({ loadingMoreChapters: true });
    try {
      const page = await legadoGetChapterListPage(book.source, book.book, cursor);
      const seen = new Set(
        book.chapters.map((chapter) => String(chapter.url || chapter.title || ""))
      );
      const chapters = book.chapters.concat(
        page.chapters.filter((chapter) => {
          const key = String(chapter.url || chapter.title || "");
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
      );
      const chapterCursors = [
        ...book.chapterCursors.slice(1),
        ...page.nextTocUrls,
      ];
      const updated = updateSourceShelfChapters(
        book.id,
        chapters,
        chapterCursors
      );
      if (updated) {
        this.setState((state) => ({
          selectedBook: updated,
          books: state.books.map((item) =>
            item.id === updated.id ? updated : item
          ),
        }));
      }
      return updated;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      this.loadingMore = false;
      this.setState({ loadingMoreChapters: false });
    }
  };

  moveChapter = async (offset: number) => {
    let book = this.state.selectedBook;
    if (!book) return;
    let target = this.state.selectedChapterIndex + offset;
    if (
      offset > 0 &&
      target >= book.chapters.length &&
      book.chapterCursors.length > 0
    ) {
      book = await this.loadMoreChapters();
      if (!book) return;
      target = this.state.selectedChapterIndex + offset;
    }
    if (target < 0 || target >= book.chapters.length) return;
    this.setState({ selectedBook: book }, () => this.loadChapter(target));
  };

  refreshShelfBooks = () => {
    const books = getSourceShelfBooks();
    const selectedBook = this.state.selectedBook
      ? books.find((book) => book.id === this.state.selectedBook!.id) ||
        this.state.selectedBook
      : null;
    this.setState({ books, selectedBook });
  };

  cacheChapters = async (indexes: number[]) => {
    const book = this.state.selectedBook;
    if (!book || this.state.caching) return;
    this.setState({ caching: { done: 0, total: indexes.length }, cacheMenu: false });
    let failed = 0;
    const cachedIndexes: number[] = [];
    for (let offset = 0; offset < indexes.length; offset += 1) {
      const chapterIndex = indexes[offset];
      try {
        if (!(await getSourceChapterContent(book.id, chapterIndex))) {
          const chapter = book.chapters[chapterIndex];
          const content =
            chapterIndex === this.state.selectedChapterIndex && this.state.content
              ? this.state.content
              : await legadoGetChapterContent(
                  book.source,
                  book.book,
                  chapter,
                  book.chapters[chapterIndex + 1],
                  book.chapters
                    .map((item) => String(item.url || ""))
                    .filter(Boolean)
                );
          await saveSourceChapterContent(book.id, chapterIndex, content);
          cachedIndexes.push(chapterIndex);
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
        } else {
          cachedIndexes.push(chapterIndex);
        }
      } catch {
        failed += 1;
      }
      this.setState({ caching: { done: offset + 1, total: indexes.length } });
    }
    markSourceChaptersCached(book.id, cachedIndexes);
    this.setState({ caching: null }, this.refreshShelfBooks);
    if (failed) toast.error(this.props.t("Some chapters could not be cached", { count: failed }));
    else toast.success(this.props.t("Caching complete"));
  };

  cacheCurrent = async () => {
    const book = this.state.selectedBook;
    if (!book || !this.state.content) return;
    await saveSourceChapterContent(book.id, this.state.selectedChapterIndex, this.state.content);
    markSourceChaptersCached(book.id, [this.state.selectedChapterIndex]);
    this.setState({ cacheMenu: false }, this.refreshShelfBooks);
    toast.success(this.props.t("Cached current chapter"));
  };

  removeBook = async (book: SourceShelfBook) => {
    if (!window.confirm(`${this.props.t("Delete")} “${book.book.name}”?`)) return;
    this.setState({ books: await removeSourceShelfBook(book.id) });
  };

  toggleFullscreen = async () => {
    const element = document.querySelector(".source-reader") as HTMLElement | null;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
  };

  renderReader() {
    const book = this.state.selectedBook!;
    const chapter = this.selectedChapter!;
    const cached = book.cachedChapterIndexes.includes(this.state.selectedChapterIndex);
    return (
      <div className={`source-reader ${this.state.sepia ? "is-sepia" : ""} ${this.state.tocCollapsed ? "is-collapsed" : ""}`}>
        <header>
          <button onClick={this.closeReader}>← <Trans>Online bookshelf</Trans></button>
          <div><strong>{book.book.name}</strong><small>{chapter.title}</small></div>
          <button onClick={() => this.moveChapter(-1)} disabled={this.state.selectedChapterIndex === 0}>‹</button>
          <button onClick={() => void this.moveChapter(1)} disabled={this.state.selectedChapterIndex === book.chapters.length - 1 && book.chapterCursors.length === 0}>›</button>
          <button className={cached ? "is-cached" : ""} onClick={() => this.setState({ cacheMenu: !this.state.cacheMenu })} title={this.props.t("Cache chapters")}>⇩</button>
          <button onClick={() => this.setState({ fontSize: Math.max(12, this.state.fontSize - 1) })}>A−</button>
          <button onClick={() => this.setState({ fontSize: Math.min(30, this.state.fontSize + 1) })}>A＋</button>
          <button onClick={() => this.setState({ sepia: !this.state.sepia })}>◐</button>
          <button onClick={this.toggleFullscreen}>⛶</button>
        </header>
        <div className="source-reader-body">
          <aside
            onScroll={(event) => {
              const element = event.currentTarget;
              if (
                element.scrollHeight - element.scrollTop - element.clientHeight < 100
              ) {
                void this.loadMoreChapters();
              }
            }}
          >
            {book.chapters.map((item, index) => (
              <button className={index === this.state.selectedChapterIndex ? "active" : ""} key={`${item.url}-${index}`} onClick={() => this.loadChapter(index)}>
                <span>{index + 1}</span><i className={book.cachedChapterIndexes.includes(index) ? "cached" : ""} />{item.title}
              </button>
            ))}
            {book.chapterCursors.length > 0 && (
              <button
                disabled={this.state.loadingMoreChapters}
                onClick={() => void this.loadMoreChapters()}
              >
                {this.state.loadingMoreChapters
                  ? this.props.t("Loading more chapters...")
                  : this.props.t("Load more chapters")}
              </button>
            )}
            <button className="source-toc-toggle" onClick={() => this.setState({ tocCollapsed: !this.state.tocCollapsed })}>{this.state.tocCollapsed ? "›" : "‹"}</button>
          </aside>
          <article ref={this.readerRef}>
            {this.state.loading ? (
              <div className="source-shelf-empty"><span className="source-spinner" /><Trans>Loading chapter...</Trans></div>
            ) : this.state.error ? (
              <div className="source-shelf-empty"><h3><Trans>Unable to load this chapter</Trans></h3><p>{this.state.error}</p><button onClick={() => this.loadChapter(this.state.selectedChapterIndex)}><Trans>Try again</Trans></button></div>
            ) : (
              <div className="source-prose" style={{ fontSize: this.state.fontSize, lineHeight: this.state.lineHeight, maxWidth: this.state.contentWidth }}>
                <h1>{chapter.title}</h1>
                <div dangerouslySetInnerHTML={{ __html: renderSourceChapter(this.state.content, chapter.title) }} />
              </div>
            )}
          </article>
        </div>
        {this.state.cacheMenu && (
          <div className="source-cache-menu">
            <strong><Trans>Cache for offline reading</Trans></strong>
            <button onClick={this.cacheCurrent}><Trans>Current chapter</Trans></button>
            <button onClick={() => this.cacheChapters(Array.from({ length: Math.min(20, book.chapters.length - this.state.selectedChapterIndex) }, (_, index) => this.state.selectedChapterIndex + index))}><Trans>Current and next 20 chapters</Trans></button>
            <button onClick={() => this.cacheChapters(book.chapters.map((_, index) => index))}><Trans>Cache whole book</Trans></button>
          </div>
        )}
        {this.state.caching && <div className="source-cache-progress"><span style={{ width: `${(this.state.caching.done / Math.max(1, this.state.caching.total)) * 100}%` }} /><em>{this.state.caching.done}/{this.state.caching.total}</em></div>}
      </div>
    );
  }

  render() {
    if (this.state.selectedBook && this.selectedChapter) return this.renderReader();
    const filter = this.state.filter.trim().toLowerCase();
    const books = this.state.books.filter((item) => !filter || `${item.book.name} ${item.book.author} ${item.sourceName}`.toLowerCase().includes(filter));
    return (
      <div className="source-shelf-page">
        <header className="source-shelf-hero">
          <div><p><Trans>BOOK SOURCE LIBRARY</Trans></p><h1><Trans>Online bookshelf</Trans></h1><span><Trans>Open a book instantly. Cache only what you want to keep offline.</Trans></span></div>
          <button onClick={() => this.props.history.push("/manager/sources")}><span className="icon-search-book" /> <Trans>Find books</Trans></button>
        </header>
        <div className="source-shelf-search"><span className="icon-search" /><input value={this.state.filter} onChange={(event) => this.setState({ filter: event.target.value })} placeholder={this.props.t("Search online bookshelf")} /><em>{books.length}</em></div>
        {books.length === 0 ? (
          <div className="source-shelf-empty"><span className="icon-bookshelf" /><h3><Trans>Your online bookshelf is empty</Trans></h3><p><Trans>Search book sources and choose Read online to add your first book.</Trans></p></div>
        ) : (
          <section className="source-shelf-grid">
            {books.map((book) => {
              const cachedCount = book.cachedChapterIndexes.length;
              const progress = book.chapters.length ? Math.round(((book.progress?.chapterIndex || 0) / book.chapters.length) * 100) : 0;
              return (
                <div className="source-shelf-book" key={book.id}>
                  <button className="source-shelf-book-open" onClick={() => this.openBook(book)}>
                    <div className="source-shelf-cover">
                      {book.book.coverUrl ? <img src={book.book.coverUrl} alt="" /> : <span>书</span>}
                      <i className={cachedCount === book.chapters.length ? "complete" : cachedCount ? "partial" : "online"} />
                    </div>
                    <strong>{book.book.name}</strong>
                    <small>{book.book.author || this.props.t("Unknown author")}</small>
                    <p>{book.sourceName}</p>
                    <div className="source-shelf-book-meta"><span>{progress}%</span><span>{cachedCount}/{book.chapters.length} <Trans>cached</Trans></span></div>
                  </button>
                  <button className="source-shelf-remove" onClick={() => this.removeBook(book)} title={this.props.t("Delete")}>×</button>
                </div>
              );
            })}
          </section>
        )}
      </div>
    );
  }
}

export default SourceShelf;
