import {
  BookOpen,
  CircleAlert,
  CircleHelp,
  Coins,
  Mail,
  Package,
  ShieldCheck,
  User,
  type LucideIcon,
} from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import type { SupportIcon, SupportTint } from '../../types/models';

/**
 * The glyph behind each name the server may send (RULES P12).
 *
 * The names are a closed enum in the contract and this is the other half of
 * it: support can reorder the help centre, reword a row or point it at
 * another shelf without an app release, but the glyphs themselves ship with
 * the app, because a name it could not draw would be a blank tile on a
 * member's screen.
 */
export const SUPPORT_ICON: Record<SupportIcon, LucideIcon> = {
  question: CircleHelp,
  mail: Mail,
  alert: CircleAlert,
  package: Package,
  coins: Coins,
  user: User,
  shield: ShieldCheck,
  guide: BookOpen,
};

/**
 * Which theme colour each tint name resolves to, in both schemes. Narrowed
 * to the plain colour tokens: the palette also holds gradients and nested
 * groups, and none of those is a glyph's colour.
 */
type ColorToken = {
  [K in keyof ThemeColors]: ThemeColors[K] extends string ? K : never;
}[keyof ThemeColors];

const TINT_TOKEN: Record<SupportTint, ColorToken> = {
  primary: 'primary',
  brandAccent: 'brandAccent',
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  gold: 'gold',
  // No purple of its own in the palette; the avatar's is the one that holds
  // its saturation in both schemes.
  purple: 'avatarPurple',
};

export const supportTint = (tint: SupportTint, colors: ThemeColors): string =>
  colors[TINT_TOKEN[tint]];
