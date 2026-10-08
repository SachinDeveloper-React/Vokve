import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { HStack, VStack } from './Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

interface Props {
  title: string;
  subtitle?: string;
  onPressBack: () => void;
  /** Something for the far corner — a pill, an action. Optional by design. */
  trailing?: React.ReactNode;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    header: { paddingTop: spacing.sm, paddingBottom: spacing.md },
    // The chevron and the far corner hold the same width, so the title sits
    // centred whether or not there is anything on the right.
    side: { width: 32 },
  });

/**
 * A page's masthead where the page is about neither coins nor shopping: a
 * way back, the name centred with a line under it, and nothing else.
 *
 * The app's other headers all carry the wallet, which is right where the
 * screen is about spending — and wrong on a help page, where a balance is
 * the one number that has nothing to do with the question being asked.
 */
export const PageHeader = memo(
  ({ title, subtitle, onPressBack, trailing }: Props) => {
    const styles = useThemedStyles(makeStyles);
    return (
      <HStack align="center" gap="sm" style={styles.header}>
        <Pressable
          onPress={onPressBack}
          feedback="opacity"
          visualSize={24}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.side}
        >
          <Icon as={ChevronLeft} size="lg" color="text" />
        </Pressable>

        <VStack flex={1} align="center" gap="xxs">
          <AppText variant="h2" accessibilityRole="header" numberOfLines={1}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="micro" color="textSecondary" center numberOfLines={2}>
              {subtitle}
            </AppText>
          ) : null}
        </VStack>

        <HStack justify="end" style={styles.side}>
          {trailing}
        </HStack>
      </HStack>
    );
  },
);

PageHeader.displayName = 'PageHeader';
