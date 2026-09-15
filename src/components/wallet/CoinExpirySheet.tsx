import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { CalendarDays } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { CoinExpiry } from '../../stores/coinsStore';
import { withAlpha } from '../../utils/color';
import { toIsoDate, formatLongDate } from '../../utils/date';
import { formatCoins } from '../../utils/format';
import { BottomSheet } from '../disclosure/BottomSheet';
import { Box } from '../layout/Box';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { IconBadge } from '../ui/IconBadge';

interface Rule {
  title: string;
  detail: string;
}

/**
 * The rules, worded from the figures in force rather than written out, so a
 * window the server changes to sixty days does not leave a sheet that still
 * promises ninety.
 */
function rulesFor(expiry: CoinExpiry): Rule[] {
  const window = `${expiry.windowDays} days`;
  const warn = [...expiry.warnDays].sort((a, b) => b - a);
  const reminders =
    warn.length === 0
      ? 'You can always check the countdown here in the wallet.'
      : `You get a heads-up ${warn
          .map(days => `${days} day${days === 1 ? '' : 's'}`)
          .join(' and ')} before, here and by notification.`;

  return [
    {
      title: 'Every credit restarts the clock',
      detail: `Any coin you earn — from steps, a workout, a streak bonus, a challenge or a referral — gives your whole balance a fresh ${window}.`,
    },
    {
      title: 'Spending does not count',
      detail:
        'Redeeming in the shop uses coins but does not reset the window. Only earning does.',
    },
    {
      title: 'We remind you before',
      detail: reminders,
    },
    {
      title: 'If the window runs out',
      detail: `The whole balance lapses at once and shows in your history as an expiry. Coins still pending verification are not affected. Earn again and the ${window} start over.`,
    },
  ];
}

/** "Your 1,240 coins are safe until 12 December 2026." — or why there is no date. */
function headlineFor(balance: number, expiry: CoinExpiry): string {
  if (balance <= 0 || expiry.expiresAt === null) {
    return `Nothing to expire yet. Earn coins and the ${expiry.windowDays}-day clock starts from that moment.`;
  }
  const on = formatLongDate(toIsoDate(new Date(expiry.expiresAt)));
  if (expiry.daysLeft === 0) {
    return `Your ${formatCoins(
      balance,
    )} coins expire tonight. Earn any coin today to keep them.`;
  }
  return `Your ${formatCoins(balance)} coins are safe until ${on}.`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  balance: number;
  expiry: CoinExpiry;
  /**
   * Where "Earn coins" leads. Optional: without it the sheet has one button,
   * which is fine for a user who only wanted the rule explained.
   */
  onPressEarn?: () => void;
}

/**
 * What "Coins Expiry" means, in the user's own numbers.
 *
 * A sheet rather than a screen: the question is asked from the balance card
 * and answered in a paragraph and four rules, and the user wants to be back
 * on the wallet the moment it is. The countdown is restated at the top so the
 * sheet stands on its own when a reminder opens it later.
 *
 * The urgency colour follows the panel's: an amber "12 days left" here and an
 * amber panel underneath are one message, not two.
 */
export const CoinExpirySheet = memo(
  ({ visible, onClose, balance, expiry, onPressEarn }: Props) => {
    const { colors, isDark } = useTheme();
    const tint =
      expiry.urgency === 'urgent'
        ? colors.destructive
        : expiry.urgency === 'soon'
        ? colors.warning
        : colors.brandAccent;
    const hasDate = balance > 0 && expiry.expiresAt !== null;

    return (
      <BottomSheet visible={visible} onClose={onClose} title="Coin expiry">
        <VStack gap="base" pb="base">
          <Box
            radius="xl"
            p="base"
            style={{ backgroundColor: withAlpha(tint, isDark ? 0.14 : 0.08) }}
          >
            <HStack align="center" gap="md">
              <IconBadge icon={CalendarDays} tint={tint} size={40} />
              <VStack flex={1} gap="xxs">
                {hasDate ? (
                  <AppText variant="h2" style={{ color: tint }}>
                    {`${expiry.daysLeft} ${
                      expiry.daysLeft === 1 ? 'day' : 'days'
                    } left`}
                  </AppText>
                ) : null}
                <AppText variant="caption" color="textSecondary">
                  {headlineFor(balance, expiry)}
                </AppText>
              </VStack>
            </HStack>
          </Box>

          <AppText variant="h3">How coin expiry works</AppText>

          {rulesFor(expiry).map((rule, index) => (
            <Fragment key={rule.title}>
              {index > 0 ? <Divider /> : null}

              <HStack align="start" gap="md">
                <AppText
                  variant="micro"
                  style={[
                    styles.number,
                    {
                      backgroundColor: withAlpha(
                        colors.primary,
                        isDark ? 0.22 : 0.12,
                      ),
                      color: colors.primary,
                    },
                  ]}
                >
                  {index + 1}
                </AppText>

                <VStack flex={1} gap="xxs">
                  <AppText variant="bodyStrong">{rule.title}</AppText>
                  <AppText variant="micro" color="textSecondary">
                    {rule.detail}
                  </AppText>
                </VStack>
              </HStack>
            </Fragment>
          ))}

          <VStack gap="sm" pt="xs">
            {onPressEarn ? (
              <Button
                label="Earn coins"
                variant="brand"
                fullWidth
                onPress={onPressEarn}
              />
            ) : null}
            <Button
              label="Got it"
              variant={onPressEarn ? 'ghost' : 'primary'}
              fullWidth
              onPress={onClose}
            />
          </VStack>
        </VStack>
      </BottomSheet>
    );
  },
);

CoinExpirySheet.displayName = 'CoinExpirySheet';

/**
 * Styled as a Text rather than a Text inside a View, so the disc hugs the
 * digit's own line box and stays centred as the OS font scale is raised —
 * the same disc the leaderboard's rules use.
 */
const styles = StyleSheet.create({
  number: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '700',
    overflow: 'hidden',
  },
});
