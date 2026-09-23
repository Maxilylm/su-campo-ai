import { describe, expect, it } from "vitest";
import { escapeHtml, isHexColor, mapLabelHtml, safeHexColor } from "./map-labels";

describe("escapeHtml", () => {
  it("escapes every character that can open markup or an attribute", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;",
    );
  });

  it("renders nullish values as empty text", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("hex colors", () => {
  it("accepts only #rrggbb", () => {
    expect(isHexColor("#22c55e")).toBe(true);
    expect(isHexColor("#22C55E")).toBe(true);
    expect(isHexColor("#fff")).toBe(false);
    expect(isHexColor("green")).toBe(false);
    expect(isHexColor('#22c55e;"><img src=x onerror=alert(1)>')).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });

  it("falls back for legacy or hostile values", () => {
    expect(safeHexColor("red")).toBe("#22c55e");
    expect(safeHexColor('#000";background:url(x)', "#123456")).toBe("#123456");
  });
});

describe("mapLabelHtml", () => {
  it("never emits the raw name, color or detail", () => {
    const html = mapLabelHtml("<b>Potrero</b>", '"><script>x</script>', { detail: "<i>42</i>" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;b&gt;Potrero&lt;/b&gt;");
    expect(html).toContain("background:#22c55e33");
  });

  it("centers labels on their point unless pinned to a top edge", () => {
    expect(mapLabelHtml("P1", "#3b82f6")).toContain("translate(-50%,-50%)");
    expect(mapLabelHtml("P1", "#3b82f6", { anchor: "top" })).toContain("translate(-50%,4px)");
  });

  it("omits the detail line when there is none", () => {
    expect(mapLabelHtml("P1", "#3b82f6")).not.toContain("font-size:10px");
  });
});
