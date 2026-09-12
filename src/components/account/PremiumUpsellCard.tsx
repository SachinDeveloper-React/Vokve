import React, { memo } from 'react';
import { ChevronRight, Crown } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  onPressUpgrade: () => void;
}

/**
 * The one paid pitch on the account screen.
 *
 * It is a tinted card rather than another white one so it reads as an offer
 * and not as a settings group — the surrounding sections are all things the
 * user already owns, and an upsell that looked identical to them would either
 * be missed or resented. The wash is derived from the wordmark's orange, which
 * is also the button's fill, so the whole card reads as one call to action.
 */
export const PremiumUpsellCard = memo(({ onPressUpgrade }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Card
      radius="xl"
      padding="base"
      style={{
        backgroundColor: withAlpha(colors.brandAccent, isDark ? 0.12 : 0.08),
        borderColor: withAlpha(colors.brandAccent, isDark ? 0.24 : 0.16),
      }}
    >
      <HStack align="center" gap="md">
        {/*
          A bare glyph, not an IconBadge: the card is already a tinted surface,
          and a tinted disc on top of it would be a second wash of the same
          orange with nothing to separate the two.
        */}
        <Icon as={Crown} size="lg" tint={colors.brandAccent} />

        <VStack flex={1} gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: colors.brandAccent }}
          >
            VOKVE Premium
          </AppText>
          {/*
            `micro` rather than `caption`: the row also carries a glyph and a
            button, and at 13pt this sentence wraps to four lines in what is
            left of a 375pt screen.
          */}
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            Unlock exclusive rewards and premium features.
          </AppText>
        </VStack>

        <Button
          label="Upgrade Now"
          variant="brand"
          size="xs"
          iconPosition="trailing"
          icon={<Icon as={ChevronRight} size="xs" color="primaryForeground" />}
          onPress={onPressUpgrade}
        />
      </HStack>
    </Card>
  );
});

PremiumUpsellCard.displayName = 'PremiumUpsellCard';
