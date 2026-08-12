import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import packageJson from "../../../../package.json";
import { openExternalUrl } from "../../../utils/common";
import { isElectron } from "react-device-detect";
declare var window: any;

class AboutSetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {};
  }

  render() {
    return (
      <>
        <div className="setting-dialog-new-title">
          <Trans>Current version</Trans>
          <span>{packageJson.version}</span>
        </div>
        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Get debug logs</Trans>
            <span
              className="change-location-button"
              onClick={() =>
                window.require("electron").ipcRenderer.invoke("get-debug-logs", "ping")
              }
            >
              <Trans>Locate</Trans>
            </span>
          </div>
        )}
        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Open console</Trans>
            <span
              className="change-location-button"
              onClick={() =>
                window.require("electron").ipcRenderer.invoke("open-console", "ping")
              }
            >
              <Trans>View</Trans>
            </span>
          </div>
        )}
        <div className="setting-dialog-new-title">
          <span>Books repository</span>
          <span
            className="change-location-button"
            onClick={() => openExternalUrl("https://github.com/user-A100/books-reader")}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <span>Open-source notice</span>
          <span style={{ fontSize: "12px", opacity: 0.72 }}>
            Based on an Apache-2.0 licensed reader project; see NOTICE.md.
          </span>
        </div>
      </>
    );
  }
}

export default AboutSetting;
