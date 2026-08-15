import i18n from "../../i18n";
import packageJson from "../../../package.json";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import {
  PLUGIN_FETCH_MAX_BYTES,
  PLUGIN_FETCH_TIMEOUT_MS,
} from "./pluginTypes";

/**
 * Host API implementation. Every capability a plugin can request from its
 * worker goes through here. Deliberately tiny: network only via httpFetch
 * (SSRF-guarded, allowlist-enforced), namespaced config storage, logging,
 * i18n, and the app version. No DOM, no filesystem, no raw fetch.
 */
export interface HttpFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** When true (default) the response body is returned as text. */
  body?: string;
}

export interface HttpFetchResult {
  status: number;
  ok: boolean;
  finalUrl: string;
  headers: Record<string, string>;
  body: string;
}

const PLUGIN_ALLOWED_HOSTS = /^[a-z0-9.-]+$/i;

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1")
    return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
};

export class PluginHostApi {
  readonly pluginId: string;
  /** Hosts the plugin declared; when non-empty, httpFetch only allows these. */
  private allowedHosts: Set<string>;

  constructor(pluginId: string) {
    this.pluginId = pluginId;
    this.allowedHosts = new Set();
  }

  /** Declare the network scope of a plugin (e.g. its book sources' origins). */
  setAllowedHosts(hosts: unknown): void {
    const list = Array.isArray(hosts) ? hosts : [];
    this.allowedHosts = new Set(
      list
        .filter(
          (host): host is string =>
            typeof host === "string" && PLUGIN_ALLOWED_HOSTS.test(host)
        )
        .map((host) => host.toLowerCase())
    );
  }

  private isUrlAllowed(urlText: string): boolean {
    try {
      const url = new URL(urlText);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !isPrivateHostname(url.hostname) &&
        (this.allowedHosts.size === 0 ||
          this.allowedHosts.has(url.hostname.toLowerCase()))
      );
    } catch {
      return false;
    }
  }

  async httpFetch(urlText: unknown, rawOptions?: unknown): Promise<HttpFetchResult> {
    if (typeof urlText !== "string" || !this.isUrlAllowed(urlText)) {
      throw new Error("The request URL is outside this plugin's allowed hosts");
    }
    const options = (rawOptions || {}) as HttpFetchOptions;
    // Route through the main process: the renderer's fetch is blocked by
    // CORS for book-source sites that don't send Access-Control-Allow-Origin.
    // The main process (Node) has no such restriction.
    if (isElectron && (window as any).require) {
      const result = await (window as any)
        .require("electron")
        .ipcRenderer.invoke("plugin-http-fetch", {
          url: urlText,
          method: options.method || "GET",
          headers: options.headers || {},
          body: options.body,
        });
      const finalUrl = result.finalUrl || urlText;
      if (!this.isUrlAllowed(finalUrl)) {
        throw new Error("The request redirected outside allowed hosts");
      }
      // The main process returns raw bytes as base64 so the engine's
      // charset detection (decodeHttpResponseBody) sees the real bytes,
      // not a prematurely-decoded UTF-8 string.
      let body: string;
      if (result.binary) {
        const binary = atob(result.body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        body = new TextDecoder("utf-8").decode(bytes);
      } else {
        body = result.body;
      }
      if (body.length > PLUGIN_FETCH_MAX_BYTES) {
        throw new Error("The plugin response is larger than 20 MB");
      }
      return {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        finalUrl,
        headers: result.headers || {},
        body,
      };
    }
    // Web fallback (subject to CORS — only works for CORS-enabled hosts).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLUGIN_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(urlText, {
        method: options.method || "GET",
        headers: options.headers || {},
        body: options.body,
        credentials: "omit",
        signal: controller.signal,
      });
      const finalUrl = response.url || urlText;
      if (!this.isUrlAllowed(finalUrl)) {
        throw new Error("The request redirected outside allowed hosts");
      }
      const body = await response.text();
      if (body.length > PLUGIN_FETCH_MAX_BYTES) {
        throw new Error("The plugin response is larger than 20 MB");
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        ok: response.ok,
        finalUrl,
        headers,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private configKey(key: unknown): string | null {
    if (typeof key !== "string" || !key) return null;
    return `plugin:${this.pluginId}:${key}`;
  }

  storageGet(key: unknown): string | null {
    const configKey = this.configKey(key);
    if (!configKey) return null;
    return ConfigService.getReaderConfig(configKey) || null;
  }

  storageSet(key: unknown, value: unknown): boolean {
    const configKey = this.configKey(key);
    if (!configKey || typeof value !== "string") return false;
    ConfigService.setReaderConfig(configKey, value);
    return true;
  }

  storageDelete(key: unknown): boolean {
    const configKey = this.configKey(key);
    if (!configKey) return false;
    ConfigService.setReaderConfig(configKey, "");
    return true;
  }

  log(level: unknown, message: unknown): void {
    const text = typeof message === "string" ? message : "";
    const prefix = `[plugin:${this.pluginId}]`;
    if (level === "error") console.error(prefix, text);
    else if (level === "warn") console.warn(prefix, text);
    else console.log(prefix, text);
  }

  translate(key: unknown): string {
    return typeof key === "string" ? i18n.t(key) : "";
  }

  getVersion(): string {
    return packageJson.version;
  }

  /** Dispatch one RPC operation coming from the plugin worker. */
  async dispatch(op: string, args: unknown[]): Promise<unknown> {
    switch (op) {
      case "setAllowedHosts":
        this.setAllowedHosts(args[0]);
        return true;
      case "httpFetch":
        return this.httpFetch(args[0], args[1]);
      case "storage.get":
        return this.storageGet(args[0]);
      case "storage.set":
        return this.storageSet(args[0], args[1]);
      case "storage.delete":
        return this.storageDelete(args[0]);
      case "log":
        this.log(args[0], args[1]);
        return true;
      case "i18n.t":
        return this.translate(args[0]);
      case "getVersion":
        return this.getVersion();
      default:
        throw new Error(`Unknown host API operation: ${op}`);
    }
  }
}
