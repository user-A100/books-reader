import React from "react";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import BackgroundUtil from "../../../utils/file/backgroundUtil";
import StyleUtil from "../../../utils/reader/styleUtil";
import "./readerBackgroundControl.css";

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface ReaderBackgroundControlProps {
  isMimicEnabled: boolean;
  onMimicChange: (enabled: boolean) => void;
  onBackgroundChange: (imageId: string) => void;
  t: (key: string) => string;
}

interface ReaderBackgroundControlState {
  imageName: string;
  opacity: number;
  spineStrength: number;
}

class ReaderBackgroundControl extends React.Component<
  ReaderBackgroundControlProps,
  ReaderBackgroundControlState
> {
  private fileInputRef = React.createRef<HTMLInputElement>();

  constructor(props: ReaderBackgroundControlProps) {
    super(props);
    const imageId = ConfigService.getReaderConfig("readerBackgroundImage") || "";
    this.state = {
      imageName: imageId ? BackgroundUtil.getImageMeta(imageId)?.name || "" : "",
      opacity: Number(ConfigService.getReaderConfig("readerBackgroundOpacity") || 78),
      spineStrength: Number(ConfigService.getReaderConfig("readerSpineStrength") || 68),
    };
  }

  applyOpacity = async (opacity: number) => {
    this.setState({ opacity });
    ConfigService.setReaderConfig("readerBackgroundOpacity", String(opacity));
    // Re-dispatch the selected image so the background layer redraws immediately.
    this.props.onBackgroundChange(
      ConfigService.getReaderConfig("readerBackgroundImage") || ""
    );
    await StyleUtil.applyReaderBackground();
  };

  applySpineStrength = (spineStrength: number) => {
    this.setState({ spineStrength });
    ConfigService.setReaderConfig("readerSpineStrength", String(spineStrength));
    // The spine is rendered outside the iframe, so request a reader redraw here.
    this.props.onBackgroundChange(
      ConfigService.getReaderConfig("readerBackgroundImage") || ""
    );
  };

  importImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!SUPPORTED_TYPES.includes(file.type)) {
      toast.error(this.props.t("Unsupported background image"));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(this.props.t("Background image is too large"));
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (!dataUrl) return;
      const id = Date.now().toString();
      const { extension } = BackgroundUtil.convertDataUrl(dataUrl);
      try {
        const colors = await BackgroundUtil.analyzeImageColors(dataUrl);
        await BackgroundUtil.saveImage(id, dataUrl);
        BackgroundUtil.saveImageMeta(id, {
          name: file.name,
          extension,
          ...colors,
        });
        BackgroundUtil.addImageId(id);
        ConfigService.setReaderConfig("readerBackgroundImage", id);
        this.props.onBackgroundChange(id);
        this.setState({ imageName: file.name });
        await StyleUtil.applyReaderBackground();
        toast.success(this.props.t("Import successful"));
      } catch (error) {
        console.error(error);
        toast.error(this.props.t("Import failed"));
      }
    };
    reader.readAsDataURL(file);
  };

  clearBackground = async () => {
    ConfigService.setReaderConfig("readerBackgroundImage", "");
    this.props.onBackgroundChange("");
    this.setState({ imageName: "" });
    await StyleUtil.applyReaderBackground();
  };

  render() {
    const { isMimicEnabled } = this.props;
    return (
      <section className="reader-background-control">
        <div className="reader-background-control-heading">
          <div>
            <span><Trans>Reader background</Trans></span>
            <small>{this.state.imageName || <Trans>No background images added yet</Trans>}</small>
          </div>
          <button onClick={() => this.fileInputRef.current?.click()}>
            <Trans>Import local image</Trans>
          </button>
        </div>
        <input
          ref={this.fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={this.importImage}
          style={{ display: "none" }}
        />
        {this.state.imageName && (
          <button className="reader-background-clear" onClick={this.clearBackground}>
            <Trans>Clear book background</Trans>
          </button>
        )}
        <label className="reader-background-slider">
          <span><Trans>Background image opacity</Trans><b>{this.state.opacity}%</b></span>
          <input
            type="range"
            min="0"
            max="100"
            value={this.state.opacity}
            onChange={(event) => this.applyOpacity(Number(event.target.value))}
          />
        </label>
        <div className="reader-background-mimic">
          <span><Trans>Book spine effect</Trans></span>
          <span
            className="single-control-switch"
            onClick={() => this.props.onMimicChange(!isMimicEnabled)}
            style={isMimicEnabled ? {} : { opacity: 0.6 }}
          >
            <span
              className="single-control-button"
              style={{
                transform: isMimicEnabled ? "translateX(20px)" : "translateX(0)",
                transition: "transform .25s ease",
              }}
            />
          </span>
        </div>
        {isMimicEnabled && (
          <label className="reader-background-slider">
            <span><Trans>Book spine strength</Trans><b>{this.state.spineStrength}%</b></span>
            <input
              type="range"
              min="0"
              max="100"
              value={this.state.spineStrength}
              onChange={(event) => this.applySpineStrength(Number(event.target.value))}
            />
          </label>
        )}
      </section>
    );
  }
}

export default ReaderBackgroundControl;
