import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '../../components/feedback';
import { useToast } from '../../components/feedback/Toast';
import { FormInput, FormPhoneInput } from '../../components/form/fields';
import { OtpInput, type OtpInputHandle } from '../../components/form';
import { formatPhone, parsePhone } from '../../components/form/PhoneInput';
import { ResendOtpRow } from '../../components';
import { HistoryHeader } from '../../components/history/HistoryHeader';
import { HStack, VStack } from '../../components/layout/Stack';
import { Pressable } from '../../components/form/Pressable';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { useCountdown } from '../../hooks';
import { accountApi } from '../../services/api/endpoints';
import { toApiError, type ApiError } from '../../services/api/errors';
import {
  abandon,
  confirmCode,
  sendCode,
  watchForAutoVerification,
} from '../../services/phoneVerification';
import { useAuthStore, useCurrentUser } from '../../stores/authStore';
import { useCoinBalance } from '../../stores/coinsStore';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { verifyPhoneSchema, type VerifyPhoneValues } from '../../types/forms';
import type { RootStackScreenProps } from '../../types/navigation';
import { formatPhoneNumber } from '../../utils/format';

/** Firebase sends a fresh SMS only once the last request has timed out. */
const RESEND_AFTER_SECONDS = 60;
const CODE_LENGTH = 6;

const makeStyles = ({ spacing }: ThemeShape) =>
  StyleSheet.create({
    content: { paddingBottom: spacing.xxxl, gap: spacing.md },
  });

type Step = { kind: 'number' } | { kind: 'code'; phone: string };

/**
 * Adding, proving or changing the phone number (RULES O14).
 *
 * Firebase sends the SMS and checks the code; this screen collects the
 * number, asks the server first whether it may go on this account (so a
 * number that is someone else's, or a wrong password, costs no SMS), then
 * takes the code and hands the server the token Firebase gives back.
 *
 * Three members arrive here and the copy says which one they are: a Google
 * or Apple member with no number at all, a member proving the number they
 * signed up with, and a member replacing a number — the only one asked for
 * a password, because a number is a way back into the account.
 */
