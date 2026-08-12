export interface OnlineLibraryBook {
  id: string;
  title: string;
  authors: string[];
  detailUrl: string;
  language: string;
}

export interface OnlineLibrarySearchPage {
  books: OnlineLibraryBook[];
  total: number;
  nextUrl: string;
}

export interface OnlineLibraryDownload {
  url: string;
  fileName: string;
  size: number;
}
