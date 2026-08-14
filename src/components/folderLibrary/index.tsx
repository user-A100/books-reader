import React from "react";
import toast from "react-hot-toast";
import Book from "../../models/Book";
import BookUtil from "../../utils/file/bookUtil";
import DatabaseService from "../../utils/storage/databaseService";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { BOOK_DRAG_TYPE, parseBookDragData } from "../../utils/reader/bookDrag";
import { supportedFormats, vexPromptAsync } from "../../utils/common";
import "./folderLibrary.css";

declare var window: any;

type LibraryEntry = {
  name: string;
  path: string;
  type: "folder" | "file";
  size: number;
  mtimeMs: number;
  folderBook?: {
    path: string;
    title: string;
    mode: "text-sequence";
    chapterCount: number;
  };
};

type Props = {
  books: Book[];
  importBookFunc: (file: any) => Promise<void>;
  handleFetchBooks: () => void;
  history: any;
  t: (key: string) => string;
};

type State = {
  root: string;
  entries: LibraryEntry[];
  expanded: string[];
  selectedFolder: string;
  loading: boolean;
  isPanelOpen: boolean;
  status: "idle" | "loading" | "error" | "success";
  errorMessage: string;
};

const IMPORT_INDEX_KEY = "folderLibraryImportIndex";
const SUPPRESSED_BOOKS_KEY = "folderLibrarySuppressedBooks";

export default class FolderLibrary extends React.Component<Props, State> {
  private importReady = false;
  private importingPaths = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  state: State = {
    root: ConfigService.getItem("folderLibraryPath") || "",
    entries: [],
    expanded: [],
    selectedFolder: "",
    loading: false,
    isPanelOpen: false,
    status: "idle",
    errorMessage: "",
  };

