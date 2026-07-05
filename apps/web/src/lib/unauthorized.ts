/** Fired when any API call returns 401 so the session can bail out to sign-in. */
let handler: (() => void) | null = null;

export function onUnauthorized(cb: (() => void) | null): void {
  handler = cb;
}

export function notifyUnauthorized(): void {
  handler?.();
}
