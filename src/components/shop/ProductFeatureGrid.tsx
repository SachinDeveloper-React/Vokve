import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { ShopFeature } from '../../types/models';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { FEATURE_ICONS } from './productIcons';

interface Props {
  features: readonly ShopFeature[];
}

/** Four across fits a 375pt card; a fifth starts a second row. */
const PER_ROW = 4;

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.base,
      paddingHorizontal: spacing.sm,
      rowGap: spacing.base,
    },
    cell: { paddingHorizontal: spacing.xs },
  });

/**
 * "Key Features": each selling point as a tinted glyph, a word, and a line
 * under it, in equal columns. Fewer than four share the width between them
 * rather than leaving an empty column at the end.
 */
export const ProductFeatureGrid = memo(({ features }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const columns = Math.min(PER_ROW, features.length);
  const width = `${100 / columns}%` as const;

  return (
    <HStack wrap style={styles.card}>
      {features.map((feature, index) => {
        const look = FEATURE_ICONS[feature.icon];
        return (
          <View
            key={`${feature.title}:${index}`}
            style={[styles.cell, { width }]}
          >
            <VStack gap="xs" align="start">
              <Icon as={look.icon} size="md" tint={look.tint(colors)} />
              <AppText variant="bodyStrong" numberOfLines={1}>
                {feature.title}
              </AppText>
              {feature.caption ? (
                <AppText variant="micro" color="textSecondary">
                  {feature.caption}
                </AppText>
              ) : null}
            </VStack>
          </View>
        );
      })}
    </HStack>
  );
});

ProductFeatureGrid.displayName = 'ProductFeatureGrid';
