import { describe, expect, it } from "vitest";
import { retryTransientResponse } from "./retry";

const respond = (...statuses: number[]) => {
  let call = 0;
  const request = async () => new Response(null, { status: statuses[Math.min(call++, statuses.length - 1)] });
  return { request, calls: () => call };
};
const noSleep = async () => {};

describe("retryTransientResponse", () => {
  it("retries once on a cold-start 504 and returns the recovered response", async () => {
    const r = respond(504, 200);
    expect((await retryTransientResponse(r.request, { sleep: noSleep })).status).toBe(200);
    expect(r.calls()).toBe(2);
  });

  it("does not retry real errors or successes", async () => {
    for (const status of [200, 401, 404, 500]) {
      const r = respond(status);
      expect((await retryTransientResponse(r.request, { sleep: noSleep })).status).toBe(status);
      expect(r.calls()).toBe(1);
    }
  });

  it("gives up after the configured retries and stops when aborted", async () => {
    const r = respond(503, 503, 503);
    expect((await retryTransientResponse(r.request, { sleep: noSleep })).status).toBe(503);
    expect(r.calls()).toBe(2);
    const controller = new AbortController();
    controller.abort();
    const aborted = respond(503, 200);
    expect((await retryTransientResponse(aborted.request, { sleep: noSleep, signal: controller.signal })).status).toBe(503);
    expect(aborted.calls()).toBe(1);
  });
});
