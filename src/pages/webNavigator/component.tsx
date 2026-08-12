import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { WebBookmark, WebNavigatorState } from "../../models/WebBookmark";
import {
  getWebBookmarks,
  saveWebBookmarks,
} from "../../services/webNavigator/bookmarkStorage";
import { resolveNavigationInput } from "./navigationInput";
import { getStorageLocation } from "../../utils/common";
import "./webNavigator.css";

interface WebNavigatorProps {
  t: (key: string) => string;
  importBookFunc: (file: File) => Promise<void>;
}

interface WebNavigatorComponentState extends WebNavigatorState {
  address: string;
  bookmarks: WebBookmark[];
  isViewOpen: boolean;
  isEditorOpen: boolean;
  editingId: string;
  editorTitle: string;
  editorUrl: string;
}

const EMPTY_BROWSER_STATE: WebNavigatorState = {
  url: "",
  title: "",
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  error: "",
};

const getIpcRenderer = () => {
  try {
    return (window as any).require?.("electron")?.ipcRenderer || null;
  } catch {
    return null;
  }
};

class WebNavigator extends React.Component<
  WebNavigatorProps,
  WebNavigatorComponentState
> {
  viewportRef = React.createRef<HTMLDivElement>();
  resizeObserver: ResizeObserver | null = null;
  ipcRenderer = getIpcRenderer();

  constructor(props: WebNavigatorProps) {
    super(props);
    this.state = {
      ...EMPTY_BROWSER_STATE,
      address: "",
      bookmarks: getWebBookmarks(),
      isViewOpen: false,
      isEditorOpen: false,
      editingId: "",
      editorTitle: "",
      editorUrl: "",
    };
  }

  componentDidMount() {
    this.ipcRenderer?.on("web-navigator-state", this.handleBrowserState);
    this.ipcRenderer?.on("web-navigator-download", this.handleBookDownload);
    this.resizeObserver = new ResizeObserver(this.syncViewportBounds);
    if (this.viewportRef.current) {
      this.resizeObserver.observe(this.viewportRef.current);
    }
    window.addEventListener("resize", this.syncViewportBounds);
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.syncViewportBounds);
    this.ipcRenderer?.removeListener(
      "web-navigator-state",
      this.handleBrowserState
    );
    this.ipcRenderer?.removeListener(
      "web-navigator-download",
      this.handleBookDownload
    );
    this.ipcRenderer?.invoke("web-navigator-close");
  }

  handleBrowserState = (_event: unknown, state: WebNavigatorState) => {
    this.setState({
      ...state,
      address: state.url || this.state.address,
    });
  };

  handleBookDownload = async (
    _event: unknown,
    download: { ok: boolean; path?: string; fileName?: string; error?: string }
  ) => {
    if (!download.ok || !download.path || !download.fileName) {
      toast.error(download.error || this.props.t("Unable to add downloaded book"));
      return;
    }
    try {
      toast.loading(this.props.t("Adding downloaded book to bookshelf"), {
        id: "web-navigator-download",
      });
      const fs = (window as any).require("fs");
      const data = fs.readFileSync(download.path);
      const file = new File([data], download.fileName);
      await this.props.importBookFunc(file);
      toast.success(this.props.t("Downloaded and added to bookshelf"), {
        id: "web-navigator-download",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${this.props.t("Import failed")}: ${message}`, {
        id: "web-navigator-download",
      });
    }
  };

  getViewportBounds = () => {
    const rect = this.viewportRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  };

  syncViewportBounds = () => {
    if (!this.state.isViewOpen || !this.ipcRenderer) return;
    const bounds = this.getViewportBounds();
    if (bounds) this.ipcRenderer.invoke("web-navigator-resize", bounds);
  };

  openUrl = (value: string) => {
    const url = resolveNavigationInput(value);
    if (!url) {
      toast.error(this.props.t("Only secure HTTPS websites are supported"));
      return;
    }
    if (!this.ipcRenderer) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    this.setState(
      {
        address: url,
        url,
        error: "",
        isLoading: true,
        isViewOpen: true,
        isEditorOpen: false,
      },
      () => {
        requestAnimationFrame(async () => {
          const bounds = this.getViewportBounds();
          if (!bounds) return;
          try {
            const ok = await this.ipcRenderer.invoke("web-navigator-open", {
              url,
              bounds,
              libraryPath: getStorageLocation(),
            });
            if (ok) return;
            this.setState({
              isViewOpen: false,
              isLoading: false,
              error: this.props.t("Unable to open this website"),
            });
          } catch (error) {
            this.setState({
              isViewOpen: false,
              isLoading: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }
    );
  };

  navigate = async () => {
    const url = resolveNavigationInput(this.state.address);
    if (!url) {
      toast.error(this.props.t("Only secure HTTPS websites are supported"));
      return;
    }
    if (!this.state.isViewOpen) {
      this.openUrl(url);
      return;
    }
    this.setState({ address: url, error: "" });
    try {
      const ok = await this.ipcRenderer?.invoke("web-navigator-navigate", url);
      if (ok !== false) return;
      this.setState({ error: this.props.t("Unable to open this website") });
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  goHome = () => {
    this.ipcRenderer?.invoke("web-navigator-close");
    this.setState({
      ...EMPTY_BROWSER_STATE,
      address: "",
      isViewOpen: false,
      isEditorOpen: false,
    });
  };

  openEditor = (bookmark?: WebBookmark) => {
    this.setState({
      isEditorOpen: true,
      editingId: bookmark?.id || "",
      editorTitle: bookmark?.title || "",
      editorUrl: bookmark?.url || this.state.url || "",
    });
  };

  saveBookmark = () => {
    const url = resolveNavigationInput(this.state.editorUrl);
    const title = this.state.editorTitle.trim();
    if (!title || !url) {
      toast.error(this.props.t("Enter a name and a secure HTTPS address"));
      return;
    }
    const existingIndex = this.state.bookmarks.findIndex(
      (item) => item.id === this.state.editingId || item.url === url
    );
    const bookmark: WebBookmark = {
      id:
        existingIndex >= 0
          ? this.state.bookmarks[existingIndex].id
          : `bookmark-${Date.now()}`,
      title,
      url,
      createdAt:
        existingIndex >= 0
          ? this.state.bookmarks[existingIndex].createdAt
          : Date.now(),
    };
    const bookmarks = [...this.state.bookmarks];
    if (existingIndex >= 0) bookmarks[existingIndex] = bookmark;
    else bookmarks.unshift(bookmark);
    saveWebBookmarks(bookmarks);
    this.setState({
      bookmarks,
      isEditorOpen: false,
      editingId: "",
      editorTitle: "",
      editorUrl: "",
    });
    toast.success(this.props.t("Bookmark saved"));
  };

  bookmarkCurrentPage = () => {
    if (!this.state.url) {
      this.openEditor();
      return;
    }
    let title = this.state.title;
    if (!title) {
      try {
        title = new URL(this.state.url).hostname;
      } catch {
        title = this.props.t("Website");
      }
    }
    this.setState(
      {
        isEditorOpen: true,
        editingId: "",
        editorTitle: title,
        editorUrl: this.state.url,
      },
      this.syncViewportBounds
    );
  };

  deleteBookmark = (id: string) => {
    const bookmarks = this.state.bookmarks.filter((item) => item.id !== id);
    saveWebBookmarks(bookmarks);
    this.setState({ bookmarks });
  };

  renderToolbar() {
    return (
      <div className="web-navigator-toolbar">
        <div className="web-navigator-controls">
          <button
            aria-label={this.props.t("Navigation home")}
            title={this.props.t("Navigation home")}
            onClick={this.goHome}
          >
            <span className="icon-home-line" />
          </button>
          <button
            disabled={!this.state.canGoBack}
            aria-label={this.props.t("Back")}
            onClick={() => this.ipcRenderer?.invoke("web-navigator-action", "back")}
          >
            ←
          </button>
          <button
            disabled={!this.state.canGoForward}
            aria-label={this.props.t("Forward")}
            onClick={() => this.ipcRenderer?.invoke("web-navigator-action", "forward")}
          >
            →
          </button>
          <button
            aria-label={this.props.t(this.state.isLoading ? "Stop" : "Reload")}
            onClick={() =>
              this.ipcRenderer?.invoke(
                "web-navigator-action",
                this.state.isLoading ? "stop" : "reload"
              )
            }
          >
            {this.state.isLoading ? "×" : "↻"}
          </button>
        </div>
        <div className="web-navigator-address">
          <span>https://</span>
          <input
            value={this.state.address}
            placeholder={this.props.t("Enter a website or search")}
            onChange={(event) => this.setState({ address: event.target.value })}
            onKeyDown={(event) => event.key === "Enter" && this.navigate()}
          />
          {this.state.isLoading && <i />}
        </div>
        <button
          className="web-navigator-go"
          onClick={this.navigate}
        >
          <Trans>Go</Trans>
        </button>
        <button
          className="web-navigator-bookmark-current"
          title={this.props.t("Bookmark current page")}
          aria-label={this.props.t("Bookmark current page")}
          onClick={this.bookmarkCurrentPage}
        >
          <span className="icon-bookmark" />
        </button>
      </div>
    );
  }

  renderEditor() {
    if (!this.state.isEditorOpen) return null;
    return (
      <div className="web-bookmark-editor">
        <div>
          <label><Trans>Bookmark name</Trans></label>
          <input
            autoFocus
            value={this.state.editorTitle}
            placeholder={this.props.t("Example: My library")}
            onChange={(event) => this.setState({ editorTitle: event.target.value })}
          />
        </div>
        <div>
          <label><Trans>Website address</Trans></label>
          <input
            value={this.state.editorUrl}
            placeholder="https://example.com"
            onChange={(event) => this.setState({ editorUrl: event.target.value })}
            onKeyDown={(event) => event.key === "Enter" && this.saveBookmark()}
          />
        </div>
        <button onClick={this.saveBookmark}><Trans>Save bookmark</Trans></button>
        <button
          className="web-bookmark-editor-cancel"
          onClick={() => this.setState({ isEditorOpen: false })}
        >
          <Trans>Cancel</Trans>
        </button>
      </div>
    );
  }

  renderHome() {
    return (
      <div className="web-navigator-home">
        <div className="web-navigator-intro">
          <p><Trans>PERSONAL WEB DESK</Trans></p>
          <h1><Trans>Your websites, one quiet shelf.</Trans></h1>
          <span>
            <Trans>Add the websites you use, then open them without leaving the reader.</Trans>
          </span>
          <button onClick={() => this.openEditor()}>
            <span className="icon-add" /> <Trans>Add website</Trans>
          </button>
        </div>
        <section className="web-bookmark-section">
          <div className="web-bookmark-section-title">
            <h2><Trans>Bookmarks</Trans></h2>
            <span>{this.state.bookmarks.length}</span>
          </div>
          {this.state.bookmarks.length === 0 ? (
            <div className="web-bookmark-empty">
              <span className="icon-bookmark" />
              <p><Trans>No bookmarks yet</Trans></p>
              <small><Trans>Add a website to build your navigation page.</Trans></small>
            </div>
          ) : (
            <div className="web-bookmark-grid">
              {this.state.bookmarks.map((bookmark) => (
                <article key={bookmark.id}>
                  <button
                    className="web-bookmark-open"
                    onClick={() => this.openUrl(bookmark.url)}
                  >
                    <span>{bookmark.title.slice(0, 1).toUpperCase()}</span>
                    <strong>{bookmark.title}</strong>
                    <small>{new URL(bookmark.url).hostname}</small>
                  </button>
                  <div>
                    <button onClick={() => this.openEditor(bookmark)}><Trans>Edit</Trans></button>
                    <button onClick={() => this.deleteBookmark(bookmark.id)}><Trans>Delete</Trans></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  render() {
    return (
      <div className="web-navigator-page">
        <header className="web-navigator-header">
          <div>
            <p><Trans>Web navigation</Trans></p>
            <h2><Trans>Web Desk</Trans></h2>
          </div>
          <div className="web-navigator-vault-note">
            <span><Trans>Books you download here are added to the current library.</Trans></span>
            <small title={getStorageLocation() || ""}>{getStorageLocation() || ""}</small>
          </div>
        </header>
        {this.renderToolbar()}
        {this.renderEditor()}
        {this.state.error && (
          <div className="web-navigator-error">{this.state.error}</div>
        )}
        <main
          ref={this.viewportRef}
          className={`web-navigator-viewport ${
            this.state.isViewOpen ? "is-browser-open" : ""
          }`}
        >
          {this.state.isViewOpen ? (
            <div className="web-navigator-native-placeholder">
              <span /> <Trans>Opening secure browser...</Trans>
            </div>
          ) : (
            this.renderHome()
          )}
        </main>
      </div>
    );
  }
}

export default WebNavigator;
