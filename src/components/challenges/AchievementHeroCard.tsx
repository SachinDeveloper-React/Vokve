import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Lock, Sparkles } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import type { AchievementDetail } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { METRIC_STYLE, formatBadgeValue } from './metrics';

const DISC = moderateScale(96);

interface Props {
  detail: AchievementDetail;
}

/**
 * The badge itself: the ring, what it is called, what it takes, and whether
 * it has been won.
 *
 * The figure sits on the ring rather than inside it. A locked badge drops the
 * colour entirely and carries a padlock, exactly as the shelf's small rings do
 * — the two have to be recognisably the same object, because this screen is
 * what a tap on one of them opens.
 *
 * The status is a word as well as a colour. "Unlocked" in green and a grey
 * padlock say the same thing twice on purpose: a reader who cannot tell the
 * two rings apart still knows which this is.
 */
export const AchievementHeroCard = memo(({ detail }: Props) => {
  const { colors, isDark } = useTheme();
  const { achievement, unlocked } = detail;
  const tint = colors[METRIC_STYLE[achievement.metric].tint];
  const status = unlocked ? colors.success : colors.textTertiary;

  return (
    <Card radius="xl" padding="base">
      <HStack align="center" gap="base">
        <VStack align="center">
          <View
            style={[
              styles.disc,
              unlocked
                ? {
                    borderColor: tint,
                    backgroundColor: withAlpha(tint, isDark ? 0.22 : 0.1),
                  }
                : { borderColor: colors.border, backgroundColor: colors.muted },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Icon
              as={unlocked ? Sparkles : Lock}
              size="xl"
              tint={unlocked ? colors.gold : colors.textTertiary}
            />
          </View>

          {/* The figure rides the ring's lower edge, as on the design. */}
          <View
            style={[
              styles.value,
              { backgroundColor: unlocked ? tint : colors.textQuaternary },
            ]}
          >
            <AppText
              variant="micro"
              numberOfLines={1}
              style={{ color: colors.card }}
            >
              {formatBadgeValue(achievement.value)}
            </AppText>
          </View>
        </VStack>

        <VStack flex={1} gap="xs">
          <AppText variant="h1" numberOfLines={2}>
            {detail.title}
          </AppText>

          <AppText variant="caption" color="textSecondary">
            {detail.description}
          </AppText>

          <HStack
            align="center"
            gap="xs"
            px="md"
            py="xs"
            style={[
              styles.chip,
              { backgroundColor: withAlpha(status, isDark ? 0.22 : 0.12) },
            ]}
            accessible
            accessibilityLabel={unlocked ? 'Unlocked' : 'Locked'}
          >
            <Icon as={unlocked ? Check : Lock} size="xs" tint={status} />
            <AppText variant="micro" style={{ color: status }}>
              {unlocked ? 'Unlocked' : 'Locked'}
            </AppText>
          </HStack>

          <AppText variant="miniMicro" color="textTertiary" numberOfLines={2}>
            {detail.note}
          </AppText>
        </VStack>
      </HStack>
    </Card>
  );
});

AchievementHeroCard.displayName = 'AchievementHeroCard';

const styles = StyleSheet.create({
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Pulled up over the ring's edge rather than placed under it, so the pair
  // reads as one badge instead of a disc with a caption.
  value: {
    marginTop: -moderateScale(14),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(2),
    borderRadius: radius.pill,
  },
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill },
});
