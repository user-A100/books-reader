import { pluginHost } from "./pluginHost";
import { getPluginStorage } from "./pluginStorage";
import { compareSemver } from "../../utils/semver";
import type { PluginManifest } from "../../models/Plugin";

let startupPromise: Promise<string[]> | null = null;

const installBundledPlugins = async (): Promise<void> => {
  const bundled = await getPluginStorage().readBundledPlugin("legado-engine");
  if (!bundled) return;
  const manifest = bundled.manifest as PluginManifest;
  const installed = (await pluginHost.listInstalled()).find(
    (record) => record.manifest.id === "legado-engine"
  );
  if (!installed) {
    await pluginHost.install(manifest, bundled.mainJs);
    await pluginHost.setEnabled("legado-engine", true);
    return;
  }
  if (compareSemver(manifest.version, installed.manifest.version) > 0) {
    const wasEnabled = installed.enabled;
    await pluginHost.install(manifest, bundled.mainJs);
    if (wasEnabled) await pluginHost.setEnabled("legado-engine", true);
  }
};

/** Starts persisted enabled plugins exactly once for the current app window. */
export const ensurePluginsStarted = (): Promise<string[]> => {
  if (!startupPromise) {
    startupPromise = installBundledPlugins()
      .then(() => pluginHost.startEnabled())
      .catch((error) => {
        startupPromise = null;
        throw error;
      });
  }
  return startupPromise;
};
