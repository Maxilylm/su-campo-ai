import { describe, expect, it } from "vitest";
import { parsePagination, splitPage } from "./pagination";

describe("pagination", () => {
  it("normalizes page size and offset safely", () => {
    expect(parsePagination(new URLSearchParams("limit=20&offset=40"))).toEqual({ limit: 20, offset: 40 });
    expect(parsePagination(new URLSearchParams("limit=999&offset=-4"))).toEqual({ limit: 200, offset: 0 });
    expect(parsePagination(new URLSearchParams("limit=nope&offset=nope"))).toEqual({ limit: 50, offset: 0 });
  });

  it("detects when another page is available", () => {
    expect(splitPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(splitPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});
