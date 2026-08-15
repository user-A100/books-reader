import { BookSource } from "../../models/BookSource";
import {
  isSourceUrlAllowed,
  parseBookDetail,
  parseChapterContent,
  parseChapterList,
  parseSearchResults,
  renderSourceTemplate,
  resolveSourceUrl,
} from "./sourceEngine";
import { validateBookSource } from "./sourceValidation";

const source: BookSource = {
  id: "fixture",
  schemaVersion: 1,
  name: "Fixture source",
  baseUrl: "https://books.example/",
  enabled: true,
  search: {
    request: { url: "/search?q={{keyword}}", method: "GET" },
    list: ".book",
    fields: {
      title: ".title@text",
      author: ".author@text",
      cover: "img@src",
      detailUrl: "a@href",
    },
  },
  detail: {
    fields: {
      title: "h1@text",
      author: ".by@text",
      description: ".intro@text",
      tocUrl: ".toc@href",
    },
  },
  toc: {
    list: ".chapters a",
    fields: { title: "@text", url: "@href" },
  },
  content: {
    body: "#content",
    remove: [".ad", "script"],
  },
};

describe("book source engine", () => {
  test("renders encoded request templates", () => {
    expect(renderSourceTemplate("/search?q={{ keyword }}", { keyword: "三 体" }))
      .toBe("/search?q=%E4%B8%89%20%E4%BD%93");
  });

  test("parses the complete search to content flow", () => {
    const results = parseSearchResults(
      source,
      `<article class="book"><a href="/book/1"><img src="/cover.jpg"><b class="title">Book One</b></a><i class="author">Author</i></article>`,
      "https://books.example/search?q=one"
    );
    expect(results).toEqual([
      {
        title: "Book One",
        author: "Author",
        coverUrl: "https://books.example/cover.jpg",
        detailUrl: "https://books.example/book/1",
      },
    ]);

    const detail = parseBookDetail(
      source,
      `<h1>Book One: Revised</h1><span class="by">Author</span><p class="intro">Intro</p><a class="toc" href="chapters.html">Read</a>`,
      results[0].detailUrl,
      results[0]
    );
    expect(detail.tocUrl).toBe("https://books.example/book/chapters.html");
    expect(detail.description).toBe("Intro");

    const chapters = parseChapterList(
      source,
      `<nav class="chapters"><a href="1.html">Chapter 1</a><a href="2.html">Chapter 2</a></nav>`,
      detail.tocUrl
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[0].url).toBe("https://books.example/book/1.html");

    const content = parseChapterContent(
      source,
      `<main id="content"><p>Hello</p><div class="ad">buy now</div><script>alert(1)</script><img src="http://127.0.0.1/secret"><img src="/safe.jpg" style="display:none"><p>World</p></main>`,
      chapters[0].url,
      chapters[0]
    );
    expect(content.text).toContain("Hello");
    expect(content.text).toContain("World");
    expect(content.text).not.toContain("buy now");
    expect(content.html).not.toContain("script");
    expect(content.html).not.toContain("127.0.0.1");
    expect(content.html).not.toContain("style=");
    expect(content.html).toContain("https://books.example/safe.jpg");
  });

  test("rejects unsafe source URLs", () => {
    const result = validateBookSource({ ...source, baseUrl: "javascript:alert(1)" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("baseUrl must use http or https");
  });
});

describe("SSRF guard (isSourceUrlAllowed)", () => {
  // The plugin host's httpFetch reuses this same private-host check; book
  // sources (and thus Legado engines) must never reach internal addresses.
  test("blocks loopback, private, and link-local IPs", () => {
    expect(isSourceUrlAllowed(source, "https://books.example/ok")).toBe(true);
    expect(isSourceUrlAllowed(source, "http://127.0.0.1/admin")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://localhost/admin")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://192.168.1.1/")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://10.0.0.1/")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://172.16.0.1/")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://172.31.255.1/")).toBe(false);
    expect(isSourceUrlAllowed(source, "http://169.254.169.254/latest/meta-data/")).toBe(
      false
    );
  });

  test("blocks non-http schemes", () => {
    expect(isSourceUrlAllowed(source, "file:///etc/passwd")).toBe(false);
    expect(isSourceUrlAllowed(source, "javascript:alert(1)")).toBe(false);
  });

  test("resolveSourceUrl + isSourceUrlAllowed refuse internal hosts", () => {
    // Relative URL resolved against the public base is allowed.
    const safe = resolveSourceUrl("/search?q=k", "https://books.example/");
    expect(safe).toBe("https://books.example/search?q=k");
    expect(isSourceUrlAllowed(source, safe)).toBe(true);
    // An explicit private host resolves fine but the allowlist rejects it,
    // mirroring how the engine guards each fetch it performs.
    const evil = resolveSourceUrl(
      "http://192.168.0.5/secret",
      "https://books.example/"
    );
    expect(isSourceUrlAllowed(source, evil)).toBe(false);
  });
});
