import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { WeReadShelfItem } from "../../models/WeRead";

const SHELF_NAMESPACE = "wereadShelf";
const LAST_SYNC_KEY = "wereadLastSync";

const isShelfItem = (value: unknown): value is WeReadShelfItem =>
  !!value && typeof value === "object" && !!(value as WeReadShelfItem).bookKey;

export const getWereReadShelf = (): WeReadShelfItem[] => {
  try {
    const value = ConfigService.getAllObjectConfig(SHELF_NAMESPACE) || {};
    return Object.values(value).filter(isShelfItem);
  } catch {
    return [];
  }
};

export const getWereReadShelfItem = (
  bookKey: string
): WeReadShelfItem | null => {
  try {
    const value = ConfigService.getObjectConfig(bookKey, SHELF_NAMESPACE, null);
    return isShelfItem(value) ? value : null;
  } catch {
    return null;
  }
};

export const saveWereReadShelfItem = (item: WeReadShelfItem): void => {
  try {
    ConfigService.setObjectConfig(item.bookKey, item, SHELF_NAMESPACE);
  } catch {
    // ignore storage failures — shelf is a cache, not authoritative
  }
};

export const saveWereReadShelf = (items: WeReadShelfItem[]): void => {
  for (const item of items) {
    saveWereReadShelfItem(item);
  }
};

export const getWereReadShelfNamesMap = (): { [bookKey: string]: string } => {
  const map: { [bookKey: string]: string } = {};
  for (const item of getWereReadShelf()) {
    if (item.bookKey && item.title) {
      map[item.bookKey] = item.title;
    }
  }
  return map;
};

export const getWereReadLastSync = (): number => {
  try {
    const value = ConfigService.getReaderConfig(LAST_SYNC_KEY);
    return value ? Number(value) || 0 : 0;
  } catch {
    return 0;
  }
};

export const saveWereReadLastSync = (timestamp: number): void => {
  try {
    ConfigService.setReaderConfig(LAST_SYNC_KEY, String(timestamp));
  } catch {
    // ignore
  }
};
