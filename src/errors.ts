export class UserError extends Error {
  override name = 'UserError';
}
// Log categories, never raw HTTP/voice errors (they may contain credentials).
export function log(event: string, details: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}
