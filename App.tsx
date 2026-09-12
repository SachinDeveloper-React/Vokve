import React from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme';
import ErrorBoundary from './src/components/common/ErrorBoundary';
import { OfflineBanner, ToastProvider } from './src/components/feedback';

enableFreeze(true);

const App = () => (
  <SafeAreaProvider>
    <ThemeProvider>
      <ErrorBoundary>
        <KeyboardProvider>
          <ToastProvider>
            <RootNavigator />
            <OfflineBanner />
          </ToastProvider>
        </KeyboardProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </SafeAreaProvider>
);

export default App;
