import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

Element.prototype.scrollIntoView = vi.fn();
// jsdom implements neither of these; assistant-ui's viewport auto-scroll calls scrollTo.
Element.prototype.scrollTo = vi.fn();

// jsdom lacks ResizeObserver, which assistant-ui's composer/viewport rely on.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
