import type { CallToolResult } from '@modelcontextprotocol/server';
import { ShapioApiError } from '@shapio/client';

/** A tool's answer: the API response as pretty JSON text (what agents read best). */
export const jsonResult = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }],
});

/**
 * A refusal or failure the agent should see and act on (a stale version, a missing permission, validation
 * issues), with Shapio's error code and details. Never thrown: the MCP client gets `isError`.
 */
export const errorResult = (error: unknown): CallToolResult => {
  const body =
    error instanceof ShapioApiError
      ? { status: error.status, code: error.code, message: error.message, details: error.details }
      : { code: 'TOOL_FAILED', message: error instanceof Error ? error.message : String(error) };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: body }, null, 2) }] };
};

/** Runs a tool body, turning any failure into an error result. */
export const runTool = async (body: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return jsonResult(await body());
  } catch (error) {
    return errorResult(error);
  }
};
