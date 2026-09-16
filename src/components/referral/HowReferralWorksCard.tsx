import React, { Fragment, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ArrowRight,
  Check,
  Gift,
  Send,
  ShieldCheck,
  UserPlus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';

interface Step {
  icon: LucideIcon;
  title: string;
  detail: string;
}

interface Props {
  /** Coins to the inviter per qualifying friend — the server's figure (RULES F3). */
  inviterCoins: number;
  /** Coins to the friend. */
  inviteeCoins: number;
  /** What qualifies, in the user's words — "your friend's first workout". */
  qualifier: string;
}

/**
 * The four steps, in the order they happen. The shape is the product's and
 * is written here; the amounts and the qualifying event are the server's,
 * because the owner can change them and a card that said "300" after the
 * rate became 20 would be the lie users screenshot.
 */
function stepsFor({ inviterCoins, inviteeCoins, qualifier }: Props): Step[] {
  return [
    {
      icon: Send,
      title: '1. Share Code',
      detail: 'Share your referral code with friends.',
    },
    {
      icon: UserPlus,
      title: '2. Friend Joins',
      detail:
        'Your friend creates an account with your code — or adds it in the app within a week.',
    },
    {
      icon: ShieldCheck,
      title: '3. First Workout',
      detail: `The reward unlocks on ${qualifier}.`,
    },
    {
      icon: Gift,
      title: '4. Get Reward',
      detail:
        inviterCoins === inviteeCoins
          ? `You both get ${inviterCoins} coins, once per friend.`
          : `You get ${inviterCoins} coins and your friend gets ${inviteeCoins}, once per friend.`,
    },
  ];
}

/**
 * How a referral turns into coins, as four steps across.
 *
 * Across rather than down: the steps are a sequence, and a column of four
 * would read as a list of features rather than as one thing happening after
 * another. The arrows between them are what makes that point without a word.
 *
 * The note underneath is the one rule people ask about: a referral pays once,
 * and the daily goal is not part of the deal.
 */
export const HowReferralWorksCard = memo((props: Props) => {
  const { colors, isDark } = useTheme();
  const steps = stepsFor(props);

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <AppText variant="h3">How Referral Works</AppText>

        <HStack align="start" gap="xxs">
          {steps.map((step, index) => (
            <Fragment key={step.title}>
              {index > 0 ? (
                <View style={styles.arrow}>
                  <Icon as={ArrowRight} size="xs" color="textTertiary" />
                </View>
              ) : null}

              <VStack
                flex={1}
                gap="xs"
                accessible
                accessibilityLabel={`${step.title}. ${step.detail}`}
              >
                <IconBadge
                  icon={step.icon}
                  tint={index === 2 ? colors.primary : colors.textSecondary}
                  size={38}
                  variant={index === 2 ? 'solid' : 'muted'}
                />
                <AppText
                  variant="miniMicro"
                  numberOfLines={2}
                  style={styles.title}
                >
                  {step.title}
                </AppText>
                <AppText
                  variant="miniMicro"
                  color="textSecondary"
                  numberOfLines={3}
                >
                  {step.detail}
                </AppText>
              </VStack>
            </Fragment>
          ))}
        </HStack>

        <HStack
          align="center"
          gap="xs"
          px="md"
          py="sm"
          style={[
            styles.note,
            { backgroundColor: withAlpha(colors.success, isDark ? 0.16 : 0.1) },
          ]}
        >
          <Icon as={Check} size="xs" tint={colors.success} strokeWidth={3} />
          <AppText
            variant="miniMicro"
            numberOfLines={2}
            style={[styles.noteText, { color: colors.success }]}
          >
            One referral = One-time reward. No extra coins for daily goal.
          </AppText>
        </HStack>
      </VStack>
    </Card>
  );
});

HowReferralWorksCard.displayName = 'HowReferralWorksCard';

const styles = StyleSheet.create({
  /** Sits level with the icon discs rather than the column's centre. */
  arrow: { paddingTop: 12 },
  title: { fontWeight: '600' },
  note: { borderRadius: radius.md },
  noteText: { flexShrink: 1 },
});
