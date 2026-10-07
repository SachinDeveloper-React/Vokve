import {
  BadgeCheck,
  Cloud,
  CupSoda,
  Diamond,
  Droplets,
  Feather,
  Hand,
  Info,
  Layers,
  MoveDiagonal2,
  Ruler,
  Scaling,
  ShieldCheck,
  Shirt,
  Thermometer,
  Umbrella,
  WashingMachine,
  Waves,
  Weight,
  Wind,
  type LucideIcon,
} from 'lucide-react-native';
import type { ThemeColors } from '../../constants/colors';
import type { ShopFeatureIcon, ShopSpecIcon } from '../../types/models';

/** The glyph for each kind of fact the catalogue can state about an item. */
export const SPEC_ICONS: Record<ShopSpecIcon, LucideIcon> = {
  category: Diamond,
  fabric: Waves,
  material: Layers,
  care: WashingMachine,
  fit: Shirt,
  sizes: Ruler,
  weight: Weight,
  dimensions: Scaling,
  capacity: CupSoda,
  warranty: ShieldCheck,
  info: Info,
};

/**
 * The glyph and tint for each key feature. The tints are theme tokens so a
 * feature reads the same in both themes; each one differs from its
 * neighbours so four in a row stay distinct.
 */
export const FEATURE_ICONS: Record<
  ShopFeatureIcon,
  { icon: LucideIcon; tint: (colors: ThemeColors) => string }
> = {
  breathable: { icon: Wind, tint: c => c.avatarGreen },
  lightweight: { icon: Feather, tint: c => c.avatarPrimary },
  stretch: { icon: MoveDiagonal2, tint: c => c.avatarPurple },
  durable: { icon: ShieldCheck, tint: c => c.avatarOrange },
  quick_dry: { icon: Droplets, tint: c => c.avatarCyan },
  grip: { icon: Hand, tint: c => c.avatarIndigo },
  cushioned: { icon: Cloud, tint: c => c.avatarPink },
  waterproof: { icon: Umbrella, tint: c => c.avatarCyan },
  insulated: { icon: Thermometer, tint: c => c.avatarRed },
  check: { icon: BadgeCheck, tint: c => c.avatarGreen },
};
