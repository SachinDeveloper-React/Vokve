export interface ThemeColors {
  background: string;
  foreground: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  inputBackground: string;
  switchBackground: string;
  ring: string;
  link: string;
  /** Wordmark colour. Flips with the theme so the logo stays legible. */
  brand: string;
  /** The wordmark's second colour. Stays orange in both themes. */
  brandAccent: string;
  success: string;
  warning: string;
  gold: string;
  notificationChallenge: string;
  notificationCoin: string;
  notificationProduct: string;
  avatarPrimary: string;
  avatarPurple: string;
  avatarGreen: string;
  avatarOrange: string;
  avatarRed: string;
  avatarPink: string;
  avatarIndigo: string;
  avatarCyan: string;
  tierBackground: string;
  tierForeground: string;
  tierProgress: string;
  overlayLight: string;
  overlayMedium: string;
  overlayHeavy: string;
  chart: {
    c1: string;
    c2: string;
    c3: string;
    c4: string;
    c5: string;
  };
  gradient: {
    primary: [string, string];
    secondary: [string, string];
    /**
     * The dark surface a screen's hero panel sits on — the profile summary,
     * the shop's coin banner. Dark in both themes: it is a feature panel
     * rather than a card, and inverting it in light mode would leave the
     * screen with two competing white surfaces.
     */
    hero: [string, string];
  };
  sidebar: {
    background: string;
    foreground: string;
    primary: string;
    primaryForeground: string;
    accent: string;
    accentForeground: string;
    border: string;
    ring: string;
  };
}

// ─── Light palette ────────────────────────────────────────────────────────────

export const lightColors: ThemeColors = {
  background: 'rgba(247, 248, 250, 1)',
  foreground: 'rgba(15, 23, 42, 1)',
  text: 'rgba(15, 23, 42, 1)',
  textSecondary: 'rgba(71, 85, 105, 1)',
  textTertiary: 'rgba(148, 163, 184, 1)',
  textQuaternary: 'rgba(203, 213, 225, 1)',
  card: 'rgba(255, 255, 255, 1)',
  cardForeground: 'rgba(15, 23, 42, 1)',
  popover: 'rgba(255, 255, 255, 1)',
  popoverForeground: 'rgba(15, 23, 42, 1)',
  primary: 'rgba(37, 99, 235, 1)',
  primaryForeground: 'rgba(255, 255, 255, 1)',
  secondary: 'rgba(241, 245, 249, 1)',
  secondaryForeground: 'rgba(15, 23, 42, 1)',
  muted: 'rgba(241, 245, 249, 1)',
  mutedForeground: 'rgba(100, 116, 139, 1)',
  accent: 'rgba(239, 244, 254, 1)',
  accentForeground: 'rgba(29, 78, 216, 1)',
  destructive: 'rgba(220, 38, 38, 1)',
  destructiveForeground: 'rgba(255, 255, 255, 1)',
  border: 'rgba(226, 232, 240, 1)',
  input: 'rgba(226, 232, 240, 1)',
  inputBackground: 'rgba(248, 250, 252, 1)',
  switchBackground: 'rgba(203, 213, 225, 1)',
  ring: 'rgba(37, 99, 235, 0.35)',
  link: 'rgba(29, 78, 216, 1)',
  brand: 'rgba(15, 23, 42, 1)',
  brandAccent: 'rgba(234, 88, 12, 1)',
  success: 'rgba(4, 120, 87, 1)',
  warning: 'rgba(180, 83, 9, 1)',
  gold: 'rgba(202, 138, 4, 1)',
  // Notification colors
  notificationChallenge: 'rgba(124, 58, 237, 1)',
  notificationCoin: 'rgba(245, 158, 11, 1)',
  notificationProduct: 'rgba(5, 150, 105, 1)',
  // Avatar colors
  avatarPrimary: 'rgba(37, 99, 235, 1)',
  avatarPurple: 'rgba(124, 58, 237, 1)',
  avatarGreen: 'rgba(5, 150, 105, 1)',
  avatarOrange: 'rgba(234, 88, 12, 1)',
  avatarRed: 'rgba(220, 38, 38, 1)',
  avatarPink: 'rgba(219, 39, 119, 1)',
  avatarIndigo: 'rgba(79, 70, 229, 1)',
  avatarCyan: 'rgba(8, 145, 178, 1)',
  // Tier/Premium colors
  tierBackground: 'rgba(15, 23, 42, 1)',
  tierForeground: 'rgba(248, 250, 252, 1)',
  tierProgress: 'rgba(245, 158, 11, 1)',
  // Overlay colors — layered on top of dark surfaces (tier cards, gradients, media)
  overlayLight: 'rgba(255, 255, 255, 0.08)',
  overlayMedium: 'rgba(255, 255, 255, 0.14)',
  overlayHeavy: 'rgba(255, 255, 255, 0.24)',
  chart: {
    c1: 'rgba(37, 99, 235, 1)',
    c2: 'rgba(13, 148, 136, 1)',
    c3: 'rgba(124, 58, 237, 1)',
    c4: 'rgba(245, 158, 11, 1)',
    c5: 'rgba(220, 38, 38, 1)',
  },
  gradient: {
    primary: ['rgba(37, 99, 235, 1)', 'rgba(79, 70, 229, 1)'],
    secondary: ['rgba(14, 165, 233, 1)', 'rgba(13, 148, 136, 1)'],
    hero: ['rgba(26, 18, 15, 1)', 'rgba(59, 33, 19, 1)'],
  },
  sidebar: {
    background: 'rgba(255, 255, 255, 1)',
    foreground: 'rgba(15, 23, 42, 1)',
    primary: 'rgba(37, 99, 235, 1)',
    primaryForeground: 'rgba(255, 255, 255, 1)',
    accent: 'rgba(241, 245, 249, 1)',
    accentForeground: 'rgba(15, 23, 42, 1)',
    border: 'rgba(226, 232, 240, 1)',
    ring: 'rgba(37, 99, 235, 0.35)',
  },
};

