import type { StatValue } from '@fcm/contracts';
import { EntityAvatar } from '../EntityAvatar';
import { PlayerAvatar } from '../PlayerAvatar';

/**
 * A row being compared in the grouped chart / tiles / dialog. Shared by the Players page
 * (kind 'player', headshot + owner subtitle) and the Analyze League page (kind 'team',
 * logo, no subtitle) so both render an identical compare experience.
 */
export interface CompareEntity {
  id: string;
  name: string;
  /** Owner for players; unset for teams. */
  subtitle?: string;
  /** Headshot (players) or team logo (teams). */
  imageUrl?: string;
  kind: 'player' | 'team';
  stats: StatValue[];
  /** Value+ index (100 = league average); set for players in a scored pool. */
  sgptPlus?: number;
  /** Value+ rank across hitters + pitchers (1 = best). */
  sgptRank?: number;
}

/** Lightweight option shape for the compare search dialog. */
export interface CompareEntityOption {
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  kind: 'player' | 'team';
}

/** Renders the right circular avatar for an entity: player headshot or team logo. */
export function CompareAvatar({
  name,
  imageUrl,
  kind,
}: {
  name: string;
  imageUrl?: string;
  kind: 'player' | 'team';
}) {
  if (kind === 'team') {
    return <EntityAvatar label={name} {...(imageUrl ? { imageUrl } : {})} />;
  }
  return <PlayerAvatar fullName={name} {...(imageUrl ? { headshotUrl: imageUrl } : {})} />;
}
