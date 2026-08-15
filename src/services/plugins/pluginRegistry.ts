import { isElectron } from "react-device-detect";
import { CommunityPluginEntry, PluginManifest } from "../../models/Plugin";
import { pluginHost } from "./pluginHost";
import { pluginDownload } from "./pluginStorage";
import { PluginError, validatePluginManifest } from "./pluginTypes";
import { compareSemver } from "../../utils/semver";

/**
 * Community plugin registry. Entries and plugin files live in a GitHub repo;
 * every URL is tried via raw.githubusercontent.com first and cdn.jsdelivr.net
 * as a fallback so users behind blocked/slow GitHub access can still install.
 */
const REGISTRY_REPO = "koodo-reader/plugins";

export const registrySources = (repo: string, path: string): string[] => [
  `https://raw.githubusercontent.com/${repo}/main/${path}`,
  `https://cdn.jsdelivr.net/gh/${repo}@main/${path}`,
];

const fetchText = async (urls: string[]): Promise<string> => {
  let lastError = "";
  for (const url of urls) {
    try {
      if (isElectron && (window as any).require) {
        const bytes = await pluginDownload(url);
        if (bytes) return new TextDecoder().decode(bytes);
      } else {
        const response = await fetch(url, { credentials: "omit" });
        if (response.ok) return await response.text();
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = (error as Error)?.message || String(error);
    }
  }
  throw new PluginError(
    "network",
    `Failed to download plugin file (${lastError || "network error"})`
  );
};

export const fetchCommunityPlugins = async (): Promise<
  CommunityPluginEntry[]
> => {
  const raw = await fetchText(
    registrySources(REGISTRY_REPO, "community-plugins.json")
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PluginError("network", "The plugin registry returned invalid JSON");
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      const manifest = validatePluginManifest(item);
      if (!manifest || !item || typeof (item as any).repo !== "string") {
        return null;
      }
      return {
        ...manifest,
        repo: (item as { repo: string }).repo,
      } as CommunityPluginEntry;
    })
    .filter((entry): entry is CommunityPluginEntry => entry !== null);
};

/** Download and install a plugin from its repo. Leaves it disabled. */
export const installFromCommunity = async (
  entry: CommunityPluginEntry
): Promise<PluginManifest> => {
  const manifestRaw = await fetchText(
    registrySources(entry.repo, "manifest.json")
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestRaw);
  } catch {
    throw new PluginError("invalid_manifest", "Invalid plugin manifest");
  }
  const manifest = validatePluginManifest(manifestValue);
  if (!manifest || manifest.id !== entry.id) {
    throw new PluginError(
      "invalid_manifest",
      "The downloaded manifest does not match the registry entry"
    );
  }
  const mainJs = await fetchText(registrySources(entry.repo, "main.js"));
  await pluginHost.install(manifest, mainJs);
  return manifest;
};

/** Whether the registry version is newer than what is installed. */
export const hasUpdate = (
  installedVersion: string,
  registryVersion: string
): boolean => compareSemver(registryVersion, installedVersion) > 0;
