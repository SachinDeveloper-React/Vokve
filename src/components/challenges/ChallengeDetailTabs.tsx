import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { radius, useTheme } from '../../theme';
import { HStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

/** Which third of the detail screen is showing. */
export type ChallengeDetailTab = 'about' | 'leaderboard' | 'participants';

const TABS: readonly { value: ChallengeDetailTab; label: string }[] = [
  { value: 'about', label: 'About' },
  { value: 'leaderboard', label: 'Leaderboard' },
  { value: 'participants', label: 'Participants' },
];

interface TabProps {
  value: ChallengeDetailTab;
  label: string;
  selected: boolean;
  onPress: (value: ChallengeDetailTab) => void;
}

const Tab = memo(({ value, label, selected, onPress }: TabProps) => {
  const { colors } = useTheme();
  const press = useCallback(() => onPress(value), [onPress, value]);

  return (
    <Pressable
      onPress={press}
      feedback="opacity"
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={styles.third}
    >
      <HStack align="center" justify="center" py="md" px="xs">
        <AppText
          variant="bodyStrong"
          numberOfLines={1}
          style={{ color: selected ? colors.brandAccent : colors.textSecondary }}
        >
          {label}
        </AppText>
      </HStack>
      {/* The rule under the chosen tab, rather than a filled pill: three
          labels at this width leave no room for the padding a pill needs. */}
      <HStack
        style={[
          styles.rule,
          selected && { backgroundColor: colors.brandAccent },
        ]}
      />
    </Pressable>
  );
});

Tab.displayName = 'ChallengeDetailTab';

interface Props {
  value: ChallengeDetailTab;
  onChange: (value: ChallengeDetailTab) => void;
}

/**
 * The detail screen's three views: the rules behind the challenge, who is
 * winning it, and who is in it.
 *
 * Underlined rather than filled, unlike the leaderboard's two tabs: three
 * labels across a 375pt row leave each one about a hundred points, and a
 * filled pill at that width would clip "Participants".
 */
export const ChallengeDetailTabs = memo(({ value, onChange }: Props) => {
  const { colors } = useTheme();

  return (
    <HStack
      align="stretch"
      px="xs"
      accessibilityRole="tablist"
      style={[styles.track, { backgroundColor: colors.card }]}
      bordered
    >
      {TABS.map(tab => (
        <Tab
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

ChallengeDetailTabs.displayName = 'ChallengeDetailTabs';

const styles = StyleSheet.create({
  track: { borderRadius: radius.lg, overflow: 'hidden' },
  third: { flex: 1 },
  rule: { height: 2, borderRadius: radius.pill, backgroundColor: 'transparent' },
});
