import { EntityAvatar } from './EntityAvatar';

/** Player headshot sprite with an initials fallback (shared by Rosters and Stats). */
export function PlayerAvatar({ fullName, headshotUrl }: { fullName: string; headshotUrl?: string }) {
  return (
    <EntityAvatar label={fullName} {...(headshotUrl ? { imageUrl: headshotUrl } : {})} />
  );
}
