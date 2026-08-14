import React from "react";
import { Trans } from "react-i18next";
import { RouteComponentProps } from "react-router-dom";
import { openExternalUrl } from "../../utils/common";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { PluginManifest } from "../../models/Plugin";
import "./plugins.css";

interface PluginsProps extends RouteComponentProps {
  t: (key: string, options?: Record<string, unknown>) => string;
}

interface PluginsState {
  selectedId: string | null;
  query: string;
}

// Demo data that matches Obsidian's PluginManifest shape. `name` and
// `description` hold i18n keys (rendered through t()) so the page is not
// hard-English. Real loaders, the community-plugins.json fetcher, and the
// host runtime are planned (see the "Community" placeholder below). These
// exist only so the page's vocabulary matches what a future real plugin
// will look like — not a different system smuggled in as fake content.
const INSTALLED_PLUGINS: PluginManifest[] = [
  {
    id: "weread-notes",
    name: "weread-notes-name",
    author: "Books",
    version: "1.0.0",
    minAppVersion: "1.0.0",
    description: "weread-notes-desc",
    isDesktopOnly: true,
  },
  {
    id: "legado-shelf",
    name: "legado-shelf-name",
    author: "Books",
    version: "0.3.0",
    minAppVersion: "1.0.0",
    description: "legado-shelf-desc",
    isDesktopOnly: true,
  },
];

class Plugins extends React.Component<PluginsProps, PluginsState> {
  constructor(props: PluginsProps) {
    super(props);
    this.state = { selectedId: INSTALLED_PLUGINS[0]?.id || null, query: "" };
  }

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

  renderPluginCard(plugin: PluginManifest, selected: boolean) {
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
        </div>
      </button>
    );
  }

  renderDetail(plugin: PluginManifest | null) {
    if (!plugin) {
      return (
        <div className="plugin-detail-empty">
          <Trans>Select a plugin to view its details</Trans>
        </div>
      );
    }
    return (
      <div className="plugin-detail">
        <p className="plugin-detail-eyebrow">
          <Trans>Installed</Trans>
        </p>
        <h1>{this.displayName(plugin)}</h1>
        <p className="plugin-detail-desc">{this.displayDesc(plugin)}</p>

        <dl className="plugin-detail-grid">
          <dt><Trans>ID</Trans></dt>
          <dd><code>{plugin.id}</code></dd>
          <dt><Trans>Plugin version</Trans></dt>
          <dd>{plugin.version}</dd>
          <dt><Trans>Author</Trans></dt>
          <dd>{plugin.author}</dd>
          <dt><Trans>Min app version</Trans></dt>
          <dd>{plugin.minAppVersion}</dd>
        </dl>

        <div className="plugin-detail-actions">
          <button className="plugin-button primary" disabled title={this.props.t("Coming soon")}>
            <Trans>Enable</Trans>
          </button>
          <button className="plugin-button" disabled title={this.props.t("Coming soon")}>
            <Trans>Uninstall</Trans>
          </button>
        </div>
      </div>
    );
  }

  render() {
    const { selectedId, query } = this.state;
    const queryTrim = query.trim().toLowerCase();
    const filtered = INSTALLED_PLUGINS.filter((p) => this.matches(p, queryTrim));
    const selected = INSTALLED_PLUGINS.find((p) => p.id === selectedId) || null;
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
            <span className="plugins-rail-count">{INSTALLED_PLUGINS.length}</span>
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
              {filtered.map((plugin) =>
                this.renderPluginCard(plugin, plugin.id === selectedId)
              )}
            </div>
          )}
        </aside>
        <main className="plugins-main">
          {this.renderDetail(selected)}

          <section className="plugin-community">
            <div className="plugin-community-head">
              <h2>
                <Trans>Community plugins</Trans>
              </h2>
              <span className="plugin-badge">
                <Trans>Coming soon</Trans>
              </span>
            </div>
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
          </section>
        </main>
      </div>
    );
  }
}

export default Plugins;
