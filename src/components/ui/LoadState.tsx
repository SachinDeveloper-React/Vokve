import React, { memo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { Card } from './Card';
import { EmptyState } from './EmptyState';

interface Props {
  /** True while the first answer is on its way. */
  loading: boolean;
  /** What could not be loaded, as a heading: "Couldn't load your wallet". */
  title: string;
  /** Why, when the server or the network said; a generic line otherwise. */
  message?: string | null;
  onRetry: () => void;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
    empty: { paddingVertical: spacing.xl },
  });

/**
 * What a screen shows in place of figures the server has not sent yet: a
 * spinner while the first answer is on its way, and a retry once it has
 * failed. Nothing is invented in the meantime — a zero or a placeholder
 * list would read as the user's real figures.
 */
export const LoadState = memo(({ loading, title, message, onRetry }: Props) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  if (loading) {
    return (
      <View
        style={styles.loading}
        accessibilityRole="progressbar"
        accessibilityLabel="Loading"
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Card radius="xl" style={styles.empty}>
      <EmptyState
        title={title}
        message={message ?? 'Check your connection and try again.'}
        actionLabel="Try again"
        onAction={onRetry}
      />
    </Card>
  );
});

LoadState.displayName = 'LoadState';
