import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  BadgeCheck,
  LogOut,
  Mail,
  Phone,
  Smartphone,
  TriangleAlert,
} from 'lucide-react-native';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { BottomSheet } from '../../components/disclosure/BottomSheet';
import { useToast } from '../../components/feedback/Toast';
import { FormInput, FormPhoneInput } from '../../components/form/fields';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { accountApi } from '../../services/api/endpoints';
import { toApiError } from '../../services/api/errors';
import { useAuthStore, useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { DEFAULT_COUNTRY_CODE, findCountry } from '../../constants/countries';
import {
  changeEmailSchema,
  changePasswordSchema,
  changePhoneSchema,
  type ChangeEmailValues,
  type ChangePasswordValues,
  type ChangePhoneValues,
} from '../../types/forms';
import { EMPTY_PHONE } from '../../components/form/PhoneInput';
import type { AccountSession } from '../../types/models';
import { formatPhoneNumber, formatRelativeDay } from '../../utils/format';

const makeStyles = ({ spacing, colors }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
    empty: { paddingVertical: spacing.lg, alignItems: 'center' },
    current: {
      borderRadius: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      backgroundColor: colors.muted,
    },
    grow: { flex: 1 },
  });

/** Which sheet is open, if any — only one can be at a time. */
type OpenSheet = 'password' | 'email' | 'phone' | null;

/**
 * Everything about getting into the account: the password, the two contacts
 * it can be recovered through, and the devices holding a live session.
 *
 * A contact change never happens here alone — the password proves it is the
 * member, then a code goes to the **new** address and only passing it moves
 * the account (RULES O2). That is why each of these opens the OTP screen
 * rather than finishing in the sheet: the code is the last word, and the
 * screen that takes codes already exists.
 *
 * Changing the password signs every other device out, which is the point of
 * changing it; the count comes back from the server so the toast can say how
 * many.
 */
