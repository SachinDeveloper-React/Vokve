import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Step {
  title: string;
  detail: string;
}

/**
 * The rules, in the order they happen to the user.
 *
 * Written out here rather than fetched for the same reason the tiers are: they
 * are how the product works, and the tab exists precisely so a user can check
 * them before a week of effort, which is no time to be waiting on a request.
 */
const STEPS: readonly Step[] = [
  {
    title: 'Compete every week',
    detail:
      'Steps, workouts and completed challenges all count towards your score. The week runs Monday to Sunday.',
  },
  {
    title: 'Climb your country board',
    detail:
      'You are ranked against everyone in your country, so a place is won against people in the same week as you.',
  },
  {
    title: 'Finish in the top ten',
    detail:
      'First place takes 5,000 coins and the full kit; second and third take 3,000; fourth to tenth take 1,000.',
  },
  {
    title: 'Rewards land on Monday',
    detail:
      'Coins are credited to your wallet automatically. Gear is shipped to the address on your account.',
  },
];

/**
 * The screen's second tab: how a place on the board is earned and paid.
 *
 * A numbered column rather than a paragraph. The rules are a sequence with a
 * deadline in the middle of it, and a reader checking whether they still have
 * time this week needs to find that line without reading the rest.
 */
export const LeaderboardHowItWorks = memo(() => {
  const { colors, isDark } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <AppText variant="h3">How the leaderboard works</AppText>

        {STEPS.map((step, index) => (
          <Fragment key={step.title}>
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
                <AppText variant="bodyStrong">{step.title}</AppText>
                <AppText variant="micro" color="textSecondary">
                  {step.detail}
                </AppText>
              </VStack>
            </HStack>
          </Fragment>
        ))}
      </VStack>
    </Card>
  );
});

LeaderboardHowItWorks.displayName = 'LeaderboardHowItWorks';

/**
 * Styled as a Text rather than a Text inside a View, so the disc hugs the
 * digit's own line box and stays centred as the OS font scale is raised.
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
