import React, { memo } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';

interface Props extends ViewProps {
  children: React.ReactNode;
  /** 'flat' avoids shadows in long lists, where they are a real scroll cost. */
  elevation?: 'flat' | 'low' | 'medium';
  /** Corner rounding. Feature cards carry a larger radius than list rows. */
  radius?: 'md' | 'lg' | 'xl';
  padding?: 'md' | 'base' | 'lg';
}

const makeStyles = ({ colors, spacing, radius, elevation }: ThemeShape) =>
  StyleSheet.create({
    base: { backgroundColor: colors.card },
    radiusMd: { borderRadius: radius.md },
    radiusLg: { borderRadius: radius.lg },
    radiusXl: { borderRadius: radius.xl },
    padMd: { padding: spacing.md },
    padBase: { padding: spacing.base },
    padLg: { padding: spacing.lg },
    // A border defines the card's edge only when nothing else does. Once the
    // card casts a shadow the outline is a second edge drawn over the first,
    // which is what makes a shadowed, outlined card look unfinished.
    outlined: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    low: elevation.low,
    medium: elevation.medium,
  });

const RADIUS = { md: 'radiusMd', lg: 'radiusLg', xl: 'radiusXl' } as const;
const PADDING = { md: 'padMd', base: 'padBase', lg: 'padLg' } as const;

export const Card = memo(
  ({
    children,
    elevation = 'flat',
    radius = 'lg',
    padding = 'base',
    style,
    ...rest
  }: Props) => {
    const styles = useThemedStyles(makeStyles);

    return (
      <View
        style={[
          styles.base,
          styles[RADIUS[radius]],
          styles[PADDING[padding]],
          elevation === 'flat' && styles.outlined,
          elevation === 'low' && styles.low,
          elevation === 'medium' && styles.medium,
          style,
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  },
);

Card.displayName = 'Card';
