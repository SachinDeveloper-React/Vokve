import React, { useCallback } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { ArrowUpCircle } from 'lucide-react-native';
import { BottomSheet } from '../disclosure/BottomSheet';
import { VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { spacing, useTheme } from '../../theme';
import type { AppUpdate } from '../../types/models';
import { logger } from '../../utils/logger';

interface Props {
  /** The server's soft verdict, or null to show nothing. */
  update: AppUpdate | null;
  /** "Later" — the sheet closes and stays quiet for `remindAfterHours`. */
  onDismiss: () => void;
}

const styles = StyleSheet.create({
  body: { paddingBottom: spacing.md },
  notes: { paddingTop: spacing.xs },
});

/**
 * The knock: there is a newer VOKVE, this one still works, and the member
 * may say "later" (RULES DV12).
 *
 * Dismissible on purpose — backdrop, drag and a labelled button — because
 * the wall is the other screen. A sheet that could not be closed would be a
 * wall with none of a wall's honesty: a member who cannot update right now
 * (no data, no space, mid-walk) would be stuck in front of it with their
 * steps still counting behind.
 *
 * Every word is the server's, including the buttons, so the same build can
 * be asked nicely today and told firmly next week without shipping anything.
 */
export const UpdateSheet = ({ update, onDismiss }: Props) => {
  const { colors } = useTheme();

  const openStore = useCallback(() => {
    if (!update?.storeUrl) return;
    // Dismissed as we leave: a member coming back from the store either has
    // the new build — where the server says nothing — or chose not to, and
    // either way the sheet should not be waiting for them.
    onDismiss();
    Linking.openURL(update.storeUrl).catch(error =>
      logger.warn('UpdateSheet', 'Could not open the store', error),
    );
  }, [onDismiss, update]);

  if (!update) return null;

  return (
    <BottomSheet visible onClose={onDismiss} title={update.title}>
      <VStack gap="md" style={styles.body}>
        <VStack align="center" gap="sm">
          <Icon as={ArrowUpCircle} size="xl" tint={colors.brandAccent} />
          <AppText variant="body" color="textSecondary" center>
            {update.message}
          </AppText>
          {update.latest?.notes ? (
            <AppText
              variant="caption"
              color="textTertiary"
              center
              style={styles.notes}
            >
              {update.latest.notes}
            </AppText>
          ) : null}
        </VStack>

        <VStack gap="xs">
          <Button
            label={update.actionLabel}
            variant="brand"
            size="lg"
            fullWidth
            onPress={openStore}
          />
          <Button
            label={update.laterLabel ?? 'Later'}
            variant="ghost"
            size="lg"
            fullWidth
            onPress={onDismiss}
          />
        </VStack>
      </VStack>
    </BottomSheet>
  );
};
