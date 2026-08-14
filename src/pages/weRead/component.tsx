import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { WeReadBook, WeReadChapter, WeReadSourceConfig } from "../../models/WeRead";
import { getWeReadBook, getWeReadChapters, searchWeRead } from "../../services/onlineLibrary/weRead";
import { getWeReadConfig, hasWeReadCredentials, saveWeReadConfig } from "../../services/onlineLibrary/weReadStorage";
import {
  getWeReadBookmarks,
  getWeReadLoginStatus,
  getWeReadNotebooks,
  getWeReadShelf,
} from "../../services/onlineLibrary/wereadSync";
import {
  getWereReadLastSync,
  getWereReadShelf as getStoredWereReadShelf,
  saveWereReadLastSync,
  saveWereReadShelf,
} from "../../services/onlineLibrary/wereadSyncStorage";
import { importWeReadBookmarks } from "../../services/onlineLibrary/wereadNoteImport";
import { WeReadShelfItem, WeReadSyncResult } from "../../models/WeRead";
import store from "../../store";
import { handleFetchNotes } from "../../store/actions";
import "./weRead.css";

interface WeReadProps {
  t: (key: string) => string;
}

interface WeReadState {
  config: WeReadSourceConfig;
  keyword: string;
  books: WeReadBook[];
  selectedBook: WeReadBook | null;
  chapters: WeReadChapter[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isLoadingDetail: boolean;
  error: string;
  loginMode: "qr" | "manual";
  loginStatus: boolean;
  isSyncing: boolean;
  syncResult: WeReadSyncResult | null;
  lastSync: number;
  shelfItems: WeReadShelfItem[];
}

const safeExternalBookUrl = (bookId: string) =>
  `https://weread.qq.com/web/bookDetail/${encodeURIComponent(bookId)}`;

class WeRead extends React.Component<WeReadProps, WeReadState> {
  state: WeReadState = {
    config: getWeReadConfig(),
    keyword: "",
    books: [],
    selectedBook: null,
    chapters: [],
    page: 0,
    hasMore: false,
    isLoading: false,
    isLoadingMore: false,
    isLoadingDetail: false,
    error: "",
    loginMode: getWeReadConfig().loginMode || "qr",
    loginStatus: false,
    isSyncing: false,
    syncResult: null,
    lastSync: getWereReadLastSync(),
    shelfItems: getStoredWereReadShelf(),
  };

  updateConfig = (patch: Partial<WeReadSourceConfig>) => {
    this.setState({ config: { ...this.state.config, ...patch } });
  };

  saveConfig = () => {
    const config = saveWeReadConfig({
      ...this.state.config,
      loginMode: this.state.loginMode,
    });
    this.setState({ config });
    toast.success("微信读书配置已保存");
  };

  openQrLogin = () => {
    // #login opens WeRead's login modal directly, so the QR code is shown
    // immediately instead of the marketing homepage (which hides login behind
    // a button). Scanning here is what sets the wr_vid/wr_skey session cookies
    // the sync depends on.
    const url = "https://weread.qq.com/#login";
    window.location.hash = `/manager/web?url=${encodeURIComponent(url)}`;
    toast("已在 Books 内嵌网页中打开微信读书，请扫码登录后再回到此页点击“同步”。");
  };

  async componentDidMount() {
    await this.checkLoginStatus();
  }

  checkLoginStatus = async () => {
    const loggedIn = await getWeReadLoginStatus();
    this.setState({ loginStatus: loggedIn });
    return loggedIn;
  };

