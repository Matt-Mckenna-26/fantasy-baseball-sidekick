import { useId, useMemo, useRef, useState } from 'react';
import styles from './PlayerPicker.module.css';

/** A player the picker can search and select as a chart series. */
export interface PlayerOption {
  id: string;
  name: string;
  abbr?: string;
}

/**
 * Builds the player series for the charts. Chosen players become sticky tiles that stay
 * put (e.g. after loading a fantasy team) with an active/inactive state: a single click
 * toggles a tile in/out of the charts, a double click isolates it (solo), and the x
 * removes it. Search adds new tiles; "Clear all" and a "Top N" preset reset the set.
 * Only active tiles (up to `cap`) are charted. State is owned by the parent.
 */
export function PlayerPicker({
  options,
  tiles,
  inactive,
  colorMap,
  cap,
  presetCount,
  onAdd,
  onRemove,
  onToggle,
  onSolo,
  onClear,
  onPreset,
}: {
  options: PlayerOption[];
  tiles: string[];
  inactive: ReadonlySet<string>;
  colorMap: Map<string, string>;
  cap: number;
  presetCount: number;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onSolo: (id: string) => void;
  onClear: () => void;
  onPreset: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const activeCount = tiles.filter((id) => !inactive.has(id)).length;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const tileSet = new Set(tiles);
    return options
      .filter((o) => !tileSet.has(o.id))
      .filter((o) => (q ? o.name.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [options, tiles, query]);

  const add = (id: string) => {
    onAdd(id);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[active];
      if (pick) add(pick.id);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.searchRow}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className={styles.input}
            placeholder={'Search players\u2026'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
          />
          {open && matches.length > 0 && (
            <ul id={listId} className={styles.dropdown} role="listbox">
              {matches.map((o, i) => (
                <li key={o.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={`${styles.option}${i === active ? ` ${styles.optionActive}` : ''}`}
                    // Mousedown fires before the input's blur, so the pick isn't lost.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(o.id);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className={styles.optionName}>{o.name}</span>
                    {o.abbr && <span className={styles.optionAbbr}>{o.abbr}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={onPreset}
            disabled={presetCount === 0}
          >
            Top {presetCount || ''}
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={onClear}
            disabled={tiles.length === 0}
          >
            Clear all
          </button>
        </div>
      </div>

      <p className={styles.hint} aria-live="polite">
        {tiles.length === 0
          ? 'Search or load a team to add players.'
          : `${activeCount} of ${cap} charted \u00b7 click a tile to toggle, double-click to isolate.`}
      </p>

      {tiles.length > 0 && (
        <div className={styles.badges}>
          {tiles.map((id) => {
            const opt = optionById.get(id);
            if (!opt) return null;
            const isActive = !inactive.has(id);
            return (
              <span
                key={id}
                className={`${styles.badge}${isActive ? '' : ` ${styles.badgeInactive}`}`}
              >
                <button
                  type="button"
                  className={styles.badgeToggle}
                  aria-pressed={isActive}
                  title="Click to toggle, double-click to isolate"
                  onClick={() => onToggle(id)}
                  onDoubleClick={() => onSolo(id)}
                >
                  <span
                    className={styles.badgeSwatch}
                    style={isActive ? { background: colorMap.get(id) } : undefined}
                    aria-hidden="true"
                  />
                  <span className={styles.badgeName}>{opt.name}</span>
                </button>
                <button
                  type="button"
                  className={styles.badgeRemove}
                  aria-label={`Remove ${opt.name}`}
                  onClick={() => onRemove(id)}
                >
                  &times;
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
