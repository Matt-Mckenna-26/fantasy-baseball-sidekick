import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';
import type { IDoesFilterPassParams, IRowNode } from 'ag-grid-community';
import styles from '../pages/StatsPage.module.css';

/** Selected values to show. `null` model = filter inactive (show all). */
type PickemModel = string[];

/** Preferred order for baseball position tokens in the Pos filter checklist. */
const POSITION_ORDER = [
  'C',
  '1B',
  '2B',
  '3B',
  'SS',
  'OF',
  'DH',
  'Util',
  'SP',
  'RP',
  'P',
];

/** Split a cell value into singular tokens ("2B,SS" -> ["2B","SS"]). */
export function splitFilterTokens(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function compareTokens(a: string, b: string): number {
  const ia = POSITION_ORDER.indexOf(a);
  const ib = POSITION_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    if (ia !== ib) return ia - ib;
  }
  return a.localeCompare(b);
}

type PickemFilterProps = CustomFilterProps<Record<string, unknown>, unknown, PickemModel> & {
  /** Show a type-to-filter box above the list (for long value sets like players). */
  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * Split comma-joined cell values into singular checklist options (e.g. Pos "2B,SS"
   * yields "2B" and "SS"), and pass a row when it contains ANY selected token.
   */
  tokenize?: boolean;
};

/**
 * Community-only "pick-em" filter: a multi-select checkbox list of the distinct
 * values in the column. Replaces the built-in filter on the Team/Player columns so
 * users can toggle which fantasy teams (or players) are visible. (The built-in Set
 * and Multi filters are Enterprise, so we implement the equivalent ourselves.) Long
 * value sets can opt into a search box via `searchable`. Pos uses `tokenize` so the
 * list is singular positions with contains-any matching.
 */
export function PickemFilter({
  model,
  onModelChange,
  getValue,
  api,
  searchable = false,
  searchPlaceholder = 'Search…',
  tokenize = false,
}: PickemFilterProps) {
  const [values, setValues] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  const collectValues = useCallback(() => {
    const found = new Set<string>();
    const add = (node: IRowNode<Record<string, unknown>>) => {
      const value = getValue(node);
      if (value == null || String(value).trim() === '') return;
      const raw = String(value);
      if (tokenize) {
        for (const token of splitFilterTokens(raw)) found.add(token);
      } else {
        found.add(raw);
      }
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
    setValues([...found].sort(tokenize ? compareTokens : (a, b) => a.localeCompare(b)));
  }, [api, getValue, model, tokenize]);

  useEffect(() => {
    collectValues();
  }, [collectValues]);

  const doesFilterPass = useCallback(
    ({ node }: IDoesFilterPassParams<Record<string, unknown>>) => {
      // Empty selection = no filter (show everything). Only a non-empty allow-list filters.
      if (model == null || model.length === 0) return true;
      const value = getValue(node);
      if (value == null) return false;
      if (tokenize) {
        const tokens = splitFilterTokens(String(value));
        return model.some((pick) => tokens.includes(pick));
      }
      return model.includes(String(value));
    },
    [model, getValue, tokenize],
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
