import {
  applySymbolColoring,
  getDefaultSymbolColorRules,
  parseSymbolColorRules,
} from "./symbolColorUtil";

describe("symbolColorUtil", () => {
  it("colors text between symbols even when inline markup splits it", () => {
    const doc = document.implementation.createHTMLDocument("book");
    doc.body.innerHTML = "<p>他说：\u201c浅<span>松</span>绿色\u201d。</p>";

    applySymbolColoring(doc, getDefaultSymbolColorRules());

    const colored = Array.from(
      doc.querySelectorAll("span[data-koodo-symbol-color]")
    ).map((item) => item.textContent);
    expect(colored).toEqual(["浅", "松", "绿色"]);
  });

  it("does not color unmatched symbols and can be applied repeatedly", () => {
    const doc = document.implementation.createHTMLDocument("book");
    doc.body.innerHTML = "<p>“没有结束，也有《完整标题》</p>";
    const rules = getDefaultSymbolColorRules();

    applySymbolColoring(doc, rules);
    applySymbolColoring(doc, rules);

    expect(doc.querySelectorAll("span[data-koodo-symbol-color]")).toHaveLength(1);
    expect(doc.querySelector("span[data-koodo-symbol-color]")?.textContent).toBe(
      "完整标题"
    );
  });

  it("falls back to default rules when saved data is invalid", () => {
    expect(parseSymbolColorRules("not-json")).toHaveLength(3);
    expect(parseSymbolColorRules("[]")).toEqual([]);
  });
});
