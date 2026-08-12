import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { WebBookmark } from "../../models/WebBookmark";

const BOOKMARKS_KEY = "webNavigatorBookmarks";

const isSecureBookmarkUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const isSecureFaviconUrl = (value: unknown) =>
  typeof value === "string" && isSecureBookmarkUrl(value);

export const getWebBookmarks = (): WebBookmark[] => {
  try {
    const value = ConfigService.getReaderConfig(BOOKMARKS_KEY);
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.url === "string" &&
          isSecureBookmarkUrl(item.url) &&
          typeof item.createdAt === "number"
      )
      .map((item) => {
        const { faviconUrl, ...bookmark } = item;
        return {
          ...bookmark,
          ...(isSecureFaviconUrl(faviconUrl) ? { faviconUrl } : {}),
        };
      })
      .slice(0, 100);
  } catch {
    return [];
  }
};

export const saveWebBookmarks = (bookmarks: WebBookmark[]) => {
  ConfigService.setReaderConfig(
    BOOKMARKS_KEY,
    JSON.stringify(bookmarks.slice(0, 100))
  );
};