export const VerifyPhoneScreen = () => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RootStackScreenProps<'VerifyPhone'>['route']>();
  const toast = useToast();
  const user = useCurrentUser();
  const balance = useCoinBalance();

  const onFile = user?.phone ?? null;
  const isVerified = Boolean(onFile && user?.phoneVerifiedAt);

  const [step, setStep] = useState<Step>({ kind: 'number' });
  const [isBusy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const otpField = useRef<OtpInputHandle>(null);
  // Android can prove the number while the member is typing it; whichever
  // gets there first finishes, and the other is ignored.
  const isFinishing = useRef(false);
  const resend = useCountdown(step.kind === 'code' ? RESEND_AFTER_SECONDS : null);

  const form = useForm<VerifyPhoneValues>({
    resolver: zodResolver(verifyPhoneSchema),
    defaultValues: {
      // Proving the number on file starts with it typed in; changing a
      // verified one starts empty.
      phone: isVerified ? parsePhone(null) : parsePhone(onFile),
      password: '',
    },
  });
  const typed = formatPhone(useWatch({ control: form.control, name: 'phone' }));
  // Only replacing the number on the account needs the password.
  const needsPassword = Boolean(onFile) && typed !== '' && typed !== onFile;

  // Whatever happens, leave no Firebase session behind.
  useEffect(
    () => () => {
      abandon();
    },
    [],
  );

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Main', { screen: 'Account' });
  }, [navigation]);

  /** Puts the server's field messages on the fields; anything else above them. */
  const showError = useCallback(
    (error: ApiError) => {
      const { phone, password } = error.fieldErrors;
      if (phone) form.setError('phone.number', { message: phone });
      if (password) form.setError('password', { message: password });
      if (!phone && !password) setProblem(error.message);
    },
    [form],
  );

  const finish = useCallback(
    async (idToken: string) => {
      if (isFinishing.current) return;
      isFinishing.current = true;
      setBusy(true);
      try {
        const password = form.getValues('password');
        const updated = await accountApi.verifyPhone({
          idToken,
          ...(password ? { password } : {}),
        });
        useAuthStore.setState({ user: updated });
        toast.show({
          title: 'Number verified',
          message: `${formatPhoneNumber(updated.phone ?? '')} is now on your account.`,
          tone: 'success',
        });
        onPressBack();
      } catch (error) {
        // Refused at the end — taken by now, or the password: back to the
        // number, where those messages belong.
        isFinishing.current = false;
        setStep({ kind: 'number' });
        setCode('');
        showError(toApiError(error));
      } finally {
        setBusy(false);
      }
    },
    [form, onPressBack, showError, toast],
  );

  const onSend = form.handleSubmit(async values => {
    const phone = formatPhone(values.phone);
    if (needsPassword && !values.password) {
      form.setError('password', { message: 'Enter your password to change your number.' });
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await accountApi.checkPhone({
        phone,
        ...(needsPassword ? { password: values.password } : {}),
      });
    } catch (error) {
      setBusy(false);
      showError(toApiError(error));
      return;
    }

    const sent = await sendCode(phone);
    setBusy(false);
    if (sent.kind === 'failed') {
      setProblem(sent.message);
      return;
    }
    if (sent.kind === 'verified') {
      await finish(sent.idToken);
      return;
    }
    setCode('');
    setStep({ kind: 'code', phone });
  });

  const verify = useCallback(
    async (value: string) => {
      if (step.kind !== 'code' || value.length !== CODE_LENGTH) return;
      setProblem(null);
      setBusy(true);
      const outcome = await confirmCode(value);
      setBusy(false);
      if (outcome.kind === 'verified') {
        await finish(outcome.idToken);
        return;
      }
      // Android may have finished it already, from the SMS it read itself.
      if (isFinishing.current) return;
      setProblem(outcome.message);
      setCode('');
      setTimeout(() => otpField.current?.focus(), 0);
    },
    [finish, step],
  );

  const onResend = useCallback(async () => {
    if (step.kind !== 'code') return;
    setProblem(null);
    setCode('');
    setBusy(true);
    const sent = await sendCode(step.phone);
    setBusy(false);
    if (sent.kind === 'failed') {
      setProblem(sent.message);
      return;
    }
    if (sent.kind === 'verified') {
      await finish(sent.idToken);
      return;
    }
    resend.restart(RESEND_AFTER_SECONDS);
  }, [finish, resend, step]);

  const onChangeNumber = useCallback(() => {
    abandon();
    setProblem(null);
    setCode('');
    setStep({ kind: 'number' });
  }, []);

  // Android may read the SMS itself while the code screen is up.
  useEffect(() => {
    if (step.kind !== 'code') return;
    return watchForAutoVerification(step.phone, finish);
  }, [finish, step]);

  const title = !onFile
    ? 'Add your phone number'
    : isVerified
    ? 'Change your number'
    : 'Verify your number';
  const intro = !onFile
    ? 'A verified number is needed to redeem rewards. We will text you a code to confirm it.'
    : isVerified
    ? 'We will text a code to the new number. Your current one stays on the account until you confirm it.'
    : 'We will text a code to confirm the number on your account.';

  return (
    <Screen edges={['top']}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <HistoryHeader
          coins={balance}
          onPressBack={onPressBack}
          title="Phone number"
          subtitle={isVerified ? formatPhoneNumber(onFile ?? '') : 'Not verified yet'}
        />

        {params?.reason === 'redeem' ? (
          <Alert
            tone="info"
            title="One step before you redeem"
            message="Rewards go to members with a verified phone number. It takes a minute."
          />
        ) : null}

        {problem ? (
          <Alert tone="error" title="That did not work" message={problem} onDismiss={() => setProblem(null)} />
        ) : null}

        <Card radius="xl" padding="base">
          {step.kind === 'number' ? (
            <VStack gap="md">
              <AppText variant="h3">{title}</AppText>
              <AppText variant="caption" color="textSecondary">
                {intro}
              </AppText>
              <FormPhoneInput
                control={form.control}
                name="phone"
                label={isVerified ? 'New number' : 'Phone number'}
              />
              {needsPassword ? (
                <FormInput
                  control={form.control}
                  name="password"
                  label="Your password"
                  helper="Changing the number on your account needs your password."
                  secureTextEntry
                  textContentType="password"
                />
              ) : null}
              <Button
                label="Send code"
                variant="brand"
                fullWidth
                loading={isBusy}
                disabled={isBusy}
                onPress={() => onSend()}
              />
            </VStack>
          ) : (
            <VStack gap="md">
              <AppText variant="h3">Enter the code</AppText>
              <HStack align="center" gap="sm" wrap>
                <AppText variant="body" color="textSecondary">
                  {`We sent a ${CODE_LENGTH}-digit code to`}
                </AppText>
                <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
                  {formatPhoneNumber(step.phone)}
                </AppText>
                <Pressable
                  onPress={onChangeNumber}
                  feedback="opacity"
                  accessibilityRole="button"
                  accessibilityLabel="Change phone number"
                >
                  <AppText variant="bodyStrong" style={{ color: colors.brandAccent }}>
                    Change
                  </AppText>
                </Pressable>
              </HStack>
              <OtpInput
                ref={otpField}
                value={code}
                onChange={setCode}
                length={CODE_LENGTH}
                onComplete={verify}
                disabled={isBusy}
                autoFocus
                accessibilityLabel="One-time code"
              />
              <Button
                label="Verify"
                variant="brand"
                fullWidth
                loading={isBusy}
                disabled={isBusy || code.length < CODE_LENGTH}
                onPress={() => verify(code)}
              />
              <ResendOtpRow
                onResend={onResend}
                secondsUntilAvailable={resend.secondsLeft}
                isSending={isBusy}
              />
            </VStack>
          )}
        </Card>
      </KeyboardAwareScrollView>
    </Screen>
  );
};
