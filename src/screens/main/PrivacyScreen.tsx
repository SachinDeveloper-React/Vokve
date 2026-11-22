import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChartNoAxesColumn,
  Database,
  Sparkles,
  Trash2,
  UserRoundX,
} from 'lucide-react-native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { BottomSheet } from '../../components/disclosure/BottomSheet';
import { Alert } from '../../components/feedback/Alert';
import { useToast } from '../../components/feedback/Toast';
import { FormInput } from '../../components/form/fields';
import { Switch } from '../../components/form/Switch';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { AppleMark } from '../../components/auth/SocialAuthRow';
import { accountApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { forgetAppleUser } from '../../services/appleCredential';
import { confirmWithProvider } from '../../services/providerConfirmation';
import {
  useAccountDeletion,
  useAccountStore,
  usePrivacySettings,
} from '../../stores/accountStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import type { DeletionConfirmation, PrivacySettings } from '../../types/models';
import { formatDaysUntil, formatRelativeDay } from '../../utils/format';
import { z } from 'zod';

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    loading: { paddingVertical: spacing.lg, alignItems: 'center' },
    grow: { flex: 1 },
  });

/**
 * The deletion sheet's fields. The password is only asked for on an account
 * whose proof it is (`confirmWith`, RULES O16) — the others confirm with
 * Apple or Google — so it is checked in the handler rather than here.
 */
const deleteSchema = z.object({
  password: z.string().optional(),
  reason: z.string().trim().max(280, 'Keep it under 280 characters').optional(),
});

/** The words for each way of confirming, on the sheet and its button. */
const CONFIRM_COPY: Record<
  Exclude<DeletionConfirmation, 'password'>,
  { button: string; note: string }
> = {
  apple: {
    button: 'Confirm with Apple',
    note: 'Sign in with Apple once more to confirm. This also removes VOKVE from your Apple ID, so Apple stops sharing anything with us.',
  },
  google: {
    button: 'Confirm with Google',
    note: 'Sign in with Google once more to confirm — it is how this account signs in.',
  },
};
type DeleteValues = z.infer<typeof deleteSchema>;

interface SwitchSpec {
  key: keyof PrivacySettings;
  icon: typeof Database;
  label: string;
  helper: string;
}

/**
 * Three switches, each of which changes something the server actually does
 * (RULES P7). There is nothing here that only looks like a setting: a
 * screen full of toggles that go nowhere is worse than no screen.
 */
const SWITCHES: readonly SwitchSpec[] = [
  {
    key: 'analytics',
    icon: ChartNoAxesColumn,
    label: 'Usage analytics',
    helper:
      'Which screens get used, so we know what to improve. Off means nothing is recorded.',
  },
  {
    key: 'personalisedOffers',
    icon: Sparkles,
    label: 'Personalised offers',
    helper:
      'Deals picked from what you browse and buy. Off means you only get offers everyone gets.',
  },
  {
    key: 'shareNameWithReferrer',
    icon: UserRoundX,
    label: 'Show my name to whoever invited me',
    helper:
      'Off shows them "A friend" instead. They still get their referral coins.',
  },
];

/**
 * What the app knows, what it does with it, and the two things only the
 * member can do: take a copy out and end the account.
 *
 * Each switch moves at once and moves back if the server refuses, because a
 * consent control that waits for the network reads as one that did not
 * work. Deletion is scheduled rather than immediate (RULES P5): the grace
 * window is what makes a tap in anger recoverable, and while one is pending
 * the whole screen leads with the way to call it off.
 */
