import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { moderateScale } from '../../theme/responsive';
import { Pressable } from '../form/Pressable';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';

interface Props {
  /** Left out, there is no chevron — the set-up after sign-in has nothing behind it. */
  onPressBack?: () => void;
}

/**
 * The goal screen's masthead: the title centred over its line, as the
 * design has it, between two slots of the same width — so the title stays
 * centred whether the chevron is there or not.
 */
export const StepGoalHeader = memo(({ onPressBack }: Props) => (
  <HStack align="center" gap="sm" pt="sm">
    <View style={styles.side}>
      {onPressBack ? (
        <Pressable
          onPress={onPressBack}
          feedback="opacity"
          visualSize={24}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon as={ChevronLeft} size="lg" color="text" />
        </Pressable>
      ) : null}
    </View>

    <VStack flex={1} align="center" gap="xxs">
      <AppText variant="h2" center numberOfLines={1} accessibilityRole="header">
        Step Goal Setting
      </AppText>
      <AppText variant="caption" color="textSecondary" center numberOfLines={1}>
        Set your daily step goal
      </AppText>
    </VStack>

    <View style={styles.side} />
  </HStack>
));

StepGoalHeader.displayName = 'StepGoalHeader';

const styles = StyleSheet.create({
  side: { width: moderateScale(32) },
});