  componentDidMount() {
    if (!this.isElectron()) return;
    this.importReady = typeof this.props.importBookFunc === "function";
    const { ipcRenderer } = window.require("electron");
    const onChange = (
      _event: any,
      change: { event?: string; path?: string; entry?: LibraryEntry | null } = {}
    ) => {
      if (
        this.state.root &&
        change.path &&
        (change.event === "unlink" || change.event === "unlinkDir")
      ) {
        const path = window.require("path");
        const removedPath = path.join(this.state.root, ...change.path.split("/"));
        const index = this.readImportIndex();
        Object.keys(index).forEach((item) => {
          if (item === removedPath || item.startsWith(`${removedPath}${path.sep}`)) delete index[item];
        });
        ConfigService.setItem(IMPORT_INDEX_KEY, JSON.stringify(index));
        this.setState((state) => ({
          entries: state.entries.filter(
            (entry) => entry.path !== change.path && !entry.path.startsWith(`${change.path}/`)
          ),
        }), this.scheduleRefresh);
        return;
      }
      if (change.entry) {
        this.setState((state) => ({
          entries: [
            ...state.entries.filter((entry) => entry.path !== change.entry!.path),
            change.entry!,
          ],
        }), this.scheduleRefresh);
      }
    };
    ipcRenderer.on("folder-library-changed", onChange);
    this.unsubscribe = () => ipcRenderer.removeListener("folder-library-changed", onChange);
    if (this.state.root) this.open(this.state.root);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.importBookFunc !== this.props.importBookFunc) {
      this.importReady = true;
      this.importNewFiles(this.state.entries);
    }
  }

  componentWillUnmount() {
    this.unsubscribe?.();
    if (this.statusTimer) clearTimeout(this.statusTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  isElectron = () => Boolean(window.require);

  invoke = (channel: string, payload?: any) =>
    window.require("electron").ipcRenderer.invoke(channel, payload);

  getErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No handler registered")) {
      return this.props.t("Folder library service is not ready. Restart Books and try again.");
    }
    return message;
  };

  setStatus = (
    status: State["status"],
    errorMessage = ""
  ) => {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.setState({ status, errorMessage });
    if (status === "success") {
      this.statusTimer = setTimeout(
        () => this.setState({ status: "idle", errorMessage: "" }),
        1400
      );
    }
  };

  open = async (root: string) => {
    this.setState({ loading: true, status: "loading", errorMessage: "" });
    try {
      const result = await this.invoke("folder-library-open", { root });
      ConfigService.setItem("folderLibraryPath", result.root);
      this.setState(
        {
          root: result.root,
          entries: result.entries,
          loading: false,
          status: "success",
          errorMessage: "",
          isPanelOpen: true,
        },
        () => {
          this.importNewFiles(result.entries);
          this.setStatus("success");
        }
      );
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setState({ loading: false, status: "error", errorMessage: message });
      toast.error(message);
    }
  };

  selectLibrary = async () => {
    this.setState({ loading: true, status: "loading", errorMessage: "" });
    try {
      const root = await this.invoke("folder-library-select");
      if (root) {
        await this.open(root);
      } else {
        this.setState({ loading: false });
        this.setStatus("idle");
      }
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setState({ loading: false });
      this.setStatus("error", message);
      toast.error(message);
    }
  };

  refresh = async (shouldImport = false) => {
    if (!this.state.root) return;
    try {
      this.setState({ loading: true, status: "loading", errorMessage: "" });
      const result = await this.invoke("folder-library-scan", { root: this.state.root });
      this.setState({ root: result.root, entries: result.entries, loading: false });
      if (shouldImport) await this.importNewFiles(result.entries);
      this.setStatus("success");
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setState({ loading: false });
      this.setStatus("error", message);
      toast.error(message);
    }
  };

  readImportIndex = (): Record<string, string> => {
    try {
      return JSON.parse(ConfigService.getItem(IMPORT_INDEX_KEY) || "{}");
    } catch {
      return {};
    }
  };

  scheduleRefresh = () => {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(true), 450);
  };

  isInsideFolder = (entryPath: string, folderPath: string) =>
    entryPath === folderPath || entryPath.startsWith(`${folderPath}/`);

  importFolderBook = async (
    entry: LibraryEntry,
    index: Record<string, string>,
    databaseBooks: Book[]
  ): Promise<{ imported: number; sourceKey: string; suppressedKeys: string[] }> => {
    if (!entry.folderBook || !this.state.root) {
      return { imported: 0, sourceKey: "", suppressedKeys: [] };
    }
    const path = window.require("path");
    const fs = window.require("fs");
    const sourceKey = `folder:${path.join(this.state.root, ...entry.path.split("/"))}`;
    if (this.importingPaths.has(sourceKey)) {
      return { imported: 0, sourceKey, suppressedKeys: [] };
    }
    this.importingPaths.add(sourceKey);
    try {
      const composed = await this.invoke("folder-library-compose-book", {
        root: this.state.root,
        folder: entry.path,
      });
      const normalizedCachePath = path.normalize(composed.path).toLowerCase();
      const legacyCachePath = normalizedCachePath.replace(/\.epub$/, ".md");
      const compositeRecords = databaseBooks
        .filter(
          (book) => {
            if (!book.path) return false;
            const bookPath = path.normalize(book.path).toLowerCase();
            return bookPath === normalizedCachePath || bookPath === legacyCachePath;
          }
        )
        .sort((left, right) => String(left.key).localeCompare(String(right.key), undefined, { numeric: true }));
      const existing = compositeRecords[0];
      const normalizedSourcePath = path
        .normalize(path.join(this.state.root, ...entry.path.split("/")))
        .toLowerCase();
      const sourcePrefix = `${normalizedSourcePath}${path.sep}`;
      const sourceBookKeys = databaseBooks
        .filter((book) => {
          if (!book.path) return false;
          const bookPath = path.normalize(book.path).toLowerCase();
          const extension = path.extname(bookPath).toLowerCase();
          return bookPath.startsWith(sourcePrefix) && (extension === ".md" || extension === ".txt");
        })
        .map((book) => book.key);
      const duplicateCompositeKeys = compositeRecords.slice(1).map((book) => book.key);
      const suppressedKeys = Array.from(new Set([...sourceBookKeys, ...duplicateCompositeKeys]));
      const fingerprint = `${composed.size}:${Math.round(composed.mtimeMs)}`;
      index[sourceKey] = fingerprint;
      if (existing) {
        if (
          existing.size !== composed.size ||
          existing.name !== composed.title ||
          existing.format !== "EPUB" ||
          path.normalize(existing.path).toLowerCase() !== normalizedCachePath
        ) {
          existing.size = composed.size;
          existing.name = composed.title;
          existing.format = "EPUB";
          existing.path = composed.path;
          await DatabaseService.updateRecord(existing, "books");
        }
        return { imported: 0, sourceKey, suppressedKeys };
      }
      const buffer = await fs.promises.readFile(composed.path);
      const file: any = new File([new Uint8Array(buffer)], composed.name);
      file.path = composed.path;
      await this.props.importBookFunc(file);
      return { imported: 1, sourceKey, suppressedKeys };
    } catch (error) {
      console.error("Folder chapter book import failed", entry.path, error);
      return { imported: 0, sourceKey, suppressedKeys: [] };
    } finally {
      this.importingPaths.delete(sourceKey);
    }
  };

  importNewFiles = async (entries: LibraryEntry[]) => {
    if (!this.importReady || !this.state.root) return;
    const path = window.require("path");
    const fs = window.require("fs");
    const index = this.readImportIndex();
    let imported = 0;
    const databaseBooks = (await DatabaseService.getAllRecords("books")) as Book[];
    const suppressionMap: Record<string, string[]> = {};
    const folderBooks = entries.filter(
      (entry) => entry.type === "folder" && entry.folderBook
    );
    for (const folderBook of folderBooks) {
      const result = await this.importFolderBook(folderBook, index, databaseBooks);
      imported += result.imported;
      if (result.sourceKey) suppressionMap[result.sourceKey] = result.suppressedKeys;
    }
    for (const entry of entries) {
      if (entry.type !== "file") continue;
      if (folderBooks.some((folder) => this.isInsideFolder(entry.path, folder.path))) continue;
      const fingerprint = `${entry.size}:${Math.round(entry.mtimeMs)}`;
      const absolutePath = path.join(this.state.root, ...entry.path.split("/"));
      // The existing importer identifies books by content hash. Re-importing an
      // edited Markdown file would otherwise create a second book record, so
      // the folder index treats an already-seen path as the same library item.
      if (Object.prototype.hasOwnProperty.call(index, absolutePath)) continue;
      if (this.importingPaths.has(absolutePath)) continue;
      this.importingPaths.add(absolutePath);
      try {
        const buffer = await fs.promises.readFile(absolutePath);
        const file: any = new File([new Uint8Array(buffer)], entry.name);
        file.path = absolutePath;
        await this.props.importBookFunc(file);
        index[absolutePath] = fingerprint;
        imported++;
      } catch (error) {
        console.error("Folder library import failed", absolutePath, error);
      } finally {
        this.importingPaths.delete(absolutePath);
      }
    }
    ConfigService.setItem(IMPORT_INDEX_KEY, JSON.stringify(index));
    ConfigService.setItem(SUPPRESSED_BOOKS_KEY, JSON.stringify(suppressionMap));
    this.props.handleFetchBooks();
    if (imported > 0) toast.success(`${this.props.t("Library synchronized")}: ${imported}`);
  };

  toggleFolder = (folderPath: string) => {
    this.setState((state) => ({
      selectedFolder: folderPath,
      expanded: state.expanded.includes(folderPath)
        ? state.expanded.filter((item) => item !== folderPath)
        : [...state.expanded, folderPath],
    }));
  };

  createEntry = async (type: "folder" | "markdown") => {
    if (!this.state.root) return this.selectLibrary();
    const name = await vexPromptAsync(
      this.props.t(type === "folder" ? "New folder" : "New Markdown note"),
      type === "folder" ? this.props.t("Folder name") : "note.md"
    );
    if (!name || typeof name !== "string") return;
    try {
      this.setState({ loading: true, status: "loading", errorMessage: "" });
      await this.invoke("folder-library-create", {
        root: this.state.root,
        parent: this.state.selectedFolder,
        type,
        name,
      });
      if (this.state.selectedFolder) {
        this.setState((state) => ({
          expanded: Array.from(new Set([...state.expanded, state.selectedFolder])),
        }));
      }
      this.setState({ loading: false });
      this.setStatus("success");
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setState({ loading: false });
      this.setStatus("error", message);
      toast.error(message);
    }
  };

  openBook = async (entry: LibraryEntry) => {
    const path = window.require("path");
    const absolutePath = path.normalize(path.join(this.state.root, ...entry.path.split("/")));
    const book = this.props.books.find(
      (item) => item.path && path.normalize(item.path).toLowerCase() === absolutePath.toLowerCase()
    );
    if (book) {
      ConfigService.setItem("tempBook", JSON.stringify(book));
      BookUtil.redirectBook(book);
      this.props.history.push("/manager/home");
      return;
    }
    await this.importNewFiles([entry]);
  };

  dropOnFolder = async (event: React.DragEvent, target: string) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (Array.from(event.dataTransfer.types).includes("application/x-books-library-entry")) {
        const source = event.dataTransfer.getData("application/x-books-library-entry");
        if (source && source !== target) {
          const path = window.require("path");
          const oldAbsolutePath = path.normalize(path.join(this.state.root, ...source.split("/")));
          const movedPath = await this.invoke("folder-library-move", {
            root: this.state.root,
            source,
            target,
          });
          const movedBook = this.props.books.find(
            (book) =>
              book.path && path.normalize(book.path).toLowerCase() === oldAbsolutePath.toLowerCase()
          );
          if (movedBook) {
            movedBook.path = path.join(this.state.root, ...String(movedPath).split("/"));
            await DatabaseService.saveRecord(movedBook, "books");
            this.props.handleFetchBooks();
          }
        }
      } else if (Array.from(event.dataTransfer.types).includes(BOOK_DRAG_TYPE)) {
        const keys = parseBookDragData(event);
        const sources = this.props.books
          .filter((book) => keys.includes(book.key) && book.path)
          .map((book) => book.path);
        if (sources.length) {
          await this.invoke("folder-library-copy-files", { root: this.state.root, sources, target });
        } else {
          toast.error(this.props.t("The original file is unavailable"));
        }
      } else if (event.dataTransfer.files.length) {
        const electron = window.require("electron");
        const sources = Array.from(event.dataTransfer.files)
          .map((file: any) => file.path || electron.webUtils?.getPathForFile(file))
          .filter(Boolean)
          .filter((filePath: string) =>
            supportedFormats.includes(window.require("path").extname(filePath).toLowerCase())
          );
        await this.invoke("folder-library-copy-files", { root: this.state.root, sources, target });
      }
      this.setStatus("success");
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setStatus("error", message);
      toast.error(message);
    }
  };

  showInFolder = async () => {
    if (!this.state.root) return;
    try {
      await this.invoke("folder-library-show", { root: this.state.root });
      this.setStatus("success");
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.setStatus("error", message);
      toast.error(message);
    }
  };

  renderEntries = (parent = "", depth = 0): React.ReactNode[] => {
    return this.state.entries
      .filter((entry) => {
        const slash = entry.path.lastIndexOf("/");
        return (slash < 0 ? "" : entry.path.slice(0, slash)) === parent;
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      })
      .flatMap((entry) => {
        const isFolder = entry.type === "folder";
        const isExpanded = this.state.expanded.includes(entry.path);
        const row = (
          <React.Fragment key={entry.path}>
            <li
              className={`folder-library-row${this.state.selectedFolder === entry.path ? " selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 16 }}
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.setData("application/x-books-library-entry", entry.path);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={isFolder ? (event) => event.preventDefault() : undefined}
              onDrop={isFolder ? (event) => this.dropOnFolder(event, entry.path) : undefined}
              onClick={() => (isFolder ? this.toggleFolder(entry.path) : this.openBook(entry))}
              title={entry.path}
            >
              <span className="folder-library-chevron">{isFolder ? (isExpanded ? <svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></svg> : <svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg>) : null}</span>
              <span className="folder-library-fileicon" aria-hidden="true">
                {isFolder ? (
                  <svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2a1.5 1.5 0 0 1 1.06.44L11.2 6.8h6.3A1.5 1.5 0 0 1 19 8.3v8.2A1.5 1.5 0 0 1 17.5 18h-13A1.5 1.5 0 0 1 3 16.5Z" /></svg>
                ) : entry.name.toLowerCase().endsWith(".md") ? (
                  <svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0V3Z" /><path d="M14 3v5h5" /><path d="M8 14l2 2.5L12 14M14.5 14v3.5" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24"><path d="M5 3h9l5 5v13a0 0 0 0 1 0 0H5a0 0 0 0 1 0 0V3Z" /><path d="M14 3v5h5" /></svg>
                )}
              </span>
              <span className="folder-library-name">{entry.name}</span>
            </li>
            {isFolder && isExpanded ? this.renderEntries(entry.path, depth + 1) : null}
          </React.Fragment>
        );
        return [row];
      });
  };

  vaultName = () => {
    if (!this.state.root) return this.props.t("Open library folder");
    const parts = this.state.root.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || this.state.root;
  };

  togglePanel = () => {
    if (!this.state.root) {
      this.selectLibrary();
      return;
    }
    this.setState((state) => ({ isPanelOpen: !state.isPanelOpen }));
  };

  closePanel = () => this.setState({ isPanelOpen: false });

  render() {
    const isElectron = this.isElectron();
    if (!isElectron) return null;
    const { status, errorMessage, isPanelOpen, root, entries, loading } = this.state;
    const stateClass =
      status === "loading" ? " is-loading" : status === "error" ? " is-error" : status === "success" ? " is-success" : "";
    const isNight =
      ConfigService.getReaderConfig("appSkin") === "night" ||
      (ConfigService.getReaderConfig("appSkin") === "system" &&
        ConfigService.getReaderConfig("isOSNight") === "yes");
    return (
      <div className={`folder-library${stateClass}${isNight ? " is-night" : ""}`}>
        <div className="folder-library-switcher">
          <button
            type="button"
            className="folder-library-identity"
            onClick={this.togglePanel}
            title={root || this.props.t("Open library folder")}
          >
            <span className="folder-library-vault-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 7.5v9A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5Z" />
                <path d="M3 10h18M8 14h2" />
              </svg>
            </span>
            <span className="folder-library-current-copy">
              <span className="folder-library-current-name">{this.vaultName()}</span>
              <span className="folder-library-current-location">{root}</span>
            </span>
          </button>
          <button
            type="button"
            className="folder-library-manage"
            onClick={this.togglePanel}
            title={this.props.t("Manage library")}
            aria-label={this.props.t("Manage library")}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
          </button>
        </div>

        {isPanelOpen && (
          <div className="folder-library-popover" role="dialog" aria-modal="false">
            <div className="folder-library-heading">
              <span className="folder-library-title">
                {root ? this.vaultName() : this.props.t("Library")}
              </span>
              <span className="folder-library-actions">
                <button onClick={this.selectLibrary} title={this.props.t("Open library folder")}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
                </button>
                <button
                  onClick={() => this.createEntry("folder")}
                  title={this.props.t("New folder")}
                  disabled={!root || loading}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2a1.5 1.5 0 0 1 1.06.44L11.2 6.8h6.3A1.5 1.5 0 0 1 19 8.3v8.2A1.5 1.5 0 0 1 17.5 18h-13A1.5 1.5 0 0 1 3 16.5Z" /><path d="M12 11v3M10.5 12.5h3" /></svg>
                </button>
                <button
                  onClick={() => this.createEntry("markdown")}
                  title={this.props.t("New Markdown note")}
                  disabled={!root || loading}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h9l5 5v13H5V3Z" /><path d="M14 3v5h5" /><path d="M8 14l2 2.5L12 14M14.5 14v3.5" /></svg>
                </button>
                <button
                  onClick={() => this.refresh(true)}
                  title={this.props.t("Refresh")}
                  disabled={!root || loading}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" /></svg>
                </button>
                <button onClick={this.showInFolder} title={this.props.t("Show in folder")} disabled={!root}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 10l4-4M7.5 4.5h4v4" /><path d="M13 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h3" /></svg>
                </button>
                <button onClick={this.closePanel} title={this.props.t("Close")} aria-label={this.props.t("Close")}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                </button>
              </span>
            </div>
            {status === "error" && errorMessage ? (
              <p className="folder-library-error">{errorMessage}</p>
            ) : entries.length === 0 ? (
              <p className="folder-library-empty">
                {root ? this.props.t("No entries") : this.props.t("No library selected")}
              </p>
            ) : (
              <ul className="folder-library-tree">{this.renderEntries()}</ul>
            )}
          </div>
        )}
      </div>
    );
  }
}
