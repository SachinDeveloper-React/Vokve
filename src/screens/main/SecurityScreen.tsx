import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  BadgeCheck,
  Link2Off,
  LogOut,
  Mail,
  Phone,
  Smartphone,
  TriangleAlert,
} from 'lucide-react-native';
import { AppleMark, GoogleMark } from '../../components/auth/SocialAuthRow';
import { ActionSheet } from '../../components/disclosure/ActionSheet';
import { BottomSheet } from '../../components/disclosure/BottomSheet';
import { useToast } from '../../components/feedback/Toast';
import { FormInput } from '../../components/form/fields';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { Divider } from '../../components/layout/Divider';
import { HStack, VStack } from '../../components/layout/Stack';
import { Icon } from '../../components/media/Icon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { accountApi } from '../../services/api/endpoints';
import { forgetAppleUser } from '../../services/appleCredential';
import { signInWithApple } from '../../services/appleSignIn';
import { confirmWithProvider } from '../../services/providerConfirmation';
import { signInWithGoogle } from '../../services/googleSignIn';
import { toApiError } from '../../services/api/errors';
import { useAuthStore, useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import {
  changeEmailSchema,
  changePasswordSchema,
  type ChangeEmailValues,
  type ChangePasswordValues,
} from '../../types/forms';
import type {
  AccountSession,
  SignInMethods,
  SignInProvider,
} from '../../types/models';
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
type OpenSheet = 'password' | 'email' | null;

const PROVIDER_NAME: Record<SignInProvider, string> = {
  google: 'Google',
  apple: 'Apple',
};

/**
 * Everything about getting into the account: the password, the two contacts
 * it can be recovered through, and the devices holding a live session.
 *
 * A contact change never happens here alone — the password proves it is the
 * member, then a code goes to the **new** address and only passing it moves
 * the account (RULES O2). That is why the email change opens the OTP screen
 * rather than finishing in the sheet: the code is the last word, and the
 * screen that takes codes already exists. The phone has a screen of its own
 * (`VerifyPhone`, RULES O14): Firebase sends that code, and the same screen
 * adds a first number to a Google or Apple account, which has no password.
 *
 * Changing the password signs every other device out, which is the point of
 * changing it; the count comes back from the server so the toast can say how
 * many.
 *
 * Google and Apple can be connected here to an account made any other way
 * (RULES O15), which is what lets a member who hides their email from Apple
 * still sign in with Apple to the account they already have. Whether one
 * can be disconnected is the server's answer — never the last way in.
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
  const [methods, setMethods] = useState<SignInMethods | null>(null);
  const [busyProvider, setBusyProvider] = useState<SignInProvider | null>(null);
  const [disconnecting, setDisconnecting] = useState<SignInProvider | null>(
    null,
  );

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

  const loadMethods = useCallback(async () => {
    try {
      setMethods(await accountApi.signInMethods());
    } catch {
      // The card says nothing rather than something wrong; the rest of the
      // screen does not depend on it.
      setMethods(null);
    }
  }, []);

  useEffect(() => {
    loadMethods();
  }, [loadMethods]);

  /**
   * The provider's own sheet, then the server: the token proves the
   * identity, and the session says whose account it goes on.
   */
  const onConnect = useCallback(
    async (provider: SignInProvider) => {
      const name = PROVIDER_NAME[provider];
      setBusyProvider(provider);
      try {
        let next: SignInMethods;
        if (provider === 'google') {
          const outcome = await signInWithGoogle();
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') throw new Error(outcome.message);
          next = await accountApi.connectGoogle(outcome.idToken);
        } else {
          const outcome = await signInWithApple();
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') throw new Error(outcome.message);
          next = await accountApi.connectApple({
            idToken: outcome.idToken,
            nonce: outcome.nonce,
            fullName: outcome.fullName,
          });
        }
        setMethods(next);
        toast.show({
          title: `${name} connected`,
          message: `Sign in with ${name} now opens this account.`,
          tone: 'success',
        });
      } catch (error) {
        toast.show({
          title: `Couldn't connect ${name}`,
          message: toApiError(error).message,
          tone: 'error',
        });
      } finally {
        setBusyProvider(null);
      }
    },
    [toast],
  );

  const onDisconnect = useCallback(async () => {
    const provider = disconnecting;
    if (!provider) return;
    const name = PROVIDER_NAME[provider];
    setBusyProvider(provider);
    try {
      if (provider === 'apple') {
        // Apple is confirmed with Apple, and that sign-in is what the server
        // revokes VOKVE from the Apple ID with (RULES O16).
        const proof = await confirmWithProvider('apple');
        if (!proof || !('apple' in proof)) return;
        setMethods(await accountApi.disconnect('apple', proof.apple));
        // Revoked on purpose: not a reason to sign this phone out.
        forgetAppleUser();
      } else {
        setMethods(await accountApi.disconnect(provider));
      }
      toast.show({
        title: `${name} disconnected`,
        message: `${name} no longer signs in to this account.`,
        tone: 'success',
      });
    } catch (error) {
      toast.show({
        title: `Couldn't disconnect ${name}`,
        message: toApiError(error).message,
        tone: 'error',
      });
    } finally {
      setBusyProvider(null);
    }
  }, [disconnecting, toast]);

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

  /**
   * How this account proves an email change (RULES O17): its password, or —
   * for an account made with Apple or Google, which has none — a fresh
   * sign-in with that provider. The server says which.
   */
  const confirmChangesWith = methods?.confirmChangesWith ?? 'password';

  const sendEmailChange = async (values: ChangeEmailValues) => {
    setBusy(true);
    try {
      let input: Parameters<typeof accountApi.changeEmail>[0] = values;
      if (confirmChangesWith !== 'password') {
        const proof = await confirmWithProvider(confirmChangesWith);
        if (!proof) return;
        input = { email: values.email, ...proof };
      }
      const challenge = await accountApi.changeEmail(input);
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
  };

  const onSubmitEmail = async () => {
    if (confirmChangesWith === 'password') {
      await email.handleSubmit(sendEmailChange)();
      return;
    }
    // No password to check: only the address is validated here, and the
    // provider's own sheet is the proof.
    if (await email.trigger('email')) {
      await sendEmailChange({ email: email.getValues('email'), password: '' });
    }
  };

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
  const disconnectActions = disconnecting
    ? [
        {
          label: `Disconnect ${PROVIDER_NAME[disconnecting]}`,
          icon: Link2Off,
          destructive: true,
          onPress: onDisconnect,
        },
      ]
    : [];

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
                {user?.emailForwardingOff ? (
                  // Apple's Hide My Email stopped forwarding (RULES O17):
                  // codes and order mail sent here go nowhere.
                  <HStack align="center" gap="xxs">
                    <Icon as={TriangleAlert} size="xs" tint={colors.warning} />
                    <AppText variant="micro" color="textSecondary">
                      Apple is not forwarding mail to this address. Change it
                      to one you read.
                    </AppText>
                  </HStack>
                ) : null}
              </VStack>
              <Button
                label="Change"
                variant={user?.emailForwardingOff ? 'brand' : 'secondary'}
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
                label={
                  !user?.phone
                    ? 'Add'
                    : user.phoneVerifiedAt
                    ? 'Change'
                    : 'Verify'
                }
                variant="secondary"
                size="xs"
                onPress={() => navigation.navigate('VerifyPhone')}
              />
            </HStack>

            {/* Only an account that has a password can change one: one made
                with Google or Apple has none, and the server says which
                (`password` in the sign-in methods). Hidden until it answers,
                so a Google member never sees the row flash up. */}
            {methods?.password ? (
              <>
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
              </>
            ) : null}
          </VStack>
        </Card>

        {methods ? (
          <Card radius="xl" padding="base">
            <VStack gap="md">
              <VStack gap="xxs">
                <AppText variant="label" color="textSecondary">
                  Sign-in methods
                </AppText>
                <AppText variant="micro" color="textTertiary">
                  Connect Google or Apple to sign in to this same account —
                  even if you hide your email from Apple.
                </AppText>
              </VStack>

              {methods.providers.map((method, index) => {
                const name = PROVIDER_NAME[method.provider];
                return (
                  <React.Fragment key={method.provider}>
                    {index > 0 ? <Divider /> : null}
                    <HStack align="center" gap="md">
                      {method.provider === 'google' ? (
                        <GoogleMark />
                      ) : (
                        <AppleMark color={colors.text} />
                      )}
                      <VStack flex={1} gap="xxs">
                        <AppText variant="body">{name}</AppText>
                        <AppText variant="micro" color="textTertiary">
                          {method.linked
                            ? method.canDisconnect
                              ? 'Connected'
                              : 'Connected · your only way in'
                            : 'Not connected'}
                        </AppText>
                      </VStack>
                      {method.linked ? (
                        method.canDisconnect ? (
                          <Button
                            label="Disconnect"
                            variant="secondary"
                            size="xs"
                            loading={busyProvider === method.provider}
                            disabled={busyProvider !== null}
                            onPress={() => setDisconnecting(method.provider)}
                          />
                        ) : null
                      ) : (
                        <Button
                          label="Connect"
                          variant="secondary"
                          size="xs"
                          loading={busyProvider === method.provider}
                          disabled={busyProvider !== null}
                          onPress={() => onConnect(method.provider)}
                        />
                      )}
                    </HStack>
                  </React.Fragment>
                );
              })}

              {!methods.password ? (
                <AppText variant="micro" color="textTertiary">
                  No password on this account. To set one, sign out and use
                  Forgot password with your email.
                </AppText>
              ) : null}
            </VStack>
          </Card>
        ) : null}

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
        visible={sheet === 'password' && methods?.password === true}
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
          {confirmChangesWith === 'password' ? (
            <FormInput
              control={email.control}
              name="password"
              label="Your password"
              secureTextEntry
              textContentType="password"
            />
          ) : (
            <AppText variant="caption" color="textSecondary">
              {`This account has no password, so you confirm with ${
                confirmChangesWith === 'apple' ? 'Apple' : 'Google'
              } instead.`}
            </AppText>
          )}
          <Button
            label={
              confirmChangesWith === 'password'
                ? 'Send code'
                : `Confirm with ${confirmChangesWith === 'apple' ? 'Apple' : 'Google'}`
            }
            variant="brand"
            fullWidth
            loading={isBusy}
            disabled={isBusy}
            onPress={() => onSubmitEmail()}
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

      <ActionSheet
        visible={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        title={
          disconnecting
            ? `Disconnect ${PROVIDER_NAME[disconnecting]}?`
            : undefined
        }
        message={
          disconnecting === 'apple'
            ? 'You will confirm with Apple, and VOKVE is removed from your Apple ID. Your data is not affected, and you can connect Apple again any time.'
            : disconnecting
            ? `${PROVIDER_NAME[disconnecting]} will stop signing in to this account. Your data is not affected, and you can connect it again any time.`
            : undefined
        }
        actions={disconnectActions}
        cancelLabel="Keep it connected"
      />
    </Screen>
  );
};
