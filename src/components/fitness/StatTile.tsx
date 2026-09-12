import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';

interface Props {
  label: string;
  value: string;
  unit?: string;
  icon?: React.ReactNode;
  accent?: boolean;
}

const makeStyles = ({ colors, spacing }: ThemeShape) =>
  StyleSheet.create({
    card: { flex: 1, gap: spacing.xs },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    valueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.xxs,
    },
    accentBar: {
      height: 3,
      width: 28,
      borderRadius: 2,
      backgroundColor: colors.primary,
      marginTop: spacing.xs,
    },
  });

/**
 * A single dashboard metric. The value uses the `metric` type style, whose
 * tabular figures stop the number jittering sideways as it counts up.
 */
export const StatTile = memo(
  ({ label, value, unit, icon, accent = false }: Props) => {
    const styles = useThemedStyles(makeStyles);

    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          {icon}
          <AppText variant="label" color="textTertiary">
            {label}
          </AppText>
        </View>
        <View style={styles.valueRow}>
          <AppText variant="metric">{value}</AppText>
          {unit ? (
            <AppText variant="caption" color="textSecondary">
              {unit}
            </AppText>
          ) : null}
        </View>
        {accent ? <View style={styles.accentBar} /> : null}
      </Card>
    );
  },
);

StatTile.displayName = 'StatTile';
