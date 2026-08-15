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

/** Drives a smooth, "fast typing" reveal of streamed assistant text (see createSmoothReveal). */
export interface SmoothReveal {
  /** Feed a streamed chunk; the reveal animates toward it at a steady cadence. */
  push(delta: string): void;
  /** Clear everything shown so far (used when a leaked-tool preamble is discarded). */
  reset(): void;
  /** Drain to the (sanitized) final text, resolving once it's fully shown. */
  finish(finalText: string): Promise<void>;
  /** Snap to the full text immediately and stop (used on abort/unmount). */
  cancel(): void;
}

/**
 * Reveal streamed assistant text at a steady, "someone typing quickly" cadence, decoupled from
 * the network's bursty chunk sizes so the reply flows in smoothly instead of snapping in whole
 * lines at once. It speeds up the further behind it falls, so a big burst catches up without a
 * visible jump, and it never animates when nothing actually streamed (e.g. the non-streaming
 * provider) - it just snaps to the final text.
 */
export function createSmoothReveal(
  onText: (text: string) => void,
  opts: { charsPerSecond?: number } = {},
): SmoothReveal {
  const baseCps = opts.charsPerSecond ?? 72;
  const canAnimate =
    typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function';

  let target = '';
  // Fractional progress so a character can appear every few frames (smooth, unhurried) rather
  // than a whole one every frame; `shown` is the integer count actually rendered.
  let progress = 0;
  let shown = 0;
  let closed = false;
  let everPushed = false;
  let raf: number | null = null;
  let last = 0;
  let resolveFinish: (() => void) | null = null;

  const emit = () => onText(target.slice(0, shown));

  const stopLoop = () => {
    if (raf !== null && canAnimate) cancelAnimationFrame(raf);
    raf = null;
    last = 0;
  };

  const settle = () => {
    stopLoop();
    const done = resolveFinish;
    resolveFinish = null;
    done?.();
  };

  const step = (ts: number) => {
    if (last === 0) last = ts;
    const dt = ts - last;
    last = ts;
    if (progress < target.length) {
      const behind = target.length - progress;
      // Gentle catch-up: nudge the rate up when a burst leaves us behind, but cap it so it
      // never sprints (keeps the cadence even instead of jerky).
      const cps = baseCps * Math.min(2.5, 1 + behind / 600);
      progress = Math.min(target.length, progress + (dt / 1000) * cps);
      const next = Math.floor(progress);
      if (next !== shown) {
        shown = next;
        emit();
      }
    }
    if (shown < target.length || !closed) raf = requestAnimationFrame(step);
    else settle();
  };

  const ensureLoop = () => {
    if (!canAnimate) {
      progress = target.length;
      shown = target.length;
      emit();
      if (closed) settle();
      return;
    }
    if (raf === null) raf = requestAnimationFrame(step);
  };

  return {
    push(delta) {
      if (!delta) return;
      everPushed = true;
      target += delta;
      ensureLoop();
    },
    reset() {
      target = '';
      progress = 0;
      shown = 0;
      emit();
    },
    finish(finalText) {
      return new Promise<void>((resolve) => {
        closed = true;
        target = finalText;
        if (shown > target.length) {
          shown = target.length;
          progress = target.length;
        }
        // Nothing streamed (or already caught up): show the final text at once, no animation.
        if (!everPushed || !canAnimate || shown >= target.length) {
          progress = target.length;
          shown = target.length;
          emit();
          resolve();
          return;
        }
        resolveFinish = resolve;
        ensureLoop();
      });
    },
    cancel() {
      closed = true;
      progress = target.length;
      shown = target.length;
      emit();
      settle();
    },
  };
}
