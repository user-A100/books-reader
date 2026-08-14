const path = require("path");
const JSZip = require("jszip");

const TEXT_CHAPTER_EXTENSIONS = new Set([".md", ".txt"]);
const CHAPTER_CONTAINER_NAMES = new Set([
  "chapters",
  "chapter",
  "content",
  "contents",
  "text",
  "正文",
  "章节",
]);
const AUXILIARY_TEXT_FILES = new Set([
  "readme.md",
  "readme.txt",
  "index.md",
  "index.txt",
]);

const normalizeRelativePath = (value = "") =>
  String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

const parentPath = (value) => {
  const normalized = normalizeRelativePath(value);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
};

const naturalCompare = (left, right) => {
  const result = String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return result || String(left).localeCompare(String(right));
};

const isTextChapter = (entry) =>
  entry.type === "file" &&
  TEXT_CHAPTER_EXTENSIONS.has(path.extname(entry.name).toLowerCase());

const isSequenceChapter = (entry) =>
  isTextChapter(entry) && !AUXILIARY_TEXT_FILES.has(entry.name.toLowerCase());

const analyzeFolderBooks = (entries) => {
  const folders = entries.filter((entry) => entry.type === "folder");
  const directFiles = new Map();
  const directFolders = new Map();

  for (const entry of entries) {
    const parent = parentPath(entry.path);
    const target = entry.type === "folder" ? directFolders : directFiles;
    target.set(parent, [...(target.get(parent) || []), entry]);
  }

  const leafCandidates = new Map();
  for (const folder of folders) {
    const children = directFolders.get(folder.path) || [];
    const files = (directFiles.get(folder.path) || []).filter(isSequenceChapter);
    if (children.length === 0 && files.length >= 2) {
      leafCandidates.set(folder.path, files);
    }
  }

  const promotedChildren = new Set();
  const books = [];
  for (const folder of folders) {
    const children = directFolders.get(folder.path) || [];
    if (children.length !== 1) continue;
    const child = children[0];
    const chapterFiles = leafCandidates.get(child.path);
    if (!chapterFiles) continue;
    const directTextFiles = (directFiles.get(folder.path) || []).filter(isTextChapter);
    const hasOnlyAuxiliaryFiles = directTextFiles.every((entry) =>
      AUXILIARY_TEXT_FILES.has(entry.name.toLowerCase())
    );
    const isNamedChapterContainer = CHAPTER_CONTAINER_NAMES.has(
      child.name.toLowerCase()
    );
    if (!isNamedChapterContainer && !hasOnlyAuxiliaryFiles) continue;
    promotedChildren.add(child.path);
    books.push({
      path: folder.path,
      title: folder.name,
      mode: "text-sequence",
      chapterCount: chapterFiles.length,
    });
  }

  for (const folder of folders) {
    const chapterFiles = leafCandidates.get(folder.path);
    if (!chapterFiles || promotedChildren.has(folder.path)) continue;
    books.push({
      path: folder.path,
      title: folder.name,
      mode: "text-sequence",
      chapterCount: chapterFiles.length,
    });
  }

  return books.sort((left, right) => naturalCompare(left.path, right.path));
};

