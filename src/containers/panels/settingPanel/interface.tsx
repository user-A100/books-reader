import BookModel from "../../../models/Book";
export interface SettingPanelProps {
  currentBook: BookModel;
  backgroundColor: string;
  isSettingLocked: boolean;
  isHideBackground: boolean;
  readerMode: string;
  t: (title: string) => string;
  handleSettingLock: (isSettingLocked: boolean) => void;
  handleHideBackground: (isHideBackground: boolean) => void;
  handleReaderBackgroundImage: (readerBackgroundImage: string) => void;
  renderBookFunc: () => void;
}
export interface SettingPanelState {
  isShowMenu: boolean;
  isSettingLocked: boolean;
}
