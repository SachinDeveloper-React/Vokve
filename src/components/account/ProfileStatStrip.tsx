import React, { memo } from 'react';
import { Flame, Footprints, Star, Trophy } from 'lucide-react-native';
import { darkColors, useTheme } from '../../theme';
import { formatCoins, formatCompactNumber } from '../../utils/format';
import { Divider } from '../layout/Divider';
import { HStack } from '../layout/Stack';
import { ProfileStat } from './ProfileStat';

interface Props {
  coins: number;
  streakDays: number;
  achievements: number;
  /** Lifetime, unformatted — the strip compacts it to `245.6K`. */
  totalSteps: number;
}

/**
 * The four figures along the foot of the profile panel.
 *
 * Accents are read from `darkColors` rather than from the active theme. The
 * panel above is a fixed dark gradient in both themes, and light mode's gold
 * is a mustard tuned for white cards that goes muddy against it — the strip
 * needs the palette that matches the surface it is actually drawn on, not the
 * one the rest of the screen uses.
 *
 * Steps are compacted rather than grouped: six digits beside three other
 * figures in a 375pt row leaves nothing legible, and nobody reads a lifetime
 * step count to the unit.
 */
export const ProfileStatStrip = memo(
  ({ coins, streakDays, achievements, totalSteps }: Props) => {
    const { colors } = useTheme();

    return (
      // `align="stretch"` is what gives the rules between the figures a height
      // to take — a vertical Divider sizes itself by stretching.
      <HStack align="stretch">
        <ProfileStat
          icon={Star}
          tint={darkColors.gold}
          value={formatCoins(coins)}
          label="Coins"
        />

        <Divider orientation="vertical" tint={colors.overlayMedium} />

        <ProfileStat
          icon={Flame}
          tint={darkColors.brandAccent}
          value={String(streakDays)}
          label="Streak Days"
        />

        <Divider orientation="vertical" tint={colors.overlayMedium} />

        <ProfileStat
          icon={Trophy}
          tint={darkColors.tierProgress}
          value={String(achievements)}
          label="Achievements"
        />

        <Divider orientation="vertical" tint={colors.overlayMedium} />

        <ProfileStat
          icon={Footprints}
          tint={darkColors.avatarCyan}
          // Upper-cased so the suffix matches the weight of the digits beside
          // it; a lowercase `k` reads as a typo next to a bold figure.
          value={formatCompactNumber(totalSteps).toUpperCase()}
          label="Total Steps"
        />
      </HStack>
    );
  },
);

ProfileStatStrip.displayName = 'ProfileStatStrip';
