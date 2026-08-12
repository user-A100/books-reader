import { parseWeReadLegacySource } from "./weReadLegacy";

describe("parseWeReadLegacySource", () => {
  test("recognizes a Legado source pack containing WeRead", () => {
    const result = parseWeReadLegacySource(
      JSON.stringify([
        {
          bookSourceName: "微信读书二合一本地源（同人）",
          bookSourceUrl: "https://i.weread.qq.com",
          enabled: true,
          ruleSearch: { bookList: "$.books[*]" },
          jsLib: "should not be copied",
        },
      ])
    );
    expect(result).toEqual({
      id: "weread",
      name: "微信读书二合一本地源（同人）",
      baseUrl: "https://i.weread.qq.com",
      description: "已导入微信读书书源规则。Koodo 不执行原书源脚本，也不解密受保护章节。",
      enabled: true,
      vid: "",
      accessToken: "",
      userAgent: "",
    });
  });

  test("does not treat unrelated legacy sources as WeRead", () => {
    expect(
      parseWeReadLegacySource(
        JSON.stringify({ bookSourceUrl: "https://example.com", ruleSearch: {} })
      )
    ).toBeNull();
  });
});
