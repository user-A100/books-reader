import React from "react";
import "./settingSearch.css";
import { Trans } from "react-i18next";
import { SettingSearchProps, SettingSearchState } from "./interface";
import { sliderConfigs, dropdownList } from "../../../constants/dropdownList";
import { readerSettingList } from "../../../constants/settingList";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { SETTING_SEARCH_FOCUS_EVENT } from "../../../utils/reader/mouseEvent";
import BookModel from "../../../models/Book";

export interface SearchEntry {
  key: string;
  title: string;
  category: string;
  isPDF: boolean;
}

class SettingSearch extends React.Component<
  SettingSearchProps,
  SettingSearchState
> {
  constructor(props: SettingSearchProps) {
    super(props);
    this.state = {
      query: "",
      results: [],
      activeIndex: -1,
      isFocused: false,
    };
  }

  buildIndex = (): SearchEntry[] => {
    const { t } = this.props;
    const index: SearchEntry[] = [];

    index.push({
      key: "readerMode",
      title: t("View mode"),
      category: t("Mode"),
      isPDF: true,
    });

    index.push({
      key: "themeColor",
      title: t("Theme"),
      category: t("Color"),
      isPDF: true,
    });

    index.push({
      key: "themeColor",
      title: t("Background color"),
      category: t("Color"),
      isPDF: true,
    });
    index.push({
      key: "themeColor",
      title: t("Text color"),
      category: t("Color"),
      isPDF: true,
    });

    index.push({
      key: "symbolColoring",
      title: t("Symbol coloring"),
      category: t("Color"),
      isPDF: false,
    });

    index.push({
      key: "readerBackground",
      title: t("Reader background"),
      category: t("Background"),
      isPDF: true,
    });
    index.push({
      key: "backgroundOpacity",
      title: t("Background image opacity"),
      category: t("Background"),
      isPDF: true,
    });
    index.push({
      key: "bookSpine",
      title: t("Book spine effect"),
      category: t("Background"),
      isPDF: true,
    });
    index.push({
      key: "bookSpineStrength",
      title: t("Book spine strength"),
      category: t("Background"),
      isPDF: true,
    });

    sliderConfigs.forEach((item) => {
      index.push({
        key: item.mode,
        title: t(item.title),
        category: t("Layout"),
        isPDF: item.isPDF,
      });
    });

    dropdownList.forEach((item) => {
      index.push({
        key: item.value,
        title: t(item.title),
        category: t("Layout"),
        isPDF: item.isPDF,
      });
    });
    index.push({
      key: "fullTranslationTarget",
      title: t("Target translation language"),
      category: t("Layout"),
      isPDF: false,
    });
    index.push({
      key: "txtParser",
      title: t("TXT parser"),
      category: t("Layout"),
      isPDF: false,
    });

    index.push({
      key: "isCustomBookCSS",
      title: t("Custom book style (CSS)"),
      category: t("Style"),
      isPDF: false,
    });
    index.push({
      key: "isSeperateStyle",
      title: t("Enable seperate style for this book"),
      category: t("Style"),
      isPDF: false,
    });
    index.push({
      key: "isWordDefinition",
      title: t("Enable word definitions"),
      category: t("Style"),
      isPDF: false,
    });

    readerSettingList.forEach((item) => {
      index.push({
        key: item.propName,
        title: t(item.title),
        category: t("Style"),
        isPDF: item.isPDF,
      });
    });

    return index;
  };

  /**
   * Fuzzy match with a relevance score (higher = better, 0 = no match).
   * Combines substring, word-boundary, and subsequence matching.
   */
  scoreMatch = (text: string, query: string): number => {
    if (!query) return 0;
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    if (!q) return 0;
    if (lower === q) return 1000;
    if (lower.startsWith(q)) return 900 - (lower.length - q.length);

    const idx = lower.indexOf(q);
    if (idx >= 0) {
      // boost for word-boundary match
      const boundary =
        idx === 0 ||
        /[\s\-_/,.;:]/.test(lower[idx - 1])
          ? 600
          : 400;
      return boundary - idx;
    }

    const qWords = q.split(/\s+/).filter(Boolean);
    // every word must appear as substring
    if (qWords.length > 1) {
      let allFound = true;
      for (const w of qWords) {
        if (!lower.includes(w)) {
          allFound = false;
          break;
        }
      }
      if (allFound) return 300;
    }

    // subsequence match
    let qi = 0;
    let prevIdx = -1;
    let consecutive = 1;
    let maxConsecutive = 1;
    for (let ti = 0; ti < lower.length && qi < q.length; ti++) {
      if (lower[ti] === q[qi]) {
        if (prevIdx === ti - 1) {
          consecutive++;
          if (consecutive > maxConsecutive) maxConsecutive = consecutive;
        } else {
          consecutive = 1;
        }
        prevIdx = ti;
        qi++;
      }
    }
    if (qi === q.length) {
      return 100 + maxConsecutive * 10 - (lower.length - q.length);
    }
    return 0;
  };

  handleQueryChange = (value: string) => {
    const query = value;
    if (!query.trim()) {
      this.setState({ query, results: [], activeIndex: -1 });
      return;
    }
    const isPDF = this.isCurrentPDF();
    const index = this.buildIndex().filter((entry) => {
      if (isPDF) return entry.isPDF;
      return true;
    });
    const scored = index
      .map((entry) => ({
        entry,
        score: this.scoreMatch(entry.title, query),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item) => item.entry);

    this.setState({ query, results: scored, activeIndex: -1 });
  };

  isCurrentPDF = () => {
    const book = this.props.currentBook;
    return (
      book?.format === "PDF" &&
      !ConfigService.getAllListConfig("convertPDFBooks").includes(book.key)
    );
  };

  scrollToEntry = (entry: SearchEntry) => {
    const container = document.querySelector(".setting-panel") as HTMLElement;
    if (!container) return;
    const el = container.querySelector(
      `[data-search-key="${entry.key}"]`
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("setting-search-highlight");
    window.setTimeout(() => {
      el.classList.remove("setting-search-highlight");
    }, 1800);
    this.setState({ query: entry.title, results: [], activeIndex: -1 });
  };

  handleKeyDown = (e: React.KeyboardEvent) => {
    const { results, activeIndex } = this.state;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      this.setState({
        activeIndex: (activeIndex + 1) % results.length,
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      this.setState({
        activeIndex:
          activeIndex <= 0 ? results.length - 1 : activeIndex - 1,
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0) {
        const idx = activeIndex >= 0 ? activeIndex : 0;
        this.scrollToEntry(results[idx]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.setState({ query: "", results: [], activeIndex: -1 });
    }
  };

  render() {
    const { t } = this.props;
    const { query, results, activeIndex, isFocused } = this.state;
    return (
      <div className="setting-search-container">
        <div className="setting-search-box">
          <span className="icon-search setting-search-icon"></span>
          <input
            className="setting-search-input"
            type="text"
            value={query}
            placeholder={t("Search reading options")}
            onChange={(e) => this.handleQueryChange(e.target.value)}
            onKeyDown={this.handleKeyDown}
            onFocus={() => {
              window.dispatchEvent(
                new CustomEvent(SETTING_SEARCH_FOCUS_EVENT, {
                  detail: { focused: true },
                })
              );
              this.setState({ isFocused: true });
            }}
            onBlur={() => {
              window.dispatchEvent(
                new CustomEvent(SETTING_SEARCH_FOCUS_EVENT, {
                  detail: { focused: false },
                })
              );
              window.setTimeout(() => {
                this.setState({ isFocused: false });
              }, 150);
            }}
          />
          {query && (
            <span
              className="icon-close setting-search-clear"
              onMouseDown={(e) => {
                e.preventDefault();
                this.setState({ query: "", results: [], activeIndex: -1 });
              }}
            ></span>
          )}
        </div>
        {isFocused && results.length > 0 && (
          <ul className="setting-search-results">
            {results.map((entry, index) => (
              <li
                key={entry.key + index}
                className={
                  "setting-search-result" +
                  (index === activeIndex ? " active" : "")
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  this.scrollToEntry(entry);
                }}
                onMouseEnter={() => this.setState({ activeIndex: index })}
              >
                <span className="setting-search-result-title">{entry.title}</span>
                <span className="setting-search-result-category">
                  {entry.category}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
}

export default SettingSearch;
