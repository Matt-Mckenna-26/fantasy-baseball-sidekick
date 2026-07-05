import { useState } from 'react';
import styles from './dataTable.module.css';

/** Initials for avatar fallback when no image URL is available. */
function entityInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

/** Circular avatar with an image or initials fallback (players, teams, leagues). */
export function EntityAvatar({
  label,
  imageUrl,
  className,
}: {
  label: string;
  imageUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <span
      className={[styles.entityAvatar, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          className={styles.entityAvatarImg}
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.entityAvatarFallback}>{entityInitials(label)}</span>
      )}
    </span>
  );
}

/** Avatar badge with label text to its right. */
export function EntityLabel({
  label,
  imageUrl,
  className,
}: {
  label: string;
  imageUrl?: string;
  className?: string;
}) {
  return (
    <span className={[styles.entityLabel, className].filter(Boolean).join(' ')}>
      <EntityAvatar label={label} {...(imageUrl ? { imageUrl } : {})} />
      <span>{label}</span>
    </span>
  );
}
