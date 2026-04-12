import { extractJsonFromText } from '../../_shared/pipeline.ts';
import { callClaude, extractTextContent, type Message } from './claude-client.ts';

export async function callClaudeForJson<T>(
  apiKey: string,
  params: {
    systemPrompt: string;
    userPrompt: string;
    model: string;
    maxTokens?: number;
  },
): Promise<T> {
  const messages: Message[] = [{ role: 'user', content: params.userPrompt }];
  const response = await callClaude(
    apiKey,
    params.systemPrompt,
    messages,
    [],
    params.model,
    params.maxTokens,
  );

  const text = extractTextContent(response.content);
  const parsed = extractJsonFromText(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Claude did not return valid JSON');
  }

  return parsed as T;
}
