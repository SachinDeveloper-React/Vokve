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
 */
export const AppImage = memo(
  ({ uri, width, height, radius = 'md', fallback, style, ...rest }: Props) => {
    const { colors } = useTheme();
    const [isLoading, setIsLoading] = useState(Boolean(uri));
    const [hasFailed, setHasFailed] = useState(false);

    const onLoadEnd = useCallback(() => setIsLoading(false), []);
    const onError = useCallback(() => {
      setIsLoading(false);
      setHasFailed(true);
    }, []);

    const frame = {
      width,
      height,
      borderRadius: radiusTokens[radius],
      backgroundColor: colors.muted,
    };

    if (!uri || hasFailed) {
      return (
        <View style={[styles.center, frame]}>
          {fallback ?? null}
        </View>
      );
    }

    return (
      <View style={frame}>
        <Image
          source={{ uri }}
          style={[styles.fill, { borderRadius: radiusTokens[radius] }, style]}
          onLoadEnd={onLoadEnd}
          onError={onError}
          accessibilityIgnoresInvertColors
          {...rest}
        />
        {isLoading ? (
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
