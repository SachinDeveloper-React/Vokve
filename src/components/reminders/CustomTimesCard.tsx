import React, { Fragment, memo } from 'react';
import { StyleSheet } from 'react-native';
import { Plus } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import type { HydrationReminder } from '../../types/models';
import { Divider } from '../layout/Divider';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { CustomTimeRow } from './CustomTimeRow';

interface Props {
  reminders: HydrationReminder[];
  /** What every custom time repeats on — the plan's own repeat rule. */
  repeatLabel: string;
  onToggle: (id: string) => void;
  onPressMore: (id: string) => void;
  onPressAdd: () => void;
}

/**
 * The times the user set themselves, and the way to add another.
 *
 * The add control is an outlined button rather than another row: it is the one
 * thing in the section that is not a reminder, and a row that looked like the
 * ones above it would be tapped by somebody trying to edit 9:30.
 */
export const CustomTimesCard = memo(
  ({ reminders, repeatLabel, onToggle, onPressMore, onPressAdd }: Props) => {
    const { colors } = useTheme();

    return (
      <VStack gap="sm">
        <HStack align="center" justify="between" gap="sm">
          <AppText variant="h3" numberOfLines={1}>
            Custom Times
          </AppText>
          <AppText variant="micro" color="textSecondary" numberOfLines={1}>
            {`${reminders.length} custom ${
              reminders.length === 1 ? 'time' : 'times'
            }`}
          </AppText>
        </HStack>

        {reminders.length > 0 ? (
          <Card radius="xl" padding="base">
            <VStack>
              {reminders.map((reminder, index) => (
                <Fragment key={reminder.id}>
                  {index > 0 ? <Divider /> : null}
                  <CustomTimeRow
                    reminder={reminder}
                    repeatLabel={repeatLabel}
                    onToggle={onToggle}
                    onPressMore={onPressMore}
                  />
                </Fragment>
              ))}
            </VStack>
          </Card>
        ) : null}

        <Pressable
          onPress={onPressAdd}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel="Add a custom time"
        >
          <HStack
            align="center"
            justify="center"
            gap="xs"
            py="md"
            style={[styles.add, { borderColor: colors.brandAccent }]}
          >
            <Icon as={Plus} size="sm" tint={colors.brandAccent} />
            <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
              Add Custom Time
            </AppText>
          </HStack>
        </Pressable>
      </VStack>
    );
  },
);

CustomTimesCard.displayName = 'CustomTimesCard';

const styles = StyleSheet.create({
  add: { borderRadius: radius.lg, borderWidth: 1 },
});
