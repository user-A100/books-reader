import React from "react";
import { Trans } from "react-i18next";
import { RouteComponentProps } from "react-router-dom";
import toast from "react-hot-toast";
import { openExternalUrl } from "../../utils/common";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { CommunityPluginEntry, PluginManifest } from "../../models/Plugin";
import {
  InstalledPluginRecord,
  PluginError,
  PluginErrorCode,
} from "../../services/plugins/pluginTypes";
import { pluginHost } from "../../services/plugins/pluginHost";
import {
  fetchCommunityPlugins,
  installFromCommunity,
  hasUpdate,
} from "../../services/plugins/pluginRegistry";
import { PluginsProps, PluginsState } from "./interface";
import "./plugins.css";

const ERROR_KEYS: Record<PluginErrorCode, string> = {
  invalid_manifest: "Invalid plugin manifest",
  bundle_too_large: "Bundle too large",
  hash_mismatch: "Verify failed",
  load_failed: "Plugin failed to load",
  incompatible: "Incompatible plugin",
  network: "Plugin network error",
  not_found: "Plugin not found",
};

const describeError = (error: unknown, t: PluginsProps["t"]): string => {
  if (error instanceof PluginError) {
    const key = ERROR_KEYS[error.code];
    return key ? `${t(key)}${error.message ? `: ${error.message}` : ""}` : error.message;
  }
  return t("Install failed");
};

class Plugins extends React.Component<PluginsProps, PluginsState> {
  private fileInput = React.createRef<HTMLInputElement>();

  constructor(props: PluginsProps) {
    super(props);
    this.state = {
      records: [],
      community: null,
      loadingCommunity: false,
      busyId: null,
      selectedId: null,
      query: "",
    };
  }

  async componentDidMount() {
    // Enabled plugins are normally started at app startup; starting here as
    // well keeps the page honest about plugins that failed to load.
    const failures = await pluginHost.startEnabled();
    const records = await pluginHost.listInstalled();
    this.setState({
      records,
      selectedId: this.state.selectedId || records[0]?.manifest.id || null,
    });
    if (failures.length) {
      toast(this.props.t("Some plugins failed to start and were disabled"));
    }
  }

  refresh = async () => {
    const records = await pluginHost.listInstalled();
    this.setState((prev) => ({
      records,
      selectedId:
        prev.selectedId && records.some((r) => r.manifest.id === prev.selectedId)
          ? prev.selectedId
          : records[0]?.manifest.id || null,
    }));
  };

  loadCommunity = async () => {
    this.setState({ loadingCommunity: true });
    try {
      const community = await fetchCommunityPlugins();
      this.setState({ community });
    } catch (error) {
      this.setState({ community: [] });
      toast(describeError(error, this.props.t));
    } finally {
      this.setState({ loadingCommunity: false });
    }
  };

  handleEnable = async (record: InstalledPluginRecord) => {
    // Capture the current state first: setEnabled() mutates this very
    // record object in place, so reading record.enabled afterwards would
    // return the post-toggle value and invert the message.
    const target = !record.enabled;
    this.setState({ busyId: record.manifest.id });
    try {
      await pluginHost.setEnabled(record.manifest.id, target);
      toast(target ? this.props.t("Plugin enabled") : this.props.t("Plugin disabled"));
      await this.refresh();
    } catch (error) {
      toast(describeError(error, this.props.t));
    } finally {
      this.setState({ busyId: null });
    }
  };

  handleUninstall = async (record: InstalledPluginRecord) => {
    if (!window.confirm(this.props.t("Confirm uninstall"))) return;
    this.setState({ busyId: record.manifest.id });
    try {
      await pluginHost.uninstall(record.manifest.id);
      toast(this.props.t("Plugin uninstalled"));
      await this.refresh();
    } catch (error) {
      toast(describeError(error, this.props.t));
    } finally {
      this.setState({ busyId: null });
    }
  };

  handleInstall = async (entry: CommunityPluginEntry) => {
    this.setState({ busyId: entry.id });
    try {
      await installFromCommunity(entry);
      toast(this.props.t("Install successful"));
      await this.refresh();
    } catch (error) {
      toast(describeError(error, this.props.t));
    } finally {
      this.setState({ busyId: null });
    }
  };

