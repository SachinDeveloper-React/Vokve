import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import {
  CalendarRange,
  CircleCheck,
  Gift,
  Info,
  RefreshCw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { ChallengeRule, ChallengeRuleIcon } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

/**
 * A glyph per rule kind.
 *
 * Looked up from the server's enum rather than from an icon name it sends:
 * lucide is imported icon by icon to stay tree-shakeable, so a name the app
 * has never imported could not be drawn anyway — and an enum makes that a
 * compile error here instead of a blank space on a phone.
 */
const RULE_ICON: Record<ChallengeRuleIcon, LucideIcon> = {
  goal: CircleCheck,
  duration: CalendarRange,
  verified: ShieldCheck,
  reward: Gift,
  repeat: RefreshCw,
  warning: Info,
};

/**
 * What each kind of rule is drawn in.
 *
 * Not one colour for the lot: the first line is what wins the challenge, the
 * reward line is what it pays, and the rest are terms. Tying the reward's
 * glyph to the brand accent is what makes the coins on this card and the
 * coins on the reward card above it read as the same promise.
 */
const RULE_TINT: Record<ChallengeRuleIcon, 'success' | 'brand' | 'muted'> = {
  goal: 'success',
  duration: 'muted',
  verified: 'success',
  reward: 'brand',
  repeat: 'muted',
  warning: 'muted',
};

interface Props {
  rules: ChallengeRule[];
}

/**
 * The rules the server actually enforces, in its own words.
 *
 * Nothing here is written by the app: the goal, the dates, what counts, what
 * it pays and what loses it all come from the definition in force (RULES C3,
 * C4, C6), so an owner who rebalances a reward does not leave the app telling
 * members the old figure.
 */
export const ChallengeRulesCard = memo(({ rules }: Props) => {
  const { colors } = useTheme();

  return (
    <Card radius="xl" padding="base">
      <VStack gap="md">
        <AppText variant="h3">Challenge Rules</AppText>

        {rules.map(rule => (
          <HStack key={rule.id} align="start" gap="sm">
            <Icon
              as={RULE_ICON[rule.icon]}
              size="sm"
              tint={
                rule.tone === 'caution'
                  ? colors.textTertiary
                  : RULE_TINT[rule.icon] === 'success'
                    ? colors.success
                    : RULE_TINT[rule.icon] === 'brand'
                      ? colors.brandAccent
                      : colors.textSecondary
              }
            />
            <AppText
              variant="caption"
              style={styles.text}
              color={rule.tone === 'caution' ? 'textTertiary' : 'textSecondary'}
            >
              {rule.text}
            </AppText>
          </HStack>
        ))}
      </VStack>
    </Card>
  );
});

ChallengeRulesCard.displayName = 'ChallengeRulesCard';

const styles = StyleSheet.create({
  text: { flex: 1 },
});
