export interface WebBookmark {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  createdAt: number;
}

export interface WebNavigatorState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  faviconUrl?: string;
  error?: string;
}
