import BookList from "../containers/lists/bookList";
import DeletedBookList from "../containers/lists/deletedBookList";
import NoteList from "../containers/lists/noteList";
import EmptyPage from "../containers/emptyPage";
import BookSources from "../pages/bookSources";
import WebNavigator from "../pages/webNavigator";
import OnlineLibrary from "../pages/onlineLibrary";
import WeRead from "../pages/weRead";

export const routes = [
  { path: "/manager/empty", component: EmptyPage },
  { path: "/manager/note", component: NoteList },
  { path: "/manager/highlight", component: NoteList },
  { path: "/manager/home", component: BookList },
  { path: "/manager/shelf", component: BookList },
  { path: "/manager/favorite", component: BookList },
  { path: "/manager/trash", component: DeletedBookList },
  { path: "/manager/sources", component: BookSources },
  { path: "/manager/library", component: OnlineLibrary },
  { path: "/manager/weread", component: WeRead },
  { path: "/manager/web", component: WebNavigator },
];
