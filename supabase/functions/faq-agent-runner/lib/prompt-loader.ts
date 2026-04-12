export async function loadPrompt(promptFile: string): Promise<string> {
  const url = new URL(`../prompts/${promptFile}`, import.meta.url);
  return await Deno.readTextFile(url);
}

export function injectPromptVariables(
  template: string,
  variables: Record<string, string | null | undefined>,
): string {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    const safeValue = value ?? '';
    rendered = rendered.replaceAll(`{{${key}}}`, safeValue);
  }
  return rendered;
}
