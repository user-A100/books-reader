import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import Plugins from "./component";

export default withTranslation()(withRouter(Plugins as any) as any) as any;
