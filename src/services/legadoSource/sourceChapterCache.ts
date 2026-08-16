import { isElectron } from "react-device-detect";
import localforage from "localforage";

interface SourceChapterCache {
  read(bookId: string, chapterIndex: number): Promise<string>;
  write(bookId: string, chapterIndex: number, content: string): Promise<void>;
  deleteBook(bookId: string): Promise<void>;
}

const electronCache: SourceChapterCache = {
  read: async (bookId, chapterIndex) =>
    String(
      (await window.require("electron").ipcRenderer.invoke("source-cache-read", {
        bookId,
        chapterIndex,
      })) || ""
    ),
  write: async (bookId, chapterIndex, content) => {
    await window.require("electron").ipcRenderer.invoke("source-cache-write", {
      bookId,
      chapterIndex,
      content,
    });
  },
  deleteBook: async (bookId) => {
    await window.require("electron").ipcRenderer.invoke("source-cache-delete", {
      bookId,
    });
  },
};

const key = (bookId: string, chapterIndex: number) => `${bookId}:${chapterIndex}`;
const webStore = localforage.createInstance({
  name: "koodo-legado-source-cache",
  storeName: "chapters",
});

const webCache: SourceChapterCache = {
  read: async (bookId, chapterIndex) => {
    try {
      return String((await webStore.getItem(key(bookId, chapterIndex))) || "");
    } catch {
      return "";
    }
  },
  write: async (bookId, chapterIndex, content) => {
    await webStore.setItem(key(bookId, chapterIndex), content);
  },
  deleteBook: async (bookId) => {
    const keys = await webStore.keys();
    await Promise.all(
      keys
        .filter((item) => item.startsWith(`${bookId}:`))
        .map((item) => webStore.removeItem(item))
    );
  },
};

export const sourceChapterCache: SourceChapterCache =
  isElectron && (window as any).require ? electronCache : webCache;
