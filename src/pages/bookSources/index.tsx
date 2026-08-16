import { connect } from "react-redux";
import { withTranslation } from "react-i18next";
import { withRouter } from "react-router-dom";
import { stateType } from "../../store";
import { handleReadingBook } from "../../store/actions/book";
import BookSources from "./component";

const mapStateToProps = (state: stateType) => ({
  importBookFunc: state.book.importBookFunc,
});

export default connect(mapStateToProps, { handleReadingBook })(
  withTranslation()(withRouter(BookSources as any) as any) as any
) as any;
