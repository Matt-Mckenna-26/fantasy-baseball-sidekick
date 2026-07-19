import { EntityAvatar } from './EntityAvatar';

/** Player headshot sprite with an initials fallback (shared by Rosters and Stats). */
export function PlayerAvatar({
  fullName,
  headshotUrl,
  imgLoading,
  imgCrossOrigin,
}: {
  fullName: string;
  headshotUrl?: string;
  imgLoading?: 'lazy' | 'eager';
  imgCrossOrigin?: '' | 'anonymous' | 'use-credentials';
}) {
  return (
    <EntityAvatar
      label={fullName}
      {...(headshotUrl ? { imageUrl: headshotUrl } : {})}
      {...(imgLoading ? { imgLoading } : {})}
      {...(imgCrossOrigin ? { imgCrossOrigin } : {})}
    />
  );
}
