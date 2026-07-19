import { useEffect, useMemo, useRef, useState } from 'react';
import { CompareAvatar, type CompareEntityOption } from './charts/compareEntity';
import styles from '../pages/StatsPage.module.css';

/**
 * Friendly "compare" entry point for users who don't reach for the grid's column filters:
 * a modal to text-search entities (players or teams), add them as cards, then compare. On
 * confirm the parent applies the grid filter to the chosen entities and opens the compare
 * chart. `noun` drives the copy so the same dialog serves both pages.
 */
export function CompareEntitiesDialog({
  open,
  onClose,
  options,
  max,
  noun,
  onCompare,
}: {
  open: boolean;
  onClose: () => void;
  options: CompareEntityOption[];
  max: number;
  noun: 'player' | 'team';
  onCompare: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const plural = noun === 'team' ? 'teams' : 'players';

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setQuery('');
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const atMax = selected.length >= max;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(selected);
    return options
      .filter((o) => !chosen.has(o.id))
      .filter((o) => o.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [options, selected, query]);

  if (!open) return null;

  const add = (id: string) => {
    if (atMax || selected.includes(id)) return;
    setSelected([...selected, id]);
    setQuery('');
    inputRef.current?.focus();
  };
  const remove = (id: string) => setSelected(selected.filter((s) => s !== id));

  return (
    <div
      className={styles.guideOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-entities-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.compareDialog}>
        <div className={styles.compareDialogHead}>
          <h2 id="compare-entities-title" className={styles.guideTitle}>
            Compare {plural}
          </h2>
          <button
            type="button"
            className={styles.compareDialogClose}
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <p className={styles.guideLead}>
          Search for up to {max} {plural} to add, then compare them across every stat.
        </p>

        <input
          ref={inputRef}
          type="text"
          className={styles.pickemSearch}
          placeholder={atMax ? `Up to ${max} ${plural} added` : `Search ${plural}\u2026`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={atMax}
          aria-label={`Search ${plural}`}
        />
        {query.trim() && !atMax ? (
          <ul className={styles.compareMatches}>
            {matches.length === 0 ? (
              <li className={styles.pickemEmpty}>No matches</li>
            ) : (
              matches.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={styles.compareMatchItem}
                    onClick={() => add(o.id)}
                  >
                    <CompareAvatar
                      name={o.name}
                      kind={o.kind}
                      {...(o.imageUrl ? { imageUrl: o.imageUrl } : {})}
                    />
                    <span className={styles.compareMatchName}>{o.name}</span>
                    {o.subtitle ? (
                      <span className={styles.compareMatchOwner}>{o.subtitle}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}

        <div className={styles.compareChosen}>
          {selected.length === 0 ? (
            <p className={styles.pickemEmpty}>No {plural} added yet.</p>
          ) : (
            selected.map((id) => {
              const o = optionById.get(id);
              if (!o) return null;
              return (
                <span key={id} className={styles.compareChosenCard}>
                  <CompareAvatar
                    name={o.name}
                    kind={o.kind}
                    {...(o.imageUrl ? { imageUrl: o.imageUrl } : {})}
                  />
                  <span className={styles.compareChosenName}>{o.name}</span>
                  <button
                    type="button"
                    className={styles.compareChosenRemove}
                    onClick={() => remove(id)}
                    aria-label={`Remove ${o.name}`}
                  >
                    &times;
                  </button>
                </span>
              );
            })
          )}
        </div>

        <div className={styles.compareDialogActions}>
          <button type="button" className={styles.compareDialogCancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.compareDialogPrimary}
            disabled={selected.length === 0}
            onClick={() => onCompare(selected)}
          >
            Compare{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
