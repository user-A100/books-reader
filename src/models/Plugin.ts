// Legacy plugin record for the existing translation/dictionary/voice system.
// Kept for backward compatibility with the settings panel and SQLite table.
class Plugin {
  key: string;
  type: string;
  displayName: string;
  icon: string;
  version: string;
  autoValue: string;
  config: object;
  langList: object | any[];
  voiceList: object | any[];
  scriptSHA256: string;
  script: string;
  constructor(
    key: string,
    type: string,
    displayName: string,
    icon: string,
    version: string,
    autoValue: string,
    config: object,
    langList: any,
    voiceList: any,
    scriptSHA256: string,
    script: string
  ) {
    this.key = key;
    this.type = type;
    this.displayName = displayName;
    this.icon = icon;
    this.version = version;
    this.autoValue = autoValue;
    this.config = config;
    this.langList = langList;
    this.voiceList = voiceList;
    this.script = script;
    this.scriptSHA256 = scriptSHA256;
  }
}

export default Plugin;

// Obsidian-style plugin manifest. This mirrors the contract used by the
// Obsidian sample plugin's manifest.json and the community-plugins.json
// registry entry, so a future plugin host and marketplace can speak the
// same vocabulary. `repo` only appears in the community registry, not the
// local manifest.
export interface PluginManifest {
  /** Unique slug identifier for the plugin. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Author or maintainer name. */
  author: string;
  /** Current version, using semantic versioning. */
  version: string;
  /** Minimum required app version to run this plugin. */
  minAppVersion: string;
  /** Short summary of what the plugin does. */
  description: string;
  /** Optional URL to the author's website. */
  authorUrl?: string;
  /** Whether the plugin can be used only on desktop. */
  isDesktopOnly?: boolean;
}

export interface CommunityPluginEntry extends PluginManifest {
  /** GitHub repository path in `owner/repo` format (registry-only). */
  repo: string;
}
