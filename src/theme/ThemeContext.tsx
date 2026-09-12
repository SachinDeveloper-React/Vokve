import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { Theme } from '@react-navigation/native';
import { useColorScheme } from 'react-native';
import type { ThemeColors } from '../constants/colors';
import { darkColors, lightColors } from '../constants/colors';
import { mmkvStorage } from '../stores';
import { AppDarkTheme, AppLightTheme } from './navigationTheme';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ColorScheme = 'light' | 'dark';

const STORAGE_KEY = 'vokve.theme.mode';

interface ThemeContextValue {
  /** What the user picked — may be 'system'. */
  mode: ThemeMode;
  /** What is actually rendered — 'system' already resolved. */
  scheme: ColorScheme;
  isDark: boolean;
  colors: ThemeColors;
  navigationTheme: Theme;
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

// Storage is a convenience here, never a requirement. `mmkvStorage` builds its
// native instance lazily, so the first read is where a missing native module or
// a corrupted store surfaces — and losing a saved theme preference must never
// take the whole app down with it.
function readStoredMode(): ThemeMode {
  try {
    const stored = mmkvStorage.getItem(STORAGE_KEY);
    return isThemeMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writeStoredMode(mode: ThemeMode): void {
  try {
    mmkvStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Preference is kept in memory for this session only.
  }
}

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  // MMKV reads are synchronous, so the stored mode is available on first
  // render and the app never flashes the wrong theme.
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const systemScheme = useColorScheme();

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStoredMode(next);
  }, []);

  const scheme: ColorScheme =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const toggleTheme = useCallback(() => {
    setMode(scheme === 'dark' ? 'light' : 'dark');
  }, [scheme, setMode]);

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = scheme === 'dark';
    return {
      mode,
      scheme,
      isDark,
      colors: isDark ? darkColors : lightColors,
      navigationTheme: isDark ? AppDarkTheme : AppLightTheme,
      setMode,
      toggleTheme,
    };
  }, [mode, scheme, setMode, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
