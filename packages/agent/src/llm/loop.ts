import type { ToolSpec } from "./tools.js";

// ---- Provider interface: one real provider (Anthropic) and one scripted (offline). ----

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** One model response, reduced to what the loop needs. */
export interface ModelTurn {
  /** "tool_use", "end_turn", "max_tokens", "refusal", ... */
  stopReason: string;
  text: string;
  toolCalls: ToolCall[];
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export interface LlmTask {
  system: string;
  prompt: string;
  tools: readonly ToolSpec[];
}

/** One conversation. The provider keeps its own message history. */
export interface LlmSession {
  start(): Promise<ModelTurn>;
  reply(results: ToolResult[]): Promise<ModelTurn>;
}

export interface LlmProvider {
  /** "offline" = scripted, simulated behaviour; "live" = real provider API calls. */
  mode: "offline" | "live";
  model: string;
  open(task: LlmTask): LlmSession;
}

// ---- Fixed bounds for one model run: no configuration layer, no retries. ----

export const LIMITS = { maxTurns: 10, maxToolCalls: 16, timeoutMs: 60_000, maxOutputTokens: 4_000 };
export type Limits = typeof LIMITS;

export interface TraceEntry {
  turn: number;
  tool: string | null;
  args: string;
  ok: boolean;
  summary: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`provider timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const short = (s: string, max = 120) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const message = (error: unknown) => String(error instanceof Error ? error.message : error);

/**
 * What the application returns for one tool call. `final` ends the loop
 * successfully (the finishing tool was accepted); `terminal` ends it as
 * invalid output. Any other error goes back to the model as a tool error.
 */
export type ToolExecution =
  | { ok: true; content: unknown; summary: string; final?: boolean }
  | { ok: false; error: string; terminal?: boolean };

export type LoopStatus = "FINISHED" | "INVALID_OUTPUT" | "LIMIT_REACHED" | "PROVIDER_FAILURE";

export interface LoopResult {
  status: LoopStatus;
  problems: string[];
  trace: TraceEntry[];
}

/**
 * The bounded tool-calling loop shared by every LLM workflow. The model
 * proposes tool calls; `execute` (application code) decides what each call
 * may do. Bounded by turns, tool calls, a per-request timeout and the
 * provider's output-token cap; never retries.
 */
export async function runToolLoop(
  provider: LlmProvider,
  task: LlmTask,
  execute: (call: ToolCall) => ToolExecution,
  limits: Limits,
): Promise<LoopResult> {
  const trace: TraceEntry[] = [];
  const end = (status: LoopStatus, problems: string[]): LoopResult => ({ status, problems, trace });
  const session = provider.open(task);
  let turn: ModelTurn;
  try {
    turn = await withTimeout(session.start(), limits.timeoutMs);
  } catch (error) {
    return end("PROVIDER_FAILURE", [message(error)]);
  }

  let toolCalls = 0;
  for (let n = 1; ; n++) {
    if (turn.text.trim()) {
      trace.push({ turn: n, tool: null, args: "", ok: true, summary: short(turn.text) });
    }
    if (turn.stopReason === "refusal")
      return end("PROVIDER_FAILURE", ["the model declined the request"]);
    if (turn.stopReason === "max_tokens")
      return end("INVALID_OUTPUT", ["output token limit reached"]);
    if (turn.toolCalls.length === 0) {
      return end("INVALID_OUTPUT", ["the model stopped without finishing the task"]);
    }
    if (toolCalls + turn.toolCalls.length > limits.maxToolCalls) {
      return end("LIMIT_REACHED", [`more than ${limits.maxToolCalls} tool calls requested`]);
    }

    const results: ToolResult[] = [];
    for (const call of turn.toolCalls) {
      toolCalls++;
      const ex = execute(call);
      trace.push({
        turn: n,
        tool: call.name,
        args: short(JSON.stringify(call.input) ?? ""),
        ok: ex.ok,
        summary: ex.ok ? short(ex.summary, 200) : ex.error,
      });
      if (ex.ok && ex.final) return end("FINISHED", []);
      if (!ex.ok && ex.terminal) return end("INVALID_OUTPUT", [ex.error]);
      results.push({
        toolCallId: call.id,
        content: JSON.stringify(ex.ok ? ex.content : { error: ex.error }),
        isError: !ex.ok,
      });
    }

    if (n >= limits.maxTurns) {
      return end("LIMIT_REACHED", [`not finished within ${limits.maxTurns} model turns`]);
    }
    try {
      turn = await withTimeout(session.reply(results), limits.timeoutMs);
    } catch (error) {
      return end("PROVIDER_FAILURE", [message(error)]);
    }
  }
}
