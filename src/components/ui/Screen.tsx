import React, { memo } from 'react';
import { StatusBar, StyleSheet, View, ViewProps } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';
import { useTheme, useThemedStyles, type ThemeShape } from '../../theme';

interface Props extends ViewProps {
  children: React.ReactNode;
  edges?: readonly Edge[];
  padded?: boolean;
  constrained?: boolean;
}

const MAX_CONTENT_WIDTH = 640;

const makeStyles = ({ colors, spacing }: ThemeShape) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, width: '100%' },
    padded: { paddingHorizontal: spacing.base },
    centered: { alignSelf: 'center', maxWidth: MAX_CONTENT_WIDTH },
  });
export const Screen = memo(
  ({
    children,
    edges = ['top'],
    padded = true,
    constrained = true,
    style,
    ...rest
  }: Props) => {
    const styles = useThemedStyles(makeStyles);
    const { isDark } = useTheme();
    const { width } = useResponsive();

    const shouldConstrain = constrained && width > MAX_CONTENT_WIDTH;

    return (
      <SafeAreaView style={styles.safeArea} edges={edges}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <View
          style={[
            styles.content,
            padded && styles.padded,
            shouldConstrain && styles.centered,
            style,
          ]}
          {...rest}
        >
          {children}
        </View>
      </SafeAreaView>
    );
  },
);

Screen.displayName = 'Screen';
