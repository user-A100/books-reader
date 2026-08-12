import DOMPurify from "dompurify";
import { load, Cheerio } from "cheerio/slim";
import {
  BookSource,
  SourceBookDetail,
  SourceBookSummary,
  SourceChapter,
  SourceChapterContent,
} from "../../models/BookSource";

const FIELD_SUFFIX = /@(text|html|[A-Za-z_:][\w:.-]*)$/;

export const renderSourceTemplate = (
  template: string,
  values: Record<string, string>
): string =>
  template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      throw new Error(`Unknown template variable: ${key}`);
    }
    return encodeURIComponent(values[key]);
  });

export const resolveSourceUrl = (value: string, baseUrl: string): string => {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1")
    return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
};

export const isSourceUrlAllowed = (source: BookSource, value: string): boolean => {
  try {
    const url = new URL(value);
    const base = new URL(source.baseUrl);
    const allowedHosts = new Set([
      base.hostname.toLowerCase(),
      ...(source.allowedHosts || []).map((host) => host.toLowerCase()),
    ]);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !isPrivateHostname(url.hostname) &&
      allowedHosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
};

const resolveAllowedUrl = (
  source: BookSource,
  value: string,
  baseUrl: string
): string => {
  const resolved = resolveSourceUrl(value, baseUrl);
  return resolved && isSourceUrlAllowed(source, resolved) ? resolved : "";
};

const parseFieldRule = (rule: string): { selector: string; output: string } => {
  const match = rule.match(FIELD_SUFFIX);
  if (!match) return { selector: rule.trim(), output: "text" };
  return {
    selector: rule.slice(0, match.index).trim(),
    output: match[1],
  };
};

export const extractSourceField = (
  root: Cheerio<any>,
  rule?: string
): string => {
  if (!rule) return "";
  const { selector, output } = parseFieldRule(rule);
  const element = selector ? root.find(selector).first() : root.first();
  if (!element.length) return "";
  if (output === "html") return (element.html() || "").trim();
  if (output === "text") return element.text().trim();
  return (element.attr(output) || "").trim();
};

export const parseSearchResults = (
  source: BookSource,
  html: string,
  responseUrl: string
): SourceBookSummary[] => {
  const $ = load(html);
  return $(source.search.list)
    .toArray()
    .map((item) => ({
      title: extractSourceField($(item), source.search.fields.title),
      author: extractSourceField($(item), source.search.fields.author),
      coverUrl: resolveAllowedUrl(
        source,
        extractSourceField($(item), source.search.fields.cover),
        responseUrl
      ),
      detailUrl: resolveAllowedUrl(
        source,
        extractSourceField($(item), source.search.fields.detailUrl),
        responseUrl
      ),
    }))
    .filter((book) => !!book.title && !!book.detailUrl);
};

export const parseBookDetail = (
  source: BookSource,
  html: string,
  responseUrl: string,
  summary: SourceBookSummary
): SourceBookDetail => {
  const $ = load(html);
  const root = $.root();
  const fields = source.detail.fields;
  return {
    title: extractSourceField(root, fields.title) || summary.title,
    author: extractSourceField(root, fields.author) || summary.author,
    coverUrl:
      resolveAllowedUrl(
        source,
        extractSourceField(root, fields.cover),
        responseUrl
      ) ||
      summary.coverUrl,
    detailUrl: summary.detailUrl,
    description: extractSourceField(root, fields.description),
    tocUrl: resolveAllowedUrl(
      source,
      extractSourceField(root, fields.tocUrl),
      responseUrl
    ),
  };
};

export const parseChapterList = (
  source: BookSource,
  html: string,
  responseUrl: string
): SourceChapter[] => {
  const $ = load(html);
  return $(source.toc.list)
    .toArray()
    .map((item) => ({
      title: extractSourceField($(item), source.toc.fields.title),
      url: resolveAllowedUrl(
        source,
        extractSourceField($(item), source.toc.fields.url),
        responseUrl
      ),
    }))
    .filter((chapter) => !!chapter.title && !!chapter.url);
};

export const parseChapterContent = (
  source: BookSource,
  html: string,
  responseUrl: string,
  chapter: SourceChapter
): SourceChapterContent => {
  const $ = load(html);
  const body = $(source.content.body).first().clone();
  if (!body.length) throw new Error("The content selector did not match any element");
  (source.content.remove || []).forEach((selector) => {
    body.find(selector).remove();
  });
  body.find("[src]").each((_, element) => {
    const node = $(element);
    const value = node.attr("src") || "";
    const safeUrl = resolveAllowedUrl(source, value, responseUrl);
    if (safeUrl) node.attr("src", safeUrl);
    else node.removeAttr("src");
  });
  body.find("a[href]").each((_, element) => {
    const node = $(element);
    const value = node.attr("href") || "";
    const safeUrl = resolveAllowedUrl(source, value, responseUrl);
    if (safeUrl) node.attr("href", safeUrl);
    else node.removeAttr("href");
  });
  const cleanHtml = DOMPurify.sanitize(body.html() || "", {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset"],
  });
  const cleanDoc = load(cleanHtml);
  return {
    title: chapter.title,
    url: resolveSourceUrl(chapter.url, responseUrl),
    html: cleanHtml,
    text: cleanDoc.root().text().trim(),
  };
};

const fetchHtml = async (
  source: BookSource,
  url: string,
  headers: Record<string, string> = {}
): Promise<{ html: string; url: string }> => {
  if (!isSourceUrlAllowed(source, url)) {
    throw new Error("The request URL is outside this source's allowed hosts");
  }
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 5 * 1024 * 1024) {
      throw new Error("The source response is larger than 5 MB");
    }
    const html = await response.text();
    if (html.length > 5 * 1024 * 1024) {
      throw new Error("The source response is larger than 5 MB");
    }
    const responseUrl = response.url || url;
    if (!isSourceUrlAllowed(source, responseUrl)) {
      throw new Error("The source redirected outside its allowed hosts");
    }
    return { html, url: responseUrl };
  } finally {
    window.clearTimeout(timeout);
  }
};

export const searchBookSource = async (
  source: BookSource,
  keyword: string
): Promise<SourceBookSummary[]> => {
  const requestUrl = resolveSourceUrl(
    renderSourceTemplate(source.search.request.url, { keyword }),
    source.baseUrl
  );
  const response = await fetchHtml(
    source,
    requestUrl,
    source.search.request.headers
  );
  return parseSearchResults(source, response.html, response.url);
};

export const fetchBookSourceDetail = async (
  source: BookSource,
  summary: SourceBookSummary
): Promise<SourceBookDetail> => {
  const response = await fetchHtml(source, summary.detailUrl);
  return parseBookDetail(source, response.html, response.url, summary);
};

export const fetchBookSourceChapters = async (
  source: BookSource,
  detail: SourceBookDetail
): Promise<SourceChapter[]> => {
  const response = await fetchHtml(source, detail.tocUrl);
  return parseChapterList(source, response.html, response.url);
};

export const fetchBookSourceContent = async (
  source: BookSource,
  chapter: SourceChapter
): Promise<SourceChapterContent> => {
  const response = await fetchHtml(source, chapter.url);
  return parseChapterContent(source, response.html, response.url, chapter);
};
