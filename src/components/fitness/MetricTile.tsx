import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { spacing } from '../../theme';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { IconBadge } from '../ui/IconBadge';
import { Icon } from '../media/Icon';
import { Pressable } from '../form/Pressable';

interface Props {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Icon and value colour. Pass a theme token, not a literal. */
  tint: string;
  onPress?: () => void;
}

/**
 * One metric in the row under the step goal.
 *
 * The tint is decoration, never the identity of the tile: the icon glyph and
 * the label carry that. Two of these accents are indistinguishable to a
 * red-green colourblind reader, which is only acceptable because neither the
 * glyph nor the label depends on telling them apart.
 */
export const MetricTile = memo(
  ({ icon, label, value, tint, onPress }: Props) => {
    const body = (
      <>
        <IconBadge icon={icon} tint={tint} size="sm" />
        <AppText variant="micro" color="textSecondary" center>
          {label}
        </AppText>
        <View style={styles.valueRow}>
          <AppText variant="micro" style={{ color: tint }}>
            {value}
          </AppText>
          {onPress ? <Icon as={ChevronRight} size="sm" tint={tint} /> : null}
        </View>
      </>
    );

    if (!onPress) {
      return (
        <Card elevation="low" style={styles.card}>
          {body}
        </Card>
      );
    }

    return (
      <Pressable
        onPress={onPress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
      >
        <Card elevation="low" style={styles.card}>
          {body}
        </Card>
      </Pressable>
    );
  },
);

MetricTile.displayName = 'MetricTile';

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
});