// ─── Dark palette ─────────────────────────────────────────────────────────────

export const darkColors: ThemeColors = {
  background: 'rgba(13, 17, 23, 1)',
  foreground: 'rgba(230, 237, 243, 1)',
  text: 'rgba(230, 237, 243, 1)',
  textSecondary: 'rgba(230, 237, 243, 0.68)',
  textTertiary: 'rgba(230, 237, 243, 0.42)',
  textQuaternary: 'rgba(230, 237, 243, 0.22)',
  card: 'rgba(21, 27, 35, 1)',
  cardForeground: 'rgba(230, 237, 243, 1)',
  popover: 'rgba(26, 33, 43, 1)',
  popoverForeground: 'rgba(230, 237, 243, 1)',
  primary: 'rgba(59, 130, 246, 1)',
  primaryForeground: 'rgba(255, 255, 255, 1)',
  secondary: 'rgba(28, 35, 45, 1)',
  secondaryForeground: 'rgba(230, 237, 243, 1)',
  muted: 'rgba(28, 35, 45, 1)',
  mutedForeground: 'rgba(139, 151, 166, 1)',
  accent: 'rgba(30, 39, 51, 1)',
  accentForeground: 'rgba(230, 237, 243, 1)',
  destructive: 'rgba(239, 68, 68, 1)',
  destructiveForeground: 'rgba(255, 255, 255, 1)',
  border: 'rgba(35, 43, 54, 1)',
  input: 'rgba(35, 43, 54, 1)',
  inputBackground: 'rgba(17, 22, 30, 1)',
  switchBackground: 'rgba(51, 61, 74, 1)',
  ring: 'rgba(59, 130, 246, 0.45)',
  link: 'rgba(96, 165, 250, 1)',
  // Near-white on dark: the navy used in light mode would vanish here.
  brand: 'rgba(230, 237, 243, 1)',
  // Lifted a step so it holds its saturation against a dark background.
  brandAccent: 'rgba(251, 146, 60, 1)',
  success: 'rgba(52, 211, 153, 1)',
  warning: 'rgba(251, 191, 36, 1)',
  gold: 'rgba(227, 179, 65, 1)',
  // Notification colors
  notificationChallenge: 'rgba(167, 139, 250, 1)',
  notificationCoin: 'rgba(251, 191, 36, 1)',
  notificationProduct: 'rgba(52, 211, 153, 1)',
  // Avatar colors
  avatarPrimary: 'rgba(59, 130, 246, 1)',
  avatarPurple: 'rgba(167, 139, 250, 1)',
  avatarGreen: 'rgba(16, 185, 129, 1)',
  avatarOrange: 'rgba(251, 146, 60, 1)',
  avatarRed: 'rgba(248, 113, 113, 1)',
  avatarPink: 'rgba(244, 114, 182, 1)',
  avatarIndigo: 'rgba(129, 140, 248, 1)',
  avatarCyan: 'rgba(34, 211, 238, 1)',
  // Tier/Premium colors
  tierBackground: 'rgba(26, 33, 43, 1)',
  tierForeground: 'rgba(230, 237, 243, 1)',
  tierProgress: 'rgba(251, 191, 36, 1)',
  // Overlay colors — layered on top of dark surfaces (tier cards, gradients, media)
  overlayLight: 'rgba(255, 255, 255, 0.06)',
  overlayMedium: 'rgba(255, 255, 255, 0.1)',
  overlayHeavy: 'rgba(255, 255, 255, 0.18)',
  chart: {
    c1: 'rgba(96, 165, 250, 1)',
    c2: 'rgba(45, 212, 191, 1)',
    c3: 'rgba(167, 139, 250, 1)',
    c4: 'rgba(251, 191, 36, 1)',
    c5: 'rgba(248, 113, 113, 1)',
  },
  gradient: {
    primary: ['rgba(59, 130, 246, 1)', 'rgba(99, 102, 241, 1)'],
    secondary: ['rgba(56, 189, 248, 1)', 'rgba(45, 212, 191, 1)'],
    // Lifted a step so the panel still separates from the dark background.
    hero: ['rgba(31, 23, 19, 1)', 'rgba(66, 38, 22, 1)'],
  },
  sidebar: {
    background: 'rgba(17, 22, 30, 1)',
    foreground: 'rgba(230, 237, 243, 1)',
    primary: 'rgba(59, 130, 246, 1)',
    primaryForeground: 'rgba(255, 255, 255, 1)',
    accent: 'rgba(28, 35, 45, 1)',
    accentForeground: 'rgba(230, 237, 243, 1)',
    border: 'rgba(35, 43, 54, 1)',
    ring: 'rgba(59, 130, 246, 0.45)',
  },
};
