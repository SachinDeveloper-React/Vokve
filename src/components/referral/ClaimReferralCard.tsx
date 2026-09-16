import React, { memo, useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { CheckCircle2, Clock, Gift, Ticket } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { AppliedReferral } from '../../types/models';
import { withAlpha } from '../../utils/color';
import { formatCoins, formatRelativeDay } from '../../utils/format';
import { Input } from '../form/Input';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Props {
  /** Coins the friend who joins gets — the server's figure (RULES F3). */
  rewardCoins: number;
  /** What a friend has to do to be paid — "your friend's first workout". */
  qualifier: string;
  /** The code this user already joined on, or null. */
  applied: AppliedReferral | null;
  /** Whether a code can still be applied (none yet, window open — F2). */
  canApply: boolean;
  /** ISO-8601 when the window shuts; null once it has or a code is in. */
  applyBy: string | null;
  isApplying: boolean;
  /** Field message from a refused code; cleared as the user types. */
  error: string | null;
  onApply: (code: string) => void;
  onChangeCode?: () => void;
}

/**
 * The invitee's side of the programme: claim the coins a friend's code
 * promises, or see where that claim stands.
 *
 * Three states, one card. Before a code: the field and the promise, with the
 * amount the server sent — never a number typed into the app, because the
 * owner sets it. After a code: who it came from and that the coins wait on
 * the qualifying event, so a user who sees nothing in their wallet yet knows
 * why. Once paid: the tick. A closed window shows nothing rather than an
 * invitation it would then refuse.
 */
export const ClaimReferralCard = memo(
  ({
    rewardCoins,
    qualifier,
    applied,
    canApply,
    applyBy,
    isApplying,
    error,
    onApply,
    onChangeCode,
  }: Props) => {
    const { colors, isDark } = useTheme();
    const [code, setCode] = useState('');

    const onChange = useCallback(
      (next: string) => {
        setCode(next.toUpperCase());
        onChangeCode?.();
      },
      [onChangeCode],
    );
    const submit = useCallback(() => {
      const trimmed = code.trim();
      if (trimmed.length > 0) {
        onApply(trimmed);
      }
    }, [code, onApply]);

    if (applied) {
      const rewarded = applied.status === 'rewarded';
      return (
        <Card
          radius="xl"
          padding="base"
          style={{
            backgroundColor: withAlpha(
              rewarded ? colors.success : colors.primary,
              isDark ? 0.12 : 0.07,
            ),
          }}
        >
          <HStack align="start" gap="md">
            <IconBadge
              icon={rewarded ? CheckCircle2 : Clock}
              tint={rewarded ? colors.success : colors.primary}
              size={38}
              variant="muted"
            />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">
                {rewarded
                  ? `${formatCoins(applied.rewardCoins)} coins claimed`
                  : `${formatCoins(applied.rewardCoins)} coins on the way`}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {rewarded
                  ? `You joined on ${applied.inviterName}'s code and your first workout unlocked the bonus.`
                  : `You joined on ${
                      applied.inviterName
                    }'s code ${formatRelativeDay(
                      applied.appliedAt,
                    ).toLowerCase()}. Finish your first workout and the coins land in your wallet.`}
              </AppText>
            </VStack>
          </HStack>
        </Card>
      );
    }

    if (!canApply) {
      return null;
    }

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <HStack align="start" gap="md">
            <IconBadge
              icon={Gift}
              tint={colors.brandAccent}
              size={38}
              variant="muted"
            />
            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">
                {`Skipped a friend's code at sign-up? Claim ${formatCoins(
                  rewardCoins,
                )} coins`}
              </AppText>
              <AppText variant="caption" color="textSecondary">
                {`Apply it${
                  applyBy
                    ? ` by ${formatRelativeDay(applyBy).toLowerCase()}`
                    : ''
                } and the coins are yours after ${qualifier.replace(
                  "your friend's",
                  'your',
                )}.`}
              </AppText>
            </VStack>
          </HStack>

          <Box>
            <Input
              value={code}
              onChangeText={onChange}
              placeholder="Enter code"
              accessibilityLabel="Friend's referral code"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              error={error ?? undefined}
              leading={<Icon as={Ticket} size="md" color="textTertiary" />}
              containerStyle={styles.field}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
          </Box>

          <Button
            label={`Claim ${formatCoins(rewardCoins)} coins`}
            variant="brand"
            fullWidth
            loading={isApplying}
            disabled={isApplying || code.trim().length < 4}
            onPress={submit}
          />
        </VStack>
      </Card>
    );
  },
);

ClaimReferralCard.displayName = 'ClaimReferralCard';

const styles = StyleSheet.create({
  /** A little taller than a text field: the code is the card's one control. */
  field: { minHeight: 52 },
});
