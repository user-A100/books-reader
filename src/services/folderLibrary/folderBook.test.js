const {
  analyzeFolderBooks,
  buildFolderBookEpub,
  composeFolderBookMarkdown,
} = require("./folderBook");

const folder = (name, itemPath) => ({ name, path: itemPath, type: "folder" });
const file = (name, itemPath) => ({ name, path: itemPath, type: "file" });

describe("folder books", () => {
  test("treats a leaf text sequence as one book", () => {
    expect(
      analyzeFolderBooks([
        folder("Novel", "Novel"),
        file("chapter-001.md", "Novel/chapter-001.md"),
        file("chapter-002.md", "Novel/chapter-002.md"),
      ])
    ).toEqual([
      { path: "Novel", title: "Novel", mode: "text-sequence", chapterCount: 2 },
    ]);
  });

  test("promotes a named chapters directory to its parent book", () => {
    expect(
      analyzeFolderBooks([
        folder("Novel", "Novel"),
        folder("chapters", "Novel/chapters"),
        file("README.md", "Novel/README.md"),
        file("chapter-001.md", "Novel/chapters/chapter-001.md"),
        file("chapter-002.md", "Novel/chapters/chapter-002.md"),
      ])
    ).toEqual([
      { path: "Novel", title: "Novel", mode: "text-sequence", chapterCount: 2 },
    ]);
  });

  test("does not merge ebook files or a general container", () => {
    expect(
      analyzeFolderBooks([
        folder("Library", "Library"),
        file("one.epub", "Library/one.epub"),
        file("two.epub", "Library/two.epub"),
        folder("One", "Library/One"),
        folder("Two", "Library/Two"),
      ])
    ).toEqual([]);
  });

  test("composes naturally ordered chapters and a table-of-contents hierarchy", () => {
    const markdown = composeFolderBookMarkdown("Novel", [
      { path: "chapters/chapter-10.md", content: "# Tenth\nB" },
      { path: "chapters/chapter-2.md", content: "# Second\nA" },
    ]);
    expect(markdown.indexOf("### Second")).toBeLessThan(markdown.indexOf("### Tenth"));
    expect(markdown).toContain("## chapters");
    expect(markdown.match(/# Second/g)).toHaveLength(1);
  });

  test("builds one EPUB spine item and TOC link per source chapter", async () => {
    const buffer = await buildFolderBookEpub(
      "Novel",
      [
        { path: "chapters/chapter-10.md", content: "# Tenth\nB" },
        { path: "chapters/chapter-2.md", content: "# Second\nA" },
      ],
      "folder-book-test"
    );
    const JSZip = require("jszip");
    const epub = await JSZip.loadAsync(buffer);
    const opf = await epub.file("OEBPS/content.opf").async("string");
    const nav = await epub.file("OEBPS/nav.xhtml").async("string");
    expect((opf.match(/<itemref /g) || []).length).toBe(2);
    expect(nav.indexOf("Second")).toBeLessThan(nav.indexOf("Tenth"));
    expect(epub.file("OEBPS/chapter-0001.xhtml")).not.toBeNull();
    expect(epub.file("OEBPS/chapter-0002.xhtml")).not.toBeNull();
  });
});