export const SecurityScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();
  const setPendingVerification = useAuthStore(s => s.setPendingVerification);

  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [sessions, setSessions] = useState<AccountSession[] | null>(null);
  const [isLoadingSessions, setLoadingSessions] = useState(true);
  const [isBusy, setBusy] = useState(false);
  const [isRevokeOpen, setRevokeOpen] = useState(false);

  const password = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });
  const email = useForm<ChangeEmailValues>({
    resolver: zodResolver(changeEmailSchema),
    defaultValues: { email: '', password: '' },
  });
  const phone = useForm<ChangePhoneValues>({
    resolver: zodResolver(changePhoneSchema),
    defaultValues: {
      phone: { ...EMPTY_PHONE, country: DEFAULT_COUNTRY_CODE },
      password: '',
    },
  });

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      setSessions(await accountApi.sessions());
    } catch (error) {
      toast.show({
        title: "Couldn't load your devices",
        message: toApiError(error).message,
        tone: 'warning',
      });
    } finally {
      setLoadingSessions(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  const closeSheet = useCallback(() => setSheet(null), []);

  const onSubmitPassword = password.handleSubmit(async values => {
    setBusy(true);
    try {
      const result = await accountApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      password.reset();
      setSheet(null);
      loadSessions();
      toast.show({
        title: 'Password changed',
        message:
          result.signedOutSessions > 0
            ? `${result.signedOutSessions} other ${
                result.signedOutSessions === 1 ? 'device was' : 'devices were'
              } signed out.`
            : 'This is the only device signed in.',
        tone: 'success',
      });
    } catch (error) {
      const apiError = toApiError(error);
      for (const [field, message] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          password.setError(field as keyof ChangePasswordValues, { message });
        }
      }
      if (Object.keys(apiError.fieldErrors).length === 0) {
        toast.show({
          title: "Couldn't change your password",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setBusy(false);
    }
  });

  /** Both contact changes end the same way: park the challenge, open the code screen. */
  const startVerification = useCallback(
    (challenge: Awaited<ReturnType<typeof accountApi.changeEmail>>) => {
      setSheet(null);
      setPendingVerification(challenge);
      navigation.navigate('Auth', { screen: 'VerifyOtp' });
    },
    [navigation, setPendingVerification],
  );

  const onSubmitEmail = email.handleSubmit(async values => {
    setBusy(true);
    try {
      const challenge = await accountApi.changeEmail(values);
      email.reset();
      startVerification(challenge);
      toast.show({
        title: 'Check your new inbox',
        message: `We sent a code to ${values.email}.`,
        tone: 'info',
      });
    } catch (error) {
      const apiError = toApiError(error);
      for (const [field, message] of Object.entries(apiError.fieldErrors)) {
        if (field in values) {
          email.setError(field as keyof ChangeEmailValues, { message });
        }
      }
      if (Object.keys(apiError.fieldErrors).length === 0) {
        toast.show({
          title: "Couldn't change your email",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setBusy(false);
    }
  });

  const onSubmitPhone = phone.handleSubmit(async values => {
    setBusy(true);
    const e164 = `${findCountry(values.phone.country).dialCode}${
      values.phone.number
    }`;
    try {
      const challenge = await accountApi.changePhone({
        phone: e164,
        password: values.password,
      });
      phone.reset();
      startVerification(challenge);
      toast.show({
        title: 'Check your new number',
        message: `We sent a code to ${formatPhoneNumber(e164)}.`,
        tone: 'info',
      });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.fieldErrors.password) {
        phone.setError('password', { message: apiError.fieldErrors.password });
      } else if (apiError.fieldErrors.phone) {
        phone.setError('phone.number', { message: apiError.fieldErrors.phone });
      } else {
        toast.show({
          title: "Couldn't change your number",
          message: apiError.message,
          tone: 'error',
        });
      }
    } finally {
      setBusy(false);
    }
  });

  const onRevokeOthers = useCallback(async () => {
    try {
      const result = await accountApi.revokeOtherSessions();
      await loadSessions();
      toast.show({
        title:
          result.signedOut > 0
            ? `${result.signedOut} ${
                result.signedOut === 1 ? 'device' : 'devices'
              } signed out`
            : 'Nothing to sign out',
        message:
          result.signedOut > 0
            ? 'They will need to sign in again.'
            : 'This is the only device signed in.',
        tone: 'success',
      });
    } catch (error) {
      toast.show({
        title: "Couldn't sign them out",
        message: toApiError(error).message,
        tone: 'error',
      });
    }
  }, [loadSessions, toast]);

  const revokeActions = [
    {
      label: 'Sign out other devices',
      icon: LogOut,
      destructive: true,
      onPress: onRevokeOthers,
    },
  ];
  const others = (sessions ?? []).filter(session => !session.isCurrent).length;

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Security"
          subtitle="Your password, contacts and signed-in devices"
        />

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <AppText variant="label" color="textSecondary">
              Sign-in details
            </AppText>

            <HStack align="center" gap="md">
              <Icon as={Mail} size="md" tint={colors.primary} />
              <VStack flex={1} gap="xxs">
                <AppText variant="body" numberOfLines={1}>
                  {user?.email ?? '—'}
                </AppText>
                <HStack align="center" gap="xxs">
                  <Icon
                    as={user?.emailVerifiedAt ? BadgeCheck : TriangleAlert}
                    size="xs"
                    tint={
                      user?.emailVerifiedAt ? colors.success : colors.warning
                    }
                  />
                  <AppText variant="micro" color="textTertiary">
                    {user?.emailVerifiedAt ? 'Verified' : 'Not verified'}
                  </AppText>
                </HStack>
              </VStack>
              <Button
                label="Change"
                variant="secondary"
                size="xs"
                onPress={() => setSheet('email')}
              />
            </HStack>

            <Divider />

            <HStack align="center" gap="md">
              <Icon as={Phone} size="md" tint={colors.primary} />
              <VStack flex={1} gap="xxs">
                <AppText variant="body" numberOfLines={1}>
                  {user?.phone
                    ? formatPhoneNumber(user.phone)
                    : 'No number yet'}
                </AppText>
                <HStack align="center" gap="xxs">
                  <Icon
                    as={user?.phoneVerifiedAt ? BadgeCheck : TriangleAlert}
                    size="xs"
                    tint={
                      user?.phoneVerifiedAt ? colors.success : colors.warning
                    }
                  />
                  <AppText variant="micro" color="textTertiary">
                    {user?.phoneVerifiedAt ? 'Verified' : 'Not verified'}
                  </AppText>
                </HStack>
              </VStack>
              <Button
                label="Change"
                variant="secondary"
                size="xs"
                onPress={() => setSheet('phone')}
              />
            </HStack>

            <Divider />

            <HStack align="center" justify="between" gap="md">
              <VStack flex={1} gap="xxs">
                <AppText variant="body">Password</AppText>
                <AppText variant="micro" color="textTertiary">
                  Changing it signs every other device out.
                </AppText>
              </VStack>
              <Button
                label="Change"
                variant="secondary"
                size="xs"
                onPress={() => setSheet('password')}
              />
            </HStack>
          </VStack>
        </Card>

        <Card radius="xl" padding="base">
          <VStack gap="md">
            <HStack align="center" justify="between">
              <AppText variant="label" color="textSecondary">
                Signed-in devices
              </AppText>
              {sessions ? (
                <AppText variant="micro" color="textTertiary">
                  {`${sessions.length} ${
                    sessions.length === 1 ? 'device' : 'devices'
                  }`}
                </AppText>
              ) : null}
            </HStack>

            {isLoadingSessions && sessions === null ? (
              <View style={styles.empty}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              (sessions ?? []).map((session, index) => (
                <React.Fragment key={session.id}>
                  {index > 0 ? <Divider /> : null}
                  <HStack align="center" gap="md">
                    <Icon
                      as={Smartphone}
                      size="md"
                      tint={colors.textSecondary}
                    />
                    <VStack flex={1} gap="xxs">
                      <HStack align="center" gap="sm" wrap>
                        <AppText variant="body" numberOfLines={1}>
                          {[session.brand, session.model]
                            .filter(Boolean)
                            .join(' ') ||
                            (session.platform === 'ios'
                              ? 'iPhone'
                              : 'Android phone')}
                        </AppText>
                        {session.isCurrent ? (
                          <View style={styles.current}>
                            <AppText variant="miniMicro" color="textSecondary">
                              This device
                            </AppText>
                          </View>
                        ) : null}
                      </HStack>
                      <AppText variant="micro" color="textTertiary">
                        {[
                          session.platform === 'ios' ? 'iOS' : 'Android',
                          session.osVersion,
                          session.appVersion
                            ? `app ${session.appVersion}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </AppText>
                      {session.lastSeenAt ? (
                        <AppText variant="micro" color="textTertiary">
                          {`Last used ${formatRelativeDay(session.lastSeenAt)}`}
                        </AppText>
                      ) : null}
                    </VStack>
                  </HStack>
                </React.Fragment>
              ))
            )}

            {others > 0 ? (
              <Button
                label={`Sign out ${others} other ${
                  others === 1 ? 'device' : 'devices'
                }`}
                variant="secondary"
                fullWidth
                onPress={() => setRevokeOpen(true)}
              />
            ) : null}
          </VStack>
        </Card>
      </KeyboardAwareScrollView>

      <BottomSheet
        visible={sheet === 'password'}
        onClose={closeSheet}
        title="Change password"
        dismissible={!isBusy}
      >
        <VStack gap="md" pb="base">
          <FormInput
            control={password.control}
            name="currentPassword"
            label="Current password"
            secureTextEntry
            textContentType="password"
          />
          <FormInput
            control={password.control}
            name="newPassword"
            label="New password"
            helper="At least 8 characters, with a letter and a number."
            secureTextEntry
            textContentType="newPassword"
          />
          <FormInput
            control={password.control}
            name="confirmPassword"
            label="Confirm new password"
            secureTextEntry
            textContentType="newPassword"
          />
          <Button
            label="Change password"
            variant="brand"
            fullWidth
            loading={isBusy}
            disabled={isBusy}
            onPress={() => onSubmitPassword()}
          />
        </VStack>
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'email'}
        onClose={closeSheet}
        title="Change email"
        dismissible={!isBusy}
      >
        <VStack gap="md" pb="base">
          <AppText variant="caption" color="textSecondary">
            We will send a code to the new address. Your current one keeps
            working until you enter it.
          </AppText>
          <FormInput
            control={email.control}
            name="email"
            label="New email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <FormInput
            control={email.control}
            name="password"
            label="Your password"
            secureTextEntry
            textContentType="password"
          />
          <Button
            label="Send code"
            variant="brand"
            fullWidth
            loading={isBusy}
            disabled={isBusy}
            onPress={() => onSubmitEmail()}
          />
        </VStack>
      </BottomSheet>

      <BottomSheet
        visible={sheet === 'phone'}
        onClose={closeSheet}
        title="Change phone number"
        dismissible={!isBusy}
      >
        <VStack gap="md" pb="base">
          <AppText variant="caption" color="textSecondary">
            We will text a code to the new number. Your current one keeps
            working until you enter it.
          </AppText>
          <FormPhoneInput
            control={phone.control}
            name="phone"
            label="New number"
          />
          <FormInput
            control={phone.control}
            name="password"
            label="Your password"
            secureTextEntry
            textContentType="password"
          />
          <Button
            label="Send code"
            variant="brand"
            fullWidth
            loading={isBusy}
            disabled={isBusy}
            onPress={() => onSubmitPhone()}
          />
        </VStack>
      </BottomSheet>

      <ActionSheet
        visible={isRevokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Sign out other devices?"
        message="Every device but this one will have to sign in again. Your data is not affected."
        actions={revokeActions}
        cancelLabel="Keep them signed in"
      />
    </Screen>
  );
};
