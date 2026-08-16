import { isElectron } from "react-device-detect";
import { PLUGIN_IPC } from "./pluginTypes";

/**
 * Storage adapter for installed plugin bundles.
 * Desktop: userData/plugins/<id>/ via the plugin-* IPC channels.
 * Web: IndexedDB (no filesystem available).
 */
export interface PluginStorage {
  readFile(relativePath: string): Promise<string | null>;
  writeFile(relativePath: string, content: string): Promise<boolean>;
  /** Deletes a file or a whole plugin directory ("id" removes id/**). */
  deletePath(relativePath: string): Promise<boolean>;
  /** Lists entries under a directory; "" lists installed plugin ids ("id/"). */
  listDir(relativePath: string): Promise<string[]>;
  readBundledPlugin(id: string): Promise<{ manifest: unknown; mainJs: string } | null>;
}

const electronStorage = (): PluginStorage => ({
  readFile: (relativePath) =>
    window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.readFile, { path: relativePath }),
  writeFile: (relativePath, content) =>
    window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.writeFile, { path: relativePath, content }),
  deletePath: (relativePath) =>
    window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.deleteFile, { path: relativePath }),
  listDir: (relativePath) =>
    window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.listDir, { path: relativePath }),
  readBundledPlugin: async (id) =>
    window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.readBundled, { id }),
});

const DB_NAME = "koodo-plugins";
const STORE = "files";
const VERSION = 1;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbOp = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const indexedDbStorage = (): PluginStorage => ({
  readFile: async (relativePath) => {
    try {
      const value = await idbOp<string | undefined>("readonly", (store) =>
        store.get(relativePath)
      );
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  },
  writeFile: async (relativePath, content) => {
    try {
      await idbOp("readwrite", (store) => store.put(content, relativePath));
      return true;
    } catch {
      return false;
    }
  },
  deletePath: async (relativePath) => {
    try {
      const entries = await idbOp<IDBValidKey[]>("readonly", (store) =>
        store.getAllKeys()
      );
      const tx = (await openDb()).transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // "id" or "id/" removes every key under that plugin directory.
      const prefix = relativePath.endsWith("/")
        ? relativePath
        : relativePath + "/";
      entries
        .filter(
          (key) =>
            key === relativePath ||
            (typeof key === "string" && key.startsWith(prefix))
        )
        .forEach((key) => store.delete(key));
      return true;
    } catch {
      return false;
    }
  },
  listDir: async (relativePath) => {
    try {
      const keys = await idbOp<IDBValidKey[]>("readonly", (store) =>
        store.getAllKeys()
      );
      const prefix = relativePath ? relativePath + "/" : "";
      const seen = new Set<string>();
      keys.forEach((key) => {
        if (typeof key !== "string" || !key.startsWith(prefix)) return;
        const rest = key.slice(prefix.length);
        if (!rest) return;
        const slash = rest.indexOf("/");
        seen.add(slash === -1 ? rest : rest.slice(0, slash + 1));
      });
      return Array.from(seen);
    } catch {
      return [];
    }
  },
  readBundledPlugin: async () => null,
});

export const getPluginStorage = (): PluginStorage =>
  isElectron && (window as any).require ? electronStorage() : indexedDbStorage();

/**
 * Download bytes through the main process (desktop) so proxies and size caps
 * live in one place. On web this is not available — callers fall back to
 * renderer fetch.
 */
export const pluginDownload = async (
  url: string
): Promise<Uint8Array | null> => {
  if (!(isElectron && (window as any).require)) return null;
  try {
    const { bytes } = await window
      .require("electron")
      .ipcRenderer.invoke(PLUGIN_IPC.download, { url });
    if (typeof bytes !== "string") return null;
    const binary = atob(bytes);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) buffer[i] = binary.charCodeAt(i);
    return buffer;
  } catch {
    return null;
  }
};
