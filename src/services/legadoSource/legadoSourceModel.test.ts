import {
  parseLegadoSourcesJson,
  validateLegadoSource,
  isLoginCapableSource,
} from "./legadoSourceModel";

const validSource = {
  bookSourceUrl: "https://www.example.com",
  bookSourceName: "Example Source",
  bookSourceType: 0,
  ruleSearch: { bookList: ".book", name: ".title@text" },
};

describe("validateLegadoSource", () => {
  it("accepts a valid source", () => {
    const source = validateLegadoSource(validSource);
    expect(source).not.toBeNull();
    expect(source!.bookSourceUrl).toBe("https://www.example.com");
  });

  it("rejects missing ruleSearch", () => {
    const { ruleSearch, ...withoutRules } = validSource;
    void ruleSearch;
    expect(validateLegadoSource(withoutRules)).toBeNull();
  });

  it("rejects non-http(s) or malformed urls", () => {
    expect(
      validateLegadoSource({ ...validSource, bookSourceUrl: "ftp://x" })
    ).toBeNull();
    expect(
      validateLegadoSource({ ...validSource, bookSourceUrl: "not a url" })
    ).toBeNull();
    expect(
      validateLegadoSource({ ...validSource, bookSourceUrl: "javascript:alert(1)" })
    ).toBeNull();
  });

  it("rejects missing name or non-object input", () => {
    expect(
      validateLegadoSource({ ...validSource, bookSourceName: " " })
    ).toBeNull();
    expect(validateLegadoSource(null)).toBeNull();
    expect(validateLegadoSource("str")).toBeNull();
  });
});

describe("parseLegadoSourcesJson", () => {
  it("parses both single objects and arrays, dropping invalid entries", () => {
    const array = parseLegadoSourcesJson(
      JSON.stringify([validSource, { bookSourceUrl: "bad" }])
    );
    expect(array).toHaveLength(1);
    const single = parseLegadoSourcesJson(JSON.stringify(validSource));
    expect(single).toHaveLength(1);
  });

  it("returns empty for invalid JSON", () => {
    expect(parseLegadoSourcesJson("not json")).toEqual([]);
  });
});

describe("isLoginCapableSource", () => {
  it("flags sources with a loginUrl (optional login entry)", () => {
    expect(
      isLoginCapableSource({ ...validSource, loginUrl: "/login" } as never)
    ).toBe(true);
    expect(isLoginCapableSource(validSource as never)).toBe(false);
  });
});
