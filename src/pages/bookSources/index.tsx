import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import BookSources from "./component";

export default withTranslation()(withRouter(BookSources as any) as any) as any;
