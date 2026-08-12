import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import { stateType } from "../../store";
import WebNavigator from "./component";

const mapStateToProps = (state: stateType) => ({
  importBookFunc: state.book.importBookFunc,
});

export default connect(mapStateToProps)(
  withTranslation()(WebNavigator as any) as any
) as any;
