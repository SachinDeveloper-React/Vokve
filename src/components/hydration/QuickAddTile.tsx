import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { Pencil } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';
import { WaterDroplet } from '../fitness/WaterDroplet';

interface Props {
  /** The amount this tile logs, in millilitres. `null` opens the custom sheet. */
  ml: number | null;
  label: string;
  onAdd: (ml: number) => void;
  onPressCustom: () => void;
}

/**
 * One quick-add amount.
 *
 * Boxed, unlike the two quick-adds on the dashboard card: those sit inside a
 * card that already has an edge, where these five *are* the row — a line of
 * bare labels would read as a legend rather than as five things to press.
 *
 * The custom tile carries a pencil rather than a droplet. It is the one tile
 * that does not log anything by itself, and a fifth droplet would promise that
 * it does.
 */
export const QuickAddTile = memo(
  ({ ml, label, onAdd, onPressCustom }: Props) => {
    const { colors } = useTheme();

    // The tile decides which of the two it is rather than the row passing a
    // handler that takes `number | null`: a logger that accepts null is a
    // logger that can be called with nothing to log.
    const handlePress = useCallback(() => {
      if (ml === null) {
        onPressCustom();
        return;
      }
      onAdd(ml);
    }, [ml, onAdd, onPressCustom]);

    return (
      <Pressable
        onPress={handlePress}
        feedback="scale"
        accessibilityRole="button"
        accessibilityLabel={ml === null ? 'Add a custom amount' : `Add ${label}`}
        style={styles.press}
      >
        <Card radius="lg" padding="md" style={styles.card}>
          <VStack align="center" gap="sm">
            {ml === null ? (
              <Icon as={Pencil} size="md" tint={colors.primary} />
            ) : (
              <WaterDroplet size={22} />
            )}

            <AppText
              variant="miniMicro"
              center
              numberOfLines={1}
              style={styles.label}
            >
              {label}
            </AppText>
          </VStack>
        </Card>
      </Pressable>
    );
  },
);

QuickAddTile.displayName = 'QuickAddTile';

const styles = StyleSheet.create({
  press: { flex: 1 },
  card: { flex: 1 },
  label: { fontWeight: '600' },
});
