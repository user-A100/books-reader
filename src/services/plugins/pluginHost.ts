import {
  BookSourceEngine,
  InstalledPluginRecord,
  PluginError,
  PLUGIN_MAX_BUNDLE_BYTES,
  sha256Hex,
  validatePluginManifest,
} from "./pluginTypes";
import { PluginHostApi } from "./pluginApi";
import { getPluginStorage } from "./pluginStorage";
import { satisfiesMinVersion } from "../../utils/semver";
import packageJson from "../../../package.json";
import { PluginManifest } from "../../models/Plugin";

/**
 * Worker-side bootstrap, stringified and run inside the plugin's dedicated
 * Web Worker. It neutralizes the worker's own network primitives (native
 * fetch is proxied through the guarded host API, WebSocket/importScripts are
 * blocked), evaluates the plugin bundle in a fake CommonJS scope, calls
 * onload(), and bridges host API and engine calls both ways.
 */
function pluginWorkerBootstrap(): void {
  const pendingApi = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  let nextApiId = 1;

  const api = (op: string, args: unknown[]) =>
    new Promise((resolve, reject) => {
      const id = nextApiId++;
      pendingApi.set(id, { resolve, reject });
      (self as unknown as Worker).postMessage({ type: "api", id, op, args });
    });

  const normalizeRequestBody = (
    body: BodyInit | null | undefined
  ): string | Uint8Array | undefined => {
    if (typeof body === "string") return body;
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return undefined;
  };

  // Route native fetch through the host's SSRF-guarded httpFetch so engine
  // code that calls fetch() directly is still allowlisted. Preserve raw bytes
  // from the main process: Legado performs charset detection after reading
  // arrayBuffer(), so decoding here would corrupt GBK/GB2312 sources.
  (self as unknown as { fetch: typeof fetch }).fetch = ((
    input: RequestInfo | URL,
    init?: RequestInit
  ) =>
    api("httpFetch", [
      typeof input === "string" ? input : String(input),
      {
        method: (init && init.method) || "GET",
        headers: (init && init.headers) as Record<string, string>,
        // iconv-lite returns Uint8Array for GBK/GB2312 form bodies. Keep those
        // bytes intact across Worker -> renderer -> Electron IPC.
        body: normalizeRequestBody(init && init.body),
      },
    ]).then((raw) => {
      const result = raw as {
        status: number;
        body: string;
        headers: Record<string, string>;
        binary?: boolean;
      };
      let responseBody: BodyInit = result.body;
      if (result.binary) {
        const encoded = atob(result.body);
        const bytes = new Uint8Array(encoded.length);
        for (let i = 0; i < encoded.length; i += 1) {
          bytes[i] = encoded.charCodeAt(i);
        }
        responseBody = bytes;
      }
      return new Response(responseBody, {
        status: result.status,
        headers: result.headers,
      });
    })) as typeof fetch;

  (self as unknown as { WebSocket: unknown }).WebSocket = function () {
    throw new Error("WebSocket is disabled inside plugins");
  };
  (self as unknown as { importScripts: unknown }).importScripts = function () {
    throw new Error("importScripts is disabled inside plugins");
  };

  let engine: Record<string, (...args: unknown[]) => unknown> | null = null;

  const host = {
    registerBookSourceEngine: (
      descriptor: Record<string, (...args: unknown[]) => unknown>
    ) => {
      engine = descriptor;
      (self as unknown as Worker).postMessage({
        type: "engine",
        methods: Object.keys(descriptor),
      });
    },
    setAllowedHosts: (hosts: string[]) => api("setAllowedHosts", [hosts]),
    httpFetch: (url: string, options?: unknown) =>
      api("httpFetch", [url, options]),
    storage: {
      get: (key: string) => api("storage.get", [key]),
      set: (key: string, value: string) => api("storage.set", [key, value]),
      delete: (key: string) => api("storage.delete", [key]),
    },
    log: {
      info: (message: string) => api("log", ["info", message]),
      warn: (message: string) => api("log", ["warn", message]),
      error: (message: string) => api("log", ["error", message]),
    },
    i18n: { t: (key: string) => api("i18n.t", [key]) },
    getVersion: () => api("getVersion", []),
  };

  (self as unknown as Worker).addEventListener("message", async (event) => {
    const data = event.data || {};
    if (data.type === "api-result") {
      const pending = pendingApi.get(data.id);
      if (!pending) return;
      pendingApi.delete(data.id);
      if (data.ok) pending.resolve(data.result);
      else pending.reject(new Error(String(data.error)));
      return;
    }
    if (data.type === "init") {
      try {
        const module = { exports: {} as Record<string, unknown> };
        const evaluate = new Function("module", "exports", "require", data.mainJs);
        evaluate(
          module,
          module.exports,
          () => {
            throw new Error("require is not available inside plugins");
          }
        );
        const exported =
          (module.exports &&
            (module.exports as Record<string, unknown>).default) ||
          module.exports;
        if (typeof exported !== "function") {
          throw new Error("Plugin bundle has no default class export");
        }
        const instance = new (exported as new (context: unknown) => unknown)({
          id: data.manifest.id,
          manifest: data.manifest,
          host,
        });
        if (
          instance &&
          typeof (instance as { onload?: () => void }).onload === "function"
        ) {
          await (instance as { onload: () => void | Promise<void> }).onload();
        }
        (self as unknown as Worker).postMessage({ type: "ready" });
      } catch (error) {
        (self as unknown as Worker).postMessage({
          type: "load-error",
          message: String((error as Error)?.message || error),
        });
      }
      return;
    }
    if (data.type === "call") {
      const method = engine && engine[data.method];
      if (!method) {
        (self as unknown as Worker).postMessage({
          type: "call-result",
          id: data.id,
          ok: false,
          error: `Engine method not available: ${data.method}`,
        });
        return;
      }
      try {
        const result = await method(...(data.args || []));
        (self as unknown as Worker).postMessage({
          type: "call-result",
          id: data.id,
          ok: true,
          result,
        });
      } catch (error) {
        (self as unknown as Worker).postMessage({
          type: "call-result",
          id: data.id,
          ok: false,
          error: String((error as Error)?.message || error),
        });
      }
    }
  });
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RunningPlugin {
  worker: Worker;
  api: PluginHostApi;
  engineMethods: string[] | null;
  pending: Map<number, PendingCall>;
  ready: Promise<void>;
}

const INDEX_KEY = "index.json";
const CALL_TIMEOUT_MS = 60_000;

/**
 * Plugin host: install/uninstall/enable/disable plugins, verify bundle
 * integrity on every load, and expose registered book-source engines.
 * One worker per enabled plugin; plugin code never runs in the app context.
 */
class PluginHostService {
  private running = new Map<string, RunningPlugin>();
  private records: InstalledPluginRecord[] | null = null;
  private nextCallId = 1;

  // ---- installed records (index.json inside plugin storage) ----

  private async loadRecords(): Promise<InstalledPluginRecord[]> {
    if (this.records) return this.records;
    const raw = await getPluginStorage().readFile(INDEX_KEY);
    if (!raw) {
      this.records = [];
      return this.records;
    }
    try {
      const parsed = JSON.parse(raw);
      this.records = Array.isArray(parsed)
        ? parsed.filter(
            (item) =>
              item &&
              validatePluginManifest(item.manifest) &&
              typeof item.sha256 === "string" &&
              typeof item.enabled === "boolean"
          )
        : [];
    } catch {
      this.records = [];
    }
    return this.records;
  }

  private async saveRecords(records: InstalledPluginRecord[]): Promise<void> {
    this.records = records;
    await getPluginStorage().writeFile(INDEX_KEY, JSON.stringify(records));
  }

  /** Snapshot copies: callers can hold these without being affected by
   * lifecycle methods that mutate the internal records in place. */
  listInstalled = async (): Promise<InstalledPluginRecord[]> =>
    (await this.loadRecords()).map((record) => ({
      ...record,
      manifest: { ...record.manifest },
    }));

  // ---- install / uninstall / enable ----

  install = async (
    manifestValue: unknown,
    mainJs: string
  ): Promise<InstalledPluginRecord> => {
    const manifest = validatePluginManifest(manifestValue);
    if (!manifest) {
      throw new PluginError("invalid_manifest", "Invalid plugin manifest");
    }
    if (typeof mainJs !== "string" || !mainJs) {
      throw new PluginError("invalid_manifest", "Empty plugin bundle");
    }
    if (mainJs.length > PLUGIN_MAX_BUNDLE_BYTES) {
      throw new PluginError("bundle_too_large", "Plugin bundle exceeds 10 MB");
    }
    if (!satisfiesMinVersion(packageJson.version, manifest.minAppVersion)) {
      throw new PluginError(
        "incompatible",
        `This plugin requires app version ${manifest.minAppVersion} or newer`
      );
    }
    const sha256 = await sha256Hex(mainJs);
    const records = await this.loadRecords();
    const existing = records.find(
      (record) => record.manifest.id === manifest.id
    );
    if (existing) await this.stopWorker(manifest.id);
    const record: InstalledPluginRecord = {
      manifest,
      sha256,
      installedAt: existing?.installedAt || Date.now(),
      enabled: false,
    };
    const persisted = await getPluginStorage().writeFile(
      `${manifest.id}/main.js`,
      mainJs
    );
    if (!persisted) {
      throw new PluginError("load_failed", "Failed to persist plugin bundle");
    }
    await this.saveRecords([
      ...records.filter((record) => record.manifest.id !== manifest.id),
      record,
    ]);
    return record;
  };

  uninstall = async (id: string): Promise<void> => {
    await this.stopWorker(id);
    const records = await this.loadRecords();
    await this.saveRecords(
      records.filter((record) => record.manifest.id !== id)
    );
    await getPluginStorage().deletePath(id);
  };

  setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    const records = await this.loadRecords();
    const record = records.find((item) => item.manifest.id === id);
    if (!record) throw new PluginError("not_found", "Plugin is not installed");
    if (!enabled) {
      await this.stopWorker(id);
      record.enabled = false;
      await this.saveRecords(records);
      return;
    }
    record.enabled = true;
    await this.saveRecords(records);
    try {
      await this.startWorker(record);
    } catch (error) {
      record.enabled = false;
      await this.saveRecords(records);
      throw error;
    }
  };

  /** Start enabled plugins (call once at app startup). Failed loads are disabled. */
  startEnabled = async (): Promise<string[]> => {
    const records = await this.loadRecords();
    const failures: string[] = [];
    for (const record of records) {
      if (!record.enabled) continue;
      try {
        await this.startWorker(record);
      } catch (error) {
        record.enabled = false;
        failures.push(record.manifest.id);
      }
    }
    if (failures.length) await this.saveRecords(records);
    return failures;
  };

  // ---- worker lifecycle ----

  private async startWorker(record: InstalledPluginRecord): Promise<void> {
    if (this.running.has(record.manifest.id)) return;
    const mainJs = await getPluginStorage().readFile(
      `${record.manifest.id}/main.js`
    );
    if (!mainJs) {
      throw new PluginError("not_found", "Plugin bundle is missing");
    }
    const digest = await sha256Hex(mainJs);
    if (digest !== record.sha256) {
      throw new PluginError(
        "hash_mismatch",
        "Plugin bundle failed integrity verification and was not loaded"
      );
    }
    const api = new PluginHostApi(record.manifest.id);
    const source = `(${pluginWorkerBootstrap.toString()})();`;
    const worker = new Worker(
      URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    );
    const entry: RunningPlugin = {
      worker,
      api,
      engineMethods: null,
      pending: new Map(),
      ready: new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new PluginError("load_failed", "Plugin failed to load in time")
            ),
          CALL_TIMEOUT_MS
        );
        const settle = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        const onInitial = (event: MessageEvent) => {
          const data = event.data || {};
          if (data.type === "ready") {
            worker.removeEventListener("message", onInitial);
            settle(resolve);
          }
          if (data.type === "load-error" || data.type === "error") {
            worker.removeEventListener("message", onInitial);
            settle(() =>
              reject(new PluginError("load_failed", String(data.message)))
            );
          }
        };
        worker.addEventListener("message", onInitial);
        worker.addEventListener("error", (event) => {
          worker.removeEventListener("message", onInitial);
          settle(() =>
            reject(
              new PluginError("load_failed", event.message || "Worker error")
            )
          );
        });
      }),
    };
    worker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "api") {
        api
          .dispatch(String(data.op), Array.isArray(data.args) ? data.args : [])
          .then((result) =>
            worker.postMessage({
              type: "api-result",
              id: data.id,
              ok: true,
              result,
            })
          )
          .catch((error: Error) =>
            worker.postMessage({
              type: "api-result",
              id: data.id,
              ok: false,
              error: error?.message || String(error),
            })
          );
        return;
      }
      if (data.type === "engine") {
        entry.engineMethods = Array.isArray(data.methods) ? data.methods : [];
        return;
      }
      if (data.type === "call-result") {
        const call = entry.pending.get(data.id);
        if (!call) return;
        entry.pending.delete(data.id);
        clearTimeout(call.timer);
        if (data.ok) call.resolve(data.result);
        else call.reject(new Error(String(data.error)));
      }
    });
    this.running.set(record.manifest.id, entry);
    worker.postMessage({ type: "init", manifest: record.manifest, mainJs });
    try {
      await entry.ready;
    } catch (error) {
      await this.stopWorker(record.manifest.id);
      throw error;
    }
  }

  private async stopWorker(id: string): Promise<void> {
    const entry = this.running.get(id);
    if (!entry) return;
    this.running.delete(id);
    entry.pending.forEach((call) => {
      clearTimeout(call.timer);
      call.reject(new Error("Plugin worker stopped"));
    });
    entry.pending.clear();
    entry.worker.terminate();
  }

  // ---- engine access ----

  private callEngine = <T>(
    id: string,
    method: string,
    args: unknown[]
  ): Promise<T> => {
    const entry = this.running.get(id);
    if (!entry || !entry.engineMethods || !entry.engineMethods.includes(method)) {
      return Promise.reject(
        new PluginError(
          "not_found",
          `Engine method not registered by this plugin: ${method}`
        )
      );
    }
    return new Promise<T>((resolve, reject) => {
      const callId = this.nextCallId++;
      const timer = setTimeout(() => {
        entry.pending.delete(callId);
        reject(new Error(`Plugin engine call timed out: ${method}`));
      }, CALL_TIMEOUT_MS);
      entry.pending.set(callId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      entry.worker.postMessage({ type: "call", id: callId, method, args });
    });
  };

  getBookSourceEngine = (id: string): BookSourceEngine | null => {
    const entry = this.running.get(id);
    if (!entry || !entry.engineMethods) return null;
    return {
      id,
      search: (source, keyword) =>
        this.callEngine<unknown[]>(id, "search", [source, keyword]),
      getBookDetail: entry.engineMethods.includes("getBookDetail")
        ? (source, book) =>
            this.callEngine<unknown>(id, "getBookDetail", [source, book])
        : undefined,
      getChapterList: entry.engineMethods.includes("getChapterList")
        ? (source, book) =>
            this.callEngine<unknown[]>(id, "getChapterList", [source, book])
        : undefined,
      getChapterListPage: entry.engineMethods.includes("getChapterListPage")
        ? (source, book, cursor) =>
            this.callEngine<{ chapters: unknown[]; nextTocUrls: string[] }>(
              id,
              "getChapterListPage",
              [source, book, cursor]
            )
        : undefined,
      getChapterContent: entry.engineMethods.includes("getChapterContent")
        ? (source, chapter) =>
            this.callEngine<unknown>(id, "getChapterContent", [source, chapter])
        : undefined,
    };
  };
}

export const pluginHost = new PluginHostService();
export type { InstalledPluginRecord, PluginManifest };
