import { getIframeDoc } from "./docUtil";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { applyThemeColor, removeThemeColor } from "./themeUtil";
import { StyleHelper } from "../../assets/lib/kookit.min";
import FontUtil from "../file/fontUtil";
import BackgroundUtil from "../file/backgroundUtil";
import {
  applySymbolColoring as applySymbolColoringToDocument,
  parseSymbolColorRules,
} from "./symbolColorUtil";

class styleUtil {
  // add default css for iframe
  static addDefaultCss(bookKey: string) {
    let doc = getIframeDoc("ANY")[0];
    if (!doc) return;
    if (!doc.head) {
      return;
    }
    //get style with id of default-style
    let styleElement = doc.getElementById("default-style");
    if (styleElement) {
      styleElement.textContent = this.getDefaultCss(bookKey);
    } else {
      let css = this.getDefaultCss(bookKey);
      let style = doc.createElement("style");
      style.id = "default-style";
      style.textContent = css;
      doc.head.appendChild(style);
    }
    // inject custom book CSS if enabled
    let customCssElement = doc.getElementById("custom-book-style");
    const isCustomBookCSS =
      ConfigService.getReaderConfig("isCustomBookCSS") === "yes";
    const customBookCSS = ConfigService.getReaderConfig("customBookCSS") || "";
    if (isCustomBookCSS && customBookCSS) {
      if (customCssElement) {
        customCssElement.textContent = customBookCSS;
      } else {
        let customStyle = doc.createElement("style");
        customStyle.id = "custom-book-style";
        customStyle.textContent = customBookCSS;
        doc.head.appendChild(customStyle);
      }
    } else if (customCssElement) {
      customCssElement.textContent = "";
    }

    void this.applyReaderBackground(doc);

    this.applySymbolColoring();
  }
  // get default css for iframe
  static getDefaultCss(bookKey: string) {
    return StyleHelper.getDefaultCss(ConfigService, bookKey);
  }

  /** Apply the saved symbol rules to every currently rendered book document.
   * This is intentionally independent from a full book render: TXT/EPUB
   * pagination can rebuild the iframe after styles were first injected. */
  static applySymbolColoring(): void {
    const rules =
      ConfigService.getReaderConfig("isSymbolColoring") === "yes"
        ? parseSymbolColorRules(
            ConfigService.getReaderConfig("symbolColorRules")
          )
        : [];
    getIframeDoc("ANY").forEach((doc) => {
      if (doc) applySymbolColoringToDocument(doc, rules);
    });
  }

  /**
   * Keep the selected image in the document that renders the book, rather
   * than only on the layer below its iframe. This makes a custom reader
   * background visible for reflowable books as well as around the page.
   */
  static async applyReaderBackground(doc?: Document): Promise<void> {
    const targetDoc = doc || getIframeDoc("ANY")[0];
    if (!targetDoc?.head) return;

    let styleElement = targetDoc.getElementById("reader-background-image");
    if (!styleElement) {
      styleElement = targetDoc.createElement("style");
      styleElement.id = "reader-background-image";
      targetDoc.head.appendChild(styleElement);
    }

    const imageId =
      ConfigService.getReaderConfig("readerBackgroundImage") || "";
    if (!imageId) {
      styleElement.textContent = "";
      return;
    }

    const meta = BackgroundUtil.getImageMeta(imageId);
    const imageUrl = await BackgroundUtil.loadImage(imageId, meta?.extension);

    // The user may have selected a different image while the local file was
    // loading. Do not let the previous request overwrite that selection.
    if (
      ConfigService.getReaderConfig("readerBackgroundImage") !== imageId ||
      !imageUrl
    ) {
      styleElement.textContent = "";
      return;
    }

    // JSON.stringify gives the data URL a quoted CSS-safe representation.
    const cssUrl = JSON.stringify(imageUrl);
    const opacity = Math.max(
      0,
      Math.min(
        100,
        Number(ConfigService.getReaderConfig("readerBackgroundOpacity") || 78)
      )
    ) / 100;
    const baseColor =
      ConfigService.getReaderConfig("backgroundColor") || "rgb(255, 255, 255)";
    styleElement.textContent = `
      html {
        background-color: ${baseColor} !important;
        background-image: linear-gradient(color-mix(in srgb, ${baseColor} ${(1 - opacity) * 100}%, transparent), color-mix(in srgb, ${baseColor} ${(1 - opacity) * 100}%, transparent)), url(${cssUrl}) !important;
        background-size: cover !important;
        background-position: center !important;
        background-attachment: fixed !important;
      }
      body {
        background-color: transparent !important;
      }
    `;
  }

  static async applyReaderFonts(rendition: any): Promise<void> {
    if (!rendition?.displayFontUrl) return;

    const fontName = ConfigService.getReaderConfig("fontFamily");
    const subFontName = ConfigService.getReaderConfig("subFontFamily");

    if (fontName && FontUtil.isCustomFont(fontName)) {
      const url = await FontUtil.getFontUrl(fontName);
      if (url) await rendition.displayFontUrl(fontName, url);
    }

    if (subFontName && FontUtil.isCustomFont(subFontName)) {
      const url = await FontUtil.getFontUrl(subFontName);
      if (url) await rendition.displayFontUrl(subFontName, url);
    }
  }

  static applyTheme() {
    const themeColor = ConfigService.getReaderConfig("themeColor");
    if (themeColor && themeColor !== "default") {
      applyThemeColor(themeColor);
    } else {
      removeThemeColor();
    }
  }
}

export default styleUtil;
