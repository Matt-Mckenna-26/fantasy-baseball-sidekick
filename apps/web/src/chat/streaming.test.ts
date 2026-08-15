import { describe, it, expect } from 'vitest';
import { stripStreamingMentions } from './streaming';

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
