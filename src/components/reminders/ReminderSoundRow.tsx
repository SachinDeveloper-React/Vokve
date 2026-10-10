import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check, Play } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { withAlpha } from '../../utils/color';
import { Pressable } from '../form/Pressable';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

const TICK = moderateScale(26);
const PLAY = moderateScale(34);

interface Props {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
}

/**
 * One sound on the picker: its name, what it sounds like in words, and a way
 * to hear it.
 *
 * The row and the play button are separate targets, because they do
 * different things and one of them is not reversible in the same way: a tap
 * on the row is the choice, and the user has to be able to listen without
 * making it. The tick rather than a radio dot — this is a list of things
 * one of which is in force, not a form field.
 */
export const ReminderSoundRow = memo(
  ({ id, label, description, selected, onSelect, onPreview }: Props) => {
    const { colors, isDark } = useTheme();
    const select = useCallback(() => onSelect(id), [id, onSelect]);
    const preview = useCallback(() => onPreview(id), [id, onPreview]);

    return (
      <HStack align="center" gap="md">
        <Pressable
          onPress={select}
          feedback="highlight"
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={`${label}, ${description}`}
          style={styles.choice}
        >
          <HStack align="center" gap="md" py="md">
            <View
              style={[
                styles.tick,
                {
                  backgroundColor: selected
                    ? colors.primary
                    : withAlpha(colors.textTertiary, isDark ? 0.22 : 0.12),
                },
              ]}
            >
              {selected ? <Icon as={Check} size="xs" color="primaryForeground" /> : null}
            </View>

            <VStack flex={1} gap="xxs">
              <AppText variant="bodyStrong">{label}</AppText>
              <AppText variant="micro" color="textSecondary" numberOfLines={1}>
                {description}
              </AppText>
            </VStack>
          </HStack>
        </Pressable>

        <Pressable
          onPress={preview}
          feedback="scale"
          visualSize={PLAY}
          accessibilityRole="button"
          accessibilityLabel={`Play ${label}`}
        >
          <HStack
            align="center"
            justify="center"
            style={[
              styles.play,
              { backgroundColor: withAlpha(colors.primary, isDark ? 0.26 : 0.12) },
            ]}
          >
            <Icon as={Play} size="xs" color="primary" />
          </HStack>
        </Pressable>
      </HStack>
    );
  },
);

ReminderSoundRow.displayName = 'ReminderSoundRow';

const styles = StyleSheet.create({
  choice: { flex: 1 },
  tick: {
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: { width: PLAY, height: PLAY, borderRadius: radius.md },
});
