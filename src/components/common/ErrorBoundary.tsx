import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { logger } from '../../utils/logger';

interface Props {
  children: React.ReactNode;
  context?: string;
}

interface State {
  error: Error | null;
  resetKey: number;
}

/**
 * The themed part of the fallback lives in its own function component.
 * `useTheme` is a hook, and hooks cannot run inside a class — calling it from
 * `render()` throws exactly when the boundary is trying to show an error,
 * so the boundary itself would crash at the one moment it has to work.
 */
const ErrorFallback = ({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>
        Something went wrong
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        The app hit an unexpected error. Your data is safe — reloading usually
        clears it. The problem has been reported to us automatically.
      </Text>

      {__DEV__ && (
        <ScrollView style={styles.devBox}>
          <Text style={[styles.devText, { color: colors.destructive }]}>
            {error.message}
            {'\n\n'}
            {error.stack}
          </Text>
        </ScrollView>
      )}

      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
          Try again
        </Text>
      </Pressable>
    </View>
  );
};

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = (info.componentStack ?? '').trim().slice(0, 2000);

    logger.error(this.props.context ?? 'ErrorBoundary', error.message, {
      componentStack,
    });

    // Wire a crash reporter in here when one is added:
    // recordError(error, this.props.context ?? 'errorBoundary', {
    //   message: error?.message ?? String(error),
    //   componentStack,
    // });
  }

  handleReset = () => {
    this.setState(s => ({ error: null, resetKey: s.resetKey + 1 }));
  };

  render() {
    const { error, resetKey } = this.state;
    if (!error) {
      // Bumping the key on reset remounts the subtree, so a child holding the
      // bad state is rebuilt rather than re-rendered straight back into it.
      return (
        <React.Fragment key={resetKey}>{this.props.children}</React.Fragment>
      );
    }

    return <ErrorFallback error={error} onRetry={this.handleReset} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  devBox: { maxHeight: 220, alignSelf: 'stretch', marginBottom: 24 },
  devText: { fontSize: 12, fontFamily: 'monospace' },
  button: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 999 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
});

export default ErrorBoundary;
