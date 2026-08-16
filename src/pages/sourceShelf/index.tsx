import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { handleMode } from "../../store/actions/sidebar";
import SourceShelf from "./component";

export default connect(null, { handleMode })(
  withTranslation()(withRouter(SourceShelf as any) as any) as any
) as any;
