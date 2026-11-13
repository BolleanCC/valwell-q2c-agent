import type { LlmProvider, ModelTurn, ToolResult } from "./loop.js";

/** A scripted step: a model turn, a provider error, or a request that never answers. */
export type ScriptStep = ModelTurn | Error | "hang";

/**
 * Offline provider that replays fixed model turns through the real loop and
 * the real tools. It is simulated behaviour, not a model run. `received`
 * records the tool results the "model" was sent, for inspection.
 */
export function scriptedProvider(steps: readonly ScriptStep[], model = "offline-script") {
  const received: ToolResult[][] = [];
  const provider: LlmProvider = {
    mode: "offline",
    model,
    open() {
      let next = 0;
      const step = (): Promise<ModelTurn> => {
        const s = steps[next++];
        if (s === undefined) return Promise.reject(new Error("offline script has no more turns"));
        if (s === "hang") return new Promise<ModelTurn>(() => {});
        if (s instanceof Error) return Promise.reject(s);
        return Promise.resolve(s);
      };
      return {
        start: step,
        reply(results) {
          received.push(results);
          return step();
        },
      };
    },
  };
  return { provider, received };
}

/** Shorthand for a turn that only calls tools. */
export const callTools = (...calls: [name: string, input: unknown][]): ModelTurn => ({
  stopReason: "tool_use",
  text: "",
  toolCalls: calls.map(([name, input], i) => ({ id: `call-${name}-${i}`, name, input })),
});
