import type { AppConfig } from '../config.js';
import { MockLlmProvider } from './llmProvider.mock.js';
import { AzureOpenAiProvider } from './llmProvider.azure.js';

/**
 * Provider-agnostic LLM boundary for the co-manager. Native function/tool calling: the
 * model may respond with text and/or a set of tool calls, which the orchestrator runs
 * and feeds back. Keeping this interface tiny lets us swap the mock (offline/tests) for
 * Azure OpenAI (or another model) without touching the orchestrator.
 */

export interface LlmToolSchema {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments object. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw JSON string of arguments as emitted by the model. */
  arguments: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant turns that request tools. */
  toolCalls?: LlmToolCall[];
  /** Present on tool-result turns (ties the result back to the call). */
  toolCallId?: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmResult {
  content: string;
  toolCalls: LlmToolCall[];
  usage?: LlmUsage;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult>;
  /**
   * Same as `complete`, but invokes `onDelta` with each chunk of reply text as it is
   * generated so the orchestrator can stream the answer to the UI. Returns the same full
   * `LlmResult` once finished (including any tool calls). Optional: the orchestrator falls
   * back to `complete` when a provider does not implement it.
   */
  stream?(
    messages: LlmMessage[],
    tools: LlmToolSchema[],
    onDelta: (text: string) => void,
  ): Promise<LlmResult>;
}

/** Select the LLM provider from config (mock by default; Azure OpenAI when configured). */
export function createLlmProvider(config: AppConfig): LlmProvider {
  return config.chatProvider === 'azure' ? new AzureOpenAiProvider(config) : new MockLlmProvider();
}
