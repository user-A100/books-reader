const mockSearch = jest.fn();

jest.mock("../plugins/pluginHost", () => ({
  pluginHost: {
    startEnabled: async () => [],
    getBookSourceEngine: () => ({ search: mockSearch }),
  },
}));

import { legadoSearchAll } from "./legadoEngineClient";
import { LegadoBookSource } from "./legadoSourceModel";

const source = (name: string): LegadoBookSource => ({
  bookSourceUrl: `https://${name}.example.com`,
  bookSourceName: name,
  ruleSearch: {},
});

describe("legadoSearchAll", () => {
  beforeEach(() => mockSearch.mockReset());

  test("reports results incrementally and isolates a failed source", async () => {
    mockSearch.mockImplementation(async (item: LegadoBookSource) => {
      if (item.bookSourceName === "broken") throw new Error("HTTP 500");
      return [{ name: `${item.bookSourceName} result`, bookUrl: "/book" }];
    });
    const progress: number[] = [];

    const outcome = await legadoSearchAll(
      [source("one"), source("broken"), source("two")],
      "book",
      1,
      (snapshot) => progress.push(snapshot.completedSources)
    );
    expect(outcome.results.map((item) => item.source.bookSourceName)).toEqual([
      "one",
      "two",
    ]);
    expect(outcome.failedSources).toEqual([
      { sourceName: "broken", message: "HTTP 500" },
    ]);
    expect(progress).toEqual([1, 2, 3]);
  });
});