const firstMarkdownHeading = (content) => {
  const match = String(content).match(/^\s{0,3}#\s+(.+?)\s*#*\s*$/m);
  return match ? match[1].trim() : "";
};

const stripFirstMarkdownHeading = (content) =>
  String(content).replace(/^\s{0,3}#\s+.+?\s*#*\s*(?:\r?\n|$)/m, "");

const chapterTitle = (filePath, content) =>
  firstMarkdownHeading(content) || path.basename(filePath, path.extname(filePath));

const composeFolderBookMarkdown = (title, chapters) => {
  const sorted = [...chapters].sort((left, right) =>
    naturalCompare(normalizeRelativePath(left.path), normalizeRelativePath(right.path))
  );
  const parts = [`# ${title.trim()}\n`];
  let previousSection = "";

  for (const chapter of sorted) {
    const relative = normalizeRelativePath(chapter.path);
    const section = parentPath(relative);
    if (section && section !== previousSection) {
      parts.push(`## ${section.split("/").join(" · ")}\n`);
      previousSection = section;
    }
    const content = String(chapter.content || "").replace(/^\uFEFF/, "");
    const heading = chapterTitle(relative, content);
    const body = path.extname(relative).toLowerCase() === ".md"
      ? stripFirstMarkdownHeading(content).trim()
      : content.trim();
    parts.push(`### ${heading}\n\n${body}\n`);
  }

  return `${parts.join("\n").trim()}\n`;
};

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const textToSafeXhtml = (content) => {
  const lines = String(content || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(escapeXml).join("<br/>")}</p>`);
    paragraph = [];
  };
  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = Math.min(6, heading[1].length + 1);
      html.push(`<h${level}>${escapeXml(heading[2])}</h${level}>`);
    } else if (!line.trim()) {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return html.join("\n");
};

const buildFolderBookEpub = async (title, chapters, identifier) => {
  const sorted = [...chapters].sort((left, right) =>
    naturalCompare(normalizeRelativePath(left.path), normalizeRelativePath(right.path))
  );
  const items = sorted.map((chapter, index) => {
    const relative = normalizeRelativePath(chapter.path);
    const content = String(chapter.content || "");
    return {
      id: `chapter-${index + 1}`,
      href: `chapter-${String(index + 1).padStart(4, "0")}.xhtml`,
      label: chapterTitle(relative, content),
      section: parentPath(relative),
      body: textToSafeXhtml(stripFirstMarkdownHeading(content)),
    };
  });
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
      "</rootfiles></container>"
  );

  const navGroups = [];
  for (const item of items) {
    let group = navGroups[navGroups.length - 1];
    if (!group || group.section !== item.section) {
      group = { section: item.section, items: [] };
      navGroups.push(group);
    }
    group.items.push(item);
  }
  const navList = navGroups
    .map((group) => {
      const links = group.items
        .map((item) => `<li><a href="${item.href}">${escapeXml(item.label)}</a></li>`)
        .join("");
      return group.section
        ? `<li><span>${escapeXml(group.section.split("/").join(" · "))}</span><ol>${links}</ol></li>`
        : links;
    })
    .join("");
  zip.file(
    "OEBPS/nav.xhtml",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
      `<head><title>${escapeXml(title)}</title></head><body>` +
      `<nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1><ol>${navList}</ol></nav>` +
      "</body></html>"
  );

  const ncxPoints = items
    .map(
      (item, index) =>
        `<navPoint id="navPoint-${index + 1}" playOrder="${index + 1}">` +
        `<navLabel><text>${escapeXml(item.label)}</text></navLabel>` +
        `<content src="${item.href}"/></navPoint>`
    )
    .join("");
  zip.file(
    "OEBPS/toc.ncx",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
      `<head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head>` +
      `<docTitle><text>${escapeXml(title)}</text></docTitle><navMap>${ncxPoints}</navMap></ncx>`
  );

  for (const item of items) {
    zip.file(
      `OEBPS/${item.href}`,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<html xmlns="http://www.w3.org/1999/xhtml"><head>' +
        `<title>${escapeXml(item.label)}</title>` +
        '<style>body{font-family:serif;line-height:1.7;margin:5%;}p{white-space:normal;}h1,h2{line-height:1.3;}</style>' +
        `</head><body><h1>${escapeXml(item.label)}</h1>${item.body}</body></html>`
    );
  }

  const manifest = items
    .map(
      (item) => `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`
    )
    .join("");
  const spine = items.map((item) => `<itemref idref="${item.id}"/>`).join("");
  zip.file(
    "OEBPS/content.opf",
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">' +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>` +
      `<dc:title>${escapeXml(title)}</dc:title><dc:language>zh-CN</dc:language></metadata>` +
      `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` +
      `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest}</manifest>` +
      `<spine toc="ncx">${spine}</spine></package>`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
};

module.exports = {
  TEXT_CHAPTER_EXTENSIONS,
  analyzeFolderBooks,
  buildFolderBookEpub,
  composeFolderBookMarkdown,
  naturalCompare,
  normalizeRelativePath,
};
