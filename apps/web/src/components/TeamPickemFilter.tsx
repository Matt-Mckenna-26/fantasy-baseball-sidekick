import { useCallback, useEffect, useState } from 'react';
import { useGridFilter, type CustomFilterProps } from 'ag-grid-react';
import type { IDoesFilterPassParams, IRowNode } from 'ag-grid-community';
import styles from '../pages/StatsPage.module.css';

/** Selected team/owner names to show. `null` model = filter inactive (show all). */
type PickemModel = string[];

/**
 * Community-only "pick-em" filter: a multi-select checkbox list of the distinct
 * values in the column. Replaces the text contains/advanced filter on the Team
 * column so users can toggle which fantasy teams are visible. (The built-in Set
 * and Multi filters are Enterprise, so we implement the equivalent ourselves.)
 */
export function TeamPickemFilter({
  model,
  onModelChange,
  getValue,
  api,
}: CustomFilterProps<Record<string, unknown>, unknown, PickemModel>) {
  const [values, setValues] = useState<string[]>([]);

  const collectValues = useCallback(() => {
    const found = new Set<string>();
    api.forEachNode((node: IRowNode<Record<string, unknown>>) => {
      const value = getValue(node);
      if (value != null && String(value).trim() !== '') found.add(String(value));
    });
    setValues([...found].sort((a, b) => a.localeCompare(b)));
  }, [api, getValue]);

  useEffect(() => {
    collectValues();
  }, [collectValues]);

  const doesFilterPass = useCallback(
    ({ node }: IDoesFilterPassParams<Record<string, unknown>>) => {
      if (model == null) return true;
      const value = getValue(node);
      return value != null && model.includes(String(value));
    },
    [model, getValue],
  );

  // Recompute the list whenever the menu opens so it tracks the current rows.
  useGridFilter({ doesFilterPass, afterGuiAttached: collectValues });

  const isChecked = (value: string) => model == null || model.includes(value);

  const toggle = (value: string) => {
    const current = new Set(model ?? values);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    const next = values.filter((v) => current.has(v));
    // All selected -> deactivate (no filter icon); otherwise store the subset.
    onModelChange(next.length === values.length ? null : next);
  };

  return (
    <div className={styles.pickem}>
      <div className={styles.pickemActions}>
        <button type="button" onClick={() => onModelChange(null)}>
          Select all
        </button>
        <button type="button" onClick={() => onModelChange([])}>
          Clear
        </button>
      </div>
      <ul className={styles.pickemList}>
        {values.length === 0 ? (
          <li className={styles.pickemEmpty}>No teams</li>
        ) : (
          values.map((value) => (
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