  handleSync = async () => {
    this.setState({ isSyncing: true, error: "" });
    const errors: string[] = [];
    let shelfItems: WeReadShelfItem[] = [];
    let notebookCount = 0;
    let bookmarkCount = 0;
    let importedNotes = 0;
    let skippedNotes = 0;

    try {
      shelfItems = (await getWeReadShelf()).map((item) => ({
        ...item,
        syncedAt: Date.now(),
      }));
      saveWereReadShelf(shelfItems);
    } catch (error) {
      errors.push(`书架同步失败：${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const notebooks = await getWeReadNotebooks();
      notebookCount = notebooks.length;
      for (const notebook of notebooks) {
        try {
          const bookmarks = await getWeReadBookmarks(notebook.bookId);
          bookmarkCount += bookmarks.length;
          const result = await importWeReadBookmarks(
            notebook.bookId,
            `weread-${notebook.bookId}`,
            bookmarks
          );
          importedNotes += result.imported;
          skippedNotes += result.skipped;
        } catch (error) {
          errors.push(
            `笔记导入失败(${notebook.bookId})：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      errors.push(`笔记列表获取失败：${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      store.dispatch(handleFetchNotes() as any);
    } catch {
      // refresh is best-effort
    }

    const now = Date.now();
    saveWereReadLastSync(now);
    this.setState({
      isSyncing: false,
      shelfItems,
      lastSync: now,
      syncResult: {
        shelfCount: shelfItems.length,
        bookmarkCount,
        notebookCount,
        importedNotes,
        skippedNotes,
        errors,
        syncedAt: now,
      },
    });
  };

  handleSearch = async (page = 1) => {
    const keyword = this.state.keyword.trim();
    if (!keyword || this.state.isLoading || this.state.isLoadingMore) return;
    if (!hasWeReadCredentials(this.state.config)) {
      this.setState({ error: "请先填写 vid、accessToken 和完整 User-Agent" });
      return;
    }
    if (page === 1) {
      this.setState({
        isLoading: true,
        isLoadingMore: false,
        books: [],
        selectedBook: null,
        chapters: [],
        error: "",
      });
    } else {
      this.setState({ isLoadingMore: true, error: "" });
    }
    try {
      const result = await searchWeRead(keyword, page);
      this.setState((state) => ({
        books: page === 1 ? result.books : [...state.books, ...result.books],
        page,
        hasMore: result.nextPage > 0,
      }));
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.setState({ isLoading: false, isLoadingMore: false });
    }
  };

  handleOpenBook = async (book: WeReadBook) => {
    this.setState({ selectedBook: book, chapters: [], isLoadingDetail: true, error: "" });
    try {
      const detail = await getWeReadBook(book);
      const chapters = await getWeReadChapters(detail);
      this.setState({ selectedBook: detail, chapters });
    } catch (error) {
      this.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.setState({ isLoadingDetail: false });
    }
  };

  renderCredentials() {
    const { config } = this.state;
    return (
      <section className="weread-panel weread-config">
        <div className="weread-section-title">
          <div><h2><Trans>Authorization parameters</Trans></h2></div>
        </div>
        <div className="weread-login-tabs">
          <button className={this.state.loginMode === "qr" ? "active" : ""} onClick={() => this.setState({ loginMode: "qr" })}>扫码登录</button>
          <button className={this.state.loginMode === "manual" ? "active" : ""} onClick={() => this.setState({ loginMode: "manual" })}>手动配置</button>
        </div>
        {this.state.loginMode === "qr" ? (
          <div className="weread-qr-login">
            <div className="weread-qr-mark"><span>微</span><i>⌁</i></div>
            <div><strong>在 Books 内嵌网页中扫码登录</strong><p>登录状态会保存在本机的内嵌网页中；Books 不会读取或保存你的微信账号密码。</p><button onClick={this.openQrLogin}>打开扫码登录</button></div>
          </div>
        ) : (
          <>
            <p className="weread-help"><Trans>Use parameters from your own authorized WeRead app session. They are stored locally on this device.</Trans></p>
            <div className="weread-form-grid">
              <label><span>vid</span><input value={config.vid} onChange={(event) => this.updateConfig({ vid: event.target.value })} /></label>
              <label><span>accessToken</span><input type="password" value={config.accessToken} onChange={(event) => this.updateConfig({ accessToken: event.target.value })} /></label>
              <label className="weread-wide"><span>User-Agent</span><input value={config.userAgent} onChange={(event) => this.updateConfig({ userAgent: event.target.value })} /></label>
            </div>
            <div className="weread-actions"><button onClick={this.saveConfig}><Trans>Save configuration</Trans></button></div>
          </>
        )}
      </section>
    );
  }

  renderSyncSection() {
    const { loginStatus, isSyncing, syncResult, lastSync } = this.state;
    return (
      <section className="weread-panel weread-sync">
        <div className="weread-section-title">
          <div>
            <h2>
              <Trans>Sync from WeRead</Trans>
            </h2>
          </div>
        </div>
        {loginStatus ? (
          <>
            <p className="weread-help">
              <Trans>
                Pull your shelf, reading progress, highlights and thoughts into
                Books. Your WeRead cloud is never modified.
              </Trans>
            </p>
            <div className="weread-actions">
              <button disabled={isSyncing} onClick={this.handleSync}>
                {isSyncing ? <Trans>Syncing</Trans> : <Trans>Sync now</Trans>}
              </button>
            </div>
          </>
        ) : (
          <div className="weread-qr-login">
            <div>
              <strong>
                <Trans>Not logged in</Trans>
              </strong>
              <p>
                <Trans>
                  Scan the WeRead QR code in the embedded browser to enable sync.
                </Trans>
              </p>
              <button onClick={this.openQrLogin}>
                <Trans>Open QR login</Trans>
              </button>
            </div>
          </div>
        )}
        {lastSync > 0 && (
          <small className="weread-last-sync">
            <Trans>Last sync</Trans>: {new Date(lastSync).toLocaleString()}
          </small>
        )}
        {syncResult && (
          <div className="weread-sync-result">
            <div>
              <span>
                <Trans>Shelf books</Trans>
              </span>
              <strong>{syncResult.shelfCount}</strong>
            </div>
            <div>
              <span>
                <Trans>Highlights imported</Trans>
              </span>
              <strong>{syncResult.importedNotes}</strong>
            </div>
            <div>
              <span>
                <Trans>Skipped (already synced)</Trans>
              </span>
              <strong>{syncResult.skippedNotes}</strong>
            </div>
            {syncResult.errors.length > 0 && (
              <pre className="weread-error">{syncResult.errors.join("\n")}</pre>
            )}
          </div>
        )}
      </section>
    );
  }

  render() {
    const { books, selectedBook, chapters } = this.state;
    return (
      <div className="weread-page">
        <main className="weread-main">
          <header className="weread-header">
            <h1>{this.state.config.name}</h1>
            <span><Trans>Search and browse metadata from your authorized account.</Trans></span>
          </header>
          {this.renderCredentials()}
          {this.renderSyncSection()}
          <section className="weread-search">
            <input
              value={this.state.keyword}
              placeholder={this.props.t("Search title, author or keyword")}
              onChange={(event) => this.setState({ keyword: event.target.value })}
              onKeyDown={(event) => event.key === "Enter" && this.handleSearch()}
            />
            <button disabled={this.state.isLoading} onClick={() => this.handleSearch()}><Trans>Search</Trans></button>
          </section>
          {this.state.error && <pre className="weread-error">{this.state.error}</pre>}
          {this.state.isLoading && <div className="weread-state"><i /><Trans>Searching...</Trans></div>}
          {books.length > 0 && (
            <section className="weread-results">
              <div className="weread-section-title"><div><h2><Trans>Search results</Trans></h2></div><span>{books.length}</span></div>
              <div className="weread-book-grid">
                {books.map((book) => (
                  <button key={book.id} className="weread-book" onClick={() => this.handleOpenBook(book)}>
                    <div className="weread-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" /> : <span>书</span>}</div>
                    <div><strong>{book.title}</strong><small>{book.author || this.props.t("Unknown author")}</small><em>{book.category || "WeRead"}</em></div>
                  </button>
                ))}
              </div>
              {this.state.hasMore && <button className="weread-more" disabled={this.state.isLoadingMore} onClick={() => this.handleSearch(this.state.page + 1)}><Trans>Load more books</Trans></button>}
            </section>
          )}
          {selectedBook && (
            <section className="weread-panel weread-detail">
              <div className="weread-section-title"><div><h2>{selectedBook.title}</h2></div><a href={safeExternalBookUrl(selectedBook.id)} target="_blank" rel="noreferrer"><Trans>Open in WeRead</Trans></a></div>
              <div className="weread-detail-copy"><strong>{selectedBook.author || this.props.t("Unknown author")}</strong><p>{selectedBook.description || this.props.t("No description parsed")}</p><small>{selectedBook.totalWords ? `${selectedBook.totalWords} · ` : ""}{selectedBook.updateTime}</small></div>
              {this.state.isLoadingDetail ? <div className="weread-state"><i /><Trans>Loading chapters...</Trans></div> : chapters.length > 0 ? <div className="weread-chapters">{chapters.map((chapter, index) => <div key={chapter.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{chapter.title}</strong>{chapter.isPaid && <em>授权限制</em>}</div>)}</div> : <p className="weread-help"><Trans>No chapter metadata was returned by WeRead.</Trans></p>}
              <p className="weread-notice"><Trans>Books does not decrypt protected chapter packages or bypass paid/member access. Open the book in WeRead to read content you are authorized to access.</Trans></p>
            </section>
          )}
        </main>
      </div>
    );
  }
}

export default WeRead;
