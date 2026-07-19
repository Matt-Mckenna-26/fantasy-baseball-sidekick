import { inferPlayerPositionType, type MentionedPlayer, type Player } from '@fcm/contracts';

/**
 * Per-chat-turn registry of the players the tools actually fetched (with their Yahoo
 * playerId and identity), keyed by a normalized name. Snapshots deliberately strip ids to
 * save tokens, so this keeps full identities server-side. After the model replies, the
 * orchestrator resolves the names it tagged ([[p:Name]]) against this registry to build the
 * response's playersMentioned list - so the client can render the same rank cards keyed on
 * playerId. Never exposed to the model.
 */
export class PlayerRegistry {
  private byName = new Map<string, MentionedPlayer>();

  /** Record a Yahoo Player DTO. `posType` overrides inference when the table context is known. */
  addPlayer(player: Player, posType?: 'B' | 'P'): void {
    if (!player.playerId || !player.fullName) return;
    const positionType =
      posType ??
      player.positionType ??
      inferPlayerPositionType({
        ...(player.positionType ? { positionType: player.positionType } : {}),
        eligiblePositions: player.eligiblePositions,
      });
    const entry: MentionedPlayer = {
      playerId: player.playerId,
      fullName: player.fullName,
      ...(positionType ? { positionType } : {}),
      ...(player.mlbTeamAbbr ? { mlbTeamAbbr: player.mlbTeamAbbr } : {}),
      ...(player.headshotUrl ? { headshotUrl: player.headshotUrl } : {}),
    };
    // Keep the first (or richer) entry; only replace when the new one adds identity fields.
    const existing = this.byName.get(normalizeName(player.fullName));
    if (!existing || (!existing.headshotUrl && entry.headshotUrl)) {
      this.byName.set(normalizeName(player.fullName), entry);
    }
  }

  addPlayers(players: Player[], posType?: 'B' | 'P'): void {
    for (const p of players) this.addPlayer(p, posType);
  }

  /** Resolve tagged names to known players, deduped by playerId, preserving mention order. */
  resolve(names: string[]): MentionedPlayer[] {
    const out: MentionedPlayer[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      const hit = this.byName.get(normalizeName(name));
      if (hit && !seen.has(hit.playerId)) {
        seen.add(hit.playerId);
        out.push(hit);
      }
    }
    return out;
  }
}

/**
 * Normalize a player name for matching: lowercase, strip accents and punctuation, drop
 * common generational suffixes, and collapse whitespace. Keeps model-tagged names robust
 * to minor formatting differences from the underlying data.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
