import React from "react";
import "./progressPanel.css";
import { Trans } from "react-i18next";
import { ProgressPanelProps, ProgressPanelState } from "./interface";
import _ from "underscore";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { scrollContents } from "../../../utils/common";
class ProgressPanel extends React.Component<
  ProgressPanelProps,
  ProgressPanelState
> {
  constructor(props: ProgressPanelProps) {
    super(props);
    this.state = {
      currentPage: 0,
      totalPage: 0,
      targetChapterIndex: 0,
      targetPage: 0,
      currentPercentage: 0,
      isEntered: false,
    };
  }
  async UNSAFE_componentWillReceiveProps(nextProps: ProgressPanelProps) {
    if (
      nextProps.htmlBook !== this.props.htmlBook &&
      nextProps.htmlBook &&
      !this.props.htmlBook
    ) {
      const htmlBook = nextProps.htmlBook;
      const rendition = htmlBook.rendition;
      const bookKey = nextProps.currentBook.key;
      await this.handlePageNum(rendition);
      rendition.on("page-changed", async () => {
        if (!this.isCurrentRendition(rendition)) return;
        this.handleLocation(rendition, bookKey);
        await this.handlePageNum(rendition);
        if (!this.isCurrentRendition(rendition)) return;
        this.handleCurrentChapterIndex(rendition, htmlBook);
        this.props.handleFetchPercentage(this.props.currentBook);
      });
      rendition.on("rendered", async () => {
        if (!this.isCurrentRendition(rendition)) return;
        await this.handlePageNum(rendition);
        if (!this.isCurrentRendition(rendition)) return;
        this.handleCurrentChapterIndex(rendition, htmlBook);
      });
      this.handleCurrentChapterIndex(rendition, htmlBook);
      let bookLocation: {
        text: string;
        chapterTitle: string;
        chapterDocIndex: string;
        chapterHref: string;
        percentage: string;
      } = ConfigService.getObjectConfig(
        this.props.currentBook.key,
        "recordLocation",
        {}
      );
      if (bookLocation.percentage) {
        let percentage = (parseFloat(bookLocation.percentage) * 100).toFixed(2);
        this.setState({ currentPercentage: parseFloat(percentage) });
      }
    }
    if (nextProps.percentage !== this.props.percentage && nextProps.htmlBook) {
      let percentage = (nextProps.percentage * 100).toFixed(2);
      this.setState({ currentPercentage: parseFloat(percentage) });
    }
  }
  isCurrentRendition = (rendition: any) =>
    Boolean(rendition && this.props.htmlBook?.rendition === rendition);

  handleLocation = (rendition = this.props.htmlBook?.rendition, bookKey = this.props.currentBook.key) => {
    if (!rendition?.getPosition) return;
    let position = rendition.getPosition();
    if (!position) return;
    ConfigService.setObjectConfig(
      bookKey,
      position,
      "recordLocation"
    );
    this.props.handleCurrentChapter(position.chapterTitle);
    setTimeout(() => {
      scrollContents(position.chapterTitle, position.chapterHref);
    }, 1000);
  };
  handleCurrentChapterIndex = (rendition, htmlBook = this.props.htmlBook) => {
    if (!rendition?.getPosition || !htmlBook) return;
    let position = rendition.getPosition();
    if (!position) return;

    let href = position.chapterHref;
    if (!href) {
      return;
    }
    let chapterIndex = _.findIndex(htmlBook.flattenChapters || [], {
      href,
    });
    this.setState({ targetChapterIndex: chapterIndex + 1 });
  };
  async handlePageNum(rendition) {
    if (!rendition?.getProgress) return;
    let pageInfo = await rendition.getProgress();
    if (
      !pageInfo ||
      typeof pageInfo.currentPage !== "number" ||
      typeof pageInfo.totalPage !== "number"
    ) {
      return;
    }
    this.setState({
      currentPage: pageInfo.currentPage,
      totalPage: pageInfo.totalPage,
    });
  }
  onProgressChange = async (event: any) => {
    if (!this.props.htmlBook?.rendition) return;
    const percentage = event.target.value / 100;
    this.setState({ currentPercentage: event.target.value });
    await this.props.htmlBook.rendition.goToPercentage(percentage);
  };
  nextChapter = async () => {
    if (this.props.htmlBook?.flattenChapters.length) {
      await this.props.htmlBook.rendition.nextChapter();
    }
  };
  prevChapter = async () => {
    if (this.props.htmlBook?.flattenChapters.length) {
      await this.props.htmlBook.rendition.prevChapter();
    }
  };
  handleJumpChapter = async (event: any) => {
    if (!this.props.htmlBook?.rendition) return;
    let targetChapterIndex = parseInt(event.target.value.trim()) - 1;
    await this.props.htmlBook.rendition.goToChapterIndex(targetChapterIndex);
  };
  render() {
    if (!this.props.htmlBook) {
      return <div className="progress-panel">Loading</div>;
    }
    let readerMode =
      (this.props.currentBook.format === "PDF" &&
        !ConfigService.getAllListConfig("convertPDFBooks").includes(
          this.props.currentBook.key
        )) ||
      this.props.currentBook.format.startsWith("CB")
        ? ConfigService.getReaderConfig("pdfReaderMode") || "scroll"
        : ConfigService.getReaderConfig("readerMode") || "double";
    return (
      <div className="progress-panel">
        <p className="progress-text" style={{ marginTop: 10 }}>
          <span>
            <Trans>Progress</Trans>: {this.state.currentPercentage}
            %&nbsp;&nbsp;&nbsp;
          </span>
        </p>

        <p className="progress-text" style={{ marginTop: 0 }}>
          <Trans>Pages</Trans>
          <input
            type="text"
            name="jumpPage"
            id="jumpPage"
            value={
              this.state.targetPage
                ? this.state.targetPage
                : this.state.currentPage *
                  (readerMode === "double" &&
                  this.props.currentBook.format !== "PDF"
                    ? 2
                    : 1)
            }
            onFocus={() => {
              this.setState({ targetPage: " " });
            }}
            onChange={(event) => {
              let fieldVal = event.target.value;
              this.setState({ targetPage: fieldVal });
            }}
            onBlur={(event) => {
              if (event.target.value.trim()) {
                this.props.htmlBook?.rendition?.goToPage(
                  parseInt(event.target.value.trim())
                );
              } else {
                this.setState({ targetPage: "" });
              }
            }}
          />
          <span>/ {this.state.totalPage}</span>
          &nbsp;&nbsp;&nbsp;
          <Trans>Chapters</Trans>
          <input
            type="text"
            name="jumpChapter"
            id="jumpChapter"
            value={this.state.targetChapterIndex}
            onFocus={() => {
              this.setState({ targetChapterIndex: " " });
            }}
            onChange={(event) => {
              let fieldVal = event.target.value;
              this.setState({ targetChapterIndex: fieldVal });
            }}
            onBlur={(event) => {
              if (!this.state.isEntered) {
                if (event.target.value.trim()) {
                  this.handleJumpChapter(event);
                  this.setState({ targetChapterIndex: "" });
                } else {
                  this.setState({ targetChapterIndex: "" });
                }
              } else {
                this.setState({ isEntered: false });
              }
            }}
            onKeyDown={(event: any) => {
              if (event.key === "Enter") {
                this.setState({ isEntered: true });
                if (event.target.value.trim()) {
                  this.handleJumpChapter(event);
                  this.setState({ targetChapterIndex: "" });
                } else {
                  this.setState({ targetChapterIndex: "" });
                }
              }
            }}
          />
          <span>/ {this.props.htmlBook.flattenChapters.length}</span>
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "90%",
            marginLeft: "5%",
          }}
        >
          <div
            className="previous-chapter"
            onClick={() => {
              this.prevChapter();
            }}
          >
            <span className="icon-dropdown previous-chapter-icon"> </span>
          </div>
          <input
            className="input-progress"
            value={this.state.currentPercentage}
            type="range"
            max="100"
            min="0"
            step="1"
            onMouseUp={(event) => {
              this.onProgressChange(event);
            }}
            onTouchEnd={(event) => {
              this.onProgressChange(event);
            }}
            onChange={(event) => {
              this.setState({
                currentPercentage: parseInt(event.target.value),
              });
            }}
            style={{ width: "80%" }}
          />
          <div
            className="next-chapter"
            onClick={() => {
              this.nextChapter();
            }}
          >
            <span className="icon-dropdown next-chapter-icon"></span>
          </div>
        </div>
      </div>
    );
  }
}

export default ProgressPanel;
