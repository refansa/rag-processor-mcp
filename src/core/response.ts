/**
 * Shared response helpers for MCP tool handlers.
 */

/**
 * Create a success response with a JSON body.
 *
 * Serialises `data` as pretty-printed JSON and wraps it in the
 * standard MCP content envelope.
 */
export function textResponse(data: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(data, null, 2),
        type: "text" as const,
      },
    ],
  };
}

/**
 * Create an error response with a plain-text message.
 */
export function errorResponse(message: string) {
  return {
    content: [
      {
        text: message,
        type: "text" as const,
      },
    ],
    isError: true as const,
  };
}
