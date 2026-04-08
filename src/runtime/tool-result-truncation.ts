export const TOOL_RESULT_MAX_CHARS = 15000;
export const TOOL_RESULT_TRUNCATION_MARKER = '\n\n--- [Tool output truncated for context safety] ---\n\n';

export function truncateToolResult(result: string, maxChars?: number): { truncated: boolean; content: string; originalLength: number } {
  const limit = maxChars ?? TOOL_RESULT_MAX_CHARS;
  if (result.length <= limit) {
    return { truncated: false, content: result, originalLength: result.length };
  }
  const head = result.slice(0, Math.floor(limit * 0.7));
  const tail = result.slice(result.length - Math.floor(limit * 0.3));
  return {
    truncated: true,
    content: `${head}${TOOL_RESULT_TRUNCATION_MARKER}[... ${result.length - limit} chars omitted ...]\n\n--- [End of truncated section, showing tail] ---\n\n${tail}`,
    originalLength: result.length,
  };
}

export function shouldTruncateToolResult(result: string, maxChars?: number): boolean {
  return result.length > (maxChars ?? TOOL_RESULT_MAX_CHARS);
}
