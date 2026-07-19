import type { MouseEvent, ReactNode } from 'react';
import { usePlayerFocusOptional, type PlayerFocusTarget } from '../context/PlayerFocusContext';
import styles from './PlayerNameButton.module.css';

/**
 * A player name rendered as an inline button that opens the global player-focus modal.
 * Used everywhere a structured player name appears. Inside ag-grid cells, pass
 * `stopPropagation` so the click opens the modal without toggling row selection. When
 * rendered outside PlayerFocusProvider (e.g. isolated tests) it degrades to plain text.
 */
export function PlayerNameButton({
  target,
  className,
  stopPropagation,
  children,
}: {
  target: PlayerFocusTarget;
  className?: string;
  stopPropagation?: boolean;
  children?: ReactNode;
}) {
  const focus = usePlayerFocusOptional();
  const label = children ?? target.fullName;
  if (!focus) return <>{label}</>;
  return (
    <button
      type="button"
      className={`${styles.name}${className ? ` ${className}` : ''}`}
      onClick={(e: MouseEvent) => {
        if (stopPropagation) e.stopPropagation();
        focus.openPlayerFocus(target);
      }}
    >
      {label}
    </button>
  );
}
