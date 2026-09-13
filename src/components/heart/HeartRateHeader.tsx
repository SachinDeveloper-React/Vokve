import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft, Info } from 'lucide-react-native';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  onPressBack: () => void;
  onPressInfo: () => void;
  title?: string;
}

/**
 * The heart rate screen's masthead: back, the title, and what the numbers mean.
 *
 * The ⓘ is wired rather than decorative. This is the one screen in the app
 * that shows a clinical figure, and a user whose reading sits outside the
 * normal band will want to know what the app is and is not claiming.
 */
export const HeartRateHeader = memo(
  ({ onPressBack, onPressInfo, title = 'Heart Rate' }: Props) => (
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
        accessibilityLabel="About heart rate readings"
      >
        <Icon as={Info} size="md" color="text" />
      </Pressable>
    </HStack>
  ),
);

HeartRateHeader.displayName = 'HeartRateHeader';

/** The title takes the row between the two controls, so it stays centred. */
const styles = StyleSheet.create({
  title: { flex: 1 },
});
