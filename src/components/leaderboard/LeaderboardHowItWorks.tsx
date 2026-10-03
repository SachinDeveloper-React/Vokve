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
 * The screen's second tab: how a place on the board is earned and paid.
 *
 * The words are the server's (`GET /leaderboard/reward-tiers`), built from
 * the scoring and prizes it applies, so a changed prize never leaves the
 * explainer promising the old one.
 *
 * A numbered column rather than a paragraph. The rules are a sequence with a
 * deadline in the middle of it, and a reader checking whether they still have
 * time this week needs to find that line without reading the rest.
 */
interface Props {
  /** The rules in the order they happen to the user, worded by the server. */
  steps: readonly Step[];
}

export const LeaderboardHowItWorks = memo(({ steps }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="base">
        <AppText variant="h3">How the leaderboard works</AppText>

        {steps.map((step, index) => (
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
