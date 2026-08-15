/**
 * Render streamed reply text without the raw [[p:Name]] player tags: unwrap any complete
 * tag to the plain name, and hide a trailing not-yet-closed tag fragment (e.g. "[[p:Aaron")
 * until it finishes streaming, so the marker syntax never flashes on screen. The final
 * `done` message carries the authoritative, already-stripped content.
 */
export function stripStreamingMentions(text: string): string {
  const unwrapped = text.replace(/\[\[p:([^\]]+)\]\]/g, '$1');
  const open = unwrapped.lastIndexOf('[[');
  return open !== -1 && unwrapped.indexOf(']]', open) === -1 ? unwrapped.slice(0, open) : unwrapped;
}
