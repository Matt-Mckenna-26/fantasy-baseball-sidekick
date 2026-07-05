import type { RosterSlot, StatColumn, StatValue } from '@fcm/contracts';

/** Shown in place of a total for rate/composite columns that cannot be summed. */
export const NO_TOTAL = '\u2014';

/** True when a value is a Yahoo ratio like "1234/4567" (e.g. the H/AB display stat). */
function isRatio(value: string): boolean {
  return /^\d+\/\d+$/.test(value.trim());
}

/** Sum ratio strings component-wise: ["1/4", "2/5"] -> "3/9". */
function sumRatios(values: (StatValue['value'] | undefined)[]): string | null {
  let num = 0;
  let den = 0;
  let found = false;
  for (const value of values) {
    if (typeof value !== 'string' || !isRatio(value)) continue;
    const [a, b] = value.trim().split('/');
    num += Number(a);
    den += Number(b);
    found = true;
  }
  return found ? `${num}/${den}` : null;
}

/** Parse a stat cell into a finite number, treating "-"/blank/non-numeric as absent. */
function toNumber(value: StatValue['value'] | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '-') return null;
    const n = Number(trimmed.startsWith('.') ? `0${trimmed}` : trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function columnKey(columns: StatColumn[], label: string, id: string): string | undefined {
  return columns.find((c) => c.label === label)?.key ?? columns.find((c) => c.key === id)?.key;
}

function statValue(
  stats: Map<string, StatValue['value']>,
  columns: StatColumn[],
  label: string,
  id: string,
): StatValue['value'] | undefined {
  const key = columnKey(columns, label, id);
  if (key) return stats.get(key);
  return stats.get(id) ?? stats.get(label);
}

function parseHitsAtBats(value: StatValue['value'] | undefined): { hits: number; ab: number } | null {
  if (typeof value !== 'string' || !isRatio(value)) return null;
  const parts = value.trim().split('/').map(Number);
  const hits = parts[0];
  const ab = parts[1];
  if (hits === undefined || ab === undefined || !Number.isFinite(hits) || !Number.isFinite(ab) || ab <= 0) {
    return null;
  }
  return { hits, ab };
}

/** Convert baseball IP ("12.1" = 12⅓) to decimal innings for rate math. */
function parseInnings(value: StatValue['value'] | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return null;
  const [whole, frac = '0'] = trimmed.split('.');
  const w = Number(whole);
  const f = Number(frac[0] ?? '0');
  if (!Number.isFinite(w) || !Number.isFinite(f) || f > 2) return null;
  return w + f / 3;
}

function playerPlateAppearances(
  stats: Map<string, StatValue['value']>,
  columns: StatColumn[],
  ab: number,
): number | null {
  const pa = toNumber(statValue(stats, columns, 'PA', '65'));
  if (pa !== null) return pa;

  const bb = toNumber(statValue(stats, columns, 'BB', '18'));
  const hbp = toNumber(statValue(stats, columns, 'HBP', '20'));
  const sf = toNumber(statValue(stats, columns, 'SF', '15'));
  if (bb === null && hbp === null && sf === null) return null;
  return ab + (bb ?? 0) + (hbp ?? 0) + (sf ?? 0);
}

function usesLeadingDot(
  slots: RosterSlot[],
  statsByPlayer: Map<string, Map<string, StatValue['value']>>,
  key: string | undefined,
): boolean {
  if (!key) return false;
  for (const slot of slots) {
    const value = statsByPlayer.get(slot.player.playerId)?.get(key);
    if (typeof value === 'string' && value.startsWith('.')) return true;
  }
  return false;
}

function formatRate(value: number, decimals: number, leadingDot: boolean): string {
  const fixed = value.toFixed(decimals);
  return leadingDot ? fixed.replace(/^0\./, '.') : fixed;
}

/**
 * Pool rate stats from H/AB and IP (and PA components when needed) instead of
 * averaging or summing the displayed rates directly.
 */
function deriveRateTotals(
  slots: RosterSlot[],
  columns: StatColumn[],
  statsByPlayer: Map<string, Map<string, StatValue['value']>>,
): Map<string, string> {
  const derived = new Map<string, string>();
  const hAbKey = columnKey(columns, 'H/AB', '60');
  const ipKey = columnKey(columns, 'IP', '50');
  const avgKey = columnKey(columns, 'AVG', '3');
  const obpKey = columnKey(columns, 'OBP', '4');
  const slgKey = columnKey(columns, 'SLG', '5');
  const opsKey = columnKey(columns, 'OPS', '55');
  const eraKey = columnKey(columns, 'ERA', '26');
  const whipKey = columnKey(columns, 'WHIP', '27');
  const tbKey = columnKey(columns, 'TB', '23');

  let totalHits = 0;
  let totalAb = 0;
  let totalTb = 0;
  let totalObpNum = 0;
  let totalPa = 0;
  let totalObpReach = 0;
  let totalObpDen = 0;
  let totalOpsWeighted = 0;
  let totalIp = 0;
  let totalEraWeighted = 0;
  let totalWhipWeighted = 0;
  let hasSlg = false;
  let hasObpFromRate = false;
  let hasObpFromComponents = false;
  let hasOpsWeighted = false;
  let hasEra = false;
  let hasWhip = false;

  for (const slot of slots) {
    const stats = statsByPlayer.get(slot.player.playerId);
    if (!stats) continue;

    const hAb = hAbKey ? parseHitsAtBats(stats.get(hAbKey)) : null;
    if (hAb) {
      totalHits += hAb.hits;
      totalAb += hAb.ab;

      const tb = tbKey ? toNumber(statValue(stats, columns, 'TB', '23')) : null;
      if (tb !== null) {
        totalTb += tb;
        hasSlg = true;
      } else {
        const slg = toNumber(statValue(stats, columns, 'SLG', '5'));
        if (slg !== null) {
          totalTb += slg * hAb.ab;
          hasSlg = true;
        }
      }

      const obp = toNumber(statValue(stats, columns, 'OBP', '4'));
      const pa = playerPlateAppearances(stats, columns, hAb.ab);
      if (obp !== null && pa !== null && pa > 0) {
        totalObpNum += obp * pa;
        totalPa += pa;
        hasObpFromRate = true;
      }

      const bb = toNumber(statValue(stats, columns, 'BB', '18'));
      const hbp = toNumber(statValue(stats, columns, 'HBP', '20'));
      const sf = toNumber(statValue(stats, columns, 'SF', '15'));
      if (bb !== null || hbp !== null || sf !== null) {
        totalObpReach += hAb.hits + (bb ?? 0) + (hbp ?? 0);
        totalObpDen += hAb.ab + (bb ?? 0) + (hbp ?? 0) + (sf ?? 0);
        hasObpFromComponents = true;
      }

      const ops = toNumber(statValue(stats, columns, 'OPS', '55'));
      if (ops !== null) {
        totalOpsWeighted += ops * hAb.ab;
        hasOpsWeighted = true;
      }
    }

    const ip = ipKey ? parseInnings(stats.get(ipKey)) : null;
    if (ip !== null && ip > 0) {
      totalIp += ip;
      const era = toNumber(statValue(stats, columns, 'ERA', '26'));
      const whip = toNumber(statValue(stats, columns, 'WHIP', '27'));
      if (era !== null) {
        totalEraWeighted += era * ip;
        hasEra = true;
      }
      if (whip !== null) {
        totalWhipWeighted += whip * ip;
        hasWhip = true;
      }
    }
  }

  const battingLeadingDot =
    usesLeadingDot(slots, statsByPlayer, avgKey) ||
    usesLeadingDot(slots, statsByPlayer, obpKey) ||
    usesLeadingDot(slots, statsByPlayer, slgKey) ||
    usesLeadingDot(slots, statsByPlayer, opsKey);

  if (avgKey && totalAb > 0) {
    derived.set(avgKey, formatRate(totalHits / totalAb, 3, battingLeadingDot));
  }

  let slgVal: number | null = null;
  if (hasSlg && totalAb > 0) {
    slgVal = totalTb / totalAb;
    if (slgKey) derived.set(slgKey, formatRate(slgVal, 3, battingLeadingDot));
  }

  let obpVal: number | null = null;
  if (hasObpFromRate && totalPa > 0) {
    obpVal = totalObpNum / totalPa;
  } else if (hasObpFromComponents && totalObpDen > 0) {
    obpVal = totalObpReach / totalObpDen;
  }
  if (obpKey && obpVal !== null) {
    derived.set(obpKey, formatRate(obpVal, 3, battingLeadingDot));
  }

  if (opsKey) {
    if (obpVal !== null && slgVal !== null) {
      derived.set(opsKey, formatRate(obpVal + slgVal, 3, battingLeadingDot));
    } else if (hasOpsWeighted && totalAb > 0) {
      derived.set(opsKey, formatRate(totalOpsWeighted / totalAb, 3, battingLeadingDot));
    }
  }

  if (eraKey && totalIp > 0 && hasEra) {
    derived.set(eraKey, (totalEraWeighted / totalIp).toFixed(2));
  }
  if (whipKey && totalIp > 0 && hasWhip) {
    derived.set(whipKey, (totalWhipWeighted / totalIp).toFixed(2));
  }

  return derived;
}

/**
 * Sum each aggregatable column across the given roster slots for the currently
 * loaded window (the values already live in `statsByPlayer`). Rate/composite
 * columns are pooled from H/AB, IP, and PA components when available. H/AB-style
 * ratios sum numerators and denominators. Non-numeric cells are skipped.
 */
export function computeRosterTotals(
  slots: RosterSlot[],
  columns: StatColumn[],
  statsByPlayer: Map<string, Map<string, StatValue['value']>>,
): Map<string, number | string | typeof NO_TOTAL> {
  const derivedRates = deriveRateTotals(slots, columns, statsByPlayer);
  const totals = new Map<string, number | string | typeof NO_TOTAL>();

  for (const col of columns) {
    if (col.aggregatable === false) {
      totals.set(col.key, derivedRates.get(col.key) ?? NO_TOTAL);
      continue;
    }
    const values = slots.map(
      (slot) => statsByPlayer.get(slot.player.playerId)?.get(col.key),
    );
    const ratioTotal = sumRatios(values);
    if (ratioTotal !== null) {
      totals.set(col.key, ratioTotal);
      continue;
    }
    let sum = 0;
    for (const value of values) {
      const n = toNumber(value);
      if (n !== null) sum += n;
    }
    totals.set(col.key, Math.round(sum * 100) / 100);
  }
  return totals;
}
