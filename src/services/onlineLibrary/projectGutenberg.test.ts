import {
  parseProjectGutenbergDownload,
  parseProjectGutenbergSearchFeed,
} from "./projectGutenberg";

const searchFeed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <opensearch:totalResults>31</opensearch:totalResults>
  <link rel="next" href="/ebooks/search.opds/?query=alice&amp;start_index=26" />
  <entry><title>Authors</title><link rel="subsection" href="/ebooks/authors/search.opds/?query=alice" /></entry>
  <entry><title>Alice's Adventures</title><content type="text">Carroll, Lewis</content><dcterms:language>en</dcterms:language><link rel="subsection" href="/ebooks/11.opds" /></entry>
</feed>`;

test("parses only book entries from the Gutenberg search feed", () => {
  expect(
    parseProjectGutenbergSearchFeed(
      searchFeed,
      "https://www.gutenberg.org/ebooks/search.opds/?query=alice"
    )
  ).toEqual({
    books: [
      {
        id: "11",
        title: "Alice's Adventures",
        authors: ["Carroll, Lewis"],
        detailUrl: "https://www.gutenberg.org/ebooks/11.opds",
        language: "en",
      },
    ],
    total: 31,
    nextUrl:
      "https://www.gutenberg.org/ebooks/search.opds/?query=alice&start_index=26",
  });
});

test("prefers an illustrated EPUB3 acquisition", () => {
  const detailFeed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" title="EPUB (no images)" href="/ebooks/11.epub.noimages" length="12" />
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" title="EPUB3" href="/ebooks/11.epub3.images" length="34" />
  </entry></feed>`;
  expect(
    parseProjectGutenbergDownload(
      detailFeed,
      "https://www.gutenberg.org/ebooks/11.opds",
      "Alice: Wonderland"
    )
  ).toEqual({
    url: "https://www.gutenberg.org/ebooks/11.epub3.images",
    fileName: "Alice- Wonderland.epub",
    size: 34,
  });
});
