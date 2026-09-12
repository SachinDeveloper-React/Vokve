import React, { memo } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  icon: LucideIcon;
  /** Colours the glyph only — the figure stays white. Pass a theme colour. */
  tint: string;
  /** Already formatted: "2,450", "245.6K". */
  value: string;
  label: string;
}

/**
 * One figure in the profile panel's stat strip.
 *
 * Colour is spent on the glyph and nothing else. Four tinted numbers across
 * one strip would each claim to be the important one; keeping the figures a
 * uniform white lets them be read as a set, with the icon doing the work of
 * saying which is which.
 *
 * Both lines are fixed to the panel's own foreground rather than a text token,
 * because the strip sits on a gradient that stays dark in light mode — where
 * `colors.text` is the navy that would vanish into it.
 */
export const ProfileStat = memo(({ icon, tint, value, label }: Props) => {
  const { colors } = useTheme();

  return (
    <VStack flex={1} gap="xxs" align="center" px="xxs">
      <HStack align="center" gap="xs">
        <Icon as={icon} size="xs" tint={tint} />
        <AppText
          variant="micro"
          numberOfLines={1}
          style={{ color: colors.tierForeground }}
        >
          {value}
        </AppText>
      </HStack>

      <AppText
        variant="miniMicro"
        numberOfLines={1}
        style={{
          color: withAlpha(colors.tierForeground, 0.6),
        }}
      >
        {label}
      </AppText>
    </VStack>
  );
});

ProfileStat.displayName = 'ProfileStat';
