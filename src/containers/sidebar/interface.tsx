import { RouteComponentProps } from "react-router";
import Book from "../../models/Book";

export interface SidebarProps extends RouteComponentProps<any> {
  mode: string;
  isCollapsed: boolean;
  shelfTitle: string;
  isAuthed: boolean;
  isOpenSortShelfDialog: boolean;
  books: Book[];
  importBookFunc: (file: any) => Promise<void>;
  handleMode: (mode: string) => void;
  handleSortShelfDialog: (isOpenSortShelfDialog: boolean) => void;
  handleSearch: (isSearch: boolean) => void;
  handleCollapse: (isCollapsed: boolean) => void;
  handleSortDisplay: (isSortDisplay: boolean) => void;
  handleSelectBook: (isSelectBook: boolean) => void;
  handleShelf: (shelfTitle: string) => void;
  handleFetchBooks: () => void;
  t: (title: string) => string;
}

export interface SidebarState {
  mode: string;
  hoverMode: string;
  hoverShelfTitle: string;
  isCollapsed: boolean;
  isCollpaseShelf: boolean;
  shelfTitle: string;
  newShelfName: string;
  isOpenDelete: boolean;
  isCreateShelf: boolean;
  dropTargetShelf: string;
}
