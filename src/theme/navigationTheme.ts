import { DefaultTheme, DarkTheme, Theme } from '@react-navigation/native';
import { darkColors, lightColors } from '../constants/colors';

export const AppLightTheme: Theme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: lightColors.primary,
    background: lightColors.background,
    card: lightColors.card,
    text: lightColors.foreground,
    border: lightColors.border,
    notification: lightColors.destructive,
  },
  fonts: DefaultTheme.fonts,
};

export const AppDarkTheme: Theme = {
  ...DarkTheme,
  dark: true,
  colors: {
    ...DarkTheme.colors,
    primary: darkColors.primary,
    background: darkColors.background,
    card: darkColors.card,
    text: darkColors.foreground,
    border: darkColors.border,
    notification: darkColors.destructive,
  },
  fonts: DarkTheme.fonts,
};
