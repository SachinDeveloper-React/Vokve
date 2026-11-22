import React, { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageProps,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
} from 'react-native';
import { mediaUri } from '../../services/api/mediaUri';
import { radius as radiusTokens, useTheme } from '../../theme';
import type { RadiusToken } from '../layout/Box';

interface Props extends Omit<ImageProps, 'source' | 'style'> {
  uri: string | null | undefined;
  width: number;
  height: number;
  radius?: RadiusToken;
  /** Rendered when there is no uri, or when loading fails. */
  fallback?: React.ReactNode;
  style?: StyleProp<ImageStyle>;
}

/**
 * Image with explicit dimensions, a loading placeholder and a failure state.
 *
 * Width and height are required on purpose: an image without an intrinsic size
 * lays out at zero and then jumps to full size once it decodes, which shifts
 * everything below it. Reserving the space up front avoids that jump.
 *
 * Loading and failure are recorded against the address they happened to,
 * not as booleans. A new address (a photo the member just uploaded) then
 * starts out loading by itself. When a failure was kept as a boolean, one
 * failed photo left the frame empty for every later photo until the screen
 * was rebuilt.
 */
export const AppImage = memo(
  ({ uri, width, height, radius = 'md', fallback, style, ...rest }: Props) => {
    const { colors } = useTheme();
    const source = uri ? mediaUri(uri) : null;
    const [settled, setSettled] = useState<string | null>(null);
    const [failed, setFailed] = useState<string | null>(null);

    const onLoadEnd = useCallback(() => setSettled(source), [source]);
    const onError = useCallback(() => {
      setSettled(source);
      setFailed(source);
    }, [source]);

    const frame = {
      width,
      height,
      borderRadius: radiusTokens[radius],
      backgroundColor: colors.muted,
    };

    if (!source || failed === source) {
      return (
        <View style={[styles.center, frame]}>
          {fallback ?? null}
        </View>
      );
    }

    return (
      <View style={frame}>
        <Image
          source={{ uri: source }}
          style={[styles.fill, { borderRadius: radiusTokens[radius] }, style]}
          onLoadEnd={onLoadEnd}
          onError={onError}
          accessibilityIgnoresInvertColors
          {...rest}
        />
        {settled !== source ? (
          <View style={[styles.center, styles.overlay]}>
            <ActivityIndicator size="small" color={colors.textTertiary} />
          </View>
        ) : null}
      </View>
    );
  },
);

AppImage.displayName = 'AppImage';

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
