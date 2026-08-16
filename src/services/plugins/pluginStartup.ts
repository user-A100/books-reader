import { pluginHost } from "./pluginHost";

let startupPromise: Promise<string[]> | null = null;

/** Starts persisted enabled plugins exactly once for the current app window. */
export const ensurePluginsStarted = (): Promise<string[]> => {
  if (!startupPromise) {
    startupPromise = pluginHost.startEnabled().catch((error) => {
      startupPromise = null;
      throw error;
    });
  }
  return startupPromise;
};
