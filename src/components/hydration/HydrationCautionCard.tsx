import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Gauge, TriangleAlert } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { HydrationCaution } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  caution: HydrationCaution;
}

/**
 * The server's health note about today's water (RULES Y1b).
 *
 * Not dismissible, and deliberately not an `Alert`: an Alert reports
 * something that has gone wrong and can be waved away, where this is a fact
 * about the day that stays true until the day ends — or, for the rate note,
 * until the hour passes and the server stops sending it. Letting it be
 * dismissed would mean the one screen that could warn somebody about
 * drinking dangerously also offers them a way not to hear it.
 *
 * Worded entirely by the server, so the sentence a user reads about diluting
 * their blood salts can be corrected without shipping a release. The app
 * chooses only the icon, from the note's `kind`.
 *
 * Phrased as information rather than instruction throughout, and it carries
 * the same disclaimer the vitals screens do: Vokve is not a medical device,
 * and the right end of this conversation is a doctor.
 */
export const HydrationCautionCard = memo(({ caution }: Props) => {
  const { colors, isDark } = useTheme();
  const tint = caution.kind === 'rate' ? colors.destructive : colors.warning;

  return (
    <Box
      radius="xl"
      p="base"
      style={{ backgroundColor: withAlpha(tint, isDark ? 0.2 : 0.1) }}
      accessibilityRole="alert"
    >
      <HStack gap="md" align="center">
        <IconBadge
          icon={caution.kind === 'rate' ? Gauge : TriangleAlert}
          tint={tint}
          size={34}
          shape="rounded"
        />

        <VStack flex={1} gap="xxs">
          <AppText variant="bodyStrong">{caution.title}</AppText>
          <AppText variant="micro" color="textSecondary">
            {caution.message}
          </AppText>
          <AppText variant="miniMicro" color="textTertiary" style={styles.note}>
            Vokve is not a medical device. This is general wellness
            information, not medical advice.
          </AppText>
        </VStack>
      </HStack>
    </Box>
  );
});

HydrationCautionCard.displayName = 'HydrationCautionCard';

const styles = StyleSheet.create({
  note: { marginTop: 2 },
});
