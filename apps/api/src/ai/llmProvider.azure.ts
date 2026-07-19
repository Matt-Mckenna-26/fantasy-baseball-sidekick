import type { AppConfig } from '../config.js';
import type {
  LlmMessage,
  LlmProvider,
  LlmResult,
  LlmToolCall,
  LlmToolSchema,
  LlmUsage,
} from './llmProvider.js';

/**
 * Azure OpenAI chat-completions provider with native tool (function) calling,
 * non-streaming. Reads endpoint/deployment/apiVersion/key from config. The API key is
 * never logged; only coarse metadata (round counts) is surfaced by the orchestrator.
 * In production the key is replaced by Managed Identity (keyless) - out of scope here.
 */

interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface RawChoiceMessage {
  content?: string | null;
  tool_calls?: RawToolCall[];
}
interface RawCompletion {
  choices?: { message?: RawChoiceMessage }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** A partial tool-call as it arrives across streamed chunks (keyed by `index`). */
interface RawDeltaToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
/** One Server-Sent-Events chunk from a streamed chat completion. */
interface RawStreamChunk {
  choices?: { delta?: { content?: string | null; tool_calls?: RawDeltaToolCall[] } }[];
  usage?: RawCompletion['usage'];
}

/**
 * Reasoning models (GPT-5 series, o1/o3) use a different request contract than legacy
 * chat models: they reject `max_tokens` and non-default `temperature`, and spend part of
 * the token budget on hidden reasoning. Detect them by deployment name so one provider
 * serves both families. Heuristic on the common naming; override by naming accordingly.
 */
function isReasoningModel(deployment: string): boolean {
  return /^(o\d|gpt-5)/i.test(deployment);
}

/** Map our neutral message shape to the OpenAI wire format. */
function toWireMessage(m: LlmMessage): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      })),
    };
  }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

export class AzureOpenAiProvider implements LlmProvider {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly reasoning: boolean;

  constructor(config: AppConfig) {
    if (!config.azureOpenAiEndpoint || !config.azureOpenAiApiKey || !config.azureOpenAiDeployment) {
      // Guarded by config.refine, but fail clearly if constructed misconfigured.
      throw new Error('Azure OpenAI is not fully configured.');
    }
    const base = config.azureOpenAiEndpoint.replace(/\/$/, '');
    this.url =
      `${base}/openai/deployments/${config.azureOpenAiDeployment}/chat/completions` +
      `?api-version=${config.azureOpenAiApiVersion}`;
    this.apiKey = config.azureOpenAiApiKey;
    this.reasoning = isReasoningModel(config.azureOpenAiDeployment);
  }

  /** Shared request body for both the buffered and streamed calls. */
  private buildBody(
    messages: LlmMessage[],
    tools: LlmToolSchema[],
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      messages: messages.map(toWireMessage),
      // Reasoning models spend part of the budget on hidden reasoning tokens, so they need
      // a larger cap and use max_completion_tokens (max_tokens is rejected). Legacy chat
      // models keep the tuned temperature; reasoning models reject non-default temperature.
      max_completion_tokens: this.reasoning ? 4096 : 700,
    };
    if (this.reasoning) {
      // Keep latency/cost down for a chat co-manager while allowing parallel tool calls.
      body.reasoning_effort = 'low';
    } else {
      body.temperature = 0.4;
    }
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (stream) {
      body.stream = true;
      // Ask for a final usage-only chunk so streamed turns still report token spend.
      body.stream_options = { include_usage: true };
    }
    return body;
  }

  private static mapUsage(raw: RawCompletion['usage']): LlmUsage | undefined {
    if (!raw) return undefined;
    return {
      ...(raw.prompt_tokens !== undefined ? { promptTokens: raw.prompt_tokens } : {}),
      ...(raw.completion_tokens !== undefined ? { completionTokens: raw.completion_tokens } : {}),
      ...(raw.total_tokens !== undefined ? { totalTokens: raw.total_tokens } : {}),
    };
  }

  async complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify(this.buildBody(messages, tools, false)),
    });
    if (!res.ok) {
      // Do not include the response body (may echo the request/headers); status is enough.
      throw new Error(`Azure OpenAI request failed: ${res.status}`);
    }
    const data = (await res.json()) as RawCompletion;
    const message = data.choices?.[0]?.message;
    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? [])
      .filter((c) => typeof c.function?.name === 'string')
      .map((c, i) => ({
        id: c.id ?? `call-${i}`,
        name: c.function!.name as string,
        arguments: c.function?.arguments ?? '{}',
      }));
    const usage = AzureOpenAiProvider.mapUsage(data.usage);
    return { content: message?.content ?? '', toolCalls, ...(usage ? { usage } : {}) };
  }

  async stream(
    messages: LlmMessage[],
    tools: LlmToolSchema[],
    onDelta: (text: string) => void,
  ): Promise<LlmResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify(this.buildBody(messages, tools, true)),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Azure OpenAI request failed: ${res.status}`);
    }

    let content = '';
    // Tool-call fragments arrive across chunks keyed by index; accumulate name + arguments.
    const toolAcc = new Map<number, { id?: string; name?: string; arguments: string }>();
    let usageRaw: RawCompletion['usage'];

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handlePayload = (payload: string): void => {
      if (payload === '[DONE]') return;
      let chunk: RawStreamChunk;
      try {
        chunk = JSON.parse(payload) as RawStreamChunk;
      } catch {
        return; // ignore keep-alive/comment lines
      }
      if (chunk.usage) usageRaw = chunk.usage;
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) return;
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        onDelta(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { arguments: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name = tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line; each frame's data lines start with "data:".
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) handlePayload(trimmed.slice(5).trim());
        }
      }
    }

    const toolCalls: LlmToolCall[] = [...toolAcc.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, c]) => typeof c.name === 'string')
      .map(([i, c]) => ({ id: c.id ?? `call-${i}`, name: c.name as string, arguments: c.arguments || '{}' }));
    const usage = AzureOpenAiProvider.mapUsage(usageRaw);
    return { content, toolCalls, ...(usage ? { usage } : {}) };
  }
}
