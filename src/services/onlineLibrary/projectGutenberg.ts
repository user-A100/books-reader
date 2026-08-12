import {
  OnlineLibraryBook,
  OnlineLibraryDownload,
  OnlineLibrarySearchPage,
} from "../../models/OnlineLibrary";

const ATOM_NS = "http://www.w3.org/2005/Atom";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const OPENSEARCH_NS = "http://a9.com/-/spec/opensearch/1.1/";
const SEARCH_ENDPOINT = "https://www.gutenberg.org/ebooks/search.opds/";
const ACQUISITION_REL = "http://opds-spec.org/acquisition";
const MAX_BOOK_BYTES = 80 * 1024 * 1024;

const getIpcRenderer = () => {
  try {
    return (window as any).require?.("electron")?.ipcRenderer || null;
  } catch {
    return null;
  }
};

const toUint8Array = (value: any): Uint8Array => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error("Invalid library response");
};

const requestBytes = async (url: string): Promise<Uint8Array> => {
  const ipcRenderer = getIpcRenderer();
  if (ipcRenderer) {
    const result = await ipcRenderer.invoke("online-library-request", url);
    if (!result?.ok) {
      throw new Error(result?.error || `HTTP ${result?.status || 500}`);
    }
    return toUint8Array(result.data);
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/atom+xml, application/epub+zip, application/xml",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BOOK_BYTES) {
    throw new Error("Downloaded file is too large");
  }
  return bytes;
};

const requestText = async (url: string) =>
  new TextDecoder("utf-8").decode(await requestBytes(url));

const resolveUrl = (value: string, baseUrl: string) => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
};

const directChildrenByName = (parent: Element, name: string): Element[] =>
  Array.from(parent.children).filter(
    (child) => child.localName === name && child.namespaceURI === ATOM_NS
  );

const childText = (parent: Element, name: string) =>
  directChildrenByName(parent, name)[0]?.textContent?.trim() || "";

const parseXml = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error("Invalid OPDS response");
  }
  return document;
};

export const parseProjectGutenbergSearchFeed = (
  xml: string,
  feedUrl: string
): OnlineLibrarySearchPage => {
  const document = parseXml(xml);
  const feed = document.documentElement;
  const books = directChildrenByName(feed, "entry")
    .map((entry): OnlineLibraryBook | null => {
      const detailLink = directChildrenByName(entry, "link").find((link) => {
        const href = link.getAttribute("href") || "";
        return (
          link.getAttribute("rel") === "subsection" &&
          /\/ebooks\/\d+\.opds(?:$|\?)/.test(href)
        );
      });
      if (!detailLink) return null;
      const detailUrl = resolveUrl(
        detailLink.getAttribute("href") || "",
        feedUrl
      );
      const id = detailUrl.match(/\/ebooks\/(\d+)\.opds/)?.[1] || detailUrl;
      const authors = directChildrenByName(entry, "author")
        .map((author) => childText(author, "name"))
        .filter(Boolean);
      const contentAuthor = childText(entry, "content");
      if (authors.length === 0 && contentAuthor) authors.push(contentAuthor);
      const language =
        entry.getElementsByTagNameNS(DCTERMS_NS, "language")[0]?.textContent?.trim() ||
        "";
      return {
        id,
        title: childText(entry, "title"),
        authors,
        detailUrl,
        language,
      };
    })
    .filter((book): book is OnlineLibraryBook => !!book && !!book.title);

  const nextLink = directChildrenByName(feed, "link").find(
    (link) => link.getAttribute("rel") === "next"
  );
  const totalText =
    document.getElementsByTagNameNS(OPENSEARCH_NS, "totalResults")[0]
      ?.textContent || "0";
  return {
    books,
    total: Number.parseInt(totalText, 10) || books.length,
    nextUrl: nextLink
      ? resolveUrl(nextLink.getAttribute("href") || "", feedUrl)
      : "",
  };
};

const acquisitionRank = (href: string, title: string) => {
  const value = `${href} ${title}`.toLowerCase();
  if (value.includes("epub3.images")) return 100;
  if (value.includes("epub.images")) return 90;
  if (value.includes("epub3")) return 80;
  if (!value.includes("noimages")) return 70;
  return 50;
};

export const parseProjectGutenbergDownload = (
  xml: string,
  feedUrl: string,
  title: string
): OnlineLibraryDownload => {
  const document = parseXml(xml);
  const links = Array.from(document.getElementsByTagNameNS(ATOM_NS, "link"))
    .filter(
      (link) =>
        link.getAttribute("rel") === ACQUISITION_REL &&
        link.getAttribute("type") === "application/epub+zip"
    )
    .map((link) => ({
      url: resolveUrl(link.getAttribute("href") || "", feedUrl),
      title: link.getAttribute("title") || "",
      size: Number.parseInt(link.getAttribute("length") || "0", 10) || 0,
    }))
    .filter((link) => !!link.url)
    .sort(
      (left, right) =>
        acquisitionRank(right.url, right.title) -
        acquisitionRank(left.url, left.title)
    );
  const selected = links[0];
  if (!selected) throw new Error("No EPUB download is available for this book");
  const safeTitle = title.replace(/[\\/:*?\"<>|]/g, "-").trim() || "book";
  return { url: selected.url, fileName: `${safeTitle}.epub`, size: selected.size };
};

export const searchProjectGutenberg = async (
  keyword: string,
  pageUrl = ""
): Promise<OnlineLibrarySearchPage> => {
  const url = pageUrl || `${SEARCH_ENDPOINT}?query=${encodeURIComponent(keyword)}`;
  return parseProjectGutenbergSearchFeed(await requestText(url), url);
};

export const getProjectGutenbergDownload = async (
  book: OnlineLibraryBook
): Promise<OnlineLibraryDownload> =>
  parseProjectGutenbergDownload(
    await requestText(book.detailUrl),
    book.detailUrl,
    book.title
  );

export const downloadProjectGutenbergBook = async (
  download: OnlineLibraryDownload
): Promise<ArrayBuffer> => {
  if (download.size > MAX_BOOK_BYTES) {
    throw new Error("Downloaded file is too large");
  }
  const bytes = await requestBytes(download.url);
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("The downloaded file is not a valid EPUB archive");
  }
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
};
