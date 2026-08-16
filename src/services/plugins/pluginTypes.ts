import { PluginManifest } from "../../models/Plugin";
import { parseSemver } from "../../utils/semver";

/** Maximum accepted size of a plugin's main.js bundle. */
export const PLUGIN_MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
/** Maximum accepted size of a single httpFetch response body. */
export const PLUGIN_FETCH_MAX_BYTES = 20 * 1024 * 1024;
/** httpFetch timeout in milliseconds. */
export const PLUGIN_FETCH_TIMEOUT_MS = 30_000;
/** IPC channels backed by the main-process plugin file store. */
export const PLUGIN_IPC = {
  readFile: "plugin-read-file",
  writeFile: "plugin-write-file",
  deleteFile: "plugin-delete-file",
  listDir: "plugin-list-dir",
  download: "plugin-download",
  readBundled: "plugin-read-bundled",
} as const;

/** What gets persisted per installed plugin (storage key: the plugin id). */
export interface InstalledPluginRecord {
  manifest: PluginManifest;
  /** SHA-256 hex digest of mainJs at install time; re-verified on every load. */
  sha256: string;
  installedAt: number;
  enabled: boolean;
}

/** A bookSource-category engine registered by a plugin through the host API. */
export interface BookSourceEngine {
  id: string;
  search: (source: unknown, keyword: string) => Promise<unknown[]>;
  getBookDetail?: (source: unknown, book: unknown) => Promise<unknown>;
  /** Reserved for online reading; may be absent in v1 plugins. */
  getChapterList?: (source: unknown, book: unknown) => Promise<unknown[]>;
  /** Loads one directory page and returns cursors for later pages. */
  getChapterListPage?: (
    source: unknown,
    book: unknown,
    cursor?: string
  ) => Promise<{ chapters: unknown[]; nextTocUrls: string[] }>;
  getChapterContent?: (source: unknown, chapter: unknown) => Promise<unknown>;
}

export type PluginErrorCode =
  | "invalid_manifest"
  | "bundle_too_large"
  | "hash_mismatch"
  | "load_failed"
  | "incompatible"
  | "network"
  | "not_found";

export class PluginError extends Error {
  code: PluginErrorCode;
  constructor(code: PluginErrorCode, message: string) {
    super(message);
    this.name = "PluginError";
    this.code = code;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate an untrusted manifest object (from a downloaded manifest.json,
 * a local .zip import, or a registry entry). Returns null when invalid.
 */
export const validatePluginManifest = (
  value: unknown
): PluginManifest | null => {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Record<string, unknown>;
  const strings = ["id", "name", "author", "version", "minAppVersion", "description"];
  for (const key of strings) {
    if (typeof manifest[key] !== "string" || !(manifest[key] as string).trim()) {
      return null;
    }
  }
  if (!ID_PATTERN.test(manifest.id as string)) return null;
  if (!parseSemver(manifest.version as string)) return null;
  if (!parseSemver(manifest.minAppVersion as string)) return null;
  if (
    manifest.isDesktopOnly !== undefined &&
    typeof manifest.isDesktopOnly !== "boolean"
  ) {
    return null;
  }
  if (manifest.category !== undefined && typeof manifest.category !== "string") {
    return null;
  }
  return {
    id: (manifest.id as string).trim(),
    name: (manifest.name as string).trim(),
    author: (manifest.author as string).trim(),
    version: (manifest.version as string).trim(),
    minAppVersion: (manifest.minAppVersion as string).trim(),
    description: (manifest.description as string).trim(),
    authorUrl: typeof manifest.authorUrl === "string" ? manifest.authorUrl : undefined,
    isDesktopOnly: manifest.isDesktopOnly === true ? true : undefined,
    category: typeof manifest.category === "string" ? manifest.category : undefined,
  };
};

/** SHA-256 hex digest of a string, via WebCrypto (available in renderer and worker). */
export const sha256Hex = async (text: string): Promise<string> => {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};
