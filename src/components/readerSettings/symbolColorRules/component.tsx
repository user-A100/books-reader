import React from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import {
  getDefaultSymbolColorRules,
  parseSymbolColorRules,
  SymbolColorRule,
} from "../../../utils/reader/symbolColorUtil";
import StyleUtil from "../../../utils/reader/styleUtil";
import "./symbolColorRules.css";

interface SymbolColorRulesProps {
  renderBookFunc: () => void;
  t: (title: string) => string;
}

interface SymbolColorRulesState {
  enabled: boolean;
  rules: SymbolColorRule[];
}

class SymbolColorRules extends React.Component<
  SymbolColorRulesProps,
  SymbolColorRulesState
> {
  constructor(props: SymbolColorRulesProps) {
    super(props);
    this.state = {
      enabled: ConfigService.getReaderConfig("isSymbolColoring") === "yes",
      rules: parseSymbolColorRules(
        ConfigService.getReaderConfig("symbolColorRules")
      ),
    };
  }

  save = (rules = this.state.rules, enabled = this.state.enabled) => {
    ConfigService.setReaderConfig("isSymbolColoring", enabled ? "yes" : "no");
    ConfigService.setReaderConfig("symbolColorRules", JSON.stringify(rules));
    // Apply to the live iframe immediately. A full render can be ignored by
    // the reader's navigation lock and TXT refreshes may overwrite its result.
    StyleUtil.applySymbolColoring();
  };

  updateRule = (id: string, patch: Partial<SymbolColorRule>) => {
    this.setState({
      rules: this.state.rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule
      ),
    });
  };

  render() {
    return (
      <section className="symbol-color-rules" data-search-key="symbolColoring">
        <div className="single-control-switch-container">
          <span className="single-control-switch-title">
            <Trans>Symbol coloring</Trans>
          </span>
          <span
            className="single-control-switch"
            onClick={() => {
              const enabled = !this.state.enabled;
              this.setState({ enabled }, () => this.save());
            }}
            style={this.state.enabled ? {} : { opacity: 0.6 }}
          >
            <span
              className="single-control-button"
              style={{
                transform: this.state.enabled
                  ? "translateX(20px)"
                  : "translateX(0px)",
                transition: "transform 0.5s ease",
              }}
            ></span>
          </span>
        </div>
        <p className="symbol-color-rules-hint">
          <Trans>
            Color only the text between matching symbols. Rules can span inline
            formatting and paragraphs.
          </Trans>
        </p>
        {this.state.enabled && (
          <div className="symbol-color-rules-editor">
            {this.state.rules.map((rule) => (
              <div className="symbol-color-rule" key={rule.id}>
                <label>
                  <span><Trans>Start</Trans></span>
                  <input
                    aria-label={this.props.t("Start")}
                    maxLength={12}
                    value={rule.start}
                    onChange={(event) =>
                      this.updateRule(rule.id, { start: event.target.value })
                    }
                  />
                </label>
                <span className="symbol-color-rule-arrow">→</span>
                <label>
                  <span><Trans>End</Trans></span>
                  <input
                    aria-label={this.props.t("End")}
                    maxLength={12}
                    value={rule.end}
                    onChange={(event) =>
                      this.updateRule(rule.id, { end: event.target.value })
                    }
                  />
                </label>
                <label className="symbol-color-rule-color">
                  <span><Trans>Color</Trans></span>
                  <input
                    aria-label={this.props.t("Color")}
                    type="color"
                    value={rule.color}
                    onChange={(event) =>
                      this.updateRule(rule.id, { color: event.target.value })
                    }
                  />
                </label>
                <button
                  aria-label={this.props.t("Delete rule")}
                  className="symbol-color-rule-delete"
                  onClick={() =>
                    this.setState({
                      rules: this.state.rules.filter((item) => item.id !== rule.id),
                    })
                  }
                >
                  ×
                </button>
                <div className="symbol-color-rule-preview">
                  {rule.start}
                  <span style={{ color: rule.color }}>
                    <Trans>Example text</Trans>
                  </span>
                  {rule.end}
                </div>
              </div>
            ))}
            <div className="symbol-color-rule-actions">
              <button
                onClick={() =>
                  this.setState({
                    rules: [
                      ...this.state.rules,
                      {
                        id: `rule-${Date.now()}`,
                        start: "(",
                        end: ")",
                        color: "#b487d8",
                        enabled: true,
                      },
                    ],
                  })
                }
              >
                <Trans>Add rule</Trans>
              </button>
              <button
                className="symbol-color-rules-apply"
                onClick={() => {
                  const rules = this.state.rules.filter(
                    (rule) => rule.start.trim() && rule.end.trim()
                  );
                  this.setState({ rules }, () => this.save());
                  toast.success(this.props.t("Symbol color rules applied"));
                }}
              >
                <Trans>Apply rules</Trans>
              </button>
              <button
                onClick={() => this.setState({ rules: getDefaultSymbolColorRules() })}
              >
                <Trans>Restore defaults</Trans>
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }
}

export default SymbolColorRules;
