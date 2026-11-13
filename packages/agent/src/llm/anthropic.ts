import Anthropic from "@anthropic-ai/sdk";
import { LIMITS, type LlmProvider, type ModelTurn } from "./loop.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

/** The one SDK call the provider makes; a fake can stand in for it in tests. */
export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

/** Reduce an API response to what the loop needs. */
export function toTurn(response: Anthropic.Message): ModelTurn {
  const toolCalls = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { stopReason: response.stop_reason ?? "unknown", text, toolCalls };
}

/**
 * Live provider: real Messages API calls with tool use.
 *
 * Credentials come from the environment (ANTHROPIC_API_KEY, which the SDK
 * reads itself); the key is never read, logged or printed here. The model is
 * LLM_MODEL or claude-opus-5-5. No automatic retries (maxRetries 0), a
 * request timeout and an output-token cap from LIMITS. The client is created
 * on the first request, so missing credentials surface as a provider failure.
 */
export function anthropicProvider(
  options: { model?: string; client?: MessagesClient } = {},
): LlmProvider {
  const model = options.model ?? (process.env.LLM_MODEL || DEFAULT_MODEL);
  let client = options.client;
  return {
    mode: "live",
    model,
    open(task) {
      const tools: Anthropic.Tool[] = task.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
      const messages: Anthropic.MessageParam[] = [{ role: "user", content: task.prompt }];
      const call = async (): Promise<ModelTurn> => {
        client ??= new Anthropic({ timeout: LIMITS.timeoutMs, maxRetries: 0 });
        const response = await client.messages.create({
          model,
          max_tokens: LIMITS.maxOutputTokens,
          system: task.system,
          tools,
          messages,
        });
        // Keep the full content (including any thinking blocks) for the next request.
        messages.push({ role: "assistant", content: response.content });
        return toTurn(response);
      };
      return {
        start: call,
        reply(results) {
          messages.push({
            role: "user",
            content: results.map((r) => ({
              type: "tool_result" as const,
              tool_use_id: r.toolCallId,
              content: r.content,
              is_error: r.isError,
            })),
          });
          return call();
        },
      };
    },
  };
}
