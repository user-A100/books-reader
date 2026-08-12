# Book source schema v1

Book sources are declarative JSON recipes. They tell Koodo where to request a
public page and how to extract search results, metadata, chapters, and content
with CSS selectors. A source does not bundle or redistribute books.

## Security boundary

Schema v1 deliberately does not execute JavaScript. It supports GET requests,
HTTP/HTTPS URLs, optional request headers, CSS selectors, and content removal
selectors. Parsed chapter HTML is sanitized before preview or rendering. Media
and links outside the source's allowed hosts are removed, redirects are rejected,
and each HTML response is limited to 5 MB.

The web build can only access servers that allow cross-origin requests. The
desktop Electron build is able to access more sites, but each imported source
should still be treated as untrusted configuration.

## Field syntax

- `.title` or `.title@text`: extract text.
- `.description@html`: extract inner HTML.
- `a@href`: extract an attribute.
- `@text` and `@href`: extract from the current list item.
- Relative links are resolved against the response URL.
- Requests and media are limited to `baseUrl` plus explicitly listed
  `allowedHosts`.
- `{{keyword}}` in the search URL is replaced with the encoded search term.

## Minimal shape

See [`examples/book-source.example.json`](../examples/book-source.example.json).

Required stages are `search`, `detail`, `toc`, and `content`. This keeps every
source testable through the same pipeline:

1. Search returns book summaries and detail URLs.
2. Detail returns metadata and a table-of-contents URL.
3. TOC returns chapter titles and URLs.
4. Content returns sanitized chapter HTML.

Future schema versions may add JSON APIs, POST forms, authentication profiles,
pagination, and a sandboxed script compatibility layer without changing v1.
