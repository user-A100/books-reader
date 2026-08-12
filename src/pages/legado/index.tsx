import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { handleMode } from "../../store/actions/sidebar";
import Legado from "./component";

export default connect(null, { handleMode })(
  withTranslation()(withRouter(Legado as any) as any) as any
) as any;
