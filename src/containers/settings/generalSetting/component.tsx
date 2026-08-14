import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import i18n from "../../../i18n";
import { isElectron } from "react-device-detect";
import _ from "underscore";
import {
  generalSettingList,
  langList,
  searchList,
} from "../../../constants/settingList";

import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";

declare var window: any;

// Maps a native DOM KeyboardEvent to the "key" token of an Electron accelerator
// (code "KeyA" → "A", "Backquote" → "`", "F5" → "F5", "ArrowLeft" → "Left").
// Returns null for keys we don't accept as a shortcut trigger; lone modifier
// presses are filtered out by the caller before this runs.
const acceleratorKeyFromEvent = (event: KeyboardEvent): string | null => {
  const code = event.code || "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const map: Record<string, string> = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Space: "Space",
    Enter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Insert: "Insert",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };
  return map[code] || null;
};

class GeneralSetting extends React.Component<
  SettingInfoProps,
  SettingInfoState
> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {
      isTouch: ConfigService.getReaderConfig("isTouch") === "yes",
      isImportPath: ConfigService.getReaderConfig("isImportPath") === "yes",
      isMergeWord: ConfigService.getReaderConfig("isMergeWord") === "yes",
      isPreventTrigger:
        ConfigService.getReaderConfig("isPreventTrigger") === "yes",
      isPreventAdd: ConfigService.getReaderConfig("isPreventAdd") === "yes",
      isOpenBook: ConfigService.getReaderConfig("isOpenBook") === "yes",
      isDisablePopup: ConfigService.getReaderConfig("isDisablePopup") === "yes",
      isDisableTrashBin:
        ConfigService.getReaderConfig("isDisableTrashBin") === "yes",
      isDeleteShelfBook:
        ConfigService.getReaderConfig("isDeleteShelfBook") === "yes",
      isHideShelfBook:
        ConfigService.getReaderConfig("isHideShelfBook") === "yes",
      isPreventSleep: ConfigService.getReaderConfig("isPreventSleep") === "yes",
      isAlwaysOnTop: ConfigService.getReaderConfig("isAlwaysOnTop") === "yes",
      isAutoMaximizeWin:
        ConfigService.getReaderConfig("isAutoMaximizeWin") === "yes",
      isAutoLaunch: ConfigService.getReaderConfig("isAutoLaunch") === "yes",
      isMinimizeToTray:
        ConfigService.getReaderConfig("isMinimizeToTray") === "yes",
      isOpenInMain: ConfigService.getReaderConfig("isOpenInMain") === "yes",
      isDisableAI: ConfigService.getReaderConfig("isDisableAI") === "yes",
      isUseOriginalName:
        ConfigService.getReaderConfig("isUseOriginalName") === "yes",
      isExportOriginalName:
        ConfigService.getReaderConfig("isExportOriginalName") === "yes",
      isDisableUpdate:
        ConfigService.getReaderConfig("isDisableUpdate") === "yes",
      isPrecacheBook: ConfigService.getReaderConfig("isPrecacheBook") === "yes",
      isUseBuiltIn: ConfigService.getReaderConfig("isUseBuiltIn") === "yes",
      isDeleteOriginal:
        ConfigService.getReaderConfig("isDeleteOriginal") === "yes",
      isDisablePDFCover:
        ConfigService.getReaderConfig("isDisablePDFCover") === "yes",
      startupShelf: ConfigService.getReaderConfig("startupShelf") || "",
      isMoyu: true,
      moyuAccelerator: "Ctrl+`",
      isRecordingHotkey: false,
      hasCustomHotkey: false,
      hotkeyError: "",
    };
  }

  async componentDidMount() {
    if (!isElectron) return;
    try {
      const { ipcRenderer } = window.require("electron");
      const config = await ipcRenderer.invoke("moyu-get-config");
      if (config) {
        this.setState({
          isMoyu: config.enabled,
          moyuAccelerator: this.formatMoyuAccelerator(config.accelerator),
          hasCustomHotkey: !!config.hasCustomKey,
        });
      }
    } catch {
      // moyu config lives in the main process; ignore if unavailable
    }
  }

  // Display-friendly form of an Electron accelerator: Control → Ctrl,
  // CommandOrControl → Ctrl (matches how the hotkey is described to users).
  formatMoyuAccelerator = (accelerator: string) =>
    (accelerator || "Ctrl+`")
      .replace(/CommandOrControl/g, "Ctrl")
      .replace(/\bSuper\b/g, "Win")
      .replace(/\bMeta\b/g, "Win")
      .replace(/\bControl\b/g, "Ctrl");

  handleMoyu = async () => {
    if (!isElectron) return;
    try {
      const { ipcRenderer } = window.require("electron");
      const res = await ipcRenderer.invoke(
        "moyu-set-enabled",
        !this.state.isMoyu
      );
      this.setState({ isMoyu: res ? res.enabled : !this.state.isMoyu });
      this.handleRest(!this.state.isMoyu);
    } catch {
      // ignore
    }
  };

  handleRest = (_bool: boolean) => {
    toast.success(this.props.t("Change successful"));
  };
  changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    ConfigService.setReaderConfig("lang", lng);
  };
  changeSearch = (searchEngine: string) => {
    ConfigService.setReaderConfig("searchEngine", searchEngine);
    this.forceUpdate();
  };
  handleSetting = (stateName: string) => {
    this.setState({ [stateName]: !this.state[stateName] } as any);
    ConfigService.setReaderConfig(
      stateName,
      this.state[stateName] ? "no" : "yes"
    );
    this.handleRest(this.state[stateName]);
  };

  handleOpenInMain = () => {
    if (this.state.isMergeWord && !this.state.isOpenInMain) {
      toast(this.props.t("Please turn off merge with word first"));
      return;
    }
    this.handleSetting("isOpenInMain");
  };
  handleAlwaysOnTop = () => {
    const { ipcRenderer } = window.require("electron");
    ipcRenderer.invoke("set-always-on-top", {
      isAlwaysOnTop: this.state.isAlwaysOnTop ? "no" : "yes",
    });
    this.handleSetting("isAlwaysOnTop");
  };
  handleMaximizeWin = () => {
    const { ipcRenderer } = window.require("electron");
    ipcRenderer.invoke("set-auto-maximize", {
      isAutoMaximizeWin: this.state.isAutoMaximizeWin ? "no" : "yes",
    });
    this.handleSetting("isAutoMaximizeWin");
  };
  handleAutoLaunch = () => {
    const { ipcRenderer } = window.require("electron");
    ipcRenderer.invoke("toggle-auto-launch", {
      isAutoLaunch: this.state.isAutoLaunch ? "no" : "yes",
    });
    this.handleSetting("isAutoLaunch");
  };
  handleMinimizeToTray = () => {
    const { ipcRenderer } = window.require("electron");
    ipcRenderer.invoke("toggle-minimize-to-tray", {
      isMinimizeToTray: this.state.isMinimizeToTray ? "no" : "yes",
    });
    this.handleSetting("isMinimizeToTray");
  };
  renderSwitchOption = (optionList: any[]) => {
    return optionList.map((item) => {
      return (
        <div
          style={item.isElectron ? (isElectron ? {} : { display: "none" }) : {}}
          key={item.propName}
        >
          <div className="setting-dialog-new-title" key={item.title}>
            <span style={{ width: "calc(100% - 100px)" }}>
              <Trans>{item.title}</Trans>
            </span>

            <span
              className="single-control-switch"
              onClick={() => {
                switch (item.propName) {
                  case "isOpenInMain":
                    this.handleOpenInMain();
                    break;
                  case "isAlwaysOnTop":
                    this.handleAlwaysOnTop();
                    break;
                  case "isAutoMaximizeWin":
                    this.handleMaximizeWin();
                    break;
                  case "isAutoLaunch":
                    this.handleAutoLaunch();
                    break;
                  case "isMinimizeToTray":
                    this.handleMinimizeToTray();
                    break;
                  default:
                    this.handleSetting(item.propName);
                    break;
                }
              }}
              style={this.state[item.propName] ? {} : { opacity: 0.6 }}
            >
              <span
                className="single-control-button"
                style={
                  this.state[item.propName]
                    ? {
                        transform: "translateX(20px)",
                        transition: "transform 0.5s ease",
                      }
                    : {
                        transform: "translateX(0px)",
                        transition: "transform 0.5s ease",
                      }
                }
              ></span>
            </span>
          </div>
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };
  handleResetMainPosition = () => {
    window
      .require("electron")
      .ipcRenderer.invoke("reset-main-position", "ping");
    toast.success(this.props.t("Reset successful"));
  };
  render() {
    return (
      <>
        {this.renderSwitchOption(generalSettingList)}

        {isElectron && (
          <div key="isMoyu">
            <div className="setting-dialog-new-title">
              <span style={{ width: "calc(100% - 100px)" }}>
                <Trans>Slacking-off mode</Trans>
              </span>
              <span
                className="single-control-switch"
                onClick={this.handleMoyu}
                style={this.state.isMoyu ? {} : { opacity: 0.6 }}
              >
                <span
                  className="single-control-button"
                  style={
                    this.state.isMoyu
                      ? {
                          transform: "translateX(20px)",
                          transition: "transform 0.5s ease",
                        }
                      : {
                          transform: "translateX(0px)",
                          transition: "transform 0.5s ease",
                        }
                  }
                ></span>
              </span>
            </div>
            <p className="setting-option-subtitle">
              <Trans>
                Instantly hide every Books window and its taskbar/dock icon;
                press the hotkey again to restore.
              </Trans>
              <br />
              <Trans>Hotkey</Trans>: <code>{this.state.moyuAccelerator}</code>
            </p>
          </div>
        )}

        <div className="setting-dialog-new-title">
          <Trans>Reset main window's position</Trans>

          <span
            className="change-location-button"
            onClick={() => {
              this.handleResetMainPosition();
            }}
          >
            <Trans>Reset</Trans>
          </span>
        </div>

        <div className="setting-dialog-new-title">
          <Trans>Language</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            value={ConfigService.getReaderConfig("lang") || "en"}
            onChange={(event) => {
              this.changeLanguage(event.target.value);
            }}
          >
            {langList.map((item) => (
              <option
                value={item.value}
                key={item.value}
                className="lang-setting-option"
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Default search engine</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            value={
              ConfigService.getReaderConfig("searchEngine") ||
              (navigator.language === "zh-CN" ? "baidu" : "google")
            }
            onChange={(event) => {
              this.changeSearch(event.target.value);
            }}
          >
            {searchList.map((item) => (
              <option
                value={item.value}
                key={item.value}
                className="lang-setting-option"
              >
                {this.props.t(item.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Auto switch to shelf on startup</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            value={this.state.startupShelf || ""}
            onChange={(event) => {
              const value = event.target.value;
              ConfigService.setReaderConfig("startupShelf", value);
              this.setState({ startupShelf: value });
              toast.success(this.props.t("Change successful"));
            }}
          >
            <option
              value=""
              className="lang-setting-option"
            >
              {this.props.t("Disabled")}
            </option>
            {Object.keys(ConfigService.getAllMapConfig("shelfList") || {}).map(
              (shelfName) => (
                <option
                  value={shelfName}
                  key={shelfName}
                  className="lang-setting-option"
                >
                  {shelfName}
                </option>
              )
            )}
          </select>
        </div>
      </>
    );
  }
}

export default GeneralSetting;
