import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AppText,
  AuthHeroBackdrop,
  Button,
  Screen,
  VStack,
  Wordmark,
} from '../../components';
import { spacing } from '../../theme';
import type { AuthStackParamList } from '../../types/navigation';

/**
 * The only two rules the layout primitives cannot express, so the rest of the
 * screen carries no stylesheet at all.
 *
 * `heroArt` has to bleed *outside* the block it belongs to — that is what puts
 * the bloom behind the wordmark rather than beside it — and `ZStack` is no
 * help here because its overlays fill and anchor within the base child instead
 * of hanging past it. The offsets are still spacing tokens, not loose numbers.
 */
const styles = StyleSheet.create({
  heroArt: {
    position: 'absolute',
    top: -spacing.xxl,
    right: -spacing.base,
  },
  tagline: { letterSpacing: 2.4 },
});

export const WelcomeScreen = () => {
  const navigation =
    useNavigation<NativeStackNavigationProp<AuthStackParamList>>();

  const goToSignIn = useCallback(
    () => navigation.navigate('SignIn'),
    [navigation],
  );
  const goToSignUp = useCallback(
    () => navigation.navigate('SignUp'),
    [navigation],
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack flex={1} justify="between" pb="xl">
        <VStack flex={1} justify="center" gap="md">
          <VStack gap="xs" mb="base">
            <AuthHeroBackdrop style={styles.heroArt} />
            <Wordmark size="lg" />
            <AppText
              variant="label"
              color="textSecondary"
              style={styles.tagline}
            >
              Move • Earn • Achieve
            </AppText>
          </VStack>

          <AppText variant="display">Train with intent.</AppText>
          <AppText variant="body" color="textSecondary">
            Log every set, watch your volume climb, and keep the streak alive.
          </AppText>
        </VStack>

        <VStack gap="md">
          <Button
            label="Create an account"
            variant="brand"
            size="lg"
            fullWidth
            onPress={goToSignUp}
          />
          <Button
            label="I already have an account"
            variant="ghost"
            fullWidth
            onPress={goToSignIn}
          />
        </VStack>
      </VStack>
    </Screen>
  );
};
