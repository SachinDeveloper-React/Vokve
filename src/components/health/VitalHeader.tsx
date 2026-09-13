import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft, Info } from 'lucide-react-native';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The vital the screen is about — "Heart Rate", "Blood Pressure". */
  title: string;
  onPressBack: () => void;
  onPressInfo: () => void;
}

/**
 * A vital's own masthead: back, the title, and what the numbers mean.
 *
 * Shared by every screen that shows one clinical figure. The ⓘ is wired rather
 * than decorative: a user whose reading sits outside the normal band will want
 * to know what the app is and is not claiming.
 */
export const VitalHeader = memo(
  ({ title, onPressBack, onPressInfo }: Props) => (
    <HStack align="center" gap="md" pt="sm">
      <Pressable
        onPress={onPressBack}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Icon as={ChevronLeft} size="lg" color="text" />
      </Pressable>

      <AppText variant="h2" center numberOfLines={1} style={styles.title}>
        {title}
      </AppText>

      <Pressable
        onPress={onPressInfo}
        feedback="opacity"
        visualSize={24}
        accessibilityRole="button"
        accessibilityLabel={`About ${title.toLowerCase()} readings`}
      >
        <Icon as={Info} size="md" color="text" />
      </Pressable>
    </HStack>
  ),
);

VitalHeader.displayName = 'VitalHeader';

/** The title takes the row between the two controls, so it stays centred. */
const styles = StyleSheet.create({
  title: { flex: 1 },
});
