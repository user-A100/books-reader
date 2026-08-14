import BookModel from "../../../models/Book";

export interface SettingSearchProps {
  currentBook: BookModel;
  t: (title: string) => string;
}

export interface SettingSearchState {
  query: string;
  results: { key: string; title: string; category: string; isPDF: boolean }[];
  activeIndex: number;
  isFocused: boolean;
}
