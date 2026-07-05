import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';
import type { IDoesFilterPassParams, IRowNode } from 'ag-grid-community';
import styles from '../pages/StatsPage.module.css';

/** Selected values to show. `null` model = filter inactive (show all). */
type PickemModel = string[];

type PickemFilterProps = CustomFilterProps<Record<string, unknown>, unknown, PickemModel> & {
  /** Show a type-to-filter box above the list (for long value sets like players). */
  searchable?: boolean;
  searchPlaceholder?: string;
};

/**
 * Community-only "pick-em" filter: a multi-select checkbox list of the distinct
 * values in the column. Replaces the built-in filter on the Team/Player columns so
 * users can toggle which fantasy teams (or players) are visible. (The built-in Set
 * and Multi filters are Enterprise, so we implement the equivalent ourselves.) Long
 * value sets can opt into a search box via `searchable`.
 */
export function PickemFilter({
  model,
  onModelChange,
  getValue,
  api,
  searchable = false,
  searchPlaceholder = 'Search…',
}: PickemFilterProps) {
  const [values, setValues] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const collectValues = useCallback(() => {
    const found = new Set<string>();
    const add = (node: IRowNode<Record<string, unknown>>) => {
      const value = getValue(node);
      if (value != null && String(value).trim() !== '') found.add(String(value));
    };
    // Respect the grid's other filters when building the list: with no selection yet,
    // only offer rows that pass those filters. Once this column has an active selection
    // (which itself narrows the grid), fall back to the full set so users can still
    // add/remove without the list collapsing to just their current picks.
    if (model == null) {
      api.forEachNodeAfterFilterAndSort(add);
    } else {
      api.forEachNode(add);
    }
    setValues([...found].sort((a, b) => a.localeCompare(b)));
  }, [api, getValue, model]);

  useEffect(() => {
    collectValues();
  }, [collectValues]);

  const doesFilterPass = useCallback(
    ({ node }: IDoesFilterPassParams<Record<string, unknown>>) => {
      // Empty selection = no filter (show everything). Only a non-empty allow-list filters.
      if (model == null || model.length === 0) return true;
      const value = getValue(node);
      return value != null && model.includes(String(value));
    },
    [model, getValue],
  );

  // Recompute the list whenever the menu opens so it tracks the current rows.
  useGridFilter({ doesFilterPass, afterGuiAttached: collectValues });

  // Checkboxes are an allow-list built from empty: nothing is checked until the user picks
  // (so they never have to unselect all first). An empty list means "show all" (see above).
  const isChecked = (value: string) => model != null && model.includes(value);

  const toggle = (value: string) => {
    const current = new Set(model ?? []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    const next = values.filter((v) => current.has(v));
    // No picks -> clear the filter (inactive, shows all); otherwise store the allow-list.
    onModelChange(next.length === 0 ? null : next);
  };

  const shown = useMemo(() => {
    if (!searchable) return values;
    const q = query.trim().toLowerCase();
    return q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
  }, [values, query, searchable]);

  return (
    <div className={styles.pickem}>
      {searchable ? (
        <input
          type="text"
          className={styles.pickemSearch}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={searchPlaceholder}
        />
      ) : null}
      <div className={styles.pickemActions}>
        <button type="button" onClick={() => onModelChange(values.length > 0 ? [...values] : null)}>
          Select all
        </button>
        <button type="button" onClick={() => onModelChange(null)}>
          Clear
        </button>
      </div>
      <ul className={styles.pickemList}>
        {shown.length === 0 ? (
          <li className={styles.pickemEmpty}>{values.length === 0 ? 'No values' : 'No matches'}</li>
        ) : (
          shown.map((value) => (
            <li key={value}>
              <label className={styles.pickemItem}>
                <input type="checkbox" checked={isChecked(value)} onChange={() => toggle(value)} />
                <span>{value}</span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
