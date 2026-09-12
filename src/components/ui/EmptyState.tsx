import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemedStyles, type ThemeShape } from '../../theme';
import { AppText } from './AppText';
import { Button } from './Button';

interface Props {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      gap: spacing.sm,
    },
    action: { marginTop: spacing.base },
  });

export const EmptyState = memo(
  ({ title, message, actionLabel, onAction, icon }: Props) => {
    const styles = useThemedStyles(makeStyles);

    return (
      <View style={styles.container}>
        {icon}
        <AppText variant="h3" center>
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary" center>
          {message}
        </AppText>
        {actionLabel && onAction ? (
          <View style={styles.action}>
            <Button label={actionLabel} onPress={onAction} />
          </View>
        ) : null}
      </View>
    );
  },
);

EmptyState.displayName = 'EmptyState';
