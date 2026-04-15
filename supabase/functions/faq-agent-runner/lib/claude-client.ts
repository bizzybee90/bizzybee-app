const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 75_000;

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ToolUseBlock | TextBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
}

export async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: Message[],
  tools: ToolDefinition[],
  model = MODEL,
  maxTokens = MAX_TOKENS,
): Promise<ClaudeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools,
    }),
    signal: controller.signal,
  }).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Claude API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  });

  clearTimeout(timeout);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  return (await response.json()) as ClaudeResponse;
}

export function extractTextContent(content: ContentBlock[]): string {
  return content
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function extractToolUseBlocks(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}

export function buildToolResultMessage(
  toolUseId: string,
  result: unknown,
  isError = false,
): Message {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result' as unknown as 'text',
        tool_use_id: toolUseId,
        content: JSON.stringify(result),
        is_error: isError,
      } as unknown as TextBlock,
    ],
  };
}
