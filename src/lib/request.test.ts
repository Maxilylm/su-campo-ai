import { describe, expect, it } from "vitest";
import { parseJsonBody } from "./request";

describe("parseJsonBody", () => {
  it("parses a JSON object", async () => {
    const result = await parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ name: "Campo" }),
      headers: { "content-type": "application/json" },
    }));

    expect("data" in result ? result.data : null).toEqual({ name: "Campo" });
  });

  it("rejects a body over the configured limit", async () => {
    const result = await parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ description: "x".repeat(20) }),
      headers: { "content-type": "application/json" },
    }), 32);

    expect("error" in result ? result.error.status : null).toBe(413);
  });

  it("rejects malformed JSON and non-object JSON", async () => {
    const invalid = await parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: "not-json",
    }));
    const array = await parseJsonBody(new Request("http://localhost", {
      method: "POST",
      body: "[]",
    }));

    expect("error" in invalid ? invalid.error.status : null).toBe(400);
    expect("error" in array ? array.error.status : null).toBe(400);
  });
});
