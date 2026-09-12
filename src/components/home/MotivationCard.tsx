import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronRight, Quote } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { useResponsive } from '../../hooks/useResponsive';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Icon } from '../media/Icon';
import { Box } from '../layout/Box';
import { HStack, VStack } from '../layout/Stack';
import { Pressable } from '../form/Pressable';
import { MotivationArt } from './MotivationArt';

interface Props {
  quote: string;
  label?: string;
  /**
   * Artwork for the right-hand side. Defaults to the emoji trio; pass `null`
   * to run the card as text alone.
   */
  illustration?: React.ReactNode;
  onPress?: () => void;
}

/**
 * The day's motivation line.
 *
 * Everything that carries the card is on the left edge: the accent label, the
 * quote mark under it, and the line itself. The artwork sits at the far right
 * with the text flexing between them, so a long quote takes the space it needs
 * instead of the emoji holding a fixed share of a narrow screen.
 *
 * The accent is spent on the label and the quote mark only. Tinting the quote
 * as well would leave the card with no plain text at all, and the point of the
 * section is that the line reads as something said, not as another readout.
 */
export const MotivationCard = memo(
  ({
    quote,
    label = "Today's motivation",
    illustration = <MotivationArt />,
    onPress,
  }: Props) => {
    const { colors } = useTheme();
    const { width } = useResponsive();

    const body = (
      <Card elevation="low" radius="xl" padding={width < 360 ? 'base' : 'lg'}>
        <HStack align="center" gap="base">
          <VStack flex={1} gap="sm">
            <AppText variant="label" style={{ color: colors.brandAccent }}>
              {label}
            </AppText>

            <HStack gap="sm">
              {/* Nudged down to the first line's cap height: sat at the top of
                  the text box, the mark floats above the line it opens. */}
              <Box style={styles.quoteMark}>
                <Icon as={Quote} size="sm" tint={colors.brandAccent} />
              </Box>
              <AppText variant="micro" style={styles.quote}>
                {quote}
              </AppText>
            </HStack>
          </VStack>

          {illustration}

          {onPress ? (
            <Icon as={ChevronRight} size="sm" color="textTertiary" />
          ) : null}
        </HStack>
      </Card>
    );

    if (!onPress) {
      return body;
    }

    return (
      <Pressable
        onPress={onPress}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${quote}`}
      >
        {body}
      </Pressable>
    );
  },
);

MotivationCard.displayName = 'MotivationCard';

/**
 * The two things the primitives cannot express: a glyph offset onto a text
 * baseline, and a text block that flexes inside the row it shares.
 */
const styles = StyleSheet.create({
  quoteMark: { marginTop: moderateScale(3) },
  quote: { flex: 1 },
});
