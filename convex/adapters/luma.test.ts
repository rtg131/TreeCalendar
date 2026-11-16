import { describe, expect, test } from "vitest";
import calendarExpected from "../../fixtures/luma/genai-collective.expected.json";
import calendarHtml from "../../fixtures/luma/genai-collective.html?raw";
import sfExpected from "../../fixtures/luma/sf.expected.json";
import sfHtml from "../../fixtures/luma/sf.html?raw";
import { lumaAdapter, parseLumaPage } from "./luma";

describe("luma adapter", () => {
  test("parses a saved city page and a saved calendar page", () => {
    expect(parseLumaPage(sfHtml)).toEqual(sfExpected);
    expect(parseLumaPage(calendarHtml)).toEqual(calendarExpected);
  });

  test("keeps coordinates and converts times to the event timezone", () => {
    const [first] = parseLumaPage(sfHtml);
    expect(first.location.lat).toBeTypeOf("number");
    expect(first.startsAt).toMatch(/-0[78]:00$/);
    expect(Date.parse(first.startsAt)).toBeGreaterThan(0);
  });

  test("returns nothing for a page without structured data", () => {
    expect(parseLumaPage("<html><body>nothing here</body></html>")).toEqual([]);
  });

  test("fetch reads the feed URL", async () => {
    const requested: string[] = [];
    const http = { text: async (url: string) => (requested.push(url), sfHtml) };
    expect(await lumaAdapter.fetch({ source: "luma", name: "Luma SF", url: "https://luma.com/sf" }, http)).toEqual(sfExpected);
    expect(requested).toEqual(["https://luma.com/sf"]);
  });
});
