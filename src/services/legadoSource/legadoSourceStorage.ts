import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { LegadoBookSource, validateLegadoSource } from "./legadoSourceModel";

/**
 * Legado book-source storage.
 *
 * Sources are stored in ConfigService under the legado-engine plugin's
 * namespaced storage key so the plugin (running in its worker) reads them
 * through host.storage.get("legado-sources") — same data, no extra IPC.
 */

export const LEGADO_SOURCES_KEY = "plugin:legado-engine:legado-sources";
const MAX_SOURCES = 500;

export const getLegadoSources = (): LegadoBookSource[] => {
  try {
    const raw = ConfigService.getReaderConfig(LEGADO_SOURCES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(validateLegadoSource)
      .filter((item): item is LegadoBookSource => item !== null);
  } catch {
    return [];
  }
};

export const saveLegadoSources = (sources: LegadoBookSource[]): void => {
  ConfigService.setReaderConfig(
    LEGADO_SOURCES_KEY,
    JSON.stringify(sources.slice(0, MAX_SOURCES))
  );
};

/** Adds sources (deduplicated by bookSourceUrl). Returns the number added. */
export const addLegadoSources = (incoming: LegadoBookSource[]): number => {
  const existing = getLegadoSources();
  const seen = new Set(existing.map((source) => source.bookSourceUrl));
  const fresh = incoming.filter((source) => !seen.has(source.bookSourceUrl));
  if (fresh.length) {
    saveLegadoSources([...existing, ...fresh].slice(0, MAX_SOURCES));
  }
  return fresh.length;
};

export const removeLegadoSource = (bookSourceUrl: string): void => {
  saveLegadoSources(
    getLegadoSources().filter((source) => source.bookSourceUrl !== bookSourceUrl)
  );
};

export const setLegadoSourceEnabled = (
  bookSourceUrl: string,
  enabled: boolean
): void => {
  saveLegadoSources(
    getLegadoSources().map((source) =>
      source.bookSourceUrl === bookSourceUrl ? { ...source, enabled } : source
    )
  );
};
