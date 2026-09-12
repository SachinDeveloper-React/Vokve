import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { Info } from 'lucide-react-native';
import { HStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  label: string;
  /**
   * Heads a card when true, a column inside one when false. The two forms
   * exist so a card and the panel beside it do not both shout.
   */
  emphasis?: boolean;
  /**
   * Wires the ⓘ to an explainer. Without it the icon is decorative and the
   * label is not announced as a button — a control that does nothing when
   * tapped reads as broken.
   */
  onPressInfo?: () => void;
}

/**
 * A section label with an "what is this?" affordance beside it.
 *
 * Coins are a currency the user did not choose the rules for — how they are
 * earned, when they expire — so the places that state a coin figure carry the
 * question mark next to the label rather than burying the answer in a settings
 * screen.
 */
export const InfoLabel = memo(({ label, emphasis = false, onPressInfo }: Props) => {
  const content = (
    <HStack align="center" gap="xs">
      <AppText
        variant={emphasis ? 'label' : 'caption'}
        color={emphasis ? 'text' : 'textSecondary'}
        style={styles.label}
      >
        {label}
      </AppText>
      <Icon as={Info} size="xs" color="textTertiary" />
    </HStack>
  );

  if (!onPressInfo) {
    return content;
  }

  return (
    <Pressable
      onPress={onPressInfo}
      accessibilityRole="button"
      accessibilityLabel={`${label}, what is this?`}
    >
      {content}
    </Pressable>
  );
});

InfoLabel.displayName = 'InfoLabel';

/**
 * Text in a row does not shrink by default, so a label wider than the column
 * it is given runs past the edge instead of wrapping. Letting it shrink is
 * what makes it wrap — into the space it has, not into the panel beside it.
 */
const styles = StyleSheet.create({
  label: { flexShrink: 1 },
});
