import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft, HelpCircle } from 'lucide-react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  onPressBack: () => void;
  /** Opens the explainer for how a day comes to count. */
  onPressHelp: () => void;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    header: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
    // The chevron and the help glyph hold the same width, so the title sits
    // centred between them.
    side: { width: 32 },
  });

/**
 * The streak screen's masthead: a way back, what the page is, and the one
 * question it cannot answer in a line — what makes a day count.
 *
 * No wordmark, no bell, no avatar, unlike the app's tab mastheads. This is a
 * page of a page, reached from the dashboard or the account, and the room a
 * masthead would take is room the two figures below it need.
 */
export const StreakDetailHeader = memo(({ onPressBack, onPressHelp }: Props) => {
  const styles = useThemedStyles(makeStyles);

  return (
    <HStack align="center" gap="sm" style={styles.header}>
      <Pressable
        onPress={onPressBack}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.side}
      >
        <Icon as={ChevronLeft} size="lg" color="text" />
      </Pressable>

      <VStack flex={1} align="center" gap="xxs">
        <AppText variant="h2" accessibilityRole="header" numberOfLines={1}>
          Streak Details
        </AppText>
        <AppText variant="micro" color="textSecondary" center numberOfLines={1}>
          Small steps. Big changes.
        </AppText>
      </VStack>

      <Pressable
        onPress={onPressHelp}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="How streaks work"
        style={styles.side}
      >
        <Icon as={HelpCircle} size="md" color="text" />
      </Pressable>
    </HStack>
  );
});

StreakDetailHeader.displayName = 'StreakDetailHeader';
