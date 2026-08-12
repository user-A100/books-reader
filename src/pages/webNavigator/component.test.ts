import { getFallbackFaviconUrl, resolveNavigationInput } from "./navigationInput";

describe("resolveNavigationInput", () => {
  it("normalizes domains and preserves secure URLs", () => {
    expect(resolveNavigationInput("example.com")).toBe("https://example.com/");
    expect(resolveNavigationInput("https://example.com/path")).toBe(
      "https://example.com/path"
    );
  });

  it("turns plain text into a search and rejects insecure protocols", () => {
    expect(resolveNavigationInput("一本好书")).toContain(
      "https://duckduckgo.com/?q="
    );
    expect(resolveNavigationInput("http://example.com")).toBeNull();
    expect(resolveNavigationInput("file:///tmp/book.epub")).toBeNull();
  });

  it("uses the conventional favicon path for secure websites", () => {
    expect(getFallbackFaviconUrl("https://example.com/reading/list")).toBe(
      "https://example.com/favicon.ico"
    );
    expect(getFallbackFaviconUrl("http://example.com")).toBeNull();
  });
});