export const PrivacyScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const balance = useCoinBalance();

  const privacy = usePrivacySettings();
  const deletion = useAccountDeletion();
  const savingPrivacy = useAccountStore(s => s.savingPrivacy);
  const loadPrivacy = useAccountStore(s => s.loadPrivacy);
  const loadDeletion = useAccountStore(s => s.loadDeletion);
  const setPrivacy = useAccountStore(s => s.setPrivacy);
  const setDeletion = useAccountStore(s => s.setDeletion);

  const [isExporting, setExporting] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const [isCancelOpen, setCancelOpen] = useState(false);
  const [isDeleting, setDeleting] = useState(false);

  const form = useForm<DeleteValues>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: '', reason: '' },
  });

  useEffect(() => {
    loadPrivacy();
    loadDeletion();
  }, [loadDeletion, loadPrivacy]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  const onToggle = useCallback(
    (key: keyof PrivacySettings) => async (value: boolean) => {
      try {
        await setPrivacy(key, value);
      } catch (error) {
        toast.show({
          title: "Couldn't save that",
          message: toApiError(error).message,
          tone: 'warning',
        });
      }
    },
    [setPrivacy, toast],
  );

  /**
   * The export is handed to the share sheet rather than written to disk: the
   * app has no file browser to point at afterwards, and a member wanting
   * their data wants it somewhere they can keep it — a mail to themselves, a
   * notes app, a drive.
   */
  const onExport = useCallback(async () => {
    setExporting(true);
    try {
      const data = await accountApi.exportData();
      await Share.share({
        title: 'My VOKVE data',
        message: JSON.stringify(data, null, 2),
      });
    } catch (error) {
      const apiError = toApiError(error);
      const seconds = Number(apiError.details?.retryAfterSeconds ?? 0);
      toast.show({
        title:
          apiError.code === 'EXPORT_TOO_SOON'
            ? 'You asked for this recently'
            : "Couldn't prepare your data",
        message:
          apiError.code === 'EXPORT_TOO_SOON' && seconds > 0
            ? `Try again in about ${Math.ceil(seconds / 3600)} hours.`
            : apiError.message,
        tone: 'warning',
      });
    } finally {
      setExporting(false);
    }
  }, [toast]);

  const confirmWith: DeletionConfirmation = deletion?.confirmWith ?? 'password';

  /**
   * The proof the account gives (RULES O16): its password, or a fresh sign-in
   * with its provider. Null when there is nothing to send — the member backed
   * out of Apple's or Google's sheet, which is a decision, not an error.
   */
  const confirmation = useCallback(
    async (
      values: DeleteValues,
    ): Promise<Parameters<typeof accountApi.scheduleDeletion>[0] | null> => {
      const reason = values.reason || undefined;
      if (confirmWith === 'password') {
        if (!values.password) {
          form.setError('password', { message: 'Enter your password' });
          return null;
        }
        return { password: values.password, reason };
      }
      const proof = await confirmWithProvider(confirmWith);
      return proof ? { ...proof, reason } : null;
    },
    [confirmWith, form],
  );

  const onSubmitDelete = form.handleSubmit(async values => {
    setDeleting(true);
    try {
      const input = await confirmation(values);
      if (!input) return;
      const result = await accountApi.scheduleDeletion(input);
      if (confirmWith === 'apple') {
        // The server just revoked VOKVE from this Apple ID on purpose; the
        // credential watch must not read that as the member walking out.
        forgetAppleUser();
      }
      setDeletion(result);
      form.reset();
      setDeleteOpen(false);
      toast.show({
        title: 'Deletion scheduled',
        message: result.purgeAt
          ? `Your data is erased ${formatDaysUntil(
              result.purgeAt,
            )}. You can cancel any time before then.`
          : undefined,
        tone: 'warning',
        durationMs: 6000,
      });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.fieldErrors.password) {
        form.setError('password', { message: apiError.fieldErrors.password });
      } else {
        toast.show({
          title: "Couldn't schedule it",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setDeleting(false);
    }
  });

  const onCancelDeletion = useCallback(async () => {
    try {
      setDeletion(await accountApi.cancelDeletion());
      toast.show({
        title: 'Deletion cancelled',
        message: 'Your account stays exactly as it was.',
        tone: 'success',
      });
    } catch (error) {
      toast.show({
        title: "Couldn't cancel it",
        message: toApiError(error).message,
        tone: 'error',
      });
    }
  }, [setDeletion, toast]);

  const isScheduled = deletion?.scheduledAt != null;
  const cancelActions = [
    { label: 'Keep my account', onPress: onCancelDeletion },
  ];

  return (
    <Screen edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Privacy & data"
          subtitle="What we keep, what we use it for, and how to take it back"
        />

        {isScheduled && deletion?.purgeAt ? (
          <Alert
            tone="warning"
            title="Your account is scheduled for deletion"
            message={`Everything personal is erased ${formatDaysUntil(
              deletion.purgeAt,
            )}. Cancel any time before then and nothing is lost.`}
            action={
              <Button
                label="Cancel deletion"
                variant="secondary"
                size="xs"
                onPress={() => setCancelOpen(true)}
              />
            }
          />
        ) : null}

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <AppText variant="label" color="textSecondary">
              Your choices
            </AppText>

            {privacy === null ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              SWITCHES.map((spec, index) => (
                <React.Fragment key={spec.key}>
                  {index > 0 ? <Divider /> : null}
                  <HStack align="start" gap="md">
                    <Icon as={spec.icon} size="md" tint={colors.primary} />
                    <View style={styles.grow}>
                      <Switch
                        label={spec.label}
                        helper={spec.helper}
                        value={privacy[spec.key]}
                        onChange={onToggle(spec.key)}
                        disabled={savingPrivacy.includes(spec.key)}
                      />
                    </View>
                  </HStack>
                </React.Fragment>
              ))
            )}
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <HStack align="center" gap="md">
              <Icon as={Database} size="md" tint={colors.success} />
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Download my data</AppText>
                <AppText variant="micro" color="textSecondary">
                  Your profile, activity, workouts, orders, addresses and
                  notifications, as one file. Once a day.
                </AppText>
              </VStack>
            </HStack>
            <Button
              label="Prepare my data"
              variant="secondary"
              fullWidth
              loading={isExporting}
              disabled={isExporting}
              onPress={onExport}
            />
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <HStack align="center" gap="md">
              <Icon as={Trash2} size="md" tint={colors.destructive} />
              <VStack flex={1} gap="xxs">
                <AppText variant="bodyStrong">Delete my account</AppText>
                <AppText variant="micro" color="textSecondary">
                  {isScheduled
                    ? `Scheduled ${
                        deletion?.scheduledAt
                          ? formatRelativeDay(deletion.scheduledAt)
                          : ''
                      }. Your coins, orders and history are erased when the window closes.`
                    : `Scheduled ${
                        deletion?.graceDays ?? 14
                      } days ahead so you can change your mind. Order and payment records are kept anonymised for accounting.`}
                </AppText>
              </VStack>
            </HStack>
            {isScheduled ? (
              <Button
                label="Cancel deletion"
                variant="brand"
                fullWidth
                onPress={() => setCancelOpen(true)}
              />
            ) : (
              <Button
                label="Delete my account"
                variant="destructive"
                fullWidth
                onPress={() => setDeleteOpen(true)}
              />
            )}
          </VStack>
        </Card>
      </ScrollView>

      <BottomSheet
        visible={isDeleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete your account?"
        dismissible={!isDeleting}
      >
        <VStack gap="md" pb="base">
          <Alert
            tone="warning"
            title={`This takes effect in ${deletion?.graceDays ?? 14} days`}
            message="Until then you can cancel it from this screen and nothing is lost. After that your profile, activity, workouts and saved addresses are erased."
          />
          {confirmWith === 'password' ? (
            <FormInput
              control={form.control}
              name="password"
              label="Your password"
              helper="Asked for again because this cannot be undone once the window closes."
              secureTextEntry
              textContentType="password"
            />
          ) : (
            <AppText variant="caption" color="textSecondary">
              {CONFIRM_COPY[confirmWith].note}
            </AppText>
          )}
          <FormInput
            control={form.control}
            name="reason"
            label="Why are you leaving? (optional)"
            placeholder="Anything you tell us helps"
          />
          <Button
            label={
              confirmWith === 'password'
                ? 'Schedule deletion'
                : CONFIRM_COPY[confirmWith].button
            }
            variant="destructive"
            fullWidth
            loading={isDeleting}
            disabled={isDeleting}
            // Apple's mark takes the label's colour; Google's is fixed
            // colours that would sit badly on red, so its words carry it.
            icon={
              confirmWith === 'apple' ? (
                <AppleMark color={colors.primaryForeground} />
              ) : undefined
            }
            onPress={() => onSubmitDelete()}
          />
        </VStack>
      </BottomSheet>

      <ActionSheet
        visible={isCancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel the deletion?"
        message="Your account carries on exactly as it is, with everything still in it."
        actions={cancelActions}
        cancelLabel="Leave it scheduled"
      />
    </Screen>
  );
};
