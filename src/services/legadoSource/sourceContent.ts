import DOMPurify from "dompurify";

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const renderSourceChapter = (
  value: string,
  chapterTitle = ""
): string => {
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(value);
  const html = looksLikeHtml
    ? value
    : value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter(
          (line, index) =>
            index > 0 ||
            line.replace(/\s+/g, " ") !== chapterTitle.trim().replace(/\s+/g, " ")
        )
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["style", "onerror", "onclick"],
  });
};
