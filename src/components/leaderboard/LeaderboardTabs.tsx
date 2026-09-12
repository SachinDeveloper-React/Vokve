import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** Which half of the screen is showing. */
export type LeaderboardTab = 'rewards' | 'how';

const TABS: readonly { value: LeaderboardTab; label: string }[] = [
  { value: 'rewards', label: 'Rewards & Prizes' },
  { value: 'how', label: 'How It Works' },
];

interface TabProps {
  value: LeaderboardTab;
  label: string;
  selected: boolean;
  onPress: (value: LeaderboardTab) => void;
}

const LeaderboardTabButton = memo(
  ({ value, label, selected, onPress }: TabProps) => {
    const { colors } = useTheme();
    const press = useCallback(() => onPress(value), [onPress, value]);

    return (
      <Pressable
        onPress={press}
        feedback="opacity"
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={label}
        style={styles.half}
      >
        <HStack
          align="center"
          justify="center"
          py="md"
          px="sm"
          style={[styles.tab, selected && { backgroundColor: colors.text }]}
        >
          <AppText
            variant="bodyStrong"
            numberOfLines={1}
            style={{ color: selected ? colors.card : colors.textSecondary }}
          >
            {label}
          </AppText>
        </HStack>
      </Pressable>
    );
  },
);

LeaderboardTabButton.displayName = 'LeaderboardTabButton';

interface Props {
  value: LeaderboardTab;
  onChange: (value: LeaderboardTab) => void;
}

/**
 * The screen's two halves: the prizes, and the rules behind them.
 *
 * Two wide tabs rather than the app's `SegmentedControl`. That control is a
 * form input — it answers a question and sits under a label — where these two
 * switch the whole page under them, which is why the chosen one is filled the
 * way the filter chips elsewhere are rather than merely washed.
 */
export const LeaderboardTabs = memo(({ value, onChange }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack
      align="stretch"
      p="xxs"
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.muted }]}
    >
      {TABS.map(tab => (
        <LeaderboardTabButton
          key={tab.value}
          value={tab.value}
          label={tab.label}
          selected={tab.value === value}
          onPress={onChange}
        />
      ))}
    </HStack>
  );
});

LeaderboardTabs.displayName = 'LeaderboardTabs';

const styles = StyleSheet.create({
  track: { borderRadius: radius.lg },
  half: { flex: 1 },
  tab: { borderRadius: radius.md },
});
