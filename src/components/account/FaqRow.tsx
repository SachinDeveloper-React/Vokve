import React, { memo, useCallback, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  StyleSheet,
  UIManager,
  View,
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useTheme } from '../../theme';
import type { SupportFaq } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

// Old Android needs this switched on before `LayoutAnimation` does anything.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  faq: SupportFaq;
  /** Opens with the answer showing — for a search that found one article. */
  defaultOpen?: boolean;
}

/**
 * One help article, question first.
 *
 * Collapsed by default so the list reads as a set of questions a member can
 * scan for their own; a page of full answers is a wall nobody reads. The
 * whole row is the target, and the chevron only says which way it will go.
 */
export const FaqRow = memo(({ faq, defaultOpen = false }: Props) => {
  const { colors } = useTheme();
  const [isOpen, setOpen] = useState(defaultOpen);

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(current => !current);
  }, []);

  return (
    <Pressable
      onPress={toggle}
      feedback="opacity"
      accessibilityRole="button"
      accessibilityState={{ expanded: isOpen }}
      accessibilityLabel={faq.question}
      style={styles.row}
    >
      <VStack gap="xs">
        <HStack align="center" gap="sm">
          <AppText variant="bodyStrong" style={styles.grow}>
            {faq.question}
          </AppText>
          <View style={isOpen ? styles.flipped : undefined}>
            <Icon as={ChevronDown} size="sm" tint={colors.textTertiary} />
          </View>
        </HStack>
        {isOpen ? (
          <AppText variant="body" color="textSecondary">
            {faq.answer}
          </AppText>
        ) : null}
      </VStack>
    </Pressable>
  );
});

FaqRow.displayName = 'FaqRow';

const styles = StyleSheet.create({
  row: { paddingVertical: 10 },
  grow: { flex: 1 },
  flipped: { transform: [{ rotate: '180deg' }] },
});
