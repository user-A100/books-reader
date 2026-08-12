import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../store";
import { handleOPDSDialog } from "../../store/actions";
import OnlineLibrary from "./component";

const mapStateToProps = (state: stateType) => ({
  importBookFunc: state.book.importBookFunc,
});

export default connect(mapStateToProps, { handleOPDSDialog })(
  withTranslation()(withRouter(OnlineLibrary as any) as any) as any
) as any;
