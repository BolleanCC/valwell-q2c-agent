import { describe, expect, it } from "vitest";
import { type LlmTask, type ModelTurn, runToolLoop, type ToolExecution } from "./loop.js";
import { callTools, scriptedProvider } from "./scripted.js";

const TASK: LlmTask = { system: "sys", prompt: "task", tools: [] };
const LIMITS = { maxTurns: 3, maxToolCalls: 4, timeoutMs: 50, maxOutputTokens: 100 };
/** "finish" ends the run, "bad" is a terminal error, "nope" an ordinary tool error. */
const execute = (call: { name: string }): ToolExecution =>
  call.name === "finish"
    ? { ok: true, content: {}, summary: "done", final: true }
    : call.name === "bad"
      ? { ok: false, error: "invalid", terminal: true }
      : call.name === "nope"
        ? { ok: false, error: "refused" }
        : { ok: true, content: { x: 1 }, summary: "read" };
const loop = (steps: Parameters<typeof scriptedProvider>[0], limits = LIMITS) =>
  runToolLoop(scriptedProvider(steps).provider, TASK, execute, limits);
const said = (stopReason: string): ModelTurn => ({ stopReason, text: "text", toolCalls: [] });

describe("runToolLoop", () => {
  it("returns tool results to the model and finishes on an accepted final call", async () => {
    const { provider, received } = scriptedProvider([
      callTools(["read", {}], ["nope", {}]),
      callTools(["finish", {}]),
    ]);
    const r = await runToolLoop(provider, TASK, execute, LIMITS);
    expect(r).toMatchObject({ status: "FINISHED", problems: [] });
    expect(r.trace.map((t) => [t.tool, t.ok])).toEqual([
      ["read", true],
      ["nope", false],
      ["finish", true],
    ]);
    expect(received[0]?.map((x) => x.isError)).toEqual([false, true]);
  });

  it("ends as invalid output on a terminal error, a stop without finishing, or the token cap", async () => {
    expect(await loop([callTools(["bad", {}])])).toMatchObject({
      status: "INVALID_OUTPUT",
      problems: ["invalid"],
    });
    expect(await loop([said("end_turn")])).toMatchObject({
      status: "INVALID_OUTPUT",
      problems: ["the model stopped without finishing the task"],
    });
    expect((await loop([said("max_tokens")])).problems).toEqual(["output token limit reached"]);
  });

  it("enforces the turn and tool-call limits", async () => {
    const reads = Array.from({ length: 5 }, () => callTools(["read", {}]));
    expect(await loop(reads)).toMatchObject({
      status: "LIMIT_REACHED",
      problems: ["not finished within 3 model turns"],
    });
    const flood = callTools(...Array.from({ length: 5 }, () => ["read", {}] as [string, unknown]));
    expect(await loop([flood])).toMatchObject({
      status: "LIMIT_REACHED",
      problems: ["more than 4 tool calls requested"],
    });
  });

  it("reports refusals, provider errors and timeouts as provider failures, without retrying", async () => {
    expect((await loop([said("refusal")])).status).toBe("PROVIDER_FAILURE");
    expect(await loop([callTools(["read", {}]), new Error("503")])).toMatchObject({
      status: "PROVIDER_FAILURE",
      problems: ["503"],
    });
    expect(await loop(["hang"])).toMatchObject({
      status: "PROVIDER_FAILURE",
      problems: ["provider timed out after 50 ms"],
    });
  });
});
