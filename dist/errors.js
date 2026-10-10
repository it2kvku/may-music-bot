export class UserError extends Error {
    name = 'UserError';
}
// Log categories, never raw HTTP/voice errors (they may contain credentials).
export function log(event, details = {}) {
    console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }));
}
//# sourceMappingURL=errors.js.map