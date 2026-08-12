export interface BackgroundProps {
  readerMode: string;
  scale: string;
  margin: string;
  isNavLocked: boolean;
  isSettingLocked: boolean;
  backgroundColor: string;
  readerBackgroundImage?: string;
  isHideBackground: boolean;
}
export interface BackgroundState {
  isSingle: boolean;
  pageOffset: string;
  pageWidth: string;
  readerBackgroundUrl: string;
}
