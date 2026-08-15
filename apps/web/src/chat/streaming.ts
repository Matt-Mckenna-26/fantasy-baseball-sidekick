/**
 * Render streamed reply text without the raw marker tags the model emits: unwrap any complete
 * [[p:Name]] player tag to the plain name, drop [[s:N]] citation markers (the clickable pills
 * are rendered from the final message + its sourcesCited, which only arrive with `done`), and
 * hide a trailing not-yet-closed tag fragment (e.g. "[[p:Aaron" or "[[s:") until it finishes
 * streaming, so the marker syntax never flashes on screen.
 */
export function stripStreamingMentions(text: string): string {
  const unwrapped = text.replace(/\[\[p:([^\]]+)\]\]/g, '$1').replace(/\[\[s:\d+\]\]/g, '');
  const open = unwrapped.lastIndexOf('[[');
  return open !== -1 && unwrapped.indexOf(']]', open) === -1 ? unwrapped.slice(0, open) : unwrapped;
}
