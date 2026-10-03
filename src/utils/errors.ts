/**
 * Error helpers
 */

/**
 * Extract a human-readable message from an unknown thrown value.
 * `JSON.stringify(new Error('x'))` yields `{}`, so always go through this.
 */
export function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
