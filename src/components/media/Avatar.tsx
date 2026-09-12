import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '../../constants/colors';
import { fontWeight, useTheme } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { AppImage } from './AppImage';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type PresenceStatus = 'online' | 'offline' | 'training';

const SIZES: Record<AvatarSize, number> = {
  xs: moderateScale(24),
  sm: moderateScale(32),
  md: moderateScale(44),
  lg: moderateScale(64),
  xl: moderateScale(96),
};

/** Palette used to give initials a stable, distinct colour per person. */
const AVATAR_TOKENS: Extract<keyof ThemeColors, `avatar${string}`>[] = [
  'avatarPrimary',
  'avatarPurple',
  'avatarGreen',
  'avatarOrange',
  'avatarRed',
  'avatarPink',
  'avatarIndigo',
  'avatarCyan',
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Same name always lands on the same colour, across sessions and devices. */
function tokenFor(name: string): (typeof AVATAR_TOKENS)[number] {
  // Kept inside a modulo rather than relying on bitwise coercion, so the
  // accumulator cannot overflow into a negative index on a long name.
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 1000003;
  }
  return AVATAR_TOKENS[hash % AVATAR_TOKENS.length];
}

interface Props {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  status?: PresenceStatus;
  /**
   * Draws a coloured ring around the avatar. Pass `true` for the brand accent,
   * or a colour string for something specific such as a streak state.
   */
  ring?: boolean | string;
}

/**
 * Falls back to coloured initials when there is no photo — which is the common
 * case for a new account, not an edge case.
 */
export const Avatar = memo(({ name, uri, size = 'md', status, ring }: Props) => {
  const { colors } = useTheme();
  const dimension = SIZES[size];

  // The ring is drawn as a border on an outer box that is grown by twice the
  // ring width, so the portrait inside keeps the size the caller asked for
  // instead of being squeezed by the border.
  const ringWidth = ring ? Math.max(2, Math.round(dimension * 0.06)) : 0;
  const ringColor =
    typeof ring === 'string' ? ring : ring ? colors.brandAccent : undefined;
  const ringGap = ringWidth > 0 ? ringWidth + 2 : 0;
  const outer = dimension + ringGap * 2;

  const { background, initials } = useMemo(
    () => ({
      background: colors[tokenFor(name)],
      initials: initialsOf(name),
    }),
    [colors, name],
  );

  const statusColor =
    status === 'training'
      ? colors.warning
      : status === 'online'
      ? colors.success
      : colors.textTertiary;

  const dotSize = Math.max(8, Math.round(dimension * 0.28));

  const content = (
    <View style={{ width: dimension, height: dimension }}>
      {uri ? (
        <AppImage
          uri={uri}
          width={dimension}
          height={dimension}
          radius="pill"
        />
      ) : (
        <View
          style={[
            styles.initials,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              backgroundColor: background,
            },
          ]}
          accessibilityRole="image"
          accessibilityLabel={name}
        >
          <Text
            style={[
              styles.initialsText,
              { fontSize: dimension * 0.38, color: colors.primaryForeground },
            ]}
            maxFontSizeMultiplier={1.2}
          >
            {initials}
          </Text>
        </View>
      )}

      {status ? (
        <View
          style={[
            styles.status,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: statusColor,
              borderColor: colors.background,
            },
          ]}
        />
      ) : null}
    </View>
  );

  if (!ringColor) {
    return content;
  }

  return (
    <View
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: ringWidth,
          borderColor: ringColor,
        },
      ]}
    >
      {content}
    </View>
  );
});

Avatar.displayName = 'Avatar';

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontWeight: fontWeight.bold },
  status: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
