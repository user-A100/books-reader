import {
  PLUGIN_MAX_BUNDLE_BYTES,
  sha256Hex,
  validatePluginManifest,
  PluginError,
} from "./pluginTypes";
import {
  compareSemver,
  satisfiesMinVersion,
  parseSemver,
} from "../../utils/semver";

// jsdom test env lacks TextEncoder/crypto.subtle; sha256Hex uses WebCrypto in
// the renderer/worker, so polyfill those globals for the integrity tests.
const { TextEncoder } = require("util");
const { webcrypto } = require("crypto");
(globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder ??=
  TextEncoder;
if (!(globalThis as { crypto?: Crypto }).crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const validManifest = {
  id: "legado-engine",
  name: "Legado Book Sources",
  author: "someone",
  version: "1.0.0",
  minAppVersion: "1.0.0",
  description: "Import Legado book sources",
};

describe("validatePluginManifest", () => {
  it("accepts a valid manifest and normalizes whitespace", () => {
    const manifest = validatePluginManifest({
      ...validManifest,
      name: "  Padded  ",
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe("Padded");
    expect(manifest!.category).toBeUndefined();
  });

  it("accepts optional category, authorUrl and isDesktopOnly", () => {
    const manifest = validatePluginManifest({
      ...validManifest,
      category: "bookSource",
      authorUrl: "https://example.com",
      isDesktopOnly: true,
    });
    expect(manifest).not.toBeNull();
    expect(manifest!.category).toBe("bookSource");
    expect(manifest!.isDesktopOnly).toBe(true);
  });

  it("rejects invalid ids", () => {
    expect(validatePluginManifest({ ...validManifest, id: "Bad_Id" })).toBeNull();
    expect(validatePluginManifest({ ...validManifest, id: "../evil" })).toBeNull();
    expect(validatePluginManifest({ ...validManifest, id: "" })).toBeNull();
  });

  it("rejects non-semver versions and missing fields", () => {
    expect(validatePluginManifest({ ...validManifest, version: "latest" })).toBeNull();
    expect(
      validatePluginManifest({ ...validManifest, minAppVersion: "x.y.z" })
    ).toBeNull();
    expect(
      validatePluginManifest({ ...validManifest, description: undefined })
    ).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(validatePluginManifest(null)).toBeNull();
    expect(validatePluginManifest("nope")).toBeNull();
  });

  it("keeps the bundle size limit at 10 MB", () => {
    expect(PLUGIN_MAX_BUNDLE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("semver", () => {
  it("parses and orders versions", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(parseSemver("v2.0.0")).toEqual([2, 0, 0]);
    expect(parseSemver("1.2")).toBeNull();
    expect(compareSemver("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
    expect(compareSemver("1.2.3", "1.2.2")).toBeGreaterThan(0);
  });

  it("treats invalid versions as lowest", () => {
    expect(compareSemver("bad", "0.0.1")).toBeLessThan(0);
  });

  it("checks minAppVersion", () => {
    expect(satisfiesMinVersion("1.5.0", "1.2.0")).toBe(true);
    expect(satisfiesMinVersion("1.1.0", "1.2.0")).toBe(false);
    expect(satisfiesMinVersion("1.1.0", "")).toBe(true);
  });
});

describe("tampered-bundle rejection (sha256Hex)", () => {
  // The host stores sha256Hex(mainJs) at install time and re-verifies it on
  // every load; a single-byte change must yield a different digest so a
  // tampered bundle is refused (hash_mismatch).
  it("produces a different digest for a one-byte change", async () => {
    const original = "class P{ onload(){} }";
    const tampered = "class P{ onload(){}!";
    const a = await sha256Hex(original);
    const b = await sha256Hex(tampered);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", async () => {
    expect(await sha256Hex("bundle")).toBe(await sha256Hex("bundle"));
  });

  it("PluginError carries a hash_mismatch code", () => {
    const err = new PluginError("hash_mismatch", "integrity failed");
    expect(err.code).toBe("hash_mismatch");
    expect(err.message).toBe("integrity failed");
  });
});
