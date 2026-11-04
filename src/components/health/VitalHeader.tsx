import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { moderateScale } from '../../theme/responsive';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  /** The vital the screen is about — "Heart Rate", "Blood Pressure". */
  title: string;
  onPressBack: () => void;
}

/**
 * A vital's own masthead: back, and the title.
 *
 * Shared by every screen that shows one clinical figure. There used to be an ⓘ
 * on the right, for an explainer screen that was never built: it did nothing,
 * which is worse than not being there, because the user who taps it is left
 * thinking the app is broken. The spacer that replaces it is doing real work —
 * the title centres itself in the row, so without something the width of the
 * chevron on the other side it would sit off-centre.
 */
export const VitalHeader = memo(({ title, onPressBack }: Props) => (
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

    <View style={styles.spacer} />
  </HStack>
));

VitalHeader.displayName = 'VitalHeader';

const styles = StyleSheet.create({
  /** The title takes the row between the chevron and the spacer. */
  title: { flex: 1 },
  /** Matches the back chevron's `lg` glyph, so the title stays centred. */
  spacer: { width: moderateScale(24) },
});
