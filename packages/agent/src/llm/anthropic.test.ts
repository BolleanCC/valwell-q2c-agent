import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { anthropicProvider, DEFAULT_MODEL, type MessagesClient } from "./anthropic.js";
import { LIMITS, SUBMIT_TOOL } from "./loop.js";

/** A fake SDK client: records requests and replays canned responses. No network. */
function fakeClient(responses: Partial<Anthropic.Message>[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create(body) {
        requests.push(structuredClone(body));
        const next = responses.shift();
        if (!next) return Promise.reject(new Error("no canned response"));
        return Promise.resolve(next as Anthropic.Message);
      },
    },
  };
  return { client, requests };
}

const task = { system: "sys", prompt: "investigate", tools: [SUBMIT_TOOL] };

describe("anthropicProvider (fake client, no network)", () => {
  it("sends tools and limits, and maps tool_use responses to turns", async () => {
    const { client, requests } = fakeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Looking up the work order.", citations: null },
          {
            type: "tool_use",
            id: "tu_1",
            name: "get_work_order",
            input: { job_id: "JOB-D4" },
            caller: { type: "direct" },
          },
        ] as Anthropic.ContentBlock[],
      },
      { stop_reason: "end_turn", content: [] },
    ]);
    const provider = anthropicProvider({ client, model: "test-model" });
    expect(provider).toMatchObject({ mode: "live", model: "test-model" });

    const session = provider.open(task);
    expect(await session.start()).toEqual({
      stopReason: "tool_use",
      text: "Looking up the work order.",
      toolCalls: [{ id: "tu_1", name: "get_work_order", input: { job_id: "JOB-D4" } }],
    });
    await session.reply([{ toolCallId: "tu_1", content: '{"lines":[]}', isError: false }]);

    expect(requests[0]).toMatchObject({
      model: "test-model",
      max_tokens: LIMITS.maxOutputTokens,
      system: "sys",
      tools: [{ name: "submit_change_order_draft" }],
      messages: [{ role: "user", content: "investigate" }],
    });
    // The assistant turn is kept verbatim and the tool result is sent back.
    expect(requests[1]?.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: expect.arrayContaining([expect.objectContaining({ id: "tu_1" })]),
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tu_1", content: '{"lines":[]}', is_error: false },
        ],
      },
    ]);
  });

  it("uses LLM_MODEL or the default model", () => {
    const saved = process.env.LLM_MODEL;
    delete process.env.LLM_MODEL;
    expect(anthropicProvider({ client: fakeClient([]).client }).model).toBe(DEFAULT_MODEL);
    process.env.LLM_MODEL = "claude-sonnet-5-5";
    expect(anthropicProvider({ client: fakeClient([]).client }).model).toBe("claude-sonnet-5-5");
    if (saved === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = saved;
  });
});
