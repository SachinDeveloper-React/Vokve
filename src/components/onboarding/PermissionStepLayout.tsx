import React, { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../theme';
import { InfoNote } from '../feedback/InfoNote';
import { HStack, VStack } from '../layout/Stack';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { IconBadge } from '../ui/IconBadge';
import { Screen } from '../ui/Screen';

/** One thing the permission is for, said in a line. */
export interface PermissionPoint {
  icon: LucideIcon;
  text: string;
}

interface Props {
  /** Which of the screens this is, from 1. */
  step: number;
  total: number;
  icon: LucideIcon;
  /** The screen's colour: the hero disc, the points' glyphs, the progress. */
  tint: string;
  title: string;
  message: string;
  points: PermissionPoint[];
  /** A tip below the points — what to do in another app, say. */
  note?: { icon: LucideIcon; title: string; message: string };
  allowLabel: string;
  onAllow: () => void;
  /** The ask is in flight; both buttons wait for it. */
  busy?: boolean;
  skipLabel?: string;
  onSkip: () => void;
  /** What the system dialog that follows will call it. */
  footnote?: string;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  segment: { flex: 1, height: 4, borderRadius: 2 },
  point: { flex: 1 },
});

/**
 * One of the permission screens after sign-in: what is being asked for and
 * why, before the system dialog — which says neither — and a way past it.
 * Every screen offers "Not now": each permission is the user's to refuse,
 * and the app works without it.
 */
export const PermissionStepLayout = memo(
  ({
    step,
    total,
    icon,
    tint,
    title,
    message,
    points,
    note,
    allowLabel,
    onAllow,
    busy = false,
    skipLabel = 'Not now',
    onSkip,
    footnote,
  }: Props) => {
    const { colors } = useTheme();

    return (
      <Screen edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <VStack gap="xl" pt="sm" pb="lg">
            <VStack gap="sm">
              <HStack gap="xs">
                {Array.from({ length: total }, (_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.segment,
                      {
                        backgroundColor: index < step ? tint : colors.border,
                      },
                    ]}
                  />
                ))}
              </HStack>
              <AppText variant="label" color="textSecondary">
                {`Step ${step} of ${total}`}
              </AppText>
            </VStack>

            <VStack align="center" gap="base" pt="base">
              <IconBadge icon={icon} tint={tint} size={88} />
              <VStack align="center" gap="xs">
                <AppText variant="h1" center>
                  {title}
                </AppText>
                <AppText variant="body" color="textSecondary" center>
                  {message}
                </AppText>
              </VStack>
            </VStack>

            <VStack gap="md">
              {points.map(point => (
                <HStack key={point.text} gap="md" align="center">
                  <IconBadge icon={point.icon} tint={tint} size="sm" />
                  <AppText variant="body" style={styles.point}>
                    {point.text}
                  </AppText>
                </HStack>
              ))}
            </VStack>

            {note ? (
              <InfoNote
                icon={note.icon}
                title={note.title}
                message={note.message}
                tint={tint}
              />
            ) : null}
          </VStack>
        </ScrollView>

        <VStack gap="xs" pt="sm" pb="base">
          <Button
            label={allowLabel}
            variant="brand"
            size="lg"
            fullWidth
            loading={busy}
            disabled={busy}
            onPress={onAllow}
          />
          <Button
            label={skipLabel}
            variant="ghost"
            size="md"
            fullWidth
            disabled={busy}
            onPress={onSkip}
          />
          {footnote ? (
            <AppText variant="micro" color="textTertiary" center>
              {footnote}
            </AppText>
          ) : null}
        </VStack>
      </Screen>
    );
  },
);

PermissionStepLayout.displayName = 'PermissionStepLayout';
