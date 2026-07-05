import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

Element.prototype.scrollIntoView = vi.fn();
