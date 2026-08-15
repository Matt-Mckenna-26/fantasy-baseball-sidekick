import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSmoothReveal, stripStreamingMentions } from './streaming';

describe('stripStreamingMentions', () => {
  it('unwraps complete player tags to the plain name', () => {
    expect(stripStreamingMentions('Target [[p:Aaron Judge]] on waivers.')).toBe(
      'Target Aaron Judge on waivers.',
    );
  });

  it('unwraps multiple tags in one message', () => {
    expect(stripStreamingMentions('[[p:Corbin Carroll]] over [[p:Elly De La Cruz]]')).toBe(
      'Corbin Carroll over Elly De La Cruz',
    );
  });

  it('hides a trailing tag fragment still streaming in', () => {
    expect(stripStreamingMentions('Consider [[p:Aaron')).toBe('Consider ');
  });

  it('leaves plain text untouched', () => {
    expect(stripStreamingMentions('No mentions here.')).toBe('No mentions here.');
  });
});

describe('createSmoothReveal', () => {
  let frames: FrameRequestCallback[] = [];
  let clock = 0;

  function flush(count: number): void {
    for (let i = 0; i < count; i++) {
      const due = frames;
      frames = [];
      clock += 16;
      for (const cb of due) cb(clock);
    }
  }

  afterEach(() => vi.unstubAllGlobals());

  function stubRaf(): void {
    frames = [];
    clock = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
  }

  it('snaps straight to the final text when nothing streamed (non-streaming provider)', async () => {
    stubRaf();
    const seen: string[] = [];
    const reveal = createSmoothReveal((t) => seen.push(t));
    await reveal.finish('The Bombers lead in home runs.');
    expect(seen).toEqual(['The Bombers lead in home runs.']);
  });

  it('reveals streamed text gradually, then lands on the full final text', async () => {
    stubRaf();
    const full = 'Start Duran; he owns the ninth inning now.';
    const seen: string[] = [];
    const reveal = createSmoothReveal((t) => seen.push(t), { charsPerSecond: 300 });

    reveal.push(full);
    flush(3); // partial reveals along the way
    const midway = seen[seen.length - 1] ?? '';
    expect(midway.length).toBeGreaterThan(0);
    expect(midway.length).toBeLessThan(full.length);
    expect(full.startsWith(midway)).toBe(true);

    const done = reveal.finish(full);
    flush(60);
    await done;
    expect(seen[seen.length - 1]).toBe(full);
  });

  it('cancel() snaps to the full text and reset() clears it', () => {
    stubRaf();
    const seen: string[] = [];
    const reveal = createSmoothReveal((t) => seen.push(t));

    reveal.push('abcdef');
    reveal.cancel();
    expect(seen[seen.length - 1]).toBe('abcdef');

    reveal.reset();
    expect(seen[seen.length - 1]).toBe('');
  });
});
