/**
 * Pure Legado source model helpers — no storage or app imports, so they are
 * unit-testable in isolation (the storage wrapper pulls in the closed-source
 * bundle which cannot run under jsdom).
 */

/** Minimal subset of the Legado BookSource JSON the UI and engine rely on. */
export interface LegadoBookSource {
  bookSourceUrl: string;
  bookSourceName: string;
  bookSourceGroup?: string;
  bookSourceType?: number;
  enabled?: boolean;
  enabledCookieJar?: boolean;
  ruleSearch?: Record<string, unknown>;
  ruleBookInfo?: Record<string, unknown>;
  ruleToc?: Record<string, unknown>;
  ruleContent?: Record<string, unknown>;
  searchUrl?: string;
  loginUrl?: string;
  /** Stored as-is: Legado sources carry many more fields than we model. */
  [key: string]: unknown;
}

/**
 * Validates one untrusted Legado source object. Returns a normalized source
 * or null. Required: a non-empty http(s) bookSourceUrl, a name, and a
 * ruleSearch block (without it the source cannot answer searches).
 */
export const validateLegadoSource = (value: unknown): LegadoBookSource | null => {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.bookSourceUrl !== "string") return null;
  try {
    const url = new URL(source.bookSourceUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (
    typeof source.bookSourceName !== "string" ||
    !source.bookSourceName.trim()
  ) {
    return null;
  }
  if (
    !source.ruleSearch ||
    typeof source.ruleSearch !== "object" ||
    Array.isArray(source.ruleSearch)
  ) {
    return null;
  }
  return { ...(source as LegadoBookSource) };
};

/** Parses a Legado source export: a single object or an array of objects. */
export const parseLegadoSourcesJson = (text: string): LegadoBookSource[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .map(validateLegadoSource)
    .filter((item): item is LegadoBookSource => item !== null);
};

/**
 * Sources that declare an OPTIONAL login entry (loginUrl). This does not
 * mean login is required — most sources work fully without it; the field
 * only exists for users who want VIP features. Whether a source truly
 * needs login is only knowable at fetch time.
 */
export const isLoginCapableSource = (source: LegadoBookSource): boolean =>
  typeof source.loginUrl === "string" && !!source.loginUrl.trim();
