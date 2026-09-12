import React, { memo } from 'react';
import { ChevronRight, Gift } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  onPressDailyOffers: () => void;
}

/**
 * The nudge to come back tomorrow.
 *
 * Tinted like the account screen's premium card and for the same reason: it
 * is a prompt, not a settings group, and it has to read as one against the
 * neutral cards around it. The button is the outlined orange rather than the
 * filled one — the filled orange is what "View Details" wears on every card
 * in the row above, and a second filled button in a different place would
 * dilute what it means.
 */
export const DailyOffersCard = memo(({ onPressDailyOffers }: Props) => {
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
        <Icon as={Gift} size="xl" tint={colors.brandAccent} />

        <VStack flex={1} gap="xxs">
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: colors.brandAccent }}
          >
            Check back daily!
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={2}>
            New rewards, special deals and surprise offers just for you.
          </AppText>
        </VStack>

        <Button
          label="Daily Offers"
          variant="brandOutline"
          size="xs"
          iconPosition="trailing"
          icon={<Icon as={ChevronRight} size="xs" tint={colors.brandAccent} />}
          onPress={onPressDailyOffers}
        />
      </HStack>
    </Card>
  );
});

DailyOffersCard.displayName = 'DailyOffersCard';
