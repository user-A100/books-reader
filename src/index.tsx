import React from "react";
import ReactDOM from "react-dom";
import "./assets/styles/reset.css";
import "./assets/styles/global.css";
import "./assets/styles/style.css";
import { Provider } from "react-redux";
import "./i18n";
import store from "./store";
import Router from "./router/index";
import StyleUtil from "./utils/reader/styleUtil";
import {
  initSystemFont,
  initTheme,
  applyCustomSystemCSS,
  applyAppBackgroundImage,
} from "./utils/reader/launchUtil";
import { migrateConfig } from "./utils/common";
import { ensurePluginsStarted } from "./services/plugins/pluginStartup";
initTheme();
initSystemFont();
migrateConfig();
applyCustomSystemCSS();
applyAppBackgroundImage();
// Restore enabled plugin workers immediately. Feature clients also await the
// same singleton promise, so opening a plugin-backed page during startup is safe.
void ensurePluginsStarted().catch((error) =>
  console.error("Failed to restore enabled plugins", error)
);
const container = document.getElementById("root")!;
ReactDOM.render(
  <Provider store={store}>
    <Router />
  </Provider>,
  container
);
StyleUtil.applyTheme();