  /** Manual import: a .json package { manifest, mainJs }. Works offline. */
  handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed.manifest !== "object" || typeof parsed.mainJs !== "string") {
        throw new PluginError("invalid_manifest", "Invalid plugin package");
      }
      await pluginHost.install(parsed.manifest, parsed.mainJs);
      toast(this.props.t("Install successful"));
      await this.refresh();
    } catch (error) {
      toast(describeError(error, this.props.t));
    }
  };

  openDocs = () => {
    const isZh = ConfigService.getReaderConfig("lang")?.startsWith("zh");
    openExternalUrl(
      isZh
        ? "https://github.com/koodo-reader/plugins/blob/main/README_CN.md"
        : "https://github.com/koodo-reader/plugins/blob/main/README.md"
    );
  };

  displayName = (plugin: PluginManifest) => this.props.t(plugin.name);
  displayDesc = (plugin: PluginManifest) => this.props.t(plugin.description);

  matches = (plugin: PluginManifest, query: string) => {
    if (!query) return true;
    const hay = `${plugin.id} ${this.displayName(plugin)} ${plugin.author} ${this.displayDesc(plugin)}`.toLowerCase();
    return hay.includes(query);
  };

  renderPluginCard(plugin: PluginManifest, selected: boolean, enabled?: boolean) {
    return (
      <button
        key={plugin.id}
        className={`plugin-card${selected ? " plugin-card-selected" : ""}`}
        onClick={() => this.setState({ selectedId: plugin.id })}
      >
        <div className="plugin-card-head">
          <span className="plugin-card-name">{this.displayName(plugin)}</span>
          <span className="plugin-card-version">v{plugin.version}</span>
        </div>
        <p className="plugin-card-desc">{this.displayDesc(plugin)}</p>
        <div className="plugin-card-meta">
          <span className="plugin-card-id">{plugin.id}</span>
          <span className="plugin-card-sep">·</span>
          <span>{plugin.author}</span>
          {plugin.isDesktopOnly && (
            <>
              <span className="plugin-card-sep">·</span>
              <span className="plugin-card-flag">desktop</span>
            </>
          )}
          {enabled && (
            <>
              <span className="plugin-card-sep">·</span>
              <span className="plugin-card-flag">
                <Trans>Enabled</Trans>
              </span>
            </>
          )}
        </div>
      </button>
    );
  }

  renderDetail(record: InstalledPluginRecord | null) {
    if (!record) {
      return (
        <div className="plugin-detail-empty">
          <Trans>Select a plugin to view its details</Trans>
        </div>
      );
    }
    const { manifest, enabled } = record;
    const busy = this.state.busyId === manifest.id;
    return (
      <div className="plugin-detail">
        <p className="plugin-detail-eyebrow">
          <Trans>Installed</Trans>
        </p>
        <h1>{this.displayName(manifest)}</h1>
        <p className="plugin-detail-desc">{this.displayDesc(manifest)}</p>

        <dl className="plugin-detail-grid">
          <dt><Trans>ID</Trans></dt>
          <dd><code>{manifest.id}</code></dd>
          <dt><Trans>Plugin version</Trans></dt>
          <dd>{manifest.version}</dd>
          <dt><Trans>Author</Trans></dt>
          <dd>{manifest.author}</dd>
          <dt><Trans>Min app version</Trans></dt>
          <dd>{manifest.minAppVersion}</dd>
        </dl>

        <div className="plugin-detail-actions">
          <div className="plugin-toggle-row">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={this.props.t("Enable")}
              className={`plugin-toggle${enabled ? " plugin-toggle-on" : ""}`}
              disabled={busy}
              onClick={() => this.handleEnable(record)}
            >
              <span className="plugin-toggle-thumb" />
            </button>
            <span className="plugin-toggle-state">
              {enabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
            </span>
          </div>
          <button
            className="plugin-button"
            disabled={busy}
            onClick={() => this.handleUninstall(record)}
          >
            <Trans>Uninstall</Trans>
          </button>
        </div>
      </div>
    );
  }

  renderCommunityRow = (entry: CommunityPluginEntry) => {
    const installed = this.state.records.find(
      (record) => record.manifest.id === entry.id
    );
    const busy = this.state.busyId === entry.id;
    const outdated = installed && hasUpdate(installed.manifest.version, entry.version);
    return (
      <div key={entry.id} className="plugin-card plugin-community-row">
        <div className="plugin-card-head">
          <span className="plugin-card-name">{this.displayName(entry)}</span>
          <span className="plugin-card-version">v{entry.version}</span>
        </div>
        <p className="plugin-card-desc">{this.displayDesc(entry)}</p>
        <div className="plugin-card-meta">
          <span className="plugin-card-id">{entry.id}</span>
          <span className="plugin-card-sep">·</span>
          <span>{entry.author}</span>
          <div className="plugin-community-actions">
            {outdated && (
              <span className="plugin-badge">
                <Trans>Update available</Trans>
              </span>
            )}
            {installed ? (
              <span className="plugin-badge">
                <Trans>Installed</Trans>
              </span>
            ) : (
              <button
                className="plugin-button primary"
                disabled={busy}
                onClick={() => this.handleInstall(entry)}
              >
                <Trans>Install</Trans>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  render() {
    const { selectedId, query, records, community, loadingCommunity } = this.state;
    const queryTrim = query.trim().toLowerCase();
    const filtered = records.filter((record) =>
      this.matches(record.manifest, queryTrim)
    );
    const selected =
      records.find((record) => record.manifest.id === selectedId) || null;
    return (
      <div className="plugins-page">
        <aside className="plugins-rail">
          <div className="plugins-rail-heading">
            <div>
              <p className="plugins-eyebrow">
                <Trans>Installed</Trans>
              </p>
              <h2>
                <Trans>Plugins</Trans>
              </h2>
            </div>
            <span className="plugins-rail-count">{records.length}</span>
          </div>
          <div className="plugins-search">
            <span className="plugins-search-icon">⌕</span>
            <input
              value={query}
              onChange={(event) => this.setState({ query: event.target.value })}
              placeholder={this.props.t("Search plugins")}
              aria-label={this.props.t("Search plugins")}
            />
          </div>
          {filtered.length === 0 ? (
            <div className="plugins-empty">
              <Trans>No plugins found</Trans>
            </div>
          ) : (
            <div className="plugins-list">
              {filtered.map((record) =>
                this.renderPluginCard(
                  record.manifest,
                  record.manifest.id === selectedId,
                  record.enabled
                )
              )}
            </div>
          )}
          <div className="plugin-detail-actions">
            <input
              ref={this.fileInput}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={this.handleImportFile}
            />
            <button
              className="plugin-button"
              onClick={() => this.fileInput.current?.click()}
            >
              <Trans>Import from file</Trans>
            </button>
          </div>
        </aside>
        <main className="plugins-main">
          {this.renderDetail(selected)}

          <section className="plugin-community">
            <div className="plugin-community-head">
              <h2>
                <Trans>Community plugins</Trans>
              </h2>
              <button
                className="plugin-button"
                disabled={loadingCommunity}
                onClick={this.loadCommunity}
              >
                {loadingCommunity ? (
                  <Trans>Loading community plugins</Trans>
                ) : (
                  <Trans>Refresh list</Trans>
                )}
              </button>
            </div>
            {community === null ? (
              <div className="plugin-community-placeholder">
                <p>
                  <Trans>
                    A community plugin registry is planned: browse, one-click install, and update plugins published by the community.
                  </Trans>
                </p>
                <ul>
                  <li><Trans>Browse community plugins</Trans></li>
                  <li><Trans>One-click install and update</Trans></li>
                  <li><Trans>Publish your own plugins</Trans></li>
                </ul>
                <div className="plugin-detail-actions" style={{ marginTop: 14 }}>
                  <button className="plugin-button" onClick={this.openDocs}>
                    <Trans>How to custom plugin</Trans>
                  </button>
                </div>
              </div>
            ) : community.length === 0 ? (
              <div className="plugin-community-placeholder">
                <p>
                  <Trans>Failed to load the community registry</Trans>
                </p>
              </div>
            ) : (
              <div className="plugins-list">
                {community.map((entry) => this.renderCommunityRow(entry))}
              </div>
            )}
          </section>
        </main>
      </div>
    );
  }
}

export default Plugins;
