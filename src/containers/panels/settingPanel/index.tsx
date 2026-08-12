import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import SettingPanel from "./component";
import { stateType } from "../../../store";
import {
  handleHideBackground,
  handleReaderBackgroundImage,
  handleSettingLock,
} from "../../../store/actions";
const mapStateToProps = (state: stateType) => {
  return {
    currentBook: state.book.currentBook,
    readerMode: state.reader.readerMode,
    backgroundColor: state.reader.backgroundColor,
    isSettingLocked: state.reader.isSettingLocked,
    isHideBackground: state.reader.isHideBackground,
    renderBookFunc: state.book.renderBookFunc,
  };
};
const actionCreator = {
  handleSettingLock,
  handleHideBackground,
  handleReaderBackgroundImage,
};
export default connect(
  mapStateToProps,
  actionCreator
)(withTranslation()(SettingPanel as any) as any);
