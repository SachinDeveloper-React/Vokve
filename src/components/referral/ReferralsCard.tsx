import React, { Fragment, memo } from 'react';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { Referral } from '../../types/models';
import { formatLongDate } from '../../utils/date';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Avatar } from '../media/Avatar';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { CoinAmount } from '../wallet/CoinAmount';
import { Pressable } from '../form/Pressable';

interface RowProps {
  referral: Referral;
}

const ReferralRow = memo(({ referral }: RowProps) => {
  const { colors } = useTheme();
  const rewarded = referral.status === 'rewarded';

  return (
    <HStack
      align="center"
      gap="md"
      py="sm"
      accessible
      accessibilityLabel={`${referral.name}, joined on ${formatLongDate(
        referral.joinedAt,
      )}, ${
        rewarded
          ? `${referral.rewardCoins} coins, reward claimed`
          : 'pending verification'
      }`}
    >
      <Avatar name={referral.name} size="sm" />

      <VStack flex={1} gap="xxs">
        <AppText variant="bodyStrong" numberOfLines={1}>
          {referral.name}
        </AppText>
        <AppText variant="miniMicro" color="textSecondary" numberOfLines={1}>
          {`Joined on ${formatLongDate(referral.joinedAt)}`}
        </AppText>
      </VStack>

      <VStack align="end" gap="xxs">
        {rewarded ? (
          <CoinAmount amount={referral.rewardCoins} size="sm" signed />
        ) : (
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: colors.brandAccent }}
          >
            Pending
          </AppText>
        )}
        <AppText
          variant="miniMicro"
          numberOfLines={1}
          style={{ color: rewarded ? colors.success : colors.textSecondary }}
        >
          {rewarded ? 'Reward Claimed' : 'Verification'}
        </AppText>
      </VStack>

      <Icon as={ChevronRight} size="xs" color="textTertiary" />
    </HStack>
  );
});

ReferralRow.displayName = 'ReferralRow';

interface Props {
  /** Newest first. Only the first few are shown. */
  referrals: Referral[];
  onPressViewAll: () => void;
}

/** How much of the list the card shows before "View All". */
const MAX_ROWS = 3;

/**
 * Who has joined lately, and what each one paid.
 *
 * A pending row says "Pending" where a rewarded one shows the coins, rather
 * than showing "+20" greyed out: the coins have not been paid, and a figure
 * that looks earned but is not is the kind of thing users screenshot when it
 * never arrives.
 */
export const ReferralsCard = memo(({ referrals, onPressViewAll }: Props) => {
  const { colors } = useTheme();
  const recent = referrals.slice(0, MAX_ROWS);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3" numberOfLines={1}>
            Your Referrals
          </AppText>

          <Pressable
            onPress={onPressViewAll}
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel="View all referrals"
          >
            <HStack align="center" gap="xxs">
              <AppText variant="micro" color="primary">
                View All
              </AppText>
              <Icon as={ChevronRight} size="xs" tint={colors.primary} />
            </HStack>
          </Pressable>
        </HStack>

        {recent.length === 0 ? (
          <AppText variant="micro" color="textSecondary">
            Nobody has joined on your code yet. Share it above to get started.
          </AppText>
        ) : (
          <VStack>
            {recent.map((referral, index) => (
              <Fragment key={referral.id}>
                {index > 0 ? <Divider /> : null}
                <ReferralRow referral={referral} />
              </Fragment>
            ))}
          </VStack>
        )}
      </VStack>
    </Card>
  );
});

ReferralsCard.displayName = 'ReferralsCard';
