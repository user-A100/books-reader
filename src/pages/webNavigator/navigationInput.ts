export const resolveNavigationInput = (value: string): string | null => {
  const input = value.trim();
  if (!input) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https:/i.test(input)) {
    return null;
  }
  let candidate = input;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate =
      !candidate.includes(" ") && candidate.includes(".")
        ? `https://${candidate}`
        : `https://duckduckgo.com/?q=${encodeURIComponent(candidate)}`;
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

export const getFallbackFaviconUrl = (websiteUrl: string): string | null => {
  try {
    const url = new URL(websiteUrl);
    return url.protocol === "https:"
      ? new URL("/favicon.ico", url).toString()
      : null;
  } catch {
    return null;
  }
};
