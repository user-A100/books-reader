import {
  buildLegadoRequestUrl,
  getLegadoCoverUrl,
  normalizeLegadoBaseUrl,
  toLegadoBook,
} from "./legadoClient";

describe("Legado client", () => {
  test("normalizes a server URL", () => {
    expect(normalizeLegadoBaseUrl("http://192.168.1.8:1122///?x=1#x")).toBe(
      "http://192.168.1.8:1122"
    );
  });

  test("builds Android and Reader endpoints", () => {
    const android = {
      id: "a",
      name: "phone",
      baseUrl: "http://192.168.1.8:1122",
      serverType: "android" as const,
      accessToken: "",
    };
    expect(buildLegadoRequestUrl(android, "getBookshelf")).toBe(
      "http://192.168.1.8:1122/getBookshelf"
    );
    expect(
      buildLegadoRequestUrl(
        { ...android, serverType: "reader", accessToken: "user:token" },
        "getChapterList",
        { url: "https://book.test/1" }
      )
    ).toContain("/reader3/getChapterList?");
    expect(getLegadoCoverUrl(android, "/storage/cover.jpg")).toContain(
      "/cover?path=%2Fstorage%2Fcover.jpg"
    );
  });

  test("maps server books defensively", () => {
    expect(
      toLegadoBook({ bookUrl: "book://1", name: "测试", durChapterIndex: "3" })
    ).toMatchObject({ bookUrl: "book://1", name: "测试", durChapterIndex: 3 });
    expect(toLegadoBook({ name: "missing url" })).toBeNull();
  });
});
