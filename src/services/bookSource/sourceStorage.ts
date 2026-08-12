import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { BookSource } from "../../models/BookSource";

const SOURCE_LIST_KEY = "bookSourceList";
const SOURCE_MAP_KEY = "bookSources";

export const getBookSources = (): BookSource[] => {
  const ids: string[] = ConfigService.getAllListConfig(SOURCE_LIST_KEY) || [];
  return ids
    .map((id) => ConfigService.getObjectConfig(id, SOURCE_MAP_KEY, null))
    .filter((source): source is BookSource => !!source);
};

export const saveBookSource = (source: BookSource): void => {
  ConfigService.setObjectConfig(source.id, source, SOURCE_MAP_KEY);
  ConfigService.setListConfig(source.id, SOURCE_LIST_KEY);
};

export const deleteBookSource = (id: string): void => {
  ConfigService.deleteListConfig(id, SOURCE_LIST_KEY);
  ConfigService.deleteObjectConfig(id, SOURCE_MAP_KEY);
};

export const setBookSourceEnabled = (id: string, enabled: boolean): void => {
  const source = ConfigService.getObjectConfig(
    id,
    SOURCE_MAP_KEY,
    null
  ) as BookSource | null;
  if (!source) return;
  saveBookSource({ ...source, enabled });
};
