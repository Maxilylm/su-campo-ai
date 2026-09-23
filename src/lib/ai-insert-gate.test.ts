import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildInsertGateState, evaluateInsertGate, gateAutoInsert, humanizeOperations, INSERT_GATE_QUESTIONS } from "./ai-insert-gate";
import type { JevAnswers } from "./jev";
import type { AIOperation } from "./ai-operation";

// Recorded from live jev-1.13.0 responses against api.typesafe.ai, so the
// thresholds below are pinned to how the model actually scores these four
// shapes rather than to numbers we found convenient.
const PROBE_CLEAR_INSERT: JevAnswers = {
  intencion: { type: "choice", choice: "registrar", confidence: 1.0, probabilities: { registrar: 1.0, consultar: 0, ambiguo: 0 } },
  coincide: { type: "noul", noul: 0.75 },
};
const PROBE_QUESTION_WITH_INVENTED_INSERT: JevAnswers = {
  intencion: { type: "choice", choice: "consultar", confidence: 0.99, probabilities: { registrar: 0.01, consultar: 0.99, ambiguo: 0 } },
  coincide: { type: "noul", noul: 0.05 },
};
const PROBE_GARBLED_AUDIO: JevAnswers = {
  intencion: { type: "choice", choice: "registrar", confidence: 0.53, probabilities: { registrar: 0.53, consultar: 0.1, ambiguo: 0.37 } },
  coincide: { type: "noul", noul: 0.17 },
};
const PROBE_UNSTATED_AMOUNT: JevAnswers = {
  intencion: { type: "choice", choice: "registrar", confidence: 0.8, probabilities: { registrar: 0.8, consultar: 0.15, ambiguo: 0.05 } },
  coincide: { type: "noul", noul: 0.11 },
};

describe("evaluateInsertGate", () => {
  it("lets a clear instruction with matching operations apply without confirmation", () => {
    expect(evaluateInsertGate(PROBE_CLEAR_INSERT)).toEqual({ confirm: false });
  });

  it("holds an insert the model invented while answering a question", () => {
    expect(evaluateInsertGate(PROBE_QUESTION_WITH_INVENTED_INSERT)).toEqual({ confirm: true, reason: "intencion" });
  });

  it("holds an insert derived from a garbled voice note", () => {
    expect(evaluateInsertGate(PROBE_GARBLED_AUDIO)).toEqual({ confirm: true, reason: "intencion" });
  });

  it("holds an insert carrying an amount the message never stated", () => {
    expect(evaluateInsertGate(PROBE_UNSTATED_AMOUNT)).toEqual({ confirm: true, reason: "coincidencia" });
  });

  it("applies without confirmation when Jev is unavailable", () => {
    expect(evaluateInsertGate(null)).toEqual({ confirm: false });
  });

  it("applies without confirmation when an expected answer is missing", () => {
    expect(evaluateInsertGate({ coincide: { type: "noul", noul: 0.9 } })).toEqual({ confirm: false });
  });

  it("applies without confirmation when an answer has the wrong type", () => {
    const wrongType = {
      intencion: { type: "noul", noul: 0.9 },
      coincide: { type: "noul", noul: 0.9 },
    } as unknown as JevAnswers;
    expect(evaluateInsertGate(wrongType)).toEqual({ confirm: false });
  });
});

describe("buildInsertGateState", () => {
  const operations: AIOperation[] = [
    { table: "cattle", action: "insert", data: { category: "terneros", quantity: 5 } },
  ];

  it("includes the message and the proposed operations", () => {
    const state = buildInsertGateState("anotá que nacieron 5 terneros", operations);
    expect(state).toContain("anotá que nacieron 5 terneros");
    expect(state).toContain("cattle");
    expect(state).toContain("terneros");
  });

  it("bounds the message so a long transcript cannot crowd out the operations", () => {
    const state = buildInsertGateState("x".repeat(10_000), operations);
    expect(state.length).toBeLessThan(6_000);
    expect(state).toContain("cattle");
  });
});

describe("humanizeOperations", () => {
  const NORTE = "9d151685-e838-4e8e-919e-00c2c207b524";
  const UNKNOWN = "11111111-1111-4111-8111-111111111111";

  it("names referenced records the way the farmer would and drops ids it cannot name", () => {
    const humanized = humanizeOperations(
      [{ table: "cattle", action: "insert", data: { category: "vaca", count: 20, section_id: NORTE, cattle_id: UNKNOWN } }],
      new Map([[NORTE, "Potrero Norte"]]),
    );
    expect(humanized).toEqual([{ table: "cattle", action: "insert", data: { category: "vaca", count: 20, potrero: "Potrero Norte" } }]);
    expect(buildInsertGateState("registrá 20 vacas en Norte", [{ table: "cattle", action: "insert", data: { section_id: NORTE } }], new Map([[NORTE, "Potrero Norte"]])))
      .not.toContain(NORTE);
  });
});

describe("gateAutoInsert", () => {
  const operations: AIOperation[] = [
    { table: "financial_transactions", action: "insert", data: { type: "egreso", amount: 450000 } },
  ];

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks Jev both gate questions and holds an insert it cannot vouch for", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ model: "jev-1.13.0", answers: PROBE_UNSTATED_AMOUNT }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(gateAutoInsert("pagué la cuenta del veterinario", operations))
      .resolves.toEqual({ confirm: true, reason: "coincidencia" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.questions).toEqual(INSERT_GATE_QUESTIONS);
    expect(body.state).toContain("pagué la cuenta del veterinario");
  });

  it("does not hold the insert when Jev is unreachable", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(gateAutoInsert("anotá 5 terneros", operations)).resolves.toEqual({ confirm: false });
  });

  it("skips the provider entirely when no key is configured", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(gateAutoInsert("anotá 5 terneros", operations)).resolves.toEqual({ confirm: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
