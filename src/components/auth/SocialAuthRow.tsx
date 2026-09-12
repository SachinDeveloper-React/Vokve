import React, { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';
import { moderateScale } from '../../theme/responsive';
import { AppText } from '../ui/AppText';
import { Pressable } from '../form/Pressable';

export type SocialProvider = 'google' | 'apple' | 'facebook';

const MARK_SIZE = moderateScale(22);

/**
 * Brand marks, inlined as paths.
 *
 * lucide dropped its brand icons, and a provider's logo is the one glyph in
 * the app that must not be redrawn in the house icon style — a sign-in button
 * is only trustworthy if the mark on it is the real one.
 */
const GoogleMark = () => (
  <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox="0 0 18 18">
    <Path
      fill="#4285F4"
      d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
    />
    <Path
      fill="#34A853"
      d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.859-3.0477.859-2.344 0-4.3282-1.5831-5.036-3.7104H.9574v2.3318C2.4382 15.9832 5.4818 18 9 18z"
    />
    <Path
      fill="#FBBC05"
      d="M3.964 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.964 10.71z"
    />
    <Path
      fill="#EA4335"
      d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.964 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
    />
  </Svg>
);

/** Apple's mark is monochrome by design — it takes the theme's text colour. */
const AppleMark = ({ color }: { color: string }) => (
  <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox="0 0 24 24">
    <Path
      fill={color}
      d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
    />
  </Svg>
);

const FacebookMark = () => (
  <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox="0 0 24 24">
    <Path
      fill="#1877F2"
      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
    />
  </Svg>
);

const PROVIDERS: { id: SocialProvider; name: string }[] = [
  { id: 'google', name: 'Google' },
  { id: 'apple', name: 'Apple' },
  { id: 'facebook', name: 'Facebook' },
];

const makeStyles = ({ colors, spacing, radius }: ThemeShape) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: spacing.sm },
    tile: {
      flex: 1,
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
    },
    mark: { height: MARK_SIZE, justifyContent: 'center' },
    caption: { textAlign: 'center' },
    name: { textAlign: 'center' },
  });

interface Props {
  onSelect: (provider: SocialProvider) => void;
  disabled?: boolean;
}

interface TileProps extends Props {
  id: SocialProvider;
  name: string;
}

const SocialTile = memo(({ id, name, onSelect, disabled }: TileProps) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const handlePress = useCallback(() => onSelect(id), [id, onSelect]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      feedback="scale"
      accessibilityRole="button"
      // One label for the whole tile. Left to the two Texts, a screen reader
      // reads "Continue with" and "Google" as separate stops.
      accessibilityLabel={`Continue with ${name}`}
      style={styles.tile}
    >
      <View
        style={styles.mark}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {id === 'google' ? <GoogleMark /> : null}
        {id === 'apple' ? <AppleMark color={colors.text} /> : null}
        {id === 'facebook' ? <FacebookMark /> : null}
      </View>

      <AppText variant="caption" color="textSecondary" style={styles.caption}>
        Continue with
      </AppText>
      <AppText variant="bodyStrong" style={styles.name}>
        {name}
      </AppText>
    </Pressable>
  );
});

SocialTile.displayName = 'SocialTile';

/**
 * The three third-party sign-in options, as equal-width tiles.
 *
 * Equal width rather than sized to their labels: providers read as a single
 * choice, and a "Facebook" button twice the width of "Apple" quietly
 * recommends one of them.
 */
export const SocialAuthRow = memo(({ onSelect, disabled = false }: Props) => {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.row}>
      {PROVIDERS.map(provider => (
        <SocialTile
          key={provider.id}
          id={provider.id}
          name={provider.name}
          onSelect={onSelect}
          disabled={disabled}
        />
      ))}
    </View>
  );
});

SocialAuthRow.displayName = 'SocialAuthRow';
