import { useEffect, useState } from 'react';

/** Shared mobile breakpoint — matches CSS `@media (max-width: 640px)` across the app. */
export const NARROW_MAX_WIDTH_PX = 640;

/**
 * True when the viewport is at or below `maxWidthPx` (defaults to the shared 640px
 * breakpoint). Used for ag-grid column pinning / touch defaults that CSS alone can't
 * express. Pass a custom width for components with a different breakpoint (e.g. the
 * player-focus card stacks at 46rem / 736px).
 */
export function useIsNarrow(maxWidthPx: number = NARROW_MAX_WIDTH_PX): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
      : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [maxWidthPx]);

  return narrow;
}
