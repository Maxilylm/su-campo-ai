import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJev } from "./jev";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const QUESTIONS = {
  coincide: {
    type: "noul" as const,
    instructions: "Las operaciones corresponden al mensaje?",
    criteria: { true: "Corresponden", false: "No corresponden" },
  },
};

describe("askJev", () => {
  // Every failure path logs a warning on purpose; keep it out of test output.
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not call the provider when TYPESAFE_API_KEY is unset", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(askJev("estado", QUESTIONS)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the state and questions to the System One endpoint with bearer auth", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ model: "jev-1.13.0", answers: { coincide: { type: "noul", noul: 0.9 } } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await askJev("nacieron 5 terneros", QUESTIONS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      model: "jev-latest",
      state: "nacieron 5 terneros",
      questions: QUESTIONS,
    });
  });

  it("returns the parsed answers on success", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      model: "jev-1.13.0",
      answers: {
        coincide: { type: "noul", noul: 0.75 },
        intencion: { type: "choice", choice: "registrar", confidence: 0.96, probabilities: { registrar: 0.96 } },
      },
    })));

    await expect(askJev("estado", QUESTIONS)).resolves.toEqual({
      coincide: { type: "noul", noul: 0.75 },
      intencion: { type: "choice", choice: "registrar", confidence: 0.96, probabilities: { registrar: 0.96 } },
    });
  });

  it("returns null when the provider rejects the request", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "unauthorized" }, false, 401)));

    await expect(askJev("estado", QUESTIONS)).resolves.toBeNull();
  });

  it("returns null when the request times out or the network fails", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })));

    await expect(askJev("estado", QUESTIONS)).resolves.toBeNull();
  });

  it("returns null when the body has no answers object", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ model: "jev-1.13.0" })));

    await expect(askJev("estado", QUESTIONS)).resolves.toBeNull();
  });

  it("returns null when the body is not valid JSON", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    } as unknown as Response));

    await expect(askJev("estado", QUESTIONS)).resolves.toBeNull();
  });
});
