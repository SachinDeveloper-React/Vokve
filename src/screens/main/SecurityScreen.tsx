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
import { AppleMark, FacebookMark, GoogleMark } from '../../components/auth/SocialAuthRow';
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
import { signInWithFacebook } from '../../services/facebookSignIn';
import { toApiError } from '../../services/api/errors';
import {
  useAuthStore,
  useCurrentUser,
  usePendingContactVerification,
  useStepUpToken,
} from '../../stores/authStore';
import type { AppleSignInPayload, FacebookProof } from '../../services/api/contracts';
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

/**
 * A change to how the account signs in, held whole so it can be sent again
 * after a step-up code (RULES O22) without opening the provider's sheet a
 * second time: the server asks for the code before it looks at the
 * provider's token, so the token is still good.
 */
type MethodChange =
  | { kind: 'connect'; provider: 'google'; idToken: string }
  | { kind: 'connect'; provider: 'facebook'; proof: FacebookProof }
  | { kind: 'connect'; provider: 'apple'; payload: Omit<AppleSignInPayload, 'ifNew'> }
  | { kind: 'disconnect'; provider: 'google' | 'facebook' };

/** The change, with the step-up token only when there is one. */
function sendChange(change: MethodChange, stepUpToken?: string): Promise<SignInMethods> {
  if (change.kind === 'disconnect') {
    return stepUpToken
      ? accountApi.disconnect(change.provider, undefined, stepUpToken)
      : accountApi.disconnect(change.provider);
  }
  switch (change.provider) {
    case 'google':
      return stepUpToken
        ? accountApi.connectGoogle(change.idToken, stepUpToken)
        : accountApi.connectGoogle(change.idToken);
    case 'facebook':
      return stepUpToken
        ? accountApi.connectFacebook(change.proof, stepUpToken)
        : accountApi.connectFacebook(change.proof);
    case 'apple':
      return stepUpToken
        ? accountApi.connectApple(change.payload, stepUpToken)
        : accountApi.connectApple(change.payload);
  }
}

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
  facebook: 'Facebook',
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
  // A change waiting on a step-up code (RULES O22), sent again once it passes.
  const [parkedChange, setParkedChange] = useState<MethodChange | null>(null);
  const stepUpToken = useStepUpToken();
  const pendingCode = usePendingContactVerification();

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
   * Sends one change and says how it went. A session not signed in within
   * the last ten minutes is asked for an email code first (RULES O22): the
   * change waits here while the code screen is open and goes again with the
   * token the code returns.
   */
  const runChange = useCallback(
    async (change: MethodChange, withStepUp?: string) => {
      const name = PROVIDER_NAME[change.provider];
      const verb = change.kind === 'connect' ? 'connect' : 'disconnect';
      setBusyProvider(change.provider);
      try {
        setMethods(await sendChange(change, withStepUp));
        toast.show(
          change.kind === 'connect'
            ? {
                title: `${name} connected`,
                message: `Sign in with ${name} now opens this account.`,
                tone: 'success',
              }
            : {
                title: `${name} disconnected`,
                message: `${name} no longer signs in to this account.`,
                tone: 'success',
              },
        );
      } catch (error) {
        const apiError = toApiError(error);
        const wantsCode =
          apiError.code === 'STEP_UP_REQUIRED' ||
          apiError.code === 'STEP_UP_INVALID';
        if (wantsCode && !withStepUp) {
          // The code is asked for first and the change parked only once it
          // is on its way: parked earlier, the effect below would read "no
          // code pending" as the member having backed out.
          const asked = await useAuthStore.getState().requestStepUp();
          if (asked) {
            setParkedChange(change);
            return;
          }
          toast.show({
            title: `Couldn't ${verb} ${name}`,
            message: (useAuthStore.getState().error ?? apiError).message,
            tone: 'error',
          });
          return;
        }
        toast.show({
          title: `Couldn't ${verb} ${name}`,
          message: apiError.message,
          tone: 'error',
        });
      } finally {
        setBusyProvider(null);
      }
    },
    [toast],
  );

  // The code passed: send the change it was asked for.
  useEffect(() => {
    if (!stepUpToken || !parkedChange) {
      return;
    }
    const token = useAuthStore.getState().takeStepUpToken();
    const change = parkedChange;
    setParkedChange(null);
    runChange(change, token ?? undefined);
  }, [parkedChange, runChange, stepUpToken]);

  // The code screen closed without a code: nothing changes.
  useEffect(() => {
    if (parkedChange && !pendingCode && !stepUpToken) {
      setParkedChange(null);
      toast.show({
        title: `${PROVIDER_NAME[parkedChange.provider]} not ${
          parkedChange.kind === 'connect' ? 'connected' : 'disconnected'
        }`,
        message: 'The change needs the code we emailed you.',
        tone: 'info',
      });
    }
  }, [parkedChange, pendingCode, stepUpToken, toast]);

  /**
   * The provider's own sheet, then the server: the token proves the
   * identity, and the session says whose account it goes on.
   */
  const onConnect = useCallback(
    async (provider: SignInProvider) => {
      setBusyProvider(provider);
      try {
        if (provider === 'google') {
          const outcome = await signInWithGoogle();
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') throw new Error(outcome.message);
          await runChange({ kind: 'connect', provider, idToken: outcome.idToken });
        } else if (provider === 'facebook') {
          const outcome = await signInWithFacebook();
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') throw new Error(outcome.message);
          await runChange({ kind: 'connect', provider, proof: outcome.proof });
        } else {
          const outcome = await signInWithApple();
          if (outcome.kind === 'cancelled') return;
          if (outcome.kind === 'failed') throw new Error(outcome.message);
          await runChange({
            kind: 'connect',
            provider,
            payload: {
              idToken: outcome.idToken,
              nonce: outcome.nonce,
              fullName: outcome.fullName,
            },
          });
        }
      } catch (error) {
        toast.show({
          title: `Couldn't connect ${PROVIDER_NAME[provider]}`,
          message: toApiError(error).message,
          tone: 'error',
        });
      } finally {
        setBusyProvider(null);
      }
    },
    [runChange, toast],
  );

  const onDisconnect = useCallback(async () => {
    const provider = disconnecting;
    if (!provider) return;
    if (provider !== 'apple') {
      await runChange({ kind: 'disconnect', provider });
      return;
    }
    const name = PROVIDER_NAME[provider];
    setBusyProvider(provider);
    try {
      // Apple is confirmed with Apple, and that sign-in is what the server
      // revokes VOKVE from the Apple ID with (RULES O16) — proof of the
      // member in itself, so no code is asked for.
      const proof = await confirmWithProvider('apple');
      if (!proof || !('apple' in proof)) return;
      setMethods(await accountApi.disconnect('apple', proof.apple));
      // Revoked on purpose: not a reason to sign this phone out.
      forgetAppleUser();
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
  }, [disconnecting, runChange, toast]);

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
                  Connect Google, Apple or Facebook to sign in to this same
                  account — even if you hide your email from Apple.
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
                      ) : method.provider === 'facebook' ? (
                        <FacebookMark />
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
