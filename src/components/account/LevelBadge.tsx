import React, { memo } from 'react';
import { useTheme } from '../../theme';
import { Tag } from '../ui/Tag';

interface Props {
  level: number;
}

/**
 * The orange pill beside a user's name.
 *
 * A `Tag` in the wordmark's orange rather than a tinted `Chip`: it sits on
 * the dark profile panel and is the only badge on it, so it is meant to be
 * loud — a 12% wash of orange on near-black would leave the level unreadable.
 */
export const LevelBadge = memo(({ level }: Props) => {
  const { colors } = useTheme();

  return <Tag label={`Level ${level}`} tint={colors.brandAccent} />;
});

LevelBadge.displayName = 'LevelBadge';
