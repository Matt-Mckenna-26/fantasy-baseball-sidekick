import { describe, it, expect } from 'vitest';
import { splitFilterTokens } from './PickemFilter';

describe('splitFilterTokens', () => {
  it('splits comma-joined positions into singular tokens', () => {
    expect(splitFilterTokens('2B,SS')).toEqual(['2B', 'SS']);
    expect(splitFilterTokens(' OF , 1B ')).toEqual(['OF', '1B']);
    expect(splitFilterTokens('SP')).toEqual(['SP']);
    expect(splitFilterTokens('')).toEqual([]);
  });
});
