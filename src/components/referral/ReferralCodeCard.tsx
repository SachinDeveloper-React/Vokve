import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Copy, Sparkles } from 'lucide-react-native';
import { radius, useTheme } from '../../theme';
import { withAlpha } from '../../utils/color';
import { HStack, VStack } from '../layout/Stack';
import { Icon } from '../media/Icon';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Pressable } from '../form/Pressable';

interface Props {
  code: string;
  onPressCopy: () => void;
  onPressShare: () => void;
}

/**
 * The code, and the two ways to hand it over.
 *
 * Copy and share are separate controls because they are separate habits: one
 * user pastes the code into a chat that is already open, another wants the
 * share sheet to pick the app. Folding copy into share would cost the first
 * user two extra taps every time.
 *
 * The box is dashed on purpose: it is the one thing on the screen that is
 * meant to be picked up and taken elsewhere, and a dashed edge is the oldest
 * way a screen has of saying so.
 */
export const ReferralCodeCard = memo(
  ({ code, onPressCopy, onPressShare }: Props) => {
    const { colors, isDark } = useTheme();

    return (
      <Card radius="xl" padding="base">
        <VStack gap="base">
          <AppText variant="bodyStrong">Your Referral Code</AppText>

          <Pressable
            onPress={onPressCopy}
            feedback="opacity"
            accessibilityRole="button"
            accessibilityLabel={`Your referral code, ${code
              .split('')
              .join(' ')}. Copy it`}
          >
            <View
              style={[
                styles.box,
                {
                  borderColor: withAlpha(
                    colors.brandAccent,
                    isDark ? 0.5 : 0.35,
                  ),
                  backgroundColor: withAlpha(
                    colors.brandAccent,
                    isDark ? 0.08 : 0.05,
                  ),
                },
              ]}
            >
              <HStack align="center" justify="center" gap="md">
                <AppText
                  variant="h1"
                  numberOfLines={1}
                  style={[styles.code, { color: colors.brandAccent }]}
                >
                  {code}
                </AppText>
                <Icon as={Copy} size="sm" tint={colors.brandAccent} />
              </HStack>
            </View>
          </Pressable>

          <Button
            label="Share Your Code"
            icon={<Icon as={Sparkles} size="sm" color="primaryForeground" />}
            variant="brand"
            size="lg"
            fullWidth
            onPress={onPressShare}
          />

          <AppText variant="miniMicro" color="textSecondary" center>
            Share via WhatsApp, Instagram, SMS or more
          </AppText>
        </VStack>
      </Card>
    );
  },
);

ReferralCodeCard.displayName = 'ReferralCodeCard';

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  code: { letterSpacing: 2 },
});
